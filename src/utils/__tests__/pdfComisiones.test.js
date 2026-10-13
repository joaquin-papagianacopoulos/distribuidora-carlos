// REQ-COM AC-COM-14: el PDF del cierre usa el mismo generador de la app (jsPDF + autotable).
import { TextEncoder, TextDecoder } from 'util';
import { generarCierreComisionesFile } from '../pdfGen';

global.TextEncoder = global.TextEncoder || TextEncoder;
global.TextDecoder = global.TextDecoder || TextDecoder;

const leer = (blob) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsText(blob); });

const CIERRE = {
  id: 'abcdef12-3456', desde: '2026-10-01', hasta: '2026-10-31', cerradoAt: Date.UTC(2026, 10, 1), cerradoPor: 'Jorge', estado: 'vigente',
  totales: { pedidos: 1, clientes: 1, totalVendido: 1000, totalComision: 50, porVendedor: [{ vendedor: 'Carlos', pedidos: 1, clientes: 1, totalVendido: 1000, totalComision: 50 }] },
  detalle: [{ vendedor: 'Carlos', clientes: [{ clienteNombre: 'Kiosco', pedidos: [{ pedidoId: 'R1', tipo: 'pedido', fecha: '2026-10-10', total: 1000, pct: 5, comision: 50, asignacion: 'ficha' }] }] }],
};

describe('AC-COM-14 PDF de cierre de comisiones', () => {
  it('AC-COM-14 genera un PDF con nombre por período', async () => {
    const f = await generarCierreComisionesFile(CIERRE);
    expect(f.name).toBe('comisiones_2026-10-01_2026-10-31.pdf');
    expect(f.type).toBe('application/pdf');
    expect((await leer(f)).startsWith('%PDF')).toBe(true);
  });

  it('AC-COM-14 un cierre anulado también se exporta, marcado en el nombre', async () => {
    const f = await generarCierreComisionesFile({ ...CIERRE, estado: 'anulado', anuladoPor: 'Jorge', motivoAnulacion: 'Error de carga' });
    expect(f.name).toMatch(/_ANULADO\.pdf$/);
    expect(f.size).toBeGreaterThan(500);
  });
});
