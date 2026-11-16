// src/domain/reparto.js — REQ-REP (Lote 2026-11-16): una sola lista con todos los pedidos
// pendientes de entrega (de cualquier fecha) para ELEGIR cuáles salen a reparto.
// Funciones puras: sin React, sin IndexedDB, sin Supabase.
import { isPedidoOculto, normalizePedidoFecha } from '../utils/pedidos';

// Días hacia atrás que se muestran por defecto (se puede cambiar en pantalla).
export const DIAS_REPARTO_POR_DEFECTO = 30;

const clavePedido = (p) => (p.remoteId !== undefined && p.remoteId !== null && p.remoteId !== '' ? `r:${p.remoteId}` : `l:${p.id}`);
const alpha = (a, b) => String(a || '').localeCompare(String(b || ''), 'es', { sensitivity: 'base' });

// AC-REP-1: pedidos visibles que todavía NO fueron entregados, de cualquier fecha (>= `desde` si se
// pasa). Sin borrados ni pedidos web sin aceptar; sin duplicados (por remoteId o id, gana el más nuevo).
// Orden: fecha del pedido (los más viejos primero) y después cliente.
export function pedidosPendientesEntrega(pedidos, { desde = null } = {}) {
  const piso = desde ? normalizePedidoFecha(desde) : '';
  const dedup = new Map();
  for (const p of Array.isArray(pedidos) ? pedidos : []) {
    if (!p || typeof p !== 'object') continue;
    if (isPedidoOculto(p)) continue;
    if (p.entregado === true) continue;
    const fecha = normalizePedidoFecha(p.fecha) || '';
    if (piso && fecha && fecha < piso) continue;
    const k = clavePedido(p);
    const prev = dedup.get(k);
    if (!prev || Number(p.updatedAt || p.createdAt || 0) >= Number(prev.updatedAt || prev.createdAt || 0)) dedup.set(k, p);
  }
  return [...dedup.values()].sort((a, b) => {
    const fa = normalizePedidoFecha(a.fecha) || '';
    const fb = normalizePedidoFecha(b.fecha) || '';
    if (fa !== fb) return fa < fb ? -1 : 1;
    return alpha(a.clienteNombre, b.clienteNombre) || String(a.id).localeCompare(String(b.id));
  });
}

// Clave de selección de un pedido (la misma que usa la lista).
export const claveSeleccionPedido = (p) => (p && typeof p === 'object' ? clavePedido(p) : '');

// AC-REP-2: de la lista de pendientes, los que el usuario tildó (en el orden de la lista).
export function pedidosSeleccionados(pendientes, seleccion) {
  const sel = seleccion instanceof Set ? seleccion : new Set(Array.isArray(seleccion) ? seleccion : []);
  return (Array.isArray(pendientes) ? pendientes : []).filter(p => sel.has(clavePedido(p)));
}

// Estado corto del pedido para la lista de reparto.
export function estadoReparto(p) {
  if (!p || typeof p !== 'object') return '';
  const partes = [];
  partes.push(String(p.estado || '').toLowerCase() === 'facturado' ? 'Facturado' : 'Sin facturar');
  if (p.aReparto) partes.push('A reparto');
  else if (p.armado) partes.push('Armado');
  else partes.push('Sin armar');
  return partes.join(' · ');
}
