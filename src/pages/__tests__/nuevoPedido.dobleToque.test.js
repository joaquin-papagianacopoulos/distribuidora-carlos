// AC-IDP-1: tocar dos veces "Guardar Pedido" no duplica el pedido.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockApp = {};
jest.mock('../../hooks/useAppContext', () => ({ useApp: () => mockApp }));
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn(() => { throw new Error('no deberia llamar a Supabase'); }) } }));
jest.mock('../../db', () => ({
  addCliente: jest.fn(() => Promise.resolve('c-nuevo')),
  updateCliente: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../services/pedidoRepository', () => ({ crearPedidoOnlineFirst: jest.fn() }));

// eslint-disable-next-line import/first
import NuevoPedido from '../NuevoPedido';
// eslint-disable-next-line import/first
import { crearPedidoOnlineFirst } from '../../services/pedidoRepository';

const PROD = { id: 'p1', nombre: 'Alfajor', codigo: 'AL', precio: 100 };
const CLIENTE = { id: 'c1', nombre: 'Kiosco Pepe', direccion: 'Mitre 123', telefono: '' };
let container; let root;

const render = async () => { await act(async () => { root.render(<NuevoPedido />); }); };
const escribir = async (el, valor) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  await act(async () => { setter.call(el, valor); el.dispatchEvent(new Event('input', { bubbles: true })); });
};
const mousedown = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); }); };
const q = (sel) => container.querySelector(sel);
const sugerencia = (txt) => [...container.querySelectorAll('.suggestion-item')].find(s => s.textContent.includes(txt));
const guardarBtn = () => [...container.querySelectorAll('button')].find(b => /Guardar Pedido|Guardando/.test(b.textContent));

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  Object.assign(mockApp, {
    productos: [PROD], clientes: [CLIENTE], vendedores: [], vendedorActual: { id: 2, nombre: 'Vend', permiso: 2, zona: 'Norte' },
    zonaActiva: '', setZona: jest.fn(), recargar: jest.fn(() => Promise.resolve()), stockMap: new Map(),
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => { root.unmount(); }); container.remove(); localStorage.clear(); });

const prepararPedido = async () => {
  await render();
  await escribir(q('input[placeholder^="Ej: 9 de oro"]'), 'Alfajor');
  await mousedown(sugerencia('Alfajor'));
  await escribir(q('input[placeholder="Nombre del cliente..."]'), 'Kiosco');
  await mousedown(sugerencia('Kiosco Pepe'));
};

describe('AC-IDP-1 doble toque en Guardar Pedido', () => {
  it('AC-IDP-1 dos toques seguidos con el guardado en curso crean UN solo pedido', async () => {
    let terminar;
    crearPedidoOnlineFirst.mockImplementation(() => new Promise((res) => { terminar = () => res({ mode: 'online' }); }));
    await prepararPedido();
    const btn = guardarBtn();
    await act(async () => {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true })); // segundo toque inmediato
    });
    expect(crearPedidoOnlineFirst).toHaveBeenCalledTimes(1);
    expect(guardarBtn().disabled).toBe(true);
    expect(guardarBtn().textContent).toContain('Guardando');
    await act(async () => { terminar(); });
  });

  it('AC-IDP-1 el pedido lleva un clientUuid propio y offline avisa que se sube solo al volver la conexión', async () => {
    crearPedidoOnlineFirst.mockResolvedValue({ mode: 'offline', localId: 1 });
    await prepararPedido();
    await act(async () => { guardarBtn().dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(crearPedidoOnlineFirst.mock.calls[0][0].clientUuid).toEqual(expect.any(String));
    expect(container.textContent).toContain('sin subir');
  });
});
