// src/services/facturacionService.js — REQ-FAB (AC-FAB-1, 3).
// Tipo de factura A/B por pedido: vive local en el pedido (tipoFactura) y se sube a
// Supabase SOLO con el PIN del admin (RPC admin_guardar_tipos_factura, migracion 011):
// es un dato fiscal y no puede quedar legible ni escribible con la anon key.
// El PIN llega por parametro, viaja solo en la llamada y NO se guarda ni se loguea.
// Ningun camino de este archivo toca stock ni el estado del pedido.
import { supabase } from '../lib/supabase';
import { getPedidos, patchRegistros } from '../db';
import {
  normalizarTipoFactura, filasTiposFacturaRpc, lotesTiposFactura, interpretarGuardarTiposFactura, interpretarFacturasAEmitir,
} from '../domain/facturacionAB';
import { esFechaISO } from '../domain/validacion';

export const contarTiposFacturaPendientes = async () =>
  filasTiposFacturaRpc((await getPedidos()) || []).length;

// Hay marcas sin subir de pedidos que todavia no tienen remoteId (quedan esperando).
export const contarTiposFacturaSinRemoto = async () =>
  ((await getPedidos()) || []).filter(p => p?.tipoFacturaPendiente && (p.remoteId == null || p.remoteId === '')).length;

// Marca local (offline-first). patchRegistros no toca `synced`: no re-sube todo el pedido.
export const guardarTiposFacturaLocal = async (ids, tipo, now = Date.now()) => {
  const t = normalizarTipoFactura(tipo);
  const lista = [...new Set((ids || []).filter(x => x !== null && x !== undefined))];
  if (!t || !lista.length) return { ok: false, count: 0 };
  await patchRegistros('pedidos', lista, { tipoFactura: t, tipoFacturaAt: now, tipoFacturaPendiente: true });
  return { ok: true, count: lista.length };
};

// Sonda de la 011: con id vacio la RPC responde no_autorizado antes de verificar el PIN
// (no cuenta como intento). Solo "funcion inexistente" => falta la migracion.
export const sondearMigracion011 = async () => {
  try {
    const { data, error } = await supabase.rpc('admin_guardar_tipos_factura', { p_admin_id: '', p_admin_pin: '', p_filas: [] });
    return { faltaMigracion: interpretarGuardarTiposFactura({ data, error }).motivo === 'falta_migracion' };
  } catch {
    return { faltaMigracion: false };
  }
};

// Sube los pendientes (lotes de 500). cred = { p_admin_id, p_admin_pin }.
// Limpia tipoFacturaPendiente SOLO de los pedidos que el servidor confirmo Y que no
// fueron re-marcados mientras se subia (tipoFacturaAt igual al de la foto).
export const subirTiposFactura = async (cred) => {
  if (!cred) return { ok: true, skipped: true, pendientes: await contarTiposFacturaPendientes() };
  const pedidos = (await getPedidos()) || [];
  const foto = new Map(pedidos.map(p => [String(p.remoteId), p]));
  const filas = filasTiposFacturaRpc(pedidos);
  let subidos = 0;
  const rechazados = [];
  for (const lote of lotesTiposFactura(filas)) {
    const { data, error } = await supabase.rpc('admin_guardar_tipos_factura', {
      p_admin_id: String(cred.p_admin_id ?? ''),
      p_admin_pin: String(cred.p_admin_pin ?? ''),
      p_filas: lote,
    });
    const r = interpretarGuardarTiposFactura({ data, error });
    if (!r.ok) {
      return { ok: false, motivo: r.motivo, mensaje: r.mensaje, faltaMigracion: r.motivo === 'falta_migracion', subidos, rechazados, pendientes: await contarTiposFacturaPendientes() };
    }
    const enLote = new Set(lote.map(f => f.pedido_id));
    const confirmados = r.guardados.filter(id => enLote.has(id));
    const actuales = new Map(((await getPedidos()) || []).map(p => [String(p.remoteId), p]));
    const idsLocales = confirmados
      .map(id => ({ antes: foto.get(id), ahora: actuales.get(id) }))
      .filter(x => x.antes && x.ahora && x.ahora.tipoFacturaAt === x.antes.tipoFacturaAt && x.ahora.tipoFactura === x.antes.tipoFactura)
      .map(x => x.ahora.id);
    await patchRegistros('pedidos', idsLocales, { tipoFacturaPendiente: false });
    subidos += confirmados.length;
    rechazados.push(...r.rechazados.filter(x => x.id === null || enLote.has(x.id)));
  }
  return { ok: true, subidos, rechazados, pendientes: await contarTiposFacturaPendientes() };
};

const rangoValido = (desde, hasta) => esFechaISO(desde) && esFechaISO(hasta) && desde <= hasta;

// Reporte "Facturas a emitir": todos los dispositivos, por RPC con PIN. Requiere conexion.
export const consultarFacturasAEmitir = async (cred, desde, hasta) => {
  if (!cred) return { ok: false, motivo: 'pin_requerido', mensaje: 'Ingresá el PIN de administrador.', filas: [] };
  if (!rangoValido(desde, hasta)) return { ok: false, motivo: 'rango_invalido', mensaje: 'Elegí un rango de fechas válido.', filas: [] };
  const { data, error } = await supabase.rpc('admin_facturas_a_emitir', {
    p_admin_id: String(cred.p_admin_id ?? ''),
    p_admin_pin: String(cred.p_admin_pin ?? ''),
    p_desde: desde,
    p_hasta: hasta,
  });
  return interpretarFacturasAEmitir({ data, error });
};

// Aplica a los pedidos locales los tipos que otro dispositivo guardo. No pisa lo que este
// dispositivo tiene pendiente de subir. `filas` viene de consultarFacturasAEmitir.
export const aplicarTiposRemotos = async (filas) => {
  const porRemoto = new Map((filas || []).filter(f => f.tipoFactura).map(f => [String(f.pedidoId), f.tipoFactura]));
  if (!porRemoto.size) return { ok: true, count: 0 };
  const pedidos = (await getPedidos()) || [];
  let count = 0;
  for (const tipo of ['A', 'B', 'ninguna']) {
    const ids = pedidos
      .filter(p => p?.remoteId != null && !p.tipoFacturaPendiente && porRemoto.get(String(p.remoteId)) === tipo && p.tipoFactura !== tipo)
      .map(p => p.id);
    if (ids.length) {
      await patchRegistros('pedidos', ids, { tipoFactura: tipo, tipoFacturaPendiente: false });
      count += ids.length;
    }
  }
  return { ok: true, count };
};
