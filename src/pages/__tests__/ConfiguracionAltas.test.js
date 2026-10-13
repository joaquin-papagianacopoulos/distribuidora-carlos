// Integración de las altas nuevas en Configuración (REQ-CLI / REQ-PROD /
// REQ-PROV) y regresión de la importación CSV (AC-PROD-5, AC-SEC-3).
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// ---- Mocks ----
const mockApp = {};
jest.mock('../../hooks/useAppContext', () => ({ useApp: () => mockApp }));

jest.mock('../../db', () => ({
  addProductoLocal: jest.fn(),
  updateProducto: jest.fn(() => Promise.resolve()),
  deleteProducto: jest.fn(() => Promise.resolve()),
  addCliente: jest.fn(() => Promise.resolve(1)),
  updateCliente: jest.fn(() => Promise.resolve()),
  deleteCliente: jest.fn(() => Promise.resolve()),
  addVendedor: jest.fn(),
  // REQ-VEN: Configuracion ya no usa deleteVendedor (borraba solo local y el
  // pull lo resucitaba). La baja es logica via darDeBajaVendedorAdmin (RPC 004);
  // se testea en src/pages/__tests__/bajaVendedores.test.js.
  getVendedores: jest.fn(() => Promise.resolve([])),
  getProductos: jest.fn(() => Promise.resolve([])),
  updateVendedor: jest.fn(),
  markVendedorSynced: jest.fn(),
  putProveedor: jest.fn(() => Promise.resolve()),
  deleteProveedor: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../sync/syncService', () => ({
  syncProductos: jest.fn(() => Promise.resolve({ ok: true })),
  buscarImagenesFaltantes: jest.fn(),
}));

jest.mock('../../services/imageSearch', () => ({ isImageSearchConfigured: () => false }));

jest.mock('../../services/stockService', () => ({
  ajustarStock: jest.fn(() => Promise.resolve(null)),
}));

const mockSb = { llamadas: [], errorDelete: null };
jest.mock('../../lib/supabase', () => {
  const builder = (table) => {
    const q = { table, op: 'select', filtros: [] };
    const api = {
      delete: () => { q.op = 'delete'; return api; },
      select: () => api,
      eq: (c, v) => { q.filtros.push([c, v]); return api; },
      then: (res, rej) => {
        mockSb.llamadas.push(q);
        const r = q.op === 'delete' && mockSb.errorDelete ? { data: null, error: mockSb.errorDelete } : { data: [], error: null };
        return Promise.resolve(r).then(res, rej);
      },
    };
    return api;
  };
  return { supabase: { from: (t) => builder(t) } };
});

import Configuracion from '../Configuracion';
import {
  addProductoLocal, updateProducto, getProductos, addCliente, updateCliente,
  putProveedor, deleteProveedor,
} from '../../db';
import { ajustarStock } from '../../services/stockService';
import { syncProductos } from '../../sync/syncService';

// ---- Helpers ----
let container;
let root;

const setOnline = (v) => Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => v });
const render = async () => { await act(async () => { root.render(<Configuracion />); }); };
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
const boton = (txt) => [...container.querySelectorAll('button')].find(b => b.textContent.trim() === txt);
const campo = (key) => container.querySelector(`#campo-${key}`);
const setValue = async (el, value) => {
  const isSelect = el.tagName === 'SELECT';
  const proto = isSelect ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event(isSelect ? 'change' : 'input', { bubbles: true }));
  });
};
const llenar = async (vals) => { for (const [k, v] of Object.entries(vals)) await setValue(campo(k), v); };
const irATab = async (t) => click(boton(t));
const itemPorNombre = (nombre) => [...container.querySelectorAll('.list-item')]
  .find(el => el.querySelector('.list-item-name')?.textContent.trim().startsWith(nombre));
const botonBorrar = (nombre) => { const b = itemPorNombre(nombre).querySelectorAll('button'); return b[b.length - 1]; };
const botonEditar = (nombre) => itemPorNombre(nombre).querySelectorAll('button')[0];
const errorDe = (key) => container.querySelector(`[data-error-for="${key}"]`);

const PROVEEDORES = [
  { id: 'prov-1', codigo: 'ARC', descripcion: 'Arcor' },
  { id: 'prov-2', codigo: 'MOL', descripcion: 'Molinos' },
];
const PRODUCTOS = [
  { id: 1, nombre: 'Bon o Bon', codigo: 'B1', precio: 300, unidad: 'unidad', proveedorId: 'prov-1' },
  { id: 2, nombre: 'Coca Cola 500ml', codigo: 'CC500', precio: 1500, unidad: 'unidad' },
];

beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(mockApp, {
    productos: PRODUCTOS,
    clientes: [{ id: 10, codigo: '0010', nombre: 'Kiosco Pepe', direccion: 'Mitre 1' }],
    vendedores: [{ id: 1, nombre: 'Admin', permiso: 1 }],
    proveedores: PROVEEDORES,
    stockMap: new Map([['1', 40], ['2', 5]]),
    vendedorActual: { id: 1, nombre: 'Admin', permiso: 1 },
    seleccionarVendedor: jest.fn(),
    recargar: jest.fn(() => Promise.resolve()),
  });
  mockSb.llamadas = [];
  mockSb.errorDelete = null;
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

// ---------------- Permisos ----------------
describe('Permisos', () => {
  it('AC-SEC-4 un vendedor (permiso 2) no puede entrar a Configuración', async () => {
    mockApp.vendedorActual = { id: 2, nombre: 'Vend', permiso: 2 };
    await render();
    expect(container.textContent).toMatch(/No ten.*s permisos para acceder/);
    expect(container.querySelector('[data-testid="cliente-form"]')).toBeNull();
    expect(boton('proveedores')).toBeUndefined();
  });

  it('AC-SEC-4 un armador (permiso 3) tampoco', async () => {
    mockApp.vendedorActual = { id: 3, nombre: 'Arm', permiso: 3 };
    await render();
    expect(boton('+ Agregar')).toBeUndefined();
  });
});

// ---------------- Proveedores ----------------
describe('Proveedores (REQ-PROV)', () => {
  it('AC-PROV-1 existe la pestaña Proveedores con listado y cantidad de productos asociados', async () => {
    await render();
    await irATab('proveedores');
    expect(container.textContent).toContain('2 proveedores');
    expect(itemPorNombre('Arcor').textContent).toContain('Código ARC · 1 producto(s)');
    expect(itemPorNombre('Molinos').textContent).toContain('0 producto(s)');
  });

  it('AC-PROV-1 alta de proveedor guarda con id UUID y recarga', async () => {
    await render();
    await irATab('proveedores');
    await click(boton('+ Agregar'));
    expect(container.querySelector('[data-testid="proveedor-form"]')).not.toBeNull();
    await llenar({ codigo: ' NES ', descripcion: ' Nestlé  Argentina ' });
    await click(boton('Guardar'));
    expect(putProveedor).toHaveBeenCalledTimes(1);
    const p = putProveedor.mock.calls[0][0];
    expect(p).toMatchObject({ codigo: 'NES', descripcion: 'Nestlé Argentina' });
    expect(p.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(mockApp.recargar).toHaveBeenCalled();
    expect(container.querySelector('[data-testid="proveedor-form"]')).toBeNull();
  });

  it('AC-PROV-2 código duplicado (case-insensitive) se rechaza y no se guarda', async () => {
    await render();
    await irATab('proveedores');
    await click(boton('+ Agregar'));
    await llenar({ codigo: 'arc', descripcion: 'Otro Arcor' });
    await click(boton('Guardar'));
    expect(putProveedor).not.toHaveBeenCalled();
    expect(errorDe('codigo').textContent).toContain('Arcor');
  });

  it('AC-PROV-2 vacíos muestran error por campo', async () => {
    await render();
    await irATab('proveedores');
    await click(boton('+ Agregar'));
    await click(boton('Guardar'));
    expect(putProveedor).not.toHaveBeenCalled();
    expect(errorDe('codigo')).not.toBeNull();
    expect(errorDe('descripcion')).not.toBeNull();
  });

  it('AC-PROV-2 editar un proveedor conserva su id y su propio código no es duplicado', async () => {
    await render();
    await irATab('proveedores');
    await click(botonEditar('Molinos'));
    await setValue(campo('descripcion'), 'Molinos Río de la Plata');
    await click(boton('Guardar'));
    expect(putProveedor).toHaveBeenCalledWith(expect.objectContaining({ id: 'prov-2', codigo: 'MOL', descripcion: 'Molinos Río de la Plata' }));
  });

  it('AC-PROV-3 no se puede borrar un proveedor con productos asociados', async () => {
    await render();
    await irATab('proveedores');
    await click(botonBorrar('Arcor'));
    expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('1 producto(s) asociado(s)'));
    expect(deleteProveedor).not.toHaveBeenCalled();
    expect(mockSb.llamadas).toHaveLength(0);
  });

  it('AC-PROV-3 un proveedor sin productos se borra en Supabase y en el dispositivo', async () => {
    await render();
    await irATab('proveedores');
    await click(botonBorrar('Molinos'));
    expect(mockSb.llamadas[0]).toMatchObject({ table: 'proveedores', op: 'delete', filtros: [['id', 'prov-2']] });
    expect(deleteProveedor).toHaveBeenCalledWith('prov-2');
    expect(mockApp.recargar).toHaveBeenCalled();
  });

  it('AC-PROV-4 si Supabase falla al borrar, no se borra local', async () => {
    mockSb.errorDelete = { message: 'permission denied' };
    await render();
    await irATab('proveedores');
    await click(botonBorrar('Molinos'));
    expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('permission denied'));
    expect(deleteProveedor).not.toHaveBeenCalled();
  });

  it('AC-PROV-4 sin internet no deja borrar un proveedor', async () => {
    setOnline(false);
    await render();
    await irATab('proveedores');
    await click(botonBorrar('Molinos'));
    expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('internet'));
    expect(deleteProveedor).not.toHaveBeenCalled();
  });
});

// ---------------- Clientes ----------------
describe('Clientes (REQ-CLI)', () => {
  it('AC-CLI-1 "+ Agregar" en clientes abre el formulario de 17 campos', async () => {
    await render();
    await irATab('clientes');
    await click(boton('+ Agregar'));
    expect(container.querySelectorAll('[data-testid="cliente-form"] label.input-label')).toHaveLength(17);
    expect(campo('codigo').value).toBe('0011');
  });

  it('AC-CLI-4 alta con código duplicado no llama a addCliente', async () => {
    await render();
    await irATab('clientes');
    await click(boton('+ Agregar'));
    await llenar({ codigo: '0010', nombre: 'Nuevo', direccion: 'X 1' });
    await click(boton('Guardar'));
    expect(addCliente).not.toHaveBeenCalled();
    expect(errorDe('codigo').textContent).toContain('Kiosco Pepe');
  });

  it('AC-CLI-2 alta válida llama a addCliente con datos normalizados y recarga', async () => {
    await render();
    await irATab('clientes');
    await click(boton('+ Agregar'));
    await llenar({ nombre: ' Despensa  Ana ', direccion: 'San Martín 50', tipoIva: 'Consumidor Final' });
    await click(boton('Guardar'));
    expect(addCliente).toHaveBeenCalledWith(expect.objectContaining({ codigo: '0011', nombre: 'Despensa Ana', tipoIva: 'Consumidor Final', pais: 'Argentina' }));
    expect(mockApp.recargar).toHaveBeenCalled();
  });

  it('AC-CLI-6 editar un cliente viejo usa updateCliente preservando campos legacy (id, alias)', async () => {
    mockApp.clientes = [{ id: 10, codigo: '0010', nombre: 'Kiosco Pepe', direccion: 'Mitre 1', alias: 'pepe', diaEntrega: 'lunes' }];
    await render();
    await irATab('clientes');
    await click(botonEditar('Kiosco Pepe'));
    await setValue(campo('ciudad'), 'Rosario');
    await click(boton('Guardar'));
    expect(updateCliente).toHaveBeenCalledWith(expect.objectContaining({ id: 10, alias: 'pepe', diaEntrega: 'lunes', ciudad: 'Rosario' }));
    expect(addCliente).not.toHaveBeenCalled();
  });
});

// ---------------- Productos ----------------
describe('Productos (REQ-PROD)', () => {
  it('AC-PROD-3 alta con stock inicial registra un movimiento "inicial" vía ajustarStock', async () => {
    addProductoLocal.mockResolvedValueOnce(77);
    await render();
    await click(boton('+ Agregar'));
    await llenar({ codigo: 'N1', nombre: 'Nuevo', costoFinal: '100', ganancia: '20', stock: '12', proveedorId: 'prov-2' });
    await click(boton('Guardar'));
    expect(addProductoLocal).toHaveBeenCalledWith(expect.objectContaining({ codigo: 'N1', nombre: 'Nuevo', precio: 120, proveedorId: 'prov-2', unidad: 'unidad' }));
    expect(addProductoLocal.mock.calls[0][0]).not.toHaveProperty('stock');
    expect(ajustarStock).toHaveBeenCalledWith(77, 12, { usuario: 'Admin', inicial: true });
  });

  it('AC-PROD-3 alta sin stock no genera movimiento', async () => {
    addProductoLocal.mockResolvedValueOnce(78);
    await render();
    await click(boton('+ Agregar'));
    await llenar({ codigo: 'N2', nombre: 'Sin stock' });
    await click(boton('Guardar'));
    expect(addProductoLocal).toHaveBeenCalled();
    expect(ajustarStock).not.toHaveBeenCalled();
  });

  it('AC-PROD-3 edición: el campo Stock muestra el actual y cambiarlo registra un ajuste', async () => {
    await render();
    await click(botonEditar('Coca Cola 500ml'));
    expect(campo('stock').value).toBe('5');
    await setValue(campo('stock'), '8');
    await click(boton('Guardar'));
    expect(updateProducto).toHaveBeenCalledWith(expect.objectContaining({ id: 2, precio: 1500 }));
    // iter 4: el ajuste se calcula contra el stock MOSTRADO al abrir (base)
    expect(ajustarStock).toHaveBeenCalledWith(2, 8, { usuario: 'Admin', base: 5 });
    expect(updateProducto).toHaveBeenCalledWith(expect.objectContaining({ extrasDirty: true }));
  });

  // ---- iter 4, bloqueante 2 del revisor ----
  it('AC-PROD-3 bloqueante 2: editar SOLO el precio no llama ajustarStock aunque el ledger cambie con el form abierto', async () => {
    await render();
    await click(botonEditar('Coca Cola 500ml'));
    expect(campo('stock').value).toBe('5');
    // llega un sync: se facturaron 3 en otro dispositivo
    mockApp.stockMap = new Map([['1', 40], ['2', 2]]);
    await render();
    expect(campo('stock').value).toBe('5'); // el form no cambia lo mostrado
    await setValue(campo('precio'), '1700');
    await click(boton('Guardar'));
    expect(updateProducto).toHaveBeenCalledWith(expect.objectContaining({ id: 2, precio: 1700 }));
    expect(ajustarStock).not.toHaveBeenCalled();
  });

  it('AC-PROD-3 bloqueante 2: stock mostrado 10 → 12 con el ledger ya en 7 registra ajuste contra base 10 (+2)', async () => {
    mockApp.stockMap = new Map([['2', 10]]);
    await render();
    await click(botonEditar('Coca Cola 500ml'));
    mockApp.stockMap = new Map([['2', 7]]);
    await render();
    await setValue(campo('stock'), '12');
    await click(boton('Guardar'));
    expect(ajustarStock).toHaveBeenCalledWith(2, 12, { usuario: 'Admin', base: 10 });
  });

  it('AC-PROD-3 bloqueante 2: reescribir el mismo valor de stock no es un cambio', async () => {
    await render();
    await click(botonEditar('Coca Cola 500ml'));
    await setValue(campo('stock'), '5');
    await click(boton('Guardar'));
    expect(ajustarStock).not.toHaveBeenCalled();
  });

  it('AC-CLI-5 bloqueante 1: alta y edición de cliente desde el formulario marcan extrasDirty', async () => {
    await render();
    await irATab('clientes');
    await click(boton('+ Agregar'));
    await llenar({ nombre: 'Nuevo', direccion: 'X 1' });
    await click(boton('Guardar'));
    expect(addCliente).toHaveBeenCalledWith(expect.objectContaining({ extrasDirty: true }));
    await click(botonEditar('Kiosco Pepe'));
    await click(boton('Guardar'));
    expect(updateCliente).toHaveBeenCalledWith(expect.objectContaining({ id: 10, extrasDirty: true }));
  });

  it('AC-PROD-5 bloqueante 1: el import CSV NO marca extrasDirty (sube solo lo básico)', async () => {
    getProductos.mockResolvedValue([{ id: 2, nombre: 'Coca Cola 500ml', codigo: 'CC500', precio: 1500, unidad: 'unidad' }]);
    addProductoLocal.mockResolvedValue(300);
    await render();
    const input = container.querySelector('input[type="file"]');
    Object.defineProperty(input, 'files', { configurable: true, value: [{ name: 'p.csv', size: 10, text: () => Promise.resolve('nombre;precio;codigo\nCoca Cola 500ml;1600;CC500\nNuevo;5;N\n') }] });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(updateProducto.mock.calls[0][0]).not.toHaveProperty('extrasDirty');
    expect(addProductoLocal.mock.calls[0][0]).not.toHaveProperty('extrasDirty');
  });

  it('AC-PROD-2 el listado muestra precio (Precio venta 1) y stock del ledger', async () => {
    await render();
    expect(itemPorNombre('Bon o Bon').textContent).toContain('Stock: 40');
    expect(itemPorNombre('Coca Cola 500ml').textContent).toContain('$1.500');
  });

  it('AC-PROD-3 si falla el guardado avisa y no cierra el formulario', async () => {
    addProductoLocal.mockRejectedValueOnce(new Error('QuotaExceeded'));
    await render();
    await click(boton('+ Agregar'));
    await llenar({ codigo: 'N3', nombre: 'Falla' });
    await click(boton('Guardar'));
    expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('QuotaExceeded'));
    expect(container.querySelector('[data-testid="producto-form"]')).not.toBeNull();
  });
});

// ---------------- CSV (regresión) ----------------
const importar = async (contenido, nombre = 'productos.csv') => {
  const input = container.querySelector('input[type="file"]');
  const file = { name: nombre, text: () => Promise.resolve(contenido) };
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
  // deja terminar las promesas encadenadas del import
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
};

describe('Importación CSV (regresión)', () => {
  beforeEach(() => {
    let next = 100;
    addProductoLocal.mockImplementation(() => Promise.resolve(next++));
    getProductos.mockResolvedValue([{ id: 2, nombre: 'Coca Cola 500ml', codigo: 'CC500', precio: 1500, unidad: 'unidad' }]);
  });

  it('AC-PROD-5 un CSV nombre;precio crea productos y actualiza los existentes', async () => {
    await render();
    await importar('nombre;precio;codigo;unidad;categoria\nAlfajor Jorgito;450;J1;unidad;Golosinas\nCoca Cola 500ml;1600;CC500;unidad;Bebidas\n');
    expect(addProductoLocal).toHaveBeenCalledTimes(1);
    expect(addProductoLocal).toHaveBeenCalledWith(expect.objectContaining({ nombre: 'Alfajor Jorgito', precio: 450, codigo: 'J1', categoria: 'Golosinas' }));
    expect(updateProducto).toHaveBeenCalledWith(expect.objectContaining({ id: 2, precio: 1600 }));
    expect(mockApp.recargar).toHaveBeenCalled();
    expect(syncProductos).toHaveBeenCalled();
    expect(container.textContent).toContain('1 creado, 1 actualizado');
  });

  it('AC-PROD-5 separador coma y comillas también funcionan', async () => {
    getProductos.mockResolvedValue([]);
    await render();
    await importar('nombre,precio\n"Galletitas, surtidas",1200\n');
    expect(addProductoLocal).toHaveBeenCalledWith(expect.objectContaining({ nombre: 'Galletitas, surtidas', precio: 1200 }));
  });

  it('AC-PROD-5 sin columna precio muestra error y no crea nada', async () => {
    await render();
    await importar('nombre;costo\nAlgo;10\n');
    expect(addProductoLocal).not.toHaveBeenCalled();
    expect(container.textContent).toContain('No se encontró columna de precio');
  });

  it('AC-SEC-3 una celda "=cmd()" en nombre/categoría se neutraliza al importar', async () => {
    getProductos.mockResolvedValue([]);
    await render();
    await importar('nombre;precio;categoria\n=cmd();100;@SUM(A1)\n+Producto;50;Bebidas\n');
    expect(addProductoLocal).toHaveBeenCalledTimes(2);
    const [p1] = addProductoLocal.mock.calls[0];
    const [p2] = addProductoLocal.mock.calls[1];
    expect(p1.nombre).toBe("'=cmd()");
    expect(p1.categoria).toBe("'@SUM(A1)");
    expect(p2.nombre).toBe("'+Producto");
    expect(p2.categoria).toBe('Bebidas');
  });

  // Antes BUG B6 (código/unidad sin neutralizar). Corregido en 082c552.
  it('AC-SEC-3 una celda "=..." en código/unidad también se neutraliza', async () => {
    getProductos.mockResolvedValue([]);
    await render();
    await importar('nombre;precio;codigo;unidad\nAlfajor;10;=cmd()|x;@unidad\n');
    const [p] = addProductoLocal.mock.calls[0];
    expect(p.codigo.startsWith("'")).toBe(true);
    expect(p.unidad.startsWith("'")).toBe(true);
    expect(p.codigo).toBe("'=cmd()|x");
    expect(p.unidad).toBe("'@unidad");
  });

  it('AC-PROD-5 S-13 precio con miles y coma decimal ("1.234,50") se importa como 1234.5', async () => {
    getProductos.mockResolvedValue([]);
    await render();
    await importar('nombre;precio\nVino;"1.234,50"\nAgua;$ 950\nMalo;-30\nTexto;abc\n');
    const precios = Object.fromEntries(addProductoLocal.mock.calls.map(([p]) => [p.nombre, p.precio]));
    // iter 3: precio negativo o no numerico => fila ignorada (antes quedaba en 0 y pisaba precios)
    expect(precios).toEqual({ Vino: 1234.5, Agua: 950 });
  });

  it('AC-PROD-5 un código numérico (con ceros adelante o negativo) no se altera', async () => {
    getProductos.mockResolvedValue([]);
    await render();
    await importar('nombre;precio;codigo\nA;1;00123\nB;1;-5\n');
    expect(addProductoLocal.mock.calls.map(([p]) => p.codigo)).toEqual(['00123', '-5']);
  });

  it('AC-PROD-5 S-21 una fila con precio > MAX_IMPORTE se saltea (cuenta como ignorada) y el resto se importa', async () => {
    getProductos.mockResolvedValue([]);
    await render();
    await importar('nombre;precio\nCaro;9999999999999\nJusto;999999999999\nNormal;10\n');
    expect(addProductoLocal.mock.calls.map(([p]) => p.nombre)).toEqual(['Justo', 'Normal']);
    expect(container.textContent).toContain('2 creados, 0 actualizados, 1 línea ignorada');
  });

  it('AC-PROD-5 S-21 un precio gigante tampoco pisa un producto existente', async () => {
    await render();
    await importar('nombre;precio;codigo\nCoca Cola 500ml;1e15;CC500\nCoca Cola 500ml;99999999999999;CC500\n');
    expect(updateProducto).not.toHaveBeenCalledWith(expect.objectContaining({ precio: 99999999999999 }));
  });

  it('AC-SEC-3 S-07 un archivo de más de 5 MB se rechaza sin importar nada', async () => {
    await render();
    const input = container.querySelector('input[type="file"]');
    const text = jest.fn(() => Promise.resolve('nombre;precio\nX;1\n'));
    Object.defineProperty(input, 'files', { configurable: true, value: [{ name: 'grande.csv', size: 5 * 1024 * 1024 + 1, text }] });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(text).not.toHaveBeenCalled();
    expect(addProductoLocal).not.toHaveBeenCalled();
    expect(container.textContent).toContain('El archivo supera 5 MB.');
  });
});
