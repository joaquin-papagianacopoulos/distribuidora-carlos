// src/domain/productos.js — REQ-PROD: alta de productos y cálculo de precios.
import { texto, toNum, toInt, redondear2, claveUnica } from './validacion';
import { normalizarRubro, resolverRubro } from './rubros';
import { resolverMarca, normalizarMarca } from './marcas';
import { avisoSinStock } from './stock';
import { minimoEfectivo } from './minimos';
import { validarUnidadVenta, VENTA_POR, BULTO_NOMBRES, ventaPorEfectivo, normalizarBultoNombre, parsearBooleano } from './unidadVenta';

export const CAMPOS_PRODUCTO = [
  { key: 'codigo', label: 'Código', requerido: true },
  { key: 'nombre', label: 'Descripción', requerido: true },
  // AC-COMR-3: el Rubro es un selector (rubros existentes + "Agregar rubro nuevo…").
  { key: 'categoria', label: 'Rubro', tipo: 'rubro' },
  // AC-VTA-1: la Marca es un selector (marcas existentes + "Agregar marca nueva…").
  { key: 'marca', label: 'Marca', tipo: 'marca' },
  { key: 'proveedorId', label: 'Proveedor', tipo: 'proveedor' },
  { key: 'costoFinal', label: 'Costo final', tipo: 'number', prefijo: '$' },
  { key: 'descuento1', label: 'Descuento 1', tipo: 'number', sufijo: '%' },
  { key: 'descuento2', label: 'Descuento 2', tipo: 'number', sufijo: '%' },
  { key: 'ganancia', label: '% Ganancia', tipo: 'number', sufijo: '%' },
  // AC-PBU-1: el campo interno sigue siendo `precio`; se muestra como "Precio por unidad".
  { key: 'precio', label: 'Precio por unidad', tipo: 'number', prefijo: '$' },
  { key: 'precioBulto', label: 'Precio por unidad llevando bulto', tipo: 'number', prefijo: '$' },
  { key: 'precioVenta2', label: 'Precio venta 2', tipo: 'number', prefijo: '$' },
  { key: 'bultoX', label: 'Bulto x', tipo: 'number' },
  // AC-VTA-1: unidad de venta. El precio cargado es siempre por unidad.
  { key: 'ventaPor', label: 'Se vende por', opciones: VENTA_POR.map(v => ({ value: v, label: v.charAt(0).toUpperCase() + v.slice(1) })), tipo: 'ventaPor' },
  { key: 'bultoNombre', label: 'Etiqueta del bulto', opciones: BULTO_NOMBRES, tipo: 'bultoNombre' },
  { key: 'visibleTienda', label: 'Mostrar en tienda', tipo: 'booleano' },
  { key: 'minimoVenta', label: 'Mínimo venta', tipo: 'number' },
  // AC-STB-1: punto de reposición. Vacío = se usa el mínimo de venta.
  { key: 'stockMinimo', label: 'Stock mínimo', tipo: 'number' },
  { key: 'stock', label: 'Stock', tipo: 'number' },
];

// AC-PROD-1: costoNeto = costo × (1-d1) × (1-d2); precio1 = costoNeto × (1+ganancia).
export const calcularPrecioVenta = ({ costoFinal, descuento1, descuento2, ganancia } = {}) => {
  const costo = toNum(costoFinal) ?? 0;
  const d1 = Math.min(Math.max(toNum(descuento1) ?? 0, 0), 100);
  const d2 = Math.min(Math.max(toNum(descuento2) ?? 0, 0), 100);
  const g = Math.max(toNum(ganancia) ?? 0, 0);
  const costoNeto = costo * (1 - d1 / 100) * (1 - d2 / 100);
  return { costoNeto: redondear2(costoNeto), precioVenta1: redondear2(costoNeto * (1 + g / 100)) };
};

// Tope = numeric(14,2) de Supabase (S-12).
export const MAX_IMPORTE = 999_999_999_999;

const pct = (v, campo, errores, label) => {
  if (v === '' || v === null || v === undefined) return 0;
  const n = toNum(v);
  if (n === null || n < 0 || n > 100) { errores[campo] = `${label}: % entre 0 y 100`; return 0; }
  return n;
};

/**
 * Valida y normaliza un producto. `stock` se devuelve aparte: no se guarda en
 * el producto, se transforma en un movimiento (AC-PROD-3).
 */
// AC-COMR-4: con `rubros` (los existentes) el rubro se normaliza y, si ya
// existe con otra escritura ("GOLOSINAS " vs "Golosinas"), se reutiliza la
// existente. Sin `rubros`, solo se normaliza.
export const validarProducto = (form = {}, { existentes = [], proveedores = [], editId = null, rubros = null, marcas = null } = {}) => {
  const errores = {};
  const p = {
    codigo: texto(form.codigo, 40),
    nombre: texto(form.nombre, 160),
    categoria: Array.isArray(rubros) ? resolverRubro(form.categoria, rubros).rubro : normalizarRubro(form.categoria),
    marca: Array.isArray(marcas) ? resolverMarca(form.marca, marcas).marca : normalizarMarca(form.marca),
    proveedorId: form.proveedorId ? String(form.proveedorId) : null,
  };
  if (!p.codigo) errores.codigo = 'El código es obligatorio';
  if (!p.nombre) errores.nombre = 'La descripción es obligatoria';
  if (p.codigo) {
    const k = claveUnica(p.codigo);
    const dup = existentes.find(x => x && x.id !== editId && x.codigo && claveUnica(x.codigo) === k);
    if (dup) errores.codigo = `El código ya está usado por "${dup.nombre}"`;
  }
  if (p.proveedorId && !proveedores.some(pr => pr.id === p.proveedorId)) {
    errores.proveedorId = 'Proveedor inexistente';
  }

  const costo = form.costoFinal === '' || form.costoFinal == null ? 0 : toNum(form.costoFinal);
  if (costo === null || costo < 0 || costo > MAX_IMPORTE) errores.costoFinal = 'Costo inválido';
  p.costoFinal = costo !== null && costo >= 0 ? costo : 0;
  p.descuento1 = pct(form.descuento1, 'descuento1', errores, 'Descuento 1');
  p.descuento2 = pct(form.descuento2, 'descuento2', errores, 'Descuento 2');
  const gan = form.ganancia === '' || form.ganancia == null ? 0 : toNum(form.ganancia);
  if (gan === null || gan < 0 || gan > 1000) errores.ganancia = '% ganancia inválido (0 a 1000)';
  p.ganancia = gan !== null && gan >= 0 ? gan : 0;

  const calculado = calcularPrecioVenta(p).precioVenta1;
  if (calculado > MAX_IMPORTE) errores.precio = 'Precio por unidad demasiado alto';
  const precioManual = form.precio === '' || form.precio == null ? null : toNum(form.precio);
  if (form.precio !== '' && form.precio != null && (precioManual === null || precioManual < 0 || precioManual > MAX_IMPORTE)) {
    errores.precio = 'Precio por unidad inválido';
  }
  p.precio = precioManual !== null && precioManual >= 0 ? redondear2(precioManual) : calculado;

  // AC-PBU-1: vacío/0 = no hay precio por bulto. Si supera al unitario no se bloquea (solo aviso en el form).
  const pb = form.precioBulto === '' || form.precioBulto == null ? 0 : toNum(form.precioBulto);
  if (pb === null || pb < 0 || pb > MAX_IMPORTE) errores.precioBulto = 'Precio por unidad llevando bulto inválido';
  p.precioBulto = pb !== null && pb >= 0 ? redondear2(pb) : 0;

  const pv2 = form.precioVenta2 === '' || form.precioVenta2 == null ? 0 : toNum(form.precioVenta2);
  if (pv2 === null || pv2 < 0 || pv2 > MAX_IMPORTE) errores.precioVenta2 = 'Precio venta 2 inválido';
  p.precioVenta2 = pv2 !== null && pv2 >= 0 ? redondear2(pv2) : 0;

  const entero = (v, campo, label) => {
    if (v === '' || v == null) return 1;
    const n = toInt(v);
    if (n === null || n < 1 || n > 1_000_000) { errores[campo] = `${label}: entero entre 1 y 1.000.000`; return 1; }
    return n;
  };
  p.bultoX = entero(form.bultoX, 'bultoX', 'Bulto x');
  p.minimoVenta = entero(form.minimoVenta, 'minimoVenta', 'Mínimo venta');

  // AC-STB-1: stock mínimo opcional (entero >= 0). Vacío => null (se usa minimoVenta).
  p.stockMinimo = null;
  if (form.stockMinimo !== '' && form.stockMinimo != null) {
    const sm = toInt(form.stockMinimo);
    if (sm === null || sm < 0 || sm > 1_000_000) errores.stockMinimo = 'Stock mínimo: entero entre 0 y 1.000.000 (o vacío)';
    else p.stockMinimo = sm;
  }

  // AC-VTA-1: "bulto" exige bultoX > 1 (error en el campo Se vende por).
  const uv = validarUnidadVenta({ ventaPor: form.ventaPor, bultoX: p.bultoX, bultoNombre: form.bultoNombre, visibleTienda: form.visibleTienda });
  if (uv.errores.ventaPor) errores.ventaPor = uv.errores.ventaPor;
  p.ventaPor = uv.valor.ventaPor;
  p.bultoNombre = uv.valor.bultoNombre;
  p.visibleTienda = uv.valor.visibleTienda;

  let stock = null;
  if (form.stock !== '' && form.stock != null) {
    stock = toInt(form.stock);
    if (stock === null || stock < 0 || stock > 1_000_000) { errores.stock = 'Stock: entero entre 0 y 1.000.000'; stock = null; }
  }

  return { ok: Object.keys(errores).length === 0, errores, producto: p, stock };
};

// S-012-01 (migracion 013): columnas internas de productos. No se leen con la anon key;
// solo bajan por la RPC admin_productos_costos (PIN de admin). precio_venta2 tambien es
// interna: es una lista de precios comercial que no usa la venta ni la tienda.
export const COSTOS_PRODUCTO = Object.freeze([
  ['costo_final', 'costoFinal'],
  ['descuento1', 'descuento1'],
  ['descuento2', 'descuento2'],
  ['ganancia', 'ganancia'],
  ['precio_venta2', 'precioVenta2'],
]);

// S-012-01: columnas que se leen de public.productos con la anon key (sin costos).
// Ordenadas de la mas vieja a la mas nueva: si falta una migracion se descarta la que nombra el error.
export const COLUMNAS_PRODUCTO_PUBLICAS = Object.freeze([
  'id', 'nombre', 'codigo', 'precio', 'unidad', 'categoria', 'imagen_url',
  'proveedor_id', 'bulto_x', 'minimo_venta',
  'marca', 'venta_por', 'bulto_nombre', 'visible_tienda',
  'precio_bulto', 'stock_minimo',
]);

/**
 * S-012-01: si el error de PostgREST nombra una columna inexistente de la lista, devuelve la
 * lista sin esa columna (para reintentar). Si no se puede identificar, null.
 */
export const columnasSinFaltante = (columnas = [], error) => {
  const msg = String(error?.message || '');
  const m = msg.match(/column\s+"?(?:[a-z_]+\.)?([a-z0-9_]+)"?\s+does not exist/i)
    || msg.match(/could not find the '([a-z0-9_]+)' column/i);
  if (!m) return null;
  const col = m[1].toLowerCase();
  if (col === 'id' || col === 'nombre' || !columnas.includes(col)) return null;
  return columnas.filter(c => c !== col);
};

/**
 * S-012-01: un costo que este dispositivo nunca bajo (undefined) y que el form/plantilla deja en
 * 0 por defecto NO se manda: asi no se pisa el costo del servidor con vacio.
 */
export const conservarCostosDesconocidos = (previo = {}, nuevo = {}) => {
  const out = { ...nuevo };
  for (const [, key] of COSTOS_PRODUCTO) {
    if (previo?.[key] === undefined && (out[key] === undefined || out[key] === null || out[key] === '' || Number(out[key]) === 0)) {
      out[key] = undefined;
    }
  }
  return out;
};

export const productoExtraToRemote = (p = {}) => {
  const out = { proveedor_id: p.proveedorId || null };
  // S-012-01: un costo desconocido (undefined) no viaja; el servidor conserva el suyo.
  for (const [col, key] of COSTOS_PRODUCTO) {
    if (p[key] !== undefined) out[col] = Number(p[key]) || 0;
  }
  out.bulto_x = Number(p.bultoX) || 1;
  out.minimo_venta = Number(p.minimoVenta) || 1;
  return out;
};

/**
 * S-012-01: aplica los costos bajados con PIN sobre los productos locales. No toca productos con
 * cambios locales sin subir. Devuelve solo los que cambian.
 */
export const aplicarCostosRemotos = (locales = [], remotos = []) => {
  const porId = new Map((Array.isArray(locales) ? locales : []).filter(Boolean).map(p => [String(p.id), p]));
  const out = [];
  for (const r of Array.isArray(remotos) ? remotos : []) {
    const local = r ? porId.get(String(r.id)) : null;
    if (!local || local.pendingSync || local.extrasDirty || local.extrasPendientes) continue;
    const parche = {};
    let cambia = false;
    for (const [col, key] of COSTOS_PRODUCTO) {
      if (r[col] === undefined) continue;
      const n = Number(r[col]);
      const v = Number.isFinite(n) && n >= 0 ? n : 0;
      parche[key] = v;
      if (local[key] !== v) cambia = true;
    }
    if (cambia) out.push({ ...local, ...parche });
  }
  return out;
};

// AC-PBU: columna de la migración 010 (aparte para poder escalonar el sync si falta).
export const productoPreciosToRemote = (p = {}) => ({
  precio_bulto: Number(p.precioBulto) > 0 ? Number(p.precioBulto) : 0,
  // AC-STB-1 (migración 012): si el producto nunca tuvo el dato, la clave no viaja y el servidor conserva el suyo.
  ...(p.stockMinimo !== undefined ? { stock_minimo: stockMinimoValido(p.stockMinimo) } : {}),
});

// AC-VTA-5: columnas de la migración 006 (aparte de las de la 001 para poder escalonar el sync).
export const productoVentaToRemote = (p = {}) => ({
  venta_por: ventaPorEfectivo(p),
  bulto_nombre: normalizarBultoNombre(p.bultoNombre),
  visible_tienda: parsearBooleano(p.visibleTienda) === false ? false : true,
});

// AC-STB-1: null si está vacío o es inválido.
export const stockMinimoValido = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : null;
};

export const productoExtraFromRemote = (r = {}, local = {}) => {
  r = r || {};
  const pick = (col, key, def) => (r[col] !== undefined ? (r[col] ?? def) : (local?.[key] ?? def));
  // S-012-01: con la 013 los costos no vienen en el select anon. Columna ausente => se conserva
  // lo local; si tampoco hay local queda undefined (desconocido: nunca se manda como 0).
  const costo = (col, key) => (r[col] === undefined && local?.[key] === undefined ? undefined : Number(pick(col, key, 0)));
  return {
    proveedorId: pick('proveedor_id', 'proveedorId', null),
    costoFinal: costo('costo_final', 'costoFinal'),
    descuento1: costo('descuento1', 'descuento1'),
    descuento2: costo('descuento2', 'descuento2'),
    ganancia: costo('ganancia', 'ganancia'),
    precioVenta2: costo('precio_venta2', 'precioVenta2'),
    bultoX: Number(pick('bulto_x', 'bultoX', 1)),
    minimoVenta: Number(pick('minimo_venta', 'minimoVenta', 1)),
    precioBulto: Number(pick('precio_bulto', 'precioBulto', 0)) || 0,
    stockMinimo: stockMinimoValido(pick('stock_minimo', 'stockMinimo', null)),
    // AC-VTA-5: columna ausente (sin 006) => valor local => default derivado.
    ventaPor: pick('venta_por', 'ventaPor', undefined),
    bultoNombre: normalizarBultoNombre(pick('bulto_nombre', 'bultoNombre', 'Bulto')),
    visibleTienda: pick('visible_tienda', 'visibleTienda', true) !== false,
  };
};

// AC-PROD-4: avisos al cargar un pedido (no bloquean la venta).
export const avisosItemPedido = (producto, cantidad, stockDisponible) => {
  const avisos = [];
  const min = minimoEfectivo(producto);
  if (Number(cantidad) < min) avisos.push(`Mínimo de venta: ${min}`);
  // AC-SST-1: aviso, nunca bloquea.
  const sinStock = avisoSinStock(cantidad, stockDisponible);
  if (sinStock) avisos.push(sinStock);
  return avisos;
};
