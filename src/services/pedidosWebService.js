// src/services/pedidosWebService.js — REQ-WEB: orquesta la bandeja "Pedidos web".
// Offline-first: aceptar/rechazar se encola en IndexedDB (store pedidosWebAcciones,
// pendingSync) y se sube con la RPC admin_resolver_pedido_web, que decide en el
// servidor (for update). El PIN del admin vive SOLO en memoria de la sesión: nunca
// en IndexedDB ni en localStorage, ni se loguea.
import { getVendedores, getPedidosWebAcciones, putPedidoWebAccion } from '../db';
import { syncPedidosWeb, pullPedidosWebPorRevisar, pullContactosPedidosWeb } from '../sync/syncService';
import { getUsuarioSesion } from './sesion';
import { esAdmin, validarPinIngresado } from '../domain/permisos';
import { validarAccionWeb } from '../domain/pedidosWeb';
import { nuevoId } from '../domain/validacion';

export const MSG_SIN_ID_REMOTO = 'Tu usuario de admin todavía no está sincronizado con el servidor: sincronizá y volvé a intentar.';
export const MSG_FALTA_008 = 'Falta correr supabase/migrations/008_tienda.sql en Supabase: todavía no se pueden resolver pedidos web.';

let pinEnMemoria = null;
export const recordarPin = (pin) => {
  const v = validarPinIngresado(pin);
  pinEnMemoria = v.ok ? v.pin : null;
  return v.ok;
};
export const olvidarPin = () => { pinEnMemoria = null; };
export const hayPinEnMemoria = () => pinEnMemoria !== null;

const idRemotoAdmin = async () => {
  const sesion = getUsuarioSesion();
  if (!sesion) return null;
  const lista = await getVendedores();
  const v = (lista || []).find(x => x?.id === sesion.id);
  const rid = v?.remoteId;
  return rid === null || rid === undefined || rid === '' ? null : String(rid);
};

export const cargarAcciones = () => getPedidosWebAcciones();

// Encola aceptar/rechazar. `datos` para aceptar: { clienteId, clienteNombre, zona, vendedor, items, total, fecha? };
// para rechazar: { motivo }. Un pedido solo admite una acción sin subir.
export const encolarAccion = async (pedido, tipo, datos = {}) => {
  const sesion = getUsuarioSesion();
  if (!sesion || !esAdmin(sesion.permiso)) return { ok: false, motivo: 'permiso', mensaje: 'Solo el admin resuelve pedidos web.' };
  if (!pedido || pedido.origen !== 'web' || pedido.remoteId === null || pedido.remoteId === undefined) {
    return { ok: false, motivo: 'pedido', mensaje: 'El pedido todavía no llegó del servidor.' };
  }
  const v = validarAccionWeb(tipo, datos);
  if (!v.ok) return { ok: false, motivo: 'validacion', errores: v.errores, mensaje: Object.values(v.errores)[0] };
  const existentes = await getPedidosWebAcciones();
  if (existentes.some(a => a.pendingSync && String(a.pedidoRemoteId) === String(pedido.remoteId))) {
    return { ok: false, motivo: 'ya_hay_accion', mensaje: 'Este pedido ya tiene una acción pendiente de subir.' };
  }
  const accion = {
    id: nuevoId(),
    pedidoRemoteId: pedido.remoteId,
    tipo,
    clienteId: tipo === 'aceptar' ? datos.clienteId : null,
    clienteNombre: tipo === 'aceptar' ? (datos.clienteNombre || '') : '',
    zona: tipo === 'aceptar' ? (datos.zona || '') : '',
    vendedor: tipo === 'aceptar' ? datos.vendedor : '',
    items: tipo === 'aceptar' ? (datos.items || pedido.items || []) : [],
    total: tipo === 'aceptar' ? Number(datos.total ?? pedido.total ?? 0) : 0,
    // AC-WEB-8: fecha del pedido elegida al aceptar (null = no se cambia).
    fecha: tipo === 'aceptar' ? (datos.fecha || null) : null,
    motivo: tipo === 'rechazar' ? String(datos.motivo).trim() : '',
    por: sesion.nombre || '',
    at: Date.now(),
    pendingSync: true,
    resultado: null,
    detalle: null,
  };
  await putPedidoWebAccion(accion);
  return { ok: true, accion };
};

// Sube las acciones pendientes. Con `pin` lo recuerda en memoria; sin PIN usa el recordado.
export const sincronizarAcciones = async ({ pin } = {}) => {
  if (pin !== undefined && pin !== null && pin !== '') {
    if (!recordarPin(pin)) return { ok: false, motivo: 'pin_requerido', mensaje: 'Ingresá tu PIN de admin' };
  }
  const sesion = getUsuarioSesion();
  if (!sesion || !esAdmin(sesion.permiso)) return { ok: false, motivo: 'permiso', mensaje: 'Solo el admin resuelve pedidos web.' };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { ok: false, motivo: 'offline', mensaje: 'Sin conexión: las acciones quedan pendientes.' };
  const adminId = await idRemotoAdmin();
  if (!adminId) return { ok: false, motivo: 'sin_id_remoto', mensaje: MSG_SIN_ID_REMOTO };
  const pendientes = (await getPedidosWebAcciones()).filter(a => a.pendingSync);
  if (pendientes.length > 0 && pinEnMemoria === null) {
    return { ok: false, motivo: 'pin_requerido', mensaje: 'Ingresá tu PIN de admin para subir las acciones pendientes.', pendientes: pendientes.length };
  }
  try {
    const r = await syncPedidosWeb({ cred: pinEnMemoria === null ? null : { p_admin_id: adminId, p_admin_pin: pinEnMemoria } });
    if (r.faltaMigracion) return { ok: false, motivo: 'falta_migracion', mensaje: MSG_FALTA_008 };
    if (r.motivo === 'no_autorizado') { olvidarPin(); return { ok: false, motivo: 'no_autorizado', mensaje: 'PIN incorrecto o sin permiso de admin.' }; }
    return r;
  } catch (e) {
    return { ok: false, motivo: 'red', mensaje: 'No se pudo subir ahora: queda pendiente y se reintenta.' };
  }
};

export const refrescarBandeja = async () => {
  try { return await pullPedidosWebPorRevisar(); } catch { return { ok: false }; }
};

// S-WEB-01: baja los datos de contacto (solo admin con PIN). Nunca tira: si la RPC falla
// devuelve un mensaje claro y la bandeja sigue sin mostrar datos de contacto.
export const MSG_CONTACTO_PIN = 'Ingresá tu PIN de admin para ver los datos de contacto.';
export const MSG_CONTACTO_ERROR = 'No se pudieron traer los datos de contacto. Los renglones y el total se ven igual; reintentá más tarde.';
export const cargarContactos = async ({ pin } = {}) => {
  if (pin !== undefined && pin !== null && pin !== '') recordarPin(pin);
  const sesion = getUsuarioSesion();
  if (!sesion || !esAdmin(sesion.permiso)) return { ok: false, motivo: 'permiso', mensaje: 'Solo el admin ve los datos de contacto.' };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { ok: false, motivo: 'offline', mensaje: 'Sin conexión: los datos de contacto se bajan cuando vuelva.' };
  try {
    const adminId = await idRemotoAdmin();
    const r = await pullContactosPedidosWeb({ cred: pinEnMemoria === null || !adminId ? null : { p_admin_id: adminId, p_admin_pin: pinEnMemoria } });
    if (r.ok) return r;
    if (r.motivo === 'pin_requerido') return { ...r, mensaje: MSG_CONTACTO_PIN };
    if (r.motivo === 'no_autorizado') { olvidarPin(); return { ...r, mensaje: 'PIN incorrecto o sin permiso de admin.' }; }
    if (r.faltaMigracion) return { ...r, motivo: 'falta_migracion', mensaje: MSG_FALTA_008 };
    return { ...r, mensaje: MSG_CONTACTO_ERROR };
  } catch {
    return { ok: false, motivo: 'red', mensaje: MSG_CONTACTO_ERROR };
  }
};
