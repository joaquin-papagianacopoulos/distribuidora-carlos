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

// ---------------------------------------------------------------------------
// REQ-ESC: descuento por escala de bultos (hasta 3 escalas "desde N bultos, D %").
// ---------------------------------------------------------------------------
export const MAX_ESCALAS_BULTO = 3;
const MAX_ESCALAS_LEIDAS = 10;
const MAX_DESDE_ESCALA = 9999;

const esDecimal2 = (n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-7;

// AC-ESC-4: escalas válidas y crecientes; lo inválido o desordenado se ignora de a uno, nunca tira.
export function normalizarEscalasBulto(raw) {
  let arr = raw;
  if (typeof arr === 'string') {
    try { arr = JSON.parse(arr); } catch (e) { return []; }
  }
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const e of arr.slice(0, MAX_ESCALAS_LEIDAS)) {
    if (!e || typeof e !== 'object') continue;
    const d = e.desde;
    const p = e.pct;
    if (typeof d !== 'number' || !Number.isInteger(d) || d < 2 || d > MAX_DESDE_ESCALA) continue;
    if (typeof p !== 'number' || !Number.isFinite(p) || !(p > 0) || !(p < 100) || !esDecimal2(p)) continue;
    if (out.length > 0 && d <= out[out.length - 1].desde) continue;
    out.push({ desde: d, pct: Math.round(p * 100) / 100 });
    if (out.length >= MAX_ESCALAS_BULTO) break;
  }
  return out;
}

// Escala más alta alcanzada con `unidades` (solo bultos completos). null si no hay.
export function escalaAlcanzada(escalas, bultoX, unidades) {
  const bx = normalizarBultoX(bultoX);
  if (bx === null) return null;
  const bultos = Math.floor(cantidadNum(unidades) / bx);
  let res = null;
  for (const e of normalizarEscalasBulto(escalas)) {
    if (bultos >= e.desde && (res === null || e.desde > res.desde)) res = e;
  }
  return res;
}

// Precio * (1 - pct/100) redondeado para arriba al peso entero, en aritmética entera.
export function aplicarDescuentoEscala(precio, pct) {
  const n = Number(precio);
  const c = BigInt(Number.isFinite(n) ? Math.max(0, Math.round(n * 100)) : 0);
  const bp = BigInt(Math.max(0, Math.min(10000, Math.round((Number(pct) || 0) * 100))));
  const num = c * (10000n - bp);
  return Number((num + 999999n) / 1000000n);
}

// Regla REQ-PBU sin escalas (AC-PBU-5).
function precioBasePBU(p, cantidad) {
  const precio = aPrecio(p.precio);
  const bx = normalizarBultoX(p.bultoX);
  const pb = aPrecio(p.precioBulto);
  if (bx !== null && pb > 0 && cantidadNum(cantidad) >= bx) {
    return { precio: Math.min(precio, pb), porBulto: true };
  }
  return { precio, porBulto: false };
}

// AC-ESC-2/4: precio por unidad con la escala aplicada. `escala` solo aparece si se aplicó.
export function precioConEscala(producto, cantidad) {
  const p = producto && typeof producto === 'object' ? producto : {};
  const base = precioBasePBU(p, cantidad);
  const esc = escalaAlcanzada(p.escalasBulto, p.bultoX, cantidad);
  if (!esc) return base;
  const con = aplicarDescuentoEscala(base.precio, esc.pct);
  if (!(con < base.precio)) return base;
  const bx = normalizarBultoX(p.bultoX);
  return { ...base, precio: con, escala: { desde: esc.desde, pct: esc.pct, bultos: Math.floor(cantidadNum(cantidad) / bx) } };
}

// AC-PBU-5 + AC-ESC-2: precio por unidad que corresponde a `cantidad` del producto.
// Con bultoX > 1, precioBulto > 0 y cantidad >= 1 bulto completo, TODAS las
// unidades van al menor entre precio y precioBulto; encima, la escala alcanzada.
export function precioAplicado(producto, cantidad) {
  return precioConEscala(producto, cantidad);
}

// Piso posible del renglón: base de bulto con la escala de mayor descuento.
export function precioMinimoRenglon(ref) {
  const r = ref && typeof ref === 'object' ? ref : {};
  const precio = aPrecio(r.precioOriginal ?? r.precio);
  const pb = aPrecio(r.precioBultoOriginal ?? r.precioBulto);
  const bx = normalizarBultoX(r.precioBultoX ?? r.bultoX);
  let piso = pb > 0 && bx !== null ? Math.min(precio, pb) : precio;
  if (bx !== null) {
    const base = piso;
    for (const e of normalizarEscalasBulto(r.escalasBulto)) {
      const v = aplicarDescuentoEscala(base, e.pct);
      if (v < piso) piso = v;
    }
  }
  return piso;
}

// Etiqueta "x5 bultos −8 %" (pantalla con signo menos real; PDF con guion ASCII).
export function etiquetaEscala(item, { pdf = false } = {}) {
  if (!item || typeof item !== 'object') return null;
  const d = Number(item.escalaDesde);
  const p = Number(item.escalaPct);
  if (!(d >= 2) || !(p > 0)) return null;
  const pct = String(p).replace('.', ',');
  return `x${d} bultos ${pdf ? '-' : '−'}${pct} %`;
}

// Base PBU del renglón (sin escala), con los precios congelados.
function basePbuRenglon(item) {
  const orig = Number(item.precioOriginal ?? item.precio ?? 0) || 0;
  const pb = Number(item.precioBultoOriginal) || 0;
  if (item.precioPorBulto === true && pb > 0) return Math.min(orig, pb);
  return orig;
}

const hayEscalaRenglon = (item) => Number(item.escalaPct) > 0;

// AC-PBU-3: ¿el precio del renglón lo puso una persona (precio o descuento)?
// AC-ESC-2: el precio que sale de la escala congelada no es manual.
export function esPrecioManual(item) {
  if (!item || typeof item !== 'object') return false;
  if (item.precioManual === true) return true;
  if (Number(item.descuentoPct) > 0) return true;
  const orig = item.precioOriginal;
  if (orig !== undefined && orig !== null && Number(item.precio) !== Number(orig) && item.precioPorBulto !== true) {
    if (hayEscalaRenglon(item) && Number(item.precio) === aplicarDescuentoEscala(basePbuRenglon(item), item.escalaPct)) return false;
    return true;
  }
  return false;
}

// Base para los descuentos %: el precio que corresponde sin intervención manual.
// La escala no cuenta como descuento (igual que el precio de bulto).
export function precioBaseRenglon(item) {
  if (!item || typeof item !== 'object') return 0;
  const base = basePbuRenglon(item);
  if (hayEscalaRenglon(item)) return aplicarDescuentoEscala(base, item.escalaPct);
  return base;
}

// AC-PBU-3 + AC-ESC-2: re-precia un renglón al cambiar la cantidad con los precios
// y escalas CONGELADOS al crearlo. Manual o legacy => igual. escalaDesde/escalaPct
// se recalculan siempre acá (nunca se confía en lo que traiga el renglón).
export function precioAplicadoRenglon(item, cantidad) {
  if (!item || typeof item !== 'object') return item;
  if (esPrecioManual(item)) return item;
  const escalas = normalizarEscalasBulto(item.escalasBulto);
  const hayPb = Number(item.precioBultoOriginal) > 0;
  if (!hayPb && escalas.length === 0) return item;
  if (item.precioOriginal === undefined || item.precioOriginal === null) return item;
  const r = precioConEscala({ precio: item.precioOriginal, precioBulto: item.precioBultoOriginal, bultoX: item.precioBultoX, escalasBulto: escalas }, cantidad);
  const desde = r.escala ? r.escala.desde : undefined;
  const pct = r.escala ? r.escala.pct : undefined;
  const mismoPb = !hayPb || r.porBulto === (item.precioPorBulto === true);
  if (r.precio === Number(item.precio) && mismoPb && item.escalaDesde === desde && item.escalaPct === pct) return item;
  const { escalaDesde: _d, escalaPct: _p, ...resto } = item;
  return { ...resto, precio: r.precio, ...(hayPb ? { precioPorBulto: r.porBulto } : {}), ...(r.escala ? { escalaDesde: desde, escalaPct: pct } : {}) };
}

// REQ-FRB (AC-FRB-1): renglones que no congelaron el precio de bulto (pedidos web
// aceptados, faltantes destachados) lo completan desde el producto, SOLO si el
// precio unitario del renglón sigue siendo el del producto (si cambió, queda legacy).
// REQ-ESC: congela también las escalas del producto.
export function completarPreciosBulto(item, producto) {
  if (!item || typeof item !== 'object' || !producto || typeof producto !== 'object') return item;
  if (Number(item.precioBultoOriginal) > 0) return item;
  if (normalizarEscalasBulto(item.escalasBulto).length > 0) return item;
  if (esPrecioManual(item)) return item;
  const pb = aPrecio(producto.precioBulto);
  const bx = normalizarBultoX(producto.bultoX);
  const escalas = bx === null ? [] : normalizarEscalasBulto(producto.escalasBulto);
  if (bx === null || (!(pb > 0) && escalas.length === 0)) return item;
  const base = Number(item.precioOriginal ?? item.precio);
  if (!Number.isFinite(base) || aPrecio(base) !== aPrecio(producto.precio)) return item;
  const congelado = {
    ...item,
    precioOriginal: base,
    precioBultoX: bx,
    ...(pb > 0 ? { precioBultoOriginal: pb } : {}),
    ...(escalas.length > 0 ? { escalasBulto: escalas } : {}),
  };
  return precioAplicadoRenglon(congelado, item.cantidad);
}

// REQ-FRB (AC-FRB-2/3): totales de la boleta. El precio de bulto y la escala NO cuentan como
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

// ---------------------------------------------------------------------------
// REQ-ESC (AC-ESC-1): validación estricta (formulario e importación) y texto.
// ---------------------------------------------------------------------------
const numTipeado = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const s = v.trim().replace(/\s*%$/, '').replace(',', '.');
  if (s === '' || !/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const vacioTipeado = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

// filas: [{desde, pct}] con texto o número. Devuelve { valor, errores, avisos }.
export function validarEscalasBulto(filas, bultoX) {
  const errores = [];
  const avisos = [];
  const lista = Array.isArray(filas) ? filas : [];
  const valor = [];
  const usadas = lista.filter(f => f && typeof f === 'object' && !(vacioTipeado(f.desde) && vacioTipeado(f.pct)));
  if (usadas.length === 0) return { valor, errores, avisos };
  if (normalizarBultoX(bultoX) === null) errores.push('Las escalas necesitan Bulto x mayor a 1');
  if (usadas.length > MAX_ESCALAS_BULTO) errores.push(`Hasta ${MAX_ESCALAS_BULTO} escalas por producto`);
  let ultimoDesde = 0;
  let ultimoPct = 0;
  usadas.slice(0, MAX_ESCALAS_BULTO).forEach((f, i) => {
    const n = i + 1;
    if (vacioTipeado(f.desde) || vacioTipeado(f.pct)) { errores.push(`Escala ${n}: completá "Desde (bultos)" y "% desc."`); return; }
    const d = numTipeado(f.desde);
    const p = numTipeado(f.pct);
    if (d === null || !Number.isInteger(d) || d < 2 || d > MAX_DESDE_ESCALA) { errores.push(`Escala ${n}: "Desde (bultos)" debe ser un entero entre 2 y ${MAX_DESDE_ESCALA}`); return; }
    if (p === null || !(p > 0) || !(p < 100) || !esDecimal2(p)) { errores.push(`Escala ${n}: el % de descuento debe estar entre 0 y 100 (hasta 2 decimales)`); return; }
    if (d <= ultimoDesde) { errores.push(`Escala ${n}: "Desde (bultos)" tiene que ser mayor que el de la escala anterior`); return; }
    if (ultimoPct > 0 && p <= ultimoPct) avisos.push(`Escala ${n}: el descuento no es mayor que el de la escala anterior`);
    ultimoDesde = d;
    ultimoPct = p;
    valor.push({ desde: d, pct: Math.round(p * 100) / 100 });
  });
  return { valor: errores.length ? [] : valor, errores, avisos };
}

const pctTexto = (p) => String(p).replace('.', ',');

// [{desde:5,pct:8}] -> "5=8; 10=12"
export function escalasATexto(arr) {
  return normalizarEscalasBulto(arr).map(e => `${e.desde}=${pctTexto(e.pct)}`).join('; ');
}

// "5=8; 10=7,5" -> filas [{desde:'5',pct:'8'}] (sin validar; usar validarEscalasBulto).
export function parsearEscalasTexto(txt) {
  if (typeof txt !== 'string') return [];
  return txt.split(/[;|]/).map(s => s.trim()).filter(Boolean).map(parte => {
    const m = parte.split(/[=:]/);
    return { desde: (m[0] ?? '').trim(), pct: (m.slice(1).join(':') ?? '').trim() };
  });
}
