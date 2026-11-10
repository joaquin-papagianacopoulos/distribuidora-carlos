// src/services/ajustesService.js — REQ-RED (AC-RED-1).
// Ajustes de la app sincronizados entre dispositivos (hoy: "Redondeo del total").
// - Lectura: RPC publica `ajustes_app_leer` (sin PIN, dato no sensible). Se cachea en
//   localStorage['ajustesApp']; si nunca se bajo, el default es $500. Sin la migracion 025 se conserva el cache.
// - Escritura: solo online y con PIN de admin (RPC `admin_guardar_redondeo`). El PIN no se guarda ni se loguea.
import { supabase } from '../lib/supabase';
import { REDONDEO_DEFAULT, MULTIPLOS_REDONDEO, normalizarMultiplo } from '../domain/redondeo';
import { getUsuarioSesion } from './sesion';
import { getVendedores } from '../db';
import { esAdmin, validarPinIngresado } from '../domain/permisos';

const CLAVE = 'ajustesApp';

const leerCache = () => {
  try {
    const o = JSON.parse(localStorage.getItem(CLAVE) || '{}');
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch {
    return {};
  }
};

const guardarCache = (parcial) => {
  try {
    localStorage.setItem(CLAVE, JSON.stringify({ ...leerCache(), ...parcial }));
  } catch {
    /* sin storage: se sigue con el default */
  }
};

// Multiplo vigente en este dispositivo (0 / 500 / 1000). Nunca bajo: 500.
export const leerRedondeoLocal = () => {
  const v = leerCache().redondeoTotal;
  return v === undefined || v === null ? REDONDEO_DEFAULT : normalizarMultiplo(v);
};

let avisoFalta025 = false;
const esFuncionInexistente = (e) =>
  ['PGRST202', '42883'].includes(String(e?.code)) || /could not find the function/i.test(String(e?.message || ''));

// Baja los ajustes. No bloquea ni lanza: sin conexion o sin migracion conserva el cache.
// Devuelve { ok, redondeoTotal }.
export const bajarAjustes = async () => {
  const actual = leerRedondeoLocal();
  try {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return { ok: false, redondeoTotal: actual };
    const { data, error } = await supabase.rpc('ajustes_app_leer');
    if (error) {
      if (esFuncionInexistente(error) && !avisoFalta025) {
        avisoFalta025 = true;
        console.warn('Supabase: falta la migracion 025 (ajustes_app_leer). El redondeo usa el valor de este dispositivo.');
      }
      return { ok: false, redondeoTotal: actual };
    }
    const crudo = data && typeof data === 'object' ? data.redondeo_total : undefined;
    if (crudo === undefined || crudo === null || !MULTIPLOS_REDONDEO.includes(Number(crudo))) return { ok: false, redondeoTotal: actual };
    const valor = Number(crudo);
    guardarCache({ redondeoTotal: valor });
    return { ok: true, redondeoTotal: valor };
  } catch {
    return { ok: false, redondeoTotal: actual };
  }
};

export const MENSAJES_AJUSTES = Object.freeze({
  offline: 'Para cambiar el redondeo necesitás conexión.',
  no_admin: 'Solo un administrador puede cambiar el redondeo.',
  sin_id_remoto: 'Tu usuario todavía no está sincronizado con el servidor: sincronizá y volvé a intentar.',
  no_autorizado: 'PIN incorrecto o sin permiso de administrador.',
  multiplo_invalido: 'El redondeo elegido no es válido.',
  falta_migracion: 'Falta la migración 025 en Supabase: el redondeo no se puede guardar todavía.',
  error: 'No se pudo guardar. Probá de nuevo con conexión.',
});

const falla = (motivo, extra = {}) => ({ ok: false, motivo, mensaje: MENSAJES_AJUSTES[motivo] || MENSAJES_AJUSTES.error, ...extra });

// Guarda el redondeo (solo admin, online, con PIN). Devuelve { ok, redondeoTotal } o { ok:false, motivo, mensaje }.
export const guardarRedondeo = async (pin, multiplo) => {
  if (!MULTIPLOS_REDONDEO.includes(Number(multiplo))) return falla('multiplo_invalido');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return falla('offline');
  const sesion = getUsuarioSesion();
  if (!esAdmin(sesion?.permiso)) return falla('no_admin');
  const v = validarPinIngresado(pin);
  if (!v.ok) return falla('no_autorizado', { mensaje: v.error });
  const lista = (await getVendedores()) || [];
  const yo = lista.find(x => x?.id === sesion?.id);
  const rid = yo?.remoteId;
  if (rid === null || rid === undefined || rid === '') return falla('sin_id_remoto');
  try {
    const { data, error } = await supabase.rpc('admin_guardar_redondeo', {
      p_admin_id: String(rid), p_admin_pin: v.pin, p_multiplo: Number(multiplo),
    });
    if (error) return falla(esFuncionInexistente(error) ? 'falta_migracion' : 'error');
    if (!data || typeof data !== 'object') return falla('error');
    if (data.ok === false) return falla(data.motivo === 'multiplo_invalido' ? 'multiplo_invalido' : 'no_autorizado');
    if (data.ok !== true) return falla('error');
    guardarCache({ redondeoTotal: Number(multiplo) });
    return { ok: true, redondeoTotal: Number(multiplo) };
  } catch {
    return falla('error');
  }
};
