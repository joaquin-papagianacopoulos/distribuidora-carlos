// AC-PBU-4: en la ficha, al elegir comprar por bulto el precio grande pasa a ser el del bulto.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import DetalleProducto from '../DetalleProducto';
import { conPrecioBulto, dosCorazones } from '../../domain/__fixtures__/tiendaCasos';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
});

const render = async (prod) => {
  await act(async () => {
    root.render(<DetalleProducto prod={prod} productos={[prod]} config={{}} onAgregar={() => {}} navegar={() => {}} search="" cantidadCarrito={0} nombreTienda="Tienda" />);
  });
};
const precio = () => container.querySelector('[data-testid="precio-principal"]').textContent;

describe('AC-PBU-4 precio grande por bulto en la ficha', () => {
  it('AC-PBU-4 por unidad muestra el unitario; al elegir Display muestra el total del bulto con su c/u y ahorro', async () => {
    await render(conPrecioBulto);
    expect(precio()).toContain('$900 por unidad');
    const radioBulto = [...container.querySelectorAll('input[name="modo"]')][1];
    await act(async () => { radioBulto.click(); });
    expect(precio()).toContain('$12.800');
    expect(precio()).toContain('por Display x16 · $800 c/u');
    expect(precio()).toContain('11% OFF');
    expect(container.querySelector('.t-precio-anterior').textContent).toBe('$14.400');
    expect(container.textContent).toContain('Por unidad: $900');
  });

  it('AC-PBU-4 producto que se vende solo por bulto arranca con el precio del bulto', async () => {
    await render(dosCorazones);
    expect(precio()).toContain('$14.400');
    expect(precio()).toContain('por Display x16 · $900 c/u');
    expect(precio()).not.toContain('OFF');
  });
});
