// REQ-REN en Facturación: no se revierte/borra/edita un pedido con rendición vigente
// (AC-REN-2/4) y la boleta muestra el saldo a favor del cliente (AC-REN-3).
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { getTodayStr } from '../../utils/fuzzy';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockApp = {};
const mockRend = { rendiciones: [], cuenta: [] };
jest.mock('../../hooks/useAppContext', () => ({ useApp: () => mockApp }));
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn(() => { throw new Error('no deberia llamar a Supabase'); }) } }));
jest.mock('../../db', () => ({ registrarFaltantes: jest.fn(() => Promise.resolve()) }));
jest.mock('../../utils/pdfGen', () => ({ generarFacturaFile: jest.fn() }));
jest.mock('../../utils/share', () => ({ shareFiles: jest.fn() }));
jest.mock('../../utils/pdfMerge', () => ({ mergePdfFilesToSingleFile: jest.fn() }));
jest.mock('../../services/pedidoRepository', () => ({
  guardarPedidoOnlineFirst: jest.fn(),
  borrarPedidoOnlineFirst: jest.fn(() => Promise.resolve()),
  marcarEntregadoOnlineFirst: jest.fn(() => Promise.resolve({ mode: 'online' })),
}));
jest.mock('../../services/deudaRepository', () => ({
  registrarDeudaFacturado: jest.fn(), quitarDeudaDePedido: async () => ({ conservada: false }), actualizarMontoDeudaDePedido: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../services/faltanteRepository', () => ({ borrarFaltantesDeProducto: jest.fn(() => Promise.resolve()) }));
jest.mock('../../services/stockService', () => ({ previsualizarStockPedido: jest.fn(() => Promise.resolve({ faltantes: [], decision: 'ok' })) }));
jest.mock('../../services/rendicionService', () => ({ cargarRendicionesLocales: async () => mockRend }));

// eslint-disable-next-line import/first
import Facturacion from '../Facturacion';
// eslint-disable-next-line import/first
import { guardarPedidoOnlineFirst, borrarPedidoOnlineFirst } from '../../services/pedidoRepository';
// eslint-disable-next-line import/first
import { generarFacturaFile } from '../../utils/pdfGen';

let container;
let root;
const ped = (o) => ({ id: 7, remoteId: 'R7', clienteId: 5, fecha: getTodayStr(), clienteNombre: 'Kiosco Pepe', vendedorNombre: 'Vend', estado: 'facturado', createdAt: 1, items: [], total: 60, ...o });
const setApp = (over = {}) => {
  Object.keys(mockApp).forEach(k => delete mockApp[k]);
  Object.assign(mockApp, {
    pedidos: [ped({})], clientes: [], productos: [], vendedores: [], deudas: [], faltantes: [],
    vendedorActual: { id: 1, nombre: 'Admin', permiso: 1 }, zonaActiva: '', setZona: jest.fn(),
    recargar: jest.fn(() => Promise.resolve()), syncNow: jest.fn(), syncPedidosFecha: jest.fn(), syncPedidosCliente: jest.fn(), online: false,
    ...over,
  });
};
const render = async () => { await act(async () => { root.render(<Facturacion />); }); await act(async () => {}); };
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
const boton = (t) => [...container.querySelectorAll('button')].find(b => b.textContent.includes(t));

let confirmSpy;
let alertSpy;
let openSpy;
beforeEach(() => {
  jest.clearAllMocks();
  mockRend.rendiciones = [];
  mockRend.cuenta = [];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
  alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});
  openSpy = jest.spyOn(window, 'open').mockReturnValue(null);
  global.URL.createObjectURL = jest.fn(() => 'blob:x');
  global.URL.revokeObjectURL = jest.fn();
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  confirmSpy.mockRestore();
  alertSpy.mockRestore();
  openSpy.mockRestore();
});

describe('AC-REN-4 Facturación bloquea pedidos con rendición vigente', () => {
  it('AC-REN-4 revertir, cancelar y editar quedan bloqueados con aviso', async () => {
    mockRend.rendiciones = [{ id: 'r1', pedidoId: 'R7', estado: 'vigente', syncEstado: 'confirmada' }];
    setApp();
    await render();
    await click(boton('Revertir a pendiente'));
    await click(boton('Cancelar'));
    await click(boton('Editar'));
    expect(alertSpy).toHaveBeenCalledTimes(3);
    expect(alertSpy.mock.calls[0][0]).toMatch(/rendición vigente/);
    expect(guardarPedidoOnlineFirst).not.toHaveBeenCalled();
    expect(borrarPedidoOnlineFirst).not.toHaveBeenCalled();
  });

  it('AC-REN-4 con la rendición anulada se puede revertir como siempre', async () => {
    mockRend.rendiciones = [{ id: 'r1', pedidoId: 'R7', estado: 'anulada', syncEstado: 'confirmada' }];
    setApp();
    await render();
    await click(boton('Revertir a pendiente'));
    expect(guardarPedidoOnlineFirst).toHaveBeenCalledWith(expect.objectContaining({ estado: 'pendiente' }));
  });
});

describe('AC-REN-3 boleta con saldo a favor', () => {
  it('AC-REN-3 sin deuda: pasa el saldo a favor del cliente a la boleta', async () => {
    mockRend.cuenta = [{ id: 'r1:favor:a', clienteId: '5', montoCents: 2500 }];
    generarFacturaFile.mockResolvedValue(new Blob(['x']));
    setApp();
    await render();
    await click(boton('Imprimir factura'));
    expect(generarFacturaFile).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }), undefined, { nombre: 'Vend' }, 0, null, { modoGrupos: 'detalle', saldoAFavor: 25 });
  });

  it('AC-REN-3 con deuda mayor: deuda neta y sin saldo; sin saldo la llamada es la de siempre', async () => {
    mockRend.cuenta = [{ id: 'r1:favor:a', clienteId: '5', montoCents: 2500 }];
    generarFacturaFile.mockResolvedValue(new Blob(['x']));
    setApp({ deudas: [{ id: 1, clienteId: 5, monto: 100, montoPagado: 0, pedidoId: 'OTRO' }] });
    await render();
    await click(boton('Imprimir factura'));
    expect(generarFacturaFile.mock.calls[0][3]).toBe(75);
    expect(generarFacturaFile.mock.calls[0][5]).toEqual({ modoGrupos: 'detalle' });
  });
});
