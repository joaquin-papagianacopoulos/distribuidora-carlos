// REQ-COMR (RUN 20261014-1449): criterio de redondeo (AC-COMR-9).
// 1) precio al centavo (half away from zero sobre el decimal exacto);
// 2) subtotal del renglón en centavos;
// 3) UN solo redondeo por pedido y por vendedor (incluida la división), con BigInt.
import { decimalACentavos, subtotalRenglonCentavos, comisionParteRubro, baseRubrosPedido, armarLineaRubro, indexarProductos, calcularAvisos } from '../comisiones';
import { indexarTablaRubros } from '../rubros';

const base1 = (subtotalCents, clave = 'r') => ({ porRubro: [{ rubro: clave.toUpperCase(), clave, subtotalCents }], sinRubro: [] });

describe('AC-COMR-9 decimalACentavos (exacto, sin punto flotante)', () => {
  it.each([
    [1.005, 101], ['1.005', 101], ['1.0049999', 100], [0.005, 1], ['-0.005', -1], [-1.005, -101], ['10', 1000], [0, 0], [-0, 0],
    ['0.1', 10], [0.1 + 0.2, 30], ['123456789012.34', 12345678901234], ['7.999', 800],
  ])('AC-COMR-9 %p => %p centavos', (v, c) => {
    expect(decimalACentavos(v)).toBe(c);
  });

  it.each([
    [1e21], ['1e3'], ['1,5'], [' 1.5'], ['1.5 '], [NaN], [Infinity], [null], [undefined], [{}], [[]], ['abc'], [''], ['--1'], [true], ['99999999999999999999'],
  ])('AC-COMR-9 %p no es un número válido => null', (v) => {
    expect(decimalACentavos(v)).toBeNull();
  });
});

describe('AC-COMR-9 subtotal del renglón', () => {
  it('AC-COMR-9 precio × cantidad en centavos; cantidades decimales legacy hasta 6 dígitos', () => {
    expect(subtotalRenglonCentavos({ precio: 10.5, cantidad: 3 })).toEqual({ cents: 3150, valido: true });
    expect(subtotalRenglonCentavos({ precio: '0.333', cantidad: 3 })).toEqual({ cents: 99, valido: true });
    expect(subtotalRenglonCentavos({ precio: 1, cantidad: '0.005' })).toEqual({ cents: 1, valido: true }); // 0,5 centavo => 1
    expect(subtotalRenglonCentavos({ precio: 1, cantidad: 0.004 })).toEqual({ cents: 0, valido: true });
    expect(subtotalRenglonCentavos({ precio: 0, cantidad: 5 })).toEqual({ cents: 0, valido: true });
  });

  it('AC-COMR-9 negativos, NaN, texto, null/undefined, cantidad 0 o con 7 decimales => inválido (comisiona 0)', () => {
    for (const it of [
      { precio: -1, cantidad: 1 }, { precio: NaN, cantidad: 1 }, { precio: 'diez', cantidad: 1 }, { precio: null, cantidad: 1 },
      { precio: undefined, cantidad: 1 }, { precio: 10, cantidad: 0 }, { precio: 10, cantidad: -2 }, { precio: 10, cantidad: '1.1234567' },
      { precio: 10, cantidad: 'dos' }, { precio: 10, cantidad: null }, { precio: 10, cantidad: Infinity }, null, undefined,
      { precio: '9'.repeat(16), cantidad: '9'.repeat(16) },
    ]) {
      expect(subtotalRenglonCentavos(it)).toEqual({ cents: 0, valido: false });
    }
    expect(subtotalRenglonCentavos({ precio: 'x', eliminado: true })).toEqual({ cents: 0, valido: true, eliminado: true });
  });
});

describe('AC-COMR-9 un solo redondeo por pedido y por vendedor', () => {
  it('AC-COMR-9 tres renglones de $0,10 al 5 % => $0,02 (no 0,00 + 0,00 + 0,00 ni 0,03)', () => {
    const pedido = { total: 0.3, items: [{ productoId: 'p', precio: 0.1, cantidad: 1 }, { productoId: 'p', precio: 0.1, cantidad: 1 }, { productoId: 'p', precio: 0.1, cantidad: 1 }] };
    const base = baseRubrosPedido(pedido, indexarProductos([{ id: 'p', categoria: 'R' }]));
    expect(base.porRubro).toEqual([{ rubro: 'R', clave: 'r', subtotalCents: 30 }]);
    expect(comisionParteRubro({ base, pctPorClave: () => 5, divisionPct: 100 }).montoCents).toBe(2); // 1,5 => 2
  });

  it('AC-COMR-9 medio centavo exacto redondea alejándose del cero; % con 2 decimales', () => {
    // $1 al 0,5 % = 0,005 => 0,01
    expect(comisionParteRubro({ base: base1(100), pctPorClave: () => 0.5, divisionPct: 100 }).montoCents).toBe(1);
    // $100 al 10,25 % = 10,25
    expect(comisionParteRubro({ base: base1(10000), pctPorClave: () => 10.25, divisionPct: 100 }).montoCents).toBe(1025);
    // $33,33 al 10,25 % con división 33,33 % => 33,33 × 0,1025 × 0,3333 = 1,13866... => 1,14
    expect(comisionParteRubro({ base: base1(3333), pctPorClave: () => 10.25, divisionPct: 33.33 }).montoCents).toBe(114);
    // pct que vino como string con coma (de la tabla) se acepta igual que el dominio
    expect(comisionParteRubro({ base: base1(10000), pctPorClave: () => '5,5', divisionPct: '100' }).montoCents).toBe(550);
    // pct fuera de rango => sin % (0 + aviso)
    const malo = comisionParteRubro({ base: base1(10000), pctPorClave: () => 150, divisionPct: 100 });
    expect(malo.montoCents).toBe(0);
    expect(malo.sinPct).toHaveLength(1);
  });

  it('AC-COMR-9 totales grandes (10^12 centavos × 100 % × 100 %) sin perder precisión (BigInt)', () => {
    const c = comisionParteRubro({ base: base1(1e12), pctPorClave: () => 100, divisionPct: 100 });
    expect(c.montoCents).toBe(1e12);
    const c2 = comisionParteRubro({ base: base1(999999999999), pctPorClave: () => 33.33, divisionPct: 50 });
    // 999999999999 × 3333 × 5000 / 10^8 = 166649999999,83335 centavos => un solo redondeo => 166650000000 centavos
    expect(c2.montoCents).toBe(166650000000);
    expect(Number.isSafeInteger(c2.montoCents)).toBe(true);
  });

  it('AC-COMR-9 la división 50/50 también se redondea una sola vez por vendedor', () => {
    const P = (o) => ({ id: 1, remoteId: 'R1', clienteId: 10, clienteNombre: 'K', vendedor: 'B', fecha: '2026-10-10', estado: 'facturado', entregado: true, total: 0.03, items: [{ productoId: 'p', precio: 0.01, cantidad: 3 }], ...o });
    const l = armarLineaRubro(P({}), {
      clientes: [{ id: 10, nombre: 'K', vendedor: 'A' }],
      vendedores: [{ nombre: 'A', remoteId: 'a', permiso: 2 }, { nombre: 'B', remoteId: 'b', permiso: 2 }],
      productosById: indexarProductos([{ id: 'p', categoria: 'R' }]),
      indiceTabla: indexarTablaRubros([{ id: 1, vendedorId: 'a', rubro: 'R', pct: 50 }, { id: 2, vendedorId: 'b', rubro: 'R', pct: 50 }]),
      asignacionBorrador: { modo: 'dividir' },
    });
    // 3 centavos × 50 % × 50 % = 0,75 centavos => 1 centavo cada uno (no 0)
    expect(l.partes.map(p => p.monto)).toEqual([0.01, 0.01]);
    // total repartido como hoy: la última parte se lleva el resto
    expect(l.partes.map(p => p.total)).toEqual([0.02, 0.01]);
  });
});

describe('S-COMR-05 AC-COMR-9 números patológicos: renglón inválido identificable, no desborde', () => {
  it('S-COMR-05 precio de 13 dígitos enteros o cantidad de 10 son inválidos (mismo tope que la 005)', () => {
    expect(subtotalRenglonCentavos({ precio: '1000000000000', cantidad: 1 }).valido).toBe(false);
    expect(subtotalRenglonCentavos({ precio: '999999999999', cantidad: 1 }).valido).toBe(true);
    expect(subtotalRenglonCentavos({ precio: 1, cantidad: '1000000000' }).valido).toBe(false);
    expect(decimalACentavos('1'.repeat(200))).toBeNull();
  });

  it('S-COMR-05 si la base del pedido pasa el tope, el renglón excedente es inválido y el aviso nombra el pedido', () => {
    const items = [{ productoId: "p", precio: 60000000000, cantidad: 1 }, { productoId: "p", precio: 60000000000, cantidad: 1 }];
    const base = baseRubrosPedido({ items }, indexarProductos([{ id: 'p', categoria: 'R' }]));
    expect(base.invalidos).toBe(1);
    expect(base.porRubro[0].subtotalCents).toBe(6000000000000);
    const l = armarLineaRubro(
      { id: 1, remoteId: 'R77', clienteId: 1, clienteNombre: 'K', vendedor: 'A', fecha: '2026-10-10', estado: 'facturado', entregado: true, total: 100, items },
      { clientes: [{ id: 1, nombre: 'K', vendedor: 'A' }], vendedores: [{ nombre: 'A', remoteId: 'a', permiso: 2 }], productosById: indexarProductos([{ id: 'p', categoria: 'R' }]), indiceTabla: indexarTablaRubros([]) },
    );
    const av = calcularAvisos([l]);
    expect(av.renglonInvalido).toEqual([{ pedidoId: 'R77', clienteNombre: 'K', renglones: 1 }]);
  });
});
