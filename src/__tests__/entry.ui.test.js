// REQ-TIE AC-TIE-1 / AC-TIE-2: el entry elige tienda o app interna. En un host de
// tienda (o en /tienda) NUNCA se carga ./App. Sin service worker en la tienda.
import { flush } from '../testUtils/ui';

const contadores = { app: 0, tienda: 0 };

const cargarEntry = async ({ url, hosts }) => {
  contadores.app = 0; contadores.tienda = 0;
  jest.resetModules();
  window.history.replaceState({}, '', url);
  if (hosts === undefined) delete process.env.REACT_APP_TIENDA_HOSTS; else process.env.REACT_APP_TIENDA_HOSTS = hosts;
  document.body.innerHTML = '<div id="root"></div>';
  jest.doMock('../App', () => { contadores.app += 1; return { __esModule: true, default: () => 'APP-INTERNA' }; });
  jest.doMock('../tienda/TiendaApp', () => { contadores.tienda += 1; return { __esModule: true, default: () => 'TIENDA-PUBLICA' }; });
  const { act } = require('react');
  await act(async () => { require('../index'); });
  await flush(10);
  return document.getElementById('root').textContent;
};

afterEach(() => { delete process.env.REACT_APP_TIENDA_HOSTS; });

describe('entry: tienda o app interna', () => {
  it('AC-TIE-1 un host de tienda con ruta /facturacion muestra la tienda y nunca importa ./App', async () => {
    const txt = await cargarEntry({ url: '/facturacion', hosts: 'localhost' });
    expect(txt).toBe('TIENDA-PUBLICA');
    expect(contadores.app).toBe(0);
  });

  it('AC-TIE-1 /tienda muestra la tienda sin login y sin cargar la app interna', async () => {
    const txt = await cargarEntry({ url: '/tienda?v=abc', hosts: '' });
    expect(txt).toBe('TIENDA-PUBLICA');
    expect(contadores.app).toBe(0);
  });

  it('AC-TIE-1 fuera de la tienda se carga la app interna y no la tienda', async () => {
    const txt = await cargarEntry({ url: '/', hosts: 'otro.com' });
    expect(txt).toBe('APP-INTERNA');
    expect(contadores.tienda).toBe(0);
  });

  it('AC-TIE-2 la tienda no registra service worker', async () => {
    const registrar = jest.fn();
    Object.defineProperty(window.navigator, 'serviceWorker', {
      configurable: true,
      value: { register: registrar, getRegistrations: () => Promise.resolve([]) },
    });
    await cargarEntry({ url: '/tienda', hosts: '' });
    expect(registrar).not.toHaveBeenCalled();
  });
});
