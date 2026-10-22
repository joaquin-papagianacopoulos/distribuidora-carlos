// REQ-COMR (RUN 20261014-1449) AC-COMR-5: al agregar un producto a un pedido
// (Nuevo pedido, Facturación y Armado) el renglón guarda el rubro del producto
// en ese momento; los pedidos viejos sin `rubro` siguen funcionando.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { getTodayStr } from '../../utils/fuzzy';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockApp = {};
jest.mock('../../hooks/useAppContext', () => ({ useApp: () => mockApp }));
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn(() => { throw new Error('no deberia llamar a Supabase'); }) } }));
jest.mock('../../db', () => ({
  addCliente: jest.fn(() => Promise.resolve('c-nuevo')),
  registrarFaltantes: jest.fn(() => Promise.resolve()),
  getPedidos: jest.fn(() => Promise.resolve([])),
}));
jest.mock('../../services/pedidoRepository', () => ({
  crearPedidoOnlineFirst: jest.fn(() => Promise.resolve()),
  guardarPedidoOnlineFirst: jest.fn(() => Promise.resolve()),
  borrarPedidoOnlineFirst: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../utils/pdfGen', () => ({ generarFacturaFile: jest.fn(), generarListaClientesFile: jest.fn() }));
jest.mock('../../utils/share', () => ({ shareFiles: jest.fn(), canShareFiles: jest.fn(() => false) }));
jest.mock('../../utils/pdfMerge', () => ({ mergePdfFilesToSingleFile: jest.fn() }));
jest.mock('../../services/deudaRepository', () => ({
  registrarDeudaFacturado: jest.fn(), quitarDeudaDePedido: jest.fn(), actualizarMontoDeudaDePedido: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../services/faltanteRepository', () => ({ borrarFaltantesDeProducto: jest.fn(() => Promise.resolve()) }));
jest.mock('../../services/stockService', () => ({ previsualizarStockPedido: jest.fn(() => Promise.resolve({ faltantes: [], decision: 'ok' })) }));

// eslint-disable-next-line import/first
import NuevoPedido from '../NuevoPedido';
// eslint-disable-next-line import/first
import Facturacion from '../Facturacion';
// eslint-disable-next-line import/first
import Armado from '../Armado';
// eslint-disable-next-line import/first
import { crearPedidoOnlineFirst, guardarPedidoOnlineFirst } from '../../services/pedidoRepository';
// eslint-disable-next-line import/first
import { previsualizarStockPedido } from '../../services/stockService';

let container;
let root;
beforeEach(() => {
  jest.clearAllMocks();
  crearPedidoOnlineFirst.mockImplementation(() => Promise.resolve());
  guardarPedidoOnlineFirst.mockImplementation(() => Promise.resolve());
  previsualizarStockPedido.mockImplementation(() => Promise.resolve({ faltantes: [], decision: 'ok' }));
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

const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
const boton = (texto) => [...container.querySelectorAll('button')].find(b => b.textContent.includes(texto));
const escribir = async (input, valor) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, valor);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const setApp = (over) => {
  Object.keys(mockApp).forEach(k => delete mockApp[k]);
  Object.assign(mockApp, {
    clientes: [], vendedores: [], deudas: [], faltantes: [], pedidos: [], zonaActiva: '', setZona: jest.fn(),
    recargar: jest.fn(() => Promise.resolve()), syncNow: jest.fn(), syncPedidosFecha: jest.fn(), syncPedidosCliente: jest.fn(),
    stockMap: new Map(), online: false, ...over,
  });
};

const PRODUCTOS = [
  { id: 'p1', nombre: 'Coca 500', precio: 10, bultoX: 1, categoria: 'Bebidas' },
  { id: 'p2', nombre: 'Alfajor', precio: 5, bultoX: 1, categoria: ' golosinas ' },
  { id: 'p3', nombre: 'Agua Mineral', precio: 3, bultoX: 1, categoria: 'Bebidas' },
];
// Pedido viejo: renglones SIN rubro (anteriores a REQ-COMR).
const pedidoViejo = (over = {}) => ({
  id: 7, fecha: getTodayStr(), clienteNombre: 'Kiosco Pepe', vendedorNombre: 'Vend', estado: 'facturado', createdAt: 1,
  items: [
    { productoId: 'p1', nombre: 'Coca 500', precio: 10, precioOriginal: 10, cantidad: 5 },
    { productoId: 'p2', nombre: 'Alfajor', precio: 5, precioOriginal: 5, cantidad: 2 },
  ],
  total: 60,
  ...over,
});

describe('AC-COMR-5 Nuevo pedido', () => {
  const VENDEDOR = { id: 2, nombre: 'Vend', permiso: 2, zona: 'Norte' };
  const render = async () => { await act(async () => { root.render(<NuevoPedido />); }); };
  const sembrar = (items) => {
    localStorage.setItem('nuevoPedidoDraft:2', JSON.stringify({ version: 1, clienteQ: 'Kiosco', clienteNombre: 'Kiosco', direccion: 'Mitre 123', items }));
  };

  it('AC-COMR-5 al agregar un producto con rubro, el renglón guardado tiene rubro (normalizado)', async () => {
    setApp({ productos: PRODUCTOS, vendedorActual: VENDEDOR });
    sembrar([]);
    await render();
    await escribir(container.querySelector('input[placeholder^="Ej: 9 de oro"]'), 'Alfajor');
    const sugg = container.querySelector('.suggestion-item');
    await act(async () => { sugg.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); });
    await click(boton('Guardar Pedido'));
    expect(crearPedidoOnlineFirst).toHaveBeenCalledTimes(1);
    const { items } = crearPedidoOnlineFirst.mock.calls[0][0];
    expect(items).toEqual([expect.objectContaining({ productoId: 'p2', rubro: 'golosinas' })]);
  });

  it('AC-COMR-5 un borrador viejo sin rubro se guarda sin errores (y el rubro del producto no se inventa)', async () => {
    setApp({ productos: PRODUCTOS, vendedorActual: VENDEDOR });
    sembrar([{ productoId: 'p1', nombre: 'Coca 500', precio: 10, precioOriginal: 10, cantidad: 3 }]);
    await render();
    await click(boton('Guardar Pedido'));
    const { items } = crearPedidoOnlineFirst.mock.calls[0][0];
    expect(items[0]).toMatchObject({ productoId: 'p1', cantidad: 3 });
    expect(items[0]).not.toHaveProperty('rubro');
  });
});

describe('AC-COMR-5 Facturación', () => {
  const ADMIN = { id: 1, nombre: 'Admin', permiso: 1 };
  const render = async () => { await act(async () => { root.render(<Facturacion />); }); };

  it('AC-COMR-5 pedido viejo sin rubro: se abre, se agrega un producto (con rubro) y se guarda; los viejos no cambian', async () => {
    setApp({ productos: PRODUCTOS, vendedorActual: ADMIN, pedidos: [pedidoViejo()] });
    await render();
    await click(boton('Editar'));
    await escribir(container.querySelector('input[placeholder="Buscar producto..."]'), 'Agua');
    const sugg = [...container.querySelectorAll('.suggestion-item')].find(s => s.textContent.includes('Agua Mineral'));
    await click(sugg);
    await click(boton('Guardar cambios'));
    expect(guardarPedidoOnlineFirst).toHaveBeenCalledTimes(1);
    const [final] = guardarPedidoOnlineFirst.mock.calls[0];
    expect(final.items.find(i => i.productoId === 'p3')).toMatchObject({ rubro: 'Bebidas', cantidad: 1 });
    expect(final.items.find(i => i.productoId === 'p1')).not.toHaveProperty('rubro');
    expect(final.items.find(i => i.productoId === 'p2')).not.toHaveProperty('rubro');
  });

  it('AC-COMR-5 cambiar después el rubro del producto NO cambia el renglón ya guardado', async () => {
    const conRubro = pedidoViejo({ items: [{ productoId: 'p1', nombre: 'Coca 500', precio: 10, precioOriginal: 10, cantidad: 5, rubro: 'Bebidas' }], total: 50 });
    setApp({ productos: PRODUCTOS.map(p => (p.id === 'p1' ? { ...p, categoria: 'Gaseosas' } : p)), vendedorActual: ADMIN, pedidos: [conRubro] });
    await render();
    await click(boton('Editar'));
    await click(boton('Guardar cambios'));
    const [final] = guardarPedidoOnlineFirst.mock.calls[0];
    expect(final.items[0]).toMatchObject({ productoId: 'p1', rubro: 'Bebidas' });
  });
});

describe('AC-COMR-5 Armado', () => {
  const ARMADOR = { id: 3, nombre: 'Arm', permiso: 3 };
  const render = async () => { await act(async () => { root.render(<Armado />); }); };

  it('AC-COMR-5 armar un pedido viejo y agregar un producto: el agregado lleva rubro, los viejos siguen sin él', async () => {
    setApp({ productos: PRODUCTOS, vendedorActual: ARMADOR, pedidos: [pedidoViejo({ id: 9 })] });
    await render();
    await click(boton('Armar pedido'));
    await escribir(container.querySelector('input[placeholder="Buscar producto..."]'), 'Agua');
    const sugg = [...container.querySelectorAll('.suggestion-item')].find(s => s.textContent.includes('Agua Mineral'));
    await click(sugg);
    await click(boton('Guardar cambios'));
    expect(guardarPedidoOnlineFirst).toHaveBeenCalledTimes(1);
    const [final] = guardarPedidoOnlineFirst.mock.calls[0];
    expect(final.items.find(i => i.productoId === 'p3')).toMatchObject({ rubro: 'Bebidas' });
    expect(final.items.find(i => i.productoId === 'p1')).not.toHaveProperty('rubro');
    expect(JSON.stringify(final.items)).not.toMatch(/_key|picked|eliminado|_cantidadPorDefecto/);
  });
});
