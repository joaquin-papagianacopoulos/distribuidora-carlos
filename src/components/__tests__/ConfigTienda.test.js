// REQ-POR: Configuración → Tienda (AC-POR-2, AC-POR-3, AC-POR-4, AC-POR-5).
import React from 'react';
import { montar, flush, click, escribir, porTexto, act } from '../../testUtils/ui';

jest.mock('../../services/tiendaConfigService', () => ({
  leerConfigTienda: jest.fn(), guardarConfigTienda: jest.fn(), subirImagenTienda: jest.fn(),
}));
import { leerConfigTienda, guardarConfigTienda, subirImagenTienda } from '../../services/tiendaConfigService';
import ConfigTienda from '../ConfigTienda';

const PRODUCTOS = [
  { id: 1, nombre: 'Dos Corazones', precio: 900, categoria: 'Golosinas', marca: 'Arcor', bultoX: 16, ventaPor: 'bulto', bultoNombre: 'Display' },
  { id: 2, nombre: 'Gaseosa Cola', precio: 1250, categoria: 'Bebidas', marca: 'Cola' },
];
const CONFIG = { nombre: 'Jorge', color: '#0f766e', bienvenida: '', contacto: '', whatsapp: '', permitirSinStock: false, limitePorHora: 5, destacados: [] };

let m;
const abrir = async () => {
  m = await montar(<ConfigTienda productos={PRODUCTOS} stockDe={() => 10} />);
  await escribir(m.cont.querySelector('[data-testid="pin-tienda"]'), '1234');
  await click(m.cont.querySelector('[data-testid="cargar-config-tienda"]'));
  await flush();
};

beforeEach(() => {
  leerConfigTienda.mockResolvedValue({ ok: true, config: CONFIG, banners: [], ofertas: [] });
  guardarConfigTienda.mockResolvedValue({ ok: true });
  subirImagenTienda.mockResolvedValue({ ok: true, url: 'https://x.supabase.co/storage/v1/object/public/tienda/img/a.png' });
});
afterEach(async () => { if (m) { await m.desmontar(); m = null; } jest.clearAllMocks(); });

describe('Configuración → Tienda', () => {
  it('AC-POR-2 carga la config con el PIN del admin y publica los cambios validados', async () => {
    await abrir();
    expect(leerConfigTienda).toHaveBeenCalledWith('1234');
    await escribir(m.cont.querySelector('[data-testid="tienda-nombre"]'), 'Distribuidora Jorge');
    await click(m.cont.querySelector('[data-testid="publicar-tienda"]'));
    await flush();
    expect(guardarConfigTienda).toHaveBeenCalledWith('1234', expect.objectContaining({
      config: expect.objectContaining({ nombre: 'Distribuidora Jorge', color: '#0f766e', limitePorHora: 5 }),
      banners: [], ofertas: [],
    }));
    expect(m.cont.querySelector('[data-testid="tienda-msg"]').textContent).toMatch(/publicados/);
  });

  it('AC-POR-2 un color sin contraste legible se marca en el campo y no se publica', async () => {
    await abrir();
    await escribir(m.cont.querySelector('[data-testid="tienda-color"]'), '#ffff00');
    expect(m.cont.textContent).toMatch(/poco contraste/);
    await click(m.cont.querySelector('[data-testid="publicar-tienda"]'));
    expect(m.cont.querySelector('[data-testid="err-color"]').textContent).toMatch(/contraste/);
    expect(guardarConfigTienda).not.toHaveBeenCalled();
  });

  it('AC-POR-3 AC-POR-5 la vista previa muestra el borrador (oferta con precio tachado) antes de publicar', async () => {
    await abrir();
    await click(m.cont.querySelector('[data-testid="agregar-oferta"]'));
    await escribir(m.cont.querySelector('select[aria-label="Producto en oferta"]'), '1');
    await escribir(m.cont.querySelector('input[aria-label="Precio de oferta"]'), '800');
    await click(m.cont.querySelector('[data-testid="vista-previa"]'));
    const prev = m.cont.querySelector('[data-testid="preview-tienda"]');
    expect(prev.querySelector('[data-testid="fila-ofertas"]').textContent).toContain('Dos Corazones');
    expect(prev.querySelector('[data-testid="precio-anterior"]').textContent).toBe('$900');
    expect(prev.textContent).toContain('$800 por unidad');
    expect(guardarConfigTienda).not.toHaveBeenCalled();
  });

  it('AC-POR-2 banners: alta, orden y baja', async () => {
    await abrir();
    await click(m.cont.querySelector('[data-testid="agregar-banner"]'));
    await click(m.cont.querySelector('[data-testid="agregar-banner"]'));
    const titulos = () => Array.from(m.cont.querySelectorAll('[data-testid="banner-form"] input[placeholder="Título"]'));
    await escribir(titulos()[0], 'Primero');
    await escribir(titulos()[1], 'Segundo');
    await click(porTexto(m.cont.querySelectorAll('[data-testid="banner-form"]')[1], 'button', 'Subir'));
    expect(titulos().map(i => i.value)).toEqual(['Segundo', 'Primero']);
    await click(porTexto(m.cont.querySelectorAll('[data-testid="banner-form"]')[0], 'button', 'Quitar'));
    expect(titulos().map(i => i.value)).toEqual(['Primero']);
  });

  it('AC-POR-4 rechaza en el navegador imágenes que no son jpg/png/webp o pasan los 2 MB', async () => {
    await abrir();
    const input = m.cont.querySelector('input[type="file"]');
    const elegir = async (file) => {
      Object.defineProperty(input, 'files', { configurable: true, value: [file] });
      await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
      await flush();
    };
    await elegir(new File(['x'], 'a.gif', { type: 'image/gif' }));
    expect(m.cont.querySelector('[data-testid="tienda-msg"]').textContent).toMatch(/JPG, PNG o WEBP/);
    const grande = new File(['x'], 'b.png', { type: 'image/png' });
    Object.defineProperty(grande, 'size', { value: 3 * 1024 * 1024 });
    await elegir(grande);
    expect(m.cont.querySelector('[data-testid="tienda-msg"]').textContent).toMatch(/2 MB/);
    expect(subirImagenTienda).not.toHaveBeenCalled();
    await elegir(new File(['x'], 'c.png', { type: 'image/png' }));
    expect(subirImagenTienda).toHaveBeenCalledWith('1234', expect.any(File));
    expect(Array.from(m.cont.querySelectorAll('input.input')).some(i => i.value.startsWith('https://x.supabase.co'))).toBe(true);
  });
});
