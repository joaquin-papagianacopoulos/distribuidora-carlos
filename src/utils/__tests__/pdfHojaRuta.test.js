// REQ-HRU (AC-HRU-1) y REQ-RTO (AC-RTO-4): PDF de la hoja de ruta (jsPDF real, con espias).
import { TextEncoder, TextDecoder } from 'util';
import { generarHojaRutaFile } from '../pdfGen';
import { ESTILO_TABLA_COMPACTA } from '../../domain/boletaLayout';

global.TextEncoder = global.TextEncoder || TextEncoder;
global.TextDecoder = global.TextDecoder || TextDecoder;

const leer = (blob) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsText(blob); });

const mockReg = { tablas: [], textos: [], orientacion: null };
jest.mock('jspdf', () => {
  const real = jest.requireActual('jspdf');
  class JsPdfEspia extends real.jsPDF {
    constructor(...a) {
      super(...a);
      mockReg.orientacion = a[0]?.orientation || null;
      const autoTable = this.autoTable && this.autoTable.bind(this);
      if (autoTable) this.autoTable = (o) => { mockReg.tablas.push(o); return autoTable(o); };
      const text = this.text.bind(this);
      this.text = (t, ...r) => { mockReg.textos.push(Array.isArray(t) ? t.join(' ') : String(t)); return text(t, ...r); };
    }
  }
  return { ...real, jsPDF: JsPdfEspia };
});

beforeEach(() => { mockReg.tablas = []; mockReg.textos = []; mockReg.orientacion = null; });

const fila = (zona, orden, clienteNombre, importe, saldoAnterior = 0, direccion = 'Calle 1') => ({
  zona, orden, clienteNombre, direccion, importe, saldoAnterior, totalACobrar: importe + saldoAnterior,
});
const RESULTADO = {
  filas: [fila('Norte', 1, 'Ana Ñandú', 1000, 500), fila('Norte', 2, 'Beto', 2000), fila('Sur', 1, 'Dani', 1500)],
  totales: { pedidos: 3, importe: 4500, saldoAnterior: 500, totalACobrar: 5000 },
};

describe('AC-HRU-1 PDF de la hoja de ruta', () => {
  it('AC-HRU-1 es un PDF apaisado, con el nombre segun las fechas', async () => {
    const f = await generarHojaRutaFile(RESULTADO, { fechas: ['2026-11-09'], zonas: [] });
    expect((await leer(f)).startsWith('%PDF')).toBe(true);
    expect(f.name).toBe('hoja_ruta_2026-11-09.pdf');
    expect(mockReg.orientacion).toBe('landscape');
    const f2 = await generarHojaRutaFile(RESULTADO, { fechas: ['2026-11-10', '2026-11-08'], zonas: [] });
    expect(f2.name).toBe('hoja_ruta_2026-11-08_2026-11-10.pdf');
  });

  it('AC-HRU-1 encabezados: orden, cliente, direccion, importe, saldo, total y las 3 columnas de cobro vacias + observaciones', async () => {
    await generarHojaRutaFile(RESULTADO, { fechas: ['2026-11-09'] });
    expect(mockReg.tablas[0].head[0]).toEqual([
      'Orden', 'Cliente', 'Dirección', 'Importe', 'Saldo ant.', 'Total a cobrar',
      'Efectivo', 'Transf.', 'Transf. a proveedor', 'Observaciones',
    ]);
    const datos = mockReg.tablas[0].body.filter(r => r.length === 10);
    expect(datos).toHaveLength(3);
    for (const r of datos) expect(r.slice(6)).toEqual(['', '', '', '']);
    expect(datos[0].slice(0, 6)).toEqual(['1', 'Ana Ñandú', 'Calle 1', '$1.000,00', '$500,00', '$1.500,00']);
    // sin saldo anterior la celda queda vacia
    expect(datos[1][4]).toBe('');
  });

  it('AC-HRU-1 agrupa por zona (una fila de zona cada vez que cambia) y pone los totales al final', async () => {
    await generarHojaRutaFile(RESULTADO, { fechas: ['2026-11-09'] });
    const t = mockReg.tablas[0];
    const zonas = t.body.filter(r => r.length === 1).map(r => r[0].content);
    expect(zonas).toEqual(['Zona: Norte', 'Zona: Sur']);
    expect(t.foot[0]).toEqual(['', 'TOTALES', '3 pedidos', '$4.500,00', '$500,00', '$5.000,00', '', '', '', '']);
  });

  it('AC-RTO-4 la tabla usa el estilo compacto', async () => {
    await generarHojaRutaFile(RESULTADO, { fechas: ['2026-11-09'] });
    expect(mockReg.tablas[0].styles).toBe(ESTILO_TABLA_COMPACTA);
  });

  it('AC-HRU-1 sin zona nombrada usa "Sin zona"; resultado vacio o nulo no rompe', async () => {
    await generarHojaRutaFile({ filas: [fila('', 1, 'Eli', 100)], totales: { pedidos: 1, importe: 100, saldoAnterior: 0, totalACobrar: 100 } }, {});
    expect(mockReg.tablas[0].body[0][0].content).toBe('Zona: Sin zona');
    const f = await generarHojaRutaFile(null);
    expect(f.size).toBeGreaterThan(300);
    expect(f.name).toBe('hoja_ruta_reparto.pdf');
  });

  it('AC-HRU-1 muchos pedidos: pagina y repite el encabezado sin explotar', async () => {
    const filas = Array.from({ length: 120 }, (_, i) => fila('Norte', i + 1, `Cliente ${i}`, 1000));
    const f = await generarHojaRutaFile({ filas, totales: { pedidos: 120, importe: 120000, saldoAnterior: 0, totalACobrar: 120000 } }, { fechas: ['2026-11-09'] });
    expect((await leer(f)).startsWith('%PDF')).toBe(true);
    expect(mockReg.textos.some(t => /Pedidos: 120/.test(t))).toBe(true);
  });
});
