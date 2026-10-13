import { PDFDocument } from 'pdf-lib';

export const mergePdfFilesToSingleFile = async (files, filename) => {
  if (!files || files.length === 0) throw new Error('No hay PDFs para unir');
  const merged = await PDFDocument.create();

  for (const f of files) {
    const ab = await f.arrayBuffer();
    const src = await PDFDocument.load(ab);
    const pages = await merged.copyPages(src, src.getPageIndices());
    for (const p of pages) merged.addPage(p);
  }

  const bytes = await merged.save();
  return new File([bytes], filename || 'boletas.pdf', { type: 'application/pdf' });
};

