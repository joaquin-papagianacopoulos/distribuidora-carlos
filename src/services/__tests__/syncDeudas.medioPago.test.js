// AC-DMP-1: syncDeudas sube medio_pago/referencia_pago/cobros y no falla si la migracion 025 no esta.
const mockDb = { deudas: [] };
jest.mock('../../db', () => ({
  getDeudas: async () => JSON.parse(JSON.stringify(mockDb.deudas)),
  addDeuda: async (d) => { mockDb.deudas.push({ ...d, id: 500 + mockDb.deudas.length }); },
  updateDeuda: async (d) => { mockDb.deudas = mockDb.deudas.map(x => (x.id === d.id ? { ...d } : x)); },
  deleteDeuda: async (id) => { mockDb.deudas = mockDb.deudas.filter(x => x.id !== id); },
}));

const mockSb = { envios: [], faltaColumna: false, remotas: [] };
jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => {
      const lectura = { eq: () => lectura, gte: () => lectura, order: () => lectura, range: () => Promise.resolve({ data: mockSb.remotas, error: null }) };
      const escribir = (tipo) => (row) => ({
        eq: () => escribir(tipo)(row),
        select: () => ({
          single: () => {
            mockSb.envios.push({ tipo, row });
            if (mockSb.faltaColumna && ('medio_pago' in row || 'cobros' in row)) {
              return Promise.resolve({ data: null, error: { code: 'PGRST204', message: "Could not find the 'medio_pago' column of 'deudas' in the schema cache" } });
            }
            mockSb.remotas = [{ id: 77, cliente_id: 5, cliente_nombre: 'Ana', monto: 1000, monto_pagado: 400, concepto: 'Boleta', fecha: '2026-11-01', pagada: false }];
            return Promise.resolve({ data: { id: 77 }, error: null });
          },
        }),
      });
      return { select: () => lectura, insert: escribir('insert'), update: escribir('update') };
    },
  },
}));
jest.mock('../imageSearch', () => ({ isImageSearchConfigured: () => false, fetchProductImage: jest.fn(), ImageSearchQuotaError: class extends Error {} }));

import { syncDeudas } from '../../sync/syncService';

const deudaConCobro = () => ({
  id: 1, clienteId: 5, clienteNombre: 'Ana', monto: 1000, montoPagado: 400, concepto: 'Boleta', fecha: '2026-11-01', pagada: false,
  synced: false, medioPago: 'efectivo', referenciaPago: 'r1',
  cobros: [{ id: 'u-1', montoCents: 40000, medio: 'efectivo', referencia: 'r1', at: 1, por: 'A' }],
});

beforeEach(() => {
  mockDb.deudas = [deudaConCobro()];
  mockSb.envios = [];
  mockSb.faltaColumna = false;
  mockSb.remotas = [];
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => console.warn.mockRestore());

describe('AC-DMP-1 syncDeudas con medio de pago', () => {
  it('AC-DMP-1 sube medio, referencia y cobros y limpia la marca de pendiente', async () => {
    await syncDeudas();
    expect(mockSb.envios).toHaveLength(1);
    expect(mockSb.envios[0].row).toMatchObject({ medio_pago: 'efectivo', referencia_pago: 'r1' });
    expect(mockSb.envios[0].row.cobros[0]).toMatchObject({ id: 'u-1', montoCents: 40000, medio: 'efectivo' });
    expect(mockDb.deudas[0]).toMatchObject({ synced: true, remoteId: 77 });
  });
  it('AC-DMP-1 sin la columna (migracion 025 sin aplicar) reintenta sin ellas y no falla', async () => {
    mockSb.faltaColumna = true;
    await expect(syncDeudas()).resolves.toEqual({ ok: true });
    expect(mockSb.envios).toHaveLength(2);
    expect(mockSb.envios[1].row).not.toHaveProperty('medio_pago');
    expect(mockSb.envios[1].row).not.toHaveProperty('cobros');
    expect(mockSb.envios[1].row.monto_pagado).toBe(400);
    // el detalle del cobro queda en este dispositivo
    expect(mockDb.deudas[0]).toMatchObject({ synced: true, medioPago: 'efectivo' });
    expect(mockDb.deudas[0].cobros).toHaveLength(1);
  });
  it('AC-DMP-1 al bajar, una fila remota sin las columnas conserva lo local', async () => {
    mockDb.deudas = [{ ...deudaConCobro(), synced: true, remoteId: 9, updatedAt: 0 }];
    mockSb.remotas = [{ id: 9, cliente_id: 5, cliente_nombre: 'Ana', monto: 1000, monto_pagado: 400, concepto: 'Boleta', fecha: '2026-11-01', pagada: false }];
    await syncDeudas();
    expect(mockDb.deudas[0]).toMatchObject({ medioPago: 'efectivo', referenciaPago: 'r1' });
    expect(mockDb.deudas[0].cobros).toHaveLength(1);
  });
  it('AC-DMP-1 una deuda vieja sin medio sube igual (sin esas claves)', async () => {
    mockDb.deudas = [{ id: 1, clienteId: 5, clienteNombre: 'Ana', monto: 100, montoPagado: 0, fecha: '2026-11-01', pagada: false, synced: false }];
    await syncDeudas();
    expect(mockSb.envios[0].row).not.toHaveProperty('medio_pago');
    expect(mockSb.envios[0].row).not.toHaveProperty('cobros');
  });
});
