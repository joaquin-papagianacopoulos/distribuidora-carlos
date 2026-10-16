// src/domain/tienda.js — REQ-TIE: lógica pura de la tienda pública.
// Sin React, sin IndexedDB, sin Supabase. La misma lógica la replica el servidor
// (RPC tienda_crear_pedido en 008_tienda.sql) y se prueba con los mismos casos
// (src/domain/__fixtures__/tiendaCasos.js).
// El precio del producto es SIEMPRE por unidad; el carrito trabaja en unidades.
import { normalizarBultoX } from './bultos';
import { MAX_CANTIDAD } from './stock';
import { ventaPorEfectivo, normalizarBultoNombre, bultosDeUnidades } from './unidadVenta';
import { precioAplicado } from './precios';
import { minimoEfectivo, cantidadInicialConMinimo } from './minimos';
import { texto, validarCuit, formatearCuit, soloDigitos } from './validacion';
import { PROVINCIAS } from './clientes';

export const MAX_RENGLONES = 150;
export const MAX_OBSERVACIONES = 500;
export const DIAS_CARRITO = 7;
export const DEBOUNCE_BUSQUEDA_MS = 250;

// ---- Dinero (centavos) ----

// Número finito >= 0 a centavos enteros (redondeo half-up); si no, null.
export function aCentavos(n) {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return null;
  return Math.round(Number((n * 100).toPrecision(12)));
}

export function deCentavos(c) {
  return c / 100;
}

// "$14.400" o "$1.234,50" (sin depender de ICU).
export function formatearPesos(n) {
  const c = aCentavos(n);
  if (c === null) return '';
  const enteros = Math.floor(c / 100);
  const cent = c % 100;
  const miles = String(enteros).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `$${miles}${cent ? `,${String(cent).padStart(2, '0')}` : ''}`;
}

// Oferta vigente: vale de `desde` a `hasta` inclusive (fechas YYYY-MM-DD).
export function precioVigente(prod, ofertas = [], hoyISO = '') {
  const base = prod && aCentavos(prod.precio) !== null ? prod.precio : null;
  const hoy = String(hoyISO || '');
  let mejor = null;
  for (const o of Array.isArray(ofertas) ? ofertas : []) {
    if (!o || !prod || String(o.productoId) !== String(prod.id)) continue;
    const c = aCentavos(o.precio);
    if (c === null || c <= 0) continue;
    if (o.desde && hoy < String(o.desde)) continue;
    if (o.hasta && hoy > String(o.hasta)) continue;
    if (mejor === null || c < mejor) mejor = c;
  }
  if (mejor !== null) return { precio: deCentavos(mejor), enOferta: true };
  return { precio: base, enOferta: false };
}

// ---- Unidades y validación de renglones ----

const enteroPositivo = (v) => {
  const n = typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v.trim()) : v;
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 ? n : null;
};

// Unidades de un renglón {cantidad, modo}. 'bulto' multiplica por bultoX.
// null si es inválido, si el modo no está permitido o supera el tope.
export function unidadesRenglon(linea, prod) {
  if (!linea || !prod) return null;
  const cant = enteroPositivo(linea.cantidad);
  if (cant === null) return null;
  const modo = linea.modo === 'bulto' ? 'bulto' : 'unidad';
  const vp = ventaPorEfectivo(prod);
  let u = cant;
  if (modo === 'bulto') {
    const bx = normalizarBultoX(prod.bultoX);
    if (vp === 'unidad' || bx === null) return null;
    u = cant * bx;
  }
  return u > MAX_CANTIDAD ? null : u;
}

// AC-MIN-1/3: mínimo efectivo (redondeado al bulto si se vende por bulto).
export function minimoDe(prod) {
  return minimoEfectivo(prod);
}

// Cantidad con la que arranca un producto en el carrito (unidades).
export function unidadesIniciales(prod) {
  return cantidadInicialConMinimo(prod || {});
}

// Paso del +/− según el modo elegido.
export function pasoUnidades(prod, modo) {
  const bx = normalizarBultoX(prod && prod.bultoX);
  const vp = ventaPorEfectivo(prod);
  if (vp === 'bulto' && bx) return bx;
  if (vp === 'ambos' && modo === 'bulto' && bx) return bx;
  return 1;
}

export function validarRenglon(linea, prod, cfg = {}) {
  const errores = [];
  if (!prod) return { ok: false, errores: ['El producto ya no está disponible'] };
  const u = unidadesRenglon(linea, prod);
  if (u === null) return { ok: false, errores: ['Cantidad inválida'] };
  const min = minimoDe(prod);
  if (u < min) errores.push(`El mínimo de compra es ${min} u.`);
  const bx = normalizarBultoX(prod.bultoX);
  if (ventaPorEfectivo(prod) === 'bulto' && bx !== null && u % bx !== 0) {
    errores.push(`Se vende por ${normalizarBultoNombre(prod.bultoNombre)} de ${bx} u.`);
  }
  const tope = Number.isFinite(cfg.maxUnidadesRenglon) ? cfg.maxUnidadesRenglon : MAX_CANTIDAD;
  if (u > tope) errores.push(`Máximo ${tope} u. por producto`);
  if (!prod.disponible && !cfg.permitirSinStock) errores.push('Sin stock');
  return { ok: errores.length === 0, errores };
}

const getProd = (cat, id) => {
  if (cat instanceof Map) return cat.get(String(id)) || cat.get(id) || null;
  return (cat && cat[String(id)]) || null;
};

// Calcula el carrito entero en centavos. Suma los renglones repetidos del mismo producto.
export function calcularCarrito(lineas, catalogoById, cfg = {}, hoyISO = '') {
  const errores = [];
  const acumulado = new Map();
  for (const l of Array.isArray(lineas) ? lineas : []) {
    if (!l || l.productoId === undefined || l.productoId === null) { errores.push({ productoId: null, mensaje: 'Renglón inválido' }); continue; }
    const prod = getProd(catalogoById, l.productoId);
    const u = unidadesRenglon(l, prod);
    if (!prod) { errores.push({ productoId: l.productoId, mensaje: 'El producto ya no está disponible' }); continue; }
    if (u === null) { errores.push({ productoId: l.productoId, mensaje: 'Cantidad inválida' }); continue; }
    const k = String(l.productoId);
    acumulado.set(k, (acumulado.get(k) || 0) + u);
  }
  const maxRenglones = Number.isFinite(cfg.maxRenglones) ? cfg.maxRenglones : MAX_RENGLONES;
  if (acumulado.size > maxRenglones) errores.push({ productoId: null, mensaje: `Máximo ${maxRenglones} productos por pedido` });
  const renglones = [];
  let totalC = 0;
  let totalUnidades = 0;
  for (const [id, unidades] of acumulado) {
    const prod = getProd(catalogoById, id);
    const v = validarRenglon({ cantidad: unidades, modo: 'unidad' }, prod, cfg);
    for (const e of v.errores) errores.push({ productoId: id, mensaje: e });
    const { precio: vigente } = precioVigente(prod, prod.ofertas || [], hoyISO);
    // AC-PBU-4: mismo precio que el servidor; con oferta y bulto se cobra el menor.
    const precio = vigente === null ? null : precioAplicado({ precio: vigente, precioBulto: prod.precioBulto, bultoX: prod.bultoX }, unidades).precio;
    const pc = aCentavos(precio);
    if (pc === null || pc <= 0) { errores.push({ productoId: id, mensaje: 'Producto sin precio' }); continue; }
    const subC = pc * unidades;
    totalC += subC;
    totalUnidades += unidades;
    const desg = bultosDeUnidades(unidades, prod.bultoX);
    renglones.push({
      productoId: prod.id,
      unidades,
      bultos: desg ? desg.bultos : 0,
      resto: desg ? desg.sueltas : unidades,
      precio: deCentavos(pc),
      subtotal: deCentavos(subC),
      disponible: !!prod.disponible,
    });
  }
  if (Number.isFinite(cfg.maxTotal) && totalC > aCentavos(cfg.maxTotal)) {
    errores.push({ productoId: null, mensaje: 'El total supera el máximo permitido' });
  }
  return { renglones, total: deCentavos(totalC), errores, totalUnidades };
}

// Compara lo que vio el cliente con lo recalculado. Ambos: {renglones:[{productoId, precio, unidades, disponible}]}.
export function compararConServidor(visto, recalculado) {
  const diffs = [];
  const nuevo = new Map(((recalculado && recalculado.renglones) || []).map(r => [String(r.productoId), r]));
  for (const v of (visto && visto.renglones) || []) {
    const r = nuevo.get(String(v.productoId));
    if (!r) { diffs.push({ productoId: v.productoId, campo: 'producto' }); continue; }
    if (aCentavos(r.precio) !== aCentavos(v.precio)) diffs.push({ productoId: v.productoId, campo: 'precio', antes: v.precio, ahora: r.precio });
    if (v.disponible !== undefined && !!r.disponible !== !!v.disponible) diffs.push({ productoId: v.productoId, campo: 'disponible' });
    if (v.unidades !== undefined && r.unidades !== v.unidades) diffs.push({ productoId: v.productoId, campo: 'unidades', antes: v.unidades, ahora: r.unidades });
  }
  return { cambio: diffs.length > 0, diffs };
}

// "Display x16 · $14.400"
export function textoBulto(prod) {
  if (!prod || ventaPorEfectivo(prod) === 'unidad') return null;
  const bx = normalizarBultoX(prod.bultoX);
  const c = aCentavos(prod.precio);
  if (bx === null || c === null) return null;
  return `${normalizarBultoNombre(prod.bultoNombre)} x${bx} · ${formatearPesos(deCentavos(c * bx))}`;
}

// AC-PBU-4: precio por unidad que ve el cliente para `unidades` (el servidor aplica lo mismo).
// Sirve de precioVisto y de subtotal en la ficha/carrito.
export function precioUnitarioTienda(prod, unidades) {
  if (!prod) return null;
  const base = precioAplicado({ precio: prod.precio, precioBulto: prod.precioBulto, bultoX: prod.bultoX }, unidades).precio;
  return aCentavos(base) === null ? prod.precio : base;
}

// AC-PBU-4: "Llevando el display: $800 c/u" (solo si el precio por bulto realmente baja el precio).
export function textoPrecioBulto(prod) {
  if (!prod || normalizarBultoX(prod.bultoX) === null) return null;
  const pb = aCentavos(Number(prod.precioBulto));
  const p = aCentavos(Number(prod.precio));
  if (pb === null || pb <= 0 || p === null || pb >= p) return null;
  return `Llevando el ${normalizarBultoNombre(prod.bultoNombre).toLowerCase()}: ${formatearPesos(deCentavos(pb))} c/u`;
}

// Precio de un bulto completo con la misma regla que cobra el servidor (AC-PBU-4):
// total del bulto, precio por unidad aplicado y lo que costaría a precio por unidad.
// null si el producto se vende solo por unidad o no tiene bulto/precio válido.
export function precioDelBulto(prod) {
  if (!prod || ventaPorEfectivo(prod) === 'unidad') return null;
  const bx = normalizarBultoX(prod.bultoX);
  const lista = aCentavos(prod.precio);
  const unit = aCentavos(precioUnitarioTienda(prod, bx));
  if (bx === null || lista === null || unit === null) return null;
  const total = unit * bx;
  const sinDescuento = lista * bx;
  const off = total < sinDescuento ? Math.round((1 - total / sinDescuento) * 100) : null;
  return {
    bultoX: bx,
    nombre: normalizarBultoNombre(prod.bultoNombre),
    unitario: deCentavos(unit),
    total: deCentavos(total),
    sinDescuento: deCentavos(sinDescuento),
    off: off && off >= 1 ? Math.min(off, 99) : null,
  };
}

// "48 u. (3 Display)" o "20 u. (1 Display + 4 u.)"
export function textoEquivalencia(unidades, prod) {
  const bx = normalizarBultoX(prod && prod.bultoX);
  if (!bx || ventaPorEfectivo(prod) === 'unidad') return `${unidades} u.`;
  const d = bultosDeUnidades(unidades, bx);
  if (!d || d.bultos === 0) return `${unidades} u.`;
  const nombre = normalizarBultoNombre(prod.bultoNombre);
  return d.sueltas === 0 ? `${unidades} u. (${d.bultos} ${nombre})` : `${unidades} u. (${d.bultos} ${nombre} + ${d.sueltas} u.)`;
}

// ---- Búsqueda y filtros ----

export function normalizarBusqueda(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .trim();
}

const tokens = (q) => normalizarBusqueda(q).split(' ').filter(Boolean);

const pajar = (p) => normalizarBusqueda(`${p.nombre || ''} ${p.codigo || ''} ${p.marca || ''}`);

export function coincide(prod, q) {
  const t = tokens(q);
  if (t.length === 0) return true;
  const h = pajar(prod || {});
  return t.every(x => h.includes(x));
}

export function puntaje(prod, q) {
  const t = tokens(q);
  if (t.length === 0 || !prod) return 0;
  const nombre = normalizarBusqueda(prod.nombre);
  const codigo = normalizarBusqueda(prod.codigo);
  const palabras = nombre.split(' ');
  let s = 0;
  if (nombre === t.join(' ')) s += 100;
  if (nombre.startsWith(t.join(' '))) s += 40;
  for (const x of t) {
    if (palabras.includes(x)) s += 10;
    else if (palabras.some(w => w.startsWith(x))) s += 6;
    else if (nombre.includes(x)) s += 3;
    if (codigo === x) s += 30;
  }
  return s;
}

const porNombre = (a, b) => String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es');

export const ORDENES = Object.freeze(['relevancia', 'precio_asc', 'precio_desc', 'nombre']);

export function filtrarCatalogo(cat, { q = '', rubros = [], marcas = [], orden = 'relevancia', ofertas = false } = {}) {
  // REQ-POR (AC-POR-1): el banner "ofertas" lleva a ?ofertas=1.
  const lista = (Array.isArray(cat) ? cat : []).filter(p => !ofertas || (p && p.enOferta));
  const rs = new Set(rubros);
  const ms = new Set(marcas);
  const base = lista.filter(p => p && coincide(p, q));
  const okR = (p) => rs.size === 0 || rs.has(p.rubro);
  const okM = (p) => ms.size === 0 || ms.has(p.marca);
  const contar = (arr, campo) => {
    const o = {};
    for (const p of arr) { const k = p[campo]; if (k) o[k] = (o[k] || 0) + 1; }
    return o;
  };
  const items = base.filter(p => okR(p) && okM(p));
  const contadores = { rubros: contar(base.filter(okM), 'rubro'), marcas: contar(base.filter(okR), 'marca') };
  const ord = ORDENES.includes(orden) ? orden : 'relevancia';
  const copia = [...items];
  if (ord === 'precio_asc') copia.sort((a, b) => (a.precio - b.precio) || porNombre(a, b));
  else if (ord === 'precio_desc') copia.sort((a, b) => (b.precio - a.precio) || porNombre(a, b));
  else if (ord === 'nombre' || tokens(q).length === 0) copia.sort(porNombre);
  else copia.sort((a, b) => (puntaje(b, q) - puntaje(a, q)) || porNombre(a, b));
  return { items: copia, contadores };
}

// ---- URL ----

export function filtrosDesdeQuery(search) {
  const sp = new URLSearchParams(String(search || ''));
  const orden = sp.get('orden');
  return {
    q: sp.get('q') || '',
    rubros: sp.getAll('rubro').filter(Boolean),
    marcas: sp.getAll('marca').filter(Boolean),
    orden: ORDENES.includes(orden) ? orden : 'relevancia',
    v: sp.get('v') || '',
    ...(sp.get('ofertas') === '1' ? { ofertas: true } : {}),
  };
}

export function filtrosAQuery(f = {}) {
  const sp = new URLSearchParams();
  if (f.v) sp.set('v', f.v);
  if (f.q) sp.set('q', f.q);
  for (const r of f.rubros || []) sp.append('rubro', r);
  for (const m of f.marcas || []) sp.append('marca', m);
  if (f.ofertas) sp.set('ofertas', '1');
  if (f.orden && f.orden !== 'relevancia') sp.set('orden', f.orden);
  const s = sp.toString();
  return s ? `?${s}` : '';
}

// ---- Host y rutas ----

const listaHosts = (envHosts) =>
  (Array.isArray(envHosts) ? envHosts : String(envHosts || '').split(','))
    .map(h => String(h).trim().toLowerCase()).filter(Boolean);

export function esHostTienda(hostname, envHosts) {
  const h = String(hostname || '').trim().toLowerCase();
  return h !== '' && listaHosts(envHosts).includes(h);
}

export function esEntradaTienda(location, envHosts) {
  const loc = location || {};
  if (esHostTienda(loc.hostname, envHosts)) return true;
  const p = String(loc.pathname || '');
  return p === '/tienda' || p.startsWith('/tienda/');
}

export function rutaTienda(pathname, search, { esHostTienda: host = false } = {}) {
  let p = String(pathname || '/');
  const enTienda = p === '/tienda' || p.startsWith('/tienda/');
  if (!enTienda && !host) return { vista: null };
  if (enTienda) p = p.slice('/tienda'.length) || '/';
  const token = new URLSearchParams(String(search || '')).get('v') || undefined;
  const partes = p.split('/').filter(Boolean);
  const out = (o) => (token ? { ...o, token } : o);
  if (partes[0] === 'p' && partes[1]) return out({ vista: 'producto', id: decodeURIComponent(partes[1]) });
  if (partes[0] === 'carrito') return out({ vista: 'carrito' });
  if (partes[0] === 'checkout') return out({ vista: 'checkout' });
  if (partes[0] === 'confirmacion') return out({ vista: 'confirmacion' });
  return out({ vista: 'catalogo' });
}

export function hrefTienda(vista, { id, search = '' } = {}) {
  if (vista === 'producto') return `/tienda/p/${encodeURIComponent(id)}${search}`;
  if (vista === 'carrito') return `/tienda/carrito${search}`;
  if (vista === 'checkout') return `/tienda/checkout${search}`;
  if (vista === 'confirmacion') return `/tienda/confirmacion${search}`;
  return `/tienda${search}`;
}

// ---- Checkout ----

export const CAMPOS_CHECKOUT = ['nombre', 'telefono', 'direccion', 'ciudad', 'cp', 'provincia', 'cuit', 'observaciones'];

export function validarCheckout(form = {}) {
  const errores = {};
  const datos = {
    nombre: texto(form.nombre, 120),
    telefono: texto(form.telefono, 30),
    direccion: texto(form.direccion, 160),
    ciudad: texto(form.ciudad, 80),
    cp: texto(form.cp, 10).toUpperCase().replace(/\s/g, ''),
    provincia: texto(form.provincia, 40),
    cuit: '',
    observaciones: texto(form.observaciones, 10000),
  };
  if (!datos.nombre) errores.nombre = 'Ingresá tu nombre o razón social';
  const dig = soloDigitos(datos.telefono);
  if (!datos.telefono) errores.telefono = 'Ingresá un teléfono o WhatsApp';
  else if (dig.length < 8 || dig.length > 15) errores.telefono = 'El teléfono debe tener entre 8 y 15 dígitos';
  if (!datos.direccion) errores.direccion = 'Ingresá la dirección de entrega';
  if (!datos.ciudad) errores.ciudad = 'Ingresá la ciudad';
  if (datos.cp && !/^[A-Z0-9]{4,8}$/.test(datos.cp)) errores.cp = 'Código postal inválido';
  if (datos.provincia && !PROVINCIAS.includes(datos.provincia)) errores.provincia = 'Provincia inválida';
  const cuitRaw = soloDigitos(form.cuit);
  if (cuitRaw) {
    if (!validarCuit(cuitRaw)) errores.cuit = 'CUIT inválido (revisá los 11 dígitos)';
    else datos.cuit = formatearCuit(cuitRaw);
  }
  if (datos.observaciones.length > MAX_OBSERVACIONES) errores.observaciones = `Máximo ${MAX_OBSERVACIONES} caracteres`;
  return { ok: Object.keys(errores).length === 0, errores, datos };
}

// ---- Persistencia del carrito (la UI hace el try/catch del localStorage) ----

export function serializarCarrito(carrito, now = Date.now()) {
  return JSON.stringify({ v: 1, at: Number(now), carrito: carrito || { lineas: [] } });
}

export function restaurarCarrito(raw, now = Date.now()) {
  if (typeof raw !== 'string' || raw === '') return null;
  let o;
  try { o = JSON.parse(raw); } catch { return null; }
  if (!o || typeof o !== 'object' || !o.carrito || !Array.isArray(o.carrito.lineas)) return null;
  const at = Number(o.at);
  if (!Number.isFinite(at) || now - at > DIAS_CARRITO * 24 * 60 * 60 * 1000) return null;
  const lineas = o.carrito.lineas
    .filter(l => l && l.productoId !== undefined && l.productoId !== null && enteroPositivo(l.unidades) !== null)
    .map(l => ({ productoId: String(l.productoId), unidades: Number(l.unidades), modo: l.modo === 'bulto' ? 'bulto' : 'unidad', precioVisto: aCentavos(l.precioVisto) === null ? null : l.precioVisto }));
  return { lineas };
}

// ---- Payload de tienda_crear_pedido (AC-TIE-13) ----
export function armarPayloadPedido(carrito, contacto, token, idem) {
  const c = contacto || {};
  return {
    idempotencia: idem,
    token: token || null,
    contacto: {
      nombre: c.nombre || '', telefono: c.telefono || '', direccion: c.direccion || '',
      ciudad: c.ciudad || '', cp: c.cp || '', provincia: c.provincia || '',
      cuit: c.cuit || '', observaciones: c.observaciones || '',
    },
    items: ((carrito && carrito.lineas) || []).map(l => ({
      productoId: l.productoId,
      cantidad: l.unidades,
      modo: 'unidad',
      precioVisto: l.precioVisto ?? null,
    })),
    hp: c.hp || '',
  };
}

// ---- Sugerencias del carrito ----

// Descuento entero (0–99) entre el precio anterior y el de oferta; null si no hay oferta real.
export function porcentajeOff(prod) {
  const antes = aCentavos(prod && prod.precioAnterior);
  const ahora = aCentavos(prod && prod.precio);
  if (antes === null || ahora === null || antes <= 0 || ahora >= antes) return null;
  const pct = Math.round((1 - ahora / antes) * 100);
  return pct >= 1 ? Math.min(pct, 99) : null;
}

// Productos de los mismos rubros que hay en el carrito y que el cliente todavía
// no eligió. Se reparten por turnos entre los rubros (el de más renglones
// primero) para no llenar la fila con uno solo; dentro de cada rubro van
// primero las ofertas, después las marcas que ya compra y después por nombre.
export function sugerenciasCarrito(lineas, productos, { max = 8, permitirSinStock = false } = {}) {
  const lista = Array.isArray(productos) ? productos.filter(p => p && p.id !== undefined && p.id !== null) : [];
  const ids = new Set((Array.isArray(lineas) ? lineas : []).map(l => String(l && l.productoId)));
  const porId = new Map(lista.map(p => [String(p.id), p]));
  const clave = (s) => normalizarBusqueda(s);

  const rubros = new Map();
  const marcas = new Set();
  for (const id of ids) {
    const p = porId.get(id);
    if (!p) continue;
    const r = clave(p.rubro);
    if (r) rubros.set(r, (rubros.get(r) || 0) + 1);
    const m = clave(p.marca);
    if (m) marcas.add(m);
  }
  if (rubros.size === 0) return [];

  const tope = Math.max(0, Math.floor(Number(max) || 0));
  const orden = (a, b) => (porcentajeOff(b) !== null) - (porcentajeOff(a) !== null)
    || marcas.has(clave(b.marca)) - marcas.has(clave(a.marca))
    || porNombre(a, b);
  const colas = Array.from(rubros.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es'))
    .map(([r]) => lista
      .filter(p => clave(p.rubro) === r && !ids.has(String(p.id)) && (p.disponible || permitirSinStock))
      .sort(orden));

  const out = [];
  for (let i = 0; out.length < tope && colas.some(c => i < c.length); i += 1) {
    for (const c of colas) {
      if (i < c.length && out.length < tope) out.push(c[i]);
    }
  }
  return out;
}
