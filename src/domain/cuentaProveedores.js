// src/domain/cuentaProveedores.js — REQ-CPR: cuenta corriente con proveedores.
// Funciones puras. Todo importe va en centavos enteros (nunca flotantes).
// saldo = compras (ingresos con costo + cargos manuales) − pagos; los anulados no cuentan.
import { texto, esFechaISO, hoyISO, nuevoId } from './validacion';
import { aCentavos } from './compras';

export const MEDIOS_PAGO = Object.freeze(['efectivo', 'transferencia', 'directa']);
export const ETIQUETA_MEDIO = Object.freeze({
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  directa: 'Transferencia directa del cliente al proveedor',
});

// Mismo tope que cuenta_proveedores.monto_centavos en la migración 012.
export const MAX_MONTO_CENTAVOS = 100_000_000_000;
// AC-CPR-2: comprobante adjunto.
export const ADJUNTO_MAX_BYTES = 5 * 1024 * 1024;
export const ADJUNTO_TIPOS = Object.freeze(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

export { aCentavos };

export const formatearCentavos = (c) => {
  const n = Math.round(Number(c) || 0);
  const signo = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const ent = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${signo}$${ent},${String(abs % 100).padStart(2, '0')}`;
};

// Día (YYYY-MM-DD) de una fecha ISO "solo día" o con hora (día local).
export const diaDe = (fecha) => {
  const s = String(fecha ?? '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const msDe = (v) => {
  if (typeof v === 'number') return v;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? 0 : t;
};

/**
 * AC-CPR-2: valida un pago o cargo manual.
 * form: { proveedorId, fecha, monto, medio, referencia, clienteId, pedidoId }
 * @returns {{ ok: boolean, errores: object, mov: object|null }}
 */
export const validarMovimientoCuenta = (form = {}, { tipo, proveedores = [], clientes = null, now = new Date(), genId = nuevoId, usuario = '' } = {}) => {
  const errores = {};
  const f = form && typeof form === 'object' ? form : {};
  if (tipo !== 'pago' && tipo !== 'cargo') errores.tipo = 'Tipo de movimiento inválido';

  const proveedorId = f.proveedorId ? String(f.proveedorId) : '';
  if (!proveedorId) errores.proveedorId = 'Elegí el proveedor';
  else if (!proveedores.some(p => String(p.id) === proveedorId)) errores.proveedorId = 'Proveedor inexistente';

  const fecha = f.fecha === undefined || f.fecha === null || String(f.fecha).trim() === '' ? hoyISO(now) : String(f.fecha).trim();
  if (!esFechaISO(fecha)) errores.fecha = 'Fecha inválida (AAAA-MM-DD)';

  const montoCentavos = aCentavos(f.monto);
  if (montoCentavos === null || montoCentavos <= 0) errores.monto = 'El monto tiene que ser mayor a 0';
  else if (montoCentavos > MAX_MONTO_CENTAVOS) errores.monto = 'Monto demasiado alto';

  let medio = null;
  if (tipo === 'pago') {
    medio = String(f.medio ?? '').trim().toLowerCase();
    if (!MEDIOS_PAGO.includes(medio)) { errores.medio = 'Elegí el medio de pago'; medio = null; }
  }

  // Cliente/pedido solo tienen sentido en "directa" (el cliente le pagó al proveedor).
  let clienteId = null;
  let pedidoId = null;
  if (tipo === 'pago' && medio === 'directa') {
    clienteId = f.clienteId ? String(f.clienteId) : null;
    pedidoId = f.pedidoId ? texto(f.pedidoId, 64) : null;
    if (clienteId && Array.isArray(clientes) && !clientes.some(c => String(c.id) === clienteId)) errores.clienteId = 'Cliente inexistente';
    if (pedidoId && !clienteId) errores.clienteId = 'Elegí el cliente del pedido';
  }

  if (Object.keys(errores).length) return { ok: false, errores, mov: null };
  const ts = now.getTime();
  return {
    ok: true,
    errores: {},
    mov: {
      id: genId(), proveedorId, tipo, fecha, montoCentavos, medio,
      referencia: texto(f.referencia, 300), clienteId, pedidoId,
      comprobantePath: null, anulado: null,
      usuario: texto(usuario, 80), creadoAt: ts, updatedAt: ts, pendingSync: true,
    },
  };
};

// AC-CPR-2: imagen o PDF de hasta 5 MB.
export const validarAdjunto = (archivo) => {
  const size = Number(archivo?.size);
  const type = String(archivo?.type ?? '').toLowerCase();
  if (!Number.isFinite(size) || size <= 0) return { ok: false, error: 'El archivo está vacío' };
  if (!ADJUNTO_TIPOS.includes(type)) return { ok: false, error: 'Solo se aceptan imágenes (jpg, png, webp) o PDF' };
  if (size > ADJUNTO_MAX_BYTES) return { ok: false, error: 'El archivo supera los 5 MB' };
  return { ok: true, error: '' };
};

export const extensionAdjunto = (type) => ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' }[String(type).toLowerCase()] || '');

/** AC-CPR-5: anula (no borra) un pago o cargo. Motivo obligatorio; ya anulado => error; las compras derivadas no se anulan. */
export const anularMovimiento = (mov, { motivo, usuario = '', now = new Date() } = {}) => {
  if (!mov || typeof mov !== 'object') return { ok: false, error: 'Movimiento inexistente', mov: null };
  if (mov.tipo !== 'pago' && mov.tipo !== 'cargo') return { ok: false, error: 'Las compras de un ingreso no se anulan acá (corregí el ingreso)', mov: null };
  if (mov.anulado) return { ok: false, error: 'El movimiento ya está anulado', mov: null };
  const m = texto(motivo, 300);
  if (!m) return { ok: false, error: 'Escribí el motivo de la anulación', mov: null };
  return {
    ok: true, error: '',
    mov: { ...mov, anulado: { motivo: m, usuario: texto(usuario, 80), at: now.toISOString() }, updatedAt: now.getTime(), pendingSync: true },
  };
};

const filasBase = (compras, movs, proveedorId) => {
  const rows = [];
  const prov = proveedorId === undefined || proveedorId === null || proveedorId === '' ? null : String(proveedorId);
  for (const c of Array.isArray(compras) ? compras : []) {
    if (!c || (prov && String(c.proveedorId) !== prov)) continue;
    rows.push({
      id: String(c.id), origen: 'ingreso', tipo: 'compra', fecha: diaDe(c.fecha), orden: msDe(c.fecha),
      montoCentavos: Math.round(Number(c.montoCentavos) || 0), medio: null, referencia: 'Ingreso de mercadería', anulado: null, mov: c,
    });
  }
  for (const m of Array.isArray(movs) ? movs : []) {
    if (!m || (prov && String(m.proveedorId) !== prov)) continue;
    rows.push({
      id: String(m.id), origen: 'cuenta', tipo: m.tipo, fecha: diaDe(m.fecha), orden: msDe(m.creadoAt),
      montoCentavos: Math.round(Number(m.montoCentavos) || 0), medio: m.medio || null, referencia: m.referencia || '',
      anulado: m.anulado || null, clienteId: m.clienteId || null, pedidoId: m.pedidoId || null, comprobantePath: m.comprobantePath || null, mov: m,
    });
  }
  return rows.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : (a.orden - b.orden) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
};

const efecto = (r) => (r.anulado ? 0 : (r.tipo === 'pago' ? -r.montoCentavos : r.montoCentavos));

/** AC-CPR-1: saldo = compras + cargos − pagos (anulados fuera). Puede ser negativo (saldo a favor). */
export const saldoProveedor = (compras = [], movs = [], proveedorId = null) =>
  filasBase(compras, movs, proveedorId).reduce((s, r) => s + efecto(r), 0);

/**
 * AC-CPR-3 / AC-CPR-5: movimientos en orden con saldo acumulado.
 * desde/hasta (YYYY-MM-DD, inclusivos) acotan las filas; saldoInicial es el saldo antes de `desde`.
 * medio filtra los pagos mostrados (compras y cargos no tienen medio); el saldo acumulado siempre es el real.
 */
export const estadoDeCuenta = (compras = [], movs = [], { proveedorId = null, desde = '', hasta = '', medio = '' } = {}) => {
  const todas = filasBase(compras, movs, proveedorId);
  let saldo = 0;
  let saldoInicial = 0;
  const filas = [];
  for (const r of todas) {
    if (desde && r.fecha < desde) { saldo += efecto(r); saldoInicial = saldo; continue; }
    if (hasta && r.fecha > hasta) continue;
    saldo += efecto(r);
    if (medio && r.medio !== medio) continue;
    filas.push({ ...r, efectoCentavos: efecto(r), saldoAcumulado: saldo });
  }
  const totalesPorMedio = { efectivo: 0, transferencia: 0, directa: 0, total: 0 };
  let totalCompras = 0;
  let totalAnulados = 0;
  for (const f of filas) {
    if (f.anulado) { totalAnulados += 1; continue; }
    if (f.tipo === 'pago') {
      if (MEDIOS_PAGO.includes(f.medio)) totalesPorMedio[f.medio] += f.montoCentavos;
      totalesPorMedio.total += f.montoCentavos;
    } else {
      totalCompras += f.montoCentavos;
    }
  }
  // saldo = saldo real al cierre del rango (aunque el filtro de medio oculte filas).
  return { filas, saldoInicial, saldoFinal: saldo, totalesPorMedio, totalCompras, totalAnulados };
};

// ---- Mapeos remotos (tabla cuenta_proveedores, migración 012) ----
const iso = (ms) => new Date(Number(ms) || Date.now()).toISOString();

export const movCuentaToRemote = (m = {}) => ({
  id: m.id,
  proveedor_id: String(m.proveedorId),
  tipo: m.tipo,
  fecha: m.fecha,
  monto_centavos: Math.round(Number(m.montoCentavos) || 0),
  medio: m.medio || null,
  referencia: m.referencia || null,
  cliente_id: m.clienteId || null,
  pedido_id: m.pedidoId || null,
  comprobante_path: m.comprobantePath || null,
  anulado: m.anulado ? { motivo: m.anulado.motivo, usuario: m.anulado.usuario || '', at: m.anulado.at } : null,
  usuario: m.usuario || null,
  creado_at: iso(m.creadoAt),
  updated_at: iso(m.updatedAt),
});

export const movCuentaFromRemote = (r = {}) => ({
  id: r.id,
  proveedorId: String(r.proveedor_id),
  tipo: r.tipo,
  fecha: diaDe(r.fecha),
  montoCentavos: Number(r.monto_centavos) || 0,
  medio: r.medio || null,
  referencia: r.referencia || '',
  clienteId: r.cliente_id || null,
  pedidoId: r.pedido_id || null,
  comprobantePath: r.comprobante_path || null,
  anulado: r.anulado_at ? { motivo: r.anulado_motivo || '', usuario: r.anulado_por || '', at: r.anulado_at } : null,
  usuario: r.usuario || '',
  creadoAt: msDe(r.creado_at),
  updatedAt: msDe(r.updated_at),
  pendingSync: false,
});
