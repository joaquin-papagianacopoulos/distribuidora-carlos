// REQ-PDF UI: actualizar precios desde PDF (AC-PDF-1, AC-PDF-2, AC-PDF-4, AC-PDF-5).
import React from 'react';
import { montar, flush, click, escribir, act } from '../../testUtils/ui';
import { itemsListaProveedor } from '../../domain/__fixtures__/pdfListaItems';

jest.mock('../../services/lectorPdf', () => ({ leerItemsPdf: jest.fn() }));
import { leerItemsPdf } from '../../services/lectorPdf';
import ImportarPreciosPdf from '../ImportarPreciosPdf';

const PRODUCTOS = [
  { id: 1, codigo: 'DC', nombre: 'Dos Corazones', precio: 800, costoFinal: 600, ganancia: 25 },
  { id: 2, codigo: 'G1', nombre: 'Gaseosa Cola', precio: 1250.5, costoFinal: 1000, ganancia: 25 },
];

let m;
const q = (sel) => m.cont.querySelector(sel);
const subir = async () => {
  const input = q('[data-testid="input-pdf"]');
  Object.defineProperty(input, 'files', { configurable: true, value: [new File(['%PDF'], 'lista.pdf', { type: 'application/pdf' })] });
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
  await flush();
};

beforeEach(() => { leerItemsPdf.mockResolvedValue({ ok: true, items: itemsListaProveedor, paginas: 1 }); });
afterEach(async () => { if (m) { await m.desmontar(); m = null; } jest.clearAllMocks(); });

describe('actualizar precios desde PDF', () => {
  it('AC-PDF-4 AC-PDF-5 vista previa en modo venta y aplica solo lo tildado', async () => {
    const onAplicar = jest.fn(async () => {});
    m = await montar(<ImportarPreciosPdf productos={PRODUCTOS} onAplicar={onAplicar} />);
    await subir();
    expect(q('[data-testid="preview-pdf"]').textContent).toContain('lista.pdf');
    expect(q('[data-testid="aplicar-pdf"]').disabled).toBe(true); // hasta elegir qué precio trae
    await click(q('[data-testid="modo-venta"]'));
    expect(q('[data-testid="resumen-pdf"]').textContent).toMatch(/1 para actualizar · 1 sin cambios/);
    const dc = Array.from(m.cont.querySelectorAll('[data-testid="fila-pdf"]')).find(f => f.textContent.includes('Dos Corazones x16'));
    expect(dc.textContent).toMatch(/\$800,00 → \$900,00 \(\+12\.5%\)/);
    await click(q('[data-testid="aplicar-pdf"]'));
    await flush();
    expect(onAplicar).toHaveBeenCalledWith([{ id: 1, cambios: { precio: 900 } }], 'venta');
    expect(q('[data-testid="pdf-msg"]').textContent).toMatch(/1 precio actualizado/);
  });

  it('AC-PDF-2 AC-PDF-5 modo costo con la columna sin IVA recalcula el precio de venta', async () => {
    const onAplicar = jest.fn(async () => {});
    m = await montar(<ImportarPreciosPdf productos={PRODUCTOS} onAplicar={onAplicar} />);
    await subir();
    await click(q('[data-testid="modo-costo"]'));
    await escribir(q('[data-testid="columna-pdf"]'), '0');
    await click(q('[data-testid="aplicar-pdf"]'));
    await flush();
    expect(onAplicar).toHaveBeenCalledWith([
      { id: 1, cambios: { costoFinal: 743.8, precio: 929.75 } },
      { id: 2, cambios: { costoFinal: 1033.47, precio: 1291.84 } },
    ], 'costo');
  });

  it('AC-PDF-4 destildar un renglón lo deja afuera', async () => {
    const onAplicar = jest.fn(async () => {});
    m = await montar(<ImportarPreciosPdf productos={PRODUCTOS} onAplicar={onAplicar} />);
    await subir();
    await click(q('[data-testid="modo-venta"]'));
    const dc = Array.from(m.cont.querySelectorAll('[data-testid="fila-pdf"]')).find(f => f.dataset.estado === 'actualizar');
    await click(dc.querySelector('input[type="checkbox"]'));
    expect(q('[data-testid="aplicar-pdf"]').disabled).toBe(true);
    expect(onAplicar).not.toHaveBeenCalled();
  });

  it('AC-PDF-1 PDF escaneado o ilegible: mensaje claro y sin vista previa', async () => {
    leerItemsPdf.mockResolvedValue({ ok: false, mensaje: 'El PDF no tiene texto (parece escaneado).' });
    m = await montar(<ImportarPreciosPdf productos={PRODUCTOS} onAplicar={jest.fn()} />);
    await subir();
    expect(q('[data-testid="pdf-msg"]').textContent).toMatch(/escaneado/);
    expect(q('[data-testid="preview-pdf"]')).toBeNull();
  });
});
