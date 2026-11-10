// src/services/faltanteRepository.js
// Borra de "Faltantes" lo que ya no falta (un producto tachado que se destacha
// porque aparecio). Lo usan Armado y Facturacion.
import { supabase } from '../lib/supabase';
import { deleteFaltante } from '../db';
import { esFuncionInexistente } from '../sync/tolerancia';

let avisado023 = false;

// AC-SEG2-1: la nube ya no admite DELETE directo (migracion 023): se borra por la RPC
// borrar_faltantes (sin PIN, archiva antes). Sin la 023 (RPC inexistente) se usa el delete de antes.
// Devuelve { error } (null si salio bien).
export const borrarFaltanteRemoto = async (remoteId) => {
  const rpc = await supabase.rpc('borrar_faltantes', { p_ids: [String(remoteId)] });
  if (!rpc.error) return rpc.data && rpc.data.ok === false ? { error: new Error('El servidor no pudo borrar el faltante') } : { error: null };
  if (!esFuncionInexistente(rpc.error)) return { error: rpc.error };
  if (!avisado023) { avisado023 = true; console.warn('Falta aplicar la migracion 023: el faltante se borra con el delete directo.'); }
  const r = await supabase.from('faltantes').delete().eq('id', remoteId);
  return { error: r.error || null };
};

const mismoPedido = (f, pedido) => {
  if (pedido?.remoteId != null) {
    return f.pedidoId != null && String(f.pedidoId) === String(pedido.remoteId);
  }
  // Pedido todavia sin id remoto: el faltante quedo con pedidoId null, asi que
  // se distingue por cliente y fecha para no borrar el de otro pedido.
  return f.pedidoId == null
    && String(f.clienteNombre || '') === String(pedido?.clienteNombre || '')
    && String(f.fecha || '') === String(String(pedido?.fecha || '').slice(0, 10));
};

export const borrarFaltantesDeProducto = async (faltantes, pedido, productoId) => {
  const coincidencias = (faltantes || []).filter(f => f.productoId === productoId && mismoPedido(f, pedido));
  for (const f of coincidencias) {
    if (f.remoteId && navigator.onLine) {
      try {
        const { error } = await borrarFaltanteRemoto(f.remoteId);
        if (error) throw error;
      } catch (e) {
        console.warn('No se pudo borrar faltante en la nube:', e?.message || String(e));
      }
    }
    await deleteFaltante(f.id);
  }
};
