// src/services/deudaRepository.js
// Logica de deudas de clientes. Pasar un pedido facturado a "Deudas" es una
// accion manual (boton "Pasar a deudas" en Facturacion): asi el admin puede
// primero ajustar items que el cliente descuenta al recibir el pedido, y
// recien despues anotar el monto EXACTO que va a salir a cobrar. Al cierre
// del dia se va cobrando desde Deudas, completa o parcialmente (lo que no se
// cobra queda como saldo).
import { addDeuda, updateDeuda, deleteDeuda, getDeudas } from '../db';
import { syncDeudas } from '../sync/syncService';
import { anularDeuda } from '../domain/deudas';
import { totalACobrar } from '../domain/redondeo';
import { validarCobro, registrarCobroEnDeuda } from '../domain/cobranza';
import { getLocalTodayStr, normalizePedidoFecha, deudaEsDePedido, saldoDeuda } from '../utils/pedidos';

// Se guarda localmente siempre. Esto sube el cambio a Supabase; si falla
// (tabla sin crear, sin permisos, sin internet real aunque figure online)
// hay que ENTERARSE, asi que se espera y se relanza con un mensaje claro
// en vez de tragarse el error en una promesa que nadie mira.
const syncSafe = async () => {
  if (!navigator.onLine) return;
  try {
    await syncDeudas();
  } catch (e) {
    const msg = e?.message || String(e);
    console.error('syncDeudas fallo:', msg);
    throw new Error('Se guardo en este dispositivo, pero no se subio a Supabase: ' + msg);
  }
};

const deudasDePedido = async (pedido) => (await getDeudas()).filter(d => deudaEsDePedido(d, pedido));

// Pasa un pedido facturado a Deudas: anota el monto EXACTO que tiene el
// pedido en este momento (por si se le descontaron items al entregarlo), con
// la fecha DEL PEDIDO. Se hace una sola vez por pedido: si ya existe una
// deuda de ese pedido no se crea otra. (No se mira pedido.deudaGenerada aca:
// quien llama ya lo puso en true antes de guardar el pedido, y cortar por eso
// impedia crear la deuda.)
export const registrarDeudaFacturado = async (pedido, cliente) => {
  if (!pedido) return false;
  // AC-RED-2: la deuda es lo que se cobra (total redondeado si el pedido lo tiene congelado).
  const monto = totalACobrar(pedido);
  if (monto <= 0) return false;
  if ((await deudasDePedido(pedido)).length > 0) return false;

  await addDeuda({
    clienteId: pedido.clienteId ?? cliente?.id ?? null,
    clienteNombre: pedido.clienteNombre || cliente?.nombre || '',
    pedidoId: pedido.remoteId ?? null,
    pedidoLocalId: pedido.id ?? null,
    monto,
    montoPagado: 0,
    concepto: cliente?.boletaContraBoleta ? 'Boleta contra boleta' : 'Boleta',
    fecha: normalizePedidoFecha(pedido.fecha) || getLocalTodayStr(),
    pagada: false,
    pagadaAt: null,
    pagadaPor: null,
  });
  await syncSafe();
  return true;
};

// Si el pedido vuelve a pendiente, su deuda deja de existir... salvo que ya se
// haya cobrado algo: esa plata entro, asi que la deuda se conserva.
// Devuelve { quitada, conservada }.
export const quitarDeudaDePedido = async (pedido) => {
  const deudas = await deudasDePedido(pedido);
  let quitada = false;
  let conservada = false;

  for (const d of deudas) {
    if (d.pagada || Number(d.montoPagado || 0) > 0) {
      conservada = true;
      continue;
    }
    if (d.remoteId) {
      // AC-SEG2-1: la nube no admite delete (migracion 023): se anula, online y offline, y se sube.
      await updateDeuda(anularDeuda(d));
    } else {
      await deleteDeuda(d.id);
    }
    quitada = true;
  }
  if (quitada) await syncSafe();
  return { quitada, conservada };
};

// Si cambia el total de un pedido ya facturado (edicion en Facturacion/Armado),
// la deuda acompana el nuevo monto. Lo ya cobrado se respeta. `nuevoTotal` es lo que se
// cobra: quien llama pasa totalACobrar(pedido) (con el redondeo congelado, AC-RED-2).
export const actualizarMontoDeudaDePedido = async (pedido, nuevoTotal) => {
  const total = Number(nuevoTotal || 0);
  const deudas = await deudasDePedido(pedido);
  let cambio = false;

  for (const d of deudas) {
    if (Number(d.monto) === total) continue;
    const pagado = Number(d.montoPagado || 0);
    const pagada = total > 0 ? pagado >= total - 0.001 : true;
    await updateDeuda({
      ...d,
      monto: total,
      pagada,
      pagadaAt: pagada ? (d.pagadaAt || Date.now()) : null,
      synced: false,
      updatedAt: Date.now(),
    });
    cambio = true;
  }
  if (cambio) await syncSafe();
  return cambio;
};

// Cobro total (sin monto) o parcial (con monto). Lo que no se cobra queda como saldo.
// AC-DMP-1: con `medio` ('efectivo' | 'transferencia') el cobro se anota en el historial de la deuda
// (UUID, idempotente) con su referencia opcional; la UI exige elegir el medio. Sin `medio` se conserva
// el cobro de siempre (queda como "sin dato").
export const cobrarDeuda = async (deuda, monto = null, por = null, { medio = null, referencia = '' } = {}) => {
  const saldo = saldoDeuda(deuda);
  const cobra = monto == null ? saldo : Math.min(Math.max(Number(monto) || 0, 0), saldo);
  if (cobra <= 0) return deuda;

  let actualizada;
  if (medio) {
    const v = validarCobro({ medio, referencia, monto: cobra }, deuda);
    if (!v.ok) throw new Error(v.errores[0]);
    actualizada = registrarCobroEnDeuda(deuda, v.cobro, { por });
  } else {
    const montoPagado = Number(deuda.montoPagado || 0) + cobra;
    const pagada = montoPagado >= Number(deuda.monto || 0) - 0.001;
    actualizada = { ...deuda, montoPagado, pagada, pagadaAt: pagada ? Date.now() : null, pagadaPor: por || null };
  }
  actualizada = { ...actualizada, synced: false, updatedAt: Date.now() };
  await updateDeuda(actualizada);
  await syncSafe();
  return actualizada;
};

// Cobra el saldo completo de todas las deudas de un cliente (de la mas vieja a la mas nueva).
export const cobrarTodoDelCliente = async (deudasCliente, por = null, opciones = {}) => {
  const ordenadas = [...deudasCliente].sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
  for (const d of ordenadas) await cobrarDeuda(d, null, por, opciones);
};

// Anula todos los cobros de una deuda (vuelve a deber el monto completo).
export const deshacerCobros = async (deuda) => {
  await updateDeuda({
    ...deuda, montoPagado: 0, pagada: false, pagadaAt: null, pagadaPor: null,
    cobros: [], medioPago: null, referenciaPago: null, synced: false, updatedAt: Date.now(),
  });
  await syncSafe();
};

export const crearDeudaManual = async ({ cliente, monto, concepto }) => {
  await addDeuda({
    clienteId: cliente.id,
    clienteNombre: cliente.nombre,
    pedidoId: null,
    pedidoLocalId: null,
    monto: Number(monto),
    montoPagado: 0,
    concepto: (concepto || '').trim() || 'Deuda manual',
    fecha: getLocalTodayStr(),
    pagada: false,
    pagadaAt: null,
    pagadaPor: null,
  });
  await syncSafe();
};

export const borrarDeuda = async (deuda) => {
  if (deuda.remoteId) {
    // AC-SEG2-1: ya no se borra en la nube (migracion 023): se anula y la anulacion se sube.
    await updateDeuda(anularDeuda(deuda));
    await syncSafe();
    return;
  }
  await deleteDeuda(deuda.id);
};

// ---------------------------------------------------------------------------
// REQ-REN (AC-REN-3 / AC-REN-4): efectos de una rendicion sobre la tabla legacy de deudas.
// Aditivo: no cambia nada de lo de arriba. Los textos solo llevan "#<8 chars>" del UUID (D3).
// El sync de deudas es "best effort": lo local ya quedo grabado y se sube en el proximo sync.
// ---------------------------------------------------------------------------
const syncSilencioso = async () => {
  if (!navigator.onLine) return;
  try { await syncDeudas(); } catch (e) { console.error('syncDeudas fallo:', e?.message || String(e)); }
};

// Los ids locales de clientes son numericos (autoIncrement): '5' -> 5 para que Deudas los agrupe igual.
export const clienteIdLocal = (v) => (typeof v === 'string' && /^\d{1,15}$/.test(v) ? Number(v) : v);

const cobrarLocal = async (deuda, montoPesos, por) => {
  const cobra = Math.min(Math.max(Number(montoPesos) || 0, 0), saldoDeuda(deuda));
  if (cobra <= 0) return false;
  // AC-DMP-1: lo aplicado por una rendicion se anota con el medio interno 'rendicion' (no elegible en la UI).
  const actualizada = registrarCobroEnDeuda(deuda, { medio: 'rendicion', montoCents: Math.round(cobra * 100) }, { por });
  await updateDeuda({ ...actualizada, synced: false, updatedAt: Date.now() });
  return true;
};

/** Cobra de cada deuda lo indicado por planEfectoCuenta (centavos). Devuelve cuantas toco. */
export const aplicarCobrosRendicion = async (cobros = [], por = null) => {
  const porId = new Map((await getDeudas()).map(d => [d.id, d]));
  let n = 0;
  for (const c of Array.isArray(cobros) ? cobros : []) {
    const d = porId.get(c?.deudaId);
    if (d && await cobrarLocal(d, (Number(c.montoCents) || 0) / 100, por)) n += 1;
  }
  if (n) await syncSilencioso();
  return n;
};

/** Deuda nueva por un cargo/reversion. Anti-duplicado local por concepto (lleva el #id corto). */
export const crearDeudaRendicion = async ({ clienteId, clienteNombre, montoCents, concepto, fecha }) => {
  const monto = (Number(montoCents) || 0) / 100;
  if (monto <= 0 || !concepto) return false;
  const existe = (await getDeudas()).some(d => d.concepto === concepto && String(d.clienteId ?? '') === String(clienteId ?? ''));
  if (existe) return false;
  await addDeuda({
    clienteId: clienteIdLocal(clienteId), clienteNombre: clienteNombre || '', pedidoId: null, pedidoLocalId: null,
    monto, montoPagado: 0, concepto, fecha: fecha || getLocalTodayStr(), pagada: false, pagadaAt: null, pagadaPor: null,
  });
  await syncSilencioso();
  return true;
};

/** Anula la deuda del cargo de un cambio (sin cobros), igual que quitarDeudaDePedido. */
export const anularDeudaRendicion = async (deudaId) => {
  const d = (await getDeudas()).find(x => x.id === deudaId);
  if (!d || d.pagada || Number(d.montoPagado || 0) > 0) return false;
  if (d.remoteId) {
    await updateDeuda(anularDeuda(d));
  } else {
    await deleteDeuda(d.id);
  }
  await syncSilencioso();
  return true;
};

/** Baja el monto de una deuda a lo ya cobrado (cargo de un cambio anulado con cobros parciales). */
export const ajustarDeudaRendicion = async (deudaId, montoCents) => {
  const d = (await getDeudas()).find(x => x.id === deudaId);
  if (!d) return false;
  const monto = (Number(montoCents) || 0) / 100;
  const pagada = Number(d.montoPagado || 0) >= monto - 0.001;
  await updateDeuda({ ...d, monto, pagada, pagadaAt: pagada ? (d.pagadaAt || Date.now()) : null, synced: false, updatedAt: Date.now() });
  await syncSilencioso();
  return true;
};
