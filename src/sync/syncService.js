import { supabase } from '../lib/supabase';
import { normalizePedidoOrdenEntrega } from '../utils/ordenEntrega';
import { isPedidoOculto, makePedidoEliminado, normalizePedidoFecha } from '../utils/pedidos';
import { fetchProductImage, isImageSearchConfigured, ImageSearchQuotaError } from '../services/imageSearch';
import { detectarMarca } from '../utils/brands';
import { clienteExtraToRemote, clienteExtraFromRemote } from '../domain/clientes';
import { productoExtraToRemote, productoExtraFromRemote, productoVentaToRemote, productoPreciosToRemote, COLUMNAS_PRODUCTO_PUBLICAS, columnasSinFaltante } from '../domain/productos';
import { bajarCambiosPrecio } from '../services/cambiosPrecioService';
import { normalizarBultoNombre } from '../domain/unidadVenta';
import { pedidoWebFromRemote, accionWebToRpc } from '../domain/pedidosWeb';

import { pedidoEntregaToRemote, pedidoEntregaFromRemote, sinColumnasEntrega } from '../domain/comisiones';
import { esColumnaInexistente, esEscrituraDenegada } from './tolerancia';
import { gruposToRemote, gruposFromRemote, sinColumnas011, nombraColumna011 } from '../domain/gruposFactura';
import { armarLotesProductosRpc, interpretarGuardarProductos, argsAdminProductos } from '../domain/productosRpc';
import { vendedorDesdeRemoto, COLUMNAS_VENDEDOR_REMOTO, COLUMNAS_VENDEDOR_SIN_ACTIVO, COLUMNAS_VENDEDOR_LEGACY } from '../domain/vendedores';

// Si Supabase todavia no tiene las columnas nuevas (migracion 001 sin correr),
// PostgREST responde PGRST204 "Could not find the 'x' column". En ese caso se
// reintenta con las columnas viejas para no cortar la sincronizacion, y se
// avisa (AC-CLI-5: tolerar que la columna todavia no exista).
export { esColumnaInexistente };

let avisoMigracion = false;
export const upsertTolerante = async (table, rowsCompletas, rowsLegacy) => {
  const { error } = await supabase.from(table).upsert(rowsCompletas, { onConflict: 'id' });
  if (!error) return { error: null, legacy: false };
  if (!esColumnaInexistente(error)) return { error, legacy: false };
  if (!avisoMigracion) {
    avisoMigracion = true;
    console.warn(`Supabase: faltan columnas nuevas en "${table}". Correr supabase/migrations/001_altas_y_stock.sql. Se sube solo lo basico.`);
  }
  const r2 = await supabase.from(table).upsert(rowsLegacy, { onConflict: 'id' });
  return { error: r2.error, legacy: true };
};
// AC-VTA-5: upsert en escalones [completo (001+006), solo 001, basico]. Baja de
// nivel solo si falta una columna: si el error nombra una columna de la 006
// pasa al escalon 001; cualquier otra columna faltante cae al basico. Asi, si
// falta solo la 006, las columnas de la 001 (bulto_x, costo_final...) igual suben.
const COLUMNAS_006 = /venta_por|bulto_nombre|visible_tienda/;
// REQ-PBU: con 4 escalones el primero suma precio_bulto (migracion 010).
const COLUMNAS_010 = /precio_bulto/;
const avisosEscalon = new Set();
export const upsertEscalonado = async (table, variantes) => {
  let i = 0;
  for (;;) {
    const { error } = await supabase.from(table).upsert(variantes[i], { onConflict: 'id' });
    if (!error) return { error: null, nivel: i };
    if (!esColumnaInexistente(error) || i >= variantes.length - 1) return { error, nivel: i };
    const msg = String(error.message || '');
    const con010 = variantes.length > 3;
    const idx006 = con010 ? 1 : 0;
    let siguiente = variantes.length - 1;
    if (con010 && i === 0 && COLUMNAS_010.test(msg)) siguiente = 1;
    else if (i <= idx006 && variantes.length > 2 && COLUMNAS_006.test(msg)) siguiente = idx006 + 1;
    if (!avisosEscalon.has(siguiente)) {
      avisosEscalon.add(siguiente);
      const archivo = con010 && siguiente === 1 ? '010_lote_operacion_precios' : (siguiente === idx006 + 1 && siguiente < variantes.length - 1 ? '006_unidad_venta' : '001_altas_y_stock');
      console.warn(`Supabase: faltan columnas nuevas en "${table}". Correr supabase/migrations/${archivo}.sql. Se sube solo lo que existe.`);
    }
    i = siguiente;
  }
};

// agregar al import de db
import {
  getPedidos, markPedidoSynced, putPedidoRemoto, deletePedido,
  getClientes, addCliente, updateCliente,
  getProductos, putProducto, putProductosBatch,
  getVendedores, addVendedor,
  getFaltantes, addFaltante, deleteFaltante, updateFaltante,
  getDeudas, addDeuda, deleteDeuda, updateDeuda,
  clearProductosPendingSync, // ← agregar
  clearProductosPendingSyncSiIgual,
  clearClientesPendingSync,
  putPedidosRemotoBatch,
  putClientesBatch,
  putVendedoresBatch,
  patchRegistros,
  getPedidosWebAcciones,
  putPedidosWebAccionesRaw,
} from '../db';

const RECENT_LOCAL_PROTECTION_MS = 10 * 60 * 1000;

const isLocalPedidoProtectedFromCleanup = (pedido, now = Date.now()) => {
  if (!pedido) return false;
  if (!pedido.synced) return true;
  if (pedido.syncLock) return true;
  const ts = Number(pedido.updatedAt || pedido.createdAt || 0);
  return Number.isFinite(ts) && ts > 0 && (now - ts) < RECENT_LOCAL_PROTECTION_MS;
};

const putPedidosRemotosSinPisarLocales = async (rows) => {
  if (!rows || rows.length === 0) return { ok: true, count: 0 };

  // Re-chequear justo antes de escribir. Un pull remoto puede haber empezado
  // antes de que el usuario toque Guardar; si ahora el pedido local esta
  // synced:false, no se puede pisar con datos viejos de Supabase.
  const localesActuales = await getPedidos();
  const byRemoteId = new Map(localesActuales.filter(p => p.remoteId).map(p => [p.remoteId, p]));
  const safeRows = rows.filter(row => {
    const current = byRemoteId.get(row.remoteId);
    return !(current && !current.synced);
  });

  for (let i = 0; i < safeRows.length; i += 200) {
    await putPedidosRemotoBatch(safeRows.slice(i, i + 200));
  }

  return { ok: true, count: safeRows.length };
};

const mapPedidoRemoto = (r, local = null) => {
  const estado = r.estado ?? 'pendiente';
  return normalizePedidoOrdenEntrega({
    ...(local ?? {}),
    remoteId: r.id,
    clienteId: r.cliente_id,
    clienteNombre: r.cliente_nombre,
    vendedor: r.vendedor,
    vendedorNombre: r.vendedor,
    fecha: normalizePedidoFecha(r.fecha),
    zona: r.zona ?? local?.zona ?? '',
    items: r.items,
    total: r.total,
    estado,
    // Armado: si la columna todavia no existe en Supabase, r.armado viene undefined
    // y conservamos el valor local (o false) sin romper nada.
    armado: r.armado !== undefined ? !!r.armado : !!local?.armado,
    armadoAt: r.armado_at !== undefined ? (r.armado_at ? Date.parse(r.armado_at) : null) : (local?.armadoAt ?? null),
    armadoPor: r.armado_por !== undefined ? (r.armado_por ?? null) : (local?.armadoPor ?? null),
    armadoLog: r.armado_log !== undefined ? (r.armado_log ?? null) : (local?.armadoLog ?? null),
    // A reparto: misma logica tolerante que armado, por si la columna todavia no existe.
    aReparto: r.a_reparto !== undefined ? !!r.a_reparto : !!local?.aReparto,
    aRepartoAt: r.a_reparto_at !== undefined ? (r.a_reparto_at ? Date.parse(r.a_reparto_at) : null) : (local?.aRepartoAt ?? null),
    aRepartoPor: r.a_reparto_por !== undefined ? (r.a_reparto_por ?? null) : (local?.aRepartoPor ?? null),
    deudaGenerada: r.deuda_generada !== undefined ? !!r.deuda_generada : !!local?.deudaGenerada,
    // Entregado (REQ-COM, AC-COM-1): tolerante a columnas faltantes y a marcas locales sin subir.
    ...pedidoEntregaFromRemote(r, local),
    // REQ-WEB: origen y datos de la bandeja "Pedidos web" (tolerante a columnas faltantes).
    ...pedidoWebFromRemote(r, local),
    // REQ-AGR: grupos de renglones (dato no confiable: se sanea). tipoFactura* vive solo
    // en el local (viene en ...local), no en la tabla pedidos.
    grupos: gruposFromRemote(r, local),
    borrado: ['cancelado', 'eliminado', 'borrado'].includes(String(estado).toLowerCase()),
    synced: true,
    createdAt: local?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
  });
};

const pedidoToRemoteRow = (pedido) => {
  const p = normalizePedidoOrdenEntrega(pedido);
  return {
    cliente_id:     p.clienteId     ?? null,
    cliente_nombre: p.clienteNombre ?? '',
    vendedor:       p.vendedor      ?? p.vendedorNombre ?? '',
    zona:           p.zona          ?? '',
    fecha:          normalizePedidoFecha(p.fecha) || null,
    items:          p.items         ?? [],
    total:          p.total         ?? 0,
    estado:         p.estado        ?? 'pendiente',
    // Armado (preparacion del pedido): campo independiente de "estado", no lo pisa.
    armado:         !!p.armado,
    armado_at:      p.armadoAt ? new Date(p.armadoAt).toISOString() : null,
    armado_por:     p.armadoPor ?? null,
    // Que confirmo (tick verde) y que saco/redujo el armador. Informativo para Facturacion.
    armado_log:     p.armadoLog ?? null,
    // "A reparto": ultima verificacion antes de salir a entregar.
    a_reparto:      !!p.aReparto,
    a_reparto_at:   p.aRepartoAt ? new Date(p.aRepartoAt).toISOString() : null,
    a_reparto_por:  p.aRepartoPor ?? null,
    deuda_generada: !!p.deudaGenerada,
    // Entregado (REQ-COM): no cambia estado ni stock.
    ...pedidoEntregaToRemote(p),
    // REQ-AGR: solo si el pedido conoce la clave (un dispositivo viejo no la pisa).
    ...gruposToRemote(p),
    updated_at:     new Date().toISOString(),
  };
};

// Aviso unico por sesion cuando faltan las columnas de entregado (migracion 003).
let avisoMigracion003 = false;
const avisarFalta003 = () => {
  if (avisoMigracion003) return;
  avisoMigracion003 = true;
  console.warn('Supabase: faltan las columnas "entregado" en pedidos. Correr supabase/migrations/003_comisiones.sql. La marca queda en este dispositivo y se reintenta.');
};

let avisoMigracion011 = false;
const avisarFalta011 = () => {
  if (avisoMigracion011) return;
  avisoMigracion011 = true;
  console.warn('Supabase: falta la columna "grupos" en pedidos. Correr supabase/migrations/011_lote_operacion_facturacion_zonas.sql. Los grupos quedan en este dispositivo.');
};

// Reintenta un update/insert de pedidos SIN las columnas de entregado si
// Supabase todavia no las tiene. Devuelve { data, error, sinEntrega }.
export const conFallbackEntrega = async (ejecutar, rowOrRows) => {
  let filas = rowOrRows;
  let r1 = await ejecutar(filas);
  if (!r1.error || !esColumnaInexistente(r1.error)) return { ...r1, sinEntrega: false };
  // REQ-AGR: falta la columna grupos (migracion 011): reintentar sin ella antes del fallback de entrega.
  if (nombraColumna011(r1.error)) {
    avisarFalta011();
    filas = Array.isArray(filas) ? filas.map(sinColumnas011) : sinColumnas011(filas);
    r1 = await ejecutar(filas);
    if (!r1.error || !esColumnaInexistente(r1.error)) return { ...r1, sinEntrega: false };
  }
  const legacy = Array.isArray(filas) ? filas.map(sinColumnasEntrega) : sinColumnasEntrega(filas);
  const r2 = await ejecutar(legacy);
  if (!r2.error) avisarFalta003();
  return { ...r2, sinEntrega: !r2.error };
};

// Pedidos ya sincronizados cuya marca de entregado no pudo subir (faltaba la
// columna): se reintenta subir SOLO esas columnas. Si siguen faltando, se deja.
export const syncEntregasPendientes = async (pedidosLocales = null) => {
  const pedidos = pedidosLocales || await getPedidos();
  const pend = pedidos.filter(p => p.synced && p.entregaPendiente && p.remoteId);
  const ok = [];
  for (const p of pend) {
    const { error } = await supabase.from('pedidos').update(pedidoEntregaToRemote(p)).eq('id', p.remoteId);
    if (error) {
      if (esColumnaInexistente(error)) { avisarFalta003(); break; }
      console.warn('syncEntregasPendientes: no se pudo subir la marca de entregado:', error?.message || String(error));
      continue;
    }
    ok.push(p.id);
  }
  await patchRegistros('pedidos', ok, { entregaPendiente: false });
  return { ok: true, count: ok.length };
};

const softDeleteRemotePedido = async (pedido) => {
  let finalPedido = makePedidoEliminado(pedido);
  let { error } = await supabase
    .from('pedidos')
    .update(pedidoToRemoteRow(finalPedido))
    .eq('id', pedido.remoteId);

  if (error) {
    finalPedido = makePedidoEliminado(pedido, 'cancelado');
    const retry = await supabase
      .from('pedidos')
      .update(pedidoToRemoteRow(finalPedido))
      .eq('id', pedido.remoteId);
    error = retry.error;
  }

  if (error) throw error;
  return finalPedido;
};

// S-VTA-01: despues de la migracion 007 la escritura directa de productos esta
// cerrada para la anon key. Flag de modulo: no reintentar el directo en la misma
// sesion (se resetea al recargar).
let escrituraDirectaCerrada = false;
export const _resetEscrituraDirectaProductos = () => { escrituraDirectaCerrada = false; };

const subirProductosDirecto = async (pendientes) => {
  for (let i = 0; i < pendientes.length; i += 100) {
    const slice = pendientes.slice(i, i + 100);
    const invalid = slice.find(p => !Number.isSafeInteger(p.id));
    if (invalid) {
      throw new Error(`syncProductos: id inválido para bigint (producto "${invalid.nombre}" id=${String(invalid.id)})`);
    }

    const batch = slice.map(p => ({
      id:         p.id,
      nombre:     p.nombre,
      codigo:     p.codigo    ?? '',
      precio:     p.precio    ?? 0,
      unidad:     p.unidad    ?? 'unidad',
      categoria:  p.categoria ?? '',
      marca:      p.marca     ?? '',
      imagen_url: p.imagen_url ?? null,
    }));
    // Solo los productos editados en el formulario (extrasDirty) o con extras
    // pendientes de una subida legacy mandan las columnas nuevas. El resto
    // (p. ej. importacion CSV de precios) sube solo lo basico, para no pisar con
    // valores viejos lo que cargo otro dispositivo (revisor, bloqueante 1).
    const conExtras = (p) => !!(p.extrasDirty || p.extrasPendientes);
    const idxExtras = slice.map((p, i) => (conExtras(p) ? i : -1)).filter(i => i >= 0);
    const idxBasico = slice.map((p, i) => (conExtras(p) ? -1 : i)).filter(i => i >= 0);
    let error = null;
    let legacy = false;
    if (idxExtras.length) {
      const r = await upsertEscalonado('productos', [
        idxExtras.map(i => ({ ...batch[i], ...productoExtraToRemote(slice[i]), ...productoVentaToRemote(slice[i]), ...productoPreciosToRemote(slice[i]) })),
        idxExtras.map(i => ({ ...batch[i], ...productoExtraToRemote(slice[i]), ...productoVentaToRemote(slice[i]) })),
        idxExtras.map(i => ({ ...batch[i], ...productoExtraToRemote(slice[i]) })),
        idxExtras.map(i => batch[i]),
      ]);
      error = r.error;
      // Nivel 1 = solo falta la 010: es "legacy" solo si algun producto tiene precio por bulto que se perderia.
      legacy = r.nivel > 1 || (r.nivel === 1 && idxExtras.some(i => Number(slice[i].precioBulto) > 0));
    }
    if (!error && idxBasico.length) {
      const r = await supabase.from('productos').upsert(idxBasico.map(i => batch[i]), { onConflict: 'id' });
      error = r.error;
    }

    if (error) return { error };

    // Limpiar la marca apenas se confirma la subida de ESTA tanda, no de
    // "todo lo pendiente" (ver comentario en clearProductosPendingSync).
    await clearProductosPendingSync(batch.map(b => b.id));
    if (idxExtras.length) {
      await patchRegistros('productos', idxExtras.map(i => batch[i].id), { extrasPendientes: !!legacy, extrasDirty: false });
    }
  }
  return { error: null };
};

// Sube por RPC con PIN de admin. Devuelve { ok, motivo?, faltaMigracion?, subidos, rechazados }.
const subirProductosRpc = async (pendientes, cred) => {
  const lotes = armarLotesProductosRpc(pendientes);
  if (lotes.invalidos?.length) {
    const inv = lotes.invalidos[0];
    throw new Error(`syncProductos: id inválido para bigint (producto "${inv.nombre}" id=${String(inv.id)})`);
  }
  let subidos = 0;
  const rechazados = [];
  for (const lote of lotes) {
    const { data, error } = await supabase.rpc('admin_guardar_productos', {
      ...argsAdminProductos({ adminId: cred?.p_admin_id, adminPin: cred?.p_admin_pin }),
      p_filas: lote.filas,
    });
    const r = interpretarGuardarProductos({ data, error });
    if (!r.ok) {
      return { ok: false, motivo: r.motivo, mensaje: r.mensaje, faltaMigracion: r.motivo === 'falta_migracion', subidos, rechazados };
    }
    const enLote = new Set(lote.ids);
    const aceptados = r.aceptados.filter(id => enLote.has(id));
    const limpiados = await clearProductosPendingSyncSiIgual(
      aceptados, lote.huellas, { extrasPendientes: false, extrasDirty: false, syncRechazo: null },
    );
    subidos += limpiados.length;
    for (const x of r.rechazados) {
      if (!enLote.has(x.id)) continue;
      rechazados.push(x);
      await patchRegistros('productos', [x.id], { syncRechazo: x.motivo });
    }
  }
  return { ok: true, subidos, rechazados };
};

export const syncProductos = async ({ cred = null } = {}) => {
  const productos = await getProductos();
  // extrasPendientes: se subio solo lo basico porque Supabase no tenia las
  // columnas nuevas; se reintenta hasta que la migracion exista (bug B1).
  const pendientes = productos.filter(p => p.pendingSync || p.extrasPendientes);

  if (pendientes.length === 0) return { ok: true };

  if (cred) {
    const r = await subirProductosRpc(pendientes, cred);
    if (r.ok) return { ok: true, subidos: r.subidos, rechazados: r.rechazados };
    if (!r.faltaMigracion) return { ok: false, motivo: r.motivo, mensaje: r.mensaje, pendientes: pendientes.length };
    // Sin la 007: camino directo de siempre.
  } else if (escrituraDirectaCerrada) {
    return { ok: true, requierePinAdmin: true, pendientes: pendientes.length };
  }

  const d = await subirProductosDirecto(pendientes);
  if (d.error) {
    if (!cred && esEscrituraDenegada(d.error)) {
      escrituraDirectaCerrada = true;
      return { ok: true, requierePinAdmin: true, pendientes: pendientes.length };
    }
    throw d.error;
  }
  return { ok: true };
};

// Busca automáticamente una foto para los productos que todavía no tienen
// imagen_url. Se detiene si se agota la cuota diaria gratuita de Google
// Custom Search; los que queden pendientes se reintentan en la próxima corrida
// (por ejemplo, el próximo día o la próxima importación de CSV).
export const buscarImagenesFaltantes = async (onProgress) => {
  if (!isImageSearchConfigured()) {
    return { ok: true, configurado: false, encontrados: 0, sinResultado: 0, agotado: false, total: 0 };
  }

  const productos = await getProductos();
  const faltantes = productos.filter(p => !p.imagen_url);

  let encontrados = 0, sinResultado = 0, agotado = false;

  for (let i = 0; i < faltantes.length; i++) {
    const p = faltantes[i];
    try {
      const url = await fetchProductImage(p.nombre);
      if (url) {
        await putProducto({ ...p, imagen_url: url, pendingSync: true });
        encontrados++;
      } else {
        sinResultado++;
      }
    } catch (err) {
      if (err instanceof ImageSearchQuotaError) { agotado = true; break; }
      sinResultado++;
    }
    onProgress?.({ procesados: i + 1, total: faltantes.length });
    // Throttle suave para no ráfaguear la API.
    await new Promise(r => setTimeout(r, 250));
  }

  if (encontrados > 0 && navigator.onLine) {
    await syncProductos();
  }

  return { ok: true, configurado: true, encontrados, sinResultado, agotado, total: faltantes.length };
};

// Detecta y guarda la marca de todos los productos que todavía no la tienen,
// a partir del nombre. Sirve para "poner al día" productos que ya estaban
// cargados antes de tener esta detección (no hace falta reimportar el CSV).
export const backfillMarcas = async () => {
  const productos = await getProductos();
  const faltantes = productos.filter(p => !p.marca);
  let detectados = 0;

  for (const p of faltantes) {
    const marca = detectarMarca(p.nombre);
    if (marca) {
      await putProducto({ ...p, marca, pendingSync: true });
      detectados++;
    }
  }

  if (detectados > 0 && navigator.onLine) {
    await syncProductos();
  }

  return { ok: true, detectados, revisados: faltantes.length };
};

export const syncPedidosPendientes = async () => {
  const pedidos    = await getPedidos();
  const pendientes = pedidos.filter(p => !p.synced);

  // REQ-COM: marcas de entregado que quedaron sin subir (faltaba la migracion 003).
  try { await syncEntregasPendientes(pedidos); } catch (e) { console.warn('syncEntregasPendientes fallo:', e?.message || String(e)); }
  
  if (pendientes.length === 0) return { ok: true, count: 0, remaining: 0 };

  // 0) Borrados: primero propagar deletes a Supabase y purgar local.
  // Usamos tombstone local (p.borrado=true) para que no "reviva" en pulls mientras estas offline.
  const borrados = pendientes.filter(p => p.borrado);
  for (const p of borrados) {
    // Si nunca se subio, se puede borrar local directo.
    if (!p.remoteId) {
      await deletePedido(p.id);
      continue;
    }

    const finalPedido = await softDeleteRemotePedido(p);
    await markPedidoSynced(p.id, p.remoteId);
    await putPedidoRemoto({
      ...finalPedido,
      synced: true,
      syncLock: false,
      updatedAt: Date.now(),
    });
  }

  const results = [];
  const MAX_PER_RUN = 150; // evita congelar móviles al importar backups grandes

  const pendientesActivos = pendientes.filter(p => !p.borrado);
  const slice = pendientesActivos.slice(0, MAX_PER_RUN);
  const toUpdate = slice.filter(p => p.remoteId);
  const toInsert = slice.filter(p => !p.remoteId);
  // id local -> true si la marca de entregado no pudo subir (falta la columna).
  const entregaPorId = new Map();

  // 1) Updates (pocos) - mantener en loop
  for (const p of toUpdate) {

    // Si esta cancelado, lo mantenemos como registro (no lo borramos).

    const row = pedidoToRemoteRow(p);

    if (p.remoteId) {
      const { data, error, sinEntrega } = await conFallbackEntrega(
        (r) => supabase.from('pedidos').update(r).eq('id', p.remoteId).select('id'),
        row,
      );
      entregaPorId.set(p.id, sinEntrega && !!p.entregado);

      // No ocultar errores: si falla un update (RLS / schema / etc),
      // el usuario cree que "edito" pero en otros dispositivos no se refleja.
      if (error) throw error;

      if (data?.length > 0) {
        results.push({ localId: p.id, remoteId: data[0].id });
        continue;
      }

      throw new Error(`syncPedidosPendientes: update sin respuesta (pedido remoteId=${String(p.remoteId)})`);
    }

    // Inserts se manejan en batch abajo
  }

  // 2) Inserts (muchos, backups) - batch insert para evitar "Sincronizando" eterno
  if (toInsert.length > 0) {
    const rows = toInsert.map(pedidoToRemoteRow);

    const { data, error, sinEntrega } = await conFallbackEntrega(
      (r) => supabase.from('pedidos').insert(r).select('id'),
      rows,
    );
    for (const p of toInsert) entregaPorId.set(p.id, sinEntrega && !!p.entregado);

    if (error) throw error;
    const ids = data || [];
    if (ids.length !== toInsert.length) {
      // No podemos mapear remoteId con seguridad si la respuesta no coincide.
      // Igual marcamos como synced en el siguiente pull, pero informamos.
      console.warn('syncPedidosPendientes: respuesta inesperada en batch insert', { expected: toInsert.length, got: ids.length });
    }

    for (let i = 0; i < Math.min(toInsert.length, ids.length); i++) {
      results.push({ localId: toInsert[i].id, remoteId: ids[i].id });
    }
  }

  await Promise.all(
    results.map(r => markPedidoSynced(r.localId, r.remoteId))
  );
  // Recordar (o limpiar) la marca de entregado pendiente de los que se subieron.
  const subidos = results.map(r => r.localId);
  await patchRegistros('pedidos', subidos.filter(id => entregaPorId.get(id)), { entregaPendiente: true });
  await patchRegistros('pedidos', subidos.filter(id => !entregaPorId.get(id)), { entregaPendiente: false });

  return { ok: true, count: results.length, remaining: Math.max(0, pendientesActivos.length - MAX_PER_RUN) };
};

// ---- PEDIDOS WEB (REQ-WEB) ----
// Baja a la bandeja los pedidos web por revisar (sin limite de fecha) y refresca
// los locales todavia no resueltos. Tolera que la migracion 008 no este aplicada.
const traerPedidosPorIds = async (ids) => {
  const filas = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await supabase.from('pedidos').select('*').in('id', ids.slice(i, i + 100));
    if (error) throw error;
    filas.push(...(data || []));
  }
  return filas;
};

const guardarPedidosWebRemotos = async (filas) => {
  const locales = await getPedidos();
  const byRemoteId = new Map(locales.filter(p => p.remoteId).map(p => [p.remoteId, p]));
  const upserts = [];
  for (const r of filas) {
    const local = byRemoteId.get(r.id);
    if (local && !local.synced) continue;
    upserts.push(mapPedidoRemoto(r, local));
  }
  await putPedidosRemotosSinPisarLocales(upserts);
  return upserts.length;
};

export const pullPedidosWebPorIds = async (ids) => {
  const lista = [...new Set((ids || []).filter(x => x !== null && x !== undefined))];
  if (lista.length === 0) return { ok: true, count: 0 };
  return { ok: true, count: await guardarPedidosWebRemotos(await traerPedidosPorIds(lista)) };
};

export const pullPedidosWebPorRevisar = async () => {
  const PAGE = 500;
  let filas = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('pedidos').select('*')
      .eq('origen', 'web').eq('web_estado', 'por_revisar')
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      if (esColumnaInexistente(error)) return { ok: true, skipped: true };
      throw error;
    }
    filas = filas.concat(data || []);
    if (!data || data.length < PAGE) break;
    from += PAGE;
  }
  // Refrescar los locales que seguian por revisar (otro admin pudo resolverlos).
  const vistos = new Set(filas.map(r => r.id));
  const locales = await getPedidos();
  const aRefrescar = locales
    .filter(p => p.origen === 'web' && p.remoteId != null && !vistos.has(p.remoteId) && (p.webEstado || 'por_revisar') === 'por_revisar')
    .map(p => p.remoteId);
  if (aRefrescar.length) filas = filas.concat(await traerPedidosPorIds(aRefrescar));
  return { ok: true, count: await guardarPedidosWebRemotos(filas) };
};

// Sube las acciones aceptar/rechazar pendientes con la credencial del admin
// ({ p_admin_id, p_admin_pin }, solo en memoria). Se limpia pendingSync SOLO de la
// accion resuelta. 'ya_resuelto' no se reintenta: el servidor manda.
export const syncPedidosWeb = async ({ cred = null } = {}) => {
  const todas = await getPedidosWebAcciones();
  const pendientes = todas.filter(a => a.pendingSync).sort((a, b) => (a.at || 0) - (b.at || 0));
  if (pendientes.length === 0) return { ok: true, count: 0, pendientes: 0 };
  if (!cred) return { ok: true, count: 0, pendientes: pendientes.length, requierePinAdmin: true };

  const clientes = await getClientes();
  const resueltos = [];
  let esperando = 0;
  for (const a of pendientes) {
    if (a.tipo === 'aceptar' && a.clienteId !== null && a.clienteId !== undefined) {
      const cl = clientes.find(c => String(c.id) === String(a.clienteId));
      // El cliente nuevo tiene que estar subido antes de vincularlo.
      if (cl && (cl.pendingSync || cl.extrasPendientes)) { esperando++; continue; }
    }
    const { data, error } = await supabase.rpc('admin_resolver_pedido_web', accionWebToRpc(a, { adminId: cred.p_admin_id, pin: cred.p_admin_pin }));
    if (error) {
      if (['PGRST202', '42883'].includes(String(error.code))) return { ok: false, faltaMigracion: true, count: resueltos.length, pendientes: pendientes.length };
      throw error;
    }
    if (!data || typeof data !== 'object') throw new Error('admin_resolver_pedido_web: respuesta inesperada');
    if (data.ok === false && data.motivo === 'no_autorizado') return { ok: false, motivo: 'no_autorizado', count: resueltos.length, pendientes: pendientes.length };
    let resultado = 'ok';
    let detalle = null;
    if (data.ok === false) {
      resultado = data.motivo === 'ya_resuelto' ? 'ya_resuelto' : 'error';
      detalle = { motivo: data.motivo, estado: data.estado ?? null, revisadoPor: data.revisado_por ?? null, clienteId: data.cliente_id ?? null };
    }
    await putPedidosWebAccionesRaw([{ ...a, pendingSync: false, resultado, detalle, updatedAt: Date.now() }]);
    resueltos.push(a.pedidoRemoteId);
  }
  if (resueltos.length) await pullPedidosWebPorIds(resueltos);
  return { ok: true, count: resueltos.length, pendientes: pendientes.length - resueltos.length, esperando };
};

// S-WEB-01: el contacto del consumidor final NO viaja en pedidos (anon key). Se baja
// con la RPC admin_listar_pedidos_web (PIN del admin, solo en memoria) para los pedidos
// web por revisar que todavia no tienen contacto local. Si falla, no se pisa nada.
export const pullContactosPedidosWeb = async ({ cred = null } = {}) => {
  const locales = await getPedidos();
  const faltan = locales.filter(p => p.origen === 'web' && p.remoteId != null && !p.webContacto
    && (p.webEstado || 'por_revisar') === 'por_revisar');
  if (faltan.length === 0) return { ok: true, count: 0 };
  if (!cred) return { ok: false, motivo: 'pin_requerido', count: 0, faltan: faltan.length };
  let count = 0;
  for (let i = 0; i < faltan.length; i += 100) {
    const lote = faltan.slice(i, i + 100);
    const { data, error } = await supabase.rpc('admin_listar_pedidos_web', {
      p_admin_id: cred.p_admin_id, p_admin_pin: cred.p_admin_pin, p_ids: lote.map(p => String(p.remoteId)),
    });
    if (error) {
      if (['PGRST202', '42883'].includes(String(error.code))) return { ok: false, faltaMigracion: true, count, faltan: faltan.length - count };
      return { ok: false, motivo: 'red', count, faltan: faltan.length - count };
    }
    if (!data || typeof data !== 'object') return { ok: false, motivo: 'respuesta', count, faltan: faltan.length - count };
    if (data.ok === false) return { ok: false, motivo: data.motivo === 'no_autorizado' ? 'no_autorizado' : 'error', count, faltan: faltan.length - count };
    const contactos = data.contactos && typeof data.contactos === 'object' ? data.contactos : {};
    for (const p of lote) {
      const c = contactos[String(p.remoteId)];
      if (c && typeof c === 'object') {
        await patchRegistros('pedidos', [p.id], { webContacto: c });
        count++;
      }
    }
  }
  return { ok: true, count };
};

// REQ-ZON: fila de cliente sin la columna de la migracion 011.
const sinOrdenZona = ({ orden_zona: _oz, ...resto }) => resto;

export const syncClientes = async () => {
  const todos = await getClientes();
  // Solo se sube lo que este dispositivo edito de verdad (pendingSync). Subir
  // la tabla entera en cada sync hacia que un dispositivo con datos viejos
  // pisara con null lo que otro acababa de guardar (ej: dia/orden de entrega).
  const clientes = (todos || []).filter(c => c.pendingSync || c.extrasPendientes);
  if (clientes.length === 0) return { ok: true };

  for (let i = 0; i < clientes.length; i += 500) {
    const batch = clientes.slice(i, i + 500).map(c => ({
      id: c.id,
      nombre: c.nombre,
      direccion: c.direccion ?? '',
      telefono: c.telefono ?? '',
      alias: c.alias ?? '',
      boleta_contra_boleta: !!c.boletaContraBoleta,
      dia_entrega: c.diaEntrega || null,
      orden_entrega: (c.ordenEntrega !== undefined && c.ordenEntrega !== null && c.ordenEntrega !== '') ? Number(c.ordenEntrega) : null,
      // REQ-ZON: puesto dentro de la zona (migracion 011). Si la columna no existe, se reintenta sin ella.
      orden_zona: (Number(c.ordenZona) > 0) ? Math.floor(Number(c.ordenZona)) : null,
    }));
    const porId = new Map(clientes.map(c => [c.id, c]));
    // Revisor, bloqueante 1: los campos nuevos (codigo, CUIT, ...) se suben SOLO
    // para clientes editados en el formulario de alta (extrasDirty) o con extras
    // pendientes. Un reordenamiento desde "Orden" (vendedor, quiza con datos
    // viejos) sube solo lo basico y no pisa con NULL lo que cargo el admin.
    const conExtras = (b) => { const c = porId.get(b.id); return !!(c?.extrasDirty || c?.extrasPendientes); };
    // REQ-COMR (AC-COMR-1): `comision` no viaja en NINGUNA fila (la excluye
    // clienteExtraToRemote). PostgREST arma el upsert del lote con la unión de
    // claves de todas las filas: si una sola la trajera, a las demás se les
    // mandaría null. Sin la clave, el ON CONFLICT no toca la columna vieja.
    const batchCompleto = batch.map(b => (conExtras(b) ? { ...b, ...clienteExtraToRemote(porId.get(b.id)) } : b));
    const subirGrupos = async (filas, filasLegacy) => {
      const extras = filas.map((f, k) => [f, filasLegacy[k]]).filter(([, l]) => conExtras(l));
      const basicos = filasLegacy.filter(l => !conExtras(l));
      let err = null; let leg = false;
      if (extras.length) {
        const r = await upsertTolerante('clientes', extras.map(x => x[0]), extras.map(x => sinOrdenZona(x[1])));
        err = r.error; leg = r.legacy;
      }
      if (!err && basicos.length) {
        const r = await upsertTolerante('clientes', basicos, basicos.map(sinOrdenZona));
        err = r.error;
      }
      return { error: err, legacy: leg };
    };

    let { error, legacy } = await subirGrupos(batchCompleto, batch);

    // B4: codigo de cliente repetido entre dos dispositivos (indice unico).
    // No se frena todo el sync (los pedidos se suben despues de clientes):
    // se sube fila por fila y las que chocan quedan pendientes y marcadas
    // con syncConflicto para que el admin cambie el codigo.
    if (error && String(error.code) === '23505') {
      const ok = [];
      const conflicto = [];
      for (let k = 0; k < batch.length; k++) {
        const r1 = await subirGrupos([batchCompleto[k]], [batch[k]]);
        if (r1.error) {
          // Revisor (no bloqueante 9): solo un 23505 es "codigo repetido";
          // cualquier otro error (red, permisos) se propaga como antes.
          if (String(r1.error.code) !== '23505') throw r1.error;
          conflicto.push(batch[k].id);
        } else { ok.push(batch[k].id); legacy = legacy || r1.legacy; }
      }
      await clearClientesPendingSync(ok);
      await patchRegistros('clientes', ok.filter(id => conExtras({ id })), { extrasPendientes: !!legacy, extrasDirty: false, syncConflicto: null });
      await patchRegistros('clientes', ok.filter(id => !conExtras({ id })), { syncConflicto: null });
      await patchRegistros('clientes', conflicto, { syncConflicto: 'Código de cliente repetido en otro dispositivo: cambialo' });
      console.warn(`syncClientes: ${conflicto.length} cliente(s) con codigo repetido; quedan pendientes.`);
      continue;
    }

    // 401/403 = RLS sin política de escritura anónima — no es crítico, seguimos.
    if (error) {
      const status = error?.status ?? error?.code;
      if (status === 401 || status === 403 || String(status) === '401' || String(status) === '403') {
        console.warn('syncClientes: sin permiso de escritura en Supabase (RLS), saltando push de clientes.');
        return { ok: true, skipped: true };
      }
      throw error;
    }

    // Limpiar la marca apenas se confirma la subida de ESTA tanda puntual,
    // no de "todo lo pendiente" — evita pisar una edicion de otro cliente
    // que haya quedado marcada pendiente mientras esta subida estaba en curso.
    await clearClientesPendingSync(batch.map(b => b.id));
    const idsExtras = batch.filter(conExtras).map(b => b.id);
    const idsBasicos = batch.filter(b => !conExtras(b)).map(b => b.id);
    await patchRegistros('clientes', idsExtras, { extrasPendientes: !!legacy, extrasDirty: false, syncConflicto: null });
    await patchRegistros('clientes', idsBasicos, { syncConflicto: null });
  }

  return { ok: true };
};
export const pullPedidos = async () => {
  // Paginado para evitar traer miles de pedidos de golpe (móviles)
  const PAGE = 500;
  const MAX_TOTAL = 6000; // por corrida
  let data = [];
  let from = 0;
  while (true) {
    const { data: page, error } = await supabase
      .from('pedidos')
      .select('*')
      .order('fecha', { ascending: false })
      .range(from, from + PAGE - 1);

    if (error) throw error;
    data = data.concat(page || []);
    if (!page || page.length < PAGE) break;
    from += PAGE;
    if (data.length >= MAX_TOTAL) break;
    await new Promise(r => setTimeout(r, 0));
  }

  const locales = await getPedidos();
  const byRemoteId = new Map(locales.filter(p => p.remoteId).map(p => [p.remoteId, p]));
  const upserts = [];

// syncService.js — pullPedidos, reemplazar el continue
  for (const r of data) {
    const local = byRemoteId.get(r.id);

    // Si hay cambios locales pendientes, no pisar con el remoto.
    // Evita revertir cancelaciones cuando el reloj del dispositivo está desfasado.
    if (local && !local.synced) continue;

    upserts.push(mapPedidoRemoto(r, local));
  }

  await putPedidosRemotosSinPisarLocales(upserts);

  // Pedidos que borraste en Supabase → borrar local también
  // No borrar locales desde este pull general: esta consulta esta paginada y
  // limitada, asi que no es una foto completa de Supabase.

  return { ok: true, count: data.length };
};

export const pullPedidosByFecha = async (fecha, { vendedorNombre = null, zona = null } = {}) => {
  if (!fecha) return { ok: true, count: 0 };

  const PAGE = 1000;
  let data = [];
  let from = 0;
  while (true) {
    let q = supabase
      .from('pedidos')
      .select('*')
      .eq('fecha', fecha);
    if (vendedorNombre) q = q.eq('vendedor', vendedorNombre);
    if (zona) q = q.eq('zona', zona);
    const { data: page, error } = await q
      .order('updated_at', { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    data = data.concat(page || []);
    if (!page || page.length < PAGE) break;
    from += PAGE;
    await new Promise(r => setTimeout(r, 0));
  }

  const locales = await getPedidos();
  const byRemoteId = new Map(locales.filter(p => p.remoteId).map(p => [p.remoteId, p]));
  const upserts = [];

  for (const r of data) {
    const local = byRemoteId.get(r.id);
    if (local && !local.synced) continue;

    upserts.push(mapPedidoRemoto(r, local));
  }

  await putPedidosRemotosSinPisarLocales(upserts);

  const remotosIds = new Set(data.map(r => r.id));
  const now = Date.now();
  for (const local of locales) {
    if (!local.remoteId || !local.synced || isPedidoOculto(local)) continue;
    if (isLocalPedidoProtectedFromCleanup(local, now)) continue;
    if (normalizePedidoFecha(local.fecha) !== fecha) continue;
    if (vendedorNombre && String(local.vendedorNombre || local.vendedor || '') !== String(vendedorNombre)) continue;
    if (zona && String(local.zona || '') !== String(zona)) continue;
    if (!remotosIds.has(local.remoteId)) {
      await deletePedido(local.id);
    }
  }

  return { ok: true, count: data.length };
};

// REQ-COM (AC-COM-3): trae TODOS los pedidos de un rango de fechas (sin filtro
// de vendedor/zona) para que el dashboard de comisiones del admin no quede
// incompleto (en local solo estan los ~300 recientes). Paginado; no borra
// pedidos locales (no es una foto completa) ni pisa ediciones sin subir.
export const pullPedidosByRango = async (desde, hasta, { maxTotal = 20000 } = {}) => {
  if (!desde || !hasta) return { ok: true, count: 0 };
  const PAGE = 500;
  let data = [];
  let from = 0;
  while (true) {
    const { data: page, error } = await supabase
      .from('pedidos')
      .select('*')
      .gte('fecha', desde)
      .lte('fecha', hasta)
      .order('fecha', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    data = data.concat(page || []);
    if (!page || page.length < PAGE) break;
    from += PAGE;
    if (data.length >= maxTotal) break;
    await new Promise(r => setTimeout(r, 0));
  }

  const locales = await getPedidos();
  const byRemoteId = new Map(locales.filter(p => p.remoteId).map(p => [p.remoteId, p]));
  const upserts = [];
  for (const r of data) {
    const local = byRemoteId.get(r.id);
    if (local && !local.synced) continue;
    upserts.push(mapPedidoRemoto(r, local));
  }
  await putPedidosRemotosSinPisarLocales(upserts);
  return { ok: true, count: data.length, incompleto: data.length >= maxTotal };
};

// Trae pedidos por coincidencia de nombre de cliente (para buscar historial por cliente).
// Ojo: no baja "todo" el historico; pagina y limita para no colgar iOS Safari.
export const pullPedidosByClienteNombre = async (q, limit = 1000, { vendedorNombre = null, zona = null } = {}) => {
  const qq = String(q || '').trim();
  const lim = Math.max(0, Math.min(5000, Number(limit) || 0));
  if (!qq || lim === 0) return { ok: true, count: 0 };

  const PAGE = 500;
  let data = [];
  let from = 0;
  while (true) {
    let qb = supabase
      .from('pedidos')
      .select('*')
      .ilike('cliente_nombre', `%${qq}%`);
    if (vendedorNombre) qb = qb.eq('vendedor', vendedorNombre);
    if (zona) qb = qb.eq('zona', zona);
    const { data: page, error } = await qb
      .order('updated_at', { ascending: false })
      .range(from, Math.min(from + PAGE - 1, lim - 1));
    if (error) throw error;
    data = data.concat(page || []);
    if (!page || page.length < PAGE) break;
    from += PAGE;
    if (data.length >= lim) break;
    await new Promise(r => setTimeout(r, 0));
  }

  const locales = await getPedidos();
  const byRemoteId = new Map(locales.filter(p => p.remoteId).map(p => [p.remoteId, p]));
  const upserts = [];

  for (const r of (data || [])) {
    const local = byRemoteId.get(r.id);
    if (local && !local.synced) continue;
    upserts.push(mapPedidoRemoto(r, local));
  }

  await putPedidosRemotosSinPisarLocales(upserts);

  return { ok: true, count: (data || []).length };
};

// Pull liviano: trae solo pedidos recientes para mantener el dispositivo actualizado
// sin bajar todo el histórico (evita cuelgues en iOS Safari).
export const pullPedidosRecientes = async (limit = 300, { vendedorNombre = null, zona = null } = {}) => {
  const lim = Math.max(0, Math.min(2000, Number(limit) || 0));
  if (lim === 0) return { ok: true, count: 0 };

  let q = supabase.from('pedidos').select('*');
  if (vendedorNombre) q = q.eq('vendedor', vendedorNombre);
  if (zona) q = q.eq('zona', zona);
  const { data, error } = await q
    .order('updated_at', { ascending: false })
    .range(0, lim - 1);

  if (error) throw error;

  const locales = await getPedidos();
  const byRemoteId = new Map(locales.filter(p => p.remoteId).map(p => [p.remoteId, p]));
  const upserts = [];

  for (const r of (data || [])) {
    const local = byRemoteId.get(r.id);
    if (local && !local.synced) continue;
    upserts.push(mapPedidoRemoto(r, local));
  }

  await putPedidosRemotosSinPisarLocales(upserts);

  return { ok: true, count: (data || []).length };
};

// Auto-alta desde la pantalla de ingreso: vendedor comun (permiso 2) SIN PIN.
// S-COM-13: nunca se manda "pin" ni un permiso distinto de 2 (el trigger de la
// 002 igual lo fuerza). Roles y PINs se cambian solo con la RPC
// admin_guardar_vendedor (src/services/vendedoresService.js, Configuracion).
export const syncVendedor = async (vendedor) => {
  const { data, error } = await supabase
    .from('vendedores')
    .insert({
      nombre: vendedor.nombre,
      zona: vendedor.zona ?? '',
      permiso: 2,
    })
    .select('id')
    .single();

  if (error) throw error;
  return data.id;
};

// S-COM-13: select EXPLICITO de vendedores, sin "pin" ni "pin_hash" (con el
// PASO 2 de la 002, select('*') da permission denied). Si "tiene_pin" todavia no
// existe (002 PASO 1 sin correr) se baja lo basico.
const fetchVendedoresRemotos = async () => {
  const PAGE = 1000;
  const traer = async (cols) => {
    let out = [];
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from('vendedores')
        .select(cols)
        .range(from, from + PAGE - 1);
      if (error) return { error, out };
      out = out.concat(data || []);
      if (!data || data.length < PAGE) break;
      from += PAGE;
      await new Promise(r => setTimeout(r, 0));
    }
    return { error: null, out };
  };
  let r = await traer(COLUMNAS_VENDEDOR_REMOTO);
  // REQ-VEN (AC-VEN-5): sin la 004 no existe "activo"; se baja sin esa columna.
  if (r.error && esColumnaInexistente(r.error)) r = await traer(COLUMNAS_VENDEDOR_SIN_ACTIVO);
  if (r.error && esColumnaInexistente(r.error)) r = await traer(COLUMNAS_VENDEDOR_LEGACY);
  if (r.error) throw r.error;
  return r.out;
};

export const uploadSeedToSupabase = async () => {
  const productos = await getProductos();
  const clientes  = await getClientes();

  for (let i = 0; i < productos.length; i += 100) {
    const batch = productos.slice(i, i + 100).map(p => ({
      id: p.id, nombre: p.nombre, codigo: p.codigo ?? '',
      precio: p.precio ?? 0, unidad: p.unidad ?? 'unidad', categoria: p.categoria ?? '',
      marca: p.marca ?? '', imagen_url: p.imagen_url ?? null,
    }));
    const { error } = await supabase.from('productos').upsert(batch, { onConflict: 'id' });
    if (error) {
      if (esEscrituraDenegada(error)) throw new Error('La escritura directa de productos esta cerrada: usar "Subir productos" con PIN de admin.');
      throw error;
    }
    console.log(`Productos subidos: ${Math.min(i + 100, productos.length)}/${productos.length}`);
  }

  for (let i = 0; i < clientes.length; i += 100) {
    const batch = clientes.slice(i, i + 100).map(c => ({
      id: c.id, nombre: c.nombre, direccion: c.direccion ?? '',
      telefono: c.telefono ?? '', alias: c.alias ?? '',
    }));
    const { error } = await supabase.from('clientes').upsert(batch, { onConflict: 'id' });
    if (error) throw error;
    console.log(`Clientes subidos: ${Math.min(i + 100, clientes.length)}/${clientes.length}`);
  }

  console.log('¡Seed completo!');
  return { ok: true };
};

export const downloadMaestros = async () => {
  const PAGE = 1000;
  // S-012-01: productos se lee con lista explicita de columnas publicas (los costos no; con la
  // 013 la anon key no puede leerlos). Si falta una columna nueva (migracion sin aplicar) se
  // descarta esa columna y se reintenta, como antes hacia select('*').
  const fetchAll = async (table, columnasIniciales = '*') => {
    let columnas = columnasIniciales;
    let out = [];
    let from = 0;
    while (true) {
      const sel = Array.isArray(columnas) ? columnas.join(',') : columnas;
      const { data, error } = await supabase
        .from(table)
        .select(sel)
        .range(from, from + PAGE - 1);
      if (error) {
        const menos = Array.isArray(columnas) && esColumnaInexistente(error) ? columnasSinFaltante(columnas, error) : null;
        if (menos) { columnas = menos; continue; }
        throw error;
      }
      out = out.concat(data || []);
      if (!data || data.length < PAGE) break;
      from += PAGE;
      // Respiro para no congelar Safari
      await new Promise(r => setTimeout(r, 0));
    }
    return out;
  };

  const [productosRemoto, clientesRemoto, vendedoresRemoto] = await Promise.all([
    fetchAll('productos', COLUMNAS_PRODUCTO_PUBLICAS),
    fetchAll('clientes'),
    fetchVendedoresRemotos(),
  ]);

  const [productosLocales, clientesLocales, vendedoresLocales] = await Promise.all([
    getProductos(), getClientes(), getVendedores(),
  ]);
  // syncService.js — downloadMaestros, reemplazar el loop de productos
  const productosById = new Map(productosLocales.map(p => [p.id, p]));
  const productosUpserts = [];
  for (const r of (productosRemoto ?? [])) {
    const local = productosById.get(r.id);
    
    // Si el producto tiene cambios locales pendientes, no pisar.
    // Pero si está "pendiente" y ya coincide con el remoto, lo limpiamos para no bloquear futuras actualizaciones.
    if (local?.pendingSync) {
      const same =
        String(local.nombre || '') === String(r.nombre || '') &&
        String(local.codigo || '') === String(r.codigo || '') &&
        Number(local.precio || 0) === Number(r.precio || 0) &&
        String(local.unidad || 'unidad') === String(r.unidad || 'unidad') &&
        String(local.categoria || '') === String(r.categoria || '') &&
        // Revisor (no bloqueante 7): tambien los campos nuevos; si no, una
        // edicion solo de minimo/bulto/proveedor se pisaba con el remoto.
        (local.extrasDirty !== true) &&
        String(local.marca || '') === String(r.marca ?? local.marca ?? '') &&
        // AC-VTA-5: defaults aplicados en ambos lados (undefined vs true no es diferencia).
        Object.entries(productoExtraFromRemote(r, local)).every(([k, v]) => {
          const l = k === 'bultoNombre' ? normalizarBultoNombre(local[k]) : (k === 'visibleTienda' ? local[k] !== false : (k === 'precioBulto' ? Number(local[k]) || 0 : local[k]));
          return String(l ?? '') === String(v ?? '');
        });
      if (!same) continue;
    }

    const mapped = {
      id:        r.id,
      nombre:    r.nombre,
      codigo:    r.codigo    ?? '',
      precio:    r.precio    ?? 0,
      unidad:    r.unidad    ?? 'unidad',
      categoria: r.categoria ?? '',
      marca:     r.marca     ?? local?.marca ?? '',
      imagen_url: r.imagen_url ?? local?.imagen_url ?? null,
      ...productoExtraFromRemote(local?.extrasPendientes ? {} : r, local),
      extrasPendientes: !!local?.extrasPendientes,
      createdAt: local?.createdAt ?? Date.now(),
      pendingSync: false,
    };
    productosUpserts.push(mapped);
  }
  for (let i = 0; i < productosUpserts.length; i += 500) {
    await putProductosBatch(productosUpserts.slice(i, i + 500));
  }
  const clientesById = new Map(clientesLocales.map(c => [c.id, c]));
  const clientesUpserts = (clientesRemoto ?? [])
    // Si este dispositivo tiene una edicion local todavia sin subir, no se
    // pisa con lo que baja de Supabase: esa edicion tiene que llegar primero.
    .filter(r => !clientesById.get(r.id)?.pendingSync)
    .map(r => {
      const local = clientesById.get(r.id);
      return {
        ...(local ?? {}),
        id: r.id,
        nombre: r.nombre,
        direccion: r.direccion,
        telefono: r.telefono,
        alias: r.alias,
        ...clienteExtraFromRemote(local?.extrasPendientes ? {} : r, local),
        pendingSync: false,
        // Tolerante: si la columna todavia no existe en Supabase, conserva el valor local.
        boletaContraBoleta: r.boleta_contra_boleta !== undefined ? !!r.boleta_contra_boleta : !!local?.boletaContraBoleta,
        diaEntrega: r.dia_entrega !== undefined ? (r.dia_entrega ?? null) : (local?.diaEntrega ?? null),
        ordenEntrega: r.orden_entrega !== undefined ? (r.orden_entrega ?? null) : (local?.ordenEntrega ?? null),
        // REQ-ZON: tolerante a que la columna todavia no exista (migracion 011).
        ordenZona: r.orden_zona !== undefined ? (r.orden_zona ?? null) : (local?.ordenZona ?? null),
      };
    });
  for (let i = 0; i < clientesUpserts.length; i += 500) {
    await putClientesBatch(clientesUpserts.slice(i, i + 500));
  }

  const vendedoresByRemoteId = new Map(vendedoresLocales.filter(v => v.remoteId).map(v => [v.remoteId, v]));
  const vendedoresUpserts = [];
  for (const r of (vendedoresRemoto ?? [])) {
    const local = vendedoresByRemoteId.get(r.id);
    // S-COM-13: sin pin (solo tienePin).
    vendedoresUpserts.push(vendedorDesdeRemoto(r, local));
  }
  for (let i = 0; i < vendedoresUpserts.length; i += 500) {
    await putVendedoresBatch(vendedoresUpserts.slice(i, i + 500));
  }

  // REQ-HPR: historial de cambios de precio (tolerante: sin la 010 no rompe el pull).
  await bajarCambiosPrecio();

  return { ok: true };
};

// Descarga solo vendedores (para pantalla inicial post-borrado de cache).
export const downloadVendedores = async () => {
  const out = await fetchVendedoresRemotos();

  const locales = await getVendedores();
  const byRemoteId = new Map(locales.filter(v => v.remoteId).map(v => [v.remoteId, v]));

  const upserts = out.map(r => {
    const local = byRemoteId.get(r.id);
    return vendedorDesdeRemoto(r, local);
  });

  for (let i = 0; i < upserts.length; i += 500) {
    await putVendedoresBatch(upserts.slice(i, i + 500));
  }

  return { ok: true, count: upserts.length };
};

// syncService.js — agregar al final

export const syncFaltantes = async () => {
  const locales = await getFaltantes();

  for (const f of locales.filter(f => !f.remoteId)) {
    // Si el pedido origen todavía no tiene remoteId, esperar al próximo sync
    if (!f.pedidoId) {
      console.warn('Faltante sin pedidoId remoto, se reintentará:', f);
      continue;
    }

    const { data, error } = await supabase
      .from('faltantes')
      .upsert({
        fecha:               f.fecha,
        mes:                 f.mes,
        pedido_id:           f.pedidoId,
        cliente_nombre:      f.clienteNombre,
        producto_id:         f.productoId          ?? null,
        producto_nombre:     f.productoNombre,
        cantidad_faltante:   f.cantidadFaltante,
        precio_unitario:     f.precioUnitario,
        dinero_no_percibido: f.dineroNoPercibido,
      }, { onConflict: 'id', ignoreDuplicates: false })
      .select('id')
      .single();

    if (error) {
      console.error('Error subiendo faltante:', error);
      continue;
    }

    if (data) {
      await updateFaltante({ ...f, remoteId: data.id });
    }
  }

  // 2. Bajar remotos que no tenemos localmente
  const { data: remotos, error } = await supabase
    .from('faltantes')
    .select('*')
    .order('fecha', { ascending: false });

  if (error) throw error;

  // Recargar locales actualizados (ya subimos los nuevos arriba)
  const localesActuales  = await getFaltantes();
  const localesRemoteIds = new Set(localesActuales.map(f => f.remoteId).filter(Boolean));
  const remotosIds       = new Set(remotos.map(r => r.id));

  for (const r of remotos) {
    if (!localesRemoteIds.has(r.id)) {
      await addFaltante({
        remoteId:            r.id,
        fecha:               r.fecha,
        mes:                 r.mes,
        pedidoId:            r.pedido_id,
        clienteNombre:       r.cliente_nombre,
        productoId:          r.producto_id,
        productoNombre:      r.producto_nombre,
        cantidadFaltante:    r.cantidad_faltante,
        precioUnitario:      r.precio_unitario,
        dineroNoPercibido:   r.dinero_no_percibido,
      });
    }
  }

  // 3. Borrar locales que ya no existen en remoto
  for (const local of localesActuales) {
    if (local.remoteId && !remotosIds.has(local.remoteId)) {
      await deleteFaltante(local.id);
    }
  }

  return { ok: true };
};

// Deudas: se sube solo lo que cambio localmente (synced:false) y se baja una
// ventana acotada: todas las pendientes + las de los ultimos DIAS_VENTANA dias.
// Sin ventana, con una deuda por pedido facturado se pasaria enseguida del
// limite de 1000 filas de la API y el paso 3 borraria deudas locales validas.
const DEUDAS_DIAS_VENTANA = 45;

export const syncDeudas = async () => {
  const desdeDate = new Date();
  desdeDate.setDate(desdeDate.getDate() - DEUDAS_DIAS_VENTANA);
  const desde = `${desdeDate.getFullYear()}-${String(desdeDate.getMonth() + 1).padStart(2, '0')}-${String(desdeDate.getDate()).padStart(2, '0')}`;

  // 1. Subir nuevas / cambios locales (creadas o cobradas offline). Si alguna
  // falla (RLS, columna faltante, etc.) no se corta: se sigue con el resto,
  // pero el fallo se guarda y se relanza al final — antes quedaba solo en un
  // console.error y syncDeudas() terminaba "ok" igual, asi que un cobro que
  // nunca llegaba a Supabase no avisaba a nadie.
  const locales = await getDeudas();
  let erroresSubida = [];
  for (const dLocal of locales.filter(d => d.synced === false || !d.remoteId)) {
    const row = {
      cliente_id:      dLocal.clienteId  ?? null,
      cliente_nombre:  dLocal.clienteNombre,
      pedido_id:       dLocal.pedidoId != null ? String(dLocal.pedidoId) : null,
      monto:           dLocal.monto,
      monto_pagado:    Number(dLocal.montoPagado || 0),
      concepto:        dLocal.concepto   ?? '',
      fecha:           dLocal.fecha,
      pagada:          !!dLocal.pagada,
      pagada_at:       dLocal.pagadaAt ? new Date(dLocal.pagadaAt).toISOString() : null,
      pagada_por:      dLocal.pagadaPor  ?? null,
    };

    // La columna "id" es "generated always as identity": Postgres rechaza
    // cualquier upsert que le mande un id a mano ("cannot insert a
    // non-DEFAULT value into column id"). Por eso una deuda nueva se INSERTA
    // (sin id, lo genera solo) y una que ya existe se ACTUALIZA por id, en
    // vez de usar upsert con el id incluido.
    const query = dLocal.remoteId
      ? supabase.from('deudas').update(row).eq('id', dLocal.remoteId)
      : supabase.from('deudas').insert(row);
    const { data, error } = await query.select('id').single();

    if (error) {
      console.error('Error subiendo deuda:', dLocal.clienteNombre, error);
      erroresSubida.push(`${dLocal.clienteNombre || 'deuda'}: ${error.message || error.code || String(error)}`);
      continue;
    }
    await updateDeuda({ ...dLocal, remoteId: data?.id ?? dLocal.remoteId, synced: true });
  }

  // 2. Bajar remotos y refrescar los locales ya sincronizados.
  // Las pendientes se traen TODAS (paginando), sin limite: son las que importan
  // para el total de deuda, y un .limit() sobre una consulta combinada podia
  // cortar pendientes viejas segun cuantas filas hubiera en ese momento — eso
  // hacia que el paso 3 las borrara localmente en un dispositivo si y en otro
  // no, dando totales distintos segun el aparato. Las pagadas solo se bajan
  // dentro de la ventana reciente (para el historial), tambien paginando.
  const PAGE_DEUDAS = 1000;
  const fetchAllRows = async (build) => {
    let out = [];
    let from = 0;
    while (true) {
      const { data, error } = await build().range(from, from + PAGE_DEUDAS - 1);
      if (error) throw error;
      out = out.concat(data || []);
      if (!data || data.length < PAGE_DEUDAS) break;
      from += PAGE_DEUDAS;
    }
    return out;
  };

  const pendientesRemotas = await fetchAllRows(() =>
    supabase.from('deudas').select('*').eq('pagada', false).order('fecha', { ascending: false })
  );
  const pagadasRecientes = await fetchAllRows(() =>
    supabase.from('deudas').select('*').eq('pagada', true).gte('fecha', desde).order('fecha', { ascending: false })
  );
  const remotosPorId = new Map();
  for (const r of [...pendientesRemotas, ...pagadasRecientes]) remotosPorId.set(r.id, r);
  const remotos = [...remotosPorId.values()];

  const localesActuales  = await getDeudas();
  const localesPorRemoto = new Map(localesActuales.filter(d => d.remoteId).map(d => [d.remoteId, d]));
  const remotosIds       = new Set((remotos || []).map(r => r.id));

  for (const r of (remotos || [])) {
    const local = localesPorRemoto.get(r.id);
    // Un cambio local que todavia no subio (por ejemplo un cobro sin internet)
    // manda, pero solo por un rato: si quedo trabado (nunca pudo subir, por lo
    // que sea) no puede bloquear para siempre que este dispositivo se entere
    // de lo que pasa en los demas — por ejemplo, que otro ya cobro esa deuda.
    if (local && local.synced === false) {
      const ts = Number(local.updatedAt || local.createdAt || 0);
      const esReciente = Number.isFinite(ts) && ts > 0 && (Date.now() - ts) < RECENT_LOCAL_PROTECTION_MS;
      if (esReciente) continue;
    }

    const mapeado = {
      remoteId:      r.id,
      clienteId:     r.cliente_id,
      clienteNombre: r.cliente_nombre,
      pedidoId:      r.pedido_id,
      monto:         Number(r.monto || 0),
      montoPagado:   Number(r.monto_pagado || 0),
      concepto:      r.concepto,
      fecha:         r.fecha,
      pagada:        !!r.pagada,
      pagadaAt:      r.pagada_at ? Date.parse(r.pagada_at) : null,
      pagadaPor:     r.pagada_por,
      synced:        true,
    };
    if (!local) await addDeuda(mapeado);
    else await updateDeuda({ ...local, ...mapeado, id: local.id });
  }

  // 3. Borrar locales ya sincronizados que se borraron en remoto (solo dentro de la ventana)
  for (const local of localesActuales) {
    if (!local.remoteId || local.synced === false) continue;
    const dentroDeVentana = !local.pagada || String(local.fecha || '') >= desde;
    if (dentroDeVentana && !remotosIds.has(local.remoteId)) {
      await deleteDeuda(local.id);
    }
  }

  // La bajada ya se aplico igual (por eso se relanza aca y no apenas se
  // detecto): si algo no pudo subir, quien llamo tiene que enterarse.
  if (erroresSubida.length > 0) {
    throw new Error(`No se pudieron subir ${erroresSubida.length} deuda(s): ${erroresSubida.join(' · ')}`);
  }

  return { ok: true };
};
