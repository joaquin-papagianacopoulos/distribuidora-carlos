// QA RUN 20261012-2106 — C3 (tope MAX_CANTIDAD tipeado) y C4 (bulto solo por id).
import {
  cantidadTipeada, sumarCantidades, validarCantidadesItems, mensajeCantidadesInvalidas, productoParaBulto,
  sumarBulto, sumarBultoRenglon, normalizarBultoX,
} from '../bultos';
import { MAX_CANTIDAD } from '../stock';

describe('AC-BUL-6 AC-STK-8 AC-SEC-2 cantidadTipeada: bordes del tope', () => {
  it('AC-STK-8 MAX_CANTIDAD vale 1.000.000 (el servidor rechaza abs(cantidad) > 1000000)', () => {
    expect(MAX_CANTIDAD).toBe(1000000);
  });

  it.each([
    ['1', 1], ['999999', 999999], ['1000000', 1000000], ['1.000.000', 1000000], [' 12 ', 12], ['0012', 12], ['1.000', 1000], ['12.345', 12345],
    [5, 5], [1000000, 1000000], [5.0, 5],
  ])('AC-BUL-6 %p => %p', (entrada, esperado) => {
    expect(cantidadTipeada(entrada)).toBe(esperado);
  });

  it.each([
    '1000001', '1.000.001', '9999999999999999999', '0', '00', '-1', '+5', '', '   ', 'abc', '1e3', '0x10', '2,5', '2.5', '1.00', '1..000', '1.0000',
    '\uFF11\uFF12', '\u0663', '5 kg', 'NaN', 'Infinity', '1,000', '1 000.5',
    null, undefined, NaN, Infinity, -Infinity, 1000001, 0, -3, 2.5, 1e21, {}, [], [5], true, () => 5, 10n,
  ])('AC-BUL-6 AC-SEC-2 entrada invalida %p => null', (entrada) => {
    expect(cantidadTipeada(entrada)).toBeNull();
  });

  it('AC-BUL-6 el espacio como separador de miles se acepta ("1 000" => 1000) y no cambia el valor', () => {
    expect(cantidadTipeada('1 000')).toBe(1000);
  });

  // BUG: BUG-BUL-01 (ver qa-report.md). La regla de miles /^\d{1,3}(\.\d{3})+$/
  // acepta un primer grupo "0" o con ceros a la izquierda: "0.500" => 500 y
  // "0.001" => 1. Nadie escribe asi un entero agrupado; quien tipea "0.500"
  // esta pensando en un decimal (0,5) y se lleva 500 unidades al pedido.
  it('AC-BUL-6 AC-SEC-2 BUG "0.500" y "0.001" (decimales) no se leen como 500 y 1 unidades', () => {
    expect(cantidadTipeada('0.500')).toBeNull();
    expect(cantidadTipeada('0.001')).toBeNull();
    expect(cantidadTipeada('00.100')).toBeNull();
  });
});

describe('AC-BUL-7 sumarCantidades y validarCantidadesItems: bordes', () => {
  it('AC-BUL-7 sumarCantidades: en el tope exacto sirve, un uno mas no; decimales, negativos, texto y NaN dan null', () => {
    expect(sumarCantidades(MAX_CANTIDAD - 1, 1)).toBe(MAX_CANTIDAD);
    expect(sumarCantidades(MAX_CANTIDAD, 1)).toBeNull();
    expect(sumarCantidades(MAX_CANTIDAD, 0)).toBe(MAX_CANTIDAD);
    expect(sumarCantidades(0, 0)).toBe(0);
    for (const malo of [[1.5, 1], [1, -1], ['1', 1], [NaN, 1], [1, undefined], [null, 1], [Infinity, 1], [1, {}]]) expect(sumarCantidades(...malo)).toBeNull();
  });

  it('AC-STK-8 validarCantidadesItems: 0, negativos, decimales, texto, NaN, Infinity y > tope se marcan con el nombre del producto', () => {
    const items = [
      { productoId: 1, nombre: 'ok', cantidad: 10 },
      { productoId: 2, nombre: 'cero', cantidad: 0 },
      { productoId: 3, nombre: 'neg', cantidad: -1 },
      { productoId: 4, nombre: 'dec', cantidad: 2.5 },
      { productoId: 5, nombre: 'txt', cantidad: '5' },
      { productoId: 6, nombre: 'nan', cantidad: NaN },
      { productoId: 7, nombre: 'inf', cantidad: Infinity },
      { productoId: 8, nombre: 'tope', cantidad: MAX_CANTIDAD },
      { productoId: 9, nombre: 'sobre', cantidad: MAX_CANTIDAD + 1 },
      { productoId: 10, nombre: 'sin', cantidad: undefined },
      null,
    ];
    const r = validarCantidadesItems(items);
    expect(r.ok).toBe(false);
    expect(r.errores.map(e => e.nombre)).toEqual(['cero', 'neg', 'dec', 'txt', 'nan', 'inf', 'sobre', 'sin', '']);
    expect(mensajeCantidadesInvalidas(r.errores)).toContain('máximo 1.000.000');
  });

  it('AC-STK-8 validarCantidadesItems: lista vacia, null o no-array no lanza y es ok (el pedido vacio lo frena otra regla)', () => {
    for (const l of [[], null, undefined, 'x', {}]) expect(validarCantidadesItems(l)).toEqual({ ok: true, errores: [] });
  });

  it('AC-STK-8 R10: con { previos } un item legacy decimal NO cambiado no bloquea, pero si se cambia a otro decimal si', () => {
    const previos = [{ productoId: 1, cantidad: 2.5 }, { productoId: 2, cantidad: 3 }];
    expect(validarCantidadesItems([{ productoId: 1, nombre: 'a', cantidad: 2.5 }, { productoId: 2, nombre: 'b', cantidad: 4 }], { previos }).ok).toBe(true);
    expect(validarCantidadesItems([{ productoId: 1, nombre: 'a', cantidad: 3.5 }], { previos }).ok).toBe(false);
    // productoId como texto vs numero: se compara por String
    expect(validarCantidadesItems([{ productoId: '1', nombre: 'a', cantidad: 2.5 }], { previos }).ok).toBe(true);
  });

  it('AC-STK-8 R10: un producto NUEVO en el pedido (sin previo) con cantidad invalida se bloquea aunque haya previos', () => {
    expect(validarCantidadesItems([{ productoId: 99, nombre: 'nuevo', cantidad: MAX_CANTIDAD + 1 }], { previos: [{ productoId: 1, cantidad: 1 }] }).ok).toBe(false);
  });

  it('AC-STK-8 R10: el "previo" invalido que NO cambia no bloquea, pero si el mismo producto aparece duplicado con otra cantidad invalida, esa si', () => {
    const previos = [{ productoId: 1, cantidad: MAX_CANTIDAD + 5 }];
    const r = validarCantidadesItems([{ productoId: 1, nombre: 'a', cantidad: MAX_CANTIDAD + 5 }, { productoId: 1, nombre: 'a', cantidad: MAX_CANTIDAD + 9 }], { previos });
    expect(r.errores).toHaveLength(1);
    expect(r.errores[0].cantidad).toBe(MAX_CANTIDAD + 9);
  });

  it('AC-STK-8 mensajeCantidadesInvalidas tolera basura', () => {
    expect(mensajeCantidadesInvalidas()).toBe('Cantidad inválida en:  (máximo 1.000.000)');
    expect(mensajeCantidadesInvalidas([null, { productoId: 7 }, { nombre: 'Coca' }])).toBe('Cantidad inválida en: ?, 7, Coca (máximo 1.000.000)');
  });
});

describe('AC-BUL-1 AC-BUL-4 productoParaBulto: solo por id', () => {
  const mapa = new Map([['1', { id: 1, nombre: 'Coca', bultoX: 12 }], ['2', { id: 2, nombre: 'Coca', bultoX: 6 }], ['abc', { id: 'abc', nombre: 'Uuid', bultoX: 4 }]]);

  it('AC-BUL-1 resuelve por id numero o texto y NUNCA por nombre (un homonimo no hereda el bulto)', () => {
    expect(productoParaBulto({ productoId: 1, nombre: 'otro' }, mapa).bultoX).toBe(12);
    expect(productoParaBulto({ productoId: '2', nombre: 'Coca' }, mapa).bultoX).toBe(6);
    expect(productoParaBulto({ productoId: 'abc' }, mapa).bultoX).toBe(4);
    expect(productoParaBulto({ nombre: 'Coca' }, mapa)).toBeNull();
    expect(productoParaBulto({ productoId: 3, nombre: 'Coca' }, mapa)).toBeNull();
  });

  it('AC-BUL-1 entradas hostiles: item/mapa invalidos, id vacio, 0 (0 es un id valido), prototipo', () => {
    for (const it of [null, undefined, 'x', 5, []]) expect(productoParaBulto(it, mapa)).toBeNull();
    for (const m of [null, undefined, {}, [], [['1', {}]], new Set()]) expect(productoParaBulto({ productoId: 1 }, m)).toBeNull();
    expect(productoParaBulto({ productoId: '' }, mapa)).toBeNull();
    expect(productoParaBulto({ productoId: null }, mapa)).toBeNull();
    expect(productoParaBulto({ productoId: 0 }, new Map([['0', { id: 0, bultoX: 3 }]])).bultoX).toBe(3);
    expect(productoParaBulto({ productoId: '__proto__' }, mapa)).toBeNull();
    expect(productoParaBulto({ productoId: 'constructor' }, mapa)).toBeNull();
  });

  it('AC-BUL-1 un producto resuelto con bultoX invalido (1, 0, texto, decimal, > tope) no ofrece bulto', () => {
    for (const bx of [1, 0, -2, 'doce', 2.5, null, undefined, MAX_CANTIDAD + 1, '']) expect(normalizarBultoX(bx)).toBeNull();
    expect(sumarBulto(5, MAX_CANTIDAD + 1)).toBe(5);
  });
});

describe('AC-BUL-9 AC-BUL-6 sumarBulto cerca del tope', () => {
  it('AC-BUL-6 sumar un bulto que pasa el tope deja la cantidad como estaba; justo en el tope se permite', () => {
    expect(sumarBulto(MAX_CANTIDAD - 12, 12)).toBe(MAX_CANTIDAD);
    expect(sumarBulto(MAX_CANTIDAD - 11, 12)).toBe(MAX_CANTIDAD - 11);
    expect(sumarBultoRenglon(1, 12, { cantidadPorDefecto: true })).toBe(12);
    expect(sumarBultoRenglon(1, 12, { cantidadPorDefecto: false })).toBe(13);
    expect(sumarBultoRenglon(1, MAX_CANTIDAD, { cantidadPorDefecto: true })).toBe(MAX_CANTIDAD);
  });
});
