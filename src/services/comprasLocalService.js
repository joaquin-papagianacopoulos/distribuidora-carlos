// src/services/comprasLocalService.js — REQ-CPR: escrituras LOCALES (offline-first) de pagos, cargos,
// anulaciones y pedidos al proveedor. Todo queda pendingSync y sube con subirCompras (PIN de admin).
// Nunca toca stock: recibir un pedido solo devuelve el formulario de Ingreso precargado.
import {
  getCuentaProveedores, putCuentaProveedoresRaw, getPedidosProveedor, putPedidosProveedorRaw,
} from '../db';
import { anularMovimiento, validarAdjunto } from '../domain/cuentaProveedores';
import {
  nuevoPedidoProveedor, agregarItems, marcarEnviado, marcarRecibido, vincularIngreso,
} from '../domain/pedidosProveedor';
import { encolarComprobante } from './comprasService';

/** Guarda un pago/cargo ya validado (validarMovimientoCuenta). El adjunto se valida ANTES de grabar. */
export const guardarMovimientoCuenta = async (mov, archivo = null) => {
  if (!mov || !mov.id) return { ok: false, mensaje: 'Movimiento inválido' };
  if (archivo) {
    const v = validarAdjunto(archivo);
    if (!v.ok) return { ok: false, mensaje: v.error };
  }
  await putCuentaProveedoresRaw([mov]);
  if (archivo) await encolarComprobante(mov.id, archivo);
  return { ok: true, mov };
};

/** AC-CPR-5: anula (no borra) un pago o cargo. */
export const anularMovimientoCuenta = async (id, { motivo, usuario = '', now = new Date() } = {}) => {
  const mov = ((await getCuentaProveedores()) || []).find(m => String(m.id) === String(id));
  const r = anularMovimiento(mov, { motivo, usuario, now });
  if (!r.ok) return r;
  await putCuentaProveedoresRaw([r.mov]);
  return r;
};

/** Último borrador del proveedor o uno nuevo. */
const borradorDe = (pedidos, proveedorId) => (pedidos || [])
  .filter(p => String(p.proveedorId) === String(proveedorId) && p.estado === 'borrador')
  .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0] || null;

/**
 * AC-CPR-4 / AC-STB-3: agrega renglones [{ productoId, cantidad, unidad, bultoX }] al borrador del
 * proveedor (lo crea si no hay). Suma si el producto ya estaba.
 */
export const agregarAlBorradorProveedor = async (proveedorId, items, { usuario = '', now = new Date(), genId } = {}) => {
  if (proveedorId === null || proveedorId === undefined || proveedorId === '') return { ok: false, mensaje: 'El producto no tiene proveedor asignado' };
  const existentes = (await getPedidosProveedor()) || [];
  const base = borradorDe(existentes, proveedorId) || nuevoPedidoProveedor(proveedorId, { usuario, now, ...(genId ? { genId } : {}) });
  const pedido = agregarItems(base, items, { now });
  if (pedido === base && !existentes.some(p => p.id === base.id)) {
    // Nada válido para agregar: no se crea un borrador vacío.
    return { ok: false, mensaje: 'No hay cantidades válidas para agregar' };
  }
  await putPedidosProveedorRaw([pedido]);
  return { ok: true, pedido };
};

export const guardarPedidoProveedor = async (pedido) => {
  if (!pedido?.id) return { ok: false };
  await putPedidosProveedorRaw([{ ...pedido, pendingSync: true }]);
  return { ok: true };
};

const buscar = async (id) => ((await getPedidosProveedor()) || []).find(p => String(p.id) === String(id)) || null;

export const marcarPedidoEnviado = async (id, { now = new Date() } = {}) => {
  const p = await buscar(id);
  if (!p) return { ok: false, mensaje: 'Pedido inexistente' };
  const nuevo = marcarEnviado(p, { now });
  if (nuevo !== p) await putPedidosProveedorRaw([nuevo]);
  return { ok: true, pedido: nuevo };
};

/** AC-CPR-4: marca recibido (terminal) y devuelve el Ingreso precargado. Idempotente. */
export const recibirPedidoProveedor = async (id, { now = new Date() } = {}) => {
  const p = await buscar(id);
  if (!p) return { ok: false, mensaje: 'Pedido inexistente' };
  const r = marcarRecibido(p, { now });
  if (!r.ok) return { ok: false, mensaje: r.error };
  if (r.pedido !== p) await putPedidosProveedorRaw([r.pedido]);
  return { ok: true, pedido: r.pedido, formIngreso: r.formIngreso };
};

/** Enlaza el ingreso confirmado con el pedido que lo originó. */
export const vincularPedidoConIngreso = async (pedidoId, ingresoId, { now = new Date() } = {}) => {
  const p = await buscar(pedidoId);
  if (!p) return { ok: false };
  const nuevo = vincularIngreso(p, ingresoId, { now });
  if (nuevo !== p) await putPedidosProveedorRaw([nuevo]);
  return { ok: true, pedido: nuevo };
};
