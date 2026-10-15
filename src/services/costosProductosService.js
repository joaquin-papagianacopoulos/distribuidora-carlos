// src/services/costosProductosService.js — S-012-01 (migracion 013).
// Los costos de productos (costo_final, descuentos, ganancia, precio_venta2) ya no se leen con la
// anon key: bajan solo por la RPC admin_productos_costos con PIN de admin, paginada por id.
// Sin PIN (o sin la 013) el dispositivo conserva los costos locales que ya tiene: nunca se pisan
// con vacio. El PIN llega por parametro, viaja solo en la llamada y NO se guarda ni se loguea.
import { supabase } from '../lib/supabase';
import { getProductos, putProductosBatch } from '../db';
import { aplicarCostosRemotos } from '../domain/productos';
import { esFuncionInexistente } from '../sync/tolerancia';

const PAGINA = 1000;
const MAX_VUELTAS = 200;

/**
 * Baja los costos con PIN de admin y los aplica sobre los productos locales sin cambios pendientes.
 * Devuelve { ok, actualizados } o { ok:false, motivo }. Nunca tira: es un paso accesorio del flujo
 * con PIN (Subir productos / datos de compras).
 */
export const bajarCostosProductos = async (cred) => {
  if (!cred || !cred.p_admin_pin) return { ok: false, motivo: 'pin_requerido', actualizados: 0 };
  try {
    const remotos = [];
    let desdeId = 0;
    for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta += 1) {
      const { data, error } = await supabase.rpc('admin_productos_costos', {
        p_admin_id: String(cred.p_admin_id ?? ''),
        p_admin_pin: String(cred.p_admin_pin ?? ''),
        p_desde_id: desdeId,
        p_limite: PAGINA,
      });
      if (error) return { ok: false, motivo: esFuncionInexistente(error) ? 'falta_migracion' : 'error', actualizados: 0 };
      if (!data || data.ok !== true) return { ok: false, motivo: data?.motivo === 'no_autorizado' ? 'no_autorizado' : 'error', actualizados: 0 };
      const filas = Array.isArray(data.productos) ? data.productos : [];
      remotos.push(...filas);
      if (filas.length < PAGINA) break;
      const ultimo = Number(filas[filas.length - 1]?.id);
      if (!Number.isSafeInteger(ultimo) || ultimo <= desdeId) break; // sin progreso: evita bucle
      desdeId = ultimo;
    }
    const cambios = aplicarCostosRemotos(await getProductos(), remotos);
    for (let i = 0; i < cambios.length; i += 500) await putProductosBatch(cambios.slice(i, i + 500));
    return { ok: true, actualizados: cambios.length };
  } catch {
    return { ok: false, motivo: 'error', actualizados: 0 };
  }
};
