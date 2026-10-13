// REQ-BUL en Facturación (modo edición): botón Bulto, regresión del borrador
// de texto (draftByPid/draftRef) y permisos.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { getTodayStr } from '../../utils/fuzzy';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockApp = {};
jest.mock('../../hooks/useAppContext', () => ({ useApp: () => mockApp }));
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn(() => { throw new Error('no deberia llamar a Supabase'); }) } }));
jest.mock('../../db', () => ({ registrarFaltantes: jest.fn(() => Promise.resolve()) }));
jest.mock('../../utils/pdfGen', () => ({ generarFacturaFile: jest.fn() }));
jest.mock('../../utils/share', () => ({ shareFiles: jest.fn() }));
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
import Facturacion from '../Facturacion';
// eslint-disable-next-line import/first
import { guardarPedidoOnlineFirst } from '../../services/pedidoRepository';

const ADMIN = { id: 1, nombre: 'Admin', permiso: 1 };

let container;
let root;

const pedidoFacturado = (over = {}) => ({
  id: 7,
  fecha: getTodayStr(),
  clienteNombre: 'Kiosco Pepe',
  vendedorNombre: 'Vend',
  estado: 'facturado',
  createdAt: 1,
  items: [
    { productoId: 'p1', nombre: 'Coca 500', precio: 10, precioOriginal: 10, cantidad: 5 },
    { productoId: 'p2', nombre: 'Alfajor', precio: 5, precioOriginal: 5, cantidad: 2 },
  ],
  total: 60,
  ...over,
});

const setApp = (over = {}) => {
  Object.keys(mockApp).forEach(k => delete mockApp[k]);
  Object.assign(mockApp, {
    pedidos: [pedidoFacturado()],
    clientes: [],
    productos: [
      { id: 'p1', nombre: 'Coca 500', precio: 10, bultoX: 12 },
      { id: 'p2', nombre: 'Alfajor', precio: 5, bultoX: 1 },
    ],
    vendedores: [],
    deudas: [],
    faltantes: [],
    vendedorActual: ADMIN,
    zonaActiva: '',
    setZona: jest.fn(),
    recargar: jest.fn(() => Promise.resolve()),
    syncNow: jest.fn(),
    syncPedidosFecha: jest.fn(),
    syncPedidosCliente: jest.fn(),
    online: false,
    ...over,
  });
};

const render = async () => { await act(async () => { root.render(<Facturacion />); }); };
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
const boton = (texto) => [...container.querySelectorAll('button')].find(b => b.textContent.includes(texto));
const mases = () => [...container.querySelectorAll('[data-testid="bulto-mas"]')];
const menos = () => container.querySelector('[data-testid="bulto-menos"]');
const desglose = () => container.querySelector('[data-testid="bulto-desglose"]');

const abrirEdicion = async () => {
  await render();
  await click(boton('Editar'));
};

beforeEach(() => {
  jest.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

describe('REQ-BUL Facturación (edición)', () => {
  test('AC-BUL-1 solo el producto con bulto x12 muestra el botón (el de bulto x1 no)', async () => {
    setApp();
    await abrirEdicion();
    expect(container.textContent).toContain('Editando pedido');
    const botones = mases();
    expect(botones).toHaveLength(1);
    expect(botones[0].textContent).toBe('+ Bulto (x 12)');
  });

  test('AC-BUL-2 AC-BUL-7 +3 bultos y Guardar: guarda 41 (no lo pisa el borrador de texto) y sin iniciarStock', async () => {
    setApp();
    await abrirEdicion();
    await click(mases()[0]);
    await click(mases()[0]);
    await click(mases()[0]);
    expect(desglose().textContent).toBe('41 u. = 3 bultos + 5 u.');
    const inputCant = [...container.querySelectorAll('input[inputmode="numeric"]')].find(i => i.value === '41');
    expect(inputCant).toBeDefined();

    await click(boton('Guardar cambios'));
    expect(guardarPedidoOnlineFirst).toHaveBeenCalledTimes(1);
    const [pedidoFinal, opts] = guardarPedidoOnlineFirst.mock.calls[0];
    const coca = pedidoFinal.items.find(i => i.productoId === 'p1');
    expect(coca.cantidad).toBe(41);
    expect(pedidoFinal.items.find(i => i.productoId === 'p2').cantidad).toBe(2);
    expect(pedidoFinal.total).toBe(41 * 10 + 2 * 5);
    expect(opts?.iniciarStock).not.toBe(true);
  });

  test('AC-BUL-3 "− Bulto" desde 5 deja 1 y al guardar queda 1', async () => {
    setApp();
    await abrirEdicion();
    await click(menos());
    expect(menos().disabled).toBe(true);
    await click(boton('Guardar cambios'));
    const [pedidoFinal] = guardarPedidoOnlineFirst.mock.calls[0];
    expect(pedidoFinal.items.find(i => i.productoId === 'p1').cantidad).toBe(1);
  });

  test('AC-BUL-7 el resumen del armado muestra las cantidades cambiadas por el armador', async () => {
    setApp({
      pedidos: [pedidoFacturado({
        armadoLog: { confirmados: [], removidos: [], cambios: [{ productoId: 'p1', nombre: 'Coca 500', antes: 5, despues: 41, diferencia: 36 }], por: 'Arm' },
      })],
    });
    await render();
    expect(container.querySelector('[data-testid="armado-cambios"]').textContent).toContain('Coca 500 5→41');
  });

  test('AC-BUL-7 un armadoLog viejo/corrupto sin cambios no rompe la pantalla', async () => {
    setApp({ pedidos: [pedidoFacturado({ armadoLog: { confirmados: [], removidos: [], cambios: 'basura' } })] });
    await render();
    expect(container.querySelector('[data-testid="armado-cambios"]')).toBeNull();
    expect(container.textContent).toContain('Kiosco Pepe');
  });

  test.each([
    ['vendedor (2)', { id: 2, nombre: 'Vend', permiso: 2 }],
    ['armador (3)', { id: 3, nombre: 'Arm', permiso: 3 }],
  ])('AC-BUL-8 Facturación niega acceso y no muestra el botón a %s', async (_l, v) => {
    setApp({ vendedorActual: v });
    await render();
    expect(container.textContent).toMatch(/No ten.+s permisos/);
    expect(mases()).toHaveLength(0);
  });
});

describe('REQ-BUL Facturación: borrador de texto (QA)', () => {
  test('AC-BUL-2 AC-BUL-7 cantidad tipeada (7) y luego +1 bulto guarda 19, no el texto viejo', async () => {
    setApp();
    await abrirEdicion();
    const input = [...container.querySelectorAll('input[inputmode="numeric"]')].find(i => i.value === '5');
    expect(input).toBeDefined();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, '7');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(mases()[0]);
    expect(desglose().textContent).toBe('19 u. = 1 bulto + 7 u.');
    await click(boton('Guardar cambios'));
    const [pedidoFinal] = guardarPedidoOnlineFirst.mock.calls[0];
    expect(pedidoFinal.items.find(i => i.productoId === 'p1').cantidad).toBe(19);
    expect(pedidoFinal.total).toBe(19 * 10 + 2 * 5);
  });

  test('AC-BUL-3 +bulto luego -bulto vuelve a 5 y guarda 5', async () => {
    setApp();
    await abrirEdicion();
    await click(mases()[0]);
    await click(menos());
    await click(boton('Guardar cambios'));
    const [pedidoFinal] = guardarPedidoOnlineFirst.mock.calls[0];
    expect(pedidoFinal.items.find(i => i.productoId === 'p1').cantidad).toBe(5);
  });

  test('AC-BUL-1 bultoX texto "12" en el producto muestra el boton', async () => {
    setApp({ productos: [{ id: 'p1', nombre: 'Coca 500', precio: 10, bultoX: '12' }, { id: 'p2', nombre: 'Alfajor', precio: 5, bultoX: 0.5 }] });
    await abrirEdicion();
    expect(mases()).toHaveLength(1);
    expect(mases()[0].textContent).toBe('+ Bulto (x 12)');
  });
});

describe('REQ-BUL Facturación: seguridad iter. 2', () => {
  test('S-BUL-05 AC-BUL-7 un armadoLog.cambios inflado se muestra acotado (500 entradas, nombre <= 120)', async () => {
    const cambios = Array.from({ length: 5000 }, (_, i) => ({ productoId: `x${i}`, nombre: 'N'.repeat(1000), antes: 1, despues: 2 }));
    setApp({ pedidos: [pedidoFacturado({ armadoLog: { confirmados: [], removidos: [], cambios } })] });
    await render();
    const txt = container.querySelector('[data-testid="armado-cambios"]').textContent;
    const entradas = txt.split(', ');
    expect(entradas).toHaveLength(500);
    expect(txt).not.toContain('N'.repeat(121));
  });

  test('S-BUL-03 S-BUL-05 AC-BUL-7 al guardar la edición no re-sube cambios de productos que ya no están', async () => {
    const cambios = [
      { productoId: 'p1', nombre: 'Coca 500', antes: 3, despues: 5, diferencia: 2 },
      { productoId: 'pX', nombre: 'Fantasma', antes: 5, despues: 10, diferencia: 5 },
    ];
    setApp({ pedidos: [pedidoFacturado({ armadoLog: { confirmados: [], removidos: [], cambios } })] });
    await abrirEdicion();
    await click(boton('Guardar cambios'));
    const [pedidoFinal] = guardarPedidoOnlineFirst.mock.calls[0];
    expect(pedidoFinal.armadoLog.cambios).toEqual([
      { productoId: 'p1', nombre: 'Coca 500', antes: 3, despues: 5, diferencia: 2 },
    ]);
  });

  test('S-BUL-07 AC-BUL-2 AC-BUL-3 toques rapidos de +/- bulto acumulan bien sin efectos en el updater', async () => {
    setApp();
    await abrirEdicion();
    await act(async () => {
      mases()[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
      mases()[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(desglose().textContent).toBe('29 u. = 2 bultos + 5 u.');
    await click(menos());
    await click(boton('Guardar cambios'));
    const [pedidoFinal] = guardarPedidoOnlineFirst.mock.calls[0];
    expect(pedidoFinal.items.find(i => i.productoId === 'p1').cantidad).toBe(17);
  });
});

// AC-BUL-9 (2026-10-08): en la edición, un producto agregado arranca en 1 con
// la marca "cantidad por defecto"; el primer "+ Bulto" la reemplaza. Ojo con el
// borrador de texto (draftByPid/draftRef): al guardar manda cantidadText, así
// que también tiene que quedar en 12/36 y no en el "1" del alta.
describe('AC-BUL-9 Facturación: unidad por defecto', () => {
  // Coca sin bulto para que el único botón "+ Bulto" sea el del producto agregado.
  const productosAc9 = [
    { id: 'p1', nombre: 'Coca 500', precio: 10, bultoX: 1 },
    { id: 'p2', nombre: 'Alfajor', precio: 5, bultoX: 1 },
    { id: 'p3', nombre: 'Agua Mineral', precio: 3, bultoX: 12 },
  ];
  const escribir = async (input, valor) => {
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, valor);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  const agregarAgua = async () => {
    await escribir(container.querySelector('input[placeholder="Buscar producto..."]'), 'Agua');
    const sugg = [...container.querySelectorAll('.suggestion-item')].find(s => s.textContent.includes('Agua Mineral'));
    await click(sugg);
  };
  const cantidadesNum = () => [...container.querySelectorAll('input[inputmode="numeric"]')].map(i => i.value);
  const guardarYObtenerAgua = async () => {
    await click(boton('Guardar cambios'));
    expect(guardarPedidoOnlineFirst).toHaveBeenCalledTimes(1);
    const [pedidoFinal] = guardarPedidoOnlineFirst.mock.calls[0];
    return { pedidoFinal, agua: pedidoFinal.items.find(i => i.productoId === 'p3') };
  };

  test('AC-BUL-9 agregar producto y tocar "+ Bulto" x12 guarda 12 (no 13 ni el "1" del borrador)', async () => {
    setApp({ productos: productosAc9 });
    await abrirEdicion();
    await agregarAgua();
    expect(cantidadesNum()).toContain('1');
    await click(mases()[0]);
    expect(desglose().textContent).toBe('12 u. = 1 bulto');
    expect(cantidadesNum()).toContain('12');
    const { pedidoFinal, agua } = await guardarYObtenerAgua();
    expect(agua.cantidad).toBe(12);
    expect(pedidoFinal.total).toBe(5 * 10 + 2 * 5 + 12 * 3);
  });

  test('AC-BUL-9 agregar producto y tocar 3 veces "+ Bulto" guarda 36', async () => {
    setApp({ productos: productosAc9 });
    await abrirEdicion();
    await agregarAgua();
    await click(mases()[0]);
    await click(mases()[0]);
    await click(mases()[0]);
    expect(desglose().textContent).toBe('36 u. = 3 bultos');
    const { agua } = await guardarYObtenerAgua();
    expect(agua.cantidad).toBe(36);
  });

  test('AC-BUL-9 si se escribe 1 a mano, "+ Bulto" suma (13)', async () => {
    setApp({ productos: productosAc9 });
    await abrirEdicion();
    await agregarAgua();
    const input = [...container.querySelectorAll('input[inputmode="numeric"]')].find(i => i.value === '1');
    await escribir(input, '');
    await escribir(input, '1');
    await click(mases()[0]);
    expect(desglose().textContent).toBe('13 u. = 1 bulto + 1 u.');
    const { agua } = await guardarYObtenerAgua();
    expect(agua.cantidad).toBe(13);
  });

  test('AC-BUL-9 un blur sin cambios en la cantidad no saca la marca (sigue dando 12)', async () => {
    setApp({ productos: productosAc9 });
    await abrirEdicion();
    await agregarAgua();
    const input = [...container.querySelectorAll('input[inputmode="numeric"]')].find(i => i.value === '1');
    await act(async () => { input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); });
    await click(mases()[0]);
    expect(desglose().textContent).toBe('12 u. = 1 bulto');
  });

  test('AC-BUL-9 la marca no llega a lo que se guarda (con y sin tocar el bulto)', async () => {
    setApp({ productos: [...productosAc9, { id: 'p4', nombre: 'Agua Saborizada', precio: 4, bultoX: 6 }] });
    await abrirEdicion();
    await escribir(container.querySelector('input[placeholder="Buscar producto..."]'), 'Agua');
    for (const nombre of ['Agua Mineral', 'Agua Saborizada']) {
      const sugg = [...container.querySelectorAll('.suggestion-item')].find(s => s.textContent.includes(nombre));
      // eslint-disable-next-line no-await-in-loop
      await click(sugg);
    }
    const masAgua = mases().find(b => b.textContent === '+ Bulto (x 12)');
    await click(masAgua);
    const { pedidoFinal, agua } = await guardarYObtenerAgua();
    expect(agua.cantidad).toBe(12);
    expect(pedidoFinal.items.find(i => i.productoId === 'p4').cantidad).toBe(1);
    expect(JSON.stringify(pedidoFinal)).not.toContain('_cantidadPorDefecto');
  });
});
