// src/services/stockService.js — orquesta el control de stock (REQ-STK/ING)
// entre el dominio puro, IndexedDB y Supabase.
import { supabase } from '../lib/supabase';
import {
  getMovimientosStock, addMovimientosStock, putMovimientosRemotos, clearMovimientosPendingSync,
  rekeyMovimientosRef, getIngresos, putIngresosRemotos, clearIngresosPendingSync,
  addIngresoConMovimientos, addIngresoCompleto, updateProducto, getProveedores, putProveedoresRemotos, clearProveedoresPendingSync, deleteProveedor,
  getRendiciones,
} from '../db';
import {
  calcularStock, revisarMovimientosPedido, mensajeMovimientosInvalidos, verificarStock, decidirFacturacion, movimientoAjuste,
  validarIngreso, refsPedido, STOCK_POLICY, esRefRendicion, idRendicionDeRef,
  movimientoToRemote, movimientoFromRemote, ingresoToRemote, ingresoFromRemote,
} from '../domain/stock';
import { proveedorToRemote, proveedorFromRemote } from '../domain/proveedores';
import { validarCostosIngreso, costoProductoDesdeIngreso } from '../domain/compras';

export const getStockMap = async () => calcularStock(await getMovimientosStock());

/**
 * Calcula (sin grabar) qué movimientos generaría el pedido y si hay faltantes.
 * Se usa ANTES de facturar para pedir confirmación / bloquear (AC-STK-6).
 */
export const previsualizarStockPedido = async (pedido, productos = [], policy = STOCK_POLICY) => {
  const movs = await getMovimientosStock();
  // S-BUL-09: los renglones con cantidad invalida no generan movimiento.
  const { movimientos: nuevos, invalidos } = revisarMovimientosPedido(pedido, movs);
  const stockMap = calcularStock(movs);
  // Solo se controla stock de productos que ya tienen movimientos (inventario
  // cargado). Si no, mientras no se cargue el stock inicial, cada factura
  // pediria confirmacion (revisor, no bloqueante 5). Igual criterio que NuevoPedido.
  const controlados = nuevos.filter(m => stockMap.has(String(m.productoId)));
  const faltantes = verificarStock(controlados, stockMap, productos);
  return { nuevos, faltantes, decision: decidirFacturacion(faltantes, policy), invalidos, avisoInvalidos: mensajeMovimientosInvalidos(invalidos) };
};

/**
 * Lleva el stock al estado que corresponde al pedido (facturado ⇒ descontado,
 * otro estado/borrado ⇒ sin efecto). Idempotente (AC-STK-5).
 *
 * `iniciar`: solo la accion explicita de FACTURAR puede empezar a controlar el
 * stock de un pedido. Cualquier otro guardado (armado, a reparto, cambio de
 * vendedor/fecha, pasar a deudas, editar) solo RECONCILIA pedidos que ya tienen
 * movimientos. Asi los pedidos facturados antes de existir el control de stock
 * no descuentan de golpe al tocarlos (bug B2 del QA).
 */
export const aplicarStockPedido = async (pedido, { usuario = '', iniciar = false } = {}) => {
  if (!pedido) return [];
  // REQ-WEB (AC-WEB-1): un pedido web sin aceptar nunca mueve stock.
  if (pedido.origen === 'web' && pedido.webEstado !== 'aceptado') return [];
  if (pedido.remoteId && pedido.id !== undefined && pedido.id !== null) {
    await rekeyMovimientosRef(`pedido-local:${pedido.id}`, `pedido:${pedido.remoteId}`);
  }
  const movs = await getMovimientosStock();
  const refs = new Set(refsPedido(pedido));
  const delPedido = movs.filter(m => refs.has(m.ref));
  if (!iniciar && delPedido.length === 0) return [];
  const { movimientos: nuevos, invalidos } = revisarMovimientosPedido(pedido, delPedido, { usuario });
  // S-BUL-09: se omiten (no traban el sync) y se reportan.
  if (invalidos.length) console.warn(mensajeMovimientosInvalidos(invalidos));
  if (nuevos.length) await addMovimientosStock(nuevos);
  return nuevos;
};

// AC-PROD-3: stock inicial (alta) o ajuste (edición).
// `base`: stock que el usuario VIO al editar. Si se pasa, el ajuste es
// (nuevo - base) y no pisa movimientos que hayan llegado mientras tanto.
export const ajustarStock = async (productoId, stockNuevo, { usuario = '', inicial = false, base } = {}) => {
  const actual = (base !== undefined && base !== null) ? Number(base) : ((await getStockMap()).get(String(productoId)) || 0);
  const mov = movimientoAjuste(productoId, actual, stockNuevo, { usuario, inicial });
  if (mov) await addMovimientosStock([mov]);
  return mov;
};

// REQ-ING: valida y graba atómicamente cabecera + movimientos.
// REQ-INA: `form.costos` (opcional) trae costo unitario y Factura A/B por renglón:
//   { tipoCabecera, facturaA, facturaB, actualizarCosto (default true), items: [{ productoId, costoUnitario, tipoFactura }] }
// Los costos se guardan APARTE (ingresosCostos, pendientes de subir con PIN); el ingreso y los
// movimientos quedan idénticos con o sin costos (AC-INA-5 / AC-ING-5).
export const registrarIngreso = async (form, { productos, usuario = '' }) => {
  const [proveedores, ingresosExistentes, movs] = await Promise.all([getProveedores(), getIngresos(), getMovimientosStock()]);
  const r = validarIngreso(form, {
    productos, proveedores, ingresosExistentes, stockMap: calcularStock(movs), usuario,
  });
  if (!r.ok) return r;

  // Se valida TODO antes de grabar: un costo inválido no deja un ingreso a medias.
  let costos = null;
  if (form?.costos) {
    const c = validarCostosIngreso(form.costos, { ingreso: r.ingreso });
    if (!c.ok) return { ok: false, errores: c.errores };
    costos = c.costos;
  }
  if (costos) await addIngresoCompleto(r.ingreso, costos, r.movimientos);
  else await addIngresoConMovimientos(r.ingreso, r.movimientos);

  // AC-INA-4: con el tilde (default sí) el costo del ingreso pasa a "Costo final" del producto.
  // updateProducto registra el cambio de precio (REQ-HPR) y deja el producto pendiente de sync.
  const productosActualizados = [];
  const erroresProducto = [];
  if (costos && form.costos.actualizarCosto !== false) {
    const porId = new Map((productos || []).map(p => [String(p.id), p]));
    for (const ren of costos.renglones) {
      const prod = porId.get(String(ren.productoId));
      const nuevo = prod ? costoProductoDesdeIngreso(prod, ren.costoUnitario) : null;
      if (!nuevo) continue;
      try {
        await updateProducto({ ...prod, costoFinal: nuevo.costoFinal, precio: nuevo.precio, extrasDirty: true }, { usuario });
        productosActualizados.push(String(prod.id));
      } catch (e) {
        erroresProducto.push({ productoId: String(prod.id), error: e?.message || String(e) });
      }
    }
  }
  return { ...r, costos, productosActualizados, erroresProducto };
};

// ---------------- Sync con Supabase ----------------
const CURSOR_KEY = 'stockSyncCursor';
const readCursor = () => { try { return localStorage.getItem(CURSOR_KEY) || null; } catch { return null; } };
const writeCursor = (v) => { try { localStorage.setItem(CURSOR_KEY, v); } catch { /* sin storage */ } };

const esTablaInexistente = (error) =>
  ['42P01', 'PGRST205'].includes(String(error?.code)) || /does not exist|could not find the table/i.test(String(error?.message || ''));

// Errores de DATO (CHECK, overflow, unique, FK): no tiene sentido reintentar el
// lote entero para siempre. Se reintenta fila por fila y las que fallan quedan
// pendientes y anotadas, sin frenar al resto (S-12).
const ES_ERROR_DE_DATO = ['23505', '23514', '23503', '22003', '22P02'];
export const esErrorDeDato = (error) => ES_ERROR_DE_DATO.includes(String(error?.code));

// Movimientos de un pedido que todavia no tiene id remoto: su ref es local
// ("pedido-local:<id>") y ese id se repite entre dispositivos. NO se suben hasta
// que el pedido sincroniza y se re-keyean a "pedido:<remoteId>" (B3 / S-11).
export const esRefLocal = (row) => String(row?.ref || '').startsWith('pedido-local:');

// REQ-REN (AC-REN-2): los movimientos de una rendicion ('rendicion:<uuid>') NO se suben hasta que
// el servidor confirmo la rendicion (el trigger de la 014 exige la cabecera). Si la rendicion no esta
// en este dispositivo o sigue pendiente/rechazada, se retienen.
export const retenerMovimientoRendicion = (row, rendicionesPorId = new Map()) => {
  if (!esRefRendicion(row)) return false;
  const r = rendicionesPorId.get(idRendicionDeRef(row.ref));
  return !r || r.syncEstado !== 'confirmada';
};

const leerRendiciones = async () => {
  try { return typeof getRendiciones === 'function' ? (await getRendiciones()) || [] : []; } catch { return []; }
};

const pushPendientes = async (rows, table, toRemote, clear, { retener = () => false } = {}) => {
  const pend = rows.filter(r => r.pendingSync && !retener(r));
  const fallidos = [];
  for (let i = 0; i < pend.length; i += 200) {
    const slice = pend.slice(i, i + 200);
    const { error } = await supabase.from(table).upsert(slice.map(toRemote), { onConflict: 'id' });
    if (!error) { await clear(slice.map(r => r.id)); continue; }
    if (!esErrorDeDato(error)) throw error;
    for (const row of slice) {
      const r1 = await supabase.from(table).upsert([toRemote(row)], { onConflict: 'id' });
      if (r1.error) fallidos.push({ id: row.id, error: r1.error.message || String(r1.error.code) });
      else await clear([row.id]);
    }
  }
  if (fallidos.length) console.warn(`syncStock: ${fallidos.length} fila(s) de ${table} rechazadas por Supabase`, fallidos);
  return { subidos: pend.length - fallidos.length, fallidos };
};

const pullDesde = async (table, cursor) => {
  const PAGE = 1000;
  let out = [];
  let from = 0;
  while (true) {
    // order('id') desempata filas con el mismo updated_at (revisor, no bloqueante 3).
    let q = supabase.from(table).select('*').order('updated_at', { ascending: true }).order('id', { ascending: true }).range(from, from + PAGE - 1);
    if (cursor) q = q.gt('updated_at', cursor);
    const { data, error } = await q;
    if (error) throw error;
    out = out.concat(data || []);
    if (!data || data.length < PAGE) break;
    from += PAGE;
  }
  return out;
};

// No pisar lo que este dispositivo todavía no subió.
const mergeRemotos = (remotos, locales, fromRemote) => {
  const pend = new Set(locales.filter(l => l.pendingSync).map(l => l.id));
  return remotos.filter(r => !pend.has(r.id)).map(fromRemote);
};

/**
 * Sube proveedores, ingresos y movimientos pendientes (upsert por UUID ⇒ sin
 * duplicados aunque se reintente, AC-STK-8) y baja lo nuevo de otros
 * dispositivos de forma incremental (por updated_at).
 */
export const syncStock = async ({ full = false } = {}) => {
  try {
    const [provs, ings, movs, rends] = await Promise.all([getProveedores(), getIngresos(), getMovimientosStock(), leerRendiciones()]);
    const rendPorId = new Map(rends.map(r => [String(r.id), r]));
    const retener = (row) => esRefLocal(row) || retenerMovimientoRendicion(row, rendPorId);
    const subidos = {
      proveedores: await pushPendientes(provs, 'proveedores', proveedorToRemote, clearProveedoresPendingSync),
      ingresos: await pushPendientes(ings, 'ingresos_mercaderia', ingresoToRemote, clearIngresosPendingSync),
      movimientos: await pushPendientes(movs, 'movimientos_stock', movimientoToRemote, clearMovimientosPendingSync, { retener }),
    };

    // Cursor con 5 min de solape: una transaccion que confirmo tarde no se
    // pierde, y el upsert local es idempotente (revisor, no bloqueante 4).
    // `full` (boton Sync manual) baja todo.
    const cursorRaw = full ? null : readCursor();
    const cursor = cursorRaw ? new Date(Date.parse(cursorRaw) - 5 * 60 * 1000).toISOString() : null;
    const [rProv, rIng, rMov] = await Promise.all([
      pullDesde('proveedores', null), // tabla chica: siempre completa
      pullDesde('ingresos_mercaderia', cursor),
      pullDesde('movimientos_stock', cursor),
    ]);
    const [lProv, lIng, lMov] = await Promise.all([getProveedores(), getIngresos(), getMovimientosStock()]);
    await putProveedoresRemotos(mergeRemotos(rProv, lProv, proveedorFromRemote));
    // Proveedores borrados en otro dispositivo: el pull es completo, asi que lo
    // que no vino y no esta pendiente de subir, ya no existe (no bloqueante 8).
    const idsRemotos = new Set(rProv.map(r => r.id));
    // Guarda: si Supabase devolvio 0 filas (p. ej. permiso de lectura mal
    // configurado) NO se borra nada local: seria borrar todo (QA iter 4).
    if (rProv.length > 0) {
      for (const p of lProv) if (!p.pendingSync && !idsRemotos.has(p.id)) await deleteProveedor(p.id);
    }
    await putIngresosRemotos(mergeRemotos(rIng, lIng, ingresoFromRemote));
    await putMovimientosRemotos(mergeRemotos(rMov, lMov, movimientoFromRemote));

    const maxTs = [...rIng, ...rMov].map(r => r.updated_at).filter(Boolean).sort().pop();
    if (maxTs) writeCursor(maxTs);
    return { ok: true, subidos, bajados: { proveedores: rProv.length, ingresos: rIng.length, movimientos: rMov.length } };
  } catch (error) {
    // Si todavía no se corrió la migración SQL, no romper el resto del sync.
    if (esTablaInexistente(error)) {
      console.warn('syncStock: faltan las tablas de stock en Supabase (correr supabase/migrations/001_altas_y_stock.sql).');
      return { ok: true, skipped: true };
    }
    throw error;
  }
};
