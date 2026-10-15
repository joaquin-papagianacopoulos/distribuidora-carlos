// src/services/tiendaLinksService.js — REQ-WEB (AC-WEB-7): links de tienda por vendedor.
// El token lo genera el servidor (256 bits aleatorios, RPC con PIN de admin).
// Acá solo se arma el link; el PIN viaja en la llamada y no se guarda.
import { supabase } from '../lib/supabase';
import { getVendedores } from '../db';
import { getUsuarioSesion } from './sesion';
import { esAdmin, validarPinIngresado } from '../domain/permisos';
import { construirLinkTienda, parsearRespuestaToken } from '../domain/tiendaLinks';

export const adminCred = async (pin) => {
  const sesion = getUsuarioSesion();
  if (!sesion || !esAdmin(sesion.permiso)) return { ok: false, mensaje: 'Solo el admin gestiona los links.' };
  const v = validarPinIngresado(pin);
  if (!v.ok) return { ok: false, mensaje: v.error };
  const lista = await getVendedores();
  const yo = (lista || []).find(x => x?.id === sesion.id);
  if (yo?.remoteId === null || yo?.remoteId === undefined || yo?.remoteId === '') {
    return { ok: false, mensaje: 'Tu usuario de admin todavía no está sincronizado con el servidor.' };
  }
  return { ok: true, p_admin_id: String(yo.remoteId), p_admin_pin: v.pin };
};

const MSG_008 = 'Falta correr supabase/migrations/008_tienda.sql en Supabase.';
const faltaMigracion = (error) => ['PGRST202', '42883'].includes(String(error?.code || ''));

// Devuelve { ok, links: { [vendedorRemoteId]: url } }.
export const listarLinks = async (pin, origin = window.location.origin) => {
  const c = await adminCred(pin);
  if (!c.ok) return c;
  const { data, error } = await supabase.rpc('admin_listar_tokens_tienda', { p_admin_id: c.p_admin_id, p_admin_pin: c.p_admin_pin });
  if (error) return { ok: false, mensaje: faltaMigracion(error) ? MSG_008 : 'No se pudieron traer los links.' };
  if (!data || data.ok === false) return { ok: false, mensaje: 'PIN incorrecto o sin permiso de admin.' };
  const links = {};
  for (const t of data.tokens || []) links[String(t.vendedor_id)] = construirLinkTienda(origin, t.token);
  return { ok: true, links };
};

// Genera (o devuelve el vigente) o regenera el link de un vendedor.
export const obtenerLink = async (pin, vendedorRemoteId, { regenerar = false, origin = window.location.origin } = {}) => {
  const c = await adminCred(pin);
  if (!c.ok) return c;
  const { data, error } = await supabase.rpc('admin_token_tienda', {
    p_admin_id: c.p_admin_id, p_admin_pin: c.p_admin_pin, p_vendedor_id: String(vendedorRemoteId), p_regenerar: !!regenerar,
  });
  if (error) return { ok: false, mensaje: faltaMigracion(error) ? MSG_008 : 'No se pudo generar el link.' };
  const r = parsearRespuestaToken(data);
  if (!r.ok) return { ok: false, mensaje: r.mensaje };
  return { ok: true, link: construirLinkTienda(origin, r.token) };
};
