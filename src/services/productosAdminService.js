// src/services/productosAdminService.js — S-VTA-01.
// Orquesta la escritura de productos con PIN de admin (RPC de la migracion 007).
// El PIN llega por parametro, viaja solo en la llamada y NO se guarda ni se loguea.
import { supabase } from '../lib/supabase';
import { getVendedores, getProductos, deleteProducto, patchRegistros } from '../db';
import { esAdmin, validarPinIngresado } from '../domain/permisos';
import { argsAdminProductos, interpretarBajaProducto } from '../domain/productosRpc';
import { syncProductos } from '../sync/syncService';
import { subirCambiosPrecio, sondearMigracion010 } from './cambiosPrecioService';
import { bajarCostosProductos } from './costosProductosService';
import { getUsuarioSesion } from './sesion';

const MSG_SIN_ID_ADMIN = 'Tu usuario de admin todavia no esta sincronizado con el servidor: sincroniza y volve a intentar.';
const MSG_SOLO_ADMIN = 'Solo un admin puede subir o borrar productos.';
const MSG_OFFLINE = 'Necesitas conexion para esto.';
export const MSG_FALTA_010 = 'Falta aplicar la migracion 010 en Supabase: el precio llevando bulto y el historial de cambios de precio quedan pendientes.';

const esAdminSesion = () => esAdmin(getUsuarioSesion()?.permiso);

export const contarProductosPendientes = async () =>
  ((await getProductos()) || []).filter(p => p?.pendingSync || p?.extrasPendientes).length;

// Credenciales del admin de la sesion (se arman por llamada, no se guardan).
export const credencialesAdminProductos = async (pin) => {
  const v = validarPinIngresado(pin);
  if (!v.ok) return { ok: false, motivo: 'pin_requerido', mensaje: v.error };
  const sesion = getUsuarioSesion();
  const lista = await getVendedores();
  const yo = (lista || []).find(x => x?.id === sesion?.id);
  const rid = yo?.remoteId;
  if (rid === null || rid === undefined || rid === '') return { ok: false, motivo: 'sin_id_remoto', mensaje: MSG_SIN_ID_ADMIN };
  return { ok: true, cred: argsAdminProductos({ adminId: rid, adminPin: v.pin }) };
};

// Sonda de la 007: con id vacio la RPC responde no_autorizado antes de verificar
// el PIN (no cuenta como intento). Cualquier excepcion => "falta" (flujo viejo).
export const sondearMigracion007 = async () => {
  try {
    const { error } = await supabase.rpc('admin_baja_producto', { p_admin_id: '', p_admin_pin: '', p_producto_id: 0 });
    if (!error) return { faltaMigracion: false };
    return { faltaMigracion: interpretarBajaProducto({ error }).motivo === 'falta_migracion' };
  } catch {
    return { faltaMigracion: true };
  }
};

export const subirProductosConPin = async (pin) => {
  if (!esAdminSesion()) return { ok: false, motivo: 'no_admin', mensaje: MSG_SOLO_ADMIN };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { ok: false, motivo: 'offline', mensaje: MSG_OFFLINE };
  const cr = await credencialesAdminProductos(pin);
  if (!cr.ok) return cr;
  try {
    const r = await syncProductos({ cred: cr.cred });
    // REQ-HPR: el historial de cambios de precio viaja con la misma credencial.
    // REQ-PBU: si falta la 010 el RPC viejo ignora precio_bulto => esos productos quedan pendientes.
    let cambios = null;
    let falta010 = false;
    if (r.ok) {
      try {
        cambios = await subirCambiosPrecio(cr.cred);
        falta010 = cambios.faltaMigracion === true || (await sondearMigracion010()).faltaMigracion;
        if (falta010) {
          const conBulto = ((await getProductos()) || []).filter(p => Number(p?.precioBulto) > 0).map(p => p.id);
          if (conBulto.length) await patchRegistros('productos', conBulto, { extrasPendientes: true });
        }
      } catch { /* el historial se reintenta en la proxima subida */ }
    }
    // S-012-01: con el PIN ya validado se bajan los costos (la anon key no los lee desde la 013).
    // Sin la 013 o con error no pasa nada: se conservan los costos locales.
    const costos = r.ok ? await bajarCostosProductos(cr.cred) : null;
    return {
      ...r,
      cambiosPrecio: cambios,
      costosBajados: costos?.ok ? costos.actualizados : 0,
      ...(falta010 ? { avisoMigracion: MSG_FALTA_010 } : {}),
      pendientes: r.ok ? await contarProductosPendientes() : r.pendientes,
    };
  } catch (e) {
    return { ok: false, motivo: 'error', mensaje: e?.message || String(e) };
  }
};

// Flujo de antes de la 007: delete directo y verificacion de que la fila ya no exista.
const borrarDirecto = async (id) => {
  const { error } = await supabase.from('productos').delete().eq('id', id);
  if (error) throw error;
  const { data, error: errCheck } = await supabase.from('productos').select('id').eq('id', id);
  if (errCheck) throw errCheck;
  if (data && data.length > 0) {
    throw new Error('Supabase no permitio borrar el producto (revisar las politicas RLS de la tabla productos).');
  }
};

// Con la 007: RPC con PIN y despues borrado local (solo si el servidor dijo ok).
// Sin la 007: flujo anterior. Baja fisica, igual que siempre.
export const borrarProductoAdmin = async ({ pin, producto } = {}) => {
  if (!esAdminSesion()) return { ok: false, motivo: 'no_admin', mensaje: MSG_SOLO_ADMIN };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { ok: false, motivo: 'offline', mensaje: 'Para borrar un producto tenes que tener internet. Si no, vuelve a aparecer al sincronizar.' };
  }
  const id = producto?.id;
  const sonda = await sondearMigracion007();
  try {
    if (sonda.faltaMigracion) {
      await borrarDirecto(id);
      await deleteProducto(id);
      return { ok: true };
    }
    const cr = await credencialesAdminProductos(pin);
    if (!cr.ok) return cr;
    const { data, error } = await supabase.rpc('admin_baja_producto', { ...cr.cred, p_producto_id: id });
    const r = interpretarBajaProducto({ data, error });
    if (!r.ok) {
      if (r.motivo === 'falta_migracion') {
        await borrarDirecto(id);
        await deleteProducto(id);
        return { ok: true };
      }
      return { ok: false, motivo: r.motivo, mensaje: r.mensaje };
    }
    await deleteProducto(id);
    return { ok: true, yaBorrado: r.yaBorrado };
  } catch (e) {
    return { ok: false, motivo: 'error', mensaje: e?.message || String(e) };
  }
};
