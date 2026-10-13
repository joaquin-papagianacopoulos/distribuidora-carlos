// Tests de seguridad de REQ-BUL (auditoria RUN 20261007-2004).
// Fijan las propiedades seguras del dominio de bultos/armado: entradas hostiles
// (NaN, Infinity, negativos, overflow, tipos raros), permisos por rol y que el
// desglose no pueda transportar texto controlado por el atacante.
import {
  normalizarBultoX, normalizarCantidad, sumarBulto, restarBulto, desgloseBultos, etiquetaBotonBulto, puedeUsarBulto,
  cantidadTipeada, sumarCantidades, validarCantidadesItems, mensajeCantidadesInvalidas,
} from '../bultos';
import {
  cambiosDeCantidad, fusionarCambiosArmado, acotarCambiosArmado,
  MAX_CAMBIOS_ARMADO, MAX_NOMBRE_CAMBIO, MAX_PRODUCTO_ID_CAMBIO,
} from '../armado';
import { MAX_CANTIDAD } from '../stock';

describe('SEC-BUL entradas numericas hostiles (AC-SEC-2, AC-BUL-5)', () => {
  test.each([
    NaN, Infinity, -Infinity, -12, 0, 1, 1.5, '12abc', '0x10', '1e3x', '', '   ', null, undefined,
    {}, [], [12], { valueOf: () => 12 }, true, MAX_CANTIDAD + 1, Number.MAX_SAFE_INTEGER, 2 ** 53 + 2,
  ])('bultoX hostil %p => sin bulto', (v) => {
    expect(normalizarBultoX(v)).toBeNull();
    expect(etiquetaBotonBulto(v)).toBeNull();
    expect(sumarBulto(5, v)).toBe(5);
    expect(restarBulto(5, v)).toBe(5);
    expect(desgloseBultos(24, v)).toBeNull();
  });

  test('cantidad hostil se trata como 0 y nunca produce NaN/Infinity/negativo', () => {
    for (const c of [NaN, Infinity, -Infinity, -5, 'abc', null, undefined, {}, []]) {
      const r = sumarBulto(c, 12);
      expect(Number.isFinite(r)).toBe(true);
      expect(r).toBeGreaterThanOrEqual(0);
      const s = restarBulto(c, 12, { minimo: 1 });
      expect(Number.isFinite(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
    }
  });

  test('sumarBulto no supera MAX_CANTIDAD (no overflow del ledger: abs(cantidad) <= 1e6)', () => {
    expect(sumarBulto(MAX_CANTIDAD - 5, 12)).toBe(MAX_CANTIDAD - 5);
    expect(sumarBulto(MAX_CANTIDAD - 12, 12)).toBe(MAX_CANTIDAD);
    expect(sumarBulto(0, MAX_CANTIDAD, 2)).toBe(0);
    // veces hostil
    for (const v of [NaN, Infinity, -1, 0, 1.5, '3', null]) expect(sumarBulto(10, 12, v)).toBe(10);
  });

  test('restarBulto con minimo hostil no baja de 0 ni devuelve NaN', () => {
    for (const m of [NaN, -10, Infinity, 'x', null]) {
      const r = restarBulto(5, 12, { minimo: m });
      expect(Number.isFinite(r)).toBe(true);
      expect(r).toBeGreaterThanOrEqual(0);
    }
  });

  test('1000 toques "+ Bulto" seguidos quedan acotados', () => {
    let c = 0;
    for (let i = 0; i < 1000; i++) c = sumarBulto(c, 999_999);
    expect(c).toBeLessThanOrEqual(MAX_CANTIDAD);
  });
});

describe('SEC-BUL desglose sin inyeccion (XSS / texto controlado)', () => {
  test('el texto del desglose solo contiene digitos y palabras fijas', () => {
    const casos = [[36, 12], [41, '12'], [1_000_000, 7], ['24', ' 6 ']];
    for (const [c, b] of casos) {
      const d = desgloseBultos(c, b);
      expect(d).not.toBeNull();
      expect(d.texto).toMatch(/^\d+ u\. = \d+ bultos?( \+ \d+ u\.)?$/);
    }
  });

  test('payloads en cantidad o bultoX no llegan al texto', () => {
    const payload = '<img src=x onerror=alert(1)>';
    expect(desgloseBultos(payload, 12)).toBeNull();
    expect(desgloseBultos(24, payload)).toBeNull();
    expect(etiquetaBotonBulto(payload)).toBeNull();
  });
});

describe('SEC-BUL permisos por pantalla (AC-BUL-8, AC-SEC-4)', () => {
  test('matriz de roles', () => {
    expect(puedeUsarBulto(1, 'pedido')).toBe(true);
    expect(puedeUsarBulto(2, 'pedido')).toBe(true);
    expect(puedeUsarBulto(3, 'pedido')).toBe(false);
    expect(puedeUsarBulto(1, 'facturacion')).toBe(true);
    expect(puedeUsarBulto(2, 'facturacion')).toBe(false);
    expect(puedeUsarBulto(3, 'facturacion')).toBe(false);
    expect(puedeUsarBulto(1, 'armado')).toBe(true);
    expect(puedeUsarBulto(2, 'armado')).toBe(false);
    expect(puedeUsarBulto(3, 'armado')).toBe(true);
  });

  test('pantallas que no existen o claves del prototipo => false', () => {
    for (const p of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', '', undefined, null, 'config']) {
      expect(puedeUsarBulto(1, p)).toBe(false);
    }
  });

  test('permisos raros no dan acceso de admin', () => {
    for (const p of [NaN, 1.5, '1.5', 'admin', null, undefined, {}, [], -1, 0, 4, Infinity]) {
      expect(puedeUsarBulto(p, 'facturacion')).toBe(false);
    }
  });
});

describe('SEC-BUL integridad de armadoLog.cambios (AC-BUL-7)', () => {
  test('previos corruptos o hostiles (de la nube) se descartan sin romper', () => {
    const previos = [
      null, 'x', 42, { productoId: null, antes: 1, despues: 2 },
      { productoId: 'a', antes: 'NaN', despues: 2 },
      { productoId: 'b', antes: -1, despues: 2 },
      { productoId: 'c', antes: Infinity, despues: 2 },
      { productoId: 'd', antes: 1, despues: 3, nombre: '<script>alert(1)</script>' },
    ];
    const out = fusionarCambiosArmado(previos, []);
    expect(out).toEqual([{ productoId: 'd', nombre: '<script>alert(1)</script>', antes: 1, despues: 3, diferencia: 2 }]);
    // No acepta un objeto en lugar de array (dato corrupto en armado_log)
    expect(fusionarCambiosArmado({ length: 1, 0: { productoId: 'x', antes: 1, despues: 2 } }, 'abc')).toEqual([]);
  });

  test('productoId "__proto__" no contamina prototipos (Map)', () => {
    const out = fusionarCambiosArmado([{ productoId: '__proto__', antes: 1, despues: 2 }], []);
    expect(out[0].productoId).toBe('__proto__');
    expect({}.antes).toBeUndefined();
    const c = cambiosDeCantidad([{ productoId: '__proto__', cantidad: 1 }], [{ productoId: '__proto__', cantidad: 3 }]);
    expect(c[0].diferencia).toBe(2);
  });

  test('cantidades negativas o NaN en items no generan cambios', () => {
    expect(cambiosDeCantidad(
      [{ productoId: 1, cantidad: 5 }],
      [{ productoId: 1, cantidad: -5 }, { productoId: 2, cantidad: NaN }],
    )).toEqual([]);
  });

  // S-BUL-03 (corregido iter. 2): un cambio de una sesion anterior no sobrevive si el
  // producto se saco del todo en esta sesion (ya figura en removidos).
  test('S-BUL-03 AC-BUL-7 fusionarCambiosArmado poda productos que ya no estan en el pedido', () => {
    const previos = [
      { productoId: 'x', nombre: 'X', antes: 5, despues: 10 },
      { productoId: 'y', nombre: 'Y', antes: 2, despues: 4 },
    ];
    const nuevos = [{ productoId: 7, nombre: 'Z', antes: 0, despues: 3 }];
    const out = fusionarCambiosArmado(previos, nuevos, { productosVigentes: ['y', 7] });
    expect(out.map(c => c.productoId)).toEqual(['y', '7']);
    // Lista de vigentes vacia => no queda ningun cambio; dato raro => tampoco.
    expect(fusionarCambiosArmado(previos, nuevos, { productosVigentes: [] })).toEqual([]);
    expect(fusionarCambiosArmado(previos, nuevos, { productosVigentes: 'x' })).toEqual([]);
    // Acepta Set; sin la opcion se mantiene el comportamiento previo.
    expect(fusionarCambiosArmado(previos, [], { productosVigentes: new Set(['x']) })).toHaveLength(1);
    expect(fusionarCambiosArmado(previos, nuevos)).toHaveLength(3);
  });

  // S-BUL-02 (corregido iter. 2): movimientos_stock.cantidad es integer en Supabase;
  // sumar/restar bulto sobre un decimal legacy no debe propagar decimales.
  test('S-BUL-02 AC-BUL-2 AC-BUL-3 sumarBulto/restarBulto no operan sobre cantidades no enteras', () => {
    for (const c of [2.5, '2,5', '14.5', 0.1, 1e6 - 0.5]) {
      const n = normalizarCantidad(c);
      expect(sumarBulto(c, 12)).toBe(n);
      expect(sumarBulto(c, 12, 3)).toBe(n);
      expect(restarBulto(c, 12)).toBe(n);
      expect(restarBulto(c, 12, { minimo: 1 })).toBe(n);
    }
    // Los enteros siguen funcionando igual (incluido '24' como texto).
    expect(sumarBulto(2, 12)).toBe(14);
    expect(sumarBulto('24', 12)).toBe(36);
    expect(restarBulto(26, 12)).toBe(14);
    // Ningun resultado nuevo es decimal partiendo de un entero.
    let c = 0;
    for (let i = 0; i < 50; i++) c = sumarBulto(c, 7);
    expect(Number.isInteger(c)).toBe(true);
  });
});

describe('SEC-BUL armadoLog.cambios acotado (S-BUL-05, AC-BUL-7)', () => {
  const inflado = (n, nombre = 'P') => Array.from({ length: n }, (_, i) => ({ productoId: `p${i}`, nombre, antes: 1, despues: 2 }));

  test('S-BUL-05 AC-BUL-7 fusionarCambiosArmado no devuelve mas de MAX_CAMBIOS_ARMADO entradas', () => {
    expect(MAX_CAMBIOS_ARMADO).toBe(500);
    expect(fusionarCambiosArmado(inflado(100_000), [])).toHaveLength(MAX_CAMBIOS_ARMADO);
    // Nuevos tambien cuentan para el tope de salida.
    const nuevos = Array.from({ length: 600 }, (_, i) => ({ productoId: `n${i}`, antes: 0, despues: 1 }));
    expect(fusionarCambiosArmado(inflado(300), nuevos)).toHaveLength(MAX_CAMBIOS_ARMADO);
  });

  test('S-BUL-05 AC-BUL-7 nombre recortado a 120 chars y productoId largo descartado', () => {
    expect(MAX_NOMBRE_CAMBIO).toBe(120);
    const largo = 'A'.repeat(10_000);
    const [c] = fusionarCambiosArmado([{ productoId: 'p', nombre: largo, antes: 1, despues: 2 }], []);
    expect(c.nombre).toHaveLength(MAX_NOMBRE_CAMBIO);
    const [n] = fusionarCambiosArmado([], [{ productoId: 'q', nombre: largo, antes: 1, despues: 2 }]);
    expect(n.nombre).toHaveLength(MAX_NOMBRE_CAMBIO);
    const pidLargo = 'x'.repeat(MAX_PRODUCTO_ID_CAMBIO + 1);
    expect(fusionarCambiosArmado([{ productoId: pidLargo, antes: 1, despues: 2 }], [{ productoId: pidLargo, antes: 1, despues: 3 }])).toEqual([]);
    expect(fusionarCambiosArmado([{ productoId: '', antes: 1, despues: 2 }], [])).toEqual([]);
  });

  test('S-BUL-05 AC-BUL-7 acotarCambiosArmado (lectura en Facturacion) aplica los mismos topes', () => {
    expect(acotarCambiosArmado(inflado(2000, 'B'.repeat(500)))).toHaveLength(MAX_CAMBIOS_ARMADO);
    expect(acotarCambiosArmado(inflado(3, 'B'.repeat(500)))[0].nombre).toHaveLength(MAX_NOMBRE_CAMBIO);
    expect(acotarCambiosArmado('basura')).toEqual([]);
    expect(acotarCambiosArmado(undefined)).toEqual([]);
    expect(acotarCambiosArmado(inflado(3), { productosVigentes: ['p1'] }).map(c => c.productoId)).toEqual(['p1']);
  });
});

// C3 (RUN 20261012-2106) — S-BUL-06: tope MAX_CANTIDAD en cantidades tipeadas.
describe('AC-BUL-6 AC-SEC-2 S-BUL-06 cantidadTipeada', () => {
  test.each([
    ['0', null], ['-3', null], ['2,5', null], ['2.5', null], ['1.000', 1000], ['1.000.000', 1000000], ['1000001', null],
    ['abc', null], [null, null], [undefined, null], ['', null], ['   ', null], ['12', 12], [' 12 ', 12], ['1 000', 1000],
    ['1', 1], ['1000000', 1000000], ['12abc', null], ['0x10', null], ['1e3', null], ['1.00', null], ['10.000,5', null],
    ['99999999999999999999', null], [7, 7], [0, null], [-1, null], [1.5, null], [NaN, null], [Infinity, null],
    [MAX_CANTIDAD, MAX_CANTIDAD], [MAX_CANTIDAD + 1, null], [{}, null], [[12], null], [true, null], [{ valueOf: () => 5 }, null],
  ])('AC-BUL-6 S-BUL-06 cantidadTipeada(%p) => %p', (entrada, esperado) => {
    expect(cantidadTipeada(entrada)).toBe(esperado);
  });
});

describe('AC-BUL-7 AC-SEC-2 S-BUL-06 sumarCantidades', () => {
  test.each([
    [1, 2, 3], [0, 5, 5], [MAX_CANTIDAD - 1, 1, MAX_CANTIDAD], [MAX_CANTIDAD, 1, null], [MAX_CANTIDAD, 0, MAX_CANTIDAD],
    [600000, 500000, null], [1.5, 1, null], [-1, 2, null], ['1', 2, null], [null, 1, null], [1, undefined, null],
    [NaN, 1, null], [Infinity, 1, null], [{}, 1, null],
  ])('AC-BUL-7 S-BUL-06 sumarCantidades(%p, %p) => %p', (a, b, esperado) => {
    expect(sumarCantidades(a, b)).toBe(esperado);
  });
});

describe('AC-BUL-6 AC-BUL-7 AC-STK-8 S-BUL-06 validarCantidadesItems', () => {
  it('AC-STK-8 S-BUL-06 sin previos: cualquier cantidad no entera, <= 0 o > MAX_CANTIDAD falla', () => {
    const r = validarCantidadesItems([
      { productoId: 1, nombre: 'Ok', cantidad: 5 },
      { productoId: 2, nombre: 'Grande', cantidad: MAX_CANTIDAD + 1 },
      { productoId: 3, nombre: 'Decimal', cantidad: 1.5 },
      { productoId: 4, nombre: 'Cero', cantidad: 0 },
      { productoId: 5, nombre: 'Texto', cantidad: '3' },
      { productoId: 6, nombre: 'Tope', cantidad: MAX_CANTIDAD },
      null,
      { nombre: 'Sin id', cantidad: -1 },
    ]);
    expect(r.ok).toBe(false);
    expect(r.errores).toEqual([
      { productoId: 2, nombre: 'Grande', cantidad: MAX_CANTIDAD + 1 },
      { productoId: 3, nombre: 'Decimal', cantidad: 1.5 },
      { productoId: 4, nombre: 'Cero', cantidad: 0 },
      { productoId: 5, nombre: 'Texto', cantidad: '3' },
      { productoId: null, nombre: '', cantidad: null },
      { productoId: null, nombre: 'Sin id', cantidad: -1 },
    ]);
  });

  it('AC-STK-8 R10 con previos: un legacy decimal sin cambios pasa; si cambió, se valida', () => {
    const previos = [{ productoId: 1, nombre: 'Legacy', cantidad: 2.5 }, { productoId: '2', nombre: 'B', cantidad: 3 }];
    expect(validarCantidadesItems([{ productoId: 1, nombre: 'Legacy', cantidad: 2.5 }, { productoId: 2, cantidad: 4 }], { previos }))
      .toEqual({ ok: true, errores: [] });
    const r = validarCantidadesItems([{ productoId: 1, nombre: 'Legacy', cantidad: 3.5 }], { previos });
    expect(r.ok).toBe(false);
    expect(r.errores[0]).toMatchObject({ productoId: 1, cantidad: 3.5 });
    // Un item nuevo (no estaba en previos) se valida aunque haya previos.
    expect(validarCantidadesItems([{ productoId: 9, cantidad: MAX_CANTIDAD + 1 }], { previos }).ok).toBe(false);
  });

  it('AC-SEC-2 entradas hostiles no lanzan', () => {
    expect(validarCantidadesItems()).toEqual({ ok: true, errores: [] });
    expect(validarCantidadesItems(null, { previos: 'x' })).toEqual({ ok: true, errores: [] });
    expect(validarCantidadesItems([], { previos: [null, { cantidad: 1 }, { productoId: null }] })).toEqual({ ok: true, errores: [] });
    expect(validarCantidadesItems([{ productoId: 1, cantidad: NaN }], { previos: [{ productoId: 1, cantidad: NaN }] }).ok).toBe(true);
  });

  it('AC-BUL-6 mensajeCantidadesInvalidas lista los productos y el máximo', () => {
    expect(mensajeCantidadesInvalidas([{ nombre: 'Coca' }, { productoId: 7 }, {}])).toBe('Cantidad inválida en: Coca, 7, ? (máximo 1.000.000)');
    expect(mensajeCantidadesInvalidas(null)).toBe('Cantidad inválida en:  (máximo 1.000.000)');
  });
});
