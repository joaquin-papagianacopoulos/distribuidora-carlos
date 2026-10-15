// REQ-TIE UI: catálogo, buscador, filtros y detalle (AC-TIE-4, 5, 6, 7, 8).
import fs from 'fs';
import path from 'path';
import { montar, flush, click, escribir, act, React } from '../../testUtils/ui';
import { dosCorazones, gaseosa, alfajor } from '../../domain/__fixtures__/tiendaCasos';

jest.mock('../tiendaApi', () => ({ cargarCatalogo: jest.fn(), crearPedido: jest.fn() }));
import { cargarCatalogo } from '../tiendaApi';
import TiendaApp from '../TiendaApp';

const alfajor2 = { ...alfajor, id: 'p-alfa2', nombre: 'Alfajor Chocolate', disponible: true, precio: 500 };
const CATALOGO = [dosCorazones, gaseosa, alfajor, alfajor2];

let m;
const abrir = async (url = '/tienda') => {
  window.history.replaceState({}, '', url);
  m = await montar(<TiendaApp />);
  await flush();
};
const nombres = () => Array.from(m.cont.querySelectorAll('.t-nombre')).map(n => n.textContent);

beforeEach(() => {
  window.localStorage.clear();
  cargarCatalogo.mockResolvedValue({ ok: true, productos: CATALOGO, config: { permitirSinStock: false } });
});
afterEach(async () => { jest.useRealTimers(); if (m) { await m.desmontar(); m = null; } });

describe('catálogo de la tienda', () => {
  it('AC-TIE-4 encabezado con buscador y carrito con contador; grilla de 2 a 5 columnas', async () => {
    await abrir();
    expect(m.cont.querySelector('header.t-header input[type="search"]')).toBeTruthy();
    expect(m.cont.querySelector('[data-testid="contador-carrito"]').textContent).toBe('0');
    expect(m.cont.querySelectorAll('[data-testid="tarjeta-producto"]').length).toBe(4);
    const css = fs.readFileSync(path.join(__dirname, '..', 'tienda.css'), 'utf8');
    expect(css).toMatch(/position: sticky/);
    for (const n of [2, 3, 4, 5]) expect(css).toMatch(new RegExp(`repeat\\(${n}, minmax`));
    expect(css).toMatch(/overflow-x: hidden/);
  });

  it('AC-TIE-7 tarjeta: precio por unidad, "Display x16 · $14.400" y Sin stock deshabilitado', async () => {
    await abrir();
    const txt = m.cont.textContent;
    expect(txt).toContain('Dos Corazones');
    expect(txt).toContain('Display x16 · $14.400');
    expect(txt).toContain('$900 por unidad');
    const botones = Array.from(m.cont.querySelectorAll('.t-card .t-btn'));
    const sinStock = botones.filter(b => b.textContent === 'Sin stock');
    expect(sinStock.length).toBe(1);
    expect(sinStock[0].disabled).toBe(true);
    expect(botones.filter(b => b.textContent === 'Agregar').every(b => !b.disabled)).toBe(true);
  });

  it('AC-TIE-7 si la tienda permite pedir sin stock el botón se habilita', async () => {
    cargarCatalogo.mockResolvedValue({ ok: true, productos: CATALOGO, config: { permitirSinStock: true } });
    await abrir();
    expect(Array.from(m.cont.querySelectorAll('.t-card .t-btn')).some(b => b.textContent === 'Sin stock')).toBe(false);
  });

  it('AC-TIE-5 búsqueda con debounce, sin tildes ni orden de palabras y sin consultar al servidor', async () => {
    await abrir();
    jest.useFakeTimers();
    const input = m.cont.querySelector('header input[type="search"]');
    await escribir(input, 'CORAZONES dos');
    expect(m.cont.querySelectorAll('[data-testid="tarjeta-producto"]').length).toBe(4); // todavía no
    await act(async () => { jest.advanceTimersByTime(300); });
    expect(m.cont.querySelectorAll('[data-testid="tarjeta-producto"]').length).toBe(1);
    expect(nombres()).toEqual(['Dos Corazones']);
    expect(window.location.search).toContain('q=');
    expect(cargarCatalogo).toHaveBeenCalledTimes(1);
  });

  it('AC-TIE-6 filtro por rubro con contador, panel desplegable y URL compartible', async () => {
    await abrir();
    const panel = m.cont.querySelector('[data-testid="panel-filtros"]');
    expect(panel.className).not.toContain('abierto');
    await click(m.cont.querySelector('.t-filtros-toggle'));
    expect(panel.className).toContain('abierto');
    const chk = Array.from(m.cont.querySelectorAll('input[name="rubro"]')).find(i => i.parentElement.textContent.includes('Golosinas'));
    expect(chk.parentElement.textContent).toContain('(3)');
    await click(chk);
    expect(m.cont.querySelectorAll('[data-testid="tarjeta-producto"]').length).toBe(3);
    expect(window.location.search).toContain('rubro=Golosinas');
  });

  it('AC-TIE-6 los filtros de la URL se aplican al abrir (sobreviven a recargar) y se combinan con la búsqueda', async () => {
    await abrir('/tienda?rubro=Golosinas&q=alfajor&orden=precio_asc');
    expect(nombres().sort()).toEqual(['Alfajor Chocolate', 'Alfajor Triple']);
    expect(m.cont.querySelectorAll('[data-testid="tarjeta-producto"]').length).toBe(2);
    expect(m.cont.querySelector('header input[type="search"]').value).toBe('alfajor');
    expect(m.cont.querySelector('select[aria-label="Ordenar por"]').value).toBe('precio_asc');
    expect(nombres()[0]).toBe('Alfajor Triple'); // $0,10 antes que $500
  });

  it('AC-TIE-8 detalle compartible con selector de cantidad, modo bulto y productos del mismo rubro', async () => {
    await abrir('/tienda/p/p-dos-corazones');
    expect(m.cont.querySelector('h1').textContent).toBe('Dos Corazones');
    expect(m.cont.querySelector('[data-testid="cantidad-detalle"]').textContent).toBe('16 u. (1 Display)');
    await click(m.cont.querySelector('button[aria-label="Más"]'));
    expect(m.cont.querySelector('[data-testid="cantidad-detalle"]').textContent).toBe('32 u. (2 Display)');
    expect(m.cont.textContent).toContain('Más de Golosinas');
    expect(m.cont.textContent).toContain('Alfajor Chocolate');
  });

  it('AC-TIE-8 producto inexistente muestra aviso y vuelve a la tienda', async () => {
    await abrir('/tienda/p/no-existe');
    expect(m.cont.textContent).toContain('ya no está disponible');
  });

  it('AC-TIE-1 un host de tienda muestra la tienda aunque la ruta sea /facturacion', async () => {
    const orig = process.env.REACT_APP_TIENDA_HOSTS;
    process.env.REACT_APP_TIENDA_HOSTS = 'localhost';
    try {
      await abrir('/facturacion');
      expect(m.cont.querySelector('header.t-header')).toBeTruthy();
      expect(m.cont.querySelectorAll('[data-testid="tarjeta-producto"]').length).toBe(4);
    } finally {
      if (orig === undefined) delete process.env.REACT_APP_TIENDA_HOSTS; else process.env.REACT_APP_TIENDA_HOSTS = orig;
    }
  });

  it('AC-TIE-2 título propio, sin manifest y sin instalar la PWA', async () => {
    const link = document.createElement('link');
    link.setAttribute('rel', 'manifest');
    document.head.appendChild(link);
    await abrir();
    expect(document.title).toBe('Tienda');
    expect(document.querySelector('link[rel="manifest"]')).toBeNull();
    const ev = new Event('beforeinstallprompt', { cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });
});
