// REQ-REN vuelta 2 (S-REN-04): tope del credito de las rendiciones vigentes al total del pedido.
import { topeCreditoPedidoCents, validarRendicion, MOTIVOS_RECHAZO } from '../rendicion';

const ID = '11111111-2222-4333-8444-555555555555';
const now = new Date('2026-10-15T15:00:00Z');
const item = (productoId, cantidad, precio) => ({ productoId, nombre: `Prod ${productoId}`, cantidad, precio, rubro: 'Golosinas' });
const pedido = (extra = {}) => ({
  id: 7, remoteId: 70, clienteId: 5, clienteNombre: 'Kiosco', estado: 'facturado', fecha: '2026-10-14', total: 1000,
  items: [item(1, 10, 100)], ...extra,
});
const productos = [{ id: 1, nombre: 'Prod 1', precio: 100, categoria: 'Golosinas' }, { id: 3, nombre: 'Prod 3', precio: 50, categoria: 'Golosinas' }];
const ctx = (extra = {}) => ({ pedido: pedido(), rendiciones: [], productos, usuario: 'Admin', now, genId: () => ID, ...extra });
const rend = (extra = {}) => ({ id: 'r1', pedidoId: '70', estado: 'vigente', syncEstado: 'confirmada', tipo: 'nc', renglones: [], creditoCents: 0, ...extra });

describe('AC-REN-3 S-REN-04 topeCreditoPedidoCents', () => {
  it('AC-REN-3 total menos creditos a favor vigentes (anuladas, rechazadas, otros pedidos y negativos no cuentan)', () => {
    const rs = [
      rend({ creditoCents: 30000 }),
      rend({ id: 'r2', estado: 'anulada', creditoCents: 50000 }),
      rend({ id: 'r3', syncEstado: 'rechazada', creditoCents: 50000 }),
      rend({ id: 'r4', pedidoId: '99', creditoCents: 50000 }),
      rend({ id: 'r5', tipo: 'cambio', creditoCents: -20000 }),
    ];
    expect(topeCreditoPedidoCents(pedido(), rs)).toBe(70000);
    expect(topeCreditoPedidoCents(pedido(), [rend({ creditoCents: 200000 })])).toBe(0);
    expect(topeCreditoPedidoCents(pedido({ total: 'x' }), [])).toBe(0);
  });
});

describe('AC-REN-3 S-REN-04 validarRendicion respeta el tope en devoluciones y cambios', () => {
  it('AC-REN-3 devolucion: rechaza si el credito supera el total del pedido menos creditos previos', () => {
    const rs = [rend({ creditoCents: 95000 })];
    const r = validarRendicion({ tipo: 'devolucion', renglones: [{ productoId: 1, cantidad: 1 }], motivo: 'roto' }, ctx({ rendiciones: rs }));
    expect(r.ok).toBe(false);
    expect(r.errores.renglones).toMatch(/no puede pasar de \$50/);
  });

  it('AC-REN-3 devolucion con pedido con descuento (total menor que los renglones) se topa', () => {
    const r = validarRendicion({ tipo: 'devolucion', renglones: [{ productoId: 1, cantidad: 10 }], motivo: 'vencido' }, ctx({ pedido: pedido({ total: 900 }) }));
    expect(r.ok).toBe(false);
    expect(r.errores.renglones).toMatch(/total del pedido/);
  });

  it('AC-REN-3 dentro del tope pasa y el credito de comision es el mismo numero que el credito', () => {
    const r = validarRendicion({ tipo: 'devolucion', renglones: [{ productoId: 1, cantidad: 3 }], motivo: 'roto' }, ctx());
    expect(r.ok).toBe(true);
    expect(r.rendicion.creditoCents).toBe(30000);
    expect(r.rendicion.creditoComisionCents).toBe(r.rendicion.creditoCents);
  });

  it('AC-REN-3 cambio con credito negativo (cliente paga) no se topa', () => {
    const rs = [rend({ creditoCents: 100000 })];
    const r = validarRendicion({ tipo: 'cambio', renglones: [{ productoId: 1, cantidad: 1 }], sale: [{ productoId: 1, cantidad: 2 }], motivo: 'cambio' }, ctx({ rendiciones: rs }));
    expect(r.ok).toBe(true);
    expect(r.rendicion.creditoCents).toBe(-10000);
    expect(r.rendicion.creditoComisionCents).toBe(-10000);
  });

  it('AC-REN-3 NC: el credito de comision coincide con el credito (lo exige el servidor)', () => {
    const r = validarRendicion({ tipo: 'nc', montoNc: '333,33', motivo: 'bonif' }, ctx());
    expect(r.ok).toBe(true);
    expect(r.rendicion.creditoComisionCents).toBe(r.rendicion.creditoCents);
  });

  it('AC-REN-3 el rechazo del servidor por credito tiene mensaje claro', () => {
    expect(MOTIVOS_RECHAZO.credito_inconsistente).toMatch(/crédito/);
  });
});
