// src/services/clientesAdminService.js — REQ-SEG2 (AC-SEG2-1, migracion 023).
// Borrar un cliente pasa por la RPC admin_borrar_cliente (PIN de admin): la tabla ya no admite
// DELETE directo de anon. Sin la 023 (la RPC no existe) se usa el delete directo de antes.
// El PIN llega por parametro, viaja solo en la llamada y no se guarda ni se loguea.
import { supabase } from '../lib/supabase';
import { deleteCliente } from '../db';
import { esAdmin } from '../domain/permisos';
import { esFuncionInexistente } from '../sync/tolerancia';
import { credencialesAdminProductos } from './productosAdminService';
import { getUsuarioSesion } from './sesion';

const MSGS = {
  no_autorizado: 'PIN incorrecto o tu usuario no es admin.',
  tiene_referencias: 'El cliente tiene datos asociados en el servidor y no se puede borrar.',
  id_invalido: 'Cliente inválido.',
};

let avisado = false;

export const borrarClienteAdmin = async ({ pin, cliente } = {}) => {
  if (!esAdmin(getUsuarioSesion()?.permiso)) return { ok: false, motivo: 'no_admin', mensaje: 'Solo un admin puede borrar clientes.' };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { ok: false, motivo: 'offline', mensaje: 'Para borrar un cliente tenés que tener internet. Si no, vuelve a aparecer al sincronizar.' };
  }
  const id = cliente?.id;
  const cr = await credencialesAdminProductos(pin);
  if (!cr.ok) return cr;
  try {
    const { data, error } = await supabase.rpc('admin_borrar_cliente', { ...cr.cred, p_cliente_id: String(id) });
    if (error) {
      if (esFuncionInexistente(error)) {
        if (!avisado) { avisado = true; console.warn('Falta aplicar la migracion 023: el cliente se borra con el delete directo.'); }
        const r = await supabase.from('clientes').delete().eq('id', id);
        if (r.error) throw r.error;
        await deleteCliente(id);
        return { ok: true, sinMigracion: true };
      }
      throw error;
    }
    if (!data || data.ok !== true) {
      const motivo = data?.motivo || 'error';
      return { ok: false, motivo, mensaje: MSGS[motivo] || 'El servidor no confirmó el borrado.' };
    }
    await deleteCliente(id);
    return { ok: true, yaBorrado: !!data.ya_borrado };
  } catch (e) {
    return { ok: false, motivo: 'error', mensaje: e?.message || String(e) };
  }
};
