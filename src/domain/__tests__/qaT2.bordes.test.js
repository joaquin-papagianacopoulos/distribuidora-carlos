// QA Tanda 2 (run 20261110-t2): casos borde de REQ-RED / REQ-HRU / REQ-DMP / REQ-RTO que no cubren
// los tests del implementador. Solo funciones puras.
import { redondearTotal, aplicarRedondeoPedido, totalACobrar, desgloseTotalRemito, alFacturar, alRevertirPendiente, recalcularRedondeoCongelado } from '../redondeo';
import { filasHojaRuta, saldoAnteriorCliente, validarCobro, registrarCobroEnDeuda, totalesPorMedio } from '../cobranza';
import { armarReporteFacturas, tipoFacturaEfectivo } from '../facturacionAB';

describe('AC-RED-2 bordes de redondearTotal / aplicarRedondeoPedido', () => {
  it.each([
    [250, 500, 500], [249.99, 500, 0], [750, 500, 1000], [749.99, 500, 500], [500, 1000, 1000], [499.99, 1000, 0],
    [-750, 500, -500], [-749.99, 500, -500], [-250.01, 500, -500], [0, 1000, 0], ['1250', 500, 1500], [0.005, 500, 0],
  ])('AC-RED-2 redondearTotal(%p, %p) => %p', (t, m, esp) => expect(redondearTotal(t, m)).toBe(esp));

  it("AC-RED-2 multiplo 0, '0', null y 'sin redondeo' dejan el total intacto", () => {
    for (const m of [0, '0', null, undefined, '', 'sin redondeo']) expect(redondearTotal(1234.56, m)).toBe(1234.56);
  });

  it('AC-RED-2 un pedido de $200 con multiplo 500 NO se redondea (no se pierde la deuda)', () => {
    expect(aplicarRedondeoPedido({ total: 200 }, 500)).toEqual({ redondeo: 0, redondeoMultiplo: 500, totalRedondeado: 200 });
    expect(aplicarRedondeoPedido({ total: 249 }, 500).totalRedondeado).toBe(249);
    expect(aplicarRedondeoPedido({ total: 250 }, 500).totalRedondeado).toBe(500);
  });

  it('AC-RED-2 pedido de $0, vacio o null no explota ni inventa deuda', () => {
    expect(aplicarRedondeoPedido({ total: 0 }, 500).totalRedondeado).toBe(0);
    expect(aplicarRedondeoPedido({}, 500).totalRedondeado).toBe(0);
    expect(aplicarRedondeoPedido(null, 500).totalRedondeado).toBe(0);
    expect(totalACobrar(null)).toBe(0);
    expect(totalACobrar(undefined)).toBe(0);
  });

  it('AC-RED-2 pedido con total negativo no lanza y el ajuste es coherente (total + redondeo = totalRedondeado)', () => {
    const r = aplicarRedondeoPedido({ total: -1300 }, 500);
    expect(r.totalRedondeado).toBe(-1500);
    expect(Math.round((-1300 + r.redondeo) * 100) / 100).toBe(r.totalRedondeado);
  });
});

describe('AC-RED-2 redondeo congelado al facturar', () => {
  const pend = { id: 1, estado: 'pendiente', total: 1260 };

  it('AC-RED-2 multiplo congelado en 0 (sin redondeo) NO cae al default 500 al leer', () => {
    const f = alFacturar(pend, 0);
    expect(f.redondeoMultiplo).toBe(0);
    expect(totalACobrar(f)).toBe(1260);
    expect(desgloseTotalRemito(f)).toEqual({ subtotal: 1260, redondeo: 0, total: 1260 });
  });

  it('AC-RED-2 cambiar la config despues de facturar no recalcula pedidos ya facturados', () => {
    const f = alFacturar(pend, 500); // 1260 => 1500
    expect(totalACobrar(f)).toBe(1500);
    // el admin pasa a $1000 y se vuelve a "facturar" (idempotente) => se mantiene el multiplo de antes
    const otra = alFacturar(f, 1000);
    expect(otra.redondeoMultiplo).toBe(500);
    expect(totalACobrar(otra, { multiploVistaPrevia: 1000 })).toBe(1500); // la vista previa no pisa al congelado
  });

  it('AC-RED-2 pedido viejo facturado (sin claves) no se redondea ni con vista previa ni al editar', () => {
    const viejo = { id: 2, estado: 'facturado', total: 1260 };
    expect(totalACobrar(viejo, { multiploVistaPrevia: 500 })).toBe(1260);
    expect(recalcularRedondeoCongelado({ ...viejo, total: 1310 })).toEqual({ ...viejo, total: 1310 });
    expect(totalACobrar({ ...viejo, total: 1310 })).toBe(1310);
  });

  it('AC-RED-2 pedido pendiente sin vista previa vale su total; con vista previa se redondea', () => {
    expect(totalACobrar(pend)).toBe(1260);
    expect(totalACobrar(pend, { multiploVistaPrevia: 500 })).toBe(1500);
    expect(totalACobrar({ ...pend, estado: 'Pendiente' }, { multiploVistaPrevia: 0 })).toBe(1260);
  });

  it('AC-RED-2 editar un facturado recalcula el ajuste con SU multiplo y el redondeo guardado viejo no manda', () => {
    const f = alFacturar(pend, 500);
    const editado = recalcularRedondeoCongelado({ ...f, total: 1010 });
    expect(editado.totalRedondeado).toBe(1000);
    expect(editado.redondeo).toBe(-10);
    // un total/ajuste desactualizado (edicion desde app vieja) igual se lee bien
    expect(totalACobrar({ ...f, total: 1010, totalRedondeado: 1500, redondeo: 240 })).toBe(1000);
  });

  it('AC-RED-2 revertir y refacturar: pasa a nuevo ajuste; deuda = totalACobrar en cada paso', () => {
    const f = alFacturar(pend, 500);
    const rev = alRevertirPendiente(f);
    expect(rev).toMatchObject({ redondeo: null, redondeoMultiplo: null, totalRedondeado: null });
    expect(totalACobrar(rev)).toBe(1260);
    expect(totalACobrar(alFacturar(rev, 1000))).toBe(1000);
  });
});

describe('AC-HRU-1 / AC-RTO-5 hoja de ruta: consistencia con la deuda', () => {
  const ped = (o) => ({ id: o.id, remoteId: `R${o.id}`, clienteId: o.c, clienteNombre: o.n, total: o.total, estado: 'facturado', ...o.x });
  const deuda = (o) => ({ id: o.id, clienteId: o.c, clienteNombre: o.n, monto: o.monto, montoPagado: o.pagado || 0, pagada: !!o.p, pedidoId: o.pedidoId ?? null, pedidoLocalId: null });
  const zonas = (pedidos) => [{ etiqueta: 'Norte', clave: 'norte', pedidos: pedidos.map((pedido, i) => ({ orden: i + 1, pedido })) }];

  it('AC-HRU-1 el importe de la fila coincide con el monto de la deuda del pedido redondeado', () => {
    const p = { ...ped({ id: 1, c: 5, n: 'A', total: 1260 }), ...alFacturar({ total: 1260 }, 500) };
    const r = filasHojaRuta(zonas([p]), { deudas: [] });
    expect(r.filas[0].importe).toBe(1500);
    expect(r.filas[0].importe).toBe(totalACobrar(p)); // lo que registrarDeudaFacturado anota
    expect(r.totales).toMatchObject({ importe: 1500, saldoAnterior: 0, totalACobrar: 1500 });
  });

  it('AC-HRU-1 saldo anterior: parcialmente pagada cuenta solo el saldo; anulada/pagada no; una vez por cliente aunque tenga 3 pedidos', () => {
    const ps = [ped({ id: 1, c: 5, n: 'A', total: 1000 }), ped({ id: 2, c: 5, n: 'A', total: 2000 }), ped({ id: 3, c: 5, n: 'A', total: 500 }), ped({ id: 4, c: 6, n: 'B', total: 700 })];
    const deudas = [
      deuda({ id: 'd0', c: 5, n: 'A', monto: 900, pagado: 400 }), // saldo 500
      deuda({ id: 'd1', c: 5, n: 'A', monto: 300, p: true }), // pagada
      deuda({ id: 'd2', c: 5, n: 'A', monto: 1000, pedidoId: 'R1' }), // del propio pedido de la hoja: no cuenta
      deuda({ id: 'd3', c: 6, n: 'B', monto: 250 }),
    ];
    const r = filasHojaRuta(zonas(ps), { deudas });
    expect(r.filas.map(f => f.saldoAnterior)).toEqual([500, 0, 0, 250]);
    expect(r.totales.saldoAnterior).toBe(750);
    expect(r.totales.importe).toBe(4200);
    expect(r.totales.totalACobrar).toBe(4950);
    expect(r.totales.totalACobrar).toBe(r.totales.importe + r.totales.saldoAnterior);
  });

  it('AC-RTO-5 cliente con ids distintos pero mismo nombre no mezcla deudas', () => {
    const p = ped({ id: 1, c: 5, n: 'Kiosco', total: 100 });
    const deudas = [deuda({ id: 'x', c: 99, n: 'Kiosco', monto: 800 })];
    expect(saldoAnteriorCliente(deudas, p)).toBe(0);
  });

  it('AC-HRU-1 centavos: la suma de totales no acumula error de punto flotante', () => {
    const ps = [ped({ id: 1, c: 1, n: 'A', total: 0.1 }), ped({ id: 2, c: 2, n: 'B', total: 0.2 }), ped({ id: 3, c: 3, n: 'C', total: 0.3 })];
    expect(filasHojaRuta(zonas(ps), {}).totales.importe).toBe(0.6);
  });

  it('AC-HRU-1 hoja sin pedidos / zona vacia => totales en cero', () => {
    expect(filasHojaRuta([{ etiqueta: 'X', pedidos: [] }], {}).totales).toEqual({ pedidos: 0, importe: 0, saldoAnterior: 0, totalACobrar: 0 });
  });
});

describe('AC-DMP-1 bordes de cobro con medio de pago', () => {
  const deuda = (o = {}) => ({ id: 'd', monto: 1000, montoPagado: 0, pagada: false, ...o });
  const cobro = (m, cents, id) => ({ id, medio: m, montoCents: cents });

  it('AC-DMP-1 medio con mayusculas/espacios se acepta; "mixto", "rendicion", "" y null no', () => {
    expect(validarCobro({ medio: ' Efectivo ', monto: 10 }, deuda()).ok).toBe(true);
    expect(validarCobro({ medio: 'TRANSFERENCIA' }, deuda()).cobro.medio).toBe('transferencia');
    for (const m of ['mixto', 'rendicion', '', null, undefined, 5, 'cheque']) expect(validarCobro({ medio: m, monto: 10 }, deuda()).ok).toBe(false);
  });

  it('AC-DMP-1 idempotencia: reenviar el mismo cobro (mismo UUID) no suma dos veces aunque se repita 3 veces', () => {
    let d = deuda();
    const c = cobro('efectivo', 30000, 'uuid-1');
    for (let i = 0; i < 3; i++) d = registrarCobroEnDeuda(d, c);
    expect(d.montoPagado).toBe(300);
    expect(d.cobros).toHaveLength(1);
  });

  it('AC-DMP-1 cobrar una deuda ya saldada o con monto negativo no cambia nada', () => {
    const saldada = deuda({ pagada: true, montoPagado: 1000 });
    expect(registrarCobroEnDeuda(saldada, cobro('efectivo', 100, 'a'))).toBe(saldada);
    const d = deuda();
    expect(registrarCobroEnDeuda(d, cobro('efectivo', -500, 'b'))).toBe(d);
    expect(registrarCobroEnDeuda(d, cobro('efectivo', 0, 'c'))).toBe(d);
  });

  it('AC-DMP-1 pago de $0,004 (menos de un centavo) debe rechazarse como monto invalido', () => {
    // BUG (menor): validarCobro da ok:true con montoCents 0 y la UI mostraria "cobrado" sin que cambie nada.
    const v = validarCobro({ medio: 'efectivo', monto: 0.004 }, deuda());
    expect(v.ok).toBe(false);
  });

  it('AC-DMP-1 totales por medio: pagos viejos y nuevos en la misma deuda no se pierden', () => {
    // Deuda con $300 cobrados ANTES de la migracion (sin historial) + un cobro nuevo de $200 en efectivo.
    const vieja = deuda({ montoPagado: 300 });
    const d = registrarCobroEnDeuda(vieja, cobro('efectivo', 20000, 'n1'));
    expect(d.montoPagado).toBe(500);
    const t = totalesPorMedio([d]);
    const sumaMedios = t.efectivo + t.transferencia + t.rendicion + t.sinDato;
    // BUG: el historial solo tiene el cobro nuevo, asi que los $300 viejos desaparecen de "Cobrado por medio"
    // (esperado: sinDato = 30000, suma = montoPagado*100 = 50000).
    expect(sumaMedios).toBe(50000);
    expect(t.sinDato).toBe(30000);
  });

  it('AC-DMP-1 totales por medio: la suma de medios + sin dato = lo cobrado en deudas con y sin historial', () => {
    const a = registrarCobroEnDeuda(deuda({ id: 'a' }), cobro('transferencia', 12345, 'x'));
    const b = deuda({ id: 'b', montoPagado: 50.5 });
    const t = totalesPorMedio([a, b, null, undefined]);
    expect(t).toMatchObject({ transferencia: 12345, sinDato: 5050, efectivo: 0 });
  });
});

describe('AC-RTO-1 / AC-FAB-3 pedidos viejos sin campos nuevos', () => {
  it('AC-RTO-1 tipoFacturaEfectivo sin marca => ninguna, con marca la respeta', () => {
    expect(tipoFacturaEfectivo({}, { tipoIva: 'Responsable Inscripto' }).tipo).toBe('ninguna');
    expect(tipoFacturaEfectivo({ tipoFactura: 'B' }, null)).toMatchObject({ tipo: 'B', sugerido: false });
  });

  it('AC-FAB-3 facturados viejos sin marca siguen en "Facturas a emitir" con la sugerencia por IVA; marcados "ninguna" quedan afuera', () => {
    const base = { fecha: '2026-10-02', estado: 'facturado', total: 100, clienteNombre: 'X' };
    const r = armarReporteFacturas([
      { ...base, pedidoId: '1', tipoIva: 'Responsable Inscripto' },
      { ...base, pedidoId: '2', tipoIva: 'Monotributo' },
      { ...base, pedidoId: '3', tipoIva: 'Responsable Inscripto', tipoFactura: 'ninguna' },
      { ...base, pedidoId: '4', tipoIva: '' },
    ], { desde: '2026-10-01', hasta: '2026-10-31' });
    expect(r.grupos.map(g => [g.tipo, g.filas.map(f => f.pedidoId)])).toEqual([['A', ['1']], ['B', ['2']]]);
    expect(r.grupos.every(g => g.filas.every(f => f.sugerido))).toBe(true);
  });
});
