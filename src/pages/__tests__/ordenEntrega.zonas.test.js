// REQ-ZON (AC-ZON-1, 2, 3): Orden de entrega por zona.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockApp = {};
jest.mock('../../hooks/useAppContext', () => ({ useApp: () => mockApp }));
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn(() => { throw new Error('no deberia llamar a Supabase'); }) } }));
jest.mock('../../db', () => ({ updateCliente: jest.fn(), getPedidos: jest.fn() }));
jest.mock('../../sync/syncService', () => ({ syncClientes: jest.fn() }));
jest.mock('../../utils/pdfGen', () => ({ generarFacturaFile: jest.fn() }));
jest.mock('../../utils/share', () => ({ shareFiles: jest.fn(), canShareFiles: jest.fn() }));
jest.mock('../../utils/pdfMerge', () => ({ mergePdfFilesToSingleFile: jest.fn() }));
jest.mock('../../services/pedidoRepository', () => ({ marcarEntregadoOnlineFirst: jest.fn() }));

// eslint-disable-next-line import/first
import OrdenEntrega from '../OrdenEntrega';
// eslint-disable-next-line import/first
import { updateCliente, getPedidos } from '../../db';
// eslint-disable-next-line import/first
import { generarFacturaFile } from '../../utils/pdfGen';
// eslint-disable-next-line import/first
import { mergePdfFilesToSingleFile } from '../../utils/pdfMerge';
// eslint-disable-next-line import/first
import { shareFiles, canShareFiles } from '../../utils/share';
// eslint-disable-next-line import/first
import { sumarDias } from '../../utils/diasSemana';

const C = (id, nombre, zona, extra = {}) => ({ id, nombre, zona, ...extra });
const CLIENTES = [
  C(1, 'Ana', 'Norte', { ordenZona: 1, diaEntrega: 'lunes', ordenEntrega: 4 }),
  C(2, 'Beto', 'norte ', { ordenZona: 2 }),
  C(3, 'Cami', 'Norte', { ordenZona: 3 }),
  C(4, 'Dani', 'Sur', { ordenZona: 1 }),
  C(5, 'Eli', '', {}),
];

let container;
let root;
const setApp = (over = {}) => {
  Object.keys(mockApp).forEach(k => delete mockApp[k]);
  Object.assign(mockApp, {
    clientes: CLIENTES, deudas: [], pedidos: [], recargar: jest.fn(() => Promise.resolve()), syncPedidosFecha: jest.fn(() => Promise.resolve()),
    vendedorActual: { id: 2, nombre: 'V', permiso: 2 }, comisionesCierres: [],
    ...over,
  });
};
const render = async () => { await act(async () => { root.render(<OrdenEntrega />); }); };
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
const porAria = (l) => container.querySelector(`[aria-label="${l}"]`);
const boton = (t) => [...container.querySelectorAll('button')].find(b => b.textContent.includes(t));
const elegirZona = async (valor) => {
  const sel = container.querySelector('#zona-sel');
  const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
  await act(async () => { set.call(sel, valor); sel.dispatchEvent(new Event('change', { bubbles: true })); });
};
const escribir = async (el, valor) => {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  await act(async () => { set.call(el, valor); el.dispatchEvent(new Event('input', { bubbles: true })); });
};
const salir = async (el) => { await act(async () => { el.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); el.blur(); }); };

beforeEach(() => {
  jest.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  jest.spyOn(window, 'alert').mockImplementation(() => {});
  jest.spyOn(window, 'open').mockReturnValue(null);
  global.URL.createObjectURL = jest.fn(() => 'blob:x');
  global.URL.revokeObjectURL = jest.fn();
  const { syncClientes } = require('../../sync/syncService');
  syncClientes.mockResolvedValue({ ok: true });
  updateCliente.mockResolvedValue(undefined);
  canShareFiles.mockReturnValue(true);
  shareFiles.mockResolvedValue(undefined);
  generarFacturaFile.mockResolvedValue(new File(['x'], 'f.pdf'));
  mergePdfFilesToSingleFile.mockResolvedValue(new File(['x'], 'm.pdf'));
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  jest.restoreAllMocks();
});

describe('AC-ZON-1 elegir zona y reordenar', () => {
  it('AC-ZON-1 lista las zonas de las fichas (variantes juntas) con Sin zona al final', async () => {
    setApp();
    await render();
    const opciones = [...container.querySelectorAll('#zona-sel option')].map(o => o.textContent);
    expect(opciones).toEqual(['Elegir zona...', 'Norte (3)', 'Sur (1)', 'Sin zona (1)']);
  });

  it('AC-ZON-1 muestra los clientes de la zona en su orden', async () => {
    setApp();
    await render();
    await elegirZona('norte');
    const filas = [...container.querySelectorAll('[data-testid^="zona-cliente-"]')];
    expect(filas.map(r => [r.querySelector('input').value, r.querySelector('span').textContent])).toEqual([['1', 'Ana'], ['2', 'Beto'], ['3', 'Cami']]);
  });

  it('AC-ZON-1 bajar corre a los demás: solo se guardan los que cambian y se conservan dia/orden de entrega', async () => {
    setApp();
    await render();
    await elegirZona('norte');
    await click(porAria('Bajar a Ana'));
    const guardados = updateCliente.mock.calls.map(c => c[0]);
    expect(guardados.map(c => [c.id, c.ordenZona]).sort()).toEqual([[1, 2], [2, 1]]);
    const ana = guardados.find(c => c.id === 1);
    expect(ana).toMatchObject({ diaEntrega: 'lunes', ordenEntrega: 4, nombre: 'Ana', zona: 'Norte' });
    expect(mockApp.recargar).toHaveBeenCalled();
  });

  it('AC-ZON-1 escribir un número lo mueve a ese puesto y corre a los demás', async () => {
    setApp();
    await render();
    await elegirZona('norte');
    const campo = porAria('Puesto de Cami');
    await escribir(campo, '1');
    await salir(campo);
    const guardados = updateCliente.mock.calls.map(c => [c[0].id, c[0].ordenZona]).sort();
    expect(guardados).toEqual([[1, 2], [2, 3], [3, 1]]);
  });

  it('AC-ZON-1 el primero no puede subir ni el último bajar', async () => {
    setApp();
    await render();
    await elegirZona('norte');
    expect(porAria('Subir a Ana').disabled).toBe(true);
    expect(porAria('Bajar a Cami').disabled).toBe(true);
  });

  it('AC-ZON-3 no muestra día ni orden de entrega del modelo viejo', async () => {
    setApp();
    await render();
    await elegirZona('norte');
    expect(container.textContent).not.toMatch(/Lunes|lunes/);
    expect(container.textContent).not.toMatch(/Elegir día/);
  });
});

describe('AC-ZON-2 imprimir por fecha de pedido y zonas', () => {
  const FECHA = sumarDias(null, -1);
  const P = (id, clienteId, clienteNombre) => ({ id, clienteId, clienteNombre, fecha: FECHA, estado: 'pendiente', vendedorNombre: 'V', items: [], total: 1 });

  const imprimir = async () => {
    await click(boton('Reparto de hoy'));
    await click(boton('Imprimir pedidos para entregar'));
  };

  it('AC-ZON-2 numera sin huecos dentro de cada zona y pasa ese número a la boleta', async () => {
    setApp();
    getPedidos.mockResolvedValue([P(10, 3, 'Cami'), P(11, 1, 'Ana'), P(12, 4, 'Dani')]);
    await render();
    await imprimir();
    expect(mockApp.syncPedidosFecha).toHaveBeenCalledWith(FECHA);
    const llamadas = generarFacturaFile.mock.calls.map(c => [c[0].clienteNombre, c[4]]);
    // Norte: Ana (puesto 1) => 1, Cami (puesto 3) => 2 (Beto no pidió). Sur: Dani => 1.
    expect(llamadas).toEqual([['Ana', 1], ['Cami', 2], ['Dani', 1]]);
    expect(mergePdfFilesToSingleFile).toHaveBeenCalledTimes(1);
  });

  it('AC-ZON-2 solo las zonas elegidas', async () => {
    setApp();
    getPedidos.mockResolvedValue([P(10, 3, 'Cami'), P(12, 4, 'Dani')]);
    await render();
    const check = [...container.querySelectorAll('[data-testid="zonas-imprimir"] input')][1]; // Sur
    await click(check);
    await imprimir();
    expect(generarFacturaFile.mock.calls.map(c => c[0].clienteNombre)).toEqual(['Dani']);
  });

  it('AC-ZON-2 clientes sin zona van al final, en Sin zona', async () => {
    setApp();
    getPedidos.mockResolvedValue([P(20, 5, 'Eli'), P(21, 1, 'Ana')]);
    await render();
    await imprimir();
    expect(generarFacturaFile.mock.calls.map(c => [c[0].clienteNombre, c[4]])).toEqual([['Ana', 1], ['Eli', 1]]);
  });

  it('AC-ZON-2 sin pedidos avisa y no genera nada', async () => {
    setApp();
    getPedidos.mockResolvedValue([]);
    await render();
    await imprimir();
    expect(generarFacturaFile).not.toHaveBeenCalled();
    expect(window.alert).toHaveBeenCalledWith(expect.stringMatching(/No hay pedidos/));
  });
});
