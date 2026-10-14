// src/services/comisionesRubroService.js — REQ-COMR (AC-COMR-6, 7, 8).
// Orquesta la tabla de % por vendedor y rubro entre el dominio
// (src/domain/rubros.js), IndexedDB (store comisionesRubro) y Supabase.
//
// Offline-first: cada cambio se guarda primero local con pendingSync. Se sube
// SOLO con el PIN del admin (RPC admin_guardar_comisiones_rubro, migración
// 005): la tabla es "solo admin" y con la anon key no se puede leer ni
// escribir. El PIN llega como parámetro, viaja solo en la llamada a la RPC y no
// se guarda ni se loguea (igual que los cierres, S-COM-01). Por eso runSync en
// segundo plano no sube nada: los pendientes se suben desde la grilla, desde
// "Actualizar % de comisión" o al confirmar un cierre.
import { supabase } from '../lib/supabase';
import {
  getVendedores, getComisionesRubro, putComisionesRubroLocal, putComisionesRubroRemotos,
  clearComisionesRubroPendingSync,
} from '../db';
import {
  upsertPctLocal, filaRubroToRemote, interpretarGuardarRubros, mezclarTablaRubros, MENSAJES_RUBRO,
} from '../domain/rubros';
import { estaActivo } from '../domain/vendedores';
import { esAdmin, validarPinIngresado } from '../domain/permisos';
import { getUsuarioSesion } from './sesion';

export const MSG_FALTA_MIGRACION_005 = MENSAJES_RUBRO.falta_migracion;
const MSG_SIN_ID = 'El vendedor todavía no está sincronizado: sincronizá vendedores antes de cargarle los %.';
const MSG_SIN_ID_ADMIN = 'Tu usuario de admin todavía no está sincronizado con el servidor: sincronizá y volvé a intentar.';
const LOTE = 1000;

const esAdminSesion = () => esAdmin(getUsuarioSesion()?.permiso);
const esPendiente = (f) => !!f?.pendingSync && !f?.obsoleto;

export const cargarTablaRubros = async () => (await getComisionesRubro()) || [];
export const contarPendientesRubro = async () => (await cargarTablaRubros()).filter(esPendiente).length;

// Credenciales del admin para las RPC (se arman por llamada y no se guardan).
export const credencialesAdminRubro = async (pin) => {
  const v = validarPinIngresado(pin);
  if (!v.ok) return { ok: false, motivo: 'pin_requerido', mensaje: v.error };
  const sesion = getUsuarioSesion();
  const lista = await getVendedores();
  const yo = (lista || []).find(x => x?.id === sesion?.id);
  const rid = yo?.remoteId;
  if (rid === null || rid === undefined || rid === '') return { ok: false, motivo: 'sin_id_remoto', mensaje: MSG_SIN_ID_ADMIN };
  return { ok: true, cred: { p_admin_id: String(rid), p_admin_pin: v.pin } };
};

// ¿Está la migración 005? Sonda sin credenciales: con id vacío la RPC responde
// 'no_autorizado' ANTES de verificar el PIN (no cuenta como intento).
export const sondearMigracion005 = async () => {
  try {
    const { error } = await supabase.rpc('admin_leer_comisiones_rubro', { p_admin_id: '', p_admin_pin: '' });
    if (!error) return { faltaMigracion: false };
    return { faltaMigracion: interpretarGuardarRubros({ error }).motivo === 'falta_migracion' };
  } catch {
    return { faltaMigracion: false };
  }
};

// Sube los pendientes (limpia SOLO los ids aceptados que no se volvieron a
// editar durante la subida) y después baja y mezcla la tabla del servidor.
// cred: la misma credencial del cierre (confirmarCierre) o se arma con pin.
export const syncComisionesRubro = async ({ pin, cred = null } = {}) => {
  if (!esAdminSesion()) return { ok: true, skipped: true };
  let c = cred;
  if (!c) {
    if (pin === undefined || pin === null || pin === '') {
      return { ok: true, skipped: true, sinPin: true, pendientes: await contarPendientesRubro() };
    }
    const cr = await credencialesAdminRubro(pin);
    if (!cr.ok) return { ok: false, motivo: cr.motivo, mensaje: cr.mensaje, pendientes: await contarPendientesRubro() };
    c = cr.cred;
  }

  const enviados = (await cargarTablaRubros()).filter(esPendiente);
  let subidos = 0;
  const rechazados = [];
  for (let i = 0; i < enviados.length; i += LOTE) {
    const lote = enviados.slice(i, i + LOTE);
    const enviadoAt = new Map(lote.map(f => [String(f.id), f.editadoAt]));
    const { data, error } = await supabase.rpc('admin_guardar_comisiones_rubro', { ...c, p_filas: lote.map(filaRubroToRemote) });
    const r = interpretarGuardarRubros({ data, error });
    if (!r.ok) {
      return {
        ok: false, motivo: r.motivo, mensaje: r.mensaje, subidos,
        faltaMigracion: r.motivo === 'falta_migracion',
        pendientes: await contarPendientesRubro(),
      };
    }
    const actuales = new Map((await cargarTablaRubros()).map(f => [String(f.id), f]));
    const sinCambios = (id) => {
      const local = actuales.get(id);
      return !!local && local.editadoAt === enviadoAt.get(id);
    };
    const limpiar = [];
    const escribir = [];
    for (const a of r.aceptados) {
      if (!sinCambios(a.idEnviado)) continue; // se editó durante la subida: sigue pendiente
      if (a.fila.id === a.idEnviado) {
        limpiar.push(a.idEnviado);
      } else {
        // El servidor ya tenía otra fila para (vendedor, rubro): la local queda
        // obsoleta (no se borra) y se guarda la canónica.
        escribir.push({ ...actuales.get(a.idEnviado), pendingSync: false, obsoleto: true });
        escribir.push({ ...a.fila, vendedorNombre: actuales.get(a.idEnviado)?.vendedorNombre || '' });
      }
      subidos += 1;
    }
    for (const x of r.rechazados) {
      if (!sinCambios(x.id)) continue;
      escribir.push({ ...actuales.get(x.id), pendingSync: false, syncRechazo: x.motivo });
      rechazados.push(x);
    }
    await clearComisionesRubroPendingSync(limpiar);
    await putComisionesRubroRemotos(escribir);
  }

  // Bajar la tabla del servidor y mezclar (sin pisar pendientes ni borrar).
  const { data, error } = await supabase.rpc('admin_leer_comisiones_rubro', c);
  if (error || !data?.ok) {
    const r = interpretarGuardarRubros({ data, error });
    return {
      ok: false, motivo: r.motivo, mensaje: r.mensaje, subidos, rechazados,
      faltaMigracion: r.motivo === 'falta_migracion',
      pendientes: await contarPendientesRubro(),
    };
  }
  const { aGuardar, obsoletos } = mezclarTablaRubros(await cargarTablaRubros(), Array.isArray(data.filas) ? data.filas : []);
  await putComisionesRubroRemotos([...aGuardar, ...obsoletos]);
  return { ok: true, subidos, rechazados, pendientes: await contarPendientesRubro() };
};

// Guarda los % editados en la grilla de un vendedor (AC-COMR-6). Valida TODO
// antes de escribir: si una fila es inválida no se guarda ninguna.
// cambios: [{ rubro, pct }] (pct como lo tipeó el admin: "5,5", "", 10...).
export const guardarPctsVendedor = async ({ vendedor, cambios = [], pin = '', online = navigator.onLine } = {}) => {
  if (!esAdminSesion()) return { ok: false, motivo: 'permiso', mensaje: 'Solo el admin puede cargar los % de comisión.' };
  const rid = vendedor?.remoteId;
  if (rid === null || rid === undefined || rid === '') return { ok: false, motivo: 'sin_id_remoto', mensaje: MSG_SIN_ID };
  if (!estaActivo(vendedor)) return { ok: false, motivo: 'vendedor_inactivo', mensaje: MENSAJES_RUBRO.vendedor_inactivo };

  const filas = await cargarTablaRubros();
  const now = Date.now();
  const errores = {};
  const nuevas = [];
  for (const cambio of Array.isArray(cambios) ? cambios : []) {
    const r = upsertPctLocal(filas, {
      vendedorId: String(rid), vendedorNombre: vendedor?.nombre, rubro: cambio?.rubro, pct: cambio?.pct,
      editadoPor: getUsuarioSesion()?.nombre,
    }, { now });
    if (!r.ok) errores[String(cambio?.rubro ?? '')] = r.error;
    else nuevas.push(r.fila);
  }
  if (Object.keys(errores).length) return { ok: false, motivo: 'validacion', errores, mensaje: 'Revisá los % marcados.' };
  if (nuevas.length === 0) return { ok: true, guardados: 0 };
  await putComisionesRubroLocal(nuevas);

  if (!pin || !online) {
    return {
      ok: true, guardados: nuevas.length, sincronizado: false,
      mensaje: 'Guardado en este dispositivo. Para subirlo al servidor ingresá tu PIN y guardá (o usá "Actualizar % de comisión").',
    };
  }
  const s = await syncComisionesRubro({ pin });
  return {
    ok: true, guardados: nuevas.length, sincronizado: !!s.ok && !s.pendientes,
    sync: s, mensaje: s.ok ? (s.pendientes ? 'Guardado. Quedaron % sin subir.' : 'Guardado y sincronizado.') : `Guardado en este dispositivo. ${s.mensaje || ''}`.trim(),
  };
};
