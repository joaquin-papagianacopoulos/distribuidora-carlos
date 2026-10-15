// src/services/rendicionService.js — REQ-REN (AC-REN-1..4), migracion 014.
// Orquesta la rendicion entre el dominio puro (src/domain/rendicion.js), IndexedDB y Supabase.
// - Alta offline: rendicion + movimientos en UNA transaccion local (pendingSync).
// - Subida con PIN de admin (RPC). syncStock retiene los movimientos 'rendicion:*' hasta que el
//   servidor confirma la rendicion. El efecto en deudas/saldo se aplica UNA vez, recien despues de
//   confirmar, por el dispositivo que la creo, y solo si gana el "reclamo" en el servidor
//   (admin_rendicion_efecto con efecto is null).
// - Anulacion SOLO online, atomica en el servidor: el que gana revierte la plata; los movimientos
//   compensatorios tienen ids deterministas (cualquiera puede generarlos sin duplicar).
// El PIN llega por parametro (cred), viaja solo en la llamada y NO se guarda ni se loguea.
import { supabase } from '../lib/supabase';
import {
  getRendiciones, putRendicionesRaw, getCuentaClientes, putCuentaClientesRaw, clearCuentaClientesPendingSync,
  addRendicionConMovimientos, addMovimientosStock, clearMovimientosPendingSync, getMovimientosStock, getDeudas,
} from '../db';
import {
  validarRendicion, movimientosRendicion, movimientosAnulacionRendicion, planEfectoCuenta, planAnulacionCuenta,
  asientoSaldoFavor, rendicionToRemote, rendicionFromRemote, cuentaClienteToRemote, cuentaClienteFromRemote,
  interpretarRpcRendicion, MENSAJES_RENDICION, MOTIVOS_RECHAZO, conceptoCargo, conceptoReversion, pagadaPorRendicion,
  saldoAFavorCliente, MIN_MOTIVO, MAX_MOTIVO,
} from '../domain/rendicion';
import { leerCursorCompras, cursorConSolape, avanzarCursorCompras, TABLAS_CURSOR_RENDICION } from '../domain/cursorCompras';
import { texto, hoyISO } from '../domain/validacion';
import { syncStock } from './stockService';
import {
  aplicarCobrosRendicion, crearDeudaRendicion, anularDeudaRendicion, ajustarDeudaRendicion,
} from './deudaRepository';

const TAM_LOTE = 200;
const PAGINA = 1000;
const CURSOR_KEY = 'rendicionesSyncCursor';

const falla = (motivo, extra = {}) => ({ ok: false, motivo, mensaje: MENSAJES_RENDICION[motivo] || MENSAJES_RENDICION.error, ...extra });
const credRpc = (cred) => ({ p_admin_id: String(cred?.p_admin_id ?? ''), p_admin_pin: String(cred?.p_admin_pin ?? '') });
const online = () => typeof navigator === 'undefined' || navigator.onLine !== false;
const intentar = async (fn) => { try { return await fn(); } catch { return null; } };

const leerLocales = async () => {
  try {
    const [rendiciones, cuenta] = await Promise.all([getRendiciones(), getCuentaClientes()]);
    return { rendiciones: rendiciones || [], cuenta: cuenta || [] };
  } catch {
    return { rendiciones: [], cuenta: [] };
  }
};

/** Rendiciones y saldo a favor locales (para pantallas). Nunca tira: sin store => listas vacias. */
export const cargarRendicionesLocales = leerLocales;

export const saldoAFavor = async (clienteId) => saldoAFavorCliente((await leerLocales()).cuenta, clienteId);

export const contarPendientesRendicion = async () => {
  const { rendiciones, cuenta } = await leerLocales();
  const r = rendiciones.filter(x => x.pendingSync && x.syncEstado !== 'rechazada').length;
  const e = rendiciones.filter(x => x.syncEstado === 'confirmada' && x.creadaAqui && !x.efectoAplicado && x.estado === 'vigente').length;
  const c = cuenta.filter(x => x.pendingSync).length;
  return { rendiciones: r, efectos: e, cuenta: c, total: r + e + c };
};

// Sonda de la 014: con id vacio la RPC responde no_autorizado sin verificar el PIN.
export const sondearMigracion014 = async () => {
  try {
    const { data, error } = await supabase.rpc('admin_rendiciones_bajar', { p_admin_id: '', p_admin_pin: '', p_cursor: {} });
    return { faltaMigracion: interpretarRpcRendicion({ data, error }).motivo === 'falta_migracion' };
  } catch {
    return { faltaMigracion: false };
  }
};

/**
 * AC-REN-1/2: valida y graba (offline) la rendicion con sus movimientos de stock, en una sola
 * transaccion. Queda pendiente de subir con el PIN del admin.
 */
export const registrarRendicion = async (form, { pedido, productos = [], usuario = '' } = {}) => {
  const { rendiciones } = await leerLocales();
  const r = validarRendicion(form, { pedido, rendiciones, productos, usuario });
  if (!r.ok) return r;
  const rendicion = { ...r.rendicion, syncEstado: 'pendiente', creadaAqui: true, efectoAplicado: false, efecto: null };
  const movimientos = movimientosRendicion(rendicion);
  await addRendicionConMovimientos(rendicion, movimientos);
  return { ok: true, rendicion, movimientos };
};

// Rechazada por el servidor: sus movimientos de alta nunca subieron (syncStock los retuvo). Se
// compensan localmente (neto 0) y ninguno queda pendiente.
const neutralizarRechazada = async (r) => {
  const alta = movimientosRendicion(r).map(m => m.id);
  const comp = movimientosAnulacionRendicion(r);
  const existentes = new Set((await getMovimientosStock()).map(m => m.id));
  const nuevos = comp.filter(m => !existentes.has(m.id));
  if (nuevos.length) await addMovimientosStock(nuevos);
  await clearMovimientosPendingSync([...alta, ...comp.map(m => m.id)]);
};

const mismoCliente = (d, r) => (d?.clienteId !== null && d?.clienteId !== undefined && r?.clienteId !== null && r?.clienteId !== undefined
  ? String(d.clienteId) === String(r.clienteId)
  : String(d?.clienteNombre || '').trim().toLowerCase() === String(r?.clienteNombre || '').trim().toLowerCase());

/** Sube los asientos de saldo a favor pendientes (ids deterministas: on conflict do nothing). */
export const subirCuentaClientes = async (cred) => {
  if (!cred) return falla('pin_requerido');
  const { cuenta } = await leerLocales();
  const pend = cuenta.filter(c => c.pendingSync);
  let subidos = 0;
  for (let i = 0; i < pend.length; i += 500) {
    const lote = pend.slice(i, i + 500);
    const { data, error } = await supabase.rpc('admin_cuenta_clientes_guardar', { ...credRpc(cred), p_lote: lote.map(cuentaClienteToRemote) });
    const r = interpretarRpcRendicion({ data, error });
    if (!r.ok) return { ...r, subidos };
    const enLote = new Set(lote.map(c => String(c.id)));
    const ok = (Array.isArray(r.data.confirmados) ? r.data.confirmados : []).map(String).filter(id => enLote.has(id));
    await clearCuentaClientesPendingSync(ok);
    subidos += ok.length;
  }
  return { ok: true, subidos };
};

// AC-REN-3: efecto en la cuenta del cliente, UNA vez. Primero se "reclama" en el servidor; solo
// si el reclamo gana se aplica localmente (si el dispositivo se corta en el medio se pierde el
// efecto, nunca se duplica: queda anotado en el servidor para revisarlo).
const aplicarEfectoAlta = async (cred, r, usuario) => {
  const deudasCliente = (await getDeudas()).filter(d => mismoCliente(d, r));
  const plan = planEfectoCuenta(r.creditoCents, deudasCliente);
  const efecto = { clase: 'alta', ...plan, cargoConcepto: plan.cargoCents > 0 ? conceptoCargo(r) : null, at: new Date().toISOString() };
  const { data, error } = await supabase.rpc('admin_rendicion_efecto', { ...credRpc(cred), p_id: r.id, p_efecto: efecto });
  const res = interpretarRpcRendicion({ data, error });
  if (!res.ok) return res;
  if (res.data.aplicado === true) {
    await aplicarCobrosRendicion(plan.cobros, pagadaPorRendicion(r));
    if (plan.saldoFavorCents > 0) {
      await putCuentaClientesRaw([{ ...asientoSaldoFavor(r, plan.saldoFavorCents, 'favor:a', { usuario }), pendingSync: true }]);
    }
    if (plan.cargoCents > 0) {
      await crearDeudaRendicion({ clienteId: r.clienteId, clienteNombre: r.clienteNombre, montoCents: plan.cargoCents, concepto: conceptoCargo(r), fecha: r.fecha });
    }
  }
  await putRendicionesRaw([{ ...r, efectoAplicado: true, efecto: res.data.aplicado === true ? efecto : r.efecto }]);
  return { ok: true, aplicado: res.data.aplicado === true };
};

/**
 * Sube las rendiciones pendientes (lotes de 200), aplica el efecto de las confirmadas creadas aca,
 * sube el saldo a favor y empuja los movimientos ya confirmados. cred = { p_admin_id, p_admin_pin }.
 */
export const subirRendiciones = async (cred, { usuario = '' } = {}) => {
  if (!cred) return falla('pin_requerido');
  const { rendiciones } = await leerLocales();
  const pend = rendiciones.filter(r => r.pendingSync && r.syncEstado !== 'rechazada');
  const porId = new Map(rendiciones.map(r => [String(r.id), r]));
  const rechazados = [];
  let subidos = 0;

  for (let i = 0; i < pend.length; i += TAM_LOTE) {
    const lote = pend.slice(i, i + TAM_LOTE);
    const { data, error } = await supabase.rpc('admin_rendiciones_guardar', { ...credRpc(cred), p_lote: { rendiciones: lote.map(rendicionToRemote) } });
    const res = interpretarRpcRendicion({ data, error });
    if (!res.ok) return { ...res, faltaMigracion: res.motivo === 'falta_migracion', subidos, rechazados };
    const enLote = new Set(lote.map(r => String(r.id)));
    const ok = (Array.isArray(res.data.confirmados) ? res.data.confirmados : []).map(String).filter(id => enLote.has(id));
    // Solo se marcan los ids confirmados (no se toca lo que no vino en la respuesta).
    const conf = ok.map(id => ({ ...porId.get(id), syncEstado: 'confirmada', pendingSync: false }));
    await putRendicionesRaw(conf);
    conf.forEach(r => porId.set(String(r.id), r));
    subidos += ok.length;
    for (const x of Array.isArray(res.data.rechazados) ? res.data.rechazados : []) {
      const id = String(x?.id ?? '');
      const local = porId.get(id);
      if (!local || !enLote.has(id)) continue;
      const motivo = String(x?.motivo || 'datos_invalidos');
      const rech = { ...local, syncEstado: 'rechazada', pendingSync: false, motivoRechazo: motivo };
      await putRendicionesRaw([rech]);
      await neutralizarRechazada(rech);
      porId.set(id, rech);
      rechazados.push({ id, motivo, mensaje: MOTIVOS_RECHAZO[motivo] || MOTIVOS_RECHAZO.datos_invalidos });
    }
  }

  let efectos = 0;
  for (const r of porId.values()) {
    if (r.syncEstado !== 'confirmada' || !r.creadaAqui || r.efectoAplicado || r.estado !== 'vigente') continue;
    const e = await aplicarEfectoAlta(cred, r, usuario);
    if (!e.ok) return { ...e, subidos, rechazados, efectos };
    if (e.aplicado) efectos += 1;
  }

  const cuenta = await subirCuentaClientes(cred);
  await intentar(() => syncStock());
  return { ok: true, subidos, rechazados, efectos, cuenta };
};

const leerCursor = () => { try { return localStorage.getItem(CURSOR_KEY) || null; } catch { return null; } };
const guardarCursor = (v) => { try { localStorage.setItem(CURSOR_KEY, v); } catch { /* sin storage */ } };

/** Baja rendiciones y saldo a favor de otros dispositivos (PIN y conexion). No pisa pendientes locales. */
export const bajarRendiciones = async (cred, { completo = false } = {}) => {
  if (!cred) return falla('pin_requerido');
  const T = TABLAS_CURSOR_RENDICION;
  const guardado = completo ? {} : leerCursorCompras(leerCursor(), T);
  let cursor = cursorConSolape(guardado, 5 * 60 * 1000, T);
  let aGuardar = guardado;
  const acum = { rendiciones: [], cuenta: [] };
  for (let vuelta = 0; vuelta < 50; vuelta += 1) {
    const { data, error } = await supabase.rpc('admin_rendiciones_bajar', { ...credRpc(cred), p_cursor: cursor });
    const res = interpretarRpcRendicion({ data, error });
    if (!res.ok) return { ...res, faltaMigracion: res.motivo === 'falta_migracion', bajados: { rendiciones: 0, cuenta: 0 } };
    const parte = { rendiciones: res.data.rendiciones || [], cuenta: res.data.cuenta || [] };
    acum.rendiciones.push(...parte.rendiciones);
    acum.cuenta.push(...parte.cuenta);
    const sig = avanzarCursorCompras(cursor, parte, PAGINA, { tablas: T });
    aGuardar = avanzarCursorCompras(aGuardar, parte, PAGINA, { soloAdelante: true, tablas: T }).cursor;
    if (!sig.llenas.length) break;
    cursor = sig.cursor;
  }
  const { rendiciones, cuenta } = await leerLocales();
  const locR = new Map(rendiciones.map(r => [String(r.id), r]));
  const pendC = new Set(cuenta.filter(c => c.pendingSync).map(c => String(c.id)));
  const filasR = acum.rendiciones
    .filter(row => !locR.get(String(row.id))?.pendingSync)
    .map(row => {
      const local = locR.get(String(row.id)) || null;
      return { ...rendicionFromRemote(row, local), creadaAqui: !!local?.creadaAqui };
    });
  const filasC = acum.cuenta.filter(row => !pendC.has(String(row.id))).map(cuentaClienteFromRemote);
  await putRendicionesRaw(filasR);
  await putCuentaClientesRaw(filasC);
  // Una rendicion anulada en otro dispositivo: se generan aca sus movimientos compensatorios
  // (mismos ids que los del ganador: el upsert no duplica).
  for (const r of filasR.filter(x => x.estado === 'anulada')) await compensarStock(r, {});
  if (Object.keys(aGuardar).length) guardarCursor(JSON.stringify(aGuardar));
  return { ok: true, bajados: { rendiciones: filasR.length, cuenta: filasC.length } };
};

// forzar: el que anula SIEMPRE genera los ':x' (ids deterministas: si otro tambien los genera, el
// upsert por id no duplica). Al bajar una anulacion ajena solo se compensa lo que este dispositivo tiene.
const compensarStock = async (r, { usuario = '', now = new Date(), forzar = false }) => {
  const existentes = new Set((await getMovimientosStock()).map(m => m.id));
  const altaLocal = movimientosRendicion(r).some(m => existentes.has(m.id));
  if (!forzar && !altaLocal) return 0;
  const nuevos = movimientosAnulacionRendicion(r, { now, usuario }).filter(m => !existentes.has(m.id));
  if (nuevos.length) await addMovimientosStock(nuevos);
  return nuevos.length;
};

/**
 * AC-REN-4: anula una rendicion confirmada (solo online). Revierte el stock (movimientos ':x') y,
 * si este dispositivo gano la anulacion, el efecto en la cuenta del cliente. Nada se borra.
 */
export const anularRendicion = async (cred, id, motivo, { usuario = '' } = {}) => {
  if (!online()) return falla('offline');
  if (!cred) return falla('pin_requerido');
  const m = texto(motivo, 1000);
  if (m.length < MIN_MOTIVO || m.length > MAX_MOTIVO) return { ok: false, motivo: 'motivo', mensaje: `Escribí el motivo de la anulación (${MIN_MOTIVO} a ${MAX_MOTIVO} caracteres).` };
  // Datos frescos: el efecto pudo haberlo aplicado otro dispositivo.
  await intentar(() => bajarRendiciones(cred));
  const { rendiciones, cuenta } = await leerLocales();
  const local = rendiciones.find(r => String(r.id) === String(id));
  if (!local) return falla('inexistente');
  if (local.syncEstado !== 'confirmada') return falla('inexistente');
  if (local.estado === 'anulada') return { ok: true, yaAnulada: true, mensaje: MENSAJES_RENDICION.ya_anulada };

  const { data, error } = await supabase.rpc('admin_rendicion_anular', { ...credRpc(cred), p_id: local.id, p_motivo: m });
  const res = interpretarRpcRendicion({ data, error });
  if (!res.ok) return res;

  const now = new Date();
  let anulada = { ...local, estado: 'anulada', motivoAnulacion: m, anuladaAt: now.toISOString(), anuladaPor: texto(usuario, 64) };
  await putRendicionesRaw([anulada]);
  await compensarStock(local, { usuario, now, forzar: true });

  if (!res.yaAnulada) {
    const plan = planAnulacionCuenta(local, await getDeudas(), cuenta);
    const efecto = { clase: 'anulacion', ...plan, at: now.toISOString() };
    const r2 = interpretarRpcRendicion(await supabase.rpc('admin_rendicion_efecto', { ...credRpc(cred), p_id: local.id, p_efecto: efecto }));
    if (!r2.ok || r2.data.aplicado !== false) {
      const asientos = [];
      if (plan.saldoFavorCompensaCents > 0) asientos.push(asientoSaldoFavor(local, -plan.saldoFavorCompensaCents, 'favor:x', { now, usuario }));
      if (plan.saldoFavorPorCargoCobradoCents > 0) asientos.push(asientoSaldoFavor(local, plan.saldoFavorPorCargoCobradoCents, 'cargo:x', { now, usuario }));
      if (asientos.length) await putCuentaClientesRaw(asientos.map(a => ({ ...a, pendingSync: true })));
      if (plan.deudaReversionCents > 0) {
        await crearDeudaRendicion({ clienteId: local.clienteId, clienteNombre: local.clienteNombre, montoCents: plan.deudaReversionCents, concepto: conceptoReversion(local), fecha: hoyISO(now) });
      }
      if (plan.anularDeudaCargoId !== null) await anularDeudaRendicion(plan.anularDeudaCargoId);
      if (plan.ajustarDeudaCargo) await ajustarDeudaRendicion(plan.ajustarDeudaCargo.deudaId, plan.ajustarDeudaCargo.montoCents);
      anulada = { ...anulada, efectoAnulacion: efecto };
      await putRendicionesRaw([anulada]);
    }
    await intentar(() => subirCuentaClientes(cred));
  }
  await intentar(() => syncStock());
  return { ok: true, yaAnulada: !!res.yaAnulada, mensaje: res.yaAnulada ? MENSAJES_RENDICION.ya_anulada : 'Rendición anulada.' };
};
