// REQ-REN (AC-REN-3/4): saldo a favor en la boleta y PDF de la rendición del día (jsPDF real).
import { TextEncoder, TextDecoder } from 'util';
import { generarFacturaFile, generarRendicionDiaFile } from '../pdfGen';
import { resumenRendicionDia } from '../../domain/rendicion';

global.TextEncoder = global.TextEncoder || TextEncoder;
global.TextDecoder = global.TextDecoder || TextDecoder;

const mockReg = { textos: [] };
jest.mock('jspdf', () => {
  const real = jest.requireActual('jspdf');
  class JsPdfEspia extends real.jsPDF {
    constructor(...a) {
      super(...a);
      const text = this.text.bind(this);
      this.text = (t, x, y, ...r) => { mockReg.textos.push({ t: Array.isArray(t) ? t.join(' ') : String(t), x, y }); return text(t, x, y, ...r); };
    }
  }
  return { ...real, jsPDF: JsPdfEspia };
});

beforeEach(() => { mockReg.textos = []; });
const buscar = (re) => mockReg.textos.filter(x => re.test(x.t));
const pedido = { id: 7, clienteNombre: 'Kiosco', fecha: '2026-10-15', items: [{ productoId: 1, nombre: 'Alfajor', cantidad: 2, precio: 100 }] };

describe('AC-REN-3 boleta con saldo a favor', () => {
  it('AC-REN-3 muestra "Saldo a favor" cuando no hay deuda', async () => {
    await generarFacturaFile(pedido, {}, {}, 0, null, { saldoAFavor: 150 });
    expect(buscar(/^Saldo a favor: \$150$/)).toHaveLength(1);
    expect(buscar(/^Deuda pendiente/)).toHaveLength(0);
  });
  it('AC-REN-3 con deuda neta solo se muestra la deuda; sin opción nada cambia', async () => {
    await generarFacturaFile(pedido, {}, {}, 50, null, { saldoAFavor: 150 });
    expect(buscar(/^Saldo a favor/)).toHaveLength(0);
    expect(buscar(/^Deuda pendiente: \$50$/)).toHaveLength(1);
    mockReg.textos = [];
    await generarFacturaFile(pedido, {}, {}, 0, null);
    expect(buscar(/Saldo a favor|Deuda pendiente/)).toHaveLength(0);
  });
});

describe('AC-REN-4 PDF de la rendición del día', () => {
  it('AC-REN-4 lista filas (anuladas marcadas) y totales', async () => {
    const resumen = resumenRendicionDia([
      { id: 'aaaaaaaa-1', fecha: '2026-10-15', tipo: 'nc', estado: 'vigente', syncEstado: 'confirmada', creditoCents: 12345, clienteNombre: 'Kiosco', nroNc: '12', tipoFactura: 'A' },
      { id: 'bbbbbbbb-2', fecha: '2026-10-15', tipo: 'devolucion', estado: 'anulada', creditoCents: 500, motivoAnulacion: 'error', renglones: [] },
    ], '2026-10-15');
    const f = await generarRendicionDiaFile(resumen, { fecha: '2026-10-15' });
    expect(f.name).toBe('rendicion_2026-10-15.pdf');
    expect(buscar(/^Rendición del día 15\/10\/2026$/)).toHaveLength(1);
    expect(buscar(/Anuladas: 1/)).toHaveLength(1);
    const sinFecha = await generarRendicionDiaFile(undefined);
    expect(sinFecha.name).toBe('rendicion_.pdf');
  });
});
