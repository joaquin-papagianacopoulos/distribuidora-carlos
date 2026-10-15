// REQ-AGR / REQ-ZON: sync tolerante de pedidos.grupos y clientes.orden_zona (migracion 011).
const mockLocal = { clientes: [], pedidos: [] };
jest.mock('../../db', () => {
  const impl = {
    getClientes: async () => mockLocal.clientes.map(c => ({ ...c })),
    getPedidos: async () => mockLocal.pedidos.map(p => ({ ...p })),
    getProductos: async () => [],
    getVendedores: async () => [],
    clearClientesPendingSync: async (ids) => {
      const s = new Set(ids);
      mockLocal.clientes = mockLocal.clientes.map(c => (s.has(c.id) ? { ...c, pendingSync: false } : c));
    },
    putClientesBatch: async (rows) => {
      for (const r of rows) {
        const i = mockLocal.clientes.findIndex(c => c.id === r.id);
        if (i >= 0) mockLocal.clientes[i] = { ...r }; else mockLocal.clientes.push({ ...r });
      }
    },
    putPedidosRemotoBatch: async (rows) => {
      for (const r of rows) {
        const i = mockLocal.pedidos.findIndex(x => x.id === r.id);
        if (i >= 0) mockLocal.pedidos[i] = { ...r }; else mockLocal.pedidos.push({ ...r });
      }
    },
    markPedidoSynced: async () => undefined,
    putVendedoresBatch: async () => undefined,
    putProductosBatch: async () => undefined,
    patchRegistros: async (store, ids, patch) => {
      const s = new Set(ids || []);
      mockLocal[store] = (mockLocal[store] || []).map(r => (s.has(r.id) ? { ...r, ...patch } : r));
    },
  };
  const mod = { __impl: impl };
  for (const k of Object.keys(impl)) mod[k] = jest.fn(impl[k]);
  return mod;
});
jest.mock('../stockService', () => ({ aplicarStockPedido: jest.fn() }));
jest.mock('../../services/imageSearch', () => ({ isImageSearchConfigured: () => false, fetchProductImage: jest.fn(), ImageSearchQuotaError: class extends Error {} }));

const mockSb = { upserts: [], calls: [], respuestas: [], remoto: {} };
jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table) => {
      const q = { table, op: 'select' };
      const api = {
        upsert: (rows, opts) => { mockSb.upserts.push({ table, rows, opts }); return Promise.resolve(mockSb.respuestas.shift() || { error: null }); },
        insert: (row) => { q.op = 'insert'; q.row = row; return api; },
        update: (row) => { q.op = 'update'; q.row = row; return api; },
        select: () => api,
        single: () => api,
        eq: () => api,
        gte: () => api,
        lte: () => api,
        order: () => api,
        range: () => api,
        then: (res, rej) => {
          mockSb.calls.push(q);
          const r = q.op === 'select' ? { data: mockSb.remoto[table] || [], error: null }
            : (mockSb.respuestas.shift() || { data: q.op === 'insert' && Array.isArray(q.row) ? q.row.map((_, i) => ({ id: `R-${i + 1}` })) : [{ id: 'R-1' }], error: null });
          return Promise.resolve(r).then(res, rej);
        },
      };
      return api;
    },
  },
}));

import * as db from '../../db';
import { syncClientes, conFallbackEntrega, pullPedidosByRango } from '../../sync/syncService';

let warnSpy;
beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(db.__impl)) db[k].mockImplementation(db.__impl[k]);
  mockLocal.clientes = []; mockLocal.pedidos = [];
  mockSb.upserts = []; mockSb.calls = []; mockSb.respuestas = []; mockSb.remoto = {};
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => warnSpy.mockRestore());

const ERR_GRUPOS = { code: 'PGRST204', message: "Could not find the 'grupos' column of 'pedidos' in the schema cache" };
const ERR_ZONA = { code: 'PGRST204', message: "Could not find the 'orden_zona' column of 'clientes' in the schema cache" };

describe('AC-AGR-2 pedidos.grupos en el sync', () => {
  it('AC-AGR-2 conFallbackEntrega: falta la columna grupos => reintenta sin grupos y no corta', async () => {
    const ejecutar = jest.fn()
      .mockResolvedValueOnce({ data: null, error: ERR_GRUPOS })
      .mockResolvedValueOnce({ data: [{ id: 1 }], error: null });
    const r = await conFallbackEntrega(ejecutar, { estado: 'facturado', grupos: [{ id: 'a' }], entregado: true });
    expect(r.error).toBeNull();
    expect(ejecutar.mock.calls[0][0]).toHaveProperty('grupos');
    expect(ejecutar.mock.calls[1][0]).not.toHaveProperty('grupos');
    expect(ejecutar.mock.calls[1][0]).toHaveProperty('entregado');
    expect(r.sinEntrega).toBe(false);
  });

  it('AC-AGR-2 grupos y entregado faltan los dos: reintenta en dos pasos', async () => {
    const ERR_ENT = { code: 'PGRST204', message: "Could not find the 'entregado' column of 'pedidos'" };
    const ejecutar = jest.fn()
      .mockResolvedValueOnce({ data: null, error: ERR_GRUPOS })
      .mockResolvedValueOnce({ data: null, error: ERR_ENT })
      .mockResolvedValueOnce({ data: [{ id: 1 }], error: null });
    const r = await conFallbackEntrega(ejecutar, [{ estado: 'x', grupos: [], entregado: true }]);
    expect(r.error).toBeNull();
    expect(r.sinEntrega).toBe(true);
    expect(ejecutar.mock.calls[2][0][0]).not.toHaveProperty('grupos');
    expect(ejecutar.mock.calls[2][0][0]).not.toHaveProperty('entregado');
  });

  it('AC-AGR-2 pull: tipoFactura local se conserva, grupos remotos se sanean y lo local se mantiene si la columna no vino', async () => {
    mockLocal.pedidos = [
      { id: 1, remoteId: 'R1', estado: 'facturado', fecha: '2026-10-10', items: [{ productoId: 1, nombre: 'a', cantidad: 1, precio: 1 }], tipoFactura: 'A', tipoFacturaPendiente: true, tipoFacturaAt: 5, grupos: [{ id: 'g', nombre: 'G', itemIds: ['1'] }], synced: true },
      { id: 2, remoteId: 'R2', estado: 'facturado', fecha: '2026-10-10', items: [{ productoId: 1, nombre: 'a', cantidad: 1, precio: 1 }, { productoId: 2, nombre: 'b', cantidad: 1, precio: 1 }], synced: true },
    ];
    mockSb.remoto.pedidos = [
      { id: 'R1', estado: 'facturado', fecha: '2026-10-10', items: [{ productoId: 1, nombre: 'a', cantidad: 1, precio: 1 }], total: 1 },
      { id: 'R2', estado: 'facturado', fecha: '2026-10-10', items: [{ productoId: 1, nombre: 'a', cantidad: 1, precio: 1 }, { productoId: 2, nombre: 'b', cantidad: 1, precio: 1 }], total: 2, grupos: [{ id: 'x', nombre: 'X', itemIds: ['1', '2', '99'] }, 'basura'] },
    ];
    await pullPedidosByRango('2026-10-01', '2026-10-31');
    const p1 = mockLocal.pedidos.find(p => p.id === 1);
    const p2 = mockLocal.pedidos.find(p => p.id === 2);
    expect(p1).toMatchObject({ tipoFactura: 'A', tipoFacturaPendiente: true, tipoFacturaAt: 5 });
    expect(p1.grupos).toEqual([{ id: 'g', nombre: 'G', itemIds: ['1'] }]);
    expect(p2.grupos).toEqual([{ id: 'x', nombre: 'X', itemIds: ['1', '2'] }]);
  });
});

describe('AC-ZON-3 clientes.orden_zona en el sync', () => {
  const CLI = { id: 7, nombre: 'Kiosco', zona: 'Norte', ordenZona: 3, diaEntrega: 'lunes', ordenEntrega: 2, pendingSync: true };

  it('AC-ZON-3 sube orden_zona junto con dia/orden (que se conservan)', async () => {
    mockLocal.clientes = [CLI];
    await syncClientes();
    expect(mockSb.upserts[0].rows[0]).toMatchObject({ id: 7, orden_zona: 3, dia_entrega: 'lunes', orden_entrega: 2 });
    expect(db.clearClientesPendingSync).toHaveBeenCalledWith([7]);
  });

  it('AC-ZON-3 sin ordenZona manda null', async () => {
    mockLocal.clientes = [{ ...CLI, ordenZona: undefined }];
    await syncClientes();
    expect(mockSb.upserts[0].rows[0].orden_zona).toBeNull();
  });

  it('AC-ZON-3 falta la columna orden_zona: reintenta sin ella, no corta y limpia pendingSync', async () => {
    mockLocal.clientes = [CLI];
    mockSb.respuestas = [{ error: ERR_ZONA }, { error: null }];
    await expect(syncClientes()).resolves.toEqual({ ok: true });
    expect(mockSb.upserts).toHaveLength(2);
    expect(mockSb.upserts[1].rows[0]).not.toHaveProperty('orden_zona');
    expect(mockSb.upserts[1].rows[0]).toMatchObject({ id: 7, dia_entrega: 'lunes', orden_entrega: 2 });
    expect(db.clearClientesPendingSync).toHaveBeenCalledWith([7]);
  });
});
