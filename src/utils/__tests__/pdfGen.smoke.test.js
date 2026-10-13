// Regresion S-06: la actualizacion jspdf 4 / jspdf-autotable 5 sigue generando
// todos los PDFs de la app (remitos, listas, resumenes, faltantes).
import { TextEncoder, TextDecoder } from 'util';
import { generarFacturaFile, generarListaClientesFile, generarResumenDiaFile, generarFaltantesDiaFile } from '../pdfGen';

// jsdom de Jest 27 no trae TextEncoder (el navegador si).
global.TextEncoder = global.TextEncoder || TextEncoder;
global.TextDecoder = global.TextDecoder || TextDecoder;

const leer = (blob) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsText(blob); });
const pedido = {
  id: 1, remoteId: 10, clienteNombre: 'Kiosco Pepe', vendedorNombre: 'Jorge', fecha: '2026-10-07', estado: 'facturado',
  total: 1500, items: [{ productoId: 1, nombre: 'Alfajor', cantidad: 10, precio: 100 }, { productoId: 2, nombre: 'Gaseosa', cantidad: 1, precio: 500 }],
};

describe('S-06 PDFs con jspdf 4 + autotable 5', () => {
  it('genera factura/remito', async () => {
    const f = await generarFacturaFile(pedido, { nombre: 'Kiosco Pepe', direccion: 'Calle 1' }, { nombre: 'Jorge' }, 200);
    expect(f.size).toBeGreaterThan(500);
    expect((await leer(f)).startsWith('%PDF')).toBe(true);
  });
  it('genera lista de clientes, resumen del dia y faltantes', async () => {
    for (const f of [
      await generarListaClientesFile([pedido], ['2026-10-07']),
      await generarResumenDiaFile([pedido], '2026-10-07'),
      await generarFaltantesDiaFile([{ productoNombre: 'Alfajor', clienteNombre: 'Kiosco', cantidadFaltante: 2, precioUnitario: 100, dineroNoPercibido: 200, fecha: '2026-10-07' }], '2026-10-07'),
    ]) {
      expect(f.size).toBeGreaterThan(300);
    }
  });
});
