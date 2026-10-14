// src/domain/bultos.js — lógica pura del botón "Bulto" (REQ-BUL).
// Sin React ni IndexedDB. Las pantallas solo invocan estas funciones; el único
// dato persistido sigue siendo item.cantidad (el stock lo reconcilia el ledger).

import { toInt } from './validacion';
import { MAX_CANTIDAD } from './stock';
import { rubroDeProducto } from './rubros';
import { cantidadInicialRenglon } from './unidadVenta';

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
// AC-COMR-5: guarda el rubro normalizado del producto EN ESE MOMENTO (solo si
// tiene uno: un producto sin rubro deja el renglón igual que antes). Cambiar
// después el rubro del producto no toca los renglones ya guardados.
export function renglonNuevo(producto, extra = {}) {
  const p = producto && typeof producto === 'object' ? producto : {};
  const rubro = rubroDeProducto(p);
  return {
    productoId: p.id,
    nombre: p.nombre,
    precio: p.precio,
    precioOriginal: p.precio,
    // AC-VTA-3: "solo bulto" arranca en 1 bulto; el resto, en 1 unidad (AC-BUL-9).
    cantidad: cantidadInicialRenglon(p),
    ...(rubro ? { rubro } : {}),
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
// AC-VTA-3: con `nombre` (Display, Caja, Pack) la etiqueta lo usa; default 'Bulto'.
export function etiquetaBotonBulto(bultoX, nombre = 'Bulto') {
  const bx = normalizarBultoX(bultoX);
  const n = typeof nombre === 'string' && nombre.trim() ? nombre.trim() : 'Bulto';
  return bx === null ? null : `+ ${n} (x ${bx})`;
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

// ---------------------------------------------------------------------------
// C3 (RUN 20261012-2106) — S-BUL-06: tope MAX_CANTIDAD en cantidades tipeadas
// (AC-BUL-6/7, AC-STK-8, AC-SEC-2). Una cantidad mayor que MAX_CANTIDAD genera
// un movimiento que el servidor rechaza (abs(cantidad) <= 1000000) y queda
// pendiente para siempre: se frena acá, antes de guardar.
// ---------------------------------------------------------------------------

// Texto tipeado -> entero en [1, MAX_CANTIDAD] o null (vacío, 0, negativo,
// decimal, NaN, > MAX_CANTIDAD). Acepta separador de miles con punto
// ("1.000" -> 1000) y espacios; una coma o un punto decimal ("2,5") => null.
export function cantidadTipeada(texto) {
  let n;
  if (typeof texto === 'number') n = texto;
  else if (typeof texto === 'string') {
    const s = texto.trim().replace(/\s+/g, '');
    if (!s) return null;
    let digitos;
    if (/^\d+$/.test(s)) digitos = s;
    // BUG-BUL-01: el primer grupo no puede empezar con 0 ("0.500" es un decimal, no 500).
    else if (/^[1-9]\d{0,2}(\.\d{3})+$/.test(s)) digitos = s.replace(/\./g, '');
    else return null;
    if (digitos.length > 16) return null;
    n = Number(digitos);
  } else return null;
  if (!Number.isInteger(n) || n < 1 || n > MAX_CANTIDAD) return null;
  return n;
}

// Suma de dos renglones del mismo producto (fusión en Armado): entero o null
// si alguna parte no es un entero >= 0 o la suma supera MAX_CANTIDAD.
export function sumarCantidades(a, b) {
  const parte = (v) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null);
  const x = parte(a);
  const y = parte(b);
  if (x === null || y === null) return null;
  const s = x + y;
  return s > MAX_CANTIDAD ? null : s;
}

const cantidadValidaParaGuardar = (c) => typeof c === 'number' && Number.isInteger(c) && c > 0 && c <= MAX_CANTIDAD;

// Validación del pedido entero antes de guardar (defensa en profundidad).
// ok:false si algún item tiene cantidad no entera, <= 0 o > MAX_CANTIDAD.
// R10 / S-BUL-02: con { previos } (los items del pedido antes de editar), un
// item cuyo productoId y cantidad no cambiaron NO se valida: una cantidad
// legacy (decimal) no bloquea editar otra cosa del pedido.
export function validarCantidadesItems(items, { previos } = {}) {
  const lista = Array.isArray(items) ? items : [];
  const antes = new Map();
  for (const p of Array.isArray(previos) ? previos : []) {
    if (p && typeof p === 'object' && p.productoId !== undefined && p.productoId !== null) antes.set(String(p.productoId), p.cantidad);
  }
  const errores = [];
  for (const it of lista) {
    if (!it || typeof it !== 'object') {
      errores.push({ productoId: null, nombre: '', cantidad: null });
      continue;
    }
    const clave = it.productoId === undefined || it.productoId === null ? null : String(it.productoId);
    if (clave !== null && antes.has(clave) && Object.is(antes.get(clave), it.cantidad)) continue;
    if (!cantidadValidaParaGuardar(it.cantidad)) {
      errores.push({ productoId: it.productoId ?? null, nombre: String(it.nombre ?? ''), cantidad: it.cantidad ?? null });
    }
  }
  return { ok: errores.length === 0, errores };
}

// Mensaje para el alert de las pantallas (texto único).
export function mensajeCantidadesInvalidas(errores) {
  const nombres = (Array.isArray(errores) ? errores : []).map(e => String(e?.nombre || e?.productoId || '?')).filter(Boolean);
  const maximo = String(MAX_CANTIDAD).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `Cantidad inválida en: ${nombres.join(', ')} (máximo ${maximo})`;
}

// ---------------------------------------------------------------------------
// C4 (RUN 20261012-2106) — S-BUL-08: el producto del botón Bulto y del
// desglose se resuelve SOLO por id (String). Sin match => null (el botón no
// aparece, igual que con bultoX <= 1). Nunca por nombre: un homónimo podría
// traer otro bultoX (AC-BUL-1, AC-BUL-4).
// ---------------------------------------------------------------------------
export function productoParaBulto(item, productosById) {
  if (!item || typeof item !== 'object') return null;
  if (!(productosById instanceof Map)) return null;
  if (item.productoId === undefined || item.productoId === null || item.productoId === '') return null;
  return productosById.get(String(item.productoId)) || null;
}
