// REQ-VTA (AC-VTA-2, AC-VTA-3) en Facturación (modo edición): unidad de venta por bulto.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { getTodayStr } from '../../utils/fuzzy';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockApp = {};
jest.mock('../../hooks/useAppContext', () => ({ useApp: () => mockApp }));
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn(() => { throw new Error('no deberia llamar a Supabase'); }) } }));
jest.mock('../../db', () => ({ registrarFaltantes: jest.fn(() => Promise.resolve()) }));
jest.mock('../../utils/pdfGen', () => ({ generarFacturaFile: jest.fn() }));
jest.mock('../../utils/share', () => ({ shareFiles: jest.fn() }));
jest.mock('../../utils/pdfMerge', () => ({ mergePdfFilesToSingleFile: jest.fn() }));
jest.mock('../../services/pedidoRepository', () => ({
  guardarPedidoOnlineFirst: jest.fn(() => Promise.resolve()),
  borrarPedidoOnlineFirst: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../services/deudaRepository', () => ({
  registrarDeudaFacturado: jest.fn(), quitarDeudaDePedido: jest.fn(), actualizarMontoDeudaDePedido: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../services/faltanteRepository', () => ({ borrarFaltantesDeProducto: jest.fn(() => Promise.resolve()) }));
jest.mock('../../services/stockService', () => ({ previsualizarStockPedido: jest.fn(() => Promise.resolve({ faltantes: [], decision: 'ok' })) }));

// eslint-disable-next-line import/first
import Facturacion from '../Facturacion';
// eslint-disable-next-line import/first
import { guardarPedidoOnlineFirst } from '../../services/pedidoRepository';

const ADMIN = { id: 1, nombre: 'Admin', permiso: 1 };

let container;
let root;

const pedidoFacturado = (over = {}) => ({
  id: 7,
  fecha: getTodayStr(),
  clienteNombre: 'Kiosco Pepe',
  vendedorNombre: 'Vend',
  estado: 'facturado',
  createdAt: 1,
  items: [
    { productoId: 'dc', nombre: 'Dos Corazones', precio: 900, precioOriginal: 900, cantidad: 32, bultos: 2, bultoX: 16, bultoNombre: 'Display' },
    { productoId: 'p2', nombre: 'Alfajor', precio: 5, precioOriginal: 5, cantidad: 2 },
  ],
  total: 28810,
  ...over,
});

const setApp = (over = {}) => {
  Object.keys(mockApp).forEach(k => delete mockApp[k]);
  Object.assign(mockApp, {
    pedidos: [pedidoFacturado()],
    clientes: [],
    productos: [
      { id: 'dc', nombre: 'Dos Corazones', precio: 900, bultoX: 16, ventaPor: 'bulto', bultoNombre: 'Display' },
      { id: 'p2', nombre: 'Alfajor', precio: 5, bultoX: 1 },
    ],
    vendedores: [],
    deudas: [],
    faltantes: [],
    vendedorActual: ADMIN,
    zonaActiva: '',
    setZona: jest.fn(),
    recargar: jest.fn(() => Promise.resolve()),
    syncNow: jest.fn(),
    syncPedidosFecha: jest.fn(),
    syncPedidosCliente: jest.fn(),
    online: false,
    ...over,
  });
};

const render = async () => { await act(async () => { root.render(<Facturacion />); }); };
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
const boton = (texto) => [...container.querySelectorAll('button')].find(b => b.textContent.includes(texto));
const cantidades = () => [...container.querySelectorAll('input[inputmode="numeric"]')].map(i => i.value);
const cantidadDe = (valor) => [...container.querySelectorAll('input[inputmode="numeric"]')].find(i => i.value === valor);
const escribir = async (el, valor) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  await act(async () => { setter.call(el, valor); el.dispatchEvent(new Event('input', { bubbles: true })); });
};
const abrirEdicion = async () => {
  await render();
  await click(boton('Editar'));
};

beforeEach(() => {
  jest.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

describe('REQ-VTA Facturación (edición)', () => {
  test('AC-VTA-2 el renglón congelado se muestra como "2 Display (32 u.)" y el precio del bulto', async () => {
    setApp();
    await abrirEdicion();
    expect(container.querySelector('[data-testid="texto-bultos"]').textContent).toBe('2 Display (32 u.)');
    expect(container.querySelector('[data-testid="bulto-mas"]').textContent).toBe('+ Display (x 16)');
    expect(container.querySelector('[data-testid="bulto-precio"]').textContent).toContain('14.400');
  });

  test('AC-VTA-3 los botones +/- mueven de a un bulto y al guardar se re-congela', async () => {
    setApp();
    await abrirEdicion();
    const mas = [...container.querySelectorAll('.qty-btn')].filter(b => b.textContent === '+').pop(); // filas ordenadas A-Z: Dos Corazones es la ultima
    await click(mas);
    expect(cantidades()).toContain('48');
    await click(boton('Guardar cambios'));
    const [pedidoFinal] = guardarPedidoOnlineFirst.mock.calls[0];
    expect(pedidoFinal.items.find(i => i.productoId === 'dc')).toMatchObject({ cantidad: 48, bultos: 3, bultoX: 16, bultoNombre: 'Display' });
    expect(pedidoFinal.total).toBe(48 * 900 + 2 * 5);
  });

  test('AC-VTA-3 tipear 20 avisa; el admin confirma y guarda igual (cantidad en unidades, sin bultos congelados)', async () => {
    setApp();
    window.confirm = jest.fn(() => true);
    await abrirEdicion();
    await escribir(cantidadDe('32'), '20');
    expect(container.querySelector('[data-testid="aviso-multiplo"]').textContent).toContain('20 u. no es múltiplo');
    await click(boton('Guardar cambios'));
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(guardarPedidoOnlineFirst).toHaveBeenCalledTimes(1);
    const item = guardarPedidoOnlineFirst.mock.calls[0][0].items.find(i => i.productoId === 'dc');
    expect(item.cantidad).toBe(20);
    expect(item).not.toHaveProperty('bultos');
  });

  test('AC-VTA-3 si el admin no confirma no se guarda', async () => {
    setApp();
    window.confirm = jest.fn(() => false);
    await abrirEdicion();
    await escribir(cantidadDe('32'), '20');
    await click(boton('Guardar cambios'));
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(guardarPedidoOnlineFirst).not.toHaveBeenCalled();
  });

  test('AC-VTA-3 un pedido viejo con cantidad no multiplo no pide confirmacion si no se toca esa cantidad', async () => {
    setApp({
      pedidos: [pedidoFacturado({
        items: [
          { productoId: 'dc', nombre: 'Dos Corazones', precio: 900, precioOriginal: 900, cantidad: 20 },
          { productoId: 'p2', nombre: 'Alfajor', precio: 5, precioOriginal: 5, cantidad: 2 },
        ],
      })],
    });
    window.confirm = jest.fn(() => true);
    await abrirEdicion();
    await click(boton('Guardar cambios'));
    expect(window.confirm).not.toHaveBeenCalled();
    expect(guardarPedidoOnlineFirst).toHaveBeenCalledTimes(1);
    expect(guardarPedidoOnlineFirst.mock.calls[0][0].items.find(i => i.productoId === 'dc').cantidad).toBe(20);
  });
});
