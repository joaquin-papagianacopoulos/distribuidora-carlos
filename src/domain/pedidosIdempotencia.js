// src/domain/pedidosIdempotencia.js — REQ-SEG2 (AC-SEG2-3): alta de pedidos idempotente por clientUuid.
// Funciones puras: sin red ni IndexedDB.

const nuevoId = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

/**
 * ¿El error de Supabase significa "falta la migración 023" (columna client_uuid o su índice único)?
 * PGRST204/42703 nombrando client_uuid, o 42P10 (ON CONFLICT sin índice único que lo respalde).
 */
export const esErrorClientUuid = (error) => {
  if (!error) return false;
  const code = String(error.code);
  const msg = `${error.message || ''} ${error.details || ''}`;
  if (code === '42P10') return true;
  return (code === 'PGRST204' || code === '42703' || /could not find the .* column|column .* does not exist/i.test(msg)) && /client_uuid/i.test(msg);
};

/** Le asigna un UUID de idempotencia al pedido si no lo tiene (no pisa uno existente). */
export const asegurarClientUuid = (p, genId = nuevoId) => (p && p.clientUuid ? p : { ...p, clientUuid: genId() });

/** Fragmento de la fila remota: `{ client_uuid }` o `{}` si el pedido no tiene UUID. */
export const clientUuidToRemote = (p) => (p && p.clientUuid ? { client_uuid: p.clientUuid } : {});

/**
 * Cruza lo enviado con lo que devolvió Supabase POR client_uuid (nunca por posición:
 * la respuesta puede venir parcial o en otro orden). enviados: [{ localId, clientUuid }].
 * filas: [{ id, client_uuid }]. Devuelve [{ localId, remoteId }] solo de los que volvieron.
 */
export const mapearRemoteIds = (enviados, filas) => {
  const porUuid = new Map();
  for (const f of Array.isArray(filas) ? filas : []) {
    if (f && f.client_uuid && f.id !== undefined && f.id !== null) porUuid.set(String(f.client_uuid), f.id);
  }
  const out = [];
  for (const e of Array.isArray(enviados) ? enviados : []) {
    if (!e || !e.clientUuid) continue;
    const remoteId = porUuid.get(String(e.clientUuid));
    if (remoteId !== undefined) out.push({ localId: e.localId, remoteId });
  }
  return out;
};

/**
 * Pull: engancha las filas remotas que son un pedido local todavía sin remoteId (misma
 * clientUuid) en vez de duplicarlo. locales: pedidos IndexedDB; remotos: pedidos ya mapeados
 * ({ id, clientUuid }). Devuelve { vinculos: [{ localId, remoteId }], descartarRemoteIds }.
 */
export const vincularPorClientUuid = (locales, remotos) => {
  const sinRemoto = new Map();
  for (const l of Array.isArray(locales) ? locales : []) {
    if (l && l.clientUuid && (l.remoteId === undefined || l.remoteId === null)) sinRemoto.set(String(l.clientUuid), l);
  }
  const vinculos = [];
  const descartarRemoteIds = [];
  for (const r of Array.isArray(remotos) ? remotos : []) {
    if (!r || !r.clientUuid) continue;
    const l = sinRemoto.get(String(r.clientUuid));
    if (l) {
      vinculos.push({ localId: l.id, remoteId: r.id });
      descartarRemoteIds.push(r.id);
      sinRemoto.delete(String(r.clientUuid));
    }
  }
  return { vinculos, descartarRemoteIds };
};
