// REQ-REN (AC-REN-1..6): dominio puro de la rendicion (devoluciones, cambios y NC).
import {
  disponiblesParaDevolver, validarRendicion, diferenciaCambioCents, creditoRendicion, comisionRenglonesDe,
  movimientosRendicion, movimientosAnulacionRendicion, planEfectoCuenta, planAnulacionCuenta,
  saldoAFavorCliente, cuentaParaBoleta, resumenRendicionDia, pedidoTieneRendicionVigente, pedidoNetoParaComision,
  rendicionToRemote, rendicionFromRemote, cuentaClienteToRemote, cuentaClienteFromRemote, interpretarRpcRendicion,
  asientoSaldoFavor, idCorto, conceptoCargo, conceptoReversion, pagadaPorRendicion, cuentaComoVigente,
  rendicionesDelPedido, MSG_PEDIDO_CON_RENDICION, MOTIVOS_RECHAZO,
} from '../rendicion';
import { calcularStock, esRefRendicion, idRendicionDeRef, TIPOS_MOVIMIENTO, revisarMovimientosPedido } from '../stock';

const ID = '11111111-2222-4333-8444-555555555555';
const genId = () => ID;
const now = new Date('2026-10-15T15:00:00Z');
const item = (productoId, cantidad, precio, extra = {}) => ({ productoId, nombre: `Prod ${productoId}`, cantidad, precio, ...extra });
const pedido = (extra = {}) => ({
  id: 7, remoteId: 70, clienteId: 5, clienteNombre: 'Kiosco Pepe', estado: 'facturado', fecha: '2026-10-14', total: 1700,
  items: [item(1, 10, 100, { rubro: 'Golosinas' }), item(2, 2, 350, { rubro: 'Bebidas' })], ...extra,
});
const productos = [
  { id: 1, nombre: 'Prod 1', precio: 100, categoria: 'Golosinas' },
  { id: 2, nombre: 'Prod 2', precio: 350, categoria: 'Bebidas' },
  { id: 3, nombre: 'Prod 3', precio: 120, categoria: 'Limpieza' },
];
const ctx = (extra = {}) => ({ pedido: pedido(), rendiciones: [], productos, usuario: 'Admin', now, genId, ...extra });
const rend = (extra = {}) => ({ id: 'r1', pedidoId: '70', estado: 'vigente', syncEstado: 'confirmada', tipo: 'devolucion', renglones: [], ...extra });

describe('AC-REN-6 disponiblesParaDevolver', () => {
  it('AC-REN-6 facturado menos lo devuelto en rendiciones vigentes (anuladas y rechazadas no cuentan)', () => {
    const rs = [
      rend({ renglones: [{ productoId: '1', cantidad: 3, sentido: 'entra' }, { productoId: '3', cantidad: 9, sentido: 'sale' }] }),
      rend({ id: 'r2', estado: 'anulada', renglones: [{ productoId: '1', cantidad: 5, sentido: 'entra' }] }),
      rend({ id: 'r3', syncEstado: 'rechazada', renglones: [{ productoId: '1', cantidad: 5, sentido: 'entra' }] }),
      rend({ id: 'r4', pedidoId: '99', renglones: [{ productoId: '1', cantidad: 5, sentido: 'entra' }] }),
      rend({ id: 'r5', renglones: [{ productoId: '8', cantidad: 1, sentido: 'entra' }] }),
    ];
    const d = disponiblesParaDevolver(pedido(), rs);
    expect(d.get('1')).toMatchObject({ facturado: 10, devuelto: 3, disponible: 7, precioCents: 10000, nombre: 'Prod 1' });
    expect(d.get('2')).toMatchObject({ facturado: 2, devuelto: 0, disponible: 2 });
  });

  it('AC-REN-6 ignora eliminados, cantidades inválidas y sin producto; varios renglones suman y toman el menor precio', () => {
    const p = pedido({ items: [
      item(1, 4, 100), item(1, 1.5, 80), item(2, 3, 50, { eliminado: true }), item(null, 1, 1), item(4, 'x', 10), item(5, 2, 'abc'),
    ] });
    const d = disponiblesParaDevolver(p, []);
    expect(d.get('1')).toMatchObject({ facturado: 5.5, disponible: 5, precioCents: 8000 });
    expect(d.has('2')).toBe(false);
    expect(d.has('4')).toBe(false);
    expect(d.get('5').precioCents).toBe(0);
    expect(disponiblesParaDevolver(null).size).toBe(0);
  });
});

describe('AC-REN-1 validarRendicion', () => {
  it('AC-REN-1 devolución válida: crédito, comisión congelada por rubro y renglones', () => {
    const r = validarRendicion({ tipo: 'devolucion', motivo: 'Vencido', renglones: [{ productoId: 1, cantidad: '3' }, { productoId: 2, cantidad: 1, vuelveAlStock: false }] }, ctx());
    expect(r.ok).toBe(true);
    const x = r.rendicion;
    expect(x).toMatchObject({ id: ID, pedidoId: '70', pedidoLocalId: 7, clienteId: '5', tipo: 'devolucion', estado: 'vigente', creditoCents: 30000 + 35000, fecha: '2026-10-15', usuario: 'Admin', tipoFactura: null, nroNc: null });
    expect(x.renglones).toEqual([
      expect.objectContaining({ productoId: '1', cantidad: 3, precioCents: 10000, vuelveAlStock: true, sentido: 'entra', rubroClave: 'golosinas' }),
      expect.objectContaining({ productoId: '2', cantidad: 1, precioCents: 35000, vuelveAlStock: false, sentido: 'entra', rubroClave: 'bebidas' }),
    ]);
    expect(x.comisionRenglones).toEqual([
      { rubroClave: 'bebidas', rubro: 'Bebidas', subtotalCents: -35000 },
      { rubroClave: 'golosinas', rubro: 'Golosinas', subtotalCents: -30000 },
    ]);
    expect(x.creditoComisionCents).toBe(65000);
  });

  it('AC-REN-1 límites de cantidad: no más de lo facturado menos lo ya devuelto, enteros > 0, sin repetir', () => {
    const ya = [rend({ renglones: [{ productoId: '1', cantidad: 8, sentido: 'entra' }] })];
    const r = validarRendicion({ tipo: 'devolucion', motivo: 'Roto', renglones: [{ productoId: 1, cantidad: 3 }] }, ctx({ rendiciones: ya }));
    expect(r.ok).toBe(false);
    expect(r.errores['item:1']).toMatch(/hasta 2/);
    const r2 = validarRendicion({ tipo: 'devolucion', motivo: 'Roto', renglones: [{ productoId: 1, cantidad: 1.5 }, { productoId: 2, cantidad: 0 }, { productoId: 9, cantidad: 1 }] }, ctx());
    expect(Object.keys(r2.errores)).toEqual(expect.arrayContaining(['item:1', 'item:2', 'item:9']));
    const r3 = validarRendicion({ tipo: 'devolucion', motivo: 'Roto', renglones: [{ productoId: 1, cantidad: 1 }, { productoId: 1, cantidad: 1 }] }, ctx());
    expect(r3.errores['item:1']).toMatch(/repetido/);
    expect(validarRendicion({ tipo: 'devolucion', motivo: 'Roto', renglones: [] }, ctx()).errores.renglones).toBeTruthy();
  });

  it('AC-REN-1 pedido no facturado, borrado, sin remoteId o sin cliente => error de pedido', () => {
    const f = { tipo: 'nc', motivo: 'Bonif', montoNc: 10 };
    expect(validarRendicion(f, ctx({ pedido: null })).errores.pedido).toBeTruthy();
    expect(validarRendicion(f, ctx({ pedido: pedido({ estado: 'pendiente' }) })).errores.pedido).toMatch(/facturados/);
    expect(validarRendicion(f, ctx({ pedido: pedido({ borrado: true }) })).errores.pedido).toMatch(/facturados/);
    expect(validarRendicion(f, ctx({ pedido: pedido({ remoteId: null }) })).errores.pedido).toMatch(/sincroniz/);
    expect(validarRendicion(f, ctx({ pedido: pedido({ clienteId: null }) })).errores.pedido).toMatch(/cliente/);
  });

  it('AC-REN-1 tipo y motivo obligatorios (3..300)', () => {
    expect(validarRendicion({ tipo: 'otro', motivo: 'ab' }, ctx()).errores).toMatchObject({ tipo: expect.any(String), motivo: expect.any(String) });
    expect(validarRendicion({ tipo: 'nc', motivo: 'x'.repeat(301), montoNc: 1 }, ctx()).errores.motivo).toMatch(/300/);
    expect(validarRendicion(null, ctx()).ok).toBe(false);
  });

  it('AC-REN-1 nota de crédito: monto > 0 y <= total - créditos previos; A/B y n.º opcionales', () => {
    const ok = validarRendicion({ tipo: 'nc', motivo: 'Bonificación', montoNc: '200,50', tipoFactura: 'Factura A', nroNc: ' 0001-00000123 ' }, ctx());
    expect(ok.ok).toBe(true);
    expect(ok.rendicion).toMatchObject({ tipo: 'nc', creditoCents: 20050, tipoFactura: 'A', nroNc: '0001-00000123', renglones: [] });
    // Prorrateo por rubro del pedido (1000 golosinas / 700 bebidas), suma exacta.
    expect(ok.rendicion.comisionRenglones.reduce((a, c) => a + c.subtotalCents, 0)).toBe(-20050);
    expect(ok.rendicion.creditoComisionCents).toBe(20050);
    expect(validarRendicion({ tipo: 'nc', motivo: 'Bonif', montoNc: 0 }, ctx()).errores.montoNc).toBeTruthy();
    const previos = [rend({ tipo: 'nc', creditoCents: 160000 })];
    expect(validarRendicion({ tipo: 'nc', motivo: 'Bonif', montoNc: 101 }, ctx({ rendiciones: previos })).errores.montoNc).toMatch(/no puede pasar/);
    expect(validarRendicion({ tipo: 'nc', motivo: 'Bonif', montoNc: 100 }, ctx({ rendiciones: previos })).ok).toBe(true);
    expect(validarRendicion({ tipo: 'nc', motivo: 'Bonif', montoNc: 1, tipoFactura: 'C' }, ctx()).errores.tipoFactura).toBeTruthy();
    expect(validarRendicion({ tipo: 'nc', motivo: 'Bonif', montoNc: 1, tipoFactura: 'ninguna' }, ctx()).rendicion.tipoFactura).toBeNull();
    expect(validarRendicion({ tipo: 'nc', motivo: 'Bonif', montoNc: 1, nroNc: '9'.repeat(31) }, ctx()).errores.nroNc).toBeTruthy();
  });

  it('AC-REN-1 NC sobre pedido sin rubros: todo a la clave vacía', () => {
    const p = pedido({ items: [{ productoId: 99, nombre: 'Sin rubro', cantidad: 1, precio: 1700 }] });
    const r = validarRendicion({ tipo: 'nc', motivo: 'Bonif', montoNc: 10 }, ctx({ pedido: p }));
    expect(r.rendicion.comisionRenglones).toEqual([{ rubroClave: '', rubro: '', subtotalCents: -1000 }]);
    const p2 = pedido({ items: [] });
    expect(validarRendicion({ tipo: 'nc', motivo: 'Bonif', montoNc: 10 }, ctx({ pedido: p2 })).rendicion.comisionRenglones).toEqual([{ rubroClave: '', rubro: '', subtotalCents: -1000 }]);
  });

  it('AC-REN-1 cambio: entra Y, sale X al precio actual, diferencia calculada', () => {
    const r = validarRendicion({ tipo: 'cambio', motivo: 'Cambio de sabor', renglones: [{ productoId: 2, cantidad: 1 }], sale: [{ productoId: 3, cantidad: 2 }] }, ctx());
    expect(r.ok).toBe(true);
    expect(r.rendicion.creditoCents).toBe(35000 - 24000);
    expect(r.rendicion.comisionRenglones).toEqual([
      { rubroClave: 'bebidas', rubro: 'Bebidas', subtotalCents: -35000 },
      { rubroClave: 'limpieza', rubro: 'Limpieza', subtotalCents: 24000 },
    ]);
    expect(r.rendicion.creditoComisionCents).toBe(11000);
    const caro = validarRendicion({ tipo: 'cambio', motivo: 'Cambio', renglones: [{ productoId: 1, cantidad: 1 }], sale: [{ productoId: 2, cantidad: 1 }] }, ctx());
    expect(caro.rendicion.creditoCents).toBe(-25000);
    const mismo = validarRendicion({ tipo: 'cambio', motivo: 'Cambio', renglones: [{ productoId: 1, cantidad: 1 }], sale: [{ productoId: 1, cantidad: 1 }] }, ctx());
    expect(mismo.rendicion.creditoCents).toBe(0);
    expect(mismo.rendicion.comisionRenglones).toEqual([]);
    expect(mismo.rendicion.creditoComisionCents).toBe(0);
  });

  it('AC-REN-1 cambio inválido: falta lo que sale, producto inexistente, repetido o sin precio', () => {
    const prods = [...productos, { id: 4, nombre: 'Sin precio', precio: 'x' }];
    const r = validarRendicion({ tipo: 'cambio', motivo: 'Cambio', renglones: [{ productoId: 1, cantidad: 1 }], sale: [{ productoId: 77, cantidad: 1 }, { productoId: 3, cantidad: 1 }, { productoId: 3, cantidad: 1 }, { productoId: 4, cantidad: 1 }, { productoId: 2, cantidad: -1 }] }, ctx({ productos: prods }));
    expect(Object.keys(r.errores)).toEqual(expect.arrayContaining(['sale:77', 'sale:3', 'sale:4', 'sale:2']));
    expect(validarRendicion({ tipo: 'cambio', motivo: 'Cambio', renglones: [{ productoId: 1, cantidad: 1 }] }, ctx()).errores.sale).toBeTruthy();
    expect(validarRendicion({ tipo: 'cambio', motivo: 'Cambio', sale: [{ productoId: 1, cantidad: 1 }] }, ctx()).errores.renglones).toMatch(/vuelve/);
  });

  it('AC-REN-1 demasiados renglones o crédito fuera de rango => error', () => {
    const items = Array.from({ length: 201 }, (_, i) => item(i + 1, 1, 1));
    const f = { tipo: 'devolucion', motivo: 'Lote', renglones: items.map(x => ({ productoId: x.productoId, cantidad: 1 })) };
    expect(validarRendicion(f, ctx({ pedido: pedido({ items }) })).errores.renglones).toMatch(/200/);
    const grande = pedido({ items: [item(1, 1000000, 999999999)] });
    const r = validarRendicion({ tipo: 'devolucion', motivo: 'Lote', renglones: [{ productoId: 1, cantidad: 1000000 }] }, ctx({ pedido: grande }));
    expect(r.ok).toBe(false);
  });
});

describe('AC-REN-6 cálculos de montos', () => {
  it('AC-REN-6 diferenciaCambioCents y creditoRendicion por tipo', () => {
    expect(diferenciaCambioCents([{ precioCents: 100, cantidad: 2 }], [{ precioCents: 50, cantidad: 1 }])).toBe(150);
    expect(diferenciaCambioCents()).toBe(0);
    expect(creditoRendicion({ tipo: 'nc', creditoCents: 77 })).toBe(77);
    expect(creditoRendicion({ tipo: 'nc' })).toBe(0);
    expect(creditoRendicion({ tipo: 'x' })).toBe(0);
    expect(creditoRendicion({ tipo: 'devolucion', renglones: [{ sentido: 'entra', precioCents: 10, cantidad: 3, vuelveAlStock: false }] })).toBe(30);
  });

  it('AC-REN-5 comisionRenglonesDe: devolución y cambio por rubro, NC prorrateada con suma exacta', () => {
    const r = { tipo: 'devolucion', renglones: [{ sentido: 'entra', precioCents: 100, cantidad: 2, rubroClave: 'a', rubro: 'A' }, { sentido: 'entra', precioCents: 1, cantidad: 1 }] };
    expect(comisionRenglonesDe(r, pedido())).toEqual([{ rubroClave: '', rubro: '', subtotalCents: -1 }, { rubroClave: 'a', rubro: 'A', subtotalCents: -200 }]);
    const p = pedido({ items: [item(1, 1, 1, { rubro: 'A' }), item(2, 1, 1, { rubro: 'B' }), item(3, 1, 1, { rubro: 'C' })] });
    const nc = comisionRenglonesDe({ tipo: 'nc', creditoCents: 100 }, p);
    expect(nc.map(x => x.subtotalCents)).toEqual([-34, -33, -33]);
    expect(nc.reduce((a, x) => a + x.subtotalCents, 0)).toBe(-100);
    const conSin = comisionRenglonesDe({ tipo: 'nc', creditoCents: 10 }, pedido({ items: [item(1, 1, 1, { rubro: 'A' }), item(9, 1, 1)] }));
    expect(conSin).toEqual([{ rubroClave: '', rubro: '', subtotalCents: -5 }, { rubroClave: 'a', rubro: 'A', subtotalCents: -5 }]);
    expect(comisionRenglonesDe(null, null)).toEqual([]);
  });
});

describe('AC-REN-2 movimientos de stock de la rendición', () => {
  const base = () => validarRendicion({ tipo: 'cambio', motivo: 'Cambio', renglones: [{ productoId: 1, cantidad: 2 }, { productoId: 2, cantidad: 1, vuelveAlStock: false }], sale: [{ productoId: 3, cantidad: 4 }] }, ctx()).rendicion;

  it('AC-REN-2 devolucion (+) por lo que vuelve, venta (-) por lo que sale, la merma no mueve stock', () => {
    const movs = movimientosRendicion(base());
    expect(movs.map(m => [m.id, m.productoId, m.cantidad, m.tipo, m.ref])).toEqual([
      [`${ID}:0:a`, '1', 2, 'devolucion', `rendicion:${ID}`],
      [`${ID}:2:a`, '3', -4, 'venta', `rendicion:${ID}`],
    ]);
    movs.forEach(m => {
      expect(m.ref.startsWith('pedido')).toBe(false);
      expect(m.id.length).toBeLessThanOrEqual(64);
      expect(m.nota).not.toMatch(/\$|Cambio de/);
      expect(esRefRendicion(m)).toBe(true);
    });
    expect(idRendicionDeRef(movs[0].ref)).toBe(ID);
    expect(idRendicionDeRef('pedido:1')).toBeNull();
    expect(TIPOS_MOVIMIENTO).toContain('devolucion');
  });

  it('AC-REN-2 idempotente: dos llamadas (o dos dispositivos) generan los mismos ids', () => {
    expect(movimientosRendicion(base())).toEqual(movimientosRendicion(base()));
  });

  it('AC-REN-2 renglones inválidos no generan movimiento', () => {
    const r = { id: 'x', renglones: [{ sentido: 'entra', cantidad: 1.5, productoId: 1 }, { sentido: 'otro', cantidad: 1, productoId: 1 }, null] };
    expect(movimientosRendicion(r)).toEqual([]);
    expect(movimientosRendicion(null)).toEqual([]);
  });

  it('AC-REN-4 anular revierte el stock al valor previo con ids :x deterministas', () => {
    const r = base();
    const alta = movimientosRendicion(r);
    const anul = movimientosAnulacionRendicion(r, { now, usuario: 'Otro' });
    expect(anul.map(m => [m.id, m.cantidad, m.tipo])).toEqual([[`${ID}:0:x`, -2, 'anulacion'], [`${ID}:2:x`, 4, 'anulacion']]);
    expect(anul[0].usuario).toBe('Otro');
    const previo = [{ productoId: '1', cantidad: 10 }, { productoId: '3', cantidad: 10 }];
    const stock = calcularStock([...previo, ...alta, ...anul]);
    expect(stock.get('1')).toBe(10);
    expect(stock.get('3')).toBe(10);
    expect(movimientosAnulacionRendicion(r)).toHaveLength(2);
  });

  it('AC-REN-2 revisarMovimientosPedido no "corrige" los movimientos de la rendición (ref distinta)', () => {
    const p = pedido();
    const ventas = revisarMovimientosPedido(p, [], { genId: () => 'v' }).movimientos;
    const dev = movimientosRendicion(base());
    expect(revisarMovimientosPedido(p, [...ventas, ...dev]).movimientos).toEqual([]);
  });
});

describe('AC-REN-3 plata: deudas, saldo a favor y boleta', () => {
  const deudas = [
    { id: 2, fecha: '2026-10-02', monto: 100, montoPagado: 0 },
    { id: 1, fecha: '2026-10-01', monto: 50, montoPagado: 20 },
    { id: 3, fecha: '2026-10-03', monto: 10, pagada: true },
  ];

  it('AC-REN-3 sin deuda: todo queda como saldo a favor', () => {
    expect(planEfectoCuenta(5000, [])).toEqual({ cobros: [], saldoFavorCents: 5000, cargoCents: 0 });
    expect(planEfectoCuenta(0)).toEqual({ cobros: [], saldoFavorCents: 0, cargoCents: 0 });
  });

  it('AC-REN-3 con deuda: cobra primero la más vieja; lo que sobra es saldo a favor', () => {
    expect(planEfectoCuenta(5000, deudas)).toEqual({ cobros: [{ deudaId: 1, deudaRemoteId: null, montoCents: 3000 }, { deudaId: 2, deudaRemoteId: null, montoCents: 2000 }], saldoFavorCents: 0, cargoCents: 0 });
    expect(planEfectoCuenta(20000, deudas).saldoFavorCents).toBe(7000);
  });

  it('AC-REN-3 diferencia a pagar en un cambio => cargo (suma a la deuda)', () => {
    expect(planEfectoCuenta(-2500, deudas)).toEqual({ cobros: [], saldoFavorCents: 0, cargoCents: 2500 });
  });

  it('AC-REN-3 saldoAFavorCliente y cuentaParaBoleta', () => {
    const cuenta = [{ clienteId: '5', montoCents: 700 }, { clienteId: 5, montoCents: -200 }, { clienteId: '6', montoCents: 999 }, null];
    expect(saldoAFavorCliente(cuenta, 5)).toBe(500);
    expect(saldoAFavorCliente(cuenta, null)).toBe(0);
    expect(saldoAFavorCliente(undefined, 5)).toBe(0);
    expect(cuentaParaBoleta(0, 500)).toEqual({ deudaPendiente: 0, saldoAFavor: 5 });
    expect(cuentaParaBoleta(10, 500)).toEqual({ deudaPendiente: 5, saldoAFavor: 0 });
    expect(cuentaParaBoleta(10, -500)).toEqual({ deudaPendiente: 15, saldoAFavor: 0 });
    expect(cuentaParaBoleta()).toEqual({ deudaPendiente: 0, saldoAFavor: 0 });
  });

  it('AC-REN-3 asiento de saldo a favor con id determinista y textos para deudas legacy', () => {
    const r = { id: ID, clienteId: 5 };
    expect(asientoSaldoFavor(r, 700, 'favor:a', { now, usuario: 'Admin' })).toEqual({ id: `${ID}:favor:a`, clienteId: '5', rendicionId: ID, tipo: 'saldo_favor', montoCents: 700, fecha: '2026-10-15', usuario: 'Admin' });
    expect(asientoSaldoFavor(r, 'x', 'favor:x').montoCents).toBe(0);
    expect(idCorto(ID)).toBe('11111111');
    expect(conceptoCargo(r)).toBe('Cambio rendición #11111111');
    expect(conceptoReversion(r)).toBe('Reversión rendición #11111111');
    expect(pagadaPorRendicion(r)).toBe('Rendición #11111111');
  });
});

describe('AC-REN-4 anulación: plan de reversión de la cuenta', () => {
  const r = { id: ID, clienteId: '5', efecto: { cobros: [{ montoCents: 300 }, { montoCents: 200 }], saldoFavorCents: 100, cargoCents: 0 } };

  it('AC-REN-4 compensa el saldo a favor y crea deuda de reversión por lo aplicado a deudas', () => {
    const cuenta = [{ id: `${ID}:favor:a`, rendicionId: ID, montoCents: 100 }, { id: 'otro', rendicionId: ID, montoCents: 999 }];
    expect(planAnulacionCuenta(r, [], cuenta)).toEqual({ saldoFavorCompensaCents: 100, deudaReversionCents: 500, anularDeudaCargoId: null, ajustarDeudaCargo: null, saldoFavorPorCargoCobradoCents: 0 });
    const yaCompensado = [...cuenta, { id: `${ID}:favor:x`, rendicionId: ID, montoCents: -100 }];
    expect(planAnulacionCuenta(r, [], yaCompensado).saldoFavorCompensaCents).toBe(0);
    expect(planAnulacionCuenta({ id: 'z' }).deudaReversionCents).toBe(0);
  });

  it('AC-REN-4 cargo de un cambio: sin cobros se anula; con cobros se devuelve lo cobrado como saldo a favor', () => {
    const rc = { id: ID, clienteId: '5', efecto: { cobros: [], cargoCents: 2500 } };
    const deuda = { id: 9, clienteId: 5, concepto: conceptoCargo(rc), monto: 25, montoPagado: 0 };
    expect(planAnulacionCuenta(rc, [deuda]).anularDeudaCargoId).toBe(9);
    const parcial = planAnulacionCuenta(rc, [{ ...deuda, montoPagado: 10 }]);
    expect(parcial).toMatchObject({ anularDeudaCargoId: null, saldoFavorPorCargoCobradoCents: 1000, ajustarDeudaCargo: { deudaId: 9, montoCents: 1000 } });
    const total = planAnulacionCuenta(rc, [{ ...deuda, montoPagado: 25, pagada: true }]);
    expect(total).toMatchObject({ saldoFavorPorCargoCobradoCents: 2500, ajustarDeudaCargo: null });
    expect(planAnulacionCuenta(rc, []).saldoFavorPorCargoCobradoCents).toBe(2500);
  });
});

describe('AC-REN-4 resumen de la rendición del día', () => {
  it('AC-REN-4 totales por tipo y mermas; anuladas/rechazadas listadas pero no suman', () => {
    const rs = [
      { id: 'a', fecha: '2026-10-15', createdAt: '2026-10-15T10:00:00Z', tipo: 'devolucion', estado: 'vigente', syncEstado: 'confirmada', creditoCents: 1000, renglones: [{ sentido: 'entra', nombre: 'Alfajor', cantidad: 2, precioCents: 250, vuelveAlStock: false }, { sentido: 'entra', nombre: 'Agua', cantidad: 1, precioCents: 500 }] },
      { id: 'b', fecha: '2026-10-15', createdAt: '2026-10-15T09:00:00Z', tipo: 'nc', estado: 'vigente', syncEstado: 'pendiente', creditoCents: 300, renglones: [] },
      { id: 'c', fecha: '2026-10-15', createdAt: '2026-10-15T11:00:00Z', tipo: 'cambio', estado: 'vigente', creditoCents: -200, renglones: [{ sentido: 'sale', nombre: 'Coca', cantidad: 1, precioCents: 700 }] },
      { id: 'd', fecha: '2026-10-15', createdAt: '2026-10-15T12:00:00Z', tipo: 'nc', estado: 'anulada', motivoAnulacion: 'error', creditoCents: 5000 },
      { id: 'e', fecha: '2026-10-15', createdAt: '2026-10-15T13:00:00Z', tipo: 'nc', estado: 'vigente', syncEstado: 'rechazada', creditoCents: 5000 },
      { id: 'f', fecha: '2026-10-14', tipo: 'nc', estado: 'vigente', creditoCents: 1 },
    ];
    const r = resumenRendicionDia(rs, '2026-10-15');
    expect(r.filas.map(f => f.id)).toEqual(['b', 'a', 'c', 'd', 'e']);
    expect(r.totales).toEqual({ devueltoCents: 1000, ncCents: 300, cambiosCents: -200, mermaCents: 500, mermaUnidades: 2, anuladas: 2 });
    expect(r.filas[1].detalle).toBe('Vuelve 2 Alfajor (merma) · Vuelve 1 Agua');
    expect(r.filas[0]).toMatchObject({ pendiente: true, tipoLabel: 'Nota de crédito' });
    expect(r.filas[3]).toMatchObject({ anulada: true, motivoAnulacion: 'error' });
    expect(resumenRendicionDia(undefined, 'x').filas).toEqual([]);
  });
});

describe('AC-REN-5 guardas y comisión neta', () => {
  it('AC-REN-5 pedidoTieneRendicionVigente bloquea revertir/borrar/editar', () => {
    expect(pedidoTieneRendicionVigente(pedido(), [rend()])).toBe(true);
    expect(pedidoTieneRendicionVigente(pedido(), [rend({ estado: 'anulada' })])).toBe(false);
    expect(pedidoTieneRendicionVigente(pedido({ remoteId: null }), [rend()])).toBe(false);
    expect(rendicionesDelPedido(pedido(), undefined)).toEqual([]);
    expect(cuentaComoVigente(null)).toBe(false);
    expect(MSG_PEDIDO_CON_RENDICION).toMatch(/Anulala/);
  });

  it('AC-REN-5 pedidoNetoParaComision: total menos crédito de comisión y extras congelados', () => {
    const p = pedido();
    expect(pedidoNetoParaComision(p, [])).toBe(p);
    const n = pedidoNetoParaComision(p, [rend({ creditoComisionCents: 30000, comisionRenglones: [{ rubroClave: 'golosinas', rubro: 'Golosinas', subtotalCents: -30000 }] })]);
    expect(n.total).toBe(1400);
    expect(n.comisionExtras).toEqual([{ rubroClave: 'golosinas', rubro: 'Golosinas', subtotalCents: -30000 }]);
    expect(pedidoNetoParaComision(p, [rend({ creditoComisionCents: 999999 })]).total).toBe(0);
  });
});

describe('AC-REN-1 mapeo remoto e interpretación de RPC', () => {
  const r = validarRendicion({ tipo: 'nc', motivo: 'Bonif', montoNc: 10, tipoFactura: 'B', nroNc: '12' }, ctx()).rendicion;

  it('AC-REN-1 rendicionToRemote / FromRemote ida y vuelta', () => {
    const row = rendicionToRemote(r);
    expect(row).toMatchObject({ id: ID, pedido_id: '70', cliente_id: '5', tipo: 'nc', credito_cents: 1000, credito_comision_cents: 1000, tipo_factura: 'B', nro_nc: '12', motivo: 'Bonif' });
    const back = rendicionFromRemote({ ...row, estado: 'vigente', updated_at: '2026-10-15T15:00:00Z', efecto: null }, { pedidoLocalId: 7, efectoAplicado: false });
    expect(back).toMatchObject({ id: ID, pedidoId: '70', pedidoLocalId: 7, creditoCents: 1000, syncEstado: 'confirmada', pendingSync: false, efectoAplicado: false, estado: 'vigente' });
    const ajena = rendicionFromRemote({ id: 'z', pedido_id: 1, estado: 'anulada', fecha: '2026-10-15', motivo_anulacion: 'x' });
    expect(ajena).toMatchObject({ estado: 'anulada', efectoAplicado: true, renglones: [], comisionRenglones: [], motivoAnulacion: 'x' });
    const dev = validarRendicion({ tipo: 'devolucion', motivo: 'Roto', renglones: [{ productoId: 1, cantidad: 1 }] }, ctx()).rendicion;
    expect(rendicionToRemote({ ...dev, clienteId: null }).renglones[0]).toEqual({ productoId: '1', nombre: 'Prod 1', cantidad: 1, precioCents: 10000, vuelveAlStock: true, sentido: 'entra', rubro: 'Golosinas', rubroClave: 'golosinas' });
  });

  it('AC-REN-3 cuenta de clientes ida y vuelta', () => {
    const c = { id: `${ID}:favor:a`, clienteId: 5, rendicionId: ID, tipo: 'saldo_favor', montoCents: 700, fecha: '2026-10-15', usuario: 'A' };
    const row = cuentaClienteToRemote(c);
    expect(row).toEqual({ id: `${ID}:favor:a`, cliente_id: '5', rendicion_id: ID, tipo: 'saldo_favor', monto_cents: 700, fecha: '2026-10-15', usuario: 'A' });
    expect(cuentaClienteFromRemote(row)).toMatchObject({ clienteId: '5', montoCents: 700, pendingSync: false });
  });

  it('AC-REN-1 interpretarRpcRendicion: pin, migración, rechazos y ya_anulada', () => {
    expect(interpretarRpcRendicion({ error: { code: 'PGRST202' } }).motivo).toBe('falta_migracion');
    expect(interpretarRpcRendicion({ error: { message: 'Demasiados intentos' } }).motivo).toBe('bloqueado');
    expect(interpretarRpcRendicion({ error: { message: 'x' } }).motivo).toBe('error');
    expect(interpretarRpcRendicion({ data: null }).motivo).toBe('respuesta_invalida');
    expect(interpretarRpcRendicion({ data: { ok: false, motivo: 'no_autorizado' } }).motivo).toBe('pin_incorrecto');
    expect(interpretarRpcRendicion({ data: { ok: false, motivo: 'inexistente' } }).motivo).toBe('inexistente');
    expect(interpretarRpcRendicion({ data: { ok: false, motivo: 'raro' } }).motivo).toBe('error');
    expect(interpretarRpcRendicion({ data: { ok: 'si' } }).motivo).toBe('respuesta_invalida');
    expect(interpretarRpcRendicion({ data: { ok: true, ya_anulada: true } })).toMatchObject({ ok: true, yaAnulada: true, motivo: 'ya_anulada' });
    expect(interpretarRpcRendicion({ data: { ok: true } })).toEqual({ ok: true, data: { ok: true } });
    expect(interpretarRpcRendicion().motivo).toBe('respuesta_invalida');
    expect(MOTIVOS_RECHAZO.cantidad_excedida).toBeTruthy();
  });
});
