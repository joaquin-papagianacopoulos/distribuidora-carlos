// REQ-COM AC-COM-2 + AC-SEC-4: la sección Comisiones es solo para admin. Un
// vendedor o armador no ve la pestaña ni puede renderizar la pantalla.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockApp = {};
jest.mock('../../hooks/useAppContext', () => ({ useApp: () => mockApp, AppProvider: ({ children }) => children }));
jest.mock('../../sync/useSync', () => ({ useSync: () => ({ syncing: false, lastSync: null, error: null, syncNote: null, syncNow: () => {} }) }));
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn(() => { throw new Error('no deberia llamar a Supabase'); }), rpc: jest.fn(() => { throw new Error('no deberia llamar a Supabase'); }) } }));
jest.mock('../../services/comisionesService', () => ({
  cargarDatosComisiones: jest.fn(), guardarBorrador: jest.fn(), confirmarCierre: jest.fn(), anularCierre: jest.fn(), syncComisiones: jest.fn(),
}));
// Las demás pantallas no importan acá: se reemplazan por marcadores.
jest.mock('../NuevoPedido', () => () => <div>pantalla-nuevo</div>);
jest.mock('../ListaPedidos', () => () => <div>pantalla-lista</div>);
jest.mock('../Facturacion', () => () => <div>pantalla-facturacion</div>);
jest.mock('../ResumenDia', () => () => <div>pantalla-resumen</div>);
jest.mock('../ReportesVentas', () => () => <div>pantalla-reportes</div>);
jest.mock('../Configuracion', () => () => <div>pantalla-config</div>);
jest.mock('../Faltantes', () => () => <div>pantalla-faltantes</div>);
jest.mock('../Deudas', () => () => <div>pantalla-deudas</div>);
jest.mock('../OrdenEntrega', () => () => <div>pantalla-orden</div>);
jest.mock('../Armado', () => () => <div>pantalla-armado</div>);
jest.mock('../Stock', () => () => <div>pantalla-stock</div>);
jest.mock('../../components/SelectorVendedor', () => () => <div>selector</div>);

// eslint-disable-next-line import/first
import App from '../../App';
// eslint-disable-next-line import/first
import Comisiones from '../Comisiones';
// eslint-disable-next-line import/first
import { cargarDatosComisiones } from '../../services/comisionesService';

let container;
let root;
const setApp = (vendedorActual) => {
  Object.keys(mockApp).forEach(k => delete mockApp[k]);
  Object.assign(mockApp, { vendedorActual, online: false, faltantes: [], seleccionarVendedor: jest.fn() });
};
const tabs = () => [...container.querySelectorAll('nav .nav-btn')].map(b => b.textContent);

beforeEach(() => {
  cargarDatosComisiones.mockImplementation(async () => ({ pedidos: [], clientes: [], vendedores: [], cierres: [], borrador: null }));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

describe('AC-COM-2 AC-SEC-4 pestaña Comisiones', () => {
  it('AC-COM-2 el admin ve la pestaña y puede abrir la pantalla', async () => {
    setApp({ id: 1, nombre: 'Jorge', permiso: 1 });
    await act(async () => { root.render(<App />); });
    expect(tabs().some(t => t.includes('Comisiones'))).toBe(true);
    const btn = [...container.querySelectorAll('nav .nav-btn')].find(b => b.textContent.includes('Comisiones'));
    await act(async () => { btn.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(container.querySelector('.page-title').textContent).toBe('Comisiones');
    expect(container.textContent).not.toMatch(/No tenés permisos/);
  });

  it.each([
    ['armador (3)', { id: 3, nombre: 'Ana', permiso: 3 }, ['Armado', 'Faltantes', 'Orden']],
    ['vendedor (2)', { id: 2, nombre: 'Carlos', permiso: 2 }, ['Pedido', 'Pedidos', 'Orden']],
    ['S-COM-11 armador "3" en texto => pestañas de vendedor', { id: 8, nombre: 'Raro', permiso: '3' }, ['Pedido', 'Pedidos', 'Orden']],
  ])('AC-SEC-4 S-COM-11 permisos existentes sin romper: %s', async (_l, v, esperadas) => {
    setApp(v);
    await act(async () => { root.render(<App />); });
    const t = tabs();
    expect(t).toHaveLength(3);
    for (const e of esperadas) expect(t.some(x => x.includes(e))).toBe(true);
  });

  it.each([
    ['vendedor (2)', { id: 2, nombre: 'Carlos', permiso: 2 }],
    ['armador (3)', { id: 3, nombre: 'Ana', permiso: 3 }],
    ['permiso desconocido (99)', { id: 4, nombre: 'Raro', permiso: 99 }],
    ['S-COM-11 permiso "1" en texto (forjado)', { id: 5, nombre: 'Forjado', permiso: '1' }],
    ['S-COM-11 permiso 1.0001', { id: 6, nombre: 'Casi', permiso: 1.0001 }],
  ])('AC-COM-2 AC-SEC-4 %s no ve la pestaña Comisiones', async (_l, v) => {
    setApp(v);
    await act(async () => { root.render(<App />); });
    expect(tabs().length).toBeGreaterThan(0);
    expect(tabs().some(t => t.includes('Comisiones'))).toBe(false);
  });

  it.each([
    ['vendedor (2)', { id: 2, nombre: 'Carlos', permiso: 2 }],
    ['armador (3)', { id: 3, nombre: 'Ana', permiso: 3 }],
    ['permiso 0', { id: 5, nombre: 'Cero', permiso: 0 }],
    ['sin permiso', { id: 6, nombre: 'SinPermiso' }],
    ['sin vendedor seleccionado', null],
    ['S-COM-11 permiso "1" en texto (forjado)', { id: 7, nombre: 'Forjado', permiso: '1' }],
  ])('AC-COM-2 AC-SEC-4 aunque se renderice la pantalla, %s ve "No tenés permisos" y no se cargan datos', async (_l, v) => {
    setApp(v);
    await act(async () => { root.render(<Comisiones />); });
    expect(container.textContent).toMatch(/No tenés permisos/);
    expect(cargarDatosComisiones).not.toHaveBeenCalled();
    expect(container.querySelector('input, select, textarea')).toBeNull();
  });
});
