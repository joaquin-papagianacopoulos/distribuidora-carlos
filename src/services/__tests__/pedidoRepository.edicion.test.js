// REQ-EDP (AC-EDP-1/3): editar un pedido no lo duplica y no pisa en silencio una version nueva del servidor.
const mockDb = { guardados: [], local: null };
jest.mock('../../db', () => ({
  addPedido: jest.fn(),
  markPedidoSynced: jest.fn(),
  getPedidos: async () => (mockDb.local ? [mockDb.local] : []),
  putPedido: async (p) => { mockDb.guardados.push({ op: 'put', p }); },
  updatePedido: async (p) => { mockDb.guardados.push({ op: 'update', p }); },
}));
jest.mock('../productosAdminService', () => ({ credencialesAdminProductos: jest.fn() }));
jest.mock('../stockService', () => ({ aplicarStockPedido: jest.fn() }));
jest.mock('../../sync/syncService', () => ({ traerPedidoRemoto: jest.fn() }));
jest.mock('../sesion', () => ({
  getNombreUsuarioSesion: () => 'Carlos',
  getUsuarioSesion: jest.fn(),
}));

const mockSb = { llamadas: [], respuestas: [], rpc: [] };
jest.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: (nombre, args) => { mockSb.rpc.push({ nombre, args }); return Promise.resolve(mockSb.rpcRespuesta); },
    from: (table) => {
      const q = { table, op: 'select', eqs: [] };
      const api = {
        insert: () => { q.op = 'insert'; return api; },
        upsert: () => { q.op = 'upsert'; return api; },
        update: (row) => { q.op = 'update'; q.row = row; return api; },
        select: () => api,
        eq: (c, v) => { q.eqs.push([c, v]); return api; },
        limit: () => api,
        single: () => api,
        then: (res, rej) => { mockSb.llamadas.push(q); return Promise.resolve(mockSb.respuestas.shift() || { data: [], error: null }).then(res, rej); },
      };
      return api;
    },
  },
}));

import { editarPedidoOnlineFirst, guardarPedidoOnlineFirst, reasignarVendedorAdmin } from '../pedidoRepository';
import { credencialesAdminProductos } from '../productosAdminService';
import { getUsuarioSesion } from '../sesion';

const setOnline = (v) => Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => v });
const ORIGINAL = {
  id: 5, remoteId: 'R5', clientUuid: 'U5', clienteNombre: 'Kiosco', vendedor: 'Carlos', estado: 'pendiente', fecha: '2026-11-10',
  remoteUpdatedAt: '2026-11-10T10:00:00+00:00', synced: true,
  items: [{ productoId: 1, nombre: 'A', cantidad: 1, precio: 10 }], total: 10,
};
const CAMBIOS = { items: [{ productoId: 1, nombre: 'A', cantidad: 4, precio: 10 }], observaciones: 'x' };

beforeEach(() => {
  getUsuarioSesion.mockImplementation(() => ({ id: 2, nombre: 'Carlos', permiso: 2 }));
  mockDb.guardados = []; mockDb.local = ORIGINAL;
  mockSb.llamadas = []; mockSb.respuestas = [];
  setOnline(true);
});

describe('AC-EDP-3 editarPedidoOnlineFirst', () => {
  test('AC-EDP-3 online: update condicional por version sobre el mismo pedido (sin insert)', async () => {
    mockSb.respuestas = [{ data: [{ id: 'R5', updated_at: '2026-11-10T11:00:00+00:00' }], error: null }];
    const r = await editarPedidoOnlineFirst(ORIGINAL, CAMBIOS);
    expect(r.mode).toBe('online');
    const u = mockSb.llamadas[0];
    expect(u.op).toBe('update');
    expect(u.eqs).toEqual([['id', 'R5'], ['updated_at', ORIGINAL.remoteUpdatedAt]]);
    expect(mockSb.llamadas.some(c => c.op === 'insert' || c.op === 'upsert')).toBe(false);
    const final = mockDb.guardados.filter(g => g.op === 'put').pop().p;
    expect(final).toMatchObject({ id: 5, remoteId: 'R5', clientUuid: 'U5', synced: true, remoteUpdatedAt: '2026-11-10T11:00:00+00:00', baseRemoteUpdatedAt: null });
    expect(final.items[0].cantidad).toBe(4);
  });
  test('AC-EDP-3 si el servidor cambio (0 filas) no pisa: conflicto y revierte lo local', async () => {
    mockSb.respuestas = [{ data: [], error: null }];
    const r = await editarPedidoOnlineFirst(ORIGINAL, CAMBIOS);
    expect(r.mode).toBe('conflicto');
    expect(mockDb.guardados.filter(g => g.op === 'put').pop().p).toEqual(ORIGINAL);
  });
  test('AC-EDP-3 offline: queda pendiente con la version base y mismo UUID', async () => {
    setOnline(false);
    const r = await editarPedidoOnlineFirst(ORIGINAL, CAMBIOS);
    expect(r.mode).toBe('offline');
    expect(mockSb.llamadas).toHaveLength(0);
    expect(mockDb.guardados[0].p).toMatchObject({ clientUuid: 'U5', remoteId: 'R5', baseRemoteUpdatedAt: ORIGINAL.remoteUpdatedAt });
  });
  test('AC-EDP-1 un vendedor no edita pedidos ajenos', async () => {
    await expect(editarPedidoOnlineFirst({ ...ORIGINAL, vendedor: 'Otro' }, CAMBIOS)).rejects.toThrow();
    expect(mockSb.llamadas).toHaveLength(0);
  });
});

describe('T1-A-04 guardados sin versionBase explicito', () => {
  test('T1-A-04 online usa la version local conocida y si el servidor cambio lanza error (no pisa)', async () => {
    mockSb.respuestas = [{ data: [], error: null }];
    await expect(guardarPedidoOnlineFirst({ ...ORIGINAL, estado: 'facturado' })).rejects.toThrow(/cambió en otro dispositivo/);
    expect(mockSb.llamadas[0].eqs).toEqual([['id', 'R5'], ['updated_at', ORIGINAL.remoteUpdatedAt]]);
    expect(mockDb.guardados.filter(g => g.op === 'put').pop().p).toEqual(ORIGINAL);
  });
  test('T1-A-04 si el servidor no cambio guarda y actualiza la version', async () => {
    mockSb.respuestas = [{ data: [{ id: 'R5', updated_at: 'V2' }], error: null }];
    const r = await guardarPedidoOnlineFirst({ ...ORIGINAL, estado: 'facturado' });
    expect(r.mode).toBe('online');
    expect(mockDb.guardados.filter(g => g.op === 'put').pop().p.remoteUpdatedAt).toBe('V2');
  });
});

describe('T1-A-01 reasignarVendedorAdmin (RPC con PIN)', () => {
  const ADMIN = { id: 1, nombre: 'Jorge', permiso: 1 };
  beforeEach(() => {
    getUsuarioSesion.mockImplementation(() => ADMIN);
    credencialesAdminProductos.mockImplementation(() => Promise.resolve({ ok: true, cred: { p_admin_id: 'r1', p_admin_pin: '1234' } }));
    mockSb.rpc = [];
  });
  test('T1-A-01 llama a la RPC con el PIN y guarda la nueva version', async () => {
    mockSb.rpcRespuesta = { data: { ok: true, updated_at: 'V9' }, error: null };
    const r = await reasignarVendedorAdmin({ pin: '1234', pedido: ORIGINAL, vendedor: { id: 3, remoteId: 'r3', nombre: 'Lu', zona: 'Sur' } });
    expect(r.mode).toBe('online');
    expect(mockSb.rpc[0].nombre).toBe('admin_reasignar_vendedor_pedido');
    expect(mockSb.rpc[0].args).toMatchObject({ p_admin_pin: '1234', p_pedido_id: 'R5', p_vendedor: 'Lu', p_vendedor_id: 'r3', p_zona: 'Sur' });
    expect(mockDb.guardados.filter(g => g.op === 'put').pop().p).toMatchObject({ vendedor: 'Lu', remoteUpdatedAt: 'V9' });
    expect(mockSb.llamadas).toHaveLength(0);
  });
  test('T1-A-01 PIN incorrecto: error y no cambia nada', async () => {
    mockSb.rpcRespuesta = { data: { ok: false, motivo: 'no_autorizado' }, error: null };
    await expect(reasignarVendedorAdmin({ pin: 'x', pedido: ORIGINAL, vendedor: { id: 3, nombre: 'Lu' } })).rejects.toThrow(/PIN/);
    expect(mockDb.guardados).toHaveLength(0);
  });
  test('T1-A-01 sin la 024 (la RPC no existe) cae al update directo', async () => {
    mockSb.rpcRespuesta = { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.admin_reasignar_vendedor_pedido' } };
    mockSb.respuestas = [{ data: [{ id: 'R5', updated_at: 'V3' }], error: null }];
    const r = await reasignarVendedorAdmin({ pin: '1234', pedido: ORIGINAL, vendedor: { id: 3, nombre: 'Lu' } });
    expect(r.mode).toBe('online');
    expect(mockSb.llamadas[0].op).toBe('update');
  });
  test('T1-A-01 un vendedor no puede reasignar', async () => {
    getUsuarioSesion.mockImplementation(() => ({ id: 2, nombre: 'Carlos', permiso: 2 }));
    await expect(reasignarVendedorAdmin({ pin: '1', pedido: ORIGINAL, vendedor: { id: 3, nombre: 'Lu' } })).rejects.toThrow();
    expect(mockSb.rpc).toHaveLength(0);
  });
});
