// QA REQ-REN: casos borde adicionales (no duplica rendicion.test.js).
import {
  disponiblesParaDevolver, validarRendicion, creditoRendicion, comisionRenglonesDe,
  movimientosRendicion, movimientosAnulacionRendicion, planEfectoCuenta, planAnulacionCuenta,
  saldoAFavorCliente, cuentaParaBoleta, resumenRendicionDia, asientoSaldoFavor,
} from '../rendicion';
import { calcularStock } from '../stock';

let seq = 0;
const genId = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
const now = new Date('2026-10-15T15:00:00Z');
const item = (productoId, cantidad, precio, extra = {}) => ({ productoId, nombre: `Prod ${productoId}`, cantidad, precio, ...extra });
const pedido = (extra = {}) => ({
  id: 7, remoteId: 70, clienteId: 5, clienteNombre: 'Kiosco', estado: 'facturado', fecha: '2026-10-14', total: 1700,
  items: [item(1, 10, 100, { rubro: 'Golosinas' }), item(2, 2, 350, { rubro: 'Bebidas' })], ...extra,
});
const productos = [
  { id: 1, nombre: 'Prod 1', precio: 100, categoria: 'Golosinas' },
  { id: 2, nombre: 'Prod 2', precio: 350, categoria: 'Bebidas' },
  { id: 3, nombre: 'Prod 3', precio: 120, categoria: 'Limpieza' },
];
const ctx = (extra = {}) => ({ pedido: pedido(), rendiciones: [], productos, usuario: 'Admin', now, genId, ...extra });
const ok = (form, extra) => { const r = validarRendicion(form, ctx(extra)); expect(r.errores).toEqual({}); return r.rendicion; };

describe('AC-REN-1 devolución parcial en dos rendiciones', () => {
  it('AC-REN-1 dos parciales suman y la tercera que excede se rechaza; el resto exacto pasa', () => {
    const r1 = ok({ tipo: 'devolucion', motivo: 'Roto', renglones: [{ productoId: 1, cantidad: 4 }] });
    const r2 = ok({ tipo: 'devolucion', motivo: 'Roto', renglones: [{ productoId: 1, cantidad: 5 }] }, { rendiciones: [{ ...r1, syncEstado: 'confirmada' }] });
    const previas = [r1, r2];
    const d = disponiblesParaDevolver(pedido(), previas).get('1');
    expect(d).toMatchObject({ devuelto: 9, disponible: 1 });
    const mal = validarRendicion({ tipo: 'devolucion', motivo: 'Roto', renglones: [{ productoId: 1, cantidad: 2 }] }, ctx({ rendiciones: previas }));
    expect(mal.ok).toBe(false);
    expect(mal.errores['item:1']).toMatch(/hasta 1/);
    expect(validarRendicion({ tipo: 'devolucion', motivo: 'Roto', renglones: [{ productoId: 1, cantidad: 1 }] }, ctx({ rendiciones: previas })).ok).toBe(true);
  });

  it('AC-REN-1 todo devuelto => disponible 0 y cualquier cantidad se rechaza', () => {
    const r1 = ok({ tipo: 'devolucion', motivo: 'Todo', renglones: [{ productoId: 2, cantidad: 2 }] });
    const mal = validarRendicion({ tipo: 'devolucion', motivo: 'Otra vez', renglones: [{ productoId: 2, cantidad: 1 }] }, ctx({ rendiciones: [r1] }));
    expect(mal.errores['item:2']).toMatch(/hasta 0/);
  });

  it('AC-REN-1 cantidad decimal facturada (2.5): se puede devolver hasta 2 enteras, no 3', () => {
    const p = pedido({ items: [item(1, 2.5, 100)], total: 250 });
    expect(validarRendicion({ tipo: 'devolucion', motivo: 'Roto', renglones: [{ productoId: 1, cantidad: 3 }] }, ctx({ pedido: p })).ok).toBe(false);
    expect(validarRendicion({ tipo: 'devolucion', motivo: 'Roto', renglones: [{ productoId: 1, cantidad: 2 }] }, ctx({ pedido: p })).ok).toBe(true);
  });

  it('AC-REN-1 form null/undefined, motivo solo espacios o de 2 letras => error sin romper', () => {
    expect(validarRendicion(null, ctx()).ok).toBe(false);
    expect(validarRendicion(undefined, {}).errores.pedido).toBeTruthy();
    const e = validarRendicion({ tipo: 'devolucion', motivo: '   ab   ', renglones: [{ productoId: 1, cantidad: 1 }] }, ctx());
    expect(e.errores.motivo).toBeTruthy();
    expect(validarRendicion({ tipo: 'devolucion', motivo: '   abc   ', renglones: [{ productoId: 1, cantidad: 1 }] }, ctx()).rendicion.motivo).toBe('abc');
  });
});

describe('AC-REN-2 merma y cambios', () => {
  it('AC-REN-2 devolución 100% merma: no hay movimientos ni anulación, pero acredita y se resume', () => {
    const r = ok({ tipo: 'devolucion', motivo: 'Vencido', renglones: [{ productoId: 1, cantidad: 3, vuelveAlStock: false }] });
    expect(movimientosRendicion(r)).toEqual([]);
    expect(movimientosAnulacionRendicion(r, { now })).toEqual([]);
    expect(creditoRendicion(r)).toBe(30000);
    const res = resumenRendicionDia([{ ...r, fecha: '2026-10-15' }], '2026-10-15');
    expect(res.totales.mermaCents).toBe(30000);
    expect(res.totales.mermaUnidades).toBe(3);
  });

  it('AC-REN-2 cambio del mismo producto (entra 1 / sale 1): diferencia 0, sin ajuste de comisión, 2 movimientos', () => {
    const r = ok({ tipo: 'cambio', motivo: 'Cambio', renglones: [{ productoId: 1, cantidad: 1 }], sale: [{ productoId: 1, cantidad: 1 }] });
    expect(r.creditoCents).toBe(0);
    expect(r.comisionRenglones).toEqual([]);
    expect(Object.is(r.creditoComisionCents, -0)).toBe(false);
    const movs = movimientosRendicion(r);
    expect(movs.map(m => m.cantidad)).toEqual([1, -1]);
    expect(new Set(movs.map(m => m.id)).size).toBe(2);
    expect(planEfectoCuenta(r.creditoCents, [])).toEqual({ cobros: [], saldoFavorCents: 0, cargoCents: 0 });
  });

  it('AC-REN-3 cambio con diferencia a favor del cliente y en contra', () => {
    const aFavor = ok({ tipo: 'cambio', motivo: 'Cambio', renglones: [{ productoId: 2, cantidad: 1 }], sale: [{ productoId: 3, cantidad: 1 }] });
    expect(aFavor.creditoCents).toBe(35000 - 12000);
    expect(planEfectoCuenta(aFavor.creditoCents, []).saldoFavorCents).toBe(23000);
    const enContra = ok({ tipo: 'cambio', motivo: 'Cambio', renglones: [{ productoId: 1, cantidad: 1 }], sale: [{ productoId: 2, cantidad: 1 }] });
    expect(enContra.creditoCents).toBe(10000 - 35000);
    expect(planEfectoCuenta(enContra.creditoCents, [{ id: 1, fecha: '2026-10-01', monto: 500, montoPagado: 0 }]))
      .toEqual({ cobros: [], saldoFavorCents: 0, cargoCents: 25000 });
    expect(enContra.creditoComisionCents).toBe(-25000);
  });

  it('AC-REN-2 anular devolución + cambio deja el stock exacto y reintentar no repite ids', () => {
    const d = ok({ tipo: 'devolucion', motivo: 'Roto', renglones: [{ productoId: 1, cantidad: 3 }, { productoId: 2, cantidad: 1, vuelveAlStock: false }] });
    const c = ok({ tipo: 'cambio', motivo: 'Cambio', renglones: [{ productoId: 1, cantidad: 2 }], sale: [{ productoId: 1, cantidad: 5 }, { productoId: 3, cantidad: 1 }] });
    const previo = [{ productoId: '1', cantidad: 20 }, { productoId: '2', cantidad: 5 }, { productoId: '3', cantidad: 7 }];
    const alta = [...movimientosRendicion(d), ...movimientosRendicion(c)];
    const anul = [...movimientosAnulacionRendicion(d, { now }), ...movimientosAnulacionRendicion(c, { now: new Date('2027-01-01') })];
    const medio = calcularStock([...previo, ...alta]);
    expect(medio.get('1')).toBe(20 + 3 + 2 - 5);
    expect(medio.get('2')).toBe(5);
    const fin = calcularStock([...previo, ...alta, ...anul]);
    expect(fin.get('1')).toBe(20);
    expect(fin.get('2')).toBe(5);
    expect(fin.get('3')).toBe(7);
    const ids = [...alta, ...anul].map(m => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(movimientosAnulacionRendicion(d, { now }).map(m => m.id)).toEqual(movimientosAnulacionRendicion(d, { now: new Date('2030-01-01') }).map(m => m.id));
  });
});

describe('AC-REN-3 NC, saldo a favor y centavos', () => {
  it('AC-REN-1 NC: monto con centavos, inválidos y tope considerando devoluciones previas', () => {
    const dev = ok({ tipo: 'devolucion', motivo: 'Roto', renglones: [{ productoId: 1, cantidad: 3 }] });
    const nc = (m, rs = []) => validarRendicion({ tipo: 'nc', motivo: 'Ajuste', montoNc: m }, ctx({ rendiciones: rs }));
    expect(nc('1400').ok).toBe(true);
    expect(nc('1400', [dev]).ok).toBe(true);
    expect(nc('1400.01', [dev]).ok).toBe(false);
    expect(nc('1700.01').ok).toBe(false);
    for (const malo of ['0', '-5', 'abc', '', null, undefined, NaN, Infinity]) expect(nc(malo).ok).toBe(false);
    expect(nc('33.33').rendicion.creditoCents).toBe(3333);
  });

  it('AC-REN-3 NC mayor que la deuda: cobra todo y el resto es saldo a favor exacto en centavos', () => {
    const deudas = [{ id: 1, fecha: '2026-10-01', monto: 33.33, montoPagado: 0 }, { id: 2, fecha: '2026-10-02', monto: 50, montoPagado: 0.1 + 0.2 }];
    const plan = planEfectoCuenta(10010, deudas);
    expect(plan.cobros.map(c => c.montoCents)).toEqual([3333, 4970]);
    expect(plan.saldoFavorCents).toBe(10010 - 3333 - 4970);
    expect(plan.cobros.reduce((a, c) => a + c.montoCents, 0) + plan.saldoFavorCents).toBe(10010);
  });

  it('AC-REN-5 NC de 1 centavo repartida en 3 rubros suma exacta -1', () => {
    const p = pedido({ items: [item(1, 1, 10, { rubro: 'A' }), item(2, 1, 10, { rubro: 'B' }), item(3, 1, 10, { rubro: 'C' })], total: 30 });
    const r = validarRendicion({ tipo: 'nc', motivo: 'Ajuste', montoNc: '0.01' }, ctx({ pedido: p }));
    expect(r.ok).toBe(true);
    expect(r.rendicion.comisionRenglones.reduce((a, c) => a + c.subtotalCents, 0)).toBe(-1);
    expect(r.rendicion.creditoComisionCents).toBe(1);
  });

  it('AC-REN-4 anular dos veces no compensa dos veces el saldo a favor', () => {
    const r = { id: 'rr', clienteId: '5', efecto: { cobros: [], saldoFavorCents: 5000 } };
    const a = asientoSaldoFavor(r, 5000, 'favor:a', { now });
    const plan1 = planAnulacionCuenta(r, [], [a]);
    expect(plan1.saldoFavorCompensaCents).toBe(5000);
    const x = asientoSaldoFavor(r, -5000, 'favor:x', { now });
    expect(planAnulacionCuenta(r, [], [a, x]).saldoFavorCompensaCents).toBe(0);
    expect(saldoAFavorCliente([a, x], 5)).toBe(0);
  });

  it('AC-REN-3 cuentaParaBoleta no pierde centavos con flotantes', () => {
    expect(cuentaParaBoleta(0.1 + 0.2, 30)).toEqual({ deudaPendiente: 0, saldoAFavor: 0 });
    expect(cuentaParaBoleta(0.3, 10)).toEqual({ deudaPendiente: 0.2, saldoAFavor: 0 });
    expect(cuentaParaBoleta(0, 1)).toEqual({ deudaPendiente: 0, saldoAFavor: 0.01 });
    expect(cuentaParaBoleta(undefined, undefined)).toEqual({ deudaPendiente: 0, saldoAFavor: 0 });
  });

  it('AC-REN-5 comisionRenglonesDe: NC sobre pedido con renglones en 0 y rendición nula no explota', () => {
    expect(comisionRenglonesDe(null, pedido())).toEqual([]);
    expect(comisionRenglonesDe({ tipo: 'nc', creditoCents: 500 }, pedido({ items: [] }))).toEqual([{ rubroClave: '', rubro: '', subtotalCents: -500 }]);
  });
});
