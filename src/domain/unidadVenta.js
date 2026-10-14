// src/domain/unidadVenta.js — REQ-VTA (AC-VTA-2/3/4): unidad de venta del producto.
// Funciones puras. El precio del producto es SIEMPRE por unidad; item.cantidad
// del renglón es SIEMPRE en unidades (stock, armado, PDF y comisiones no cambian).
import { normalizarBultoX, normalizarCantidad } from './bultos';
import { MAX_CANTIDAD } from './stock';

export const VENTA_POR = Object.freeze(['unidad', 'bulto', 'ambos']);
export const BULTO_NOMBRES = Object.freeze(['Bulto', 'Display', 'Caja', 'Pack']);
export const MSG_BULTO_SIN_BULTOX = 'Para vender por bulto, "Bulto x" tiene que ser mayor que 1';

const sinTildes = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '');
const clave = (v) => (typeof v === 'string' ? sinTildes(v).trim().toLowerCase() : '');

// Default: 'ambos' si hay bulto usable (entero > 1), si no 'unidad'.
export function ventaPorPorDefecto(bultoX) {
  return normalizarBultoX(bultoX) !== null ? 'ambos' : 'unidad';
}

// Valor de ventaPor válido (acepta mayúsculas/tildes) o null.
export function normalizarVentaPor(v) {
  const k = clave(v);
  return VENTA_POR.includes(k) ? k : null;
}

// Valor efectivo del producto: el guardado si es válido y consistente;
// 'bulto' sin bultoX > 1 (dato de otro dispositivo) degrada a 'unidad'.
export function ventaPorEfectivo(producto) {
  const p = producto && typeof producto === 'object' ? producto : {};
  const guardado = normalizarVentaPor(p.ventaPor);
  if (guardado === null) return ventaPorPorDefecto(p.bultoX);
  if (guardado === 'bulto' && normalizarBultoX(p.bultoX) === null) return 'unidad';
  return guardado;
}

export function normalizarBultoNombre(v) {
  const k = clave(v);
  const hallado = BULTO_NOMBRES.find(n => n.toLowerCase() === k);
  return hallado || 'Bulto';
}

// Si/Sí/true/1/x => true; No/false/0 => false; vacío u otro => null.
export function parsearBooleano(v) {
  if (v === true) return true;
  if (v === false) return false;
  if (typeof v === 'number') return v === 1 ? true : (v === 0 ? false : null);
  const k = clave(v);
  if (['si', 'true', '1', 'x', 'verdadero', 'yes'].includes(k)) return true;
  if (['no', 'false', '0', 'falso'].includes(k)) return false;
  return null;
}

// AC-VTA-1: valida la combinación. `valor` trae los campos normalizados.
export function validarUnidadVenta({ ventaPor, bultoX, bultoNombre, visibleTienda } = {}) {
  const errores = {};
  const vacio = ventaPor === undefined || ventaPor === null || (typeof ventaPor === 'string' && ventaPor.trim() === '');
  let vp = vacio ? ventaPorPorDefecto(bultoX) : normalizarVentaPor(ventaPor);
  if (vp === null) {
    errores.ventaPor = 'Se vende por: elegí unidad, bulto o ambos';
    vp = ventaPorPorDefecto(bultoX);
  } else if (vp === 'bulto' && normalizarBultoX(bultoX) === null) {
    errores.ventaPor = MSG_BULTO_SIN_BULTOX;
  }
  const vt = parsearBooleano(visibleTienda);
  return {
    ok: Object.keys(errores).length === 0,
    errores,
    valor: { ventaPor: vp, bultoNombre: normalizarBultoNombre(bultoNombre), visibleTienda: vt === null ? true : vt },
  };
}

const entero = (v) => {
  if (typeof v === 'number') return Number.isInteger(v) ? v : null;
  if (typeof v === 'string' && /^\d+$/.test(v.trim())) return Number(v.trim());
  return null;
};

// bultos * bultoX en unidades; null si inválido o supera MAX_CANTIDAD.
export function unidadesDeBultos(bultos, bultoX) {
  const b = entero(bultos);
  const bx = normalizarBultoX(bultoX);
  if (b === null || b < 1 || bx === null) return null;
  const u = b * bx;
  return u > MAX_CANTIDAD ? null : u;
}

export function bultosDeUnidades(unidades, bultoX) {
  const u = entero(unidades);
  const bx = normalizarBultoX(bultoX);
  if (u === null || u < 0 || bx === null) return null;
  const bultos = Math.floor(u / bx);
  return { bultos, sueltas: u - bultos * bx };
}

const aCentavos = (p) => {
  const n = typeof p === 'string' ? Number(p.trim().replace(',', '.')) : p;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
};

// Precio del bulto = precio unitario × bultoX (aritmética en centavos).
export function precioBulto(precioUnit, bultoX) {
  const c = aCentavos(precioUnit);
  const bx = normalizarBultoX(bultoX);
  if (c === null || bx === null) return null;
  return (c * bx) / 100;
}

export function importeBultos(bultos, bultoX, precioUnit) {
  const unidades = unidadesDeBultos(bultos, bultoX);
  const c = aCentavos(precioUnit);
  if (unidades === null || c === null) return null;
  return { unidades, importe: (c * unidades) / 100 };
}

export function esMultiploDeBulto(cantidad, bultoX) {
  const bx = normalizarBultoX(bultoX);
  const c = normalizarCantidad(cantidad);
  if (bx === null || !Number.isInteger(c) || c < 1) return false;
  return c % bx === 0;
}

// Cantidad con la que arranca un renglón nuevo: 1 bulto si es "solo bulto".
export function cantidadInicialRenglon(producto) {
  if (ventaPorEfectivo(producto) === 'bulto') return normalizarBultoX(producto && producto.bultoX) || 1;
  return 1;
}

// Paso de los botones +/− del renglón.
export function pasoCantidad(producto) {
  return cantidadInicialRenglon(producto);
}

export function avisoMultiplo(cantidad, producto) {
  if (ventaPorEfectivo(producto) !== 'bulto') return null;
  const bx = normalizarBultoX(producto.bultoX);
  const c = normalizarCantidad(cantidad);
  if (bx === null || c < 1 || esMultiploDeBulto(c, bx)) return null;
  return `Se vende por ${normalizarBultoNombre(producto.bultoNombre)} de ${bx}: ${c} u. no es múltiplo`;
}

// Solo el admin, en Facturación, puede guardar cantidades no múltiplo.
export function puedeGuardarNoMultiplo(permiso, pantalla) {
  return Number(permiso) === 1 && pantalla === 'facturacion';
}

const claveItem = (it) => (it && it.productoId !== undefined && it.productoId !== null ? String(it.productoId) : null);

const mapaPrevios = (previos) => {
  const m = new Map();
  for (const p of Array.isArray(previos) ? previos : []) {
    const k = claveItem(p);
    if (k !== null) m.set(k, p);
  }
  return m;
};

// Renglones de productos "solo bulto" con cantidad no múltiplo. Los que no
// cambiaron respecto de `previos` se saltean (pedidos viejos no se bloquean).
export function validarMultiplosItems(items, productosById, { permiso, pantalla, previos } = {}) {
  const antes = mapaPrevios(previos);
  const avisos = [];
  for (const it of Array.isArray(items) ? items : []) {
    const k = claveItem(it);
    if (k === null) continue;
    if (antes.has(k) && Object.is(antes.get(k).cantidad, it.cantidad)) continue;
    const prod = productosById instanceof Map ? productosById.get(k) : null;
    if (!prod) continue;
    if (avisoMultiplo(it.cantidad, prod)) {
      avisos.push({ productoId: it.productoId, nombre: String(it.nombre ?? prod.nombre ?? ''), cantidad: it.cantidad, bultoX: normalizarBultoX(prod.bultoX) });
    }
  }
  return { ok: avisos.length === 0, avisos, bloquea: avisos.length > 0 && !puedeGuardarNoMultiplo(permiso, pantalla) };
}

const sinCongelado = (item) => {
  const { bultos: _b, bultoX: _x, bultoNombre: _n, ...resto } = item;
  return resto;
};

// Congela bultos/bultoX/bultoNombre en el renglón (para "3 Display (48 u.)").
// Nunca toca `cantidad`.
export function congelarBultosRenglon(item, producto, previo) {
  if (!item || typeof item !== 'object') return item;
  const base = sinCongelado(item);
  if (previo && typeof previo === 'object' && Object.is(previo.cantidad, item.cantidad)) {
    for (const c of ['bultos', 'bultoX', 'bultoNombre']) if (previo[c] !== undefined) base[c] = previo[c];
    return base;
  }
  if (!producto || ventaPorEfectivo(producto) === 'unidad') return base;
  const bx = normalizarBultoX(producto.bultoX);
  const c = normalizarCantidad(item.cantidad);
  if (bx === null || !esMultiploDeBulto(c, bx)) return base;
  return { ...base, bultos: c / bx, bultoX: bx, bultoNombre: normalizarBultoNombre(producto.bultoNombre) };
}

export function congelarBultosItems(items, productosById, { previos } = {}) {
  const antes = mapaPrevios(previos);
  return (Array.isArray(items) ? items : []).map(it => {
    const k = claveItem(it);
    const prod = k !== null && productosById instanceof Map ? productosById.get(k) : null;
    return congelarBultosRenglon(it, prod, k !== null ? antes.get(k) : undefined);
  });
}

// "3 Display (48 u.)" solo con campos congelados; si no, null (se muestra como hoy).
export function textoRenglonBultos(item) {
  if (!item || typeof item !== 'object') return null;
  const b = entero(item.bultos);
  const bx = normalizarBultoX(item.bultoX);
  if (b === null || b < 1 || bx === null) return null;
  return `${b} ${normalizarBultoNombre(item.bultoNombre)} (${b * bx} u.)`;
}
