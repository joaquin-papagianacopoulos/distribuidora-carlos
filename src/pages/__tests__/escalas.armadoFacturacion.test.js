// AC-ESC-3: Armado y Facturacion (edicion) muestran la etiqueta de escala y re-precian con +/- Bulto.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { getTodayStr } from '../../utils/fuzzy';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockApp = {};
jest.mock('../../hooks/useAppContext', () => ({ useApp: () => mockApp }));
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn(() => { throw new Error('no deberia llamar a Supabase'); }) } }));
jest.mock('../../db', () => ({ registrarFaltantes: jest.fn(() => Promise.resolve()), getPedidos: jest.fn(() => Promise.resolve([])) }));
jest.mock('../../utils/pdfGen', () => ({ generarFacturaFile: jest.fn(), generarListaClientesFile: jest.fn() }));
jest.mock('../../utils/share', () => ({ shareFiles: jest.fn(), canShareFiles: jest.fn(() => false) }));
jest.mock('../../utils/pdfMerge', () => ({ mergePdfFilesToSingleFile: jest.fn() }));
jest.mock('../../services/pedidoRepository', () => ({
  guardarPedidoOnlineFirst: jest.fn(() => Promise.resolve()),
  borrarPedidoOnlineFirst: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../services/deudaRepository', () => ({
  registrarDeudaFacturado: jest.fn(), quitarDeudaDePedido: jest.fn(), actualizarMontoDeudaDePedido: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../services/faltanteRepository', () => ({ borrarFaltantesDeProducto: jest.fn(() => Promise.resolve()) }));
jest.mock('../../services/stockService', () => ({ previsualizarStockPedido: jest.fn(() => Promise.resolve({ faltantes: [], decision: 'ok' })) }));

// eslint-disable-next-line import/first
import Armado from '../Armado';
// eslint-disable-next-line import/first
import Facturacion from '../Facturacion';
// eslint-disable-next-line import/first
import { guardarPedidoOnlineFirst } from '../../services/pedidoRepository';

const ADMIN = { id: 1, nombre: 'Admin', permiso: 1 };
const ESC = [{ desde: 5, pct: 8 }];
let container; let root;

const pedido = (cantidad, extra = {}) => ({
  id: 7, fecha: getTodayStr(), clienteNombre: 'Kiosco', vendedorNombre: 'Vend', estado: 'facturado', createdAt: 1,
  items: [{ productoId: 'p1', nombre: 'Coca 500', precio: 1000, precioOriginal: 1000, precioBultoX: 10, escalasBulto: ESC, cantidad, ...extra }],
  total: 1000 * cantidad,
});
const setApp = (p) => {
  Object.keys(mockApp).forEach(k => delete mockApp[k]);
  Object.assign(mockApp, {
    pedidos: [p], clientes: [], vendedores: [], deudas: [], faltantes: [], vendedorActual: ADMIN, zonaActiva: '',
    productos: [{ id: 'p1', nombre: 'Coca 500', precio: 1000, bultoX: 10, escalasBulto: ESC }],
    setZona: jest.fn(), recargar: jest.fn(() => Promise.resolve()), syncNow: jest.fn(), syncPedidosFecha: jest.fn(),
    syncPedidosCliente: jest.fn(), online: false,
  });
};
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
const boton = (t) => [...container.querySelectorAll('button')].find(b => b.textContent.includes(t));
const etiqueta = () => container.querySelector('[data-testid="escala-aplicada"]');

beforeEach(() => {
  jest.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => { root.unmount(); }); container.remove(); });

const abrir = async (Comp, txt) => { await act(async () => { root.render(<Comp />); }); await click(boton(txt)); };

describe.each([['Armado', Armado, 'Armar pedido'], ['Facturacion', Facturacion, 'Editar']])('AC-ESC-3 %s', (_n, Comp, txt) => {
  test('AC-ESC-3 sin escala no hay etiqueta', async () => {
    setApp(pedido(40));
    await abrir(Comp, txt);
    expect(etiqueta()).toBeNull();
  });
  test('AC-ESC-3 renglon con escala la muestra con signo menos', async () => {
    setApp(pedido(50, { precio: 920, escalaDesde: 5, escalaPct: 8 }));
    await abrir(Comp, txt);
    expect(etiqueta().textContent).toContain('x5 bultos −8 %');
  });
  test('AC-ESC-3 +Bulto cruza el borde (4 -> 5 bultos), muestra etiqueta y guarda total con 920', async () => {
    setApp(pedido(40));
    await abrir(Comp, txt);
    await click(container.querySelector('[data-testid="bulto-mas"]'));
    expect(etiqueta()).not.toBeNull();
    await click(boton('Guardar cambios'));
    const [final] = guardarPedidoOnlineFirst.mock.calls[0];
    expect(final.items[0].cantidad).toBe(50);
    expect(final.items[0].precio).toBe(920);
    expect(final.total).toBe(50 * 920);
  });
  test('AC-ESC-3 precio manual: no se re-precia ni se etiqueta', async () => {
    setApp(pedido(40, { precio: 900, precioManual: true }));
    await abrir(Comp, txt);
    await click(container.querySelector('[data-testid="bulto-mas"]'));
    expect(etiqueta()).toBeNull();
  });
});
