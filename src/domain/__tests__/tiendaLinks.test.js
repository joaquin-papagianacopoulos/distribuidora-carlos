import { esTokenValido, construirLinkTienda, tokenParaPedido, parsearRespuestaToken } from '../tiendaLinks';
import { rutaTienda } from '../tienda';

const TOKEN = 'Xk3_aB9-QmZ1pL0wRtYvUe7sDfGhJkNc2oIuPqAbCdE';

describe('links de tienda por vendedor (AC-WEB-7)', () => {
  it('AC-WEB-7 construye /tienda?v=<token> y no usa nombre ni id', () => {
    expect(construirLinkTienda('https://x.com/', TOKEN)).toBe(`https://x.com/tienda?v=${TOKEN}`);
    expect(construirLinkTienda('https://x.com', 'Juan')).toBeNull();
    expect(construirLinkTienda('https://x.com', 12)).toBeNull();
  });

  it('AC-WEB-7 un token inválido (forma rara, vacío, script) se trata como link general', () => {
    for (const t of ['', null, undefined, 'a b', '<script>', 'corto', 'x'.repeat(200)]) {
      expect(esTokenValido(t)).toBe(false);
      expect(tokenParaPedido(t)).toBeNull();
    }
    expect(tokenParaPedido(TOKEN)).toBe(TOKEN);
  });

  it('AC-WEB-7 la ruta de la tienda con un token inválido igual muestra el catálogo', () => {
    expect(rutaTienda('/tienda', '?v=cualquiera').vista).toBe('catalogo');
    expect(rutaTienda('/tienda', '').token).toBeUndefined();
  });

  it('AC-WEB-7 parsearRespuestaToken: ok, sin permiso, vendedor inválido y token raro', () => {
    expect(parsearRespuestaToken({ ok: true, token: TOKEN })).toEqual({ ok: true, token: TOKEN });
    expect(parsearRespuestaToken({ ok: false, motivo: 'no_autorizado' }).ok).toBe(false);
    expect(parsearRespuestaToken({ ok: false, motivo: 'vendedor_invalido' }).mensaje).toMatch(/baja/);
    expect(parsearRespuestaToken({ ok: true, token: 'x' }).ok).toBe(false);
    expect(parsearRespuestaToken(null).ok).toBe(false);
  });
});
