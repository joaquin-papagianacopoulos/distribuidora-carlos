// REQ-TRQ (AC-TRQ-1) y REQ-FAB (AC-FAB-4): pie de la boleta sin solapamientos.
import { layoutPieBoleta, encabezadoTipoFactura } from '../boletaLayout';

const PAGE_H = 297;

// Lo que dibuja arriba de la linea de corte, en orden vertical.
const alturas = (l) => [l.totalesY, l.deudaY, l.obsY].filter(v => v !== null);

describe('AC-FAB-4 encabezadoTipoFactura', () => {
  it('AC-FAB-4 A y B se muestran, el resto no', () => {
    expect(encabezadoTipoFactura('A')).toBe('FACTURA A');
    expect(encabezadoTipoFactura('B')).toBe('FACTURA B');
    expect(encabezadoTipoFactura('ninguna')).toBeNull();
    expect(encabezadoTipoFactura(undefined)).toBeNull();
    expect(encabezadoTipoFactura('C')).toBeNull();
  });
});

describe('AC-TRQ-1 layoutPieBoleta', () => {
  it('AC-TRQ-1 boleta corta: todo en la misma pagina, sobre la linea de corte', () => {
    const l = layoutPieBoleta({ finalY: 80, pageH: PAGE_H });
    expect(l.nuevaPagina).toBe(false);
    expect(alturas(l).every(y => y < l.corteY)).toBe(true);
  });

  it('AC-TRQ-1 casilla "Transf. a proveedor" y linea "Proveedor:" dentro de la pagina y bajo el corte', () => {
    const l = layoutPieBoleta({ finalY: 80, pageH: PAGE_H });
    const labels = l.casillas.map(c => c.label);
    expect(labels).toEqual(['Efectivo', 'Transferencia', 'Transf. a proveedor']);
    for (const c of l.casillas) {
      expect(c.y - 4).toBeGreaterThan(l.corteY);
      expect(c.y).toBeLessThan(PAGE_H);
    }
    expect(l.proveedorTexto).toMatch(/^Proveedor:/);
    expect(l.proveedorY).toBeGreaterThan(l.casillas[2].y);
    expect(l.proveedorY).toBeLessThan(PAGE_H - 5);
  });

  it('AC-TRQ-1 las casillas no se pisan entre si (>= 5 mm)', () => {
    const l = layoutPieBoleta({ finalY: 80, pageH: PAGE_H });
    const ys = [...l.casillas.map(c => c.y), l.proveedorY];
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(5);
  });

  it('AC-TRQ-1 boleta larga con deuda + descuento + obs que entra: sin solapamiento', () => {
    // La mas larga que todavia entra: busca el maximo finalY sin pagina nueva.
    let finalY = 100;
    while (!layoutPieBoleta({ finalY: finalY + 1, pageH: PAGE_H, hayDescuento: true, hayDeuda: true, hayObs: true }).nuevaPagina) finalY++;
    const l = layoutPieBoleta({ finalY, pageH: PAGE_H, hayDescuento: true, hayDeuda: true, hayObs: true });
    expect(l.nuevaPagina).toBe(false);
    const ys = alturas(l);
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(6);
    expect(ys[ys.length - 1] + 3).toBeLessThanOrEqual(l.corteY);
  });

  it('AC-TRQ-1 si no entra pasa a pagina nueva y entra completo ahi', () => {
    const l = layoutPieBoleta({ finalY: 250, pageH: PAGE_H, hayDescuento: true, hayDeuda: true, hayObs: true, lineasObs: 2 });
    expect(l.nuevaPagina).toBe(true);
    expect(l.baseY).toBeLessThan(40);
    expect(Math.max(...alturas(l)) + 3).toBeLessThanOrEqual(l.corteY);
  });

  it('AC-TRQ-1 tabla que termina casi al borde de la pagina', () => {
    const l = layoutPieBoleta({ finalY: 290, pageH: PAGE_H, hayDeuda: true });
    expect(l.nuevaPagina).toBe(true);
  });

  it('AC-TRQ-1 la deuda queda debajo del total y la nota debajo de la deuda', () => {
    const l = layoutPieBoleta({ finalY: 90, pageH: PAGE_H, hayDeuda: true, hayObs: true });
    expect(l.deudaY).toBeGreaterThan(l.totalesY);
    expect(l.obsY).toBeGreaterThan(l.deudaY);
  });

  it('AC-TRQ-1 entradas raras no rompen', () => {
    const l = layoutPieBoleta({});
    expect(l.corteY).toBeGreaterThan(0);
    expect(Number.isFinite(l.totalesY)).toBe(true);
  });
});
