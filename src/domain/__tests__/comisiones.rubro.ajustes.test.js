// REQ-COMR (RUN 20261014-1449): ajustes pendientes (AC-COMR-14).
// - Base con el modelo viejo ('cliente'): el cambio de modelo NO genera ajustes;
//   si el pedido cambia, diferencia de total × % congelado (como la 003).
// - Base con el modelo nuevo ('rubro'): diferencia recalculada por rubro con el
//   % congelado (un rubro nuevo usa el % vigente) y la asignación congelada.
import { armarDashboard, construirCierre, calcularAjustesPendientes, indexarProductos } from '../comisiones';
import { indexarTablaRubros } from '../rubros';

const PERIODO = { desde: '2026-10-01', hasta: '2026-10-31' };
const PERIODO2 = { desde: '2026-11-01', hasta: '2026-11-30' };
const VENDEDORES = [
  { id: 1, remoteId: 'u-jorge', nombre: 'Jorge', permiso: 1 },
  { id: 2, remoteId: 'u-ana', nombre: 'Ana', permiso: 2 },
  { id: 3, remoteId: 'u-beto', nombre: 'Beto', permiso: 2 },
];
const CLIENTES = [{ id: 10, nombre: 'Kiosco', vendedor: 'Ana', comision: 5 }];
const PRODUCTOS = [{ id: 'g', categoria: 'Golosinas' }, { id: 'b', categoria: 'Bebidas' }];
const TABLA = [
  { id: 't1', vendedorId: 'u-ana', rubro: 'Golosinas', pct: 5 },
  { id: 't2', vendedorId: 'u-ana', rubro: 'Bebidas', pct: 10 },
  { id: 't3', vendedorId: 'u-beto', rubro: 'Golosinas', pct: 3 },
];
const it1 = (productoId, precio, cantidad = 1) => ({ productoId, precio, cantidad });
const ped = (o) => ({ id: 1, remoteId: 'R1', clienteId: 10, clienteNombre: 'Kiosco', vendedor: 'Ana', fecha: '2026-10-10', estado: 'facturado', entregado: true, total: 1000, items: [it1('g', 1000)], ...o });
const dash = (pedidos, cierres = [], over = {}) => armarDashboard({
  pedidos, clientes: CLIENTES, vendedores: VENDEDORES, cierres, periodo: PERIODO2, modelo: 'rubro', productos: PRODUCTOS, tablaRubros: TABLA, ...over,
});
// Cierra el período de octubre con el modelo por rubro y lo deja vigente.
const cerrarRubro = (pedidos, borrador = null, tabla = TABLA) => {
  const d = armarDashboard({ pedidos, clientes: CLIENTES, vendedores: VENDEDORES, cierres: [], periodo: PERIODO, borrador, modelo: 'rubro', productos: PRODUCTOS, tablaRubros: tabla });
  return { ...construirCierre(d, { admin: 'Jorge', genId: () => 'c-rubro', now: 1 }), estado: 'vigente' };
};
const CIERRE_CLIENTE = {
  id: 'c-viejo', estado: 'vigente', desde: '2026-10-01', hasta: '2026-10-31',
  lineas: [{ tipo: 'pedido', pedidoId: 'R1', fecha: '2026-10-10', clienteId: 10, clienteNombre: 'Kiosco', total: 1000, pct: 5, comision: 50, asignacion: { modo: 'ficha', partes: [{ vendedor: 'Ana', pct: 100 }] }, partes: [{ vendedor: 'Ana', pct: 100, monto: 50, total: 1000 }] }],
};

describe('AC-COMR-14 ajustes de pedidos cerrados con el modelo viejo (cliente)', () => {
  it('AC-COMR-14 sin cambios en el pedido: 0 ajustes aunque ahora exista una tabla de % por rubro', () => {
    expect(dash([ped({})], [CIERRE_CLIENTE]).ajustes).toEqual([]);
    expect(calcularAjustesPendientes([ped({})], [CIERRE_CLIENTE])).toEqual([]);
  });

  it('AC-COMR-14 con el total cambiado: diferencia de total × % congelado (igual que antes, sin campos nuevos)', () => {
    const a = dash([ped({ total: 1200, items: [it1('g', 1200)] })], [CIERRE_CLIENTE]).ajustes;
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ tipo: 'ajuste', pedidoId: 'R1', pct: 5, comisionCerrada: 50, comisionActual: 60, diferencia: 10, total: 200, motivo: 'total_cambio' });
    expect(a[0]).not.toHaveProperty('modelo');
    expect(a[0].partes).toEqual([{ vendedor: 'Ana', pct: 100, monto: 10, total: 200 }]);
  });
});

describe('AC-COMR-14 ajustes de pedidos cerrados con el modelo nuevo (rubro)', () => {
  it('AC-COMR-14 el cierre congela la línea con modelo, vendedorId y desglose', () => {
    const c = cerrarRubro([ped({})]);
    expect(c.modelo).toBe('rubro');
    expect(c.lineas[0]).toMatchObject({ modelo: 'rubro', pct: null, comision: 50 });
    expect(c.lineas[0].partes[0]).toMatchObject({ vendedor: 'Ana', vendedorId: 'u-ana', monto: 50, desglose: [{ rubro: 'Golosinas', rubroClave: 'golosinas', subtotal: 1000, pct: 5, comision: 50 }] });
  });

  it('AC-COMR-14 cambiar la tabla de % sin editar el pedido: 0 ajustes', () => {
    const c = cerrarRubro([ped({})]);
    const tablaNueva = [{ id: 't1', vendedorId: 'u-ana', rubro: 'Golosinas', pct: 9 }];
    expect(dash([ped({})], [c], { tablaRubros: tablaNueva }).ajustes).toEqual([]);
  });

  it('AC-COMR-14 pedido editado: diferencia por rubro con el % CONGELADO (no el vigente)', () => {
    const c = cerrarRubro([ped({})]);
    const tablaNueva = [{ id: 't1', vendedorId: 'u-ana', rubro: 'Golosinas', pct: 8 }];
    const a = dash([ped({ total: 2000, items: [it1('g', 2000)] })], [c], { tablaRubros: tablaNueva }).ajustes;
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ tipo: 'ajuste', modelo: 'rubro', pct: null, comisionCerrada: 50, comisionActual: 100, diferencia: 50, total: 1000, ajusteDeCierreId: 'c-rubro', ajusteSeq: 1 });
    expect(a[0].partes).toEqual([{
      vendedor: 'Ana', vendedorId: 'u-ana', pct: 100, monto: 50, total: 1000,
      desglose: [{ rubro: 'Golosinas', rubroClave: 'golosinas', subtotal: 1000, pct: 5, comision: 50 }],
    }]);
  });

  it('AC-COMR-14 rubro que no estaba en el cierre: usa el % vigente (supuesto S6)', () => {
    const c = cerrarRubro([ped({})]);
    const a = dash([ped({ total: 1500, items: [it1('g', 1000), it1('b', 500)] })], [c]).ajustes;
    expect(a[0]).toMatchObject({ diferencia: 50, total: 500 });
    expect(a[0].partes[0].desglose).toEqual([{ rubro: 'Bebidas', rubroClave: 'bebidas', subtotal: 500, pct: 10, comision: 50 }]);
  });

  it('AC-COMR-14 pedido que deja de contar: ajuste negativo por vendedor (división congelada 50/50 => -25 y -15)', () => {
    const c = cerrarRubro([ped({ vendedor: 'Beto' })], { asignaciones: { R1: { modo: 'dividir' } } });
    expect(c.lineas[0].partes.map(p => p.monto)).toEqual([25, 15]);
    const a = dash([ped({ vendedor: 'Beto', entregado: false })], [c]).ajustes;
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ motivo: 'ya_no_cuenta', diferencia: -40, total: -1000, comisionActual: 0, comisionUnica: false });
    expect(a[0].partes.map(p => [p.vendedor, p.vendedorId, p.monto, p.total])).toEqual([['Ana', 'u-ana', -25, -500], ['Beto', 'u-beto', -15, -500]]);
    expect(a[0].partes[0].desglose).toEqual([{ rubro: 'Golosinas', rubroClave: 'golosinas', subtotal: -1000, pct: 5, comision: -25 }]);
  });

  it('AC-COMR-14 con un ajuste ya cerrado, el siguiente parte de base + ajustes (no se cobra dos veces)', () => {
    const c = cerrarRubro([ped({})]);
    const editado = ped({ total: 2000, items: [it1('g', 2000)] });
    const d2 = dash([editado], [c]);
    expect(d2.ajustes).toHaveLength(1);
    const c2 = { ...construirCierre(d2, { admin: 'Jorge', genId: () => 'c-nov', now: 2 }), estado: 'vigente' };
    expect(c2.lineas.find(l => l.tipo === 'ajuste')).toMatchObject({ modelo: 'rubro', comision: 50 });
    expect(dash([editado], [c, c2]).ajustes).toEqual([]);
    // una tercera edición vuelve a generar SOLO la diferencia nueva
    const a3 = dash([ped({ total: 2100, items: [it1('g', 2100)] })], [c, c2]).ajustes;
    expect(a3[0]).toMatchObject({ diferencia: 5, ajusteSeq: 2, comisionCerrada: 100 });
  });

  it('AC-COMR-14 sin_comision: no genera ajustes; base sin vendorId resuelve por nombre; pedido sin datos locales se ignora', () => {
    const c = cerrarRubro([ped({})], { asignaciones: { R1: { modo: 'sin_comision' } } });
    expect(dash([ped({ total: 5000, items: [it1('g', 5000)] })], [c]).ajustes).toEqual([]);
    const cb = cerrarRubro([ped({})]);
    cb.lineas[0].partes[0].vendedorId = undefined;
    const a = calcularAjustesPendientes([ped({ total: 2000, items: [it1('g', 2000)] })], [cb], undefined, {
      productosById: indexarProductos(PRODUCTOS), indiceTabla: indexarTablaRubros(TABLA), vendedores: VENDEDORES,
    });
    expect(a[0].partes[0]).toMatchObject({ vendedorId: 'u-ana', monto: 50 });
    expect(calcularAjustesPendientes([], [cb])).toEqual([]);
    // sin ctx (dispatch por modelo de la base): usa el rubro guardado del renglón
    const sinCtx = calcularAjustesPendientes([ped({ total: 2000, items: [{ ...it1('g', 2000), rubro: 'Golosinas' }] })], [cb]);
    expect(sinCtx[0].diferencia).toBe(50);
  });
});
