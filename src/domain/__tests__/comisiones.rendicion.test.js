// REQ-REN (AC-REN-5): una devolución o NC baja la comisión del período si el pedido no está
// cerrado, y aparece como ajuste pendiente (AC-COM-13 / AC-COMR-14) si ya está cerrado.
import { armarDashboard, construirCierre, baseRubrosPedido, indexarProductos, netearPedidosComision } from '../comisiones';

const PERIODO = { desde: '2026-10-01', hasta: '2026-10-31' };
const PERIODO2 = { desde: '2026-11-01', hasta: '2026-11-30' };
const VENDEDORES = [{ id: 1, remoteId: 'u-jorge', nombre: 'Jorge', permiso: 1 }, { id: 2, remoteId: 'u-ana', nombre: 'Ana', permiso: 2 }];
const CLIENTES = [{ id: 10, nombre: 'Kiosco', vendedor: 'Ana', comision: 5 }];
const PRODUCTOS = [{ id: 'g', categoria: 'Golosinas' }, { id: 'b', categoria: 'Bebidas' }];
const TABLA = [
  { id: 't1', vendedorId: 'u-ana', rubro: 'Golosinas', pct: 5 },
  { id: 't2', vendedorId: 'u-ana', rubro: 'Bebidas', pct: 10 },
];
const it1 = (productoId, precio, cantidad = 1) => ({ productoId, precio, cantidad });
const ped = (o) => ({ id: 1, remoteId: 'R1', clienteId: 10, clienteNombre: 'Kiosco', vendedor: 'Ana', fecha: '2026-10-10', estado: 'facturado', entregado: true, total: 1500, items: [it1('g', 1000), it1('b', 500)], ...o });
const rend = (o) => ({ id: 'r1', pedidoId: 'R1', estado: 'vigente', syncEstado: 'confirmada', creditoComisionCents: 50000, comisionRenglones: [{ rubroClave: 'bebidas', rubro: 'Bebidas', subtotalCents: -50000 }], ...o });
const dash = (pedidos, { periodo = PERIODO, cierres = [], rendiciones, modelo = 'rubro' } = {}) => armarDashboard({
  pedidos, clientes: CLIENTES, vendedores: VENDEDORES, cierres, periodo, modelo, productos: PRODUCTOS, tablaRubros: TABLA, rendiciones,
});

describe('AC-REN-5 base por rubro con extras (renglones de comisión congelados)', () => {
  it('AC-REN-5 extras vacío o ausente no cambia nada', () => {
    const p = ped({});
    const pb = indexarProductos(PRODUCTOS);
    expect(baseRubrosPedido(p, pb, { extras: [] })).toEqual(baseRubrosPedido(p, pb));
    expect(baseRubrosPedido(p, pb, {})).toEqual(baseRubrosPedido(p, pb));
  });

  it('AC-REN-5 extras se suman por clave; clave nueva y sin rubro también; inválidos se ignoran', () => {
    const b = baseRubrosPedido(ped({}), indexarProductos(PRODUCTOS), { extras: [
      { rubroClave: 'bebidas', rubro: 'Bebidas', subtotalCents: -50000 },
      { rubroClave: 'limpieza', rubro: 'Limpieza', subtotalCents: 1200 },
      { rubroClave: '', subtotalCents: -10 },
      { rubroClave: 'golosinas', subtotalCents: 1.5 },
      { rubroClave: 'golosinas', subtotalCents: 0 },
      null,
    ] });
    expect(b.porRubro).toEqual([
      { rubro: 'Bebidas', clave: 'bebidas', subtotalCents: 0 },
      { rubro: 'Golosinas', clave: 'golosinas', subtotalCents: 100000 },
      { rubro: 'Limpieza', clave: 'limpieza', subtotalCents: 1200 },
    ]);
    expect(b.sinRubro).toEqual([{ productoId: null, nombre: 'Rendición', subtotalCents: -10 }]);
  });

  it('AC-REN-5 netearPedidosComision sin rendiciones devuelve la misma lista', () => {
    const ps = [ped({})];
    expect(netearPedidosComision(ps, [])).toBe(ps);
    expect(netearPedidosComision(null, [rend({})])).toBeNull();
  });
});

describe('AC-REN-5 pedido NO cerrado: baja la comisión del período', () => {
  it('AC-REN-5 modelo por rubro: total y comisión netos de la devolución', () => {
    const sin = dash([ped({})]).lineas[0];
    expect(sin).toMatchObject({ total: 1500, comision: 100 });
    const con = dash([ped({})], { rendiciones: [rend({})] }).lineas[0];
    expect(con).toMatchObject({ total: 1000, comision: 50 });
    expect(con.partes[0].desglose.find(d => d.rubroClave === 'bebidas')).toMatchObject({ subtotal: 0, comision: 0 });
  });

  it('AC-REN-5 rendiciones anuladas, rechazadas o de otro pedido no cuentan', () => {
    const rs = [rend({ estado: 'anulada' }), rend({ syncEstado: 'rechazada' }), rend({ pedidoId: 'OTRO' })];
    expect(dash([ped({})], { rendiciones: rs }).lineas[0]).toMatchObject({ total: 1500, comision: 100 });
  });

  it('AC-REN-5 modelo cliente (compatibilidad): % del cliente sobre el total neto', () => {
    expect(dash([ped({})], { rendiciones: [rend({})], modelo: undefined }).lineas[0]).toMatchObject({ total: 1000, comision: 50 });
  });
});

describe('AC-REN-5 pedido YA cerrado: ajuste pendiente (AC-COM-13)', () => {
  const cerrar = () => {
    const d = dash([ped({})]);
    return { ...construirCierre(d, { admin: 'Jorge', genId: () => 'c1', now: 1 }), estado: 'vigente' };
  };

  it('AC-REN-5 devolución sobre pedido cerrado (modelo rubro) => ajuste negativo', () => {
    const c = cerrar();
    expect(dash([ped({})], { periodo: PERIODO2, cierres: [c] }).ajustes).toEqual([]);
    const a = dash([ped({})], { periodo: PERIODO2, cierres: [c], rendiciones: [rend({})] }).ajustes;
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ tipo: 'ajuste', modelo: 'rubro', pedidoId: 'R1', comisionCerrada: 100, comisionActual: 50, diferencia: -50, total: -500 });
  });

  it('AC-REN-5 NC sobre pedido cerrado con el modelo viejo (cliente) => diferencia × % congelado', () => {
    const cierre = {
      id: 'c-viejo', estado: 'vigente', desde: '2026-10-01', hasta: '2026-10-31',
      lineas: [{ tipo: 'pedido', pedidoId: 'R1', fecha: '2026-10-10', clienteId: 10, clienteNombre: 'Kiosco', total: 1500, pct: 5, comision: 75, asignacion: { modo: 'ficha', partes: [{ vendedor: 'Ana', pct: 100 }] }, partes: [{ vendedor: 'Ana', pct: 100, monto: 75, total: 1500 }] }],
    };
    const nc = rend({ creditoComisionCents: 20000, comisionRenglones: [{ rubroClave: 'golosinas', rubro: 'Golosinas', subtotalCents: -13333 }, { rubroClave: 'bebidas', rubro: 'Bebidas', subtotalCents: -6667 }] });
    const a = dash([ped({})], { periodo: PERIODO2, cierres: [cierre], rendiciones: [nc] }).ajustes;
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ pct: 5, comisionCerrada: 75, comisionActual: 65, diferencia: -10, total: -200 });
  });
});
