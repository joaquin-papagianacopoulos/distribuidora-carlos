// S-11 y S-12 (security-report 20261007-run1, iteracion 2):
// - S-12: un movimiento que la base rechaza por CHECK no frena el sync de los
//   demas (reintento fila por fila; la fila mala queda pendiente).
// - S-11: los movimientos con ref local "pedido-local:<id>" no se suben.
const mockDb = { movs: [], cleared: [] };
jest.mock('../../db', () => ({
  getMovimientosStock: async () => mockDb.movs.map(m => ({ ...m })),
  addMovimientosStock: async () => undefined, putMovimientosRemotos: async () => undefined,
  clearMovimientosPendingSync: async (ids) => { mockDb.cleared.push(...ids); },
  rekeyMovimientosRef: async () => 0, getIngresos: async () => [],
  putIngresosRemotos: async () => undefined, clearIngresosPendingSync: async () => undefined,
  addIngresoConMovimientos: async () => undefined, getProveedores: async () => [],
  putProveedoresRemotos: async () => undefined, clearProveedoresPendingSync: async () => undefined,
}));

// Supabase falso: rechaza (23514) cualquier lote que tenga |cantidad| > 1e6, igual que el CHECK de la 001.
const mockSb = { subidos: [], llamadasUpsert: 0 };
jest.mock('../../lib/supabase', () => {
  const builder = (table) => {
    const q = {
      upsert: (rows) => {
        mockSb.llamadasUpsert += 1;
        const malo = rows.some(r => table === 'movimientos_stock' && Math.abs(r.cantidad) > 1_000_000);
        if (malo) return Promise.resolve({ error: { code: '23514', message: 'violates check constraint' } });
        if (table === 'movimientos_stock') mockSb.subidos.push(...rows);
        return Promise.resolve({ error: null });
      },
      select: () => q, order: () => q, range: () => q, gt: () => q,
      then: (res, rej) => Promise.resolve({ data: [], error: null }).then(res, rej),
    };
    return q;
  };
  return { supabase: { from: (t) => builder(t) } };
});

// eslint-disable-next-line import/first
import { syncStock } from '../stockService';
// eslint-disable-next-line import/first
import { MAX_CANTIDAD, movimientoAjuste, validarIngreso } from '../../domain/stock';
// eslint-disable-next-line import/first
import { MAX_IMPORTE, validarProducto } from '../../domain/productos';
// eslint-disable-next-line import/first
import { readFileSync } from 'fs';
// eslint-disable-next-line import/first
import path from 'path';

const mov = (id, cantidad, ref = `pedido:${id}`) => ({
  id, productoId: 'p1', cantidad, tipo: cantidad < 0 ? 'venta' : 'ingreso', ref, fecha: '2026-10-07T00:00:00.000Z', pendingSync: true,
});

beforeEach(() => {
  mockDb.movs = []; mockDb.cleared = [];
  mockSb.subidos = []; mockSb.llamadasUpsert = 0;
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { console.warn.mockRestore(); });

describe('S-12 sync del ledger tolerante a filas invalidas', () => {
  test('S-12 una fila rechazada por CHECK no bloquea las demas y queda pendiente', async () => {
    mockDb.movs = [mov('a', -1), mov('malo', -2_000_000), mov('b', -3)];
    const r = await syncStock();
    expect(r.ok).toBe(true);
    expect(mockSb.subidos.map(x => x.id).sort()).toEqual(['a', 'b']);
    expect(mockDb.cleared.sort()).toEqual(['a', 'b']);
    expect(mockDb.cleared).not.toContain('malo');
  });

  test('S-11 movimientos con ref pedido-local:* no se suben (quedan pendientes hasta el re-key)', async () => {
    mockDb.movs = [mov('l1', -1, 'pedido-local:5'), mov('r1', -1, 'pedido:77')];
    await syncStock();
    expect(mockSb.subidos.map(x => x.id)).toEqual(['r1']);
    expect(mockDb.cleared).toEqual(['r1']);
  });
});

describe('S-12 topes del dominio alineados con las restricciones de Supabase', () => {
  const sql = readFileSync(path.resolve(__dirname, '..', '..', '..', 'supabase', 'migrations', '001_altas_y_stock.sql'), 'utf8');

  test('S-12 MAX_CANTIDAD coincide con el CHECK de movimientos_stock', () => {
    const m = sql.match(/abs\(cantidad\)\s*<=\s*(\d+)/i);
    expect(m).not.toBeNull();
    expect(MAX_CANTIDAD).toBe(Number(m[1]));
  });

  test('S-12 MAX_IMPORTE entra en numeric(14,2)', () => {
    expect(sql).toMatch(/costo_final\s+numeric\(14,2\)/i);
    expect(MAX_IMPORTE).toBeLessThanOrEqual(999_999_999_999.99);
  });

  test('S-12 movimientoAjuste rechaza stock > MAX_CANTIDAD y deltas > MAX_CANTIDAD', () => {
    expect(() => movimientoAjuste('p', 0, MAX_CANTIDAD + 1, { genId: () => 'x' })).toThrow();
    expect(() => movimientoAjuste('p', -500_000, 600_000, { genId: () => 'x' })).toThrow();
    expect(movimientoAjuste('p', 0, MAX_CANTIDAD, { genId: () => 'x' }).cantidad).toBe(MAX_CANTIDAD);
  });

  test('S-12 validarIngreso acepta hasta MAX_CANTIDAD y rechaza mas', () => {
    const ctx = { productos: [{ id: 'p1', nombre: 'P' }], proveedores: [{ id: 'pv', descripcion: 'Prov' }], genId: () => 'x' };
    expect(validarIngreso({ facturaProveedor: 'F', proveedorId: 'pv', items: [{ productoId: 'p1', ingreso: MAX_CANTIDAD }] }, ctx).ok).toBe(true);
    expect(validarIngreso({ facturaProveedor: 'F', proveedorId: 'pv', items: [{ productoId: 'p1', ingreso: MAX_CANTIDAD + 1 }] }, ctx).ok).toBe(false);
  });

  test('S-12 validarProducto rechaza importes y enteros fuera de rango de la base', () => {
    const base = { codigo: 'P1', nombre: 'Prod' };
    expect(validarProducto({ ...base, costoFinal: MAX_IMPORTE }).errores.costoFinal).toBeUndefined();
    expect(validarProducto({ ...base, costoFinal: MAX_IMPORTE + 1 }).errores.costoFinal).toBeTruthy();
    expect(validarProducto({ ...base, precio: MAX_IMPORTE + 1 }).errores.precio).toBeTruthy();
    expect(validarProducto({ ...base, precioVenta2: MAX_IMPORTE + 1 }).errores.precioVenta2).toBeTruthy();
    expect(validarProducto({ ...base, costoFinal: 900_000_000_000, ganancia: 500 }).errores.precio).toBeTruthy();
    expect(validarProducto({ ...base, bultoX: 1_000_001 }).errores.bultoX).toBeTruthy();
    expect(validarProducto({ ...base, minimoVenta: 2 ** 31 }).errores.minimoVenta).toBeTruthy();
    expect(validarProducto({ ...base, stock: MAX_CANTIDAD + 1 }).errores.stock).toBeTruthy();
  });
});
