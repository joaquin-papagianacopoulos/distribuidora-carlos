// src/domain/catalogoPdf.js — REQ-CAT: armado del catálogo PDF / tienda web.
// Lógica pura (sin React, sin IndexedDB, sin Supabase, sin pdf-lib). Decide qué productos
// entran al catálogo, cuáles van marcados "SIN STOCK", cómo se paginan y dónde cae cada
// celda. El dibujo del PDF vive en services/catalogoService.js.

import { validarEscalasBulto, normalizarEscalasBulto, precioAplicado, MAX_ESCALAS_BULTO, valorEscalaTexto } from './precios';
import { normalizarBultoX } from './bultos';
import { normalizarBultoNombre } from './unidadVenta';

export const POR_PAGINA_DEFAULT = 16; // 4 columnas x 4 filas, como el catálogo actual
export const COLUMNAS_DEFAULT = 4;
export const MAX_LINEAS_OFERTA_PDF = 4;

// ---- Marcas por producto (solo para el catálogo; no tocan "Mostrar en tienda" ni el stock) ----
// AC-CAT-5: la marca también guarda `orden` (puesto manual en el PDF, 1..n). Sin orden = va después, por rubro y nombre.

export const marcaCatalogoVacia = (productoId) => ({ productoId, oculto: false, sinStock: false });

const ordenValido = (o) => (Number.isFinite(Number(o)) && Number(o) >= 1 && o !== null && o !== '' ? Math.floor(Number(o)) : null);

export const normalizarMarca = (m = {}) => {
  const base = { productoId: m?.productoId, oculto: m?.oculto === true, sinStock: m?.sinStock === true };
  const orden = ordenValido(m?.orden);
  return orden === null ? base : { ...base, orden };
};

// Una marca solo ocupa lugar si tiene algún valor activo.
export const marcaTieneDatos = (m) => !!m && (m.oculto === true || m.sinStock === true || ordenValido(m.orden) !== null);

// Lista de marcas -> Map por clave de producto. Las marcas "en blanco" no ocupan lugar.
export const indexarMarcas = (marcas = []) => {
  const mapa = new Map();
  (Array.isArray(marcas) ? marcas : []).forEach((m) => {
    if (m?.productoId === undefined || m?.productoId === null) return;
    const n = normalizarMarca(m);
    if (marcaTieneDatos(n)) mapa.set(String(n.productoId), n);
  });
  return mapa;
};

// Orden del catálogo: primero los que tienen puesto manual (por puesto), después el resto por rubro y nombre.
const comparar = (a, b) => {
  const oa = a.orden ?? null; const ob = b.orden ?? null;
  if (oa !== null && ob !== null && oa !== ob) return oa - ob;
  if (oa !== null && ob === null) return -1;
  if (oa === null && ob !== null) return 1;
  return String(a.categoria ?? '').localeCompare(String(b.categoria ?? ''), 'es')
    || String(a.nombre ?? '').localeCompare(String(b.nombre ?? ''), 'es');
};

// Productos (incluidos los ocultos) en el orden en que saldrían en el PDF. Para la pantalla de armado.
export const ordenarProductosCatalogo = (productos = [], marcas = []) => {
  const mapa = marcas instanceof Map ? marcas : indexarMarcas(marcas);
  return (Array.isArray(productos) ? productos : [])
    .filter((p) => p && p.id !== undefined && p.id !== null)
    .map((p) => ({ p, orden: mapa.get(String(p.id))?.orden ?? null, categoria: p.categoria, nombre: p.nombre }))
    .sort(comparar)
    .map((x) => x.p);
};

// Mueve el elemento de `desde` a `hasta` (índices). Devuelve una lista nueva; índices fuera de rango no cambian nada.
export const moverEnLista = (lista = [], desde, hasta) => {
  const arr = Array.isArray(lista) ? [...lista] : [];
  if (!Number.isInteger(desde) || !Number.isInteger(hasta) || desde === hasta) return arr;
  if (desde < 0 || desde >= arr.length || hasta < 0 || hasta >= arr.length) return arr;
  const [x] = arr.splice(desde, 1);
  arr.splice(hasta, 0, x);
  return arr;
};

// ---- Ofertas por bulto (AC-CAT-6 / AC-CAT-7) ----

const pesosCorto = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return '';
  return Number.isInteger(v) ? `$${v.toLocaleString('es-AR')}` : formatoPrecio(v).replace('$ ', '$');
};

/**
 * Líneas de oferta de un producto para el PDF: "Llevando el bulto: $800 c/u" y una por escala
 * ("Desde 3 bultos: $950 c/u"). Cada precio sale de precioAplicado (la misma regla que cobra el pedido).
 * Sin bulto usable no hay ofertas. Máximo MAX_LINEAS_OFERTA_PDF.
 */
export const textosOfertasProducto = (p) => {
  const bx = normalizarBultoX(p?.bultoX);
  const precio = Number(p?.precio);
  if (bx === null || !(precio > 0)) return [];
  const nombre = normalizarBultoNombre(p?.bultoNombre).toLowerCase();
  const lineas = [];
  const escalas = normalizarEscalasBulto(p?.escalasBulto);
  const conBulto = precioAplicado({ precio, precioBulto: p?.precioBulto, bultoX: bx, escalasBulto: [] }, bx).precio;
  // Siempre precio POR UNIDAD, con las unidades del bulto entre paréntesis para que no se confunda con el precio del bulto.
  if (conBulto > 0 && conBulto < precio) lineas.push(`Llevando 1 ${nombre} (${bx} u): ${pesosCorto(conBulto)} c/u`);
  escalas.forEach((e) => {
    const u = precioAplicado({ precio, precioBulto: p?.precioBulto, bultoX: bx, escalasBulto: escalas }, e.desde * bx).precio;
    if (u > 0 && u < precio) lineas.push(`Desde ${e.desde} ${nombre}s (${e.desde * bx} u): ${pesosCorto(u)} c/u`);
  });
  return lineas.slice(0, MAX_LINEAS_OFERTA_PDF);
};

// Filas del editor de ofertas: siempre MAX_ESCALAS_BULTO filas ({ desde, valor } como texto).
export const filasOfertasEditor = (p) => {
  const filas = normalizarEscalasBulto(p?.escalasBulto).map((e) => ({ desde: String(e.desde), valor: valorEscalaTexto(e) }));
  while (filas.length < MAX_ESCALAS_BULTO) filas.push({ desde: '', valor: '' });
  return filas;
};

/**
 * Valida las ofertas que armó el admin para un producto. Devuelve { ok, producto, errores, avisos }.
 * `producto` = el producto con bultoX y escalasBulto nuevos (sin tocar nada más). Sin filas = borra las ofertas.
 */
export const aplicarOfertasProducto = (p, { bultoX, filas } = {}) => {
  const bx = bultoX === undefined || bultoX === '' ? p?.bultoX : bultoX;
  const base = Number(p?.precioBulto) > 0 && Number(p.precioBulto) < Number(p?.precio) ? Number(p.precioBulto) : Number(p?.precio);
  const r = validarEscalasBulto(filas, bx, base);
  if (r.errores.length) return { ok: false, producto: p, errores: r.errores, avisos: r.avisos };
  const bn = normalizarBultoX(bx);
  return {
    ok: true,
    producto: { ...p, bultoX: bn === null ? (Number(p?.bultoX) || 1) : bn, escalasBulto: r.valor },
    errores: [],
    avisos: r.avisos,
  };
};

export const marcaDe = (mapa, productoId) => mapa?.get?.(String(productoId)) || marcaCatalogoVacia(productoId);

// Devuelve la marca nueva tras aplicar `cambios` ({ oculto?, sinStock? }).
export const aplicarCambioMarca = (marcaActual, productoId, cambios = {}) =>
  normalizarMarca({ ...marcaCatalogoVacia(productoId), ...(marcaActual || {}), ...cambios, productoId });

// ---- Texto y precio ----

export const formatoPrecio = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return '';
  return `$ ${v.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

// pdf-lib con fuentes estándar solo codifica WinAnsi: lo que no entra se reemplaza para no cortar la generación.
export const textoPdfSeguro = (s) =>
  String(s ?? '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[^\x20-\x7E¡-ÿ]/g, '?')
    .trim();

// Corta un texto en renglones de hasta `maxAncho` según `medir(texto)`; el último renglón lleva "…" si no entra todo.
export const partirEnRenglones = (texto, medir, maxAncho, maxRenglones = 3) => {
  const palabras = textoPdfSeguro(texto).split(' ').filter(Boolean);
  const renglones = [];
  let actual = '';
  let i = 0;
  for (; i < palabras.length; i++) {
    const prueba = actual ? `${actual} ${palabras[i]}` : palabras[i];
    if (medir(prueba) <= maxAncho || !actual) { actual = prueba; continue; }
    renglones.push(actual);
    actual = palabras[i];
    if (renglones.length === maxRenglones) break;
  }
  if (renglones.length < maxRenglones) { if (actual) renglones.push(actual); return renglones; }
  const ultimo = renglones[maxRenglones - 1];
  let t = `${ultimo.replace(/\.+$/, '')}...`;
  while (t.length > 4 && medir(t) > maxAncho) t = `${t.slice(0, -4)}...`;
  renglones[maxRenglones - 1] = t;
  return renglones;
};

// ---- Qué entra al catálogo ----

/**
 * Productos del catálogo, ya ordenados (rubro, nombre). Los ocultos no salen.
 * `sinStock` = marca manual, o (si autoSinStock) stock real <= 0.
 * soloConFoto: deja afuera los que todavía no tienen foto.
 */
export const armarCatalogo = (productos = [], marcas = [], { stockDe = null, autoSinStock = false, soloConFoto = false } = {}) => {
  const mapa = marcas instanceof Map ? marcas : indexarMarcas(marcas);
  const items = [];
  (Array.isArray(productos) ? productos : []).forEach((p) => {
    if (!p || p.id === undefined || p.id === null) return;
    const marca = marcaDe(mapa, p.id);
    if (marca.oculto) return;
    if (soloConFoto && !p.imagen_url) return;
    const stockReal = typeof stockDe === 'function' ? Number(stockDe(p.id)) : null;
    items.push({
      id: p.id,
      codigo: String(p.codigo ?? '').trim(),
      nombre: String(p.nombre ?? '').trim(),
      categoria: String(p.categoria ?? '').trim(),
      precio: Number(p.precio) || 0,
      imagen_url: p.imagen_url || null,
      sinStock: marca.sinStock || (autoSinStock && stockReal !== null && stockReal <= 0),
      orden: marca.orden ?? null,
      ofertas: textosOfertasProducto(p), // AC-CAT-6
    });
  });
  return items.sort(comparar); // AC-CAT-5: puesto manual primero, después rubro y nombre
};

export const paginar = (items = [], porPagina = POR_PAGINA_DEFAULT) => {
  const n = Math.max(1, Math.floor(Number(porPagina)) || POR_PAGINA_DEFAULT);
  const paginas = [];
  for (let i = 0; i < items.length; i += n) paginas.push(items.slice(i, i + n));
  return paginas;
};

// Resumen para mostrar antes de generar.
export const resumenCatalogo = (productos = [], marcas = []) => {
  const mapa = indexarMarcas(marcas);
  let ocultos = 0; let sinStock = 0; let sinFoto = 0; let visibles = 0;
  (productos || []).forEach((p) => {
    const m = marcaDe(mapa, p?.id);
    if (m.oculto) { ocultos++; return; }
    visibles++;
    if (m.sinStock) sinStock++;
    if (!p?.imagen_url) sinFoto++;
  });
  return { total: (productos || []).length, visibles, ocultos, sinStock, sinFoto };
};

// ---- Geometría de la página (puntos PDF, origen abajo a la izquierda) ----

export const layoutPagina = ({ ancho = 595.28, alto = 841.89, margen = 28, cabecera = 44, pie = 22, columnas = COLUMNAS_DEFAULT, filas = 4, hueco = 8 } = {}) => {
  const anchoCelda = (ancho - margen * 2 - hueco * (columnas - 1)) / columnas;
  const altoCelda = (alto - margen - cabecera - pie - hueco * (filas - 1)) / filas;
  const celdas = [];
  for (let f = 0; f < filas; f++) {
    for (let c = 0; c < columnas; c++) {
      celdas.push({
        x: margen + c * (anchoCelda + hueco),
        y: alto - cabecera - (f + 1) * altoCelda - f * hueco,
        w: anchoCelda,
        h: altoCelda,
      });
    }
  }
  return { celdas, anchoCelda, altoCelda, porPagina: columnas * filas };
};

// ---- Alta rápida de fotos: el nombre del archivo es el código del producto ----

const sinExtension = (nombre) => String(nombre ?? '').replace(/\.[a-z0-9]+$/i, '');
// "66.jpg", "66 (1).jpg", "66_2.png" -> "66"
export const codigoDesdeArchivo = (nombre) => sinExtension(nombre).replace(/\s*\(\d+\)\s*$/, '').replace(/_\d+$/, '').trim();

/**
 * Empareja archivos con productos por código (sin distinguir mayúsculas). Si dos archivos
 * apuntan al mismo producto gana el último y el otro se informa en `repetidos`.
 * Devuelve { asignaciones: [{ file, producto }], sinProducto: [nombre], repetidos: [nombre] }.
 */
export const emparejarFotosPorCodigo = (archivos = [], productos = []) => {
  const porCodigo = new Map();
  (productos || []).forEach((p) => {
    const c = String(p?.codigo ?? '').trim().toLowerCase();
    if (c && !porCodigo.has(c)) porCodigo.set(c, p);
  });
  const elegidos = new Map(); // id -> { file, producto }
  const sinProducto = []; const repetidos = [];
  Array.from(archivos || []).forEach((file) => {
    const nombre = String(file?.name ?? '');
    const p = porCodigo.get(codigoDesdeArchivo(nombre).toLowerCase())
      || porCodigo.get(sinExtension(nombre).trim().toLowerCase());
    if (!p) { sinProducto.push(nombre); return; }
    if (elegidos.has(p.id)) repetidos.push(elegidos.get(p.id).file.name);
    elegidos.set(p.id, { file, producto: p });
  });
  return { asignaciones: [...elegidos.values()], sinProducto, repetidos };
};

export const nombreArchivoCatalogo = (ahora = new Date(), marca = 'Catalogo') => {
  const p = (n) => String(n).padStart(2, '0');
  const slug = textoPdfSeguro(marca).replace(/[^A-Za-z0-9]+/g, '') || 'Catalogo';
  return `Catalogo-${slug}-${ahora.getFullYear()}-${p(ahora.getMonth() + 1)}-${p(ahora.getDate())}_${p(ahora.getHours())}-${p(ahora.getMinutes())}-${p(ahora.getSeconds())}.pdf`;
};
