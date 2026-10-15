// REQ-PAN (AC-PAN-4): grafico de barras SVG propio.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import GraficoBarras from '../GraficoBarras';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let container; let root;
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => { root.unmount(); }); container.remove(); });
const render = async (props) => { await act(async () => { root.render(<GraficoBarras {...props} />); }); };

describe('AC-PAN-4 GraficoBarras', () => {
  it('AC-PAN-4 una barra por dato, con role img, título y etiquetas', async () => {
    await render({ titulo: 'Ventas', barras: [{ etiqueta: 'S1', valorCents: 1000 }, { etiqueta: 'S2', valorCents: 0 }, { etiqueta: 'S3', valorCents: 500 }] });
    const svg = container.querySelector('svg[role="img"]');
    expect(svg.getAttribute('aria-label')).toBe('Ventas');
    expect(svg.querySelector('title').textContent).toBe('Ventas');
    expect(container.querySelectorAll('[data-testid="barra"]')).toHaveLength(3);
    expect(container.textContent).toContain('S3');
  });
  it('AC-PAN-4 las barras negativas se dibujan bajo el eje y las positivas sobre él', async () => {
    await render({ barras: [{ etiqueta: 'a', valorCents: 1000 }, { etiqueta: 'b', valorCents: -500 }] });
    const eje = Number(container.querySelector('line').getAttribute('y1'));
    const [pos, neg] = [...container.querySelectorAll('rect')];
    expect(Number(pos.getAttribute('y')) + Number(pos.getAttribute('height'))).toBeCloseTo(eje);
    expect(Number(neg.getAttribute('y'))).toBeCloseTo(eje);
    expect(neg.getAttribute('fill')).not.toBe(pos.getAttribute('fill'));
  });
  it('AC-PAN-4 sin datos no rompe', async () => {
    await render({ barras: [] });
    expect(container.querySelectorAll('rect')).toHaveLength(0);
  });
});
