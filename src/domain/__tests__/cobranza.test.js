import {
  saldoAnteriorCliente, filasHojaRuta, validarCobro, registrarCobroEnDeuda, totalesPorMedio,
  deudaMedioToRemote, deudaMedioFromRemote, sinColumnasDmp, nombraColumnaDmp,
} from '../cobranza';

const ped = (o) => ({ id: 1, clienteId: 10, clienteNombre: 'Ana', total: 1000, estado: 'pendiente', ...o });
const deuda = (o) => ({ id: 'd', clienteId: 10, clienteNombre: 'Ana', monto: 500, montoPagado: 0, pagada: false, ...o });

describe('AC-RTO-5 saldoAnteriorCliente', () => {
  it('AC-RTO-5 suma lo pendiente del cliente sin contar el propio pedido', () => {
    const p = ped({ id: 1, remoteId: 'r1' });
    const deudas = [
      deuda({ id: 'a', pedidoId: 'r1', monto: 1000 }), // del pedido actual: no cuenta
      deuda({ id: 'b', pedidoId: 'r2', monto: 700, montoPagado: 200 }), // saldo 500
      deuda({ id: 'c', pedidoLocalId: 9, monto: 300 }),
      deuda({ id: 'x', clienteId: 99, clienteNombre: 'Otro', monto: 999 }),
    ];
    expect(saldoAnteriorCliente(deudas, p)).toBe(800);
  });
  it('AC-RTO-5 ignora pagadas y anuladas; sin deuda => 0', () => {
    const p = ped();
    expect(saldoAnteriorCliente([deuda({ pagada: true }), deuda({ monto: 0, pagada: true, concepto: 'Anulada' })], p)).toBe(0);
    expect(saldoAnteriorCliente([], p)).toBe(0);
    expect(saldoAnteriorCliente(null, p)).toBe(0);
    expect(saldoAnteriorCliente([deuda()], null)).toBe(0);
  });
  it('AC-RTO-5 excluye las deudas de otros pedidos de la hoja', () => {
    const p1 = ped({ id: 1, remoteId: 'r1' });
    const p2 = ped({ id: 2, remoteId: 'r2' });
    const deudas = [deuda({ pedidoId: 'r2', monto: 400 }), deuda({ pedidoId: 'r7', monto: 100 })];
    expect(saldoAnteriorCliente(deudas, p1)).toBe(500);
    expect(saldoAnteriorCliente(deudas, p1, { excluirPedidos: [p2] })).toBe(100);
  });
  it('AC-RTO-5 cliente sin id se une por nombre', () => {
    expect(saldoAnteriorCliente([deuda({ clienteId: null, clienteNombre: ' ANA ' })], ped({ clienteId: null }))).toBe(500);
  });
});

describe('AC-HRU-1 filasHojaRuta', () => {
  const grupos = [
    { clave: 'norte', etiqueta: 'Norte', pedidos: [
      { orden: 1, pedido: ped({ id: 1, remoteId: 'r1', total: 1260, redondeoMultiplo: 500, estado: 'facturado' }) },
      { orden: 2, pedido: ped({ id: 2, remoteId: 'r2', clienteId: 11, clienteNombre: 'Beto', total: 2000 }) },
    ] },
    { clave: '', etiqueta: 'Sin zona', pedidos: [{ orden: 1, pedido: ped({ id: 3, remoteId: 'r3', clienteId: null, clienteNombre: '', total: 100 }) }] },
  ];
  it('AC-HRU-1 zonas, orden, importe con redondeo, saldo, total y totales', () => {
    const deudas = [deuda({ id: 'v', pedidoId: 'r9', monto: 300 }), deuda({ id: 'w', clienteId: 11, clienteNombre: 'Beto', pedidoId: 'r10', monto: 50 })];
    const r = filasHojaRuta(grupos, { deudas, direccionDe: (p) => (p.clienteId === 10 ? 'Calle 1' : '') });
    expect(r.filas).toHaveLength(3);
    expect(r.filas[0]).toMatchObject({ zona: 'Norte', orden: 1, clienteNombre: 'Ana', direccion: 'Calle 1', importe: 1500, saldoAnterior: 300, totalACobrar: 1800 });
    expect(r.filas[1]).toMatchObject({ orden: 2, importe: 2000, saldoAnterior: 50, totalACobrar: 2050 });
    expect(r.filas[2]).toMatchObject({ zona: 'Sin zona', clienteNombre: '', importe: 100, saldoAnterior: 0 });
    expect(r.totales).toEqual({ pedidos: 3, importe: 3600, saldoAnterior: 350, totalACobrar: 3950 });
  });
  it('AC-HRU-1 vista previa de redondeo para pendientes', () => {
    const r = filasHojaRuta([{ clave: 'a', etiqueta: 'A', pedidos: [{ orden: 1, pedido: ped({ total: 1260 }) }] }], { multiploVistaPrevia: 500 });
    expect(r.filas[0].importe).toBe(1500);
  });
  it('AC-HRU-1 dos pedidos del mismo cliente: el saldo anterior se cuenta una sola vez y sin sus propias deudas', () => {
    const g = [{ clave: 'a', etiqueta: 'A', pedidos: [
      { orden: 1, pedido: ped({ id: 1, remoteId: 'r1', total: 100 }) },
      { orden: 2, pedido: ped({ id: 2, remoteId: 'r2', total: 200 }) },
    ] }];
    const deudas = [deuda({ pedidoId: 'r1', monto: 100 }), deuda({ pedidoId: 'r2', monto: 200 }), deuda({ pedidoId: 'r0', monto: 40 })];
    const r = filasHojaRuta(g, { deudas });
    expect(r.filas.map(f => f.saldoAnterior)).toEqual([40, 0]);
    expect(r.totales.saldoAnterior).toBe(40);
  });
  it('AC-HRU-1 entradas vacias o invalidas', () => {
    expect(filasHojaRuta([], {}).totales).toEqual({ pedidos: 0, importe: 0, saldoAnterior: 0, totalACobrar: 0 });
    expect(filasHojaRuta(null).filas).toEqual([]);
    expect(filasHojaRuta([{ pedidos: [{ orden: 1 }, null] }]).filas).toEqual([]);
  });
});

describe('AC-DMP-1 validarCobro', () => {
  it('AC-DMP-1 sin medio => error', () => {
    const r = validarCobro({ referencia: 'x', monto: 10 }, deuda());
    expect(r.ok).toBe(false);
    expect(r.errores.join(' ')).toMatch(/medio de pago/i);
    expect(validarCobro({ medio: 'cheque' }, deuda()).ok).toBe(false);
  });
  it('AC-DMP-1 medio valido, referencia opcional recortada y monto limitado al saldo', () => {
    expect(validarCobro({ medio: 'Efectivo' }, deuda())).toEqual({ ok: true, errores: [], cobro: { medio: 'efectivo', referencia: '', montoCents: 50000 } });
    const r = validarCobro({ medio: 'transferencia', referencia: '  Op 123  ', monto: 9999 }, deuda());
    expect(r.cobro).toEqual({ medio: 'transferencia', referencia: 'Op 123', montoCents: 50000 });
    expect(validarCobro({ medio: 'efectivo', monto: 120.5 }, deuda()).cobro.montoCents).toBe(12050);
  });
  it('AC-DMP-1 referencia larga, monto invalido o deuda saldada => error', () => {
    expect(validarCobro({ medio: 'efectivo', referencia: 'x'.repeat(61) }, deuda()).ok).toBe(false);
    expect(validarCobro({ medio: 'efectivo', monto: 0 }, deuda()).ok).toBe(false);
    expect(validarCobro({ medio: 'efectivo', monto: 'abc' }, deuda()).ok).toBe(false);
    expect(validarCobro({ medio: 'efectivo' }, deuda({ pagada: true })).ok).toBe(false);
  });
});

describe('AC-DMP-1 registrarCobroEnDeuda', () => {
  const opts = (id) => ({ now: 1000, genId: () => id, por: 'Admin' });
  it('AC-DMP-1 suma el pago, anota el cobro con UUID y no muta', () => {
    const d = deuda();
    const r = registrarCobroEnDeuda(d, { medio: 'efectivo', montoCents: 20000, referencia: 'a' }, opts('u1'));
    expect(r).toMatchObject({ montoPagado: 200, pagada: false, medioPago: 'efectivo', referenciaPago: 'a' });
    expect(r.cobros).toEqual([{ id: 'u1', montoCents: 20000, medio: 'efectivo', referencia: 'a', at: 1000, por: 'Admin' }]);
    expect(d.cobros).toBeUndefined();
  });
  it('AC-DMP-1 mezclar medios => mixto y se salda', () => {
    const a = registrarCobroEnDeuda(deuda(), { medio: 'efectivo', montoCents: 20000 }, opts('u1'));
    const b = registrarCobroEnDeuda(a, { medio: 'transferencia', montoCents: 30000 }, opts('u2'));
    expect(b).toMatchObject({ montoPagado: 500, pagada: true, pagadaAt: 1000, medioPago: 'mixto' });
    expect(b.cobros).toHaveLength(2);
  });
  it('AC-DMP-1 idempotente por id de cobro y tope al saldo', () => {
    const a = registrarCobroEnDeuda(deuda(), { id: 'dup', medio: 'efectivo', montoCents: 10000 }, opts('x'));
    expect(registrarCobroEnDeuda(a, { id: 'dup', medio: 'efectivo', montoCents: 10000 }, opts('y'))).toBe(a);
    const tope = registrarCobroEnDeuda(deuda(), { medio: 'efectivo', montoCents: 999999 }, opts('z'));
    expect(tope.montoPagado).toBe(500);
    expect(registrarCobroEnDeuda(deuda({ pagada: true }), { medio: 'efectivo', montoCents: 100 }, opts('q')).cobros).toBeUndefined();
  });
});

describe('AC-DMP-1 totalesPorMedio', () => {
  it('AC-DMP-1 totales por medio y pagos viejos como "sin dato"', () => {
    const r = totalesPorMedio([
      deuda({ cobros: [{ id: '1', medio: 'efectivo', montoCents: 10000 }, { id: '2', medio: 'transferencia', montoCents: 5000 }] }),
      deuda({ cobros: [{ id: '3', medio: 'rendicion', montoCents: 700 }] }),
      deuda({ montoPagado: 20.5 }), // pago viejo sin historial
      deuda({ montoPagado: 0 }),
      null,
    ]);
    expect(r).toEqual({ efectivo: 10000, transferencia: 5000, rendicion: 700, sinDato: 2050 });
  });
});

describe('AC-DMP-1 sync 025 tolerante', () => {
  it('AC-DMP-1 toRemote solo manda lo que la deuda conoce', () => {
    expect(deudaMedioToRemote({})).toEqual({});
    expect(deudaMedioToRemote(null)).toEqual({});
    const r = deudaMedioToRemote({ medioPago: 'mixto', referenciaPago: 'abc', cobros: [{ id: 'u', montoCents: 100, medio: 'efectivo', at: 5 }, { id: '', montoCents: 5 }] });
    expect(r.medio_pago).toBe('mixto');
    expect(r.referencia_pago).toBe('abc');
    expect(r.cobros).toEqual([{ id: 'u', montoCents: 100, medio: 'efectivo', referencia: '', at: 5, por: null }]);
    expect(deudaMedioToRemote({ medioPago: 'bitcoin' })).toEqual({});
  });
  it('AC-DMP-1 fromRemote conserva lo local si faltan columnas y sanea', () => {
    const local = { medioPago: 'efectivo', referenciaPago: 'r', cobros: [{ id: '1' }] };
    expect(deudaMedioFromRemote({}, local)).toEqual(local);
    expect(deudaMedioFromRemote({}, {})).toEqual({});
    const r = deudaMedioFromRemote({ medio_pago: 'transferencia', referencia_pago: 'T', cobros: [{ id: 'a', montoCents: 5, medio: 'raro' }, 'basura'] }, null);
    expect(r).toEqual({ medioPago: 'transferencia', referenciaPago: 'T', cobros: [{ id: 'a', montoCents: 5, medio: 'sinDato', referencia: '', at: null, por: null }] });
  });
  it('AC-DMP-1 sinColumnasDmp / nombraColumnaDmp', () => {
    expect(sinColumnasDmp({ monto: 1, medio_pago: 'x', referencia_pago: 'y', cobros: [] })).toEqual({ monto: 1 });
    expect(nombraColumnaDmp({ message: "Could not find the 'medio_pago' column of 'deudas' in the schema cache" })).toBe(true);
    expect(nombraColumnaDmp({ message: 'column "cobros" of relation "deudas" does not exist' })).toBe(true);
    expect(nombraColumnaDmp({ message: 'otro error' })).toBe(false);
  });
});
