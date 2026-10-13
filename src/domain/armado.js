// src/domain/armado.js — registro puro de lo que cambió el armador (REQ-BUL / AC-BUL-7).
// Sin React ni IndexedDB.

const cantidadValida = (v) => {
  if (typeof v !== 'number' && typeof v !== 'string') return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

// Agrupa por productoId (String) sumando filas duplicadas; ignora eliminados e inválidos.
function agrupar(items) {
  const mapa = new Map();
  if (!Array.isArray(items)) return mapa;
  for (const it of items) {
    if (!it || it.eliminado) continue;
    if (it.productoId === null || it.productoId === undefined || it.productoId === '') continue;
    const cant = cantidadValida(it.cantidad);
    if (cant === null) continue;
    const pid = String(it.productoId);
    const prev = mapa.get(pid);
    if (prev) prev.cantidad += cant;
    else mapa.set(pid, { cantidad: cant, nombre: it.nombre ? String(it.nombre) : '' });
  }
  return mapa;
}

/**
 * Diferencias de cantidad entre lo que había al abrir el armado y lo que queda.
 * Solo productos presentes en ambos lados o agregados (antes = 0).
 * Lo sacado del todo NO va acá (ya está en armadoLog.removidos).
 */
export function cambiosDeCantidad(itemsAntes, itemsDespues) {
  const antes = agrupar(itemsAntes);
  const despues = agrupar(itemsDespues);
  const out = [];
  for (const [pid, d] of despues) {
    const a = antes.get(pid);
    const cantAntes = a ? a.cantidad : 0;
    if (cantAntes === d.cantidad) continue;
    out.push({
      productoId: pid,
      nombre: d.nombre || (a && a.nombre) || '',
      antes: cantAntes,
      despues: d.cantidad,
      diferencia: d.cantidad - cantAntes,
    });
  }
  return out;
}

// S-BUL-05: topes para armadoLog.cambios (puede venir inflado desde la nube).
export const MAX_CAMBIOS_ARMADO = 500;
export const MAX_NOMBRE_CAMBIO = 120;
export const MAX_PRODUCTO_ID_CAMBIO = 64;

const nombreAcotado = (v) => (v ? String(v).slice(0, MAX_NOMBRE_CAMBIO) : '');

// productoId usable como clave: no vacío y con largo acotado; si no, null.
const pidValido = (v) => {
  if (v === null || v === undefined) return null;
  const pid = String(v);
  if (pid === '' || pid.length > MAX_PRODUCTO_ID_CAMBIO) return null;
  return pid;
};

// Set de productoId (String) a partir de un array/Set de ids; null si no se pasó.
const setDeVigentes = (v) => {
  if (v === null || v === undefined) return null;
  if (!Array.isArray(v) && !(v instanceof Set)) return new Set();
  const out = new Set();
  for (const id of v) {
    if (id === null || id === undefined || id === '') continue;
    out.add(String(id));
  }
  return out;
};

/**
 * Acumula con los cambios de sesiones anteriores del armador: conserva el
 * `antes` más viejo y el `despues` más nuevo; descarta los que vuelven a quedar
 * iguales. No muta las entradas.
 * - S-BUL-03: con `productosVigentes` (ids de los items que quedan activos) se
 *   descartan los cambios de productos que ya no están en el pedido.
 * - S-BUL-05: lee como mucho MAX_CAMBIOS_ARMADO previos, devuelve como mucho
 *   MAX_CAMBIOS_ARMADO entradas y recorta `nombre` a MAX_NOMBRE_CAMBIO.
 */
export function fusionarCambiosArmado(previos = [], nuevos = [], { productosVigentes = null } = {}) {
  const mapa = new Map();
  const listaPrev = Array.isArray(previos) ? previos.slice(0, MAX_CAMBIOS_ARMADO) : [];
  const listaNuevos = Array.isArray(nuevos) ? nuevos : [];
  const vigentes = setDeVigentes(productosVigentes);
  for (const c of listaPrev) {
    if (!c) continue;
    const pid = pidValido(c.productoId);
    if (pid === null) continue;
    const antes = cantidadValida(c.antes);
    const despues = cantidadValida(c.despues);
    if (antes === null || despues === null) continue;
    mapa.set(pid, { productoId: pid, nombre: nombreAcotado(c.nombre), antes, despues });
  }
  for (const c of listaNuevos) {
    if (!c) continue;
    const pid = pidValido(c.productoId);
    if (pid === null) continue;
    const antes = cantidadValida(c.antes);
    const despues = cantidadValida(c.despues);
    if (antes === null || despues === null) continue;
    const prev = mapa.get(pid);
    mapa.set(pid, {
      productoId: pid,
      nombre: nombreAcotado(c.nombre) || (prev && prev.nombre) || '',
      antes: prev ? prev.antes : antes,
      despues,
    });
  }
  const out = [];
  for (const c of mapa.values()) {
    if (out.length >= MAX_CAMBIOS_ARMADO) break;
    if (vigentes && !vigentes.has(c.productoId)) continue;
    const diferencia = c.despues - c.antes;
    if (diferencia === 0) continue;
    out.push({ ...c, diferencia });
  }
  return out;
}

// S-BUL-05: lectura acotada de armadoLog.cambios (para mostrar o re-subir).
// Valida, deduplica y aplica los mismos topes que fusionarCambiosArmado.
export function acotarCambiosArmado(cambios, opciones = {}) {
  return fusionarCambiosArmado(cambios, [], opciones);
}
