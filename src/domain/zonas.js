// src/domain/zonas.js — REQ-ZON (AC-ZON-1, 2, 3, 4).
// Logistica por zona: cada cliente tiene un puesto (`ordenZona`) dentro de la zona
// de su ficha (`cliente.zona`). Funciones puras: sin React, sin IndexedDB.
// OJO: `pedido.zona` es la zona del VENDEDOR; aca se usa siempre la del cliente.
import { claveRubro } from './rubros';
import { texto } from './validacion';
import { DIAS_SEMANA } from '../utils/diasSemana';

export const ETIQUETA_SIN_ZONA = 'Sin zona';

const alpha = (a, b) => String(a || '').localeCompare(String(b || ''), 'es', { sensitivity: 'base' });

// AC-ZON-4: "Centro", " centro ", "CENTRO" y "Céntro" son la misma zona. '' = sin zona.
export const claveZona = (z) => claveRubro(z);

const posValida = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
};

export const listarZonas = (clientes) => {
  const por = new Map();
  for (const c of clientes || []) {
    const k = claveZona(c?.zona);
    const e = por.get(k) || { clave: k, variantes: new Map(), cantidad: 0 };
    e.cantidad += 1;
    const v = texto(c?.zona, 60);
    if (v) e.variantes.set(v, (e.variantes.get(v) || 0) + 1);
    por.set(k, e);
  }
  const out = [...por.values()].map(e => {
    const etiqueta = e.clave === ''
      ? ETIQUETA_SIN_ZONA
      : [...e.variantes.entries()].sort((a, b) => b[1] - a[1] || alpha(a[0], b[0]))[0][0];
    return { clave: e.clave, etiqueta, cantidad: e.cantidad };
  });
  return out.sort((a, b) => (a.clave === '' ? 1 : b.clave === '' ? -1 : alpha(a.etiqueta, b.etiqueta)));
};

// Orden viejo: dia de la semana, luego puesto del dia, luego nombre.
export const ordenLegacy = (a, b) => {
  const idx = (c) => { const i = DIAS_SEMANA.indexOf(String(c?.diaEntrega || '').toLowerCase()); return i < 0 ? 99 : i; };
  const ord = (c) => posValida(c?.ordenEntrega) ?? Infinity;
  return (idx(a) - idx(b)) || (ord(a) === ord(b) ? 0 : ord(a) < ord(b) ? -1 : 1) || alpha(a?.nombre, b?.nombre) || String(a?.id ?? '').localeCompare(String(b?.id ?? ''));
};

// AC-ZON-1/3: clientes de la zona en orden. Primero los que ya tienen `ordenZona`;
// los que no (datos viejos) siguen el orden legacy (inicializacion perezosa local).
export const clientesDeZona = (clientes, clave) => {
  const k = claveZona(clave);
  const de = (clientes || []).filter(c => c && claveZona(c.zona) === k);
  const con = de.filter(c => posValida(c.ordenZona) !== null)
    .sort((a, b) => posValida(a.ordenZona) - posValida(b.ordenZona) || alpha(a.nombre, b.nombre) || String(a.id).localeCompare(String(b.id)));
  const sin = de.filter(c => posValida(c.ordenZona) === null).sort(ordenLegacy);
  return [...con, ...sin];
};

// Mueve un cliente al puesto indicado (1..n) y corre a los demas. Devuelve SOLO los
// clientes cuyo `ordenZona` cambia, ya renumerados 1..n sin huecos.
export const moverEnZona = (clientes, clave, clienteId, nuevoPuesto) => {
  const lista = clientesDeZona(clientes, clave);
  const desde = lista.findIndex(c => String(c.id) === String(clienteId));
  const pos = Number(nuevoPuesto);
  if (desde < 0 || !Number.isFinite(pos)) return [];
  const [mov] = lista.splice(desde, 1);
  const hasta = Math.min(Math.max(Math.floor(pos), 1), lista.length + 1) - 1;
  lista.splice(hasta, 0, mov);
  const cambios = [];
  lista.forEach((c, i) => {
    if (posValida(c.ordenZona) !== i + 1) cambios.push({ id: c.id, ordenZona: i + 1 });
  });
  return cambios;
};

// Si el cliente cambia de zona su puesto deja de valer: va al final de la nueva (null).
export const ordenZonaTrasCambioZona = (anterior, nuevo) => {
  const zonaA = typeof anterior === 'object' && anterior !== null ? anterior.zona : anterior;
  const zonaN = typeof nuevo === 'object' && nuevo !== null ? nuevo.zona : nuevo;
  if (claveZona(zonaA) !== claveZona(zonaN)) return null;
  const orden = typeof nuevo === 'object' && nuevo !== null ? nuevo.ordenZona : undefined;
  return posValida(orden);
};

// AC-ZON-2: pedidos agrupados por zona del cliente y numerados 1..n sin huecos segun
// quien tiene pedido. `zonas` = claves elegidas (vacio/undefined = todas).
export const calcularOrdenPorZona = (pedidos, clientes, { zonas } = {}) => {
  const porId = new Map((clientes || []).map(c => [String(c.id), c]));
  const elegidas = Array.isArray(zonas) && zonas.length ? new Set(zonas.map(claveZona)) : null;
  const etiquetas = new Map(listarZonas(clientes).map(z => [z.clave, z.etiqueta]));
  const porZona = new Map();
  for (const p of pedidos || []) {
    if (!p || typeof p !== 'object') continue;
    const cli = p?.clienteId != null ? porId.get(String(p.clienteId)) : undefined;
    const k = claveZona(cli?.zona);
    if (elegidas && !elegidas.has(k)) continue;
    if (!porZona.has(k)) porZona.set(k, []);
    porZona.get(k).push(p);
  }
  const porNombre = (a, b) => alpha(a.clienteNombre, b.clienteNombre) || alpha(a.fecha, b.fecha) || String(a.id).localeCompare(String(b.id));
  const claves = [...porZona.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : alpha(etiquetas.get(a), etiquetas.get(b))));
  return claves.map(k => {
    const puesto = new Map(clientesDeZona(clientes, k).map((c, i) => [String(c.id), i]));
    const ps = [...porZona.get(k)].sort((a, b) => {
      const ia = puesto.get(String(a.clienteId)); const ib = puesto.get(String(b.clienteId));
      if (ia !== undefined && ib !== undefined) return (ia - ib) || porNombre(a, b);
      if (ia !== undefined) return -1;
      if (ib !== undefined) return 1;
      return porNombre(a, b);
    });
    return {
      clave: k,
      etiqueta: k === '' ? ETIQUETA_SIN_ZONA : (etiquetas.get(k) || k),
      pedidos: ps.map((pedido, i) => ({ pedido, orden: i + 1 })),
    };
  });
};
