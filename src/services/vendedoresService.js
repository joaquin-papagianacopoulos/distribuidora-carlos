// src/services/vendedoresService.js — ingreso online y alta/edicion de
// vendedores con el servidor (S-COM-13, cliente del PASO 2 de la 002).
// Orquesta dominio (src/domain/vendedores.js), Supabase e IndexedDB.
// El PIN que recibe cada funcion viaja SOLO en la llamada RPC: no se guarda,
// no se loguea y no se devuelve.
import { supabase } from '../lib/supabase';
import { addVendedor, updateVendedor, getVendedores } from '../db';
import {
  decidirIngreso,
  interpretarVerificacionPin,
  interpretarEstadoRemoto,
  validarFormVendedor,
  argsAdminGuardarVendedor,
  interpretarGuardarVendedor,
  puedeDarDeBaja,
  argsAdminBajaVendedor,
  interpretarBajaVendedor,
  MSG_BAJA_SIN_CONEXION,
  MSG_SIN_CONEXION,
} from '../domain/vendedores';
import { esAdmin } from '../domain/permisos';
import { esColumnaInexistente } from '../sync/tolerancia';

const enLinea = () => (typeof navigator === 'undefined' ? true : navigator.onLine === true);

// Paso 1 del ingreso: el usuario toco su nombre.
// Devuelve { accion: 'entrar' | 'pedir_pin' | 'sin_conexion' | ..., mensaje }.
export const iniciarIngreso = async (vendedor, { online = enLinea() } = {}) => {
  const d = decidirIngreso(vendedor, { online });
  if (d.accion !== 'consultar') return d;
  // Sin PIN segun este dispositivo: se confirma con el servidor, que es la
  // fuente de verdad (el dato local puede estar viejo).
  let r;
  try {
    // REQ-VEN: tambien "activo" (004). Sin la 004 se consulta sin esa columna.
    r = await supabase.from('vendedores').select('id,tiene_pin,permiso,activo').eq('id', vendedor.remoteId).maybeSingle();
    if (r?.error && esColumnaInexistente(r.error)) {
      r = await supabase.from('vendedores').select('id,tiene_pin,permiso').eq('id', vendedor.remoteId).maybeSingle();
    }
  } catch (e) {
    return { accion: 'sin_conexion', mensaje: MSG_SIN_CONEXION };
  }
  // 002 PASO 1 sin correr: la columna no existe. Sin verificacion de PIN en el
  // servidor no hay forma de saber; se respeta el dato local (sin PIN).
  if (r?.error && esColumnaInexistente(r.error)) {
    return { accion: 'entrar', mensaje: null };
  }
  const e = interpretarEstadoRemoto(r || {});
  if (!e.ok) return { accion: e.motivo, mensaje: e.mensaje };
  if (e.tienePin) return { accion: 'pedir_pin', mensaje: null };
  return { accion: 'entrar', mensaje: null, permiso: e.permiso };
};

// Paso 2: verificar el PIN en el servidor. Nunca compara contra nada local.
export const verificarPinIngreso = async (vendedor, pin, { online = enLinea() } = {}) => {
  if (!online) return { ok: false, motivo: 'sin_conexion', mensaje: MSG_SIN_CONEXION };
  const rid = vendedor?.remoteId;
  if (rid === null || rid === undefined || String(rid) === '') {
    return { ok: false, motivo: 'sin_sincronizar', mensaje: decidirIngreso(vendedor, { online: true }).mensaje };
  }
  let r;
  try {
    r = await supabase.rpc('verificar_pin', { p_vendedor_id: String(rid), p_pin: String(pin ?? '').trim() });
  } catch (e) {
    return { ok: false, motivo: 'sin_conexion', mensaje: MSG_SIN_CONEXION };
  }
  return interpretarVerificacionPin(r || {});
};

// Alta/edicion desde Configuracion (solo admin). Va por la RPC
// admin_guardar_vendedor de la 002 con el PIN del admin; nunca upsert directo
// con pin. Recien con el OK del servidor se escribe local (sin pin).
export const guardarVendedorAdmin = async ({ admin, adminPin, form, previo = null, online = enLinea() }) => {
  if (!admin || !esAdmin(Number(admin.permiso))) return { ok: false, motivo: 'permiso', mensaje: 'Solo el admin puede crear o editar vendedores.' };
  const v = validarFormVendedor(form, previo);
  if (!v.ok) return { ok: false, motivo: 'validacion', errores: v.errores, mensaje: Object.values(v.errores).join(' · ') };
  if (!online) return { ok: false, motivo: 'sin_conexion', mensaje: 'Necesitás conexión para guardar vendedores (los cambios de rol y PIN se validan en el servidor).' };
  const adminId = admin.remoteId;
  if (adminId === null || adminId === undefined || String(adminId) === '') {
    return { ok: false, motivo: 'sin_id_remoto', mensaje: 'Tu usuario de admin todavía no está sincronizado con el servidor.' };
  }
  if (!String(adminPin ?? '').trim()) return { ok: false, motivo: 'pin_requerido', mensaje: 'Ingresá tu PIN de admin para confirmar.' };

  let r;
  try {
    r = await supabase.rpc('admin_guardar_vendedor', argsAdminGuardarVendedor({
      adminId, adminPin, vendedorId: previo?.remoteId ?? null, datos: v.datos,
    }));
  } catch (e) {
    return { ok: false, motivo: 'sin_conexion', mensaje: 'Necesitás conexión para guardar vendedores.' };
  }
  const res = interpretarGuardarVendedor(r || {});
  if (!res.ok) return res;

  const local = {
    nombre: v.datos.nombre,
    zona: v.datos.zona,
    permiso: v.datos.permiso,
    tienePin: v.datos.tienePin,
    // Mismo tipo que baja el pull (id numerico de Supabase) para no duplicar.
    remoteId: previo?.remoteId ?? (/^\d{1,15}$/.test(res.id) ? Number(res.id) : res.id),
  };
  if (previo) await updateVendedor({ ...previo, ...local });
  else await addVendedor(local);
  return { ok: true, id: res.id };
};

// REQ-VEN (AC-VEN-1..5): baja LOGICA desde Configuracion (solo admin), por la
// RPC admin_baja_vendedor de la 004 con el PIN del admin. Requiere conexion.
// Recien con el OK del servidor se marca local activo:false (el registro NO se
// borra: asi el pull no lo vuelve a bajar como nuevo y el historial queda).
// Si falta la 004, no se toca nada (ni local).
export const darDeBajaVendedorAdmin = async ({ admin, adminPin, vendedor, vendedores = null, online = enLinea() }) => {
  const lista = Array.isArray(vendedores) ? vendedores : await getVendedores();
  const chk = puedeDarDeBaja({ admin, vendedor, vendedores: lista });
  if (!chk.ok) return chk;
  if (!online) return { ok: false, motivo: 'sin_conexion', mensaje: MSG_BAJA_SIN_CONEXION };
  const adminId = admin.remoteId;
  if (adminId === null || adminId === undefined || String(adminId) === '') {
    return { ok: false, motivo: 'sin_id_remoto', mensaje: 'Tu usuario de admin todavía no está sincronizado con el servidor.' };
  }
  if (!String(adminPin ?? '').trim()) return { ok: false, motivo: 'pin_requerido', mensaje: 'Ingresá tu PIN de admin para confirmar.' };

  let r;
  try {
    r = await supabase.rpc('admin_baja_vendedor', argsAdminBajaVendedor({ adminId, adminPin, vendedorId: vendedor.remoteId }));
  } catch (e) {
    return { ok: false, motivo: 'sin_conexion', mensaje: MSG_BAJA_SIN_CONEXION };
  }
  const res = interpretarBajaVendedor(r || {});
  if (!res.ok) return res;

  await updateVendedor({ ...vendedor, activo: false, tienePin: false });
  return { ok: true, motivo: 'ok', mensaje: null };
};
