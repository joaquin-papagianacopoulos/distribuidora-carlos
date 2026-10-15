// REQ-REN (AC-REN-4): en Pedidos no se borra un pedido facturado con rendición vigente.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { getTodayStr } from '../../utils/fuzzy';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockApp = {};
const mockRend = { rendiciones: [] };
jest.mock('../../hooks/useAppContext', () => ({ useApp: () => mockApp }));
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn(() => { throw new Error('no deberia llamar a Supabase'); }) } }));
jest.mock('../../utils/pdfGen', () => ({ generarFacturaFile: jest.fn() }));
jest.mock('../../utils/share', () => ({ shareFiles: jest.fn() }));
jest.mock('../../utils/pdfMerge', () => ({ mergePdfFilesToSingleFile: jest.fn() }));
jest.mock('../../services/pedidoRepository', () => ({ borrarPedidoOnlineFirst: jest.fn(), guardarPedidoOnlineFirst: jest.fn() }));
jest.mock('../../services/deudaRepository', () => ({ quitarDeudaDePedido: async () => ({}) }));
jest.mock('../../services/rendicionService', () => ({ cargarRendicionesLocales: async () => mockRend }));

// eslint-disable-next-line import/first
import ListaPedidos from '../ListaPedidos';
// eslint-disable-next-line import/first
import { borrarPedidoOnlineFirst } from '../../services/pedidoRepository';

const ADMIN = { id: 1, nombre: 'Jorge', permiso: 1 };
const PED = { id: 7, remoteId: 'R7', fecha: getTodayStr(), clienteNombre: 'Kiosco', vendedor: 'Jorge', vendedorNombre: 'Jorge', estado: 'facturado', items: [], total: 10, createdAt: 1 };
let container;
let root;
let alertSpy;
let confirmSpy;
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
const boton = (t) => [...container.querySelectorAll('button')].find(b => b.textContent.includes(t));

beforeEach(async () => {
  Object.keys(mockApp).forEach(k => delete mockApp[k]);
  Object.assign(mockApp, {
    pedidos: [PED], clientes: [], vendedores: [ADMIN], deudas: [], vendedorActual: ADMIN, zonaActiva: '', setZona: jest.fn(),
    recargar: jest.fn(() => Promise.resolve()), syncNow: jest.fn(), syncPedidosFecha: jest.fn(), syncPedidosCliente: jest.fn(),
  });
  alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});
  confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<ListaPedidos />); });
  await click(container.querySelector('.pedido-card'));
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  alertSpy.mockRestore();
  confirmSpy.mockRestore();
});

it('AC-REN-4 con rendición vigente: avisa y no borra', async () => {
  mockRend.rendiciones = [{ id: 'r1', pedidoId: 'R7', estado: 'vigente', syncEstado: 'confirmada' }];
  await click(boton('Borrar pedido'));
  expect(alertSpy.mock.calls[0][0]).toMatch(/rendición vigente/);
  expect(borrarPedidoOnlineFirst).not.toHaveBeenCalled();
});

it('AC-REN-4 sin rendición vigente: se borra como siempre', async () => {
  mockRend.rendiciones = [{ id: 'r1', pedidoId: 'R7', estado: 'anulada' }];
  await click(boton('Borrar pedido'));
  expect(borrarPedidoOnlineFirst).toHaveBeenCalled();
});
