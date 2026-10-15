// REQ-PBU / REQ-MIN / REQ-SST en Facturación (edición y "Cambiar a facturado").
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
jest.mock('../../services/stockService', () => ({ previsualizarStockPedido: jest.fn() }));

// eslint-disable-next-line import/first
import Facturacion from '../Facturacion';
// eslint-disable-next-line import/first
import { guardarPedidoOnlineFirst } from '../../services/pedidoRepository';
// eslint-disable-next-line import/first
import { previsualizarStockPedido } from '../../services/stockService';

const ADMIN = { id: 1, nombre: 'Admin', permiso: 1 };
let container;
let root;

// Unidad $10; llevando bulto (x12) $8.
const pedido = (over = {}) => ({
  id: 7,
  fecha: getTodayStr(),
  clienteNombre: 'Kiosco Pepe',
  vendedorNombre: 'Vend',
  estado: 'pendiente',
  createdAt: 1,
  items: [
    { productoId: 'p1', nombre: 'Coca 500', precio: 10, precioOriginal: 10, precioBultoOriginal: 8, precioBultoX: 12, precioPorBulto: false, cantidad: 5 },
  ],
  total: 50,
  ...over,
});

const setApp = (productoOver = {}, over = {}) => {
  Object.keys(mockApp).forEach(k => delete mockApp[k]);
  Object.assign(mockApp, {
    pedidos: [pedido()],
    clientes: [],
    productos: [{ id: 'p1', nombre: 'Coca 500', precio: 10, precioBulto: 8, bultoX: 12, ventaPor: 'ambos', ...productoOver }],
    vendedores: [], deudas: [], faltantes: [], vendedorActual: ADMIN, zonaActiva: '',
    setZona: jest.fn(), recargar: jest.fn(() => Promise.resolve()), syncNow: jest.fn(),
    syncPedidosFecha: jest.fn(), syncPedidosCliente: jest.fn(), online: false, stockMap: new Map(),
    ...over,
  });
};

const render = async () => { await act(async () => { root.render(<Facturacion />); }); };
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
const boton = (texto) => [...container.querySelectorAll('button')].find(b => b.textContent.includes(texto));
const setValue = async (el, value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  await act(async () => { setter.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); });
};
const abrirEdicion = async () => { await render(); await click(boton('Editar')); };
const inputsNumericos = () => [...container.querySelectorAll('input[inputmode="numeric"]')];

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

describe('AC-PBU-3 Facturación: precio llevando bulto', () => {
  test('AC-PBU-3 +1 bulto lleva el renglón a 17 u. a $8 y se guarda con precioPorBulto', async () => {
    setApp();
    await abrirEdicion();
    await click(container.querySelector('[data-testid="bulto-mas"]'));
    expect(inputsNumericos()[0].value).toBe('17');
    expect(container.querySelector('[data-testid="precio-por-bulto"]')).not.toBeNull();
    await click(boton('Guardar cambios'));
    expect(guardarPedidoOnlineFirst).toHaveBeenCalledTimes(1);
    const guardado = guardarPedidoOnlineFirst.mock.calls[0][0];
    expect(guardado.items[0]).toMatchObject({ cantidad: 17, precio: 8, precioOriginal: 10, precioPorBulto: true });
    expect(guardado.total).toBe(136);
  });

  test('AC-PBU-3 un precio puesto a mano (manual) se respeta al cruzar el bulto', async () => {
    setApp({}, { pedidos: [pedido({ items: [{ productoId: 'p1', nombre: 'Coca 500', precio: 9, precioOriginal: 10, precioBultoOriginal: 8, precioBultoX: 12, precioManual: true, cantidad: 5 }] })] });
    await abrirEdicion();
    await click(container.querySelector('[data-testid="bulto-mas"]'));
    await click(boton('Guardar cambios'));
    expect(guardarPedidoOnlineFirst.mock.calls[0][0].items[0]).toMatchObject({ cantidad: 17, precio: 9 });
  });
});

describe('AC-MIN-2 Facturación: el admin guarda bajo el mínimo con confirmación', () => {
  const bajarA2 = async () => { await setValue(inputsNumericos()[0], '2'); };

  test('AC-MIN-2 muestra el aviso en el renglón y, si el admin NO confirma, no guarda', async () => {
    setApp({ minimoVenta: 6, precioBulto: 0 }, { pedidos: [pedido({ items: [{ productoId: 'p1', nombre: 'Coca 500', precio: 10, precioOriginal: 10, cantidad: 8 }] })] });
    const confirmar = jest.spyOn(window, 'confirm').mockReturnValue(false);
    await abrirEdicion();
    await bajarA2();
    expect(container.querySelector('[data-testid="aviso-minimo"]').textContent).toContain('Mínimo para pedir: 6');
    await click(boton('Guardar cambios'));
    expect(confirmar).toHaveBeenCalledWith(expect.stringContaining('por debajo del mínimo'));
    expect(guardarPedidoOnlineFirst).not.toHaveBeenCalled();
  });

  test('AC-MIN-2 si el admin confirma, guarda', async () => {
    setApp({ minimoVenta: 6, precioBulto: 0 }, { pedidos: [pedido({ items: [{ productoId: 'p1', nombre: 'Coca 500', precio: 10, precioOriginal: 10, cantidad: 8 }] })] });
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    await abrirEdicion();
    await bajarA2();
    await click(boton('Guardar cambios'));
    expect(guardarPedidoOnlineFirst).toHaveBeenCalledTimes(1);
    expect(guardarPedidoOnlineFirst.mock.calls[0][0].items[0].cantidad).toBe(2);
  });

  test('AC-MIN-2 un renglón viejo que ya estaba bajo el mínimo no pide confirmación al guardar otra cosa', async () => {
    setApp({ minimoVenta: 6, precioBulto: 0 }, { pedidos: [pedido({ items: [{ productoId: 'p1', nombre: 'Coca 500', precio: 10, precioOriginal: 10, cantidad: 2 }] })] });
    const confirmar = jest.spyOn(window, 'confirm').mockReturnValue(false);
    await abrirEdicion();
    await click(boton('Guardar cambios'));
    expect(confirmar).not.toHaveBeenCalled();
    expect(guardarPedidoOnlineFirst).toHaveBeenCalledTimes(1);
  });
});

describe('AC-SST-1 Facturación: sin stock avisa pero nunca bloquea', () => {
  test('AC-SST-1 en el renglón: "Sin stock (hay 3)"', async () => {
    setApp({}, { stockMap: new Map([['p1', 3]]), pedidos: [pedido({ items: [{ productoId: 'p1', nombre: 'Coca 500', precio: 10, precioOriginal: 10, cantidad: 5 }] })] });
    await abrirEdicion();
    expect(container.querySelector('[data-testid="aviso-stock"]').textContent).toContain('Sin stock (hay 3)');
  });

  test('AC-SST-1 en un pedido ya facturado lo descontado no cuenta como faltante', async () => {
    setApp({}, { stockMap: new Map([['p1', 0]]), pedidos: [pedido({ estado: 'facturado', items: [{ productoId: 'p1', nombre: 'Coca 500', precio: 10, precioOriginal: 10, cantidad: 5 }] })] });
    await abrirEdicion();
    expect(container.querySelector('[data-testid="aviso-stock"]')).toBeNull();
  });

  test('AC-SST-1 al facturar con stock insuficiente resume "N productos quedan con stock negativo" y deja facturar', async () => {
    setApp();
    previsualizarStockPedido.mockResolvedValue({
      faltantes: [{ productoId: 'p1', nombre: 'Coca 500', disponible: 0, requerido: 5, resultante: -5 }],
      decision: 'confirmar',
    });
    const confirmar = jest.spyOn(window, 'confirm').mockReturnValue(true);
    await render();
    await click(boton('Cambiar a facturado'));
    expect(confirmar).toHaveBeenCalledWith(expect.stringContaining('1 producto queda con stock negativo'));
    expect(guardarPedidoOnlineFirst).toHaveBeenCalledWith(expect.objectContaining({ estado: 'facturado' }), { iniciarStock: true });
  });
});
