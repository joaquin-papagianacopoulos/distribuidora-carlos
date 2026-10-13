import {
  CANTIDAD_MINIMA_RENGLON,
  normalizarBultoX,
  tieneBulto,
  normalizarCantidad,
  sumarBulto,
  restarBulto,
  desgloseBultos,
  etiquetaBotonBulto,
  puedeUsarBulto,
} from '../bultos';
import { MAX_CANTIDAD } from '../stock';

describe('REQ-BUL dominio de bultos', () => {
  test('AC-BUL-1 etiqueta del botón con bultoX > 1 y nada con <= 1 o vacío', () => {
    expect(etiquetaBotonBulto(12)).toBe('+ Bulto (x 12)');
    expect(etiquetaBotonBulto('6')).toBe('+ Bulto (x 6)');
    expect(etiquetaBotonBulto(1)).toBeNull();
    expect(etiquetaBotonBulto(0)).toBeNull();
    expect(etiquetaBotonBulto('')).toBeNull();
    expect(etiquetaBotonBulto(undefined)).toBeNull();
    expect(tieneBulto({ bultoX: 12 })).toBe(true);
    expect(tieneBulto({ bultoX: 1 })).toBe(false);
    expect(tieneBulto({ bultoX: 0 })).toBe(false);
    expect(tieneBulto({ bultoX: '' })).toBe(false);
    expect(tieneBulto({})).toBe(false);
    expect(tieneBulto(null)).toBe(false);
    expect(tieneBulto(undefined)).toBe(false);
  });

  test('AC-BUL-2 cada toque suma exactamente bultoX (0 a 36, 5 a 41)', () => {
    expect(sumarBulto(0, 12, 3)).toBe(36);
    expect(sumarBulto(5, 12, 3)).toBe(41);
    let c = 5;
    for (let i = 0; i < 3; i += 1) c = sumarBulto(c, 12);
    expect(c).toBe(41);
    let d = 0;
    for (let i = 0; i < 3; i += 1) d = sumarBulto(d, 12);
    expect(d).toBe(36);
  });

  test('AC-BUL-2 sin bulto o veces inválido no cambia la cantidad; no supera MAX_CANTIDAD', () => {
    expect(sumarBulto(5, null)).toBe(5);
    expect(sumarBulto(5, 1)).toBe(5);
    expect(sumarBulto(5, 'x')).toBe(5);
    expect(sumarBulto(5, 12, 0)).toBe(5);
    expect(sumarBulto(5, 12, -1)).toBe(5);
    expect(sumarBulto(5, 12, 1.5)).toBe(5);
    expect(sumarBulto(MAX_CANTIDAD - 5, 12)).toBe(MAX_CANTIDAD - 5);
    expect(sumarBulto(MAX_CANTIDAD - 12, 12)).toBe(MAX_CANTIDAD);
  });

  test('AC-BUL-3 resta bultoX sin bajar del piso', () => {
    expect(restarBulto(41, 12)).toBe(29);
    expect(restarBulto(5, 12)).toBe(0);
    expect(restarBulto(5, 12, { minimo: 1 })).toBe(1);
    expect(restarBulto(12, 12, { minimo: 1 })).toBe(1);
    expect(restarBulto(1, 12, { minimo: CANTIDAD_MINIMA_RENGLON })).toBe(1);
    expect(restarBulto(0, 12)).toBe(0);
    expect(restarBulto(41, null)).toBe(41);
    expect(restarBulto(41, 1)).toBe(41);
    expect(restarBulto(41, 'doce')).toBe(41);
  });

  test('AC-BUL-4 desglose "36 u. = 3 bultos" y "41 u. = 3 bultos + 5 u."', () => {
    expect(desgloseBultos(36, 12)).toEqual({ bultos: 3, sueltas: 0, texto: '36 u. = 3 bultos' });
    expect(desgloseBultos(41, 12)).toEqual({ bultos: 3, sueltas: 5, texto: '41 u. = 3 bultos + 5 u.' });
    expect(desgloseBultos(12, 12).texto).toBe('12 u. = 1 bulto');
    expect(desgloseBultos(13, 12).texto).toBe('13 u. = 1 bulto + 1 u.');
    expect(desgloseBultos(5, 12)).toBeNull();
    expect(desgloseBultos(0, 12)).toBeNull();
    expect(desgloseBultos(24.5, 12)).toBeNull();
    expect(desgloseBultos(36, null)).toBeNull();
  });

  test('AC-BUL-4 el desglose usa el bultoX actual (12 a 6 cambia el texto)', () => {
    expect(desgloseBultos(36, 12).texto).toBe('36 u. = 3 bultos');
    expect(desgloseBultos(36, 6).texto).toBe('36 u. = 6 bultos');
  });

  test('AC-BUL-5 bultoX decimal, negativo, texto o ausente se trata como sin bulto', () => {
    expect(normalizarBultoX(12)).toBe(12);
    expect(normalizarBultoX('12')).toBe(12);
    expect(normalizarBultoX('12,0')).toBe(12);
    const sinBulto = [1, 0, -12, '-12', 12.5, '12,5', 'doce', '', '  ', null, undefined,
      NaN, Infinity, -Infinity, true, [12], {}, MAX_CANTIDAD + 1];
    sinBulto.forEach((v) => {
      expect(normalizarBultoX(v)).toBeNull();
      expect(sumarBulto(5, v)).toBe(5);
      expect(restarBulto(41, v)).toBe(41);
      expect(desgloseBultos(36, v)).toBeNull();
      expect(etiquetaBotonBulto(v)).toBeNull();
    });
  });

  test('AC-BUL-5 normalizarCantidad sanea la cantidad del renglón', () => {
    expect(normalizarCantidad(5)).toBe(5);
    expect(normalizarCantidad('5')).toBe(5);
    expect(normalizarCantidad(-3)).toBe(0);
    expect(normalizarCantidad('abc')).toBe(0);
    expect(normalizarCantidad(null)).toBe(0);
    expect(normalizarCantidad(NaN)).toBe(0);
    expect(normalizarCantidad(2.5)).toBe(2.5);
    expect(sumarBulto('abc', 12)).toBe(12);
  });

  test('AC-BUL-8 matriz de permisos por pantalla', () => {
    ['pedido', 'facturacion', 'armado'].forEach((p) => expect(puedeUsarBulto(1, p)).toBe(true));
    expect(puedeUsarBulto(2, 'pedido')).toBe(true);
    expect(puedeUsarBulto(2, 'facturacion')).toBe(false);
    expect(puedeUsarBulto(2, 'armado')).toBe(false);
    expect(puedeUsarBulto(3, 'armado')).toBe(true);
    expect(puedeUsarBulto(3, 'pedido')).toBe(false);
    expect(puedeUsarBulto(3, 'facturacion')).toBe(false);
    expect(puedeUsarBulto(9, 'pedido')).toBe(false);
    expect(puedeUsarBulto(undefined, 'pedido')).toBe(false);
    expect(puedeUsarBulto(1, 'otra')).toBe(false);
    expect(puedeUsarBulto(1, 'toString')).toBe(false);
  });
});

describe('REQ-BUL dominio de bultos: bordes adicionales (QA)', () => {
  test('AC-BUL-5 bultoX texto numerico, con espacios, 0.5, -3 y MAX_CANTIDAD', () => {
    expect(normalizarBultoX('12')).toBe(12);
    expect(normalizarBultoX(' 12 ')).toBe(12);
    expect(normalizarBultoX(0.5)).toBeNull();
    expect(normalizarBultoX('0.5')).toBeNull();
    expect(normalizarBultoX(-3)).toBeNull();
    expect(normalizarBultoX('-3')).toBeNull();
    expect(normalizarBultoX(MAX_CANTIDAD)).toBe(MAX_CANTIDAD);
    expect(normalizarBultoX(MAX_CANTIDAD + 1)).toBeNull();
    expect(etiquetaBotonBulto('12')).toBe('+ Bulto (x 12)');
    expect(tieneBulto({ bultoX: '12' })).toBe(true);
    expect(tieneBulto({ bultoX: 0.5 })).toBe(false);
    expect(tieneBulto({ bultoX: -3 })).toBe(false);
    expect(tieneBulto('12')).toBe(false);
  });

  test('AC-BUL-2 bultoX texto "12" suma 12; bultoX = MAX_CANTIDAD desde 0 llega al tope y no pasa', () => {
    expect(sumarBulto(0, '12')).toBe(12);
    expect(sumarBulto(5, ' 12 ', 3)).toBe(41);
    expect(sumarBulto(0, MAX_CANTIDAD)).toBe(MAX_CANTIDAD);
    expect(sumarBulto(1, MAX_CANTIDAD)).toBe(1);
    expect(sumarBulto(MAX_CANTIDAD, 12)).toBe(MAX_CANTIDAD);
    expect(sumarBulto(undefined, 12)).toBe(12);
    expect(sumarBulto(-3, 12)).toBe(12);
  });

  test('AC-BUL-3 restarBulto con cantidad negativa/undefined y bultoX texto', () => {
    expect(restarBulto(-3, 12)).toBe(0);
    expect(restarBulto(undefined, 12)).toBe(0);
    expect(restarBulto(41, '12')).toBe(29);
    expect(restarBulto(41, 0.5)).toBe(41);
    expect(restarBulto(41, -3)).toBe(41);
    expect(restarBulto(13, 12, { minimo: 1 })).toBe(1);
    expect(restarBulto(25, 12, { minimo: 1 })).toBe(13);
  });

  test('AC-BUL-4 desglose con bultoX texto, exacto en un bulto y cantidad texto', () => {
    expect(desgloseBultos(36, '12').texto).toBe('36 u. = 3 bultos');
    expect(desgloseBultos('41', 12).texto).toBe('41 u. = 3 bultos + 5 u.');
    expect(desgloseBultos(11, 12)).toBeNull();
    expect(desgloseBultos(undefined, 12)).toBeNull();
    expect(desgloseBultos(-36, 12)).toBeNull();
  });
});
