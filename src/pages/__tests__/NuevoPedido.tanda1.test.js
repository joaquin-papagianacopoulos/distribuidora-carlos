// Tanda 1 en Nuevo pedido: REQ-CBU (botones Unidad/Bulto, casilleros, precio vigente), REQ-MUL (paso de a minimo,
// ajuste al tipear), REQ-SST2 (Sin stock — por recibir) y REQ-EDP (modo edicion).
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockApp = {};
jest.mock('../../hooks/useAppContext', () => ({ useApp: () => mockApp }));
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn(() => { throw new Error('no deberia llamar a Supabase'); }) } }));
jest.mock('../../db', () => ({ addCliente: jest.fn(() => Promise.resolve('c-nuevo')), updateCliente: jest.fn(() => Promise.resolve()) }));
jest.mock('../../services/pedidoRepository', () => ({
  crearPedidoOnlineFirst: jest.fn(() => Promise.resolve()),
  editarPedidoOnlineFirst: jest.fn(() => Promise.resolve({ mode: 'online' })),
}));

// eslint-disable-next-line import/first
import NuevoPedido from '../NuevoPedido';
// eslint-disable-next-line import/first
import { editarPedidoOnlineFirst } from '../../services/pedidoRepository';

const VENDEDOR = { id: 2, nombre: 'Vend', permiso: 2, zona: 'Norte' };

let container;
let root;

const sembrarBorrador = (items) => {
  localStorage.setItem(`nuevoPedidoDraft:${VENDEDOR.id}`, JSON.stringify({
    version: 1, clienteQ: 'Kiosco', clienteNombre: 'Kiosco', direccion: 'Mitre 123', items,
  }));
};
const renglon = (over = {}) => ({ productoId: 'p1', nombre: 'Coca 500', precio: 10, precioOriginal: 10, cantidad: 5, ...over });

const setApp = (over = {}) => {
  Object.keys(mockApp).forEach(k => delete mockApp[k]);
  Object.assign(mockApp, {
    productos: [{ id: 'p1', nombre: 'Coca 500', codigo: 'CC', precio: 10, bultoX: 12 }],
    clientes: [], vendedores: [], vendedorActual: VENDEDOR, zonaActiva: '', setZona: jest.fn(),
    recargar: jest.fn(() => Promise.resolve()), stockMap: new Map(), pedidos: [],
    ...over,
  });
};

const render = async (props = {}) => { await act(async () => { root.render(<NuevoPedido {...props} />); }); };
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
const mouseDown = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); }); };
const tipear = async (el, value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  await act(async () => { setter.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); });
};
const blur = async (el) => { await act(async () => { el.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); }); };
const cantidadInput = () => container.querySelector('input[inputmode="numeric"]');
const btnQty = (i) => container.querySelectorAll('.qty-btn')[i];
const q = (id) => container.querySelector(`[data-testid="${id}"]`);
const buscador = () => container.querySelector('input[placeholder^="Ej: 9 de oro"]');
const buscar = async (texto) => { await tipear(buscador(), texto); };

beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  localStorage.clear();
  jest.clearAllMocks();
});

describe('AC-CBU-1 lista de productos: botones Unidad / Bulto', () => {
  test('AC-CBU-1 producto con bulto muestra "Unidad $X" y "Bulto xN $Y" y tocar Bulto agrega 1 bulto', async () => {
    setApp({ productos: [{ id: 'p1', nombre: 'Coca 500', codigo: 'CC', precio: 10, precioBulto: 8, bultoX: 12 }] });
    await render();
    await buscar('coca');
    expect(q('lista-unidad').textContent).toBe('Unidad $10');
    expect(q('lista-bulto').textContent).toBe('Bulto x12 $96');
    await mouseDown(q('lista-bulto'));
    expect(cantidadInput().value).toBe('12');
    expect(q('bulto-casillero-valor').textContent).toBe('1');
    // Otro toque suma otro bulto (no suma el minimo ni 1 unidad).
    await mouseDown(q('lista-bulto'));
    expect(cantidadInput().value).toBe('24');
  });

  test('AC-CBU-1 "Unidad" agrega 1 unidad como siempre; sin bulto no hay botones', async () => {
    setApp({ productos: [{ id: 'p1', nombre: 'Coca 500', codigo: 'CC', precio: 10, bultoX: 12 }, { id: 'p2', nombre: 'Cocoa', codigo: 'CO', precio: 5, bultoX: 1 }] });
    await render();
    await buscar('coc');
    expect(container.querySelectorAll('[data-testid="lista-bulto"]')).toHaveLength(1);
    await mouseDown(q('lista-unidad'));
    expect(cantidadInput().value).toBe('1');
  });
});

describe('AC-CBU-2/3 casilleros y precio aplicado', () => {
  test('AC-CBU-2 el renglon muestra bultos y sueltas partidos de la cantidad en unidades', async () => {
    setApp();
    sembrarBorrador([renglon({ cantidad: 29 })]);
    await render();
    expect(q('bulto-casillero-valor').textContent).toBe('2');
    expect(q('sueltas-casillero-valor').textContent).toBe('5');
    expect(cantidadInput().value).toBe('29');
  });

  test('AC-CBU-2 sumar un bulto no suma el minimo', async () => {
    setApp({ productos: [{ id: 'p1', nombre: 'Coca 500', codigo: 'CC', precio: 10, bultoX: 12, minimoVenta: 6 }] });
    sembrarBorrador([renglon({ cantidad: 12 })]);
    await render();
    await click(q('bulto-mas'));
    expect(cantidadInput().value).toBe('24');
  });

  test('AC-CBU-3 muestra "Precio unidad" y cambia a "Precio bulto" al cruzar el bulto', async () => {
    setApp({ productos: [{ id: 'p1', nombre: 'Coca 500', codigo: 'CC', precio: 10, precioBulto: 8, bultoX: 12 }] });
    sembrarBorrador([renglon({ cantidad: 5, precioOriginal: 10, precioBultoOriginal: 8, precioBultoX: 12, precioPorBulto: false })]);
    await render();
    expect(q('precio-vigente').textContent).toBe('Precio unidad $10');
    await click(q('bulto-mas')); // 5 + 12 = 17 (>= bulto)
    expect(q('precio-vigente').textContent).toBe('Precio bulto $8 c/u');
  });
});

describe('AC-MUL-1/2 multiplos del minimo', () => {
  const prodMin = { id: 'p1', nombre: 'Coca 500', codigo: 'CC', precio: 10, minimoVenta: 3 };

  test('AC-MUL-1 el + va de a minimo (3 -> 6 -> 9) y el - baja de a minimo sin bajar del minimo', async () => {
    setApp({ productos: [prodMin] });
    sembrarBorrador([renglon({ cantidad: 3 })]);
    await render();
    await mouseDown(btnQty(1));
    expect(cantidadInput().value).toBe('6');
    await mouseDown(btnQty(1));
    expect(cantidadInput().value).toBe('9');
    await mouseDown(btnQty(0));
    expect(cantidadInput().value).toBe('6');
    await mouseDown(btnQty(0));
    await mouseDown(btnQty(0));
    expect(cantidadInput().value).toBe('3');
  });

  test('AC-MUL-1 volver a tocar el producto en la lista suma de a minimo', async () => {
    setApp({ productos: [prodMin] });
    await render();
    await buscar('coca');
    await mouseDown(container.querySelector('.suggestion-item'));
    expect(cantidadInput().value).toBe('3');
    await mouseDown(container.querySelector('.suggestion-item'));
    expect(cantidadInput().value).toBe('6');
  });

  test('AC-MUL-1 tipear 7 con minimo 3 se ajusta al multiplo superior (9) con aviso', async () => {
    setApp({ productos: [prodMin] });
    sembrarBorrador([renglon({ cantidad: 3 })]);
    await render();
    await tipear(cantidadInput(), '7');
    await blur(cantidadInput());
    expect(cantidadInput().value).toBe('9');
    expect(q('aviso-ajuste').textContent).toContain('Se ajustó a 9 (de a 3)');
  });

  test('AC-MUL-1 minimo vacio, 0 o 1 va de a 1', async () => {
    for (const minimoVenta of [undefined, 0, 1, '']) {
      setApp({ productos: [{ id: 'p1', nombre: 'Coca 500', codigo: 'CC', precio: 10, minimoVenta }] });
      sembrarBorrador([renglon({ cantidad: 3 })]);
      await act(async () => { root.unmount(); });
      root = createRoot(container);
      await render();
      await mouseDown(btnQty(1));
      expect(cantidadInput().value).toBe('4');
    }
  });

  test('AC-MUL-2 un renglon fuera de multiplo muestra error y no se guarda desde Nuevo pedido', async () => {
    setApp({ productos: [prodMin] });
    sembrarBorrador([renglon({ cantidad: 7 })]);
    const alerta = jest.spyOn(window, 'alert').mockImplementation(() => {});
    await render();
    expect(q('error-multiplo').textContent).toContain('Se pide de a 3');
    const guardar = [...container.querySelectorAll('button')].find(b => b.textContent.includes('Guardar Pedido'));
    await click(guardar);
    expect(require('../../services/pedidoRepository').crearPedidoOnlineFirst).not.toHaveBeenCalled();
    alerta.mockRestore();
  });
});

describe('AC-SST2-1 productos sin stock', () => {
  test('AC-SST2-1 un producto con stock 0 aparece en la lista, dice "Sin stock — por recibir" y se puede agregar', async () => {
    setApp({ productos: [{ id: 'p1', nombre: 'Coca 500', codigo: 'CC', precio: 10 }], stockMap: new Map([['p1', 0]]) });
    await render();
    await buscar('coca');
    expect(q('sugerencia-sin-stock').textContent).toBe('Sin stock — por recibir');
    await mouseDown(container.querySelector('.suggestion-item'));
    expect(cantidadInput().value).toBe('1');
    expect(q('sin-stock-por-recibir').textContent).toBe('Sin stock — por recibir');
  });

  test('AC-SST2-1 con stock negativo tambien aparece y se agrega; con stock positivo no hay etiqueta', async () => {
    setApp({ productos: [{ id: 'p1', nombre: 'Coca 500', codigo: 'CC', precio: 10 }, { id: 'p2', nombre: 'Cocoa', codigo: 'CO', precio: 5 }], stockMap: new Map([['p1', -4], ['p2', 20]]) });
    await render();
    await buscar('coc');
    expect(container.querySelectorAll('.suggestion-item')).toHaveLength(2);
    expect(container.querySelectorAll('[data-testid="sugerencia-sin-stock"]')).toHaveLength(1);
  });
});

describe('AC-EDP-1 modo edicion', () => {
  const pedidoEditable = (over = {}) => ({
    id: 77, fecha: '2026-11-10', clienteNombre: 'Kiosco Pepe', clienteId: 'c1', vendedor: 'Vend', vendedorNombre: 'Vend',
    estado: 'pendiente', items: [renglon({ cantidad: 6 })], total: 60, observaciones: 'obs', createdAt: 1, ...over,
  });

  test('AC-EDP-1 carga el pedido del vendedor, bloquea cliente/fecha y guarda por editarPedidoOnlineFirst (mismo pedido)', async () => {
    const p = pedidoEditable();
    setApp({ pedidos: [p] });
    const onFin = jest.fn();
    await render({ pedidoEditarId: 77, onFinEdicion: onFin });
    expect(q('banner-edicion').textContent).toContain('Kiosco Pepe');
    expect(container.querySelector('h1').textContent).toBe('Editar pedido');
    expect(cantidadInput().value).toBe('6');
    await mouseDown(btnQty(1)); // 6 -> 7 (sin minimo, de a 1)
    const guardar = [...container.querySelectorAll('button')].find(b => b.textContent.includes('Guardar cambios'));
    await click(guardar);
    expect(editarPedidoOnlineFirst).toHaveBeenCalledTimes(1);
    const [original, cambios] = editarPedidoOnlineFirst.mock.calls[0];
    expect(original.id).toBe(77);
    expect(cambios.items[0].cantidad).toBe(7);
    expect(cambios.total).toBe(70);
    expect(onFin).toHaveBeenCalled();
  });

  test('AC-EDP-1 las mismas reglas de Nuevo pedido: fuera de multiplo del minimo no se guarda', async () => {
    setApp({ pedidos: [pedidoEditable({ items: [renglon({ cantidad: 3 })], total: 30 })], productos: [{ id: 'p1', nombre: 'Coca 500', codigo: 'CC', precio: 10, minimoVenta: 3 }] });
    const alerta = jest.spyOn(window, 'alert').mockImplementation(() => {});
    await render({ pedidoEditarId: 77, onFinEdicion: jest.fn() });
    await tipear(cantidadInput(), '4'); // sin blur: queda fuera de multiplo
    const guardar = [...container.querySelectorAll('button')].find(b => b.textContent.includes('Guardar cambios'));
    await click(guardar);
    expect(editarPedidoOnlineFirst).not.toHaveBeenCalled();
    alerta.mockRestore();
  });

  test('AC-EDP-1 un pedido de otro vendedor no se puede editar', async () => {
    setApp({ pedidos: [pedidoEditable({ vendedor: 'Otro', vendedorNombre: 'Otro' })] });
    await render({ pedidoEditarId: 77, onFinEdicion: jest.fn() });
    expect(q('error-edicion')).not.toBeNull();
    expect(q('banner-edicion')).toBeNull();
  });

  test('AC-EDP-1 un pedido facturado se edita desde Facturacion, no desde acá', async () => {
    setApp({ pedidos: [pedidoEditable({ estado: 'facturado' })], vendedorActual: { id: 1, nombre: 'Admin', permiso: 1 } });
    await render({ pedidoEditarId: 77, onFinEdicion: jest.fn() });
    expect(q('error-edicion').textContent).toContain('Facturación');
  });
});
