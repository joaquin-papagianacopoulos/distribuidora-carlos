// REQ-VTA (AC-VTA-2, AC-VTA-3) en Armado: unidad de venta por bulto.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { getTodayStr } from '../../utils/fuzzy';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockApp = {};
jest.mock('../../hooks/useAppContext', () => ({ useApp: () => mockApp }));
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn(() => { throw new Error('no deberia llamar a Supabase'); }) } }));
jest.mock('../../db', () => ({
  registrarFaltantes: jest.fn(() => Promise.resolve()),
  getPedidos: jest.fn(() => Promise.resolve([])),
}));
jest.mock('../../utils/pdfGen', () => ({ generarFacturaFile: jest.fn(), generarListaClientesFile: jest.fn() }));
jest.mock('../../utils/share', () => ({ shareFiles: jest.fn(), canShareFiles: jest.fn(() => false) }));
jest.mock('../../utils/pdfMerge', () => ({ mergePdfFilesToSingleFile: jest.fn() }));
jest.mock('../../services/pedidoRepository', () => ({ guardarPedidoOnlineFirst: jest.fn(() => Promise.resolve()) }));
jest.mock('../../services/deudaRepository', () => ({ actualizarMontoDeudaDePedido: jest.fn(() => Promise.resolve()) }));
jest.mock('../../services/faltanteRepository', () => ({ borrarFaltantesDeProducto: jest.fn(() => Promise.resolve()) }));

// eslint-disable-next-line import/first
import Armado from '../Armado';
// eslint-disable-next-line import/first
import { guardarPedidoOnlineFirst } from '../../services/pedidoRepository';

const ARMADOR = { id: 3, nombre: 'Arm', permiso: 3 };

let container;
let root;

const pedido = (over = {}) => ({
  id: 9,
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
    pedidos: [pedido()],
    clientes: [],
    productos: [
      { id: 'dc', nombre: 'Dos Corazones', precio: 900, bultoX: 16, ventaPor: 'bulto', bultoNombre: 'Display' },
      { id: 'p2', nombre: 'Alfajor', precio: 5, bultoX: 1 },
    ],
    faltantes: [],
    deudas: [],
    vendedorActual: ARMADOR,
    recargar: jest.fn(() => Promise.resolve()),
    syncPedidosFecha: jest.fn(),
    ...over,
  });
};

const render = async () => { await act(async () => { root.render(<Armado />); }); };
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
const boton = (texto) => [...container.querySelectorAll('button')].find(b => b.textContent.includes(texto));
const mases = () => [...container.querySelectorAll('[data-testid="bulto-mas"]')];
const cantidades = () => [...container.querySelectorAll('input[inputmode="numeric"]')].map(i => i.value);
const cantidadDe = (valor) => [...container.querySelectorAll('input[inputmode="numeric"]')].find(i => i.value === valor);
const escribir = async (el, valor) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  await act(async () => { setter.call(el, valor); el.dispatchEvent(new Event('input', { bubbles: true })); });
};
const abrirArmado = async () => {
  await render();
  await click(boton('Armar pedido'));
};

beforeEach(() => {
  jest.clearAllMocks();
  window.alert = jest.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

describe('REQ-VTA Armado', () => {
  test('AC-VTA-2 el renglón congelado se muestra como "2 Display (32 u.)"', async () => {
    setApp();
    await abrirArmado();
    expect(container.querySelector('[data-testid="texto-bultos"]').textContent).toBe('2 Display (32 u.)');
    expect(mases()[0].textContent).toBe('+ Display (x 16)');
  });

  test('AC-VTA-3 los botones +/- mueven de a un bulto y al guardar se re-congela', async () => {
    setApp();
    await abrirArmado();
    await click([...container.querySelectorAll('.qty-btn')].find(b => b.textContent === '+'));
    expect(cantidades()).toContain('48');
    await click(boton('Guardar cambios'));
    const [pedidoFinal] = guardarPedidoOnlineFirst.mock.calls[0];
    expect(pedidoFinal.items.find(i => i.productoId === 'dc')).toMatchObject({ cantidad: 48, bultos: 3, bultoX: 16, bultoNombre: 'Display' });
    expect(pedidoFinal.total).toBe(48 * 900 + 2 * 5);
  });

  test('AC-VTA-3 tipear 20 muestra el aviso y el armador no puede guardar', async () => {
    setApp();
    await abrirArmado();
    await escribir(cantidadDe('32'), '20');
    expect(container.querySelector('[data-testid="aviso-multiplo"]').textContent).toContain('20 u. no es múltiplo');
    await click(boton('Guardar cambios'));
    expect(window.alert).toHaveBeenCalledTimes(1);
    expect(guardarPedidoOnlineFirst).not.toHaveBeenCalled();
  });

  test('AC-VTA-3 tachar el renglón con cantidad no multiplo sigue funcionando', async () => {
    setApp();
    await abrirArmado();
    await escribir(cantidadDe('32'), '20');
    await click(container.querySelector('button[title^="Sacar del pedido"]'));
    await click(boton('Guardar cambios'));
    expect(window.alert).not.toHaveBeenCalled();
    expect(guardarPedidoOnlineFirst).toHaveBeenCalledTimes(1);
    const [pedidoFinal] = guardarPedidoOnlineFirst.mock.calls[0];
    expect(pedidoFinal.items.map(i => i.productoId)).toEqual(['p2']);
  });

  test('AC-VTA-3 un pedido viejo con cantidad no multiplo se puede guardar si no se toca esa cantidad', async () => {
    setApp({
      pedidos: [pedido({
        items: [
          { productoId: 'dc', nombre: 'Dos Corazones', precio: 900, precioOriginal: 900, cantidad: 20 },
          { productoId: 'p2', nombre: 'Alfajor', precio: 5, precioOriginal: 5, cantidad: 2 },
        ],
      })],
    });
    await abrirArmado();
    await click(boton('Guardar cambios'));
    expect(window.alert).not.toHaveBeenCalled();
    expect(guardarPedidoOnlineFirst).toHaveBeenCalledTimes(1);
  });
});
