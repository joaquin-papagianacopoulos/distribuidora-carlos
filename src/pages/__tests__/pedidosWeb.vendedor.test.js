// REQ-ASV (AC-ASV-2) en la bandeja de pedidos web: badge "Sin vendedor".
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockApp = {};
jest.mock('../../hooks/useAppContext', () => ({ useApp: () => mockApp }));
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }));
jest.mock('../../db', () => ({ addCliente: jest.fn() }));
jest.mock('../../services/pedidosWebService', () => ({
  encolarAccion: jest.fn(), sincronizarAcciones: jest.fn(), cargarAcciones: jest.fn(() => Promise.resolve([])),
  hayPinEnMemoria: jest.fn(() => true), cargarContactos: jest.fn(() => Promise.resolve({ ok: true, count: 0 })),
}));

// eslint-disable-next-line import/first
import PedidosWeb from '../PedidosWeb';
// eslint-disable-next-line import/first
import { cargarAcciones, hayPinEnMemoria, cargarContactos } from '../../services/pedidosWebService';

const web = (id, vendedor) => ({
  id, remoteId: `R${id}`, origen: 'web', webEstado: 'por_revisar', estado: 'pendiente', fecha: '2026-11-10', vendedor, vendedorNombre: vendedor,
  clienteNombre: `Cliente ${id}`, items: [], total: 0, webContacto: { nombre: `Cliente ${id}`, telefono: '3415551234', direccion: 'Mitre 1', ciudad: 'Rosario' },
});

let container;
let root;
const render = async () => { await act(async () => { root.render(<PedidosWeb />); }); };
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };

beforeEach(() => {
  // CRA resetea los mocks entre tests: se vuelven a definir.
  cargarAcciones.mockImplementation(() => Promise.resolve([]));
  hayPinEnMemoria.mockImplementation(() => true);
  cargarContactos.mockImplementation(() => Promise.resolve({ ok: true, count: 0 }));
  Object.keys(mockApp).forEach(k => delete mockApp[k]);
  Object.assign(mockApp, {
    pedidos: [web(1, 'WEB'), web(2, 'Carlos')], clientes: [], productos: [], vendedores: [{ id: 2, nombre: 'Carlos', permiso: 2 }],
    vendedorActual: { id: 1, nombre: 'Jorge', permiso: 1 }, online: true, recargar: jest.fn(() => Promise.resolve()),
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

describe('AC-ASV-2 bandeja Pedidos web', () => {
  it('AC-ASV-2 un pedido sin vendedor (link general o WEB) muestra el badge "Sin vendedor"', async () => {
    await render();
    const items = container.querySelectorAll('[data-testid="pedido-web"]');
    await click(items[0]);
    expect(container.querySelector('[data-testid="badge-sin-vendedor"]')).not.toBeNull();
    expect(container.textContent).toContain('sin vendedor (link general)');
  });

  it('AC-ASV-2 un pedido con vendedor del link no muestra el badge y nombra al vendedor', async () => {
    await render();
    const items = container.querySelectorAll('[data-testid="pedido-web"]');
    await click(items[1]);
    expect(container.querySelector('[data-testid="badge-sin-vendedor"]')).toBeNull();
    expect(container.textContent).toContain('Vendedor del link: Carlos');
  });
});
