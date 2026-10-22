// src/domain/precios.js — REQ-PBU (precio por unidad llevando bulto) y REQ-HPR
// (historial de cambios de precio). Funciones puras: sin React ni IndexedDB.
//
// OJO nombres: `unidadVenta.precioBulto(precioUnit, bultoX)` es el precio del
// bulto ENTERO. El campo `producto.precioBulto` de este archivo es el precio
// POR UNIDAD cuando se lleva al menos un bulto. Por eso la función de acá se
// llama `precioAplicado`.
import { toNum, redondear2, texto, esFechaISO, nuevoId } from './validacion';
import { normalizarBultoX } from './bultos';
import { normalizarRubro } from './rubros';

const aCentavos = (v) => {
  const n = toNum(v);
  return n === null || n < 0 ? 0 : Math.round(n * 100);
};

const aPrecio = (v) => aCentavos(v) / 100;

const cantidadNum = (v) => {
  const n = typeof v === 'number' ? v : toNum(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

// AC-PBU-5: precio por unidad que corresponde a `cantidad` del producto.
// Con bultoX > 1, precioBulto > 0 y cantidad >= 1 bulto completo, TODAS las
// unidades van al menor entre precio y precioBulto (llevar más nunca cuesta más).
export function precioAplicado(producto, cantidad) {
  const p = producto && typeof producto === 'object' ? producto : {};
  const precio = aPrecio(p.precio);
  const bx = normalizarBultoX(p.bultoX);
  const pb = aPrecio(p.precioBulto);
  if (bx !== null && pb > 0 && cantidadNum(cantidad) >= bx) {
    return { precio: Math.min(precio, pb), porBulto: true };
  }
  return { precio, porBulto: false };
}

// AC-PBU-3: ¿el precio del renglón lo puso una persona (precio o descuento)?
export function esPrecioManual(item) {
  if (!item || typeof item !== 'object') return false;
  if (item.precioManual === true) return true;
  if (Number(item.descuentoPct) > 0) return true;
  const orig = item.precioOriginal;
  if (orig !== undefined && orig !== null && Number(item.precio) !== Number(orig) && item.precioPorBulto !== true) return true;
  return false;
}

// Base para los descuentos %: el precio que corresponde sin intervención manual.
export function precioBaseRenglon(item) {
  if (!item || typeof item !== 'object') return 0;
  const orig = Number(item.precioOriginal ?? item.precio ?? 0) || 0;
  const pb = Number(item.precioBultoOriginal) || 0;
  if (item.precioPorBulto === true && pb > 0) return Math.min(orig, pb);
  return orig;
}

// AC-PBU-3: re-precia un renglón al cambiar la cantidad con los precios
// CONGELADOS al crearlo. Manual o legacy (sin precioBultoOriginal) => igual.
export function precioAplicadoRenglon(item, cantidad) {
  if (!item || typeof item !== 'object') return item;
  if (esPrecioManual(item)) return item;
  if (!(Number(item.precioBultoOriginal) > 0)) return item;
  if (item.precioOriginal === undefined || item.precioOriginal === null) return item;
  const r = precioAplicado({ precio: item.precioOriginal, precioBulto: item.precioBultoOriginal, bultoX: item.precioBultoX }, cantidad);
  if (r.precio === Number(item.precio) && r.porBulto === (item.precioPorBulto === true)) return item;
  return { ...item, precio: r.precio, precioPorBulto: r.porBulto };
}

// REQ-FRB (AC-FRB-1): renglones que no congelaron el precio de bulto (pedidos web
// aceptados, faltantes destachados) lo completan desde el producto, SOLO si el
// precio unitario del renglón sigue siendo el del producto (si cambió, queda legacy).
export function completarPreciosBulto(item, producto) {
  if (!item || typeof item !== 'object' || !producto || typeof producto !== 'object') return item;
  if (Number(item.precioBultoOriginal) > 0) return item;
  if (esPrecioManual(item)) return item;
  const pb = aPrecio(producto.precioBulto);
  const bx = normalizarBultoX(producto.bultoX);
  if (!(pb > 0) || bx === null) return item;
  const base = Number(item.precioOriginal ?? item.precio);
  if (!Number.isFinite(base) || aPrecio(base) !== aPrecio(producto.precio)) return item;
  const congelado = {
    ...item,
    precioOriginal: base,
    precioBultoOriginal: pb,
    precioBultoX: bx,
  };
  return precioAplicadoRenglon(congelado, item.cantidad);
}

// REQ-FRB (AC-FRB-2/3): totales de la boleta. El precio de bulto NO cuenta como
// descuento (la base es precioBaseRenglon); el descuento manual sí.
export function totalesBoleta(items) {
  const lista = Array.isArray(items) ? items : [];
  let total = 0;
  let base = 0;
  for (const i of lista) {
    const c = Number(i?.cantidad) || 0;
    total += c * (Number(i?.precio) || 0);
    base += c * precioBaseRenglon(i);
  }
  const descuento = Math.max(0, base - total);
  const descuentoPct = base > 0 ? Math.round((descuento / base) * 100) : 0;
  return { total, totalSinDescuento: base, descuento, descuentoPct };
}

// AC-PBU-1: aviso (no bloquea) si el precio llevando bulto supera al unitario.
export function avisoPrecioBulto(precio, precioBulto) {
  const p = aCentavos(precio);
  const b = aCentavos(precioBulto);
  if (b > 0 && p > 0 && b > p) {
    return 'El precio llevando bulto es mayor que el precio por unidad: se va a cobrar el menor';
  }
  return null;
}

// ---------------------------------------------------------------------------
// REQ-HPR
// ---------------------------------------------------------------------------

// Fecha de hoy en Argentina (UTC-3 todo el año).
export const fechaArgentina = (now = new Date()) =>
  new Date(now.getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10);

const nombreUsuario = (u) => {
  if (u && typeof u === 'object') return texto(u.nombre ?? u.usuario ?? '', 80);
  return texto(u ?? '', 80);
};
const idUsuario = (u) => (u && typeof u === 'object' && u.id !== undefined && u.id !== null ? String(u.id) : null);

// AC-HPR-1: registro de cambio entre `previo` (producto guardado, o null en el
// alta) y `nuevo`. Devuelve null si ni `precio` ni `precioBulto` cambian
// (comparación en centavos).
export function cambioDePrecio(previo, nuevo, { usuario = null, now = new Date(), genId = nuevoId } = {}) {
  if (!nuevo || typeof nuevo !== 'object') return null;
  const pNuevo = aCentavos(nuevo.precio);
  const bNuevo = aCentavos(nuevo.precioBulto);
  const hayPrevio = previo && typeof previo === 'object';
  const pAnt = hayPrevio ? aCentavos(previo.precio) : null;
  const bAnt = hayPrevio ? aCentavos(previo.precioBulto) : null;
  if (hayPrevio ? (pAnt === pNuevo && bAnt === bNuevo) : (pNuevo === 0 && bNuevo === 0)) return null;
  const aMonto = (c) => (c === null ? null : c / 100);
  return {
    id: genId(),
    productoId: String(nuevo.id ?? previo?.id ?? ''),
    codigo: texto(nuevo.codigo ?? previo?.codigo ?? '', 40),
    nombre: texto(nuevo.nombre ?? previo?.nombre ?? '', 160),
    rubro: normalizarRubro(nuevo.categoria ?? previo?.categoria),
    precioAnterior: aMonto(pAnt),
    precioNuevo: pNuevo / 100,
    precioBultoAnterior: aMonto(bAnt),
    precioBultoNuevo: bNuevo / 100,
    fecha: fechaArgentina(now),
    creadoEn: now.toISOString(),
    usuarioId: idUsuario(usuario),
    usuarioNombre: nombreUsuario(usuario),
    pendingSync: true,
  };
}

const porCreado = (a, b) => {
  const ca = String(a.creadoEn || '');
  const cb = String(b.creadoEn || '');
  if (ca !== cb) return ca < cb ? -1 : 1;
  return String(a.id || '') < String(b.id || '') ? -1 : (String(a.id || '') > String(b.id || '') ? 1 : 0);
};

// AC-HPR-2: una fila por producto: primer anterior, último nuevo. Los productos
// que terminan igual que como empezaron (A -> B -> A) no aparecen.
export function resumirCambiosPrecio(cambios, { desde = null, hasta = null } = {}) {
  const lista = (Array.isArray(cambios) ? cambios : []).filter(c => {
    if (!c || typeof c !== 'object') return false;
    const f = String(c.fecha || '');
    if (desde && f < desde) return false;
    if (hasta && f > hasta) return false;
    return true;
  });
  const grupos = new Map();
  for (const c of lista) {
    const k = String(c.productoId);
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(c);
  }
  const filas = [];
  for (const [productoId, arr] of grupos) {
    arr.sort(porCreado);
    const primero = arr[0];
    const ultimo = arr[arr.length - 1];
    const ant = primero.precioAnterior ?? null;
    const antB = primero.precioBultoAnterior ?? null;
    const nue = Number(ultimo.precioNuevo) || 0;
    const nueB = Number(ultimo.precioBultoNuevo) || 0;
    if (ant !== null && aCentavos(ant) === aCentavos(nue) && aCentavos(antB) === aCentavos(nueB)) continue;
    const variacionPct = ant === null || !(Number(ant) > 0) ? null : redondear2(((nue - Number(ant)) / Number(ant)) * 100);
    filas.push({
      productoId,
      codigo: ultimo.codigo || '',
      nombre: ultimo.nombre || '',
      rubro: ultimo.rubro || '',
      precioAnterior: ant,
      precioNuevo: nue,
      precioBultoAnterior: antB,
      precioBultoNuevo: nueB,
      variacionPct,
    });
  }
  const cmp = (a, b) => String(a).localeCompare(String(b), 'es', { sensitivity: 'base' });
  filas.sort((a, b) => cmp(a.rubro, b.rubro) || cmp(a.nombre, b.nombre) || cmp(a.codigo, b.codigo));
  return filas;
}

// AC-HPR-3: "solo precio nuevo" (lista para pasar a clientes/vendedores).
export function filasPdfSoloPrecioNuevo(filas, productosById) {
  return (Array.isArray(filas) ? filas : []).map(f => {
    const prod = productosById instanceof Map ? productosById.get(String(f.productoId)) : null;
    return {
      codigo: prod?.codigo || f.codigo || '',
      nombre: prod?.nombre || f.nombre || '',
      precio: Number(f.precioNuevo) || 0,
      precioBulto: Number(f.precioBultoNuevo) > 0 ? Number(f.precioBultoNuevo) : null,
    };
  });
}

export const cambioPrecioToRemote = (c = {}) => ({
  id: c.id,
  producto_id: String(c.productoId ?? ''),
  codigo: c.codigo ?? '',
  nombre: c.nombre ?? '',
  rubro: c.rubro ?? '',
  precio_anterior: c.precioAnterior ?? null,
  precio_nuevo: Number(c.precioNuevo) || 0,
  precio_bulto_anterior: c.precioBultoAnterior ?? null,
  precio_bulto_nuevo: Number(c.precioBultoNuevo) || 0,
  fecha: c.fecha,
  creado_en: c.creadoEn,
  usuario_id: c.usuarioId ?? null,
  usuario_nombre: c.usuarioNombre ?? '',
});

const numOrNull = (v) => (v === null || v === undefined ? null : Number(v));

export const cambioPrecioFromRemote = (r = {}) => ({
  id: r.id,
  productoId: String(r.producto_id ?? ''),
  codigo: r.codigo ?? '',
  nombre: r.nombre ?? '',
  rubro: r.rubro ?? '',
  precioAnterior: numOrNull(r.precio_anterior),
  precioNuevo: Number(r.precio_nuevo) || 0,
  precioBultoAnterior: numOrNull(r.precio_bulto_anterior),
  precioBultoNuevo: Number(r.precio_bulto_nuevo) || 0,
  fecha: esFechaISO(r.fecha) ? r.fecha : String(r.fecha || '').slice(0, 10),
  creadoEn: r.creado_en ?? '',
  usuarioId: r.usuario_id ?? null,
  usuarioNombre: r.usuario_nombre ?? '',
  pendingSync: false,
});

// AC-HPR-1: interpreta la respuesta de admin_registrar_cambios_precio (migracion 010).
// Solo los ids aceptados se limpian del pendiente local.
export const MENSAJES_CAMBIOS_PRECIO = Object.freeze({
  no_autorizado: 'PIN incorrecto o tu usuario no esta autorizado como admin en el servidor.',
  falta_migracion: 'Falta aplicar la migracion 010 en Supabase: los cambios de precio quedan pendientes.',
  lote_invalido: 'El servidor rechazo el lote de cambios de precio.',
  respuesta_invalida: 'El servidor respondio algo inesperado: los cambios de precio siguen pendientes.',
  error: 'No se pudieron subir los cambios de precio.',
});

const esFuncionInexistente = (e) =>
  ['PGRST202', '42883'].includes(String(e?.code)) || /could not find the function/i.test(String(e?.message || ''));

export function interpretarRegistrarCambiosPrecio({ data, error } = {}) {
  const falla = (motivo) => ({ ok: false, motivo, mensaje: MENSAJES_CAMBIOS_PRECIO[motivo], aceptados: [], rechazados: [] });
  if (error) return falla(esFuncionInexistente(error) ? 'falta_migracion' : 'error');
  if (!data || typeof data !== 'object') return falla('respuesta_invalida');
  if (data.ok === false) return falla(data.motivo === 'no_autorizado' || data.motivo === 'lote_invalido' ? data.motivo : 'error');
  if (data.ok !== true || !Array.isArray(data.aceptados) || !Array.isArray(data.rechazados)) return falla('respuesta_invalida');
  return {
    ok: true,
    motivo: null,
    mensaje: null,
    aceptados: data.aceptados.filter(x => typeof x === 'string'),
    rechazados: data.rechazados
      .filter(r => r && typeof r === 'object')
      .map(r => ({ id: r.id, motivo: typeof r.motivo === 'string' ? r.motivo : 'datos_invalidos' })),
  };
}
