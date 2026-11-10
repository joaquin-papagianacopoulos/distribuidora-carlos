// Correcciones de seguridad tanda 2: S-T2-01 (reintento solo ante columna inexistente) y
// S-T2-03 (los cobros de dos dispositivos se unen por id, no se pisan). AC-DMP-1.
const mockDb = { deudas: [] };
jest.mock('../../db', () => ({
  getDeudas: async () => JSON.parse(JSON.stringify(mockDb.deudas)),
  addDeuda: async (d) => { mockDb.deudas.push({ ...d, id: 500 + mockDb.deudas.length }); },
  updateDeuda: async (d) => { mockDb.deudas = mockDb.deudas.map(x => (x.id === d.id ? { ...d } : x)); },
  deleteDeuda: async (id) => { mockDb.deudas = mockDb.deudas.filter(x => x.id !== id); },
}));

const mockSb = { envios: [], errorEscritura: null, remota: null };
jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => {
      const lista = () => (mockSb.remota ? [mockSb.remota] : []);
      const lectura = {
        eq: () => lectura, gte: () => lectura, order: () => lectura,
        range: () => Promise.resolve({ data: lista(), error: null }),
        maybeSingle: () => Promise.resolve({ data: mockSb.remota, error: null }),
      };
      const escribir = (tipo) => (row) => ({
        eq: () => escribir(tipo)(row),
        select: () => ({
          single: () => {
            mockSb.envios.push({ tipo, row });
            if (mockSb.errorEscritura) return Promise.resolve({ data: null, error: mockSb.errorEscritura });
            mockSb.remota = { ...(mockSb.remota || {}), id: 77, cliente_id: 5, cliente_nombre: 'Ana', concepto: 'B', fecha: '2026-11-01', ...row };
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

const cobro = (id, cents, medio, at) => ({ id, montoCents: cents, medio, referencia: '', at, por: 'A' });
const base = { id: 1, clienteId: 5, clienteNombre: 'Ana', monto: 1000, concepto: 'B', fecha: '2026-11-01' };

beforeEach(() => {
  mockDb.deudas = [];
  mockSb.envios = [];
  mockSb.errorEscritura = null;
  mockSb.remota = null;
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { console.warn.mockRestore(); console.error.mockRestore(); });

describe('S-T2-01 el reintento sin columnas solo ante columna inexistente', () => {
  it('AC-DMP-1 un CHECK violado NO reintenta sin cobros, no marca la deuda como subida y avisa', async () => {
    mockDb.deudas = [{ ...base, montoPagado: 400, pagada: false, synced: false, medioPago: 'efectivo', cobros: [cobro('u-1', 40000, 'efectivo', 1)] }];
    mockSb.errorEscritura = { code: '23514', message: 'new row for relation "deudas" violates check constraint "deudas_cobros_formato" (cobros)' };
    await expect(syncDeudas()).rejects.toThrow(/No se pudieron subir 1 deuda/);
    expect(mockSb.envios).toHaveLength(1);
    expect(mockSb.envios[0].row).toHaveProperty('cobros');
    expect(mockDb.deudas[0].synced).toBe(false);
  });
});

describe('S-T2-03 dos dispositivos que cobran offline no se pisan', () => {
  it('AC-DMP-1 al subir, une los cobros ya subidos por el otro dispositivo y recalcula montoPagado', async () => {
    // Remoto: el dispositivo B ya subio un cobro de $300 en transferencia.
    mockSb.remota = { id: 77, cliente_id: 5, cliente_nombre: 'Ana', monto: 1000, monto_pagado: 300, pagada: false, concepto: 'B', fecha: '2026-11-01', cobros: [cobro('b-1', 30000, 'transferencia', 5)] };
    // Local (dispositivo A): cobro de $200 en efectivo sin subir, con la base que conocia.
    mockDb.deudas = [{ ...base, remoteId: 77, montoPagado: 200, pagada: false, synced: false, medioPago: 'efectivo', cobros: [cobro('a-1', 20000, 'efectivo', 9)] }];
    await syncDeudas();
    const row = mockSb.envios[0].row;
    expect(row.cobros.map(c => c.id).sort()).toEqual(['a-1', 'b-1']);
    expect(row.monto_pagado).toBe(500);
    expect(row.medio_pago).toBe('mixto');
    expect(mockDb.deudas[0]).toMatchObject({ montoPagado: 500, synced: true, medioPago: 'mixto' });
    expect(mockDb.deudas[0].cobros).toHaveLength(2);
  });

  it('AC-DMP-1 al bajar con un cobro local sin subir, une en vez de pisar y deja la union pendiente de subir', async () => {
    mockSb.remota = { id: 77, cliente_id: 5, cliente_nombre: 'Ana', monto: 1000, monto_pagado: 300, pagada: false, concepto: 'B', fecha: '2026-11-01', cobros: [cobro('b-1', 30000, 'transferencia', 5)] };
    mockDb.deudas = [{ ...base, remoteId: 77, montoPagado: 200, pagada: false, synced: false, updatedAt: 1, cobros: [cobro('a-1', 20000, 'efectivo', 9)] }];
    // bloquea la subida para aislar la bajada: la escritura falla y la bajada igual se aplica
    mockSb.errorEscritura = { code: '500', message: 'sin conexion' };
    await expect(syncDeudas()).rejects.toThrow();
    const d = mockDb.deudas[0];
    expect(d.cobros.map(c => c.id).sort()).toEqual(['a-1', 'b-1']);
    expect(d.montoPagado).toBe(500);
    expect(d.synced).toBe(false);
  });

  it('AC-DMP-1 es idempotente: unir dos veces lo mismo no duplica ni suma de mas', async () => {
    mockSb.remota = { id: 77, cliente_id: 5, cliente_nombre: 'Ana', monto: 1000, monto_pagado: 200, pagada: false, concepto: 'B', fecha: '2026-11-01', cobros: [cobro('a-1', 20000, 'efectivo', 9)] };
    mockDb.deudas = [{ ...base, remoteId: 77, montoPagado: 200, pagada: false, synced: false, cobros: [cobro('a-1', 20000, 'efectivo', 9)] }];
    await syncDeudas();
    await syncDeudas();
    expect(mockDb.deudas[0].cobros).toHaveLength(1);
    expect(mockDb.deudas[0].montoPagado).toBe(200);
  });

  it('AC-DMP-1 con deshacer (cobros vacios) no se resucitan los cobros remotos al subir', async () => {
    mockSb.remota = { id: 77, cliente_id: 5, cliente_nombre: 'Ana', monto: 1000, monto_pagado: 200, pagada: false, concepto: 'B', fecha: '2026-11-01', cobros: [cobro('a-1', 20000, 'efectivo', 9)] };
    mockDb.deudas = [{ ...base, remoteId: 77, montoPagado: 0, pagada: false, synced: false, cobros: [], medioPago: null }];
    await syncDeudas();
    expect(mockSb.envios[0].row.monto_pagado).toBe(0);
    expect(mockSb.envios[0].row.cobros).toEqual([]);
  });
});
