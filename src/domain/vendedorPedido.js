// src/domain/vendedorPedido.js — REQ-ASV: de quién es un pedido y quién lo cargó.
// Funciones puras: sin React, sin IndexedDB, sin Supabase.
import { texto, claveUnica } from './validacion';
import { filtrarActivos } from './vendedores';

export const MAX_VENDEDOR_ID = 64;
export const MAX_CARGADO_POR = 80;

// Dueño del pedido (el que cobra la comisión). '' o 'WEB' (pedidos del carrito/tienda
// sin link de vendedor) = sin vendedor => null. AC-ASV-2.
export function vendedorDelPedido(p) {
  const n = texto(p && (p.vendedor || p.vendedorNombre), MAX_CARGADO_POR);
  if (!n || claveUnica(n) === 'web') return null;
  return n;
}

export const esSinVendedor = (p) => vendedorDelPedido(p) === null;

const idDe = (v) => {
  const x = v && (v.remoteId ?? v.id);
  return x === undefined || x === null || x === '' ? null : x;
};

const buscar = (elegido, lista) => {
  if (elegido === undefined || elegido === null || elegido === '') return null;
  const porObjeto = elegido && typeof elegido === 'object';
  const nombre = porObjeto ? elegido.nombre : null;
  const clave = nombre ? claveUnica(nombre) : null;
  return lista.find((v) => {
    if (!v || typeof v !== 'object') return false;
    if (porObjeto) {
      if (idDe(elegido) !== null && idDe(v) !== null && String(idDe(v)) === String(idDe(elegido))) return true;
      return clave !== null && claveUnica(v.nombre) === clave;
    }
    const s = String(elegido);
    return String(v.remoteId ?? '') === s || String(v.id ?? '') === s || claveUnica(v.nombre) === claveUnica(s);
  }) || null;
};

// AC-ASV-1: campos del pedido nuevo. `elegido` = id, nombre o vendedor de la lista; vacío = el
// mismo que carga. Tiene que estar activo. Se guarda quién lo cargó (cargadoPor) y de quién es.
export function datosVendedorAlCrear({ vendedorActual, elegido, vendedores } = {}) {
  const actual = vendedorActual && typeof vendedorActual === 'object' ? vendedorActual : {};
  const nombreActual = texto(actual.nombre, MAX_CARGADO_POR);
  const activos = filtrarActivos(vendedores);
  let duenio = actual;
  const vacio = elegido === undefined || elegido === null || elegido === '';
  if (!vacio) {
    const hallado = buscar(elegido, activos);
    if (!hallado) return { ok: false, error: 'El vendedor elegido no está activo', campos: null };
    duenio = hallado;
  }
  const nombre = texto(duenio.nombre, MAX_CARGADO_POR);
  if (!nombre) return { ok: false, error: 'Elegí el vendedor del pedido', campos: null };
  return {
    ok: true,
    error: null,
    campos: {
      vendedor: nombre,
      vendedorNombre: nombre,
      vendedorId: idDe(duenio),
      cargadoPor: nombreActual || nombre,
      cargadoPorId: actual.id ?? null,
    },
  };
}

// AC-ASV-2: el admin asigna (o cambia) el vendedor de un pedido existente. Cambia también la zona
// si el vendedor tiene una (como hacía la lista para los pedidos web).
export function asignarVendedor(pedido, vendedor, { usuario, now = Date.now() } = {}) {
  const nombre = texto(vendedor && vendedor.nombre, MAX_CARGADO_POR);
  if (!pedido || !nombre) return pedido;
  const quien = texto(usuario && usuario.nombre, MAX_CARGADO_POR);
  return {
    ...pedido,
    vendedor: nombre,
    vendedorNombre: nombre,
    vendedorId: idDe(vendedor),
    zona: texto(vendedor.zona, 80) || pedido.zona || '',
    ...(pedido.cargadoPor || !quien ? {} : { cargadoPor: quien }),
    updatedAt: now,
  };
}

// ---- Sync (migración 024) ----
// Las claves viajan solo si el pedido las conoce: un dispositivo viejo no las pisa con null.
export function vendedorToRemote(p) {
  if (!p || typeof p !== 'object') return {};
  const out = {};
  if (p.vendedorId !== undefined && p.vendedorId !== null && p.vendedorId !== '') out.vendedor_id = String(p.vendedorId).slice(0, MAX_VENDEDOR_ID);
  if (p.cargadoPor !== undefined && p.cargadoPor !== null && p.cargadoPor !== '') out.cargado_por = texto(p.cargadoPor, MAX_CARGADO_POR);
  return out;
}

// Dato no confiable: se sanea. `undefined` (columna inexistente) o null conserva lo local.
export function vendedorFromRemote(r, local) {
  const out = {};
  const vid = r && r.vendedor_id;
  out.vendedorId = vid !== undefined && vid !== null && vid !== '' ? String(vid).slice(0, MAX_VENDEDOR_ID) : local?.vendedorId;
  const cp = r && r.cargado_por;
  out.cargadoPor = cp !== undefined && cp !== null && cp !== '' ? texto(cp, MAX_CARGADO_POR) : local?.cargadoPor;
  if (local && local.cargadoPorId !== undefined) out.cargadoPorId = local.cargadoPorId;
  return out;
}

export const COLUMNAS_024 = Object.freeze(['cargado_por', 'vendedor_id', 'modificado_tras_armado']);

// Fila sin las columnas de la 024 (si todavía no se aplicó).
export function sinColumnas024(row) {
  if (!row || typeof row !== 'object') return row;
  const { cargado_por: _c, vendedor_id: _v, modificado_tras_armado: _m, ...resto } = row;
  return resto;
}

export const nombraColumna024 = (error) => /cargado_por|vendedor_id|modificado_tras_armado/i.test(String(error?.message || ''));
