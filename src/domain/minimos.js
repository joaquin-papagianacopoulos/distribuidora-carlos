// src/domain/minimos.js — REQ-MIN: mínimo para pedir un producto ("Mínimo venta").
// Funciones puras. Mínimo vacío/0/1 = sin restricción.
import { toInt } from './validacion';
import { normalizarBultoX, normalizarCantidad } from './bultos';
import { ventaPorEfectivo, cantidadInicialRenglon } from './unidadVenta';

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

// AC-MIN-1/2: 'no' = no se puede guardar bajo el mínimo; 'confirmar' = se puede con confirmación.
export function puedeGuardarBajoMinimo(permiso, pantalla) {
  return Number(permiso) === 1 && pantalla === 'facturacion' ? 'confirmar' : 'no';
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
