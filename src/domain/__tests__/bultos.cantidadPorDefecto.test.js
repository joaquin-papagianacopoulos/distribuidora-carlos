// AC-BUL-9 (decisión del dueño, 2026-10-08): el primer "+ Bulto" reemplaza la
// unidad que se pone sola al agregar el producto; si la cantidad se tocó, suma.
import {
  CANTIDAD_INICIAL_RENGLON,
  MARCA_CANTIDAD_POR_DEFECTO,
  renglonNuevo,
  sumarBultoRenglon,
  quitarMarcasRenglon,
  quitarMarcasRenglones,
} from '../bultos';
import { MAX_CANTIDAD } from '../stock';

describe('AC-BUL-9 dominio: unidad por defecto y "+ Bulto"', () => {
  test('AC-BUL-9 renglón nuevo arranca en 1 con la marca puesta', () => {
    const r = renglonNuevo({ id: 'p1', nombre: 'Coca', precio: 10 });
    expect(r).toEqual({
      productoId: 'p1', nombre: 'Coca', precio: 10, precioOriginal: 10,
      cantidad: CANTIDAD_INICIAL_RENGLON, [MARCA_CANTIDAD_POR_DEFECTO]: true,
    });
    expect(CANTIDAD_INICIAL_RENGLON).toBe(1);
  });

  test('AC-BUL-9 renglonNuevo acepta extras de pantalla pero no deja pisar la marca', () => {
    const r = renglonNuevo({ id: 'p1', nombre: 'Coca', precio: 10 }, { _key: 'k1', [MARCA_CANTIDAD_POR_DEFECTO]: false });
    expect(r._key).toBe('k1');
    expect(r[MARCA_CANTIDAD_POR_DEFECTO]).toBe(true);
    expect(renglonNuevo(null).cantidad).toBe(1);
  });

  test('AC-BUL-9 con marca y cantidad 1, el primer bulto x12 deja 12; los siguientes suman (24, 36)', () => {
    let c = sumarBultoRenglon(1, 12, { cantidadPorDefecto: true });
    expect(c).toBe(12);
    // Después del primer toque la pantalla quita la marca: suma normal.
    c = sumarBultoRenglon(c, 12, { cantidadPorDefecto: false });
    expect(c).toBe(24);
    c = sumarBultoRenglon(c, 12);
    expect(c).toBe(36);
  });

  test('AC-BUL-9 sin marca (cantidad escrita a mano, aunque sea 1) suma como AC-BUL-2: 1 -> 13', () => {
    expect(sumarBultoRenglon(1, 12)).toBe(13);
    expect(sumarBultoRenglon(1, 12, { cantidadPorDefecto: false })).toBe(13);
    expect(sumarBultoRenglon(5, 12)).toBe(17);
  });

  test('AC-BUL-9 marca presente pero cantidad != 1 suma normal', () => {
    expect(sumarBultoRenglon(2, 12, { cantidadPorDefecto: true })).toBe(14);
    expect(sumarBultoRenglon(12, 12, { cantidadPorDefecto: true })).toBe(24);
    expect(sumarBultoRenglon(0, 12, { cantidadPorDefecto: true })).toBe(12);
    expect(sumarBultoRenglon('1', 12, { cantidadPorDefecto: true })).toBe(12);
  });

  test('AC-BUL-9 solo true estricto activa el reemplazo (truthy no alcanza)', () => {
    expect(sumarBultoRenglon(1, 12, { cantidadPorDefecto: 'true' })).toBe(13);
    expect(sumarBultoRenglon(1, 12, { cantidadPorDefecto: 1 })).toBe(13);
    expect(sumarBultoRenglon(1, 12, undefined)).toBe(13);
  });

  test.each([[1], [0], [-3], [0.5], ['abc'], [''], [null], [undefined], [MAX_CANTIDAD + 1]])(
    'AC-BUL-9 bultoX inválido (%p) => sin cambios aunque haya marca',
    (bx) => {
      expect(sumarBultoRenglon(1, bx, { cantidadPorDefecto: true })).toBe(1);
      expect(sumarBultoRenglon(5, bx)).toBe(5);
    },
  );

  test('AC-BUL-9 respeta S-BUL-02 y MAX_CANTIDAD cuando suma', () => {
    expect(sumarBultoRenglon(1.5, 12, { cantidadPorDefecto: true })).toBe(1.5);
    expect(sumarBultoRenglon(MAX_CANTIDAD, 12)).toBe(MAX_CANTIDAD);
    expect(sumarBultoRenglon(1, MAX_CANTIDAD, { cantidadPorDefecto: true })).toBe(MAX_CANTIDAD);
  });

  test('AC-BUL-9 quitarMarcasRenglon saca solo la marca y no muta el original', () => {
    const item = { productoId: 'p1', cantidad: 12, precio: 10, [MARCA_CANTIDAD_POR_DEFECTO]: true };
    const limpio = quitarMarcasRenglon(item);
    expect(limpio).toEqual({ productoId: 'p1', cantidad: 12, precio: 10 });
    expect(Object.prototype.hasOwnProperty.call(limpio, MARCA_CANTIDAD_POR_DEFECTO)).toBe(false);
    expect(item[MARCA_CANTIDAD_POR_DEFECTO]).toBe(true);
    const sinMarca = { productoId: 'p2', cantidad: 3 };
    expect(quitarMarcasRenglon(sinMarca)).toBe(sinMarca);
    expect(quitarMarcasRenglon(null)).toBeNull();
  });

  test('AC-BUL-9 quitarMarcasRenglones limpia la lista (y tolera no-array)', () => {
    const items = [renglonNuevo({ id: 'a', nombre: 'A', precio: 1 }), { productoId: 'b', cantidad: 2 }];
    const out = quitarMarcasRenglones(items);
    expect(out.some(i => MARCA_CANTIDAD_POR_DEFECTO in i)).toBe(false);
    expect(JSON.stringify(out)).not.toContain(MARCA_CANTIDAD_POR_DEFECTO);
    expect(quitarMarcasRenglones(undefined)).toEqual([]);
  });
});
