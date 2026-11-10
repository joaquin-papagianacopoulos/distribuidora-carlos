// REQ-FAB (AC-FAB-3/4), REQ-AGR (AC-AGR-3), REQ-TRQ (AC-TRQ-1): la boleta y el reporte en PDF real (jsPDF).
import { TextEncoder, TextDecoder } from 'util';
import { generarFacturaFile, generarFacturasAEmitirFile, generarResumenDiaFile } from '../pdfGen';
import { ESTILO_TABLA_COMPACTA, ESTILO_TABLA_ANTERIOR, filasPorHoja } from '../../domain/boletaLayout';

global.TextEncoder = global.TextEncoder || TextEncoder;
global.TextDecoder = global.TextDecoder || TextDecoder;

const leer = (blob) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsText(blob); });

// Registra cada doc.text(texto, x, y) y cada pagina agregada (subclase de jsPDF real).
const mockReg = { textos: [], paginas: 0, tablas: [], lineasPunteadas: 0 };
jest.mock('jspdf', () => {
  const real = jest.requireActual('jspdf');
  class JsPdfEspia extends real.jsPDF {
    constructor(...a) {
      super(...a);
      const text = this.text.bind(this);
      const addPage = this.addPage.bind(this);
      const autoTable = this.autoTable && this.autoTable.bind(this);
      const setLineDash = this.setLineDash.bind(this);
      if (autoTable) this.autoTable = (o) => { mockReg.tablas.push(o); return autoTable(o); };
      this.setLineDash = (d, ...r) => { if (Array.isArray(d) && d.length) mockReg.lineasPunteadas += 1; return setLineDash(d, ...r); };
      this.text = (t, x, y, ...r) => {
        mockReg.textos.push({ t: Array.isArray(t) ? t.join(' ') : String(t), x, y, pagina: this.internal.getCurrentPageInfo().pageNumber, fs: this.getFontSize(), bold: /bold/i.test(String(this.getFont().fontStyle)) });
        return text(t, x, y, ...r);
      };
      this.addPage = (...p) => { mockReg.paginas += 1; return addPage(...p); };
    }
  }
  return { ...real, jsPDF: JsPdfEspia };
});

let textos; let paginas;
beforeEach(() => { mockReg.textos = []; mockReg.paginas = 0; mockReg.tablas = []; mockReg.lineasPunteadas = 0; textos = mockReg.textos; paginas = 0; });
const limpiar = () => { mockReg.textos = []; mockReg.paginas = 0; mockReg.tablas = []; mockReg.lineasPunteadas = 0; };
const vistos = () => mockReg.textos;
const pags = () => mockReg.paginas;

const item = (n, nombre, cantidad, precio, extra = {}) => ({ productoId: n, nombre, cantidad, precio, ...extra });
const pedido = (extra = {}) => ({
  id: 7, remoteId: 70, clienteNombre: 'Kiosco Pepe', vendedorNombre: 'Jorge', fecha: '2026-10-07', estado: 'facturado',
  items: [item(1, 'Alfajor', 10, 100), item(2, 'Gaseosa', 1, 500)], ...extra,
});
const buscar = (re) => vistos().filter(x => re.test(x.t));

// ADAPTADO (AC-FAB-4 -> AC-RTO-1): el impreso siempre es un REMITO, nunca "FACTURA A/B".
describe('AC-RTO-1 encabezado del remito', () => {
  it('AC-RTO-1 el titulo es REMITO y nunca FACTURA, aun con tipo A o B', async () => {
    await generarFacturaFile(pedido(), {}, {}, 0, null, { tipoFactura: 'A' });
    expect(buscar(/^REMITO$/)).toHaveLength(1);
    expect(buscar(/^REMITO N° 000007$/)).toHaveLength(1);
    limpiar();
    await generarFacturaFile(pedido({ tipoFactura: 'B' }), {}, {}, 0, null);
    expect(buscar(/^REMITO$/)).toHaveLength(1);
    expect(buscar(/FACTURA/)).toHaveLength(0);
    limpiar();
    await generarFacturaFile(pedido({ tipoFactura: 'ninguna' }), {}, {}, 0, null);
    expect(buscar(/^REMITO$/)).toHaveLength(1);
    expect(buscar(/BOLETA/)).toHaveLength(0);
  });
  it('AC-RTO-1 el archivo se llama remito_<n>_<fecha>.pdf', async () => {
    const f = await generarFacturaFile(pedido(), {}, {}, 0, null);
    expect(f.name).toBe('remito_000007_2026-10-07.pdf');
  });
  it('AC-FAB-4 retrocompatible: 5 parametros siguen andando', async () => {
    const f = await generarFacturaFile(pedido(), { nombre: 'x' }, { nombre: 'y' }, 100, 3);
    expect((await leer(f)).startsWith('%PDF')).toBe(true);
    expect(buscar(/^3$/)).toHaveLength(1);
  });
});

describe('AC-RTO-2 direccion y vendedor destacado', () => {
  it('AC-RTO-2 la direccion (y la zona) van debajo del nombre del cliente', async () => {
    await generarFacturaFile(pedido(), { direccion: 'Calle Falsa 123', zona: 'Norte' }, { nombre: 'Jorge' }, 0, null);
    const cli = buscar(/^Kiosco Pepe$/)[0];
    const dir = buscar(/^Calle Falsa 123$/)[0];
    expect(dir).toBeDefined();
    expect(dir.y).toBeGreaterThan(cli.y);
    expect(buscar(/^Zona: Norte$/)[0].y).toBeGreaterThan(cli.y);
  });
  it('AC-RTO-2 sin direccion no escribe una linea vacia', async () => {
    await generarFacturaFile(pedido(), {}, {}, 0, null);
    expect(buscar(/^Zona:/)).toHaveLength(0);
  });
  it('AC-RTO-2 "Vendedor:" va en negrita y con tamano >= al del cliente', async () => {
    await generarFacturaFile(pedido(), {}, { nombre: 'Jorge' }, 0, null);
    const cli = buscar(/^Kiosco Pepe$/)[0];
    const ven = buscar(/^Vendedor: Jorge$/)[0];
    expect(ven).toBeDefined();
    expect(ven.fs).toBeGreaterThanOrEqual(cli.fs);
    expect(ven.bold).toBe(true);
  });
});

describe('AC-RTO-3 renglones numerados e Items', () => {
  it('AC-RTO-3 la tabla lleva columna N° y "Ítems: N" al pie', async () => {
    await generarFacturaFile(pedido(), {}, {}, 0, null);
    expect(mockReg.tablas[0].head[0]).toEqual(['N°', 'Producto', 'Cant.', 'Precio Unit.', 'Subtotal']);
    expect(mockReg.tablas[0].body.map(r => r[0])).toEqual([1, 2]);
    expect(buscar(/^Ítems: 2$/)).toHaveLength(1);
  });
  it('AC-RTO-3 un grupo cuenta 1 y su detalle no se numera', async () => {
    const items = [item(1, 'Saphirus Lavanda', 12, 100, { bultoX: 12 }), item(2, 'Saphirus Rosa', 24, 100, { bultoX: 12 }), item(3, 'Jabon', 2, 50)];
    const grupos = [{ id: 'g', nombre: 'Saphirus', itemIds: ['1', '2'] }];
    await generarFacturaFile(pedido({ items, grupos }), {}, {}, 0, null, { modoGrupos: 'detalle' });
    const body = mockReg.tablas[0].body;
    expect(body.length).toBeGreaterThan(2);
    expect(body.filter(r => r[0] !== '')).toHaveLength(2);
    expect(buscar(/^Ítems: 2$/)).toHaveLength(1);
  });
});

describe('AC-RTO-4 estilo compacto y pedido largo', () => {
  it('AC-RTO-4 el remito y otro PDF con tabla usan ESTILO_TABLA_COMPACTA', async () => {
    await generarFacturaFile(pedido(), {}, {}, 0, null);
    expect(mockReg.tablas[0].styles).toBe(ESTILO_TABLA_COMPACTA);
    mockReg.tablas = [];
    await generarResumenDiaFile([pedido()], '2026-10-07');
    expect(mockReg.tablas[0].styles).toBe(ESTILO_TABLA_COMPACTA);
  });
  it('AC-RTO-4 pedido de 120 renglones: entra en <= 3 hojas (con el estilo anterior eran 4) y el pie queda en la ultima', async () => {
    const items = Array.from({ length: 120 }, (_, i) => item(i + 1, `Producto ${String(i).padStart(3, '0')}`, 1, 10));
    await generarFacturaFile(pedido({ items }), {}, {}, 0, null);
    const ultimaPagina = Math.max(...vistos().map(x => x.pagina));
    expect(ultimaPagina).toBeLessThanOrEqual(3);
    expect(ultimaPagina).toBeGreaterThan(1);
    expect(buscar(/^Ítems: 120$/)[0].pagina).toBe(ultimaPagina);
    expect(buscar(/^TOTAL:$/)[0].pagina).toBe(ultimaPagina);
    const compacto = filasPorHoja({ pageH: 297, startY: 38, bottom: 14, estilo: ESTILO_TABLA_COMPACTA });
    const anterior = filasPorHoja({ pageH: 297, startY: 38, bottom: 14, estilo: ESTILO_TABLA_ANTERIOR });
    expect(compacto).toBeGreaterThanOrEqual(Math.ceil(1.3 * anterior));
  });
});

describe('AC-RTO-5 saldo anterior y total a cobrar', () => {
  it('AC-RTO-5 con deuda: "Saldo anterior" y "Total a cobrar" = total + saldo; ya no dice "Deuda pendiente"', async () => {
    await generarFacturaFile(pedido(), {}, {}, 5000, null);
    expect(buscar(/^Saldo anterior: \$5\.000$/)).toHaveLength(1);
    expect(buscar(/^Total a cobrar: \$6\.500$/)).toHaveLength(1);
    expect(buscar(/Deuda pendiente/)).toHaveLength(0);
  });
  it('AC-RTO-5 sin deuda no aparece ninguno de los dos', async () => {
    await generarFacturaFile(pedido(), {}, {}, 0, null);
    expect(buscar(/Saldo anterior|Total a cobrar/)).toHaveLength(0);
  });
});

describe('AC-RED-2 Subtotal / Redondeo / TOTAL en el remito', () => {
  it('AC-RED-2 pedido facturado con redondeo congelado: Subtotal, Redondeo y TOTAL redondeado', async () => {
    await generarFacturaFile(pedido({ redondeoMultiplo: 1000 }), {}, {}, 0, null);
    expect(buscar(/^Subtotal:$/)).toHaveLength(1);
    expect(buscar(/^Redondeo:$/)).toHaveLength(1);
    expect(vistos().filter(x => x.x === 195).map(x => x.t)).toEqual(expect.arrayContaining(['$1.500', '+$500', '$2.000']));
  });
  it('AC-RED-2 sin ajuste solo se muestra TOTAL', async () => {
    await generarFacturaFile(pedido(), {}, {}, 0, null);
    expect(buscar(/^Subtotal:|^Redondeo:/)).toHaveLength(0);
    expect(buscar(/^TOTAL:$/)).toHaveLength(1);
  });
  it('AC-RED-2 pendiente: vista previa con redondeoVistaPrevia; con saldo, Total a cobrar suma el total redondeado', async () => {
    await generarFacturaFile(pedido({ estado: 'pendiente' }), {}, {}, 1000, null, { redondeoVistaPrevia: 1000 });
    expect(buscar(/^Redondeo:$/)).toHaveLength(1);
    expect(buscar(/^Total a cobrar: \$3\.000$/)).toHaveLength(1);
  });
});

describe('AC-RTO-6 sin troquel ni pie de pagina', () => {
  it('AC-RTO-6 no aparecen Efectivo, Transferencia, Transf. a proveedor, Proveedor: ni la linea de corte', async () => {
    await generarFacturaFile(pedido(), {}, {}, 0, null);
    expect(buscar(/^Efectivo$|^Transferencia$|^Transf\. a proveedor$|^Proveedor:/)).toHaveLength(0);
    expect(mockReg.lineasPunteadas).toBe(0);
  });

  it('AC-RTO-6 boleta larga con saldo y observaciones: total, saldo y obs en orden y sobre el margen inferior', async () => {
    const items = Array.from({ length: 60 }, (_, i) => item(i + 1, `Producto ${String(i).padStart(2, '0')}`, 3, 100));
    await generarFacturaFile(pedido({ items, observaciones: 'Entregar por la puerta de atras' }), {}, {}, 5000, null);
    const total = buscar(/^TOTAL:$/)[0];
    const saldo = buscar(/^Saldo anterior/)[0];
    const cobrar = buscar(/^Total a cobrar/)[0];
    const obs = buscar(/^Obs:/)[0];
    expect(saldo.pagina).toBe(total.pagina);
    expect(saldo.y).toBeGreaterThan(total.y);
    expect(cobrar.y).toBeGreaterThan(saldo.y);
    expect(obs.y).toBeGreaterThan(cobrar.y);
    expect(obs.y).toBeLessThan(297 - 12);
  });

  it('AC-RTO-6 si el pie no entra abajo de la tabla pasa entero a una hoja nueva', async () => {
    let hallado = false;
    for (let n = 30; n < 80 && !hallado; n++) {
      limpiar();
      const items = Array.from({ length: n }, (_, i) => item(i + 1, `P${i}`, 1, 10));
      await generarFacturaFile(pedido({ items, observaciones: 'nota' }), {}, {}, 100, null);
      const total = buscar(/^TOTAL:$/)[0];
      const items1 = buscar(/^Ítems:/)[0];
      const obs = buscar(/^Obs:/)[0];
      expect(total.pagina).toBe(items1.pagina);
      expect(obs.pagina).toBe(total.pagina);
      expect(obs.y).toBeLessThan(297 - 12);
      if (pags() > 0 && total.y < 60) hallado = true;
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

describe('AC-FRB-2 AC-FRB-3 boleta con precio de bulto', () => {
  const base = { productoId: 1, nombre: 'Dos Corazones', precioOriginal: 900, precioBultoOriginal: 800, precioBultoX: 16 };

  it('AC-FRB-3 16 u. -> $12.800, marca "x precio de bulto" y sin "Total sin descuento"', async () => {
    await generarFacturaFile(pedido({ items: [{ ...base, cantidad: 16, precio: 800, precioPorBulto: true }] }), {}, {}, 0, null);
    expect(buscar(/x precio de bulto/).length).toBeGreaterThan(0);
    expect(buscar(/12\.800/).length).toBeGreaterThan(0);
    expect(buscar(/Total sin descuento/i)).toHaveLength(0);
  });

  it('AC-FRB-3 10 u. -> $9.000, sin marca de bulto', async () => {
    await generarFacturaFile(pedido({ items: [{ ...base, cantidad: 10, precio: 900, precioPorBulto: false }] }), {}, {}, 0, null);
    expect(buscar(/x precio de bulto/)).toHaveLength(0);
    expect(buscar(/9\.000/).length).toBeGreaterThan(0);
  });
});
