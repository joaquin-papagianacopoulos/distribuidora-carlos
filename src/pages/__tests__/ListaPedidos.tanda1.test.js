// REQ-EDP (AC-EDP-1) y REQ-PEN (AC-PEN-1) en la lista de pedidos: boton "Editar" segun permiso
// y bloque "Pendientes" con pedidos no facturados de otras fechas.
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
const CARLOS = { id: 2, nombre: 'Carlos', permiso: 2, zona: 'Norte' };
const hoy = getTodayStr();
const diaMas = (n) => {
  const d = new Date(`${hoy}T12:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const ped = (id, over = {}) => ({
  id, fecha: hoy, clienteNombre: `Cliente ${id}`, vendedor: 'Carlos', vendedorNombre: 'Carlos', zona: 'Norte',
  estado: 'pendiente', items: [{ productoId: 'p1', nombre: 'Coca', cantidad: 2, precio: 10 }], total: 20, createdAt: id, ...over,
});

let container;
let root;
const render = async (props = {}) => { await act(async () => { root.render(<ListaPedidos {...props} />); }); };
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };

const setApp = (pedidos, usuario) => {
  Object.keys(mockApp).forEach(k => delete mockApp[k]);
  Object.assign(mockApp, {
    pedidos, clientes: [], vendedores: [ADMIN, CARLOS], deudas: [], vendedorActual: usuario, zonaActiva: '',
    setZona: jest.fn(), recargar: jest.fn(() => Promise.resolve()), syncNow: jest.fn(), syncPedidosFecha: jest.fn(),
    syncPedidosCliente: jest.fn(), traerPedidosPendientes: jest.fn(),
  });
};

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

describe('AC-EDP-1 ListaPedidos: boton "Editar"', () => {
  test('AC-EDP-1 el vendedor ve "Editar" en su pedido pendiente y al tocarlo llama onEditar con el pedido', async () => {
    const p = ped(10);
    setApp([p], CARLOS);
    const onEditar = jest.fn();
    await render({ onEditar });
    await click(container.querySelector('.pedido-card'));
    const btn = container.querySelector('[data-testid="btn-editar-pedido"]');
    expect(btn).not.toBeNull();
    await click(btn);
    expect(onEditar).toHaveBeenCalledWith(expect.objectContaining({ id: 10 }));
  });

  test('AC-EDP-1 el vendedor NO ve "Editar" en un pedido de otro vendedor', async () => {
    setApp([ped(11, { vendedor: 'Lucia', vendedorNombre: 'Lucia' })], CARLOS);
    await render({ onEditar: jest.fn() });
    // El vendedor solo ve lo suyo: no aparece ni el pedido ni el boton.
    expect(container.querySelector('[data-testid="btn-editar-pedido"]')).toBeNull();
  });

  test('AC-EDP-1 el vendedor NO ve "Editar" en un pedido facturado (solo admin, por Facturacion)', async () => {
    setApp([ped(12, { estado: 'facturado' })], CARLOS);
    await render({ onEditar: jest.fn() });
    await click(container.querySelector('.pedido-card'));
    expect(container.querySelector('[data-testid="btn-editar-pedido"]')).toBeNull();
  });

  test('AC-EDP-1 el pedido que cargo el vendedor a nombre de otro tambien se puede editar (cargadoPor)', async () => {
    setApp([ped(13, { vendedor: 'Lucia', vendedorNombre: 'Lucia', cargadoPor: 'Carlos' })], CARLOS);
    await render({ onEditar: jest.fn() });
    await click(container.querySelector('.pedido-card'));
    expect(container.querySelector('[data-testid="btn-editar-pedido"]')).not.toBeNull();
  });

  test('AC-EDP-1 sin la prop onEditar no hay boton', async () => {
    setApp([ped(14)], CARLOS);
    await render();
    await click(container.querySelector('.pedido-card'));
    expect(container.querySelector('[data-testid="btn-editar-pedido"]')).toBeNull();
  });
});

describe('AC-PEN-1 ListaPedidos: bloque "Pendientes"', () => {
  test('AC-PEN-1 muestra los no facturados de otras fechas con dias faltan/pasaron y baja los pendientes al abrir', async () => {
    setApp([
      ped(20, { fecha: diaMas(-3), clienteNombre: 'Vencido' }),
      ped(21, { fecha: diaMas(2), clienteNombre: 'Futuro' }),
    ], ADMIN);
    await render();
    expect(mockApp.traerPedidosPendientes).toHaveBeenCalled();
    const bloque = container.querySelector('[data-testid="bloque-pendientes"]');
    expect(bloque).not.toBeNull();
    const items = [...container.querySelectorAll('[data-testid="pendiente-item"]')];
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain('Vencido');
    expect(items[0].textContent).toMatch(/Hace 3 d/);
    expect(items[1].textContent).toContain('Futuro');
    expect(items[1].textContent).toMatch(/Faltan 2 d/);
  });

  test('AC-PEN-1 no aparecen facturados, borrados ni los de hoy en el bloque', async () => {
    setApp([
      ped(30, { fecha: diaMas(-1), estado: 'facturado' }),
      ped(31, { fecha: diaMas(-1), borrado: true, estado: 'cancelado' }),
      ped(32, { fecha: hoy }),
    ], ADMIN);
    await render();
    expect(container.querySelector('[data-testid="bloque-pendientes"]')).toBeNull();
  });
});
