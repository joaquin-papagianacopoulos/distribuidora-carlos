// src/services/catalogoService.js — REQ-CAT: fotos y PDF del catálogo.
// Orquesta dominio (catalogoPdf), IndexedDB, subida de imágenes y pdf-lib.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { subirImagenTienda } from './tiendaConfigService';
import { subirProductosConPin } from './productosAdminService';
import { updateProducto } from '../db';
import {
  armarCatalogo, paginar, layoutPagina, formatoPrecio, textoPdfSeguro, partirEnRenglones, nombreArchivoCatalogo,
} from '../domain/catalogoPdf';

const LADO_MAX = 1000; // px: alcanza para 4 columnas y mantiene cada foto bien por debajo de 2 MB

const cargarImagen = (blob) => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
  img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('imagen ilegible')); };
  img.src = url;
});

// Reduce y convierte a JPEG (también deja pasar WEBP/PNG al PDF, que solo embebe JPG/PNG).
export const imagenAJpeg = async (blob, { lado = LADO_MAX, calidad = 0.85 } = {}) => {
  const img = await cargarImagen(blob);
  const k = Math.min(1, lado / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.width * k));
  canvas.height = Math.max(1, Math.round(img.height * k));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; // PNG con transparencia: fondo blanco
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const out = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', calidad));
  if (!out) throw new Error('no se pudo convertir');
  return { blob: out, ancho: canvas.width, alto: canvas.height };
};

/**
 * Sube la foto (ya reducida) y la deja en el producto. Con PIN, además sube el producto a
 * Supabase para que la tienda la vea. Devuelve { ok, url, mensaje, subido }.
 */
export const subirFotoProducto = async (pin, producto, file) => {
  let archivo = file;
  try {
    const j = await imagenAJpeg(file);
    archivo = new File([j.blob], `${producto.id}.jpg`, { type: 'image/jpeg' });
  } catch (e) {
    return { ok: false, mensaje: 'No se pudo leer la imagen.' };
  }
  const r = await subirImagenTienda(pin, archivo);
  if (!r.ok) return r;
  await updateProducto({ ...producto, imagen_url: r.url });
  const s = await subirProductosConPin(pin);
  return { ok: true, url: r.url, subido: s?.ok !== false, mensaje: s?.ok === false ? s.mensaje : '' };
};

const descargarJpeg = async (url) => {
  const resp = await fetch(url, { mode: 'cors' });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return (await imagenAJpeg(await resp.blob(), { lado: 600, calidad: 0.8 })).blob;
};

// Corre `fn` sobre la lista con a lo sumo `n` tareas a la vez.
const enParalelo = async (lista, n, fn) => {
  let i = 0;
  const trabajadores = Array.from({ length: Math.min(n, lista.length) }, async () => {
    while (i < lista.length) { const k = i++; await fn(lista[k], k); }
  });
  await Promise.all(trabajadores);
};

/**
 * Genera el PDF del catálogo. Devuelve { file, paginas, productos, sinFotoDescargable }.
 * opciones: { titulo, subtitulo, autoSinStock, soloConFoto, stockDe, onProgreso(hecho,total) }
 */
export const generarCatalogoPdf = async (productos, marcas, opciones = {}) => {
  const { titulo = 'Catalogo', subtitulo = 'DISTRIBUCION MAYORISTA', onProgreso = () => {} } = opciones;
  const items = armarCatalogo(productos, marcas, opciones);
  const paginas = paginar(items);
  const doc = await PDFDocument.create();
  doc.setTitle(textoPdfSeguro(titulo));
  doc.setAuthor(textoPdfSeguro(titulo));
  const fuente = await doc.embedFont(StandardFonts.Helvetica);
  const negrita = await doc.embedFont(StandardFonts.HelveticaBold);

  // 1) Fotos: se bajan de a 4 y se embeben una sola vez.
  const imagenes = new Map();
  const conFoto = items.filter((it) => it.imagen_url);
  let hechas = 0; let fallidas = 0;
  await enParalelo(conFoto, 4, async (it) => {
    try { imagenes.set(it.id, await doc.embedJpg(await (await descargarJpeg(it.imagen_url)).arrayBuffer())); } catch { fallidas++; }
    onProgreso(++hechas, conFoto.length);
  });

  // 2) Páginas.
  const lay = layoutPagina();
  const gris = rgb(0.45, 0.45, 0.45);
  paginas.forEach((pag, nPag) => {
    const page = doc.addPage([595.28, 841.89]);
    page.drawText(textoPdfSeguro(subtitulo).toUpperCase(), { x: 28, y: 841.89 - 30, size: 13, font: negrita, color: rgb(0.1, 0.1, 0.1) });
    page.drawText(`${nPag + 1} / ${paginas.length}`, { x: 595.28 - 28 - 30, y: 14, size: 8, font: fuente, color: gris });
    pag.forEach((it, k) => {
      const c = lay.celdas[k];
      page.drawRectangle({ x: c.x, y: c.y, width: c.w, height: c.h, borderColor: rgb(0.85, 0.85, 0.85), borderWidth: 0.5 });
      // AC-CAT-6: las ofertas por bulto van entre el nombre y el precio (8 pt por renglón); un producto sin stock no las muestra.
      const ofertas = it.sinStock ? [] : (it.ofertas || []);
      const altoTexto = 46 + 8 * ofertas.length;
      const caja = { x: c.x + 4, y: c.y + altoTexto, w: c.w - 8, h: c.h - altoTexto - 4 };
      const img = imagenes.get(it.id);
      if (img) {
        const k2 = Math.min(caja.w / img.width, caja.h / img.height);
        const w = img.width * k2; const h = img.height * k2;
        page.drawImage(img, { x: caja.x + (caja.w - w) / 2, y: caja.y + (caja.h - h) / 2, width: w, height: h, opacity: it.sinStock ? 0.35 : 1 });
      } else {
        page.drawRectangle({ x: caja.x, y: caja.y, width: caja.w, height: caja.h, color: rgb(0.95, 0.95, 0.95) });
        page.drawText('SIN FOTO', { x: caja.x + caja.w / 2 - 20, y: caja.y + caja.h / 2 - 3, size: 8, font: fuente, color: gris });
      }
      if (it.sinStock) {
        const t = 'SIN STOCK'; const tam = 11; const w = negrita.widthOfTextAtSize(t, tam) + 12;
        page.drawRectangle({ x: caja.x + (caja.w - w) / 2, y: caja.y + caja.h / 2 - 9, width: w, height: 18, color: rgb(0.8, 0.1, 0.1) });
        page.drawText(t, { x: caja.x + (caja.w - w) / 2 + 6, y: caja.y + caja.h / 2 - 4, size: tam, font: negrita, color: rgb(1, 1, 1) });
      }
      const renglones = partirEnRenglones(it.nombre, (s) => negrita.widthOfTextAtSize(s, 7.5), c.w - 8, 2);
      renglones.forEach((r, i) => page.drawText(r, { x: c.x + 4, y: c.y + altoTexto - 10 - i * 9, size: 7.5, font: negrita, color: rgb(0.1, 0.1, 0.1) }));
      page.drawText(it.sinStock ? 'Consultar' : formatoPrecio(it.precio).replace('$ ', '$'), { x: c.x + 4, y: c.y + 14, size: 11, font: negrita, color: it.sinStock ? gris : rgb(0.05, 0.4, 0.2) });
      ofertas.forEach((t, i) => {
        const txt = partirEnRenglones(t, (s) => negrita.widthOfTextAtSize(s, 6.5), c.w - 8, 1)[0] || '';
        page.drawText(txt, { x: c.x + 4, y: c.y + 25 + (ofertas.length - 1 - i) * 8, size: 6.5, font: negrita, color: rgb(0.75, 0.15, 0.1) });
      });
      page.drawText(`Cod. ${textoPdfSeguro(it.codigo)}`, { x: c.x + 4, y: c.y + 4, size: 7, font: fuente, color: gris });
    });
  });
  if (!paginas.length) doc.addPage([595.28, 841.89]).drawText('El catalogo no tiene productos visibles.', { x: 40, y: 780, size: 12, font: fuente });

  const bytes = await doc.save();
  const file = new File([bytes], nombreArchivoCatalogo(new Date(), titulo), { type: 'application/pdf' });
  return { file, paginas: paginas.length, productos: items.length, sinFotoDescargable: fallidas };
};
