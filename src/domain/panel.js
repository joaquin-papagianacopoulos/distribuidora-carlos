// src/domain/panel.js — REQ-PAN (AC-PAN-1..6): panel de ganancia y rentabilidad.
// Funciones puras: sin React, sin IndexedDB, sin Supabase. Montos en CENTAVOS enteros; margen en
// puntos basicos (1 % = 100 bp; null si no hay ventas). Fechas ISO YYYY-MM-DD.
//
// El costo unitario de cada renglon sale del snapshot que captura el SERVIDOR al facturar
// (migracion 015, tabla privada pedidos_costos). Sin snapshot se usa el costo actual del producto
// y el renglon queda marcado "costo estimado". El costo NUNCA viaja dentro de pedidos.items.
import { calcularPrecioVenta } from './productos';
import { toNum } from './validacion';
import { pedidoIdComision } from './comisiones';
import { cuentaComoVigente } from './rendicion';
import { isPedidoOculto, normalizePedidoFecha } from '../utils/pedidos';

const k = (v) => String(v);
const SIN_RUBRO = 'Sin rubro';
const SIN_MARCA = 'Sin marca';
const SIN_VENDEDOR = 'Sin vendedor';

// ---------------------------------------------------------------------------
// Costos (AC-PAN-1)
// ---------------------------------------------------------------------------
/** Costo neto unitario del producto en centavos (misma formula que calcularPrecioVenta) o null. */
export const costoNetoProductoCents = (producto) => {
  if (!producto) return null;
  const costo = toNum(producto.costoFinal);
  if (costo === null || costo <= 0) return null;
  const { costoNeto } = calcularPrecioVenta(producto);
  return Number.isFinite(costoNeto) && costoNeto >= 0 ? Math.round(costoNeto * 100) : null;
};

const CLAVES_COSTO = ['costoUnitario', 'costoFinal', 'costoNeto', 'costo', 'descuento1', 'descuento2', 'ganancia'];

/** Copia de los items sin ningun dato de costo (pedidos es legible con la anon key). */
export const itemsSinCostos = (items) => {
  if (!Array.isArray(items)) return items;
  return items.map((it) => {
    if (!it || typeof it !== 'object') return it;
    if (!CLAVES_COSTO.some(c => c in it)) return it;
    const copia = { ...it };
    for (const c of CLAVES_COSTO) delete copia[c];
    return copia;
  });
};

// ---------------------------------------------------------------------------
// Periodos (AC-PAN-2)
// ---------------------------------------------------------------------------
const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const desdeMs = (ms) => { const d = new Date(ms); return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); };
const DIA = 86400000;
const ultimoDiaMes = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export const periodoMesEnCurso = (now = new Date()) => {
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  return { desde: iso(y, m, 1), hasta: iso(y, m, ultimoDiaMes(y, m)) };
};

/** Mes calendario completo => mes anterior completo; rango libre => mismos dias inmediatamente antes. */
export const periodoAnterior = ({ desde, hasta }) => {
  const [y, m, d] = desde.split('-').map(Number);
  const [y2, m2, d2] = hasta.split('-').map(Number);
  if (d === 1 && y === y2 && m === m2 && d2 === ultimoDiaMes(y, m)) {
    const py = m === 1 ? y - 1 : y;
    const pm = m === 1 ? 12 : m - 1;
    return { desde: iso(py, pm, 1), hasta: iso(py, pm, ultimoDiaMes(py, pm)) };
  }
  const dias = Math.round((parse(hasta) - parse(desde)) / DIA) + 1;
  return { desde: desdeMs(parse(desde) - dias * DIA), hasta: desdeMs(parse(desde) - DIA) };
};

// ---------------------------------------------------------------------------
// Renglones (AC-PAN-1/2/6)
// ---------------------------------------------------------------------------
const fechaDe = (f) => {
  const raw = String(f || '');
  if (raw.length === 10 && raw.charCodeAt(4) === 45) return raw;
  // Con hora y zona (Z / +hh:mm) o timestamp numerico: dia de Argentina (UTC-3 fijo, sin DST).
  const conZona = /T.*(Z|[+-]\d{2}:?\d{2})$/i.test(raw);
  if (conZona || (typeof f === 'number' && Number.isFinite(f))) {
    const t = typeof f === 'number' ? f : Date.parse(raw);
    if (Number.isFinite(t)) return new Date(t - 3 * 3600 * 1000).toISOString().slice(0, 10);
  }
  return normalizePedidoFecha(raw);
};
const enPeriodo = (f, p) => !!f && (!p || (f >= p.desde && f <= p.hasta));
const centsPrecio = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) : 0; };
const claveCliente = (id, nombre) => (id !== null && id !== undefined && id !== '' ? `id:${id}` : `n:${String(nombre || '').trim().toLowerCase()}`);
const normCostosVenta = (cv) => (cv instanceof Map ? cv : new Map());
const normProductos = (pr) => (pr instanceof Map ? pr : new Map());

// Costo unitario en centavos de un producto dentro de un pedido: { cents|null, estimado }.
const costoUnitarioDe = (pid, snap, producto) => {
  const s = snap ? Number(snap[pid]) : NaN;
  if (Number.isFinite(s) && s >= 0 && snap[pid] !== null && snap[pid] !== '') return { cents: Math.round(s * 100), estimado: false };
  const actual = costoNetoProductoCents(producto);
  return actual === null ? { cents: null, estimado: false } : { cents: actual, estimado: true };
};

const datosProducto = (producto, item) => ({
  nombre: (producto && (producto.nombre || producto.descripcion)) || item?.nombre || 'Producto',
  rubro: String((producto && producto.categoria) || item?.rubro || '').trim(),
  marca: String((producto && producto.marca) || item?.marca || '').trim(),
});

const vendedorDe = (p) => String(p?.vendedor || p?.vendedorNombre || '').trim();

/** Renglones de venta: pedidos facturados, no ocultos, items no eliminados con cantidad > 0. */
export const renglonesVenta = (pedidos, { costosVenta, productosById, periodo } = {}) => {
  const cv = normCostosVenta(costosVenta);
  const prods = normProductos(productosById);
  const out = [];
  for (const p of Array.isArray(pedidos) ? pedidos : []) {
    if (!p || String(p.estado || '').toLowerCase() !== 'facturado' || isPedidoOculto(p)) continue;
    const fecha = fechaDe(p.fecha);
    if (!enPeriodo(fecha, periodo) || !Array.isArray(p.items)) continue;
    const pedidoId = pedidoIdComision(p) ?? `local:${p.id}`;
    const snap = cv.get(pedidoIdComision(p) ?? '')?.costos || null;
    const vendedor = vendedorDe(p);
    const cliKey = claveCliente(p.clienteId, p.clienteNombre);
    const cliNombre = p.clienteNombre || '';
    for (const it of p.items) {
      if (!it || String(it.eliminado) === 'true') continue;
      const cant = Number(it.cantidad);
      if (!Number.isFinite(cant) || cant <= 0) continue;
      const pid = it.productoId === null || it.productoId === undefined || it.productoId === '' ? null : k(it.productoId);
      const prod = pid === null ? undefined : prods.get(pid);
      const d = datosProducto(prod, it);
      const cu = pid === null ? { cents: null, estimado: false } : costoUnitarioDe(pid, snap, prod);
      out.push({
        tipo: 'venta', pedidoId, fecha, productoId: pid, nombre: d.nombre, rubro: d.rubro, marca: d.marca,
        vendedor, clienteKey: cliKey, clienteNombre: cliNombre, unidades: cant,
        ventaCents: Math.round(centsPrecio(it.precio) * cant),
        costoCents: cu.cents === null ? null : Math.round(cu.cents * cant),
        costoEstimado: cu.estimado, productoBorrado: pid !== null && !prod,
      });
    }
  }
  return out;
};

/** Ajustes de rendiciones vigentes, imputados a la fecha de la rendicion (AC-PAN-2). */
export const ajustesRendicion = (rendiciones, { pedidosById, costosVenta, productosById, periodo } = {}) => {
  const cv = normCostosVenta(costosVenta);
  const prods = normProductos(productosById);
  const peds = pedidosById instanceof Map ? pedidosById : new Map();
  const out = [];
  for (const r of Array.isArray(rendiciones) ? rendiciones : []) {
    if (!cuentaComoVigente(r)) continue;
    const fecha = fechaDe(r.fecha);
    if (!enPeriodo(fecha, periodo)) continue;
    const pedido = peds.get(k(r.pedidoId)) || null;
    const snap = cv.get(k(r.pedidoId))?.costos || null;
    const base = {
      pedidoId: k(r.pedidoId), fecha, vendedor: vendedorDe(pedido),
      clienteKey: claveCliente(r.clienteId ?? pedido?.clienteId, r.clienteNombre || pedido?.clienteNombre),
      clienteNombre: r.clienteNombre || pedido?.clienteNombre || '',
    };
    if (r.tipo === 'nc') {
      out.push({ ...base, tipo: 'nc', productoId: null, nombre: 'Notas de crédito', rubro: '', marca: '', unidades: 0,
        ventaCents: -(Number(r.creditoCents) || 0), costoCents: 0, costoEstimado: false, productoBorrado: false });
      continue;
    }
    for (const ren of Array.isArray(r.renglones) ? r.renglones : []) {
      const cant = Number(ren?.cantidad);
      if (!Number.isFinite(cant) || cant <= 0 || (ren.sentido !== 'entra' && ren.sentido !== 'sale')) continue;
      const pid = k(ren.productoId);
      const prod = prods.get(pid);
      const d = datosProducto(prod, ren);
      const cu = costoUnitarioDe(pid, snap, prod);
      const signo = ren.sentido === 'entra' ? -1 : 1;
      // Merma (no vuelve al stock): baja la venta pero el costo se perdio igual.
      const costoNeteable = ren.sentido === 'sale' || ren.vuelveAlStock !== false;
      out.push({
        ...base, tipo: r.tipo, productoId: pid, nombre: d.nombre, rubro: d.rubro || String(ren.rubro || '').trim(),
        marca: d.marca, unidades: signo * cant,
        ventaCents: signo * Math.round((Number(ren.precioCents) || 0) * cant),
        costoCents: cu.cents === null ? null : (costoNeteable ? signo * Math.round(cu.cents * cant) : 0),
        costoEstimado: cu.estimado, productoBorrado: !prod,
      });
    }
  }
  return out;
};

// ---------------------------------------------------------------------------
// Resumen y comparacion (AC-PAN-2, AC-PAN-6)
// ---------------------------------------------------------------------------
const margen = (ganancia, ventas) => (ventas <= 0 ? null : Math.round((ganancia * 10000) / ventas));

export const resumenPeriodo = (renglones) => {
  let ventas = 0; let costo = 0; let sinCosto = 0; let estimados = 0;
  const pedidos = new Set();
  for (const r of renglones || []) {
    ventas += r.ventaCents;
    if (r.costoCents === null) { if (r.tipo !== 'nc') sinCosto += 1; } else costo += r.costoCents;
    if (r.costoEstimado) estimados += 1;
    if (r.tipo === 'venta' && r.ventaCents > 0) pedidos.add(r.pedidoId);
  }
  const ganancia = ventas - costo;
  return {
    ventasCents: ventas, costoCents: costo, gananciaCents: ganancia, margenBp: margen(ganancia, ventas),
    pedidos: pedidos.size, ticketPromedioCents: pedidos.size ? Math.round(ventas / pedidos.size) : 0,
    renglonesSinCosto: sinCosto, renglonesEstimados: estimados,
  };
};

const CAMPOS_COMPARAR = ['ventasCents', 'costoCents', 'gananciaCents', 'margenBp', 'pedidos', 'ticketPromedioCents'];

export const compararPeriodos = (actual, anterior) => {
  const out = {};
  for (const c of CAMPOS_COMPARAR) {
    const a = actual?.[c] ?? null;
    const b = anterior?.[c] ?? null;
    out[c] = { actual: a, anterior: b, variacionBp: a === null || b === null || b === 0 ? null : Math.round(((a - b) * 10000) / Math.abs(b)) };
  }
  return out;
};

// ---------------------------------------------------------------------------
// Rentabilidad (AC-PAN-3)
// ---------------------------------------------------------------------------
const CLAVE_DIM = {
  producto: (r) => (r.productoId === null ? null : { clave: r.productoId, etiqueta: r.nombre }),
  rubro: (r) => (r.tipo === 'nc' ? null : { clave: r.rubro.toLowerCase() || SIN_RUBRO, etiqueta: r.rubro || SIN_RUBRO }),
  marca: (r) => (r.tipo === 'nc' ? null : { clave: r.marca.toLowerCase() || SIN_MARCA, etiqueta: r.marca || SIN_MARCA }),
  vendedor: (r) => ({ clave: r.vendedor.toLowerCase() || SIN_VENDEDOR, etiqueta: r.vendedor || SIN_VENDEDOR }),
  cliente: (r) => ({ clave: r.clienteKey, etiqueta: r.clienteNombre || 'Sin cliente' }),
};

export const rentabilidadPor = (renglones, dimension) => {
  const fn = CLAVE_DIM[dimension];
  if (!fn) return [];
  const m = new Map();
  for (const r of renglones || []) {
    const c = fn(r);
    if (!c) continue;
    let f = m.get(c.clave);
    if (!f) { f = { clave: c.clave, etiqueta: c.etiqueta, unidades: 0, ventasCents: 0, costoCents: 0, estimado: false }; m.set(c.clave, f); }
    f.unidades += r.unidades;
    f.ventasCents += r.ventaCents;
    f.costoCents += r.costoCents ?? 0;
    if (r.costoEstimado) f.estimado = true;
  }
  const filas = [];
  for (const f of m.values()) {
    f.gananciaCents = f.ventasCents - f.costoCents;
    f.margenBp = margen(f.gananciaCents, f.ventasCents);
    filas.push(f);
  }
  return filas;
};

export const ordenarFilas = (filas, campo, dir = 'desc') => {
  const signo = dir === 'asc' ? 1 : -1;
  const con = (filas || []).map((f, i) => ({ f, i }));
  con.sort((a, b) => {
    const x = a.f?.[campo]; const y = b.f?.[campo];
    const nx = x === null || x === undefined; const ny = y === null || y === undefined;
    if (nx || ny) return nx && ny ? a.i - b.i : (nx ? 1 : -1); // nulos siempre al final
    const c = typeof x === 'string' || typeof y === 'string' ? String(x).localeCompare(String(y), 'es', { sensitivity: 'base' }) : x - y;
    return c === 0 ? a.i - b.i : signo * c;
  });
  return con.map(x => x.f);
};

// ---------------------------------------------------------------------------
// Rankings (AC-PAN-4)
// ---------------------------------------------------------------------------
export const masVendidos = (filasProducto, n = 10) => ({
  porUnidades: ordenarFilas((filasProducto || []).filter(f => f.unidades > 0), 'unidades', 'desc').slice(0, n),
  porImporte: ordenarFilas((filasProducto || []).filter(f => f.ventasCents > 0), 'ventasCents', 'desc').slice(0, n),
});

/** Variacion de unidades contra el periodo anterior. Anterior 0 => nuevo (sin %). */
export const enAlzaEnBaja = (filasActual, filasAnterior, n = 10) => {
  const ant = new Map((filasAnterior || []).map(f => [f.clave, f]));
  const act = new Map((filasActual || []).map(f => [f.clave, f]));
  const claves = new Set([...act.keys(), ...ant.keys()]);
  const lista = [];
  for (const c of claves) {
    const a = act.get(c); const b = ant.get(c);
    const u1 = a?.unidades ?? 0; const u0 = b?.unidades ?? 0;
    if (u1 === u0) continue;
    lista.push({
      clave: c, etiqueta: (a || b).etiqueta, unidades: u1, unidadesAnterior: u0, delta: u1 - u0,
      nuevo: u0 <= 0 && u1 > 0, variacionBp: u0 > 0 ? Math.round(((u1 - u0) * 10000) / u0) : null,
    });
  }
  return {
    alza: lista.filter(x => x.delta > 0).sort((x, y) => y.delta - x.delta).slice(0, n),
    baja: lista.filter(x => x.delta < 0).sort((x, y) => x.delta - y.delta).slice(0, n),
  };
};

const esVigente = (p) => !!p && !p.eliminado && !p.borrado && p.activo !== false;

export const sinVentas = (productos, filasProducto) => {
  const vendidos = new Set((filasProducto || []).filter(f => f.unidades > 0).map(f => f.clave));
  return (productos || []).filter(p => esVigente(p) && !vendidos.has(k(p.id)));
};

const lunesDe = (ms) => { const dow = (new Date(ms).getUTCDay() + 6) % 7; return ms - dow * DIA; };

/** Barras de ventas/ganancia por semana (lunes a domingo) o mes, con buckets vacios en 0. */
export const tendencia = (renglones, { agrupacion = 'semana', hasta, cantidad = 12 } = {}) => {
  if (!hasta) return [];
  const buckets = [];
  if (agrupacion === 'mes') {
    const [y, m] = hasta.split('-').map(Number);
    for (let i = cantidad - 1; i >= 0; i -= 1) {
      const t = new Date(Date.UTC(y, m - 1 - i, 1));
      const yy = t.getUTCFullYear(); const mm = t.getUTCMonth() + 1;
      buckets.push({ etiqueta: `${pad(mm)}/${yy}`, desde: iso(yy, mm, 1), hastaB: iso(yy, mm, ultimoDiaMes(yy, mm)) });
    }
  } else {
    const lunes = lunesDe(parse(hasta));
    for (let i = cantidad - 1; i >= 0; i -= 1) {
      const ini = lunes - i * 7 * DIA;
      buckets.push({ etiqueta: desdeMs(ini).slice(5).split('-').reverse().join('/'), desde: desdeMs(ini), hastaB: desdeMs(ini + 6 * DIA) });
    }
  }
  const out = buckets.map(b => ({ etiqueta: b.etiqueta, desde: b.desde, ventasCents: 0, gananciaCents: 0 }));
  const cache = new Map(); // fecha -> indice (evita recorrer buckets por cada renglon)
  for (const r of renglones || []) {
    let i = cache.get(r.fecha);
    if (i === undefined) {
      i = buckets.findIndex(b => r.fecha >= b.desde && r.fecha <= b.hastaB);
      cache.set(r.fecha, i);
    }
    if (i < 0) continue;
    out[i].ventasCents += r.ventaCents;
    out[i].gananciaCents += r.ventaCents - (r.costoCents ?? 0);
  }
  return out;
};

// ---------------------------------------------------------------------------
// Avisos (AC-PAN-5)
// ---------------------------------------------------------------------------
export const avisosPanel = (productos, filasProducto) => {
  const margenNegativo = [];
  const vistos = new Set();
  for (const f of filasProducto || []) {
    if (f.ventasCents > 0 && f.gananciaCents < 0) { margenNegativo.push({ clave: f.clave, etiqueta: f.etiqueta, motivo: 'periodo', gananciaCents: f.gananciaCents }); vistos.add(f.clave); }
  }
  const sinCosto = [];
  for (const p of productos || []) {
    if (!esVigente(p)) continue;
    const costo = costoNetoProductoCents(p);
    if (costo === null) { sinCosto.push({ clave: k(p.id), etiqueta: p.nombre || '', codigo: p.codigo || '' }); continue; }
    const precio = centsPrecio(p.precio);
    if (precio < costo && !vistos.has(k(p.id))) margenNegativo.push({ clave: k(p.id), etiqueta: p.nombre || '', motivo: 'catalogo', gananciaCents: precio - costo });
  }
  return { margenNegativo, sinCosto };
};

// ---------------------------------------------------------------------------
// Orquestador (AC-PAN-6): una sola pasada sobre pedidos y rendiciones.
// ---------------------------------------------------------------------------
export const calcularPanel = ({ pedidos = [], productos = [], rendiciones = [], costosVenta, periodo, agrupacion = 'semana', now = new Date(), cantidadBarras = 12 } = {}) => {
  const per = periodo || periodoMesEnCurso(now);
  const ant = periodoAnterior(per);
  const productosById = new Map((productos || []).filter(p => p && p.id !== undefined && p.id !== null).map(p => [k(p.id), p]));
  const pedidosById = new Map();
  for (const p of pedidos || []) { const id = pedidoIdComision(p); if (id) pedidosById.set(id, p); }
  const barras = tendencia([], { agrupacion, hasta: per.hasta, cantidad: cantidadBarras });
  const inicioTend = barras.length ? barras[0].desde : per.desde;
  const union = { desde: [per.desde, ant.desde, inicioTend].sort()[0], hasta: per.hasta };
  const todos = renglonesVenta(pedidos, { costosVenta, productosById, periodo: union })
    .concat(ajustesRendicion(rendiciones, { pedidosById, costosVenta, productosById, periodo: union }));
  const actual = []; const previo = [];
  for (const r of todos) {
    if (r.fecha >= per.desde && r.fecha <= per.hasta) actual.push(r);
    else if (r.fecha >= ant.desde && r.fecha <= ant.hasta) previo.push(r);
  }
  const resumen = resumenPeriodo(actual);
  const resumenAnterior = resumenPeriodo(previo);
  const filasProducto = rentabilidadPor(actual, 'producto');
  const filasAnterior = rentabilidadPor(previo, 'producto');
  return {
    periodo: per, periodoAnterior: ant, resumen, resumenAnterior, comparacion: compararPeriodos(resumen, resumenAnterior),
    porProducto: filasProducto, porRubro: rentabilidadPor(actual, 'rubro'), porMarca: rentabilidadPor(actual, 'marca'),
    porVendedor: rentabilidadPor(actual, 'vendedor'), porCliente: rentabilidadPor(actual, 'cliente'),
    masVendidos: masVendidos(filasProducto), variacion: enAlzaEnBaja(filasProducto, filasAnterior),
    sinVentas: sinVentas(productos, filasProducto), tendencia: tendencia(todos, { agrupacion, hasta: per.hasta, cantidad: cantidadBarras }),
    avisos: avisosPanel(productos, filasProducto),
  };
};

