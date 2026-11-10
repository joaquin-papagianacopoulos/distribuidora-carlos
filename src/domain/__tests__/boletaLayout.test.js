// REQ-RTO (AC-RTO-1/4/6) y, historico, REQ-FAB (AC-FAB-4) / REQ-TRQ (AC-TRQ-1): pie del remito sin solapamientos.
import {
  layoutPieBoleta, encabezadoTipoFactura, encabezadoComprobante,
  ESTILO_TABLA_COMPACTA, ESTILO_TABLA_ANTERIOR, altoFilaMm, filasPorHoja, MARGEN_INFERIOR_PAGINA,
} from '../boletaLayout';

const PAGE_H = 297;

// Lo que dibuja el pie, en orden vertical (de arriba hacia abajo).
const alturas = (l) => [l.totalesY, l.saldoAnteriorY, l.totalCobrarY, l.obsY].filter(v => v !== null);

describe('AC-RTO-1 encabezado del comprobante', () => {
  // ADAPTADO (AC-FAB-4 -> AC-RTO-1): el impreso siempre dice REMITO; encabezadoTipoFactura se conserva exportada.
  it('AC-RTO-1 el titulo siempre es REMITO', () => {
    expect(encabezadoComprobante()).toBe('REMITO');
  });
  it('AC-FAB-4 encabezadoTipoFactura se conserva: A y B se nombran, el resto no', () => {
    expect(encabezadoTipoFactura('A')).toBe('FACTURA A');
    expect(encabezadoTipoFactura('B')).toBe('FACTURA B');
    expect(encabezadoTipoFactura('ninguna')).toBeNull();
    expect(encabezadoTipoFactura(undefined)).toBeNull();
    expect(encabezadoTipoFactura('C')).toBeNull();
  });
});

describe('AC-RTO-6 layoutPieBoleta sin troquel', () => {
  // ADAPTADO (AC-TRQ-1 -> AC-RTO-6): ya no hay casillas, linea de corte ni "Proveedor:"; el limite es el margen inferior.
  it('AC-RTO-6 el pie no tiene casillas, corte ni linea de proveedor', () => {
    const l = layoutPieBoleta({ finalY: 80, pageH: PAGE_H });
    expect(l.casillas).toBeUndefined();
    expect(l.corteY).toBeUndefined();
    expect(l.proveedorY).toBeUndefined();
    expect(l.proveedorTexto).toBeUndefined();
  });

  it('AC-RTO-6 boleta corta: todo en la misma pagina y sobre el margen inferior', () => {
    const l = layoutPieBoleta({ finalY: 80, pageH: PAGE_H });
    expect(l.nuevaPagina).toBe(false);
    expect(l.limiteY).toBe(PAGE_H - MARGEN_INFERIOR_PAGINA);
    expect(alturas(l).every(y => y < l.limiteY)).toBe(true);
  });

  it('AC-RTO-6 boleta larga con redondeo + descuento + saldo + obs que entra: sin solapamiento', () => {
    const flags = { pageH: PAGE_H, hayDescuento: true, hayRedondeo: true, hayDeuda: true, hayObs: true };
    let finalY = 100;
    while (!layoutPieBoleta({ finalY: finalY + 1, ...flags }).nuevaPagina) finalY++;
    const l = layoutPieBoleta({ finalY, ...flags });
    expect(l.nuevaPagina).toBe(false);
    const ys = [l.subtotalY, l.redondeoY, l.totalesY, l.descuentoY, l.saldoAnteriorY, l.totalCobrarY, l.obsY];
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(6);
    expect(ys[ys.length - 1] + 3).toBeLessThanOrEqual(l.limiteY);
  });

  it('AC-RTO-6 si no entra pasa a pagina nueva y entra completo ahi', () => {
    const l = layoutPieBoleta({ finalY: 250, pageH: PAGE_H, hayDescuento: true, hayRedondeo: true, hayDeuda: true, hayObs: true, lineasObs: 2 });
    expect(l.nuevaPagina).toBe(true);
    expect(l.baseY).toBeLessThan(40);
    expect(Math.max(...alturas(l)) + 3).toBeLessThanOrEqual(l.limiteY);
  });

  it('AC-RTO-6 tabla que termina casi al borde de la pagina', () => {
    expect(layoutPieBoleta({ finalY: 290, pageH: PAGE_H, hayDeuda: true }).nuevaPagina).toBe(true);
  });

  it('AC-RTO-5 el saldo anterior queda debajo del total, el total a cobrar debajo del saldo y la nota al final', () => {
    const l = layoutPieBoleta({ finalY: 90, pageH: PAGE_H, hayDeuda: true, hayObs: true });
    expect(l.saldoAnteriorY).toBeGreaterThan(l.totalesY);
    expect(l.totalCobrarY).toBeGreaterThan(l.saldoAnteriorY);
    expect(l.obsY).toBeGreaterThan(l.totalCobrarY);
    expect(l.deudaY).toBe(l.saldoAnteriorY);
  });

  it('AC-RED-2 con redondeo van Subtotal, Redondeo y TOTAL en ese orden; sin redondeo no hay subtotal ni redondeo', () => {
    const con = layoutPieBoleta({ finalY: 90, hayRedondeo: true });
    expect(con.subtotalY).toBeLessThan(con.redondeoY);
    expect(con.redondeoY).toBeLessThan(con.totalesY);
    const sin = layoutPieBoleta({ finalY: 90 });
    expect(sin.subtotalY).toBeNull();
    expect(sin.redondeoY).toBeNull();
    expect(sin.saldoAnteriorY).toBeNull();
    expect(sin.totalCobrarY).toBeNull();
    expect(Number.isFinite(sin.itemsY)).toBe(true);
  });

  it('AC-RTO-6 entradas raras no rompen', () => {
    const l = layoutPieBoleta({});
    expect(l.limiteY).toBeGreaterThan(0);
    expect(Number.isFinite(l.totalesY)).toBe(true);
    expect(Number.isFinite(layoutPieBoleta({ finalY: NaN, hayDeuda: true }).totalesY)).toBe(true);
  });
});

describe('AC-RTO-4 estilo compacto: mas renglones por hoja', () => {
  const A4 = { pageH: PAGE_H, startY: 38, bottom: 14 };

  it('AC-RTO-4 el estilo compacto es de 8 pt con 0,8 mm de padding vertical', () => {
    expect(ESTILO_TABLA_COMPACTA.fontSize).toBe(8);
    expect(ESTILO_TABLA_COMPACTA.cellPadding.top).toBe(0.8);
    expect(ESTILO_TABLA_COMPACTA.cellPadding.bottom).toBe(0.8);
    expect(ESTILO_TABLA_ANTERIOR.fontSize).toBe(9);
  });

  it('AC-RTO-4 entran >= 30 % mas renglones por hoja que con el estilo anterior', () => {
    const antes = filasPorHoja({ ...A4, estilo: ESTILO_TABLA_ANTERIOR });
    const ahora = filasPorHoja({ ...A4, estilo: ESTILO_TABLA_COMPACTA });
    expect(antes).toBeGreaterThan(20);
    expect(ahora).toBeGreaterThanOrEqual(Math.ceil(1.3 * antes));
    // tambien con el origen clasico de la tabla (startY 28)
    const antes28 = filasPorHoja({ pageH: PAGE_H, startY: 28, bottom: 14, estilo: ESTILO_TABLA_ANTERIOR });
    const ahora28 = filasPorHoja({ pageH: PAGE_H, startY: 28, bottom: 14, estilo: ESTILO_TABLA_COMPACTA });
    expect(ahora28).toBeGreaterThanOrEqual(Math.ceil(1.3 * antes28));
  });

  it('AC-RTO-4 el alto de fila nunca es menor que el texto (no se superponen renglones)', () => {
    for (const e of [ESTILO_TABLA_COMPACTA, ESTILO_TABLA_ANTERIOR]) {
      const textoMm = e.fontSize * 25.4 / 72;
      expect(altoFilaMm(e)).toBeGreaterThan(textoMm);
    }
    expect(altoFilaMm(ESTILO_TABLA_COMPACTA)).toBeLessThan(altoFilaMm(ESTILO_TABLA_ANTERIOR));
  });

  it('AC-RTO-4 un pedido de 120 renglones ocupa al menos 30 % menos hojas', () => {
    const hojas = (n, estilo) => {
      const primera = filasPorHoja({ ...A4, estilo });
      const resto = filasPorHoja({ pageH: PAGE_H, startY: 10, bottom: 14, estilo });
      return n <= primera ? 1 : 1 + Math.ceil((n - primera) / resto);
    };
    const antes = hojas(120, ESTILO_TABLA_ANTERIOR);
    const ahora = hojas(120, ESTILO_TABLA_COMPACTA);
    expect(ahora).toBeLessThan(antes);
    expect(ahora).toBeLessThanOrEqual(Math.ceil(antes / 1.3));
  });

  it('AC-RTO-4 entradas raras no rompen', () => {
    expect(filasPorHoja({})).toBeGreaterThan(0);
    expect(filasPorHoja({ pageH: 10, startY: 50 })).toBe(0);
    expect(Number.isFinite(altoFilaMm({}))).toBe(true);
    expect(Number.isFinite(altoFilaMm({ fontSize: 'x', cellPadding: 3 }))).toBe(true);
  });
});
