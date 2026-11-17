// src/domain/catalogoPdf.js — REQ-CAT: armado del catálogo PDF / tienda web.
// Lógica pura (sin React, sin IndexedDB, sin Supabase, sin pdf-lib). Decide qué productos
// entran al catálogo, cuáles van marcados "SIN STOCK", cómo se paginan y dónde cae cada
// celda. El dibujo del PDF vive en services/catalogoService.js.

export const POR_PAGINA_DEFAULT = 16; // 4 columnas x 4 filas, como el catálogo actual
export const COLUMNAS_DEFAULT = 4;

// ---- Marcas por producto (solo para el catálogo; no tocan "Mostrar en tienda" ni el stock) ----

export const marcaCatalogoVacia = (productoId) => ({ productoId, oculto: false, sinStock: false });

export const normalizarMarca = (m = {}) => ({
  productoId: m?.productoId,
  oculto: m?.oculto === true,
  sinStock: m?.sinStock === true,
});

// Lista de marcas -> Map por clave de producto. Las marcas "en blanco" no ocupan lugar.
export const indexarMarcas = (marcas = []) => {
  const mapa = new Map();
  (Array.isArray(marcas) ? marcas : []).forEach((m) => {
    if (m?.productoId === undefined || m?.productoId === null) return;
    const n = normalizarMarca(m);
    if (n.oculto || n.sinStock) mapa.set(String(n.productoId), n);
  });
  return mapa;
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
    });
  });
  return items.sort((a, b) =>
    a.categoria.localeCompare(b.categoria, 'es') || a.nombre.localeCompare(b.nombre, 'es'));
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
