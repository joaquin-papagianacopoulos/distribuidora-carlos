// src/domain/stockBajo.js — REQ-STB: búsqueda de productos en Stock y avisos de stock bajo.
// Funciones puras (sin React ni IndexedDB). El stock llega como Map<productoId, number>
// (suma de movimientos); acá nunca se escribe stock.
import { normalizarBultoX } from './bultos';
import { umbralStock } from './stock';

export { umbralStock };

const key = (id) => String(id);
const stockDeMapa = (stockMap, id) => {
  const v = stockMap && typeof stockMap.get === 'function' ? stockMap.get(key(id)) : undefined;
  return Number.isFinite(Number(v)) ? Number(v) : 0;
};

export const ESTADOS_STOCK = Object.freeze(['negativo', 'sin_stock', 'bajo', 'ok']);

// AC-STB-2: negativo (< 0), sin stock (= 0), bajo (<= umbral) u ok.
export const estadoStock = (producto, stock) => {
  const s = Number(stock) || 0;
  if (s < 0) return 'negativo';
  if (s === 0) return 'sin_stock';
  if (s <= umbralStock(producto)) return 'bajo';
  return 'ok';
};

const norm = (v) => String(v ?? '')
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .replace(/\s+/g, ' ')
  .trim();

// AC-STB-2: sin tildes ni mayúsculas, palabras en cualquier orden, sobre nombre/código/marca.
export const buscarProductos = (productos = [], query = '') => {
  const lista = Array.isArray(productos) ? productos : [];
  const palabras = norm(query).split(' ').filter(Boolean);
  if (!palabras.length) return lista;
  return lista.filter(p => {
    const pajar = norm(`${p?.nombre || ''} ${p?.codigo || ''} ${p?.marca || ''}`);
    return palabras.every(w => pajar.includes(w));
  });
};

/**
 * AC-STB-2: filas de la pantalla Stock con búsqueda y filtros.
 * @returns {Array<{ producto: object, stock: number, estado: string, umbral: number }>}
 */
export const filtrarStock = (productos = [], stockMap = new Map(), { query = '', rubro = '', marca = '', proveedorId = '', estado = '' } = {}) => {
  const rubroN = norm(rubro);
  const marcaN = norm(marca);
  const prov = proveedorId === null || proveedorId === undefined ? '' : String(proveedorId);
  const base = buscarProductos(productos, query).filter(p => {
    if (rubroN && norm(p.categoria) !== rubroN) return false;
    if (marcaN && norm(p.marca) !== marcaN) return false;
    if (prov && String(p.proveedorId ?? '') !== prov) return false;
    return true;
  });
  const filas = base.map(p => {
    const stock = stockDeMapa(stockMap, p.id);
    return { producto: p, stock, estado: estadoStock(p, stock), umbral: umbralStock(p) };
  });
  const e = String(estado || '');
  if (!e || e === 'todos') return filas;
  // "alerta" = todo lo que necesita reposición (bajo, sin stock y negativo): es lo que cuenta el aviso.
  if (e === 'alerta') return filas.filter(f => f.estado !== 'ok');
  return filas.filter(f => f.estado === e);
};

// AC-STB-3 (supuesto S4): el contador incluye bajo, sin stock y negativo.
export const contarStockBajo = (productos = [], stockMap = new Map()) =>
  (Array.isArray(productos) ? productos : []).reduce(
    (n, p) => n + (estadoStock(p, stockDeMapa(stockMap, p?.id)) === 'ok' ? 0 : 1), 0);

export const textoContadorStockBajo = (n) => {
  const c = Number(n) || 0;
  if (c <= 0) return 'Sin productos con stock bajo';
  return `${c} ${c === 1 ? 'producto con stock bajo' : 'productos con stock bajo'}`;
};

// Cantidad sugerida para reponer: lo que falta para llegar al umbral (mínimo 1),
// redondeada hacia arriba al múltiplo de bulto si el producto tiene bulto.
export const cantidadSugerida = (producto, stock) => {
  const falta = Math.max(umbralStock(producto) - (Number(stock) || 0), 1);
  const bx = normalizarBultoX(producto?.bultoX);
  return bx ? Math.ceil(falta / bx) * bx : falta;
};

/**
 * AC-STB-3: productos de un proveedor que necesitan reposición, con cantidad sugerida (unidades).
 * Sin proveedorId devuelve los de todos los proveedores que tengan uno asignado.
 * @returns {Array<{ productoId: string, sugerido: number }>}
 */
export const stockBajoDeProveedor = (productos = [], stockMap = new Map(), proveedorId = null) => {
  const prov = proveedorId === null || proveedorId === undefined || proveedorId === '' ? null : String(proveedorId);
  const out = [];
  for (const p of Array.isArray(productos) ? productos : []) {
    if (!p) continue;
    const pid = p.proveedorId === null || p.proveedorId === undefined ? '' : String(p.proveedorId);
    if (prov === null ? !pid : pid !== prov) continue;
    const stock = stockDeMapa(stockMap, p.id);
    if (estadoStock(p, stock) === 'ok') continue;
    out.push({ productoId: key(p.id), sugerido: cantidadSugerida(p, stock) });
  }
  return out;
};
