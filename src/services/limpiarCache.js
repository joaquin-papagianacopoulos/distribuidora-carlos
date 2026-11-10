// src/services/limpiarCache.js
// "Borrar cache": deja el dispositivo como recien instalado para que vuelva a bajar
// todo desde Supabase. Borra la base local (IndexedDB), las caches del navegador, los
// service workers y los cursores de sync. Conserva el usuario elegido y la zona.
import { cerrarDB } from '../db';
import { evaluarBorradoCache } from './respaldoService';

const DB_NAME = 'distribuidoraDB';
const CLAVES_A_CONSERVAR = ['vendedorActual', 'zonaActiva'];

const borrarIndexedDB = () => new Promise((resolve) => {
  try {
    cerrarDB();
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve(true);
    req.onerror = () => resolve(false);
    // Otra pestaña con la app abierta la mantiene viva: seguimos igual.
    req.onblocked = () => resolve(false);
  } catch {
    resolve(false);
  }
});

const borrarCachesNavegador = async () => {
  try {
    if ('caches' in window) {
      const claves = await window.caches.keys();
      await Promise.all(claves.map(k => window.caches.delete(k)));
    }
  } catch { /* sin Cache API */ }
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
  } catch { /* sin service worker */ }
};

const borrarStorage = () => {
  try {
    Object.keys(localStorage)
      .filter(k => !CLAVES_A_CONSERVAR.includes(k))
      .forEach(k => localStorage.removeItem(k));
  } catch { /* sin storage */ }
  try { sessionStorage.clear(); } catch { /* sin storage */ }
};

// AC-SEG2-2: no borra si hay algo sin subir o no hay conexion, salvo { forzado: true } (el llamador ya
// exporto el respaldo y pidio la confirmacion escrita). Devuelve { bloqueado, motivo, total, porStore }.
export const limpiarCacheLocal = async ({ forzado = false } = {}) => {
  if (!forzado) {
    let ev;
    // AC-SEG2-2: si no se puede leer la base no se sabe que hay pendiente: NO se borra (falla cerrado).
    try { ev = await evaluarBorradoCache(); } catch { return { dbOk: false, bloqueado: true, motivo: 'no_se_pudo_leer' }; }
    if (!ev) return { dbOk: false, bloqueado: true, motivo: 'no_se_pudo_leer' };
    if (!ev.permitir) return { dbOk: false, bloqueado: true, motivo: ev.motivo, total: ev.total, porStore: ev.porStore };
  }
  await borrarCachesNavegador();
  borrarStorage();
  const dbOk = await borrarIndexedDB();
  return { dbOk };
};
