// src/domain/casilleros.js — REQ-CBU: casilleros "Bultos" y "Unidades sueltas" del renglón.
// Funciones puras. La cantidad guardada sigue siendo item.cantidad en unidades.
import { normalizarBultoX, normalizarCantidad, sumarBultoRenglon, restarBulto, renglonNuevo, partirBultos, MARCA_CANTIDAD_POR_DEFECTO, quitarMarcasRenglon } from './bultos';
import { cantidadConPasoMinimo, pasoMinimo, minimoEfectivo } from './minimos';
import { MAX_CANTIDAD } from './stock';
import { ventaPorEfectivo } from './unidadVenta';
import { precioAplicadoRenglon } from './precios';

const pesos = (n) => `$${Number(n).toLocaleString('es-AR', { maximumFractionDigits: 2 })}`;
const redondear = (n) => Math.round(Number(n) * 100) / 100;

// AC-CBU-2: +/− del casillero. cantidad guardada = bultos × bultoX + sueltas.
// 'bultos' opera SOLO sobre los bultos (el primer bulto reemplaza la unidad que se puso sola, AC-BUL-9; no suma
// el mínimo; con 0 bultos el − no hace nada). 'sueltas' opera SOLO sobre c % bultoX, con el paso de AC-MUL-1
// (con 0 sueltas el − no hace nada; no rompe un bulto). Sin bulto, 'sueltas' es el total.
export function cambiarCasillero(cantidad, producto, casillero, op = 'sumar', { cantidadPorDefecto = false } = {}) {
  const c = normalizarCantidad(cantidad);
  if (casillero === 'bultos') {
    const bx = normalizarBultoX(producto && producto.bultoX);
    if (bx === null) return c;
    return op === 'sumar' ? sumarBultoRenglon(c, bx, { cantidadPorDefecto }) : restarBulto(c, bx, { minimo: 0 });
  }
  const bx = normalizarBultoX(producto && producto.bultoX);
  const partes = bx === null ? null : partirBultos(c, bx);
  if (!partes) return cantidadConPasoMinimo(c, producto, op);
  // "Solo bulto": no hay sueltas; el +/− de unidades sigue de a bulto (AC-VTA-3).
  if (ventaPorEfectivo(producto) === 'bulto') return cantidadConPasoMinimo(c, producto, op);
  const m = pasoMinimo(producto);
  const { bultos, sueltas } = partes;
  if (op === 'sumar') {
    let s = m > 1 ? (Math.floor(sueltas / m) + 1) * m : sueltas + 1;
    if (s >= bx) s = bx; // completa el bulto
    const total = bultos * bx + s;
    return total > MAX_CANTIDAD ? c : total;
  }
  if (sueltas === 0) return c;
  const s = m > 1 ? (sueltas % m === 0 ? sueltas - m : Math.floor(sueltas / m) * m) : sueltas - 1;
  const total = bultos * bx + Math.max(0, s);
  return Math.max(total, bultos === 0 ? minimoEfectivo(producto) : 0);
}

// AC-CBU-1: textos de los dos botones de la lista de productos.
export function botonesProductoLista(producto) {
  const p = producto && typeof producto === 'object' ? producto : {};
  const unidad = { texto: `Unidad ${pesos(Number(p.precio) || 0)}`, precio: Number(p.precio) || 0 };
  const bx = normalizarBultoX(p.bultoX);
  if (bx === null) return { unidad, bulto: null };
  const porUnidad = Number(p.precioBulto) > 0 ? Number(p.precioBulto) : (Number(p.precio) || 0);
  const precio = redondear(porUnidad * bx);
  return { unidad, bulto: { texto: `Bulto x${bx} ${pesos(precio)}`, precio, bultoX: bx } };
}

// AC-CBU-1: tocar "Bulto" agrega 1 bulto (renglón nuevo = 1 bulto, sin marca de cantidad por defecto).
export function agregarBultoDesdeLista(items, producto) {
  const lista = Array.isArray(items) ? items : [];
  const bx = normalizarBultoX(producto && producto.bultoX);
  if (!producto || bx === null) return lista;
  if (lista.some(i => i.productoId === producto.id)) {
    return lista.map(i => {
      if (i.productoId !== producto.id) return i;
      const cant = sumarBultoRenglon(i.cantidad, bx, { cantidadPorDefecto: i[MARCA_CANTIDAD_POR_DEFECTO] === true });
      return cant === i.cantidad ? i : precioAplicadoRenglon(quitarMarcasRenglon({ ...i, cantidad: cant }), cant);
    });
  }
  const { [MARCA_CANTIDAD_POR_DEFECTO]: _m, ...sinMarca } = renglonNuevo(producto);
  return [precioAplicadoRenglon({ ...sinMarca, cantidad: bx }, bx), ...lista];
}

// AC-CBU-3: precio que se está aplicando en el renglón.
export function precioVigenteRenglon(item) {
  const precio = Number(item && item.precio) || 0;
  return item && item.precioPorBulto === true
    ? { tipo: 'bulto', precio, texto: `Precio bulto ${pesos(precio)} c/u` }
    : { tipo: 'unidad', precio, texto: `Precio unidad ${pesos(precio)}` };
}
