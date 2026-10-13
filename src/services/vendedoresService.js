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
  MSG_DADO_DE_BAJA,
  MSG_NO_CONFIRMADO,
  COLUMNAS_VENDEDOR_REMOTO,
  COLUMNAS_VENDEDOR_SIN_ACTIVO,
  COLUMNAS_VENDEDOR_LEGACY,
  vendedorDeSesion,
  interpretarFilaIngreso,
  chequeoUltimoAdmin,
  validarNombreNuevoVendedor,
  claveNombreVendedor,
  decidirRevalidacion,
} from '../domain/vendedores';
import { esAdmin } from '../domain/permisos';
import { esColumnaInexistente } from '../sync/tolerancia';

const enLinea = () => (typeof navigator === 'undefined' ? true : navigator.onLine === true);

// C5 / S-COM-18: fila del vendedor en el servidor (select explícito, nunca
// pin/pin_hash). Mismo fallback de columnas que el pull (AC-VEN-5):
// REMOTO (con activo, 004) -> SIN_ACTIVO (sin la 004) -> LEGACY (sin la 002
// PASO 1). Devuelve { data, error, columnas }. Puede lanzar (red caída).
const leerFilaVendedor = async (remoteId) => {
  let columnas = COLUMNAS_VENDEDOR_REMOTO;
  let r = await supabase.from('vendedores').select(columnas).eq('id', remoteId).maybeSingle();
  if (r?.error && esColumnaInexistente(r.error)) {
    columnas = COLUMNAS_VENDEDOR_SIN_ACTIVO;
    r = await supabase.from('vendedores').select(columnas).eq('id', remoteId).maybeSingle();
  }
  if (r?.error && esColumnaInexistente(r.error)) {
    columnas = COLUMNAS_VENDEDOR_LEGACY;
    r = await supabase.from('vendedores').select(columnas).eq('id', remoteId).maybeSingle();
  }
  return { data: r?.data ?? null, error: r?.error ?? null, columnas };
};

// C5: persiste la verdad del servidor sobre el registro local existente (por
// id local; nunca crea ni borra registros). Así el efecto de useAppContext
// que mezcla el registro local sobre vendedorActual no vuelve a subir un
// permiso adulterado.
const persistirSesion = async (local, sesion) => {
  await updateVendedor({ ...(local || {}), ...sesion });
};

// S-BUL-01 (mitigacion parcial): revalida la sesion abierta contra la fila
// del servidor. Sin red, sin remoteId o con error de lectura => 'mantener'
// (offline-first). 'actualizar' persiste la verdad del servidor en el
// registro local (asi el merge de useAppContext no vuelve a subir un permiso
// adulterado). Devuelve { accion: 'mantener'|'actualizar'|'cerrar', sesion? }.
export const revalidarSesion = async (local, { online = enLinea() } = {}) => {
  const rid = local?.remoteId;
  if (!online || rid === null || rid === undefined || String(rid) === '') return { accion: 'mantener', motivo: 'sin_verificar' };
  let r;
  try {
    r = await leerFilaVendedor(rid);
  } catch (e) {
    return { accion: 'mantener', motivo: 'error_lectura' };
  }
  const d = decidirRevalidacion(local, r);
  if (d.accion === 'actualizar') {
    try { await persistirSesion(local, d.sesion); } catch (e) { /* se aplica igual en memoria */ }
  }
  return d;
};

// Paso 1 del ingreso: el usuario toco su nombre.
// Devuelve { accion: 'entrar' | 'pedir_pin' | 'sin_conexion' | ..., mensaje }.
// En 'entrar' devuelve además `vendedor`: el registro con el que se abre la
// sesión (datos del servidor; un solo-local entra con permiso 2).
export const iniciarIngreso = async (vendedor, { online = enLinea() } = {}) => {
  const d = decidirIngreso(vendedor, { online });
  if (d.accion === 'entrar') {
    // Solo-local (nunca llegó al servidor): entra como vendedor (2).
    const sesion = { ...vendedor, permiso: d.permiso };
    if (Number(vendedor.permiso) !== d.permiso) {
      try { await updateVendedor(sesion); } catch (e) { return { accion: 'error', mensaje: MSG_NO_CONFIRMADO }; }
    }
    return { ...d, vendedor: sesion };
  }
  if (d.accion !== 'consultar') return d;
  // Sin PIN segun este dispositivo: se confirma con el servidor, que es la
  // fuente de verdad (el dato local puede estar viejo o adulterado).
  let r;
  try {
    r = await leerFilaVendedor(vendedor.remoteId);
  } catch (e) {
    return { accion: 'sin_conexion', mensaje: MSG_SIN_CONEXION };
  }
  if (r.columnas === COLUMNAS_VENDEDOR_LEGACY && !r.error) {
    // 002 PASO 1 sin correr (S-COM-22(1), fail-open por decisión del dueño):
    // no hay verificación de PIN en el servidor. Igual la sesión sale de la
    // fila del servidor (permiso y nombre), no del registro local.
    if (!r.data) return { accion: 'no_existe', mensaje: 'Este usuario ya no existe en el servidor. Sincronizá vendedores.' };
  } else {
    const e = interpretarEstadoRemoto(r);
    if (!e.ok) return { accion: e.motivo, mensaje: e.mensaje };
    if (e.tienePin) return { accion: 'pedir_pin', mensaje: null };
  }
  const sesion = vendedorDeSesion(vendedor, r.data);
  if (!sesion) return { accion: 'inactivo', mensaje: MSG_DADO_DE_BAJA };
  try { await persistirSesion(vendedor, sesion); } catch (e) { return { accion: 'error', mensaje: MSG_NO_CONFIRMADO }; }
  return { accion: 'entrar', mensaje: null, permiso: sesion.permiso, vendedor: sesion };
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

// C5 / S-COM-18 (AC-SEC-4, AC-VEN-2): ingreso con PIN completo. Verifica el
// PIN en el servidor y, si da ok, lee la fila por el MISMO remoteId que
// verificó el PIN: la sesión queda con el nombre y el permiso del dueño real
// del PIN, y se persiste en el registro local. Si la lectura falla, no entra
// (fail-closed). Devuelve { ok, vendedor } o { ok:false, motivo, mensaje }.
export const ingresarConPin = async (vendedor, pin, { online = enLinea() } = {}) => {
  const v = await verificarPinIngreso(vendedor, pin, { online });
  if (!v.ok) return v;
  let r;
  try {
    r = await leerFilaVendedor(vendedor.remoteId);
  } catch (e) {
    r = { data: null, error: { message: 'Failed to fetch' } };
  }
  const f = interpretarFilaIngreso(r);
  if (!f.ok) return f;
  const sesion = vendedorDeSesion(vendedor, f.fila);
  if (!sesion) return { ok: false, motivo: 'inactivo', mensaje: MSG_DADO_DE_BAJA };
  try {
    await persistirSesion(vendedor, sesion);
  } catch (e) {
    return { ok: false, motivo: 'error', mensaje: MSG_NO_CONFIRMADO };
  }
  return { ok: true, motivo: 'ok', mensaje: null, vendedor: sesion };
};

// Alta/edicion desde Configuracion (solo admin). Va por la RPC
// admin_guardar_vendedor de la 002 con el PIN del admin; nunca upsert directo
// con pin. Recien con el OK del servidor se escribe local (sin pin).
export const guardarVendedorAdmin = async ({ admin, adminPin, form, previo = null, vendedores = null, online = enLinea() }) => {
  if (!admin || !esAdmin(Number(admin.permiso))) return { ok: false, motivo: 'permiso', mensaje: 'Solo el admin puede crear o editar vendedores.' };
  const v = validarFormVendedor(form, previo);
  if (!v.ok) return { ok: false, motivo: 'validacion', errores: v.errores, mensaje: Object.values(v.errores).join(' · ') };
  const lista = Array.isArray(vendedores) ? vendedores : ((await getVendedores()) || []);
  // S-VEN-01: alta o renombre con el nombre de otro vendedor (activo o dado
  // de baja) => no. Editar sin cambiar el nombre no se frena.
  const renombra = !previo || claveNombreVendedor(previo.nombre) !== claveNombreVendedor(v.datos.nombre);
  if (renombra) {
    const n = validarNombreNuevoVendedor(v.datos.nombre, lista, { excluido: previo });
    if (!n.ok) return n;
  }
  // C5b (AC-VEN-4 / S-COM-20): no dejar la base sin admin activo con PIN. El
  // servidor (004) lo vuelve a chequear bajo lock.
  if (previo) {
    const u = chequeoUltimoAdmin({ previo, datos: v.datos, vendedores: lista });
    if (!u.ok) return u;
  }
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
