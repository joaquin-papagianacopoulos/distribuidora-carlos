import { supabase } from '../lib/supabase';
import {
  addPedido,
  markPedidoSynced,
  getPedidos,
  putPedido,
  updatePedido,
} from '../db';
import { normalizePedidoOrdenEntrega } from '../utils/ordenEntrega';
import { makePedidoEliminado, normalizePedidoFecha } from '../utils/pedidos';
import { aplicarStockPedido } from './stockService';
import { getNombreUsuarioSesion, getUsuarioSesion } from './sesion';
import { marcarEntregado, pedidoEntregaToRemote, sinColumnasEntrega, validarCambioEntrega } from '../domain/comisiones';
import { esColumnaInexistente, esFuncionInexistente } from '../sync/tolerancia';
import { credencialesAdminProductos } from './productosAdminService';
import { itemsSinCostos } from '../domain/panel';
import { asegurarClientUuid, clientUuidToRemote, esErrorClientUuid } from '../domain/pedidosIdempotencia';
import { gruposToRemote, sinColumnas011, nombraColumna011 } from '../domain/gruposFactura';
import { vendedorToRemote, sinColumnas024, nombraColumna024, asignarVendedor } from '../domain/vendedorPedido';
import { redondeoToRemote, sinColumnas025, nombraColumna025 } from '../domain/redondeo';
import { modificadoToRemote, aplicarEdicion, confirmarModificacion } from '../domain/edicionPedido';
import { puedeEditarPedido, puedeAsignarVendedor } from '../domain/permisos';
import { traerPedidoRemoto } from '../sync/syncService';

const toRemoteRow = (pedido) => {
  const p = normalizePedidoOrdenEntrega(pedido);
  return {
    cliente_id: p.clienteId ?? null,
    cliente_nombre: p.clienteNombre ?? '',
    vendedor: p.vendedor ?? p.vendedorNombre ?? '',
    zona: p.zona ?? '',
    fecha: normalizePedidoFecha(p.fecha) || null,
    items: itemsSinCostos(p.items) ?? [],
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
    // Tanda 1 (migracion 024): vendedor del pedido, quien lo cargo y marca "Modificado" (solo si el pedido los conoce).
    ...vendedorToRemote(p),
    ...modificadoToRemote(p),
    // Tanda 2 (migracion 025): redondeo del total (solo si el pedido lo conoce).
    ...redondeoToRemote(p),
    // AC-SEG2-3: id de idempotencia del alta (solo viaja si el pedido lo tiene).
    ...clientUuidToRemote(p),
    updated_at: new Date().toISOString(),
  };
};

const findLocal = async (id) => {
  const pedidos = await getPedidos();
  return pedidos.find(p => p.id === id) || null;
};

let avisoSinClientUuid = false;

// AC-SEG2-3: alta idempotente por client_uuid (indice unico, migracion 023). Si la respuesta se
// pierde y se reintenta, no se crea un segundo pedido: se lee el id existente por el UUID.
// Sin la 023 (columna o indice ausentes) vuelve al insert de siempre y avisa una sola vez.
// Devuelve { data: { id }, error } como el insert().select().single() de antes.
const insertarPedidoIdempotente = async (row) => {
  if (row.client_uuid) {
    const r = await supabase.from('pedidos')
      .upsert(row, { onConflict: 'client_uuid', ignoreDuplicates: true })
      .select('id,client_uuid,updated_at');
    if (!esErrorClientUuid(r.error)) {
      if (r.error) return { data: null, error: r.error };
      const filas = Array.isArray(r.data) ? r.data : (r.data ? [r.data] : []);
      const fila = filas.find(f => f && f.client_uuid === row.client_uuid) || filas[0];
      if (fila) return { data: fila, error: null };
      // Ya existia (conflicto ignorado): se busca el id por el UUID.
      const q = await supabase.from('pedidos').select('id,client_uuid,updated_at').eq('client_uuid', row.client_uuid).limit(1);
      if (q.error) return { data: null, error: q.error };
      const ya = (q.data || [])[0];
      if (!ya) return { data: null, error: new Error('No se pudo confirmar el pedido en la nube') };
      // AC-SEG2-3: ya existia (alta previa): la version local puede tener una edicion posterior, asi que se
      // actualiza por id. Si falla, error: el pedido queda pendiente y no se marca synced con la version vieja.
      const { client_uuid: _cu, ...cambios } = row; // eslint-disable-line no-unused-vars
      const u = await supabase.from('pedidos').update(cambios).eq('id', ya.id).select('id,client_uuid,updated_at');
      if (u.error) return { data: null, error: u.error };
      return { data: ya, error: null };
    }
    if (!avisoSinClientUuid) {
      avisoSinClientUuid = true;
      console.warn('Falta aplicar la migracion 023 (pedidos.client_uuid): el alta de pedidos no es idempotente.');
    }
    const { client_uuid: _omitido, ...sinUuid } = row; // eslint-disable-line no-unused-vars
    return supabase.from('pedidos').insert(sinUuid).select('id').single();
  }
  return supabase.from('pedidos').insert(row).select('id').single();
};

// AC-SEG2-3: el pedido se escribe PRIMERO en IndexedDB (con clientUuid y synced:false) y despues
// se intenta subir. Un error de red no pierde nada: devuelve mode 'pendiente' (sin throw) y el
// pedido queda visible como "sin subir" hasta que el sync lo suba.
export const crearPedidoOnlineFirst = async (pedido) => {
  const pedidoNormalizado = asegurarClientUuid({ ...pedido, fecha: normalizePedidoFecha(pedido?.fecha) });
  const localId = await addPedido(pedidoNormalizado);
  if (!navigator.onLine) return { localId, mode: 'offline' };

  try {
    const { data, error } = await insertarPedidoIdempotente(toRemoteRow(pedidoNormalizado));
    if (error) throw error;
    await (data.updated_at ? markPedidoSynced(localId, data.id, { remoteUpdatedAt: data.updated_at }) : markPedidoSynced(localId, data.id));
    return { localId, remoteId: data.id, mode: 'online' };
  } catch (e) {
    return { localId, mode: 'pendiente', error: e };
  }
};

// versionBase (AC-EDP-3): updated_at del servidor sobre el que se edito. Con base, el update es
// condicional (id + updated_at); 0 filas = el pedido cambio en otro dispositivo: no se pisa,
// se revierte lo local y se devuelve { mode: 'conflicto' }.
const guardarPedidoInterno = async (pedido, { versionBase = null } = {}) => {
  const base = { ...pedido, fecha: normalizePedidoFecha(pedido?.fecha) };
  // AC-SEG2-3: un pedido que todavia no esta en la nube lleva su UUID de idempotencia.
  const pedidoNormalizado = base.remoteId ? base : asegurarClientUuid(base);
  const original = pedido?.id ? await findLocal(pedido.id) : null;
  // T1-A-04: todo guardado online de un pedido que ya esta en la nube es condicional por version. Si el que llama
  // no pasa versionBase se usa la ultima version del servidor que conoce este dispositivo (registro local); si el
  // servidor cambio, es un ERROR visible (no se pisa en silencio). Con versionBase explicito se devuelve { mode: 'conflicto' }.
  const explicito = versionBase !== null && versionBase !== undefined && versionBase !== '';
  const baseVersion = explicito ? versionBase : (pedidoNormalizado.remoteId ? (original?.remoteUpdatedAt ?? null) : null);
  const conBase = !!pedidoNormalizado.remoteId && baseVersion !== null && baseVersion !== undefined && baseVersion !== '';

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
    const enviar = (r) => {
      if (!remoteId) return insertarPedidoIdempotente(r);
      const q = supabase.from('pedidos').update(r).eq('id', remoteId);
      return conBase ? q.eq('updated_at', baseVersion).select('id,updated_at') : q.select('id,updated_at').single();
    };

    let { data, error } = await enviar(row);
    let filaEnvio = row;
    // Tanda 2: falta la migracion 025 (redondeo): reintento sin esas columnas (se repite despues por si faltan varias).
    const sin025 = async () => {
      if (error && esColumnaInexistente(error) && nombraColumna025(error)) {
        console.warn('Falta aplicar la migracion 025 (pedidos): el redondeo queda solo en este dispositivo.');
        filaEnvio = sinColumnas025(filaEnvio);
        ({ data, error } = await enviar(filaEnvio));
      }
    };
    await sin025();
    // Tanda 1: falta la migracion 024 (cargado_por, vendedor_id, modificado_tras_armado): reintento sin esas columnas.
    if (error && esColumnaInexistente(error) && nombraColumna024(error)) {
      console.warn('Falta aplicar la migracion 024 (pedidos): vendedor/cargado por y marca Modificado quedan solo en este dispositivo.');
      filaEnvio = sinColumnas024(filaEnvio);
      ({ data, error } = await enviar(filaEnvio));
    }
    // AC-COM-1 / AC-CLI-5: si Supabase todavia no tiene las columnas de
    // entregado (migracion 003 sin correr), se reintenta sin ellas y la marca
    // queda local (entregaPendiente) para subirla cuando exista la columna.
    let entregaPendiente = false;
    // REQ-AGR: falta la columna grupos (migracion 011): reintento sin ella.
    if (error && esColumnaInexistente(error) && nombraColumna011(error)) {
      filaEnvio = sinColumnas011(filaEnvio);
      ({ data, error } = await enviar(filaEnvio));
    }
    await sin025();
    if (error && esColumnaInexistente(error)) {
      const retry = await enviar(sinColumnasEntrega(filaEnvio));
      data = retry.data; error = retry.error;
      entregaPendiente = !error && !!pedidoNormalizado.entregado;
    }
    if (error) throw error;
    if (conBase && (!Array.isArray(data) || data.length === 0)) {
      // AC-EDP-3: el servidor cambio: no se pisa. Se revierte lo local y se avisa.
      if (!explicito) throw new Error('El pedido cambió en otro dispositivo. Recargá la lista y volvé a intentar.');
      if (original) await putPedido(original);
      return { mode: 'conflicto' };
    }
    if (conBase) data = data[0];
    remoteId = data.id;

    await putPedido({
      ...pedidoNormalizado,
      remoteId,
      synced: true,
      syncLock: false,
      entregaPendiente,
      updatedAt: Date.now(),
      // AC-EDP-3: nueva version del servidor; la base de la edicion y un conflicto viejo ya no aplican.
      ...(data.updated_at ? { remoteUpdatedAt: data.updated_at } : {}),
      baseRemoteUpdatedAt: null,
      conflictoEdicion: null,
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
      // T1-A-04: borrar tambien es condicional por version (no pisa la edicion de otro dispositivo).
      const baseBorrar = original?.remoteUpdatedAt ?? null;
      let q0 = supabase.from('pedidos').update(toRemoteRow(eliminado)).eq('id', pedido.remoteId);
      if (baseBorrar) q0 = q0.eq('updated_at', baseBorrar).select('id');
      let { data: dBorrar, error } = await q0;
      if (!error && baseBorrar && Array.isArray(dBorrar) && dBorrar.length === 0) {
        throw new Error('El pedido cambió en otro dispositivo. Recargá la lista y volvé a intentar.');
      }

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
export const guardarPedidoOnlineFirst = async (pedido, { iniciarStock = false, versionBase = null } = {}) => {
  const res = await guardarPedidoInterno(pedido, { versionBase });
  if (res?.mode === 'conflicto') return res; // no se guardo nada: no hay stock que alinear
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

// ---- Tanda 1 (REQ-EDP / REQ-ASV) ----

// AC-EDP-1/2/3: edita un pedido ya enviado. Mismo id/remoteId/clientUuid (no duplica). Online: update
// condicional por version (no pisa en silencio: devuelve { mode: 'conflicto' }); offline: queda
// pendiente con baseRemoteUpdatedAt y el sync decide. El permiso se valida ACA tambien (sesion en memoria).
export const editarPedidoOnlineFirst = async (original, cambios, { productosById = null, cerradoEn = null } = {}) => {
  const usuario = getUsuarioSesion();
  const chk = puedeEditarPedido(usuario, original, { cerradoEn });
  if (!chk.ok) throw new Error(chk.motivo || 'Sin permiso para editar el pedido');
  const editado = aplicarEdicion(original, cambios, { usuario, now: Date.now(), productosById });
  const res = await guardarPedidoOnlineFirst(editado, { versionBase: original?.remoteUpdatedAt ?? null });
  return { ...res, pedido: editado };
};

// AC-ASV-1/2: el admin asigna (o cambia) el vendedor de un pedido existente.
export const asignarVendedorOnlineFirst = async (pedido, vendedor) => {
  const usuario = getUsuarioSesion();
  if (!puedeAsignarVendedor(usuario, pedido)) throw new Error('Solo el admin puede asignar el vendedor de un pedido');
  const nuevo = asignarVendedor(pedido, vendedor, { usuario, now: Date.now() });
  if (nuevo === pedido) throw new Error('Elegí un vendedor');
  const res = await guardarPedidoOnlineFirst(nuevo, { versionBase: pedido?.remoteUpdatedAt ?? null });
  return { ...res, pedido: nuevo };
};

// AC-EDP-2: el armador confirma los cambios del vendedor y la marca "Modificado" se va.
export const confirmarModificacionOnlineFirst = async (pedido) => {
  const usuario = getUsuarioSesion();
  const nuevo = confirmarModificacion(pedido, usuario, Date.now());
  const res = await guardarPedidoOnlineFirst(nuevo, { versionBase: pedido?.remoteUpdatedAt ?? null });
  return { ...res, pedido: nuevo };
};

// AC-EDP-3: el usuario resuelve un conflicto de edicion (nunca se resuelve solo).
// 'servidor' descarta la edicion local y baja la version del servidor; 'mia' sube la local
// sobre la version actual del servidor (requiere conexion).
export const resolverConflictoEdicion = async (pedido, eleccion) => {
  if (!pedido || !pedido.remoteId) throw new Error('El pedido todavía no está en la nube');
  if (!navigator.onLine) throw new Error('Necesitás conexión para resolver el conflicto');
  if (eleccion === 'servidor') {
    await traerPedidoRemoto(pedido.remoteId, { forzar: true });
    return { mode: 'servidor' };
  }
  const { data, error } = await supabase.from('pedidos').select('id,updated_at').eq('id', pedido.remoteId);
  if (error) throw error;
  const actual = (data || [])[0]?.updated_at ?? null;
  const limpio = { ...pedido, conflictoEdicion: null, baseRemoteUpdatedAt: null };
  return guardarPedidoOnlineFirst(limpio, { versionBase: actual });
};

const MSGS_REASIGNAR = {
  no_autorizado: 'PIN incorrecto o tu usuario no es admin.',
  vendedor_invalido: 'El vendedor elegido no está activo.',
  no_encontrado: 'No se encontró el pedido en el servidor.',
  id_invalido: 'Pedido inválido.',
};

// T1-A-01: el admin reasigna el vendedor de un pedido con su PIN (RPC admin_reasignar_vendedor_pedido, migracion 024):
// el trigger de la 024 deja vendedor/vendedor_id/cargado_por inmutables para escrituras directas. Sin la 024
// (la RPC no existe) o con un pedido que todavia no esta en la nube, se asigna por el camino de antes.
export const reasignarVendedorAdmin = async ({ pin, pedido, vendedor } = {}) => {
  const usuario = getUsuarioSesion();
  if (!puedeAsignarVendedor(usuario, pedido)) throw new Error('Solo el admin puede asignar el vendedor de un pedido');
  if (!pedido?.remoteId) return asignarVendedorOnlineFirst(pedido, vendedor);
  if (!navigator.onLine) throw new Error('Necesitás conexión para reasignar el vendedor (se valida con tu PIN en el servidor).');
  const cr = await credencialesAdminProductos(pin);
  if (!cr.ok) throw new Error(cr.mensaje || 'Ingresá tu PIN de admin');
  const nuevo = asignarVendedor(pedido, vendedor, { usuario, now: Date.now() });
  if (nuevo === pedido) throw new Error('Elegí un vendedor');
  const { data, error } = await supabase.rpc('admin_reasignar_vendedor_pedido', {
    ...cr.cred,
    p_pedido_id: String(pedido.remoteId),
    p_vendedor: nuevo.vendedor,
    p_vendedor_id: nuevo.vendedorId === null || nuevo.vendedorId === undefined ? null : String(nuevo.vendedorId),
    p_zona: nuevo.zona || null,
  });
  if (error) {
    if (esFuncionInexistente(error)) {
      console.warn('Falta aplicar la migracion 024: el vendedor se asigna con el update directo.');
      return asignarVendedorOnlineFirst(pedido, vendedor);
    }
    throw error;
  }
  if (!data || data.ok !== true) throw new Error(MSGS_REASIGNAR[data?.motivo] || 'No se pudo reasignar el vendedor');
  await putPedido({ ...nuevo, synced: pedido.synced !== false, ...(data.updated_at ? { remoteUpdatedAt: data.updated_at } : {}) });
  return { mode: 'online', remoteId: pedido.remoteId, pedido: nuevo };
};
