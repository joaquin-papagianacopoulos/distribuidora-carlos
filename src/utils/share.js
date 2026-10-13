export const canShareFiles = () => {
  return !!(navigator.share && navigator.canShare);
};

export const shareFiles = async ({ title, text, files }) => {
  if (!files || files.length === 0) throw new Error('No hay archivos para compartir');
  if (!navigator.share) throw new Error('Compartir no soportado en este navegador');

  // iOS Safari requiere canShare({files}) para compartir archivos.
  if (navigator.canShare && !navigator.canShare({ files })) {
    throw new Error('Este navegador no permite compartir archivos');
  }

  await navigator.share({
    title: title || '',
    text: text || '',
    files,
  });
};
