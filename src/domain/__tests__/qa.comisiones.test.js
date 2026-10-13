// QA adversarial REQ-COM (RUN 20261007-2022): bordes que los tests de la
// implementación no ejercitan de forma explícita.
import {
  calcularComision, repartirComision, armarDashboard, construirCierre, calcularAjustesPendientes,
  clasificarPedidos, pedidosEnCierresVigentes, enRango, marcarEntregado, validarAsignacion,
  armarLinea, resumirPorVendedor, puedeCerrar,
} from '../comisiones';

const VENDEDORES = [
  { id: 1, nombre: 'Jorge', permiso: 1 },
  { id: 2, nombre: 'Carlos', permiso: 2 },
  { id: 3, nombre: 'Lucía', permiso: 2 },
];
const mkClientes = () => [
  { id: 10, nombre: 'Kiosco', vendedor: 'Carlos', comision: 5 },
  { id: 12, nombre: 'Huérfano', vendedor: '', comision: 10 },
];
const PERIODO = { desde: '2026-10-01', hasta: '2026-10-31' };
const ped = (o) => ({
  id: o.id ?? 1, remoteId: `R${o.id ?? 1}`, clienteId: 10, clienteNombre: 'Kiosco',
  vendedor: 'Carlos', vendedorNombre: 'Carlos', fecha: '2026-10-10', estado: 'facturado', entregado: true, total: 1000, items: [], ...o,
});
const dash = (pedidos, extra = {}) => armarDashboard({ pedidos, clientes: mkClientes(), vendedores: VENDEDORES, cierres: [], borrador: null, periodo: PERIODO, ...extra });

describe('QA AC-COM-4 AC-COM-7 centavos impares', () => {
  it('AC-COM-7 dividir 0,01 y 0,03 50/50 suma exacto al centavo (la última parte se lleva el resto)', () => {
    const div = { modo: 'dividir', partes: [{ vendedor: 'Carlos', pct: 50 }, { vendedor: 'Lucía', pct: 50 }] };
    for (const c of [0.01, 0.03, 1.01, 333.33, 99.99, 0.05]) {
      const r = repartirComision(c, div);
      const suma = Math.round(r.reduce((a, p) => a + p.monto * 100, 0));
      expect(suma).toBe(Math.round(c * 100));
    }
  });
  it('AC-COM-7 dividir 33,33 / 66,67 de 100,01 suma exacto', () => {
    const div = { modo: 'dividir', partes: [{ vendedor: 'Carlos', pct: 33.33 }, { vendedor: 'Lucía', pct: 66.67 }] };
    const r = repartirComision(100.01, div);
    expect(Math.round((r[0].monto + r[1].monto) * 100)).toBe(10001);
  });
  it('AC-COM-4 la suma de comisiones por vendedor del dashboard coincide con la suma de comisiones por pedido (sin deriva)', () => {
    const pedidos = Array.from({ length: 50 }, (_, i) => ped({ id: i + 1, total: 33.33 + i * 0.07 }));
    const d = dash(pedidos);
    const porPedido = Math.round(d.lineas.reduce((a, l) => a + l.comision * 100, 0));
    expect(Math.round(d.totales.totalComision * 100)).toBe(porPedido);
  });
  it('AC-COM-4 comisión negativa imposible y 0 % no genera aviso (0 es un % cargado)', () => {
    expect(calcularComision(1000, 0)).toEqual({ comision: 0, aviso: null });
    expect(calcularComision(0, 10)).toEqual({ comision: 0, aviso: null });
  });
});

describe('QA AC-COM-3 AC-COM-6 clasificación', () => {
  it('AC-COM-3 AC-COM-6 facturado no entregado es informativo (aviso d) y no suma comisión ni total', () => {
    const d = dash([ped({ id: 1 }), ped({ id: 2, entregado: false, total: 99999 })]);
    expect(d.avisos.contadores.d).toBe(1);
    expect(d.totales.totalVendido).toBe(1000);
    expect(d.lineas).toHaveLength(1);
  });
  it('AC-COM-3 pedido eliminado/cancelado/borrado (varias grafías) no cuenta ni siquiera como no entregado', () => {
    const r = clasificarPedidos([
      ped({ id: 1, estado: 'cancelado', entregado: false }),
      ped({ id: 2, estado: 'eliminado' }),
      ped({ id: 3, borrado: true, entregado: false }),
      ped({ id: 5, estado: 'pendiente', entregado: true }),
    ], PERIODO);
    expect(r.incluidos).toHaveLength(0);
    expect(r.noEntregados).toHaveLength(0);
  });
  it('AC-COM-3 bordes de fecha: 1 y 31 incluidos; 30/09 y 01/11 fuera; ISO con Z usa el día literal', () => {
    expect(enRango('2026-10-01', PERIODO)).toBe(true);
    expect(enRango('2026-10-31', PERIODO)).toBe(true);
    expect(enRango('2026-09-30', PERIODO)).toBe(false);
    expect(enRango('2026-11-01', PERIODO)).toBe(false);
    // Documenta el comportamiento: se toma el día escrito, sin convertir zona horaria.
    // 2026-11-01T01:00:00Z es 31/10 22:00 en Argentina, pero cuenta como 01/11.
    expect(enRango('2026-11-01T01:00:00Z', PERIODO)).toBe(false);
    expect(enRango(null, PERIODO)).toBe(false);
    expect(enRango(undefined, PERIODO)).toBe(false);
  });
  it('AC-COM-3 AC-COM-11 estados del cierre: vigente y pendiente ocupan; anulado y rechazado liberan', () => {
    const mk = (estado) => [{ id: 'c1', estado, lineas: [{ tipo: 'pedido', pedidoId: 'R1' }] }];
    expect(pedidosEnCierresVigentes(mk('vigente')).has('R1')).toBe(true);
    expect(pedidosEnCierresVigentes(mk('pendiente')).has('R1')).toBe(true);
    expect(pedidosEnCierresVigentes(mk('anulado')).has('R1')).toBe(false);
    expect(pedidosEnCierresVigentes(mk('rechazado')).has('R1')).toBe(false);
    expect(pedidosEnCierresVigentes(null).size).toBe(0);
  });
  it('AC-COM-11 AC-COM-12 pedido en cierre vigente no vuelve a contar; tras anular vuelve a aparecer', () => {
    const pedidos = [ped({ id: 1 })];
    const d1 = dash(pedidos);
    const cierre = { ...construirCierre(d1, { admin: 'Jorge' }), estado: 'vigente' };
    expect(dash(pedidos, { cierres: [cierre] }).lineas).toHaveLength(0);
    expect(dash(pedidos, { cierres: [{ ...cierre, estado: 'anulado' }] }).lineas).toHaveLength(1);
  });
});

describe('QA AC-COM-6 AC-COM-7 AC-COM-8 asignación', () => {
  it('AC-COM-6 cliente sin vendedor y pedido cargado por otro: avisos (a) y (b) independientes', () => {
    const d = dash([
      ped({ id: 1, vendedor: 'Lucía', vendedorNombre: 'Lucía' }),
      ped({ id: 2, clienteId: 12, clienteNombre: 'Huérfano' }),
    ]);
    expect(d.avisos.contadores).toMatchObject({ a: 1, b: 1 });
  });
  it('AC-COM-8 cliente sin vendedor bloquea el cierre; con sin_comision o asignar a otro se destraba', () => {
    const base = [ped({ id: 2, clienteId: 12, clienteNombre: 'Huérfano' })];
    expect(puedeCerrar(dash(base)).ok).toBe(false);
    const sc = { asignaciones: { R2: { modo: 'sin_comision' } } };
    const d = dash(base, { borrador: sc });
    expect(puedeCerrar(d).ok).toBe(true);
    expect(d.resumenPorVendedor).toEqual([]);
    const otro = dash(base, { borrador: { asignaciones: { R2: { modo: 'otro', vendedor: 'Lucía' } } } });
    expect(puedeCerrar(otro).ok).toBe(true);
    expect(otro.resumenPorVendedor[0]).toMatchObject({ vendedor: 'Lucía', totalComision: 100 });
  });
  it('AC-COM-8 asignación "otro" con vendedor inexistente o dividir sin ficha es inválida y bloquea', () => {
    const base = [ped({ id: 2, clienteId: 12, clienteNombre: 'Huérfano' })];
    const d = dash(base, { borrador: { asignaciones: { R2: { modo: 'otro', vendedor: 'Fantasma' } } } });
    expect(puedeCerrar(d).ok).toBe(false);
    const d2 = dash(base, { borrador: { asignaciones: { R2: { modo: 'dividir' } } } });
    expect(puedeCerrar(d2).ok).toBe(false);
  });
  it('AC-COM-7 cargado por el admin o por ADMIN en mayúsculas no dispara aviso (a)', () => {
    const d = dash([ped({ id: 1, vendedor: 'JORGE', vendedorNombre: 'JORGE' }), ped({ id: 2, vendedor: 'WEB', vendedorNombre: 'WEB' })]);
    expect(d.avisos.contadores.a).toBe(0);
  });
  it('AC-COM-7 vendedor con espacios / tildes / mayúsculas se reconoce igual', () => {
    expect(validarAsignacion({ modo: 'cargador' }, { pedido: ped({ vendedor: '  LUCIA ' }), cliente: mkClientes()[0], vendedores: VENDEDORES }).ok).toBe(true);
  });
});

describe('QA AC-COM-10 AC-COM-13 congelado y ajustes', () => {
  it('AC-COM-10 el cierre queda congelado aunque luego cambie la ficha del cliente, el pedido o el borrador', () => {
    const clientes = mkClientes();
    const pedidos = [ped({ id: 1, total: 1000 })];
    const d = armarDashboard({ pedidos, clientes, vendedores: VENDEDORES, cierres: [], borrador: null, periodo: PERIODO });
    const c = construirCierre(d, { admin: 'Jorge' });
    const foto = JSON.stringify(c);
    clientes[0].comision = 50; clientes[0].vendedor = 'Lucía'; pedidos[0].total = 1; d.lineas[0].comision = 777;
    d.resumenPorVendedor[0].totalComision = 777;
    expect(JSON.stringify(c)).toBe(foto);
    expect(c.lineas[0]).toMatchObject({ pct: 5, comision: 50 });
  });
  it('AC-COM-13 si el cliente cambia de % después del cierre, el ajuste usa el % congelado (no hay ajuste espurio)', () => {
    const pedidos = [ped({ id: 1, total: 1000 })];
    const c = { ...construirCierre(dash(pedidos), { admin: 'Jorge' }), estado: 'vigente' };
    expect(calcularAjustesPendientes(pedidos, [c])).toEqual([]);
  });
  it('AC-COM-13 editar total, desmarcar entregado, revertir y borrar generan ajuste con la diferencia', () => {
    const base = [ped({ id: 1, total: 1000 })];
    const c = { ...construirCierre(dash(base), { admin: 'Jorge' }), estado: 'vigente' };
    const dif = (p) => calcularAjustesPendientes([p], [c])[0]?.diferencia;
    expect(dif(ped({ id: 1, total: 1200 }))).toBe(10);
    expect(dif(ped({ id: 1, total: 500 }))).toBe(-25);
    expect(dif(ped({ id: 1, entregado: false }))).toBe(-50);
    expect(dif(ped({ id: 1, estado: 'pendiente' }))).toBe(-50);
    expect(dif(ped({ id: 1, borrado: true }))).toBe(-50);
  });
  it('AC-COM-13 un ajuste ya cerrado no se repite; un segundo cambio genera ajuste con diferencia contra lo ya cobrado', () => {
    const base = [ped({ id: 1, total: 1000 })];
    const c1 = { ...construirCierre(dash(base), { admin: 'Jorge' }), estado: 'vigente' };
    const cambiado = [ped({ id: 1, total: 2000 })];
    const aj = calcularAjustesPendientes(cambiado, [c1]);
    expect(aj).toHaveLength(1);
    const d2 = armarDashboard({ pedidos: cambiado, clientes: mkClientes(), vendedores: VENDEDORES, cierres: [c1], borrador: null, periodo: PERIODO });
    const c2 = { ...construirCierre(d2, { admin: 'Jorge' }), id: 'c2', estado: 'vigente' };
    expect(calcularAjustesPendientes(cambiado, [c1, c2])).toEqual([]);
    const otra = calcularAjustesPendientes([ped({ id: 1, total: 3000 })], [c1, c2]);
    expect(otra[0]).toMatchObject({ diferencia: 50, ajusteSeq: 2 });
  });
  it('AC-COM-13 un cierre anulado no genera ajustes', () => {
    const base = [ped({ id: 1, total: 1000 })];
    const c = { ...construirCierre(dash(base), { admin: 'Jorge' }), estado: 'anulado' };
    expect(calcularAjustesPendientes([ped({ id: 1, total: 5 })], [c])).toEqual([]);
  });
});

describe('QA AC-COM-1 marcar/desmarcar entregado', () => {
  it('AC-COM-1 marcar y desmarcar en cadena no altera estado, items, total ni stock (campos de stock intactos)', () => {
    const p = ped({ id: 1, items: [{ productoId: 1, cantidad: 2 }], stockAplicado: true, entregado: false });
    const a = marcarEntregado(p, true, 'Ana', 1);
    const b = marcarEntregado(a, false, 'Ana', 2);
    for (const r of [a, b]) {
      expect(r.estado).toBe('facturado');
      expect(r.stockAplicado).toBe(true);
      expect(r.items).toEqual(p.items);
      expect(r.total).toBe(1000);
    }
    expect(p.entregado).toBe(false); // no muta el original
  });
});

describe('QA AC-COM-15 entradas hostiles', () => {
  it('AC-COM-15 pedidos/clientes/vendedores null o con basura no tiran excepción', () => {
    expect(() => armarDashboard({ pedidos: [null, undefined, {}, ped({ id: 1, total: {} })], clientes: [null], vendedores: [null], cierres: [null], borrador: null, periodo: PERIODO })).not.toThrow();
    expect(() => armarLinea(null, {})).not.toThrow();
    expect(() => resumirPorVendedor(null, null)).not.toThrow();
  });
  it('AC-COM-15 totales de strings con coma / espacios / unicode', () => {
    expect(calcularComision(' 1.000,50 ', 10).comision).toBe(100.05);
    expect(calcularComision('１０００', 10).aviso).toBe('total_invalido');
  });
});
