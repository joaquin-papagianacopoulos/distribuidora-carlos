// REQ-COMR (RUN 20261014-1449): comisión por vendedor y por rubro, renglón por
// renglón (src/domain/comisiones.js). Ejemplos del SPEC incluidos.
import {
  armarDashboard, armarLineaRubro, baseRubrosPedido, comisionParteRubro, calcularAvisos, resumirPorVendedor,
  puedeCerrar, indexarProductos, MODELO_VIGENTE, MODELOS_COMISION, armarLinea,
} from '../comisiones';
import { indexarTablaRubros } from '../rubros';

const PERIODO = { desde: '2026-10-01', hasta: '2026-10-31' };
const VENDEDORES = [
  { id: 1, remoteId: 'u-jorge', nombre: 'Jorge', permiso: 1 },
  { id: 2, remoteId: 'u-ana', nombre: 'Ana', permiso: 2 },
  { id: 3, remoteId: 'u-beto', nombre: 'Beto', permiso: 2 },
  { id: 4, nombre: 'Nuevo', permiso: 2 }, // sin remoteId (nunca sincronizado)
];
const CLIENTES = [
  { id: 10, nombre: 'Kiosco', vendedor: 'Ana', comision: 50 }, // la comision vieja NO se usa
  { id: 11, nombre: 'Almacén', vendedor: 'Nuevo' },
  { id: 12, nombre: 'Sin vendedor', vendedor: '' },
];
const PRODUCTOS = [
  { id: 'p-gol', nombre: 'Alfajor', categoria: 'Golosinas' },
  { id: 'p-beb', nombre: 'Gaseosa', categoria: 'Bebidas' },
  { id: 'p-lac', nombre: 'Yogur', categoria: 'Lácteos' },
  { id: 'p-sin', nombre: 'Varios', categoria: '' },
];
const TABLA = [
  { id: 't1', vendedorId: 'u-ana', rubro: 'Golosinas', rubroClave: 'golosinas', pct: 5 },
  { id: 't2', vendedorId: 'u-ana', rubro: 'Bebidas', rubroClave: 'bebidas', pct: 10 },
  { id: 't3', vendedorId: 'u-beto', rubro: 'Golosinas', rubroClave: 'golosinas', pct: 3 },
  { id: 't4', vendedorId: 'u-beto', rubro: 'Bebidas', rubroClave: 'bebidas', pct: null }, // vaciado
];
const item = (productoId, precio, cantidad = 1, extra = {}) => ({ productoId, nombre: productoId, precio, cantidad, ...extra });
const ped = (o) => ({ id: 1, remoteId: 'R1', clienteId: 10, clienteNombre: 'Kiosco', vendedor: 'Ana', fecha: '2026-10-10', estado: 'facturado', entregado: true, total: 1000, items: [item('p-gol', 1000)], ...o });
const ctx = (over = {}) => ({
  clientes: CLIENTES, vendedores: VENDEDORES, productosById: indexarProductos(PRODUCTOS), indiceTabla: indexarTablaRubros(TABLA), ...over,
});
const dash = (pedidos, over = {}) => armarDashboard({ pedidos, clientes: CLIENTES, vendedores: VENDEDORES, cierres: [], periodo: PERIODO, modelo: 'rubro', productos: PRODUCTOS, tablaRubros: TABLA, ...over });

describe('AC-COMR-9 comisión por renglón y por pedido', () => {
  it('AC-COMR-9 varios rubros con % distintos: suma de renglones (el % del cliente ya no se usa)', () => {
    const l = armarLineaRubro(ped({ total: 1500, items: [item('p-gol', 500, 2), item('p-beb', 250, 2)] }), ctx());
    expect(MODELO_VIGENTE).toBe('rubro');
    expect(MODELOS_COMISION).toEqual(['cliente', 'rubro']);
    expect(l).toMatchObject({ modelo: 'rubro', pct: null, total: 1500, comision: 100, comisionUnica: true });
    expect(l.partes).toHaveLength(1);
    expect(l.partes[0]).toMatchObject({ vendedor: 'Ana', vendedorId: 'u-ana', pct: 100, monto: 100, total: 1500 });
    expect(l.partes[0].desglose).toEqual([
      { rubro: 'Bebidas', rubroClave: 'bebidas', subtotal: 500, pct: 10, comision: 50 },
      { rubro: 'Golosinas', rubroClave: 'golosinas', subtotal: 1000, pct: 5, comision: 50 },
    ]);
  });

  it('AC-COMR-9 AC-COMR-11 rubro sin % para el vendedor: ese renglón comisiona 0 y genera aviso (c1)', () => {
    const l = armarLineaRubro(ped({ total: 1200, items: [item('p-gol', 1000), item('p-lac', 200)] }), ctx());
    expect(l.comision).toBe(50);
    expect(l.partes[0].desglose.find(d => d.rubroClave === 'lacteos')).toEqual({ rubro: 'Lácteos', rubroClave: 'lacteos', subtotal: 200, pct: null, comision: 0 });
    expect(l.avisosRubro.sinPct).toEqual([{ vendedor: 'Ana', vendedorId: 'u-ana', rubro: 'Lácteos', clave: 'lacteos', subtotalCents: 20000 }]);
    // % vaciado (null) cuenta igual que sin fila
    const b = armarLineaRubro(ped({ vendedor: 'Beto' }), ctx({ asignacionBorrador: { modo: 'cargador' } }));
    expect(b.partes[0]).toMatchObject({ vendedor: 'Beto', monto: 30 });
    const bb = armarLineaRubro(ped({ vendedor: 'Beto', items: [item('p-beb', 1000)] }), ctx({ asignacionBorrador: { modo: 'cargador' } }));
    expect(bb.comision).toBe(0);
    expect(bb.avisosRubro.sinPct[0]).toMatchObject({ vendedor: 'Beto', clave: 'bebidas' });
  });

  it('AC-COMR-9 AC-COMR-11 producto sin rubro: comisiona 0 y aviso (c2); se ve como "Sin rubro" en el desglose', () => {
    const l = armarLineaRubro(ped({ total: 1300, items: [item('p-gol', 1000), item('p-sin', 300, 1, { nombre: 'Varios' })] }), ctx());
    expect(l.comision).toBe(50);
    expect(l.avisosRubro.sinRubro).toEqual([{ productoId: 'p-sin', nombre: 'Varios', subtotalCents: 30000 }]);
    expect(l.partes[0].desglose.at(-1)).toEqual({ rubro: '', rubroClave: '', subtotal: 300, pct: null, comision: 0 });
  });

  it('AC-COMR-9 renglones eliminado (tachados) no cuentan ni generan aviso', () => {
    const l = armarLineaRubro(ped({ items: [item('p-gol', 1000), item('p-beb', 999, 1, { eliminado: true }), item('p-lac', 5, 1, { eliminado: 'true' })] }), ctx());
    expect(l.comision).toBe(50);
    expect(l.avisosRubro).toMatchObject({ sinPct: [], sinRubro: [], invalidos: 0 });
  });

  it('AC-COMR-9 renglón inválido (precio texto, NaN, negativo, cantidad 0) comisiona 0 y avisa', () => {
    const l = armarLineaRubro(ped({ items: [item('p-gol', 1000), item('p-gol', 'abc'), item('p-gol', NaN), item('p-gol', -5), item('p-gol', 10, 0), item('p-gol', 10, null)] }), ctx());
    expect(l.comision).toBe(50);
    expect(l.avisosRubro.invalidos).toBe(5);
    // S9: pedido con total > 0 y sin items (WEB) => 1 renglón inválido, comisión 0
    const web = armarLineaRubro(ped({ items: undefined, total: 800 }), ctx());
    expect(web).toMatchObject({ comision: 0, total: 800 });
    expect(web.avisosRubro.invalidos).toBe(1);
    expect(baseRubrosPedido({ total: 0 }, new Map()).invalidos).toBe(0);
  });

  it('AC-COMR-5 renglón con rubro guardado vs viejo sin rubro (rubro actual del producto) vs producto borrado', () => {
    const l = armarLineaRubro(ped({
      total: 3000,
      items: [
        item('p-gol', 1000, 1, { rubro: 'Bebidas' }), // guardado: Bebidas (10 %) aunque hoy el producto sea Golosinas
        item('p-gol', 1000), // viejo: rubro actual (Golosinas 5 %)
        item('p-borrado', 1000), // producto borrado => sin rubro
      ],
    }), ctx());
    expect(l.comision).toBe(150);
    expect(l.avisosRubro.sinRubro).toEqual([{ productoId: 'p-borrado', nombre: 'p-borrado', subtotalCents: 100000 }]);
  });
});

describe('AC-COMR-10 división entre dos vendedores con tablas distintas', () => {
  // Ficha: Ana; cargó: Beto (vendedor, permiso 2) => se puede dividir.
  const P = ped({ vendedor: 'Beto' });

  it('AC-COMR-10 ejemplo del SPEC: Golosinas $1000, A=5 %, B=3 %, 50/50 => A $25 y B $15', () => {
    const l = armarLineaRubro(P, ctx({ asignacionBorrador: { modo: 'dividir' } }));
    expect(l.asignacion.modo).toBe('dividir');
    expect(l.partes.map(p => [p.vendedor, p.vendedorId, p.pct, p.total, p.monto])).toEqual([
      ['Ana', 'u-ana', 50, 500, 25],
      ['Beto', 'u-beto', 50, 500, 15],
    ]);
    // No hay una comisión única del pedido (AC-COMR-10)
    expect(l.comisionUnica).toBe(false);
    expect(l.comision).toBe(40); // suma técnica para el servidor
    const r = resumirPorVendedor([l]);
    expect(r.map(v => [v.vendedor, v.totalVendido, v.totalComision])).toEqual([['Ana', 500, 25], ['Beto', 500, 15]]);
    expect(r[0].detalle[0].pedidos[0]).toMatchObject({ comision: 25, comisionPedido: null, division: 50, modelo: 'rubro', vendedorId: 'u-ana' });
    expect(r[0].detalle[0].pedidos[0].desglose).toEqual([{ rubro: 'Golosinas', rubroClave: 'golosinas', subtotal: 1000, pct: 5, comision: 25 }]);
  });

  it('AC-COMR-10 70/30 con tablas distintas: A 70 % × 5 % y B 30 % × 3 %', () => {
    const l = armarLineaRubro(P, ctx({ asignacionBorrador: { modo: 'dividir', pctFicha: '70', pctCargador: '30' } }));
    expect(l.partes.map(p => [p.vendedor, p.total, p.monto])).toEqual([['Ana', 700, 35], ['Beto', 300, 9]]);
  });

  it('AC-COMR-10 modos ficha, cargador, otro y sin_comision aplican la tabla del que recibe', () => {
    expect(armarLineaRubro(P, ctx()).partes.map(p => [p.vendedor, p.monto])).toEqual([['Ana', 50]]);
    expect(armarLineaRubro(P, ctx({ asignacionBorrador: { modo: 'cargador' } })).partes.map(p => [p.vendedor, p.monto])).toEqual([['Beto', 30]]);
    expect(armarLineaRubro(P, ctx({ asignacionBorrador: { modo: 'otro', vendedor: 'Beto' } })).partes.map(p => [p.vendedor, p.monto])).toEqual([['Beto', 30]]);
    const sc = armarLineaRubro(ped({ items: [item('p-sin', 10), item('p-gol', 'x')] }), ctx({ asignacionBorrador: { modo: 'sin_comision' } }));
    expect(sc).toMatchObject({ comision: 0, partes: [], comisionUnica: true });
    expect(sc.avisosRubro).toEqual({ sinPct: [], sinRubro: [], vendedorSinId: [], invalidos: 0 });
    // asignación inválida => sin partes, con errores (AC-COM-8 sin cambios)
    const inv = armarLineaRubro(P, ctx({ asignacionBorrador: { modo: 'dividir', pctFicha: '60', pctCargador: '60' } }));
    expect(inv).toMatchObject({ partes: [], comision: 0 });
    expect(inv.asignacionErrores).toHaveProperty('suma');
  });
});

describe('AC-COMR-12 desglose por rubro que suma exacto', () => {
  it('AC-COMR-12 el desglose se prorratea (mayor resto) y suma EXACTO el monto del vendedor', () => {
    const tabla = indexarTablaRubros([
      { id: 'a', vendedorId: 'v', rubro: 'A', pct: 3.33 },
      { id: 'b', vendedorId: 'v', rubro: 'B', pct: 3.33 },
      { id: 'c', vendedorId: 'v', rubro: 'C', pct: 3.33 },
    ]);
    const base = { porRubro: [{ rubro: 'A', clave: 'a', subtotalCents: 1 }, { rubro: 'B', clave: 'b', subtotalCents: 1 }, { rubro: 'C', clave: 'c', subtotalCents: 1 }], sinRubro: [] };
    const conMonto = { porRubro: base.porRubro.map(r => ({ ...r, subtotalCents: 1001 })), sinRubro: [] };
    const c = comisionParteRubro({ base: conMonto, vendedorId: 'v', pctPorClave: (k) => tabla.get('v').get(k).pct, divisionPct: 100 });
    // 3 × 10,01 × 3,33 % = 1,000 => un solo redondeo: 1,00 (no 0,33 + 0,33 + 0,33 = 0,99)
    expect(c.montoCents).toBe(100);
    expect(c.desglose.map(d => d.comision)).toEqual([0.34, 0.33, 0.33]);
    expect(c.desglose.reduce((a, d) => a + Math.round(d.comision * 100), 0)).toBe(100);
    // Base con pesos en cero y entradas raras
    expect(comisionParteRubro({ base, vendedorId: 'v', pctPorClave: () => 0, divisionPct: 100 }).montoCents).toBe(0);
    expect(comisionParteRubro({ base, vendedorId: 'v', pctPorClave: 'no-es-funcion', divisionPct: 100 }).sinPct).toHaveLength(3);
    expect(comisionParteRubro({ base: conMonto, vendedorId: 'v', pctPorClave: () => 5, divisionPct: 'raro' }).montoCents).toBe(0);
    expect(comisionParteRubro()).toMatchObject({ montoCents: 0, desglose: [], sinPct: [] });
  });
});

describe('AC-COMR-11 avisos (c1) y (c2) en el dashboard', () => {
  const PEDIDOS = [
    ped({ remoteId: 'R1', total: 1200, items: [item('p-gol', 1000), item('p-lac', 200)] }),
    ped({ id: 2, remoteId: 'R2', total: 300, items: [item('p-lac', 300)] }),
    ped({ id: 3, remoteId: 'R3', vendedor: 'Beto', total: 400, items: [item('p-lac', 400), item('p-sin', 0, 1, { nombre: 'Varios' })] }),
    ped({ id: 4, remoteId: 'R4', total: 50, items: [item('p-sin', 25, 2, { nombre: 'Varios' })] }),
  ];

  it('AC-COMR-11 (c1) agrupado por vendedor + rubro con contador de pedidos y monto afectado (en divididos, la parte del vendedor)', () => {
    const d = dash(PEDIDOS, { borrador: { asignaciones: { R3: { modo: 'dividir' } } } });
    expect(d.modelo).toBe('rubro');
    expect(d.avisos.vendedorSinPctRubro).toEqual([
      { vendedor: 'Ana', vendedorId: 'u-ana', rubro: 'Lácteos', clave: 'lacteos', pedidos: 3, montoAfectado: 700 },
      { vendedor: 'Beto', vendedorId: 'u-beto', rubro: 'Lácteos', clave: 'lacteos', pedidos: 1, montoAfectado: 200 },
    ]);
    expect(d.avisos.productosSinRubro).toEqual([{ productoId: 'p-sin', nombre: 'Varios', renglones: 2, monto: 50 }]);
    expect(d.avisos.contadores).toMatchObject({ c: 0, c1: 2, c2: 1, vendedorSinId: 0, renglonInvalido: 0 });
    expect(d.avisos.contadores.total).toBe(d.avisos.contadores.a + d.avisos.contadores.b + 2 + 1);
  });

  it('AC-COMR-8 vendedor sin remoteId: comisiona 0, aviso y bloquea el cierre', () => {
    const d = dash([ped({ clienteId: 11, clienteNombre: 'Almacén', vendedor: 'Nuevo' })]);
    expect(d.lineas[0].partes[0]).toMatchObject({ vendedor: 'Nuevo', vendedorId: null, monto: 0 });
    expect(d.avisos.vendedorSinSincronizar).toEqual([{ vendedor: 'Nuevo', pedidos: 1 }]);
    expect(d.avisos.contadores.vendedorSinId).toBe(1);
    expect(d.avisos.vendedorSinPctRubro).toEqual([]); // no se mezcla con (c1)
    expect(puedeCerrar(d).motivos.join(' ')).toMatch(/vendedor sin sincronizar/);
  });

  it('AC-COMR-11 renglón inválido aparece en avisos con el pedido', () => {
    const d = dash([ped({ items: [item('p-gol', 'x')] })]);
    expect(d.avisos.renglonInvalido).toEqual([{ pedidoId: 'R1', clienteNombre: 'Kiosco', renglones: 1 }]);
    expect(calcularAvisos([{ modelo: 'rubro', avisosRubro: { sinRubro: [{ productoId: null, nombre: 'Suelto', subtotalCents: 5 }] } }]).productosSinRubro[0]).toMatchObject({ nombre: 'Suelto', renglones: 1 });
  });

  it('AC-COMR-11 (c2) lista varios productos sin rubro ordenados por nombre, sumando renglones y monto', () => {
    const av = calcularAvisos([
      { modelo: 'rubro', pedidoId: 'R1', avisosRubro: { sinRubro: [{ productoId: 'z', nombre: 'Zapallo', subtotalCents: 100 }, { productoId: 'a', nombre: 'Ajo', subtotalCents: 50 }] } },
      { modelo: 'rubro', pedidoId: 'R2', avisosRubro: { sinRubro: [{ productoId: 'a', nombre: 'Ajo', subtotalCents: 25 }] } },
    ]);
    expect(av.productosSinRubro).toEqual([
      { productoId: 'a', nombre: 'Ajo', renglones: 2, monto: 0.75 },
      { productoId: 'z', nombre: 'Zapallo', renglones: 1, monto: 1 },
    ]);
  });

  it('AC-COMR-7 puedeCerrar: falta la 005 o hay % sin sincronizar => no se cierra', () => {
    const d = dash([ped({})], { faltaMigracion005: true, pendientesRubro: 2 });
    expect(d).toMatchObject({ faltaMigracion005: true, pendientesRubro: 2 });
    const m = puedeCerrar(d).motivos.join(' ');
    expect(m).toMatch(/migración 005/);
    expect(m).toMatch(/2 % de comisión sin sincronizar/);
    expect(puedeCerrar(dash([ped({})])).ok).toBe(true);
  });
});

describe('AC-COMR-9 compatibilidad del modelo viejo', () => {
  it('AC-COMR-9 armarDashboard sin modelo (legacy) da exactamente lo mismo que antes, aunque haya tabla de %', () => {
    const base = { pedidos: [ped({})], clientes: CLIENTES, vendedores: VENDEDORES, cierres: [], periodo: PERIODO };
    const legacy = armarDashboard(base);
    const conExtras = armarDashboard({ ...base, productos: PRODUCTOS, tablaRubros: TABLA, pendientesRubro: 3 });
    expect(conExtras).toEqual(legacy);
    expect(legacy.lineas[0]).toEqual(armarLinea(ped({}), { clientes: CLIENTES, vendedores: VENDEDORES }));
    expect(legacy.lineas[0]).toMatchObject({ pct: 50, comision: 500 });
    expect(legacy).not.toHaveProperty('modelo');
    expect(legacy.avisos.contadores).not.toHaveProperty('c1');
    // con modelo 'rubro' la comisión sale de la tabla (5 % de 1000)
    expect(dash([ped({})]).lineas[0].comision).toBe(50);
  });

  it('AC-COMR-15 indexarProductos: ignora basura y duplicados', () => {
    const m = indexarProductos([{ id: 1, categoria: 'A' }, { id: '1', categoria: 'B' }, null, { categoria: 'sin id' }]);
    expect([...m.keys()]).toEqual(['1']);
    expect(m.get('1').categoria).toBe('A');
    expect(indexarProductos(undefined).size).toBe(0);
  });
});
