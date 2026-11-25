// src/domain/planillaProductos.js — AC-XLS-2: el ultimo Excel de productos queda guardado en la app
// (bucket privado, migracion 029) para que cualquier admin lo pueda bajar. Logica pura.

export const MAX_BYTES_PLANILLA = 10 * 1024 * 1024;

const MIME_POR_EXT = Object.freeze({
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  csv: 'text/csv',
});

export const extensionPlanilla = (nombre) => {
  const m = /\.([a-z0-9]+)$/i.exec(String(nombre ?? '').trim());
  return m ? m[1].toLowerCase() : '';
};

/** Valida el archivo antes de subirlo. Devuelve { ok, ext, mime } o { ok:false, error }. */
export const validarArchivoPlanilla = (file) => {
  if (!file || typeof file !== 'object') return { ok: false, error: 'No hay archivo para guardar.' };
  const ext = extensionPlanilla(file.name);
  if (!MIME_POR_EXT[ext]) return { ok: false, error: 'Solo se guardan archivos .xlsx, .xls o .csv.' };
  const tam = Number(file.size);
  if (!(tam > 0)) return { ok: false, error: 'El archivo está vacío.' };
  if (tam > MAX_BYTES_PLANILLA) return { ok: false, error: 'El archivo supera los 10 MB.' };
  return { ok: true, ext, mime: MIME_POR_EXT[ext] };
};

/** Nombre para mostrar/guardar el archivo bajado: sin rutas ni caracteres raros. */
export const nombreSeguroDescarga = (nombre, ext = 'xlsx') => {
  const base = String(nombre ?? '').split(/[\\/]/).pop().replace(/[^\w.\- ()áéíóúñÁÉÍÓÚÑ]/g, '_').trim();
  return base || `productos.${ext}`;
};

const p2 = (n) => String(n).padStart(2, '0');

/** "plantilla.xlsx — subido por Jorge el 25/11/2026 14:30 (212 KB)" */
export const textoUltimaPlanilla = (info) => {
  if (!info || info.hay === false) return 'Todavía no se guardó ningún Excel de productos.';
  const d = new Date(info.subido_at);
  const cuando = Number.isNaN(d.getTime()) ? '' : ` el ${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
  const quien = info.subido_por ? ` por ${info.subido_por}` : '';
  const kb = Number(info.tam_bytes) > 0 ? ` (${Math.max(1, Math.round(Number(info.tam_bytes) / 1024))} KB)` : '';
  return `${nombreSeguroDescarga(info.nombre_original)} — subido${quien}${cuando}${kb}`;
};
