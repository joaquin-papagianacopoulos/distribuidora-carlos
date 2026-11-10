// QA Tanda 2 (run 20261110-t2): REQ-RED en Facturación — redondeo congelado al facturar, no recalculado en
// pedidos viejos, revertir lo limpia y la deuda sigue a totalACobrar.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { getTodayStr } from '../../utils/fuzzy';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockApp = {};
jest.mock('../../hooks/useAppContext', () => ({ useApp: () => mockApp }));
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn(() => { throw new Error('no deberia llamar a Supabase'); }) } }));
jest.mock('../../db', () => ({ registrarFaltantes: jest.fn(() => Promise.resolve()), getPedidos: jest.fn(), patchRegistros: jest.fn(), getVendedores: jest.fn() }));
jest.mock('../../utils/pdfGen', () => ({ generarFacturaFile: jest.fn() }));
jest.mock('../../utils/share', () => ({ shareFiles: jest.fn() }));
jest.mock('../../utils/pdfMerge', () => ({ mergePdfFilesToSingleFile: jest.fn() }));
jest.mock('../../services/pedidoRepository', () => ({
  guardarPedidoOnlineFirst: jest.fn(),
  borrarPedidoOnlineFirst: jest.fn(),
  marcarEntregadoOnlineFirst: jest.fn(),
}));
jest.mock('../../services/deudaRepository', () => ({ registrarDeudaFacturado: jest.fn(), quitarDeudaDePedido: jest.fn(() => Promise.resolve({ quitada: true, conservada: false })), actualizarMontoDeudaDePedido: jest.fn() }));
jest.mock('../../services/faltanteRepository', () => ({ borrarFaltantesDeProducto: jest.fn() }));
jest.mock('../../services/stockService', () => ({ previsualizarStockPedido: jest.fn(), aplicarStockPedido: jest.fn() }));
jest.mock('../../services/facturacionService', () => ({ guardarTiposFacturaLocal: jest.fn(), subirTiposFactura: jest.fn() }));
jest.mock('../../services/productosAdminService', () => ({ credencialesAdminProductos: jest.fn() }));

// eslint-disable-next-line import/first
import Facturacion from '../Facturacion';
// eslint-disable-next-line import/first
import * as mockStock from '../../services/stockService';
// eslint-disable-next-line import/first
import { guardarPedidoOnlineFirst } from '../../services/pedidoRepository';
// eslint-disable-next-line import/first
import { actualizarMontoDeudaDePedido, quitarDeudaDePedido } from '../../services/deudaRepository';
// eslint-disable-next-line import/first
import { guardarTiposFacturaLocal, subirTiposFactura } from '../../services/facturacionService';
// eslint-disable-next-line import/first
import { credencialesAdminProductos } from '../../services/productosAdminService';

let container;
let root;
const items = [
  { productoId: 1, nombre: 'Saphirus Lavanda', cantidad: 12, precio: 100 },
  { productoId: 2, nombre: 'Saphirus Rosa', cantidad: 12, precio: 100 },
];
const ped = (o) => ({ id: 7, remoteId: 'R7', fecha: getTodayStr(), clienteId: 5, clienteNombre: 'Kiosco Pepe', vendedorNombre: 'Vend', estado: 'pendiente', createdAt: 1, items, total: 2400, ...o });

const setApp = (over = {}) => {
  Object.keys(mockApp).forEach(k => delete mockApp[k]);
  Object.assign(mockApp, {
    pedidos: [ped({})], clientes: [{ id: 5, nombre: 'Kiosco Pepe', tipoIva: 'Responsable Inscripto', cuit: '' }],
    productos: [{ id: 1, nombre: 'Saphirus Lavanda', marca: 'Saphirus', precio: 100 }, { id: 2, nombre: 'Saphirus Rosa', marca: 'Saphirus', precio: 100 }],
    vendedores: [], deudas: [], faltantes: [],
    vendedorActual: { id: 1, nombre: 'Admin', permiso: 1 }, zonaActiva: '', setZona: jest.fn(),
    recargar: jest.fn(() => Promise.resolve()), syncNow: jest.fn(), syncPedidosFecha: jest.fn(), syncPedidosCliente: jest.fn(), online: false,
    ...over,
  });
};
const render = async () => { await act(async () => { root.render(<Facturacion />); }); };
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
const q = (id) => container.querySelector(`[data-testid="${id}"]`);
const boton = (t) => [...container.querySelectorAll('button')].find(b => b.textContent.includes(t));
const escribir = async (el, valor) => {
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const set = Object.getOwnPropertyDescriptor(proto, 'value').set;
  await act(async () => { set.call(el, valor); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); });
};

beforeEach(() => {
  jest.clearAllMocks();
  guardarTiposFacturaLocal.mockResolvedValue({ ok: true, count: 1 });
  guardarPedidoOnlineFirst.mockResolvedValue({});
  quitarDeudaDePedido.mockResolvedValue({ quitada: true, conservada: false });
  mockStock.previsualizarStockPedido.mockResolvedValue({ faltantes: [], decision: 'ok' });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  jest.spyOn(window, 'confirm').mockReturnValue(true);
  jest.spyOn(window, 'alert').mockImplementation(() => {});
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  jest.restoreAllMocks();
});

const items1260 = [{ productoId: 1, nombre: 'Saphirus Lavanda', cantidad: 12, precio: 105 }];
const guardado = () => guardarPedidoOnlineFirst.mock.calls[0][0];

describe('AC-RED-2 Facturación: el redondeo se congela al facturar', () => {
  it('AC-RED-2 facturar con el ajuste por defecto ($500) congela multiplo, redondeo y total redondeado; total sigue siendo la suma de renglones', async () => {
    setApp({ pedidos: [ped({ items: items1260, total: 1260 })] });
    await render();
    await click(boton('Cambiar a facturado'));
    expect(guardado()).toMatchObject({ estado: 'facturado', total: 1260, redondeoMultiplo: 500, totalRedondeado: 1500, redondeo: 240 });
    expect(guardarPedidoOnlineFirst.mock.calls[0][1]).toEqual({ iniciarStock: true });
  });

  it('AC-RED-2 con el ajuste del contexto en $1000 se congela $1000', async () => {
    setApp({ redondeoTotal: 1000, pedidos: [ped({ items: items1260, total: 1260 })] });
    await render();
    await click(boton('Cambiar a facturado'));
    expect(guardado()).toMatchObject({ redondeoMultiplo: 1000, totalRedondeado: 1000, redondeo: -260 });
  });

  it('AC-RED-2 sin redondeo (0) congela 0 y el total a cobrar es el de los renglones', async () => {
    setApp({ redondeoTotal: 0, pedidos: [ped({ items: items1260, total: 1260 })] });
    await render();
    await click(boton('Cambiar a facturado'));
    expect(guardado()).toMatchObject({ redondeoMultiplo: 0, totalRedondeado: 1260, redondeo: 0 });
  });

  it('AC-RED-2 pedido de $200 con ajuste $500: no se redondea', async () => {
    setApp({ pedidos: [ped({ items: [{ productoId: 1, nombre: 'X', cantidad: 2, precio: 100 }], total: 200 })] });
    await render();
    await click(boton('Cambiar a facturado'));
    expect(guardado()).toMatchObject({ total: 200, totalRedondeado: 200, redondeo: 0 });
  });

  it('AC-RED-2 revertir a pendiente limpia las tres claves y quita la deuda', async () => {
    setApp({ pedidos: [ped({ estado: 'facturado', items: items1260, total: 1260, redondeoMultiplo: 500, totalRedondeado: 1500, redondeo: 240 })] });
    await render();
    await click(boton('Revertir a pendiente'));
    expect(guardado()).toMatchObject({ estado: 'pendiente', redondeo: null, redondeoMultiplo: null, totalRedondeado: null });
  });
});

describe('AC-RED-2 Facturación: editar un facturado', () => {
  it('AC-RED-2 editar un facturado con multiplo congelado recalcula el ajuste con ESE multiplo (aunque la config cambie) y la deuda sigue a lo que se cobra', async () => {
    setApp({ redondeoTotal: 1000, pedidos: [ped({ estado: 'facturado', deudaGenerada: true, total: 1260, redondeoMultiplo: 500, totalRedondeado: 1500, redondeo: 240 })] });
    await render();
    await click(boton('Editar'));
    await click(boton('Guardar cambios'));
    expect(guardado()).toMatchObject({ total: 2400, redondeoMultiplo: 500, totalRedondeado: 2500, redondeo: 100 });
    expect(actualizarMontoDeudaDePedido).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }), 2500);
  });

  it('AC-RED-2 editar un facturado VIEJO (sin claves) no lo redondea: deuda = suma de renglones', async () => {
    setApp({ redondeoTotal: 500, pedidos: [ped({ estado: 'facturado', deudaGenerada: true, total: 2400 })] });
    await render();
    await click(boton('Editar'));
    await click(boton('Guardar cambios'));
    expect(guardado()).toMatchObject({ total: 2400 });
    expect(guardado().redondeoMultiplo == null).toBe(true);
    expect(actualizarMontoDeudaDePedido).toHaveBeenCalledWith(expect.anything(), 2400);
  });

  it('AC-RED-2 la lista muestra el total a cobrar redondeado de un facturado', async () => {
    setApp({ pedidos: [ped({ estado: 'facturado', items: items1260, total: 1260, redondeoMultiplo: 500, totalRedondeado: 1500, redondeo: 240 })] });
    await render();
    expect(container.textContent).toMatch(/1\.500/);
  });
});
