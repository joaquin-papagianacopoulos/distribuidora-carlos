// REQ-PBU / REQ-MIN / REQ-SST en Nuevo pedido.
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
// eslint-disable-next-line import/first
import { crearPedidoOnlineFirst } from '../../services/pedidoRepository';

const VENDEDOR = { id: 2, nombre: 'Vend', permiso: 2, zona: 'Norte' };
let container;
let root;

// Unidad $10, llevando bulto (x12) $8.
const producto = (over = {}) => ({ id: 'p1', nombre: 'Coca 500', codigo: 'CC', precio: 10, precioBulto: 8, bultoX: 12, ventaPor: 'ambos', ...over });

const sembrar = (cantidad, extra = {}, vendedor = VENDEDOR) => {
  localStorage.setItem(`nuevoPedidoDraft:${vendedor.id}`, JSON.stringify({
    version: 1,
    clienteQ: 'Kiosco',
    clienteNombre: 'Kiosco', direccion: 'Mitre 123',
    items: [{ productoId: 'p1', nombre: 'Coca 500', precio: 10, precioOriginal: 10, precioBultoOriginal: 8, precioBultoX: 12, precioPorBulto: false, cantidad, ...extra }],
  }));
};

const setApp = (over = {}) => {
  Object.keys(mockApp).forEach(k => delete mockApp[k]);
  Object.assign(mockApp, {
    productos: [producto()], clientes: [], vendedores: [], vendedorActual: VENDEDOR, zonaActiva: '',
    setZona: jest.fn(), recargar: jest.fn(() => Promise.resolve()), stockMap: new Map(), ...over,
  });
};

const render = async () => { await act(async () => { root.render(<NuevoPedido />); }); };
const precioInput = () => container.querySelector('input[type="number"]');
const botonMenos = () => container.querySelectorAll('.qty-btn')[0];
const botonMas = () => container.querySelectorAll('.qty-btn')[1];
const guardarBtn = () => [...container.querySelectorAll('button')].find(b => b.textContent.includes('Guardar Pedido'));
const click = async (el) => {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};

beforeEach(() => {
  jest.clearAllMocks();
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

describe('AC-PBU-3 Nuevo pedido: precio llevando bulto', () => {
  test('AC-PBU-3 al llegar a 1 bulto el precio baja a $8 y al bajar vuelve a $10', async () => {
    setApp();
    sembrar(11);
    await render();
    expect(precioInput().value).toBe('10');
    await click(botonMas()); // 12 u. = 1 bulto
    expect(precioInput().value).toBe('8');
    expect(container.querySelector('[data-testid="precio-por-bulto"]')).not.toBeNull();
    await click(botonMenos()); // 11 u.
    expect(precioInput().value).toBe('10');
    expect(container.querySelector('[data-testid="precio-por-bulto"]')).toBeNull();
  });

  test('AC-PBU-3 un precio manual del renglón se respeta al cruzar el bulto', async () => {
    const admin = { id: 1, nombre: 'Admin', permiso: 1 };
    setApp({ vendedorActual: admin });
    sembrar(11, { precio: 9, precioManual: true }, admin);
    await render();
    await click(botonMas());
    expect(precioInput().value).toBe('9');
  });
});

describe('AC-MIN-1 Nuevo pedido: mínimo', () => {
  test('AC-MIN-1 bajo el mínimo hay error en el renglón y no se guarda', async () => {
    setApp({ productos: [producto({ minimoVenta: 6, precioBulto: 0 })] });
    sembrar(2);
    await render();
    expect(container.querySelector('[data-testid="error-minimo"]').textContent).toContain('Mínimo para pedir: 6');
    await click(guardarBtn());
    expect(crearPedidoOnlineFirst).not.toHaveBeenCalled();
  });

  test('AC-MIN-1 cumpliendo el mínimo se guarda', async () => {
    setApp({ productos: [producto({ minimoVenta: 6, precioBulto: 0 })] });
    sembrar(6);
    await render();
    expect(container.querySelector('[data-testid="error-minimo"]')).toBeNull();
    await click(guardarBtn());
    expect(crearPedidoOnlineFirst).toHaveBeenCalledTimes(1);
  });
});

describe('AC-SST-1 Nuevo pedido: sin stock avisa pero nunca bloquea', () => {
  test('AC-SST-1 muestra "Sin stock (hay 3)" y igual guarda', async () => {
    setApp({ stockMap: new Map([['p1', 3]]) });
    sembrar(5);
    await render();
    expect(container.querySelector('[data-testid="aviso-stock"]').textContent).toContain('Sin stock (hay 3)');
    await click(guardarBtn());
    expect(crearPedidoOnlineFirst).toHaveBeenCalledTimes(1);
  });
});
