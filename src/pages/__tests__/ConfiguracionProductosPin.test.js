// S-VTA-01 (QA): UI de Configuracion para subir productos y borrar con PIN de admin.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockApp = {};
jest.mock('../../hooks/useAppContext', () => ({ useApp: () => mockApp }));
jest.mock('../../db', () => ({
  addProductoLocal: jest.fn(), updateProducto: jest.fn(() => Promise.resolve()),
  deleteProducto: jest.fn(() => Promise.resolve()), addCliente: jest.fn(), updateCliente: jest.fn(),
  deleteCliente: jest.fn(), addVendedor: jest.fn(), getVendedores: jest.fn(() => Promise.resolve([])),
  getProductos: jest.fn(() => Promise.resolve([])), updateVendedor: jest.fn(), markVendedorSynced: jest.fn(),
  putProveedor: jest.fn(), deleteProveedor: jest.fn(),
}));
jest.mock('../../sync/syncService', () => ({
  syncProductos: jest.fn(() => Promise.resolve({ ok: true })), buscarImagenesFaltantes: jest.fn(),
}));
jest.mock('../../services/imageSearch', () => ({ isImageSearchConfigured: () => false }));
jest.mock('../../services/stockService', () => ({ ajustarStock: jest.fn() }));
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }));
jest.mock('../../services/productosAdminService', () => ({
  sondearMigracion007: jest.fn(),
  subirProductosConPin: jest.fn(),
  borrarProductoAdmin: jest.fn(),
  contarProductosPendientes: jest.fn(),
}));

import Configuracion from '../Configuracion';
import {
  sondearMigracion007, subirProductosConPin, borrarProductoAdmin, contarProductosPendientes,
} from '../../services/productosAdminService';

let container; let root;
const setOnline = (v) => Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => v });
const render = async () => { await act(async () => { root.render(<Configuracion />); }); };
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
const boton = (txt) => [...container.querySelectorAll('button')].find(b => b.textContent.trim() === txt);
const tid = (id) => container.querySelector(`[data-testid="${id}"]`);
const setValue = async (el, value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  await act(async () => { setter.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); });
};
const itemPorNombre = (n) => [...container.querySelectorAll('.list-item')]
  .find(el => el.querySelector('.list-item-name')?.textContent.trim().startsWith(n));
const botonBorrar = (n) => { const b = itemPorNombre(n).querySelectorAll('button'); return b[b.length - 1]; };

beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(mockApp, {
    productos: [{ id: 1, nombre: 'Bon o Bon', codigo: 'B1', precio: 300, unidad: 'unidad' }],
    clientes: [], vendedores: [{ id: 1, nombre: 'Admin', permiso: 1 }], proveedores: [], stockMap: new Map(),
    vendedorActual: { id: 1, nombre: 'Admin', permiso: 1 },
    seleccionarVendedor: jest.fn(), recargar: jest.fn(() => Promise.resolve()),
  });
  contarProductosPendientes.mockResolvedValue(0);
  sondearMigracion007.mockResolvedValue({ faltaMigracion: false });
  window.confirm = jest.fn(() => true);
  window.alert = jest.fn();
  setOnline(true);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe('S01-3 aviso y Subir productos con PIN', () => {
  it('S01-3 sin pendientes no muestra el aviso', async () => {
    await render();
    expect(tid('productos-pendientes')).toBeNull();
  });
  it('S01-3 con pendientes muestra el aviso con la cantidad', async () => {
    contarProductosPendientes.mockResolvedValue(3);
    await render();
    expect(tid('productos-pendientes').textContent).toMatch(/3 producto\(s\) sin subir/);
    expect(tid('admin-pin-productos').type).toBe('password');
  });
  it('S01-3 Subir productos manda el PIN, lo vacia del campo y informa', async () => {
    contarProductosPendientes.mockResolvedValue(2);
    subirProductosConPin.mockResolvedValue({ ok: true, subidos: 2, rechazados: [] });
    await render();
    await setValue(tid('admin-pin-productos'), '1234');
    await click(tid('subir-productos'));
    expect(subirProductosConPin).toHaveBeenCalledWith('1234');
    expect(tid('admin-pin-productos').value).toBe('');
    expect(tid('productos-msg').textContent).toMatch(/Productos subidos/);
    expect(mockApp.recargar).toHaveBeenCalled();
  });
  it('S01-3 PIN incorrecto: muestra el mensaje del servicio, sin PIN en el DOM', async () => {
    contarProductosPendientes.mockResolvedValue(2);
    subirProductosConPin.mockResolvedValue({ ok: false, motivo: 'no_autorizado', mensaje: 'PIN incorrecto o sin permiso.' });
    await render();
    await setValue(tid('admin-pin-productos'), '9999');
    await click(tid('subir-productos'));
    expect(tid('productos-msg').textContent).toMatch(/PIN incorrecto/);
    expect(container.innerHTML).not.toMatch(/9999/);
    expect(tid('productos-pendientes')).not.toBeNull();
  });
  it('S01-4 aceptacion parcial: informa cuantos rechazo el servidor', async () => {
    contarProductosPendientes.mockResolvedValue(2);
    subirProductosConPin.mockResolvedValue({ ok: true, subidos: 1, rechazados: [{ id: 2, motivo: 'datos_invalidos' }] });
    await render();
    await setValue(tid('admin-pin-productos'), '1234');
    await click(tid('subir-productos'));
    expect(tid('productos-msg').textContent).toMatch(/Se subieron 1.*rechaz. 1/);
  });
  it('S01-3 PIN vacio: el servicio valida y la pantalla no lanza', async () => {
    contarProductosPendientes.mockResolvedValue(1);
    subirProductosConPin.mockResolvedValue({ ok: false, mensaje: 'Ingresa tu PIN.' });
    await render();
    await click(tid('subir-productos'));
    expect(subirProductosConPin).toHaveBeenCalledWith('');
    expect(tid('productos-msg').textContent).toMatch(/PIN/);
  });
  it('S01-6 un no admin no ve Configuracion ni el aviso', async () => {
    mockApp.vendedorActual = { id: 2, nombre: 'Vend', permiso: 2 };
    contarProductosPendientes.mockResolvedValue(5);
    await render();
    expect(tid('productos-pendientes')).toBeNull();
    expect(container.textContent).toMatch(/No ten.s permisos/);
  });
});

describe('S01-5 borrar producto', () => {
  it('S01-5 con 007 abre el modal de PIN y no borra hasta confirmar', async () => {
    await render();
    await click(botonBorrar('Bon o Bon'));
    expect(tid('baja-producto')).not.toBeNull();
    expect(borrarProductoAdmin).not.toHaveBeenCalled();
  });
  it('S01-5 confirmar manda PIN+producto, vacia el PIN y cierra el modal', async () => {
    borrarProductoAdmin.mockResolvedValue({ ok: true });
    await render();
    await click(botonBorrar('Bon o Bon'));
    await setValue(tid('admin-pin-baja-producto'), '4321');
    await click(tid('confirmar-baja-producto'));
    expect(borrarProductoAdmin).toHaveBeenCalledWith({ pin: '4321', producto: expect.objectContaining({ id: 1 }) });
    expect(tid('baja-producto')).toBeNull();
    expect(mockApp.recargar).toHaveBeenCalled();
  });
  it('S01-5 PIN incorrecto: alerta, el modal sigue abierto y el PIN se vacio', async () => {
    borrarProductoAdmin.mockResolvedValue({ ok: false, motivo: 'no_autorizado', mensaje: 'PIN incorrecto.' });
    await render();
    await click(botonBorrar('Bon o Bon'));
    await setValue(tid('admin-pin-baja-producto'), '0000');
    await click(tid('confirmar-baja-producto'));
    expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('PIN incorrecto'));
    expect(tid('baja-producto')).not.toBeNull();
    expect(tid('admin-pin-baja-producto').value).toBe('');
  });
  it('S01-5 cancelar cierra el modal sin llamar al servicio', async () => {
    await render();
    await click(botonBorrar('Bon o Bon'));
    await click(boton('Cancelar'));
    expect(tid('baja-producto')).toBeNull();
    expect(borrarProductoAdmin).not.toHaveBeenCalled();
  });
  it('S01-5 offline no abre el modal y avisa', async () => {
    setOnline(false);
    await render();
    await click(botonBorrar('Bon o Bon'));
    expect(window.alert).toHaveBeenCalled();
    expect(tid('baja-producto')).toBeNull();
    expect(sondearMigracion007).not.toHaveBeenCalled();
  });
  it('S01-5 sin 007 (sonda falta) no abre el modal de PIN (flujo viejo)', async () => {
    sondearMigracion007.mockResolvedValue({ faltaMigracion: true });
    await render();
    await click(botonBorrar('Bon o Bon'));
    expect(tid('baja-producto')).toBeNull();
    expect(borrarProductoAdmin).not.toHaveBeenCalled();
  });
});
