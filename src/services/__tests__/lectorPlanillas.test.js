// RUN 20261012-2106 iteracion 2 — lectura de archivos de importacion.
// S-DEP-01 (Worker con timeout + fallback, sin .xls, magic bytes, opciones
// acotadas), S-PLA-01 (tope de filas/columnas en el xlsx), BUG-PLA-01 (fechas)
// y BUG-PLA-03 (CSV ANSI leido por bytes).
import * as XLSX from 'xlsx';
import { leerFilasArchivo, leerXlsx, MAX_IMPORT_BYTES } from '../lectorPlanillas';
import { filasDesdeLibro, OPCIONES_LECTURA_XLSX } from '../planillaXlsx';
import { MAX_FILAS_IMPORT, MAX_COLUMNAS_IMPORT, MSG_EXCESO_FILAS, MSG_TIMEOUT, MSG_XLS, MSG_XLSX_INVALIDO } from '../../domain/importacion';

const libro = (aoa, opts) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa, opts), 'Hoja1');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['otra hoja']]), 'Hoja2');
  return XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
};
const archivo = (name, buf) => ({ name, size: buf.byteLength, arrayBuffer: () => Promise.resolve(buf) });
const sinWorker = { crearWorker: async () => null };

// Worker falso: responde con lo que diga `responder` (o nunca).
const workerFalso = (responder) => {
  const w = {
    terminado: false,
    terminate: jest.fn(() => { w.terminado = true; }),
    postMessage: (buf) => { if (responder) setTimeout(() => responder(w, buf), 0); },
  };
  return w;
};

describe('AC-PLA-6 S-DEP-01 opciones de lectura acotadas', () => {
  test('AC-PLA-6 S-DEP-01 sin formulas, estilos, HTML ni VBA; denso; solo la primera hoja; sheetRows con tope', () => {
    expect(OPCIONES_LECTURA_XLSX).toMatchObject({
      type: 'array', dense: true, sheets: 0, sheetRows: MAX_FILAS_IMPORT + 2,
      cellFormula: false, cellHTML: false, cellStyles: false, bookVBA: false, bookFiles: false, WTF: false,
    });
  });

  test('AC-PLA-4 BUG-PLA-01 las celdas de fecha salen YYYY-MM-DD y solo se lee la primera hoja', () => {
    const r = filasDesdeLibro(XLSX, libro([['Código cliente', 'Fecha de alta'], ['F1', new Date(2026, 9, 1, 12)], ['F2', 5]], { cellDates: true }));
    expect(r).toEqual({ filas: [['Código cliente', 'Fecha de alta'], ['F1', '2026-10-01'], ['F2', '5']], truncado: false });
  });

  test('S-PLA-01 mas filas que el tope => truncado; columnas recortadas', () => {
    const muchas = [['h'], ...Array.from({ length: MAX_FILAS_IMPORT + 5 }, (_, i) => [`x${i}`])];
    expect(filasDesdeLibro(XLSX, libro(muchas)).truncado).toBe(true);
    const ancha = [Array.from({ length: MAX_COLUMNAS_IMPORT + 30 }, (_, i) => `c${i}`)];
    expect(filasDesdeLibro(XLSX, libro(ancha)).filas[0]).toHaveLength(MAX_COLUMNAS_IMPORT + 1);
  });

  test('AC-PLA-6 S-DEP-01 un libro sin hojas da error claro; celdas "d" (cellDates) tambien salen ISO', () => {
    const falso = { read: () => ({ SheetNames: [] }) };
    expect(() => filasDesdeLibro(falso, new ArrayBuffer(4))).toThrow('El archivo XLSX no tiene hojas.');
    const ws = { '!ref': 'A1:A1', A1: { t: 'd', v: new Date(2026, 0, 2) } };
    const conD = { ...XLSX, read: () => ({ SheetNames: ['H'], Sheets: { H: ws } }) };
    expect(filasDesdeLibro(conD, new ArrayBuffer(4)).filas).toEqual([['2026-01-02']]);
  });
});

describe('AC-PLA-6 S-DEP-01 Web Worker con timeout', () => {
  const buf = libro([['a'], ['b']]);

  test('AC-PLA-6 S-DEP-01 usa el worker, recibe solo filas y lo termina', async () => {
    const w = workerFalso((wk) => wk.onmessage({ data: { ok: true, filas: [['a'], ['b']], truncado: false } }));
    await expect(leerXlsx(buf, { crearWorker: async () => w })).resolves.toEqual({ filas: [['a'], ['b']], truncado: false });
    expect(w.terminate).toHaveBeenCalled();
  });

  test('AC-PLA-6 S-DEP-01 si el worker no contesta a tiempo, se corta con mensaje claro', async () => {
    const w = workerFalso(null);
    await expect(leerXlsx(buf, { crearWorker: async () => w, timeoutMs: 20 })).rejects.toThrow(MSG_TIMEOUT);
    expect(w.terminado).toBe(true);
  });

  test('AC-PLA-6 S-DEP-01 error del parser o del worker => rechazo; respuesta tardia se ignora', async () => {
    const malo = workerFalso((wk) => { wk.onmessage({ data: { ok: false, error: 'zip roto' } }); wk.onmessage({ data: { ok: true, filas: [] } }); });
    await expect(leerXlsx(buf, { crearWorker: async () => malo })).rejects.toThrow('zip roto');
    const raro = workerFalso((wk) => wk.onmessage({}));
    await expect(leerXlsx(buf, { crearWorker: async () => raro })).rejects.toThrow('No se pudo leer el archivo XLSX.');
    const caido = workerFalso((wk) => wk.onerror(new Event('error')));
    await expect(leerXlsx(buf, { crearWorker: async () => caido })).rejects.toThrow('No se pudo leer el archivo XLSX.');
  });

  test('AC-PLA-6 S-DEP-01 sin Worker (o si no se puede crear) usa el mismo codigo en el hilo principal', async () => {
    await expect(leerXlsx(buf, sinWorker)).resolves.toEqual({ filas: [['a'], ['b']], truncado: false });
    await expect(leerXlsx(buf, { crearWorker: async () => { throw new Error('CSP'); } })).resolves.toMatchObject({ filas: [['a'], ['b']] });
    // por defecto (jsdom no tiene Worker) tambien cae al fallback
    expect(typeof Worker).toBe('undefined');
    await expect(leerXlsx(buf)).resolves.toMatchObject({ filas: [['a'], ['b']] });
  });
});

describe('AC-PLA-3 AC-PLA-6 leerFilasArchivo', () => {
  test('AC-PLA-6 S-DEP-01 .xls rechazado, >5 MB rechazado sin leer, xlsx sin magic bytes rechazado, sin archivo', async () => {
    const arrayBuffer = jest.fn();
    await expect(leerFilasArchivo({ name: 'v.xls', size: 10, arrayBuffer })).rejects.toThrow(MSG_XLS);
    await expect(leerFilasArchivo({ name: 'g.xlsx', size: MAX_IMPORT_BYTES + 1, arrayBuffer })).rejects.toThrow('El archivo supera 5 MB.');
    expect(arrayBuffer).not.toHaveBeenCalled();
    const cfb = Uint8Array.from([0xD0, 0xCF, 0x11, 0xE0, 0, 0]).buffer;
    await expect(leerFilasArchivo(archivo('disfrazado.xlsx', cfb), sinWorker)).rejects.toThrow(MSG_XLSX_INVALIDO);
    await expect(leerFilasArchivo(null)).rejects.toThrow('No se eligió ningún archivo.');
  });

  test('AC-PLA-3 S-PLA-01 xlsx valido => filas y origen; truncado => error de exceso de filas', async () => {
    await expect(leerFilasArchivo(archivo('p.xlsx', libro([['a'], ['b']])), sinWorker)).resolves.toEqual({ filas: [['a'], ['b']], origen: 'xlsx' });
    const muchas = libro([['h'], ...Array.from({ length: MAX_FILAS_IMPORT + 5 }, (_, i) => [`x${i}`])]);
    await expect(leerFilasArchivo(archivo('m.xlsx', muchas), sinWorker)).rejects.toThrow(MSG_EXCESO_FILAS);
  });

  test('AC-PLA-3 BUG-PLA-03 CSV en Windows-1252 leido por bytes; CSV solo con text() sigue andando (sin BOM)', async () => {
    const bytes = Uint8Array.from([...'Código;Descripción\nF1;Piña'].map(c => c.charCodeAt(0)));
    await expect(leerFilasArchivo(archivo('p.csv', bytes.buffer))).resolves.toEqual({ filas: [['Código', 'Descripción'], ['F1', 'Piña']], origen: 'csv' });
    await expect(leerFilasArchivo({ name: 'p.csv', size: 5, text: () => Promise.resolve('﻿a,b\n1,2') }))
      .resolves.toEqual({ filas: [['a', 'b'], ['1', '2']], origen: 'csv' });
  });

  test('S-PLA-01 CSV con mas filas que el tope => error claro', async () => {
    const txt = ['h', ...Array.from({ length: MAX_FILAS_IMPORT + 1 }, (_, i) => `x${i}`)].join('\n');
    await expect(leerFilasArchivo({ name: 'p.csv', size: txt.length, text: () => Promise.resolve(txt) })).rejects.toThrow(MSG_EXCESO_FILAS);
  });
});
