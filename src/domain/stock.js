// src/domain/stock.js — REQ-STK / REQ-ING: control de stock como libro de
// movimientos (ledger). Funciones puras: reciben datos, devuelven datos.
//
// Por qué ledger y no un número "stock" en el producto: la app es offline-first
// y multi-dispositivo. Si dos celulares descuentan stock sin conexión y después
// suben "stock = X", el último pisa al primero y se pierde un descuento. Con
// movimientos inmutables (UUID) cada descuento llega una sola vez y el stock es
// siempre la suma.
import { texto, toInt, claveUnica, nuevoId } from './validacion';

// 'advertir' = pide confirmación si queda stock negativo; 'bloquear' = no deja facturar.
export const STOCK_POLICY = 'advertir';

export const TIPOS_MOVIMIENTO = ['inicial', 'ajuste', 'ingreso', 'venta', 'anulacion'];

// Mismo tope que el CHECK de movimientos_stock en Supabase (S-12): lo que el
// dominio acepta, la base tambien lo acepta.
export const MAX_CANTIDAD = 1_000_000;

const keyProd = (id) => String(id);

// AC-STK-1: stock = Σ movimientos. Devuelve Map<productoId(string), number>.
export const calcularStock = (movimientos = []) => {
  const m = new Map();
  for (const mv of movimientos) {
    if (!mv || mv.productoId === undefined || mv.productoId === null) continue;
    const n = Number(mv.cantidad);
    if (!Number.isFinite(n)) continue;
    const k = keyProd(mv.productoId);
    m.set(k, (m.get(k) || 0) + n);
  }
  return m;
};

export const stockDe = (stockMap, productoId) => stockMap?.get(keyProd(productoId)) ?? 0;

// Referencias con las que un pedido pudo haber registrado movimientos.
export const refPedido = (pedido) =>
  (pedido?.remoteId ? `pedido:${pedido.remoteId}` : `pedido-local:${pedido?.id}`);
export const refsPedido = (pedido) => {
  const refs = [];
  if (pedido?.remoteId) refs.push(`pedido:${pedido.remoteId}`);
  if (pedido?.id !== undefined && pedido?.id !== null) refs.push(`pedido-local:${pedido.id}`);
  return refs;
};

const estaBorrado = (p) => !!p?.borrado || ['cancelado', 'eliminado', 'borrado'].includes(String(p?.estado || '').toLowerCase());

// Efecto que el pedido DEBERÍA tener sobre el stock: solo si está facturado.
export const efectoDeseado = (pedido) => {
  const m = new Map();
  if (!pedido || String(pedido.estado) !== 'facturado' || estaBorrado(pedido)) return m;
  for (const it of pedido.items || []) {
    const cant = Number(it?.cantidad);
    if (it?.productoId === undefined || it?.productoId === null || !Number.isFinite(cant) || cant <= 0) continue;
    const k = keyProd(it.productoId);
    m.set(k, (m.get(k) || 0) - cant);
  }
  return m;
};

/**
 * AC-STK-2..5: movimientos a registrar para que el stock refleje el estado
 * actual del pedido. Idempotente: compara contra lo ya registrado para ese
 * pedido y solo emite la diferencia.
 * S-BUL-09 (RUN 20261012-2106, iteracion 2): un delta no entero o con
 * |delta| > MAX_CANTIDAD (pedido legacy o adulterado) NO se emite: el
 * servidor lo rechazaria (integer, abs <= 1000000) y quedaria pendiente para
 * siempre trabando el sync. Se devuelve aparte en `invalidos` para avisar.
 * @returns {{ movimientos: object[], invalidos: Array<{ productoId: string, nombre: string, delta: number }> }}
 */
export const revisarMovimientosPedido = (pedido, movimientosExistentes = [], { usuario = '', now = new Date(), genId = nuevoId } = {}) => {
  const refs = new Set(refsPedido(pedido));
  const actual = calcularStock(movimientosExistentes.filter(mv => refs.has(mv.ref)));
  const deseado = efectoDeseado(pedido);
  const productos = new Set([...actual.keys(), ...deseado.keys()]);
  const nombres = new Map((pedido?.items || []).map(i => [keyProd(i.productoId), i.nombre]));
  const out = [];
  const invalidos = [];
  for (const k of productos) {
    const delta = (deseado.get(k) || 0) - (actual.get(k) || 0);
    if (delta === 0) continue;
    if (!Number.isInteger(delta) || Math.abs(delta) > MAX_CANTIDAD) {
      invalidos.push({ productoId: k, nombre: String(nombres.get(k) ?? ''), delta });
      continue;
    }
    out.push({
      id: genId(),
      productoId: k,
      cantidad: delta,
      tipo: delta < 0 ? 'venta' : 'anulacion',
      ref: refPedido(pedido),
      fecha: now.toISOString(),
      usuario: texto(usuario, 80),
      nota: texto(`${pedido?.clienteNombre || ''} ${nombres.get(k) ? `· ${nombres.get(k)}` : ''}`, 160),
    });
  }
  return { movimientos: out, invalidos };
};

/** Igual que revisarMovimientosPedido, pero solo los movimientos validos (contrato historico: array). */
export const movimientosParaPedido = (pedido, movimientosExistentes = [], opciones = {}) =>
  revisarMovimientosPedido(pedido, movimientosExistentes, opciones).movimientos;

/** Aviso para la pantalla/log de los renglones omitidos por S-BUL-09. */
export const mensajeMovimientosInvalidos = (invalidos = []) => {
  const lista = (Array.isArray(invalidos) ? invalidos : []).map(i => i?.nombre || i?.productoId).filter(Boolean);
  if (!lista.length) return '';
  return `No se movió el stock de: ${lista.join(', ')} (cantidad no entera o mayor a ${String(MAX_CANTIDAD).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}). Corregí la cantidad del pedido.`;
};

/**
 * AC-STK-6: productos que quedarían con stock negativo si se aplican `nuevos`.
 */
export const verificarStock = (nuevos = [], stockMap = new Map(), productos = []) => {
  const delta = calcularStock(nuevos);
  const nombre = new Map(productos.map(p => [keyProd(p.id), p.nombre]));
  const faltantes = [];
  for (const [k, d] of delta) {
    if (d >= 0) continue;
    const disponible = stockDe(stockMap, k);
    const resultante = disponible + d;
    if (resultante < 0) faltantes.push({ productoId: k, nombre: nombre.get(k) || k, disponible, requerido: -d, resultante });
  }
  return faltantes;
};

export const decidirFacturacion = (faltantes, policy = STOCK_POLICY) => {
  if (!faltantes.length) return 'ok';
  return policy === 'bloquear' ? 'bloquear' : 'confirmar';
};

// AC-PROD-3: stock inicial / ajuste de inventario.
export const movimientoAjuste = (productoId, stockActual, stockNuevo, { usuario = '', now = new Date(), genId = nuevoId, inicial = false } = {}) => {
  const nuevo = toInt(stockNuevo);
  if (nuevo === null || nuevo < 0 || nuevo > MAX_CANTIDAD) throw new Error(`Stock inválido: entero entre 0 y ${MAX_CANTIDAD}`);
  const delta = nuevo - (Number(stockActual) || 0);
  if (delta === 0) return null;
  if (Math.abs(delta) > MAX_CANTIDAD) throw new Error('Ajuste demasiado grande: hacelo en dos pasos');
  return {
    id: genId(), productoId: keyProd(productoId), cantidad: delta,
    tipo: inicial ? 'inicial' : 'ajuste', ref: `ajuste:${keyProd(productoId)}`,
    fecha: now.toISOString(), usuario: texto(usuario, 80),
    nota: inicial ? 'Stock inicial' : `Ajuste de ${Number(stockActual) || 0} a ${nuevo}`,
  };
};

/**
 * REQ-ING: valida un ingreso de mercadería y devuelve cabecera + movimientos.
 * items: [{ productoId, ingreso }]
 */
export const validarIngreso = (form = {}, { productos = [], proveedores = [], ingresosExistentes = [], stockMap = new Map(), usuario = '', now = new Date(), genId = nuevoId } = {}) => {
  const errores = {};
  const factura = texto(form.facturaProveedor, 40);
  const proveedorId = form.proveedorId ? String(form.proveedorId) : '';
  const proveedor = proveedores.find(p => p.id === proveedorId);

  if (!factura) errores.facturaProveedor = 'La factura del proveedor es obligatoria';
  if (!proveedorId) errores.proveedorId = 'Elegí el proveedor';
  else if (!proveedor) errores.proveedorId = 'Proveedor inexistente';

  // AC-ING-4: misma factura del mismo proveedor no se ingresa dos veces.
  if (factura && proveedorId && ingresosExistentes.some(i => i.proveedorId === proveedorId && claveUnica(i.facturaProveedor) === claveUnica(factura))) {
    errores.facturaProveedor = 'Esa factura de ese proveedor ya fue ingresada';
  }

  const items = Array.isArray(form.items) ? form.items : [];
  if (items.length === 0) errores.items = 'Agregá al menos un producto';
  const vistos = new Set();
  const prodById = new Map(productos.map(p => [keyProd(p.id), p]));
  const renglones = [];
  // Los errores de renglon se indexan por producto (`item:<productoId>`) y no
  // por posicion: si el usuario quita un renglon, el error no "salta" al
  // siguiente producto (bug B5 del QA).
  items.forEach((it) => {
    const k = keyProd(it?.productoId);
    const ek = `item:${k}`;
    const prod = prodById.get(k);
    if (!prod) { errores[ek] = 'Producto inexistente'; return; }
    if (vistos.has(k)) { errores[ek] = `"${prod.nombre}" está repetido`; return; }
    vistos.add(k);
    const ingreso = toInt(it?.ingreso);
    if (ingreso === null || ingreso <= 0 || ingreso > MAX_CANTIDAD) { errores[ek] = `Ingreso inválido para "${prod.nombre}" (entero entre 1 y ${MAX_CANTIDAD})`; return; }
    const stockActual = stockDe(stockMap, k);
    renglones.push({ productoId: k, codigo: prod.codigo || '', descripcion: prod.nombre, stockActual, ingreso, stockTotal: stockActual + ingreso });
  });

  if (Object.keys(errores).length) return { ok: false, errores };

  const id = genId();
  const fecha = now.toISOString();
  const cabecera = {
    id, facturaProveedor: factura, proveedorId, proveedorNombre: proveedor.descripcion,
    fecha, usuario: texto(usuario, 80), items: renglones,
  };
  const movimientos = renglones.map(r => ({
    id: genId(), productoId: r.productoId, cantidad: r.ingreso, tipo: 'ingreso',
    ref: `ingreso:${id}`, fecha, usuario: texto(usuario, 80),
    nota: `Fact. ${factura} · ${proveedor.descripcion}`,
  }));
  return { ok: true, errores: {}, ingreso: cabecera, movimientos };
};

// AC-STK-7: productos con stock bajo (≤ mínimo de venta).
export const productosStockBajo = (productos = [], stockMap = new Map()) =>
  productos
    .map(p => ({ ...p, stock: stockDe(stockMap, p.id) }))
    .filter(p => p.stock <= (Number(p.minimoVenta) || 0));

export const movimientoToRemote = (m) => ({
  id: m.id, producto_id: String(m.productoId), cantidad: Number(m.cantidad), tipo: m.tipo,
  ref: m.ref, fecha: m.fecha, usuario: m.usuario || null, nota: m.nota || null,
});
export const movimientoFromRemote = (r) => ({
  id: r.id, productoId: String(r.producto_id), cantidad: Number(r.cantidad), tipo: r.tipo,
  ref: r.ref, fecha: r.fecha, usuario: r.usuario || '', nota: r.nota || '', pendingSync: false,
});
export const ingresoToRemote = (i) => ({
  id: i.id, factura_proveedor: i.facturaProveedor, proveedor_id: i.proveedorId,
  proveedor_nombre: i.proveedorNombre, fecha: i.fecha, usuario: i.usuario || null, items: i.items,
});
export const ingresoFromRemote = (r) => ({
  id: r.id, facturaProveedor: r.factura_proveedor, proveedorId: r.proveedor_id,
  proveedorNombre: r.proveedor_nombre || '', fecha: r.fecha, usuario: r.usuario || '',
  items: Array.isArray(r.items) ? r.items : [], pendingSync: false,
});
