// REQ-ASV (AC-ASV-1) en Nuevo pedido: selector "Vendedor del pedido" y datos guardados.
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
import { crearPedidoOnlineFirst } from '../../services/pedidoRepository';

const PROD = { id: 'p1', nombre: 'Alfajor', codigo: 'AL', precio: 100 };
const CLIENTE = { id: 'c1', nombre: 'Kiosco Pepe', direccion: 'Mitre 123', telefono: '' };
const ADMIN = { id: 1, remoteId: 'r1', nombre: 'Jorge', permiso: 1 };
const CARLOS = { id: 2, remoteId: 'r2', nombre: 'Carlos', permiso: 2, zona: 'Norte' };
const LU = { id: 3, nombre: 'Lu', permiso: 2, zona: 'Sur' };
const BAJA = { id: 4, nombre: 'Baja', permiso: 2, activo: false };

let container;
let root;
const setApp = (over = {}) => {
  Object.keys(mockApp).forEach(k => delete mockApp[k]);
  Object.assign(mockApp, {
    productos: [PROD], clientes: [CLIENTE], vendedores: [ADMIN, CARLOS, LU, BAJA], vendedorActual: ADMIN,
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
const elegir = async (el, valor) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
  await act(async () => { setter.call(el, valor); el.dispatchEvent(new Event('change', { bubbles: true })); });
};
const q = (sel) => container.querySelector(sel);
const sugerencia = (txt) => [...container.querySelectorAll('.suggestion-item')].find(s => s.textContent.includes(txt));
const guardarBtn = () => [...container.querySelectorAll('button')].find(b => b.textContent.includes('Guardar Pedido'));
const cargarTodo = async () => {
  await escribir(q('input[placeholder^="Ej: 9 de oro"]'), 'Alfajor');
  await mousedown(sugerencia('Alfajor'));
  await escribir(q('input[placeholder="Nombre del cliente..."]'), 'Kiosco');
  await mousedown(sugerencia('Kiosco Pepe'));
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

describe('AC-ASV-1 selector "Vendedor del pedido" en Nuevo pedido', () => {
  it('AC-ASV-1 el admin ve el selector con los vendedores activos (sin dados de baja ni el mismo)', async () => {
    await render();
    const sel = q('#np-vendedor');
    expect(sel).not.toBeNull();
    const valores = [...sel.querySelectorAll('option')].map(o => o.value);
    expect(valores).toEqual(['', 'r2', '3']);
    expect(sel.textContent).toContain('Jorge (yo)');
    expect(sel.textContent).not.toContain('Baja');
  });

  it('AC-ASV-1 el admin carga a nombre de otro: guarda vendedor, vendedorId, cargadoPor y la zona del dueño', async () => {
    await render();
    await cargarTodo();
    await elegir(q('#np-vendedor'), 'r2');
    await click(guardarBtn());
    expect(crearPedidoOnlineFirst).toHaveBeenCalledTimes(1);
    expect(crearPedidoOnlineFirst.mock.calls[0][0]).toMatchObject({
      vendedor: 'Carlos', vendedorNombre: 'Carlos', vendedorId: 'r2', cargadoPor: 'Jorge', cargadoPorId: 1, zona: 'Norte',
    });
  });

  it('AC-ASV-1 por defecto el pedido es del que lo carga (cargadoPor = vendedor)', async () => {
    await render();
    await cargarTodo();
    await click(guardarBtn());
    expect(crearPedidoOnlineFirst.mock.calls[0][0]).toMatchObject({ vendedor: 'Jorge', vendedorId: 'r1', cargadoPor: 'Jorge' });
  });

  it('AC-ASV-1 un vendedor tambien puede cargar a nombre de otro vendedor activo', async () => {
    setApp({ vendedorActual: CARLOS });
    await render();
    expect(q('#np-vendedor')).not.toBeNull();
    await cargarTodo();
    await elegir(q('#np-vendedor'), '3');
    await click(guardarBtn());
    expect(crearPedidoOnlineFirst.mock.calls[0][0]).toMatchObject({ vendedor: 'Lu', vendedorId: 3, cargadoPor: 'Carlos' });
  });

  it('AC-ASV-1 sin otros vendedores activos el selector no aparece; el armador no elige', async () => {
    setApp({ vendedores: [ADMIN] });
    await render();
    expect(q('#np-vendedor')).toBeNull();
    setApp({ vendedorActual: { id: 9, nombre: 'Ana', permiso: 3 } });
    await render();
    expect(q('#np-vendedor')).toBeNull();
  });
});
