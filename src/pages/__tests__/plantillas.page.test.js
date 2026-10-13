// REQ-PLA en Configuracion: botones "Descargar plantilla Excel", importacion
// de productos con la plantilla nueva e importacion de clientes.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import * as XLSX from 'xlsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockApp = {};
jest.mock('../../hooks/useAppContext', () => ({ useApp: () => mockApp }));

jest.mock('../../db', () => ({
  addProductoLocal: jest.fn(),
  updateProducto: jest.fn(() => Promise.resolve()),
  deleteProducto: jest.fn(() => Promise.resolve()),
  addCliente: jest.fn(() => Promise.resolve(1)),
  updateCliente: jest.fn(() => Promise.resolve()),
  deleteCliente: jest.fn(() => Promise.resolve()),
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
jest.mock('../../services/stockService', () => ({ ajustarStock: jest.fn(() => Promise.resolve(null)) }));
jest.mock('../../lib/supabase', () => ({ supabase: { from: () => ({}) } }));

import Configuracion from '../Configuracion';
import { addProductoLocal, updateProducto, getProductos, addCliente, updateCliente } from '../../db';
import { ajustarStock } from '../../services/stockService';
import { CAMPOS_PRODUCTO } from '../../domain/productos';
import { CAMPOS_CLIENTE } from '../../domain/clientes';

let container;
let root;
const setOnline = (v) => Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => v });
const render = async () => { await act(async () => { root.render(<Configuracion />); }); };
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
const boton = (txt) => [...container.querySelectorAll('button')].find(b => b.textContent.trim() === txt);
const botonesPlantilla = () => [...container.querySelectorAll('button')].filter(b => b.textContent.trim() === 'Descargar plantilla Excel');
const esperar = async () => { for (let i = 0; i < 5; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); }); };

const subir = async (input, file) => {
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
  await esperar();
};
const xlsxFile = (nombre, aoa, hoja = 'Hoja1') => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), hoja);
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return { name: nombre, size: buf.byteLength, arrayBuffer: () => Promise.resolve(buf) };
};

const PROVEEDORES = [{ id: 'prov-1', codigo: 'ARC', descripcion: 'Arcor' }];
const CLIENTES = [{ id: 10, codigo: '0010', nombre: 'Kiosco Pepe', direccion: 'Mitre 1', boletaContraBoleta: true }];

let anchorClick;
beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(mockApp, {
    productos: [],
    clientes: CLIENTES,
    vendedores: [{ id: 1, nombre: 'Admin', permiso: 1 }, { id: 2, nombre: 'Juan', permiso: 2 }, { id: 3, nombre: 'Viejo', permiso: 2, activo: false }],
    proveedores: PROVEEDORES,
    stockMap: new Map(),
    vendedorActual: { id: 1, nombre: 'Admin', permiso: 1 },
    seleccionarVendedor: jest.fn(),
    recargar: jest.fn(() => Promise.resolve()),
  });
  window.alert = jest.fn();
  window.confirm = jest.fn(() => true);
  setOnline(true);
  URL.createObjectURL = jest.fn(() => 'blob:plantilla');
  URL.revokeObjectURL = jest.fn();
  anchorClick = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  anchorClick.mockRestore();
  act(() => { root.unmount(); });
  container.remove();
});

describe('AC-PLA-1 / AC-PLA-2 botones de plantilla', () => {
  it('AC-PLA-1 en Productos hay "Descargar plantilla Excel" y baja plantilla_productos.xlsx', async () => {
    await render();
    expect(botonesPlantilla()).toHaveLength(1);
    await click(botonesPlantilla()[0]);
    await esperar();
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    const blob = URL.createObjectURL.mock.calls[0][0];
    expect(blob.type).toMatch(/spreadsheetml/);
    expect(anchorClick).toHaveBeenCalledTimes(1);
    expect(anchorClick.mock.instances[0].download).toBe('plantilla_productos.xlsx');
    // El libro descargado tiene los encabezados del formulario.
    const buf = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsArrayBuffer(blob); });
    const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
    expect(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 })[0]).toEqual(CAMPOS_PRODUCTO.map(c => c.label));
    expect(wb.SheetNames[1]).toBe('Instrucciones');
  });

  it('AC-PLA-2 en Clientes hay una tarjeta de importación con "Descargar plantilla Excel" (plantilla_clientes.xlsx)', async () => {
    await render();
    await click(boton('clientes'));
    expect(container.querySelector('[data-testid="import-clientes"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="import-productos"]')).toBeNull();
    await click(container.querySelector('[data-testid="plantilla-clientes"]'));
    await esperar();
    expect(anchorClick.mock.instances[0].download).toBe('plantilla_clientes.xlsx');
  });

  it('AC-PLA-2 en Proveedores y Vendedores no aparece el botón', async () => {
    await render();
    await click(boton('proveedores'));
    expect(botonesPlantilla()).toHaveLength(0);
    await click(boton('vendedores'));
    expect(botonesPlantilla()).toHaveLength(0);
  });

  it('AC-PLA-1 si falla la generación avisa', async () => {
    URL.createObjectURL = jest.fn(() => { throw new Error('sin blob'); });
    await render();
    await click(botonesPlantilla()[0]);
    await esperar();
    expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('sin blob'));
  });

  it.each([[2, 'vendedor'], [3, 'armador']])('AC-PLA-6 AC-SEC-4 permiso %i (%s) no ve botones de plantilla ni importación', async (permiso) => {
    mockApp.vendedorActual = { id: 9, nombre: 'X', permiso };
    await render();
    expect(botonesPlantilla()).toHaveLength(0);
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(container.textContent).toMatch(/No ten.*s permisos/);
  });
});

describe('AC-PLA-3 importación de productos con la plantilla', () => {
  it('AC-PLA-3 XLSX de plantilla: crea con stock inicial (movimiento inicial), actualiza sin tocar stock y lista rechazos', async () => {
    getProductos.mockResolvedValue([{ id: 7, nombre: 'Bon o Bon', codigo: 'B1', precio: 300, unidad: 'unidad' }]);
    addProductoLocal.mockResolvedValue(55);
    await render();
    const L = CAMPOS_PRODUCTO.map(c => c.label);
    const fila = (o) => L.map(l => o[l] ?? '');
    const file = xlsxFile('plantilla_productos.xlsx', [
      L,
      fila({ 'Código': 'N1', 'Descripción': 'Nuevo', 'Proveedor': 'arcor', 'Costo final': '100', '% Ganancia': '50', 'Stock': '10' }),
      fila({ 'Código': 'B1', 'Descripción': 'Bon o Bon', 'Precio venta 1': '350', 'Stock': '99' }),
      fila({ 'Código': 'N2', 'Descripción': 'Malo', 'Bulto x': '0' }),
    ]);
    await subir(container.querySelector('input[type="file"]'), file);
    expect(addProductoLocal).toHaveBeenCalledWith(expect.objectContaining({ codigo: 'N1', proveedorId: 'prov-1', precio: 150, extrasDirty: true }));
    expect(ajustarStock).toHaveBeenCalledTimes(1);
    expect(ajustarStock).toHaveBeenCalledWith(55, 10, { usuario: 'Admin', inicial: true });
    expect(updateProducto).toHaveBeenCalledWith(expect.objectContaining({ id: 7, precio: 350, extrasDirty: true }));
    const res = container.querySelector('[data-testid="resultado-productos"]');
    expect(res.textContent).toContain('1 creado, 1 actualizado, 1 línea ignorada');
    expect(container.querySelector('[data-testid="resultado-productos-resumen"]').textContent)
      .toContain('Creados: 1 · Actualizados: 1 · Rechazados: 1 · Stock ignorado en 1 producto(s) existente(s)');
    expect(container.querySelector('[data-testid="resultado-productos-rechazos"]').textContent).toContain('Fila 4: Bulto x: entero');
  });

  it('AC-PLA-5 si falla el guardado de una fila, se informa y sigue con el resto', async () => {
    addProductoLocal.mockRejectedValueOnce(new Error('QuotaExceeded')).mockResolvedValue(2);
    await render();
    await subir(container.querySelector('input[type="file"]'), { name: 'p.csv', size: 10, text: () => Promise.resolve('Código;Descripción;Precio venta 1\nA;Uno;1\nB;Dos;2\n') });
    expect(addProductoLocal).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[data-testid="resultado-productos-rechazos"]').textContent).toContain('Fila 2: No se pudo guardar: QuotaExceeded');
    expect(container.querySelector('[data-testid="resultado-productos-resumen"]').textContent).toContain('Creados: 1');
  });

  it('AC-PLA-6 S-07 un XLSX de más de 5 MB no se parsea', async () => {
    await render();
    const arrayBuffer = jest.fn();
    await subir(container.querySelector('input[type="file"]'), { name: 'g.xlsx', size: 5 * 1024 * 1024 + 1, arrayBuffer });
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(container.textContent).toContain('El archivo supera 5 MB.');
  });
});

describe('AC-PLA-4 / AC-PLA-5 importación de clientes', () => {
  const irAClientes = async () => { await render(); await click(boton('clientes')); };
  const inputClientes = () => container.querySelector('[data-testid="input-import-clientes"]');

  it('AC-PLA-4 AC-PLA-5 CSV: crea, actualiza por código (extrasDirty como el form) y muestra resumen con rechazos', async () => {
    await irAClientes();
    const csv = [
      'Código cliente;Razón social;Domicilio de entrega;Tipo de IVA;CUIT;Vendedor;Comisión',
      '0042;Nuevo SA;Calle 1;Responsable Inscripto;30712345671;juan;5',
      '0010;Kiosco Pepe SRL;Mitre 1;;;;',
      '0043;CUIT malo;Calle 2;Monotributo;20123456780;;',
      '0044;Vendedor viejo;Calle 3;;;Viejo;',
      '0042;Repetido;Calle 4;;;;',
      '0045;Comision;Calle 5;;;;150',
    ].join('\n');
    await subir(inputClientes(), { name: 'clientes.csv', size: csv.length, text: () => Promise.resolve(csv) });
    expect(addCliente).toHaveBeenCalledTimes(1);
    expect(addCliente).toHaveBeenCalledWith(expect.objectContaining({
      codigo: '0042', nombre: 'Nuevo SA', cuit: '30-71234567-1', vendedor: 'Juan', comision: 5, extrasDirty: true, boletaContraBoleta: false,
    }));
    expect(updateCliente).toHaveBeenCalledWith(expect.objectContaining({ id: 10, nombre: 'Kiosco Pepe SRL', boletaContraBoleta: true, extrasDirty: true }));
    expect(mockApp.recargar).toHaveBeenCalled();
    expect(container.querySelector('[data-testid="resultado-clientes-resumen"]').textContent).toContain('Creados: 1 · Actualizados: 1 · Rechazados: 4');
    const rech = container.querySelector('[data-testid="resultado-clientes-rechazos"]').textContent;
    expect(rech).toContain('Fila 4: CUIT inválido');
    expect(rech).toContain('Fila 5: Vendedor "Viejo" no existe o está dado de baja');
    expect(rech).toContain('Fila 6: Código repetido en el archivo (ya está en la fila 2)');
    expect(rech).toContain('Fila 7: La comisión debe ser un % entre 0 y 100');
  });

  it('AC-PLA-4 XLSX con la plantilla de clientes', async () => {
    await irAClientes();
    const L = CAMPOS_CLIENTE.map(c => c.label);
    const file = xlsxFile('plantilla_clientes.xlsx', [L, L.map(l => ({ 'Código cliente': 'X1', 'Razón social': 'Desde Excel', 'Domicilio de entrega': 'Dir', 'Provincia': 'cordoba' }[l] ?? ''))], 'Clientes');
    await subir(inputClientes(), file);
    expect(addCliente).toHaveBeenCalledWith(expect.objectContaining({ codigo: 'X1', provincia: 'Córdoba', extrasDirty: true }));
    expect(container.querySelector('[data-testid="resultado-clientes"]').textContent).toContain('1 creado, 0 actualizados');
  });

  it('AC-PLA-4 archivo sin columnas obligatorias muestra error y no guarda nada', async () => {
    await irAClientes();
    await subir(inputClientes(), { name: 'c.csv', size: 5, text: () => Promise.resolve('nombre;telefono\nA;1\n') });
    expect(addCliente).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="resultado-clientes"]').textContent).toContain('Faltan columnas obligatorias');
  });

  it('AC-PLA-6 S-07 clientes: archivo de más de 5 MB se rechaza sin leerlo', async () => {
    await irAClientes();
    const text = jest.fn();
    await subir(inputClientes(), { name: 'c.csv', size: 5 * 1024 * 1024 + 1, text });
    expect(text).not.toHaveBeenCalled();
    expect(container.textContent).toContain('El archivo supera 5 MB.');
  });

  it('AC-PLA-5 si falla el guardado de un cliente se informa como rechazo', async () => {
    updateCliente.mockRejectedValueOnce(new Error('disco lleno'));
    await irAClientes();
    await subir(inputClientes(), { name: 'c.csv', size: 5, text: () => Promise.resolve('Código cliente;Razón social;Domicilio de entrega\n0010;Pepe;Mitre\n') });
    expect(container.querySelector('[data-testid="resultado-clientes-rechazos"]').textContent).toContain('Fila 2: No se pudo guardar: disco lleno');
  });
});
