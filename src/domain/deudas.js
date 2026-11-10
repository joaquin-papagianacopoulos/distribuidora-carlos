// src/domain/deudas.js — REQ-SEG2 (AC-SEG2-1): las deudas no se borran en la nube, se anulan.
// Misma forma que la anulación offline que ya existía (monto 0, pagada, concepto "Anulada").

export const CONCEPTO_ANULADA = 'Anulada';

/** Devuelve la deuda anulada (no muta la original). Queda pendiente de subir. */
export const anularDeuda = (d, now = Date.now()) => ({
  ...d, monto: 0, pagada: true, concepto: CONCEPTO_ANULADA, synced: false, updatedAt: now,
});

/** ¿Es una deuda anulada? (se oculta en las listas). */
export const esDeudaAnulada = (d) => !!d
  && d.concepto === CONCEPTO_ANULADA && Number(d.monto || 0) === 0 && !!d.pagada;
