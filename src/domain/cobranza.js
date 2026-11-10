// src/domain/cobranza.js — REQ-RTO (AC-RTO-5), REQ-HRU (AC-HRU-1), REQ-DMP (AC-DMP-1).
// Saldo anterior del cliente, filas de la hoja de ruta y medio de pago de los cobros de deudas.
// Funciones puras: sin React, sin IndexedDB, sin Supabase.
import { texto, nuevoId } from './validacion';
import { totalACobrar } from './redondeo';
import { deudaEsDePedido, saldoDeuda } from '../utils/pedidos';
import { esDeudaAnulada } from './deudas';

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const centavos = (pesos) => Math.round((Number(pesos) || 0) * 100);
const norm = (s) => String(s || '').trim().toLowerCase();

export const MEDIOS_PAGO = Object.freeze(['efectivo', 'transferencia']);
export const ETIQUETA_MEDIO = Object.freeze({
  efectivo: 'Efectivo', transferencia: 'Transferencia', mixto: 'Mixto', rendicion: 'Rendición', sinDato: 'Sin dato',
});
// Valores que admite la columna deudas.medio_pago (migracion 025).
const MEDIOS_GUARDABLES = Object.freeze(['efectivo', 'transferencia', 'mixto', 'rendicion']);
export const MAX_REFERENCIA = 60;
export const MAX_COBROS = 200;

const mismoCliente = (d, pedido) => {
  const cid = pedido?.clienteId ?? null;
  return (cid != null && d?.clienteId != null)
    ? String(d.clienteId) === String(cid)
    : norm(d?.clienteNombre) === norm(pedido?.clienteNombre);
};

// AC-RTO-5: lo que el cliente ya debia (deudas pendientes) sin contar el pedido actual ni los
// pedidos de `excluirPedidos` (otros pedidos incluidos en la misma hoja: evita doble conteo).
export const saldoAnteriorCliente = (deudas, pedido, { excluirPedidos = [] } = {}) => {
  if (!pedido) return 0;
  const excluidos = (Array.isArray(excluirPedidos) ? excluirPedidos : []).filter(Boolean);
  let total = 0;
  for (const d of Array.isArray(deudas) ? deudas : []) {
    if (!d || !mismoCliente(d, pedido)) continue;
    if (deudaEsDePedido(d, pedido) || excluidos.some(p => deudaEsDePedido(d, p))) continue;
    total += saldoDeuda(d);
  }
  return r2(total);
};

const claveCliente = (p) => (p?.clienteId != null ? `id:${p.clienteId}` : `n:${norm(p?.clienteNombre)}`);

// AC-HRU-1: filas de la hoja de ruta a partir de calcularOrdenPorZona. El saldo anterior de un cliente
// se cuenta UNA sola vez (en su primer pedido de la hoja) y no incluye las deudas de los pedidos de la hoja.
export const filasHojaRuta = (gruposZona, { deudas = [], multiploVistaPrevia, direccionDe } = {}) => {
  const grupos = Array.isArray(gruposZona) ? gruposZona : [];
  const todos = grupos.flatMap(g => (g?.pedidos || []).map(x => x?.pedido).filter(Boolean));
  const vistos = new Set();
  const filas = [];
  for (const g of grupos) {
    for (const item of g?.pedidos || []) {
      const pedido = item?.pedido;
      if (!pedido) continue;
      // S-T2-07: si el pedido ya tiene deuda, se cobra lo que realmente falta (descuenta cobros parciales).
      const deudaPropia = (Array.isArray(deudas) ? deudas : []).find(d => d && !esDeudaAnulada(d) && deudaEsDePedido(d, pedido));
      const total = totalACobrar(pedido, { multiploVistaPrevia });
      const importe = deudaPropia ? r2(Math.min(total, saldoDeuda(deudaPropia))) : total;
      const k = claveCliente(pedido);
      const primera = !vistos.has(k);
      vistos.add(k);
      const saldoAnterior = primera
        ? saldoAnteriorCliente(deudas, pedido, { excluirPedidos: todos.filter(p => p !== pedido) })
        : 0;
      const dir = typeof direccionDe === 'function' ? direccionDe(pedido) : (pedido.direccion || '');
      filas.push({
        zona: g.etiqueta ?? '',
        zonaClave: g.clave ?? '',
        orden: item.orden,
        clienteNombre: pedido.clienteNombre || '',
        direccion: texto(dir, 200),
        importe,
        saldoAnterior,
        totalACobrar: r2(importe + saldoAnterior),
      });
    }
  }
  const suma = (campo) => r2(filas.reduce((s, f) => s + f[campo], 0));
  return {
    filas,
    totales: { pedidos: filas.length, importe: suma('importe'), saldoAnterior: suma('saldoAnterior'), totalACobrar: suma('totalACobrar') },
  };
};

// ---- AC-DMP-1: medio de pago de un cobro ----
// monto en pesos (opcional: sin monto cobra el saldo). Medio obligatorio; referencia opcional (<= 60).
export const validarCobro = ({ medio, referencia, monto } = {}, deuda = null) => {
  const errores = [];
  const m = typeof medio === 'string' ? medio.trim().toLowerCase() : '';
  if (!MEDIOS_PAGO.includes(m)) errores.push('Elegí el medio de pago: Efectivo o Transferencia.');
  const ref = texto(referencia, 500);
  if (ref.length > MAX_REFERENCIA) errores.push(`La referencia no puede pasar de ${MAX_REFERENCIA} caracteres.`);
  const saldo = deuda ? saldoDeuda(deuda) : null;
  let pesos = monto === undefined || monto === null || monto === '' ? saldo : Number(monto);
  if (pesos === null || !Number.isFinite(pesos) || pesos <= 0 || centavos(pesos) <= 0) errores.push('El monto a cobrar tiene que ser mayor a cero.');
  else if (saldo !== null) {
    if (saldo <= 0) errores.push('La deuda no tiene saldo para cobrar.');
    else pesos = Math.min(pesos, saldo);
  }
  if (errores.length) return { ok: false, errores, cobro: null };
  return { ok: true, errores: [], cobro: { medio: m, referencia: ref, montoCents: centavos(pesos) } };
};

const medioResumen = (cobros) => {
  const medios = new Set(cobros.map(c => c.medio));
  return medios.size === 1 ? [...medios][0] : 'mixto';
};

// Suma el cobro a la deuda y lo anota en su historial (`cobros`, con UUID: idempotente por id).
// No muta; si ya existe un cobro con ese id devuelve la deuda tal cual.
export const registrarCobroEnDeuda = (deuda, cobro, { now = Date.now(), genId = nuevoId, por = null } = {}) => {
  if (!deuda || !cobro) return deuda;
  const previos = Array.isArray(deuda.cobros) ? deuda.cobros : [];
  if (cobro.id && previos.some(c => c.id === cobro.id)) return deuda;
  const saldo = saldoDeuda(deuda);
  const cents = Math.min(Math.max(Math.round(Number(cobro.montoCents) || 0), 0), centavos(saldo));
  if (cents <= 0) return deuda;
  const nuevo = {
    id: cobro.id || genId(),
    montoCents: cents,
    medio: cobro.medio,
    referencia: texto(cobro.referencia, MAX_REFERENCIA),
    at: now,
    por: por ?? cobro.por ?? null,
  };
  const cobros = [...previos, nuevo];
  const montoPagado = r2(Number(deuda.montoPagado || 0) + cents / 100);
  const pagada = montoPagado >= Number(deuda.monto || 0) - 0.001;
  return {
    ...deuda,
    montoPagado,
    pagada,
    pagadaAt: pagada ? now : null,
    pagadaPor: por ?? deuda.pagadaPor ?? null,
    cobros,
    medioPago: medioResumen(cobros),
    referenciaPago: nuevo.referencia || deuda.referenciaPago || '',
  };
};

// Totales cobrados por medio, en centavos. Deudas con pago pero sin historial de cobros => "sinDato".
export const totalesPorMedio = (deudas) => {
  const out = { efectivo: 0, transferencia: 0, rendicion: 0, sinDato: 0 };
  for (const d of Array.isArray(deudas) ? deudas : []) {
    if (!d) continue;
    const cobros = Array.isArray(d.cobros) ? d.cobros : [];
    let enHistorial = 0;
    for (const c of cobros) {
      const k = ['efectivo', 'transferencia', 'rendicion'].includes(c?.medio) ? c.medio : 'sinDato';
      const cents = Math.round(Number(c?.montoCents) || 0);
      out[k] += cents;
      enHistorial += cents;
    }
    // BUG-1: lo cobrado antes del historial (pagos viejos sin medio) que el historial no cubre es "sin dato".
    const resto = centavos(d.montoPagado) - enHistorial;
    if (resto > 0) out.sinDato += resto;
  }
  return out;
};

// ---- Sync (migracion 025) ----
const sanearCobros = (v) => {
  if (!Array.isArray(v)) return undefined;
  const out = [];
  const ids = new Set();
  for (const c of v) {
    if (out.length >= MAX_COBROS) break;
    if (!c || typeof c !== 'object') continue;
    const id = texto(c.id, 64);
    const cents = Math.round(Number(c.montoCents));
    if (!id || ids.has(id) || !Number.isFinite(cents) || cents <= 0) continue;
    ids.add(id);
    out.push({
      id,
      montoCents: cents,
      medio: MEDIOS_GUARDABLES.includes(c.medio) ? c.medio : 'sinDato',
      referencia: texto(c.referencia, MAX_REFERENCIA),
      at: Number.isFinite(Number(c.at)) ? Number(c.at) : null,
      por: c.por == null ? null : texto(c.por, 80),
    });
  }
  return out;
};

// Las claves viajan solo si la deuda las conoce (un dispositivo viejo no las pisa con null).
export const deudaMedioToRemote = (d) => {
  if (!d || typeof d !== 'object') return {};
  const out = {};
  if (MEDIOS_GUARDABLES.includes(d.medioPago)) out.medio_pago = d.medioPago;
  else if (d.medioPago === null) out.medio_pago = null; // cobros deshechos: se limpia tambien en la nube
  if (d.referenciaPago !== undefined) out.referencia_pago = d.referenciaPago ? texto(d.referenciaPago, MAX_REFERENCIA) || null : null;
  const cobros = sanearCobros(d.cobros);
  if (cobros !== undefined) out.cobros = cobros.map(c => ({ ...c, medio: c.medio === 'sinDato' ? null : c.medio }));
  return out;
};

// Dato no confiable: se sanea. `undefined` (columna inexistente) o null conserva lo local.
export const deudaMedioFromRemote = (r, local) => {
  const out = {};
  const mp = r && r.medio_pago;
  const medioPago = MEDIOS_GUARDABLES.includes(mp) ? mp : local?.medioPago;
  if (medioPago !== undefined) out.medioPago = medioPago;
  const rp = r && r.referencia_pago;
  const ref = rp !== undefined && rp !== null ? texto(rp, MAX_REFERENCIA) : local?.referenciaPago;
  if (ref !== undefined) out.referenciaPago = ref;
  const cobros = sanearCobros(r && r.cobros);
  const resultado = cobros !== undefined ? cobros : local?.cobros;
  if (resultado !== undefined) out.cobros = resultado;
  return out;
};

export const COLUMNAS_025_DEUDAS = Object.freeze(['medio_pago', 'referencia_pago', 'cobros']);

export const sinColumnasDmp = (row) => {
  if (!row || typeof row !== 'object') return row;
  const { medio_pago: _m, referencia_pago: _r, cobros: _c, ...resto } = row;
  return resto;
};

export const nombraColumnaDmp = (error) => /medio_pago|referencia_pago|\bcobros\b/i.test(String(error?.message || ''));

// S-T2-03: union idempotente de los cobros de dos dispositivos (por id de cobro). `montoPagado` se
// recalcula desde los cobros unidos (+ lo "legacy" que no tiene cobro: el mayor de los dos lados),
// con tope en el monto de la deuda. No muta. Devuelve null si ninguno tiene cobros.
const sumaCents = (cobros) => cobros.reduce((s, c) => s + c.montoCents, 0);
export const unirCobrosDeuda = (local, remoto, { now = Date.now() } = {}) => {
  const cl = sanearCobros(local?.cobros) || [];
  const cr = sanearCobros(remoto?.cobros) || [];
  if (cl.length === 0 && cr.length === 0) return null;
  const ids = new Set(cr.map(c => c.id));
  const soloLocales = cl.filter(c => !ids.has(c.id));
  const cobros = [...cr, ...soloLocales].sort((a, b) => (a.at ?? 0) - (b.at ?? 0)).slice(0, MAX_COBROS);
  const legacy = Math.max(
    0,
    centavos(local?.montoPagado) - sumaCents(cl),
    centavos(remoto?.montoPagado) - sumaCents(cr),
  );
  const monto = Number(local?.monto ?? remoto?.monto ?? 0);
  const cents = Math.min(sumaCents(cobros) + legacy, centavos(monto));
  const montoPagado = r2(cents / 100);
  const pagada = montoPagado >= monto - 0.001 && monto > 0;
  return {
    cobros,
    montoPagado,
    pagada,
    pagadaAt: pagada ? (local?.pagadaAt ?? remoto?.pagadaAt ?? now) : null,
    medioPago: medioResumen(cobros),
    hayLocalesNuevos: soloLocales.length > 0,
  };
};
