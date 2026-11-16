// src/domain/ruta.js — REQ-RUT (Lote 2026-11-16): "Mi ruta" de entrega armada a mano.
// El cliente elige, en el momento, QUE pedidos pendientes salen y en QUE orden. La ruta es una lista
// de claves de pedido (`r:<remoteId>` o `l:<id>`, ver reparto.js) en el orden de entrega.
// Funciones puras: sin React, sin IndexedDB, sin Supabase. Nunca mutan lo que reciben.
import { claveSeleccionPedido } from './reparto';
import { calcularOrdenPorZona } from './zonas';

export const MAX_RUTA = 500;

// Lista de claves sin repetidos ni basura, con tope.
export function normalizarRuta(ruta) {
  const out = [];
  const vistos = new Set();
  for (const k of Array.isArray(ruta) ? ruta : []) {
    if (typeof k !== 'string' || !k || vistos.has(k)) continue;
    vistos.add(k);
    out.push(k);
    if (out.length >= MAX_RUTA) break;
  }
  return out;
}

// Deja solo las claves que siguen siendo pedidos pendientes (un pedido entregado o borrado sale solo).
export function rutaVigente(ruta, pedidosPorClave) {
  const hay = pedidosPorClave instanceof Map ? pedidosPorClave : new Map();
  return normalizarRuta(ruta).filter(k => hay.has(k));
}

// Pedidos de la ruta en su orden, listos para mostrar o imprimir.
export function pedidosDeRuta(ruta, pedidosPorClave) {
  const hay = pedidosPorClave instanceof Map ? pedidosPorClave : new Map();
  return rutaVigente(ruta, hay).map(k => hay.get(k));
}

// Agrega al FINAL (el siguiente en la ruta). Si ya estaba, no cambia nada.
export function agregarARuta(ruta, clave) {
  const r = normalizarRuta(ruta);
  if (typeof clave !== 'string' || !clave || r.includes(clave) || r.length >= MAX_RUTA) return r;
  return [...r, clave];
}

// Agrega varias (en el orden recibido) sin repetir.
export function agregarVariosARuta(ruta, claves) {
  return (Array.isArray(claves) ? claves : []).reduce((acc, k) => agregarARuta(acc, k), normalizarRuta(ruta));
}

export function quitarDeRuta(ruta, clave) {
  return normalizarRuta(ruta).filter(k => k !== clave);
}

// Mueve el elemento de la posicion `desde` a `hasta` (indices desde 0; `hasta` se ajusta a 0..n-1).
export function moverEnRuta(ruta, desde, hasta) {
  const r = normalizarRuta(ruta);
  if (!Number.isInteger(desde) || desde < 0 || desde >= r.length) return r;
  const destino = Math.min(Math.max(Number.isFinite(hasta) ? Math.trunc(hasta) : desde, 0), r.length - 1);
  if (destino === desde) return r;
  const [mov] = r.splice(desde, 1);
  r.splice(destino, 0, mov);
  return r;
}

// Mueve una clave al puesto escrito por el usuario (1..n; fuera de rango se ajusta).
export function moverAPuesto(ruta, clave, puesto) {
  const r = normalizarRuta(ruta);
  const n = Number(puesto);
  const desde = r.indexOf(clave);
  if (desde < 0 || !Number.isFinite(n)) return r;
  return moverEnRuta(r, desde, Math.floor(n) - 1);
}

export const subirEnRuta = (ruta, clave) => {
  const r = normalizarRuta(ruta);
  const i = r.indexOf(clave);
  return i <= 0 ? r : moverEnRuta(r, i, i - 1);
};

export const bajarEnRuta = (ruta, clave) => {
  const r = normalizarRuta(ruta);
  const i = r.indexOf(clave);
  return i < 0 || i >= r.length - 1 ? r : moverEnRuta(r, i, i + 1);
};

export const invertirRuta = (ruta) => normalizarRuta(ruta).reverse();

// Atajo: ordena la ruta por zona y por el puesto fijo de cada cliente en su zona (el criterio de antes).
// El usuario despues la retoca a mano. Pedidos de clientes sin zona van al final.
export function ordenarRutaPorZona(ruta, pedidosPorClave, clientes) {
  const pedidos = pedidosDeRuta(ruta, pedidosPorClave);
  const grupos = calcularOrdenPorZona(pedidos, clientes || []);
  return grupos.flatMap(g => g.pedidos.map(x => claveSeleccionPedido(x.pedido)));
}

// Un solo grupo "Ruta" numerado 1..n en el orden de la ruta (misma forma que calcularOrdenPorZona,
// asi sirve tal cual para filasHojaRuta y para numerar los remitos).
export function grupoDeRuta(pedidosEnOrden, etiqueta = 'Ruta del día') {
  const lista = (Array.isArray(pedidosEnOrden) ? pedidosEnOrden : []).filter(Boolean);
  return [{ clave: '', etiqueta, pedidos: lista.map((pedido, i) => ({ pedido, orden: i + 1 })) }];
}

// Link para abrir la direccion en Google Maps (solo texto de la direccion y localidad; null si no hay).
export function enlaceMapa(direccion, localidad = '') {
  const d = String(direccion || '').replace(/\s+/g, ' ').trim();
  if (!d) return null;
  const l = String(localidad || '').replace(/\s+/g, ' ').trim();
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(l ? `${d}, ${l}` : d)}`;
}

// ---- Persistencia local (en el dispositivo): se guarda como texto JSON ----
export const claveAlmacenRuta = (usuario) => `rutaEntrega:${usuario?.remoteId ?? usuario?.id ?? usuario?.nombre ?? 'default'}`;

export function leerRutaGuardada(texto) {
  if (typeof texto !== 'string' || !texto) return [];
  try {
    const p = JSON.parse(texto);
    return normalizarRuta(p && p.version === 1 ? p.ruta : []);
  } catch (e) {
    return [];
  }
}

export const serializarRuta = (ruta) => JSON.stringify({ version: 1, ruta: normalizarRuta(ruta), actualizado: Date.now() });
