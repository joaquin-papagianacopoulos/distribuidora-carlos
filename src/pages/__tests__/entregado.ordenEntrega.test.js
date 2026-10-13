// REQ-COM AC-COM-1 en Orden de entrega: lista de facturados del día con
// "Marcar entregado" para admin y armador; el vendedor solo ve el estado.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { sumarDias } from '../../utils/diasSemana';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockApp = {};
jest.mock('../../hooks/useAppContext', () => ({ useApp: () => mockApp }));
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn(() => { throw new Error('no deberia llamar a Supabase'); }) } }));
jest.mock('../../db', () => ({ updateCliente: jest.fn(), getPedidos: jest.fn(() => Promise.resolve([])) }));
jest.mock('../../sync/syncService', () => ({ syncClientes: jest.fn() }));
jest.mock('../../utils/pdfGen', () => ({ generarFacturaFile: jest.fn() }));
jest.mock('../../utils/share', () => ({ shareFiles: jest.fn(), canShareFiles: jest.fn(() => false) }));
jest.mock('../../utils/pdfMerge', () => ({ mergePdfFilesToSingleFile: jest.fn() }));
jest.mock('../../services/pedidoRepository', () => ({ marcarEntregadoOnlineFirst: jest.fn(() => Promise.resolve({ mode: 'offline' })) }));

// eslint-disable-next-line import/first
import OrdenEntrega from '../OrdenEntrega';
// eslint-disable-next-line import/first
import { marcarEntregadoOnlineFirst } from '../../services/pedidoRepository';

const AYER = sumarDias(null, -1);
const ped = (o) => ({ id: 1, remoteId: 'R1', fecha: AYER, clienteNombre: 'Kiosco', estado: 'facturado', total: 10, ...o });

let container;
let root;
const setApp = (vendedorActual, over = {}) => {
  Object.keys(mockApp).forEach(k => delete mockApp[k]);
  Object.assign(mockApp, {
    clientes: [], deudas: [], recargar: jest.fn(() => Promise.resolve()), syncPedidosFecha: jest.fn(),
    pedidos: [ped({}), ped({ id: 2, remoteId: 'R2', clienteNombre: 'Almacén', entregado: true }), ped({ id: 3, clienteNombre: 'Pendiente', estado: 'pendiente' }), ped({ id: 4, clienteNombre: 'Viejo', fecha: '2020-01-01' })],
    vendedorActual,
    ...over,
  });
};
const render = async () => { await act(async () => { root.render(<OrdenEntrega />); }); };
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
const fila = (id) => container.querySelector(`[data-testid="entrega-${id}"]`);

let alertSpy;
let confirmSpy;
beforeEach(() => {
  jest.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});
  confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  alertSpy.mockRestore();
  confirmSpy.mockRestore();
});

describe('AC-COM-1 Orden de entrega: entregas del día', () => {
  it('AC-COM-1 por defecto lista los facturados de ayer (salen hoy) con su estado', async () => {
    setApp({ id: 4, nombre: 'Ana', permiso: 3 });
    await render();
    const card = container.querySelector('[data-testid="entregas"]');
    expect(card.textContent).toMatch(/1 de 2 entregados/);
    expect(fila(1)).not.toBeNull();
    expect(fila(2).textContent).toMatch(/Entregado/);
    expect(fila(3)).toBeNull(); // pendiente
    expect(fila(4)).toBeNull(); // otro día
  });

  it('AC-COM-1 el armador marca entregado (no cambia estado ni stock)', async () => {
    setApp({ id: 4, nombre: 'Ana', permiso: 3 });
    await render();
    await click(fila(1).querySelector('button'));
    // S-COM-17: ahora se pasa { cerradoEn } (null: el pedido no esta en un cierre).
    expect(marcarEntregadoOnlineFirst).toHaveBeenCalledWith(expect.objectContaining({ id: 1, estado: 'facturado' }), true, { cerradoEn: null });
    expect(mockApp.recargar).toHaveBeenCalled();
  });

  it('AC-COM-1 el armador también puede desmarcar', async () => {
    setApp({ id: 4, nombre: 'Ana', permiso: 3 });
    await render();
    await click(fila(2).querySelector('button'));
    expect(marcarEntregadoOnlineFirst).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }), false, { cerradoEn: null });
  });

  it('AC-COM-1 el vendedor ve el estado pero no tiene botón', async () => {
    setApp({ id: 2, nombre: 'Carlos', permiso: 2 });
    await render();
    expect(fila(1)).not.toBeNull();
    expect(fila(1).querySelector('button')).toBeNull();
    expect(fila(2).querySelector('button')).toBeNull();
  });

  it('AC-COM-1 AC-COM-13 en el dispositivo del admin, un pedido cerrado pide confirmación; el armador no puede desmarcarlo', async () => {
    const cierres = [{ id: 'c1', estado: 'vigente', lineas: [{ tipo: 'pedido', pedidoId: 'R2' }] }];
    setApp({ id: 1, nombre: 'Jorge', permiso: 1 }, { comisionesCierres: cierres });
    confirmSpy.mockReturnValue(false);
    await render();
    await click(fila(2).querySelector('button'));
    expect(confirmSpy).toHaveBeenCalled();
    expect(marcarEntregadoOnlineFirst).not.toHaveBeenCalled();
    setApp({ id: 4, nombre: 'Ana', permiso: 3 }, { comisionesCierres: cierres });
    await render();
    expect(fila(2).querySelector('button')).toBeNull();
  });

  // S-COM-17 (iteracion 3): el admin confirma y el repositorio recibe cerradoEn.
  it('AC-COM-13 S-COM-17 el admin desmarca un pedido cerrado y se pasa cerradoEn al repositorio', async () => {
    const cierres = [{ id: 'c1', estado: 'vigente', lineas: [{ tipo: 'pedido', pedidoId: 'R2' }] }];
    setApp({ id: 1, nombre: 'Jorge', permiso: 1 }, { comisionesCierres: cierres });
    confirmSpy.mockReturnValue(true);
    await render();
    await click(fila(2).querySelector('button'));
    expect(marcarEntregadoOnlineFirst).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }), false, { cerradoEn: 'c1' });
  });

  it('AC-COM-1 cambiar de día y error al guardar', async () => {
    marcarEntregadoOnlineFirst.mockRejectedValueOnce(new Error('falló'));
    setApp({ id: 1, nombre: 'Jorge', permiso: 1 });
    await render();
    await click(fila(1).querySelector('button'));
    expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('falló'));
    const input = container.querySelector('#fecha-entregas');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, '2019-01-01');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(container.querySelector('[data-testid="entregas"]').textContent).toMatch(/No hay pedidos facturados/);
  });
});
