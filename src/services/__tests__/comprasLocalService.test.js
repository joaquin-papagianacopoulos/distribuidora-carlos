// REQ-CPR: escrituras locales de cuenta y pedidos al proveedor (IndexedDB falsa en memoria).
const mockStore = { cuenta: [], pedidos: [], adjuntos: [] };

jest.mock('../../db', () => {
  const put = (key) => async (rows) => {
    for (const row of rows || []) {
      const i = mockStore[key].findIndex(r => r.id === row.id);
      if (i >= 0) mockStore[key][i] = JSON.parse(JSON.stringify(row)); else mockStore[key].push(JSON.parse(JSON.stringify(row)));
    }
  };
  return {
    getCuentaProveedores: async () => JSON.parse(JSON.stringify(mockStore.cuenta)),
    putCuentaProveedoresRaw: put('cuenta'),
    getPedidosProveedor: async () => JSON.parse(JSON.stringify(mockStore.pedidos)),
    putPedidosProveedorRaw: put('pedidos'),
    getComprobantesPendientes: async () => mockStore.adjuntos,
    putComprobantePendiente: async (c) => { mockStore.adjuntos.push(c); },
    deleteComprobantePendiente: async () => {},
    getIngresosCostos: async () => [], putIngresosCostosRaw: async () => {}, clearIngresosCostosPendingSync: async () => {},
    clearCuentaProveedoresPendingSync: async () => {}, clearPedidosProveedorPendingSync: async () => {},
  };
});
jest.mock('../../lib/supabase', () => ({ supabase: {} }));
jest.mock('../stockService', () => ({ syncStock: jest.fn() }));

const svc = require('../comprasLocalService');

const now = new Date('2026-10-15T12:00:00Z');
const pago = (extra = {}) => ({ id: 'a', proveedorId: 'p1', tipo: 'pago', fecha: '2026-10-15', montoCentavos: 1000, medio: 'efectivo', referencia: '', clienteId: null, pedidoId: null, comprobantePath: null, anulado: null, usuario: 'ana', creadoAt: 1, updatedAt: 1, pendingSync: true, ...extra });

beforeEach(() => { Object.assign(mockStore, { cuenta: [], pedidos: [], adjuntos: [] }); });

describe('AC-CPR-2 guardarMovimientoCuenta', () => {
  it('AC-CPR-2 guarda el pago pendiente de sync', async () => {
    expect((await svc.guardarMovimientoCuenta(pago())).ok).toBe(true);
    expect(mockStore.cuenta).toHaveLength(1);
    expect(mockStore.cuenta[0].pendingSync).toBe(true);
  });
  it('AC-CPR-2 con adjunto válido lo deja en cola; con adjunto inválido NO graba el pago', async () => {
    expect((await svc.guardarMovimientoCuenta(pago(), { size: 10, type: 'image/png' })).ok).toBe(true);
    expect(mockStore.adjuntos).toHaveLength(1);
    const mal = await svc.guardarMovimientoCuenta(pago({ id: 'b' }), { size: 10 * 1024 * 1024, type: 'image/png' });
    expect(mal.ok).toBe(false);
    expect(mockStore.cuenta.map(m => m.id)).toEqual(['a']);
  });
  it('AC-CPR-2 movimiento sin id => error', async () => {
    expect((await svc.guardarMovimientoCuenta(null)).ok).toBe(false);
  });
});

describe('AC-CPR-5 anularMovimientoCuenta', () => {
  it('AC-CPR-5 anula con motivo y no borra; la segunda vez falla', async () => {
    await svc.guardarMovimientoCuenta(pago({ pendingSync: false }));
    const r = await svc.anularMovimientoCuenta('a', { motivo: 'error de carga', usuario: 'ana', now });
    expect(r.ok).toBe(true);
    expect(mockStore.cuenta).toHaveLength(1);
    expect(mockStore.cuenta[0]).toMatchObject({ montoCentavos: 1000, pendingSync: true, anulado: { motivo: 'error de carga', usuario: 'ana' } });
    expect((await svc.anularMovimientoCuenta('a', { motivo: 'otra' })).ok).toBe(false);
  });
  it('AC-CPR-5 sin motivo o inexistente no cambia nada', async () => {
    await svc.guardarMovimientoCuenta(pago({ pendingSync: false }));
    expect((await svc.anularMovimientoCuenta('a', { motivo: ' ' })).ok).toBe(false);
    expect((await svc.anularMovimientoCuenta('zzz', { motivo: 'x' })).ok).toBe(false);
    expect(mockStore.cuenta[0].anulado).toBeNull();
    expect(mockStore.cuenta[0].pendingSync).toBe(false);
  });
});

describe('AC-CPR-4 / AC-STB-3 pedidos al proveedor', () => {
  it('AC-STB-3 crea un borrador al agregar y reutiliza el mismo para sumar', async () => {
    const r1 = await svc.agregarAlBorradorProveedor('p1', [{ productoId: 1, cantidad: 5 }], { usuario: 'ana', now, genId: () => 'ped-1' });
    expect(r1.ok).toBe(true);
    const r2 = await svc.agregarAlBorradorProveedor('p1', [{ productoId: 1, cantidad: 3 }, { productoId: 2, cantidad: 1 }], { now });
    expect(mockStore.pedidos).toHaveLength(1);
    expect(r2.pedido.id).toBe('ped-1');
    expect(mockStore.pedidos[0].items.map(i => [i.productoId, i.cantidad])).toEqual([['1', 8], ['2', 1]]);
    expect(mockStore.pedidos[0].pendingSync).toBe(true);
  });
  it('AC-STB-3 otro proveedor => otro borrador; sin proveedor o sin cantidades válidas => no crea nada', async () => {
    await svc.agregarAlBorradorProveedor('p1', [{ productoId: 1, cantidad: 5 }], { now, genId: () => 'ped-1' });
    await svc.agregarAlBorradorProveedor('p2', [{ productoId: 1, cantidad: 5 }], { now, genId: () => 'ped-2' });
    expect(mockStore.pedidos.map(p => p.proveedorId)).toEqual(['p1', 'p2']);
    expect((await svc.agregarAlBorradorProveedor('', [{ productoId: 1, cantidad: 5 }])).ok).toBe(false);
    expect((await svc.agregarAlBorradorProveedor('p3', [{ productoId: 1, cantidad: 0 }])).ok).toBe(false);
    expect(mockStore.pedidos).toHaveLength(2);
  });
  it('AC-STB-3 un pedido enviado no se reabre: se arma un borrador nuevo', async () => {
    await svc.agregarAlBorradorProveedor('p1', [{ productoId: 1, cantidad: 5 }], { now, genId: () => 'ped-1' });
    await svc.marcarPedidoEnviado('ped-1', { now });
    expect(mockStore.pedidos[0].estado).toBe('enviado');
    await svc.agregarAlBorradorProveedor('p1', [{ productoId: 2, cantidad: 1 }], { now, genId: () => 'ped-2' });
    expect(mockStore.pedidos.map(p => [p.id, p.estado])).toEqual([['ped-1', 'enviado'], ['ped-2', 'borrador']]);
  });
  it('AC-CPR-4 recibir: terminal, devuelve el ingreso precargado y es idempotente', async () => {
    await svc.agregarAlBorradorProveedor('p1', [{ productoId: 1, cantidad: 2, unidad: 'bulto', bultoX: 6 }], { now, genId: () => 'ped-1' });
    const r = await svc.recibirPedidoProveedor('ped-1', { now });
    expect(r.ok).toBe(true);
    expect(r.formIngreso).toEqual({ proveedorId: 'p1', pedidoProveedorId: 'ped-1', items: [{ productoId: '1', ingreso: 12 }] });
    expect(mockStore.pedidos[0]).toMatchObject({ estado: 'recibido', pendingSync: true });
    const r2 = await svc.recibirPedidoProveedor('ped-1', { now });
    expect(r2.ok).toBe(true);
    expect(r2.formIngreso).toEqual(r.formIngreso);
    expect((await svc.recibirPedidoProveedor('nada')).ok).toBe(false);
  });
  it('AC-CPR-4 vincula el ingreso confirmado; el pedido vacío no se puede recibir', async () => {
    await svc.guardarPedidoProveedor({ id: 'v', proveedorId: 'p9', estado: 'borrador', items: [], ingresoId: null, creadoAt: 1, updatedAt: 1 });
    expect((await svc.recibirPedidoProveedor('v')).ok).toBe(false);
    await svc.agregarAlBorradorProveedor('p1', [{ productoId: 1, cantidad: 2 }], { now, genId: () => 'ped-1' });
    await svc.recibirPedidoProveedor('ped-1', { now });
    const r = await svc.vincularPedidoConIngreso('ped-1', 'ing-9', { now });
    expect(r.pedido.ingresoId).toBe('ing-9');
    expect(mockStore.pedidos.find(p => p.id === 'ped-1').ingresoId).toBe('ing-9');
  });
});
