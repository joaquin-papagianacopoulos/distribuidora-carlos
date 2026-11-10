// REQ-SEG2 (AC-SEG2-5): los ajustes/iniciales que el servidor rechaza de anon quedan pendientes
// y suben con el PIN de admin por la RPC admin_registrar_ajustes_stock.
const mockDb = { movs: [], cleared: [] };
jest.mock('../../db', () => ({
  getMovimientosStock: async () => mockDb.movs.map(m => ({ ...m })),
  addMovimientosStock: async () => undefined, putMovimientosRemotos: async () => undefined,
  clearMovimientosPendingSync: async (ids) => { mockDb.cleared.push(...ids); },
  rekeyMovimientosRef: async () => 0, getIngresos: async () => [],
  putIngresosRemotos: async () => undefined, clearIngresosPendingSync: async () => undefined,
  addIngresoConMovimientos: async () => undefined, getProveedores: async () => [],
  putProveedoresRemotos: async () => undefined, clearProveedoresPendingSync: async () => undefined,
  getRendiciones: async () => [],
}));

const mockSb = { rpc: [], upserts: [], rpcRespuesta: null };
jest.mock('../../lib/supabase', () => {
  const builder = (table) => {
    const q = {
      // El trigger de la 023 rechaza ajuste/inicial de anon con 23514.
      upsert: (rows) => {
        if (table === 'movimientos_stock' && rows.some(r => r.tipo === 'ajuste' || r.tipo === 'inicial')) {
          return Promise.resolve({ error: { code: '23514', message: 'solo con el PIN de admin' } });
        }
        if (table === 'movimientos_stock') mockSb.upserts.push(...rows);
        return Promise.resolve({ error: null });
      },
      select: () => q, order: () => q, range: () => q, gt: () => q,
      then: (res, rej) => Promise.resolve({ data: [], error: null }).then(res, rej),
    };
    return q;
  };
  return {
    supabase: {
      from: (t) => builder(t),
      rpc: (fn, args) => { mockSb.rpc.push({ fn, args }); return Promise.resolve(mockSb.rpcRespuesta(args)); },
    },
  };
});

import { syncStock, subirAjustesConPin } from '../stockService';

const M = (id, tipo, extra = {}) => ({ id, productoId: 1, cantidad: 5, tipo, ref: tipo === 'venta' ? 'pedido:9' : 'ajuste:1', fecha: '2026-11-10T10:00:00.000Z', usuario: 'Ana', pendingSync: true, ...extra });
const CRED = { p_admin_id: '1', p_admin_pin: '1234' };

beforeEach(() => {
  mockDb.movs = [M('a1', 'ajuste'), M('i1', 'inicial'), M('v1', 'venta')];
  mockDb.cleared = []; mockSb.rpc = []; mockSb.upserts = [];
  mockSb.rpcRespuesta = (args) => ({ data: { ok: true, ids: args.p_movs.map(m => m.id) }, error: null });
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => console.warn.mockRestore());

describe('AC-SEG2-5 ajustes de stock con PIN', () => {
  test('AC-SEG2-5 syncStock: el ajuste rechazado por anon queda pendiente y la venta sí sube', async () => {
    await syncStock();
    expect(mockSb.upserts.map(r => r.id)).toEqual(['v1']);
    expect(mockDb.cleared).toEqual(['v1']);
  });
  test('AC-SEG2-5 subirAjustesConPin sube solo ajuste/inicial por la RPC y limpia los confirmados', async () => {
    const r = await subirAjustesConPin(CRED);
    expect(r).toMatchObject({ ok: true, subidos: 2 });
    expect(mockSb.rpc).toHaveLength(1);
    expect(mockSb.rpc[0].fn).toBe('admin_registrar_ajustes_stock');
    expect(mockSb.rpc[0].args).toMatchObject(CRED);
    expect(mockSb.rpc[0].args.p_movs.map(m => m.id)).toEqual(['a1', 'i1']);
    expect([...mockDb.cleared].sort()).toEqual(['a1', 'i1']);
  });
  test('AC-SEG2-5 solo se limpian los ids que el servidor confirma', async () => {
    mockSb.rpcRespuesta = () => ({ data: { ok: true, ids: ['a1'] }, error: null });
    const r = await subirAjustesConPin(CRED);
    expect(r).toMatchObject({ ok: true, subidos: 1, rechazados: 1 });
    expect(mockDb.cleared).toEqual(['a1']);
  });
  test('AC-SEG2-5 PIN incorrecto o sin la 023: no se limpia nada', async () => {
    mockSb.rpcRespuesta = () => ({ data: { ok: false, motivo: 'no_autorizado' }, error: null });
    expect(await subirAjustesConPin(CRED)).toMatchObject({ ok: false, motivo: 'no_autorizado' });
    mockSb.rpcRespuesta = () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
    expect(await subirAjustesConPin(CRED)).toMatchObject({ ok: false, faltaMigracion: true });
    expect(mockDb.cleared).toEqual([]);
  });
  test('AC-SEG2-5 sin ajustes pendientes no llama a la RPC', async () => {
    mockDb.movs = [M('v1', 'venta')];
    expect(await subirAjustesConPin(CRED)).toEqual({ ok: true, subidos: 0 });
    expect(mockSb.rpc).toHaveLength(0);
  });
});
