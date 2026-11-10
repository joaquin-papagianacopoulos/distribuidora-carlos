// src/domain/grupoBulto.js — REQ-GBU: productos combinables para llegar al bulto.
// Funciones puras (sin React ni IndexedDB). Productos distintos con el mismo
// "Grupo bulto" (ej. Prime Rojo, Prime Azul, Prime Violeta => "Prime") suman sus
// unidades para llegar al bulto y en la factura salen en una sola línea.
// item.cantidad sigue siendo SIEMPRE en unidades y por producto (stock, armado y
// comisiones no cambian).
import { normalizarBultoX, normalizarCantidad } from './bultos';
import { precioAplicadoRenglon, etiquetaEscala } from './precios';

export const MAX_GRUPO_BULTO = 40;

const sinTildes = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '');

// AC-GBU-1: texto del grupo (espacios colapsados, hasta 40). Vacío/inválido => ''.
export function normalizarGrupoBulto(v) {
  if (typeof v !== 'string' && typeof v !== 'number') return '';
  // eslint-disable-next-line no-control-regex
  return String(v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_GRUPO_BULTO).trim();
}

// Clave de comparación: sin mayúsculas, tildes ni espacios de más ("prime" = "PRIME ").
export function claveGrupoBulto(v) {
  const n = normalizarGrupoBulto(v);
  return n ? sinTildes(n).toLowerCase() : '';
}

// Bulto del renglón: el congelado del precio de bulto (REQ-PBU) o el de REQ-VTA.
const bultoDeRenglon = (it) => normalizarBultoX(it?.precioBultoX) ?? normalizarBultoX(it?.bultoX);

const activo = (it) => it && typeof it === 'object' && it.eliminado !== true;

// Clave del grupo de un renglón: mismo grupo Y mismo bulto (un "Prime x12" no se
// mezcla con un "Prime x24"). Sin grupo => null.
export function claveRenglonGrupo(it) {
  if (!activo(it)) return null;
  const g = claveGrupoBulto(it.grupoBulto);
  if (!g) return null;
  return `${g}|${bultoDeRenglon(it) ?? 0}`;
}

// Unidades por grupo (solo renglones activos).
export function totalesGrupoBulto(items) {
  const totales = new Map();
  for (const it of Array.isArray(items) ? items : []) {
    const k = claveRenglonGrupo(it);
    if (k === null) continue;
    totales.set(k, (totales.get(k) || 0) + normalizarCantidad(it.cantidad));
  }
  return totales;
}

// AC-GBU-2: re-precia los renglones agrupados con la cantidad del GRUPO: si entre
// todos llegan al bulto, todos van a precio de bulto (también lo que sobra); si
// bajan, vuelven al precio por unidad. Precio manual o renglón legacy => igual
// (lo decide precioAplicadoRenglon). Sin cambios devuelve los mismos objetos.
export function preciosPorGrupoBulto(items) {
  if (!Array.isArray(items)) return [];
  const totales = totalesGrupoBulto(items);
  if (totales.size === 0) return items;
  let cambio = false;
  const out = items.map(it => {
    const k = claveRenglonGrupo(it);
    if (k === null) return it;
    const r = precioAplicadoRenglon(it, Math.max(normalizarCantidad(it.cantidad), totales.get(k)));
    if (r !== it) cambio = true;
    return r;
  });
  return cambio ? out : items;
}

// AC-GBU-2: aviso del renglón en pantalla ("Prime: 9 de 24 para precio de bulto").
// null si el renglón no tiene grupo o el grupo no tiene bulto conocido.
export function progresoGrupoBulto(item, items) {
  const k = claveRenglonGrupo(item);
  if (k === null) return null;
  const bx = bultoDeRenglon(item);
  if (bx === null) return null;
  const total = totalesGrupoBulto(items).get(k) || 0;
  const nombre = normalizarGrupoBulto(item.grupoBulto);
  const esc = etiquetaEscala(item);
  if (total >= bx) return { nombre, total, bultoX: bx, llego: true, texto: `${nombre}: ${total} u. combinadas, precio de bulto${esc ? ` · ${esc}` : ''}` };
  return { nombre, total, bultoX: bx, llego: false, texto: `${nombre}: ${total} de ${bx} para precio de bulto` };
}

// Agrupa (para la boleta) los renglones con grupo. Solo se juntan grupos con 2 o
// más productos distintos; un producto solo queda como renglón normal.
export function gruposBultoParaBoleta(items) {
  const grupos = new Map();
  for (const it of Array.isArray(items) ? items : []) {
    const k = claveRenglonGrupo(it);
    if (k === null) continue;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(it);
  }
  for (const [k, rengs] of grupos) {
    const productos = new Set(rengs.map(i => String(i.productoId)));
    if (productos.size < 2) grupos.delete(k);
  }
  return grupos;
}

// AC-GBU-3: columnas de la línea única del grupo en la boleta, sin colores.
//   exacto:     "Prime (bulto x24)"            | "1"               | $precio del bulto
//   con sobra:  "Prime (bulto x24)"            | "1 bulto + 6 u."  | $precio c/u
//   bajo bulto: "Prime"                        | "9"               | $precio
// Si los renglones tienen precios distintos (precio manual) la columna precio va vacía.
export function lineaGrupoBulto(rengs, { peso, sufijoPrecioBulto = '' } = {}) {
  const lista = Array.isArray(rengs) ? rengs : [];
  const fmt = typeof peso === 'function' ? peso : (n) => `$${Number(n).toLocaleString('es-AR')}`;
  const nombre = normalizarGrupoBulto(lista[0]?.grupoBulto);
  const bx = bultoDeRenglon(lista[0]);
  const total = lista.reduce((s, i) => s + normalizarCantidad(i.cantidad), 0);
  const subtotal = lista.reduce((s, i) => s + Number(i.cantidad) * Number(i.precio), 0);
  const precios = new Set(lista.map(i => Math.round(Number(i.precio) * 100)));
  const precioUnit = precios.size === 1 ? Number(lista[0]?.precio) : null;
  const porBulto = lista.some(i => i.precioPorBulto === true);
  // AC-ESC-3: si todos los renglones tienen la misma escala se muestra (ASCII, va al PDF).
  const escalas = new Set(lista.map(i => (Number(i.escalaPct) > 0 ? `${i.escalaDesde}|${i.escalaPct}` : '')));
  const etiqueta = escalas.size === 1 ? etiquetaEscala(lista[0], { pdf: true }) : null;
  const marca = (porBulto ? sufijoPrecioBulto : '') + (etiqueta ? ` (${etiqueta})` : '');
  if (bx !== null && Number.isInteger(total) && total >= bx) {
    const bultos = Math.floor(total / bx);
    const sueltas = total - bultos * bx;
    const base = { nombre: `${nombre} (bulto x${bx})${marca}`, subtotal, enBultos: true, ...(porBulto ? { porBulto: true } : {}) };
    if (sueltas === 0) {
      return { ...base, cantidadTexto: String(bultos), precioTexto: precioUnit !== null ? fmt(Math.round(precioUnit * bx * 100) / 100) : '' };
    }
    return { ...base, cantidadTexto: `${bultos} ${bultos === 1 ? 'bulto' : 'bultos'} + ${sueltas} u.`, precioTexto: precioUnit !== null ? `${fmt(precioUnit)} c/u` : '' };
  }
  return { nombre: `${nombre}${marca}`, cantidadTexto: String(total), precioTexto: precioUnit !== null ? fmt(precioUnit) : '', subtotal, ...(porBulto ? { porBulto: true } : {}) };
}
