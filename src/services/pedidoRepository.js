import { supabase } from '../lib/supabase';
import {
  addPedido,
  addPedidoSynced,
  getPedidos,
  putPedido,
  updatePedido,
} from '../db';
import { normalizePedidoOrdenEntrega } from '../utils/ordenEntrega';
import { makePedidoEliminado, normalizePedidoFecha } from '../utils/pedidos';
import { aplicarStockPedido } from './stockService';
import { getNombreUsuarioSesion, getUsuarioSesion } from './sesion';
import { marcarEntregado, pedidoEntregaToRemote, sinColumnasEntrega, validarCambioEntrega } from '../domain/comisiones';
import { esColumnaInexistente } from '../sync/tolerancia';
import { gruposToRemote, sinColumnas011, nombraColumna011 } from '../domain/gruposFactura';

const toRemoteRow = (pedido) => {
  const p = normalizePedidoOrdenEntrega(pedido);
  return {
    cliente_id: p.clienteId ?? null,
    cliente_nombre: p.clienteNombre ?? '',
    vendedor: p.vendedor ?? p.vendedorNombre ?? '',
    zona: p.zona ?? '',
    fecha: normalizePedidoFecha(p.fecha) || null,
    items: p.items ?? [],
    total: p.total ?? 0,
    estado: p.estado ?? 'pendiente',
    // Armado (preparacion del pedido): campo independiente de "estado", no lo pisa.
    armado: !!p.armado,
    armado_at: p.armadoAt ? new Date(p.armadoAt).toISOString() : null,
    armado_por: p.armadoPor ?? null,
    // Que confirmo (tick verde) y que saco/redujo el armador. Informativo para Facturacion.
    armado_log: p.armadoLog ?? null,
    // "A reparto": ultima verificacion antes de salir a entregar. Independiente de armado/estado.
    a_reparto: !!p.aReparto,
    a_reparto_at: p.aRepartoAt ? new Date(p.aRepartoAt).toISOString() : null,
    a_reparto_por: p.aRepartoPor ?? null,
    // Evita duplicar la deuda de "boleta contra boleta" si se re-factura este pedido desde otro dispositivo.
    deuda_generada: !!p.deudaGenerada,
    // Entregado (REQ-COM, AC-COM-1): independiente de estado y del stock.
    ...pedidoEntregaToRemote(p),
    // REQ-AGR: grupos de la boleta; la clave viaja solo si el pedido la conoce.
    ...gruposToRemote(p),
    updated_at: new Date().toISOString(),
  };
};

const findLocal = async (id) => {
  const pedidos = await getPedidos();
  return pedidos.find(p => p.id === id) || null;
};

export const crearPedidoOnlineFirst = async (pedido) => {
  const pedidoNormalizado = { ...pedido, fecha: normalizePedidoFecha(pedido?.fecha) };
  if (!navigator.onLine) {
    const localId = await addPedido(pedidoNormalizado);
    return { localId, mode: 'offline' };
  }

  const { data, error } = await supabase
    .from('pedidos')
    .insert(toRemoteRow(pedidoNormalizado))
    .select('id')
    .single();

  if (error) throw error;

  const localId = await addPedidoSynced({ ...pedidoNormalizado, remoteId: data.id });
  return { localId, remoteId: data.id, mode: 'online' };
};

const guardarPedidoInterno = async (pedido) => {
  const pedidoNormalizado = { ...pedido, fecha: normalizePedidoFecha(pedido?.fecha) };
  const original = pedido?.id ? await findLocal(pedido.id) : null;

  if (!navigator.onLine) {
    await updatePedido(pedidoNormalizado);
    return { mode: 'offline' };
  }

  // Bloqueo local temprano: impide que un pull remoto viejo pise la edicion.
  if (pedido?.id) {
    await updatePedido({ ...pedidoNormalizado, syncLock: true });
  }

  try {
    let remoteId = pedidoNormalizado.remoteId;
    const row = toRemoteRow(pedidoNormalizado);
    const enviar = (r) => (remoteId
      ? supabase.from('pedidos').update(r).eq('id', remoteId).select('id').single()
      : supabase.from('pedidos').insert(r).select('id').single());

    let { data, error } = await enviar(row);
    // AC-COM-1 / AC-CLI-5: si Supabase todavia no tiene las columnas de
    // entregado (migracion 003 sin correr), se reintenta sin ellas y la marca
    // queda local (entregaPendiente) para subirla cuando exista la columna.
    let entregaPendiente = false;
    let filaEnvio = row;
    // REQ-AGR: falta la columna grupos (migracion 011): reintento sin ella.
    if (error && esColumnaInexistente(error) && nombraColumna011(error)) {
      filaEnvio = sinColumnas011(row);
      ({ data, error } = await enviar(filaEnvio));
    }
    if (error && esColumnaInexistente(error)) {
      const retry = await enviar(sinColumnasEntrega(filaEnvio));
      data = retry.data; error = retry.error;
      entregaPendiente = !error && !!pedidoNormalizado.entregado;
    }
    if (error) throw error;
    remoteId = data.id;

    await putPedido({
      ...pedidoNormalizado,
      remoteId,
      synced: true,
      syncLock: false,
      entregaPendiente,
      updatedAt: Date.now(),
    });

    return { remoteId, mode: 'online' };
  } catch (e) {
    if (original) await putPedido(original);
    throw e;
  }
};

const borrarPedidoInterno = async (pedido) => {
  const original = pedido?.id ? await findLocal(pedido.id) : null;
  const eliminado = makePedidoEliminado({ ...pedido, fecha: normalizePedidoFecha(pedido?.fecha) });

  if (!navigator.onLine) {
    if (!pedido?.remoteId) {
      await putPedido(eliminado);
      return { mode: 'offline' };
    }
    await updatePedido(eliminado);
    return { mode: 'offline' };
  }

  if (pedido?.id) {
    await updatePedido({ ...eliminado, syncLock: true });
  }

  try {
    let finalPedido = eliminado;
    if (pedido.remoteId) {
      let { error } = await supabase
        .from('pedidos')
        .update(toRemoteRow(eliminado))
        .eq('id', pedido.remoteId);

      // Fallback por si la base tuviera una restriccion de estados antigua.
      if (error) {
        finalPedido = makePedidoEliminado(eliminado, 'cancelado');
        const retry = await supabase
          .from('pedidos')
          .update(toRemoteRow(finalPedido))
          .eq('id', pedido.remoteId);
        error = retry.error;
      }

      if (error) throw error;
    }

    await putPedido({
      ...finalPedido,
      synced: true,
      syncLock: false,
      updatedAt: Date.now(),
    });
    return { mode: 'online', softDeleted: true };
  } catch (e) {
    if (original) await putPedido(original);
    throw e;
  }
};

// ---- Control de stock (REQ-STK) ----
// TODO cambio de un pedido pasa por aca, venga de Facturacion, Armado o Lista
// de pedidos. Despues de guardar, el stock se lleva al estado que corresponde
// (facturado => descontado; pendiente/borrado => devuelto). Es idempotente,
// asi que para pedidos no facturados no genera movimientos.
// S-20: el nombre sale de la sesion en memoria (resuelta contra la base), no de
// localStorage, para que nadie firme movimientos con el nombre de otro.
const usuarioActual = () => getNombreUsuarioSesion();

const sincronizarStock = async (pedido, { iniciar = false } = {}) => {
  try {
    await aplicarStockPedido(pedido, iniciar ? { usuario: usuarioActual(), iniciar: true } : { usuario: usuarioActual() });
  } catch (e) {
    // El pedido ya quedo guardado; el stock se re-alinea en el proximo guardado
    // (idempotente). No se corta la operacion del usuario.
    console.error('No se pudo actualizar el stock del pedido:', e?.message || String(e));
  }
};

// opciones.iniciarStock: true SOLO desde la accion "Facturar" (ver aplicarStockPedido).
export const guardarPedidoOnlineFirst = async (pedido, { iniciarStock = false } = {}) => {
  const res = await guardarPedidoInterno(pedido);
  await sincronizarStock({ ...pedido, remoteId: res?.remoteId ?? pedido?.remoteId }, { iniciar: iniciarStock });
  return res;
};

export const borrarPedidoOnlineFirst = async (pedido) => {
  const res = await borrarPedidoInterno(pedido);
  await sincronizarStock({ ...pedido, borrado: true, estado: 'eliminado' });
  return res;
};

// REQ-COM (AC-COM-1): marcar / desmarcar "Entregado". Guarda entregado,
// entregadoAt y entregadoPor (de la sesion en memoria, S-20). NO cambia el
// estado ni pasa por el stock: no se llama a aplicarStockPedido.
// S-COM-05: el permiso se valida ACA tambien (mismos roles que la UI), con el
// rol de la sesion en memoria (no el de localStorage). cerradoEn: id del cierre
// vigente que contiene al pedido, si quien llama lo conoce.
export const marcarEntregadoOnlineFirst = async (pedido, entregado, { cerradoEn = null } = {}) => {
  const chk = validarCambioEntrega(pedido, !!entregado, getUsuarioSesion()?.permiso, cerradoEn);
  if (!chk.ok) throw new Error(chk.motivo);
  const actualizado = marcarEntregado(pedido, entregado, usuarioActual());
  const res = await guardarPedidoInterno(actualizado);
  return { ...res, pedido: actualizado };
};
