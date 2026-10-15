// src/domain/pedidosProveedor.js — REQ-CPR AC-CPR-4: pedidos al proveedor (listas de reposición).
// Funciones puras. Flujo: borrador -> enviado -> recibido (terminal). Al recibir se precarga un
// Ingreso de mercadería; el ingreso lo confirma el admin a mano (AC-ING-4 evita duplicar la factura).
import { texto, toInt, nuevoId } from './validacion';
import { normalizarBultoX } from './bultos';
import { MAX_CANTIDAD } from './stock';

export const ESTADOS_PEDIDO_PROVEEDOR = Object.freeze(['borrador', 'enviado', 'recibido']);
export const UNIDADES_PEDIDO = Object.freeze(['u', 'bulto']);

const k = (id) => String(id);

export const nuevoPedidoProveedor = (proveedorId, { usuario = '', now = new Date(), genId = nuevoId } = {}) => ({
  id: genId(),
  proveedorId: k(proveedorId),
  estado: 'borrador',
  items: [],
  ingresoId: null,
  usuario: texto(usuario, 80),
  creadoAt: now.getTime(),
  updatedAt: now.getTime(),
  pendingSync: true,
});

// Cantidad en unidades: en bultos = cantidad x unidades por bulto (bultoX <= 1 => unidades).
export const unidadesItem = (item) => {
  const cant = toInt(item?.cantidad);
  if (cant === null || cant <= 0) return 0;
  if (item?.unidad === 'bulto') {
    const bx = normalizarBultoX(item?.bultoX);
    return bx ? cant * bx : cant;
  }
  return cant;
};

// Renglón válido o null. Cantidad entera 1..MAX_CANTIDAD; unidad 'u' | 'bulto' ('bulto' sin bultoX > 1 pasa a 'u').
export const normalizarItemPedido = (it) => {
  if (!it || it.productoId === undefined || it.productoId === null || String(it.productoId) === '') return null;
  const cantidad = toInt(it.cantidad);
  if (cantidad === null || cantidad <= 0 || cantidad > MAX_CANTIDAD) return null;
  const bultoX = normalizarBultoX(it.bultoX);
  const unidad = it.unidad === 'bulto' && bultoX ? 'bulto' : 'u';
  return { productoId: k(it.productoId), cantidad, unidad, bultoX: bultoX || null };
};

const editable = (p) => p && (p.estado === 'borrador' || p.estado === 'enviado');

const tocar = (pedido, items, now) => ({ ...pedido, items, updatedAt: now.getTime(), pendingSync: true });

/** Agrega renglones; si el producto ya estaba, suma (en unidades si las unidades difieren). Inválidos se ignoran. */
export const agregarItems = (pedido, items = [], { now = new Date() } = {}) => {
  if (!editable(pedido)) return pedido;
  const lista = [...(Array.isArray(pedido.items) ? pedido.items : [])];
  let cambio = false;
  for (const crudo of Array.isArray(items) ? items : []) {
    const it = normalizarItemPedido(crudo);
    if (!it) continue;
    cambio = true;
    const i = lista.findIndex(x => x.productoId === it.productoId);
    if (i < 0) { lista.push(it); continue; }
    const ant = lista[i];
    let nuevo;
    if (ant.unidad === it.unidad && (ant.unidad === 'u' || ant.bultoX === it.bultoX)) {
      nuevo = { ...ant, cantidad: ant.cantidad + it.cantidad };
    } else {
      nuevo = { productoId: it.productoId, cantidad: unidadesItem(ant) + unidadesItem(it), unidad: 'u', bultoX: it.bultoX || ant.bultoX };
    }
    if (nuevo.cantidad > MAX_CANTIDAD) nuevo.cantidad = MAX_CANTIDAD;
    lista[i] = nuevo;
  }
  return cambio ? tocar(pedido, lista, now) : pedido;
};

/** Reemplaza cantidad/unidad de un renglón existente (edición desde la pantalla). Inválido => sin cambios. */
export const fijarItem = (pedido, item, { now = new Date() } = {}) => {
  if (!editable(pedido)) return pedido;
  const it = normalizarItemPedido(item);
  if (!it) return pedido;
  const items = (pedido.items || []).map(x => (x.productoId === it.productoId ? { ...it, bultoX: it.bultoX || x.bultoX || null } : x));
  return tocar(pedido, items, now);
};

export const quitarItem = (pedido, productoId, { now = new Date() } = {}) => {
  if (!editable(pedido)) return pedido;
  const items = (pedido.items || []).filter(x => x.productoId !== k(productoId));
  return items.length === (pedido.items || []).length ? pedido : tocar(pedido, items, now);
};

export const marcarEnviado = (pedido, { now = new Date() } = {}) => {
  if (!pedido || pedido.estado === 'recibido') return pedido;
  if (pedido.estado === 'enviado') return pedido;
  return { ...pedido, estado: 'enviado', updatedAt: now.getTime(), pendingSync: true };
};

/**
 * AC-CPR-4: marca recibido y devuelve el formulario de Ingreso precargado (cantidades en unidades).
 * Idempotente: sobre un pedido ya recibido devuelve ok con el mismo pedido y el mismo formulario.
 */
export const marcarRecibido = (pedido, { now = new Date() } = {}) => {
  if (!pedido || typeof pedido !== 'object') return { ok: false, error: 'Pedido inexistente', pedido: null, formIngreso: null };
  const items = (Array.isArray(pedido.items) ? pedido.items : []).filter(x => unidadesItem(x) > 0);
  if (!items.length) return { ok: false, error: 'El pedido no tiene productos', pedido, formIngreso: null };
  const formIngreso = {
    proveedorId: k(pedido.proveedorId),
    pedidoProveedorId: pedido.id,
    items: items.map(x => ({ productoId: x.productoId, ingreso: unidadesItem(x) })),
  };
  if (pedido.estado === 'recibido') return { ok: true, error: '', pedido, formIngreso };
  if (!ESTADOS_PEDIDO_PROVEEDOR.includes(pedido.estado)) return { ok: false, error: 'Estado inválido', pedido, formIngreso: null };
  return { ok: true, error: '', pedido: { ...pedido, estado: 'recibido', updatedAt: now.getTime(), pendingSync: true }, formIngreso };
};

/** Vincula el ingreso confirmado con el pedido (no cambia el estado). */
export const vincularIngreso = (pedido, ingresoId, { now = new Date() } = {}) =>
  (!pedido || !ingresoId || pedido.ingresoId === String(ingresoId)
    ? pedido
    : { ...pedido, ingresoId: String(ingresoId), updatedAt: now.getTime(), pendingSync: true });

const etiquetaItem = (it, prod) => {
  const nombre = prod ? `${prod.codigo ? `${prod.codigo} - ` : ''}${prod.nombre}` : `Producto ${it.productoId}`;
  const cant = it.unidad === 'bulto'
    ? `${it.cantidad} ${it.cantidad === 1 ? 'bulto' : 'bultos'} (${unidadesItem(it)} u.)`
    : `${it.cantidad} u.`;
  return `- ${nombre}: ${cant}`;
};

/** Texto para compartir por WhatsApp (sin precios ni costos). */
export const textoCompartirPedido = (pedido, productos = [], proveedor = null) => {
  const porId = new Map((Array.isArray(productos) ? productos : []).map(p => [k(p.id), p]));
  const nombre = proveedor?.descripcion || proveedor?.nombre || '';
  const lineas = (pedido?.items || []).map(it => etiquetaItem(it, porId.get(k(it.productoId))));
  return [`Pedido${nombre ? ` para ${nombre}` : ''}`, ...lineas].join('\n');
};

// ---- Mapeos remotos (tabla pedidos_proveedor, migración 012) ----
const iso = (ms) => new Date(Number(ms) || Date.now()).toISOString();
const msDe = (v) => { const t = new Date(v).getTime(); return Number.isNaN(t) ? 0 : t; };

export const pedidoProveedorToRemote = (p = {}) => ({
  id: p.id,
  proveedor_id: k(p.proveedorId),
  estado: p.estado,
  items: (Array.isArray(p.items) ? p.items : []).map(x => ({ producto_id: k(x.productoId), cantidad: x.cantidad, unidad: x.unidad, bulto_x: x.bultoX || null })),
  ingreso_id: p.ingresoId || null,
  usuario: p.usuario || null,
  creado_at: iso(p.creadoAt),
  updated_at: iso(p.updatedAt),
});

export const pedidoProveedorFromRemote = (r = {}) => ({
  id: r.id,
  proveedorId: k(r.proveedor_id),
  estado: ESTADOS_PEDIDO_PROVEEDOR.includes(r.estado) ? r.estado : 'borrador',
  items: (Array.isArray(r.items) ? r.items : []).map(normalizarItemPedidoRemoto).filter(Boolean),
  ingresoId: r.ingreso_id || null,
  usuario: r.usuario || '',
  creadoAt: msDe(r.creado_at),
  updatedAt: msDe(r.updated_at),
  pendingSync: false,
});

function normalizarItemPedidoRemoto(x) {
  return normalizarItemPedido({ productoId: x?.producto_id, cantidad: x?.cantidad, unidad: x?.unidad, bultoX: x?.bulto_x });
}
