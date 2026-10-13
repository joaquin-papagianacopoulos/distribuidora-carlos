// src/domain/importacion.js — REQ-PLA (AC-PLA-3/4/5/6), RUN 20261012-2106 iteracion 2.
// Lectura de archivos de importacion SIN efectos: tipo de archivo, limites
// (S-PLA-01), decodificacion del CSV (BUG-PLA-03), delimitador unico por
// archivo (BUG-PLA-02) y fechas de Excel (BUG-PLA-01). Aca no hay xlsx, ni
// File, ni IndexedDB: solo bytes, textos y arrays.

// ---------------------------------------------------------------------------
// S-PLA-01: topes. Un archivo de un tercero no puede colgar la pestaña.
// ---------------------------------------------------------------------------
export const MAX_FILAS_IMPORT = 5000;      // filas con datos (sin el encabezado)
export const MAX_COLUMNAS_IMPORT = 60;     // columnas del encabezado
export const MAX_LARGO_CELDA = 1000;       // caracteres por celda
export const MAX_RECHAZOS_VISIBLES = 200;  // rechazos listados en pantalla
export const TIMEOUT_LECTURA_MS = 20000;   // tope para parsear un XLSX (S-DEP-01)

const miles = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

export const MSG_EXCESO_FILAS = `El archivo tiene más de ${miles(MAX_FILAS_IMPORT)} filas con datos: partilo en varios archivos de hasta ${miles(MAX_FILAS_IMPORT)} filas.`;
export const MSG_EXCESO_COLUMNAS = `El archivo tiene más de ${MAX_COLUMNAS_IMPORT} columnas: usá la plantilla (no agregues columnas).`;
export const MSG_CELDA_LARGA = `Una celda supera los ${miles(MAX_LARGO_CELDA)} caracteres`;
export const MSG_TIMEOUT = 'El archivo tardó demasiado en leerse. Puede estar dañado o ser demasiado grande: guardalo de nuevo como .xlsx o CSV y probá otra vez.';
export const MSG_XLS = 'Los archivos .xls (Excel 97-2003) no se aceptan: guardalo como .xlsx o como CSV.';
export const MSG_XLSX_INVALIDO = 'El archivo no es un .xlsx válido: guardalo de nuevo desde Excel como "Libro de Excel (.xlsx)" o como CSV.';

// S-DEP-01: solo .xlsx y .csv/.txt (sin .xls: BIFF/CFB es la superficie mas
// historica del parser vulnerable).
export const ACCEPT_IMPORT = '.csv,.txt,.xlsx';

/** 'xlsx' | 'csv' segun el nombre; .xls se rechaza. Otra extension se lee como CSV (como antes). */
export const tipoArchivoImport = (nombre) => {
  const n = String(nombre ?? '').toLowerCase().trim();
  if (n.endsWith('.xls')) return { ok: false, error: MSG_XLS };
  if (n.endsWith('.xlsx')) return { ok: true, tipo: 'xlsx' };
  return { ok: true, tipo: 'csv' };
};

/** Un .xlsx es un ZIP: empieza con "PK\x03\x04". */
export const esZip = (bytes) => !!bytes && bytes.length >= 4
  && bytes[0] === 0x50 && bytes[1] === 0x4B && bytes[2] === 0x03 && bytes[3] === 0x04;

// ---------------------------------------------------------------------------
// BUG-PLA-03: decodificacion. UTF-8 estricto y, si no es UTF-8 valido,
// Windows-1252 ("CSV" de Excel en es-AR, ANSI). Sin BOM.
// ---------------------------------------------------------------------------
export const quitarBOM = (s) => String(s ?? '').replace(/^﻿/, '');

// Bytes 0x80-0x9F de Windows-1252 (los indefinidos quedan como el byte).
const CP1252 = [
  0x20AC, 0x81, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6, 0x2030, 0x0160, 0x2039, 0x0152, 0x8D, 0x017D, 0x8F,
  0x90, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014, 0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0x9D, 0x017E, 0x0178,
];

const desdeUnidades = (unidades) => {
  let out = '';
  for (let i = 0; i < unidades.length; i += 8192) out += String.fromCharCode.apply(null, unidades.slice(i, i + 8192));
  return out;
};

export const decodificarWindows1252 = (bytes) => {
  const u = new Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    u[i] = b >= 0x80 && b <= 0x9F ? CP1252[b - 0x80] : b;
  }
  return desdeUnidades(u);
};

const cont = (b) => b !== undefined && b >= 0x80 && b <= 0xBF;

// UTF-8 estricto sin TextDecoder (por ejemplo en los tests con jsdom).
// Devuelve null si los bytes no son UTF-8 valido (overlong, surrogates,
// continuaciones faltantes, > U+10FFFF).
export const decodificarUtf8Estricto = (bytes) => {
  const u = [];
  let i = 0;
  while (i < bytes.length) {
    const c = bytes[i];
    let cp;
    let largo;
    if (c < 0x80) { cp = c; largo = 1; }
    else if (c >= 0xC2 && c <= 0xDF) {
      if (!cont(bytes[i + 1])) return null;
      cp = ((c & 0x1F) << 6) | (bytes[i + 1] & 0x3F); largo = 2;
    } else if (c >= 0xE0 && c <= 0xEF) {
      const b1 = bytes[i + 1];
      if (!cont(b1) || !cont(bytes[i + 2])) return null;
      if ((c === 0xE0 && b1 < 0xA0) || (c === 0xED && b1 > 0x9F)) return null;
      cp = ((c & 0x0F) << 12) | ((b1 & 0x3F) << 6) | (bytes[i + 2] & 0x3F); largo = 3;
    } else if (c >= 0xF0 && c <= 0xF4) {
      const b1 = bytes[i + 1];
      if (!cont(b1) || !cont(bytes[i + 2]) || !cont(bytes[i + 3])) return null;
      if ((c === 0xF0 && b1 < 0x90) || (c === 0xF4 && b1 > 0x8F)) return null;
      cp = ((c & 0x07) << 18) | ((b1 & 0x3F) << 12) | ((bytes[i + 2] & 0x3F) << 6) | (bytes[i + 3] & 0x3F); largo = 4;
    } else return null;
    if (cp > 0xFFFF) {
      const x = cp - 0x10000;
      u.push(0xD800 + (x >> 10), 0xDC00 + (x & 0x3FF));
    } else u.push(cp);
    i += largo;
  }
  return desdeUnidades(u);
};

/**
 * Bytes del CSV -> texto. Primero UTF-8 estricto (TextDecoder con fatal si
 * existe; si no, el decodificador propio); si falla, Windows-1252. Sin BOM.
 * @returns {{ texto: string, codificacion: 'utf-8'|'windows-1252' }}
 */
export const decodificarTexto = (bytes, { TextDecoder: TD = globalThis.TextDecoder } = {}) => {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  let utf8 = null;
  if (typeof TD === 'function') {
    try { utf8 = new TD('utf-8', { fatal: true }).decode(b); } catch (e) { utf8 = null; }
  } else utf8 = decodificarUtf8Estricto(b);
  if (utf8 !== null) return { texto: quitarBOM(utf8), codificacion: 'utf-8' };
  return { texto: quitarBOM(decodificarWindows1252(b)), codificacion: 'windows-1252' };
};

// ---------------------------------------------------------------------------
// BUG-PLA-02: un solo delimitador por archivo, detectado en el encabezado
// (fuera de comillas). Ya no se corta en "," Y ";" a la vez.
// ---------------------------------------------------------------------------
const DELIMITADORES = [';', ',', '\t'];

/** El que mas aparece fuera de comillas en la linea de encabezado. Empate: ";" > "," > tab. Ninguno: ",". */
export const detectarDelimitador = (linea) => {
  const cuenta = { ';': 0, ',': 0, '\t': 0 };
  let comillas = false;
  for (const ch of String(linea ?? '')) {
    if (ch === '"') comillas = !comillas;
    else if (!comillas && ch in cuenta) cuenta[ch]++;
  }
  let mejor = ',';
  let max = 0;
  for (const d of DELIMITADORES) if (cuenta[d] > max) { mejor = d; max = cuenta[d]; }
  return mejor;
};

/** Parte una linea con UN delimitador, respetando comillas ("" = comilla literal). */
export const partirLineaCSV = (linea, delim = ',') => {
  const out = [];
  let actual = '';
  let comillas = false;
  const s = String(linea ?? '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"') {
      if (comillas && s[i + 1] === '"') { actual += '"'; i++; }
      else comillas = !comillas;
    } else if (ch === delim && !comillas) { out.push(actual.trim()); actual = ''; }
    else actual += ch;
  }
  out.push(actual.trim());
  return out;
};

// Recorta lo que llega al dominio (memoria): una columna y un caracter de mas
// alcanzan para que planificarImportacion detecte el exceso y lo informe.
export const recortarFila = (fila) => (Array.isArray(fila) ? fila : [])
  .slice(0, MAX_COLUMNAS_IMPORT + 1)
  .map(c => (c === null || c === undefined ? '' : String(c)).slice(0, MAX_LARGO_CELDA + 1));

/**
 * Texto CSV -> filas. Las lineas vacias se conservan (numero de fila del
 * resumen = linea del archivo, AC-PLA-5). Mas de MAX_FILAS_IMPORT filas con
 * datos => error, sin parsear el resto (S-PLA-01).
 * @returns {{ ok: true, filas: string[][], delimitador: string } | { ok: false, error: string }}
 */
export const filasDesdeCSV = (texto) => {
  const lineas = quitarBOM(texto).split(/\r\n|\n|\r/).map(l => l.trim());
  let conDatos = 0;
  for (const l of lineas) if (l && ++conDatos > MAX_FILAS_IMPORT + 1) return { ok: false, error: MSG_EXCESO_FILAS };
  const encabezado = lineas.find(l => l) || '';
  const delimitador = detectarDelimitador(encabezado);
  const filas = lineas.map(l => (l ? recortarFila(partirLineaCSV(l, delimitador)) : []));
  return { ok: true, filas, delimitador };
};

// ---------------------------------------------------------------------------
// S-PLA-01 en el dominio: lo valida planificarImportacion para CSV y XLSX.
// ---------------------------------------------------------------------------
const vaciaCelda = (c) => c === null || c === undefined || String(c).trim() === '';

/** Cantidad de columnas del encabezado (hasta la ultima no vacia). */
export const largoEncabezado = (headers) => {
  const h = Array.isArray(headers) ? headers : [];
  let n = h.length;
  while (n > 0 && vaciaCelda(h[n - 1])) n--;
  return n;
};

/** Error de limites del archivo entero, o null. `datos` = filas no vacias sin el encabezado. */
export const errorLimitesArchivo = ({ headers, datos }) => {
  if (datos > MAX_FILAS_IMPORT) return MSG_EXCESO_FILAS;
  if (largoEncabezado(headers) > MAX_COLUMNAS_IMPORT) return MSG_EXCESO_COLUMNAS;
  return null;
};

/**
 * Problemas de una fila de datos (motivos de rechazo).
 * `celdasDeMas`: en un CSV, una celda NO vacia mas alla del encabezado casi
 * siempre es una coma o un punto y coma sin comillas que corrio las columnas
 * (BUG-PLA-02): la fila se rechaza en vez de guardarse corrida.
 */
export const problemasDeFila = (fila, largoEnc, { celdasDeMas = false } = {}) => {
  const r = Array.isArray(fila) ? fila : [];
  const out = [];
  if (r.some(c => !vaciaCelda(c) && String(c).length > MAX_LARGO_CELDA)) out.push(MSG_CELDA_LARGA);
  if (celdasDeMas) {
    const n = largoEncabezado(r);
    if (n > largoEnc) {
      out.push(`La fila tiene ${n} columnas y el encabezado ${largoEnc}: revisá que no haya comas o punto y coma sin comillas (por ejemplo en un decimal o un domicilio)`);
    }
  }
  return out;
};

// ---------------------------------------------------------------------------
// BUG-PLA-01: fechas de Excel.
// ---------------------------------------------------------------------------
const pad = (n) => String(n).padStart(2, '0');
const isoValida = (y, m, d) => {
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
};

// Numero de serie de Excel (dias desde 1899-12-30) en un rango razonable
// (1954..2119), para no tomar un codigo o un CUIT como fecha.
export const SERIAL_MIN = 20000;
export const SERIAL_MAX = 80000;
export const fechaDesdeSerial = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v) || v < SERIAL_MIN || v > SERIAL_MAX) return null;
  const dt = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
};

/**
 * Fecha de una celda -> "YYYY-MM-DD", o null si no se reconoce.
 * Acepta: Date, numero de serie de Excel, ISO, D/M/AAAA y fecha con año de 2
 * digitos. Con año de 2 digitos, si el dia o el mes son > 12 no hay duda; si
 * no, decide `corta`: 'mdy' (lo que devuelve xlsx con raw:false para una
 * celda de fecha: "10/1/26") o 'dmy' (lo que escribe una persona en un CSV:
 * "1/10/26").
 */
export const fechaDesdeCelda = (v, { corta = 'mdy' } = {}) => {
  if (v instanceof Date) {
    return Number.isNaN(v.getTime()) ? null : `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  }
  if (typeof v === 'number') return fechaDesdeSerial(v);
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return isoValida(Number(m[1]), Number(m[2]), Number(m[3]));
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return isoValida(Number(m[3]), Number(m[2]), Number(m[1]));
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = 2000 + Number(m[3]);
    if (a > 12) return isoValida(y, b, a);
    if (b > 12) return isoValida(y, a, b);
    return corta === 'dmy' ? isoValida(y, b, a) : isoValida(y, a, b);
  }
  if (/^\d{5}(\.\d+)?$/.test(s)) return fechaDesdeSerial(Number(s));
  return null;
};

/** Primeros MAX_RECHAZOS_VISIBLES rechazos y cuantos quedan afuera (para no renderizar miles de <li>). */
export const rechazosVisibles = (rechazos = []) => {
  const lista = Array.isArray(rechazos) ? rechazos : [];
  return { visibles: lista.slice(0, MAX_RECHAZOS_VISIBLES), ocultos: Math.max(0, lista.length - MAX_RECHAZOS_VISIBLES) };
};
