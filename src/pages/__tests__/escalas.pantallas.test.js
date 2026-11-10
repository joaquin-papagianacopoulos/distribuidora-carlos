// AC-ESC-3: Nuevo Pedido muestra la escala aplicada ("x5 bultos -8 %") y re-precia al cambiar la cantidad.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockApp = {};
jest.mock('../../hooks/useAppContext', () => ({ useApp: () => mockApp }));
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn(() => { throw new Error('no deberia llamar a Supabase'); }) } }));
jest.mock('../../db', () => ({ addCliente: jest.fn(() => Promise.resolve('c-nuevo')) }));
jest.mock('../../services/pedidoRepository', () => ({ crearPedidoOnlineFirst: jest.fn(() => Promise.resolve()) }));

// eslint-disable-next-line import/first
import NuevoPedido from '../NuevoPedido';

const VENDEDOR = { id: 2, nombre: 'Vend', permiso: 2, zona: 'Norte' };
const ESC = [{ desde: 5, pct: 8 }, { desde: 10, pct: 12 }];
let container;
let root;

const sembrar = (cantidad, extra = {}) => {
  localStorage.setItem(`nuevoPedidoDraft:${VENDEDOR.id}`, JSON.stringify({
    version: 1,
    clienteQ: 'Kiosco', clienteNombre: 'Kiosco', direccion: 'Mitre 123',
    items: [{ productoId: 'p1', nombre: 'Coca 500', precio: 1000, precioOriginal: 1000, precioBultoX: 10, escalasBulto: ESC, cantidad, ...extra }],
  }));
};
const setApp = () => {
  Object.keys(mockApp).forEach(k => delete mockApp[k]);
  Object.assign(mockApp, {
    productos: [{ id: 'p1', nombre: 'Coca 500', codigo: 'CC', precio: 1000, bultoX: 10, escalasBulto: ESC }],
    clientes: [], vendedores: [], vendedorActual: VENDEDOR, zonaActiva: '', setZona: jest.fn(),
    recargar: jest.fn(() => Promise.resolve()), stockMap: new Map(),
  });
};
const render = async () => { await act(async () => { root.render(<NuevoPedido />); }); };
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
const escala = () => container.querySelector('[data-testid="escala-aplicada"]');

beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  localStorage.clear();
});

describe('AC-ESC-3 Nuevo Pedido con escalas', () => {
  test('AC-ESC-3 sin llegar a la escala no se muestra nada', async () => {
    setApp();
    sembrar(40);
    await render();
    expect(escala()).toBeNull();
  });

  test('AC-ESC-3 al sumar un bulto cruza la escala y la muestra', async () => {
    setApp();
    sembrar(40);
    await render();
    await click(container.querySelector('[data-testid="bulto-mas"]'));
    expect(escala().textContent).toContain('x5 bultos');
    expect(escala().textContent).toContain('8 %');
  });

  test('AC-ESC-3 al restar un bulto vuelve a precio de lista (la etiqueta desaparece)', async () => {
    setApp();
    sembrar(50, { precio: 920, escalaDesde: 5, escalaPct: 8 });
    await render();
    expect(escala()).not.toBeNull();
    await click(container.querySelector('[data-testid="bulto-menos"]'));
    expect(escala()).toBeNull();
  });

  test('AC-ESC-3 con precio manual no se toca ni se etiqueta (AC-PBU-3)', async () => {
    setApp();
    sembrar(40, { precio: 900, precioManual: true });
    await render();
    await click(container.querySelector('[data-testid="bulto-mas"]'));
    expect(escala()).toBeNull();
  });
});
