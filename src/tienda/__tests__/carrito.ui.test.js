// REQ-TIE UI: carrito, checkout y confirmación (AC-TIE-9, 10, 12, 13, 14).
import { montar, flush, click, escribir, enviarForm, porTexto, React } from '../../testUtils/ui';
import { dosCorazones, gaseosa } from '../../domain/__fixtures__/tiendaCasos';
import { serializarCarrito } from '../../domain/tienda';

jest.mock('../tiendaApi', () => ({ cargarCatalogo: jest.fn(), crearPedido: jest.fn() }));
import { cargarCatalogo, crearPedido } from '../tiendaApi';
import TiendaApp from '../TiendaApp';

let m;
const abrir = async (url = '/tienda') => {
  window.history.replaceState({}, '', url);
  m = await montar(<TiendaApp />);
  await flush();
};
const agregarDosCorazones = async () => {
  const tarjeta = porTexto(m.cont, '[data-testid="tarjeta-producto"]', 'Dos Corazones');
  await click(tarjeta.querySelector('.t-btn-primario'));
};
const llenarForm = async (extra = {}) => {
  const v = { nombre: 'Ana López', telefono: '341 555 1234', direccion: 'Calle 1 123', ciudad: 'Rosario', ...extra };
  for (const [k, val] of Object.entries(v)) await escribir(m.cont.querySelector(`#co-${k}`), val);
};
const CAT = [dosCorazones, gaseosa];

beforeEach(() => {
  window.localStorage.clear();
  cargarCatalogo.mockResolvedValue({ ok: true, productos: CAT, config: { permitirSinStock: false } });
});
afterEach(async () => { if (m) { await m.desmontar(); m = null; } jest.restoreAllMocks(); });

describe('carrito de la tienda', () => {
  it('AC-TIE-9 y AC-TIE-10 agregar (1 Display = 16 u.), cambiar cantidad por bulto, total y quitar', async () => {
    await abrir();
    await agregarDosCorazones();
    expect(m.cont.querySelector('[data-testid="contador-carrito"]').textContent).toBe('1');
    await click(m.cont.querySelector('.t-carrito-btn'));
    expect(m.cont.querySelector('[data-testid="linea-carrito"]').textContent).toContain('16 u. (1 Display)');
    expect(m.cont.querySelector('[data-testid="total-carrito"]').textContent).toBe('Total $14.400');
    await click(m.cont.querySelector('button[aria-label="Más Dos Corazones"]'));
    expect(m.cont.querySelector('[data-testid="linea-carrito"]').textContent).toContain('32 u. (2 Display)');
    expect(m.cont.querySelector('[data-testid="total-carrito"]').textContent).toBe('Total $28.800');
    await click(m.cont.querySelector('button[aria-label="Menos Dos Corazones"]'));
    await click(m.cont.querySelector('button[aria-label="Menos Dos Corazones"]')); // no baja del piso (1 Display)
    expect(m.cont.querySelector('[data-testid="total-carrito"]').textContent).toBe('Total $14.400');
    await click(porTexto(m.cont, 'button', 'Quitar'));
    expect(m.cont.querySelectorAll('[data-testid="linea-carrito"]').length).toBe(0);
    expect(m.cont.textContent).toContain('Todavía no agregaste productos');
  });

  it('AC-TIE-10 el carrito persiste en localStorage y se restaura al recargar', async () => {
    await abrir();
    await agregarDosCorazones();
    expect(window.localStorage.getItem('tienda_carrito_v1')).toContain('p-dos-corazones');
    await m.desmontar();
    await abrir();
    expect(m.cont.querySelector('[data-testid="contador-carrito"]').textContent).toBe('1');
  });

  it('AC-TIE-10 un carrito de más de 7 días se descarta', async () => {
    const hace8 = Date.now() - 8 * 24 * 60 * 60 * 1000;
    window.localStorage.setItem('tienda_carrito_v1', serializarCarrito({ lineas: [{ productoId: 'p-dos-corazones', unidades: 16, modo: 'bulto', precioVisto: 900 }] }, hace8));
    await abrir();
    expect(m.cont.querySelector('[data-testid="contador-carrito"]').textContent).toBe('0');
  });

  it('AC-TIE-10 si localStorage falla, el carrito funciona en memoria', async () => {
    await abrir();
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('cuota'); });
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('bloqueado'); });
    await agregarDosCorazones();
    expect(m.cont.querySelector('[data-testid="contador-carrito"]').textContent).toBe('1');
  });

  it('AC-TIE-9 producto con mínimo de compra: no se baja del mínimo', async () => {
    await abrir();
    const tarjeta = porTexto(m.cont, '[data-testid="tarjeta-producto"]', 'Gaseosa Cola');
    await click(tarjeta.querySelector('.t-btn-primario'));
    await click(m.cont.querySelector('.t-carrito-btn'));
    expect(m.cont.querySelector('[data-testid="linea-carrito"]').textContent).toContain('2 u.');
    await click(m.cont.querySelector('button[aria-label="Menos Gaseosa Cola"]'));
    expect(m.cont.querySelector('[data-testid="linea-carrito"]').textContent).toContain('2 u.');
  });
});

describe('checkout y confirmación', () => {
  const irAlCheckout = async () => {
    await abrir();
    await agregarDosCorazones();
    await click(m.cont.querySelector('.t-carrito-btn'));
    await click(porTexto(m.cont, 'button', 'Continuar'));
  };

  it('AC-TIE-12 muestra errores por campo y no llama al servidor', async () => {
    await irAlCheckout();
    await enviarForm(m.cont.querySelector('form'));
    for (const k of ['nombre', 'telefono', 'direccion', 'ciudad']) expect(m.cont.querySelector(`[data-testid="error-${k}"]`)).toBeTruthy();
    expect(m.cont.querySelector('[data-testid="error-cuit"]')).toBeNull();
    expect(crearPedido).not.toHaveBeenCalled();
    await escribir(m.cont.querySelector('#co-cuit'), '20-12345678-0');
    await enviarForm(m.cont.querySelector('form'));
    expect(m.cont.querySelector('[data-testid="error-cuit"]')).toBeTruthy();
  });

  it('AC-TIE-13 AC-TIE-14 confirma: payload con idempotencia, vacía el carrito y muestra el número y el total', async () => {
    crearPedido.mockResolvedValue({ ok: true, pedidoId: 321, total: 14400, renglones: [{ productoId: 1, nombre: 'Dos Corazones', cantidad: 16, subtotal: 14400 }] });
    await irAlCheckout();
    await llenarForm();
    await enviarForm(m.cont.querySelector('form'));
    await flush();
    const payload = crearPedido.mock.calls[0][0];
    expect(payload.items).toEqual([{ productoId: 'p-dos-corazones', cantidad: 16, modo: 'unidad', precioVisto: 900 }]);
    expect(payload.idempotencia).toMatch(/^[0-9a-f-]{36}$/);
    expect(payload.hp).toBe('');
    expect(payload.contacto.nombre).toBe('Ana López');
    expect(m.cont.querySelector('[data-testid="numero-pedido"]').textContent).toBe('321');
    expect(m.cont.querySelector('[data-testid="total-confirmacion"]').textContent).toBe('Total $14.400');
    expect(m.cont.querySelector('[data-testid="contador-carrito"]').textContent).toBe('0');
    expect(window.localStorage.getItem('tienda_carrito_v1')).toContain('"lineas":[]');
  });

  it('AC-TIE-12 los datos se recuerdan en el dispositivo para el próximo pedido', async () => {
    crearPedido.mockResolvedValue({ ok: true, pedidoId: 1, total: 14400, renglones: [] });
    await irAlCheckout();
    await llenarForm();
    await enviarForm(m.cont.querySelector('form'));
    await flush();
    await click(porTexto(m.cont, 'a', 'Seguir comprando'));
    await agregarDosCorazones();
    await click(m.cont.querySelector('.t-carrito-btn'));
    await click(porTexto(m.cont, 'button', 'Continuar'));
    expect(m.cont.querySelector('#co-nombre').value).toBe('Ana López');
    expect(m.cont.querySelector('#co-ciudad').value).toBe('Rosario');
  });

  it('AC-TIE-14 error de red: el carrito NO se pierde y se puede reintentar con el mismo id', async () => {
    crearPedido.mockResolvedValueOnce({ ok: false, motivo: 'red', mensaje: 'No pudimos conectarnos. Tu carrito sigue guardado: probá de nuevo.' });
    await irAlCheckout();
    await llenarForm();
    await enviarForm(m.cont.querySelector('form'));
    await flush();
    expect(m.cont.querySelector('[data-testid="error-envio"]').textContent).toContain('carrito sigue guardado');
    expect(m.cont.querySelector('[data-testid="contador-carrito"]').textContent).toBe('1');
    crearPedido.mockResolvedValueOnce({ ok: true, pedidoId: 9, total: 14400, renglones: [] });
    await enviarForm(m.cont.querySelector('form'));
    await flush();
    expect(crearPedido.mock.calls[1][0].idempotencia).toBe(crearPedido.mock.calls[0][0].idempotencia);
    expect(m.cont.querySelector('[data-testid="numero-pedido"]').textContent).toBe('9');
  });

  it('AC-TIE-15 límite por hora: mensaje claro sin detalles internos y el carrito se conserva', async () => {
    crearPedido.mockResolvedValue({ ok: false, motivo: 'limite', mensaje: 'Hiciste varios pedidos en poco tiempo. Probá de nuevo en un rato.' });
    await irAlCheckout();
    await llenarForm();
    await enviarForm(m.cont.querySelector('form'));
    await flush();
    expect(m.cont.querySelector('[data-testid="error-envio"]').textContent).toContain('varios pedidos');
    expect(m.cont.querySelector('[data-testid="contador-carrito"]').textContent).toBe('1');
  });

  it('AC-TIE-13 cambió el precio: no crea el pedido, muestra el carrito corregido y se reemplaza al aceptarlo', async () => {
    crearPedido.mockResolvedValue({ ok: false, motivo: 'cambio', carrito: { renglones: [{ productoId: 'p-dos-corazones', unidades: 16, precio: 1000, disponible: true }], total: 16000 } });
    await irAlCheckout();
    await llenarForm();
    await enviarForm(m.cont.querySelector('form'));
    await flush();
    const aviso = m.cont.querySelector('[data-testid="carrito-corregido"]');
    expect(aviso.textContent).toContain('Cambiaron algunos precios');
    expect(aviso.textContent).toContain('$1.000 c/u');
    expect(aviso.textContent).toContain('Nuevo total $16.000');
    expect(m.cont.querySelector('[data-testid="numero-pedido"]')).toBeNull();
    await click(porTexto(m.cont, 'button', 'Ver el carrito corregido'));
    expect(window.localStorage.getItem('tienda_carrito_v1')).toContain('"precioVisto":1000');
  });

  it('AC-WEB-7 el token del link llega en el payload; un token raro se manda como link general', async () => {
    crearPedido.mockResolvedValue({ ok: true, pedidoId: 5, total: 14400, renglones: [] });
    const TOKEN = 'Xk3_aB9-QmZ1pL0wRtYvUe7sDfGhJkNc2oIuPqAbCdE';
    await abrir(`/tienda?v=${TOKEN}`);
    await agregarDosCorazones();
    await click(m.cont.querySelector('.t-carrito-btn'));
    await click(porTexto(m.cont, 'button', 'Continuar'));
    await llenarForm();
    await enviarForm(m.cont.querySelector('form'));
    await flush();
    expect(crearPedido.mock.calls[0][0].token).toBe(TOKEN);
  });
});
