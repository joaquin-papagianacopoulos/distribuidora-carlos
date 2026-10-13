// src/domain/validacion.js — helpers puros de validación/normalización.
// Sin React ni IndexedDB: todo lo que entra desde formularios o archivos pasa
// por acá antes de guardarse (REQ-SEC / AC-SEC-2).

const MAX_TEXTO = 200;

// Texto limpio: sin caracteres de control, espacios colapsados, largo acotado.
export const texto = (v, max = MAX_TEXTO) => {
  if (v === null || v === undefined) return '';
  return String(v)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
};

// Número finito o null. Acepta coma decimal ("1.234,5" y "1234,5").
export const toNum = (v) => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).trim().replace(/\s/g, '').replace(/^\$/, '');
  if (s === '') return null;
  // Si hay punto y coma, el ULTIMO separador es el decimal: "1.234,50" (AR) y
  // "1,234.50" (US) dan 1234.5. Con solo coma, la coma es decimal.
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
  else if (lastComma >= 0) s = s.replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

// Entero o null (rechaza decimales: "1.5" → null).
export const toInt = (v) => {
  const n = toNum(v);
  return n !== null && Number.isInteger(n) ? n : null;
};

export const redondear2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export const soloDigitos = (v) => String(v ?? '').replace(/\D/g, '');

// ---- CUIT / CUIL (AFIP/ARCA): 11 dígitos, prefijo válido y dígito verificador ----
const CUIT_PREFIJOS = ['20', '23', '24', '25', '26', '27', '30', '33', '34'];
const CUIT_PESOS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

export const validarCuit = (v) => {
  const d = soloDigitos(v);
  if (d.length !== 11) return false;
  if (!CUIT_PREFIJOS.includes(d.slice(0, 2))) return false;
  const suma = CUIT_PESOS.reduce((acc, p, i) => acc + p * Number(d[i]), 0);
  let dv = 11 - (suma % 11);
  if (dv === 11) dv = 0;
  if (dv === 10) return false;
  return dv === Number(d[10]);
};

export const formatearCuit = (v) => {
  const d = soloDigitos(v);
  return d.length === 11 ? `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}` : d;
};

// Fecha YYYY-MM-DD válida (calendario real).
export const esFechaISO = (v) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))) return false;
  const [y, m, d] = String(v).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};

export const hoyISO = (now = new Date()) =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

// Clave de comparación case/acento-insensible para unicidad de códigos.
export const claveUnica = (v) => texto(v).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// AC-SEC-3: neutraliza "formula injection" al exportar/importar CSV/XLSX.
// Una celda que empieza con = + - @ (o tab/CR) se ejecuta como fórmula en
// Excel/LibreOffice; se le antepone un apóstrofo. Los números puros se respetan.
export const csvSafe = (v) => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return v;
  const s = String(v);
  if (/^-?\d+([.,]\d+)?$/.test(s.trim())) return s;
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
};

// UUID v4 (usa crypto.randomUUID si está; fallback con getRandomValues).
export const nuevoId = () => {
  const c = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};
