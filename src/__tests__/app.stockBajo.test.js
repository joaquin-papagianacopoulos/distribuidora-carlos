// REQ-STB (AC-STB-3) y REQ-CPR (AC-CPR-4) a nivel App: badge de stock bajo, pestaña Proveedores
// solo admin y apertura del Ingreso precargado desde un pedido recibido.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockApp = {};
jest.mock('../hooks/useAppContext', () => ({ AppProvider: ({ children }) => children, useApp: () => mockApp }));
jest.mock('../sync/useSync', () => ({ useSync: () => ({ syncing: false, lastSync: null, error: null, syncNote: null, syncNow: () => {} }) }));
jest.mock('../components/SelectorVendedor', () => () => 'SELECTOR');
jest.mock('../pages/NuevoPedido', () => ({ __esModule: true, default: () => 'PAGINA-NuevoPedido' }));
jest.mock('../pages/ListaPedidos', () => ({ __esModule: true, default: () => 'PAGINA-ListaPedidos' }));
jest.mock('../pages/Facturacion', () => ({ __esModule: true, default: () => 'PAGINA-Facturacion' }));
jest.mock('../pages/ResumenDia', () => ({ __esModule: true, default: () => 'PAGINA-ResumenDia' }));
jest.mock('../pages/ReportesVentas', () => ({ __esModule: true, default: () => 'PAGINA-ReportesVentas' }));
jest.mock('../pages/Configuracion', () => ({ __esModule: true, default: () => 'PAGINA-Configuracion' }));
jest.mock('../pages/Faltantes', () => ({ __esModule: true, default: () => 'PAGINA-Faltantes' }));
jest.mock('../pages/Deudas', () => ({ __esModule: true, default: () => 'PAGINA-Deudas' }));
jest.mock('../pages/OrdenEntrega', () => ({ __esModule: true, default: () => 'PAGINA-OrdenEntrega' }));
jest.mock('../pages/Armado', () => ({ __esModule: true, default: () => 'PAGINA-Armado' }));
jest.mock('../pages/Comisiones', () => ({ __esModule: true, default: () => 'PAGINA-Comisiones' }));
jest.mock('../pages/FacturasAEmitir', () => ({ __esModule: true, default: () => 'PAGINA-FacturasAEmitir' }));
jest.mock('../pages/PedidosWeb', () => ({ __esModule: true, default: () => 'PAGINA-PedidosWeb' }));
jest.mock('../pages/Stock', () => ({ __esModule: true, default: ({ precarga }) => `STOCK:${precarga ? JSON.stringify(precarga) : 'sin-precarga'}` }));
jest.mock('../pages/Proveedores', () => ({
  __esModule: true,
  default: ({ onAbrirIngreso }) => (
    <button onClick={() => onAbrirIngreso({ proveedorId: 'p1', pedidoProveedorId: 'ped-1', items: [{ productoId: '1', ingreso: 24 }] })}>RECIBIR</button>
  ),
}));

import App from '../App';

let container;
let root;
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
const tab = (label) => [...container.querySelectorAll('.nav-btn')].find(b => b.querySelector('.nav-label').textContent === label);

beforeEach(() => {
  Object.assign(mockApp, {
    vendedorActual: { id: 1, nombre: 'Admin', permiso: 1 }, online: true, faltantes: [], pedidos: [], seleccionarVendedor: jest.fn(),
    productos: [
      { id: 1, nombre: 'A', minimoVenta: 4 }, { id: 2, nombre: 'B', minimoVenta: 2 }, { id: 3, nombre: 'C', minimoVenta: 1, stockMinimo: 10 },
    ],
    stockMap: new Map([['1', 3], ['2', 50], ['3', 5]]),
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  Object.defineProperty(window.navigator, 'serviceWorker', { configurable: true, value: { getRegistrations: () => Promise.resolve([]) } });
});

afterEach(() => { act(() => { root.unmount(); }); container.remove(); });

const render = async () => { await act(async () => { root.render(<App />); }); };

describe('AC-STB-3 badge de stock bajo en la pestaña Stock', () => {
  it('AC-STB-3 el admin ve el contador (bajo por mínimo de venta y por Stock mínimo)', async () => {
    await render();
    expect(container.querySelector('[data-testid="badge-stock"]').textContent).toBe('2');
    expect(tab('Stock').contains(container.querySelector('[data-testid="badge-stock"]'))).toBe(true);
  });
  it('AC-STB-3 sin stock bajo no hay badge', async () => {
    mockApp.stockMap = new Map([['1', 50], ['2', 50], ['3', 50]]);
    await render();
    expect(container.querySelector('[data-testid="badge-stock"]')).toBeNull();
  });
  it.each([[2], [3]])('AC-SEC-4 rol %s no ve badge, ni Stock ni Proveedores', async (permiso) => {
    mockApp.vendedorActual = { id: 9, nombre: 'X', permiso };
    await render();
    expect(container.querySelector('[data-testid="badge-stock"]')).toBeNull();
    expect(tab('Stock')).toBeUndefined();
    expect(tab('Proveedores')).toBeUndefined();
  });
  it('AC-STB-3 mas de 99 se muestra 99+', async () => {
    mockApp.productos = Array.from({ length: 120 }, (_, i) => ({ id: i + 1, nombre: `P${i}`, minimoVenta: 5 }));
    mockApp.stockMap = new Map();
    await render();
    expect(container.querySelector('[data-testid="badge-stock"]').textContent).toBe('99+');
  });
});

describe('AC-CPR-4 recibir un pedido abre el Ingreso precargado', () => {
  it('AC-CPR-4 la pestaña Proveedores es de admin y "recibido" lleva a Stock con la precarga', async () => {
    await render();
    await click(tab('Proveedores'));
    expect(container.querySelector('main').textContent).toBe('RECIBIR');
    await click([...container.querySelectorAll('main button')][0]);
    expect(container.querySelector('main').textContent).toContain('STOCK:{"proveedorId":"p1","pedidoProveedorId":"ped-1"');
    expect(tab('Stock').className).toContain('active');
  });
  it('AC-CPR-4 al abrir Stock directo no hay precarga', async () => {
    await render();
    await click(tab('Stock'));
    expect(container.querySelector('main').textContent).toBe('STOCK:sin-precarga');
  });
});
