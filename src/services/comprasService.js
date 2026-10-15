// src/services/comprasService.js — REQ-INA / REQ-CPR (migracion 012).
// Costos de ingresos, cuenta con proveedores y pedidos al proveedor: son datos financieros, asi que
// viven local (IndexedDB, offline-first) y se suben/bajan SOLO por RPC con el PIN del admin
// (patron facturacionService). El PIN llega por parametro, viaja solo en la llamada y NO se guarda
// ni se loguea. Los comprobantes van a un bucket PRIVADO: subir y leer exige un permiso corto
// otorgado por RPC con PIN. Nada de este archivo toca stock.
import { supabase } from '../lib/supabase';
import {
  getIngresosCostos, putIngresosCostosRaw, clearIngresosCostosPendingSync,
  getCuentaProveedores, putCuentaProveedoresRaw, clearCuentaProveedoresPendingSync,
  getPedidosProveedor, putPedidosProveedorRaw, clearPedidosProveedorPendingSync,
  getComprobantesPendientes, putComprobantePendiente, deleteComprobantePendiente,
} from '../db';
import { syncStock } from './stockService';
import { costosToRemote, costosFromRemote } from '../domain/compras';
import { movCuentaToRemote, movCuentaFromRemote, validarAdjunto, extensionAdjunto } from '../domain/cuentaProveedores';
import { pedidoProveedorToRemote, pedidoProveedorFromRemote } from '../domain/pedidosProveedor';
import { leerCursorCompras, cursorConSolape, avanzarCursorCompras } from '../domain/cursorCompras';

export const BUCKET_COMPROBANTES = 'comprobantes-proveedores';
const TAM_LOTE = 500;
const PAGINA = 1000;
const CURSOR_KEY = 'comprasSyncCursor';

export const MENSAJES_COMPRAS = Object.freeze({
  pin_requerido: 'Ingresá el PIN de administrador.',
  no_autorizado: 'PIN incorrecto o tu usuario no está autorizado como admin en el servidor.',
  bloqueado: 'Demasiados intentos de PIN. Probá de nuevo en 15 minutos.',
  falta_migracion: 'Falta la migración 012 en Supabase: los datos de compras siguen guardados en este dispositivo.',
  lote_invalido: 'El servidor rechazó el lote.',
  respuesta_invalida: 'El servidor respondió algo inesperado: los datos siguen pendientes.',
  datos_invalidos: 'El servidor rechazó el archivo.',
  error: 'No se pudo completar la operación con el servidor.',
});

const falla = (motivo, extra = {}) => ({ ok: false, motivo, mensaje: MENSAJES_COMPRAS[motivo] || MENSAJES_COMPRAS.error, ...extra });

const esFuncionInexistenteErr = (e) =>
  ['PGRST202', '42883'].includes(String(e?.code)) || /could not find the function/i.test(String(e?.message || ''));

// Traduce { data, error } de una RPC a { ok, data } o { ok:false, motivo }.
export const interpretarRpcCompras = ({ data, error } = {}) => {
  if (error) {
    if (esFuncionInexistenteErr(error)) return falla('falta_migracion');
    if (/demasiados intentos/i.test(String(error?.message || ''))) return falla('bloqueado');
    return falla('error');
  }
  if (!data || typeof data !== 'object') return falla('respuesta_invalida');
  if (data.ok === false) {
    const m = ['no_autorizado', 'lote_invalido', 'datos_invalidos'].includes(data.motivo) ? data.motivo : 'error';
    return falla(m);
  }
  if (data.ok !== true) return falla('respuesta_invalida');
  return { ok: true, data };
};

const credRpc = (cred) => ({ p_admin_id: String(cred?.p_admin_id ?? ''), p_admin_pin: String(cred?.p_admin_pin ?? '') });

// ---------------- Pendientes ----------------
const pendientes = (rows) => (Array.isArray(rows) ? rows : []).filter(r => r && r.pendingSync);

export const contarComprasPendientes = async () => {
  const [c, m, p, a] = await Promise.all([getIngresosCostos(), getCuentaProveedores(), getPedidosProveedor(), getComprobantesPendientes()]);
  const out = { costos: pendientes(c).length, cuenta: pendientes(m).length, pedidos: pendientes(p).length, comprobantes: (a || []).length };
  return { ...out, total: out.costos + out.cuenta + out.pedidos + out.comprobantes };
};

// Sonda de la 012: con id vacio la RPC responde no_autorizado antes de verificar el PIN
// (no cuenta como intento). Solo "funcion inexistente" => falta la migracion.
export const sondearMigracion012 = async () => {
  try {
    const { data, error } = await supabase.rpc('admin_compras_guardar', { p_admin_id: '', p_admin_pin: '', p_lote: {} });
    return { faltaMigracion: interpretarRpcCompras({ data, error }).motivo === 'falta_migracion' };
  } catch {
    return { faltaMigracion: false };
  }
};

// Arma lotes de hasta TAM_LOTE filas entre las tres tablas.
export const armarLotesCompras = (costos = [], cuenta = [], pedidos = [], tam = TAM_LOTE) => {
  const n = Math.max(1, Math.min(TAM_LOTE, Number(tam) || TAM_LOTE));
  const todas = [
    ...costos.map(r => ['costos', r]),
    ...cuenta.map(r => ['cuenta', r]),
    ...pedidos.map(r => ['pedidos', r]),
  ];
  const lotes = [];
  for (let i = 0; i < todas.length; i += n) {
    const lote = { costos: [], cuenta: [], pedidos: [] };
    for (const [tabla, fila] of todas.slice(i, i + n)) lote[tabla].push(fila);
    lotes.push(lote);
  }
  return lotes;
};

const confirmadosDe = (data, tabla, enviados, rechazados) => {
  const ids = data?.ids?.[tabla];
  const enLote = new Set(enviados);
  if (Array.isArray(ids)) return ids.map(String).filter(id => enLote.has(id));
  // Servidor sin detalle por id: se confirma lo que no fue rechazado.
  const rech = new Set((rechazados || []).map(x => String(x?.id)));
  return enviados.filter(id => !rech.has(id));
};

/**
 * Sube costos, cuenta y pedidos pendientes (lotes de 500). cred = { p_admin_id, p_admin_pin }.
 * Primero sincroniza stock (la cabecera del ingreso tiene que existir en el servidor). Limpia
 * pendingSync SOLO de los ids confirmados cuyo updatedAt no cambio durante la subida; los rechazados
 * (p. ej. ingreso_inexistente) quedan pendientes y se reintentan.
 */
export const subirCompras = async (cred) => {
  if (!cred) return { ok: true, skipped: true, pendientes: await contarComprasPendientes() };
  const [costosL, cuentaL, pedidosL] = await Promise.all([getIngresosCostos(), getCuentaProveedores(), getPedidosProveedor()]);
  const pc = pendientes(costosL);
  const pm = pendientes(cuentaL);
  const pp = pendientes(pedidosL);
  if (!pc.length && !pm.length && !pp.length) return { ok: true, subidos: { costos: 0, cuenta: 0, pedidos: 0 }, rechazados: [], pendientes: await contarComprasPendientes() };

  if (pc.length) {
    // Si el sync de stock falla (sin red), igual se intenta: los costos de ingresos ya subidos entran.
    try { await syncStock(); } catch { /* se informa por ingreso_inexistente */ }
  }

  const filaDe = new Map();
  const costosR = pc.map(r => { const f = costosToRemote(r); filaDe.set(`costos:${r.id}`, r); return f; });
  const cuentaR = pm.map(r => { const f = movCuentaToRemote(r); filaDe.set(`cuenta:${r.id}`, r); return f; });
  const pedidosR = pp.map(r => { const f = pedidoProveedorToRemote(r); filaDe.set(`pedidos:${r.id}`, r); return f; });

  const subidos = { costos: 0, cuenta: 0, pedidos: 0 };
  const rechazados = [];
  const limpiadores = {
    costos: [clearIngresosCostosPendingSync, 'ingreso_id'],
    cuenta: [clearCuentaProveedoresPendingSync, 'id'],
    pedidos: [clearPedidosProveedorPendingSync, 'id'],
  };

  for (const lote of armarLotesCompras(costosR, cuentaR, pedidosR)) {
    const { data, error } = await supabase.rpc('admin_compras_guardar', { ...credRpc(cred), p_lote: lote });
    const r = interpretarRpcCompras({ data, error });
    if (!r.ok) return { ...r, faltaMigracion: r.motivo === 'falta_migracion', subidos, rechazados, pendientes: await contarComprasPendientes() };

    for (const tabla of ['costos', 'cuenta', 'pedidos']) {
      const [limpiar, campoId] = limpiadores[tabla];
      const enviados = lote[tabla].map(f => String(f[campoId]));
      if (!enviados.length) continue;
      const ok = confirmadosDe(r.data, tabla, enviados, r.data.rechazados);
      await limpiar(ok.map(id => {
        const fila = filaDe.get(`${tabla}:${id}`);
        return { id, updatedAt: fila?.updatedAt };
      }));
      subidos[tabla] += ok.length;
    }
    const enLote = new Set(['costos', 'cuenta', 'pedidos'].flatMap(t => lote[t].map(f => String(f.ingreso_id ?? f.id))));
    rechazados.push(...(Array.isArray(r.data.rechazados) ? r.data.rechazados : []).filter(x => x?.id === null || enLote.has(String(x?.id))));
  }
  return { ok: true, subidos, rechazados, pendientes: await contarComprasPendientes() };
};

// ---------------- Bajada ----------------
const leerCursor = () => { try { return localStorage.getItem(CURSOR_KEY) || null; } catch { return null; } };
const guardarCursor = (v) => { try { localStorage.setItem(CURSOR_KEY, v); } catch { /* sin storage */ } };

// No pisa filas con cambios locales sin subir.
const sinPendientes = (remotas, locales, idRemoto) => {
  const pend = new Set(pendientes(locales).map(l => String(l.id)));
  return remotas.filter(r => !pend.has(String(r[idRemoto])));
};

/**
 * Baja lo cambiado por otros dispositivos (necesita PIN y conexion: S6). S-012-02: cursor por tabla
 * sobre (synced_at, id) que pone el servidor (no el reloj del cliente), con solape de 5 min al
 * arrancar, guardado en localStorage. `completo` baja todo.
 */
export const bajarCompras = async (cred, { completo = false } = {}) => {
  if (!cred) return falla('pin_requerido', { bajados: { costos: 0, cuenta: 0, pedidos: 0 } });
  const guardado = completo ? {} : leerCursorCompras(leerCursor());
  let cursor = cursorConSolape(guardado);
  let aGuardar = guardado;
  const acumulado = { costos: [], cuenta: [], pedidos: [] };

  for (let vuelta = 0; vuelta < 50; vuelta += 1) {
    const { data, error } = await supabase.rpc('admin_compras_bajar', { ...credRpc(cred), p_cursor: cursor });
    const r = interpretarRpcCompras({ data, error });
    if (!r.ok) return { ...r, faltaMigracion: r.motivo === 'falta_migracion', bajados: { costos: 0, cuenta: 0, pedidos: 0 } };
    const parte = { costos: r.data.costos || [], cuenta: r.data.cuenta || [], pedidos: r.data.pedidos || [] };
    for (const t of Object.keys(acumulado)) acumulado[t].push(...parte[t]);
    const sig = avanzarCursorCompras(cursor, parte, PAGINA);
    aGuardar = avanzarCursorCompras(aGuardar, parte, PAGINA, { soloAdelante: true }).cursor;
    if (!sig.llenas.length) break;
    cursor = sig.cursor;
  }

  const [lc, lm, lp] = await Promise.all([getIngresosCostos(), getCuentaProveedores(), getPedidosProveedor()]);
  const costos = sinPendientes(acumulado.costos, lc, 'ingreso_id').map(costosFromRemote);
  const cuenta = sinPendientes(acumulado.cuenta, lm, 'id').map(movCuentaFromRemote);
  const pedidos = sinPendientes(acumulado.pedidos, lp, 'id').map(pedidoProveedorFromRemote);
  await putIngresosCostosRaw(costos);
  await putCuentaProveedoresRaw(cuenta);
  await putPedidosProveedorRaw(pedidos);
  if (Object.keys(aGuardar).length) guardarCursor(JSON.stringify(aGuardar));
  return { ok: true, bajados: { costos: costos.length, cuenta: cuenta.length, pedidos: pedidos.length } };
};

// ---------------- Comprobantes (Storage privado) ----------------

/**
 * Deja el adjunto en cola local (sin conexion tambien). El pago se crea sin comprobantePath; el path
 * se completa al subir con subirComprobantes.
 */
export const encolarComprobante = async (pagoId, archivo) => {
  const v = validarAdjunto(archivo);
  if (!v.ok) return { ok: false, mensaje: v.error };
  await putComprobantePendiente({ id: String(pagoId), blob: archivo, mime: String(archivo.type).toLowerCase(), size: archivo.size });
  return { ok: true };
};

/**
 * Sube los comprobantes en cola: pide nombre (RPC con PIN) -> upload -> guarda el path en el pago
 * (queda pendiente de sync) -> recien ahi borra el blob local. Una falla no frena a los demas.
 */
export const subirComprobantes = async (cred) => {
  const cola = (await getComprobantesPendientes()) || [];
  if (!cred) return { ok: true, skipped: true, pendientes: cola.length };
  if (!cola.length) return { ok: true, subidos: 0, fallidos: [], pendientes: 0 };
  const pagos = new Map(((await getCuentaProveedores()) || []).map(p => [String(p.id), p]));
  let subidos = 0;
  const fallidos = [];
  for (const item of cola) {
    const pago = pagos.get(String(item.id));
    if (!pago) { fallidos.push({ id: item.id, motivo: 'pago_inexistente' }); continue; }
    const ext = extensionAdjunto(item.mime);
    if (!ext) { fallidos.push({ id: item.id, motivo: 'datos_invalidos' }); continue; }
    const { data, error } = await supabase.rpc('admin_comprobante_subida', { ...credRpc(cred), p_pago_id: String(item.id), p_ext: ext });
    const r = interpretarRpcCompras({ data, error });
    if (!r.ok) return { ...r, faltaMigracion: r.motivo === 'falta_migracion', subidos, fallidos, pendientes: (await getComprobantesPendientes()).length };
    const nombre = String(r.data.nombre || '');
    const up = await supabase.storage.from(BUCKET_COMPROBANTES).upload(nombre, item.blob, { contentType: item.mime, upsert: false });
    if (up?.error) { fallidos.push({ id: item.id, motivo: 'upload' }); continue; }
    await putCuentaProveedoresRaw([{ ...pago, comprobantePath: nombre, updatedAt: Date.now(), pendingSync: true }]);
    await deleteComprobantePendiente(item.id);
    subidos += 1;
  }
  const sync = subidos ? await subirCompras(cred) : null;
  return { ok: true, subidos, fallidos, sync, pendientes: (await getComprobantesPendientes()).length };
};

/**
 * Descarga un comprobante: permiso de lectura de 2 min (RPC con PIN) -> download -> blob URL local.
 * No se generan URLs compartibles. Quien llama debe hacer URL.revokeObjectURL(url) al cerrar.
 */
export const verComprobante = async (cred, path) => {
  if (!cred) return falla('pin_requerido');
  const { data, error } = await supabase.rpc('admin_comprobante_lectura', { ...credRpc(cred), p_nombre: String(path || '') });
  const r = interpretarRpcCompras({ data, error });
  if (!r.ok) return r;
  const dl = await supabase.storage.from(BUCKET_COMPROBANTES).download(String(path));
  if (dl?.error || !dl?.data) return falla('error');
  return { ok: true, url: URL.createObjectURL(dl.data), blob: dl.data };
};

// Vista previa de un adjunto que todavia esta solo en este dispositivo.
export const verComprobanteLocal = async (pagoId) => {
  const item = ((await getComprobantesPendientes()) || []).find(c => String(c.id) === String(pagoId));
  if (!item) return { ok: false, mensaje: 'No hay comprobante pendiente' };
  return { ok: true, url: URL.createObjectURL(item.blob), blob: item.blob };
};
