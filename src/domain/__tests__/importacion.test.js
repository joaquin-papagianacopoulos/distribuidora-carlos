// RUN 20261012-2106 iteracion 2 — src/domain/importacion.js (REQ-PLA).
// BUG-PLA-01/02/03, S-PLA-01 y S-DEP-01 (tipo de archivo) en el dominio.
import { TextDecoder as NodeTextDecoder } from 'util';
import {
  MAX_FILAS_IMPORT, MAX_COLUMNAS_IMPORT, MAX_LARGO_CELDA, MAX_RECHAZOS_VISIBLES,
  MSG_EXCESO_FILAS, MSG_EXCESO_COLUMNAS, MSG_CELDA_LARGA, MSG_XLS, ACCEPT_IMPORT,
  tipoArchivoImport, esZip, quitarBOM, decodificarWindows1252, decodificarUtf8Estricto, decodificarTexto,
  detectarDelimitador, partirLineaCSV, recortarFila, filasDesdeCSV,
  largoEncabezado, errorLimitesArchivo, problemasDeFila,
  fechaDesdeSerial, fechaDesdeCelda, rechazosVisibles,
} from '../importacion';
import { planificarImportacion, normalizarFecha } from '../plantillas';

const utf8 = (s) => Uint8Array.from(Buffer.from(s, 'utf8'));
const latin1 = (s) => Uint8Array.from([...s].map(ch => ch.charCodeAt(0) & 0xff));

describe('AC-PLA-6 S-DEP-01 tipo de archivo', () => {
  test('AC-PLA-6 S-DEP-01 .xls se rechaza con mensaje claro; .xlsx y .csv se aceptan; accept sin .xls', () => {
    expect(tipoArchivoImport('Viejo.XLS')).toEqual({ ok: false, error: MSG_XLS });
    expect(tipoArchivoImport('p.xlsx')).toEqual({ ok: true, tipo: 'xlsx' });
    expect(tipoArchivoImport('p.csv')).toEqual({ ok: true, tipo: 'csv' });
    expect(tipoArchivoImport('p.txt')).toEqual({ ok: true, tipo: 'csv' });
    expect(tipoArchivoImport(undefined)).toEqual({ ok: true, tipo: 'csv' });
    expect(ACCEPT_IMPORT.split(',')).not.toContain('.xls');
  });

  test('AC-PLA-6 S-DEP-01 un .xlsx tiene que empezar con PK\\x03\\x04', () => {
    expect(esZip(Uint8Array.from([0x50, 0x4B, 0x03, 0x04, 1]))).toBe(true);
    expect(esZip(Uint8Array.from([0xD0, 0xCF, 0x11, 0xE0]))).toBe(false); // CFB (.xls)
    expect(esZip(Uint8Array.from([0x50, 0x4B]))).toBe(false);
    expect(esZip(null)).toBe(false);
  });
});

describe('AC-PLA-3 BUG-PLA-03 decodificacion del CSV', () => {
  test('AC-PLA-3 BUG-PLA-03 UTF-8 valido (con y sin TextDecoder) y sin BOM', () => {
    const b = utf8('﻿Código;Descripción\nF1;Piña 😀');
    expect(decodificarTexto(b, { TextDecoder: NodeTextDecoder })).toEqual({ texto: 'Código;Descripción\nF1;Piña 😀', codificacion: 'utf-8' });
    expect(decodificarTexto(b, { TextDecoder: null })).toEqual({ texto: 'Código;Descripción\nF1;Piña 😀', codificacion: 'utf-8' });
  });

  test('AC-PLA-3 BUG-PLA-03 ANSI / Windows-1252 cae al fallback con tildes, ñ y euro', () => {
    const b = Uint8Array.from([...latin1('Piña Descripción '), 0x80, 0x93, 0x94]);
    const esperado = 'Piña Descripción €“”';
    expect(decodificarTexto(b, { TextDecoder: NodeTextDecoder })).toEqual({ texto: esperado, codificacion: 'windows-1252' });
    expect(decodificarTexto(b, { TextDecoder: null })).toEqual({ texto: esperado, codificacion: 'windows-1252' });
    expect(decodificarTexto(undefined, { TextDecoder: null })).toEqual({ texto: '', codificacion: 'utf-8' });
    expect(decodificarTexto([0x41], { TextDecoder: null }).texto).toBe('A');
  });

  test.each([
    ['continuacion faltante', [0xC3, 0x41]],
    ['overlong de 2 bytes', [0xC0, 0x80]],
    ['overlong E0', [0xE0, 0x80, 0x80]],
    ['surrogate ED A0', [0xED, 0xA0, 0x80]],
    ['overlong F0', [0xF0, 0x80, 0x80, 0x80]],
    ['mayor a U+10FFFF', [0xF4, 0x90, 0x80, 0x80]],
    ['byte F5', [0xF5]],
    ['3 bytes truncado', [0xE2, 0x82]],
    ['4 bytes truncado', [0xF0, 0x9F, 0x98]],
  ])('AC-PLA-3 BUG-PLA-03 decodificador propio estricto rechaza %s', (_n, bytes) => {
    expect(decodificarUtf8Estricto(Uint8Array.from(bytes))).toBeNull();
  });

  test('AC-PLA-3 BUG-PLA-03 el decodificador propio coincide con TextDecoder en texto valido', () => {
    const s = 'aé€😀 ñÑ “x”';
    expect(decodificarUtf8Estricto(utf8(s))).toBe(new NodeTextDecoder('utf-8', { fatal: true }).decode(utf8(s)));
    expect(decodificarWindows1252(Uint8Array.from([0x81, 0xE9]))).toBe('\u0081é');
    expect(quitarBOM('﻿x')).toBe('x');
    expect(quitarBOM(null)).toBe('');
  });
});

describe('AC-PLA-3 BUG-PLA-02 un solo delimitador por archivo', () => {
  test.each([
    ['Código;Descripción;Costo final', ';'],
    ['nombre,precio,codigo', ','],
    ['a\tb\tc', '\t'],
    ['"Precio, venta";Costo;Otro', ';'],
    ['solo', ','],
    ['a;b,c', ';'],
    [undefined, ','],
  ])('AC-PLA-3 BUG-PLA-02 encabezado %j => %j', (linea, d) => {
    expect(detectarDelimitador(linea)).toBe(d);
  });

  test('AC-PLA-3 BUG-PLA-02 con ";" la coma decimal y la coma del domicilio no parten la celda', () => {
    expect(partirLineaCSV('D1;Decimal;1234,50;1500,75;12', ';')).toEqual(['D1', 'Decimal', '1234,50', '1500,75', '12']);
    expect(partirLineaCSV('0200;Con coma;Mitre 123, piso 2;Rosario', ';')).toEqual(['0200', 'Con coma', 'Mitre 123, piso 2', 'Rosario']);
    expect(partirLineaCSV('A1;"Coca; 500ml";"dice ""hola"""', ';')).toEqual(['A1', 'Coca; 500ml', 'dice "hola"']);
    expect(partirLineaCSV(null)).toEqual(['']);
  });

  test('AC-PLA-5 BUG-PLA-02 filasDesdeCSV conserva renglones vacios (numero de fila) y usa el delimitador del encabezado', () => {
    const r = filasDesdeCSV('﻿Código;Descripción\r\n\r\nA;Mitre 1, piso 2\rB;x\n');
    expect(r.ok).toBe(true);
    expect(r.delimitador).toBe(';');
    expect(r.filas).toEqual([['Código', 'Descripción'], [], ['A', 'Mitre 1, piso 2'], ['B', 'x'], []]);
  });

  test('AC-PLA-3 BUG-PLA-02 una fila con celdas de mas que el encabezado (CSV) se rechaza con motivo; con celdasDeMas=false no', () => {
    const rows = filasDesdeCSV('Código,Descripción,Costo final\nD1,Decimal,1234,50\nD2,Ok,10,\n').filas;
    const plan = planificarImportacion(rows, 'productos', { celdasDeMas: true });
    expect(plan.entradas[0].accion).toBe('rechazar');
    expect(plan.entradas[0].errores[0]).toMatch(/4 columnas y el encabezado 3/);
    // celda vacia de mas (coma final) no es problema
    expect(plan.entradas[1].accion).toBe('crear');
    expect(planificarImportacion(rows, 'productos', {}).entradas[0].accion).toBe('crear');
  });
});

describe('AC-PLA-5 S-PLA-01 topes de filas, columnas y largo de celda', () => {
  test('S-PLA-01 filasDesdeCSV corta con mensaje claro si hay mas de MAX_FILAS_IMPORT filas con datos', () => {
    const ok = ['h', ...Array.from({ length: MAX_FILAS_IMPORT }, (_, i) => `x${i}`)].join('\n');
    expect(filasDesdeCSV(ok).ok).toBe(true);
    const mucho = `${ok}\nuna mas`;
    expect(filasDesdeCSV(mucho)).toEqual({ ok: false, error: MSG_EXCESO_FILAS });
    expect(MSG_EXCESO_FILAS).toMatch(/5\.000 filas/);
  });

  test('S-PLA-01 recortarFila deja una columna y un caracter de mas (para detectar el exceso) y pasa todo a texto', () => {
    const r = recortarFila([...Array(MAX_COLUMNAS_IMPORT + 10).fill('a'), 'z'.repeat(5000)]);
    expect(r).toHaveLength(MAX_COLUMNAS_IMPORT + 1);
    expect(recortarFila(['z'.repeat(5000), null, 3])).toEqual(['z'.repeat(MAX_LARGO_CELDA + 1), '', '3']);
    expect(recortarFila(undefined)).toEqual([]);
  });

  test('S-PLA-01 errorLimitesArchivo y largoEncabezado', () => {
    expect(largoEncabezado(['a', 'b', '', ' '])).toBe(2);
    expect(largoEncabezado(null)).toBe(0);
    expect(errorLimitesArchivo({ headers: ['a'], datos: MAX_FILAS_IMPORT })).toBeNull();
    expect(errorLimitesArchivo({ headers: ['a'], datos: MAX_FILAS_IMPORT + 1 })).toBe(MSG_EXCESO_FILAS);
    expect(errorLimitesArchivo({ headers: Array(MAX_COLUMNAS_IMPORT + 1).fill('c'), datos: 1 })).toBe(MSG_EXCESO_COLUMNAS);
  });

  test('S-PLA-01 problemasDeFila: celda demasiado larga', () => {
    expect(problemasDeFila(['a', 'x'.repeat(MAX_LARGO_CELDA + 1)], 2)).toEqual([MSG_CELDA_LARGA]);
    expect(problemasDeFila(['a', 'x'.repeat(MAX_LARGO_CELDA)], 2)).toEqual([]);
    expect(problemasDeFila(undefined, 2, { celdasDeMas: true })).toEqual([]);
  });

  test('S-PLA-01 planificarImportacion rechaza el archivo con mas filas o columnas, y la fila con celda larga', () => {
    const head = ['Código', 'Descripción', 'Precio venta 1'];
    const filas = [head, ...Array.from({ length: MAX_FILAS_IMPORT + 1 }, (_, i) => [`C${i}`, `P${i}`, '1'])];
    expect(planificarImportacion(filas, 'productos')).toMatchObject({ ok: false, error: MSG_EXCESO_FILAS });
    const anchas = [[...head, ...Array(MAX_COLUMNAS_IMPORT).fill('Extra')], ['C', 'P', '1']];
    expect(planificarImportacion(anchas, 'productos')).toMatchObject({ ok: false, error: MSG_EXCESO_COLUMNAS });
    const larga = planificarImportacion([head, ['C1', 'x'.repeat(MAX_LARGO_CELDA + 1), '1'], ['C2', 'ok', '1']], 'productos');
    expect(larga.entradas.map(e => e.accion)).toEqual(['rechazar', 'crear']);
    expect(larga.resumen.rechazos[0].motivo).toBe(MSG_CELDA_LARGA);
  });

  test('S-PLA-01 rechazosVisibles lista los primeros y cuenta el resto', () => {
    const muchos = Array.from({ length: MAX_RECHAZOS_VISIBLES + 5 }, (_, i) => ({ fila: i + 2, motivo: 'x' }));
    const r = rechazosVisibles(muchos);
    expect(r.visibles).toHaveLength(MAX_RECHAZOS_VISIBLES);
    expect(r.ocultos).toBe(5);
    expect(rechazosVisibles(null)).toEqual({ visibles: [], ocultos: 0 });
  });
});

describe('AC-PLA-4 BUG-PLA-01 fechas de Excel en Fecha de alta', () => {
  test.each([
    [new Date(2026, 9, 1, 12), '2026-10-01'],
    [46296, '2026-10-01'],
    ['46296', '2026-10-01'],
    ['46296.5', '2026-10-01'],
    ['2026-10-01', '2026-10-01'],
    ['2026-2-3', '2026-02-03'],
    ['1/10/2026', '2026-10-01'],
    ['10/1/26', '2026-10-01'],     // xlsx raw:false (m/d/yy) por defecto
    ['25/12/26', '2026-12-25'],    // dia > 12: no hay duda
    ['12/25/26', '2026-12-25'],    // mes > 12 en la 2da posicion: m/d
  ])('AC-PLA-4 BUG-PLA-01 %p => %s', (v, iso) => {
    expect(fechaDesdeCelda(v)).toBe(iso);
  });

  test('AC-PLA-4 BUG-PLA-01 con corta "dmy" (CSV tipeado) "1/10/26" es 1 de octubre', () => {
    expect(fechaDesdeCelda('1/10/26', { corta: 'dmy' })).toBe('2026-10-01');
    expect(fechaDesdeCelda('1/10/26')).toBe('2026-01-10');
    expect(normalizarFecha('1/10/26', { corta: 'dmy' })).toBe('2026-10-01');
  });

  test.each([
    [new Date('x')], [123], ['12345'], ['99999'], ['31/02/2026'], ['2026-02-31'], ['13/13/26'], ['hola'], [null], [''], ['0/5/26'],
  ])('AC-PLA-4 BUG-PLA-01 %p no es una fecha', (v) => {
    expect(fechaDesdeCelda(v)).toBeNull();
  });

  test('AC-PLA-4 BUG-PLA-01 numero de serie fuera de rango => null; normalizarFecha deja el texto para que se rechace', () => {
    expect(fechaDesdeSerial(19999)).toBeNull();
    expect(fechaDesdeSerial(80001)).toBeNull();
    expect(fechaDesdeSerial('x')).toBeNull();
    expect(normalizarFecha('31/02/2026')).toBe('31/02/2026');
  });
});
