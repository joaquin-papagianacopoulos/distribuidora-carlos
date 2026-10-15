import { rutaTienda, esHostTienda, esEntradaTienda, hrefTienda } from '../tienda';

describe('tienda rutas y host (AC-TIE-1, AC-TIE-8)', () => {
  it('AC-TIE-1 esHostTienda con lista de hosts', () => {
    expect(esHostTienda('Tienda.Midominio.com', 'tienda.midominio.com, otra.com')).toBe(true);
    expect(esHostTienda('app.midominio.com', 'tienda.midominio.com')).toBe(false);
    expect(esHostTienda('', '')).toBe(false);
    expect(esHostTienda('x.com', undefined)).toBe(false);
  });
  it('AC-TIE-1 esEntradaTienda: /tienda, /tienda/* o host listado', () => {
    expect(esEntradaTienda({ hostname: 'localhost', pathname: '/tienda' }, '')).toBe(true);
    expect(esEntradaTienda({ hostname: 'localhost', pathname: '/tienda/p/1' }, '')).toBe(true);
    expect(esEntradaTienda({ hostname: 'localhost', pathname: '/tiendas' }, '')).toBe(false);
    expect(esEntradaTienda({ hostname: 'localhost', pathname: '/' }, '')).toBe(false);
    expect(esEntradaTienda({ hostname: 't.com', pathname: '/facturacion' }, 't.com')).toBe(true);
    expect(esEntradaTienda(null, 't.com')).toBe(false);
  });
  it('AC-TIE-1 en host de tienda toda ruta muestra la tienda', () => {
    expect(rutaTienda('/facturacion', '', { esHostTienda: true }).vista).toBe('catalogo');
    expect(rutaTienda('/', '', { esHostTienda: true }).vista).toBe('catalogo');
    expect(rutaTienda('/', '', {}).vista).toBeNull();
  });
  it('AC-TIE-8 rutas propias y token', () => {
    expect(rutaTienda('/tienda/p/abc%20d', '?v=tok')).toEqual({ vista: 'producto', id: 'abc d', token: 'tok' });
    expect(rutaTienda('/tienda/carrito', '').vista).toBe('carrito');
    expect(rutaTienda('/tienda/checkout', '').vista).toBe('checkout');
    expect(rutaTienda('/tienda/confirmacion', '').vista).toBe('confirmacion');
    expect(rutaTienda('/tienda', '?q=a').vista).toBe('catalogo');
    expect(rutaTienda('/p/9', '', { esHostTienda: true })).toEqual({ vista: 'producto', id: '9' });
  });
  it('AC-TIE-8 hrefTienda', () => {
    expect(hrefTienda('producto', { id: 'a b' })).toBe('/tienda/p/a%20b');
    expect(hrefTienda('catalogo', { search: '?v=x' })).toBe('/tienda?v=x');
  });
});
