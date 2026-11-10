// Correcciones de seguridad/QA tanda 2: S-T2-03, S-T2-06, S-T2-07, BUG-1, BUG-2.
import { unirCobrosDeuda, filasHojaRuta, totalesPorMedio, validarCobro } from '../cobranza';
import { redondeoFromRemote } from '../redondeo';

const cobro = (id, cents, medio, at = 1) => ({ id, montoCents: cents, medio, referencia: '', at, por: 'A' });

describe('S-T2-03 unirCobrosDeuda (AC-DMP-1)', () => {
  it('AC-DMP-1 une por id, recalcula montoPagado y marca medio mixto', () => {
    const u = unirCobrosDeuda(
      { monto: 1000, montoPagado: 200, cobros: [cobro('a', 20000, 'efectivo', 2)] },
      { monto: 1000, montoPagado: 300, cobros: [cobro('b', 30000, 'transferencia', 1)] },
    );
    expect(u.cobros.map(c => c.id)).toEqual(['b', 'a']);
    expect(u.montoPagado).toBe(500);
    expect(u.medioPago).toBe('mixto');
    expect(u.hayLocalesNuevos).toBe(true);
    expect(u.pagada).toBe(false);
  });
  it('AC-DMP-1 es idempotente, respeta el tope del monto y conserva pagos viejos sin historial', () => {
    const l = { monto: 500, montoPagado: 300, cobros: [cobro('a', 20000, 'efectivo')] }; // 100 viejos
    const u = unirCobrosDeuda(l, l);
    expect(u.cobros).toHaveLength(1);
    expect(u.montoPagado).toBe(300);
    const tope = unirCobrosDeuda({ monto: 300, cobros: [cobro('a', 20000, 'efectivo')] }, { monto: 300, cobros: [cobro('b', 20000, 'efectivo')] });
    expect(tope.montoPagado).toBe(300);
    expect(tope.pagada).toBe(true);
  });
  it('AC-DMP-1 sin cobros en ningun lado devuelve null', () => {
    expect(unirCobrosDeuda({ monto: 1 }, { monto: 1 })).toBeNull();
  });
});

describe('S-T2-06 redondeo congelado que vuelve de una app vieja', () => {
  it('AC-RED-2 fila remota pendiente con multiplo viejo: se limpian las 3 claves', () => {
    const out = redondeoFromRemote({ estado: 'pendiente', redondeo_multiplo: 500, redondeo: 50, total_redondeado: 1500 }, { redondeoMultiplo: 500 });
    expect(out).toEqual({ redondeo: null, redondeoMultiplo: null, totalRedondeado: null });
  });
  it('AC-RED-2 fila facturada conserva el multiplo', () => {
    expect(redondeoFromRemote({ estado: 'facturado', redondeo_multiplo: 500, redondeo: 50, total_redondeado: 1500 }, {}).redondeoMultiplo).toBe(500);
  });
});

describe('S-T2-07 hoja de ruta con cobros parciales', () => {
  it('AC-HRU-1 el importe de un pedido con deuda parcialmente cobrada es lo que falta', () => {
    const pedido = { id: 1, remoteId: 10, clienteId: 5, clienteNombre: 'Ana', total: 1000, estado: 'facturado' };
    const deudas = [{ id: 'd', clienteId: 5, clienteNombre: 'Ana', pedidoId: 10, monto: 1000, montoPagado: 400, pagada: false }];
    const r = filasHojaRuta([{ clave: 'n', etiqueta: 'Norte', pedidos: [{ pedido, orden: 1 }] }], { deudas });
    expect(r.filas[0]).toMatchObject({ importe: 600, saldoAnterior: 0, totalACobrar: 600 });
  });
});

describe('BUG-1 / BUG-2 (QA)', () => {
  it('AC-DMP-1 totalesPorMedio: pagos viejos + cobro con medio => sinDato conserva lo viejo', () => {
    const t = totalesPorMedio([{ montoPagado: 500, cobros: [cobro('a', 20000, 'efectivo')] }]);
    expect(t).toMatchObject({ efectivo: 20000, sinDato: 30000 });
  });
  it('AC-DMP-1 validarCobro rechaza montos que en centavos son 0', () => {
    expect(validarCobro({ medio: 'efectivo', monto: 0.004 }, { monto: 100, montoPagado: 0 }).ok).toBe(false);
    expect(validarCobro({ medio: 'efectivo', monto: 0.01 }, { monto: 100, montoPagado: 0 }).ok).toBe(true);
  });
});
