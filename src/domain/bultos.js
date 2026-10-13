// src/domain/bultos.js — lógica pura del botón "Bulto" (REQ-BUL).
// Sin React ni IndexedDB. Las pantallas solo invocan estas funciones; el único
// dato persistido sigue siendo item.cantidad (el stock lo reconcilia el ledger).

import { toInt } from './validacion';
import { MAX_CANTIDAD } from './stock';

// Piso que usan las pantallas para "− Bulto": el renglón no se borra solo (AC-BUL-3).
export const CANTIDAD_MINIMA_RENGLON = 1;

// AC-BUL-5: bultoX válido (entero > 1 y <= MAX_CANTIDAD) o null = "sin bulto".
// Solo se aceptan number y string; decimal, negativo, texto o ausente => null.
export function normalizarBultoX(v) {
  if (typeof v !== 'number' && typeof v !== 'string') return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  const n = toInt(v);
  if (n === null || n <= 1 || n > MAX_CANTIDAD) return null;
  return n;
}

// AC-BUL-1: ¿el producto tiene bulto usable?
export function tieneBulto(producto) {
  if (!producto || typeof producto !== 'object') return false;
  return normalizarBultoX(producto.bultoX) !== null;
}

// Cantidad del renglón saneada: número finito >= 0; inválido => 0.
// No trunca decimales legacy (no se altera un dato existente).
export function normalizarCantidad(v) {
  if (typeof v !== 'number' && typeof v !== 'string') return 0;
  const n = typeof v === 'number' ? v : Number(String(v).trim().replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

// AC-BUL-2: suma `veces` bultos. Sin bulto o `veces` inválido => sin cambios.
// Si el resultado superaría MAX_CANTIDAD, devuelve la cantidad sin cambios.
// S-BUL-02: cantidad legacy no entera => sin cambios (movimientos_stock.cantidad es integer).
export function sumarBulto(cantidad, bultoX, veces = 1) {
  const c = normalizarCantidad(cantidad);
  if (!Number.isInteger(c)) return c;
  const bx = normalizarBultoX(bultoX);
  if (bx === null) return c;
  if (!Number.isInteger(veces) || veces <= 0) return c;
  const resultado = c + bx * veces;
  if (resultado > MAX_CANTIDAD) return c;
  return resultado;
}

// AC-BUL-9: cantidad que se pone sola al agregar un producto al renglón.
export const CANTIDAD_INICIAL_RENGLON = 1;

// AC-BUL-9: marca transitoria del renglón ("la cantidad es la que se puso sola,
// nadie la tocó"). Vive solo en pantalla: se quita antes de guardar en
// IndexedDB/Supabase con quitarMarcasRenglon/quitarMarcasRenglones.
export const MARCA_CANTIDAD_POR_DEFECTO = '_cantidadPorDefecto';

// AC-BUL-9: renglón nuevo con la unidad por defecto y la marca puesta.
export function renglonNuevo(producto, extra = {}) {
  const p = producto && typeof producto === 'object' ? producto : {};
  return {
    productoId: p.id,
    nombre: p.nombre,
    precio: p.precio,
    precioOriginal: p.precio,
    cantidad: CANTIDAD_INICIAL_RENGLON,
    ...extra,
    [MARCA_CANTIDAD_POR_DEFECTO]: true,
  };
}

// AC-BUL-9: "+ Bulto" sobre un renglón. Si la cantidad sigue siendo la unidad
// que se puso sola (marca presente Y cantidad == 1), el primer bulto la
// reemplaza (1 -> bultoX). En cualquier otro caso suma como AC-BUL-2.
// Sin bulto válido => sin cambios.
export function sumarBultoRenglon(cantidad, bultoX, { cantidadPorDefecto = false } = {}) {
  const bx = normalizarBultoX(bultoX);
  if (bx === null) return normalizarCantidad(cantidad);
  if (cantidadPorDefecto === true && normalizarCantidad(cantidad) === CANTIDAD_INICIAL_RENGLON) return bx;
  return sumarBulto(cantidad, bx);
}

// AC-BUL-9: copia del renglón sin la marca transitoria (para guardar/sincronizar).
export function quitarMarcasRenglon(item) {
  if (!item || typeof item !== 'object') return item;
  if (!Object.prototype.hasOwnProperty.call(item, MARCA_CANTIDAD_POR_DEFECTO)) return item;
  const { [MARCA_CANTIDAD_POR_DEFECTO]: _omitida, ...resto } = item;
  return resto;
}

export function quitarMarcasRenglones(items) {
  return Array.isArray(items) ? items.map(quitarMarcasRenglon) : [];
}

// AC-BUL-3: resta 1 bulto sin bajar de `minimo` (default 0).
// S-BUL-02: cantidad legacy no entera => sin cambios.
export function restarBulto(cantidad, bultoX, { minimo = 0 } = {}) {
  const c = normalizarCantidad(cantidad);
  if (!Number.isInteger(c)) return c;
  const bx = normalizarBultoX(bultoX);
  if (bx === null) return c;
  const piso = Number.isFinite(Number(minimo)) && Number(minimo) > 0 ? Number(minimo) : 0;
  if (c <= piso) return c;
  return Math.max(piso, c - bx);
}

// AC-BUL-4: desglose con el bultoX ACTUAL del producto.
// null si no hay bulto, cantidad no entera o menos de 1 bulto.
export function desgloseBultos(cantidad, bultoX) {
  const bx = normalizarBultoX(bultoX);
  if (bx === null) return null;
  const c = normalizarCantidad(cantidad);
  if (!Number.isInteger(c) || c < bx) return null;
  const bultos = Math.floor(c / bx);
  const sueltas = c - bultos * bx;
  let texto = `${String(c)} u. = ${String(bultos)} ${bultos === 1 ? 'bulto' : 'bultos'}`;
  if (sueltas > 0) texto += ` + ${String(sueltas)} u.`;
  return { bultos, sueltas, texto };
}

// AC-BUL-1: etiqueta del botón o null si no hay bulto.
export function etiquetaBotonBulto(bultoX) {
  const bx = normalizarBultoX(bultoX);
  return bx === null ? null : `+ Bulto (x ${bx})`;
}

// AC-BUL-8: permisos por pantalla (1 admin, 2 vendedor, 3 armador).
const PERMISOS_BULTO = {
  pedido: [1, 2],
  facturacion: [1],
  armado: [1, 3],
};

export function puedeUsarBulto(permiso, pantalla) {
  const lista = Object.prototype.hasOwnProperty.call(PERMISOS_BULTO, pantalla) ? PERMISOS_BULTO[pantalla] : null;
  if (!lista) return false;
  const p = Number(permiso);
  if (!Number.isInteger(p)) return false;
  return lista.includes(p);
}
