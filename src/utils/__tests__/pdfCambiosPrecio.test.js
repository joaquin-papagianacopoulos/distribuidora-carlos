// REQ-HPR (AC-HPR-2/3): el PDF de cambios de precio usa el mismo generador (jsPDF + autotable).
import { TextEncoder, TextDecoder } from 'util';
import { generarCambiosPrecioFile } from '../pdfGen';

global.TextEncoder = global.TextEncoder || TextEncoder;
global.TextDecoder = global.TextDecoder || TextDecoder;

const leer = (blob) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsText(blob); });

const FILAS = [
  { productoId: '1', codigo: 'A1', nombre: 'Alfajor', rubro: 'Golosinas', precioAnterior: 100, precioNuevo: 120, precioBultoAnterior: 0, precioBultoNuevo: 110, variacionPct: 20 },
  { productoId: '2', codigo: 'B2', nombre: 'Nuevo', rubro: 'Bebidas', precioAnterior: null, precioNuevo: 50, precioBultoAnterior: null, precioBultoNuevo: 0, variacionPct: null },
];

describe('AC-HPR-2 AC-HPR-3 PDF de cambios de precio', () => {
  it('AC-HPR-2 genera el PDF completo con nombre por período', async () => {
    const f = await generarCambiosPrecioFile(FILAS, { desde: '2026-10-15', hasta: '2026-10-15' });
    expect(f.name).toBe('cambios_precio_2026-10-15.pdf');
    expect(f.type).toBe('application/pdf');
    expect((await leer(f)).startsWith('%PDF')).toBe(true);
  });

  it('AC-HPR-3 la opción "solo precio nuevo" genera otro archivo', async () => {
    const solo = [{ codigo: 'A1', nombre: 'Alfajor', precio: 120, precioBulto: 110 }];
    const f = await generarCambiosPrecioFile(solo, { desde: '2026-10-01', hasta: '2026-10-15', soloNuevo: true });
    expect(f.name).toBe('precios_nuevos_2026-10-01_2026-10-15.pdf');
    expect(f.size).toBeGreaterThan(500);
  });

  it('AC-HPR-2 sin filas no explota', async () => {
    const f = await generarCambiosPrecioFile([], { desde: '2026-10-15', hasta: '2026-10-15' });
    expect(f.size).toBeGreaterThan(300);
  });
});
