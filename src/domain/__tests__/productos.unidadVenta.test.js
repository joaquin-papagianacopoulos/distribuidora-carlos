// REQ-VTA (AC-VTA-1, AC-VTA-5): validarProducto y mapeo remoto con los 4 campos nuevos.
import { validarProducto, CAMPOS_PRODUCTO, productoVentaToRemote, productoExtraFromRemote } from '../productos';

const base = (over = {}) => ({ codigo: 'DC1', nombre: 'Dos Corazones', precio: '900', bultoX: '16', ...over });

describe('AC-VTA-1 validarProducto con unidad de venta y marca', () => {
  it('AC-VTA-1 CAMPOS_PRODUCTO suma Marca, Se vende por, Etiqueta del bulto y Mostrar en tienda', () => {
    const labels = CAMPOS_PRODUCTO.map(c => c.label);
    expect(labels).toEqual(expect.arrayContaining(['Marca', 'Se vende por', 'Etiqueta del bulto', 'Mostrar en tienda']));
    expect(labels.indexOf('Marca')).toBe(labels.indexOf('Rubro') + 1);
  });
  it('AC-VTA-1 Dos Corazones: bulto x16, bulto, Display', () => {
    const r = validarProducto(base({ ventaPor: 'bulto', bultoNombre: 'Display', marca: 'Dos Corazones' }));
    expect(r.ok).toBe(true);
    expect(r.producto).toMatchObject({ bultoX: 16, ventaPor: 'bulto', bultoNombre: 'Display', visibleTienda: true, marca: 'Dos Corazones', precio: 900 });
  });
  it('AC-VTA-1 "bulto" con bultoX <= 1 => error en el campo ventaPor', () => {
    for (const bx of ['1', '', '0', '2,5', 'abc']) {
      const r = validarProducto(base({ ventaPor: 'bulto', bultoX: bx }));
      expect(r.ok).toBe(false);
      expect(r.errores.ventaPor).toMatch(/Bulto x/);
    }
  });
  it('AC-VTA-1 defaults: sin campos nuevos queda ambos/unidad, Bulto y visible', () => {
    expect(validarProducto(base()).producto).toMatchObject({ ventaPor: 'ambos', bultoNombre: 'Bulto', visibleTienda: true, marca: '' });
    expect(validarProducto(base({ bultoX: '' })).producto.ventaPor).toBe('unidad');
  });
  it('AC-VTA-1 Mostrar en tienda: false se respeta; texto "No" tambien', () => {
    expect(validarProducto(base({ visibleTienda: false })).producto.visibleTienda).toBe(false);
    expect(validarProducto(base({ visibleTienda: 'No' })).producto.visibleTienda).toBe(false);
  });
  it('AC-VTA-1 la marca se normaliza y se deduplica contra las existentes', () => {
    expect(validarProducto(base({ marca: '  ARCOR ' })).producto.marca).toBe('ARCOR');
    expect(validarProducto(base({ marca: '  ARCOR ' }), { marcas: ['Arcor'] }).producto.marca).toBe('Arcor');
  });
});

describe('AC-VTA-5 mapeo remoto', () => {
  it('AC-VTA-5 productoVentaToRemote manda las 3 columnas de la 006', () => {
    expect(productoVentaToRemote({ ventaPor: 'bulto', bultoX: 16, bultoNombre: 'Display', visibleTienda: false }))
      .toEqual({ venta_por: 'bulto', bulto_nombre: 'Display', visible_tienda: false });
    // producto viejo: deriva
    expect(productoVentaToRemote({ bultoX: 12 })).toEqual({ venta_por: 'ambos', bulto_nombre: 'Bulto', visible_tienda: true });
    // dato inconsistente no se sube como "bulto" (el CHECK de la 006 lo rechazaria)
    expect(productoVentaToRemote({ ventaPor: 'bulto', bultoX: 1 }).venta_por).toBe('unidad');
  });
  it('AC-VTA-5 productoExtraFromRemote: columnas ausentes (sin 006) conservan lo local o el default', () => {
    expect(productoExtraFromRemote({}, {})).toMatchObject({ ventaPor: undefined, bultoNombre: 'Bulto', visibleTienda: true });
    expect(productoExtraFromRemote({}, { ventaPor: 'bulto', bultoNombre: 'Display', visibleTienda: false }))
      .toMatchObject({ ventaPor: 'bulto', bultoNombre: 'Display', visibleTienda: false });
  });
  it('AC-VTA-5 productoExtraFromRemote: columnas presentes pisan; null => default', () => {
    expect(productoExtraFromRemote({ venta_por: 'unidad', bulto_nombre: 'Caja', visible_tienda: false }, { ventaPor: 'bulto' }))
      .toMatchObject({ ventaPor: 'unidad', bultoNombre: 'Caja', visibleTienda: false });
    expect(productoExtraFromRemote({ venta_por: null, bulto_nombre: null, visible_tienda: null }, {}))
      .toMatchObject({ ventaPor: undefined, bultoNombre: 'Bulto', visibleTienda: true });
  });
});
