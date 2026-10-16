// REQ-FOT: editar un producto abre el formulario arriba (sin la lista) y, con el PIN,
// guardar sube el producto a Supabase para que la tienda vea la foto nueva.
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
  sondearMigracion007: jest.fn(), subirProductosConPin: jest.fn(), borrarProductoAdmin: jest.fn(), contarProductosPendientes: jest.fn(),
}));
jest.mock('../../services/tiendaConfigService', () => ({
  subirImagenTienda: jest.fn(), leerConfigTienda: jest.fn(), guardarConfigTienda: jest.fn(),
}));

import Configuracion from '../Configuracion';
import { updateProducto } from '../../db';
import { subirProductosConPin, contarProductosPendientes, sondearMigracion007 } from '../../services/productosAdminService';
import { subirImagenTienda } from '../../services/tiendaConfigService';

const URL_OK = 'https://x.supabase.co/storage/v1/object/public/tienda/img/a.png';
let container; let root;
const setOnline = (v) => Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => v });
const render = async () => { await act(async () => { root.render(<Configuracion />); }); };
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
const flush = async () => { await act(async () => { await new Promise(r => setTimeout(r, 0)); }); };
const tid = (id) => container.querySelector(`[data-testid="${id}"]`);
const setValue = async (el, value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  await act(async () => { setter.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); });
};
const lapiz = () => [...container.querySelectorAll('.list-item button')].find(b => b.textContent === '✏');
const guardar = () => [...container.querySelectorAll('button')].find(b => b.textContent === 'Guardar');
const elegirFoto = async () => {
  const input = tid('foto-input');
  Object.defineProperty(input, 'files', { configurable: true, value: [new File(['x'], 'a.png', { type: 'image/png' })] });
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
  await flush();
};

beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(mockApp, {
    productos: [{ id: 1, nombre: 'Bon o Bon', codigo: 'B1', precio: 300, unidad: 'unidad', bultoX: 1, minimoVenta: 1 }],
    clientes: [], vendedores: [{ id: 1, nombre: 'Admin', permiso: 1 }], proveedores: [], stockMap: new Map(),
    vendedorActual: { id: 1, nombre: 'Admin', permiso: 1 },
    seleccionarVendedor: jest.fn(), recargar: jest.fn(() => Promise.resolve()),
  });
  contarProductosPendientes.mockResolvedValue(0);
  sondearMigracion007.mockResolvedValue({ faltaMigracion: false });
  subirImagenTienda.mockResolvedValue({ ok: true, url: URL_OK });
  subirProductosConPin.mockResolvedValue({ ok: true, subidos: 1, rechazados: [] });
  window.scrollTo = jest.fn();
  window.alert = jest.fn();
  setOnline(true);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe('editar producto con foto', () => {
  it('AC-FOT-1 el lápiz abre el formulario arriba de todo, sin la lista abajo, y vuelve al inicio', async () => {
    await render();
    await click(lapiz());
    const form = tid('producto-form');
    expect(form).toBeTruthy();
    expect(container.querySelector('.list-item')).toBeNull();
    // El formulario va antes que el resto de las tarjetas de la pantalla.
    const cards = [...container.querySelectorAll('.card')];
    expect(cards[0]).toBe(form);
    expect(window.scrollTo).toHaveBeenCalled();
    await click([...container.querySelectorAll('button')].find(b => b.textContent === 'Cancelar'));
    expect(container.querySelector('.list-item')).toBeTruthy();
  });

  it('AC-FOT-1 con el PIN, guardar sube el producto a Supabase y la foto queda en la tienda', async () => {
    await render();
    await click(lapiz());
    await setValue(tid('foto-pin'), '1234');
    await elegirFoto();
    await click(guardar());
    await flush();
    expect(updateProducto).toHaveBeenCalledWith(expect.objectContaining({ id: 1, imagen_url: URL_OK, extrasDirty: true }), expect.anything());
    expect(subirProductosConPin).toHaveBeenCalledWith('1234');
    expect(tid('productos-msg').textContent).toMatch(/ya se ve en la tienda/);
  });

  it('AC-FOT-1 sin PIN el producto queda en el dispositivo y se avisa cómo subirlo', async () => {
    await render();
    await click(lapiz());
    await click(guardar());
    await flush();
    expect(subirProductosConPin).not.toHaveBeenCalled();
    expect(tid('productos-msg').textContent).toMatch(/Subir productos/);
  });

  it('AC-MIN-1 AC-FOT-1 cambiar solo el mínimo con el PIN (junto a Guardar) lo sube y la tienda lo ve', async () => {
    await render();
    await click(lapiz());
    // El PIN está fuera del bloque de foto, al lado de Guardar.
    expect(tid('pin-producto').contains(tid('foto-pin'))).toBe(true);
    expect(tid('foto-producto').contains(tid('foto-pin'))).toBe(false);
    await setValue(container.querySelector('#campo-minimoVenta'), '6');
    await setValue(tid('foto-pin'), '1234');
    await click(guardar());
    await flush();
    expect(updateProducto.mock.calls[0][0]).toMatchObject({ id: 1, minimoVenta: 6, extrasDirty: true });
    expect(subirProductosConPin).toHaveBeenCalledWith('1234');
    expect(tid('productos-msg').textContent).toMatch(/ya se ve en la tienda/);
  });
});
