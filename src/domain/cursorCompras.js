// src/domain/cursorCompras.js — S-012-02 (REQ-CPR, AC-CPR-3).
// Cursor de bajada de compras por tabla sobre (synced_at, id). synced_at lo pone el SERVIDOR
// (trigger de la 012), asi un dispositivo que sube tarde con updated_at viejos igual llega a los
// demas; el id desempata filas con el mismo instante en el borde de pagina. Funciones puras.

export const TABLAS_CURSOR = Object.freeze({ costos: 'ingreso_id', cuenta: 'id', pedidos: 'id' });

const tsValido = (v) => typeof v === 'string' && v.length <= 64 && Number.isFinite(Date.parse(v));

/** Lee el cursor guardado (JSON). Formatos viejos o invalidos => {} (baja todo: es idempotente). */
export const leerCursorCompras = (texto) => {
  if (!texto || typeof texto !== 'string') return {};
  let crudo;
  try { crudo = JSON.parse(texto); } catch { return {}; }
  if (!crudo || typeof crudo !== 'object' || Array.isArray(crudo)) return {};
  const out = {};
  for (const t of Object.keys(TABLAS_CURSOR)) {
    const c = crudo[t];
    if (c && tsValido(c.ts)) out[t] = { ts: c.ts, id: typeof c.id === 'string' ? c.id.slice(0, 64) : '' };
  }
  return out;
};

/**
 * Cursor para pedir al servidor: cada tabla arranca `solapeMs` antes (y sin id) para cubrir
 * transacciones que confirmaron tarde. Lo que se re-baja se vuelve a guardar igual (idempotente).
 */
export const cursorConSolape = (cursor = {}, solapeMs = 5 * 60 * 1000) => {
  const out = {};
  for (const t of Object.keys(TABLAS_CURSOR)) {
    const c = cursor?.[t];
    if (c && tsValido(c.ts)) out[t] = { ts: new Date(Date.parse(c.ts) - solapeMs).toISOString(), id: '' };
  }
  return out;
};

const ultimaFila = (filas, campoId) => {
  const u = Array.isArray(filas) && filas.length ? filas[filas.length - 1] : null;
  const ts = u?.synced_at;
  if (!u || !tsValido(ts)) return null;
  return { ts, id: String(u[campoId] ?? '') };
};

/**
 * Avanza el cursor con una pagina { costos, cuenta, pedidos } (filas ordenadas por synced_at, id).
 * `soloAdelante` evita retroceder (para el cursor que se guarda). Devuelve { cursor, llenas }.
 */
export const avanzarCursorCompras = (cursor = {}, parte = {}, pagina = 1000, { soloAdelante = false } = {}) => {
  const out = { ...cursor };
  const llenas = [];
  for (const [t, campoId] of Object.entries(TABLAS_CURSOR)) {
    const filas = Array.isArray(parte?.[t]) ? parte[t] : [];
    const u = ultimaFila(filas, campoId);
    if (u) {
      const previo = out[t];
      if (!soloAdelante || !previo || Date.parse(u.ts) >= Date.parse(previo.ts)) out[t] = u;
    }
    if (filas.length >= pagina && u) llenas.push(t);
  }
  return { cursor: out, llenas };
};
