// src/services/planillaProductosService.js — AC-XLS-2 (migracion 029).
// Guarda el ultimo Excel de productos en un bucket PRIVADO y deja que cualquier admin lo baje.
// Subir y leer exige un permiso corto otorgado por RPC con el PIN de admin (patron comprobantes, 012).
// El PIN llega por parametro, viaja solo en la llamada y NO se guarda ni se loguea.
import { supabase } from '../lib/supabase';
import { credencialesAdminProductos } from './productosAdminService';
import { validarArchivoPlanilla } from '../domain/planillaProductos';

export const BUCKET_PLANILLAS = 'planillas-productos';
const MSG_FALTA_029 = 'Falta aplicar la migración 029 en Supabase para guardar el Excel en la app.';
const MSG_OFFLINE = 'Necesitás conexión para esto.';

const faltaFuncion = (e) => ['PGRST202', '42883'].includes(String(e?.code)) || /could not find the function/i.test(String(e?.message || ''));

const interpretar = ({ data, error }) => {
  if (error) {
    if (faltaFuncion(error)) return { ok: false, mensaje: MSG_FALTA_029 };
    if (/demasiados intentos/i.test(String(error?.message || ''))) return { ok: false, mensaje: 'Demasiados intentos de PIN. Probá de nuevo en 15 minutos.' };
    return { ok: false, mensaje: 'No se pudo completar la operación con el servidor.' };
  }
  if (!data || typeof data !== 'object') return { ok: false, mensaje: 'El servidor respondió algo inesperado.' };
  if (data.ok === false) {
    return { ok: false, mensaje: data.motivo === 'no_autorizado' ? 'PIN incorrecto o tu usuario no es admin en el servidor.' : 'El servidor rechazó el archivo.' };
  }
  return { ok: true, data };
};

const sinConexion = () => typeof navigator !== 'undefined' && navigator.onLine === false;

/** Sube el Excel y lo deja como "el último". Devuelve { ok, mensaje? }. */
export const guardarPlanillaProductos = async (pin, file) => {
  const v = validarArchivoPlanilla(file);
  if (!v.ok) return { ok: false, mensaje: v.error };
  if (sinConexion()) return { ok: false, mensaje: MSG_OFFLINE };
  const cr = await credencialesAdminProductos(pin);
  if (!cr.ok) return { ok: false, mensaje: cr.mensaje };
  try {
    const a = interpretar(await supabase.rpc('admin_planilla_subida', { ...cr.cred, p_ext: v.ext }));
    if (!a.ok) return a;
    const nombre = a.data.nombre;
    const up = await supabase.storage.from(BUCKET_PLANILLAS).upload(nombre, file, { contentType: v.mime, upsert: false });
    if (up?.error) return { ok: false, mensaje: 'No se pudo subir el archivo (máx. 10 MB).' };
    const c = interpretar(await supabase.rpc('admin_planilla_confirmar', {
      ...cr.cred, p_nombre: nombre, p_nombre_original: String(file.name || `productos.${v.ext}`), p_tam: Math.round(file.size),
    }));
    return c.ok ? { ok: true } : c;
  } catch {
    return { ok: false, mensaje: 'No se pudo completar la operación con el servidor.' };
  }
};

/** Baja el último Excel guardado. Devuelve { ok, hay, info, blob } (hay=false si todavía no hay ninguno). */
export const bajarUltimaPlanillaProductos = async (pin) => {
  if (sinConexion()) return { ok: false, mensaje: MSG_OFFLINE };
  const cr = await credencialesAdminProductos(pin);
  if (!cr.ok) return { ok: false, mensaje: cr.mensaje };
  try {
    const r = interpretar(await supabase.rpc('admin_planilla_ultima', cr.cred));
    if (!r.ok) return r;
    if (!r.data.hay) return { ok: true, hay: false, info: { hay: false } };
    const dl = await supabase.storage.from(BUCKET_PLANILLAS).download(String(r.data.nombre));
    if (dl?.error || !dl?.data) return { ok: false, mensaje: 'No se pudo bajar el archivo.' };
    return { ok: true, hay: true, info: r.data, blob: dl.data };
  } catch {
    return { ok: false, mensaje: 'No se pudo completar la operación con el servidor.' };
  }
};
