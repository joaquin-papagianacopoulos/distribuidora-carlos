// REQ-VEN: pantalla Configuracion -> Vendedores. El boton "x" ahora da de baja
// (logica) por la RPC de la 004 con el PIN del admin. Antes borraba solo de
// IndexedDB y el pull lo volvia a bajar (bug reportado por el dueño).
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockApp = {};
jest.mock('../../hooks/useAppContext', () => ({ useApp: () => mockApp }));

// IndexedDB falsa en memoria (solo vendedores).
const mockDb = { vendedores: [] };
jest.mock('../../db', () => ({
  getVendedores: async () => mockDb.vendedores.map(v => ({ ...v })),
  putVendedoresBatch: async (rows) => {
    for (const r of rows) {
      const i = mockDb.vendedores.findIndex(x => x.id === r.id);
      if (i >= 0) mockDb.vendedores[i] = { ...r };
      else mockDb.vendedores.push({ ...r, id: r.id ?? 100 + mockDb.vendedores.length });
    }
  },
  updateVendedor: async (v) => { mockDb.vendedores = mockDb.vendedores.map(x => (x.id === v.id ? { ...v } : x)); },
  addVendedor: async () => 99,
  getProductos: async () => [],
  deleteVendedor: async (id) => { mockDb.borrados.push(id); },
}));
jest.mock('../../services/imageSearch', () => ({
  isImageSearchConfigured: () => false, fetchProductImage: jest.fn(), ImageSearchQuotaError: class extends Error {},
}));
jest.mock('../../services/stockService', () => ({ ajustarStock: async () => null }));

// Supabase falso: tabla vendedores + RPC admin_baja_vendedor como la 004.
const mockSb = { remoto: [], rpc: [], faltaMigracion: false };
jest.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: (fn, args) => {
      mockSb.rpc.push({ fn, args });
      if (mockSb.faltaMigracion) return Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.admin_baja_vendedor' } });
      const admin = mockSb.remoto.find(x => String(x.id) === args.p_admin_id);
      if (!admin || admin.permiso !== 1 || args.p_admin_pin !== '4821') return Promise.resolve({ data: { ok: false, motivo: 'no_autorizado' }, error: null });
      if (args.p_vendedor_id === args.p_admin_id) return Promise.resolve({ data: { ok: false, motivo: 'propio_admin' }, error: null });
      mockSb.remoto = mockSb.remoto.map(x => (String(x.id) === args.p_vendedor_id ? { ...x, activo: false, tiene_pin: false } : x));
      return Promise.resolve({ data: { ok: true }, error: null });
    },
    from: () => {
      const q = { cols: '' };
      const api = {
        select: (cols) => { q.cols = cols; return api; },
        eq: () => api,
        range: () => api,
        then: (res, rej) => {
          const cols = q.cols.split(',');
          return Promise.resolve({ data: mockSb.remoto.map(x => Object.fromEntries(cols.filter(c => c in x).map(c => [c, x[c]]))), error: null }).then(res, rej);
        },
      };
      return api;
    },
  },
}));

// eslint-disable-next-line import/first
import Configuracion from '../Configuracion';
// eslint-disable-next-line import/first
import { downloadVendedores } from '../../sync/syncService';

const ADMIN = { id: 1, remoteId: 7, nombre: 'Jorge', permiso: 1, tienePin: true };
const VEND = { id: 2, remoteId: 8, nombre: 'Carlos', permiso: 2, tienePin: true };
const ARM = { id: 3, remoteId: 9, nombre: 'Ana', permiso: 3 };

let container;
let root;

const setOnline = (v) => Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => v });
const render = async () => { await act(async () => { root.render(<Configuracion />); }); };
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
const escribir = async (el, valor) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  await act(async () => { setter.call(el, valor); el.dispatchEvent(new Event('input', { bubbles: true })); });
};
const irAVendedores = async () => {
  const tab = [...container.querySelectorAll('button')].find(b => /vendedores/i.test(b.textContent) && !b.closest('.list-item'));
  await click(tab);
};
const nombres = () => [...container.querySelectorAll('.list-item-name')].map(el => el.textContent.trim());
const botonBorrar = (nombre) => {
  const item = [...container.querySelectorAll('.list-item')].find(el => el.querySelector('.list-item-name').textContent.trim() === nombre);
  const bs = item.querySelectorAll('button');
  return bs[bs.length - 1];
};
const darDeBaja = async (nombre, pin) => {
  await click(botonBorrar(nombre));
  const input = container.querySelector('[data-testid="admin-pin-baja"]');
  expect(input).not.toBeNull();
  await escribir(input, pin);
  await click(container.querySelector('[data-testid="confirmar-baja"]'));
};

beforeEach(() => {
  mockDb.vendedores = [{ ...ADMIN }, { ...VEND }, { ...ARM }];
  mockDb.borrados = [];
  mockSb.remoto = [
    { id: 7, nombre: 'Jorge', zona: '', permiso: 1, tiene_pin: true, activo: true },
    { id: 8, nombre: 'Carlos', zona: '', permiso: 2, tiene_pin: true, activo: true },
    { id: 9, nombre: 'Ana', zona: '', permiso: 3, tiene_pin: false, activo: true },
  ];
  mockSb.rpc = [];
  mockSb.faltaMigracion = false;
  Object.assign(mockApp, {
    productos: [], clientes: [], proveedores: [], stockMap: new Map(),
    vendedores: mockDb.vendedores.map(v => ({ ...v })),
    vendedorActual: { ...ADMIN },
    seleccionarVendedor: jest.fn(),
    recargar: jest.fn(async () => { mockApp.vendedores = mockDb.vendedores.map(v => ({ ...v })); }),
  });
  window.alert = jest.fn();
  window.confirm = jest.fn(() => true);
  setOnline(true);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
});

describe('AC-VEN-1 AC-VEN-3 baja desde Configuracion -> Vendedores', () => {
  it('AC-VEN-1 AC-VEN-3 con PIN ok: desaparece de la lista y NO reaparece tras el pull', async () => {
    await render();
    await irAVendedores();
    expect(nombres()).toEqual(['Jorge', 'Carlos', 'Ana']);

    await darDeBaja('Carlos', '4821');
    expect(window.alert).not.toHaveBeenCalled();
    expect(mockSb.rpc).toEqual([{ fn: 'admin_baja_vendedor', args: { p_admin_id: '7', p_admin_pin: '4821', p_vendedor_id: '8' } }]);
    await render();
    expect(nombres()).toEqual(['Jorge', 'Ana']);
    expect(container.textContent).toContain('2 vendedores');
    // no se borra el registro local (baja logica) y nunca se usa deleteVendedor
    expect(mockDb.vendedores.find(v => v.id === 2)).toMatchObject({ activo: false, tienePin: false });
    expect(mockDb.borrados).toEqual([]);

    // pull (como el sync automatico) + recargar: sigue sin aparecer
    await act(async () => { await downloadVendedores(); await mockApp.recargar(); });
    await render();
    expect(nombres()).toEqual(['Jorge', 'Ana']);
    expect(mockDb.vendedores).toHaveLength(3);
    // el PIN no queda en ningun lado
    expect(container.querySelector('[data-testid="admin-pin-baja"]')).toBeNull();
    expect(JSON.stringify(mockDb.vendedores)).not.toContain('4821');
  });

  it('AC-VEN-1 sin conexion: avisa, no pide PIN y no hace nada', async () => {
    setOnline(false);
    await render();
    await irAVendedores();
    await click(botonBorrar('Carlos'));
    expect(window.alert).toHaveBeenCalledWith(expect.stringMatching(/Necesitás conexión/));
    expect(container.querySelector('[data-testid="admin-pin-baja"]')).toBeNull();
    expect(mockSb.rpc).toEqual([]);
    expect(mockApp.recargar).not.toHaveBeenCalled();
    expect(nombres()).toContain('Carlos');
  });

  it('AC-VEN-1 PIN incorrecto: avisa, no toca lo local y el campo de PIN queda vacio', async () => {
    await render();
    await irAVendedores();
    await darDeBaja('Carlos', '0000');
    expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('PIN de admin incorrecto'));
    expect(mockDb.vendedores.find(v => v.id === 2).activo).toBeUndefined();
    expect(container.querySelector('[data-testid="admin-pin-baja"]').value).toBe('');
    await render();
    expect(nombres()).toContain('Carlos');
  });

  it('AC-VEN-5 falta la 004: muestra "Falta la migración 004 en Supabase" y no borra nada', async () => {
    mockSb.faltaMigracion = true;
    await render();
    await irAVendedores();
    await darDeBaja('Carlos', '4821');
    expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Falta la migración 004 en Supabase'));
    expect(mockDb.vendedores.every(v => v.activo === undefined)).toBe(true);
    expect(mockDb.borrados).toEqual([]);
    expect(nombres()).toEqual(['Jorge', 'Carlos', 'Ana']);
  });

  it('AC-VEN-4 no se puede dar de baja al propio admin (ultimo admin activo)', async () => {
    await render();
    await irAVendedores();
    await darDeBaja('Jorge', '4821');
    expect(window.alert).toHaveBeenCalledWith(expect.stringMatching(/vos mismo|último admin/));
    expect(mockSb.rpc).toEqual([]);
    expect(mockApp.seleccionarVendedor).not.toHaveBeenCalled();
    expect(nombres()).toContain('Jorge');
  });

  it('AC-VEN-4 no se puede dar de baja al ultimo admin activo (aunque lo intente otro admin)', async () => {
    // Operador: admin "Marta" que en la lista local figura dado de baja (dato viejo);
    // Jorge es el unico admin activo => el cliente lo frena.
    mockDb.vendedores.push({ id: 5, remoteId: 11, nombre: 'Marta', permiso: 1, tienePin: true, activo: false });
    mockApp.vendedores = mockDb.vendedores.map(v => ({ ...v }));
    mockApp.vendedorActual = { id: 5, remoteId: 11, nombre: 'Marta', permiso: 1, tienePin: true };
    await render();
    await irAVendedores();
    await darDeBaja('Jorge', '4821');
    expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('último admin activo'));
    expect(mockSb.rpc).toEqual([]);
  });

  it('AC-VEN-3 los dados de baja no aparecen en la lista ni en el selector de vendedor del cliente', async () => {
    mockDb.vendedores[1] = { ...VEND, activo: false };
    mockApp.vendedores = mockDb.vendedores.map(v => ({ ...v }));
    await render();
    await irAVendedores();
    expect(nombres()).toEqual(['Jorge', 'Ana']);
    const tabClientes = [...container.querySelectorAll('button')].find(b => /clientes/i.test(b.textContent) && !b.closest('.list-item'));
    await click(tabClientes);
    const agregar = [...container.querySelectorAll('button')].find(b => b.textContent.includes('+ Agregar'));
    await click(agregar);
    const form = container.querySelector('[data-testid="cliente-form"]');
    const opciones = [...form.querySelectorAll('option')].map(o => o.textContent);
    expect(opciones).toContain('Jorge');
    expect(opciones).not.toContain('Carlos');
  });
});
