// RUN 20261012-2106 iteracion 2 — S-BUL-01 (mitigacion parcial): al restaurar
// la sesion y despues de cada pull de vendedores, CON RED, la sesion se
// revalida contra la fila del servidor. Sin red, comportamiento offline.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockVendedores = { lista: [] };
jest.mock('../../db', () => {
  const vacio = async () => [];
  return {
    initDB: async () => undefined,
    seedDemoData: async () => undefined,
    getProductos: vacio, getClientes: vacio, getPedidos: vacio, getFaltantes: vacio, getDeudas: vacio,
    getProveedores: vacio, getMovimientosStock: vacio, getIngresos: vacio, getComisionesCierres: vacio,
    getVendedores: async () => mockVendedores.lista.map(v => ({ ...v })),
    updateVendedor: async (v) => { mockVendedores.lista = mockVendedores.lista.map(x => (x.id === v.id ? { ...v } : x)); },
  };
});
jest.mock('../../services/stockService', () => ({ syncStock: async () => ({ ok: true }) }));
jest.mock('../../services/comisionesService', () => ({ syncComisiones: async () => ({ ok: true }) }));
const mockSb = { fila: null, error: null, lanzar: false, lecturas: 0 };
jest.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: () => Promise.resolve({ data: false, error: null }),
    from: () => {
      const api = {
        select: () => api,
        eq: () => api,
        maybeSingle: () => {
          mockSb.lecturas++;
          if (mockSb.lanzar) return Promise.reject(new TypeError('Failed to fetch'));
          return Promise.resolve({ data: mockSb.fila, error: mockSb.error });
        },
      };
      return api;
    },
  },
}));
jest.mock('../../sync/syncService', () => ({
  syncPedidosPendientes: async () => ({ remaining: 0 }), downloadMaestros: async () => undefined, pullPedidosRecientes: async () => ({}),
  pullPedidosByFecha: async () => undefined, pullPedidosByClienteNombre: async () => undefined, syncFaltantes: async () => undefined,
  syncDeudas: async () => undefined, syncProductos: async () => undefined, syncClientes: async () => undefined,
}));

// eslint-disable-next-line import/first
import { AppProvider, useApp } from '../useAppContext';
// eslint-disable-next-line import/first
import { setUsuarioSesion } from '../../services/sesion';

let container;
let root;
const ctx = { actual: null };
const Espia = () => { ctx.actual = useApp(); return null; };
const setOnline = (v) => Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => v });
const montar = async () => {
  await act(async () => { root.render(<AppProvider><Espia /></AppProvider>); });
  for (let i = 0; i < 8; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); });
};

const FILA = { id: 'u-vend', nombre: 'Carlos', zona: 'Norte', permiso: 2, tiene_pin: false, activo: true };

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  setUsuarioSesion(null);
  ctx.actual = null;
  Object.assign(mockSb, { fila: { ...FILA }, error: null, lanzar: false, lecturas: 0 });
  // Registro local ADULTERADO: "permiso: 1" editado en IndexedDB (S-BUL-01).
  mockVendedores.lista = [{ id: 2, remoteId: 'u-vend', nombre: 'Carlos', zona: 'Norte', permiso: 1, tienePin: false }];
  localStorage.setItem('vendedorActual', JSON.stringify({ id: 2, remoteId: 'u-vend', nombre: 'Carlos' }));
  jest.spyOn(console, 'log').mockImplementation(() => {});
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
  console.log.mockRestore();
});

describe('AC-SEC-4 S-BUL-01 revalidacion de la sesion restaurada', () => {
  it('AC-SEC-4 S-BUL-01 con red, el permiso adulterado se reemplaza por el del servidor (y se corrige el registro local)', async () => {
    setOnline(true);
    await montar();
    expect(mockSb.lecturas).toBeGreaterThan(0);
    expect(ctx.actual.vendedorActual).toMatchObject({ id: 2, permiso: 2 });
    expect(mockVendedores.lista[0].permiso).toBe(2);
  });

  it('AC-VEN-4 S-BUL-01 con red, si el servidor dice dado de baja, se cierra la sesion', async () => {
    setOnline(true);
    mockSb.fila = { ...FILA, activo: false };
    await montar();
    expect(ctx.actual.vendedorActual).toBeNull();
    expect(localStorage.getItem('vendedorActual')).toBeNull();
  });

  it('AC-SEC-4 S-BUL-01 con red pero lectura fallida: se mantiene la sesion (offline-first)', async () => {
    setOnline(true);
    mockSb.lanzar = true;
    await montar();
    expect(ctx.actual.vendedorActual).toMatchObject({ id: 2 });
  });

  it('AC-SEC-4 S-BUL-01 sin red no se consulta al servidor (comportamiento offline de siempre)', async () => {
    setOnline(false);
    await montar();
    expect(mockSb.lecturas).toBe(0);
    expect(ctx.actual.vendedorActual).toMatchObject({ id: 2 });
  });
});
