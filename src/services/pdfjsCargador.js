// src/services/pdfjsCargador.js — carga pdfjs-dist bajo demanda (chunk aparte).
// Se importa solo con import() desde lectorPdf.js: así ni el bundle principal ni
// los tests cargan pdfjs. El "worker" corre en el hilo principal (globalThis.pdfjsWorker):
// evita configurar una URL de worker y alcanza para una lista de precios.
export async function cargarPdfjs() {
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.mjs'),
  ]);
  if (!globalThis.pdfjsWorker) globalThis.pdfjsWorker = worker;
  return pdfjs;
}
