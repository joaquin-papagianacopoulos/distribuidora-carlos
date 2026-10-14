// S-VTA-01: syncProductos con escritura directa cerrada (007) y por RPC con PIN.
import { huellaProductoSync } from '../../domain/productosRpc';

const mockLocal = { productos: [] };
jest.mock('../../db', () => {
  const huella = require('../../domain/productosRpc').huellaProductoSync;
  const impl = {
    getProductos: async () => mockLocal.productos.map(p => ({ ...p })),
    getClientes: async () => [],
    getVendedores: async () => [],
    clearProductosPendingSync: async (ids) => {
      const s = new Set(ids);
      mockLocal.productos = mockLocal.productos.map(p => (s.has(p.id) ? { ...p, pendingSync: false } : p));
    },
    clearProductosPendingSyncSiIgual: async (ids, huellas, extra = {}) => {
      const hechos = [];
      for (const id of ids) {
        const i = mockLocal.productos.findIndex(p => p.id === id);
        if (i < 0) continue;
        const p = mockLocal.productos[i];
        if (huellas.get(id) !== huella(p)) continue;
        mockLocal.productos[i] = { ...p, pendingSync: false, ...extra };
        hechos.push(id);
      }
      return hechos;
    },
    patchRegistros: async (store, ids, patch) => {
      const s = new Set(ids || []);
      mockLocal[store] = (mockLocal[store] || []).map(r => (s.has(r.id) ? { ...r, ...patch } : r));
    },
  };
  return impl;
});
jest.mock('../../services/imageSearch', () => ({
  isImageSearchConfigured: () => false, fetchProductImage: jest.fn(), ImageSearchQuotaError: class extends Error {},
}));

const mockSb = { upserts: [], upsertResp: [], rpcs: [], rpcResp: [] };
jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table) => ({
      upsert: (rows) => {
        mockSb.upserts.push({ table, rows });
        return Promise.resolve(mockSb.upsertResp.shift() || { error: null });
      },
    }),
    rpc: (fn, args) => {
      mockSb.rpcs.push({ fn, args });
      const r = mockSb.rpcResp.shift();
      return Promise.resolve(typeof r === 'function' ? r() : (r || { data: null, error: null }));
    },
  },
}));

import { syncProductos, _resetEscrituraDirectaProductos } from '../../sync/syncService';

const CRED = { p_admin_id: '9', p_admin_pin: '1234' };
const DENEGADO = { error: { code: '42501', message: 'permission denied for table productos' } };

beforeEach(() => {
  jest.clearAllMocks();
  mockLocal.productos = [
    { id: 1, nombre: 'A', precio: 10, pendingSync: true },
    { id: 2, nombre: 'B', precio: 20, pendingSync: true, extrasDirty: true },
  ];
  mockSb.upserts = []; mockSb.upsertResp = []; mockSb.rpcs = []; mockSb.rpcResp = [];
  _resetEscrituraDirectaProductos();
});

describe('S01-3 sin credencial', () => {
  it('S01-3 antes de la 007 sube directo como siempre', async () => {
    const r = await syncProductos();
    expect(r).toEqual({ ok: true });
    expect(mockSb.upserts.length).toBeGreaterThan(0);
    expect(mockLocal.productos.every(p => !p.pendingSync)).toBe(true);
    expect(mockSb.rpcs).toHaveLength(0);
  });
  it('S01-3 con escritura cerrada (42501) no lanza, avisa y deja pendientes', async () => {
    mockSb.upsertResp = [DENEGADO, DENEGADO, DENEGADO];
    const r = await syncProductos();
    expect(r).toMatchObject({ ok: true, requierePinAdmin: true, pendientes: 2 });
    expect(mockLocal.productos.every(p => p.pendingSync)).toBe(true);
    // no reintenta el directo en la misma sesion
    const n = mockSb.upserts.length;
    const r2 = await syncProductos();
    expect(r2.requierePinAdmin).toBe(true);
    expect(mockSb.upserts.length).toBe(n);
  });
  it('S01-3 otros errores siguen lanzando', async () => {
    mockSb.upsertResp = [{ error: { code: '500', message: 'boom' } }];
    await expect(syncProductos()).rejects.toMatchObject({ code: '500' });
  });
  it('S01-6 sin credencial nunca llama a las RPC admin', async () => {
    mockSb.upsertResp = [DENEGADO, DENEGADO];
    await syncProductos();
    expect(mockSb.rpcs).toHaveLength(0);
    expect(mockLocal.productos.every(p => p.pendingSync)).toBe(true);
  });
});

describe('S01-3 / S01-4 con credencial (RPC)', () => {
  it('S01-3 una RPC por lote, sin upsert directo, y limpia lo aceptado', async () => {
    mockSb.rpcResp = [{ data: { ok: true, aceptados: [1, 2], rechazados: [] }, error: null }];
    const r = await syncProductos({ cred: CRED });
    expect(r).toMatchObject({ ok: true, subidos: 2 });
    expect(mockSb.rpcs).toHaveLength(1);
    expect(mockSb.rpcs[0].fn).toBe('admin_guardar_productos');
    expect(mockSb.rpcs[0].args).toMatchObject({ p_admin_id: '9', p_admin_pin: '1234' });
    expect(mockSb.rpcs[0].args.p_filas[1].extras).toBe(true);
    expect(mockSb.upserts).toHaveLength(0);
    expect(mockLocal.productos.every(p => !p.pendingSync && !p.extrasDirty)).toBe(true);
  });
  it('S01-7 el payload no lleva stock', async () => {
    mockLocal.productos[0].stock = 50;
    mockSb.rpcResp = [{ data: { ok: true, aceptados: [1, 2], rechazados: [] }, error: null }];
    await syncProductos({ cred: CRED });
    expect(JSON.stringify(mockSb.rpcs[0].args)).not.toMatch(/stock/);
  });
  it('S01-3 PGRST202 (sin 007) cae al camino directo', async () => {
    mockSb.rpcResp = [{ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }];
    const r = await syncProductos({ cred: CRED });
    expect(r.ok).toBe(true);
    expect(mockSb.upserts.length).toBeGreaterThan(0);
  });
  it('S01-3 no_autorizado devuelve ok:false y no limpia nada', async () => {
    mockSb.rpcResp = [{ data: { ok: false, motivo: 'no_autorizado' }, error: null }];
    const r = await syncProductos({ cred: CRED });
    expect(r).toMatchObject({ ok: false, motivo: 'no_autorizado' });
    expect(mockLocal.productos.every(p => p.pendingSync)).toBe(true);
    expect(mockSb.upserts).toHaveLength(0);
  });
  it('S01-4 aceptados parciales: limpia solo esos; rechazado queda con syncRechazo', async () => {
    mockSb.rpcResp = [{ data: { ok: true, aceptados: [1], rechazados: [{ id: 2, motivo: 'datos_invalidos' }] }, error: null }];
    const r = await syncProductos({ cred: CRED });
    expect(r.rechazados).toHaveLength(1);
    expect(mockLocal.productos.find(p => p.id === 1).pendingSync).toBe(false);
    const p2 = mockLocal.productos.find(p => p.id === 2);
    expect(p2.pendingSync).toBe(true);
    expect(p2.syncRechazo).toBe('datos_invalidos');
  });
  it('S01-4 producto editado durante la subida sigue pendiente', async () => {
    const original = mockLocal.productos[0];
    const h = huellaProductoSync(original);
    expect(h).toBeTruthy();
    // la edicion llega despues de leer pendientes y antes de la respuesta
    mockSb.rpcResp = [() => {
      mockLocal.productos[0] = { ...mockLocal.productos[0], precio: 999 };
      return { data: { ok: true, aceptados: [1, 2], rechazados: [] }, error: null };
    }];
    await syncProductos({ cred: CRED });
    expect(mockLocal.productos.find(p => p.id === 1).pendingSync).toBe(true);
    expect(mockLocal.productos.find(p => p.id === 2).pendingSync).toBe(false);
  });
  it('S01-4 respuesta malformada no limpia ningun id', async () => {
    mockSb.rpcResp = [{ data: { ok: true }, error: null }];
    const r = await syncProductos({ cred: CRED });
    expect(r.ok).toBe(false);
    expect(mockLocal.productos.every(p => p.pendingSync)).toBe(true);
  });
});
