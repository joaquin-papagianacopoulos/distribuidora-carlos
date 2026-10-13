// src/services/faltanteRepository.js
// Borra de "Faltantes" lo que ya no falta (un producto tachado que se destacha
// porque aparecio). Lo usan Armado y Facturacion.
import { supabase } from '../lib/supabase';
import { deleteFaltante } from '../db';

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
        await supabase.from('faltantes').delete().eq('id', f.remoteId);
      } catch (e) {
        console.warn('No se pudo borrar faltante en la nube:', e?.message || String(e));
      }
    }
    await deleteFaltante(f.id);
  }
};
