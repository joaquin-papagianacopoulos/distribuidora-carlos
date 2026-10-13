// src/domain/permisos.js — roles y PIN (AC-SEC-4, S-COM-01, S-COM-11).
// Lógica pura: sin React, sin IndexedDB, sin Supabase.

export const ROLES = Object.freeze({ ADMIN: 1, VENDEDOR: 2, ARMADOR: 3 });
const VALIDOS = new Set(Object.values(ROLES));

// S-COM-11: permiso entero validado. Solo el NÚMERO 1, 2 o 3; cualquier otra
// cosa ("1" en texto, 1.5, true, [1], 99, NaN) da null y no habilita nada.
// La sesión (useAppContext) ya normaliza con Number() contra la base local,
// así que los permisos legítimos siempre llegan como número.
export const permisoValido = (permiso) =>
  (typeof permiso === 'number' && Number.isInteger(permiso) && VALIDOS.has(permiso) ? permiso : null);

export const esAdmin = (permiso) => permisoValido(permiso) === ROLES.ADMIN;
export const esArmador = (permiso) => permisoValido(permiso) === ROLES.ARMADOR;

// S-COM-01: PIN que tipea el admin para confirmar/anular un cierre. Se valida
// la forma acá; la verificación real la hace el servidor (verificar_pin). El
// PIN no se guarda en ningún lado: viaja solo en la llamada a la RPC.
export const MAX_PIN = 32;
export const validarPinIngresado = (pin) => {
  if (typeof pin !== 'string' && typeof pin !== 'number') return { ok: false, pin: null, error: 'Ingresá tu PIN de admin' };
  const p = String(pin).trim();
  if (!p) return { ok: false, pin: null, error: 'Ingresá tu PIN de admin' };
  // eslint-disable-next-line no-control-regex
  if (p.length > MAX_PIN || /[\u0000-\u001F\u007F]/.test(p)) return { ok: false, pin: null, error: 'PIN inválido' };
  return { ok: true, pin: p, error: null };
};
