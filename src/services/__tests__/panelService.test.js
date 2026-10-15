// REQ-PAN (AC-PAN-1): bajada de costos de venta con PIN (IndexedDB y Supabase falsos).
const mockDb = { costos: [] };
const mockSb = { rpc: [], respuestas: [] };
jest.mock('../../db', () => ({
  putCostosVentaBatch: async (rows) => { rows.forEach(r => mockDb.costos.push(r)); },
  getCostosVenta: async () => mockDb.costos,
  getPedidos: async () => [{ id: 1 }],
  getProductos: async () => { throw new Error('store roto'); },
  getRendiciones: async () => [],
}));
jest.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: (fn, args) => {
      mockSb.rpc.push({ fn, args: JSON.parse(JSON.stringify(args)) });
      return Promise.resolve(mockSb.respuestas.shift() || { data: { ok: true, costos: [] }, error: null });
    },
  },
}));
const { bajarCostosVenta, sondearMigracion015, cargarDatosPanel } = require('../panelService');

const fila = (id, ts) => ({ pedido_id: id, costos: { 1: 10 }, capturado_at: ts, synced_at: ts });
const cred = { p_admin_id: '7', p_admin_pin: '1234' };

beforeEach(() => { mockDb.costos = []; mockSb.rpc = []; mockSb.respuestas = []; localStorage.clear(); });

describe('AC-PAN-1 bajarCostosVenta', () => {
  it('AC-PAN-1 sin PIN => pin_requerido y no llama al servidor', async () => {
    expect((await bajarCostosVenta(null)).motivo).toBe('pin_requerido');
    expect((await bajarCostosVenta({ p_admin_id: '7', p_admin_pin: '' })).motivo).toBe('pin_requerido');
    expect(mockSb.rpc).toHaveLength(0);
  });
  it('AC-PAN-1 PIN incorrecto => pin_incorrecto; migración faltante => falta_migracion', async () => {
    mockSb.respuestas.push({ data: { ok: false, motivo: 'no_autorizado' }, error: null });
    expect((await bajarCostosVenta(cred)).motivo).toBe('pin_incorrecto');
    mockSb.respuestas.push({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
    const r = await bajarCostosVenta(cred);
    expect(r.motivo).toBe('falta_migracion');
    expect(r.mensaje).toMatch(/015/);
  });
  it('AC-PAN-1 pagina con cursor, guarda las filas y el cursor; no guarda ni expone el PIN', async () => {
    const pagina1 = Array.from({ length: 1000 }, (_, i) => fila(`p${String(i).padStart(4, '0')}`, '2026-10-15T10:00:00.000Z'));
    mockSb.respuestas.push({ data: { ok: true, costos: pagina1 }, error: null });
    mockSb.respuestas.push({ data: { ok: true, costos: [fila('p9999', '2026-10-15T11:00:00.000Z')] }, error: null });
    const r = await bajarCostosVenta(cred);
    expect(r).toEqual({ ok: true, bajados: 1001 });
    expect(mockSb.rpc).toHaveLength(2);
    expect(mockSb.rpc[1].args.p_cursor.costos).toEqual({ ts: '2026-10-15T10:00:00.000Z', id: 'p0999' });
    expect(mockDb.costos).toHaveLength(1001);
    expect(mockDb.costos[0]).toEqual({ pedidoId: 'p0000', costos: { 1: 10 }, capturadoAt: '2026-10-15T10:00:00.000Z' });
    expect(JSON.parse(localStorage.getItem('panelCostosCursor')).costos).toEqual({ ts: '2026-10-15T11:00:00.000Z', id: 'p9999' });
    expect(JSON.stringify(localStorage)).not.toContain('1234');
  });
  it('AC-PAN-1 la próxima bajada arranca con solape de 5 min y "completo" arranca de cero', async () => {
    localStorage.setItem('panelCostosCursor', JSON.stringify({ costos: { ts: '2026-10-15T11:00:00.000Z', id: 'p9' } }));
    await bajarCostosVenta(cred);
    expect(mockSb.rpc[0].args.p_cursor.costos).toEqual({ ts: '2026-10-15T10:55:00.000Z', id: '' });
    await bajarCostosVenta(cred, { completo: true });
    expect(mockSb.rpc[1].args.p_cursor).toEqual({});
  });
  it('AC-PAN-1 sondearMigracion015 detecta la función inexistente', async () => {
    mockSb.respuestas.push({ data: null, error: { code: '42883', message: 'function does not exist' } });
    expect(await sondearMigracion015()).toEqual({ faltaMigracion: true });
    mockSb.respuestas.push({ data: { ok: false, motivo: 'no_autorizado' }, error: null });
    expect(await sondearMigracion015()).toEqual({ faltaMigracion: false });
  });
  it('AC-PAN-1 cargarDatosPanel no tira si un store falla y arma el Map de costos', async () => {
    mockDb.costos = [{ pedidoId: 10, costos: {} }];
    const d = await cargarDatosPanel();
    expect(d.productos).toEqual([]);
    expect(d.pedidos).toHaveLength(1);
    expect(d.costosVenta.get('10')).toBeTruthy();
  });
});
