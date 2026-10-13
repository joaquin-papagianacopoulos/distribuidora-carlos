// REQ-COM AC-COM-1 / AC-COM-11 / AC-COM-13 en Facturación: botón "Marcar
// entregado" solo en facturados, badge "Cerrado" y aviso de ajuste.
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
  marcarEntregadoOnlineFirst: jest.fn(() => Promise.resolve({ mode: 'online' })),
}));
jest.mock('../../services/deudaRepository', () => ({
  registrarDeudaFacturado: jest.fn(), quitarDeudaDePedido: jest.fn(() => Promise.resolve({ conservada: false })), actualizarMontoDeudaDePedido: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../services/faltanteRepository', () => ({ borrarFaltantesDeProducto: jest.fn(() => Promise.resolve()) }));
jest.mock('../../services/stockService', () => ({ previsualizarStockPedido: jest.fn(() => Promise.resolve({ faltantes: [], decision: 'ok' })) }));

// eslint-disable-next-line import/first
import Facturacion from '../Facturacion';
// eslint-disable-next-line import/first
import { marcarEntregadoOnlineFirst, guardarPedidoOnlineFirst } from '../../services/pedidoRepository';
// eslint-disable-next-line import/first
import { quitarDeudaDePedido } from '../../services/deudaRepository';

let container;
let root;
const ped = (o) => ({ id: 7, remoteId: 'R7', fecha: getTodayStr(), clienteNombre: 'Kiosco Pepe', vendedorNombre: 'Vend', estado: 'facturado', createdAt: 1, items: [], total: 60, ...o });
const CIERRE = { id: 'c1', estado: 'vigente', lineas: [{ tipo: 'pedido', pedidoId: 'R7' }] };

const setApp = (over = {}) => {
  Object.keys(mockApp).forEach(k => delete mockApp[k]);
  Object.assign(mockApp, {
    pedidos: [ped({})], clientes: [], productos: [], vendedores: [], deudas: [], faltantes: [],
    vendedorActual: { id: 1, nombre: 'Admin', permiso: 1 }, zonaActiva: '', setZona: jest.fn(),
    recargar: jest.fn(() => Promise.resolve()), syncNow: jest.fn(), syncPedidosFecha: jest.fn(), syncPedidosCliente: jest.fn(), online: false,
    ...over,
  });
};
const render = async () => { await act(async () => { root.render(<Facturacion />); }); };
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
const q = (id) => container.querySelector(`[data-testid="${id}"]`);
const boton = (t) => [...container.querySelectorAll('button')].find(b => b.textContent.includes(t));

let confirmSpy;
let alertSpy;
beforeEach(() => {
  jest.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
  alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  confirmSpy.mockRestore();
  alertSpy.mockRestore();
});

describe('AC-COM-1 Facturación: marcar entregado', () => {
  it('AC-COM-1 un pedido facturado tiene el botón y al tocarlo marca entregado (sin cambiar estado)', async () => {
    setApp();
    await render();
    expect(q('btn-entregado').textContent).toMatch(/Marcar entregado/);
    await click(q('btn-entregado'));
    // S-COM-17: ahora se pasa { cerradoEn } (null: el pedido no esta en un cierre).
    expect(marcarEntregadoOnlineFirst).toHaveBeenCalledWith(expect.objectContaining({ id: 7, estado: 'facturado' }), true, { cerradoEn: null });
    expect(guardarPedidoOnlineFirst).not.toHaveBeenCalled();
    expect(mockApp.recargar).toHaveBeenCalled();
  });

  it('AC-COM-1 un pedido pendiente no tiene el botón', async () => {
    setApp({ pedidos: [ped({ estado: 'pendiente' })] });
    await render();
    expect(q('btn-entregado')).toBeNull();
  });

  it('AC-COM-1 marcado: muestra el badge y el botón "Desmarcar"', async () => {
    setApp({ pedidos: [ped({ entregado: true })] });
    await render();
    expect(q('badge-entregado')).not.toBeNull();
    await click(boton('Desmarcar entregado'));
    expect(marcarEntregadoOnlineFirst).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }), false, { cerradoEn: null });
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('AC-COM-1 si falla el guardado avisa y no rompe', async () => {
    marcarEntregadoOnlineFirst.mockRejectedValueOnce(new Error('sin red'));
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    setApp();
    await render();
    await click(q('btn-entregado'));
    expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('sin red'));
    errSpy.mockRestore();
  });
});

describe('AC-COM-11 AC-COM-13 pedido en un cierre vigente', () => {
  it('AC-COM-11 muestra el badge "Cerrado"', async () => {
    setApp({ pedidos: [ped({ entregado: true })], comisionesCierres: [CIERRE] });
    await render();
    expect(q('badge-cerrado')).not.toBeNull();
  });

  it('AC-COM-13 desmarcar un pedido cerrado pide confirmación de ajuste; si cancela no guarda', async () => {
    setApp({ pedidos: [ped({ entregado: true })], comisionesCierres: [CIERRE] });
    confirmSpy.mockReturnValue(false);
    await render();
    await click(boton('Desmarcar entregado'));
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringMatching(/AJUSTE PENDIENTE/));
    expect(marcarEntregadoOnlineFirst).not.toHaveBeenCalled();
  });

  // S-COM-17 (iteracion 3): el repositorio recibe el id del cierre para
  // aplicar "solo el admin desmarca un pedido cerrado" tambien fuera de la UI.
  it('AC-COM-13 S-COM-17 al desmarcar un pedido cerrado se pasa cerradoEn al repositorio', async () => {
    setApp({ pedidos: [ped({ entregado: true })], comisionesCierres: [CIERRE] });
    confirmSpy.mockReturnValue(true);
    await render();
    await click(boton('Desmarcar entregado'));
    expect(marcarEntregadoOnlineFirst).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }), false, { cerradoEn: 'c1' });
  });

  it('AC-COM-13 revertir a pendiente un pedido cerrado avisa que queda como ajuste', async () => {
    quitarDeudaDePedido.mockResolvedValue({ conservada: false });
    setApp({ pedidos: [ped({ entregado: true })], comisionesCierres: [CIERRE] });
    await render();
    await click(boton('Revertir a pendiente'));
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringMatching(/AJUSTE PENDIENTE/));
    expect(guardarPedidoOnlineFirst).toHaveBeenCalledWith(expect.objectContaining({ estado: 'pendiente' }));
  });

  it('AC-COM-13 cancelar un pedido cerrado también avisa; sin cierre no', async () => {
    setApp({ pedidos: [ped({})], comisionesCierres: [CIERRE] });
    confirmSpy.mockReturnValue(false);
    await render();
    await click(boton('Cancelar'));
    expect(confirmSpy).toHaveBeenLastCalledWith(expect.stringMatching(/AJUSTE PENDIENTE/));
    setApp({ pedidos: [ped({})], comisionesCierres: [] });
    await render();
    await click(boton('Cancelar'));
    expect(confirmSpy).toHaveBeenLastCalledWith(expect.not.stringMatching(/AJUSTE/));
  });
});
