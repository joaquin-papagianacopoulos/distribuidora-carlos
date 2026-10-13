// REQ-COM AC-COM-1: la marca "Entregado" se guarda y sincroniza tolerando que
// Supabase todavía no tenga las columnas (AC-CLI-5) y NUNCA toca el stock.
const mockLocal = { pedidos: [] };
jest.mock('../../db', () => {
  const impl = {
    getPedidos: async () => mockLocal.pedidos.map(p => ({ ...p })),
    updatePedido: async (p) => { const i = mockLocal.pedidos.findIndex(x => x.id === p.id); mockLocal.pedidos[i] = { ...p, synced: false }; },
    putPedido: async (p) => { const i = mockLocal.pedidos.findIndex(x => x.id === p.id); mockLocal.pedidos[i] = { ...p }; },
    addPedido: async () => 1,
    addPedidoSynced: async () => 1,
    markPedidoSynced: async (id, remoteId) => {
      const i = mockLocal.pedidos.findIndex(x => x.id === id);
      mockLocal.pedidos[i] = { ...mockLocal.pedidos[i], synced: true, remoteId };
    },
    putPedidoRemoto: async () => undefined,
    deletePedido: async () => undefined,
    putPedidosRemotoBatch: async (rows) => {
      for (const r of rows) {
        const i = mockLocal.pedidos.findIndex(x => x.id === r.id);
        if (i >= 0) mockLocal.pedidos[i] = { ...r }; else mockLocal.pedidos.push({ ...r });
      }
    },
    patchRegistros: async (store, ids, patch) => {
      const s = new Set(ids || []);
      mockLocal.pedidos = mockLocal.pedidos.map(r => (s.has(r.id) ? { ...r, ...patch } : r));
    },
  };
  const mod = { __impl: impl };
  for (const k of Object.keys(impl)) mod[k] = jest.fn(impl[k]);
  return mod;
});
jest.mock('../stockService', () => ({ aplicarStockPedido: jest.fn() }));
jest.mock('../../services/imageSearch', () => ({ isImageSearchConfigured: () => false, fetchProductImage: jest.fn(), ImageSearchQuotaError: class extends Error {} }));

// Supabase falso: registra cada llamada y responde de una cola.
const mockSb = { calls: [], respuestas: [], remoto: [] };
jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table) => {
      const q = { table, op: 'select', filtros: [] };
      const api = {
        insert: (row) => { q.op = 'insert'; q.row = row; return api; },
        update: (row) => { q.op = 'update'; q.row = row; return api; },
        select: () => api,
        single: () => api,
        eq: (c, v) => { q.filtros.push(['eq', c, v]); return api; },
        gte: (c, v) => { q.filtros.push(['gte', c, v]); return api; },
        lte: (c, v) => { q.filtros.push(['lte', c, v]); return api; },
        order: () => api,
        range: (a, b) => { q.range = [a, b]; return api; },
        then: (res, rej) => {
          mockSb.calls.push(q);
          const r = q.op === 'select' ? { data: mockSb.remoto, error: null } : (mockSb.respuestas.shift() || { data: q.op === 'insert' && Array.isArray(q.row) ? q.row.map((_, i) => ({ id: `R-${i + 1}` })) : (q.op === 'update' && !q.single ? [{ id: 'R-1' }] : { id: 'R-1' }), error: null });
          return Promise.resolve(r).then(res, rej);
        },
      };
      return api;
    },
  },
}));

import * as db from '../../db';
import { marcarEntregadoOnlineFirst } from '../pedidoRepository';
import { aplicarStockPedido } from '../stockService';
import { setUsuarioSesion } from '../sesion';
import { syncPedidosPendientes, syncEntregasPendientes, pullPedidosByRango, conFallbackEntrega } from '../../sync/syncService';

const setOnline = (v) => Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => v });
const ERR_COL = { code: 'PGRST204', message: "Could not find the 'entregado' column of 'pedidos' in the schema cache" };
const PEDIDO = { id: 5, remoteId: 'R-1', clienteNombre: 'Kiosco', estado: 'facturado', fecha: '2026-10-07', items: [{ productoId: 1, cantidad: 3 }], total: 300, synced: true };

let warnSpy;
beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(db.__impl)) db[k].mockImplementation(db.__impl[k]);
  mockLocal.pedidos = [{ ...PEDIDO }];
  mockSb.calls = []; mockSb.respuestas = []; mockSb.remoto = [];
  setUsuarioSesion({ id: 4, nombre: 'Ana', permiso: 3 });
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { warnSpy.mockRestore(); setUsuarioSesion(null); });

describe('AC-COM-1 marcarEntregadoOnlineFirst', () => {
  it('AC-COM-1 offline: guarda entregado/entregadoAt/entregadoPor sin cambiar estado y sin tocar stock', async () => {
    setOnline(false);
    const r = await marcarEntregadoOnlineFirst(PEDIDO, true);
    expect(r.mode).toBe('offline');
    expect(mockLocal.pedidos[0]).toMatchObject({ entregado: true, entregadoPor: 'Ana', estado: 'facturado', total: 300, synced: false });
    expect(typeof mockLocal.pedidos[0].entregadoAt).toBe('number');
    expect(aplicarStockPedido).not.toHaveBeenCalled();
    expect(mockSb.calls).toHaveLength(0);
  });

  it('AC-COM-1 online: sube las columnas entregado* junto con el pedido y no toca stock', async () => {
    setOnline(true);
    await marcarEntregadoOnlineFirst(PEDIDO, true);
    expect(mockSb.calls).toHaveLength(1);
    expect(mockSb.calls[0]).toMatchObject({ op: 'update', row: { entregado: true, entregado_por: 'Ana', estado: 'facturado' } });
    expect(mockSb.calls[0].row.entregado_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(mockLocal.pedidos[0]).toMatchObject({ entregado: true, synced: true, entregaPendiente: false, syncLock: false });
    expect(aplicarStockPedido).not.toHaveBeenCalled();
  });

  it('AC-COM-1 AC-CLI-5 online sin la columna (PGRST204): reintenta sin entregado* y deja la marca local pendiente', async () => {
    setOnline(true);
    mockSb.respuestas = [{ data: null, error: ERR_COL }, { data: { id: 'R-1' }, error: null }];
    await expect(marcarEntregadoOnlineFirst(PEDIDO, true)).resolves.toMatchObject({ mode: 'online', remoteId: 'R-1' });
    expect(mockSb.calls).toHaveLength(2);
    expect(mockSb.calls[1].row).not.toHaveProperty('entregado');
    expect(mockSb.calls[1].row).not.toHaveProperty('entregado_at');
    expect(mockSb.calls[1].row).toMatchObject({ estado: 'facturado', total: 300 });
    expect(mockLocal.pedidos[0]).toMatchObject({ entregado: true, entregaPendiente: true, synced: true });
  });

  it('AC-COM-1 un error que no es de columna restaura el pedido original y se propaga', async () => {
    setOnline(true);
    mockSb.respuestas = [{ data: null, error: { code: '500', message: 'boom' } }];
    await expect(marcarEntregadoOnlineFirst(PEDIDO, true)).rejects.toMatchObject({ message: 'boom' });
    expect(mockLocal.pedidos[0].entregado).toBeUndefined();
  });

  it('AC-COM-1 desmarcar limpia la marca', async () => {
    setOnline(true);
    mockLocal.pedidos = [{ ...PEDIDO, entregado: true, entregadoAt: 1, entregadoPor: 'Ana' }];
    await marcarEntregadoOnlineFirst(mockLocal.pedidos[0], false);
    expect(mockSb.calls[0].row).toMatchObject({ entregado: false, entregado_at: null, entregado_por: null });
    expect(mockLocal.pedidos[0]).toMatchObject({ entregado: false, entregadoAt: null, entregadoPor: null, estado: 'facturado' });
  });

  it.each([
    ['vendedor (2)', { id: 2, nombre: 'Carlos', permiso: 2 }],
    ['sin sesión', null],
  ])('AC-COM-1 AC-SEC-4 S-COM-05 %s: el repositorio rechaza marcar y desmarcar sin escribir nada', async (_l, sesion) => {
    setOnline(true);
    setUsuarioSesion(sesion);
    await expect(marcarEntregadoOnlineFirst(PEDIDO, true)).rejects.toThrow(/permiso/);
    await expect(marcarEntregadoOnlineFirst({ ...PEDIDO, entregado: true }, false)).rejects.toThrow(/permiso/);
    expect(mockSb.calls).toHaveLength(0);
    expect(db.updatePedido).not.toHaveBeenCalled();
    expect(db.putPedido).not.toHaveBeenCalled();
    expect(mockLocal.pedidos[0].entregado).toBeUndefined();
  });

  it('AC-COM-1 S-COM-05 pedido no facturado o en un cierre (para no admin) también se rechaza en el repositorio', async () => {
    setOnline(true);
    await expect(marcarEntregadoOnlineFirst({ ...PEDIDO, estado: 'pendiente' }, true)).rejects.toThrow(/facturado/);
    await expect(marcarEntregadoOnlineFirst({ ...PEDIDO, entregado: true }, false, { cerradoEn: 'c1' })).rejects.toThrow(/cierre/);
    setUsuarioSesion({ id: 1, nombre: 'Jorge', permiso: 1 });
    mockLocal.pedidos = [{ ...PEDIDO, entregado: true }];
    await expect(marcarEntregadoOnlineFirst(mockLocal.pedidos[0], false, { cerradoEn: 'c1' })).resolves.toMatchObject({ pedido: expect.objectContaining({ entregado: false }) });
    expect(mockSb.calls).toHaveLength(1);
  });
});

describe('AC-COM-1 AC-CLI-5 sync diferido de entregado', () => {
  it('AC-COM-1 syncPedidosPendientes: update sin la columna reintenta legacy y marca entregaPendiente', async () => {
    mockLocal.pedidos = [{ ...PEDIDO, synced: false, entregado: true, entregadoAt: 1, entregadoPor: 'Ana' }];
    mockSb.respuestas = [{ data: null, error: ERR_COL }, { data: [{ id: 'R-1' }], error: null }];
    await syncPedidosPendientes();
    const updates = mockSb.calls.filter(c => c.op === 'update');
    expect(updates[0].row).toHaveProperty('entregado', true);
    expect(updates[1].row).not.toHaveProperty('entregado');
    expect(mockLocal.pedidos[0]).toMatchObject({ synced: true, entregaPendiente: true });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('003_comisiones.sql'));
  });

  it('AC-COM-1 syncPedidosPendientes: insert en lote con columna faltante también reintenta', async () => {
    mockLocal.pedidos = [{ ...PEDIDO, remoteId: null, synced: false, entregado: true }, { ...PEDIDO, id: 6, remoteId: null, synced: false }];
    mockSb.respuestas = [{ data: null, error: ERR_COL }, { data: [{ id: 'R-9' }, { id: 'R-10' }], error: null }];
    await syncPedidosPendientes();
    const ins = mockSb.calls.filter(c => c.op === 'insert');
    expect(ins).toHaveLength(2);
    expect(ins[1].row.every(r => !('entregado' in r))).toBe(true);
    expect(mockLocal.pedidos.find(p => p.id === 5)).toMatchObject({ remoteId: 'R-9', entregaPendiente: true });
    expect(mockLocal.pedidos.find(p => p.id === 6)).toMatchObject({ remoteId: 'R-10', entregaPendiente: false });
  });

  it('AC-COM-1 con la columna ya creada, el sync siguiente sube SOLO entregado* y limpia la marca', async () => {
    mockLocal.pedidos = [{ ...PEDIDO, entregado: true, entregadoAt: Date.UTC(2026, 9, 7), entregadoPor: 'Ana', entregaPendiente: true }];
    await syncPedidosPendientes();
    expect(mockSb.calls).toHaveLength(1);
    expect(mockSb.calls[0].row).toEqual({ entregado: true, entregado_at: '2026-10-07T00:00:00.000Z', entregado_por: 'Ana' });
    expect(mockSb.calls[0].filtros).toEqual([['eq', 'id', 'R-1']]);
    expect(mockLocal.pedidos[0].entregaPendiente).toBe(false);
  });

  it('AC-COM-1 si la columna sigue faltando, la marca queda pendiente y no se corta nada', async () => {
    mockLocal.pedidos = [{ ...PEDIDO, entregado: true, entregaPendiente: true }, { ...PEDIDO, id: 7, remoteId: 'R-7', entregado: true, entregaPendiente: true }];
    mockSb.respuestas = [{ error: ERR_COL }];
    await expect(syncEntregasPendientes()).resolves.toEqual({ ok: true, count: 0 });
    expect(mockSb.calls).toHaveLength(1); // corta en el primero: no insiste fila por fila
    expect(mockLocal.pedidos.every(p => p.entregaPendiente)).toBe(true);
  });

  it('AC-COM-1 otro error en una fila no frena las demás', async () => {
    mockLocal.pedidos = [{ ...PEDIDO, entregado: true, entregaPendiente: true }, { ...PEDIDO, id: 7, remoteId: 'R-7', entregado: true, entregaPendiente: true }];
    mockSb.respuestas = [{ error: { code: '500', message: 'x' } }, { error: null }];
    await expect(syncEntregasPendientes()).resolves.toEqual({ ok: true, count: 1 });
    expect(mockLocal.pedidos.find(p => p.id === 7).entregaPendiente).toBe(false);
  });

  it('AC-COM-1 conFallbackEntrega: si el reintento también falla, devuelve el error', async () => {
    const ej = jest.fn().mockResolvedValueOnce({ error: ERR_COL }).mockResolvedValueOnce({ error: { code: '500' } });
    await expect(conFallbackEntrega(ej, { entregado: true, a: 1 })).resolves.toMatchObject({ error: { code: '500' }, sinEntrega: false });
    expect(ej).toHaveBeenLastCalledWith({ a: 1 });
  });
});

describe('AC-COM-3 AC-CLI-5 pullPedidosByRango', () => {
  it('AC-COM-3 trae el rango por fecha (sin filtro de vendedor) y sin la columna conserva la marca local', async () => {
    mockLocal.pedidos = [{ ...PEDIDO, entregado: true, entregadoAt: 9, entregadoPor: 'Ana' }];
    mockSb.remoto = [
      { id: 'R-1', cliente_nombre: 'Kiosco', vendedor: 'Carlos', fecha: '2026-10-07', items: [], total: 300, estado: 'facturado' },
      { id: 'R-2', cliente_nombre: 'Otro', vendedor: 'Lucía', fecha: '2026-10-08', items: [], total: 100, estado: 'facturado', entregado: true, entregado_at: '2026-10-08T10:00:00Z', entregado_por: 'Ana' },
    ];
    const r = await pullPedidosByRango('2026-10-01', '2026-10-31');
    expect(r).toMatchObject({ ok: true, count: 2, incompleto: false });
    const q = mockSb.calls[0];
    expect(q.filtros).toEqual([['gte', 'fecha', '2026-10-01'], ['lte', 'fecha', '2026-10-31']]);
    expect(mockLocal.pedidos.find(p => p.remoteId === 'R-1')).toMatchObject({ entregado: true, entregadoAt: 9, entregadoPor: 'Ana' });
    expect(mockLocal.pedidos.find(p => p.remoteId === 'R-2')).toMatchObject({ entregado: true, entregadoPor: 'Ana' });
    expect(db.deletePedido).not.toHaveBeenCalled();
  });

  it('AC-COM-3 no pisa pedidos con cambios locales sin subir; sin rango no consulta', async () => {
    mockLocal.pedidos = [{ ...PEDIDO, synced: false, total: 999 }];
    mockSb.remoto = [{ id: 'R-1', fecha: '2026-10-07', total: 300, estado: 'facturado' }];
    await pullPedidosByRango('2026-10-01', '2026-10-31');
    expect(mockLocal.pedidos[0].total).toBe(999);
    mockSb.calls = [];
    expect(await pullPedidosByRango('', '2026-10-31')).toEqual({ ok: true, count: 0 });
    expect(mockSb.calls).toHaveLength(0);
  });
});
