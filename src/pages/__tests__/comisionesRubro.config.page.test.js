// REQ-COMR (RUN 20261014-1449): Configuración -> Vendedores -> "% por rubro"
// (AC-COMR-6, 8) y el Rubro como selector en Productos (AC-COMR-3).
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockApp = {};
jest.mock('../../hooks/useAppContext', () => ({ useApp: () => mockApp }));
jest.mock('../../db', () => new Proxy({}, { get: (_t, k) => (k === '__esModule' ? false : jest.fn(() => Promise.resolve([]))) }));
jest.mock('../../sync/syncService', () => ({ syncProductos: jest.fn(), buscarImagenesFaltantes: jest.fn() }));
jest.mock('../../services/stockService', () => ({ registrarIngreso: jest.fn(), ajustarStock: jest.fn() }));
jest.mock('../../services/imageSearch', () => ({ isImageSearchConfigured: () => false }));
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn(() => { throw new Error('no deberia llamar a Supabase'); }), rpc: jest.fn(() => { throw new Error('no deberia llamar a Supabase'); }) } }));
jest.mock('../../services/comisionesRubroService', () => ({
  cargarTablaRubros: jest.fn(async () => [{ id: 'f1', vendedorId: '8', rubro: 'Golosinas', rubroClave: 'golosinas', pct: 5 }]),
  guardarPctsVendedor: jest.fn(async () => ({ ok: true, mensaje: 'Guardado.' })),
}));

// eslint-disable-next-line import/first
import Configuracion from '../Configuracion';
// eslint-disable-next-line import/first
import { cargarTablaRubros } from '../../services/comisionesRubroService';

const ADMIN = { id: 1, remoteId: 7, nombre: 'Jorge', permiso: 1 };
const VEND = { id: 2, remoteId: 8, nombre: 'Carlos', permiso: 2 };
const ARM = { id: 3, remoteId: 9, nombre: 'Ana', permiso: 3 };
const BAJA = { id: 4, remoteId: 10, nombre: 'Viejo', permiso: 2, activo: false };
const PRODUCTOS = [
  { id: 1, nombre: 'Alfajor', categoria: 'Golosinas', precio: 10 },
  { id: 2, nombre: 'Coca', categoria: 'bebidas', precio: 20 },
  { id: 3, nombre: 'Chicle', categoria: 'GOLOSINAS', precio: 5 },
];

let container;
let root;
beforeEach(() => {
  // CRA usa resetMocks: la implementación se fija en cada test.
  cargarTablaRubros.mockImplementation(async () => [{ id: 'f1', vendedorId: '8', rubro: 'Golosinas', rubroClave: 'golosinas', pct: 5 }]);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

const setApp = (vendedorActual) => {
  Object.keys(mockApp).forEach(k => delete mockApp[k]);
  Object.assign(mockApp, {
    vendedorActual, productos: PRODUCTOS, clientes: [], vendedores: [ADMIN, VEND, ARM, BAJA], proveedores: [], stockMap: new Map(),
    seleccionarVendedor: jest.fn(), recargar: jest.fn(), online: true,
  });
};
const render = async () => { await act(async () => { root.render(<Configuracion />); }); await act(async () => { await Promise.resolve(); }); };
const click = async (el) => {
  await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
};
const tab = (nombre) => [...container.querySelectorAll('button')].find(b => b.textContent.toLowerCase().includes(nombre) && !b.closest('.list-item'));
const $ = (sel) => container.querySelector(sel);

describe('AC-COMR-6 Configuración -> Vendedores -> % por rubro', () => {
  it('AC-COMR-6 el admin ve "% por rubro" en cada vendedor activo y abre la grilla con todos los rubros', async () => {
    setApp(ADMIN);
    await render();
    await click(tab('vendedores'));
    expect($('[data-testid="pct-rubro-1"]')).not.toBeNull();
    expect($('[data-testid="pct-rubro-2"]')).not.toBeNull();
    expect($('[data-testid="pct-rubro-3"]')).not.toBeNull();
    // AC-VEN-3: el dado de baja no se lista, así que tampoco se le ofrece la grilla
    expect($('[data-testid="pct-rubro-4"]')).toBeNull();
    await click($('[data-testid="pct-rubro-2"]'));
    expect($('[data-testid="comision-rubro-grid"]').textContent).toContain('Carlos');
    expect([...container.querySelectorAll('[data-testid^="fila-rubro-"]')].map(d => d.getAttribute('data-testid')))
      .toEqual(['fila-rubro-bebidas', 'fila-rubro-golosinas']);
    expect($('#pct-golosinas').value).toBe('5');
    // tocar de nuevo cierra la grilla
    await click($('[data-testid="pct-rubro-2"]'));
    expect($('[data-testid="comision-rubro-grid"]')).toBeNull();
  });

  it('AC-COMR-6 la grilla se abre como ventana encima de la lista y se cierra con Escape o tocando el fondo', async () => {
    setApp(ADMIN);
    await render();
    await click(tab('vendedores'));
    await click($('[data-testid="pct-rubro-2"]'));
    const modal = $('[data-testid="modal-rubro-vendedor"]');
    expect(modal).not.toBeNull();
    expect(modal.querySelector('[role="dialog"] [data-testid="comision-rubro-grid"]')).not.toBeNull();
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect($('[data-testid="modal-rubro-vendedor"]')).toBeNull();
    await click($('[data-testid="pct-rubro-1"]'));
    await click($('[data-testid="modal-rubro-vendedor"]'));
    expect($('[data-testid="modal-rubro-vendedor"]')).toBeNull();
  });

  it.each([[VEND], [ARM]])('AC-COMR-6 un vendedor o armador (%o) no ve Configuración ni la grilla', async (usuario) => {
    setApp(usuario);
    await render();
    expect(container.textContent).toMatch(/No tenés permisos/);
    expect($('[data-testid^="pct-rubro-"]')).toBeNull();
    expect($('[data-testid="comision-rubro-grid"]')).toBeNull();
  });
});

describe('AC-COMR-3 Configuración pasa los rubros al formulario del producto', () => {
  it('AC-COMR-3 "+ Agregar" producto muestra el selector con los rubros existentes deduplicados', async () => {
    setApp(ADMIN);
    await render();
    const agregar = [...container.querySelectorAll('button')].find(b => b.textContent.includes('+ Agregar'));
    await click(agregar);
    const opciones = [...$('#campo-categoria').options].map(o => o.textContent);
    expect(opciones).toEqual(['— Sin rubro —', 'bebidas', 'Golosinas', 'Agregar rubro nuevo…']);
  });
});
