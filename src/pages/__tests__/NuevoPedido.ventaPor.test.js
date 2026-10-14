// REQ-VTA (AC-VTA-2, AC-VTA-3) en Nuevo pedido: unidad de venta por bulto.
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
const ADMIN = { id: 1, nombre: 'Admin', permiso: 1 };

const DOS_CORAZONES = { id: 'dc', nombre: 'Dos Corazones', codigo: 'DC', precio: 900, bultoX: 16, ventaPor: 'bulto', bultoNombre: 'Display' };
const VIEJO = { id: 'v1', nombre: 'Coca 500', codigo: 'CC', precio: 10, bultoX: 12 }; // sin campos nuevos

let container;
let root;

const setApp = (over = {}) => {
  Object.keys(mockApp).forEach(k => delete mockApp[k]);
  Object.assign(mockApp, {
    productos: [DOS_CORAZONES, VIEJO],
    clientes: [],
    vendedores: [],
    vendedorActual: VENDEDOR,
    zonaActiva: '',
    setZona: jest.fn(),
    recargar: jest.fn(() => Promise.resolve()),
    stockMap: new Map(),
    ...over,
  });
};

const render = async () => { await act(async () => { root.render(<NuevoPedido />); }); };
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
const mousedown = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); }); };
const escribir = async (el, valor) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  await act(async () => { setter.call(el, valor); el.dispatchEvent(new Event('input', { bubbles: true })); });
};
const buscador = () => container.querySelector('input[placeholder^="Ej: 9 de oro"]');
const sugerencia = (txt) => [...container.querySelectorAll('.suggestion-item')].find(s => s.textContent.includes(txt));
const cantidadInput = () => container.querySelector('input[inputmode="numeric"]');
const aviso = () => container.querySelector('[data-testid="aviso-multiplo"]');
const textoBultos = () => container.querySelector('[data-testid="texto-bultos"]');
const botonGuardar = () => [...container.querySelectorAll('button')].find(b => b.textContent.includes('Guardar Pedido'));
const qtyBtn = (txt) => [...container.querySelectorAll('.qty-btn')].find(b => b.textContent === txt);

const agregar = async (nombre) => {
  await escribir(buscador(), nombre);
  await mousedown(sugerencia(nombre));
};
const ponerCliente = async () => {
  await escribir(container.querySelector('input[placeholder="Nombre del cliente..."]'), 'Kiosco');
};

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  window.alert = jest.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  localStorage.clear();
});

describe('REQ-VTA Nuevo pedido', () => {
  test('AC-VTA-3 un producto "solo bulto" arranca en 1 Display (16 u.) y +/- se mueven de a 16', async () => {
    setApp();
    await render();
    await agregar('Dos Corazones');
    expect(cantidadInput().value).toBe('16');
    expect(textoBultos().textContent).toBe('1 Display (16 u.)');
    await mousedown(qtyBtn('+'));
    expect(cantidadInput().value).toBe('32');
    expect(textoBultos().textContent).toBe('2 Display (32 u.)');
    await mousedown(qtyBtn('−'));
    await mousedown(qtyBtn('−'));
    expect(cantidadInput().value).toBe('16');
  });

  test('AC-VTA-3 el boton de bulto usa la etiqueta del producto y muestra el precio del bulto', async () => {
    setApp();
    await render();
    await agregar('Dos Corazones');
    expect(container.querySelector('[data-testid="bulto-mas"]').textContent).toBe('+ Display (x 16)');
    expect(container.querySelector('[data-testid="bulto-menos"]').textContent).toBe('− Display');
    expect(container.querySelector('[data-testid="bulto-precio"]').textContent).toContain('14.400');
    // "- Display" no baja de 1 Display
    expect(container.querySelector('[data-testid="bulto-menos"]').disabled).toBe(true);
    await click(container.querySelector('[data-testid="bulto-mas"]'));
    expect(cantidadInput().value).toBe('32');
  });

  test('AC-VTA-3 tipear 20 muestra el aviso y el vendedor no puede guardar', async () => {
    setApp();
    await render();
    await agregar('Dos Corazones');
    await ponerCliente();
    await escribir(cantidadInput(), '20');
    expect(aviso().textContent).toContain('Se vende por Display de 16: 20 u. no es múltiplo');
    await click(botonGuardar());
    expect(crearPedidoOnlineFirst).not.toHaveBeenCalled();
    expect(window.alert).toHaveBeenCalledTimes(1);
  });

  test('AC-VTA-3 el admin tampoco guarda un no multiplo desde Nuevo pedido (solo en Facturacion)', async () => {
    setApp({ vendedorActual: ADMIN });
    await render();
    await agregar('Dos Corazones');
    await ponerCliente();
    await escribir(cantidadInput(), '20');
    await click(botonGuardar());
    expect(crearPedidoOnlineFirst).not.toHaveBeenCalled();
  });

  test('AC-VTA-2 guarda cantidad en unidades (48) con bultos 3 / bultoX 16 / Display congelados', async () => {
    setApp();
    await render();
    await agregar('Dos Corazones');
    await ponerCliente();
    await click(container.querySelector('[data-testid="bulto-mas"]'));
    await click(container.querySelector('[data-testid="bulto-mas"]'));
    expect(textoBultos().textContent).toBe('3 Display (48 u.)');
    await click(botonGuardar());
    expect(crearPedidoOnlineFirst).toHaveBeenCalledTimes(1);
    const [pedido] = crearPedidoOnlineFirst.mock.calls[0];
    expect(pedido.items).toHaveLength(1);
    expect(pedido.items[0]).toMatchObject({ productoId: 'dc', cantidad: 48, precio: 900, bultos: 3, bultoX: 16, bultoNombre: 'Display' });
    expect(pedido.items[0]).not.toHaveProperty('_cantidadPorDefecto');
    expect(pedido.total).toBe(43200);
  });

  test('AC-VTA-2 producto viejo sin campos nuevos: arranca en 1, no pide multiplo y no congela nada', async () => {
    setApp();
    await render();
    await agregar('Coca 500');
    await ponerCliente();
    expect(cantidadInput().value).toBe('1');
    await escribir(cantidadInput(), '5');
    expect(aviso()).toBeNull();
    await click(botonGuardar());
    expect(crearPedidoOnlineFirst).toHaveBeenCalledTimes(1);
    const [pedido] = crearPedidoOnlineFirst.mock.calls[0];
    expect(pedido.items[0]).toMatchObject({ productoId: 'v1', cantidad: 5 });
    expect(pedido.items[0]).not.toHaveProperty('bultos');
    expect(pedido.items[0]).not.toHaveProperty('bultoX');
  });
});
