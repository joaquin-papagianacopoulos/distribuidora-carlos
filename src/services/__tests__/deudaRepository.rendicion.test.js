// REQ-REN (AC-REN-3 / AC-REN-4): efectos de la rendición sobre la tabla legacy de deudas.
const mockDb = { deudas: [], nextId: 100 };
const mockSb = { deletes: [] };

jest.mock('../../db', () => ({
  getDeudas: async () => JSON.parse(JSON.stringify(mockDb.deudas)),
  addDeuda: async (d) => { const id = mockDb.nextId++; mockDb.deudas.push({ ...d, id }); return id; },
  updateDeuda: async (d) => { mockDb.deudas = mockDb.deudas.map(x => (x.id === d.id ? { ...d } : x)); },
  deleteDeuda: async (id) => { mockDb.deudas = mockDb.deudas.filter(x => x.id !== id); },
}));
jest.mock('../../sync/syncService', () => ({ syncDeudas: jest.fn(async () => { throw new Error('sin red'); }) }));
jest.mock('../../lib/supabase', () => ({
  supabase: { from: () => ({ delete: () => ({ eq: (_c, v) => { mockSb.deletes.push(v); return Promise.resolve({ error: null }); } }) }) },
}));

import {
  aplicarCobrosRendicion, crearDeudaRendicion, anularDeudaRendicion, ajustarDeudaRendicion, clienteIdLocal,
} from '../deudaRepository';

beforeEach(() => {
  mockDb.deudas = [
    { id: 1, clienteId: 5, monto: 100, montoPagado: 20, concepto: 'Boleta' },
    { id: 2, clienteId: 5, monto: 50, montoPagado: 0, concepto: 'Boleta', remoteId: 'r2' },
  ];
  mockSb.deletes = [];
  jest.spyOn(console, 'error').mockImplementation(() => {});
  Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
});
afterEach(() => console.error.mockRestore());

describe('AC-REN-3 cobros y deudas de una rendición', () => {
  it('AC-REN-3 cobra de cada deuda lo planificado (tope: su saldo) y marca "Rendición #id"; un sync fallido no rompe', async () => {
    const n = await aplicarCobrosRendicion([{ deudaId: 1, montoCents: 9000 }, { deudaId: 2, montoCents: 1000 }, { deudaId: 99, montoCents: 1 }], 'Rendición #abcd1234');
    expect(n).toBe(2);
    expect(mockDb.deudas[0]).toMatchObject({ montoPagado: 100, pagada: true, pagadaPor: 'Rendición #abcd1234', synced: false });
    expect(mockDb.deudas[1]).toMatchObject({ montoPagado: 10, pagada: false });
    expect(await aplicarCobrosRendicion(undefined)).toBe(0);
  });

  it('AC-REN-3 deuda de cargo nueva, sin duplicar por concepto', async () => {
    expect(await crearDeudaRendicion({ clienteId: '5', clienteNombre: 'Kiosco', montoCents: 2500, concepto: 'Cambio rendición #abcd1234', fecha: '2026-10-15' })).toBe(true);
    expect(mockDb.deudas[2]).toMatchObject({ clienteId: 5, monto: 25, montoPagado: 0, concepto: 'Cambio rendición #abcd1234', pagada: false, pedidoId: null });
    expect(await crearDeudaRendicion({ clienteId: 5, montoCents: 2500, concepto: 'Cambio rendición #abcd1234' })).toBe(false);
    expect(await crearDeudaRendicion({ clienteId: 5, montoCents: 0, concepto: 'x' })).toBe(false);
    expect(clienteIdLocal('abc')).toBe('abc');
  });
});

describe('AC-REN-4 reversión del cargo de un cambio', () => {
  it('AC-REN-4 anula solo deudas sin cobros (con remoteId online: borra en Supabase como quitarDeudaDePedido)', async () => {
    expect(await anularDeudaRendicion(1)).toBe(false);
    expect(await anularDeudaRendicion(2)).toBe(true);
    expect(mockSb.deletes).toEqual(['r2']);
    expect(mockDb.deudas.map(d => d.id)).toEqual([1]);
    mockDb.deudas.push({ id: 3, clienteId: 5, monto: 10, montoPagado: 0 }, { id: 4, clienteId: 5, monto: 10, montoPagado: 0, remoteId: 'r4' });
    expect(await anularDeudaRendicion(3)).toBe(true);
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
    expect(await anularDeudaRendicion(4)).toBe(true);
    expect(mockDb.deudas.find(d => d.id === 4)).toMatchObject({ monto: 0, pagada: true, concepto: 'Anulada' });
    expect(await anularDeudaRendicion(999)).toBe(false);
  });

  it('AC-REN-4 ajusta el monto de una deuda a lo ya cobrado', async () => {
    expect(await ajustarDeudaRendicion(1, 2000)).toBe(true);
    expect(mockDb.deudas[0]).toMatchObject({ monto: 20, pagada: true });
    expect(await ajustarDeudaRendicion(999, 1)).toBe(false);
  });
});
