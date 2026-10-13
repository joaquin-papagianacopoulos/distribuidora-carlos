// AC-SEC-4: las pantallas de admin (Stock, Configuracion) niegan el acceso
// a vendedor (2), armador (3) y a sesiones sin vendedor seleccionado.
// Nota: esto es control de UI. El permiso vive en localStorage y se puede
// forjar; la proteccion real tiene que estar en Supabase (ver security-report).
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockApp = {};
jest.mock('../../hooks/useAppContext', () => ({ useApp: () => mockApp }));
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn(() => { throw new Error('no deberia llamar a Supabase'); }) } }));
jest.mock('../../db', () => new Proxy({}, { get: (_t, k) => (k === '__esModule' ? false : jest.fn(() => Promise.resolve([]))) }));
jest.mock('../../sync/syncService', () => ({ syncProductos: jest.fn(), buscarImagenesFaltantes: jest.fn() }));
jest.mock('../../services/stockService', () => ({ registrarIngreso: jest.fn(), ajustarStock: jest.fn() }));
jest.mock('../../services/imageSearch', () => ({ isImageSearchConfigured: () => false }));

// eslint-disable-next-line import/first
import Stock from '../Stock';
// eslint-disable-next-line import/first
import Configuracion from '../Configuracion';

let container;
let root;

const baseApp = (vendedorActual) => ({
  productos: [{ id: 'p1', nombre: 'Producto secreto', codigo: 'X1', precio: 10 }],
  clientes: [{ id: 'c1', nombre: 'Cliente secreto', codigo: 'C1' }],
  vendedores: [{ id: 9, nombre: 'Vendedor secreto', permiso: 1, pin: '4321' }],
  proveedores: [{ id: 'pv1', codigo: 'PV', descripcion: 'Proveedor secreto' }],
  ingresos: [],
  movimientosStock: [],
  stockMap: new Map([['p1', 5]]),
  vendedorActual,
  seleccionarVendedor: jest.fn(),
  recargar: jest.fn(() => Promise.resolve()),
  zonaActiva: '',
  setZona: jest.fn(),
  online: false,
});

const render = async (Comp, vendedorActual) => {
  Object.keys(mockApp).forEach(k => delete mockApp[k]);
  Object.assign(mockApp, baseApp(vendedorActual));
  await act(async () => { root.render(<Comp />); });
  return container.textContent;
};

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

const NO_ADMIN = [
  ['vendedor (2)', { id: 2, nombre: 'Vend', permiso: 2 }],
  ['armador (3)', { id: 3, nombre: 'Arm', permiso: 3 }],
  ['permiso desconocido (99)', { id: 4, nombre: 'Raro', permiso: 99 }],
  ['permiso 0', { id: 5, nombre: 'Cero', permiso: 0 }],
  ['sin permiso', { id: 6, nombre: 'SinPermiso' }],
  ['sin vendedor seleccionado', null],
];

describe('AC-SEC-4 Stock solo para admin', () => {
  test.each(NO_ADMIN)('AC-SEC-4 Stock niega acceso a %s', async (_label, v) => {
    const txt = await render(Stock, v);
    expect(txt).toMatch(/No ten.s permisos/);
    expect(txt).not.toContain('Producto secreto');
    expect(container.querySelector('input, select, form')).toBeNull();
  });

  test('AC-SEC-4 Stock se muestra al admin (control positivo)', async () => {
    const txt = await render(Stock, { id: 1, nombre: 'Admin', permiso: 1 });
    expect(txt).not.toMatch(/No ten.s permisos/);
  });
});

describe('AC-SEC-4 Configuracion solo para admin', () => {
  test.each(NO_ADMIN)('AC-SEC-4 Configuracion niega acceso a %s', async (_label, v) => {
    const txt = await render(Configuracion, v);
    expect(txt).toMatch(/No ten.+s permisos/);
    expect(txt).not.toContain('Producto secreto');
    expect(txt).not.toContain('Vendedor secreto');
    expect(txt).not.toContain('4321');
    expect(container.querySelector('input[type="file"]')).toBeNull();
  });

  test('AC-SEC-4 Configuracion se muestra al admin (control positivo)', async () => {
    const txt = await render(Configuracion, { id: 1, nombre: 'Admin', permiso: 1 });
    expect(txt).not.toMatch(/No ten.+s permisos/);
  });
});
