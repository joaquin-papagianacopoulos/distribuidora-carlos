// REQ-FAB (AC-FAB-3/4), REQ-AGR (AC-AGR-3), REQ-TRQ (AC-TRQ-1): la boleta y el reporte en PDF real (jsPDF).
import { TextEncoder, TextDecoder } from 'util';
import { generarFacturaFile, generarFacturasAEmitirFile } from '../pdfGen';

global.TextEncoder = global.TextEncoder || TextEncoder;
global.TextDecoder = global.TextDecoder || TextDecoder;

const leer = (blob) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsText(blob); });

// Registra cada doc.text(texto, x, y) y cada pagina agregada (subclase de jsPDF real).
const mockReg = { textos: [], paginas: 0 };
jest.mock('jspdf', () => {
  const real = jest.requireActual('jspdf');
  class JsPdfEspia extends real.jsPDF {
    constructor(...a) {
      super(...a);
      const text = this.text.bind(this);
      const addPage = this.addPage.bind(this);
      this.text = (t, x, y, ...r) => {
        mockReg.textos.push({ t: Array.isArray(t) ? t.join(' ') : String(t), x, y, pagina: this.internal.getCurrentPageInfo().pageNumber });
        return text(t, x, y, ...r);
      };
      this.addPage = (...p) => { mockReg.paginas += 1; return addPage(...p); };
    }
  }
  return { ...real, jsPDF: JsPdfEspia };
});

let textos; let paginas;
beforeEach(() => { mockReg.textos = []; mockReg.paginas = 0; textos = mockReg.textos; paginas = 0; });
const limpiar = () => { mockReg.textos = []; mockReg.paginas = 0; };
const vistos = () => mockReg.textos;
const pags = () => mockReg.paginas;

const item = (n, nombre, cantidad, precio, extra = {}) => ({ productoId: n, nombre, cantidad, precio, ...extra });
const pedido = (extra = {}) => ({
  id: 7, remoteId: 70, clienteNombre: 'Kiosco Pepe', vendedorNombre: 'Jorge', fecha: '2026-10-07', estado: 'facturado',
  items: [item(1, 'Alfajor', 10, 100), item(2, 'Gaseosa', 1, 500)], ...extra,
});
const buscar = (re) => vistos().filter(x => re.test(x.t));

describe('AC-FAB-4 encabezado de la boleta', () => {
  it('AC-FAB-4 muestra FACTURA A / FACTURA B segun el tipo', async () => {
    await generarFacturaFile(pedido(), {}, {}, 0, null, { tipoFactura: 'A' });
    expect(buscar(/^FACTURA A$/)).toHaveLength(1);
    limpiar();
    await generarFacturaFile(pedido({ tipoFactura: 'B' }), {}, {}, 0, null);
    expect(buscar(/^FACTURA B$/)).toHaveLength(1);
  });
  it('AC-FAB-4 sin tipo (o "ninguna") no escribe FACTURA', async () => {
    await generarFacturaFile(pedido(), {}, {}, 0, null);
    await generarFacturaFile(pedido({ tipoFactura: 'ninguna' }), {}, {}, 0, null);
    expect(buscar(/^FACTURA/)).toHaveLength(0);
  });
  it('AC-FAB-4 retrocompatible: 5 parametros siguen andando', async () => {
    const f = await generarFacturaFile(pedido(), { nombre: 'x' }, { nombre: 'y' }, 100, 3);
    expect((await leer(f)).startsWith('%PDF')).toBe(true);
    expect(buscar(/^3$/)).toHaveLength(1);
  });
});

describe('AC-TRQ-1 troquel con Transf. a proveedor', () => {
  it('AC-TRQ-1 boleta corta: tres casillas y linea Proveedor, todo dentro de la hoja', async () => {
    await generarFacturaFile(pedido(), {}, {}, 0, null);
    expect(buscar(/^Efectivo$/)).toHaveLength(1);
    expect(buscar(/^Transferencia$/)).toHaveLength(1);
    const prov = buscar(/^Transf\. a proveedor$/);
    expect(prov).toHaveLength(1);
    const linea = buscar(/^Proveedor:/);
    expect(linea).toHaveLength(1);
    expect(linea[0].y).toBeLessThan(297);
    expect(linea[0].y).toBeGreaterThan(prov[0].y);
  });

  it('AC-TRQ-1 boleta larga con deuda y observaciones: el troquel solo en la ultima pagina y nada se pisa', async () => {
    const items = Array.from({ length: 60 }, (_, i) => item(i + 1, `Producto ${String(i).padStart(2, '0')}`, 3, 100));
    await generarFacturaFile(pedido({ items, observaciones: 'Entregar por la puerta de atras' }), {}, {}, 5000, null);
    const prov = buscar(/^Transf\. a proveedor$/);
    expect(prov).toHaveLength(1);
    const total = buscar(/^TOTAL:$/)[0];
    const deuda = buscar(/^Deuda pendiente/)[0];
    const obs = buscar(/^Obs:/)[0];
    expect(total.pagina).toBe(prov[0].pagina);
    expect(deuda.y).toBeGreaterThan(total.y);
    expect(obs.y).toBeGreaterThan(deuda.y);
    expect(obs.y).toBeLessThan(prov[0].y - 20);
  });

  it('AC-TRQ-1 si totales+deuda+obs no entran arriba del corte, pasan a una hoja nueva con el troquel', async () => {
    // Busca una cantidad de renglones que deje la tabla casi al final de la hoja.
    let hallado = false;
    for (let n = 20; n < 45 && !hallado; n++) {
      limpiar();
      const items = Array.from({ length: n }, (_, i) => item(i + 1, `P${i}`, 1, 10));
      await generarFacturaFile(pedido({ items, observaciones: 'nota' }), {}, {}, 100, null);
      const prov = buscar(/^Transf\. a proveedor$/)[0];
      const total = buscar(/^TOTAL:$/)[0];
      expect(prov.pagina).toBe(total.pagina);
      if (pags() > 0) hallado = true;
    }
    expect(hallado).toBe(true);
  });
});

describe('AC-AGR-3 grupos en la boleta', () => {
  const items = [item(1, 'Saphirus Lavanda', 12, 100, { bultoX: 12 }), item(2, 'Saphirus Rosa', 24, 100, { bultoX: 12 }), item(3, 'Jabon', 2, 50)];
  const grupos = [{ id: 'g', nombre: 'Saphirus', itemIds: ['1', '2'] }];

  it('AC-AGR-3 con detalle: linea del grupo con bultos y debajo los renglones', async () => {
    await generarFacturaFile(pedido({ items, grupos }), {}, {}, 0, null, { modoGrupos: 'detalle' });
    expect(buscar(/3 bultos \(36 u\.\)/).length + buscar(/^Saphirus$/).length).toBeGreaterThan(0);
    expect(buscar(/^TOTAL:$/)).toHaveLength(1);
  });

  it('AC-AGR-3 el TOTAL no cambia con grupos ni segun el modo', async () => {
    const totales = [];
    for (const [g, modo] of [[undefined, 'detalle'], [grupos, 'detalle'], [grupos, 'solo_grupos']]) {
      limpiar();
      await generarFacturaFile(pedido({ items, grupos: g }), {}, {}, 0, null, { modoGrupos: modo });
      const y = buscar(/^TOTAL:$/)[0].y;
      totales.push(vistos().filter(x => x.x === 195 && x.y === y).map(x => x.t).join('|'));
    }
    expect(totales[0]).toBe('$3.700');
    expect(totales[1]).toBe(totales[0]);
    expect(totales[2]).toBe(totales[0]);
  });
});

describe('AC-FAB-3 PDF Facturas a emitir', () => {
  const reporte = {
    grupos: [
      { tipo: 'A', subtotal: 150, filas: [{ pedidoId: '1', fecha: '2026-10-01', clienteNombre: 'Kiosco', cuit: '20-12345678-6', tipoIva: 'Responsable Inscripto', tipo: 'A', sugerido: false, total: 150 }] },
      { tipo: 'B', subtotal: 300, filas: [{ pedidoId: '3', fecha: '2026-10-03', clienteNombre: 'Pepe', cuit: '', tipoIva: 'Monotributo', tipo: 'B', sugerido: true, total: 300 }] },
    ],
    total: 450,
  };
  it('AC-FAB-3 genera el PDF, sin CUIT ni cliente en el nombre del archivo', async () => {
    const f = await generarFacturasAEmitirFile(reporte, { desde: '2026-10-01', hasta: '2026-10-31', filtro: 'todas' });
    expect(f.name).toBe('facturas_a_emitir_2026-10-01_2026-10-31.pdf');
    expect(f.name).not.toMatch(/20-12345678|Kiosco/);
    expect((await leer(f)).startsWith('%PDF')).toBe(true);
    expect(buscar(/TOTAL GENERAL/)).toHaveLength(1);
  });
  it('AC-FAB-3 reporte vacio no explota', async () => {
    const f = await generarFacturasAEmitirFile({ grupos: [], total: 0 }, { desde: '2026-10-01', hasta: '2026-10-01' });
    expect(f.name).toBe('facturas_a_emitir_2026-10-01.pdf');
    expect(f.size).toBeGreaterThan(300);
  });
});
