// src/services/planillaXlsx.js — S-DEP-01 / S-PLA-01 / BUG-PLA-01 (RUN 20261012-2106, iteracion 2).
// Lectura ACOTADA de un .xlsx con la libreria xlsx. La usan el Web Worker
// (leerPlanilla.worker.js) y el fallback sin Worker (tests / navegadores sin
// Worker). Recibe el modulo XLSX por parametro: no lo importa, asi el mismo
// codigo corre en el worker y en el hilo principal.
import { MAX_FILAS_IMPORT, MAX_COLUMNAS_IMPORT, recortarFila } from '../domain/importacion';

// Opciones de lectura: solo la primera hoja, modo denso, sin formulas, sin
// estilos, sin HTML, sin VBA ni archivos internos, y un tope de filas
// (encabezado + MAX_FILAS_IMPORT + 1, para poder detectar el exceso).
export const OPCIONES_LECTURA_XLSX = Object.freeze({
  type: 'array',
  dense: true,
  sheets: 0,
  sheetRows: MAX_FILAS_IMPORT + 2,
  cellFormula: false,
  cellHTML: false,
  cellStyles: false,
  cellNF: true, // hace falta el formato para reconocer las celdas de fecha
  cellDates: false,
  bookVBA: false,
  bookFiles: false,
  bookDeps: false,
  bookProps: false,
  sheetStubs: false,
  WTF: false,
});

const pad = (n) => String(n).padStart(2, '0');

// Celdas de una hoja (modo denso de 0.18: array de filas; 0.19+: "!data";
// modo normal: claves A1).
const recorrerCeldas = (ws, fn) => {
  const filas = Array.isArray(ws) ? ws : (Array.isArray(ws?.['!data']) ? ws['!data'] : null);
  if (filas) {
    for (const fila of filas) if (Array.isArray(fila)) for (const c of fila) if (c) fn(c);
    return;
  }
  for (const k of Object.keys(ws || {})) if (k[0] !== '!' && ws[k]) fn(ws[k]);
};

/**
 * Lee el primer libro del buffer y devuelve las filas como texto.
 * - BUG-PLA-01: una celda de fecha de Excel sale como "YYYY-MM-DD" (sin zona horaria).
 * - S-PLA-01: `truncado` = el archivo tenia mas filas que el tope (sheetRows);
 *   columnas recortadas a MAX_COLUMNAS_IMPORT + 1 y celdas a MAX_LARGO_CELDA + 1.
 * @returns {{ filas: string[][], truncado: boolean }}
 */
export const filasDesdeLibro = (XLSX, buf) => {
  const wb = XLSX.read(buf, { ...OPCIONES_LECTURA_XLSX });
  const hoja = wb?.SheetNames?.[0];
  const ws = hoja ? wb.Sheets?.[hoja] : null;
  if (!ws) throw new Error('El archivo XLSX no tiene hojas.');

  recorrerCeldas(ws, (c) => {
    if (c.t === 'n' && c.z && typeof c.v === 'number' && XLSX.SSF.is_date(c.z)) {
      const d = XLSX.SSF.parse_date_code(c.v);
      if (d && d.y) c.w = `${d.y}-${pad(d.m)}-${pad(d.d)}`;
    } else if (c.t === 'd' && c.v instanceof Date && !Number.isNaN(c.v.getTime())) {
      c.w = `${c.v.getFullYear()}-${pad(c.v.getMonth() + 1)}-${pad(c.v.getDate())}`;
    }
  });

  let truncado = false;
  if (ws['!ref']) {
    const rango = XLSX.utils.decode_range(ws['!ref']);
    if (ws['!fullref']) truncado = XLSX.utils.decode_range(ws['!fullref']).e.r > rango.e.r;
    // S-PLA-01: una hoja con rango A1:XFD5000 no se recorre entera.
    if (rango.e.c - rango.s.c > MAX_COLUMNAS_IMPORT) {
      rango.e.c = rango.s.c + MAX_COLUMNAS_IMPORT;
      ws['!ref'] = XLSX.utils.encode_range(rango);
    }
  }
  const filas = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '', blankrows: true });
  return { filas: (Array.isArray(filas) ? filas : []).map(recortarFila), truncado };
};
