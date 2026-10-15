// src/domain/boletaLayout.js — REQ-TRQ (AC-TRQ-1) y apoyo de REQ-FAB (AC-FAB-4).
// Posiciones (en mm) del pie de la boleta: totales, deuda, observaciones y el
// troquel de abajo. Funcion pura: pdfGen solo dibuja donde esta funcion indica.
// Garantia: nada de lo de arriba (totales/deuda/obs) llega a la linea de corte y
// el troquel se dibuja una sola vez, en la ultima pagina.
import { normalizarTipoFactura } from './facturacionAB';

export const MARGEN_INFERIOR_PAGINA = 12;   // el troquel termina 12 mm antes del borde
export const ALTO_TROQUEL = 30;             // de la linea de corte hacia abajo
export const SEPARACION_MIN = 3;            // aire minimo entre el contenido y la linea de corte
export const Y_INICIO_PAGINA_NUEVA = 20;

export const encabezadoTipoFactura = (tipo) => {
  const t = normalizarTipoFactura(tipo);
  if (t === 'A') return 'FACTURA A';
  if (t === 'B') return 'FACTURA B';
  return null;
};

const num = (v, def = 0) => (Number.isFinite(Number(v)) ? Number(v) : def);

// finalY: y donde termina la tabla (ya con su separacion). lineasObs: lineas de la nota.
export const layoutPieBoleta = ({ finalY, pageH = 297, hayDescuento = false, hayDeuda = false, hayObs = false, lineasObs = 1 } = {}) => {
  const alto = num(pageH, 297);
  const cutY = alto - MARGEN_INFERIOR_PAGINA;
  const corteY = cutY - ALTO_TROQUEL;

  const calcular = (base) => {
    const totalesY = base + (hayDescuento ? 16 : 6);
    const deudaY = hayDeuda ? totalesY + 8 : null;
    const ultimo = deudaY ?? totalesY;
    const obsY = hayObs ? ultimo + 8 : null;
    const fin = obsY !== null ? obsY + 4 * (Math.max(1, num(lineasObs, 1)) - 1) : ultimo;
    return { totalesY, deudaY, obsY, fin };
  };

  let baseY = num(finalY, Y_INICIO_PAGINA_NUEVA);
  let pos = calcular(baseY);
  let nuevaPagina = false;
  if (pos.fin + SEPARACION_MIN > corteY) {
    nuevaPagina = true;
    baseY = Y_INICIO_PAGINA_NUEVA;
    pos = calcular(baseY);
  }

  return {
    nuevaPagina,
    baseY,
    totalesY: pos.totalesY,
    deudaY: pos.deudaY,
    obsY: pos.obsY,
    corteY,
    // Texto del troquel (Cliente / Vendedor / Total) debajo de la linea de corte.
    clienteY: cutY - 22,
    vendedorY: cutY - 17,
    totalTroquelY: cutY - 12,
    // Casillas: la ultima ("Transf. a proveedor") es nueva (AC-TRQ-1).
    casillas: [
      { label: 'Efectivo', y: cutY - 24 },
      { label: 'Transferencia', y: cutY - 18 },
      { label: 'Transf. a proveedor', y: cutY - 12 },
    ],
    proveedorY: cutY - 5,
    proveedorTexto: 'Proveedor: ____________________',
  };
};
