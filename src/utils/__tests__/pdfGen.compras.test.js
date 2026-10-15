// REQ-INA / REQ-CPR: los PDFs de compras usan el mismo generador (jsPDF + autotable).
import { TextEncoder, TextDecoder } from 'util';
import { generarIngresosFile, generarEstadoCuentaFile, generarPedidoProveedorFile, generarComprobanteIngresoFile } from '../pdfGen';

global.TextEncoder = global.TextEncoder || TextEncoder;
global.TextDecoder = global.TextDecoder || TextDecoder;

const leer = (blob) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsText(blob); });
const cero = () => ({ unidades: 0, costoCentavos: 0 });
const subs = { A: { unidades: 10, costoCentavos: 10000 }, B: cero(), sinDato: { unidades: 2 }, total: { unidades: 12, costoCentavos: 10000 }, renglonesSinCosto: 0 };

describe('AC-INA-2 AC-INA-3 PDF de ingresos', () => {
  it('AC-INA-2 comprobante de un ingreso con subtotales A/B/total', async () => {
    const f = await generarComprobanteIngresoFile({ id: 'abc-123', proveedorNombre: 'Prov', facturaProveedor: 'F-1', fecha: '2026-10-10T15:00:00.000Z', items: [{ codigo: 'A1', descripcion: 'Uno', ingreso: 10 }] }, subs);
    expect(f.type).toBe('application/pdf');
    expect(f.name).toBe('ingreso_abc-123.pdf');
    expect((await leer(f)).startsWith('%PDF')).toBe(true);
  });
  it('AC-INA-3 historial con totales, nombre por período', async () => {
    const filas = [{ fecha: '2026-10-10T15:00:00.000Z', proveedorNombre: 'Prov', factura: 'F-1', facturaA: 'A-1', facturaB: '', subtotales: subs }];
    const f = await generarIngresosFile(filas, subs, { desde: '2026-10-01', hasta: '2026-10-15', tipo: 'A', proveedor: 'Prov' });
    expect(f.name).toBe('ingresos_2026-10-01_2026-10-15.pdf');
    expect((await leer(f)).startsWith('%PDF')).toBe(true);
  });
  it('AC-INA-3 sin filas ni fechas no explota', async () => {
    const f = await generarIngresosFile([], null, {});
    expect(f.name).toBe('ingresos_historial.pdf');
    expect(f.size).toBeGreaterThan(300);
  });
});

describe('AC-CPR-3 AC-CPR-4 PDF de cuenta y pedido', () => {
  it('AC-CPR-3 estado de cuenta con anulados, totales por medio y saldo', async () => {
    const estado = {
      saldoInicial: 0, saldoFinal: 55050, totalesPorMedio: { efectivo: 30000, transferencia: 20000, directa: 0, total: 50000 },
      filas: [
        { fecha: '2026-10-01', tipo: 'compra', montoCentavos: 100000, saldoAcumulado: 100000, referencia: 'Ingreso de mercadería', anulado: null, medio: null },
        { fecha: '2026-10-05', tipo: 'pago', medio: 'efectivo', montoCentavos: 30000, saldoAcumulado: 70000, referencia: 'recibo 4', anulado: null },
        { fecha: '2026-10-06', tipo: 'pago', medio: 'directa', montoCentavos: 10000, saldoAcumulado: 70000, referencia: '', anulado: { motivo: 'error', usuario: 'a', at: 'z' } },
      ],
    };
    const f = await generarEstadoCuentaFile(estado, { proveedor: 'Prov', desde: '2026-10-01', hasta: '2026-10-31' });
    expect(f.name).toBe('estado_cuenta_2026-10-01_2026-10-31.pdf');
    expect((await leer(f)).startsWith('%PDF')).toBe(true);
    expect((await generarEstadoCuentaFile({ filas: [] }, {})).name).toBe('estado_cuenta_completo.pdf');
  });
  it('AC-CPR-4 pedido al proveedor en PDF', async () => {
    const f = await generarPedidoProveedorFile([{ codigo: 'A1', nombre: 'Uno', cantidad: 2, unidad: 'bulto', unidades: 24 }, { codigo: '', nombre: 'Dos', cantidad: 1, unidad: 'u', unidades: 1 }], { proveedor: 'Prov Uno', fecha: '2026-10-15T12:00:00Z' });
    expect(f.name).toBe('pedido_proveedor_ProvUno.pdf');
    expect((await leer(f)).startsWith('%PDF')).toBe(true);
    expect((await generarPedidoProveedorFile([], {})).size).toBeGreaterThan(300);
  });
});
