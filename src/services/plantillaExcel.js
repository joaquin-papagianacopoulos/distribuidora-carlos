// src/services/plantillaExcel.js — REQ-PLA: genera y descarga las plantillas
// .xlsx en el navegador. El contenido (columnas, instrucciones, csvSafe) sale
// de src/domain/plantillas.js; aca solo se arma el libro con xlsx.
// S-DEP-01 afecta al PARSEO de archivos; escribir un libro propio no expone
// esa superficie.
import { armarPlantilla } from '../domain/plantillas';

export const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// Ancho de columna aproximado segun el contenido (solo cosmetico).
const anchos = (filas) => {
  const max = [];
  for (const f of filas) f.forEach((v, i) => { max[i] = Math.max(max[i] || 10, Math.min(60, String(v ?? '').length + 2)); });
  return max.map(wch => ({ wch }));
};

/** Arma el workbook con la libreria xlsx que se le pase (inyectada para testear). */
export const libroPlantilla = (XLSX, plantilla) => {
  const wb = XLSX.utils.book_new();
  for (const hoja of plantilla.hojas) {
    const ws = XLSX.utils.aoa_to_sheet(hoja.filas);
    ws['!cols'] = anchos(hoja.filas);
    XLSX.utils.book_append_sheet(wb, ws, hoja.nombre);
  }
  return wb;
};

/** Genera el .xlsx de la entidad. @returns {Promise<{ nombreArchivo: string, blob: Blob }>} */
export const generarPlantillaXlsx = async (entidad, ctx = {}) => {
  const XLSX = await import('xlsx');
  const plantilla = armarPlantilla(entidad, ctx);
  const data = XLSX.write(libroPlantilla(XLSX, plantilla), { bookType: 'xlsx', type: 'array' });
  return { nombreArchivo: plantilla.nombreArchivo, blob: new Blob([data], { type: MIME_XLSX }) };
};

/** Dispara la descarga de un Blob con el nombre dado. */
export const descargarBlob = (blob, nombre) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
};

export const descargarPlantilla = async (entidad, ctx = {}) => {
  const { nombreArchivo, blob } = await generarPlantillaXlsx(entidad, ctx);
  descargarBlob(blob, nombreArchivo);
  return nombreArchivo;
};
