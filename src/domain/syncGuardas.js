// src/domain/syncGuardas.js — REQ-SEG2 (AC-SEG2-4 / AC-SEG2-7): guardas del sync. Puras.

/**
 * AC-SEG2-7: ids de lo enviado que NO cambió mientras se subía (mismo updatedAt):
 * solo a esos se les limpia pendingSync. enviados: [{ id, updatedAt }]; actuales: filas locales.
 */
export const idsSinCambios = (enviados, actuales) => {
  const porId = new Map();
  for (const a of Array.isArray(actuales) ? actuales : []) if (a) porId.set(String(a.id), a);
  const out = [];
  for (const e of Array.isArray(enviados) ? enviados : []) {
    const a = e ? porId.get(String(e.id)) : null;
    if (a && puedeMarcarSynced(a, e.updatedAt)) out.push(e.id);
  }
  return out;
};

/** ¿Se puede marcar como subido? Solo si el registro sigue igual a lo que se envió. */
export const puedeMarcarSynced = (actual, updatedAtEnviado) => {
  if (!actual) return false;
  return (actual.updatedAt ?? null) === (updatedAtEnviado ?? null);
};

/**
 * AC-SEG2-4: ids locales de faltantes que se pueden borrar del dispositivo porque ya no
 * están en el remoto. Solo si la lectura remota fue COMPLETA y no vino vacía; nunca borra
 * lo pendiente de subir ni lo que no tiene remoteId.
 */
export const idsFaltantesABorrar = (locales, remotos, { completo = false } = {}) => {
  if (!completo || !Array.isArray(remotos) || remotos.length === 0) return [];
  const remotoIds = new Set(remotos.map(r => String(r?.id)));
  return (Array.isArray(locales) ? locales : [])
    .filter(l => l && l.remoteId !== undefined && l.remoteId !== null && !l.pendingSync && !remotoIds.has(String(l.remoteId)))
    .map(l => l.id);
};
