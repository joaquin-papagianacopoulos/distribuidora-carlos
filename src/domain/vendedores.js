// src/domain/vendedores.js — login online y alta/edicion de vendedores (S-COM-13).
// Logica pura: sin React, sin IndexedDB, sin Supabase.
//
// Decision del dueño (RUN 20261007-2022, iteracion 3): el ingreso es 100 %
// online. El PIN se verifica SOLO en el servidor (rpc verificar_pin de la 002) y
// nunca se guarda en el dispositivo: ni IndexedDB, ni localStorage, ni logs, ni
// estado persistido. Localmente solo queda "tienePin" (para el candado y para
// saber si hay que pedirlo). La sesion ya iniciada se mantiene offline como
// antes; lo que requiere conexion es un ingreso NUEVO.

import { ROLES, permisoValido } from './permisos';

export const MSG_SIN_CONEXION = 'Necesitás conexión para ingresar.';
export const MSG_PIN_INCORRECTO = 'PIN incorrecto.';
export const MSG_BLOQUEADO = 'Demasiados intentos. Probá de nuevo en 15 minutos.';
export const MSG_FALTA_MIGRACION = 'El servidor todavía no tiene la verificación de PIN (falta aplicar la migración 002). Avisale al administrador.';
export const MSG_DADO_DE_BAJA = 'Este usuario fue dado de baja. Sincronizá vendedores.';
export const MSG_SIN_SINCRONIZAR = 'Este usuario todavía no está sincronizado con el servidor: tocá "Sincronizar vendedores" y probá de nuevo.';

// Columnas que se bajan de Supabase. NUNCA "pin" ni "pin_hash" (PASO 2 de la
// 002 les quita el select a la anon key; con select('*') daria permission denied).
// REQ-VEN (AC-VEN-3): tambien "activo" (baja logica de la 004).
export const COLUMNAS_VENDEDOR_REMOTO = 'id,nombre,zona,permiso,tiene_pin,activo';
// Si la 004 todavia no se corrio, "activo" no existe: se baja sin esa columna.
export const COLUMNAS_VENDEDOR_SIN_ACTIVO = 'id,nombre,zona,permiso,tiene_pin';
// Si la 002 PASO 1 todavia no se corrio, "tiene_pin" no existe: se baja lo basico.
export const COLUMNAS_VENDEDOR_LEGACY = 'id,nombre,zona,permiso';

// Campos de credenciales que no pueden quedar en un registro local.
const CAMPOS_SECRETOS = ['pin', 'pin_hash', 'pinHash'];

const pinNoVacio = (pin) => (typeof pin === 'string' || typeof pin === 'number') && String(pin).trim() !== '';

// ¿El vendedor tiene PIN? Acepta el flag nuevo (tienePin / tiene_pin) y, solo
// para registros viejos todavia no migrados, la presencia de un "pin" legacy.
export const tienePin = (v) => !!v && (v.tienePin === true || v.tiene_pin === true || pinNoVacio(v.pin));

// Copia del registro local SIN credenciales. No borra el registro ni otros
// campos (regla dura 6): solo quita "pin" (no es dato de negocio: es una
// credencial que ahora vive hasheada en el servidor) y deja tienePin.
export const sinPinLocal = (v) => {
  if (!v || typeof v !== 'object') return v;
  const out = { ...v, tienePin: tienePin(v) };
  for (const k of CAMPOS_SECRETOS) delete out[k];
  delete out.tiene_pin;
  return out;
};

export const tieneCamposSecretos = (v) => !!v && typeof v === 'object' && CAMPOS_SECRETOS.some(k => k in v);

// Mapea una fila remota (select explicito, sin pin) al registro local.
export const vendedorDesdeRemoto = (r, local = null, now = Date.now()) => {
  const base = sinPinLocal(local || {});
  const permiso = Number(r?.permiso ?? local?.permiso ?? ROLES.VENDEDOR);
  return {
    ...base,
    nombre: r?.nombre ?? base.nombre ?? '',
    zona: r?.zona ?? '',
    remoteId: r?.id,
    permiso: permisoValido(permiso) ?? ROLES.VENDEDOR,
    // Tolerante: si la columna todavia no existe en Supabase, conserva lo local.
    tienePin: r && r.tiene_pin !== undefined ? r.tiene_pin === true : tienePin(local),
    // AC-VEN-3: el servidor manda. Si la columna no existe (004 sin correr) se
    // conserva lo local (y si no hay nada, no se agrega el campo).
    ...(r && r.activo !== undefined && r.activo !== null ? { activo: r.activo !== false } : {}),
    createdAt: local?.createdAt ?? now,
  };
};

// Que hacer cuando el usuario toca su nombre en la pantalla de ingreso.
//  - sin_conexion: no se entra.
//  - pedir_pin: mostrar el modal y verificar con el servidor.
//  - consultar: no tiene PIN segun este dispositivo, pero se confirma con el
//    servidor (el dato local puede estar viejo o adulterado).
//  - entrar: vendedor solo-local sin PIN (nunca llego al servidor).
export const decidirIngreso = (v, { online } = {}) => {
  if (!v) return { accion: 'invalido', mensaje: 'Elegí un usuario.' };
  if (online !== true) return { accion: 'sin_conexion', mensaje: MSG_SIN_CONEXION };
  const rid = v.remoteId;
  const conRemoto = rid !== null && rid !== undefined && String(rid) !== '';
  if (tienePin(v)) {
    return conRemoto ? { accion: 'pedir_pin', mensaje: null } : { accion: 'sin_sincronizar', mensaje: MSG_SIN_SINCRONIZAR };
  }
  return conRemoto ? { accion: 'consultar', mensaje: null } : { accion: 'entrar', mensaje: null };
};

const esFaltaRpc = (error) => {
  const code = String(error?.code || '');
  return ['PGRST202', '42883'].includes(code) || /could not find the function/i.test(String(error?.message || ''));
};
export const esErrorDeConexion = (error) =>
  !!error && (!error.code || /failed to fetch|network|timeout|load failed/i.test(String(error?.message || '')));
const esBloqueo = (error) => /demasiados intentos/i.test(String(error?.message || ''));

// Resultado de rpc('verificar_pin'). Solo data === true habilita el ingreso.
// Nunca devuelve ni repite el PIN.
export const interpretarVerificacionPin = ({ data, error } = {}) => {
  if (error) {
    if (esBloqueo(error)) return { ok: false, motivo: 'bloqueado', mensaje: MSG_BLOQUEADO };
    if (esFaltaRpc(error)) return { ok: false, motivo: 'falta_migracion', mensaje: MSG_FALTA_MIGRACION };
    if (esErrorDeConexion(error)) return { ok: false, motivo: 'sin_conexion', mensaje: MSG_SIN_CONEXION };
    return { ok: false, motivo: 'error', mensaje: 'No se pudo verificar el PIN. Probá de nuevo.' };
  }
  if (data === true) return { ok: true, motivo: 'ok', mensaje: null };
  return { ok: false, motivo: 'pin_incorrecto', mensaje: MSG_PIN_INCORRECTO };
};

// Resultado de la consulta "este vendedor tiene PIN en el servidor?".
export const interpretarEstadoRemoto = ({ data, error } = {}) => {
  if (error) {
    if (esErrorDeConexion(error)) return { ok: false, motivo: 'sin_conexion', mensaje: MSG_SIN_CONEXION };
    return { ok: false, motivo: 'error', mensaje: 'No se pudo consultar el usuario en el servidor. Probá de nuevo.' };
  }
  if (!data) return { ok: false, motivo: 'no_existe', mensaje: 'Este usuario ya no existe en el servidor. Sincronizá vendedores.' };
  // REQ-VEN (AC-VEN-2): dado de baja en el servidor => no entra, aunque este
  // dispositivo todavia no lo haya sincronizado.
  if (data.activo === false) return { ok: false, motivo: 'inactivo', mensaje: MSG_DADO_DE_BAJA };
  return { ok: true, tienePin: data.tiene_pin === true, permiso: permisoValido(Number(data.permiso)) ?? ROLES.VENDEDOR };
};

// ---------------------------------------------------------------------------
// Alta/edicion por el admin: rpc('admin_guardar_vendedor') de la 002.
// ---------------------------------------------------------------------------
export const PIN_REGEX = /^\d{4,8}$/;
const MAX_NOMBRE = 120;
const MAX_ZONA = 80;

// form: { nombre, zona, permiso, pin, clearPin }. previo: vendedor editado (o null).
// Devuelve los datos limpios para la RPC. Regla operativa (aviso del auditor):
// un admin (permiso 1) tiene que tener PIN, si no no puede cerrar comisiones ni
// autorizar cambios, y entraria sin clave.
export const validarFormVendedor = (form, previo = null) => {
  const errores = {};
  const nombre = String(form?.nombre ?? '').trim();
  const zona = String(form?.zona ?? '').trim();
  const permiso = permisoValido(Number(form?.permiso ?? ROLES.VENDEDOR));
  const pin = String(form?.pin ?? '').trim();
  const borrarPin = !!previo && form?.clearPin === true;

  if (!nombre) errores.nombre = 'El nombre es obligatorio';
  else if (nombre.length > MAX_NOMBRE) errores.nombre = `Máximo ${MAX_NOMBRE} caracteres`;
  if (zona.length > MAX_ZONA) errores.zona = `Máximo ${MAX_ZONA} caracteres`;
  if (permiso === null) errores.permiso = 'Permiso inválido';
  if (pin && !borrarPin && !PIN_REGEX.test(pin)) errores.pin = 'El PIN debe tener entre 4 y 8 dígitos';
  const quedaConPin = borrarPin ? false : (!!pin || tienePin(previo));
  if (permiso === ROLES.ADMIN && !quedaConPin) errores.pin = 'Un admin tiene que tener PIN (4 a 8 dígitos)';

  if (Object.keys(errores).length) return { ok: false, errores, datos: null };
  return {
    ok: true,
    errores,
    datos: { nombre, zona, permiso, pinNuevo: borrarPin ? null : (pin || null), borrarPin, tienePin: quedaConPin },
  };
};

// Argumentos de la RPC (firma de la 002). El PIN del admin y el nuevo viajan
// solo en esta llamada; quien la arma no los guarda.
export const argsAdminGuardarVendedor = ({ adminId, adminPin, vendedorId = null, datos }) => ({
  p_admin_id: String(adminId),
  p_admin_pin: String(adminPin ?? ''),
  p_vendedor_id: vendedorId === null || vendedorId === undefined || vendedorId === '' ? null : String(vendedorId),
  p_nombre: datos.nombre,
  p_zona: datos.zona,
  p_permiso: datos.permiso,
  p_pin_nuevo: datos.pinNuevo,
  p_borrar_pin: datos.borrarPin === true,
});

// La 002 devuelve el id (texto) o null si el admin/PIN no autoriza.
export const interpretarGuardarVendedor = ({ data, error } = {}) => {
  if (error) {
    if (esBloqueo(error)) return { ok: false, motivo: 'bloqueado', mensaje: MSG_BLOQUEADO };
    if (esFaltaRpc(error)) return { ok: false, motivo: 'falta_migracion', mensaje: MSG_FALTA_MIGRACION };
    if (esErrorDeConexion(error)) return { ok: false, motivo: 'sin_conexion', mensaje: 'Necesitás conexión para guardar vendedores.' };
    if (/solo un admin/i.test(String(error.message || ''))) return { ok: false, motivo: 'no_autorizado', mensaje: 'PIN de admin incorrecto.' };
    return { ok: false, motivo: 'error', mensaje: `El servidor rechazó el cambio: ${String(error.message || error.code).slice(0, 200)}` };
  }
  if (data === null || data === undefined || String(data) === '') {
    return { ok: false, motivo: 'no_autorizado', mensaje: 'PIN de admin incorrecto.' };
  }
  return { ok: true, id: String(data) };
};

// ---------------------------------------------------------------------------
// REQ-VEN: baja logica de vendedores (rpc admin_baja_vendedor de la 004).
// Nunca se borra el registro: queda activo = false, para que el pull no lo
// "resucite" y para que pedidos/cierres que lo nombran sigan igual.
// ---------------------------------------------------------------------------
export const MSG_FALTA_MIGRACION_004 = 'Falta la migración 004 en Supabase. No se dio de baja a nadie.';
export const MSG_BAJA_SIN_CONEXION = 'Necesitás conexión para dar de baja vendedores (se valida en el servidor).';

// Registro sin el campo (viejo o 004 sin correr) = activo.
export const estaActivo = (v) => !!v && typeof v === 'object' && v.activo !== false;

export const filtrarActivos = (lista) => (Array.isArray(lista) ? lista.filter(estaActivo) : []);

// Opciones para un selector de vendedor: solo activos, salvo el valor ya
// elegido (p. ej. un cliente viejo asignado a alguien dado de baja), que se
// conserva para no perder el dato al editar.
export const vendedoresParaSelector = (lista, valorActual = null) => {
  const actual = String(valorActual ?? '').trim();
  return (Array.isArray(lista) ? lista : []).filter(v =>
    estaActivo(v) || (!!v && actual !== '' && String(v.nombre ?? '').trim() === actual));
};

const vacio = (x) => x === null || x === undefined || String(x) === '';
const mismoVendedor = (a, b) => {
  if (!a || !b) return false;
  if (!vacio(a.id) && !vacio(b.id) && a.id === b.id) return true;
  return !vacio(a.remoteId) && !vacio(b.remoteId) && String(a.remoteId) === String(b.remoteId);
};

const esAdminVendedor = (v) => permisoValido(Number(v?.permiso)) === ROLES.ADMIN;

// ¿El admin puede dar de baja a este vendedor? (AC-VEN-4, lado cliente; el
// servidor vuelve a chequear todo). vendedores = lista local completa.
export const puedeDarDeBaja = ({ admin, vendedor, vendedores = [] } = {}) => {
  if (!admin || !esAdminVendedor(admin) || !estaActivo(admin)) {
    return { ok: false, motivo: 'permiso', mensaje: 'Solo un admin puede dar de baja vendedores.' };
  }
  if (!vendedor || typeof vendedor !== 'object') return { ok: false, motivo: 'invalido', mensaje: 'Elegí un vendedor.' };
  if (!estaActivo(vendedor)) return { ok: false, motivo: 'ya_inactivo', mensaje: 'Ese vendedor ya está dado de baja.' };
  if (mismoVendedor(admin, vendedor)) {
    return { ok: false, motivo: 'propio_admin', mensaje: 'No podés darte de baja a vos mismo.' };
  }
  if (esAdminVendedor(vendedor)) {
    const otros = filtrarActivos(vendedores).filter(v => esAdminVendedor(v) && !mismoVendedor(v, vendedor));
    if (otros.length === 0) return { ok: false, motivo: 'ultimo_admin', mensaje: 'No se puede dar de baja al último admin activo.' };
  }
  if (vacio(vendedor.remoteId)) {
    return { ok: false, motivo: 'sin_sincronizar', mensaje: 'Este vendedor todavía no está sincronizado con el servidor: sincronizá y probá de nuevo.' };
  }
  return { ok: true, motivo: 'ok', mensaje: null };
};

// Argumentos de la RPC (firma de la 004). El PIN viaja solo en esta llamada.
export const argsAdminBajaVendedor = ({ adminId, adminPin, vendedorId }) => ({
  p_admin_id: String(adminId ?? ''),
  p_admin_pin: String(adminPin ?? '').trim(),
  p_vendedor_id: String(vendedorId ?? ''),
});

const MENSAJES_BAJA = {
  no_autorizado: 'PIN de admin incorrecto.',
  propio_admin: 'No podés darte de baja a vos mismo.',
  ultimo_admin: 'No se puede dar de baja al último admin activo.',
  no_existe: 'Ese vendedor ya no existe en el servidor. Sincronizá vendedores.',
};

// Resultado de rpc('admin_baja_vendedor'): { ok } o { ok:false, motivo }.
// Cualquier respuesta rara se trata como no autorizado (no se toca nada local).
export const interpretarBajaVendedor = ({ data, error } = {}) => {
  if (error) {
    if (esBloqueo(error)) return { ok: false, motivo: 'bloqueado', mensaje: MSG_BLOQUEADO };
    const msg = String(error?.message || '');
    const faltaColumnaActivo = /activo/i.test(msg) && /does not exist|could not find/i.test(msg);
    if (esFaltaRpc(error) || faltaColumnaActivo) {
      return { ok: false, motivo: 'falta_migracion', mensaje: MSG_FALTA_MIGRACION_004 };
    }
    if (esErrorDeConexion(error)) return { ok: false, motivo: 'sin_conexion', mensaje: MSG_BAJA_SIN_CONEXION };
    return { ok: false, motivo: 'error', mensaje: `El servidor rechazó la baja: ${String(error.message || error.code).slice(0, 200)}` };
  }
  if (data && typeof data === 'object' && data.ok === true) return { ok: true, motivo: 'ok', mensaje: null };
  const motivo = data && typeof data === 'object' && MENSAJES_BAJA[data.motivo] ? data.motivo : 'no_autorizado';
  return { ok: false, motivo, mensaje: MENSAJES_BAJA[motivo] };
};
