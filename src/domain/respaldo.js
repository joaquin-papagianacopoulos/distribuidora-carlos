// src/domain/respaldo.js — REQ-SEG2 (AC-SEG2-2 / AC-SEG2-6): qué queda sin subir, cuándo se
// puede borrar el caché y cómo se arma el respaldo. Puro: el snapshot lo arma el servicio.

// Stores que viven solo en el dispositivo: cualquier registro cuenta como pendiente.
const SOLO_LOCALES = ['comisionesBorradores', 'comprobantesPendientes'];
// Stores que se recalculan o no se suben: nunca cuentan.
const NUNCA = ['costosVenta'];

/** ¿Este registro todavía no está en la nube? */
export const esPendiente = (store, row) => {
  if (!row || NUNCA.includes(store)) return false;
  if (SOLO_LOCALES.includes(store)) return true;
  if (store === 'faltantes' && !row.remoteId) return true;
  return row.pendingSync === true
    || row.synced === false
    || row.extrasPendientes === true
    || row.entregaPendiente === true;
};

/** snapshot: { [store]: row[] }. Devuelve { total, porStore } (solo stores con pendientes). */
export const contarPendientes = (snapshot) => {
  const porStore = {};
  let total = 0;
  for (const [store, rows] of Object.entries(snapshot || {})) {
    const n = (Array.isArray(rows) ? rows : []).filter(r => esPendiente(store, r)).length;
    if (n > 0) { porStore[store] = n; total += n; }
  }
  return { total, porStore };
};

/** "3 pedidos, 2 clientes" en español, para el aviso de "falta subir". */
export const textoPendientes = (porStore) => Object.entries(porStore || {})
  .map(([k, n]) => `${n} en ${k}`).join(', ');

/** Con pendientes u offline no se borra el caché (salvo camino forzado con respaldo). */
export const decidirBorradoCache = ({ total = 0, online = true } = {}) => {
  if (total > 0) return { permitir: false, motivo: 'pendientes' };
  if (!online) return { permitir: false, motivo: 'offline' };
  return { permitir: true, motivo: 'ok' };
};

/** Segunda confirmación escrita: la palabra BORRAR (sin importar mayúsculas ni espacios). */
export const confirmacionEscritaValida = (txt) => String(txt ?? '').trim().toUpperCase() === 'BORRAR';

const CLAVES_SECRETAS = /^(pin|pinhash|pin_hash|adminpin|pinadmin)$|token|api_?key|password|passwd|clave|secret/i;
const TEXTO_BINARIO = '[archivo no incluido]';

// AC-SEG2-6: datos financieros privados. Solo el admin los lleva en el respaldo.
export const STORES_FINANCIEROS = Object.freeze([
  'costosVenta', 'ingresosCostos', 'cuentaProveedores', 'comisionesCierres', 'comisionesRubro', 'cambiosPrecio',
]);
const CLAVES_FINANCIERAS = /costo|ganancia|descuento|margen/i;

const limpiar = (v, esAdmin) => {
  if (v === null || typeof v !== 'object') return v;
  if ((typeof Blob !== 'undefined' && v instanceof Blob) || (typeof ArrayBuffer !== 'undefined' && (v instanceof ArrayBuffer || ArrayBuffer.isView(v)))) return TEXTO_BINARIO;
  if (Array.isArray(v)) return v.map(x => limpiar(x, esAdmin));
  if (v instanceof Date) return v.toISOString();
  const out = {};
  for (const [k, x] of Object.entries(v)) {
    if (CLAVES_SECRETAS.test(k)) continue;
    if (!esAdmin && CLAVES_FINANCIERAS.test(k)) continue;
    out[k] = limpiar(x, esAdmin);
  }
  return out;
};

/** Objeto listo para JSON: sin PIN ni claves y sin binarios. Si no es admin (por defecto), sin datos financieros. */
export const armarRespaldo = (snapshot, { now = new Date(), dbVersion = null, esAdmin = false } = {}) => {
  const base = {};
  for (const [store, rows] of Object.entries(snapshot || {})) {
    if (!esAdmin && STORES_FINANCIEROS.includes(store)) continue;
    base[store] = rows;
  }
  return {
    app: 'distribuidora',
    generado: new Date(now).toISOString(),
    dbVersion,
    stores: limpiar(base, esAdmin),
  };
};

const dos = (n) => String(n).padStart(2, '0');

/** respaldo-distribuidora-AAAA-MM-DD-HHmm.json (hora local). */
export const nombreArchivoRespaldo = (now = new Date()) => {
  const d = new Date(now);
  return `respaldo-distribuidora-${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}-${dos(d.getHours())}${dos(d.getMinutes())}.json`;
};
