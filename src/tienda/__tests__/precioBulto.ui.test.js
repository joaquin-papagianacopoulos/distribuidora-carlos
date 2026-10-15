// AC-PBU-4 / AC-MIN-1: la tienda muestra el precio llevando bulto y el mínimo efectivo.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import TarjetaProducto from '../TarjetaProducto';
import { precioUnitarioTienda } from '../../domain/tienda';
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
  await act(async () => { root.render(<TarjetaProducto prod={prod} navegar={() => {}} onAgregar={() => {}} />); });
};

describe('AC-PBU-4 tarjeta de la tienda', () => {
  it('AC-PBU-4 muestra "Llevando el display: $800 c/u" cuando hay precio por bulto', async () => {
    await render(conPrecioBulto);
    expect(container.querySelector('[data-testid="precio-bulto"]').textContent).toBe('Llevando el display: $800 c/u');
  });

  it('AC-PBU-4 sin precio por bulto no muestra la leyenda', async () => {
    await render(dosCorazones);
    expect(container.querySelector('[data-testid="precio-bulto"]')).toBeNull();
  });

  it('AC-PBU-4 precioUnitarioTienda (precioVisto) cambia al llegar al bulto', () => {
    expect(precioUnitarioTienda(conPrecioBulto, 15)).toBe(900);
    expect(precioUnitarioTienda(conPrecioBulto, 16)).toBe(800);
    expect(precioUnitarioTienda(null, 16)).toBeNull();
  });
});
