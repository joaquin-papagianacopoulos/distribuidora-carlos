// src/services/respaldoService.js — REQ-SEG2 (AC-SEG2-2 / AC-SEG2-6).
// Arma el snapshot de TODOS los stores de IndexedDB, cuenta lo que falta subir y exporta un
// respaldo en JSON (sin PIN ni claves). La logica pura vive en src/domain/respaldo.js.
import { leerTodosLosStores } from '../db';
import { contarPendientes, decidirBorradoCache, armarRespaldo, nombreArchivoRespaldo } from '../domain/respaldo';

/** { permitir, motivo, total, porStore }: ¿se puede borrar el cache sin perder nada? */
export const evaluarBorradoCache = async () => {
  const snapshot = await leerTodosLosStores();
  const { total, porStore } = contarPendientes(snapshot);
  const online = typeof navigator === 'undefined' ? true : navigator.onLine !== false;
  return { ...decidirBorradoCache({ total, online }), total, porStore };
};

/** Baja un archivo JSON con todos los stores locales. Devuelve { ok, nombre, registros }. */
export const exportarRespaldo = async ({ esAdmin = false } = {}) => {
  try {
    const snapshot = await leerTodosLosStores();
    const ahora = new Date();
    const respaldo = armarRespaldo(snapshot, { now: ahora, esAdmin });
    const nombre = nombreArchivoRespaldo(ahora);
    const blob = new Blob([JSON.stringify(respaldo)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    const registros = Object.values(snapshot).reduce((n, rows) => n + (Array.isArray(rows) ? rows.length : 0), 0);
    return { ok: true, nombre, registros };
  } catch (e) {
    return { ok: false, mensaje: e?.message || String(e) };
  }
};
