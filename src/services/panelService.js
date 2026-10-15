// src/services/panelService.js — REQ-PAN (AC-PAN-1/2). Orquesta el Panel entre IndexedDB y Supabase.
// Los costos del momento los captura el SERVIDOR (trigger de la 015) en una tabla privada; aca solo
// se BAJAN con el PIN del admin (admin_costos_venta_bajar) a un cache de solo lectura (costosVenta).
// El cliente nunca escribe costos al servidor. El PIN llega por parametro (cred), viaja solo en la
// llamada y NO se guarda ni se loguea.
import { supabase } from '../lib/supabase';
import { getPedidos, getProductos, getRendiciones, getCostosVenta, putCostosVentaBatch } from '../db';
import { interpretarRpcRendicion } from '../domain/rendicion';
import { leerCursorCompras, cursorConSolape, avanzarCursorCompras, TABLAS_CURSOR_PANEL } from '../domain/cursorCompras';

const PAGINA = 1000;
const MAX_VUELTAS = 200;
const CURSOR_KEY = 'panelCostosCursor';

export const MENSAJES_PANEL = Object.freeze({
  pin_requerido: 'Ingresá el PIN de administrador.',
  pin_incorrecto: 'PIN incorrecto o tu usuario no está autorizado como admin en el servidor.',
  bloqueado: 'Demasiados intentos de PIN. Probá de nuevo en 15 minutos.',
  falta_migracion: 'Falta la migración 015 en Supabase: el Panel usa el costo actual de cada producto (costo estimado).',
  offline: 'Necesitás conexión para actualizar los costos.',
  lote_invalido: 'El servidor rechazó el pedido de costos.',
  respuesta_invalida: 'El servidor respondió algo inesperado.',
  error: 'No se pudieron actualizar los costos.',
});

const falla = (motivo) => ({ ok: false, motivo, mensaje: MENSAJES_PANEL[motivo] || MENSAJES_PANEL.error, bajados: 0 });
const leerCursor = () => { try { return localStorage.getItem(CURSOR_KEY) || null; } catch { return null; } };
const guardarCursor = (v) => { try { localStorage.setItem(CURSOR_KEY, v); } catch { /* sin storage */ } };

const filaLocal = (r) => ({ pedidoId: String(r.pedido_id), costos: r.costos && typeof r.costos === 'object' ? r.costos : {}, capturadoAt: r.capturado_at || null });

/** Baja los costos capturados por el servidor (paginado, con cursor y solape). cred = { p_admin_id, p_admin_pin }. */
export const bajarCostosVenta = async (cred, { completo = false } = {}) => {
  if (!cred || !cred.p_admin_pin) return falla('pin_requerido');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return falla('offline');
  try {
    const guardado = completo ? {} : leerCursorCompras(leerCursor(), TABLAS_CURSOR_PANEL);
    let pedido = cursorConSolape(guardado, undefined, TABLAS_CURSOR_PANEL);
    let nuevo = { ...guardado };
    let bajados = 0;
    for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta += 1) {
      const { data, error } = await supabase.rpc('admin_costos_venta_bajar', {
        p_admin_id: String(cred.p_admin_id ?? ''), p_admin_pin: String(cred.p_admin_pin ?? ''), p_cursor: pedido,
      });
      const r = interpretarRpcRendicion({ data, error });
      if (!r.ok) return { ...falla(r.motivo), bajados };
      const filas = Array.isArray(r.data.costos) ? r.data.costos.filter(x => x && x.pedido_id !== undefined && x.pedido_id !== null) : [];
      for (let i = 0; i < filas.length; i += 500) await putCostosVentaBatch(filas.slice(i, i + 500).map(filaLocal));
      bajados += filas.length;
      const opciones = { soloAdelante: true, tablas: TABLAS_CURSOR_PANEL };
      const avance = avanzarCursorCompras(pedido, { costos: filas }, PAGINA, opciones);
      nuevo = avanzarCursorCompras(nuevo, { costos: filas }, PAGINA, opciones).cursor;
      guardarCursor(JSON.stringify(nuevo));
      if (!avance.llenas.length) break;
      pedido = avance.cursor;
    }
    return { ok: true, bajados };
  } catch {
    return falla('error');
  }
};

// Sonda de la 015: con id vacio la RPC responde no_autorizado sin verificar PIN.
export const sondearMigracion015 = async () => {
  try {
    const { data, error } = await supabase.rpc('admin_costos_venta_bajar', { p_admin_id: '', p_admin_pin: '', p_cursor: {} });
    return { faltaMigracion: interpretarRpcRendicion({ data, error }).motivo === 'falta_migracion' };
  } catch {
    return { faltaMigracion: false };
  }
};

/** Datos locales para el Panel. Nunca tira: un store que falla => lista vacia. */
export const cargarDatosPanel = async () => {
  const seguro = async (fn) => { try { return (await fn()) || []; } catch { return []; } };
  const [pedidos, productos, rendiciones, costos] = await Promise.all([
    seguro(getPedidos), seguro(getProductos), seguro(getRendiciones), seguro(getCostosVenta),
  ]);
  return { pedidos, productos, rendiciones, costosVenta: new Map(costos.map(c => [String(c.pedidoId), c])) };
};
