// src/domain/productos.js — REQ-PROD: alta de productos y cálculo de precios.
import { texto, toNum, toInt, redondear2, claveUnica } from './validacion';
import { normalizarRubro, resolverRubro } from './rubros';
import { resolverMarca, normalizarMarca } from './marcas';
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
  { key: 'precio', label: 'Precio venta 1', tipo: 'number', prefijo: '$' },
  { key: 'precioVenta2', label: 'Precio venta 2', tipo: 'number', prefijo: '$' },
  { key: 'bultoX', label: 'Bulto x', tipo: 'number' },
  // AC-VTA-1: unidad de venta. El precio cargado es siempre por unidad.
  { key: 'ventaPor', label: 'Se vende por', opciones: VENTA_POR.map(v => ({ value: v, label: v.charAt(0).toUpperCase() + v.slice(1) })), tipo: 'ventaPor' },
  { key: 'bultoNombre', label: 'Etiqueta del bulto', opciones: BULTO_NOMBRES, tipo: 'bultoNombre' },
  { key: 'visibleTienda', label: 'Mostrar en tienda', tipo: 'booleano' },
  { key: 'minimoVenta', label: 'Mínimo venta', tipo: 'number' },
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
  if (calculado > MAX_IMPORTE) errores.precio = 'Precio venta 1 demasiado alto';
  const precioManual = form.precio === '' || form.precio == null ? null : toNum(form.precio);
  if (form.precio !== '' && form.precio != null && (precioManual === null || precioManual < 0 || precioManual > MAX_IMPORTE)) {
    errores.precio = 'Precio venta 1 inválido';
  }
  p.precio = precioManual !== null && precioManual >= 0 ? redondear2(precioManual) : calculado;

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

export const productoExtraToRemote = (p = {}) => ({
  proveedor_id: p.proveedorId || null,
  costo_final: Number(p.costoFinal) || 0,
  descuento1: Number(p.descuento1) || 0,
  descuento2: Number(p.descuento2) || 0,
  ganancia: Number(p.ganancia) || 0,
  precio_venta2: Number(p.precioVenta2) || 0,
  bulto_x: Number(p.bultoX) || 1,
  minimo_venta: Number(p.minimoVenta) || 1,
});

// AC-VTA-5: columnas de la migración 006 (aparte de las de la 001 para poder escalonar el sync).
export const productoVentaToRemote = (p = {}) => ({
  venta_por: ventaPorEfectivo(p),
  bulto_nombre: normalizarBultoNombre(p.bultoNombre),
  visible_tienda: parsearBooleano(p.visibleTienda) === false ? false : true,
});

export const productoExtraFromRemote = (r = {}, local = {}) => {
  const pick = (col, key, def) => (r[col] !== undefined ? (r[col] ?? def) : (local?.[key] ?? def));
  return {
    proveedorId: pick('proveedor_id', 'proveedorId', null),
    costoFinal: Number(pick('costo_final', 'costoFinal', 0)),
    descuento1: Number(pick('descuento1', 'descuento1', 0)),
    descuento2: Number(pick('descuento2', 'descuento2', 0)),
    ganancia: Number(pick('ganancia', 'ganancia', 0)),
    precioVenta2: Number(pick('precio_venta2', 'precioVenta2', 0)),
    bultoX: Number(pick('bulto_x', 'bultoX', 1)),
    minimoVenta: Number(pick('minimo_venta', 'minimoVenta', 1)),
    // AC-VTA-5: columna ausente (sin 006) => valor local => default derivado.
    ventaPor: pick('venta_por', 'ventaPor', undefined),
    bultoNombre: normalizarBultoNombre(pick('bulto_nombre', 'bultoNombre', 'Bulto')),
    visibleTienda: pick('visible_tienda', 'visibleTienda', true) !== false,
  };
};

// AC-PROD-4: avisos al cargar un pedido (no bloquean la venta).
export const avisosItemPedido = (producto, cantidad, stockDisponible) => {
  const avisos = [];
  const min = Number(producto?.minimoVenta) || 1;
  if (Number(cantidad) < min) avisos.push(`Mínimo de venta: ${min}`);
  if (stockDisponible !== undefined && stockDisponible !== null && Number(cantidad) > stockDisponible) {
    avisos.push(`Stock disponible: ${stockDisponible}`);
  }
  return avisos;
};
