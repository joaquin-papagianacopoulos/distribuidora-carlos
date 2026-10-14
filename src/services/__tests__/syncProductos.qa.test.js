// S-VTA-01 (QA): bordes del sync de productos con 007 ausente/presente, lotes, concurrencia,
// permiso 2/3, descarga que no pisa pendientes y PIN que no queda en storage.
import { huellaProductoSync } from '../../domain/productosRpc';

const mockLocal = { productos: [], puestos: [] };
jest.mock('../../db', () => {
  const huella = require('../../domain/productosRpc').huellaProductoSync;
  return {
    getProductos: async () => mockLocal.productos.map(p => ({ ...p })),
    getClientes: async () => [],
    getVendedores: async () => [],
    putProductosBatch: async (rows) => { mockLocal.puestos.push(...rows); },
    putClientesBatch: async () => {},
    putVendedoresBatch: async () => {},
    clearProductosPendingSync: async (ids) => {
      const s = new Set(ids);
      mockLocal.productos = mockLocal.productos.map(p => (s.has(p.id) ? { ...p, pendingSync: false } : p));
    },
    clearProductosPendingSyncSiIgual: async (ids, huellas, extra = {}) => {
      const hechos = [];
      for (const id of ids) {
        const i = mockLocal.productos.findIndex(p => p.id === id);
        if (i < 0) continue;
        if (huellas.get(id) !== huella(mockLocal.productos[i])) continue;
        mockLocal.productos[i] = { ...mockLocal.productos[i], pendingSync: false, ...extra };
        hechos.push(id);
      }
      return hechos;
    },
    patchRegistros: async (store, ids, patch) => {
      const s = new Set(ids || []);
      mockLocal[store] = (mockLocal[store] || []).map(r => (s.has(r.id) ? { ...r, ...patch } : r));
    },
  };
});
jest.mock('../../services/imageSearch', () => ({
  isImageSearchConfigured: () => false, fetchProductImage: jest.fn(), ImageSearchQuotaError: class extends Error {},
}));

const mockSb = { upserts: [], upsertResp: [], rpcs: [], rpcResp: [], remotos: [] };
jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table) => ({
      upsert: (rows) => {
        mockSb.upserts.push({ table, rows });
        return Promise.resolve(mockSb.upsertResp.shift() || { error: null });
      },
      select: () => ({ range: () => Promise.resolve({ data: table === 'productos' ? mockSb.remotos : [], error: null }) }),
    }),
    rpc: (fn, args) => {
      mockSb.rpcs.push({ fn, args });
      const r = mockSb.rpcResp.shift();
      if (r instanceof Error) return Promise.reject(r);
      return Promise.resolve(typeof r === 'function' ? r(args) : (r || { data: null, error: null }));
    },
  },
}));

import { syncProductos, downloadMaestros, _resetEscrituraDirectaProductos } from '../../sync/syncService';

const CRED = { p_admin_id: '9', p_admin_pin: '1234' };
const DENEGADO = { error: { code: '42501', message: 'permission denied for table productos' } };
const OK = (ids) => ({ data: { ok: true, aceptados: ids, rechazados: [] }, error: null });

beforeEach(() => {
  mockLocal.productos = [{ id: 1, nombre: 'A', precio: 10, pendingSync: true }];
  mockLocal.puestos = [];
  mockSb.upserts = []; mockSb.upsertResp = []; mockSb.rpcs = []; mockSb.rpcResp = []; mockSb.remotos = [];
  _resetEscrituraDirectaProductos();
  localStorage.clear(); sessionStorage.clear();
});

describe('S01 bordes del sync de productos', () => {
  it('S01-3 sin pendientes no llama a nadie (ni con cred)', async () => {
    mockLocal.productos = [{ id: 1, nombre: 'A', precio: 1, pendingSync: false }];
    expect(await syncProductos({ cred: CRED })).toEqual({ ok: true });
    expect(mockSb.rpcs).toHaveLength(0);
    expect(mockSb.upserts).toHaveLength(0);
  });
  it('S01-3 007 ausente con cred: cae al directo y deja todo subido (una sola RPC de prueba)', async () => {
    mockSb.rpcResp = [{ data: null, error: { code: '42883', message: 'function does not exist' } }];
    const r = await syncProductos({ cred: CRED });
    expect(r.ok).toBe(true);
    expect(mockSb.rpcs).toHaveLength(1);
    expect(mockLocal.productos[0].pendingSync).toBe(false);
  });
  it('S01-3 007 presente y escritura directa denegada + cred: usa RPC, no toca el directo', async () => {
    mockSb.upsertResp = [DENEGADO];
    mockSb.rpcResp = [OK([1])];
    await syncProductos({ cred: CRED });
    expect(mockSb.upserts).toHaveLength(0);
    expect(mockLocal.productos[0].pendingSync).toBe(false);
  });
  it('S01-3 admin con cred y flag de directo cerrado igual sube por RPC', async () => {
    mockSb.upsertResp = [DENEGADO];
    await syncProductos(); // marca el flag
    mockSb.rpcResp = [OK([1])];
    const r = await syncProductos({ cred: CRED });
    expect(r.ok).toBe(true);
    expect(mockLocal.productos[0].pendingSync).toBe(false);
  });
  it('S01-3 PIN bloqueado (P0001) devuelve ok:false y no limpia', async () => {
    mockSb.rpcResp = [{ data: null, error: { code: 'P0001', message: 'Demasiados intentos, espera unos minutos' } }];
    const r = await syncProductos({ cred: CRED });
    expect(r).toMatchObject({ ok: false, motivo: 'bloqueado' });
    expect(mockLocal.productos[0].pendingSync).toBe(true);
    expect(mockSb.upserts).toHaveLength(0);
  });
  it('S01-3 la red se cae durante la RPC: lanza y el pendiente se conserva', async () => {
    mockSb.rpcResp = [new Error('Failed to fetch')];
    await expect(syncProductos({ cred: CRED })).rejects.toThrow('Failed to fetch');
    expect(mockLocal.productos[0].pendingSync).toBe(true);
  });
  it('S01-4 mas de 500 pendientes: lotes de 500 y el segundo lote rechazado no pierde el primero', async () => {
    mockLocal.productos = Array.from({ length: 501 }, (_, i) => ({ id: i + 1, nombre: 'P' + i, precio: 1, pendingSync: true }));
    mockSb.rpcResp = [
      (a) => OK(a.p_filas.map(f => f.id)),
      { data: { ok: false, motivo: 'no_autorizado' }, error: null },
    ];
    const r = await syncProductos({ cred: CRED });
    expect(mockSb.rpcs.map(c => c.args.p_filas.length)).toEqual([500, 1]);
    expect(r.ok).toBe(false);
    expect(mockLocal.productos.filter(p => p.pendingSync)).toHaveLength(1);
  });
  it('S01-4 el servidor acepta un id que no mandamos: se ignora', async () => {
    mockSb.rpcResp = [OK([1, 777])];
    await syncProductos({ cred: CRED });
    expect(mockLocal.productos).toHaveLength(1);
    expect(mockLocal.productos[0].pendingSync).toBe(false);
  });
  it('S01-4 aceptado y luego editado con extrasDirty durante la subida sigue pendiente', async () => {
    mockSb.rpcResp = [() => {
      mockLocal.productos[0] = { ...mockLocal.productos[0], extrasDirty: true, bultoX: 6 };
      return OK([1]);
    }];
    await syncProductos({ cred: CRED });
    expect(mockLocal.productos[0].pendingSync).toBe(true);
    expect(mockLocal.productos[0].extrasDirty).toBe(true);
  });
  it('S01-4 un rechazado que luego se acepta limpia syncRechazo', async () => {
    mockSb.rpcResp = [{ data: { ok: true, aceptados: [], rechazados: [{ id: 1, motivo: 'datos_invalidos' }] }, error: null }];
    await syncProductos({ cred: CRED });
    expect(mockLocal.productos[0].syncRechazo).toBe('datos_invalidos');
    mockSb.rpcResp = [OK([1])];
    await syncProductos({ cred: CRED });
    expect(mockLocal.productos[0].syncRechazo).toBeNull();
    expect(mockLocal.productos[0].pendingSync).toBe(false);
  });
  it('S01-4 id invalido (no entero) lanza antes de llamar a la RPC', async () => {
    mockLocal.productos = [{ id: 'abc', nombre: 'X', precio: 1, pendingSync: true }];
    await expect(syncProductos({ cred: CRED })).rejects.toThrow(/id inv/);
    expect(mockSb.rpcs).toHaveLength(0);
  });
});

describe('S01-6 permiso 2/3 y descarga', () => {
  it('S01-6 pendiente de un no admin con 007: queda, y downloadMaestros no lo pisa', async () => {
    mockLocal.productos = [{ id: 1, nombre: 'A', precio: 999, pendingSync: true }];
    mockSb.upsertResp = [DENEGADO];
    const r = await syncProductos();
    expect(r.requierePinAdmin).toBe(true);
    mockSb.remotos = [{ id: 1, nombre: 'A', precio: 10, codigo: '', unidad: 'unidad', categoria: '' }];
    await downloadMaestros();
    expect(mockLocal.puestos.find(p => p.id === 1)).toBeUndefined();
    expect(mockLocal.productos[0]).toMatchObject({ precio: 999, pendingSync: true });
    expect(mockSb.rpcs).toHaveLength(0);
  });
});

describe('AC-SEC-1 el PIN no queda en storage', () => {
  it('S01-3 tras subir con PIN no hay rastro en localStorage/sessionStorage ni en los productos locales', async () => {
    mockSb.rpcResp = [OK([1])];
    await syncProductos({ cred: { p_admin_id: '9', p_admin_pin: '987654' } });
    const volcado = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + JSON.stringify(mockLocal.productos);
    expect(volcado).not.toContain('987654');
  });
  it('S01-3 la huella de sincronizacion no incluye credenciales', () => {
    expect(huellaProductoSync({ id: 1, nombre: 'A', precio: 1 })).not.toMatch(/pin/i);
  });
});
