import {
  validarMovimientoCuenta, validarAdjunto, anularMovimiento, estadoDeCuenta, saldoProveedor,
  movCuentaToRemote, movCuentaFromRemote, formatearCentavos, extensionAdjunto, aCentavos,
} from '../cuentaProveedores';

const now = new Date('2026-10-15T15:00:00.000Z');
const proveedores = [{ id: 'p1', descripcion: 'Uno' }, { id: 'p2', descripcion: 'Dos' }];
let n = 0;
const genId = () => `m-${++n}`;
const opts = (tipo, extra = {}) => ({ tipo, proveedores, now, genId, usuario: 'ana', ...extra });

describe('AC-CPR-2 validarMovimientoCuenta', () => {
  it('AC-CPR-2 pago válido en efectivo: centavos enteros, pendiente de sync', () => {
    const r = validarMovimientoCuenta({ proveedorId: 'p1', fecha: '2026-10-14', monto: '1.234,56', medio: 'efectivo', referencia: ' recibo 4 ' }, opts('pago'));
    expect(r.ok).toBe(true);
    expect(r.mov).toMatchObject({ tipo: 'pago', montoCentavos: 123456, medio: 'efectivo', referencia: 'recibo 4', usuario: 'ana', pendingSync: true, anulado: null, comprobantePath: null });
    expect(r.mov.id).toMatch(/^m-/);
  });
  it('AC-CPR-2 sin 0,1+0,2 de flotantes: 0,29 son 29 centavos', () => {
    expect(aCentavos('0,29')).toBe(29);
    expect(aCentavos(1.005)).toBe(101);
    expect(aCentavos('x')).toBeNull();
  });
  it('AC-CPR-2 monto 0, negativo, vacío o gigante se rechazan', () => {
    for (const monto of ['0', '-5', '', 'abc', '2000000000']) {
      const r = validarMovimientoCuenta({ proveedorId: 'p1', monto, medio: 'efectivo' }, opts('pago'));
      expect(r.ok).toBe(false);
      expect(r.errores.monto).toBeTruthy();
    }
  });
  it('AC-CPR-2 el medio es obligatorio en un pago y no aplica a un cargo', () => {
    expect(validarMovimientoCuenta({ proveedorId: 'p1', monto: '5' }, opts('pago')).errores.medio).toBeTruthy();
    expect(validarMovimientoCuenta({ proveedorId: 'p1', monto: '5', medio: 'cheque' }, opts('pago')).errores.medio).toBeTruthy();
    const c = validarMovimientoCuenta({ proveedorId: 'p1', monto: '5', medio: 'efectivo' }, opts('cargo'));
    expect(c.ok).toBe(true);
    expect(c.mov.medio).toBeNull();
    expect(c.mov.tipo).toBe('cargo');
  });
  it('AC-CPR-2 directa: cliente/pedido opcionales; con otro medio se descartan', () => {
    const clientes = [{ id: 'c1' }];
    const d = validarMovimientoCuenta({ proveedorId: 'p1', monto: '5', medio: 'directa', clienteId: 'c1', pedidoId: '77' }, opts('pago', { clientes }));
    expect(d.mov).toMatchObject({ clienteId: 'c1', pedidoId: '77' });
    const sin = validarMovimientoCuenta({ proveedorId: 'p1', monto: '5', medio: 'directa' }, opts('pago', { clientes }));
    expect(sin.ok).toBe(true);
    const otro = validarMovimientoCuenta({ proveedorId: 'p1', monto: '5', medio: 'transferencia', clienteId: 'c1' }, opts('pago', { clientes }));
    expect(otro.mov.clienteId).toBeNull();
    expect(validarMovimientoCuenta({ proveedorId: 'p1', monto: '5', medio: 'directa', clienteId: 'zz' }, opts('pago', { clientes })).errores.clienteId).toBeTruthy();
    expect(validarMovimientoCuenta({ proveedorId: 'p1', monto: '5', medio: 'directa', pedidoId: '9' }, opts('pago', { clientes })).errores.clienteId).toBeTruthy();
  });
  it('AC-CPR-2 proveedor y fecha: obligatorio/inexistente/inválida; fecha vacía = hoy', () => {
    expect(validarMovimientoCuenta({ monto: '5', medio: 'efectivo' }, opts('pago')).errores.proveedorId).toBeTruthy();
    expect(validarMovimientoCuenta({ proveedorId: 'zz', monto: '5', medio: 'efectivo' }, opts('pago')).errores.proveedorId).toBeTruthy();
    expect(validarMovimientoCuenta({ proveedorId: 'p1', monto: '5', medio: 'efectivo', fecha: '31/02/2026' }, opts('pago')).errores.fecha).toBeTruthy();
    expect(validarMovimientoCuenta({ proveedorId: 'p1', monto: '5', medio: 'efectivo' }, opts('pago')).mov.fecha).toMatch(/^2026-10-1[45]$/);
    expect(validarMovimientoCuenta({ proveedorId: 'p1', monto: '5', medio: 'efectivo' }, opts('otro')).ok).toBe(false);
  });
  it('AC-CPR-2 adjunto: imagen/PDF hasta 5 MB', () => {
    expect(validarAdjunto({ size: 1000, type: 'image/png' }).ok).toBe(true);
    expect(validarAdjunto({ size: 5 * 1024 * 1024, type: 'application/pdf' }).ok).toBe(true);
    expect(validarAdjunto({ size: 5 * 1024 * 1024 + 1, type: 'application/pdf' }).ok).toBe(false);
    expect(validarAdjunto({ size: 100, type: 'text/html' }).ok).toBe(false);
    expect(validarAdjunto({ size: 100, type: 'image/svg+xml' }).ok).toBe(false);
    expect(validarAdjunto({ size: 0, type: 'image/png' }).ok).toBe(false);
    expect(validarAdjunto(null).ok).toBe(false);
    expect(extensionAdjunto('image/jpeg')).toBe('jpg');
    expect(extensionAdjunto('x/y')).toBe('');
  });
});

describe('AC-CPR-5 anularMovimiento', () => {
  const pago = { id: 'a', tipo: 'pago', montoCentavos: 100, anulado: null, pendingSync: false };
  it('AC-CPR-5 anula con motivo, queda quién y cuándo, y no borra', () => {
    const r = anularMovimiento(pago, { motivo: ' se cargó mal ', usuario: 'ana', now });
    expect(r.ok).toBe(true);
    expect(r.mov.anulado).toEqual({ motivo: 'se cargó mal', usuario: 'ana', at: now.toISOString() });
    expect(r.mov.montoCentavos).toBe(100);
    expect(r.mov.pendingSync).toBe(true);
    expect(pago.anulado).toBeNull();
  });
  it('AC-CPR-5 sin motivo, ya anulado o compra derivada => error', () => {
    expect(anularMovimiento(pago, { motivo: '  ' }).ok).toBe(false);
    expect(anularMovimiento({ ...pago, anulado: { motivo: 'x' } }, { motivo: 'y' }).error).toMatch(/ya está anulado/);
    expect(anularMovimiento({ id: 'i', tipo: 'compra' }, { motivo: 'y' }).ok).toBe(false);
    expect(anularMovimiento(null, { motivo: 'y' }).ok).toBe(false);
  });
});

describe('AC-CPR-1 / AC-CPR-3 / AC-CPR-5 saldos y estado de cuenta', () => {
  const compras = [
    { id: 'i1', proveedorId: 'p1', fecha: '2026-10-01T15:00:00.000Z', montoCentavos: 100000, tipo: 'compra' },
    { id: 'i2', proveedorId: 'p2', fecha: '2026-10-02T15:00:00.000Z', montoCentavos: 999, tipo: 'compra' },
  ];
  const movs = [
    { id: 'm1', proveedorId: 'p1', tipo: 'pago', fecha: '2026-10-05', montoCentavos: 30000, medio: 'efectivo', creadoAt: 2, anulado: null },
    { id: 'm2', proveedorId: 'p1', tipo: 'pago', fecha: '2026-10-06', montoCentavos: 20000, medio: 'transferencia', creadoAt: 3, anulado: null },
    { id: 'm3', proveedorId: 'p1', tipo: 'cargo', fecha: '2026-10-07', montoCentavos: 5050, medio: null, creadoAt: 4, anulado: null },
    { id: 'm4', proveedorId: 'p1', tipo: 'pago', fecha: '2026-10-08', montoCentavos: 10000, medio: 'directa', creadoAt: 5, anulado: { motivo: 'x', usuario: 'a', at: 'z' } },
    { id: 'm5', proveedorId: 'p2', tipo: 'pago', fecha: '2026-10-09', montoCentavos: 5000, medio: 'efectivo', creadoAt: 6, anulado: null },
  ];
  it('AC-CPR-1 saldo = compras + cargos − pagos, sin anulados, por proveedor', () => {
    expect(saldoProveedor(compras, movs, 'p1')).toBe(100000 + 5050 - 30000 - 20000);
    expect(saldoProveedor(compras, movs, 'p2')).toBe(999 - 5000);
    expect(saldoProveedor([], [])).toBe(0);
  });
  it('AC-CPR-5 saldo negativo (a favor) y centavos exactos', () => {
    expect(saldoProveedor([], [{ id: 'x', proveedorId: 'p1', tipo: 'pago', fecha: '2026-10-01', montoCentavos: 7, medio: 'efectivo' }])).toBe(-7);
    expect(formatearCentavos(-123456)).toBe('-$1.234,56');
    expect(formatearCentavos(5)).toBe('$0,05');
  });
  it('AC-CPR-3 filas en orden de fecha con saldo acumulado; anulados visibles pero fuera del saldo', () => {
    const e = estadoDeCuenta(compras, movs, { proveedorId: 'p1' });
    expect(e.filas.map(f => f.id)).toEqual(['i1', 'm1', 'm2', 'm3', 'm4']);
    expect(e.filas.map(f => f.saldoAcumulado)).toEqual([100000, 70000, 50000, 55050, 55050]);
    expect(e.filas[4].anulado).toBeTruthy();
    expect(e.filas[4].efectoCentavos).toBe(0);
    expect(e.saldoFinal).toBe(55050);
    expect(e.saldoInicial).toBe(0);
    expect(e.totalAnulados).toBe(1);
    expect(e.totalCompras).toBe(105050);
  });
  it('AC-CPR-3 totales por medio (sin anulados)', () => {
    const e = estadoDeCuenta(compras, movs, { proveedorId: 'p1' });
    expect(e.totalesPorMedio).toEqual({ efectivo: 30000, transferencia: 20000, directa: 0, total: 50000 });
  });
  it('AC-CPR-3 filtro por fechas: saldo inicial = lo anterior al rango', () => {
    const e = estadoDeCuenta(compras, movs, { proveedorId: 'p1', desde: '2026-10-06', hasta: '2026-10-07' });
    expect(e.saldoInicial).toBe(70000);
    expect(e.filas.map(f => f.id)).toEqual(['m2', 'm3']);
    expect(e.filas[0].saldoAcumulado).toBe(50000);
    expect(e.saldoFinal).toBe(55050);
  });
  it('AC-CPR-3 filtro por medio muestra solo esos pagos pero el saldo sigue siendo el real', () => {
    const e = estadoDeCuenta(compras, movs, { proveedorId: 'p1', medio: 'efectivo' });
    expect(e.filas.map(f => f.id)).toEqual(['m1']);
    expect(e.filas[0].saldoAcumulado).toBe(70000);
    expect(e.saldoFinal).toBe(55050);
    expect(e.totalesPorMedio.efectivo).toBe(30000);
  });
  it('AC-CPR-3 mismo día: ordena por hora de carga y luego id (estable)', () => {
    const ms = [
      { id: 'b', proveedorId: 'p1', tipo: 'pago', fecha: '2026-10-05', montoCentavos: 1, medio: 'efectivo', creadoAt: 5 },
      { id: 'a', proveedorId: 'p1', tipo: 'pago', fecha: '2026-10-05', montoCentavos: 1, medio: 'efectivo', creadoAt: 5 },
      { id: 'c', proveedorId: 'p1', tipo: 'pago', fecha: '2026-10-05', montoCentavos: 1, medio: 'efectivo', creadoAt: 1 },
    ];
    expect(estadoDeCuenta([], ms).filas.map(f => f.id)).toEqual(['c', 'a', 'b']);
  });
  it('AC-CPR-3 sin movimientos', () => {
    expect(estadoDeCuenta([], [])).toMatchObject({ filas: [], saldoInicial: 0, saldoFinal: 0, totalAnulados: 0 });
  });
});

describe('AC-CPR-2 mapeo remoto', () => {
  it('AC-CPR-2 round-trip con anulación', () => {
    const m = {
      id: 'u1', proveedorId: 'p1', tipo: 'pago', fecha: '2026-10-05', montoCentavos: 12345, medio: 'directa', referencia: 'r',
      clienteId: 'c1', pedidoId: '9', comprobantePath: null, anulado: null, usuario: 'ana', creadoAt: 1760000000000, updatedAt: 1760000001000,
    };
    const r = movCuentaToRemote(m);
    expect(r).toMatchObject({ id: 'u1', proveedor_id: 'p1', monto_centavos: 12345, medio: 'directa', cliente_id: 'c1', anulado: null });
    const back = movCuentaFromRemote({ ...r, anulado_at: null });
    expect(back).toMatchObject({ id: 'u1', montoCentavos: 12345, creadoAt: 1760000000000, updatedAt: 1760000001000, pendingSync: false, anulado: null });
    const anul = movCuentaFromRemote({ ...r, anulado_at: '2026-10-06T10:00:00Z', anulado_motivo: 'mal', anulado_por: 'ana' });
    expect(anul.anulado).toEqual({ motivo: 'mal', usuario: 'ana', at: '2026-10-06T10:00:00Z' });
    expect(movCuentaToRemote({ ...m, anulado: { motivo: 'mal', usuario: 'ana', at: 'z' } }).anulado).toEqual({ motivo: 'mal', usuario: 'ana', at: 'z' });
  });
});
