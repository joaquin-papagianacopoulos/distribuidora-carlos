// REQ-SEG2 (AC-SEG2-3): crear un pedido escribe primero en IndexedDB con clientUuid y la subida es idempotente.
const mockDb = { agregados: [], sincronizados: [] };
jest.mock('../../db', () => ({
  addPedido: async (p) => { mockDb.agregados.push(p); return 77; },
  markPedidoSynced: async (id, remoteId) => { mockDb.sincronizados.push([id, remoteId]); },
  getPedidos: async () => [],
  putPedido: async () => undefined,
  updatePedido: async () => undefined,
}));
jest.mock('../stockService', () => ({ aplicarStockPedido: jest.fn() }));

const mockSb = { llamadas: [], respuestas: [] };
jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table) => {
      const q = { table, op: 'select' };
      const api = {
        insert: (row) => { q.op = 'insert'; q.row = row; return api; },
        upsert: (row, opts) => { q.op = 'upsert'; q.row = row; q.opts = opts; return api; },
        update: (row) => { q.op = 'update'; q.row = row; return api; },
        select: () => api,
        eq: (c, v) => { q.eq = [c, v]; return api; },
        limit: () => api,
        single: () => api,
        then: (res, rej) => { mockSb.llamadas.push(q); return Promise.resolve(mockSb.respuestas.shift() || { data: [], error: null }).then(res, rej); },
      };
      return api;
    },
  },
}));

import { crearPedidoOnlineFirst } from '../pedidoRepository';

const setOnline = (v) => Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => v });
const PEDIDO = { clienteNombre: 'Kiosco', estado: 'pendiente', fecha: '2026-11-10', items: [{ productoId: 1, cantidad: 1, precio: 10 }], total: 10 };

beforeEach(() => {
  mockDb.agregados = []; mockDb.sincronizados = [];
  mockSb.llamadas = []; mockSb.respuestas = [];
  setOnline(true);
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => console.warn.mockRestore());

describe('AC-SEG2-3 crearPedidoOnlineFirst', () => {
  test('AC-SEG2-3 escribe primero en el dispositivo con clientUuid y sube con upsert por client_uuid', async () => {
    mockSb.respuestas = [{ data: [{ id: 'R1' }], error: null }];
    const r = await crearPedidoOnlineFirst(PEDIDO);
    expect(mockDb.agregados[0].clientUuid).toEqual(expect.any(String));
    expect(mockSb.llamadas[0]).toMatchObject({ op: 'upsert', opts: { onConflict: 'client_uuid', ignoreDuplicates: true } });
    expect(mockSb.llamadas[0].row.client_uuid).toBe(mockDb.agregados[0].clientUuid);
    expect(r).toEqual({ localId: 77, remoteId: 'R1', mode: 'online' });
    expect(mockDb.sincronizados).toEqual([[77, 'R1']]);
  });
  test('AC-SEG2-3 si la red cae no pierde el pedido: queda local sin subir y no lanza', async () => {
    mockSb.respuestas = [{ data: null, error: new Error('Failed to fetch') }];
    const r = await crearPedidoOnlineFirst(PEDIDO);
    expect(r).toMatchObject({ localId: 77, mode: 'pendiente' });
    expect(r.error.message).toBe('Failed to fetch');
    expect(mockDb.agregados).toHaveLength(1);
    expect(mockDb.sincronizados).toEqual([]);
  });
  test('AC-SEG2-3 si el alta ya existía (conflicto ignorado) lee el id por client_uuid, sin duplicar', async () => {
    mockSb.respuestas = [{ data: [], error: null }, { data: [{ id: 'R9', client_uuid: 'x' }], error: null }, { data: [{ id: 'R9' }], error: null }];
    const r = await crearPedidoOnlineFirst(PEDIDO);
    expect(r).toMatchObject({ remoteId: 'R9', mode: 'online' });
    expect(mockSb.llamadas[1]).toMatchObject({ op: 'select', eq: ['client_uuid', mockDb.agregados[0].clientUuid] });
    expect(mockSb.llamadas.filter(c => c.op === 'insert')).toHaveLength(0);
  });
  test('AC-SEG2-3 si el alta ya existía, actualiza por id con la versión local (no pierde la edición)', async () => {
    mockSb.respuestas = [{ data: [], error: null }, { data: [{ id: 'R9', client_uuid: 'x' }], error: null }, { data: [{ id: 'R9' }], error: null }];
    await crearPedidoOnlineFirst(PEDIDO);
    expect(mockSb.llamadas[2]).toMatchObject({ op: 'update', eq: ['id', 'R9'] });
    expect(mockSb.llamadas[2].row.total).toBe(10);
    expect('client_uuid' in mockSb.llamadas[2].row).toBe(false);
  });
  test('AC-SEG2-3 si el update del existente falla, no marca synced (queda pendiente)', async () => {
    mockSb.respuestas = [{ data: [], error: null }, { data: [{ id: 'R9', client_uuid: 'x' }], error: null }, { data: null, error: new Error('boom') }];
    const r = await crearPedidoOnlineFirst(PEDIDO);
    expect(r).toMatchObject({ mode: 'pendiente' });
    expect(mockDb.sincronizados).toEqual([]);
  });
  test('AC-SEG2-3 sin la migración 023 (columna ausente) usa el insert de antes sin client_uuid', async () => {
    mockSb.respuestas = [
      { data: null, error: { code: 'PGRST204', message: "Could not find the 'client_uuid' column of 'pedidos' in the schema cache" } },
      { data: { id: 'R2' }, error: null },
    ];
    const r = await crearPedidoOnlineFirst(PEDIDO);
    expect(mockSb.llamadas[1].op).toBe('insert');
    expect('client_uuid' in mockSb.llamadas[1].row).toBe(false);
    expect(r).toMatchObject({ remoteId: 'R2', mode: 'online' });
  });
  test('AC-SEG2-3 offline: guarda local y no llama a la nube', async () => {
    setOnline(false);
    const r = await crearPedidoOnlineFirst(PEDIDO);
    expect(r).toEqual({ localId: 77, mode: 'offline' });
    expect(mockDb.agregados[0].clientUuid).toEqual(expect.any(String));
    expect(mockSb.llamadas).toHaveLength(0);
  });
});
