// S-03 (security-report 20261007-run1, iteracion 2): el permiso del vendedor
// activo se resuelve contra la base local (IndexedDB), nunca desde lo que
// diga localStorage. Fija la mitigacion implementada en useAppContext.init().
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockVendedores = { lista: [] };
jest.mock('../../db', () => {
  const vacio = async () => [];
  return {
    initDB: async () => undefined,
    seedDemoData: async () => undefined,
    getProductos: vacio, getClientes: vacio, getPedidos: vacio,
    getFaltantes: vacio, getDeudas: vacio, getProveedores: vacio,
    getMovimientosStock: vacio, getIngresos: vacio,
    getVendedores: async () => mockVendedores.lista.map(v => ({ ...v })),
  };
});
jest.mock('../../services/stockService', () => ({ syncStock: async () => ({ ok: true }) }));
jest.mock('../../sync/syncService', () => ({
  syncPedidosPendientes: jest.fn(), downloadMaestros: jest.fn(), pullPedidosRecientes: jest.fn(),
  pullPedidosByFecha: jest.fn(), pullPedidosByClienteNombre: jest.fn(), syncFaltantes: jest.fn(),
  syncDeudas: jest.fn(), syncProductos: jest.fn(), syncClientes: jest.fn(),
}));

// eslint-disable-next-line import/first
import { AppProvider, useApp } from '../useAppContext';
// eslint-disable-next-line import/first
import { getUsuarioSesion, getNombreUsuarioSesion, setUsuarioSesion } from '../../services/sesion';

let container;
let root;
const ctx = { actual: null };
const Espia = () => { ctx.actual = useApp(); return null; };

const montar = async () => {
  await act(async () => { root.render(<AppProvider><Espia /></AppProvider>); });
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
};

beforeEach(() => {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => false });
  localStorage.clear();
  sessionStorage.clear();
  setUsuarioSesion(null);
  ctx.actual = null;
  mockVendedores.lista = [
    { id: 1, remoteId: 'u-admin', nombre: 'Admin', permiso: 1, pin: '4321' },
    { id: 2, remoteId: 'u-vend', nombre: 'Carlos', permiso: 2, zona: 'Norte' },
    { id: 3, remoteId: 'u-arm', nombre: 'Ana', permiso: 3 },
  ];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

describe('AC-SEC-4 S-03 el rol no se toma de localStorage', () => {
  test.each([
    ['vendedor', 2, 2],
    ['armador', 3, 3],
  ])('AC-SEC-4 S-03 un %s con "permiso:1" forjado sigue con su permiso real', async (_l, id, permisoReal) => {
    localStorage.setItem('vendedorActual', JSON.stringify({ id, nombre: 'x', permiso: 1 }));
    await montar();
    expect(ctx.actual.loading).toBe(false);
    expect(ctx.actual.vendedorActual.id).toBe(id);
    expect(ctx.actual.vendedorActual.permiso).toBe(permisoReal);
  });

  test('AC-SEC-4 S-03 un id inexistente con permiso 1 no abre sesion y se limpia', async () => {
    localStorage.setItem('vendedorActual', JSON.stringify({ id: 999999, nombre: 'Atacante', permiso: 1 }));
    await montar();
    expect(ctx.actual.vendedorActual).toBeNull();
    expect(localStorage.getItem('vendedorActual')).toBeNull();
  });

  test('AC-SEC-4 S-03 JSON corrupto o sin id no rompe ni abre sesion', async () => {
    for (const valor of ['{no es json', '{"permiso":1,"nombre":"Admin"}', '"admin"', '1']) {
      localStorage.setItem('vendedorActual', valor);
      // eslint-disable-next-line no-await-in-loop
      await montar();
      expect(ctx.actual.loading).toBe(false);
      expect(ctx.actual.vendedorActual?.permiso === 1).toBe(false);
      // eslint-disable-next-line no-await-in-loop
      await act(async () => { root.unmount(); });
      root = createRoot(container);
    }
  });

  test('AC-SEC-4 S-03 los datos de sesion salen de la base, no del JSON forjado', async () => {
    localStorage.setItem('vendedorActual', JSON.stringify({ id: 2, nombre: 'Admin', permiso: 1, zona: '' }));
    await montar();
    expect(ctx.actual.vendedorActual).toMatchObject({ id: 2, nombre: 'Carlos', permiso: 2, zona: 'Norte' });
  });

  // S-03 residual (iter 3): un vendedor con PIN tiene que volver a ingresarlo
  // en cada sesion nueva de la app; conocer su id ya no alcanza.
  test('AC-SEC-4 S-03 restaurar la sesion de un vendedor con PIN exige PIN de nuevo', async () => {
    localStorage.setItem('vendedorActual', JSON.stringify({ id: 1, nombre: 'Admin', permiso: 1 }));
    await montar();
    expect(ctx.actual.loading).toBe(false);
    expect(ctx.actual.vendedorActual).toBeNull();
    expect(getUsuarioSesion()).toBeNull();
  });

  test('AC-SEC-4 S-03 con el PIN ya validado en esta sesion se restaura con el permiso de la base', async () => {
    localStorage.setItem('vendedorActual', JSON.stringify({ id: 1 }));
    // iter 4: la validacion de PIN vive en localStorage `sesionVendedor` con vencimiento (12 h).
    localStorage.setItem('sesionVendedor', JSON.stringify({ id: '1', exp: Date.now() + 60 * 60 * 1000 }));
    await montar();
    expect(ctx.actual.vendedorActual).toMatchObject({ id: 1, nombre: 'Admin', permiso: 1 });
  });

  test('AC-SEC-4 S-03 un vendedor sin PIN se restaura sin pedir nada', async () => {
    localStorage.setItem('vendedorActual', JSON.stringify({ id: 2 }));
    await montar();
    expect(ctx.actual.vendedorActual).toMatchObject({ id: 2, permiso: 2 });
  });

  test('AC-SEC-4 S-03 localStorage nunca guarda PIN ni permiso', async () => {
    await montar();
    await act(async () => { ctx.actual.seleccionarVendedor({ ...mockVendedores.lista[0] }); });
    const guardado = JSON.parse(localStorage.getItem('vendedorActual'));
    expect(guardado).toMatchObject({ id: 1, nombre: 'Admin' });
    expect(guardado).not.toHaveProperty('pin');
    expect(guardado).not.toHaveProperty('permiso');
    expect(localStorage.getItem('vendedorActual')).not.toContain('4321');
    await act(async () => { ctx.actual.seleccionarVendedor(null); });
    expect(localStorage.getItem('sesionVendedor')).toBeNull();
    expect(getUsuarioSesion()).toBeNull();
  });

  // S-20: la firma de los movimientos sale de la sesion en memoria.
  test('AC-SEC-4 S-20 el nombre de sesion sale de la base aunque localStorage diga otro', async () => {
    localStorage.setItem('vendedorActual', JSON.stringify({ id: 2, nombre: 'Admin', permiso: 1 }));
    await montar();
    expect(getNombreUsuarioSesion()).toBe('Carlos');
    expect(getUsuarioSesion()).toMatchObject({ id: 2, permiso: 2 });
  });
});
