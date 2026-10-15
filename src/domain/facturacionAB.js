// src/domain/facturacionAB.js — REQ-FAB (AC-FAB-1, 2, 3, 4).
// Facturas A / B por pedido y reporte "Facturas a emitir". Funciones puras: sin
// React, sin IndexedDB, sin Supabase. No tocan items, estado ni stock.
import { claveRubro } from './rubros';
import { texto, toNum, redondear2, validarCuit, formatearCuit, esFechaISO } from './validacion';

export const TIPOS_FACTURA = Object.freeze(['A', 'B', 'ninguna']);
export const ETIQUETA_TIPO_FACTURA = Object.freeze({ A: 'Factura A', B: 'Factura B', ninguna: 'Sin factura' });
export const MSG_FALTA_MIGRACION_011 = 'Falta la migración 011 en Supabase: los tipos de factura quedan en este dispositivo.';
const LOTE_MAX = 500;

// Cualquier valor que no sea A/B/ninguna se rechaza (null).
export const normalizarTipoFactura = (v) => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (t === 'A' || t === 'B') return t;
  if (t.toLowerCase() === 'ninguna') return 'ninguna';
  return null;
};

// AC-FAB-1: Responsable Inscripto => A; otro tipo de IVA => B; sin dato => ninguna.
export const sugerirTipoFactura = (cliente) => {
  const iva = claveRubro(cliente?.tipoIva ?? cliente?.tipo_iva ?? '');
  if (!iva) return 'ninguna';
  if (iva === 'responsable inscripto') return 'A';
  return 'B';
};

export const tipoFacturaEfectivo = (pedido, cliente) => {
  const guardado = normalizarTipoFactura(pedido?.tipoFactura);
  if (guardado) return { tipo: guardado, sugerido: false };
  return { tipo: sugerirTipoFactura(cliente), sugerido: true };
};

// Marcado masivo. Devuelve una lista nueva; solo cambian los pedidos de `ids`.
export const marcarTipoFactura = (pedidos, ids, tipo, now = Date.now()) => {
  const t = normalizarTipoFactura(tipo);
  const sel = new Set((ids || []).map(String));
  return (pedidos || []).map(p => {
    if (!t || !sel.has(String(p?.id))) return p;
    return { ...p, tipoFactura: t, tipoFacturaAt: now, tipoFacturaPendiente: true };
  });
};

// AC-FAB-2: aviso (no bloquea) si es factura A y el cliente no tiene un CUIT valido.
export const avisoFacturaA = (tipo, cliente) => {
  if (normalizarTipoFactura(tipo) !== 'A') return null;
  if (validarCuit(cliente?.cuit)) return null;
  return 'Factura A: el cliente no tiene un CUIT válido. Cargalo en su ficha antes de emitir.';
};

// ---- Sincronizacion (RPC con PIN de admin) ----
const pendiente = (p) => !!p?.tipoFacturaPendiente && !!normalizarTipoFactura(p?.tipoFactura) && p?.remoteId != null && p?.remoteId !== '';

export const filasTiposFacturaRpc = (pedidos) =>
  (pedidos || []).filter(pendiente).map(p => ({
    pedido_id: String(p.remoteId),
    tipo_factura: normalizarTipoFactura(p.tipoFactura),
    updated_at: new Date(Number(p.tipoFacturaAt) > 0 ? Number(p.tipoFacturaAt) : Date.now()).toISOString(),
  }));

export const lotesTiposFactura = (filas, tam = LOTE_MAX) => {
  const out = [];
  for (let i = 0; i < (filas || []).length; i += tam) out.push(filas.slice(i, i + tam));
  return out;
};

const esFuncionInexistente = (e) =>
  ['PGRST202', '42883'].includes(String(e?.code)) || /could not find the function/i.test(String(e?.message || ''));

export const MENSAJES_FACTURA = Object.freeze({
  falta_migracion: MSG_FALTA_MIGRACION_011,
  no_autorizado: 'PIN incorrecto o sin permiso de administrador.',
  pin_incorrecto: 'PIN incorrecto o sin permiso de administrador.',
  lote_invalido: 'El lote de pedidos no es válido.',
  rango_invalido: 'El rango de fechas no es válido (máximo un año).',
  respuesta_invalida: 'Respuesta inesperada del servidor.',
  error: 'No se pudo completar la operación. Probá de nuevo con conexión.',
});

const falla = (motivo) => ({ ok: false, motivo, mensaje: MENSAJES_FACTURA[motivo] || MENSAJES_FACTURA.error, guardados: [], rechazados: [] });

export const interpretarGuardarTiposFactura = ({ data, error } = {}) => {
  if (error) return falla(esFuncionInexistente(error) ? 'falta_migracion' : 'error');
  if (!data || typeof data !== 'object') return falla('respuesta_invalida');
  if (data.ok === false) {
    const m = data.motivo === 'no_autorizado' ? 'pin_incorrecto' : (data.motivo === 'lote_invalido' ? 'lote_invalido' : 'error');
    return falla(m);
  }
  if (data.ok !== true || !Array.isArray(data.guardados) || !Array.isArray(data.rechazados)) return falla('respuesta_invalida');
  return {
    ok: true, motivo: null, mensaje: null,
    guardados: data.guardados.map(String),
    rechazados: data.rechazados.filter(r => r && typeof r === 'object')
      .map(r => ({ id: r.id == null ? null : String(r.id), motivo: typeof r.motivo === 'string' ? r.motivo : 'datos_invalidos' })),
  };
};

// ---- Reporte "Facturas a emitir" (AC-FAB-3) ----
export const filaReporteDeRemoto = (r = {}) => ({
  pedidoId: r.pedido_id != null ? String(r.pedido_id) : '',
  fecha: texto(r.fecha, 10),
  clienteNombre: texto(r.cliente_nombre, 200),
  cuit: texto(r.cuit, 20),
  tipoIva: texto(r.tipo_iva, 60),
  tipoFactura: normalizarTipoFactura(r.tipo_factura),
  total: toNum(r.total) ?? 0,
});

export const interpretarFacturasAEmitir = ({ data, error } = {}) => {
  if (error) return { ...falla(esFuncionInexistente(error) ? 'falta_migracion' : 'error'), filas: [] };
  if (!data || typeof data !== 'object') return { ...falla('respuesta_invalida'), filas: [] };
  if (data.ok === false) {
    const m = data.motivo === 'no_autorizado' ? 'pin_incorrecto' : (data.motivo === 'rango_invalido' ? 'rango_invalido' : 'error');
    return { ...falla(m), filas: [] };
  }
  if (data.ok !== true || !Array.isArray(data.filas)) return { ...falla('respuesta_invalida'), filas: [] };
  return { ok: true, motivo: null, mensaje: null, filas: data.filas.filter(f => f && typeof f === 'object').map(filaReporteDeRemoto) };
};

const FILTROS = ['A', 'B', 'todas'];

// Solo pedidos facturados y no borrados, dentro del rango. "ninguna" queda fuera.
// Sin tipo guardado se usa la sugerencia segun el IVA y se marca `sugerido`.
export const armarReporteFacturas = (filas, { desde, hasta, filtro = 'todas' } = {}) => {
  const f = FILTROS.includes(filtro) ? filtro : 'todas';
  const okDesde = esFechaISO(desde) ? desde : null;
  const okHasta = esFechaISO(hasta) ? hasta : null;
  const porTipo = { A: [], B: [] };
  for (const r of filas || []) {
    if (!r || r.borrado === true) continue;
    if (r.estado != null && String(r.estado).toLowerCase() !== 'facturado') continue;
    const fecha = String(r.fecha || '').slice(0, 10);
    if (okDesde && fecha < okDesde) continue;
    if (okHasta && fecha > okHasta) continue;
    const guardado = normalizarTipoFactura(r.tipoFactura);
    const tipo = guardado || sugerirTipoFactura({ tipoIva: r.tipoIva });
    if (tipo !== 'A' && tipo !== 'B') continue;
    if (f !== 'todas' && tipo !== f) continue;
    porTipo[tipo].push({
      pedidoId: r.pedidoId, fecha, clienteNombre: r.clienteNombre || '', cuit: r.cuit ? formatearCuit(r.cuit) : '',
      tipoIva: r.tipoIva || '', tipo, sugerido: !guardado, total: redondear2(toNum(r.total) ?? 0),
    });
  }
  const orden = (a, b) => a.fecha.localeCompare(b.fecha) || String(a.pedidoId).localeCompare(String(b.pedidoId), 'es', { numeric: true });
  const grupos = ['A', 'B'].filter(t => porTipo[t].length).map(t => {
    const filasT = porTipo[t].sort(orden);
    return { tipo: t, filas: filasT, subtotal: redondear2(filasT.reduce((s, x) => s + x.total, 0)) };
  });
  return { grupos, total: redondear2(grupos.reduce((s, g) => s + g.subtotal, 0)) };
};

// El reporte viene del servidor (todos los dispositivos). Lo que este dispositivo marco y
// todavia no subio manda sobre lo que dice el servidor para ese pedido.
export const aplicarTiposLocales = (filas, pedidos) => {
  const locales = new Map(
    (pedidos || [])
      .filter(p => p?.tipoFacturaPendiente && p?.remoteId != null && normalizarTipoFactura(p.tipoFactura))
      .map(p => [String(p.remoteId), normalizarTipoFactura(p.tipoFactura)]),
  );
  if (!locales.size) return filas || [];
  return (filas || []).map(f => (locales.has(String(f.pedidoId)) ? { ...f, tipoFactura: locales.get(String(f.pedidoId)) } : f));
};
