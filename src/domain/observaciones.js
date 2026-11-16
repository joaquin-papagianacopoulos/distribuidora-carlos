// src/domain/observaciones.js — REQ-OBS: notas del pedido ("Observaciones") sincronizadas.
// Antes la nota quedaba solo en el dispositivo que cargo el pedido: el que armaba o imprimia el
// remito desde otro dispositivo no la veia. Funciones puras: sin React, sin IndexedDB, sin Supabase.

export const MAX_OBSERVACIONES_PEDIDO = 500;

// Texto de la nota: sin caracteres de control (salvo salto de linea), sin espacios de mas y con tope.
export function normalizarObservaciones(v) {
  if (typeof v !== 'string' && typeof v !== 'number') return '';
  // eslint-disable-next-line no-control-regex
  return String(v).replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').trim().slice(0, MAX_OBSERVACIONES_PEDIDO);
}

// AC-OBS-3: nota a mostrar de un pedido. Un pedido web trae la nota del cliente en webContacto.
export function notaDePedido(pedido) {
  if (!pedido || typeof pedido !== 'object') return '';
  return normalizarObservaciones(pedido.observaciones) || normalizarObservaciones(pedido.webContacto?.observaciones);
}

// ---- Sync (migracion 028) ----
// La clave viaja solo si el pedido la conoce (`!== undefined`): un dispositivo viejo no la pisa.
export const observacionesToRemote = (p) =>
  (p && typeof p === 'object' && p.observaciones !== undefined && p.observaciones !== null
    ? { observaciones: normalizarObservaciones(p.observaciones) }
    : {});

// `undefined` (columna inexistente) o null (pedido anterior a la 028) conserva la nota local.
export const observacionesFromRemote = (r, local) => {
  if (!r || r.observaciones === undefined || r.observaciones === null) {
    return local?.observaciones !== undefined ? { observaciones: local.observaciones } : {};
  }
  return { observaciones: normalizarObservaciones(r.observaciones) };
};

// Fila sin la columna de la 028 (si todavia no se aplico).
export const sinColumnas028 = (row) => {
  if (!row || typeof row !== 'object') return row;
  const { observaciones: _o, ...resto } = row;
  return resto;
};

export const nombraColumna028 = (error) => /\bobservaciones\b/i.test(String(error?.message || ''));
