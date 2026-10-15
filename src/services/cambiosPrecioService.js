// src/services/cambiosPrecioService.js — REQ-HPR (AC-HPR-1, 2).
// Historial de cambios de precio: IndexedDB (store cambiosPrecio) <-> Supabase.
//
// Offline-first: el cambio se guarda local junto con el producto (db/index.js)
// con pendingSync. Se sube SOLO con el PIN del admin (RPC
// admin_registrar_cambios_precio, migracion 010), igual que los productos; el PIN
// llega como credencial por parametro y no se guarda ni se loguea. Se limpian
// SOLO los ids que el servidor aceptó. La lectura es publica (precios de venta).
import { supabase } from '../lib/supabase';
import { getCambiosPrecio, putCambiosPrecioRemotos, clearCambiosPrecioPendingSync } from '../db';
import {
  cambioPrecioToRemote, cambioPrecioFromRemote, interpretarRegistrarCambiosPrecio, fechaArgentina,
} from '../domain/precios';

const LOTE = 500;
const PAGINA = 1000;
export const DIAS_HISTORIAL_LOCAL = 90;

const esPendiente = (c) => !!c?.pendingSync && !c?.syncRechazo;

export const contarCambiosPrecioPendientes = async () =>
  ((await getCambiosPrecio()) || []).filter(esPendiente).length;

// Sonda de la 010: con id vacio la RPC responde no_autorizado antes de verificar
// el PIN (no cuenta como intento). Solo "funcion inexistente" => falta la migracion.
export const sondearMigracion010 = async () => {
  try {
    const { data, error } = await supabase.rpc('admin_registrar_cambios_precio', { p_admin_id: '', p_admin_pin: '', p_filas: [] });
    return { faltaMigracion: interpretarRegistrarCambiosPrecio({ data, error }).motivo === 'falta_migracion' };
  } catch {
    return { faltaMigracion: false };
  }
};

// Sube los pendientes (lotes de 500). cred = { p_admin_id, p_admin_pin }.
export const subirCambiosPrecio = async (cred) => {
  if (!cred) return { ok: true, skipped: true, pendientes: await contarCambiosPrecioPendientes() };
  const pendientes = ((await getCambiosPrecio()) || []).filter(esPendiente);
  let subidos = 0;
  const rechazados = [];
  for (let i = 0; i < pendientes.length; i += LOTE) {
    const lote = pendientes.slice(i, i + LOTE);
    const ids = new Set(lote.map(c => c.id));
    const { data, error } = await supabase.rpc('admin_registrar_cambios_precio', {
      p_admin_id: String(cred.p_admin_id ?? ''),
      p_admin_pin: String(cred.p_admin_pin ?? ''),
      p_filas: lote.map(cambioPrecioToRemote),
    });
    const r = interpretarRegistrarCambiosPrecio({ data, error });
    if (!r.ok) {
      return {
        ok: false, motivo: r.motivo, mensaje: r.mensaje, subidos, rechazados,
        faltaMigracion: r.motivo === 'falta_migracion',
        pendientes: await contarCambiosPrecioPendientes(),
      };
    }
    const aceptados = r.aceptados.filter(id => ids.has(id));
    await clearCambiosPrecioPendingSync(aceptados);
    subidos += aceptados.length;
    // Un registro que el servidor rechaza por datos invalidos no se reintenta para siempre.
    const rech = r.rechazados.filter(x => ids.has(x.id));
    if (rech.length) {
      const porId = new Map(lote.map(c => [c.id, c]));
      await putCambiosPrecioRemotos(rech.map(x => ({ ...porId.get(x.id), pendingSync: false, syncRechazo: x.motivo })));
      rechazados.push(...rech);
    }
  }
  return { ok: true, subidos, rechazados, pendientes: await contarCambiosPrecioPendientes() };
};

// S-010-01: sin usuario_id (anon no tiene select sobre esa columna).
const COLUMNAS_CAMBIOS = 'id,producto_id,codigo,nombre,rubro,precio_anterior,precio_nuevo,precio_bulto_anterior,precio_bulto_nuevo,fecha,creado_en,usuario_nombre';

const leerRango = async (desde, hasta) => {
  let out = [];
  for (let from = 0; ; from += PAGINA) {
    let q = supabase.from('cambios_precio').select(COLUMNAS_CAMBIOS).gte('fecha', desde);
    if (hasta) q = q.lte('fecha', hasta);
    const { data, error } = await q.order('fecha', { ascending: true }).order('id', { ascending: true }).range(from, from + PAGINA - 1);
    if (error) throw error;
    out = out.concat(data || []);
    if (!data || data.length < PAGINA) break;
  }
  return out.map(cambioPrecioFromRemote);
};

// Baja los cambios de los ultimos 90 dias a IndexedDB sin pisar los pendientes locales.
export const bajarCambiosPrecio = async ({ now = new Date() } = {}) => {
  try {
    const desde = fechaArgentina(new Date(now.getTime() - DIAS_HISTORIAL_LOCAL * 86400000));
    const remotos = await leerRango(desde, null);
    const locales = new Map(((await getCambiosPrecio()) || []).map(c => [c.id, c]));
    const aGuardar = remotos.filter(r => !locales.get(r.id)?.pendingSync);
    for (let i = 0; i < aGuardar.length; i += 500) await putCambiosPrecioRemotos(aGuardar.slice(i, i + 500));
    return { ok: true, count: aGuardar.length };
  } catch (e) {
    // Tolerante: sin la 010 (tabla inexistente) o sin conexion, la pantalla usa lo local.
    return { ok: false, mensaje: e?.message || String(e) };
  }
};

// Rangos mas viejos que el historial local: se consultan online, sin guardar.
export const consultarCambiosPrecioOnline = async (desde, hasta) => {
  try {
    return { ok: true, cambios: await leerRango(desde, hasta) };
  } catch (e) {
    return { ok: false, mensaje: e?.message || String(e), cambios: [] };
  }
};
