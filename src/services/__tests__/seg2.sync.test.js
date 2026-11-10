// REQ-SEG2 en src/sync/syncService.js: AC-SEG2-3 (pedidos por UUID), AC-SEG2-4 (faltantes paginados),
// AC-SEG2-7 (clientes con 403 y sin pisar ediciones).
const mockLocal = { clientes: [], pedidos: [], faltantes: [], borrados: [] };
jest.mock('../../db', () => {
  const impl = {
    getClientes: async () => mockLocal.clientes.map(c => ({ ...c })),
    getPedidos: async () => mockLocal.pedidos.map(p => ({ ...p })),
    getFaltantes: async () => mockLocal.faltantes.map(f => ({ ...f })),
    addFaltante: async (f) => { mockLocal.faltantes.push({ ...f, id: mockLocal.faltantes.length + 1000 }); },
    updateFaltante: async () => undefined,
    deleteFaltante: async (id) => { mockLocal.borrados.push(id); },
    clearClientesPendingSync: async () => undefined,
    putPedidosRemotoBatch: async () => undefined,
    markPedidoSynced: async (id, remoteId, opts) => {
      mockLocal.pedidos = mockLocal.pedidos.map(p => (p.id === id ? { ...p, remoteId, synced: true, opts } : p));
    },
    patchRegistros: async (store, ids, patch) => {
      const s = new Set(ids || []);
      mockLocal[store] = (mockLocal[store] || []).map(r => (s.has(r.id) ? { ...r, ...patch } : r));
    },
    putPedidoRemoto: async () => undefined,
    deletePedido: async () => undefined,
  };
  const mod = { __impl: impl };
  for (const k of Object.keys(impl)) mod[k] = jest.fn(impl[k]);
  return mod;
});
jest.mock('../stockService', () => ({ aplicarStockPedido: jest.fn() }));
jest.mock('../../services/imageSearch', () => ({ isImageSearchConfigured: () => false, fetchProductImage: jest.fn(), ImageSearchQuotaError: class extends Error {} }));

const mockSb = { calls: [], faltantesRemotos: [], errorPagina: null, upsertPedidos: null, selectPedidos: [], upsertClientes: null };
jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table) => {
      const q = { table, op: 'select', filtros: [] };
      const api = {
        upsert: (rows, opts) => { q.op = 'upsert'; q.rows = rows; q.opts = opts; return api; },
        insert: (rows) => { q.op = 'insert'; q.rows = rows; return api; },
        update: (row) => { q.op = 'update'; q.row = row; return api; },
        eq: (c, v) => { q.eq = [c, v]; return api; },
        select: () => api,
        in: (c, v) => { q.filtros.push(['in', c, v]); return api; },
        order: () => api,
        range: (a, b) => { q.range = [a, b]; return api; },
        single: () => api,
        then: (res, rej) => {
          mockSb.calls.push(q);
          let r = { data: [], error: null };
          if (table === 'faltantes' && q.op === 'select') {
            r = mockSb.errorPagina && q.range[0] >= 1000
              ? { data: null, error: mockSb.errorPagina }
              : { data: mockSb.faltantesRemotos.slice(q.range[0], q.range[1] + 1), error: null };
          } else if (table === 'pedidos' && (q.op === 'upsert' || q.op === 'insert')) r = mockSb.upsertPedidos(q);
          else if (table === 'pedidos' && q.op === 'update') r = { data: null, error: mockSb.errorUpdate || null };
          else if (table === 'pedidos' && q.op === 'select') r = { data: mockSb.selectPedidos, error: null };
          else if (table === 'clientes' && q.op === 'upsert') r = mockSb.upsertClientes(q);
          return Promise.resolve(r).then(res, rej);
        },
      };
      return api;
    },
  },
}));

import * as db from '../../db';
import { syncFaltantes, syncPedidosPendientes, syncClientes } from '../../sync/syncService';

const filasRemotas = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1, fecha: '2026-11-01', mes: '2026-11', pedido_id: 1, cliente_nombre: 'C', producto_id: 1, producto_nombre: 'P', cantidad_faltante: 1, precio_unitario: 1, dinero_no_percibido: 1 }));

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(db.__impl)) db[k].mockImplementation(db.__impl[k]);
  Object.assign(mockLocal, { clientes: [], pedidos: [], faltantes: [], borrados: [] });
  Object.assign(mockSb, { calls: [], faltantesRemotos: [], errorPagina: null, selectPedidos: [] });
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { console.warn.mockRestore(); console.error.mockRestore(); });

describe('AC-SEG2-4 syncFaltantes paginado', () => {
  test('AC-SEG2-4 baja 1500 filas en 2 páginas y no borra lo que sigue en el remoto', async () => {
    mockSb.faltantesRemotos = filasRemotas(1500);
    mockLocal.faltantes = [{ id: 1, remoteId: 1400 }, { id: 2, remoteId: 5 }];
    await syncFaltantes();
    const pags = mockSb.calls.filter(c => c.table === 'faltantes' && c.op === 'select');
    expect(pags.map(p => p.range)).toEqual([[0, 999], [1000, 1999]]);
    expect(mockLocal.borrados).toEqual([]);
    expect(mockLocal.faltantes.length).toBeGreaterThan(1400); // bajó las que no tenía
  });
  test('AC-SEG2-4 solo borra local lo ausente del remoto completo', async () => {
    mockSb.faltantesRemotos = filasRemotas(3);
    mockLocal.faltantes = [{ id: 1, remoteId: 1 }, { id: 2, remoteId: 999 }];
    await syncFaltantes();
    expect(mockLocal.borrados).toEqual([2]);
  });
  test('AC-SEG2-4 una página con error corta con error y no purga nada', async () => {
    mockSb.faltantesRemotos = filasRemotas(1500);
    mockSb.errorPagina = { message: 'timeout' };
    mockLocal.faltantes = [{ id: 2, remoteId: 99999 }];
    await expect(syncFaltantes()).rejects.toMatchObject({ message: 'timeout' });
    expect(mockLocal.borrados).toEqual([]);
  });
  test('AC-SEG2-4 remoto vacío no purga', async () => {
    mockSb.faltantesRemotos = [];
    mockLocal.faltantes = [{ id: 2, remoteId: 77 }];
    await syncFaltantes();
    expect(mockLocal.borrados).toEqual([]);
  });
});

describe('AC-SEG2-3 syncPedidosPendientes por client_uuid', () => {
  const pend = (id, extra = {}) => ({ id, clienteNombre: 'K', estado: 'pendiente', fecha: '2026-11-10', items: [], total: 10, synced: false, updatedAt: 111, ...extra });

  test('AC-SEG2-3 asigna UUID antes de subir, usa upsert por client_uuid y mapea la respuesta parcial por UUID', async () => {
    mockLocal.pedidos = [pend(1, { clientUuid: 'u1' }), pend(2), pend(3, { clientUuid: 'u3' })];
    mockSb.upsertPedidos = (q) => ({ data: [{ id: 'R3', client_uuid: 'u3' }, { id: 'R1', client_uuid: 'u1' }], error: null });
    mockSb.selectPedidos = [];
    await syncPedidosPendientes();
    const up = mockSb.calls.find(c => c.table === 'pedidos' && c.op === 'upsert');
    expect(up.opts).toEqual({ onConflict: 'client_uuid', ignoreDuplicates: true });
    expect(up.rows.every(r => typeof r.client_uuid === 'string')).toBe(true);
    expect(mockLocal.pedidos.find(p => p.id === 2).clientUuid).toEqual(expect.any(String)); // UUID guardado local
    expect(mockLocal.pedidos.find(p => p.id === 1)).toMatchObject({ remoteId: 'R1', synced: true });
    expect(mockLocal.pedidos.find(p => p.id === 3)).toMatchObject({ remoteId: 'R3', synced: true });
    // El 2 no volvió en la respuesta y no existe en la nube: sigue pendiente (no se le inventa remoteId).
    expect(mockLocal.pedidos.find(p => p.id === 2).remoteId).toBeUndefined();
    expect(mockLocal.pedidos.find(p => p.id === 2).synced).toBe(false);
  });
  test('AC-SEG2-3 un reintento cuyo alta ya existía engancha el id por UUID', async () => {
    mockLocal.pedidos = [pend(1, { clientUuid: 'u1' })];
    mockSb.upsertPedidos = () => ({ data: [], error: null }); // ON CONFLICT DO NOTHING: no devuelve fila
    mockSb.selectPedidos = [{ id: 'R1', client_uuid: 'u1' }];
    await syncPedidosPendientes();
    expect(mockLocal.pedidos[0]).toMatchObject({ remoteId: 'R1', synced: true });
    // La edición local se sube por id (no se pierde si el alta ya existía).
    const up = mockSb.calls.find(c => c.table === 'pedidos' && c.op === 'update');
    expect(up).toMatchObject({ eq: ['id', 'R1'] });
    expect('client_uuid' in up.row).toBe(false);
  });
  test('AC-SEG2-3 si el update del existente falla, no marca synced', async () => {
    mockLocal.pedidos = [pend(1, { clientUuid: 'u1' })];
    mockSb.upsertPedidos = () => ({ data: [], error: null });
    mockSb.selectPedidos = [{ id: 'R1', client_uuid: 'u1' }];
    mockSb.errorUpdate = { message: 'boom' };
    await syncPedidosPendientes().catch(() => {});
    mockSb.errorUpdate = null;
    expect(mockLocal.pedidos[0].synced).toBe(false);
  });
  test('AC-SEG2-3 sin la migración 023 vuelve al insert de antes', async () => {
    mockLocal.pedidos = [pend(1, { clientUuid: 'u1' })];
    // Con client_uuid en la fila falla siempre (la columna no existe); sin ella, sube.
    mockSb.upsertPedidos = (q) => {
      return q.rows.some(r => 'client_uuid' in r)
        ? { data: null, error: { code: 'PGRST204', message: "Could not find the 'client_uuid' column of 'pedidos' in the schema cache" } }
        : { data: [{ id: 'R1' }], error: null };
    };
    await syncPedidosPendientes();
    expect(mockLocal.pedidos[0]).toMatchObject({ remoteId: 'R1', synced: true });
    const ups = mockSb.calls.filter(c => c.table === 'pedidos' && (c.op === 'upsert' || c.op === 'insert'));
    const ultima = ups[ups.length - 1];
    expect(ultima.op).toBe('insert');
    expect(ultima.rows.every(r => !('client_uuid' in r))).toBe(true);
  });
  test('AC-SEG2-7 markPedidoSynced recibe el updatedAt enviado (edición mientras sube queda pendiente)', async () => {
    mockLocal.pedidos = [pend(1, { clientUuid: 'u1', updatedAt: 555 })];
    mockSb.upsertPedidos = () => ({ data: [{ id: 'R1', client_uuid: 'u1' }], error: null });
    await syncPedidosPendientes();
    expect(db.markPedidoSynced).toHaveBeenCalledWith(1, 'R1', { updatedAtEnviado: 555 });
  });
});

describe('AC-SEG2-7 syncClientes', () => {
  const cli = { id: 7, nombre: 'Kiosco', pendingSync: true, updatedAt: 42 };

  test('AC-SEG2-7 un 403 informa el error (ok:false) y deja pendiente', async () => {
    mockLocal.clientes = [cli];
    mockSb.upsertClientes = () => ({ error: { status: 403, code: '42501', message: 'permission denied' } });
    const r = await syncClientes();
    expect(r).toMatchObject({ ok: false, motivo: 'sin_permiso' });
    expect(r.mensaje).toMatch(/clientes/);
    expect(db.clearClientesPendingSync).not.toHaveBeenCalled();
  });
  test('AC-SEG2-7 al limpiar pendingSync informa la versión enviada (updatedAt)', async () => {
    mockLocal.clientes = [cli];
    mockSb.upsertClientes = () => ({ error: null });
    const r = await syncClientes();
    expect(r.ok).toBe(true);
    expect(db.clearClientesPendingSync).toHaveBeenCalledWith([{ id: 7, updatedAt: 42 }]);
  });
});
