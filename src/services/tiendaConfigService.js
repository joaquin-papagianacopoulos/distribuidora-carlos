// src/services/tiendaConfigService.js — REQ-POR (AC-POR-2/4/5): Configuración → Tienda.
// Todo pasa por RPC con el PIN del admin (009_tienda_portada.sql). El PIN viaja en la
// llamada y no se guarda. Las imágenes van al bucket "tienda" con un nombre que el
// servidor habilita por 10 minutos (admin_tienda_subida).
import { supabase } from '../lib/supabase';
import { adminCred } from './tiendaLinksService';
import { validarImagen } from '../domain/tiendaPortada';

const MSG_009 = 'Falta correr supabase/migrations/009_tienda_portada.sql en Supabase.';
const faltaMigracion = (error) => ['PGRST202', '42883'].includes(String(error?.code || ''));
const MSG_PIN = 'PIN incorrecto o sin permiso de admin.';

export const leerConfigTienda = async (pin) => {
  const c = await adminCred(pin);
  if (!c.ok) return c;
  const { data, error } = await supabase.rpc('admin_tienda_leer', { p_admin_id: c.p_admin_id, p_admin_pin: c.p_admin_pin });
  if (error) return { ok: false, mensaje: faltaMigracion(error) ? MSG_009 : 'No se pudo leer la configuración.' };
  if (!data || data.ok === false) return { ok: false, mensaje: MSG_PIN };
  return { ok: true, config: data.config || {}, banners: data.banners || [], ofertas: data.ofertas || [] };
};

// `datos` ya validado con validarConfigTienda; el servidor vuelve a validar todo.
export const guardarConfigTienda = async (pin, datos) => {
  const c = await adminCred(pin);
  if (!c.ok) return c;
  const { data, error } = await supabase.rpc('admin_tienda_guardar', { p_admin_id: c.p_admin_id, p_admin_pin: c.p_admin_pin, p: datos });
  if (error) return { ok: false, mensaje: faltaMigracion(error) ? MSG_009 : 'No se pudo guardar la configuración.' };
  if (!data || data.ok === false) {
    return { ok: false, mensaje: data?.motivo === 'invalido' ? `El servidor rechazó los datos (${data.campo || 'revisá el formulario'}).` : MSG_PIN };
  }
  return { ok: true };
};

// Devuelve { ok, url } con la URL pública de la imagen subida.
export const subirImagenTienda = async (pin, file) => {
  const v = validarImagen(file);
  if (!v.ok) return { ok: false, mensaje: v.error };
  const c = await adminCred(pin);
  if (!c.ok) return c;
  const { data, error } = await supabase.rpc('admin_tienda_subida', { p_admin_id: c.p_admin_id, p_admin_pin: c.p_admin_pin, p_tipo: file.type });
  if (error) return { ok: false, mensaje: faltaMigracion(error) ? MSG_009 : 'No se pudo preparar la subida.' };
  if (!data || data.ok === false || typeof data.nombre !== 'string') return { ok: false, mensaje: MSG_PIN };
  const bucket = supabase.storage.from('tienda');
  const up = await bucket.upload(data.nombre, file, { contentType: file.type, upsert: false });
  if (up.error) return { ok: false, mensaje: 'No se pudo subir la imagen (máx. 2 MB, JPG/PNG/WEBP).' };
  const { data: pub } = bucket.getPublicUrl(data.nombre);
  return { ok: true, url: pub?.publicUrl || '' };
};
