// src/services/deudaRepository.js
// Logica de deudas de clientes. Pasar un pedido facturado a "Deudas" es una
// accion manual (boton "Pasar a deudas" en Facturacion): asi el admin puede
// primero ajustar items que el cliente descuenta al recibir el pedido, y
// recien despues anotar el monto EXACTO que va a salir a cobrar. Al cierre
// del dia se va cobrando desde Deudas, completa o parcialmente (lo que no se
// cobra queda como saldo).
import { supabase } from '../lib/supabase';
import { addDeuda, updateDeuda, deleteDeuda, getDeudas } from '../db';
import { syncDeudas } from '../sync/syncService';
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
  const monto = Number(pedido.total || 0);
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
    if (d.remoteId && navigator.onLine) {
      const { error } = await supabase.from('deudas').delete().eq('id', d.remoteId);
      if (error) throw error;
      await deleteDeuda(d.id);
    } else if (d.remoteId) {
      // Sin internet no se puede borrar en la nube: se anula y se sube despues.
      await updateDeuda({ ...d, monto: 0, pagada: true, concepto: 'Anulada', synced: false, updatedAt: Date.now() });
    } else {
      await deleteDeuda(d.id);
    }
    quitada = true;
  }
  if (quitada) await syncSafe();
  return { quitada, conservada };
};

// Si cambia el total de un pedido ya facturado (edicion en Facturacion/Armado),
// la deuda acompana el nuevo monto. Lo ya cobrado se respeta.
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
export const cobrarDeuda = async (deuda, monto = null, por = null) => {
  const saldo = saldoDeuda(deuda);
  const cobra = monto == null ? saldo : Math.min(Math.max(Number(monto) || 0, 0), saldo);
  if (cobra <= 0) return deuda;

  const montoPagado = Number(deuda.montoPagado || 0) + cobra;
  const pagada = montoPagado >= Number(deuda.monto || 0) - 0.001;
  const actualizada = {
    ...deuda,
    montoPagado,
    pagada,
    pagadaAt: pagada ? Date.now() : null,
    pagadaPor: por || null,
    synced: false,
    updatedAt: Date.now(),
  };
  await updateDeuda(actualizada);
  await syncSafe();
  return actualizada;
};

// Cobra el saldo completo de todas las deudas de un cliente (de la mas vieja a la mas nueva).
export const cobrarTodoDelCliente = async (deudasCliente, por = null) => {
  const ordenadas = [...deudasCliente].sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
  for (const d of ordenadas) await cobrarDeuda(d, null, por);
};

// Anula todos los cobros de una deuda (vuelve a deber el monto completo).
export const deshacerCobros = async (deuda) => {
  await updateDeuda({ ...deuda, montoPagado: 0, pagada: false, pagadaAt: null, pagadaPor: null, synced: false, updatedAt: Date.now() });
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
    if (!navigator.onLine) throw new Error('Necesitas conexion para borrar una deuda ya sincronizada.');
    const { error } = await supabase.from('deudas').delete().eq('id', deuda.remoteId);
    if (error) throw error;
  }
  await deleteDeuda(deuda.id);
};
