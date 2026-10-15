// src/domain/rendicion.js — REQ-REN (AC-REN-1..6): rendicion de devoluciones, cambios y notas
// de credito sobre pedidos facturados. Funciones puras: sin React, sin IndexedDB, sin Supabase.
//
// Modelo: la rendicion es un documento INMUTABLE (UUID). Solo cambia de 'vigente' a 'anulada'.
// - Stock (AC-REN-2): movimientos con ref 'rendicion:<uuid>' (NUNCA 'pedido:*') e ids
//   deterministas '<id>:<idx>:a' (alta) y '<id>:<idx>:x' (anulacion): cualquier dispositivo que
//   los regenere produce los mismos ids, asi el upsert por id no duplica.
// - Plata (AC-REN-3): todo en CENTAVOS enteros. creditoCents > 0 = a favor del cliente,
//   < 0 = a cargo del cliente (diferencia de un cambio).
// - Comisiones (AC-REN-5): cada rendicion congela comisionRenglones (por rubro) y
//   creditoComisionCents; cliente y servidor usan esos numeros (no se recalculan prorrateos).
/* global BigInt */
import { texto, toInt, nuevoId, esFechaISO, hoyISO } from './validacion';
import { aCentavos as pesosACentavos, normalizarTipoAB } from './compras';
import { decimalACentavos, baseRubrosPedido, pedidoIdComision, pedidoNetoParaComision } from './comisiones';
import { rubroDeRenglon, claveRubro, normalizarRubro } from './rubros';
import { MAX_CANTIDAD, refRendicion } from './stock';
import { isPedidoOculto, saldoDeuda } from '../utils/pedidos';

export { pedidoNetoParaComision };

export const TIPOS_RENDICION = Object.freeze(['devolucion', 'cambio', 'nc']);
export const ETIQUETA_TIPO_RENDICION = Object.freeze({ devolucion: 'Devolución', cambio: 'Cambio', nc: 'Nota de crédito' });
export const MIN_MOTIVO = 3;
export const MAX_MOTIVO = 300;
export const MAX_NRO_NC = 30;
// Mismo tope que los CHECK de la 014 (abs(credito_cents) <= 10^11 centavos).
export const MAX_CREDITO_CENTS = 100000000000;
export const MAX_RENGLONES = 200;

const k = (v) => String(v);

/** Primeros 8 caracteres del UUID: lo unico que viaja a la tabla legacy deudas (D3). */
export const idCorto = (id) => String(id || '').slice(0, 8);
export const conceptoCargo = (r) => `Cambio rendición #${idCorto(r?.id)}`;
export const conceptoReversion = (r) => `Reversión rendición #${idCorto(r?.id)}`;
export const pagadaPorRendicion = (r) => `Rendición #${idCorto(r?.id)}`;

/** Una rendicion cuenta si esta vigente y el servidor no la rechazo. */
export const cuentaComoVigente = (r) => !!r && r.estado === 'vigente' && r.syncEstado !== 'rechazada';

export const rendicionesDelPedido = (pedido, rendiciones = []) => {
  const pid = pedidoIdComision(pedido);
  if (!pid) return [];
  return (Array.isArray(rendiciones) ? rendiciones : []).filter(r => r && k(r.pedidoId) === pid);
};

/** Guarda de Facturacion: no se revierte/borra/edita un pedido con rendicion vigente. */
export const pedidoTieneRendicionVigente = (pedido, rendiciones = []) =>
  rendicionesDelPedido(pedido, rendiciones).some(cuentaComoVigente);

export const MSG_PEDIDO_CON_RENDICION = 'Este pedido tiene una rendición vigente (devolución, cambio o nota de crédito). Anulala primero desde "Rendición".';

const esRendible = (p) => !!p && !isPedidoOculto(p) && String(p.estado || '').toLowerCase() === 'facturado';

/**
 * AC-REN-1/6: por producto, lo facturado (renglones no eliminados) menos lo ya devuelto en
 * rendiciones vigentes del pedido. Si un producto aparece en varios renglones con precios
 * distintos se toma el MENOR (el credito nunca supera lo cobrado).
 * @returns {Map<string, {productoId, nombre, facturado, devuelto, disponible, precioCents, rubro}>}
 */
export const disponiblesParaDevolver = (pedido, rendiciones = []) => {
  const m = new Map();
  for (const it of Array.isArray(pedido?.items) ? pedido.items : []) {
    if (!it || String(it.eliminado) === 'true') continue;
    if (it.productoId === null || it.productoId === undefined || it.productoId === '') continue;
    const cant = Number(it.cantidad);
    if (!Number.isFinite(cant) || cant <= 0) continue;
    const precio = decimalACentavos(it.precio);
    const p = precio !== null && precio >= 0 ? precio : 0;
    const key = k(it.productoId);
    const prev = m.get(key);
    if (!prev) {
      m.set(key, { productoId: key, nombre: texto(it.nombre, 160), facturado: cant, devuelto: 0, disponible: 0, precioCents: p, rubro: it.rubro ?? null });
    } else {
      prev.facturado += cant;
      if (p < prev.precioCents) prev.precioCents = p;
    }
  }
  for (const r of rendicionesDelPedido(pedido, rendiciones)) {
    if (!cuentaComoVigente(r)) continue;
    for (const ren of Array.isArray(r.renglones) ? r.renglones : []) {
      if (ren?.sentido !== 'entra') continue;
      const d = m.get(k(ren.productoId));
      if (d) d.devuelto += Number(ren.cantidad) || 0;
    }
  }
  for (const d of m.values()) d.disponible = Math.max(0, Math.floor(d.facturado + 1e-9) - d.devuelto);
  return m;
};

/**
 * AC-REN-3 / S-REN-04: credito que todavia se puede dar sobre el pedido = total del pedido menos
 * los creditos a favor de las rendiciones vigentes (mismo tope que admin_rendiciones_guardar).
 */
export const topeCreditoPedidoCents = (pedido, rendiciones = []) => {
  const totalCents = pesosACentavos(pedido?.total) || 0;
  const previos = rendicionesDelPedido(pedido, rendiciones).filter(cuentaComoVigente)
    .reduce((a, r) => a + Math.max(0, Number(r.creditoCents) || 0), 0);
  return Math.max(0, totalCents - previos);
};

const sumaRenglones = (rs) => (rs || []).reduce((a, r) => a + (Number(r.precioCents) || 0) * (Number(r.cantidad) || 0), 0);

/** AC-REN-1: diferencia de un cambio (+ credito a favor del cliente, - a pagar por el cliente). */
export const diferenciaCambioCents = (renglonesEntra = [], renglonesSale = []) =>
  sumaRenglones(renglonesEntra) - sumaRenglones(renglonesSale);

const entraDe = (r) => (r?.renglones || []).filter(x => x?.sentido === 'entra');
const saleDe = (r) => (r?.renglones || []).filter(x => x?.sentido === 'sale');

/** AC-REN-3: credito de la rendicion (devolucion: lo facturado de lo que vuelve, mermas incluidas). */
export const creditoRendicion = (r) => {
  if (r?.tipo === 'devolucion') return sumaRenglones(entraDe(r));
  if (r?.tipo === 'cambio') return diferenciaCambioCents(entraDe(r), saleDe(r));
  if (r?.tipo === 'nc') return Number(r.creditoCents) || 0;
  return 0;
};

// Mayor resto (Hamilton) en BigInt: reparte `total` (entero, con signo) segun pesos >= 0.
const prorratear = (total, pesos) => {
  const W = pesos.reduce((a, p) => a + BigInt(p), BigInt(0));
  if (W === BigInt(0) || total === 0) return pesos.map(() => 0);
  const T = BigInt(Math.abs(total));
  const base = pesos.map(p => (T * BigInt(p)) / W);
  const restos = pesos.map((p, i) => ({ i, r: (T * BigInt(p)) % W }));
  let falta = Number(T - base.reduce((a, b) => a + b, BigInt(0)));
  restos.sort((a, b) => (a.r === b.r ? a.i - b.i : (a.r > b.r ? -1 : 1)));
  for (const { i } of restos) {
    if (falta <= 0) break;
    base[i] += BigInt(1);
    falta -= 1;
  }
  return base.map(b => (total < 0 ? -Number(b) : Number(b)));
};

const ordenClave = (a, b) => (a.rubroClave < b.rubroClave ? -1 : a.rubroClave > b.rubroClave ? 1 : 0);

/**
 * AC-REN-5: efecto de la rendicion en la base de comision, por rubro (congelado).
 * Devolucion/cambio: -precio x cantidad de lo que entra, +precio x cantidad de lo que sale.
 * NC: el monto se prorratea por rubro del pedido (mayor resto, en centavos).
 * @returns {Array<{rubroClave: string, rubro: string, subtotalCents: number}>}
 */
export const comisionRenglonesDe = (rendicion, pedido, productosById = new Map()) => {
  const acc = new Map();
  const sumar = (rubroClave, rubro, cents) => {
    const key = rubroClave || '';
    if (!acc.has(key)) acc.set(key, { rubroClave: key, rubro: key ? rubro : '', subtotalCents: 0 });
    acc.get(key).subtotalCents += cents;
  };
  if (rendicion?.tipo === 'nc') {
    const credito = Number(rendicion.creditoCents) || 0;
    const base = baseRubrosPedido(pedido, productosById);
    const grupos = base.porRubro.map(r => ({ rubroClave: r.clave, rubro: r.rubro, peso: Math.max(0, r.subtotalCents) }));
    const sinRubro = base.sinRubro.reduce((a, s) => a + (Number(s.subtotalCents) || 0), 0);
    if (sinRubro > 0) grupos.push({ rubroClave: '', rubro: '', peso: sinRubro });
    const reparto = prorratear(-credito, grupos.map(g => g.peso));
    if (grupos.every(g => g.peso === 0)) sumar('', '', -credito);
    else grupos.forEach((g, i) => sumar(g.rubroClave, g.rubro, reparto[i]));
  } else {
    for (const ren of rendicion?.renglones || []) {
      const cents = (Number(ren.precioCents) || 0) * (Number(ren.cantidad) || 0);
      sumar(ren.rubroClave || '', ren.rubro || '', ren.sentido === 'sale' ? cents : -cents);
    }
  }
  return [...acc.values()].filter(x => x.subtotalCents !== 0).sort(ordenClave);
};

const rubroDe = (item, productosById) => {
  const r = rubroDeRenglon(item, productosById);
  return { rubro: r.rubro || '', rubroClave: r.clave || '' };
};

/**
 * AC-REN-1: valida el formulario y arma la rendicion (todavia sin grabar).
 * form = { tipo, renglones: [{ productoId, cantidad, vuelveAlStock }], sale: [{ productoId, cantidad }],
 *          montoNc, tipoFactura, nroNc, motivo, fecha }
 */
export const validarRendicion = (form = {}, { pedido, rendiciones = [], productos = [], usuario = '', now = new Date(), genId = nuevoId } = {}) => {
  const errores = {};
  const f = form && typeof form === 'object' ? form : {};
  if (!pedido) errores.pedido = 'Elegí un pedido';
  else if (!esRendible(pedido)) errores.pedido = 'Solo se rinden pedidos facturados (no borrados)';
  else if (!pedidoIdComision(pedido)) errores.pedido = 'El pedido todavía no se sincronizó: sincronizá antes de rendir';
  else if (pedido.clienteId === null || pedido.clienteId === undefined || pedido.clienteId === '') errores.pedido = 'El pedido no tiene un cliente asociado';

  const tipo = TIPOS_RENDICION.includes(f.tipo) ? f.tipo : null;
  if (!tipo) errores.tipo = 'Elegí Devolución, Cambio o Nota de crédito';

  const motivo = texto(f.motivo, 1000);
  if (motivo.length < MIN_MOTIVO) errores.motivo = `Escribí el motivo (mínimo ${MIN_MOTIVO} letras)`;
  else if (motivo.length > MAX_MOTIVO) errores.motivo = `El motivo no puede pasar de ${MAX_MOTIVO} caracteres`;

  let tipoFactura = null;
  let nroNc = null;
  if (tipo === 'nc') {
    const raw = String(f.tipoFactura ?? '').trim();
    tipoFactura = normalizarTipoAB(raw);
    if (raw && !tipoFactura && !['ninguna', 'sin factura', '-'].includes(raw.toLowerCase())) errores.tipoFactura = 'Elegí Factura A, Factura B o ninguna';
    const n = texto(f.nroNc, 1000);
    if (n.length > MAX_NRO_NC) errores.nroNc = `El n.º de NC no puede pasar de ${MAX_NRO_NC} caracteres`;
    nroNc = n || null;
  }

  const productosById = new Map((Array.isArray(productos) ? productos : []).filter(p => p && p.id !== undefined && p.id !== null).map(p => [k(p.id), p]));
  const renglones = [];
  let creditoCents = 0;

  if (pedido && !errores.pedido && tipo) {
    const disp = disponiblesParaDevolver(pedido, rendiciones);
    const itemsPorProducto = new Map((pedido.items || []).filter(it => it && String(it.eliminado) !== 'true').map(it => [k(it.productoId), it]));
    if (tipo === 'devolucion' || tipo === 'cambio') {
      const entra = Array.isArray(f.renglones) ? f.renglones : [];
      const vistos = new Set();
      if (!entra.length) errores.renglones = tipo === 'cambio' ? 'Elegí el producto que vuelve' : 'Elegí al menos un producto a devolver';
      for (const r of entra) {
        const pid = k(r?.productoId);
        const ek = `item:${pid}`;
        const d = disp.get(pid);
        if (!d) { errores[ek] = 'Ese producto no está en el pedido'; continue; }
        if (vistos.has(pid)) { errores[ek] = `"${d.nombre}" está repetido`; continue; }
        vistos.add(pid);
        const cant = toInt(r?.cantidad);
        if (cant === null || cant <= 0) { errores[ek] = `Cantidad inválida para "${d.nombre}" (entero mayor a 0)`; continue; }
        if (cant > d.disponible) { errores[ek] = `"${d.nombre}": se pueden devolver hasta ${d.disponible}`; continue; }
        const rub = rubroDe(itemsPorProducto.get(pid) || { productoId: pid }, productosById);
        renglones.push({ productoId: pid, nombre: d.nombre, cantidad: cant, precioCents: d.precioCents, vuelveAlStock: r?.vuelveAlStock !== false, sentido: 'entra', ...rub });
      }
    }
    if (tipo === 'cambio') {
      const sale = Array.isArray(f.sale) ? f.sale : [];
      const vistos = new Set();
      if (!sale.length) errores.sale = 'Elegí el producto que sale';
      for (const r of sale) {
        const pid = k(r?.productoId);
        const ek = `sale:${pid}`;
        const prod = productosById.get(pid);
        if (!prod) { errores[ek] = 'Producto inexistente'; continue; }
        if (vistos.has(pid)) { errores[ek] = `"${prod.nombre}" está repetido`; continue; }
        vistos.add(pid);
        const cant = toInt(r?.cantidad);
        if (cant === null || cant <= 0 || cant > MAX_CANTIDAD) { errores[ek] = `Cantidad inválida para "${prod.nombre}"`; continue; }
        const precio = decimalACentavos(prod.precio);
        if (precio === null || precio < 0) { errores[ek] = `"${prod.nombre}" no tiene un precio válido`; continue; }
        const rub = rubroDe({ productoId: pid }, productosById);
        renglones.push({ productoId: pid, nombre: texto(prod.nombre, 160), cantidad: cant, precioCents: precio, vuelveAlStock: true, sentido: 'sale', ...rub });
      }
    }
    if (tipo === 'nc') {
      const monto = pesosACentavos(f.montoNc);
      const tope = topeCreditoPedidoCents(pedido, rendiciones);
      if (monto === null || monto <= 0) errores.montoNc = 'Ingresá el monto de la nota de crédito';
      else if (monto > tope) errores.montoNc = `El monto no puede pasar de $${(tope / 100).toLocaleString('es-AR')} (total del pedido menos créditos anteriores)`;
      else creditoCents = monto;
    }
    if (renglones.length > MAX_RENGLONES) errores.renglones = `Máximo ${MAX_RENGLONES} renglones`;
  }

  if (Object.keys(errores).length) return { ok: false, errores };

  const id = genId();
  const rendicion = {
    id,
    pedidoId: pedidoIdComision(pedido),
    pedidoLocalId: pedido.id ?? null,
    clienteId: k(pedido.clienteId),
    clienteNombre: texto(pedido.clienteNombre, 200),
    fecha: esFechaISO(f.fecha) ? f.fecha : hoyISO(now),
    tipo,
    renglones,
    creditoCents: 0,
    creditoComisionCents: 0,
    comisionRenglones: [],
    tipoFactura,
    nroNc,
    motivo,
    estado: 'vigente',
    usuario: texto(usuario, 80),
    createdAt: now.toISOString(),
  };
  rendicion.creditoCents = tipo === 'nc' ? creditoCents : creditoRendicion(rendicion);
  if (Math.abs(rendicion.creditoCents) > MAX_CREDITO_CENTS) return { ok: false, errores: { montoNc: 'Monto fuera de rango' } };
  if (tipo !== 'nc' && rendicion.creditoCents > topeCreditoPedidoCents(pedido, rendiciones)) {
    const tope = topeCreditoPedidoCents(pedido, rendiciones);
    return { ok: false, errores: { renglones: `El crédito no puede pasar de $${(tope / 100).toLocaleString('es-AR')} (total del pedido menos créditos anteriores)` } };
  }
  rendicion.comisionRenglones = comisionRenglonesDe(rendicion, pedido, productosById);
  rendicion.creditoComisionCents = -rendicion.comisionRenglones.reduce((a, c) => a + c.subtotalCents, 0) || 0;
  return { ok: true, errores: {}, rendicion };
};

// ---------------------------------------------------------------------------
// Stock (AC-REN-2)
// ---------------------------------------------------------------------------
const notaMov = (r, ren) => texto(`Rendición #${idCorto(r.id)} · ${ren.nombre || ''}`, 160);

/** Alta: 'devolucion' (+) por lo que vuelve al stock, 'venta' (-) por lo que sale. La merma no mueve stock. */
export const movimientosRendicion = (r) => {
  const out = [];
  (r?.renglones || []).forEach((ren, idx) => {
    const cant = Number(ren?.cantidad);
    if (!Number.isInteger(cant) || cant <= 0 || cant > MAX_CANTIDAD) return;
    if (ren.sentido === 'entra' && ren.vuelveAlStock === false) return; // merma
    if (ren.sentido !== 'entra' && ren.sentido !== 'sale') return;
    out.push({
      id: `${r.id}:${idx}:a`,
      productoId: k(ren.productoId),
      cantidad: ren.sentido === 'entra' ? cant : -cant,
      tipo: ren.sentido === 'entra' ? 'devolucion' : 'venta',
      ref: refRendicion(r.id),
      fecha: r.createdAt || new Date().toISOString(),
      usuario: texto(r.usuario, 80),
      nota: notaMov(r, ren),
    });
  });
  return out;
};

/** Anulacion: compensa cada movimiento del alta (tipo 'anulacion', cantidad opuesta, id ':x'). */
export const movimientosAnulacionRendicion = (r, { now = new Date(), usuario = '' } = {}) =>
  movimientosRendicion(r).map(m => ({
    ...m,
    id: m.id.replace(/:a$/, ':x'),
    cantidad: -m.cantidad,
    tipo: 'anulacion',
    fecha: now.toISOString(),
    usuario: texto(usuario || m.usuario, 80),
  }));

// ---------------------------------------------------------------------------
// Plata (AC-REN-3 / AC-REN-4)
// ---------------------------------------------------------------------------
const centsDe = (pesos) => Math.round((Number(pesos) || 0) * 100);

/**
 * Credito > 0: se cobra de las deudas pendientes del cliente (mas viejas primero) y el resto
 * queda como saldo a favor. Credito < 0: el cliente paga la diferencia (deuda nueva).
 */
export const planEfectoCuenta = (creditoCents, deudasCliente = []) => {
  const credito = Number(creditoCents) || 0;
  if (credito < 0) return { cobros: [], saldoFavorCents: 0, cargoCents: -credito };
  const ordenadas = [...(Array.isArray(deudasCliente) ? deudasCliente : [])]
    .filter(d => saldoDeuda(d) > 0)
    .sort((a, b) => String(a.fecha || '').localeCompare(String(b.fecha || '')) || (Number(a.id) || 0) - (Number(b.id) || 0));
  let resto = credito;
  const cobros = [];
  for (const d of ordenadas) {
    if (resto <= 0) break;
    const cobra = Math.min(centsDe(saldoDeuda(d)), resto);
    if (cobra <= 0) continue;
    cobros.push({ deudaId: d.id, deudaRemoteId: d.remoteId ?? null, montoCents: cobra });
    resto -= cobra;
  }
  return { cobros, saldoFavorCents: resto, cargoCents: 0 };
};

const mismoCliente = (a, b) => a !== null && a !== undefined && b !== null && b !== undefined && k(a) === k(b);

/** Asiento del ledger privado de saldo a favor. sufijo: 'favor:a' | 'favor:x' | 'cargo:x'. */
export const asientoSaldoFavor = (r, montoCents, sufijo, { now = new Date(), usuario = '' } = {}) => ({
  id: `${r.id}:${sufijo}`,
  clienteId: k(r.clienteId),
  rendicionId: r.id,
  tipo: 'saldo_favor',
  montoCents: Number(montoCents) || 0,
  fecha: hoyISO(now),
  usuario: texto(usuario, 80),
});

/**
 * AC-REN-4: que hay que revertir al anular, a partir del efecto registrado (nada se borra:
 * todo son asientos/deudas compensatorias, salvo la deuda del cargo si no tuvo cobros).
 */
export const planAnulacionCuenta = (r, deudas = [], cuenta = []) => {
  const ef = r?.efecto && typeof r.efecto === 'object' ? r.efecto : null;
  const netoFavor = (Array.isArray(cuenta) ? cuenta : [])
    .filter(c => c && c.rendicionId === r?.id && String(c.id || '').startsWith(`${r?.id}:favor`))
    .reduce((a, c) => a + (Number(c.montoCents) || 0), 0);
  const plan = {
    saldoFavorCompensaCents: netoFavor > 0 ? netoFavor : 0,
    deudaReversionCents: (ef?.cobros || []).reduce((a, c) => a + (Number(c?.montoCents) || 0), 0),
    anularDeudaCargoId: null,
    ajustarDeudaCargo: null,
    saldoFavorPorCargoCobradoCents: 0,
  };
  const cargo = Number(ef?.cargoCents) || 0;
  if (cargo > 0) {
    const d = (Array.isArray(deudas) ? deudas : []).find(x => x && x.concepto === conceptoCargo(r) && (mismoCliente(x.clienteId, r.clienteId) || !x.clienteId));
    const cobrado = d ? Math.min(centsDe(d.montoPagado), centsDe(d.monto)) : 0;
    if (!d) plan.saldoFavorPorCargoCobradoCents = cargo; // no esta en este dispositivo: se compensa con saldo a favor
    else if (cobrado <= 0 && !d.pagada) plan.anularDeudaCargoId = d.id;
    else {
      plan.saldoFavorPorCargoCobradoCents = cobrado;
      if (cobrado < centsDe(d.monto)) plan.ajustarDeudaCargo = { deudaId: d.id, montoCents: cobrado };
    }
  }
  return plan;
};

/** AC-REN-3: saldo a favor de un cliente = suma del ledger privado. */
export const saldoAFavorCliente = (cuentaClientes = [], clienteId) => {
  if (clienteId === null || clienteId === undefined || clienteId === '') return 0;
  return (Array.isArray(cuentaClientes) ? cuentaClientes : [])
    .filter(c => c && k(c.clienteId) === k(clienteId))
    .reduce((a, c) => a + (Number(c.montoCents) || 0), 0);
};

/** AC-REN-3: lo que se imprime en la boleta (pesos). Deuda y saldo a favor se netean. */
export const cuentaParaBoleta = (deudaPendiente = 0, saldoFavorCents = 0) => {
  const neto = centsDe(deudaPendiente) - (Number(saldoFavorCents) || 0);
  return neto >= 0 ? { deudaPendiente: neto / 100, saldoAFavor: 0 } : { deudaPendiente: 0, saldoAFavor: -neto / 100 };
};

// ---------------------------------------------------------------------------
// Rendicion del dia (AC-REN-4)
// ---------------------------------------------------------------------------
export const resumenRendicionDia = (rendiciones = [], fecha) => {
  const filas = (Array.isArray(rendiciones) ? rendiciones : [])
    .filter(r => r && r.fecha === fecha)
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
    .map(r => {
      const merma = entraDe(r).filter(x => x.vuelveAlStock === false);
      return {
        id: r.id,
        idCorto: idCorto(r.id),
        clienteNombre: r.clienteNombre || '',
        pedidoId: r.pedidoId,
        tipo: r.tipo,
        tipoLabel: ETIQUETA_TIPO_RENDICION[r.tipo] || r.tipo,
        creditoCents: Number(r.creditoCents) || 0,
        mermaUnidades: merma.reduce((a, x) => a + (Number(x.cantidad) || 0), 0),
        mermaCents: sumaRenglones(merma),
        detalle: (r.renglones || []).map(x => `${x.sentido === 'sale' ? 'Sale' : 'Vuelve'} ${x.cantidad} ${x.nombre}${x.vuelveAlStock === false ? ' (merma)' : ''}`).join(' · '),
        motivo: r.motivo || '',
        nroNc: r.nroNc || '',
        tipoFactura: r.tipoFactura || '',
        estado: r.estado,
        anulada: r.estado === 'anulada',
        rechazada: r.syncEstado === 'rechazada',
        pendiente: r.syncEstado !== 'confirmada' && r.syncEstado !== 'rechazada',
        motivoAnulacion: r.motivoAnulacion || '',
      };
    });
  const totales = { devueltoCents: 0, ncCents: 0, cambiosCents: 0, mermaCents: 0, mermaUnidades: 0, anuladas: 0 };
  for (const f of filas) {
    if (f.anulada || f.rechazada) { totales.anuladas += 1; continue; }
    if (f.tipo === 'devolucion') totales.devueltoCents += f.creditoCents;
    else if (f.tipo === 'nc') totales.ncCents += f.creditoCents;
    else if (f.tipo === 'cambio') totales.cambiosCents += f.creditoCents;
    totales.mermaCents += f.mermaCents;
    totales.mermaUnidades += f.mermaUnidades;
  }
  return { fecha, filas, totales };
};

// ---------------------------------------------------------------------------
// Remoto (014) — D1: solo viaja por RPC con PIN de admin.
// ---------------------------------------------------------------------------
const renglonRemoto = (x) => ({
  productoId: k(x.productoId), nombre: texto(x.nombre, 160), cantidad: Number(x.cantidad),
  precioCents: Number(x.precioCents) || 0, vuelveAlStock: x.vuelveAlStock !== false, sentido: x.sentido,
  rubro: normalizarRubro(x.rubro), rubroClave: x.rubroClave || claveRubro(x.rubro),
});

export const rendicionToRemote = (r) => ({
  id: r.id,
  pedido_id: k(r.pedidoId),
  cliente_id: r.clienteId === null || r.clienteId === undefined ? null : k(r.clienteId),
  cliente_nombre: r.clienteNombre || null,
  fecha: r.fecha,
  tipo: r.tipo,
  renglones: (r.renglones || []).map(renglonRemoto),
  credito_cents: Number(r.creditoCents) || 0,
  credito_comision_cents: Number(r.creditoComisionCents) || 0,
  comision_renglones: (r.comisionRenglones || []).map(c => ({ rubroClave: c.rubroClave || '', rubro: c.rubro || '', subtotalCents: Number(c.subtotalCents) || 0 })),
  tipo_factura: r.tipoFactura || null,
  nro_nc: r.nroNc || null,
  motivo: r.motivo,
  usuario: r.usuario || null,
  created_at: r.createdAt || null,
});

const ms = (v) => { const n = Date.parse(v); return Number.isFinite(n) ? n : null; };

export const rendicionFromRemote = (row, local = null) => ({
  id: String(row.id),
  pedidoId: k(row.pedido_id),
  pedidoLocalId: local?.pedidoLocalId ?? null,
  clienteId: row.cliente_id ?? null,
  clienteNombre: row.cliente_nombre || '',
  fecha: String(row.fecha || '').slice(0, 10),
  tipo: row.tipo,
  renglones: Array.isArray(row.renglones) ? row.renglones : [],
  creditoCents: Number(row.credito_cents) || 0,
  creditoComisionCents: Number(row.credito_comision_cents) || 0,
  comisionRenglones: Array.isArray(row.comision_renglones) ? row.comision_renglones : [],
  tipoFactura: row.tipo_factura || null,
  nroNc: row.nro_nc || null,
  motivo: row.motivo || '',
  estado: row.estado === 'anulada' ? 'anulada' : 'vigente',
  anuladaAt: row.anulada_at || null,
  anuladaPor: row.anulada_por || null,
  motivoAnulacion: row.motivo_anulacion || '',
  efecto: row.efecto ?? local?.efecto ?? null,
  efectoAnulacion: row.efecto_anulacion ?? local?.efectoAnulacion ?? null,
  // El efecto lo aplica SOLO el dispositivo que creo la rendicion; uno que la baja no lo aplica.
  efectoAplicado: local ? !!local.efectoAplicado || row.efecto != null : true,
  usuario: row.usuario || '',
  createdAt: row.created_at || null,
  updatedAt: ms(row.updated_at) ?? Date.now(),
  syncEstado: 'confirmada',
  pendingSync: false,
});

export const cuentaClienteToRemote = (c) => ({
  id: c.id, cliente_id: k(c.clienteId), rendicion_id: c.rendicionId || null, tipo: c.tipo,
  monto_cents: Number(c.montoCents) || 0, fecha: c.fecha, usuario: c.usuario || null,
});

export const cuentaClienteFromRemote = (row) => ({
  id: String(row.id), clienteId: k(row.cliente_id), rendicionId: row.rendicion_id || null, tipo: row.tipo,
  montoCents: Number(row.monto_cents) || 0, fecha: String(row.fecha || '').slice(0, 10), usuario: row.usuario || '',
  pendingSync: false,
});

export const MENSAJES_RENDICION = Object.freeze({
  pin_requerido: 'Ingresá el PIN de administrador.',
  pin_incorrecto: 'PIN incorrecto o tu usuario no está autorizado como admin en el servidor.',
  bloqueado: 'Demasiados intentos de PIN. Probá de nuevo en 15 minutos.',
  falta_migracion: 'Falta la migración 014 en Supabase: las rendiciones quedan guardadas en este dispositivo.',
  offline: 'Necesitás conexión para esta operación.',
  lote_invalido: 'El servidor rechazó el lote.',
  datos_invalidos: 'El servidor rechazó los datos.',
  inexistente: 'La rendición no está en el servidor: subila primero.',
  ya_anulada: 'La rendición ya estaba anulada (otro dispositivo la anuló antes).',
  rechazada: 'El servidor rechazó la rendición.',
  respuesta_invalida: 'El servidor respondió algo inesperado: los datos siguen pendientes.',
  error: 'No se pudo completar la operación con el servidor.',
});

const fallaRpc = (motivo) => ({ ok: false, motivo, mensaje: MENSAJES_RENDICION[motivo] || MENSAJES_RENDICION.error });

/** Traduce { data, error } de una RPC de la 014. */
export const interpretarRpcRendicion = ({ data, error } = {}) => {
  if (error) {
    if (['PGRST202', '42883'].includes(String(error?.code)) || /could not find the function/i.test(String(error?.message || ''))) return fallaRpc('falta_migracion');
    if (/demasiados intentos/i.test(String(error?.message || ''))) return fallaRpc('bloqueado');
    return fallaRpc('error');
  }
  if (!data || typeof data !== 'object') return fallaRpc('respuesta_invalida');
  if (data.ok === false) {
    if (data.motivo === 'no_autorizado') return fallaRpc('pin_incorrecto');
    return fallaRpc(['lote_invalido', 'datos_invalidos', 'inexistente'].includes(data.motivo) ? data.motivo : 'error');
  }
  if (data.ok !== true) return fallaRpc('respuesta_invalida');
  if (data.ya_anulada === true) return { ok: true, data, yaAnulada: true, motivo: 'ya_anulada', mensaje: MENSAJES_RENDICION.ya_anulada };
  return { ok: true, data };
};

export const MOTIVOS_RECHAZO = Object.freeze({
  cantidad_excedida: 'otro dispositivo ya devolvió esas cantidades',
  monto_excedido: 'el monto supera lo que queda del pedido',
  credito_inconsistente: 'el crédito no coincide con los renglones facturados',
  pedido_invalido: 'el pedido no está facturado en el servidor',
  comision_inconsistente: 'datos de comisión inconsistentes',
  datos_invalidos: 'datos inválidos',
});
