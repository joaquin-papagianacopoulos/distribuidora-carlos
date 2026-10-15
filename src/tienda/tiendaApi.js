// src/tienda/tiendaApi.js — único acceso a Supabase de la tienda pública (REQ-TIE).
// Solo usa RPC públicas security definer (tienda_catalogo, tienda_portada, tienda_crear_pedido);
// nunca .from(): el rol anon no lee ni escribe tablas directamente.
import { supabase } from '../lib/supabase';

export const MENSAJES_ERROR = {
  limite: 'Hiciste varios pedidos en poco tiempo. Probá de nuevo en un rato.',
  tope: 'El pedido supera los límites permitidos. Probá dividirlo en dos.',
  invalido: 'No pudimos procesar el pedido. Revisá los datos e intentá de nuevo.',
  red: 'No pudimos conectarnos. Tu carrito sigue guardado: probá de nuevo.',
};

export async function cargarCatalogo() {
  try {
    const { data, error } = await supabase.rpc('tienda_catalogo');
    if (error || !data || data.ok === false) return { ok: false, mensaje: 'No pudimos cargar el catálogo. Probá de nuevo.' };
    return { ok: true, productos: Array.isArray(data.productos) ? data.productos : [], config: data.config || {} };
  } catch {
    return { ok: false, mensaje: 'No pudimos cargar el catálogo. Probá de nuevo.' };
  }
}

// REQ-POR (AC-POR-5): portada y personalización. Si falla (o falta la migración 009),
// la tienda sigue andando con los valores por defecto.
export async function cargarPortada() {
  try {
    const { data, error } = await supabase.rpc('tienda_portada');
    if (error || !data || data.ok === false) return { ok: false, config: {}, banners: [], ofertas: [] };
    return { ok: true, config: data.config || {}, banners: Array.isArray(data.banners) ? data.banners : [], ofertas: Array.isArray(data.ofertas) ? data.ofertas : [] };
  } catch {
    return { ok: false, config: {}, banners: [], ofertas: [] };
  }
}

// Devuelve { ok:true, pedidoId, total, renglones } | { ok:false, motivo, mensaje, carrito? }.
export async function crearPedido(payload) {
  try {
    const { data, error } = await supabase.rpc('tienda_crear_pedido', { p: payload });
    if (error || !data || typeof data !== 'object') return { ok: false, motivo: 'red', mensaje: MENSAJES_ERROR.red };
    if (data.ok === true) return { ok: true, pedidoId: data.pedidoId, total: data.total, renglones: data.renglones || [], repetido: !!data.repetido };
    const motivo = ['limite', 'tope', 'invalido', 'cambio'].includes(data.motivo) ? data.motivo : 'invalido';
    return { ok: false, motivo, mensaje: MENSAJES_ERROR[motivo] || MENSAJES_ERROR.invalido, carrito: data.carrito || null };
  } catch {
    return { ok: false, motivo: 'red', mensaje: MENSAJES_ERROR.red };
  }
}
