// src/services/lectorPdf.js — REQ-PDF: lee el texto de un PDF (lista de precios).
// Devuelve los fragmentos con su posición; el armado de renglones y precios es
// dominio puro (domain/importacionPdf.js).
import { validarArchivoPdf, MAX_PAGINAS } from '../domain/importacionPdf';

export async function leerItemsPdf(file) {
  const v = validarArchivoPdf(file);
  if (!v.ok) return { ok: false, mensaje: v.error };
  let doc;
  try {
    const { cargarPdfjs } = await import('./pdfjsCargador');
    const pdfjs = await cargarPdfjs();
    const data = new Uint8Array(await file.arrayBuffer());
    // isEvalSupported:false (sin eval, CVE-2024-4367) y sin fuentes embebidas: solo se lee texto.
    doc = await pdfjs.getDocument({ data, isEvalSupported: false, disableFontFace: true, enableXfa: false }).promise;
  } catch (err) {
    const pass = String(err?.name || '') === 'PasswordException';
    return { ok: false, mensaje: pass ? 'El PDF tiene contraseña: exportalo sin clave.' : 'No se pudo leer el PDF.' };
  }
  try {
    if (doc.numPages > MAX_PAGINAS) return { ok: false, mensaje: `El PDF tiene más de ${MAX_PAGINAS} páginas.` };
    const items = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const pg = await doc.getPage(n);
      const tc = await pg.getTextContent();
      for (const it of tc.items) {
        if (typeof it.str === 'string' && Array.isArray(it.transform)) {
          items.push({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, pagina: n });
        }
      }
    }
    if (!items.some(i => i.str.trim())) {
      return { ok: false, mensaje: 'El PDF no tiene texto (parece escaneado). Pedile al proveedor la lista en PDF digital o Excel.' };
    }
    return { ok: true, items, paginas: doc.numPages };
  } catch {
    return { ok: false, mensaje: 'No se pudo leer el PDF.' };
  } finally {
    try { await doc.destroy(); } catch { /* noop */ }
  }
}
