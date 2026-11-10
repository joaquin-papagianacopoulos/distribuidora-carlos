// src/domain/minimos.js — REQ-MIN: mínimo para pedir un producto ("Mínimo venta").
// Funciones puras. Mínimo vacío/0/1 = sin restricción.
import { toInt } from './validacion';
import { normalizarBultoX, normalizarCantidad } from './bultos';
import { ventaPorEfectivo, cantidadInicialRenglon, cantidadConPaso } from './unidadVenta';
import { MAX_CANTIDAD } from './stock';

// AC-MIN-3: mínimo efectivo. Si el producto se vende por bulto, se redondea
// hacia arriba al múltiplo de bulto.
export function minimoEfectivo(producto) {
  const p = producto && typeof producto === 'object' ? producto : {};
  const m = toInt(p.minimoVenta);
  if (m === null || m <= 1) return 1;
  const bx = normalizarBultoX(p.bultoX);
  if (ventaPorEfectivo(p) === 'bulto' && bx !== null) return Math.ceil(m / bx) * bx;
  return m;
}

// AC-MIN-1: cantidad con la que arranca el renglón.
export function cantidadInicialConMinimo(producto) {
  return Math.max(cantidadInicialRenglon(producto), minimoEfectivo(producto));
}

// AC-MIN-1/2 + AC-MIN2-1: 'no' = no se puede guardar bajo el mínimo; 'confirmar' = se puede con
// confirmación. Solo el admin (permiso 1), en Facturación o en Armado.
export function puedeGuardarBajoMinimo(permiso, pantalla) {
  return Number(permiso) === 1 && (pantalla === 'facturacion' || pantalla === 'armado') ? 'confirmar' : 'no';
}

const claveItem = (it) => (it && it.productoId !== undefined && it.productoId !== null ? String(it.productoId) : null);

// AC-MIN-1/2: renglones por debajo del mínimo. Se ignoran los eliminados/tachados
// y los que no empeoraron respecto de `previos` (pedidos viejos no se bloquean).
export function validarMinimosItems(items, productosById, { permiso, pantalla, previos } = {}) {
  const antes = new Map();
  for (const p of Array.isArray(previos) ? previos : []) {
    const k = claveItem(p);
    if (k !== null) antes.set(k, p);
  }
  const errores = [];
  for (const it of Array.isArray(items) ? items : []) {
    const k = claveItem(it);
    if (k === null || it.eliminado === true) continue;
    const prod = productosById instanceof Map ? productosById.get(k) : null;
    if (!prod) continue;
    const minimo = minimoEfectivo(prod);
    if (minimo <= 1) continue;
    const cant = normalizarCantidad(it.cantidad);
    if (cant >= minimo) continue;
    const previo = antes.get(k);
    if (previo && normalizarCantidad(previo.cantidad) < minimo && cant >= normalizarCantidad(previo.cantidad)) continue;
    errores.push({ productoId: it.productoId, nombre: String(it.nombre ?? prod.nombre ?? ''), minimo });
  }
  return { errores, requiereConfirmacion: errores.length > 0 && puedeGuardarBajoMinimo(permiso, pantalla) === 'confirmar' };
}

export function mensajeMinimo(minimo) {
  return `Mínimo para pedir: ${minimo}`;
}

// ---------------------------------------------------------------------------
// REQ-MUL (AC-MUL-1/2): cantidades en múltiplos del mínimo.
// ---------------------------------------------------------------------------

// Paso por debajo del bulto: el mínimo de venta (entero > 1) si el producto no es
// "solo bulto" (ahí manda el bulto); si no, 1.
export function pasoMinimo(producto) {
  const p = producto && typeof producto === 'object' ? producto : {};
  const m = toInt(p.minimoVenta);
  if (m === null || m <= 1) return 1;
  if (ventaPorEfectivo(p) === 'bulto') return 1;
  return m;
}

// AC-MUL-1: cantidad que deja el +/− (o volver a tocar el producto). Con paso 1 es
// exactamente AC-FRB-4 (cantidadConPaso). Con mínimo m > 1: 3 -> 6 -> 9; 7 -> 10;
// 12 -> 10. En "ambos" desde el bulto va de a bulto. Nunca baja del mínimo efectivo
// ni supera MAX_CANTIDAD (en ese caso, sin cambios).
export function cantidadConPasoMinimo(cantidad, producto, op = 'sumar') {
  const m = pasoMinimo(producto);
  if (m <= 1) return cantidadConPaso(cantidad, producto, op);
  const c = normalizarCantidad(cantidad);
  const bx = normalizarBultoX(producto && producto.bultoX);
  const piso = minimoEfectivo(producto);
  const conBulto = ventaPorEfectivo(producto) === 'ambos' && bx !== null && Number.isInteger(c);
  let nueva;
  if (op === 'sumar') {
    if (conBulto && c >= bx) nueva = (Math.floor(c / bx) + 1) * bx;
    else {
      nueva = (Math.floor(c / m) + 1) * m;
      if (conBulto && nueva > bx) nueva = bx;
    }
    return nueva > MAX_CANTIDAD ? c : nueva;
  }
  if (conBulto && c > bx) nueva = (Math.ceil(c / bx) - 1) * bx;
  else nueva = c % m === 0 ? c - m : Math.floor(c / m) * m;
  return Math.max(piso, nueva);
}

const esMultiploMinimo = (c, producto) => {
  const m = pasoMinimo(producto);
  if (m <= 1) return true;
  if (!Number.isInteger(c)) return false;
  if (c % m === 0) return true;
  const bx = normalizarBultoX(producto && producto.bultoX);
  return bx !== null && ventaPorEfectivo(producto) === 'ambos' && (c % bx) % m === 0;
};

// AC-MUL-2: espejo exacto de public.tienda_cantidad_valida (migración 024).
// c >= mínimo efectivo y (m <= 1, o c múltiplo de m, o las sueltas sobre el bulto lo son).
export function esCantidadValidaMinimo(cantidad, producto) {
  const c = normalizarCantidad(cantidad);
  if (c < minimoEfectivo(producto)) return false;
  return esMultiploMinimo(c, producto);
}

// AC-MUL-1: lo tipeado que no es múltiplo se sube al múltiplo superior (las sueltas,
// si ya hay bultos). Devuelve { cantidad, ajustado, aviso }.
export function ajustarAMultiploMinimo(cantidad, producto) {
  const c = normalizarCantidad(cantidad);
  const m = pasoMinimo(producto);
  if (m <= 1 || !Number.isInteger(c) || esMultiploMinimo(c, producto)) return { cantidad: c, ajustado: false, aviso: null };
  const bx = normalizarBultoX(producto && producto.bultoX);
  let nueva;
  if (bx !== null && ventaPorEfectivo(producto) === 'ambos' && c > bx) {
    const s = c % bx;
    nueva = c - s + Math.ceil(s / m) * m;
  } else {
    nueva = Math.ceil(c / m) * m;
  }
  nueva = Math.max(nueva, minimoEfectivo(producto));
  if (nueva > MAX_CANTIDAD) return { cantidad: c, ajustado: false, aviso: null };
  return { cantidad: nueva, ajustado: true, aviso: `Se ajustó a ${nueva} (de a ${m})` };
}

// AC-MUL-2: renglones fuera de múltiplo del mínimo. Los que no cambiaron respecto de
// `previos` se saltean (pedidos viejos no se bloquean). El admin en Facturación/Armado
// puede guardar con confirmación (AC-MIN2-1); el resto queda bloqueado.
export function validarMultiplosMinimoItems(items, productosById, { permiso, pantalla, previos } = {}) {
  const antes = new Map();
  for (const p of Array.isArray(previos) ? previos : []) {
    const k = claveItem(p);
    if (k !== null) antes.set(k, p);
  }
  const errores = [];
  for (const it of Array.isArray(items) ? items : []) {
    const k = claveItem(it);
    if (k === null || it.eliminado === true) continue;
    const prod = productosById instanceof Map ? productosById.get(k) : null;
    if (!prod || pasoMinimo(prod) <= 1) continue;
    if (antes.has(k) && Object.is(antes.get(k).cantidad, it.cantidad)) continue;
    const cant = normalizarCantidad(it.cantidad);
    if (esMultiploMinimo(cant, prod)) continue;
    errores.push({ productoId: it.productoId, nombre: String(it.nombre ?? prod.nombre ?? ''), cantidad: it.cantidad, minimo: pasoMinimo(prod) });
  }
  const confirmar = puedeGuardarBajoMinimo(permiso, pantalla) === 'confirmar';
  return { errores, requiereConfirmacion: errores.length > 0 && confirmar, bloquea: errores.length > 0 && !confirmar };
}

export function mensajeMultiploMinimo(m) {
  return `Se pide de a ${m}`;
}
