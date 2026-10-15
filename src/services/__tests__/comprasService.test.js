// REQ-INA / REQ-CPR: sync de compras por RPC con PIN, comprobantes en Storage privado.
const mockStore = { costos: [], cuenta: [], pedidos: [], adjuntos: [] };
const mockRpc = jest.fn();
const mockUpload = jest.fn();
const mockDownload = jest.fn();
const mockSyncStock = jest.fn();

jest.mock('../../db', () => {
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const put = (key) => async (rows) => {
    for (const row of rows || []) {
      const i = mockStore[key].findIndex(r => r.id === row.id);
      if (i >= 0) mockStore[key][i] = clone(row); else mockStore[key].push(clone(row));
    }
  };
  // Misma regla que db/index.js: solo limpia si updatedAt no cambio desde lo enviado.
  const clearSi = (key) => async (enviados) => {
    const por = new Map(enviados.map(x => [x.id, x.updatedAt]));
    mockStore[key] = mockStore[key].map(r => (por.has(r.id) && r.pendingSync && (r.updatedAt || 0) === (por.get(r.id) || 0) ? { ...r, pendingSync: false } : r));
  };
  return {
    getIngresosCostos: async () => clone(mockStore.costos),
    putIngresosCostosRaw: put('costos'),
    clearIngresosCostosPendingSync: clearSi('costos'),
    getCuentaProveedores: async () => clone(mockStore.cuenta),
    putCuentaProveedoresRaw: put('cuenta'),
    clearCuentaProveedoresPendingSync: clearSi('cuenta'),
    getPedidosProveedor: async () => clone(mockStore.pedidos),
    putPedidosProveedorRaw: put('pedidos'),
    clearPedidosProveedorPendingSync: clearSi('pedidos'),
    getComprobantesPendientes: async () => mockStore.adjuntos.slice(),
    putComprobantePendiente: async (c) => { mockStore.adjuntos.push(c); },
    deleteComprobantePendiente: async (id) => { mockStore.adjuntos = mockStore.adjuntos.filter(a => a.id !== id); },
  };
});
jest.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: (...a) => mockRpc(...a),
    storage: { from: () => ({ upload: (...a) => mockUpload(...a), download: (...a) => mockDownload(...a) }) },
  },
}));
jest.mock('../stockService', () => ({ syncStock: (...a) => mockSyncStock(...a) }));

const svc = require('../comprasService');

const CRED = { p_admin_id: '1', p_admin_pin: '987654' };
const costo = (id, extra = {}) => ({ id, proveedorId: 'p1', fecha: '2026-10-10T15:00:00.000Z', tipoCabecera: 'A', facturaA: '', facturaB: '', renglones: [{ productoId: '1', costoUnitario: 10, tipoFactura: 'A', unidades: 2 }], updatedAt: 1000, pendingSync: true, ...extra });
const pago = (id, extra = {}) => ({ id, proveedorId: 'p1', tipo: 'pago', fecha: '2026-10-11', montoCentavos: 5000, medio: 'efectivo', referencia: '', creadoAt: 1, updatedAt: 2000, anulado: null, comprobantePath: null, pendingSync: true, ...extra });
const pedido = (id, extra = {}) => ({ id, proveedorId: 'p1', estado: 'borrador', items: [{ productoId: '1', cantidad: 2, unidad: 'u', bultoX: null }], ingresoId: null, usuario: '', creadoAt: 1, updatedAt: 3000, pendingSync: true, ...extra });

let logSpy;
let warnSpy;
let errSpy;
beforeEach(() => {
  Object.assign(mockStore, { costos: [], cuenta: [], pedidos: [], adjuntos: [] });
  mockRpc.mockReset();
  mockUpload.mockReset();
  mockDownload.mockReset();
  mockSyncStock.mockReset();
  mockSyncStock.mockResolvedValue({ ok: true });
  try { localStorage.clear(); } catch { /* sin storage */ }
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  global.URL.createObjectURL = jest.fn(() => 'blob:fake');
});
afterEach(() => { logSpy.mockRestore(); warnSpy.mockRestore(); errSpy.mockRestore(); });

describe('AC-CPR-1 subirCompras sin credenciales', () => {
  it('AC-CPR-1 sin PIN no llama al servidor y deja todo pendiente', async () => {
    mockStore.costos = [costo('i1')];
    mockStore.cuenta = [pago('a')];
    const r = await svc.subirCompras(null);
    expect(r).toMatchObject({ ok: true, skipped: true });
    expect(r.pendientes).toMatchObject({ costos: 1, cuenta: 1, pedidos: 0, total: 2 });
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockStore.costos[0].pendingSync).toBe(true);
  });
  it('AC-CPR-1 sin nada pendiente no llama a la RPC', async () => {
    mockStore.costos = [costo('i1', { pendingSync: false })];
    const r = await svc.subirCompras(CRED);
    expect(r).toMatchObject({ ok: true, subidos: { costos: 0, cuenta: 0, pedidos: 0 } });
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe('AC-CPR-1 / AC-INA-1 subirCompras con PIN', () => {
  it('AC-INA-1 sincroniza stock primero, manda nombres remotos y limpia SOLO los confirmados', async () => {
    mockStore.costos = [costo('i1'), costo('i2')];
    mockStore.cuenta = [pago('a')];
    mockStore.pedidos = [pedido('p')];
    mockRpc.mockResolvedValueOnce({ data: {
      ok: true, guardados: { costos: 1, cuenta: 1, pedidos: 1 },
      ids: { costos: ['i1'], cuenta: ['a'], pedidos: ['p'] },
      rechazados: [{ id: 'i2', motivo: 'ingreso_inexistente' }],
    }, error: null });
    const r = await svc.subirCompras(CRED);
    expect(mockSyncStock).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledTimes(1);
    const [nombre, args] = mockRpc.mock.calls[0];
    expect(nombre).toBe('admin_compras_guardar');
    expect(args).toMatchObject({ p_admin_id: '1', p_admin_pin: '987654' });
    expect(args.p_lote.costos.map(f => f.ingreso_id)).toEqual(['i1', 'i2']);
    expect(args.p_lote.cuenta[0]).toMatchObject({ id: 'a', monto_centavos: 5000, medio: 'efectivo' });
    expect(args.p_lote.pedidos[0]).toMatchObject({ id: 'p', estado: 'borrador' });
    expect(r).toMatchObject({ ok: true, subidos: { costos: 1, cuenta: 1, pedidos: 1 } });
    expect(r.rechazados).toEqual([{ id: 'i2', motivo: 'ingreso_inexistente' }]);
    expect(mockStore.costos.map(c => [c.id, c.pendingSync])).toEqual([['i1', false], ['i2', true]]);
    expect(mockStore.cuenta[0].pendingSync).toBe(false);
    expect(mockStore.pedidos[0].pendingSync).toBe(false);
  });

  it('AC-CPR-5 una edición hecha mientras subía sigue pendiente (updatedAt distinto)', async () => {
    mockStore.cuenta = [pago('a')];
    mockRpc.mockImplementationOnce(async () => {
      // el usuario anula el pago mientras la RPC está en vuelo
      mockStore.cuenta = [{ ...mockStore.cuenta[0], updatedAt: 9999, anulado: { motivo: 'x', usuario: 'a', at: 'z' }, pendingSync: true }];
      return { data: { ok: true, ids: { costos: [], cuenta: ['a'], pedidos: [] }, rechazados: [] }, error: null };
    });
    await svc.subirCompras(CRED);
    expect(mockStore.cuenta[0].pendingSync).toBe(true);
    expect(mockStore.cuenta[0].anulado).toBeTruthy();
  });

  it('AC-CPR-1 reintento sin duplicar: lo ya confirmado no se vuelve a mandar', async () => {
    mockStore.cuenta = [pago('a'), pago('b')];
    mockRpc.mockResolvedValueOnce({ data: { ok: true, ids: { costos: [], cuenta: ['a'], pedidos: [] }, rechazados: [{ id: 'b', motivo: 'datos_invalidos' }] }, error: null });
    await svc.subirCompras(CRED);
    mockRpc.mockResolvedValueOnce({ data: { ok: true, ids: { costos: [], cuenta: ['b'], pedidos: [] }, rechazados: [] }, error: null });
    await svc.subirCompras(CRED);
    expect(mockRpc.mock.calls[1][1].p_lote.cuenta.map(f => f.id)).toEqual(['b']);
    expect(mockStore.cuenta.every(p => !p.pendingSync)).toBe(true);
  });

  it('AC-CPR-1 lotes de 500 filas', async () => {
    mockStore.cuenta = Array.from({ length: 1100 }, (_, i) => pago(`m${i}`));
    mockRpc.mockImplementation(async (_n, a) => ({ data: { ok: true, ids: { costos: [], cuenta: a.p_lote.cuenta.map(f => f.id), pedidos: [] }, rechazados: [] }, error: null }));
    const r = await svc.subirCompras(CRED);
    expect(mockRpc).toHaveBeenCalledTimes(3);
    expect(mockRpc.mock.calls.map(c => c[1].p_lote.cuenta.length)).toEqual([500, 500, 100]);
    expect(r.subidos.cuenta).toBe(1100);
  });

  it('AC-SEC-1 PIN incorrecto: no limpia nada y devuelve el motivo', async () => {
    mockStore.cuenta = [pago('a')];
    mockRpc.mockResolvedValueOnce({ data: { ok: false, motivo: 'no_autorizado' }, error: null });
    const r = await svc.subirCompras(CRED);
    expect(r).toMatchObject({ ok: false, motivo: 'no_autorizado' });
    expect(mockStore.cuenta[0].pendingSync).toBe(true);
  });

  it('AC-CPR-1 falta la migración 012: queda pendiente con aviso', async () => {
    mockStore.cuenta = [pago('a')];
    mockRpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.admin_compras_guardar' } });
    const r = await svc.subirCompras(CRED);
    expect(r).toMatchObject({ ok: false, motivo: 'falta_migracion', faltaMigracion: true });
    expect(r.mensaje).toMatch(/012/);
    expect(mockStore.cuenta[0].pendingSync).toBe(true);
  });

  it('AC-INA-1 si el sync de stock falla igual se intenta subir', async () => {
    mockStore.costos = [costo('i1')];
    mockSyncStock.mockRejectedValueOnce(new Error('sin red'));
    mockRpc.mockResolvedValueOnce({ data: { ok: true, ids: { costos: [], cuenta: [], pedidos: [] }, rechazados: [{ id: 'i1', motivo: 'ingreso_inexistente' }] }, error: null });
    const r = await svc.subirCompras(CRED);
    expect(r.ok).toBe(true);
    expect(mockStore.costos[0].pendingSync).toBe(true);
  });

  it('AC-SEC-1 el PIN nunca se loguea ni se guarda', async () => {
    mockStore.costos = [costo('i1')];
    mockStore.cuenta = [pago('a')];
    mockRpc.mockResolvedValueOnce({ data: { ok: false, motivo: 'no_autorizado' }, error: null });
    await svc.subirCompras(CRED);
    await svc.bajarCompras(CRED).catch(() => {});
    const salida = JSON.stringify([logSpy.mock.calls, warnSpy.mock.calls, errSpy.mock.calls]);
    expect(salida).not.toContain('987654');
    expect(JSON.stringify(mockStore)).not.toContain('987654');
    expect(JSON.stringify(Object.entries(localStorage))).not.toContain('987654');
  });
});

describe('AC-CPR-1 sondearMigracion012', () => {
  it('AC-CPR-1 detecta función inexistente y distingue no_autorizado', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { code: '42883', message: 'function does not exist' } });
    expect(await svc.sondearMigracion012()).toEqual({ faltaMigracion: true });
    mockRpc.mockResolvedValueOnce({ data: { ok: false, motivo: 'no_autorizado' }, error: null });
    expect(await svc.sondearMigracion012()).toEqual({ faltaMigracion: false });
    mockRpc.mockRejectedValueOnce(new Error('red'));
    expect(await svc.sondearMigracion012()).toEqual({ faltaMigracion: false });
  });
});

describe('AC-CPR-3 bajarCompras', () => {
  const remotoPago = (id, extra = {}) => ({ id, proveedor_id: 'p1', tipo: 'pago', fecha: '2026-10-11', monto_centavos: 7000, medio: 'efectivo', referencia: null, anulado_at: null, creado_at: '2026-10-11T10:00:00Z', updated_at: '2026-10-11T10:00:00Z', ...extra });

  it('AC-CPR-3 sin PIN no llama al servidor', async () => {
    const r = await svc.bajarCompras(null);
    expect(r).toMatchObject({ ok: false, motivo: 'pin_requerido' });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('AC-CPR-3 / S-012-02 baja las tres tablas, no pisa lo pendiente y guarda el cursor (synced_at, id)', async () => {
    mockStore.cuenta = [pago('a', { montoCentavos: 111 })]; // pendiente local: no se pisa
    mockRpc.mockResolvedValueOnce({ data: {
      ok: true,
      costos: [{ ingreso_id: 'i9', proveedor_id: 'p1', fecha: '2026-10-09T10:00:00Z', tipo_cabecera: 'B', factura_a: null, factura_b: 'B-1', renglones: [{ producto_id: '1', costo_unitario: 4, tipo_factura: 'B', unidades: 3 }], updated_at: '2026-10-09T10:00:00Z', synced_at: '2026-10-13T08:00:00Z' }],
      cuenta: [remotoPago('a', { synced_at: '2026-10-13T09:00:00Z' }), remotoPago('z', { synced_at: '2026-10-13T09:00:01Z' })],
      pedidos: [{ id: 'ped', proveedor_id: 'p1', estado: 'enviado', items: [{ producto_id: '1', cantidad: 2, unidad: 'u', bulto_x: null }], ingreso_id: null, usuario: 'ana', creado_at: '2026-10-08T10:00:00Z', updated_at: '2026-10-12T10:00:00Z', synced_at: '2026-10-13T10:00:00Z' }],
    }, error: null });
    const r = await svc.bajarCompras(CRED);
    expect(r).toMatchObject({ ok: true, bajados: { costos: 1, cuenta: 1, pedidos: 1 } });
    expect(mockRpc.mock.calls[0][0]).toBe('admin_compras_bajar');
    expect(mockRpc.mock.calls[0][1]).toMatchObject({ p_cursor: {}, p_admin_pin: '987654' });
    expect(mockRpc.mock.calls[0][1]).not.toHaveProperty('p_desde');
    expect(mockStore.cuenta.find(p => p.id === 'a').montoCentavos).toBe(111);
    expect(mockStore.cuenta.find(p => p.id === 'z')).toMatchObject({ montoCentavos: 7000, pendingSync: false });
    expect(mockStore.costos[0]).toMatchObject({ id: 'i9', tipoCabecera: 'B', pendingSync: false });
    expect(mockStore.pedidos[0]).toMatchObject({ id: 'ped', estado: 'enviado' });
    expect(JSON.parse(localStorage.getItem('comprasSyncCursor'))).toEqual({
      costos: { ts: '2026-10-13T08:00:00Z', id: 'i9' },
      cuenta: { ts: '2026-10-13T09:00:01Z', id: 'z' },
      pedidos: { ts: '2026-10-13T10:00:00Z', id: 'ped' },
    });
    // La próxima bajada pide desde el synced_at del servidor con 5 minutos de solape (no updated_at).
    mockRpc.mockResolvedValueOnce({ data: { ok: true, costos: [], cuenta: [], pedidos: [] }, error: null });
    await svc.bajarCompras(CRED);
    expect(mockRpc.mock.calls[1][1].p_cursor).toEqual({
      costos: { ts: '2026-10-13T07:55:00.000Z', id: '' },
      cuenta: { ts: '2026-10-13T08:55:01.000Z', id: '' },
      pedidos: { ts: '2026-10-13T09:55:00.000Z', id: '' },
    });
    // Sin filas nuevas el cursor guardado no retrocede (el solape no se acumula).
    expect(JSON.parse(localStorage.getItem('comprasSyncCursor')).pedidos.ts).toBe('2026-10-13T10:00:00Z');
    await svc.bajarCompras(CRED, { completo: true }).catch(() => {});
  });

  it('S-012-02 página llena: sigue desde (synced_at, id) de la última fila, sin saltear empates', async () => {
    const mismo = '2026-10-13T09:00:00.123456+00:00';
    const pagina = Array.from({ length: 1000 }, (_, i) => remotoPago(`m${String(i).padStart(4, '0')}`, { synced_at: mismo }));
    mockRpc.mockResolvedValueOnce({ data: { ok: true, costos: [], cuenta: pagina, pedidos: [] }, error: null });
    mockRpc.mockResolvedValueOnce({ data: { ok: true, costos: [], cuenta: [remotoPago('m1000', { synced_at: mismo })], pedidos: [] }, error: null });
    const r = await svc.bajarCompras(CRED);
    expect(r.bajados.cuenta).toBe(1001);
    expect(mockRpc).toHaveBeenCalledTimes(2);
    expect(mockRpc.mock.calls[1][1].p_cursor.cuenta).toEqual({ ts: mismo, id: 'm0999' });
  });

  it('S-012-02 un cursor viejo (texto con updated_at) se descarta y baja todo', async () => {
    localStorage.setItem('comprasSyncCursor', '2026-10-12T10:00:00Z');
    mockRpc.mockResolvedValueOnce({ data: { ok: true, costos: [], cuenta: [], pedidos: [] }, error: null });
    await svc.bajarCompras(CRED);
    expect(mockRpc.mock.calls[0][1].p_cursor).toEqual({});
  });

  it('AC-CPR-3 falta la 012: devuelve el aviso y no rompe', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
    const r = await svc.bajarCompras(CRED);
    expect(r).toMatchObject({ ok: false, faltaMigracion: true });
  });
});

describe('AC-CPR-2 comprobantes', () => {
  const archivo = (extra = {}) => ({ size: 1000, type: 'application/pdf', ...extra });

  it('AC-CPR-2 encolar valida tipo y tamaño', async () => {
    expect((await svc.encolarComprobante('a', archivo({ size: 6 * 1024 * 1024 }))).ok).toBe(false);
    expect((await svc.encolarComprobante('a', archivo({ type: 'text/html' }))).ok).toBe(false);
    expect(mockStore.adjuntos).toEqual([]);
    expect((await svc.encolarComprobante('a', archivo())).ok).toBe(true);
    expect(mockStore.adjuntos).toHaveLength(1);
  });

  it('AC-CPR-2 sube: pide nombre, hace upload, guarda el path y recién ahí borra el blob', async () => {
    mockStore.cuenta = [pago('a', { pendingSync: false })];
    await svc.encolarComprobante('a', archivo());
    mockRpc.mockImplementation(async (nombre) => (nombre === 'admin_comprobante_subida'
      ? { data: { ok: true, nombre: 'pagos/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.pdf' }, error: null }
      : { data: { ok: true, ids: { costos: [], cuenta: ['a'], pedidos: [] }, rechazados: [] }, error: null }));
    mockUpload.mockResolvedValueOnce({ data: {}, error: null });
    const r = await svc.subirComprobantes(CRED);
    expect(mockRpc.mock.calls[0][0]).toBe('admin_comprobante_subida');
    expect(mockRpc.mock.calls[0][1]).toMatchObject({ p_pago_id: 'a', p_ext: 'pdf' });
    expect(mockUpload.mock.calls[0][0]).toMatch(/^pagos\//);
    expect(mockUpload.mock.calls[0][2]).toMatchObject({ contentType: 'application/pdf', upsert: false });
    expect(r).toMatchObject({ ok: true, subidos: 1, pendientes: 0 });
    expect(mockStore.adjuntos).toEqual([]);
    expect(mockStore.cuenta[0].comprobantePath).toMatch(/^pagos\//);
    expect(mockRpc.mock.calls.some(c => c[0] === 'admin_compras_guardar')).toBe(true);
  });

  it('AC-CPR-2 si el upload falla el blob local NO se borra y el pago no cambia', async () => {
    mockStore.cuenta = [pago('a', { pendingSync: false })];
    await svc.encolarComprobante('a', archivo());
    mockRpc.mockResolvedValueOnce({ data: { ok: true, nombre: 'pagos/x.pdf' }, error: null });
    mockUpload.mockResolvedValueOnce({ data: null, error: { message: 'nope' } });
    const r = await svc.subirComprobantes(CRED);
    expect(r.subidos).toBe(0);
    expect(r.fallidos).toEqual([{ id: 'a', motivo: 'upload' }]);
    expect(mockStore.adjuntos).toHaveLength(1);
    expect(mockStore.cuenta[0].comprobantePath).toBeNull();
  });

  it('AC-CPR-2 sin PIN no hace nada; PIN incorrecto corta y conserva la cola', async () => {
    mockStore.cuenta = [pago('a', { pendingSync: false })];
    await svc.encolarComprobante('a', archivo());
    expect(await svc.subirComprobantes(null)).toMatchObject({ ok: true, skipped: true, pendientes: 1 });
    mockRpc.mockResolvedValueOnce({ data: { ok: false, motivo: 'no_autorizado' }, error: null });
    expect(await svc.subirComprobantes(CRED)).toMatchObject({ ok: false, motivo: 'no_autorizado', pendientes: 1 });
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('AC-CPR-2 ver: habilita la lectura con PIN, descarga y arma un blob URL (sin URL compartible)', async () => {
    mockRpc.mockResolvedValueOnce({ data: { ok: true }, error: null });
    mockDownload.mockResolvedValueOnce({ data: { fake: 'blob' }, error: null });
    const r = await svc.verComprobante(CRED, 'pagos/x.pdf');
    expect(mockRpc.mock.calls[0][0]).toBe('admin_comprobante_lectura');
    expect(mockRpc.mock.calls[0][1]).toMatchObject({ p_nombre: 'pagos/x.pdf', p_admin_pin: '987654' });
    expect(r).toMatchObject({ ok: true, url: 'blob:fake' });
  });

  it('AC-CPR-2 ver sin PIN o con PIN malo no descarga', async () => {
    expect((await svc.verComprobante(null, 'pagos/x.pdf')).ok).toBe(false);
    mockRpc.mockResolvedValueOnce({ data: { ok: false, motivo: 'no_autorizado' }, error: null });
    expect((await svc.verComprobante(CRED, 'pagos/x.pdf')).ok).toBe(false);
    expect(mockDownload).not.toHaveBeenCalled();
  });

  it('AC-CPR-2 vista previa local de un adjunto en cola', async () => {
    await svc.encolarComprobante('a', archivo());
    expect(await svc.verComprobanteLocal('a')).toMatchObject({ ok: true, url: 'blob:fake' });
    expect((await svc.verComprobanteLocal('zz')).ok).toBe(false);
  });
});
