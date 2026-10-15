// REQ-PBU / REQ-MIN / REQ-SST en Armado.
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

// Unidad $10; llevando bulto (x12) $8; mínimo 6.
const pedido = (cantidad, over = {}) => ({
  id: 9,
  fecha: getTodayStr(),
  clienteNombre: 'Kiosco Pepe',
  vendedorNombre: 'Vend',
  estado: 'pendiente',
  createdAt: 1,
  items: [{ productoId: 'p1', nombre: 'Coca 500', precio: 10, precioOriginal: 10, precioBultoOriginal: 8, precioBultoX: 12, precioPorBulto: false, cantidad }],
  total: cantidad * 10,
  ...over,
});

const setApp = (pedidos, over = {}, productoOver = {}) => {
  Object.keys(mockApp).forEach(k => delete mockApp[k]);
  Object.assign(mockApp, {
    pedidos,
    clientes: [],
    productos: [{ id: 'p1', nombre: 'Coca 500', precio: 10, precioBulto: 8, bultoX: 12, ventaPor: 'ambos', minimoVenta: 6, ...productoOver }],
    faltantes: [], deudas: [], vendedorActual: ARMADOR,
    recargar: jest.fn(() => Promise.resolve()), syncPedidosFecha: jest.fn(), stockMap: new Map(),
    ...over,
  });
};

const render = async () => { await act(async () => { root.render(<Armado />); }); };
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
const boton = (texto) => [...container.querySelectorAll('button')].find(b => b.textContent.includes(texto));
const setValue = async (el, value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  await act(async () => { setter.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); });
};
const cantidad = () => container.querySelector('input[inputmode="numeric"]');
const abrirArmado = async () => { await render(); await click(boton('Armar pedido')); };

beforeEach(() => {
  jest.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  jest.restoreAllMocks();
});

describe('AC-PBU-3 Armado: precio llevando bulto', () => {
  test('AC-PBU-3 al sumar un bulto el precio baja y se guarda a $8 por unidad', async () => {
    setApp([pedido(8)]);
    await abrirArmado();
    await click(container.querySelector('[data-testid="bulto-mas"]')); // 8 + 12 = 20
    expect(cantidad().value).toBe('20');
    await click(boton('Guardar'));
    expect(guardarPedidoOnlineFirst).toHaveBeenCalledTimes(1);
    const g = guardarPedidoOnlineFirst.mock.calls[0][0];
    expect(g.items[0]).toMatchObject({ cantidad: 20, precio: 8, precioOriginal: 10, precioPorBulto: true });
    expect(g.total).toBe(160);
  });
});

describe('AC-MIN-2 Armado: el armador no baja del mínimo', () => {
  test('AC-MIN-2 el "−" se frena en el mínimo (6)', async () => {
    setApp([pedido(7)]);
    await abrirArmado();
    const menosBtn = container.querySelectorAll('.qty-btn')[0];
    await click(menosBtn);
    expect(cantidad().value).toBe('6');
    await click(menosBtn);
    expect(cantidad().value).toBe('6');
  });

  test('AC-MIN-2 tipear una cantidad bajo el mínimo muestra el error y no guarda', async () => {
    setApp([pedido(8)]);
    const alerta = jest.spyOn(window, 'alert').mockImplementation(() => {});
    await abrirArmado();
    await setValue(cantidad(), '2');
    expect(container.querySelector('[data-testid="aviso-minimo"]').textContent).toContain('Mínimo para pedir: 6');
    await click(boton('Guardar'));
    expect(alerta).toHaveBeenCalledWith(expect.stringContaining('por debajo del mínimo'));
    expect(guardarPedidoOnlineFirst).not.toHaveBeenCalled();
  });

  test('AC-MIN-2 si falta mercadería lo tacha como faltante y guarda igual', async () => {
    setApp([pedido(8)]);
    await abrirArmado();
    await click(container.querySelector('[title^="Sacar del pedido"]'));
    await click(boton('Guardar'));
    expect(guardarPedidoOnlineFirst).toHaveBeenCalledTimes(1);
  });

  test('AC-MIN-2 un renglón viejo ya bajo el mínimo no se sube solo con el "−" ni bloquea guardar', async () => {
    setApp([pedido(3)]);
    await abrirArmado();
    await click(container.querySelectorAll('.qty-btn')[0]);
    expect(cantidad().value).toBe('3');
    await click(boton('Guardar'));
    expect(guardarPedidoOnlineFirst).toHaveBeenCalledTimes(1);
  });
});

describe('AC-SST-1 Armado: sin stock avisa pero nunca bloquea', () => {
  test('AC-SST-1 muestra "Sin stock (hay 3)" y guarda igual', async () => {
    setApp([pedido(8)], { stockMap: new Map([['p1', 3]]) });
    await abrirArmado();
    expect(container.querySelector('[data-testid="aviso-stock"]').textContent).toContain('Sin stock (hay 3)');
    await click(boton('Guardar'));
    expect(guardarPedidoOnlineFirst).toHaveBeenCalledTimes(1);
  });

  test('AC-SST-1 pedido ya facturado: lo que ya se descontó no cuenta (stock 0, cantidad 8, ya descontada)', async () => {
    setApp([pedido(8, { estado: 'facturado' })], { stockMap: new Map([['p1', 0]]) });
    await abrirArmado();
    expect(container.querySelector('[data-testid="aviso-stock"]')).toBeNull();
  });
});
