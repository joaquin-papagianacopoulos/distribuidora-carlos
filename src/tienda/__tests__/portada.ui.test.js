// REQ-POR UI: portada de la tienda y personalización (AC-POR-1, AC-POR-2, AC-POR-3, AC-TIE-2).
import { montar, flush, click, React } from '../../testUtils/ui';
import { dosCorazones, gaseosa, alfajor } from '../../domain/__fixtures__/tiendaCasos';

jest.mock('../tiendaApi', () => ({ cargarCatalogo: jest.fn(), cargarPortada: jest.fn(), crearPedido: jest.fn() }));
import { cargarCatalogo, cargarPortada } from '../tiendaApi';
import TiendaApp from '../TiendaApp';

const IMG = 'https://x.supabase.co/storage/v1/object/public/tienda/img/a.png';
const CATALOGO = [{ ...dosCorazones, precio: 800, precioAnterior: 900, enOferta: true }, gaseosa, alfajor];
const PORTADA = {
  ok: true,
  config: { nombre: 'Distribuidora Jorge', color: '#1d4ed8', bienvenida: 'Hola!', contacto: 'Lun a vie 8 a 17', whatsapp: '5491112345678', destacados: ['Bebidas'] },
  banners: [
    { imagen: IMG, titulo: 'Golosinas', subtitulo: 'Todo el rubro', destino: { tipo: 'rubro', valor: 'Golosinas' } },
    { imagen: IMG, titulo: 'Ofertas', destino: { tipo: 'ofertas' } },
  ],
  ofertas: [],
};

let m;
const abrir = async (url = '/tienda') => {
  window.history.replaceState({}, '', url);
  m = await montar(<TiendaApp />);
  await flush();
  await flush();
};
const q = (sel) => m.cont.querySelector(sel);

beforeEach(() => {
  window.localStorage.clear();
  cargarCatalogo.mockResolvedValue({ ok: true, productos: CATALOGO, config: { permitirSinStock: false } });
  cargarPortada.mockResolvedValue(PORTADA);
});
afterEach(async () => { if (m) { await m.desmontar(); m = null; } });

describe('portada de la tienda', () => {
  it('AC-POR-1 muestra banners, fila de Ofertas, Destacados por rubro y acceso a todos los rubros', async () => {
    await abrir();
    expect(q('[data-testid="banner-actual"]').textContent).toContain('Golosinas');
    expect(q('[data-testid="banners"]').querySelectorAll('.t-banner-puntos button').length).toBe(2);
    expect(q('[data-testid="fila-ofertas"]').textContent).toContain('Dos Corazones');
    const dest = q('[data-testid="fila-destacados"]');
    expect(dest.querySelector('h2').textContent).toBe('Bebidas');
    expect(dest.textContent).toContain('Gaseosa Cola');
    expect(q('[data-testid="rubros"]').textContent).toMatch(/Golosinas \(2\)/);
    expect(q('[data-testid="portada"]').textContent).toContain('Hola!');
  });

  it('AC-POR-1 el banner lleva a su destino y "ofertas" filtra el catálogo', async () => {
    await abrir();
    await click(q('[data-testid="banner-actual"]'));
    expect(window.location.search).toBe('?rubro=Golosinas');
    expect(q('[data-testid="portada"]')).toBeNull(); // con filtros activos no se muestra la portada
    await m.desmontar(); m = null;
    await abrir('/tienda?ofertas=1');
    expect(q('[data-testid="contador-resultados"]').textContent).toBe('1 producto');
    expect(m.cont.textContent).toContain('Mostrando ofertas');
  });

  it('AC-POR-3 precio anterior tachado y precio de oferta en la tarjeta', async () => {
    await abrir();
    const tachado = q('[data-testid="precio-anterior"]');
    expect(tachado.tagName).toBe('S');
    expect(tachado.textContent).toBe('$900');
    expect(tachado.closest('.t-card').textContent).toContain('$800 por unidad');
  });

  it('AC-POR-2 AC-TIE-2 nombre, color, título y pie con contacto/WhatsApp de la configuración', async () => {
    await abrir();
    expect(document.title).toBe('Distribuidora Jorge');
    expect(q('.t-logo').textContent).toBe('Distribuidora Jorge');
    expect(q('.tienda-root').style.getPropertyValue('--t-color')).toBe('#1d4ed8');
    const pie = q('[data-testid="pie-tienda"]');
    expect(pie.textContent).toContain('Lun a vie 8 a 17');
    expect(pie.querySelector('a').getAttribute('href')).toBe('https://wa.me/5491112345678');
  });

  it('AC-POR-5 si la portada no carga (sin migración 009), la tienda sigue con los valores por defecto', async () => {
    cargarPortada.mockRejectedValue(new Error('PGRST202'));
    await abrir();
    expect(q('[data-testid="portada"]')).toBeNull();
    expect(q('.t-logo').textContent).toBe('Tienda');
    expect(m.cont.querySelectorAll('[data-testid="tarjeta-producto"]').length).toBe(3);
  });
});
