// src/domain/productosRpc.js — S-VTA-01. Funciones puras para escribir productos
// por las RPC admin_guardar_productos / admin_baja_producto (migracion 007).
// Sin React ni IndexedDB. El stock NUNCA viaja (solo por movimientosStock).
import { productoExtraToRemote, productoVentaToRemote, productoPreciosToRemote } from './productos';
import { esAdmin } from './permisos';

export const MENSAJES_PRODUCTOS = Object.freeze({
  no_autorizado: 'PIN incorrecto o tu usuario no esta autorizado como admin en el servidor.',
  bloqueado: 'Demasiados intentos de PIN. Proba de nuevo en 15 minutos.',
  falta_migracion: 'Falta la migracion 007 en Supabase.',
  lote_invalido: 'El servidor rechazo el lote de productos.',
  respuesta_invalida: 'El servidor respondio algo inesperado: los productos siguen pendientes.',
  error: 'No se pudo completar la operacion con el servidor.',
  id_invalido: 'El producto tiene un id invalido.',
});

const TAM_LOTE = 500;

// Fila con nombres de columna remotos. Basicas siempre; 001+006 solo con extras.
export const filaProductoRpc = (p = {}, { conExtras = false } = {}) => ({
  id: p.id,
  nombre: p.nombre,
  codigo: p.codigo ?? '',
  precio: p.precio ?? 0,
  unidad: p.unidad ?? 'unidad',
  categoria: p.categoria ?? '',
  marca: p.marca ?? '',
  imagen_url: p.imagen_url ?? null,
  ...(conExtras ? { ...productoExtraToRemote(p), ...productoVentaToRemote(p), ...productoPreciosToRemote(p) } : {}),
  extras: !!conExtras,
});

export const productoConExtras = (p) => !!(p?.extrasDirty || p?.extrasPendientes);

// Serializacion estable de lo que viaja: detecta ediciones durante la subida.
export const huellaProductoSync = (p = {}) => {
  const f = filaProductoRpc(p, { conExtras: true });
  return JSON.stringify([
    ...Object.keys(f).sort().map(k => [k, f[k]]),
    productoConExtras(p),
  ]);
};

// Arma lotes de hasta `tam` filas. Los ids que no son enteros seguros se
// reportan aparte (en `invalidos`) y no viajan.
export const armarLotesProductosRpc = (pendientes, tam = TAM_LOTE) => {
  const lista = Array.isArray(pendientes) ? pendientes : [];
  const validos = lista.filter(p => p && Number.isSafeInteger(p.id) && p.id > 0);
  const invalidos = lista.filter(p => p && !(Number.isSafeInteger(p.id) && p.id > 0));
  const n = Math.max(1, Math.min(TAM_LOTE, Number(tam) || TAM_LOTE));
  const lotes = [];
  for (let i = 0; i < validos.length; i += n) {
    const parte = validos.slice(i, i + n);
    lotes.push({
      filas: parte.map(p => filaProductoRpc(p, { conExtras: productoConExtras(p) })),
      ids: parte.map(p => p.id),
      huellas: new Map(parte.map(p => [p.id, huellaProductoSync(p)])),
    });
  }
  Object.defineProperty(lotes, 'invalidos', { value: invalidos, enumerable: false });
  return lotes;
};

const esFuncionInexistenteErr = (e) =>
  ['PGRST202', '42883'].includes(String(e?.code)) || /could not find the function/i.test(String(e?.message || ''));
const esBloqueo = (e) => String(e?.code) === 'P0001' && /demasiados intentos/i.test(String(e?.message || ''));
const falla = (motivo) => ({ ok: false, motivo, mensaje: MENSAJES_PRODUCTOS[motivo], aceptados: [], rechazados: [] });

export const interpretarGuardarProductos = ({ data, error } = {}) => {
  if (error) {
    if (esFuncionInexistenteErr(error)) return falla('falta_migracion');
    if (esBloqueo(error) || /demasiados intentos/i.test(String(error?.message || ''))) return falla('bloqueado');
    return falla('error');
  }
  if (!data || typeof data !== 'object') return falla('respuesta_invalida');
  if (data.ok === false) {
    const m = data.motivo === 'no_autorizado' || data.motivo === 'lote_invalido' ? data.motivo : 'error';
    return falla(m);
  }
  if (data.ok !== true || !Array.isArray(data.aceptados) || !Array.isArray(data.rechazados)) return falla('respuesta_invalida');
  const aceptados = data.aceptados.filter(Number.isSafeInteger);
  const rechazados = data.rechazados
    .filter(r => r && typeof r === 'object')
    .map(r => ({ id: r.id, motivo: typeof r.motivo === 'string' ? r.motivo : 'datos_invalidos' }));
  return { ok: true, motivo: null, mensaje: null, aceptados, rechazados };
};

export const interpretarBajaProducto = ({ data, error } = {}) => {
  const f = (motivo) => ({ ok: false, motivo, mensaje: MENSAJES_PRODUCTOS[motivo] });
  if (error) {
    if (esFuncionInexistenteErr(error)) return f('falta_migracion');
    if (esBloqueo(error) || /demasiados intentos/i.test(String(error?.message || ''))) return f('bloqueado');
    return f('error');
  }
  if (!data || typeof data !== 'object') return f('respuesta_invalida');
  if (data.ok === true) return { ok: true, motivo: null, mensaje: null, yaBorrado: data.ya_borrado === true };
  if (data.motivo === 'no_autorizado' || data.motivo === 'id_invalido') return f(data.motivo);
  return f('error');
};

export const argsAdminProductos = ({ adminId, adminPin } = {}) => ({
  p_admin_id: String(adminId ?? '').trim(),
  p_admin_pin: String(adminPin ?? '').trim(),
});

// AC-SEC-4: solo admin edita productos.
export const puedeEditarProductos = (permiso) => esAdmin(permiso);
