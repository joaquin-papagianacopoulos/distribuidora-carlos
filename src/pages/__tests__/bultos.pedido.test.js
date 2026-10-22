// REQ-BUL en Nuevo Pedido: botón Bulto en el renglón, desglose, avisos y permisos.
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
const ADMIN = { id: 1, nombre: 'Admin', permiso: 1 };

let container;
let root;

const producto = (over = {}) => ({ id: 'p1', nombre: 'Coca 500', codigo: 'CC', precio: 10, bultoX: 12, ...over });

const sembrarBorrador = (vendedor, cantidad = 5, extra = {}) => {
  localStorage.setItem(`nuevoPedidoDraft:${vendedor.id}`, JSON.stringify({
    version: 1,
    clienteQ: 'Kiosco',
    clienteNombre: 'Kiosco', direccion: 'Mitre 123',
    items: [{ productoId: 'p1', nombre: 'Coca 500', precio: 10, precioOriginal: 10, cantidad, ...extra }],
  }));
};

const setApp = (over = {}) => {
  Object.keys(mockApp).forEach(k => delete mockApp[k]);
  Object.assign(mockApp, {
    productos: [producto()],
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
const mas = () => container.querySelector('[data-testid="bulto-mas"]');
const menos = () => container.querySelector('[data-testid="bulto-menos"]');
const desglose = () => container.querySelector('[data-testid="bulto-desglose"]');
const cantidadInput = () => container.querySelector('input[inputmode="numeric"]');
const avisos = () => container.querySelector('[data-testid="aviso-stock"]');
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };

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

describe('REQ-BUL Nuevo Pedido', () => {
  test('AC-BUL-1 producto con bulto x12 muestra "+ Bulto (x 12)"', async () => {
    setApp();
    sembrarBorrador(VENDEDOR);
    await render();
    expect(mas().textContent).toBe('+ Bulto (x 12)');
  });

  test('AC-BUL-1 producto con bulto x1 no muestra el botón', async () => {
    setApp({ productos: [producto({ bultoX: 1 })] });
    sembrarBorrador(VENDEDOR);
    await render();
    expect(mas()).toBeNull();
    expect(menos()).toBeNull();
  });

  test('AC-BUL-2 renglón en 5 + 3 toques de bulto x12 queda en 41', async () => {
    setApp();
    sembrarBorrador(VENDEDOR, 5);
    await render();
    await click(mas());
    await click(mas());
    await click(mas());
    expect(cantidadInput().value).toBe('41');
    expect(desglose().textContent).toBe('41 u. = 3 bultos + 5 u.');
    // El borrador persistido guarda solo la cantidad (sin bultoX).
    const draft = JSON.parse(localStorage.getItem('nuevoPedidoDraft:2'));
    expect(draft.items[0].cantidad).toBe(41);
    expect(draft.items[0].bultoX).toBeUndefined();
  });

  test('AC-BUL-3 "− Bulto" desde 5 deja 1 y el renglón sigue existiendo', async () => {
    setApp();
    sembrarBorrador(VENDEDOR, 5);
    await render();
    await click(menos());
    expect(cantidadInput().value).toBe('1');
    expect(container.textContent).toContain('Coca 500');
    expect(menos().disabled).toBe(true);
  });

  test('AC-BUL-3 "− Bulto" desde 41 deja 29', async () => {
    setApp();
    sembrarBorrador(VENDEDOR, 41);
    await render();
    await click(menos());
    expect(cantidadInput().value).toBe('29');
  });

  test('AC-BUL-4 el desglose usa el bultoX actual del producto (12 a 6)', async () => {
    setApp();
    sembrarBorrador(VENDEDOR, 36, { bultoX: 99 });
    await render();
    expect(desglose().textContent).toBe('36 u. = 3 bultos');
    mockApp.productos = [producto({ bultoX: 6 })];
    await render();
    expect(desglose().textContent).toBe('36 u. = 6 bultos');
    expect(mas().textContent).toBe('+ Bulto (x 6)');
  });

  test('AC-BUL-6 AC-MIN-1 AC-SST-1 el error de mínimo y el aviso de stock siguen la cantidad resultante', async () => {
    setApp({
      productos: [producto({ minimoVenta: 24 })],
      stockMap: new Map([['p1', 30]]),
    });
    sembrarBorrador(VENDEDOR, 1);
    await render();
    const errorMin = () => container.querySelector('[data-testid="error-minimo"]');
    expect(errorMin().textContent).toContain('Mínimo para pedir: 24');
    await click(mas());
    await click(mas());
    expect(cantidadInput().value).toBe('25');
    expect(errorMin()).toBeNull();
    expect(avisos()).toBeNull();
    await click(mas());
    expect(cantidadInput().value).toBe('37');
    expect(avisos().textContent).toContain('Sin stock (hay 30)');
  });

  test.each([['vendedor (2)', VENDEDOR], ['admin (1)', ADMIN]])('AC-BUL-8 en Pedido el botón está para %s', async (_l, v) => {
    setApp({ vendedorActual: v });
    sembrarBorrador(v);
    await render();
    expect(mas()).not.toBeNull();
  });

  test('AC-BUL-8 en Pedido el armador (3) no ve el botón', async () => {
    const armador = { id: 3, nombre: 'Arm', permiso: 3 };
    setApp({ vendedorActual: armador });
    sembrarBorrador(armador);
    await render();
    expect(mas()).toBeNull();
  });
});

// AC-BUL-9 (2026-10-08): el primer "+ Bulto" reemplaza la unidad que se pone
// sola al agregar el producto; si la cantidad se escribió a mano, suma.
describe('AC-BUL-9 Nuevo Pedido: unidad por defecto', () => {
  const escribir = async (input, valor) => {
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, valor);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  const buscador = () => container.querySelector('input[placeholder^="Ej: 9 de oro"]');
  const agregarCoca = async () => {
    await escribir(buscador(), 'Coca');
    const sugg = container.querySelector('.suggestion-item');
    await act(async () => { sugg.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); });
  };
  const sembrarSoloCliente = () => {
    localStorage.setItem('nuevoPedidoDraft:2', JSON.stringify({ version: 1, clienteQ: 'Kiosco', clienteNombre: 'Kiosco', direccion: 'Mitre 123', items: [] }));
  };

  test('AC-BUL-9 agregar producto (arranca en 1) y tocar "+ Bulto" x12 deja 12, no 13', async () => {
    setApp();
    await render();
    await agregarCoca();
    expect(cantidadInput().value).toBe('1');
    await click(mas());
    expect(cantidadInput().value).toBe('12');
    expect(desglose().textContent).toBe('12 u. = 1 bulto');
  });

  test('AC-BUL-9 agregar producto y tocar 3 veces "+ Bulto" x12 deja 36', async () => {
    setApp();
    await render();
    await agregarCoca();
    await click(mas());
    await click(mas());
    await click(mas());
    expect(cantidadInput().value).toBe('36');
  });

  test('AC-BUL-9 si se escribe 1 a mano, "+ Bulto" suma como AC-BUL-2 (13)', async () => {
    setApp();
    await render();
    await agregarCoca();
    await escribir(cantidadInput(), '');
    await escribir(cantidadInput(), '1');
    await click(mas());
    expect(cantidadInput().value).toBe('13');
  });

  test('AC-BUL-9 "+"/"−" o "− Bulto" sacan la marca: después "+ Bulto" suma', async () => {
    setApp();
    await render();
    await agregarCoca();
    await click(mas()); // 12
    await click(menos()); // 1 (piso), ya sin marca
    expect(cantidadInput().value).toBe('1');
    await click(mas());
    expect(cantidadInput().value).toBe('13');
  });

  test('AC-BUL-9 la marca no llega a lo que se guarda (ni con ni sin tocar el bulto)', async () => {
    const { crearPedidoOnlineFirst } = require('../../services/pedidoRepository');
    crearPedidoOnlineFirst.mockClear();
    setApp({ productos: [producto(), producto({ id: 'p2', nombre: 'Coca 1500', bultoX: 6 })] });
    sembrarSoloCliente();
    await render();
    await escribir(buscador(), 'Coca');
    const suggs = [...container.querySelectorAll('.suggestion-item')];
    expect(suggs).toHaveLength(2);
    for (const s of suggs) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => { s.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); });
    }
    // Solo se toca el bulto de uno; el otro queda con la marca en pantalla.
    const masP1 = [...container.querySelectorAll('[data-testid="bulto-mas"]')].find(b => b.textContent === '+ Bulto (x 12)');
    await click(masP1);
    const btnGuardar = [...container.querySelectorAll('button')].find(b => b.textContent.includes('Guardar Pedido'));
    await click(btnGuardar);
    expect(crearPedidoOnlineFirst).toHaveBeenCalledTimes(1);
    const { items } = crearPedidoOnlineFirst.mock.calls[0][0];
    expect(items.find(i => i.productoId === 'p1').cantidad).toBe(12);
    expect(items.find(i => i.productoId === 'p2').cantidad).toBe(1);
    expect(JSON.stringify(items)).not.toContain('_cantidadPorDefecto');
  });
});

// C3 (RUN 20261012-2106) — S-BUL-06
describe('S-BUL-06 Nuevo Pedido: tope de cantidad tipeada', () => {
  const tipear = async (input, valor) => {
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, valor);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  const blur = async (input) => { await act(async () => { input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); }); };
  const botonGuardar = () => [...container.querySelectorAll('button')].find(b => b.textContent.includes('Guardar Pedido'));

  test('AC-BUL-6 S-BUL-06 Nuevo Pedido: una cantidad mayor que MAX_CANTIDAD no se toma; el blur restaura la última válida', async () => {
    setApp();
    sembrarBorrador(VENDEDOR, 5);
    await render();
    await tipear(cantidadInput(), '2000000');
    // La cantidad del renglón (y del borrador) sigue en 5.
    expect(JSON.parse(localStorage.getItem('nuevoPedidoDraft:2')).items[0].cantidad).toBe(5);
    await blur(cantidadInput());
    expect(cantidadInput().value).toBe('5');
  });

  test('AC-BUL-6 S-BUL-06 Nuevo Pedido: cantidades válidas siguen igual ("7" se toma; vacío al salir vuelve a 1)', async () => {
    setApp();
    sembrarBorrador(VENDEDOR, 5);
    await render();
    await tipear(cantidadInput(), '7');
    expect(JSON.parse(localStorage.getItem('nuevoPedidoDraft:2')).items[0].cantidad).toBe(7);
    await tipear(cantidadInput(), '');
    await blur(cantidadInput());
    expect(cantidadInput().value).toBe('1');
  });

  test('AC-BUL-6 AC-SEC-2 S-BUL-06 Nuevo Pedido: un renglón con cantidad fuera de tope no se guarda y avisa', async () => {
    const { crearPedidoOnlineFirst } = require('../../services/pedidoRepository');
    crearPedidoOnlineFirst.mockClear();
    window.alert = jest.fn();
    setApp();
    sembrarBorrador(VENDEDOR, 2000000);
    await render();
    await click(botonGuardar());
    expect(crearPedidoOnlineFirst).not.toHaveBeenCalled();
    expect(window.alert).toHaveBeenCalledWith('Cantidad inválida en: Coca 500 (máximo 1.000.000)');
  });
});
