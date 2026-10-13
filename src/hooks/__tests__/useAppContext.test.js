// S-03 (iter 2): al iniciar, el vendedor activo (y su permiso) se resuelve
// contra la base local; un rol forjado en localStorage no da acceso de admin.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockVendedores = { lista: [] };
jest.mock('../../db', () => {
  const vacio = async () => [];
  const impl = {
    initDB: async () => undefined,
    seedDemoData: async () => undefined,
    getProductos: vacio, getClientes: vacio, getPedidos: vacio, getFaltantes: vacio, getDeudas: vacio,
    getProveedores: vacio, getMovimientosStock: vacio, getIngresos: vacio,
    getVendedores: async () => mockVendedores.lista.map(v => ({ ...v })),
    // C5 (S-COM-18): el login persiste la fila del servidor en el registro local.
    updateVendedor: async (v) => { mockVendedores.lista = mockVendedores.lista.map(x => (x.id === v.id ? { ...v } : x)); },
  };
  const mod = { __impl: impl };
  for (const k of Object.keys(impl)) mod[k] = jest.fn(impl[k]);
  return mod;
});
jest.mock('../../services/stockService', () => ({ syncStock: jest.fn() }));
const mockSb = { rpcRespuestas: [], selectRespuestas: [] };
jest.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: () => Promise.resolve(mockSb.rpcRespuestas.shift() || { data: false, error: null }),
    from: () => {
      const api = { select: () => api, eq: () => api, maybeSingle: () => Promise.resolve(mockSb.selectRespuestas.shift() || { data: null, error: null }) };
      return api;
    },
  },
}));
jest.mock('../../sync/syncService', () => ({
  syncPedidosPendientes: jest.fn(), downloadMaestros: jest.fn(), pullPedidosRecientes: jest.fn(),
  pullPedidosByFecha: jest.fn(), pullPedidosByClienteNombre: jest.fn(), syncFaltantes: jest.fn(),
  syncDeudas: jest.fn(), syncProductos: jest.fn(), syncClientes: jest.fn(),
}));

import * as db from '../../db';
import { AppProvider, useApp } from '../useAppContext';
import { getUsuarioSesion, getNombreUsuarioSesion, setUsuarioSesion } from '../../services/sesion';
import { ingresarConPin } from '../../services/vendedoresService';

let container;
let root;
const ctx = { actual: null };
const Espia = () => { ctx.actual = useApp(); return null; };

const montar = async () => {
  await act(async () => { root.render(<AppProvider><Espia /></AppProvider>); });
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
};

beforeEach(() => {
  for (const k of Object.keys(db.__impl)) db[k].mockImplementation(db.__impl[k]);
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => false });
  localStorage.clear();
  sessionStorage.clear();
  setUsuarioSesion(null); // estado de módulo: en la app real arranca vacío en cada carga
  ctx.actual = null;
  mockVendedores.lista = [
    { id: 1, remoteId: 'u-admin', nombre: 'Jorge', permiso: 1, pin: '4321' },
    { id: 2, remoteId: 'u-vend', nombre: 'Carlos', permiso: 2, zona: 'Norte' },
    { id: 3, remoteId: 'u-arm', nombre: 'Ana', permiso: 3 },
  ];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
});

describe('S-03 vendedorActual se resuelve contra la base', () => {
  it('AC-SEC-4 un vendedor que se edita "permiso: 1" en localStorage sigue siendo vendedor (2)', async () => {
    localStorage.setItem('vendedorActual', JSON.stringify({ id: 2, nombre: 'Carlos', permiso: 1 }));
    await montar();
    expect(ctx.actual.loading).toBe(false);
    expect(ctx.actual.vendedorActual).toMatchObject({ id: 2, nombre: 'Carlos', permiso: 2 });
  });

  // Antes BUG B7 (iter 2): el JSON forjado quedaba en localStorage y firmaba
  // los movimientos. Corregido en 5ead627: se reescribe con datosPersistibles
  // (solo id/remoteId/nombre) y la firma sale de la sesión en memoria (S-20).
  it('AC-SEC-4 tras resolver contra la base, localStorage queda con los datos reales (no los forjados)', async () => {
    localStorage.setItem('vendedorActual', JSON.stringify({ id: 2, nombre: 'Jorge', permiso: 1, pin: null }));
    await montar();
    // Solo lo mínimo: sin permiso ni PIN
    expect(JSON.parse(localStorage.getItem('vendedorActual'))).toEqual({ id: 2, remoteId: 'u-vend', nombre: 'Carlos' });
    // y la firma de movimientos sale de la sesión resuelta
    expect(getNombreUsuarioSesion()).toBe('Carlos');
    expect(getUsuarioSesion()).toEqual({ id: 2, nombre: 'Carlos', permiso: 2 });
  });

  it('AC-SEC-4 un armador con permiso forjado "1" (string) queda como armador', async () => {
    localStorage.setItem('vendedorActual', JSON.stringify({ id: 3, permiso: '1' }));
    await montar();
    expect(ctx.actual.vendedorActual.permiso).toBe(3);
  });

  it('AC-SEC-4 se resuelve también por remoteId (id local distinto tras borrar caché)', async () => {
    localStorage.setItem('vendedorActual', JSON.stringify({ id: 99, remoteId: 'u-vend', permiso: 1 }));
    await montar();
    expect(ctx.actual.vendedorActual).toMatchObject({ id: 2, permiso: 2 });
  });

  it('AC-SEC-4 un vendedor inexistente en la base vuelve a la pantalla de selección y se borra del storage', async () => {
    localStorage.setItem('vendedorActual', JSON.stringify({ id: 77, nombre: 'Hacker', permiso: 1 }));
    await montar();
    expect(ctx.actual.vendedorActual).toBeNull();
    expect(localStorage.getItem('vendedorActual')).toBeNull();
  });

  it('AC-SEC-4 un JSON inválido en localStorage no rompe el arranque', async () => {
    localStorage.setItem('vendedorActual', '{roto');
    await montar();
    expect(ctx.actual.loading).toBe(false);
    expect(ctx.actual.vendedorActual).toBeNull();
  });

  it('AC-SEC-4 sin vendedor guardado arranca sin sesión', async () => {
    await montar();
    expect(ctx.actual.vendedorActual).toBeNull();
    expect(db.getVendedores).toHaveBeenCalled();
  });

  it('AC-SEC-4 seleccionarVendedor guarda y un rearranque conserva el permiso de la base', async () => {
    await montar();
    await act(async () => { ctx.actual.seleccionarVendedor(mockVendedores.lista[1]); });
    expect(ctx.actual.vendedorActual.permiso).toBe(2);
    // El admin cambia el permiso de Carlos en la base a armador
    mockVendedores.lista[1].permiso = 3;
    act(() => { root.unmount(); });
    root = createRoot(container);
    await montar();
    expect(ctx.actual.vendedorActual).toMatchObject({ id: 2, permiso: 3 });
  });

  // Antes RESIDUAL S-03 (iter 2): {"id":1} en localStorage entraba como admin
  // sin PIN. Corregido en 5ead627: un vendedor con PIN solo se restaura si la
  // sesión ya lo validó (iter 4: localStorage `sesionVendedor` {id, exp} con 12 h); si no, pide PIN.
  it('AC-SEC-4 forjar el id de un admin con PIN no saltea el PIN: vuelve a la selección (pide PIN)', async () => {
    localStorage.setItem('vendedorActual', JSON.stringify({ id: 1 }));
    await montar();
    expect(ctx.actual.loading).toBe(false);
    expect(ctx.actual.vendedorActual).toBeNull();
    expect(getUsuarioSesion()).toBeNull();
  });

  it('AC-SEC-4 tampoco por remoteId del admin ni con permiso/pin forjados', async () => {
    localStorage.setItem('vendedorActual', JSON.stringify({ id: 50, remoteId: 'u-admin', permiso: 1, pin: null }));
    await montar();
    expect(ctx.actual.vendedorActual).toBeNull();
  });

  it('AC-SEC-4 la sesión validada de OTRO vendedor no habilita al admin', async () => {
    localStorage.setItem('sesionVendedor', JSON.stringify({ id: '2', exp: Date.now() + 3600e3 }));
    localStorage.setItem('vendedorActual', JSON.stringify({ id: 1 }));
    await montar();
    expect(ctx.actual.vendedorActual).toBeNull();
  });

  it('AC-SEC-4 en la misma sesión de la app (PIN ya validado al seleccionar) el admin se restaura al recargar', async () => {
    await montar();
    await act(async () => { ctx.actual.seleccionarVendedor(mockVendedores.lista[0]); });
    expect(ctx.actual.vendedorActual.permiso).toBe(1);
    const ses = JSON.parse(localStorage.getItem('sesionVendedor'));
    expect(ses.id).toBe('1');
    expect(ses.exp - Date.now()).toBeGreaterThan(12 * 3600e3 - 60e3);
    expect(ses.exp - Date.now()).toBeLessThanOrEqual(12 * 3600e3);
    const guardado = JSON.parse(localStorage.getItem('vendedorActual'));
    expect(guardado).toEqual({ id: 1, remoteId: 'u-admin', nombre: 'Jorge' });
    expect(guardado).not.toHaveProperty('pin');
    act(() => { root.unmount(); });
    root = createRoot(container);
    await montar();
    expect(ctx.actual.vendedorActual).toMatchObject({ id: 1, permiso: 1 });
  });

  it('AC-SEC-4 la validación de PIN vence a las 12 h: pasado ese plazo vuelve a pedir el PIN', async () => {
    await montar();
    await act(async () => { ctx.actual.seleccionarVendedor(mockVendedores.lista[0]); });
    act(() => { root.unmount(); });
    const ahora = Date.now();
    const spy = jest.spyOn(Date, 'now').mockReturnValue(ahora + 12 * 3600e3 + 1000);
    try {
      root = createRoot(container);
      await montar();
      expect(ctx.actual.vendedorActual).toBeNull();
    } finally { spy.mockRestore(); }
  });

  it('AC-SEC-4 antes de las 12 h (11 h 59) se restaura sin pedir PIN', async () => {
    await montar();
    await act(async () => { ctx.actual.seleccionarVendedor(mockVendedores.lista[0]); });
    act(() => { root.unmount(); });
    const spy = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 12 * 3600e3 - 60e3);
    try {
      root = createRoot(container);
      await montar();
      expect(ctx.actual.vendedorActual).toMatchObject({ id: 1, permiso: 1 });
    } finally { spy.mockRestore(); }
  });

  it.each([
    ['vencida', () => ({ id: '1', exp: Date.now() - 1 })],
    ['sin exp', () => ({ id: '1' })],
    ['id numérico distinto', () => ({ id: '2', exp: Date.now() + 3600e3 })],
    ['JSON roto', () => '{roto'],
  ])('AC-SEC-4 una marca de sesión %s no restaura al admin', async (_n, marca) => {
    const m = marca();
    localStorage.setItem('sesionVendedor', typeof m === 'string' ? m : JSON.stringify(m));
    localStorage.setItem('vendedorActual', JSON.stringify({ id: 1 }));
    await montar();
    expect(ctx.actual.vendedorActual).toBeNull();
  });

  it('AC-SEC-4 "Cambiar" (seleccionarVendedor(null)) limpia sesión, storage y firma', async () => {
    await montar();
    await act(async () => { ctx.actual.seleccionarVendedor(mockVendedores.lista[0]); });
    await act(async () => { ctx.actual.seleccionarVendedor(null); });
    expect(ctx.actual.vendedorActual).toBeNull();
    expect(localStorage.getItem('sesionVendedor')).toBeNull();
    expect(localStorage.getItem('vendedorActual')).toBeNull();
    expect(getNombreUsuarioSesion()).toBe('');
  });

  // LIMITACIÓN CONOCIDA (no corregible en el cliente): la marca
  // `sesionVendedor` vive en localStorage y se edita desde la consola; además el
  // PIN está en texto plano en IndexedDB y se compara en el cliente. Quien tenga
  // DevTools entra como admin. El PIN con vencimiento protege el caso real
  // (celular compartido), no a un atacante con consola. Requiere auth en Supabase.
  // Repro: localStorage.setItem('sesionVendedor', JSON.stringify({id:'1',exp:9e15}));
  //        localStorage.setItem('vendedorActual','{"id":1}'); recargar.
  it.skip('AC-SEC-4 LIMITACIÓN: forjar la marca de sesión no debería dar acceso de admin', async () => {
    localStorage.setItem('sesionVendedor', JSON.stringify({ id: '1', exp: 9e15 }));
    localStorage.setItem('vendedorActual', JSON.stringify({ id: 1 }));
    await montar();
    expect(ctx.actual.vendedorActual?.permiso).not.toBe(1);
  });
});

describe('AC-VEN-4 sesion de un vendedor dado de baja', () => {
  it('AC-VEN-4 un vendedor dado de baja no restaura la sesion guardada', async () => {
    mockVendedores.lista[1] = { ...mockVendedores.lista[1], activo: false };
    localStorage.setItem('vendedorActual', JSON.stringify({ id: 2 }));
    await montar();
    expect(ctx.actual.vendedorActual).toBeNull();
    expect(localStorage.getItem('vendedorActual')).toBeNull();
  });

  it('AC-VEN-4 si lo dan de baja con la sesion abierta (baja local o pull), se cierra', async () => {
    await montar();
    await act(async () => { ctx.actual.seleccionarVendedor(mockVendedores.lista[1]); });
    expect(ctx.actual.vendedorActual).toMatchObject({ id: 2 });
    mockVendedores.lista[1] = { ...mockVendedores.lista[1], activo: false };
    await act(async () => { await ctx.actual.recargar(); });
    expect(ctx.actual.vendedorActual).toBeNull();
    expect(getUsuarioSesion()).toBeNull();
    expect(localStorage.getItem('vendedorActual')).toBeNull();
  });
});

// C5 (RUN 20261012-2106) — S-COM-18: el login persiste la fila del servidor en
// el registro local, así el efecto que mezcla `found` sobre vendedorActual no
// vuelve a subir un permiso adulterado en IndexedDB.
describe('AC-SEC-4 S-COM-18 login con datos del servidor + recarga', () => {
  it('AC-SEC-4 S-COM-18 después de entrar con los datos del servidor, recargar no vuelve a subir el permiso', async () => {
    // Registro local de Carlos adulterado a admin (y con "PIN" para pasar por verificar_pin).
    mockVendedores.lista[1] = { id: 2, remoteId: 'u-vend', nombre: 'Carlos', permiso: 1, tienePin: true, zona: 'Norte' };
    mockSb.rpcRespuestas = [{ data: true, error: null }];
    mockSb.selectRespuestas = [{ data: { id: 'u-vend', nombre: 'Carlos', zona: 'Norte', permiso: 2, tiene_pin: true, activo: true }, error: null }];
    await montar();
    const r = await ingresarConPin(mockVendedores.lista[1], '1111', { online: true });
    expect(r.ok).toBe(true);
    // El registro local quedó con la verdad del servidor.
    expect(mockVendedores.lista[1]).toMatchObject({ id: 2, permiso: 2 });
    await act(async () => { ctx.actual.seleccionarVendedor(r.vendedor); });
    await act(async () => { await ctx.actual.recargar(); });
    await act(async () => { await new Promise(res => setTimeout(res, 0)); });
    expect(ctx.actual.vendedorActual).toMatchObject({ id: 2, nombre: 'Carlos', permiso: 2 });
  });
});
