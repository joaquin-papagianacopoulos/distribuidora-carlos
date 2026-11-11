// src/domain/boletaLayout.js — REQ-RTO (AC-RTO-1/4/6) y, historico, REQ-FAB (AC-FAB-4) / REQ-TRQ.
// Posiciones (en mm) del pie del remito: items, subtotal/redondeo/total, saldo anterior, total a cobrar
// y observaciones. El remito ya NO tiene troquel ni pie de pagina: el limite es el margen inferior.
// Funcion pura: pdfGen solo dibuja donde esta funcion indica.
import { normalizarTipoFactura } from './facturacionAB';

export const MARGEN_INFERIOR_PAGINA = 12;   // nada se dibuja a menos de 12 mm del borde
export const SEPARACION_MIN = 3;            // aire minimo entre el contenido y el margen inferior
export const Y_INICIO_PAGINA_NUEVA = 20;
export const PASO_PIE = 6;                  // mm entre renglones del pie

// AC-RTO-1: el comprobante impreso siempre es un REMITO (nunca "FACTURA A/B").
export const encabezadoComprobante = () => 'REMITO';

// Se conserva por compatibilidad (el tipo de factura sigue guardandose en el pedido), pero el PDF no lo usa.
export const encabezadoTipoFactura = (tipo) => {
  const t = normalizarTipoFactura(tipo);
  if (t === 'A') return 'FACTURA A';
  if (t === 'B') return 'FACTURA B';
  return null;
};

// AC-RTO-4: estilo compacto de las tablas (mas renglones por hoja) y el anterior, de referencia.
const LINEA = { lineColor: [80, 80, 80], lineWidth: 0.35 };
export const ESTILO_TABLA_COMPACTA = Object.freeze({
  fontSize: 8,
  cellPadding: Object.freeze({ top: 0.8, bottom: 0.8, left: 1.5, right: 1.5 }),
  ...LINEA,
});
// AC-RTO-7: renglones (items) del remito: Arial (en jsPDF la fuente equivalente es "helvetica") en negrita.
export const ESTILO_ITEMS_REMITO = Object.freeze({ font: 'helvetica', fontStyle: 'bold', fontSize: 9, textColor: 0 });
export const ESTILO_TABLA_ANTERIOR = Object.freeze({ fontSize: 9, cellPadding: 2, ...LINEA });

const PT_A_MM = 25.4 / 72;
const FACTOR_INTERLINEADO = 1.15; // el mismo que usa jsPDF / autoTable por defecto

const num = (v, def = 0) => (Number.isFinite(Number(v)) ? Number(v) : def);

const paddingVertical = (p) => {
  if (p && typeof p === 'object') return num(p.top, 0) + num(p.bottom, 0);
  return num(p, 0) * 2;
};

// Alto (mm) de una fila de una sola linea con ese estilo: texto + padding vertical.
export const altoFilaMm = (estilo = ESTILO_TABLA_COMPACTA) =>
  num(estilo?.fontSize, 9) * PT_A_MM * FACTOR_INTERLINEADO + paddingVertical(estilo?.cellPadding);

// Cuantos renglones entran en una hoja (descontando el encabezado de la tabla).
export const filasPorHoja = ({ pageH = 297, startY = 28, bottom = 14, estilo = ESTILO_TABLA_COMPACTA } = {}) => {
  const util = num(pageH, 297) - num(startY, 28) - num(bottom, 14);
  return Math.max(0, Math.floor(util / altoFilaMm(estilo)) - 1);
};

// finalY: y donde termina la tabla (ya con su separacion). lineasObs: lineas de la nota.
export const layoutPieBoleta = ({
  finalY, pageH = 297, hayDescuento = false, hayRedondeo = false, hayDeuda = false, hayObs = false, lineasObs = 1,
} = {}) => {
  const alto = num(pageH, 297);
  const limiteY = alto - MARGEN_INFERIOR_PAGINA;

  const calcular = (base) => {
    let y = base;
    const sig = () => { y += PASO_PIE; return y; };
    const itemsY = sig();
    const sinDescuentoY = hayDescuento ? y : null;   // misma linea que "Items" si hay descuento
    const subtotalY = hayRedondeo ? (hayDescuento ? sig() : y) : null;
    const redondeoY = hayRedondeo ? sig() : null;
    const totalesY = (hayRedondeo || hayDescuento) ? sig() : y;
    const descuentoY = hayDescuento ? sig() : null;
    const saldoAnteriorY = hayDeuda ? sig() : null;
    const totalCobrarY = hayDeuda ? sig() : null;
    const ultimo = Math.max(totalesY, descuentoY ?? 0, totalCobrarY ?? 0);
    const obsY = hayObs ? ultimo + 8 : null;
    const fin = obsY !== null ? obsY + 4 * (Math.max(1, num(lineasObs, 1)) - 1) : ultimo;
    return { itemsY, sinDescuentoY, subtotalY, redondeoY, totalesY, descuentoY, saldoAnteriorY, totalCobrarY, obsY, fin };
  };

  let baseY = num(finalY, Y_INICIO_PAGINA_NUEVA);
  let pos = calcular(baseY);
  let nuevaPagina = false;
  if (pos.fin + SEPARACION_MIN > limiteY) {
    nuevaPagina = true;
    baseY = Y_INICIO_PAGINA_NUEVA;
    pos = calcular(baseY);
  }

  return {
    nuevaPagina,
    baseY,
    limiteY,
    itemsY: pos.itemsY,
    sinDescuentoY: pos.sinDescuentoY,
    subtotalY: pos.subtotalY,
    redondeoY: pos.redondeoY,
    totalesY: pos.totalesY,
    descuentoY: pos.descuentoY,
    saldoAnteriorY: pos.saldoAnteriorY,
    totalCobrarY: pos.totalCobrarY,
    // Alias historico: la linea de "deuda" / "saldo a favor" va donde va el saldo anterior.
    deudaY: pos.saldoAnteriorY,
    obsY: pos.obsY,
  };
};
