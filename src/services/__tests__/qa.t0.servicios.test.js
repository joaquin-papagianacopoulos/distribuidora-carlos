// QA RUN 20261110-t0: casos 3, 4 y 7 a nivel servicio.
const mockDb = { agregados: [], sync: [], stores: {}, leerFalla: false, borrada: 0 };
jest.mock('../../db', () => ({
  addPedido: async (p) => { mockDb.agregados.push(p); return mockDb.agregados.length; },
  markPedidoSynced: async (id, r) => { mockDb.sync.push([id, r]); },
  getPedidos: async () => [], putPedido: async () => undefined, updatePedido: async () => undefined,
  leerTodosLosStores: async () => { if (mockDb.leerFalla) throw new Error('db rota'); return mockDb.stores; },
  cerrarDB: () => { mockDb.borrada += 1; },
}));
jest.mock('../stockService', () => ({ aplicarStockPedido: jest.fn() }));

const mockSb = { llamadas: [], impl: null };
jest.mock('../../lib/supabase', () => ({
  supabase: { from: () => {
    const q = {};
    const api = {
      insert: (r) => { q.row = r; q.op = 'insert'; return api; },
      upsert: (r, o) => { q.row = r; q.opts = o; q.op = 'upsert'; return api; },
      select: () => api, eq: () => api, limit: () => api, single: () => api,
      then: (res, rej) => { mockSb.llamadas.push(q); return Promise.resolve().then(() => mockSb.impl(q)).then(res, rej); },
    };
    return api;
  } },
}));

import { crearPedidoOnlineFirst } from '../pedidoRepository';
import { limpiarCacheLocal } from '../limpiarCache';

const setOnline = (v) => Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => v });
const PED = { clienteNombre: 'K', estado: 'pendiente', fecha: '2026-11-10', items: [{ productoId: 1, cantidad: 1, precio: 10 }], total: 10 };

beforeEach(() => {
  mockDb.agregados = []; mockDb.sync = []; mockDb.stores = {}; mockDb.leerFalla = false; mockDb.borrada = 0;
  mockSb.llamadas = []; setOnline(true); localStorage.clear(); localStorage.setItem('x', '1');
});

describe('AC-SEG2-3 caso 3', () => {
  test('AC-SEG2-3 guardado dos veces con el mismo client_uuid: ambas subidas usan el mismo UUID y el servidor devuelve el mismo id', async () => {
    mockSb.impl = async () => ({ data: [{ id: 'R1' }], error: null });
    const a = await crearPedidoOnlineFirst({ ...PED, clientUuid: 'UUID-FIJO' });
    const b = await crearPedidoOnlineFirst({ ...PED, clientUuid: 'UUID-FIJO' });
    expect(mockSb.llamadas.map(q => q.row.client_uuid)).toEqual(['UUID-FIJO', 'UUID-FIJO']);
    expect(mockSb.llamadas.every(q => q.op === 'upsert' && q.opts.onConflict === 'client_uuid')).toBe(true);
    expect(a.remoteId).toBe(b.remoteId);
  });
  test('AC-SEG2-3 red caida con excepcion (fetch rechaza) queda local sin subir y no lanza', async () => {
    mockSb.impl = async () => { throw new TypeError('Failed to fetch'); };
    const r = await crearPedidoOnlineFirst(PED);
    expect(r.mode).toBe('pendiente');
    expect(mockDb.agregados).toHaveLength(1);
    expect(mockDb.agregados[0].clientUuid).toBeTruthy();
    expect(mockDb.sync).toEqual([]);
  });
  test('AC-SEG2-3 pedido sin campos nuevos (viejo) se guarda igual', async () => {
    mockSb.impl = async () => ({ data: [{ id: 'R5' }], error: null });
    const r = await crearPedidoOnlineFirst({ clienteNombre: 'Viejo', items: [], total: 0 });
    expect(r.mode).toBe('online');
  });
});

describe('AC-SEG2-2 caso 4', () => {
  test('AC-SEG2-2 con pendientes en un store distinto de pedidos no borra nada ni cierra la db', async () => {
    mockDb.stores = { pedidos: [{ id: 1, synced: true }], faltantes: [{ id: 2 }], clientes: [] };
    const r = await limpiarCacheLocal();
    expect(r.bloqueado).toBe(true);
    expect(r.porStore).toEqual({ faltantes: 1 });
    expect(localStorage.getItem('x')).toBe('1');
    expect(mockDb.borrada).toBe(0);
  });
  test('AC-SEG2-2 offline con todo subido no borra', async () => {
    setOnline(false);
    mockDb.stores = { pedidos: [{ id: 1, synced: true }] };
    const r = await limpiarCacheLocal();
    expect(r).toMatchObject({ bloqueado: true, motivo: 'offline' });
    expect(localStorage.getItem('x')).toBe('1');
    expect(mockDb.borrada).toBe(0);
  });
  test('AC-SEG2-2 si no se puede leer la base local NO borra (no se confirma que no hay pendientes)', async () => {
    // (corregido, M-1) limpiarCache falla cerrado si no puede leer la base.
    mockDb.leerFalla = true;
    await limpiarCacheLocal();
    expect(localStorage.getItem('x')).toBe('1');
  });
});
