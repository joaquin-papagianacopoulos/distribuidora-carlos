// REQ-RED (AC-RED-2) y REQ-DMP (AC-DMP-1): deuda = lo que se cobra y cobros con medio de pago.
const mockDb = { deudas: [], nextId: 100 };

jest.mock('../../db', () => ({
  getDeudas: async () => JSON.parse(JSON.stringify(mockDb.deudas)),
  addDeuda: async (d) => { const id = mockDb.nextId++; mockDb.deudas.push({ ...d, id }); return id; },
  updateDeuda: async (d) => { mockDb.deudas = mockDb.deudas.map(x => (x.id === d.id ? { ...d } : x)); },
  deleteDeuda: async (id) => { mockDb.deudas = mockDb.deudas.filter(x => x.id !== id); },
}));
jest.mock('../../sync/syncService', () => ({ syncDeudas: jest.fn(async () => undefined) }));

import {
  registrarDeudaFacturado, actualizarMontoDeudaDePedido, cobrarDeuda, cobrarTodoDelCliente, deshacerCobros, aplicarCobrosRendicion,
} from '../deudaRepository';

beforeEach(() => {
  mockDb.deudas = [];
  mockDb.nextId = 100;
  Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
});

describe('AC-RED-2 deuda = total a cobrar', () => {
  it('AC-RED-2 la deuda nueva usa el total redondeado congelado del pedido', async () => {
    const p = { id: 1, remoteId: 'r1', clienteId: 5, clienteNombre: 'Ana', fecha: '2026-11-01', total: 1260, estado: 'facturado', redondeoMultiplo: 500 };
    expect(await registrarDeudaFacturado(p, null)).toBe(true);
    expect(mockDb.deudas[0].monto).toBe(1500);
  });
  it('AC-RED-2 un pedido facturado antes del redondeo (sin la clave) mantiene su total', async () => {
    await registrarDeudaFacturado({ id: 2, clienteId: 5, fecha: '2026-11-01', total: 1260, estado: 'facturado' }, null);
    expect(mockDb.deudas[0].monto).toBe(1260);
  });
  it('AC-RED-2 editar un facturado ajusta la deuda con lo que se cobra y respeta lo ya cobrado', async () => {
    mockDb.deudas = [{ id: 1, pedidoLocalId: 3, clienteId: 5, monto: 1500, montoPagado: 1000, pagada: false }];
    const cambio = await actualizarMontoDeudaDePedido({ id: 3 }, 1000);
    expect(cambio).toBe(true);
    expect(mockDb.deudas[0]).toMatchObject({ monto: 1000, pagada: true });
  });
});

describe('AC-DMP-1 cobros con medio de pago', () => {
  const deuda = (o = {}) => ({ id: 1, clienteId: 5, fecha: '2026-11-01', monto: 1000, montoPagado: 0, pagada: false, ...o });

  it('AC-DMP-1 un cobro parcial queda en el historial con UUID, medio y referencia', async () => {
    mockDb.deudas = [deuda()];
    const r = await cobrarDeuda(mockDb.deudas[0], 400, 'Admin', { medio: 'transferencia', referencia: 'Op 9' });
    expect(r).toMatchObject({ montoPagado: 400, pagada: false, medioPago: 'transferencia', referenciaPago: 'Op 9', synced: false });
    expect(r.cobros).toHaveLength(1);
    expect(r.cobros[0]).toMatchObject({ medio: 'transferencia', montoCents: 40000, referencia: 'Op 9', por: 'Admin' });
    expect(r.cobros[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(mockDb.deudas[0].cobros).toHaveLength(1);
  });
  it('AC-DMP-1 dos medios => mixto', async () => {
    mockDb.deudas = [deuda()];
    const a = await cobrarDeuda(mockDb.deudas[0], 400, 'A', { medio: 'efectivo' });
    const b = await cobrarDeuda(a, null, 'A', { medio: 'transferencia' });
    expect(b).toMatchObject({ montoPagado: 1000, pagada: true, medioPago: 'mixto' });
  });
  it('AC-DMP-1 un medio invalido no cobra nada', async () => {
    mockDb.deudas = [deuda()];
    await expect(cobrarDeuda(mockDb.deudas[0], null, 'A', { medio: 'cheque' })).rejects.toThrow(/medio de pago/i);
    expect(mockDb.deudas[0].montoPagado).toBe(0);
  });
  it('AC-DMP-1 cobrar todo del cliente aplica el medio a cada deuda', async () => {
    mockDb.deudas = [deuda({ id: 1 }), deuda({ id: 2, monto: 300 })];
    await cobrarTodoDelCliente(mockDb.deudas, 'A', { medio: 'efectivo' });
    expect(mockDb.deudas.every(d => d.pagada && d.medioPago === 'efectivo')).toBe(true);
  });
  it('AC-DMP-1 deshacer cobros limpia el historial y el medio', async () => {
    mockDb.deudas = [deuda()];
    const c = await cobrarDeuda(mockDb.deudas[0], null, 'A', { medio: 'efectivo' });
    await deshacerCobros(c);
    expect(mockDb.deudas[0]).toMatchObject({ montoPagado: 0, pagada: false, cobros: [], medioPago: null, referenciaPago: null });
  });
  it('AC-DMP-1 los cobros de una rendicion usan el medio interno "rendicion"', async () => {
    mockDb.deudas = [deuda()];
    await aplicarCobrosRendicion([{ deudaId: 1, montoCents: 25000 }], 'Rendición #ab');
    expect(mockDb.deudas[0].cobros[0]).toMatchObject({ medio: 'rendicion', montoCents: 25000 });
    expect(mockDb.deudas[0].montoPagado).toBe(250);
  });
  it('AC-DMP-1 sin medio se conserva el cobro de siempre (pago "sin dato")', async () => {
    mockDb.deudas = [deuda()];
    const r = await cobrarDeuda(mockDb.deudas[0], 100, 'A');
    expect(r.montoPagado).toBe(100);
    expect(r.cobros).toBeUndefined();
  });
});
