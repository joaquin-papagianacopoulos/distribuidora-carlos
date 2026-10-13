// REQ-VEN AC-VEN-3 (RUN 20261012-2106, C8): el selector "Asignar vendedor" de
// los pedidos web en ListaPedidos no ofrece vendedores dados de baja.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { getTodayStr } from '../../utils/fuzzy';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockApp = {};
jest.mock('../../hooks/useAppContext', () => ({ useApp: () => mockApp }));
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn(() => { throw new Error('no deberia llamar a Supabase'); }) } }));
jest.mock('../../utils/pdfGen', () => ({ generarFacturaFile: jest.fn() }));
jest.mock('../../utils/share', () => ({ shareFiles: jest.fn() }));
jest.mock('../../utils/pdfMerge', () => ({ mergePdfFilesToSingleFile: jest.fn() }));
jest.mock('../../services/pedidoRepository', () => ({
  borrarPedidoOnlineFirst: jest.fn(() => Promise.resolve()),
  guardarPedidoOnlineFirst: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../services/deudaRepository', () => ({ quitarDeudaDePedido: jest.fn(() => Promise.resolve()) }));

// eslint-disable-next-line import/first
import ListaPedidos from '../ListaPedidos';

const ADMIN = { id: 1, nombre: 'Jorge', permiso: 1 };
const VENDEDORES = [
  ADMIN,
  { id: 2, nombre: 'Carlos', permiso: 2, zona: 'Norte' },
  { id: 3, nombre: 'Ex', permiso: 2, activo: false },
  { id: 4, nombre: 'Lucía', permiso: 2, activo: true },
];
const PEDIDO_WEB = { id: 50, fecha: getTodayStr(), clienteNombre: 'Cliente Web', vendedor: 'WEB', vendedorNombre: 'WEB', estado: 'pendiente', items: [], total: 0, createdAt: 1 };

let container;
let root;
const render = async () => { await act(async () => { root.render(<ListaPedidos />); }); };
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };

beforeEach(() => {
  Object.keys(mockApp).forEach(k => delete mockApp[k]);
  Object.assign(mockApp, {
    pedidos: [PEDIDO_WEB],
    clientes: [],
    vendedores: VENDEDORES,
    deudas: [],
    vendedorActual: ADMIN,
    zonaActiva: '',
    setZona: jest.fn(),
    recargar: jest.fn(() => Promise.resolve()),
    syncNow: jest.fn(),
    syncPedidosFecha: jest.fn(),
    syncPedidosCliente: jest.fn(),
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

describe('AC-VEN-3 ListaPedidos: asignar vendedor a un pedido web', () => {
  it("AC-VEN-3 'Asignar vendedor' en ListaPedidos no muestra dados de baja", async () => {
    await render();
    await click(container.querySelector('.pedido-card'));
    expect(container.textContent).toContain('Asignar vendedor');
    const select = [...container.querySelectorAll('select')].find(s => s.textContent.includes('Seleccionar vendedor'));
    expect(select).toBeDefined();
    const nombres = [...select.querySelectorAll('option')].map(o => o.value).filter(Boolean);
    expect(nombres).toEqual(['Jorge', 'Carlos', 'Lucía']);
    expect(nombres).not.toContain('Ex');
  });
});
