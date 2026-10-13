// REQ-BUL en Armado ("Armar pedido"): botón Bulto, armadoLog.cambios y permisos.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { getTodayStr } from '../../utils/fuzzy';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockApp = {};
jest.mock('../../hooks/useAppContext', () => ({ useApp: () => mockApp }));
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn(() => { throw new Error('no deberia llamar a Supabase'); }) } }));
jest.mock('../../db', () => ({
  registrarFaltantes: jest.fn(() => Promise.resolve()),
  getPedidos: jest.fn(() => Promise.resolve([])),
}));
jest.mock('../../utils/pdfGen', () => ({ generarFacturaFile: jest.fn(), generarListaClientesFile: jest.fn() }));
jest.mock('../../utils/share', () => ({ shareFiles: jest.fn(), canShareFiles: jest.fn(() => false) }));
jest.mock('../../utils/pdfMerge', () => ({ mergePdfFilesToSingleFile: jest.fn() }));
jest.mock('../../services/pedidoRepository', () => ({ guardarPedidoOnlineFirst: jest.fn(() => Promise.resolve()) }));
jest.mock('../../services/deudaRepository', () => ({ actualizarMontoDeudaDePedido: jest.fn(() => Promise.resolve()) }));
jest.mock('../../services/faltanteRepository', () => ({ borrarFaltantesDeProducto: jest.fn(() => Promise.resolve()) }));

// eslint-disable-next-line import/first
import Armado from '../Armado';
// eslint-disable-next-line import/first
import { guardarPedidoOnlineFirst } from '../../services/pedidoRepository';

const ARMADOR = { id: 3, nombre: 'Arm', permiso: 3 };
const ADMIN = { id: 1, nombre: 'Admin', permiso: 1 };
const VENDEDOR = { id: 2, nombre: 'Vend', permiso: 2 };

let container;
let root;

const pedido = (over = {}) => ({
  id: 9,
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
    pedidos: [pedido()],
    clientes: [],
    productos: [
      { id: 'p1', nombre: 'Coca 500', precio: 10, bultoX: 12 },
      { id: 'p2', nombre: 'Alfajor', precio: 5, bultoX: 1 },
      { id: 'p3', nombre: 'Agua', precio: 3, bultoX: 6 },
    ],
    faltantes: [],
    deudas: [],
    vendedorActual: ARMADOR,
    recargar: jest.fn(() => Promise.resolve()),
    syncPedidosFecha: jest.fn(),
    ...over,
  });
};

const render = async () => { await act(async () => { root.render(<Armado />); }); };
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
const boton = (texto) => [...container.querySelectorAll('button')].find(b => b.textContent.includes(texto));
const mases = () => [...container.querySelectorAll('[data-testid="bulto-mas"]')];
const menos = () => container.querySelector('[data-testid="bulto-menos"]');
const desglose = () => container.querySelector('[data-testid="bulto-desglose"]');
const cantidades = () => [...container.querySelectorAll('input[inputmode="numeric"]')].map(i => i.value);

const abrirArmado = async () => {
  await render();
  await click(boton('Armar pedido'));
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

describe('REQ-BUL Armado', () => {
  test('AC-BUL-1 solo el producto con bulto x12 muestra el botón', async () => {
    setApp();
    await abrirArmado();
    expect(container.querySelector('h2').textContent).toContain('Armar pedido');
    expect(mases()).toHaveLength(1);
    expect(mases()[0].textContent).toBe('+ Bulto (x 12)');
  });

  test('AC-BUL-2 AC-BUL-7 5 + 3 bultos = 41; al guardar armadoLog.cambios lo refleja y no inicia stock', async () => {
    setApp();
    await abrirArmado();
    await click(mases()[0]);
    await click(mases()[0]);
    await click(mases()[0]);
    expect(cantidades()).toContain('41');
    expect(desglose().textContent).toBe('41 u. = 3 bultos + 5 u.');

    await click(boton('Guardar cambios'));
    expect(guardarPedidoOnlineFirst).toHaveBeenCalledTimes(1);
    const [pedidoFinal, opts] = guardarPedidoOnlineFirst.mock.calls[0];
    expect(pedidoFinal.items.find(i => i.productoId === 'p1').cantidad).toBe(41);
    expect(pedidoFinal.armadoLog.cambios).toEqual([
      { productoId: 'p1', nombre: 'Coca 500', antes: 5, despues: 41, diferencia: 36 },
    ]);
    expect(pedidoFinal.total).toBe(41 * 10 + 2 * 5);
    expect(opts?.iniciarStock).not.toBe(true);
  });

  test('AC-BUL-7 los cambios se acumulan con sesiones anteriores del armador', async () => {
    setApp({
      pedidos: [pedido({
        items: [{ productoId: 'p1', nombre: 'Coca 500', precio: 10, cantidad: 17 }],
        armadoLog: { confirmados: [], removidos: [], cambios: [{ productoId: 'p1', nombre: 'Coca 500', antes: 5, despues: 17, diferencia: 12 }] },
      })],
    });
    await abrirArmado();
    await click(mases()[0]);
    await click(boton('Guardar cambios'));
    const [pedidoFinal] = guardarPedidoOnlineFirst.mock.calls[0];
    expect(pedidoFinal.armadoLog.cambios).toEqual([
      { productoId: 'p1', nombre: 'Coca 500', antes: 5, despues: 29, diferencia: 24 },
    ]);
  });

  test('AC-BUL-3 "− Bulto" desde 5 deja 1 y el renglón sigue existiendo', async () => {
    setApp();
    await abrirArmado();
    await click(menos());
    expect(cantidades()).toContain('1');
    expect(container.textContent).toContain('Coca 500');
    expect(menos().disabled).toBe(true);
  });

  test('AC-BUL-1 un ítem tachado (sacado) no muestra el botón', async () => {
    setApp({
      pedidos: [pedido({
        items: [{ productoId: 'p2', nombre: 'Alfajor', precio: 5, cantidad: 2 }],
        armadoLog: { confirmados: [], removidos: [{ productoId: 'p1', nombre: 'Coca 500', cantidad: 5, precio: 10 }] },
      })],
    });
    await abrirArmado();
    expect(container.textContent).toContain('Coca 500');
    expect(mases()).toHaveLength(0);
  });

  test.each([['armador (3)', ARMADOR], ['admin (1)', ADMIN]])('AC-BUL-8 en Armado el botón está para %s', async (_l, v) => {
    setApp({ vendedorActual: v });
    await abrirArmado();
    expect(mases()).toHaveLength(1);
  });

  test('AC-BUL-8 en Armado el vendedor (2) no ve el botón', async () => {
    setApp({ vendedorActual: VENDEDOR });
    await abrirArmado();
    expect(mases()).toHaveLength(0);
  });
});

describe('REQ-BUL Armado: bordes (QA)', () => {
  test('AC-BUL-7 +bulto y -bulto de vuelta al original no deja cambios en armadoLog', async () => {
    setApp();
    await abrirArmado();
    await click(mases()[0]);
    await click(menos());
    expect(cantidades()).toContain('5');
    await click(boton('Guardar cambios'));
    const [pedidoFinal] = guardarPedidoOnlineFirst.mock.calls[0];
    const cambios = pedidoFinal.armadoLog?.cambios ?? [];
    expect(cambios).toEqual([]);
  });

  test('AC-BUL-7 armadoLog.cambios previo corrupto (no-array) no rompe el guardado', async () => {
    setApp({
      pedidos: [pedido({ armadoLog: { confirmados: [], removidos: [], cambios: 'basura' } })],
    });
    await abrirArmado();
    await click(mases()[0]);
    await click(boton('Guardar cambios'));
    const [pedidoFinal] = guardarPedidoOnlineFirst.mock.calls[0];
    expect(pedidoFinal.armadoLog.cambios).toEqual([
      { productoId: 'p1', nombre: 'Coca 500', antes: 5, despues: 17, diferencia: 12 },
    ]);
  });
});

describe('REQ-BUL Armado: seguridad iter. 2', () => {
  test('S-BUL-03 AC-BUL-7 sacar del todo un producto con cambio previo no lo deja en armadoLog.cambios', async () => {
    setApp({
      pedidos: [pedido({
        items: [
          { productoId: 'p1', nombre: 'Coca 500', precio: 10, cantidad: 17 },
          { productoId: 'p2', nombre: 'Alfajor', precio: 5, cantidad: 2 },
        ],
        armadoLog: { confirmados: [], removidos: [], cambios: [{ productoId: 'p1', nombre: 'Coca 500', antes: 5, despues: 17, diferencia: 12 }] },
      })],
    });
    await abrirArmado();
    const sacar = [...container.querySelectorAll('button[title="Sacar del pedido (se anota en Faltantes)"]')];
    expect(sacar.length).toBeGreaterThan(0);
    await click(sacar[0]); // la lista se ordena alfabeticamente: Alfajor (p2) primero
    // Volvemos a buscar: sacamos tambien Coca 500 (p1), que tenia cambio previo.
    const sacarCoca = [...container.querySelectorAll('button[title="Sacar del pedido (se anota en Faltantes)"]')];
    await click(sacarCoca[sacarCoca.length - 1]);
    await click(boton('Guardar cambios'));
    const [pedidoFinal] = guardarPedidoOnlineFirst.mock.calls[0];
    const idsActivos = pedidoFinal.items.map(i => String(i.productoId));
    for (const c of pedidoFinal.armadoLog.cambios) expect(idsActivos).toContain(c.productoId);
    expect(pedidoFinal.armadoLog.removidos.map(r => r.productoId)).toContain('p1');
    expect(pedidoFinal.armadoLog.cambios.find(c => c.productoId === 'p1')).toBeUndefined();
  });
});

// AC-BUL-9 (2026-10-08): en "Armar pedido", un producto agregado arranca en 1
// con la marca "cantidad por defecto"; el primer "+ Bulto" la reemplaza.
describe('AC-BUL-9 Armado: unidad por defecto', () => {
  // Coca sin bulto para que el único botón "+ Bulto" sea el del producto agregado.
  const productosAc9 = [
    { id: 'p1', nombre: 'Coca 500', precio: 10, bultoX: 1 },
    { id: 'p2', nombre: 'Alfajor', precio: 5, bultoX: 1 },
    { id: 'p3', nombre: 'Agua Mineral', precio: 3, bultoX: 12 },
    { id: 'p4', nombre: 'Agua Saborizada', precio: 4, bultoX: 6 },
  ];
  const escribir = async (input, valor) => {
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, valor);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  const buscar = () => escribir(container.querySelector('input[placeholder="Buscar producto..."]'), 'Agua');
  const tocarSugerencia = async (nombre) => {
    const sugg = [...container.querySelectorAll('.suggestion-item')].find(s => s.textContent.includes(nombre));
    await click(sugg);
  };
  const agregarAgua = async () => { await buscar(); await tocarSugerencia('Agua Mineral'); };
  const masAgua = () => mases().find(b => b.textContent === '+ Bulto (x 12)');
  const guardarYObtener = async () => {
    await click(boton('Guardar cambios'));
    expect(guardarPedidoOnlineFirst).toHaveBeenCalledTimes(1);
    return guardarPedidoOnlineFirst.mock.calls[0][0];
  };

  test('AC-BUL-9 agregar producto y tocar "+ Bulto" x12 deja 12, no 13', async () => {
    setApp({ productos: productosAc9 });
    await abrirArmado();
    await agregarAgua();
    expect(cantidades()).toEqual(expect.arrayContaining(['5', '2', '1']));
    await click(masAgua());
    expect(cantidades()).toContain('12');
    expect(desglose().textContent).toBe('12 u. = 1 bulto');
    const pedidoFinal = await guardarYObtener();
    expect(pedidoFinal.items.find(i => i.productoId === 'p3').cantidad).toBe(12);
  });

  test('AC-BUL-9 agregar producto y tocar 3 veces "+ Bulto" deja 36', async () => {
    setApp({ productos: productosAc9 });
    await abrirArmado();
    await agregarAgua();
    await click(masAgua());
    await click(masAgua());
    await click(masAgua());
    expect(cantidades()).toContain('36');
    const pedidoFinal = await guardarYObtener();
    expect(pedidoFinal.items.find(i => i.productoId === 'p3').cantidad).toBe(36);
  });

  test('AC-BUL-9 si se escribe 1 a mano, "+ Bulto" suma (13)', async () => {
    setApp({ productos: productosAc9 });
    await abrirArmado();
    await agregarAgua();
    const input = [...container.querySelectorAll('input[inputmode="numeric"]')].find(i => i.value === '1');
    await escribir(input, '');
    await escribir(input, '1');
    await click(masAgua());
    expect(cantidades()).toContain('13');
  });

  test('AC-BUL-9 la marca no llega a lo que se guarda (con y sin tocar el bulto)', async () => {
    setApp({ productos: productosAc9 });
    await abrirArmado();
    await buscar();
    await tocarSugerencia('Agua Mineral');
    await tocarSugerencia('Agua Saborizada');
    await click(masAgua());
    const pedidoFinal = await guardarYObtener();
    expect(pedidoFinal.items.find(i => i.productoId === 'p3').cantidad).toBe(12);
    expect(pedidoFinal.items.find(i => i.productoId === 'p4').cantidad).toBe(1);
    expect(JSON.stringify(pedidoFinal)).not.toContain('_cantidadPorDefecto');
    expect(JSON.stringify(pedidoFinal.items)).not.toContain('_key');
  });
});

// C3 / C4 (RUN 20261012-2106)
describe('S-BUL-06 S-BUL-08 Armado', () => {
  const tipear = async (input, valor) => {
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, valor);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };

  test('AC-BUL-7 S-BUL-06 Armado: tipear 2000000 no cambia la cantidad; "1.000.000" se toma como 1000000', async () => {
    window.alert = jest.fn();
    setApp();
    await abrirArmado();
    const input = [...container.querySelectorAll('input[inputmode="numeric"]')].find(i => i.value === '5');
    await tipear(input, '2000000');
    expect(cantidades()).toContain('5');
    expect(cantidades()).not.toContain('2000000');
    await tipear(input, '1.000.000');
    expect(cantidades()).toContain('1000000');
  });

  test('AC-BUL-7 S-BUL-06 Armado: restaurar un tachado cuya suma supera el tope no fusiona; al guardar avisa y no guarda', async () => {
    window.alert = jest.fn();
    setApp({
      pedidos: [pedido({
        items: [{ productoId: 'p1', nombre: 'Coca 500', precio: 10, cantidad: 600000 }],
        armadoLog: { confirmados: [], removidos: [{ productoId: 'p1', nombre: 'Coca 500', cantidad: 500000, precio: 10 }] },
      })],
    });
    await abrirArmado();
    const ticks = () => [...container.querySelectorAll('button')].filter(b => b.textContent === '\u2713');
    expect(ticks()).toHaveLength(2);
    // El tachado es el que muestra "Sacado ×500000".
    const cardTachado = [...container.querySelectorAll('div')].filter(d => d.textContent.includes('Sacado') && d.querySelector('button')).pop();
    await click(cardTachado.querySelector('button'));
    // No se fusionó: quedan dos renglones activos (600000 y 500000).
    expect(cantidades()).toEqual(expect.arrayContaining(['600000', '500000']));
    await click(boton('Guardar cambios'));
    expect(guardarPedidoOnlineFirst).not.toHaveBeenCalled();
    expect(window.alert).toHaveBeenCalledWith('Cantidad inválida en: Coca 500 (máximo 1.000.000)');
  });

  test('AC-BUL-7 Armado: restaurar un tachado dentro del tope sigue fusionando como antes', async () => {
    setApp({
      pedidos: [pedido({
        items: [{ productoId: 'p1', nombre: 'Coca 500', precio: 10, cantidad: 6 }],
        armadoLog: { confirmados: [], removidos: [{ productoId: 'p1', nombre: 'Coca 500', cantidad: 5, precio: 10 }] },
      })],
    });
    await abrirArmado();
    const cardTachado = [...container.querySelectorAll('div')].filter(d => d.textContent.includes('Sacado') && d.querySelector('button')).pop();
    await click(cardTachado.querySelector('button'));
    expect(cantidades()).toEqual(['11']);
    await click(boton('Guardar cambios'));
    const [pedidoFinal] = guardarPedidoOnlineFirst.mock.calls[0];
    expect(pedidoFinal.items).toEqual([expect.objectContaining({ productoId: 'p1', cantidad: 11 })]);
  });

  test('AC-BUL-1 S-BUL-08 Armado: sin match por id no hay botón aunque exista un homónimo con bulto', async () => {
    setApp({ productos: [{ id: 'pX', nombre: 'Coca 500', precio: 10, bultoX: 12 }] });
    await abrirArmado();
    expect(mases()).toHaveLength(0);
  });
});
