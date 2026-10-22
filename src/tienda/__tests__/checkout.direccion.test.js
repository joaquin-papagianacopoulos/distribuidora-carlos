// REQ-DIR (AC-DIR-1): el botón del checkout queda deshabilitado con dirección no exacta y muestra el error.
import { montar, flush, click, escribir, porTexto, React } from '../../testUtils/ui';
import { dosCorazones } from '../../domain/__fixtures__/tiendaCasos';

jest.mock('../tiendaApi', () => ({ cargarCatalogo: jest.fn(), crearPedido: jest.fn() }));
import { cargarCatalogo } from '../tiendaApi';
import TiendaApp from '../TiendaApp';

let m;
afterEach(async () => { if (m) { await m.desmontar(); m = null; } });

it('AC-DIR-1 botón deshabilitado y error bajo el campo hasta que la dirección tiene calle y número', async () => {
  window.localStorage.clear();
  cargarCatalogo.mockResolvedValue({ ok: true, productos: [dosCorazones], config: { permitirSinStock: false } });
  window.history.replaceState({}, '', '/tienda');
  m = await montar(<TiendaApp />);
  await flush();
  await click(porTexto(m.cont, '[data-testid="tarjeta-producto"]', 'Dos Corazones').querySelector('.t-btn-primario'));
  await click(m.cont.querySelector('.t-carrito-btn'));
  await click(porTexto(m.cont, 'button', 'Continuar'));
  const boton = () => porTexto(m.cont, 'button', 'Confirmar pedido');
  expect(boton().disabled).toBe(true);
  await escribir(m.cont.querySelector('#co-direccion'), 'Calle Mitre');
  expect(boton().disabled).toBe(true);
  expect(m.cont.querySelector('[data-testid="error-direccion"]')).toBeTruthy();
  expect(m.cont.querySelector('#co-direccion').getAttribute('aria-describedby')).toBe('co-direccion-error');
  await escribir(m.cont.querySelector('#co-direccion'), 'Calle Mitre 742');
  expect(boton().disabled).toBe(false);
  expect(m.cont.querySelector('[data-testid="error-direccion"]')).toBeNull();
});
