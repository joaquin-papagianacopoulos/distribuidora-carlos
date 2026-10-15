// REQ-FAB (AC-FAB-1, 3): servicio de tipos de factura (RPC con PIN) y reporte.
const mockLocal = { pedidos: [] };
jest.mock('../../db', () => ({ getPedidos: jest.fn(), patchRegistros: jest.fn() }));
const mockRpc = jest.fn();
jest.mock('../../lib/supabase', () => ({ supabase: { rpc: (...a) => mockRpc(...a) } }));
jest.mock('../stockService', () => ({ aplicarStockPedido: jest.fn() }));

import * as db from '../../db';
import { aplicarStockPedido } from '../stockService';
import {
  guardarTiposFacturaLocal, subirTiposFactura, consultarFacturasAEmitir, aplicarTiposRemotos, sondearMigracion011,
  contarTiposFacturaPendientes,
} from '../facturacionService';

const CRED = { p_admin_id: '1', p_admin_pin: '1234' };
const P = (id, extra = {}) => ({ id, remoteId: `R${id}`, estado: 'facturado', items: [{ productoId: 1, cantidad: 2 }], total: 10, ...extra });

beforeEach(() => {
  // CRA tiene resetMocks: las implementaciones se vuelven a poner en cada test.
  db.getPedidos.mockImplementation(async () => mockLocal.pedidos.map(p => ({ ...p })));
  db.patchRegistros.mockImplementation(async (store, ids, patch) => {
    const set = new Set(ids || []);
    mockLocal.pedidos = mockLocal.pedidos.map(r => (set.has(r.id) ? { ...r, ...patch } : r));
  });
  mockLocal.pedidos = [P(1), P(2), P(3, { remoteId: undefined })];
  mockRpc.mockReset();
});

describe('AC-FAB-1 guardarTiposFacturaLocal', () => {
  it('AC-FAB-1 marca local pendiente sin tocar items, estado, synced ni stock', async () => {
    const r = await guardarTiposFacturaLocal([1, 2], 'A', 500);
    expect(r).toEqual({ ok: true, count: 2 });
    expect(mockLocal.pedidos[0]).toMatchObject({ tipoFactura: 'A', tipoFacturaAt: 500, tipoFacturaPendiente: true, estado: 'facturado', total: 10 });
    expect(mockLocal.pedidos[0].items).toEqual([{ productoId: 1, cantidad: 2 }]);
    expect(mockLocal.pedidos[0]).not.toHaveProperty('synced');
    expect(aplicarStockPedido).not.toHaveBeenCalled();
    expect(await contarTiposFacturaPendientes()).toBe(2);
  });
  it('AC-FAB-1 tipo invalido o sin ids no escribe', async () => {
    expect((await guardarTiposFacturaLocal([1], 'Z')).ok).toBe(false);
    expect((await guardarTiposFacturaLocal([], 'A')).ok).toBe(false);
    expect(db.patchRegistros).not.toHaveBeenCalled();
  });
});

describe('AC-FAB-3 subirTiposFactura', () => {
  beforeEach(async () => {
    await guardarTiposFacturaLocal([1, 2, 3], 'B', 700);
  });

  it('AC-FAB-3 sube solo los que tienen remoteId y limpia SOLO los confirmados', async () => {
    mockRpc.mockResolvedValueOnce({ data: { ok: true, guardados: ['R1'], rechazados: [{ id: 'R2', motivo: 'pedido_inexistente' }] }, error: null });
    const r = await subirTiposFactura(CRED);
    expect(mockRpc).toHaveBeenCalledTimes(1);
    const [nombre, args] = mockRpc.mock.calls[0];
    expect(nombre).toBe('admin_guardar_tipos_factura');
    expect(args.p_filas.map(f => f.pedido_id)).toEqual(['R1', 'R2']);
    expect(args).toMatchObject({ p_admin_id: '1', p_admin_pin: '1234' });
    expect(r).toMatchObject({ ok: true, subidos: 1 });
    expect(r.rechazados).toEqual([{ id: 'R2', motivo: 'pedido_inexistente' }]);
    const por = (id) => mockLocal.pedidos.find(p => p.id === id);
    expect(por(1).tipoFacturaPendiente).toBe(false);
    expect(por(2).tipoFacturaPendiente).toBe(true);
    expect(por(3).tipoFacturaPendiente).toBe(true);
    expect(r.pendientes).toBe(1);
  });

  it('AC-FAB-3 si se re-marca mientras sube, no se limpia esa marca', async () => {
    mockRpc.mockImplementationOnce(async () => {
      await guardarTiposFacturaLocal([1], 'A', 900);
      return { data: { ok: true, guardados: ['R1', 'R2'], rechazados: [] }, error: null };
    });
    await subirTiposFactura(CRED);
    expect(mockLocal.pedidos.find(p => p.id === 1)).toMatchObject({ tipoFactura: 'A', tipoFacturaPendiente: true });
    expect(mockLocal.pedidos.find(p => p.id === 2).tipoFacturaPendiente).toBe(false);
  });

  it('AC-FAB-3 PIN incorrecto: no limpia nada y devuelve el motivo', async () => {
    mockRpc.mockResolvedValueOnce({ data: { ok: false, motivo: 'no_autorizado' }, error: null });
    const r = await subirTiposFactura(CRED);
    expect(r).toMatchObject({ ok: false, motivo: 'pin_incorrecto' });
    expect(mockLocal.pedidos.filter(p => p.tipoFacturaPendiente)).toHaveLength(3);
  });

  it('AC-FAB-3 falta la migracion 011: avisa y deja todo pendiente', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
    const r = await subirTiposFactura(CRED);
    expect(r).toMatchObject({ ok: false, faltaMigracion: true });
    expect(mockLocal.pedidos.filter(p => p.tipoFacturaPendiente)).toHaveLength(3);
  });

  it('AC-FAB-3 sin credenciales no llama a Supabase', async () => {
    const r = await subirTiposFactura(null);
    expect(r.skipped).toBe(true);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('AC-FAB-3 no loguea el PIN', async () => {
    const espiar = ['log', 'warn', 'error'].map(k => jest.spyOn(console, k).mockImplementation(() => {}));
    mockRpc.mockResolvedValueOnce({ data: { ok: true, guardados: [], rechazados: [] }, error: null });
    await subirTiposFactura(CRED);
    for (const s of espiar) { expect(JSON.stringify(s.mock.calls)).not.toContain('1234'); s.mockRestore(); }
  });
});

describe('AC-FAB-3 consultarFacturasAEmitir', () => {
  it('AC-FAB-3 llama a la RPC con PIN y rango, y mapea filas', async () => {
    mockRpc.mockResolvedValueOnce({ data: { ok: true, filas: [{ pedido_id: 'R1', fecha: '2026-10-01', cliente_nombre: 'Kiosco', cuit: '20123456786', tipo_iva: 'Monotributo', tipo_factura: null, total: 50 }] }, error: null });
    const r = await consultarFacturasAEmitir(CRED, '2026-10-01', '2026-10-31');
    expect(mockRpc).toHaveBeenCalledWith('admin_facturas_a_emitir', { p_admin_id: '1', p_admin_pin: '1234', p_desde: '2026-10-01', p_hasta: '2026-10-31' });
    expect(r.ok).toBe(true);
    expect(r.filas[0]).toMatchObject({ pedidoId: 'R1', clienteNombre: 'Kiosco', tipoFactura: null, total: 50 });
  });
  it('AC-FAB-3 rango o credencial invalidos no llaman a Supabase', async () => {
    expect((await consultarFacturasAEmitir(CRED, '2026-10-31', '2026-10-01')).motivo).toBe('rango_invalido');
    expect((await consultarFacturasAEmitir(null, '2026-10-01', '2026-10-31')).motivo).toBe('pin_requerido');
    expect(mockRpc).not.toHaveBeenCalled();
  });
  it('AC-FAB-3 PIN incorrecto', async () => {
    mockRpc.mockResolvedValueOnce({ data: { ok: false, motivo: 'no_autorizado' }, error: null });
    expect((await consultarFacturasAEmitir(CRED, '2026-10-01', '2026-10-31')).motivo).toBe('pin_incorrecto');
  });
});

describe('AC-FAB-1 aplicarTiposRemotos', () => {
  it('AC-FAB-1 aplica lo de otro dispositivo pero no pisa lo pendiente local', async () => {
    await guardarTiposFacturaLocal([2], 'B', 5);
    const r = await aplicarTiposRemotos([
      { pedidoId: 'R1', tipoFactura: 'A' }, { pedidoId: 'R2', tipoFactura: 'A' }, { pedidoId: 'R3', tipoFactura: 'B' }, { pedidoId: 'R1', tipoFactura: null },
    ].slice(0, 3));
    expect(r.count).toBe(1);
    expect(mockLocal.pedidos.find(p => p.id === 1)).toMatchObject({ tipoFactura: 'A', tipoFacturaPendiente: false });
    expect(mockLocal.pedidos.find(p => p.id === 2)).toMatchObject({ tipoFactura: 'B', tipoFacturaPendiente: true });
  });
});

describe('AC-FAB-1 sondearMigracion011', () => {
  it('AC-FAB-1 funcion inexistente => falta; no_autorizado => esta', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202' } });
    expect(await sondearMigracion011()).toEqual({ faltaMigracion: true });
    mockRpc.mockResolvedValueOnce({ data: { ok: false, motivo: 'no_autorizado' }, error: null });
    expect(await sondearMigracion011()).toEqual({ faltaMigracion: false });
    mockRpc.mockRejectedValueOnce(new Error('red'));
    expect(await sondearMigracion011()).toEqual({ faltaMigracion: false });
  });
});
