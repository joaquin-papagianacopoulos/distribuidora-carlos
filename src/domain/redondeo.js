// src/domain/redondeo.js — REQ-RED (AC-RED-1, AC-RED-2).
// Redondeo del total a cobrar de un pedido al multiplo mas cercano ($500 / $1000 / sin redondeo).
// Funciones puras: sin React, sin IndexedDB, sin Supabase.
//
// Modelo (aclaracion de la Tanda 2): `pedido.total` sigue siendo la suma de renglones (las comisiones
// se calculan sobre eso). El total a cobrar redondeado va en `totalRedondeado`, el ajuste en `redondeo`
// y el multiplo usado queda congelado en `redondeoMultiplo` al facturar. Los pedidos facturados antes de
// este cambio (sin la clave) nunca se redondean.

export const MULTIPLOS_REDONDEO = Object.freeze([0, 500, 1000]);
export const REDONDEO_DEFAULT = 500;

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const multiploValido = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return MULTIPLOS_REDONDEO.includes(n) ? n : null;
};

// 0 / 500 / 1000. Sin dato (undefined/null) o invalido => 500 (default del negocio).
export const normalizarMultiplo = (v) => {
  const m = multiploValido(v);
  return m === null ? REDONDEO_DEFAULT : m;
};

// Al multiplo mas cercano; la mitad exacta va hacia arriba (tambien en negativos: -250 => 0).
// Calcula en centavos enteros para no arrastrar errores de punto flotante.
export const redondearTotal = (total, multiplo) => {
  const t = Number(total);
  if (!Number.isFinite(t)) return 0;
  const m = multiploValido(multiplo);
  if (!m) return r2(t);
  const c = Math.round(t * 100);
  const mc = m * 100;
  return (Math.floor((2 * c + mc) / (2 * mc)) * mc) / 100;
};

// Calcula el redondeo de un pedido (no muta). Si el redondeo dejara en $0 o menos un pedido que valia
// mas de $0, no se redondea: nunca se regala un pedido ni se pierde la deuda.
export const aplicarRedondeoPedido = (pedido, multiplo) => {
  const m = normalizarMultiplo(multiplo);
  const total = r2(Number(pedido?.total) || 0);
  let redondeado = redondearTotal(total, m);
  if (total > 0 && redondeado <= 0) redondeado = total;
  return { redondeo: r2(redondeado - total), redondeoMultiplo: m, totalRedondeado: redondeado };
};

const esFacturado = (p) => String(p?.estado || '').toLowerCase() === 'facturado';

// Lo que se cobra del pedido. Con multiplo congelado se recalcula desde `total` (asi una edicion desde
// una app vieja no deja un redondeo viejo); facturado sin la clave => `total`; pendiente => vista previa
// solo si se pasa `multiploVistaPrevia`.
export const totalACobrar = (pedido, { multiploVistaPrevia } = {}) => {
  const total = r2(Number(pedido?.total) || 0);
  const congelado = multiploValido(pedido?.redondeoMultiplo);
  if (congelado !== null) return aplicarRedondeoPedido(pedido, congelado).totalRedondeado;
  if (!esFacturado(pedido) && multiploVistaPrevia !== undefined && multiploVistaPrevia !== null) {
    return aplicarRedondeoPedido(pedido, multiploVistaPrevia).totalRedondeado;
  }
  return total;
};

// Pie del remito: subtotal (renglones), ajuste y total a cobrar.
export const desgloseTotalRemito = (pedido, opts = {}) => {
  const subtotal = r2(Number(pedido?.total) || 0);
  const total = totalACobrar(pedido, opts);
  return { subtotal, redondeo: r2(total - subtotal), total };
};

// Al facturar: congela el multiplo. Idempotente: si ya tiene uno no lo cambia (solo recalcula el total).
export const alFacturar = (pedido, multiplo) => {
  const congelado = multiploValido(pedido?.redondeoMultiplo);
  return { ...pedido, ...aplicarRedondeoPedido(pedido, congelado !== null ? congelado : multiplo) };
};

// Tras editar los items de un pedido: si tiene multiplo congelado recalcula el ajuste con ESE multiplo;
// si no (pendiente o facturado antes del redondeo) lo deja como esta.
export const recalcularRedondeoCongelado = (pedido) => {
  const congelado = multiploValido(pedido?.redondeoMultiplo);
  return congelado === null ? pedido : { ...pedido, ...aplicarRedondeoPedido(pedido, congelado) };
};

// Al volver a pendiente: se limpian las 3 claves (null); al re-facturar rige el ajuste vigente.
export const alRevertirPendiente = (pedido) => ({ ...pedido, redondeo: null, redondeoMultiplo: null, totalRedondeado: null });

// ---- Sync (migracion 025) ----
// Las claves viajan solo si el pedido las conoce (`!== undefined`): un dispositivo viejo no las pisa.
export const redondeoToRemote = (p) => {
  if (!p || typeof p !== 'object') return {};
  const out = {};
  if (p.redondeo !== undefined) out.redondeo = p.redondeo === null ? null : r2(Number(p.redondeo) || 0);
  if (p.redondeoMultiplo !== undefined) out.redondeo_multiplo = p.redondeoMultiplo === null ? null : multiploValido(p.redondeoMultiplo);
  if (p.totalRedondeado !== undefined) out.total_redondeado = p.totalRedondeado === null ? null : r2(Number(p.totalRedondeado) || 0);
  return out;
};

const numOLocal = (rv, lv) => {
  if (rv === undefined) return lv;
  if (rv === null) return null;
  const n = Number(rv);
  return Number.isFinite(n) ? r2(n) : lv;
};

// Dato no confiable: se sanea. `undefined` (columna inexistente) conserva lo local.
export const redondeoFromRemote = (r, local) => {
  const out = {};
  const red = numOLocal(r?.redondeo, local?.redondeo);
  const tot = numOLocal(r?.total_redondeado, local?.totalRedondeado);
  let mul = local?.redondeoMultiplo;
  if (r && r.redondeo_multiplo !== undefined) {
    const v = r.redondeo_multiplo === null ? null : multiploValido(r.redondeo_multiplo);
    if (r.redondeo_multiplo === null || v !== null) mul = v; // valor invalido: se conserva lo local
  }
  // S-T2-06: una app vieja pudo revertir el pedido a pendiente sin limpiar el redondeo congelado:
  // si la fila remota dice que NO esta facturado, se limpian las 3 claves.
  if (r && typeof r.estado === 'string' && r.estado.toLowerCase() !== 'facturado' && (r.redondeo_multiplo != null || r.redondeo != null || r.total_redondeado != null)) {
    return { redondeo: null, redondeoMultiplo: null, totalRedondeado: null };
  }
  if (red !== undefined && !(red === null && local?.redondeo === undefined)) out.redondeo = red;
  if (mul !== undefined && !(mul === null && local?.redondeoMultiplo === undefined)) out.redondeoMultiplo = mul;
  if (tot !== undefined && !(tot === null && local?.totalRedondeado === undefined)) out.totalRedondeado = tot;
  return out;
};

export const COLUMNAS_025_PEDIDOS = Object.freeze(['redondeo', 'redondeo_multiplo', 'total_redondeado']);

// Fila sin las columnas de la 025 (si todavia no se aplico).
export const sinColumnas025 = (row) => {
  if (!row || typeof row !== 'object') return row;
  const { redondeo: _r, redondeo_multiplo: _m, total_redondeado: _t, ...resto } = row;
  return resto;
};

export const nombraColumna025 = (error) =>
  /\bredondeo\b|redondeo_multiplo|total_redondeado/i.test(String(error?.message || ''));
