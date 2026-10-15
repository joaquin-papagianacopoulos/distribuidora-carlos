// Tests de la pantalla de Configuracion: botones quitados, buscador de
// productos y borrado de productos (Supabase + dispositivo).
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// ---- Mocks ----
const mockApp = {};
jest.mock('../hooks/useAppContext', () => ({ useApp: () => mockApp }));

jest.mock('../db', () => ({
  addProductoLocal: jest.fn(),
  updateProducto: jest.fn(),
  deleteProducto: jest.fn(() => Promise.resolve()),
  addCliente: jest.fn(),
  deleteCliente: jest.fn(() => Promise.resolve()),
  addVendedor: jest.fn(),
  // REQ-VEN: Configuracion ya no usa deleteVendedor (borraba solo local y el
  // pull lo resucitaba). La baja es logica via darDeBajaVendedorAdmin (RPC 004);
  // se testea en src/pages/__tests__/bajaVendedores.test.js.
  getVendedores: jest.fn(() => Promise.resolve([])),
  getProductos: jest.fn(() => Promise.resolve([])),
  updateVendedor: jest.fn(),
  markVendedorSynced: jest.fn(),
}));

jest.mock('../sync/syncService', () => ({
  syncProductos: jest.fn(),
  buscarImagenesFaltantes: jest.fn(),
}));

jest.mock('../services/imageSearch', () => ({ isImageSearchConfigured: () => false }));

// Supabase falso: guarda las filas de "productos" en memoria.
// mockSupabaseState.bloquearBorrado simula RLS sin permiso de borrado
// (Supabase no da error, pero no borra nada).
const mockSupabaseState = { filas: [], bloquearBorrado: false, errorDelete: null, llamadas: [] };
jest.mock('../lib/supabase', () => {
  const builder = (table) => {
    const q = { table, op: null, filtros: [] };
    const run = () => {
      mockSupabaseState.llamadas.push({ table: q.table, op: q.op, filtros: q.filtros });
      const match = (r) => q.filtros.every(([col, val]) => r[col] === val);
      if (q.op === 'delete') {
        if (mockSupabaseState.errorDelete) return { data: null, error: mockSupabaseState.errorDelete };
        if (!mockSupabaseState.bloquearBorrado) {
          mockSupabaseState.filas = mockSupabaseState.filas.filter(r => !match(r));
        }
        return { data: null, error: null };
      }
      return { data: mockSupabaseState.filas.filter(match).map(r => ({ id: r.id })), error: null };
    };
    const api = {
      delete: () => { q.op = 'delete'; return api; },
      select: () => { q.op = q.op || 'select'; return api; },
      eq: (col, val) => { q.filtros.push([col, val]); return api; },
      then: (res, rej) => Promise.resolve(run()).then(res, rej),
    };
    return api;
  };
  return { supabase: { from: (t) => builder(t) } };
});

import Configuracion from './Configuracion';
import { deleteProducto } from '../db';

// ---- Helpers ----
const PRODUCTOS = [
  { id: 1, nombre: 'Alfajor Milka Mousse', codigo: 'A100', precio: 900, unidad: 'unidad', categoria: 'Golosinas', marca: 'Milka' },
  { id: 2, nombre: 'Coca Cola 500ml', codigo: 'CC500', precio: 1500, unidad: 'unidad', categoria: 'Bebidas', marca: 'Coca Cola' },
  { id: 3, nombre: 'Galletitas Óreo', codigo: 'G77', precio: 1200, unidad: 'unidad', categoria: 'Galletitas', marca: 'Oreo' },
];

let container;
let root;

const setOnline = (value) => {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => value });
};

const render = async () => {
  await act(async () => { root.render(<Configuracion />); });
};

const nombresListados = () =>
  [...container.querySelectorAll('.list-item-name')].map(el => el.textContent.trim());

const escribirBusqueda = async (texto) => {
  const input = container.querySelector('input[type="search"]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  await act(async () => {
    setter.call(input, texto);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

const botonBorrar = (nombre) => {
  const item = [...container.querySelectorAll('.list-item')]
    .find(el => el.querySelector('.list-item-name').textContent.trim() === nombre);
  const botones = item.querySelectorAll('button');
  return botones[botones.length - 1];
};

const click = async (el) => {
  await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
};

beforeEach(() => {
  Object.assign(mockApp, {
    productos: PRODUCTOS,
    clientes: [],
    vendedores: [],
    vendedorActual: { id: 1, nombre: 'Admin', permiso: 1 },
    seleccionarVendedor: jest.fn(),
    recargar: jest.fn(() => Promise.resolve()),
  });
  mockSupabaseState.filas = PRODUCTOS.map(p => ({ id: p.id }));
  mockSupabaseState.bloquearBorrado = false;
  mockSupabaseState.errorDelete = null;
  mockSupabaseState.llamadas = [];
  jest.clearAllMocks();
  window.confirm = jest.fn(() => true);
  window.alert = jest.fn();
  setOnline(true);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
});

// ---- Tests ----
describe('Botones quitados', () => {
  test.each([
    'Detectar marcas faltantes',
    'Buscar fotos faltantes',
    'Seleccionar backup JSON',
    'Seleccionar backup.mn',
    'Importar backup',
  ])('no aparece "%s"', async (texto) => {
    await render();
    expect(container.textContent).not.toContain(texto);
  });

  test('sigue estando la importación de CSV', async () => {
    await render();
    expect(container.textContent).toContain('Seleccionar archivo CSV/XLSX');
  });
});

describe('Buscador de productos', () => {
  test('sin texto muestra todos los productos', async () => {
    await render();
    expect(nombresListados()).toHaveLength(3);
    expect(container.textContent).toContain('3 productos');
  });

  test('filtra por nombre sin importar mayúsculas', async () => {
    await render();
    await escribirBusqueda('coca');
    expect(nombresListados()).toEqual(['Coca Cola 500ml']);
    expect(container.textContent).toContain('1 productos');
  });

  test('ignora tildes', async () => {
    await render();
    await escribirBusqueda('oreo');
    expect(nombresListados()).toEqual(['Galletitas Óreo']);
  });

  test('filtra por código, categoría y marca', async () => {
    await render();
    await escribirBusqueda('a100');
    expect(nombresListados()).toEqual(['Alfajor Milka Mousse']);
    await escribirBusqueda('bebidas');
    expect(nombresListados()).toEqual(['Coca Cola 500ml']);
    await escribirBusqueda('milka');
    expect(nombresListados()).toEqual(['Alfajor Milka Mousse']);
  });

  test('sin coincidencias muestra el mensaje de búsqueda vacía', async () => {
    await render();
    await escribirBusqueda('xyz inexistente');
    expect(nombresListados()).toHaveLength(0);
    expect(container.textContent).toContain('Sin resultados para la búsqueda');
  });
});

describe('Borrar producto', () => {
  test('borra en Supabase y después en el dispositivo', async () => {
    await render();
    await click(botonBorrar('Coca Cola 500ml'));

    const ops = mockSupabaseState.llamadas.map(l => l.op);
    expect(ops[0]).toBe('delete');
    expect(mockSupabaseState.llamadas[0]).toEqual({ table: 'productos', op: 'delete', filtros: [['id', 2]] });
    expect(mockSupabaseState.filas.map(r => r.id)).toEqual([1, 3]);
    expect(deleteProducto).toHaveBeenCalledWith(2);
    expect(mockApp.recargar).toHaveBeenCalled();
    expect(window.alert).not.toHaveBeenCalled();
  });

  test('si se cancela la confirmación no borra nada', async () => {
    window.confirm = jest.fn(() => false);
    await render();
    await click(botonBorrar('Coca Cola 500ml'));
    expect(mockSupabaseState.llamadas).toHaveLength(0);
    expect(deleteProducto).not.toHaveBeenCalled();
  });

  test('sin internet avisa y no borra', async () => {
    setOnline(false);
    await render();
    await click(botonBorrar('Coca Cola 500ml'));
    expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('internet'));
    expect(mockSupabaseState.llamadas).toHaveLength(0);
    expect(deleteProducto).not.toHaveBeenCalled();
  });

  test('si Supabase no deja borrar (RLS) avisa y no lo borra del dispositivo', async () => {
    mockSupabaseState.bloquearBorrado = true;
    await render();
    await click(botonBorrar('Coca Cola 500ml'));
    expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('No se pudo borrar el producto'));
    expect(deleteProducto).not.toHaveBeenCalled();
    expect(mockApp.recargar).not.toHaveBeenCalled();
  });

  test('si Supabase devuelve error avisa y no lo borra del dispositivo', async () => {
    mockSupabaseState.errorDelete = { message: 'violates row-level security policy' };
    await render();
    await click(botonBorrar('Coca Cola 500ml'));
    expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('violates row-level security policy'));
    expect(deleteProducto).not.toHaveBeenCalled();
  });

  test('un producto que nunca se subió a Supabase se borra igual', async () => {
    mockSupabaseState.filas = [{ id: 1 }, { id: 3 }];
    await render();
    await click(botonBorrar('Coca Cola 500ml'));
    expect(deleteProducto).toHaveBeenCalledWith(2);
    expect(window.alert).not.toHaveBeenCalled();
  });

  test('después de un error el botón vuelve a estar habilitado', async () => {
    mockSupabaseState.bloquearBorrado = true;
    await render();
    await click(botonBorrar('Coca Cola 500ml'));
    const boton = botonBorrar('Coca Cola 500ml');
    expect(boton.disabled).toBe(false);
    expect(boton.textContent).toBe('×');
  });
});

// REQ-FOT: productos sin foto marcados en la lista.
describe('Fotos de productos', () => {
  test('AC-FOT-3 marca los productos sin foto y cuenta cuántos faltan', async () => {
    mockApp.productos = [{ ...PRODUCTOS[0], imagen_url: 'https://x.supabase.co/storage/v1/object/public/tienda/img/a.png' }, PRODUCTOS[1], PRODUCTOS[2]];
    await render();
    expect(container.querySelectorAll('[data-testid="producto-sin-foto"]').length).toBe(2);
    expect(container.querySelector('[data-testid="contador-sin-foto"]').textContent).toContain('2 sin foto');
  });
});
