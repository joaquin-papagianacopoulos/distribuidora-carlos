// src/services/sesion.js — sesion del usuario actual en memoria (S-03 / S-20).
// Lo que hay en localStorage lo puede editar cualquiera desde la consola, asi
// que para FIRMAR movimientos o decidir permisos se usa este valor, que solo
// setea useAppContext despues de resolver al vendedor contra la base local.
let usuario = null;

export const setUsuarioSesion = (v) => { usuario = v ? { id: v.id, nombre: v.nombre || '', permiso: Number(v.permiso || 2) } : null; };
export const getUsuarioSesion = () => usuario;
export const getNombreUsuarioSesion = () => usuario?.nombre || '';

// Lo minimo que se persiste para recordar "quien estaba" (sin PIN ni permiso).
export const datosPersistibles = (v) => (v ? { id: v.id, remoteId: v.remoteId ?? null, nombre: v.nombre || '' } : null);

// PIN recordado por 12 h (revisor, no bloqueante 11): misma seguridad real que
// sessionStorage contra alguien con DevTools, pero sin pedir el PIN cada vez
// que el celular cierra la PWA. Conocer solo el id del admin ya no alcanza.
const SESION_KEY = 'sesionVendedor';
export const SESION_TTL_MS = 12 * 60 * 60 * 1000;
export const marcarSesionValidada = (id, now = Date.now()) => {
  try { localStorage.setItem(SESION_KEY, JSON.stringify({ id: String(id), exp: now + SESION_TTL_MS })); } catch { /* sin storage */ }
};
export const sesionValidada = (id, now = Date.now()) => {
  try {
    const s = JSON.parse(localStorage.getItem(SESION_KEY) || 'null');
    return !!s && s.id === String(id) && Number(s.exp) > now;
  } catch { return false; }
};
export const limpiarSesion = () => { try { localStorage.removeItem(SESION_KEY); } catch { /* sin storage */ } };
