// src/domain/gruposFactura.js — REQ-AGR (AC-AGR-1, 2, 3, 4).
// Agrupar renglones de un pedido para mostrarlos en una sola linea en la boleta.
// Solo es presentacion: los renglones (`items`) siguen separados para stock,
// armado, comisiones y estadisticas, y el total siempre sale de los items.
// Funciones puras: sin React, sin IndexedDB, sin Supabase.
import { texto, nuevoId } from './validacion';
import { claveMarca, normalizarMarca } from './marcas';
import { rubroDeRenglon } from './rubros';
import { normalizarBultoX } from './bultos';

export const MAX_GRUPOS = 50;
export const MAX_NOMBRE_GRUPO = 60;
// Conservador (x2 por caracteres multibyte): < 65536 bytes de pg_column_size en el server.
export const MAX_BYTES_GRUPOS = 30000;
export const NOMBRE_GRUPO_POR_DEFECTO = 'Grupo';

const peso = (n) => `$${Number(n).toLocaleString('es-AR')}`;
const alpha = (a, b) => String(a || '').localeCompare(String(b || ''), 'es', { sensitivity: 'base' });

// Clave estable de un renglon dentro del pedido.
export const claveRenglon = (item) => String(item?.productoId ?? item?.nombre ?? '');

const nombreLimpio = (n) => texto(n, MAX_NOMBRE_GRUPO);

const productoDe = (item, productosById) => {
  if (!productosById || typeof productosById.get !== 'function' || item?.productoId == null) return undefined;
  return productosById.get(String(item.productoId)) ?? productosById.get(item.productoId);
};

// AC-AGR-1: nombre sugerido = marca comun; si no, rubro comun; si no, "Grupo".
export const sugerirNombreGrupo = (items, productosById) => {
  const lista = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!lista.length) return NOMBRE_GRUPO_POR_DEFECTO;
  const marcas = lista.map(i => normalizarMarca(i.marca || productoDe(i, productosById)?.marca));
  if (marcas.every(m => m) && new Set(marcas.map(claveMarca)).size === 1) return marcas[0];
  const rubros = lista.map(i => rubroDeRenglon(i, productosById));
  if (rubros.every(r => r.rubro) && new Set(rubros.map(r => r.clave)).size === 1) return rubros[0].rubro;
  return NOMBRE_GRUPO_POR_DEFECTO;
};

// Crea un grupo con esas claves. Un renglon vive en un solo grupo: se saca de los
// otros (y los grupos que quedan vacios se descartan). Seleccion vacia => sin cambios.
export const crearGrupo = (grupos, itemIds, nombre, idFn = nuevoId) => {
  const actuales = Array.isArray(grupos) ? grupos : [];
  const ids = [...new Set((itemIds || []).map(String).filter(Boolean))];
  if (!ids.length || actuales.length >= MAX_GRUPOS) return actuales;
  const sel = new Set(ids);
  const resto = actuales
    .map(g => ({ ...g, itemIds: (g.itemIds || []).filter(k => !sel.has(String(k))) }))
    .filter(g => g.itemIds.length > 0);
  return [...resto, { id: idFn(), nombre: nombreLimpio(nombre) || NOMBRE_GRUPO_POR_DEFECTO, itemIds: ids }];
};

export const renombrarGrupo = (grupos, id, nombre) =>
  (Array.isArray(grupos) ? grupos : []).map(g => (g.id === id ? { ...g, nombre: nombreLimpio(nombre) || NOMBRE_GRUPO_POR_DEFECTO } : g));

export const deshacerGrupo = (grupos, id) => (Array.isArray(grupos) ? grupos : []).filter(g => g.id !== id);

// AC-AGR-4: saneo (dato no confiable: lo puede escribir cualquier dispositivo).
// Descarta claves que ya no existen en `items` y grupos que quedan vacios.
// Si items es undefined no se filtran las claves (solo se sanea el formato).
export const normalizarGrupos = (grupos, items) => {
  if (!Array.isArray(grupos)) return [];
  const existentes = Array.isArray(items) ? new Set(items.map(claveRenglon)) : null;
  const usadas = new Set();
  const ids = new Set();
  const out = [];
  let bytes = 2;
  for (const g of grupos) {
    if (out.length >= MAX_GRUPOS) break;
    if (!g || typeof g !== 'object' || Array.isArray(g)) continue;
    const gid = texto(g.id, 64);
    if (!gid || ids.has(gid) || !Array.isArray(g.itemIds)) continue;
    const claves = [];
    for (const k of g.itemIds.slice(0, 500)) {
      if (typeof k !== 'string' && typeof k !== 'number') continue;
      const c = String(k);
      if (!c || usadas.has(c) || claves.includes(c)) continue;
      if (existentes && !existentes.has(c)) continue;
      claves.push(c);
    }
    if (!claves.length) continue;
    const nuevo = { id: gid, nombre: nombreLimpio(g.nombre) || NOMBRE_GRUPO_POR_DEFECTO, itemIds: claves };
    // S-011-05: tope de tamano (el server rechaza pg_column_size >= 65536); queda margen.
    bytes += JSON.stringify(nuevo).length * 2;
    if (bytes > MAX_BYTES_GRUPOS) break;
    claves.forEach(c => usadas.add(c));
    ids.add(gid);
    out.push(nuevo);
  }
  return out;
};

const unidades = (r) => Number(r?.cantidad) || 0;

// AC-AGR-3: "3 bultos (36 u.)" si todos comparten bultoX y la suma es multiplo; si no, "36 u.".
export const textoBultosGrupo = (renglones) => {
  const lista = Array.isArray(renglones) ? renglones.filter(Boolean) : [];
  const total = lista.reduce((s, r) => s + unidades(r), 0);
  const solo = `${total} u.`;
  if (!lista.length) return solo;
  const bxs = lista.map(r => normalizarBultoX(r.bultoX));
  if (bxs.some(b => b === null) || new Set(bxs).size !== 1) return solo;
  const bx = bxs[0];
  if (!Number.isInteger(total) || total < bx || total % bx !== 0) return solo;
  const b = total / bx;
  return `${b} ${b === 1 ? 'bulto' : 'bultos'} (${total} u.)`;
};

const subtotalItem = (i) => Number(i?.cantidad) * Number(i?.precio);

// Filas de la tabla de la boleta. El total del pedido es la suma de los items:
// las filas "detalle" (renglones bajo un grupo) NO se suman de nuevo.
//   tipo 'grupo' | 'detalle' | 'item'
export const filasBoleta = (items, grupos, { modo = 'detalle' } = {}) => {
  const lista = Array.isArray(items) ? items : [];
  const gs = normalizarGrupos(grupos, lista);
  const claveAGrupo = new Map();
  gs.forEach(g => g.itemIds.forEach(k => claveAGrupo.set(k, g.id)));

  const sueltos = lista.filter(i => !claveAGrupo.has(claveRenglon(i)));
  const top = [];
  for (const i of sueltos) {
    top.push({
      orden: i.nombre, fila: { tipo: 'item', nombre: i.nombre, cantidadTexto: String(i.cantidad), precioTexto: peso(i.precio), subtotal: subtotalItem(i) }, detalle: [],
    });
  }
  for (const g of gs) {
    const rengs = lista.filter(i => claveAGrupo.get(claveRenglon(i)) === g.id);
    if (!rengs.length) continue;
    const detalle = modo === 'solo_grupos' ? [] : [...rengs].sort((a, b) => alpha(a.nombre, b.nombre)).map(i => ({
      tipo: 'detalle', nombre: `   ${i.nombre}`, cantidadTexto: String(i.cantidad), precioTexto: peso(i.precio), subtotal: subtotalItem(i),
    }));
    top.push({
      orden: g.nombre,
      fila: { tipo: 'grupo', nombre: g.nombre, cantidadTexto: textoBultosGrupo(rengs), precioTexto: '', subtotal: rengs.reduce((s, i) => s + subtotalItem(i), 0) },
      detalle,
    });
  }
  top.sort((a, b) => alpha(a.orden, b.orden));
  return top.flatMap(t => [t.fila, ...t.detalle]);
};

// Total a partir de las filas (sin doble conteo): ignora las filas de detalle.
export const totalFilasBoleta = (filas) =>
  (filas || []).filter(f => f.tipo !== 'detalle').reduce((s, f) => s + (Number(f.subtotal) || 0), 0);

// ---- Sync (migracion 011) ----
// La clave `grupos` viaja SOLO si el pedido la conoce (`!== undefined`): un dispositivo
// viejo, que no la tiene, no la pisa con null (PostgREST no toca columnas ausentes).
export const gruposToRemote = (pedido) =>
  (pedido && pedido.grupos !== undefined && pedido.grupos !== null
    ? { grupos: normalizarGrupos(pedido.grupos, pedido.items) }
    : {});

// Lo que vuelve de Supabase es dato no confiable: se sanea. `undefined` (columna
// inexistente) o null => se conserva lo local.
export const gruposFromRemote = (r, local) => {
  if (!r || r.grupos === undefined || r.grupos === null) return local?.grupos;
  return normalizarGrupos(r.grupos, Array.isArray(r.items) ? r.items : undefined);
};

// Fila sin las columnas de la 011 (si todavia no se aplico).
export const sinColumnas011 = (row) => {
  if (!row || typeof row !== 'object') return row;
  const { grupos: _g, ...resto } = row;
  return resto;
};

export const nombraColumna011 = (error) => /\bgrupos\b/i.test(String(error?.message || ''));
