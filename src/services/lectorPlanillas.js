// src/services/lectorPlanillas.js — REQ-PLA, RUN 20261012-2106 iteracion 2.
// Lee el archivo elegido (File/Blob) y devuelve las filas crudas para
// planificarImportacion. Orquesta: la logica (limites, decodificacion,
// delimitador, fechas) esta en src/domain/importacion.js.
//  - S-DEP-01: el .xlsx se parsea en un Web Worker con timeout; si el entorno
//    no tiene Worker (tests, navegadores viejos) se usa el mismo codigo en el
//    hilo principal (fallback testeable). Sin .xls. Magic bytes PK.
//  - S-PLA-01: 5 MB, filas, columnas y largo de celda acotados.
//  - BUG-PLA-03: CSV leido como bytes (UTF-8 estricto o Windows-1252, sin BOM).
//  - BUG-PLA-02: un solo delimitador por archivo.
import {
  tipoArchivoImport, esZip, decodificarTexto, quitarBOM, filasDesdeCSV,
  MSG_EXCESO_FILAS, MSG_TIMEOUT, MSG_XLSX_INVALIDO, TIMEOUT_LECTURA_MS,
} from '../domain/importacion';
import { filasDesdeLibro } from './planillaXlsx';

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

const crearWorkerPorDefecto = async () => {
  if (typeof Worker === 'undefined') return null;
  const { crearWorkerXlsx } = await import('./workerXlsx');
  return crearWorkerXlsx();
};

const leerEnHiloPrincipal = async (buf) => {
  const XLSX = await import('xlsx');
  return filasDesdeLibro(XLSX, buf);
};

/**
 * Parsea un .xlsx (ArrayBuffer). `crearWorker` devuelve un Worker (o algo con
 * postMessage/terminate/onmessage/onerror) o null para usar el fallback.
 * @returns {Promise<{ filas: string[][], truncado: boolean }>}
 */
export const leerXlsx = async (buf, { crearWorker = crearWorkerPorDefecto, timeoutMs = TIMEOUT_LECTURA_MS } = {}) => {
  let worker = null;
  try {
    worker = await crearWorker();
  } catch (e) {
    worker = null; // p. ej. CSP que bloquea workers: se lee igual (sin aislamiento)
  }
  if (!worker) return leerEnHiloPrincipal(buf);
  return new Promise((resolve, reject) => {
    let terminado = false;
    const fin = (fn, valor) => {
      if (terminado) return;
      terminado = true;
      clearTimeout(timer);
      try { worker.terminate(); } catch (e) { /* ya terminado */ }
      fn(valor);
    };
    const timer = setTimeout(() => fin(reject, new Error(MSG_TIMEOUT)), timeoutMs);
    worker.onmessage = (e) => {
      const d = e?.data;
      if (d && d.ok === true && Array.isArray(d.filas)) fin(resolve, { filas: d.filas, truncado: d.truncado === true });
      else fin(reject, new Error(String(d?.error || 'No se pudo leer el archivo XLSX.')));
    };
    worker.onerror = () => fin(reject, new Error('No se pudo leer el archivo XLSX.'));
    worker.postMessage(buf);
  });
};

/**
 * File -> { filas, origen: 'csv'|'xlsx' }. Lanza Error con un mensaje claro.
 */
export const leerFilasArchivo = async (file, opciones = {}) => {
  if (!file) throw new Error('No se eligió ningún archivo.');
  if (Number(file.size) > MAX_IMPORT_BYTES) throw new Error('El archivo supera 5 MB.');
  const tipo = tipoArchivoImport(file.name);
  if (!tipo.ok) throw new Error(tipo.error);

  if (tipo.tipo === 'xlsx') {
    const buf = await file.arrayBuffer();
    if (!esZip(new Uint8Array(buf, 0, Math.min(4, buf.byteLength)))) throw new Error(MSG_XLSX_INVALIDO);
    const r = await leerXlsx(buf, opciones);
    if (r.truncado) throw new Error(MSG_EXCESO_FILAS);
    return { filas: r.filas, origen: 'xlsx' };
  }

  let texto;
  if (typeof file.arrayBuffer === 'function') texto = decodificarTexto(new Uint8Array(await file.arrayBuffer())).texto;
  else texto = quitarBOM(await file.text());
  const r = filasDesdeCSV(texto);
  if (!r.ok) throw new Error(r.error);
  return { filas: r.filas, origen: 'csv' };
};
