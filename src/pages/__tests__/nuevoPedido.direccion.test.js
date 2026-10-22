// REQ-DIR (AC-DIR-1, supuesto S1) en Nuevo pedido: dirección de entrega exacta obligatoria.
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
jest.mock('../../services/pedidoRepository', () => ({ crearPedidoOnlineFirst: jest.fn(() => Promise.resolve()) }));

// eslint-disable-next-line import/first
import NuevoPedido from '../NuevoPedido';
// eslint-disable-next-line import/first
import { addCliente, updateCliente } from '../../db';
// eslint-disable-next-line import/first
import { crearPedidoOnlineFirst } from '../../services/pedidoRepository';

const PROD = { id: 'p1', nombre: 'Alfajor', codigo: 'AL', precio: 100 };
const CLIENTE = { id: 'c1', nombre: 'Kiosco Pepe', direccion: '', telefono: '' };

let container;
let root;

const setApp = (over = {}) => {
  Object.keys(mockApp).forEach(k => delete mockApp[k]);
  Object.assign(mockApp, {
    productos: [PROD], clientes: [CLIENTE], vendedores: [], vendedorActual: { id: 2, nombre: 'Vend', permiso: 2, zona: 'Norte' },
    zonaActiva: '', setZona: jest.fn(), recargar: jest.fn(() => Promise.resolve()), stockMap: new Map(), ...over,
  });
};
const render = async () => { await act(async () => { root.render(<NuevoPedido />); }); };
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
const mousedown = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); }); };
const escribir = async (el, valor) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  await act(async () => { setter.call(el, valor); el.dispatchEvent(new Event('input', { bubbles: true })); });
};
const q = (sel) => container.querySelector(sel);
const sugerencia = (txt) => [...container.querySelectorAll('.suggestion-item')].find(s => s.textContent.includes(txt));
const guardarBtn = () => [...container.querySelectorAll('button')].find(b => b.textContent.includes('Guardar Pedido'));

const cargarProducto = async () => {
  await escribir(q('input[placeholder^="Ej: 9 de oro"]'), 'Alfajor');
  await mousedown(sugerencia('Alfajor'));
};

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  setApp();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  localStorage.clear();
});

describe('REQ-DIR Nuevo pedido', () => {
  it('AC-DIR-1 cliente sin dirección: el botón está deshabilitado; con calle sin número muestra error; con calle y número guarda y actualiza el cliente', async () => {
    await render();
    await cargarProducto();
    await escribir(q('input[placeholder="Nombre del cliente..."]'), 'Kiosco');
    await mousedown(sugerencia('Kiosco Pepe'));
    expect(guardarBtn().disabled).toBe(true);
    await escribir(q('#np-direccion'), 'Calle Mitre');
    expect(guardarBtn().disabled).toBe(true);
    expect(q('[data-testid="error-direccion"]')).not.toBeNull();
    await escribir(q('#np-direccion'), 'Mitre 123');
    expect(guardarBtn().disabled).toBe(false);
    expect(q('[data-testid="error-direccion"]')).toBeNull();
    await click(guardarBtn());
    expect(crearPedidoOnlineFirst).toHaveBeenCalledTimes(1);
    expect(updateCliente).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1', direccion: 'Mitre 123' }));
    expect(addCliente).not.toHaveBeenCalled();
  });

  it('AC-DIR-1 cliente con dirección exacta: se precarga y no se vuelve a escribir en el cliente', async () => {
    setApp({ clientes: [{ ...CLIENTE, direccion: 'Mitre 123' }] });
    await render();
    await cargarProducto();
    await escribir(q('input[placeholder="Nombre del cliente..."]'), 'Kiosco');
    await mousedown(sugerencia('Kiosco Pepe'));
    expect(q('#np-direccion').value).toBe('Mitre 123');
    await click(guardarBtn());
    expect(crearPedidoOnlineFirst).toHaveBeenCalledTimes(1);
    expect(updateCliente).not.toHaveBeenCalled();
  });

  it('AC-DIR-1 cliente nuevo: se da de alta con la dirección ingresada', async () => {
    await render();
    await cargarProducto();
    await escribir(q('input[placeholder="Nombre del cliente..."]'), 'Cliente Nuevo');
    expect(guardarBtn().disabled).toBe(true);
    await escribir(q('#np-direccion'), 'Sarmiento 45');
    await click(guardarBtn());
    expect(addCliente).toHaveBeenCalledWith(expect.objectContaining({ nombre: 'Cliente Nuevo', direccion: 'Sarmiento 45' }));
    expect(crearPedidoOnlineFirst).toHaveBeenCalledTimes(1);
  });
});
