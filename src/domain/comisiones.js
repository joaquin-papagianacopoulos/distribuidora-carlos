// src/domain/comisiones.js — REQ-COM (AC-COM-1, 3..15). Lógica pura del cierre
// de comisiones: sin React, sin IndexedDB, sin Supabase. La UI, el servicio y
// el sync solo invocan estas funciones.
//
// Todo el dinero se opera en CENTAVOS ENTEROS y se devuelve en pesos con 2
// decimales: así una división 50/50 de $0,01 da 0,01 + 0,00 (la suma cierra
// exacto) y 1,005 no se convierte en 1,00 por error de punto flotante.
//
// REQ-COMR (RUN 20261014-1449): la comisión se calcula por vendedor y por rubro
// del producto, renglón por renglón (modelo 'rubro'). El modelo viejo (% de la
// ficha del cliente, modelo 'cliente') se conserva para los cierres ya
// confirmados y sus ajustes: un cierre sin `modelo` se lee como 'cliente'.
/* global BigInt */
import { texto, toNum, claveUnica, nuevoId, esFechaISO } from './validacion';
import { isPedidoOculto, normalizePedidoFecha } from '../utils/pedidos';
import { rubroDeRenglon, indexarTablaRubros, pctDe, vendedorIdPorNombre } from './rubros';

// AC-COMR-13: versión del modelo de cálculo. Los servicios siempre mandan
// MODELO_VIGENTE; sin `modelo` se usa 'cliente' (compatibilidad).
export const MODELOS_COMISION = ['cliente', 'rubro'];
export const MODELO_VIGENTE = 'rubro';

// ---------------------------------------------------------------------------
// Configuración / supuestos "a confirmar con el dueño" (plan §9 y §10).
// Están acá, juntos y visibles, para cambiarlos sin tocar la lógica.
// ---------------------------------------------------------------------------
export const CONFIG_COMISIONES = Object.freeze({
  // ⚠ A confirmar: ¿alcanza con "A reparto"? 'entregado' (marca nueva, AC-COM-1)
  // o 'aReparto' (la marca que ya existe). Cambiar acá cambia el filtro del dashboard.
  // S-COM-04: la RPC cerrar_comisiones (supabase/migrations/003_comisiones.sql)
  // exige coalesce(p.entregado, false). Si se pasa a 'aReparto', hay que cambiar
  // JUNTOS este valor y la RPC (p.a_reparto), si no el servidor rechaza el cierre.
  criterioEntregado: 'entregado',
  // Quiénes pueden marcar "Entregado": 1 = admin, 3 = armador (supuesto 9).
  rolesMarcanEntregado: [1, 3],
  // Aviso (a) solo si quien cargó es un vendedor (permiso 2). Pedidos "WEB" o
  // cargados por el admin van al vendedor de la ficha sin aviso (supuesto 6).
  rolesQueCuentanComoCargador: [2],
  // Rango máximo del período, en días (supuesto 10).
  maxDiasPeriodo: 366,
  // Reparto por defecto al dividir (AC-COM-7).
  divisionPorDefecto: [50, 50],
});

export const ESTADOS_CIERRE = ['vigente', 'anulado', 'pendiente', 'rechazado'];
// Estados que "ocupan" un pedido: no puede contarse en otro cierre.
export const ESTADOS_QUE_CIERRAN = ['vigente', 'pendiente'];
export const MODOS_ASIGNACION = ['ficha', 'cargador', 'dividir', 'otro', 'sin_comision'];
export const MAX_MOTIVO = 300;
export const MIN_MOTIVO = 3;
const MAX_NOMBRE = 80;

// ---------------------------------------------------------------------------
// Permisos (AC-COM-2, AC-SEC-4)
// ---------------------------------------------------------------------------
// Estricto: solo el número 1. Un '1' string (forjado) o undefined no pasa.
export const puedeVerComisiones = (permiso) => permiso === 1;

const esFacturadoActivo = (p) => !!p && !isPedidoOculto(p) && String(p.estado || '').toLowerCase() === 'facturado';

export const puedeMarcarEntregado = (pedido, permiso, config = CONFIG_COMISIONES) => {
  if (!config.rolesMarcanEntregado.includes(permiso)) return { ok: false, motivo: 'No tenés permiso para marcar entregas' };
  if (!esFacturadoActivo(pedido)) return { ok: false, motivo: 'Solo se marca entregado un pedido facturado' };
  return { ok: true };
};

// cerradoEn: id del cierre vigente que contiene al pedido (o null).
export const puedeDesmarcarEntregado = (pedido, permiso, cerradoEn = null, config = CONFIG_COMISIONES) => {
  if (!pedido?.entregado) return { ok: false, requiereConfirmacion: false, motivo: 'El pedido no está marcado como entregado' };
  if (cerradoEn) {
    if (permiso !== 1) return { ok: false, requiereConfirmacion: false, motivo: 'El pedido ya está en un cierre de comisiones: solo el admin lo puede desmarcar' };
    return { ok: true, requiereConfirmacion: true };
  }
  if (!config.rolesMarcanEntregado.includes(permiso)) return { ok: false, requiereConfirmacion: false, motivo: 'No tenés permiso para marcar entregas' };
  return { ok: true, requiereConfirmacion: false };
};

// S-COM-05: guard único para el repositorio (defensa en profundidad, mismos
// roles que la UI). entregado = valor NUEVO que se quiere guardar.
export const validarCambioEntrega = (pedido, entregado, permiso, cerradoEn = null, config = CONFIG_COMISIONES) =>
  (entregado
    ? puedeMarcarEntregado(pedido, permiso, config)
    : puedeDesmarcarEntregado(pedido, permiso, cerradoEn, config));

// ---------------------------------------------------------------------------
// Marca de entregado (AC-COM-1). No toca estado, items ni total.
// ---------------------------------------------------------------------------
export const marcarEntregado = (pedido, entregado, usuario, now = Date.now()) => ({
  ...pedido,
  entregado: !!entregado,
  entregadoAt: entregado ? now : null,
  entregadoPor: entregado ? (texto(usuario, MAX_NOMBRE) || null) : null,
  updatedAt: now,
});

export const COLUMNAS_ENTREGA = ['entregado', 'entregado_at', 'entregado_por'];

const aIso = (ms) => {
  const n = Number(ms);
  if (ms === null || ms === undefined || ms === '' || !Number.isFinite(n)) return null;
  const d = new Date(n);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

export const pedidoEntregaToRemote = (p) => ({
  entregado: !!p?.entregado,
  entregado_at: p?.entregado ? aIso(p?.entregadoAt) : null,
  entregado_por: p?.entregado ? (texto(p?.entregadoPor, MAX_NOMBRE) || null) : null,
});

export const sinColumnasEntrega = (row) => {
  const out = { ...(row || {}) };
  for (const k of COLUMNAS_ENTREGA) delete out[k];
  return out;
};

// Tolerante (AC-CLI-5): si Supabase no tiene la columna (undefined) se conserva
// lo local; si el local tiene una marca sin subir (entregaPendiente) manda lo local.
export const pedidoEntregaFromRemote = (r, local = null) => {
  if (local?.entregaPendiente) {
    return { entregado: !!local.entregado, entregadoAt: local.entregadoAt ?? null, entregadoPor: local.entregadoPor ?? null };
  }
  const row = r || {};
  const at = row.entregado_at !== undefined
    ? (row.entregado_at ? Date.parse(row.entregado_at) : null)
    : (local?.entregadoAt ?? null);
  return {
    entregado: row.entregado !== undefined ? !!row.entregado : !!local?.entregado,
    entregadoAt: Number.isFinite(at) ? at : null,
    entregadoPor: row.entregado_por !== undefined ? (row.entregado_por ?? null) : (local?.entregadoPor ?? null),
  };
};

export const estaEntregado = (pedido, config = CONFIG_COMISIONES) =>
  (config.criterioEntregado === 'aReparto' ? !!pedido?.aReparto : !!pedido?.entregado);

// ---------------------------------------------------------------------------
// Período (AC-COM-3)
// ---------------------------------------------------------------------------
const pad2 = (n) => String(n).padStart(2, '0');

export const periodoPorDefecto = (now = new Date()) => {
  const y = now.getFullYear();
  const m = now.getMonth();
  const ultimo = new Date(y, m + 1, 0).getDate();
  return { desde: `${y}-${pad2(m + 1)}-01`, hasta: `${y}-${pad2(m + 1)}-${pad2(ultimo)}` };
};

const diasEntre = (a, b) => {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
};

export const validarPeriodo = (periodo, config = CONFIG_COMISIONES) => {
  const desde = String(periodo?.desde ?? '').trim();
  const hasta = String(periodo?.hasta ?? '').trim();
  const errores = {};
  if (!esFechaISO(desde)) errores.desde = 'Fecha "desde" inválida';
  if (!esFechaISO(hasta)) errores.hasta = 'Fecha "hasta" inválida';
  if (!errores.desde && !errores.hasta) {
    const dias = diasEntre(desde, hasta);
    if (dias < 0) errores.hasta = '"Hasta" no puede ser anterior a "desde"';
    else if (dias + 1 > config.maxDiasPeriodo) errores.hasta = `El período no puede superar ${config.maxDiasPeriodo} días`;
  }
  return { ok: Object.keys(errores).length === 0, errores, periodo: { desde, hasta } };
};

// ---------------------------------------------------------------------------
// Dinero (AC-COM-4, AC-COM-15)
// ---------------------------------------------------------------------------
// Pesos → centavos enteros. NaN / Infinity / no numérico => null.
const esEscalar = (v) => typeof v === 'number' || typeof v === 'string';

export const aCentavos = (v) => {
  if (!esEscalar(v)) return null;
  const n = toNum(v);
  if (n === null) return null;
  const s = n < 0 ? -1 : 1;
  // +1e-7: 1.005 * 100 = 100.49999999999999 en binario; así redondea a 101.
  const c = s * Math.round(Math.abs(n) * 100 + 1e-7);
  return Number.isSafeInteger(c) ? c : null;
};

export const deCentavos = (c) => (Number(c) === 0 ? 0 : Number(c) / 100);

// % válido entre 0 y 100 (acepta "10,5"). Fuera de rango / NaN / '' => null.
export const porcentajeValido = (v) => {
  if (!esEscalar(v)) return null;
  const n = toNum(v);
  if (n === null || n < 0 || n > 100) return null;
  return n;
};

// Porcentaje a "centésimos de punto" (10,5 % => 1050), entero.
const pctABase = (pct) => Math.round(pct * 100);

// round(a * b / d) half-up en enteros (simétrico para negativos).
const mulDivRedondeo = (a, b, d) => {
  const s = (a < 0) !== (b < 0) ? -1 : 1;
  const num = Math.abs(a) * Math.abs(b);
  const q = Math.floor(num / d);
  const r = num - q * d;
  return s * (r * 2 >= d ? q + 1 : q);
};

// Comisión de un pedido en centavos (uso interno) + aviso.
const comisionCentavos = (total, pct) => {
  const t = aCentavos(total);
  if (t === null || t < 0) return { cents: 0, aviso: 'total_invalido' };
  const p = porcentajeValido(pct);
  if (p === null) return { cents: 0, aviso: 'sin_pct' };
  return { cents: mulDivRedondeo(t, pctABase(p), 10000), aviso: null };
};

export const calcularComision = (total, pct) => {
  const { cents, aviso } = comisionCentavos(total, pct);
  return { comision: deCentavos(cents), aviso };
};

// Reparte un monto (pesos) según las partes de la asignación. La última parte
// se lleva el resto, así la suma da exacto al centavo.
const repartirCentavos = (cents, partes) => {
  const lista = Array.isArray(partes) ? partes : [];
  if (lista.length === 0) return [];
  let asignado = 0;
  return lista.map((p, i) => {
    const monto = i === lista.length - 1 ? cents - asignado : mulDivRedondeo(cents, pctABase(Number(p.pct)), 10000);
    asignado += monto;
    return { vendedor: p.vendedor, pct: Number(p.pct), montoCents: monto };
  });
};

export const repartirComision = (comision, asignacion) => {
  const c = aCentavos(comision);
  if (c === null || !asignacion || asignacion.modo === 'sin_comision') return [];
  return repartirCentavos(c, asignacion.partes).map(p => ({ vendedor: p.vendedor, pct: p.pct, monto: deCentavos(p.montoCents) }));
};

// ---------------------------------------------------------------------------
// REQ-COMR: aritmética exacta por renglón (AC-COMR-9). Criterio de redondeo:
//  1. precio del renglón al centavo (round half away from zero sobre el string
//     decimal, igual que round(numeric, 2) en Postgres): 1,005 -> 1,01.
//  2. subtotal = round(precioCents × cantidad) en centavos (el importe vendido,
//     como el total del pedido; NO es redondear la comisión).
//  3. comisión de un vendedor en un pedido = round( Σ subtotal × pct × división
//     / 10^8 ) — UN SOLO redondeo por pedido y por vendedor, con BigInt.
// La migración 005 hace exactamente la misma cuenta con numeric.
// ---------------------------------------------------------------------------
// S-COMR-05: largo acotado (misma regla que comision_rubro_base en la 005) para
// que un número patológico sea un renglón inválido y no un desborde.
const RE_DECIMAL = /^-?\d{1,12}(\.\d{1,20})?$/;
const RE_CANTIDAD = /^\d{1,9}(\.\d{1,6})?$/;
// Tope de la base de un pedido en centavos (la 005 usa el mismo tope: 10^11 pesos).
export const MAX_CENTAVOS_PEDIDO = 1e13;

// Representación decimal exacta de un number o string (sin exponente, sin coma).
const decimalTexto = (v) => {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null;
    const s = String(v);
    return /e/i.test(s) ? null : s;
  }
  return typeof v === 'string' ? v : null;
};

// round half away from zero de num / den (BigInt, den > 0).
const divRedondeoBig = (num, den) => {
  const neg = num < BigInt(0);
  const a = neg ? -num : num;
  let q = a / den;
  if ((a % den) * BigInt(2) >= den) q += BigInt(1);
  return neg ? -q : q;
};

const bigANumero = (b) => {
  const n = Number(b);
  return Number.isSafeInteger(n) ? n : null;
};

// Pesos (string decimal exacto) -> centavos enteros. Exponente, coma, NaN,
// objeto o null => null.
export const decimalACentavos = (v) => {
  const s = decimalTexto(v);
  if (s === null || !RE_DECIMAL.test(s)) return null;
  const neg = s[0] === '-';
  const [ent, frac = ''] = (neg ? s.slice(1) : s).split('.');
  const dig = `${ent}${(frac + '00').slice(0, 2)}`;
  let c = BigInt(dig);
  if (frac.length > 2 && Number(frac[2]) >= 5) c += BigInt(1);
  const n = bigANumero(neg ? -c : c);
  return n === 0 ? 0 : n;
};

// Cantidad del renglón como entero escalado: { q, escala } (q / 10^escala).
const cantidadEscalada = (v) => {
  const s = decimalTexto(v);
  if (s === null || !RE_CANTIDAD.test(s)) return null;
  const [ent, frac = ''] = s.split('.');
  const q = BigInt(`${ent}${frac}`);
  if (q <= BigInt(0)) return null;
  // Sin el operador ** (Babel lo pasa a Math.pow, que no acepta BigInt).
  let den = BigInt(1);
  for (let i = 0; i < frac.length; i += 1) den *= BigInt(10);
  return { q, den };
};

// Subtotal de un renglón en centavos. Los renglones `eliminado` (tachados en
// Armado) no cuentan y no son inválidos.
export const subtotalRenglonCentavos = (item) => {
  if (String(item?.eliminado) === 'true') return { cents: 0, valido: true, eliminado: true };
  const p = decimalACentavos(item?.precio);
  if (p === null || p < 0) return { cents: 0, valido: false };
  const c = cantidadEscalada(item?.cantidad);
  if (!c) return { cents: 0, valido: false };
  const cents = bigANumero(divRedondeoBig(BigInt(p) * c.q, c.den));
  if (cents === null) return { cents: 0, valido: false };
  return { cents, valido: true };
};

// Base de cálculo de un pedido agrupada por rubro (AC-COMR-9, 11).
// S9: un pedido sin renglones válidos y con total > 0 (p. ej. WEB sin items)
// cuenta como renglón inválido.
// REQ-REN (AC-REN-5): `extras` = renglones de comision congelados en las rendiciones vigentes
// del pedido ([{ rubroClave, rubro, subtotalCents }], negativos por devolucion/NC). Se suman por
// clave igual que comision_rubro_base de la 014. Sin extras el resultado es el de siempre.
export const baseRubrosPedido = (pedido, productosById, { extras = [] } = {}) => {
  const items = Array.isArray(pedido?.items) ? pedido.items : [];
  const porClave = new Map();
  const sinRubro = [];
  let invalidos = 0;
  let validos = 0;
  let acumulado = 0;
  for (const item of items) {
    const st = subtotalRenglonCentavos(item);
    if (st.eliminado) continue;
    // S-COMR-05: un renglón que haría desbordar la base del pedido es inválido
    // (comisiona 0 y el aviso identifica el pedido), no un fallo genérico.
    if (!st.valido || acumulado + st.cents > MAX_CENTAVOS_PEDIDO) { invalidos += 1; continue; }
    acumulado += st.cents;
    validos += 1;
    const r = rubroDeRenglon(item, productosById);
    if (!r.clave) {
      sinRubro.push({ productoId: item?.productoId ?? null, nombre: texto(item?.nombre, 160), subtotalCents: st.cents });
      continue;
    }
    if (!porClave.has(r.clave)) porClave.set(r.clave, { rubro: r.rubro, clave: r.clave, subtotalCents: 0 });
    porClave.get(r.clave).subtotalCents += st.cents;
  }
  if (validos === 0 && invalidos === 0 && (aCentavos(pedido?.total) || 0) > 0) invalidos = 1;
  for (const x of Array.isArray(extras) ? extras : []) {
    const cents = Number(x?.subtotalCents);
    if (!Number.isSafeInteger(cents) || cents === 0) continue;
    const clave = typeof x?.rubroClave === 'string' ? x.rubroClave : '';
    if (!clave) { sinRubro.push({ productoId: null, nombre: 'Rendición', subtotalCents: cents }); continue; }
    if (!porClave.has(clave)) porClave.set(clave, { rubro: texto(x?.rubro, 120), clave, subtotalCents: 0 });
    porClave.get(clave).subtotalCents += cents;
  }
  const porRubro = [...porClave.values()].sort((a, b) => (a.clave < b.clave ? -1 : a.clave > b.clave ? 1 : 0));
  return { porRubro, sinRubro, invalidos };
};

// Prorrateo por mayor resto (Hamilton): reparte `total` según `pesos` (BigInt)
// y suma exacto. Empate: gana el orden de la lista (clave alfabética).
const hamilton = (total, pesos) => {
  const W = pesos.reduce((a, p) => a + p, BigInt(0));
  if (W === BigInt(0) || total === 0) return pesos.map(() => 0);
  const neg = total < 0;
  const T = BigInt(Math.abs(total));
  const base = pesos.map(p => (T * p) / W);
  const restos = pesos.map((p, i) => ({ i, r: (T * p) % W }));
  let falta = Number(T - base.reduce((a, b) => a + b, BigInt(0)));
  restos.sort((a, b) => (a.r === b.r ? a.i - b.i : (a.r > b.r ? -1 : 1)));
  for (const { i } of restos) {
    if (falta <= 0) break;
    base[i] += BigInt(1);
    falta -= 1;
  }
  return base.map(b => (neg ? -Number(b) : Number(b)));
};

// Comisión de UNA parte (vendedor) sobre la base del pedido. pctPorClave(clave)
// devuelve el % del vendedor para ese rubro o null (sin % => 0 + aviso c1).
export const comisionParteRubro = ({ base, vendedorId = null, pctPorClave, divisionPct } = {}) => {
  const div = porcentajeValido(divisionPct);
  const divCent = div === null ? 0 : pctABase(div);
  const buscar = typeof pctPorClave === 'function' ? pctPorClave : () => null;
  const filas = [];
  const sinPct = [];
  let num = BigInt(0);
  for (const r of base?.porRubro || []) {
    const pctRaw = buscar(r.clave);
    const pct = pctRaw === null || pctRaw === undefined ? null : porcentajeValido(pctRaw);
    if (pct === null) {
      sinPct.push({ rubro: r.rubro, clave: r.clave, subtotalCents: mulDivRedondeo(r.subtotalCents, divCent, 10000) });
      filas.push({ r, pct: null, peso: BigInt(0) });
      continue;
    }
    const peso = BigInt(r.subtotalCents) * BigInt(pctABase(pct));
    num += peso * BigInt(divCent);
    filas.push({ r, pct: pctABase(pct) / 100, peso });
  }
  const montoCents = bigANumero(divRedondeoBig(num, BigInt(100000000))) || 0;
  const reparto = hamilton(montoCents, filas.map(f => f.peso));
  const desglose = filas.map((f, i) => ({
    rubro: f.r.rubro,
    rubroClave: f.r.clave,
    subtotal: deCentavos(f.r.subtotalCents),
    pct: f.pct,
    comision: deCentavos(reparto[i]),
  }));
  const sinRubroCents = (base?.sinRubro || []).reduce((a, s) => a + (Number(s.subtotalCents) || 0), 0);
  if ((base?.sinRubro || []).length) desglose.push({ rubro: '', rubroClave: '', subtotal: deCentavos(sinRubroCents), pct: null, comision: 0 });
  return { montoCents, desglose, sinPct, vendedorId };
};

// ---------------------------------------------------------------------------
// Identidades (pedido, cliente, vendedor)
// ---------------------------------------------------------------------------
export const pedidoIdComision = (pedido) =>
  (pedido?.remoteId === null || pedido?.remoteId === undefined || pedido?.remoteId === '' ? null : String(pedido.remoteId));

export const vendedorDeFicha = (cliente) => texto(cliente?.vendedor, MAX_NOMBRE) || null;
export const vendedorQueCargo = (pedido) => texto(pedido?.vendedor || pedido?.vendedorNombre, MAX_NOMBRE) || null;

const buscarVendedor = (nombre, vendedores) => {
  if (!nombre) return null;
  const k = claveUnica(nombre);
  return (vendedores || []).find(v => claveUnica(v?.nombre) === k) || null;
};

// Vendedor de la ficha "válido": existe en la lista (si la lista está cargada).
// Un nombre que ya no existe (renombrado/borrado) se trata como sin vendedor.
const fichaValida = (cliente, vendedores) => {
  const ficha = vendedorDeFicha(cliente);
  if (!ficha) return null;
  if (!vendedores || vendedores.length === 0) return ficha;
  const v = buscarVendedor(ficha, vendedores);
  return v ? texto(v.nombre, MAX_NOMBRE) : null;
};

export const buscarCliente = (pedido, clientes) => {
  const lista = clientes || [];
  if (pedido?.clienteId !== null && pedido?.clienteId !== undefined && pedido?.clienteId !== '') {
    const c = lista.find(x => String(x?.id) === String(pedido.clienteId));
    if (c) return { cliente: c, porNombre: false };
  }
  const k = claveUnica(pedido?.clienteNombre);
  if (!k) return { cliente: null, porNombre: false };
  const c = lista.find(x => claveUnica(x?.nombre) === k);
  return { cliente: c || null, porNombre: !!c };
};

export const esCargaDeOtroVendedor = (pedido, cliente, vendedores, config = CONFIG_COMISIONES) => {
  const ficha = fichaValida(cliente, vendedores);
  const cargo = vendedorQueCargo(pedido);
  if (!ficha || !cargo || claveUnica(ficha) === claveUnica(cargo)) return false;
  const v = buscarVendedor(cargo, vendedores);
  return !!v && config.rolesQueCuentanComoCargador.includes(Number(v.permiso));
};

// ---------------------------------------------------------------------------
// Asignación (AC-COM-7, AC-COM-8)
// ---------------------------------------------------------------------------
export const asignacionPorDefecto = (pedido, cliente, vendedores) => {
  const ficha = fichaValida(cliente, vendedores);
  if (!ficha) return { modo: null, partes: [] };
  return { modo: 'ficha', partes: [{ vendedor: ficha, pct: 100 }] };
};

const tieneMasDeDosDecimales = (n) => Math.abs(n * 100 - Math.round(n * 100)) > 1e-6;

export const validarAsignacion = (input, { pedido, cliente, vendedores } = {}, config = CONFIG_COMISIONES) => {
  const modo = input?.modo;
  const errores = {};
  const ficha = fichaValida(cliente, vendedores);
  const cargadorNombre = vendedorQueCargo(pedido);
  const cargador = buscarVendedor(cargadorNombre, vendedores);
  const fail = () => ({ ok: false, errores, asignacion: null });

  if (!MODOS_ASIGNACION.includes(modo)) { errores.modo = 'Modo de asignación inválido'; return fail(); }

  if (modo === 'sin_comision') return { ok: true, errores, asignacion: { modo, partes: [] } };

  if (modo === 'ficha') {
    if (!ficha) { errores.modo = 'El cliente no tiene vendedor en la ficha'; return fail(); }
    return { ok: true, errores, asignacion: { modo, partes: [{ vendedor: ficha, pct: 100 }] } };
  }

  if (modo === 'cargador') {
    if (!cargador) { errores.modo = 'El vendedor que cargó el pedido no existe en la lista'; return fail(); }
    return { ok: true, errores, asignacion: { modo, partes: [{ vendedor: texto(cargador.nombre, MAX_NOMBRE), pct: 100 }] } };
  }

  if (modo === 'otro') {
    const v = buscarVendedor(texto(input?.vendedor, MAX_NOMBRE), vendedores);
    if (!v) { errores.vendedor = 'Elegí un vendedor de la lista'; return fail(); }
    return { ok: true, errores, asignacion: { modo, partes: [{ vendedor: texto(v.nombre, MAX_NOMBRE), pct: 100 }] } };
  }

  // dividir
  if (!ficha || !cargador || claveUnica(ficha) === claveUnica(cargador.nombre)) {
    errores.modo = 'Para dividir tiene que haber vendedor de ficha y otro vendedor que cargó el pedido';
    return fail();
  }
  const vacio = (v) => v === undefined || v === null || v === '';
  const usarDefault = vacio(input?.pctFicha) && vacio(input?.pctCargador);
  const pf = usarDefault ? config.divisionPorDefecto[0] : porcentajeValido(input?.pctFicha);
  const pc = usarDefault ? config.divisionPorDefecto[1] : porcentajeValido(input?.pctCargador);
  if (pf === null || tieneMasDeDosDecimales(pf)) errores.pctFicha = '% inválido (0 a 100, hasta 2 decimales)';
  if (pc === null || tieneMasDeDosDecimales(pc)) errores.pctCargador = '% inválido (0 a 100, hasta 2 decimales)';
  if (Object.keys(errores).length) return fail();
  if (pctABase(pf) + pctABase(pc) !== 10000) { errores.suma = 'La suma tiene que dar 100 %'; return fail(); }
  return {
    ok: true,
    errores,
    asignacion: { modo, partes: [{ vendedor: ficha, pct: pf }, { vendedor: texto(cargador.nombre, MAX_NOMBRE), pct: pc }] },
  };
};

// ---------------------------------------------------------------------------
// Cierres vigentes y clasificación de pedidos (AC-COM-3, AC-COM-11)
// ---------------------------------------------------------------------------
const cierreOcupa = (c) => !!c && ESTADOS_QUE_CIERRAN.includes(c.estado);

export const renglonesDeCierre = (cierre) => (cierre?.lineas || []).map(l => ({
  pedidoId: String(l.pedidoId),
  tipo: l.tipo === 'ajuste' ? 'ajuste' : 'pedido',
  ajusteSeq: l.tipo === 'ajuste' ? Number(l.ajusteSeq || 0) : 0,
  total: Number(l.total || 0),
  comision: Number(l.comision || 0),
}));

// Map<pedidoId, cierreId> de los pedidos que ya están en un cierre vigente
// (o pendiente de confirmar por el servidor: conservador).
export const pedidosEnCierresVigentes = (cierres) => {
  const out = new Map();
  for (const c of cierres || []) {
    if (!cierreOcupa(c)) continue;
    for (const l of c.lineas || []) {
      if (l.tipo !== 'ajuste' && !out.has(String(l.pedidoId))) out.set(String(l.pedidoId), c.id);
    }
  }
  return out;
};

export const enRango = (fecha, periodo) => {
  const f = normalizePedidoFecha(fecha);
  return esFechaISO(f) && f >= periodo.desde && f <= periodo.hasta;
};

export const clasificarPedidos = (pedidos, periodo, cerrados = new Map(), config = CONFIG_COMISIONES) => {
  const out = { incluidos: [], noEntregados: [], sinSincronizar: [], yaCerrados: [] };
  const vistos = new Set();
  for (const p of pedidos || []) {
    if (!esFacturadoActivo(p)) continue;
    if (!enRango(p.fecha, periodo)) continue;
    const pid = pedidoIdComision(p);
    if (pid) {
      if (vistos.has(pid)) continue;
      vistos.add(pid);
    }
    if (pid && cerrados.has(pid)) out.yaCerrados.push(p);
    else if (!estaEntregado(p, config)) out.noEntregados.push(p);
    else if (!pid) out.sinSincronizar.push(p);
    else out.incluidos.push(p);
  }
  return out;
};

// ---------------------------------------------------------------------------
// REQ-REN (AC-REN-5): rendiciones (devolucion, cambio, NC) sobre la comision
// ---------------------------------------------------------------------------
const rendicionCuenta = (r) => !!r && r.estado === 'vigente' && r.syncEstado !== 'rechazada';

/**
 * Pedido con el total para comision neto de las rendiciones vigentes (total - creditoComision,
 * minimo 0, igual que _pedido_total_comision de la 014) y sus renglones de comision congelados
 * en `comisionExtras`. Sin rendiciones devuelve el MISMO objeto.
 */
export const pedidoNetoParaComision = (pedido, rendiciones = []) => {
  const pid = pedidoIdComision(pedido);
  if (!pid) return pedido;
  const propias = (Array.isArray(rendiciones) ? rendiciones : []).filter(r => rendicionCuenta(r) && String(r.pedidoId) === pid);
  if (!propias.length) return pedido;
  const credito = propias.reduce((a, r) => a + (Number(r.creditoComisionCents) || 0), 0);
  const totalCents = aCentavos(pedido?.total);
  const total = totalCents === null || totalCents < 0 ? pedido.total : deCentavos(Math.max(0, totalCents - credito));
  const extras = propias.flatMap(r => (Array.isArray(r.comisionRenglones) ? r.comisionRenglones : []));
  return { ...pedido, total, comisionExtras: extras };
};

export const netearPedidosComision = (pedidos, rendiciones = []) => {
  if (!Array.isArray(rendiciones) || !rendiciones.length || !Array.isArray(pedidos)) return pedidos;
  return pedidos.map(p => pedidoNetoParaComision(p, rendiciones));
};

// ---------------------------------------------------------------------------
// Líneas del dashboard
// ---------------------------------------------------------------------------
const conPartes = (cents, totalCents, asignacion) => {
  if (!asignacion || !asignacion.modo || asignacion.modo === 'sin_comision') return [];
  const com = repartirCentavos(cents, asignacion.partes);
  const tot = repartirCentavos(totalCents, asignacion.partes);
  return com.map((p, i) => ({ vendedor: p.vendedor, pct: p.pct, monto: deCentavos(p.montoCents), total: deCentavos(tot[i].montoCents) }));
};

// Asignación vigente de un pedido (default de la ficha o la del borrador).
// La comparten el modelo 'cliente' y el modelo 'rubro' (AC-COM-7/8/17 sin cambios).
const resolverAsignacion = (pedido, cliente, vendedores, asignacionBorrador, config) => {
  let asignacion = asignacionPorDefecto(pedido, cliente, vendedores);
  let asignacionErrores = null;
  let asignacionConfirmada = false;
  if (asignacionBorrador) {
    const v = validarAsignacion(asignacionBorrador, { pedido, cliente, vendedores }, config);
    if (v.ok) asignacion = v.asignacion;
    else { asignacionErrores = v.errores; asignacion = { modo: null, partes: [] }; }
    // AC-COM-17: solo cuenta como confirmada si la asignación sigue siendo
    // válida hoy (p.ej. un vendedor borrado la vuelve pendiente). Borradores
    // viejos sin la marca => no confirmada.
    asignacionConfirmada = asignacionBorrador.confirmada === true && v.ok;
  }
  return { asignacion, asignacionErrores, asignacionConfirmada };
};

export const armarLinea = (pedido, { clientes, vendedores, asignacionBorrador = null } = {}, config = CONFIG_COMISIONES) => {
  const { cliente, porNombre } = buscarCliente(pedido, clientes);
  const pct = porcentajeValido(cliente?.comision);
  const { cents, aviso } = comisionCentavos(pedido?.total, pct);
  const totalCents = aCentavos(pedido?.total);
  const totalOk = totalCents !== null && totalCents >= 0 ? totalCents : 0;
  const ficha = fichaValida(cliente, vendedores);
  const cargaDeOtro = esCargaDeOtroVendedor(pedido, cliente, vendedores, config);
  const { asignacion, asignacionErrores, asignacionConfirmada } = resolverAsignacion(pedido, cliente, vendedores, asignacionBorrador, config);

  return {
    tipo: 'pedido',
    pedidoId: pedidoIdComision(pedido),
    localId: pedido?.id ?? null,
    fecha: normalizePedidoFecha(pedido?.fecha),
    clienteId: cliente?.id ?? pedido?.clienteId ?? null,
    clienteNombre: texto(cliente?.nombre || pedido?.clienteNombre, 120),
    clientePorNombre: porNombre,
    cargadoPor: vendedorQueCargo(pedido),
    vendedorFicha: ficha,
    pct,
    total: deCentavos(totalOk),
    comision: deCentavos(cents),
    aviso, // null | 'sin_pct' | 'total_invalido'
    cargaDeOtro, // aviso (a)
    sinVendedor: !ficha, // aviso (b)
    asignacion,
    asignacionErrores,
    asignacionEditada: !!asignacionBorrador,
    asignacionConfirmada, // AC-COM-17: no viaja al cierre (lineaCongelada no la copia)
    partes: conPartes(cents, totalOk, asignacion),
  };
};

// ---------------------------------------------------------------------------
// REQ-COMR: línea del dashboard con el modelo por vendedor y rubro.
// Misma forma que armarLinea + modelo:'rubro', pct:null, partes[].vendedorId,
// partes[].desglose, comisionUnica y avisosRubro.
// ---------------------------------------------------------------------------
const pctPorClaveDe = (indiceTabla, vendedorId) => (clave) => (vendedorId ? pctDe(indiceTabla, vendedorId, clave) : null);

export const armarLineaRubro = (pedido, { clientes, vendedores, productosById, indiceTabla, asignacionBorrador = null } = {}, config = CONFIG_COMISIONES) => {
  const { cliente, porNombre } = buscarCliente(pedido, clientes);
  const totalCents = aCentavos(pedido?.total);
  const totalOk = totalCents !== null && totalCents >= 0 ? totalCents : 0;
  const ficha = fichaValida(cliente, vendedores);
  const cargaDeOtro = esCargaDeOtroVendedor(pedido, cliente, vendedores, config);
  const { asignacion, asignacionErrores, asignacionConfirmada } = resolverAsignacion(pedido, cliente, vendedores, asignacionBorrador, config);
  const sinComision = asignacion?.modo === 'sin_comision';
  const base = baseRubrosPedido(pedido, productosById, { extras: pedido?.comisionExtras });

  const avisosRubro = { sinPct: [], sinRubro: sinComision ? [] : base.sinRubro, vendedorSinId: [], invalidos: sinComision ? 0 : base.invalidos };
  let partes = [];
  let comisionCents = 0;
  if (asignacion?.modo && !sinComision) {
    const tot = repartirCentavos(totalOk, asignacion.partes);
    partes = (asignacion.partes || []).map((p, i) => {
      const vendedorId = vendedorIdPorNombre(p.vendedor, vendedores);
      if (!vendedorId) avisosRubro.vendedorSinId.push(p.vendedor);
      const c = comisionParteRubro({ base, vendedorId, pctPorClave: pctPorClaveDe(indiceTabla, vendedorId), divisionPct: p.pct });
      if (vendedorId) {
        for (const s of c.sinPct) avisosRubro.sinPct.push({ vendedor: p.vendedor, vendedorId, rubro: s.rubro, clave: s.clave, subtotalCents: s.subtotalCents });
      }
      comisionCents += c.montoCents;
      return { vendedor: p.vendedor, vendedorId, pct: Number(p.pct), monto: deCentavos(c.montoCents), total: deCentavos(tot[i].montoCents), desglose: c.desglose };
    });
  }

  return {
    tipo: 'pedido',
    modelo: 'rubro',
    pedidoId: pedidoIdComision(pedido),
    localId: pedido?.id ?? null,
    fecha: normalizePedidoFecha(pedido?.fecha),
    clienteId: cliente?.id ?? pedido?.clienteId ?? null,
    clienteNombre: texto(cliente?.nombre || pedido?.clienteNombre, 120),
    clientePorNombre: porNombre,
    cargadoPor: vendedorQueCargo(pedido),
    vendedorFicha: ficha,
    pct: null,
    total: deCentavos(totalOk),
    // Suma técnica de las partes (servidor y totales). En pedidos divididos NO
    // se muestra como "comisión del pedido" (AC-COMR-10): comisionUnica=false.
    comision: deCentavos(comisionCents),
    comisionUnica: asignacion?.modo !== 'dividir',
    aviso: totalCents === null || totalCents < 0 ? 'total_invalido' : null,
    cargaDeOtro,
    sinVendedor: !ficha,
    asignacion,
    asignacionErrores,
    asignacionEditada: !!asignacionBorrador,
    asignacionConfirmada,
    avisosRubro,
    partes,
  };
};

// ---------------------------------------------------------------------------
// Ajustes pendientes (AC-COM-13)
// ---------------------------------------------------------------------------
// REQ-COMR (AC-COMR-14): acumulado ya cerrado por vendedor y por rubro de un
// pedido (base + ajustes vigentes). Clave del vendedor: vendedorId (o nombre).
const claveParte = (p) => (p?.vendedorId ? `id:${p.vendedorId}` : `n:${claveUnica(p?.vendedor)}`);
const acumularPartes = (acc, partes) => {
  for (const p of partes || []) {
    const k = claveParte(p);
    if (!acc.has(k)) acc.set(k, { montoCents: 0, rubros: new Map() });
    const a = acc.get(k);
    a.montoCents += aCentavos(p.monto) || 0;
    for (const d of p.desglose || []) {
      const rk = String(d?.rubroClave ?? '');
      if (!a.rubros.has(rk)) a.rubros.set(rk, { rubro: d?.rubro ?? '', subtotalCents: 0, comisionCents: 0 });
      const r = a.rubros.get(rk);
      r.subtotalCents += aCentavos(d?.subtotal) || 0;
      r.comisionCents += aCentavos(d?.comision) || 0;
    }
  }
};

// Ajuste de un pedido cerrado con el modelo 'rubro': se recalcula con los ítems
// actuales, la MISMA asignación congelada y el % congelado por rubro (un rubro
// que no estaba en el cierre usa el % vigente: supuesto S6).
const ajusteRubro = (l, pedido, prev, sigueContando, ctx) => {
  const asignacion = l.asignacion || { modo: null, partes: [] };
  const base = sigueContando ? baseRubrosPedido(pedido, ctx.productosById, { extras: pedido?.comisionExtras }) : { porRubro: [], sinRubro: [], invalidos: 0 };
  const cerrado = new Map();
  acumularPartes(cerrado, l.partes);
  acumularPartes(cerrado, prev.partes);
  const totalActualCents = sigueContando ? Math.max(0, aCentavos(pedido.total) || 0) : 0;
  const cerradoTotalCents = (aCentavos(l.total) || 0) + prev.sumaTotalCents;
  const difTotal = totalActualCents - cerradoTotalCents;
  const tot = repartirCentavos(difTotal, l.partes || []);
  let actualCents = 0;
  let difCents = 0;
  const partes = (l.partes || []).map((p, i) => {
    const vendedorId = p.vendedorId || vendedorIdPorNombre(p.vendedor, ctx.vendedores);
    const congelado = new Map((p.desglose || []).filter(d => d?.rubroClave).map(d => [String(d.rubroClave), d.pct]));
    const pctPorClave = (clave) => (congelado.has(clave) ? congelado.get(clave) : pctPorClaveDe(ctx.indiceTabla, vendedorId)(clave));
    const c = comisionParteRubro({ base, vendedorId, pctPorClave, divisionPct: p.pct });
    const prevV = cerrado.get(claveParte(p)) || { montoCents: 0, rubros: new Map() };
    const dif = c.montoCents - prevV.montoCents;
    actualCents += c.montoCents;
    difCents += dif;
    const claves = new Set([...c.desglose.map(d => d.rubroClave), ...prevV.rubros.keys()]);
    const desglose = [...claves].sort().map(k => {
      const act = c.desglose.find(d => d.rubroClave === k);
      const ant = prevV.rubros.get(k) || { rubro: '', subtotalCents: 0, comisionCents: 0 };
      return {
        rubro: act ? act.rubro : ant.rubro,
        rubroClave: k,
        subtotal: deCentavos((act ? aCentavos(act.subtotal) : 0) - ant.subtotalCents),
        pct: act ? act.pct : (congelado.has(k) ? congelado.get(k) : null),
        comision: deCentavos((act ? aCentavos(act.comision) : 0) - ant.comisionCents),
      };
    }).filter(d => d.subtotal !== 0 || d.comision !== 0);
    return { vendedor: p.vendedor, vendedorId, pct: Number(p.pct), monto: deCentavos(dif), total: deCentavos(tot[i]?.montoCents || 0), desglose };
  });
  if (difCents === 0 && difTotal === 0 && partes.every(p => p.monto === 0)) return null;
  return {
    tipo: 'ajuste',
    modelo: 'rubro',
    pedidoId: String(l.pedidoId),
    localId: pedido.id ?? null,
    ajusteDeCierreId: l.cierreId,
    ajusteSeq: prev.maxSeq + 1,
    fecha: l.fecha,
    clienteId: l.clienteId ?? null,
    clienteNombre: l.clienteNombre,
    pct: null,
    comisionCerrada: deCentavos((aCentavos(l.comision) || 0) + prev.sumaCents),
    comisionActual: deCentavos(actualCents),
    diferencia: deCentavos(difCents),
    total: deCentavos(difTotal),
    comision: deCentavos(difCents),
    comisionUnica: asignacion.modo !== 'dividir',
    motivo: !sigueContando ? 'ya_no_cuenta' : 'total_cambio',
    asignacion,
    partes,
  };
};

// ctx = { productosById, indiceTabla, vendedores }: solo hace falta para bases
// con modelo 'rubro'. Con base 'cliente' el resultado es idéntico al de antes
// (diferencia de total × % congelado): el cambio de modelo no genera ajustes.
export const calcularAjustesPendientes = (pedidos, cierres, config = CONFIG_COMISIONES, ctx = {}) => {
  const base = new Map(); // pid -> línea congelada del pedido
  const ajustes = new Map(); // pid -> { sumaCents, sumaTotalCents, maxSeq, partes }
  for (const c of cierres || []) {
    if (!cierreOcupa(c)) continue;
    for (const l of c.lineas || []) {
      const pid = String(l.pedidoId);
      if (l.tipo === 'ajuste') {
        const a = ajustes.get(pid) || { sumaCents: 0, sumaTotalCents: 0, maxSeq: 0, partes: [] };
        a.sumaCents += aCentavos(l.comision) || 0;
        a.sumaTotalCents += aCentavos(l.total) || 0;
        a.maxSeq = Math.max(a.maxSeq, Number(l.ajusteSeq || 0));
        a.partes.push(...(Array.isArray(l.partes) ? l.partes : []));
        ajustes.set(pid, a);
      } else if (!base.has(pid)) {
        base.set(pid, { ...l, cierreId: c.id });
      }
    }
  }

  const porRemoto = new Map();
  for (const p of pedidos || []) {
    const pid = pedidoIdComision(p);
    if (pid && !porRemoto.has(pid)) porRemoto.set(pid, p);
  }

  const out = [];
  for (const [pid, l] of base) {
    const pedido = porRemoto.get(pid);
    if (!pedido) continue; // sin datos locales: no se puede saber si cambió
    if (l.asignacion?.modo === 'sin_comision') continue;
    const prev = ajustes.get(pid) || { sumaCents: 0, sumaTotalCents: 0, maxSeq: 0, partes: [] };
    const sigueContando = esFacturadoActivo(pedido) && estaEntregado(pedido, config);
    if (l.modelo === 'rubro') {
      const a = ajusteRubro(l, pedido, prev, sigueContando, ctx || {});
      if (a) out.push(a);
      continue;
    }
    const cerradoCents = (aCentavos(l.comision) || 0) + prev.sumaCents;
    const cerradoTotalCents = (aCentavos(l.total) || 0) + prev.sumaTotalCents;
    const actual = sigueContando ? comisionCentavos(pedido.total, l.pct) : { cents: 0 };
    const totalActualCents = sigueContando ? Math.max(0, aCentavos(pedido.total) || 0) : 0;
    const dif = actual.cents - cerradoCents;
    const difTotal = totalActualCents - cerradoTotalCents;
    if (dif === 0 && difTotal === 0) continue;
    const asignacion = l.asignacion || { modo: null, partes: [] };
    out.push({
      tipo: 'ajuste',
      pedidoId: pid,
      localId: pedido.id ?? null,
      ajusteDeCierreId: l.cierreId,
      ajusteSeq: prev.maxSeq + 1,
      fecha: l.fecha,
      clienteId: l.clienteId ?? null,
      clienteNombre: l.clienteNombre,
      pct: l.pct,
      comisionCerrada: deCentavos(cerradoCents),
      comisionActual: deCentavos(actual.cents),
      diferencia: deCentavos(dif),
      total: deCentavos(difTotal),
      comision: deCentavos(dif),
      motivo: !sigueContando ? 'ya_no_cuenta' : 'total_cambio',
      asignacion,
      partes: conPartes(dif, difTotal, asignacion),
    });
  }
  return out.sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)) || a.pedidoId.localeCompare(b.pedidoId));
};

// ---------------------------------------------------------------------------
// Avisos (AC-COM-6)
// ---------------------------------------------------------------------------
const distintosPorCliente = (lineas) => {
  const m = new Map();
  for (const l of lineas) {
    const k = l.clienteId !== null && l.clienteId !== undefined ? `id:${l.clienteId}` : `n:${claveUnica(l.clienteNombre)}`;
    if (!m.has(k)) m.set(k, { clienteId: l.clienteId, clienteNombre: l.clienteNombre, pedidos: 0 });
    m.get(k).pedidos += 1;
  }
  return [...m.values()];
};

export const calcularAvisos = (lineas, noEntregados = [], sinSincronizar = []) => {
  const ls = lineas || [];
  // AC-COM-17: los pedidos con asignación confirmada no cuentan en (a) ni (b).
  // (b) cuenta clientes distintos: un cliente sale del aviso recién cuando
  // TODOS sus pedidos del período están confirmados.
  const cargadoPorOtro = ls.filter(l => l.cargaDeOtro && !l.asignacionConfirmada);
  const clienteSinVendedor = distintosPorCliente(ls.filter(l => l.sinVendedor && !l.asignacionConfirmada));
  const clienteSinPct = distintosPorCliente(ls.filter(l => l.aviso === 'sin_pct'));
  const montoInvalido = ls.filter(l => l.aviso === 'total_invalido');
  const contadores = {
    a: cargadoPorOtro.length,
    b: clienteSinVendedor.length,
    c: clienteSinPct.length,
    d: (noEntregados || []).length,
    sinSincronizar: (sinSincronizar || []).length,
    montoInvalido: montoInvalido.length,
  };
  contadores.total = contadores.a + contadores.b + contadores.c + contadores.d + contadores.sinSincronizar + contadores.montoInvalido;
  const rubro = avisosDeRubro(ls);
  // Los contadores nuevos solo aparecen si hay líneas del modelo 'rubro' (la
  // salida del modelo viejo queda idéntica).
  if (ls.some(l => l?.modelo === 'rubro')) {
    contadores.c1 = rubro.vendedorSinPctRubro.length;
    contadores.c2 = rubro.productosSinRubro.length;
    contadores.vendedorSinId = rubro.vendedorSinSincronizar.length;
    contadores.renglonInvalido = rubro.renglonInvalido.length;
    contadores.total += contadores.c1 + contadores.c2 + contadores.vendedorSinId + contadores.renglonInvalido;
  }
  return { cargadoPorOtro, clienteSinVendedor, clienteSinPct, montoInvalido, noEntregados: noEntregados || [], sinSincronizar: sinSincronizar || [], ...rubro, contadores };
};

// AC-COMR-11: (c1) vendedor sin % para un rubro (por vendedor + rubro, con
// pedidos y monto afectado: en pedidos divididos, la parte de ese vendedor) y
// (c2) productos sin rubro vendidos. Más: vendedor sin sincronizar y renglones
// inválidos (comisionan 0).
function avisosDeRubro(lineas) {
  const c1 = new Map();
  const c2 = new Map();
  const sinId = new Map();
  const invalidos = [];
  for (const l of lineas) {
    const a = l?.avisosRubro;
    if (!a) continue;
    for (const s of a.sinPct || []) {
      const k = `${s.vendedorId}|${s.clave}`;
      if (!c1.has(k)) c1.set(k, { vendedor: s.vendedor, vendedorId: s.vendedorId, rubro: s.rubro, clave: s.clave, pedidos: new Set(), cents: 0 });
      const x = c1.get(k);
      x.pedidos.add(String(l.pedidoId));
      x.cents += Number(s.subtotalCents) || 0;
    }
    for (const s of a.sinRubro || []) {
      const k = s.productoId !== null && s.productoId !== undefined ? `id:${s.productoId}` : `n:${claveUnica(s.nombre)}`;
      if (!c2.has(k)) c2.set(k, { productoId: s.productoId ?? null, nombre: s.nombre, renglones: 0, cents: 0 });
      const x = c2.get(k);
      x.renglones += 1;
      x.cents += Number(s.subtotalCents) || 0;
    }
    for (const v of a.vendedorSinId || []) {
      const k = claveUnica(v);
      if (!sinId.has(k)) sinId.set(k, { vendedor: v, pedidos: 0 });
      sinId.get(k).pedidos += 1;
    }
    if (a.invalidos > 0) invalidos.push({ pedidoId: l.pedidoId, clienteNombre: l.clienteNombre, renglones: a.invalidos });
  }
  const orden = (a, b) => String(a).localeCompare(String(b), 'es');
  return {
    vendedorSinPctRubro: [...c1.values()]
      .map(({ pedidos, cents, ...x }) => ({ ...x, pedidos: pedidos.size, montoAfectado: deCentavos(cents) }))
      .sort((a, b) => orden(a.vendedor, b.vendedor) || orden(a.clave, b.clave)),
    productosSinRubro: [...c2.values()]
      .map(({ cents, ...x }) => ({ ...x, monto: deCentavos(cents) }))
      .sort((a, b) => orden(a.nombre, b.nombre)),
    vendedorSinSincronizar: [...sinId.values()],
    renglonInvalido: invalidos,
  };
}

// ---------------------------------------------------------------------------
// Resumen por vendedor (AC-COM-5)
// ---------------------------------------------------------------------------
export const resumirPorVendedor = (lineas, ajustes = []) => {
  const porV = new Map();
  for (const l of [...(lineas || []), ...(ajustes || [])]) {
    for (const parte of l.partes || []) {
      const k = claveUnica(parte.vendedor);
      if (!porV.has(k)) porV.set(k, { vendedor: parte.vendedor, pedidos: new Set(), clientes: new Map(), vendidoCents: 0, comisionCents: 0 });
      const acc = porV.get(k);
      if (l.tipo !== 'ajuste') acc.pedidos.add(l.pedidoId);
      const ck = l.clienteId !== null && l.clienteId !== undefined ? `id:${l.clienteId}` : `n:${claveUnica(l.clienteNombre)}`;
      if (!acc.clientes.has(ck)) acc.clientes.set(ck, { clienteId: l.clienteId ?? null, clienteNombre: l.clienteNombre, pedidos: [], cuentaComoCliente: false });
      const cli = acc.clientes.get(ck);
      if (l.tipo !== 'ajuste') cli.cuentaComoCliente = true;
      acc.vendidoCents += aCentavos(parte.total) || 0;
      acc.comisionCents += aCentavos(parte.monto) || 0;
      const esRubro = l.modelo === 'rubro';
      cli.pedidos.push({
        pedidoId: l.pedidoId,
        tipo: l.tipo,
        fecha: l.fecha,
        total: parte.total,
        totalPedido: l.total,
        pct: l.pct,
        comision: parte.monto,
        // AC-COMR-10: en un pedido dividido con el modelo por rubro no hay una
        // "comisión del pedido" única (cada vendedor aplica su tabla).
        comisionPedido: esRubro && l.asignacion?.modo === 'dividir' ? null : l.comision,
        asignacion: l.asignacion?.modo || null,
        division: parte.pct,
        ...(esRubro ? { modelo: 'rubro', vendedorId: parte.vendedorId ?? null, desglose: parte.desglose || [] } : {}),
        ...(l.tipo === 'ajuste' ? { ajusteSeq: l.ajusteSeq, ajusteDeCierreId: l.ajusteDeCierreId } : {}),
      });
    }
  }
  return [...porV.values()]
    .map(v => ({
      vendedor: v.vendedor,
      pedidos: v.pedidos.size,
      clientes: [...v.clientes.values()].filter(c => c.cuentaComoCliente).length,
      totalVendido: deCentavos(v.vendidoCents),
      totalComision: deCentavos(v.comisionCents),
      detalle: [...v.clientes.values()]
        .map(({ cuentaComoCliente, ...c }) => ({ ...c, pedidos: c.pedidos.sort((a, b) => String(a.fecha).localeCompare(String(b.fecha))) }))
        .sort((a, b) => String(a.clienteNombre).localeCompare(String(b.clienteNombre), 'es')),
    }))
    .sort((a, b) => String(a.vendedor).localeCompare(String(b.vendedor), 'es'));
};

// ---------------------------------------------------------------------------
// Dashboard completo
// ---------------------------------------------------------------------------
// Map<String(id), producto> para resolver el rubro actual de renglones viejos.
export const indexarProductos = (productos) => {
  const m = new Map();
  for (const p of Array.isArray(productos) ? productos : []) {
    if (p && typeof p === 'object' && p.id !== null && p.id !== undefined && !m.has(String(p.id))) m.set(String(p.id), p);
  }
  return m;
};

// modelo: 'rubro' (REQ-COMR, lo que mandan los servicios) o, si falta,
// 'cliente' (compatibilidad: salida idéntica a la de REQ-COM).
export const armarDashboard = ({
  pedidos, clientes, vendedores, cierres, borrador, periodo,
  modelo, productos, tablaRubros, pendientesRubro = 0, faltaMigracion005 = false,
  rendiciones = [],
}, config = CONFIG_COMISIONES) => {
  const vp = validarPeriodo(periodo, config);
  // REQ-REN (AC-REN-5): total y base de cada pedido netos de sus rendiciones vigentes y
  // confirmadas. Pedido no cerrado => baja la linea; cerrado => aparece como ajuste.
  pedidos = netearPedidosComision(pedidos, rendiciones);
  const cerrados = pedidosEnCierresVigentes(cierres);
  const clas = vp.ok
    ? clasificarPedidos(pedidos, vp.periodo, cerrados, config)
    : { incluidos: [], noEntregados: [], sinSincronizar: [], yaCerrados: [] };
  const asign = borrador?.asignaciones || {};
  const esRubro = modelo === 'rubro';
  const productosById = indexarProductos(productos);
  const indiceTabla = indexarTablaRubros(tablaRubros);
  const lineas = clas.incluidos
    .map(p => (esRubro
      ? armarLineaRubro(p, { clientes, vendedores, productosById, indiceTabla, asignacionBorrador: asign[pedidoIdComision(p)] || null }, config)
      : armarLinea(p, { clientes, vendedores, asignacionBorrador: asign[pedidoIdComision(p)] || null }, config)))
    .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)) || String(a.clienteNombre).localeCompare(String(b.clienteNombre), 'es'));
  const ajustes = calcularAjustesPendientes(pedidos, cierres, config, { productosById, indiceTabla, vendedores });
  const avisos = calcularAvisos(lineas, clas.noEntregados, clas.sinSincronizar);
  const resumenPorVendedor = resumirPorVendedor(lineas, ajustes);
  const sumC = (arr, k) => arr.reduce((acc, x) => acc + (aCentavos(x[k]) || 0), 0);
  const totales = {
    pedidos: lineas.length,
    clientes: distintosPorCliente(lineas).length,
    totalVendido: deCentavos(sumC(lineas, 'total')),
    totalComision: deCentavos(sumC(resumenPorVendedor, 'totalComision')),
    ajustes: ajustes.length,
    totalAjustes: deCentavos(sumC(ajustes, 'diferencia')),
  };
  return {
    periodo: vp.periodo,
    periodoValido: vp.ok,
    erroresPeriodo: vp.errores,
    lineas,
    ajustes,
    avisos,
    resumenPorVendedor,
    totales,
    noEntregados: clas.noEntregados,
    sinSincronizar: clas.sinSincronizar,
    yaCerrados: clas.yaCerrados,
    ...(esRubro ? { modelo: 'rubro', pendientesRubro: Number(pendientesRubro) || 0, faltaMigracion005: !!faltaMigracion005 } : {}),
  };
};

// Huella del dashboard para detectar si cambió entre lo que vio el admin y lo
// que se recalculó con datos frescos justo antes de confirmar. REQ-COMR: con
// el modelo por rubro incluye el vendedorId y el monto de cada parte (un
// cambio de % invalida la confirmación).
const firmaParte = (p) => (p?.vendedorId !== undefined ? [p.vendedor, p.monto, p.vendedorId] : [p.vendedor, p.monto]);
export const firmaDashboard = (d) => JSON.stringify({
  l: (d?.lineas || []).map(l => [l.pedidoId, l.comision, l.total, (l.partes || []).map(firmaParte)]),
  a: (d?.ajustes || []).map(a => (a.modelo === 'rubro'
    ? [a.pedidoId, a.ajusteSeq, a.diferencia, (a.partes || []).map(firmaParte)]
    : [a.pedidoId, a.ajusteSeq, a.diferencia])),
});

// ---------------------------------------------------------------------------
// Cierre (AC-COM-8, 10, 11, 12)
// ---------------------------------------------------------------------------
export const puedeCerrar = (d) => {
  const motivos = [];
  if (!d?.periodoValido) motivos.push('El período no es válido');
  const lineas = d?.lineas || [];
  const sinAsignar = lineas.filter(l => !l.asignacion?.modo && !l.asignacionErrores);
  const invalidas = lineas.filter(l => l.asignacionErrores);
  if (sinAsignar.length) motivos.push(`${sinAsignar.length} pedido(s) de clientes sin vendedor: asigná la comisión a un vendedor o marcala "sin comisión"`);
  if (invalidas.length) motivos.push(`${invalidas.length} asignación(es) inválida(s): revisá las divisiones`);
  const sinSync = (d?.sinSincronizar || []).length;
  if (sinSync) motivos.push(`${sinSync} pedido(s) sin sincronizar: sincronizá antes de cerrar`);
  // REQ-COMR (AC-COMR-7/8): sin el id remoto del vendedor no hay tabla de %, y
  // sin la 005 (o con % sin subir) el servidor no puede verificar el cierre.
  const sinIdVend = lineas.filter(l => (l.avisosRubro?.vendedorSinId || []).length > 0);
  if (sinIdVend.length) motivos.push(`${sinIdVend.length} pedido(s) con un vendedor sin sincronizar: sincronizá los vendedores antes de cerrar`);
  if (d?.faltaMigracion005) motivos.push('Falta la migración 005 en Supabase: no se puede cerrar con comisiones por rubro');
  if (Number(d?.pendientesRubro) > 0) motivos.push(`Hay ${Number(d.pendientesRubro)} % de comisión sin sincronizar: sincronizá los % antes de cerrar`);
  if (lineas.length === 0 && (d?.ajustes || []).length === 0) motivos.push('No hay pedidos ni ajustes para cerrar en este período');
  return { ok: motivos.length === 0, motivos };
};

const copia = (x) => JSON.parse(JSON.stringify(x ?? null));

// AC-COMR-13: las líneas del modelo 'rubro' congelan además, por parte,
// vendedorId y el desglose por rubro (subtotal, %, comisión) — viajan dentro
// de `partes`, que se copia entera.
const lineaCongelada = (l) => ({
  ...(l.modelo === 'rubro' ? { modelo: 'rubro' } : {}),
  tipo: l.tipo,
  pedidoId: String(l.pedidoId),
  fecha: l.fecha,
  clienteId: l.clienteId ?? null,
  clienteNombre: l.clienteNombre,
  cargadoPor: l.cargadoPor ?? null,
  vendedorFicha: l.vendedorFicha ?? null,
  total: l.total,
  pct: l.pct,
  comision: l.comision,
  asignacion: copia(l.asignacion),
  partes: copia(l.partes),
  ...(l.tipo === 'ajuste'
    ? { ajusteSeq: l.ajusteSeq, ajusteDeCierreId: l.ajusteDeCierreId, comisionCerrada: l.comisionCerrada, comisionActual: l.comisionActual }
    : { ajusteSeq: 0 }),
});

export const construirCierre = (d, { admin, now = new Date(), genId = nuevoId } = {}) => {
  const chk = puedeCerrar(d);
  if (!chk.ok) throw new Error(chk.motivos.join(' · '));
  const cerradoPor = texto(admin, MAX_NOMBRE);
  if (!cerradoPor) throw new Error('Falta el admin que cierra');
  const resumen = copia(d.resumenPorVendedor);
  const ts = now instanceof Date ? now.getTime() : Number(now);
  return {
    id: genId(),
    desde: d.periodo.desde,
    hasta: d.periodo.hasta,
    cerradoAt: ts,
    cerradoPor,
    estado: 'pendiente',
    anuladoAt: null,
    anuladoPor: null,
    motivoAnulacion: null,
    totales: {
      ...copia(d.totales),
      porVendedor: resumen.map(v => ({ vendedor: v.vendedor, pedidos: v.pedidos, clientes: v.clientes, totalVendido: v.totalVendido, totalComision: v.totalComision })),
    },
    detalle: resumen.map(v => ({ vendedor: v.vendedor, totalVendido: v.totalVendido, totalComision: v.totalComision, clientes: v.detalle })),
    lineas: [...d.lineas, ...d.ajustes].map(lineaCongelada),
    ...(d.modelo === 'rubro' ? { modelo: 'rubro' } : {}),
    createdAt: ts,
    updatedAt: ts,
  };
};

// AC-COMR-13: 'rubro' si el cierre (o alguna de sus líneas) lo dice; si no,
// 'cliente' (cierres viejos sin el campo).
export const modeloDeCierre = (c) => {
  if (c?.modelo === 'rubro') return 'rubro';
  return (Array.isArray(c?.lineas) ? c.lineas : []).some(l => l?.modelo === 'rubro') ? 'rubro' : 'cliente';
};

export const validarAnulacion = (cierre, motivo, usuario, now = Date.now()) => {
  const errores = {};
  const m = texto(motivo, 10000);
  if (m.length < MIN_MOTIVO) errores.motivo = 'El motivo es obligatorio (mínimo 3 caracteres)';
  else if (m.length > MAX_MOTIVO) errores.motivo = `El motivo no puede superar ${MAX_MOTIVO} caracteres`;
  const por = texto(usuario, MAX_NOMBRE);
  if (!por) errores.usuario = 'Falta el usuario que anula';
  if (!cierre || cierre.estado !== 'vigente') errores.estado = 'Solo se puede anular un cierre vigente';
  else if (cierre.anulacionPendiente) errores.estado = 'La anulación de este cierre ya está en curso';
  if (Object.keys(errores).length) return { ok: false, errores, patch: null };
  return { ok: true, errores, patch: { estado: 'anulado', anuladoAt: now, anuladoPor: por, motivoAnulacion: m } };
};

// C2 (AC-COM-12, RUN 20261012-2106): estado del botón "Confirmar anulación" y
// texto de ayuda visible mientras está deshabilitado. Usa la MISMA
// normalización (texto()) y los mismos MIN_MOTIVO / MAX_MOTIVO que
// validarAnulacion, para que la UI y el dominio no se contradigan.
// Solo strings y números cuentan como texto: un objeto o null es "vacío".
const textoPlano = (v) => (typeof v === 'string' || typeof v === 'number' ? texto(v, 10000) : '');
export const AYUDA_ANULACION = Object.freeze({
  procesando: 'Anulando...',
  motivoCorto: `Escribí el motivo (mínimo ${MIN_MOTIVO} letras)`,
  motivoLargo: `El motivo no puede superar ${MAX_MOTIVO} caracteres`,
  sinPin: 'Ingresá tu PIN de admin',
});
export const ayudaAnulacion = (entrada) => {
  const { motivo, pin, procesando } = entrada && typeof entrada === 'object' ? entrada : {};
  if (procesando) return { habilitado: false, ayuda: AYUDA_ANULACION.procesando };
  const m = textoPlano(motivo);
  if (m.length < MIN_MOTIVO) return { habilitado: false, ayuda: AYUDA_ANULACION.motivoCorto };
  if (m.length > MAX_MOTIVO) return { habilitado: false, ayuda: AYUDA_ANULACION.motivoLargo };
  if (!textoPlano(pin)) return { habilitado: false, ayuda: AYUDA_ANULACION.sinPin };
  return { habilitado: true, ayuda: null };
};

// S-COM-15 (iteración 3): ids de OTROS cierres que ocupan (vigentes o
// pendientes) y tienen ajustes de pedidos que este cierre tiene como base. Si
// hay alguno, el cierre no se anula (el servidor también lo rechaza con
// 'tiene_ajustes_vigentes'): hay que anular primero esos cierres.
export const cierresConAjustesDependientes = (cierre, cierres) => {
  if (!cierre) return [];
  const bases = new Set(renglonesDeCierre(cierre).filter(r => r.tipo === 'pedido').map(r => r.pedidoId));
  if (bases.size === 0) return [];
  const out = [];
  for (const c of cierres || []) {
    if (!c || c.id === cierre.id || !cierreOcupa(c)) continue;
    if (renglonesDeCierre(c).some(r => r.tipo === 'ajuste' && bases.has(r.pedidoId))) out.push(String(c.id));
  }
  return out;
};

const fechaHoraIso = (ms) => aIso(ms);

// % congelado tal como se usó para calcular (centésimos de punto): 10,125 => 10,13.
// Es el que verifica el servidor (S-COM-02). null = sin % (comisión 0).
export const pctCongelado = (pct) => {
  const p = porcentajeValido(pct);
  return p === null ? null : pctABase(p) / 100;
};

// cerrado_por / cerrado_at viajan solo como dato informativo: el servidor los
// ignora y usa el admin autenticado por PIN y su propio now() (S-COM-01/02).
export const cierreToRemote = (c) => ({
  p_cierre: {
    id: c.id,
    desde: c.desde,
    hasta: c.hasta,
    cerrado_at: fechaHoraIso(c.cerradoAt),
    cerrado_por: c.cerradoPor,
    total_vendido: Number(c.totales?.totalVendido || 0),
    total_comision: Number(c.totales?.totalComision || 0),
    totales: c.totales || {},
    detalle: c.detalle || [],
    lineas: c.lineas || [],
    ...(modeloDeCierre(c) === 'rubro' ? { modelo: 'rubro' } : {}),
  },
  p_renglones: renglonesDeCierre(c).map((r, i) => {
    const l = (c.lineas || [])[i] || {};
    const base = {
      pedido_id: r.pedidoId,
      tipo: r.tipo,
      ajuste_seq: r.ajusteSeq,
      total: r.total,
      comision: r.comision,
      pct: pctCongelado(l.pct),
      sin_comision: l.asignacion?.modo === 'sin_comision',
    };
    if (l.modelo !== 'rubro') return base;
    // AC-COMR-13: el servidor recalcula cada parte con SU tabla y arma el
    // desglose; el cliente solo manda vendedor, división y monto por parte.
    return {
      ...base,
      modelo: 'rubro',
      partes: (Array.isArray(l.partes) ? l.partes : []).map(p => ({
        vendedor_id: p?.vendedorId === null || p?.vendedorId === undefined ? null : String(p.vendedorId),
        pct: Number(p?.pct),
        monto: Number(p?.monto || 0),
      })),
    };
  }),
});

const parseFecha = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Date.parse(v);
  return Number.isFinite(n) ? n : null;
};

export const cierreFromRemote = (r, local = null) => ({
  ...(local || {}),
  id: String(r.id),
  desde: String(r.desde || '').slice(0, 10),
  hasta: String(r.hasta || '').slice(0, 10),
  cerradoAt: parseFecha(r.cerrado_at),
  cerradoPor: r.cerrado_por ?? '',
  estado: r.estado === 'anulado' ? 'anulado' : 'vigente',
  anuladoAt: parseFecha(r.anulado_at),
  anuladoPor: r.anulado_por ?? null,
  motivoAnulacion: r.motivo_anulacion ?? null,
  totales: r.totales || {},
  detalle: Array.isArray(r.detalle) ? r.detalle : [],
  lineas: Array.isArray(r.lineas) ? r.lineas : (local?.lineas || []),
  anulacionPendiente: r.estado === 'anulado' ? null : (local?.anulacionPendiente ?? null),
  ...(r.modelo === 'rubro' ? { modelo: 'rubro' } : {}),
  pendingSync: false,
  updatedAt: parseFecha(r.updated_at) ?? Date.now(),
});

// Mezcla remotos con locales: un local con pendingSync (o rechazado, que solo
// existe local) no se pisa.
export const mezclarCierres = (locales, remotos) => {
  const porId = new Map((locales || []).map(c => [c.id, c]));
  const out = [];
  for (const r of remotos || []) {
    const local = porId.get(String(r.id));
    if (local && (local.pendingSync || local.anulacionPendiente)) continue;
    out.push(cierreFromRemote(r, local));
  }
  return out;
};

// Cierre o anulación que el servidor todavía no confirmó (S-COM-01: se
// reintentan solo con el PIN del admin, desde la pantalla Comisiones).
export const esPendienteDeServidor = (c) =>
  (c?.estado === 'pendiente' && !!c?.pendingSync) || (c?.estado === 'vigente' && !!c?.anulacionPendiente);
export const contarPendientesServidor = (cierres) =>
  (Array.isArray(cierres) ? cierres : []).filter(esPendienteDeServidor).length;

// ---------------------------------------------------------------------------
// Borrador del período (AC-COM-9)
// ---------------------------------------------------------------------------
export const claveBorrador = (periodo) => `periodo:${periodo?.desde}:${periodo?.hasta}`;

export const borradorVacio = (periodo) => ({ id: claveBorrador(periodo), desde: periodo?.desde, hasta: periodo?.hasta, asignaciones: {}, updatedAt: null });

const limpiarAsignacionInput = (input) => {
  const out = { modo: MODOS_ASIGNACION.includes(input?.modo) ? input.modo : null };
  if (input?.vendedor !== undefined) out.vendedor = texto(input.vendedor, MAX_NOMBRE);
  if (input?.pctFicha !== undefined) out.pctFicha = texto(input.pctFicha, 10);
  if (input?.pctCargador !== undefined) out.pctCargador = texto(input.pctCargador, 10);
  return out;
};

// Devuelve un borrador nuevo con la asignación de un pedido (null = volver al default).
// AC-COM-17: limpiarAsignacionInput no copia `confirmada`, así que cualquier
// cambio deja la asignación pendiente otra vez (sin marca = no confirmada).
export const setAsignacionBorrador = (borrador, periodo, pedidoId, input, now = Date.now()) => {
  const base = borrador && borrador.id === claveBorrador(periodo) ? borrador : borradorVacio(periodo);
  const asignaciones = { ...(base.asignaciones || {}) };
  if (!input) delete asignaciones[String(pedidoId)];
  else asignaciones[String(pedidoId)] = limpiarAsignacionInput(input);
  return { ...base, asignaciones, updatedAt: now };
};

// AC-COM-17: ¿la asignación vigente de una línea del dashboard se puede confirmar?
// (vendedor elegido, "sin comisión" o división que suma 100).
export const asignacionLineaValida = (linea) =>
  !!linea && linea.tipo !== 'ajuste' && !linea.asignacionErrores && MODOS_ASIGNACION.includes(linea.asignacion?.modo);

// AC-COM-17: marca `confirmada: true` en la asignación del pedido. Solo se
// acepta si la asignación (la del borrador o, si no hay, la de la ficha) es
// válida según validarAsignacion. Si no, devuelve el borrador sin cambios.
// contexto = { pedido, cliente, vendedores } (los mismos que usa armarLinea).
export const confirmarAsignacionBorrador = (borrador, periodo, pedidoId, contexto = {}, now = Date.now(), config = CONFIG_COMISIONES) => {
  const base = borrador && borrador.id === claveBorrador(periodo) ? borrador : borradorVacio(periodo);
  const pid = pedidoId === null || pedidoId === undefined ? '' : String(pedidoId);
  const { pedido, cliente, vendedores } = contexto || {};
  if (!pid || !pedido || pedidoIdComision(pedido) !== pid) {
    return { ok: false, errores: { pedido: 'No se encontró el pedido' }, borrador: base };
  }
  const actual = (base.asignaciones || {})[pid];
  const input = actual ? limpiarAsignacionInput(actual) : asignacionPorDefecto(pedido, cliente, vendedores);
  if (!input.modo) {
    return { ok: false, errores: { modo: 'Elegí a quién va la comisión antes de confirmar' }, borrador: base };
  }
  const v = validarAsignacion(input, { pedido, cliente, vendedores }, config);
  if (!v.ok) return { ok: false, errores: v.errores, borrador: base };
  const guardada = actual ? limpiarAsignacionInput(actual) : { modo: input.modo };
  return {
    ok: true,
    errores: {},
    borrador: { ...base, asignaciones: { ...(base.asignaciones || {}), [pid]: { ...guardada, confirmada: true } }, updatedAt: now },
  };
};

// Quita asignaciones de pedidos que ya no están en el dashboard.
export const podarBorrador = (borrador, pedidoIds) => {
  if (!borrador) return borrador;
  const set = new Set([...(pedidoIds || [])].map(String));
  const asignaciones = {};
  for (const [k, v] of Object.entries(borrador.asignaciones || {})) if (set.has(k)) asignaciones[k] = v;
  return { ...borrador, asignaciones };
};

// ---------------------------------------------------------------------------
// PDF (AC-COM-14): filas listas para el generador (pdfGen).
// ---------------------------------------------------------------------------
const fmtFecha = (iso) => String(iso || '').slice(0, 10).split('-').reverse().join('/');
const fmtPesos = (n) => `$ ${(Number.isFinite(Number(n)) && typeof n !== 'object' ? Number(n) : 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const NOMBRE_MODO = { ficha: 'Ficha', cargador: 'Cargó', dividir: 'Dividido', otro: 'Asignado', sin_comision: 'Sin comisión' };

export const filasPdfCierre = (cierre) => {
  const c = cierre || {};
  const titulo = `Cierre de comisiones ${fmtFecha(c.desde)} al ${fmtFecha(c.hasta)}`;
  const cerrado = c.cerradoAt ? new Date(c.cerradoAt) : null;
  const subtitulo = `Cerrado por ${texto(c.cerradoPor, MAX_NOMBRE) || '-'}${cerrado && !Number.isNaN(cerrado.getTime()) ? ` el ${fmtFecha(cerrado.toISOString())}` : ''} · Id ${String(c.id || '').slice(0, 8)}`;
  const anulado = c.estado === 'anulado'
    ? `ANULADO por ${texto(c.anuladoPor, MAX_NOMBRE) || '-'}: ${texto(c.motivoAnulacion, MAX_MOTIVO)}`
    : null;
  // S-COM-08: TODA celda sale como string. Un objeto del jsonb remoto
  // ({content, styles, colSpan}) llega a autotable como "[object Object]" y no
  // puede falsear el layout del PDF.
  const lista = (v) => (Array.isArray(v) ? v : []);
  const resumen = lista(c.totales?.porVendedor).map(v => [texto(v?.vendedor, MAX_NOMBRE), texto(v?.pedidos, 12), texto(v?.clientes, 12), fmtPesos(v?.totalVendido), fmtPesos(v?.totalComision)]);
  resumen.push(['TOTAL', String(c.totales?.pedidos ?? ''), String(c.totales?.clientes ?? ''), fmtPesos(c.totales?.totalVendido), fmtPesos(c.totales?.totalComision)]);
  const detalle = [];
  // AC-COMR-13: cierre con el modelo por rubro => una fila por (vendedor,
  // pedido, rubro). Los cierres viejos ('cliente') salen exactamente como antes.
  if (modeloDeCierre(c) === 'rubro') {
    for (const v of lista(c.detalle)) {
      for (const cli of lista(v?.clientes)) {
        for (const p of lista(cli?.pedidos)) {
          const modo = typeof p?.asignacion === 'string' && Object.prototype.hasOwnProperty.call(NOMBRE_MODO, p.asignacion) ? p.asignacion : null;
          const pedido = `${p?.tipo === 'ajuste' ? 'Ajuste ' : ''}#${texto(p?.pedidoId, 64)}${modo === 'dividir' ? ` (${texto(p.division, 10)} %)` : ''}`;
          const fila = (rubro, subtotal, pct, comision) => [
            texto(v?.vendedor, MAX_NOMBRE),
            texto(cli?.clienteNombre, 120),
            pedido,
            fmtFecha(texto(p?.fecha, 30)),
            rubro,
            fmtPesos(subtotal),
            pct === null || pct === undefined ? '-' : `${texto(pct, 10)} %`,
            fmtPesos(comision),
          ].map(String);
          const desglose = lista(p?.desglose);
          if (p?.modelo === 'rubro' && desglose.length) {
            for (const d of desglose) detalle.push(fila(texto(d?.rubro, 60) || 'Sin rubro', d?.subtotal, d?.pct, d?.comision));
          } else {
            // Ajuste de un cierre viejo (modelo 'cliente') o pedido sin desglose.
            detalle.push(fila('-', p?.total, p?.pct, p?.comision));
          }
        }
      }
    }
    return {
      titulo,
      subtitulo,
      anulado,
      headResumen: ['Vendedor', 'Pedidos', 'Clientes', 'Total vendido', 'Comisión'],
      resumen,
      headDetalle: ['Vendedor', 'Cliente', 'Pedido', 'Fecha', 'Rubro', 'Subtotal', '%', 'Comisión'],
      detalle,
      filename: `comisiones_${c.desde || ''}_${c.hasta || ''}${c.estado === 'anulado' ? '_ANULADO' : ''}.pdf`,
    };
  }
  for (const v of lista(c.detalle)) {
    for (const cli of lista(v?.clientes)) {
      for (const p of lista(cli?.pedidos)) {
        const modo =typeof p?.asignacion === 'string' && Object.prototype.hasOwnProperty.call(NOMBRE_MODO, p.asignacion) ? p.asignacion : null;
        detalle.push([
          texto(v?.vendedor, MAX_NOMBRE),
          texto(cli?.clienteNombre, 120),
          `${p?.tipo === 'ajuste' ? 'Ajuste ' : ''}#${texto(p?.pedidoId, 64)}`,
          fmtFecha(texto(p?.fecha, 30)),
          fmtPesos(p?.total),
          p?.pct === null || p?.pct === undefined ? '-' : `${texto(p.pct, 10)} %`,
          `${modo ? NOMBRE_MODO[modo] : '-'}${modo === 'dividir' ? ` ${texto(p.division, 10)} %` : ''}`,
          fmtPesos(p?.comision),
        ].map(String));
      }
    }
  }
  return {
    titulo,
    subtitulo,
    anulado,
    headResumen: ['Vendedor', 'Pedidos', 'Clientes', 'Total vendido', 'Comisión'],
    resumen,
    headDetalle: ['Vendedor', 'Cliente', 'Pedido', 'Fecha', 'Total', '%', 'Asignación', 'Comisión'],
    detalle,
    filename: `comisiones_${c.desde || ''}_${c.hasta || ''}${c.estado === 'anulado' ? '_ANULADO' : ''}.pdf`,
  };
};
