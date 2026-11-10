// src/domain/pedidosPendientes.js — REQ-PEN: pedidos no facturados de cualquier fecha.
// Funciones puras: sin React, sin IndexedDB, sin Supabase.
import { normalizePedidoFecha, isPedidoOculto } from '../utils/pedidos';

const MS_DIA = 86400000;
const aUTC = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};

export function etiquetaDias(dias) {
  if (dias === null) return 'Sin fecha';
  if (dias === 0) return 'Para hoy';
  const n = Math.abs(dias);
  const u = n === 1 ? 'día' : 'días';
  return dias > 0 ? `Faltan ${n} ${u}` : `Hace ${n} ${u}`;
}

// AC-PEN-1: pedidos no facturados (ni borrados) de cualquier fecha distinta de `hoy` (los de hoy ya
// están en la lista). Sin los pedidos web no aceptados (viven en la bandeja). Sin duplicados
// (por remoteId o id). Orden por fecha ascendente. dias: + faltan, − pasaron.
export function pedidosPendientesVisibles(pedidos, hoy) {
  const hoyISO = normalizePedidoFecha(hoy);
  const base = aUTC(hoyISO);
  const vistos = new Set();
  const out = [];
  for (const p of Array.isArray(pedidos) ? pedidos : []) {
    if (!p || typeof p !== 'object') continue;
    if (isPedidoOculto(p)) continue;
    if (String(p.estado || '').toLowerCase() === 'facturado') continue;
    const fecha = normalizePedidoFecha(p.fecha) || '';
    if (fecha && fecha === hoyISO) continue;
    const clave = p.remoteId !== undefined && p.remoteId !== null && p.remoteId !== '' ? `r:${p.remoteId}` : `l:${p.id}`;
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    const f = aUTC(fecha);
    const dias = f === null || base === null ? null : Math.round((f - base) / MS_DIA);
    out.push({ pedido: p, fecha, dias, etiqueta: etiquetaDias(dias) });
  }
  return out.sort((a, b) => (a.fecha === b.fecha ? 0 : (!a.fecha ? 1 : (!b.fecha ? -1 : (a.fecha < b.fecha ? -1 : 1)))));
}
