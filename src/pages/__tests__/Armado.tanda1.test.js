// Tanda 1 en Armado: REQ-MIN2 (solo admin por debajo del minimo / fuera de multiplo, con confirmacion),
// REQ-MUL (paso de a minimo), REQ-SST2 (etiqueta, nunca bloquea) y REQ-EDP (AC-EDP-2 banner "Modificado",
// AC-EDP-3 chequeo de version).
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
jest.mock('../../services/pedidoRepository', () => ({
  guardarPedidoOnlineFirst: jest.fn(() => Promise.resolve()),
  confirmarModificacionOnlineFirst: jest.fn((p) => Promise.resolve({ mode: 'online', pedido: { ...p, modificadoTrasArmado: null } })),
}));
jest.mock('../../services/deudaRepository', () => ({ actualizarMontoDeudaDePedido: jest.fn(() => Promise.resolve()) }));
jest.mock('../../services/faltanteRepository', () => ({ borrarFaltantesDeProducto: jest.fn(() => Promise.resolve()) }));
jest.mock('../../sync/syncService', () => ({ traerPedidoRemoto: jest.fn(() => Promise.resolve(null)) }));

// eslint-disable-next-line import/first
import Armado from '../Armado';
// eslint-disable-next-line import/first
import { guardarPedidoOnlineFirst, confirmarModificacionOnlineFirst } from '../../services/pedidoRepository';

const ADMIN = { id: 1, nombre: 'Admin', permiso: 1 };
const ARMADOR = { id: 3, nombre: 'Arm', permiso: 3 };
const VENDEDOR = { id: 2, nombre: 'Vend', permiso: 2 };

let container;
let root;

const pedido = (cantidad, over = {}) => ({
  id: 9, fecha: getTodayStr(), clienteNombre: 'Kiosco Pepe', vendedorNombre: 'Vend', estado: 'pendiente', createdAt: 1,
  items: [{ productoId: 'p1', nombre: 'Coca 500', precio: 10, precioOriginal: 10, cantidad }],
  total: cantidad * 10, ...over,
});

const setApp = (pedidos, usuario, productoOver = {}, over = {}) => {
  Object.keys(mockApp).forEach(k => delete mockApp[k]);
  Object.assign(mockApp, {
    pedidos, clientes: [],
    productos: [{ id: 'p1', nombre: 'Coca 500', precio: 10, minimoVenta: 6, ...productoOver }],
    faltantes: [], deudas: [], vendedorActual: usuario,
    recargar: jest.fn(() => Promise.resolve()), syncPedidosFecha: jest.fn(), stockMap: new Map(),
    ...over,
  });
};

const render = async () => { await act(async () => { root.render(<Armado />); }); };
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
const boton = (texto) => [...container.querySelectorAll('button')].find(b => b.textContent.includes(texto));
const setValue = async (el, value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  await act(async () => { setter.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); });
};
const cantidad = () => container.querySelector('input[inputmode="numeric"]');
const abrirArmado = async () => { await render(); await click(boton('Armar pedido')); };
const q = (id) => container.querySelector(`[data-testid="${id}"]`);

beforeEach(() => {
  jest.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  jest.restoreAllMocks();
});

describe('AC-MIN2-1 Armado: por debajo del minimo solo el admin, con confirmacion', () => {
  test('AC-MIN2-1 el admin baja de 12 a 2 (bajo el minimo 6): pide confirmacion y, si acepta, guarda', async () => {
    setApp([pedido(12)], ADMIN);
    const conf = jest.spyOn(window, 'confirm').mockReturnValue(true);
    await abrirArmado();
    await setValue(cantidad(), '2');
    expect(q('aviso-minimo').textContent).toContain('Mínimo para pedir: 6');
    await click(boton('Guardar cambios'));
    expect(conf).toHaveBeenCalledWith(expect.stringContaining('por debajo del mínimo'));
    expect(guardarPedidoOnlineFirst).toHaveBeenCalledTimes(1);
    expect(guardarPedidoOnlineFirst.mock.calls[0][0].items[0].cantidad).toBe(2);
  });

  test('AC-MIN2-1 el admin cancela la confirmacion: no guarda', async () => {
    setApp([pedido(12)], ADMIN);
    jest.spyOn(window, 'confirm').mockReturnValue(false);
    await abrirArmado();
    await setValue(cantidad(), '2');
    await click(boton('Guardar cambios'));
    expect(guardarPedidoOnlineFirst).not.toHaveBeenCalled();
  });

  test.each([['armador', ARMADOR], ['vendedor', VENDEDOR]])('AC-MIN2-1 %s no puede dejar el renglon bajo el minimo: ve el error y no guarda', async (_n, usuario) => {
    setApp([pedido(12)], usuario);
    const alerta = jest.spyOn(window, 'alert').mockImplementation(() => {});
    const conf = jest.spyOn(window, 'confirm');
    await abrirArmado();
    await setValue(cantidad(), '2');
    expect(q('aviso-minimo')).not.toBeNull();
    await click(boton('Guardar cambios'));
    expect(alerta).toHaveBeenCalledWith(expect.stringContaining('por debajo del mínimo'));
    expect(conf).not.toHaveBeenCalled();
    expect(guardarPedidoOnlineFirst).not.toHaveBeenCalled();
  });

  test('AC-MIN2-1 AC-MUL-2 fuera de multiplo (8 con minimo 6): admin con confirmacion, armador bloqueado', async () => {
    setApp([pedido(12)], ADMIN);
    const conf = jest.spyOn(window, 'confirm').mockReturnValue(true);
    await abrirArmado();
    await setValue(cantidad(), '8');
    expect(q('aviso-multiplo-minimo').textContent).toContain('Se pide de a 6');
    await click(boton('Guardar cambios'));
    expect(conf).toHaveBeenCalledWith(expect.stringContaining('fuera de múltiplo'));
    expect(guardarPedidoOnlineFirst).toHaveBeenCalledTimes(1);

    jest.clearAllMocks();
    await act(async () => { root.unmount(); });
    root = createRoot(container);
    setApp([pedido(12)], ARMADOR);
    const alerta = jest.spyOn(window, 'alert').mockImplementation(() => {});
    await abrirArmado();
    await setValue(cantidad(), '8');
    await click(boton('Guardar cambios'));
    expect(alerta).toHaveBeenCalledWith(expect.stringContaining('fuera de múltiplo'));
    expect(guardarPedidoOnlineFirst).not.toHaveBeenCalled();
  });

  test('AC-MUL-1 el + y el − de Armado van de a minimo (6 -> 12 -> 6) y no bajan del minimo', async () => {
    setApp([pedido(6)], ARMADOR);
    await abrirArmado();
    await click(container.querySelectorAll('.qty-btn')[1]);
    expect(cantidad().value).toBe('12');
    await click(container.querySelectorAll('.qty-btn')[0]);
    expect(cantidad().value).toBe('6');
    await click(container.querySelectorAll('.qty-btn')[0]);
    expect(cantidad().value).toBe('6');
  });
});

describe('AC-SST2-1 Armado: Sin stock — por recibir', () => {
  test('AC-SST2-1 muestra la etiqueta con stock 0 y guarda igual (nunca bloquea)', async () => {
    setApp([pedido(6)], ARMADOR, {}, { stockMap: new Map([['p1', 0]]) });
    await abrirArmado();
    expect(q('sin-stock-por-recibir').textContent).toBe('Sin stock — por recibir');
    await click(boton('Guardar cambios'));
    expect(guardarPedidoOnlineFirst).toHaveBeenCalledTimes(1);
  });
});

describe('AC-EDP-2 Armado: banner "Modificado"', () => {
  const modificado = { at: 1700000000000, por: 'Vend', productoIds: ['p1'] };

  test('AC-EDP-2 el pedido modificado muestra el banner y resalta los renglones cambiados', async () => {
    setApp([pedido(6, { armado: true, modificadoTrasArmado: modificado })], ARMADOR);
    await render();
    expect(q('badge-modificado')).not.toBeNull();
    await click(boton('Armar pedido'));
    expect(q('banner-modificado').textContent).toContain('Modificado');
    expect(q('renglon-modificado')).not.toBeNull();
  });

  test('AC-EDP-2 "Confirmar cambios" saca la marca (confirmarModificacionOnlineFirst) y el banner se va', async () => {
    setApp([pedido(6, { armado: true, modificadoTrasArmado: modificado })], ARMADOR);
    // restoreAllMocks (afterEach) borra las implementaciones: se define aca.
    confirmarModificacionOnlineFirst.mockImplementation((p) => Promise.resolve({ mode: 'online', pedido: { ...p, modificadoTrasArmado: null } }));
    await abrirArmado();
    await click(q('confirmar-modificacion'));
    expect(confirmarModificacionOnlineFirst).toHaveBeenCalledTimes(1);
    expect(q('banner-modificado')).toBeNull();
  });

  test('AC-EDP-2 un pedido sin marca no muestra banner', async () => {
    setApp([pedido(6)], ARMADOR);
    await abrirArmado();
    expect(q('banner-modificado')).toBeNull();
    expect(q('renglon-modificado')).toBeNull();
  });
});

describe('AC-EDP-3 Armado: chequeo de version', () => {
  test('AC-EDP-3 guarda con la version base (remoteUpdatedAt) del pedido', async () => {
    setApp([pedido(6, { remoteId: 'r1', remoteUpdatedAt: '2026-11-10T10:00:00Z' })], ARMADOR);
    await abrirArmado();
    await click(boton('Guardar cambios'));
    expect(guardarPedidoOnlineFirst).toHaveBeenCalledWith(expect.objectContaining({ id: 9 }), { versionBase: '2026-11-10T10:00:00Z' });
  });

  test('AC-EDP-3 si el servidor responde conflicto avisa, recarga y no pisa en silencio', async () => {
    setApp([pedido(6, { remoteId: 'r1', remoteUpdatedAt: '2026-11-10T10:00:00Z' })], ARMADOR);
    guardarPedidoOnlineFirst.mockResolvedValueOnce({ mode: 'conflicto' });
    const alerta = jest.spyOn(window, 'alert').mockImplementation(() => {});
    await abrirArmado();
    await click(boton('Guardar cambios'));
    expect(alerta).toHaveBeenCalledWith(expect.stringContaining('cambió en otro dispositivo'));
    expect(mockApp.recargar).toHaveBeenCalled();
    expect(boton('Guardar cambios')).toBeUndefined(); // volvió a la lista
  });
});
