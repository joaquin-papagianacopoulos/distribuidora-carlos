// REQ-FAB (AC-FAB-1, 2) y REQ-AGR (AC-AGR-1, 2) en Facturación: selector por pedido, marcado masivo,
// subida con PIN, aviso de CUIT y agrupar en el editor. Nunca toca stock.
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
jest.mock('../../services/deudaRepository', () => ({ registrarDeudaFacturado: jest.fn(), quitarDeudaDePedido: jest.fn(), actualizarMontoDeudaDePedido: jest.fn() }));
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

describe('AC-FAB-1 Facturación: tipo de factura por pedido', () => {
  it('AC-FAB-1 el admin ve el selector con la sugerencia (RI => A) y confirma sin tocar stock', async () => {
    setApp();
    await render();
    expect(container.querySelector('[aria-label="Tipo de factura"]').value).toBe('A');
    await click(boton('Confirmar'));
    expect(guardarTiposFacturaLocal).toHaveBeenCalledWith([7], 'A');
    expect(mockApp.recargar).toHaveBeenCalled();
    expect(mockStock.aplicarStockPedido).not.toHaveBeenCalled();
    expect(guardarPedidoOnlineFirst).not.toHaveBeenCalled();
  });

  it('AC-FAB-1 los no admin no ven selector ni acciones de factura', async () => {
    for (const permiso of [2, 3]) {
      setApp({ vendedorActual: { id: 2, nombre: 'V', permiso }, pedidos: [ped({ tipoFactura: 'A', tipoFacturaPendiente: true, remoteId: 'R7' })] });
      await render();
      expect(container.querySelector('[aria-label="Tipo de factura"]')).toBeNull();
      expect(q('subir-tipos-factura')).toBeNull();
    }
  });

  it('AC-FAB-1 marcado masivo sobre la selección', async () => {
    setApp({ pedidos: [ped({ id: 7 }), ped({ id: 8, remoteId: 'R8', clienteNombre: 'Otro' })] });
    await render();
    await click(boton('Seleccionar'));
    expect(q('marcar-B').disabled).toBe(true);
    const checks = [...container.querySelectorAll('input[type="checkbox"]')];
    await click(checks[0].closest('.card'));
    await click(checks[1].closest('.card'));
    await click(q('marcar-B'));
    expect(guardarTiposFacturaLocal).toHaveBeenCalledWith(expect.arrayContaining([7, 8]), 'B');
  });
});

describe('AC-FAB-2 aviso Factura A sin CUIT', () => {
  it('AC-FAB-2 pedido A con cliente sin CUIT muestra el aviso y no bloquea el resto', async () => {
    setApp({ pedidos: [ped({ tipoFactura: 'A' })] });
    await render();
    expect(q('aviso-factura-a').textContent).toMatch(/CUIT/);
    expect(boton('Editar').disabled).toBe(false);
  });
});

describe('AC-FAB-3 subir tipos de factura con PIN', () => {
  const pendiente = () => ped({ tipoFactura: 'B', tipoFacturaPendiente: true, tipoFacturaAt: 5 });

  it('AC-FAB-3 muestra el contador, pide el PIN, lo limpia y sube', async () => {
    setApp({ pedidos: [pendiente()] });
    credencialesAdminProductos.mockResolvedValue({ ok: true, cred: { p_admin_id: '1', p_admin_pin: '1234' } });
    subirTiposFactura.mockResolvedValue({ ok: true, subidos: 1, rechazados: [], pendientes: 0 });
    await render();
    expect(boton('Subir tipos de factura (1)')).toBeTruthy();
    const pin = container.querySelector('[aria-label="PIN de administrador"]');
    await escribir(pin, '1234');
    await click(boton('Subir tipos de factura'));
    expect(credencialesAdminProductos).toHaveBeenCalledWith('1234');
    expect(subirTiposFactura).toHaveBeenCalledWith({ p_admin_id: '1', p_admin_pin: '1234' });
    expect(container.querySelector('[aria-label="PIN de administrador"]').value).toBe('');
    expect(container.textContent).toMatch(/Se subieron 1/);
  });

  it('AC-FAB-3 sin PIN valido no sube y avisa', async () => {
    setApp({ pedidos: [pendiente()] });
    credencialesAdminProductos.mockResolvedValue({ ok: false, mensaje: 'Ingresá tu PIN' });
    await render();
    await click(boton('Subir tipos de factura'));
    expect(subirTiposFactura).not.toHaveBeenCalled();
    expect(container.textContent).toMatch(/Ingresá tu PIN/);
  });

  it('AC-FAB-3 falta la migración: muestra el mensaje y deja pendiente', async () => {
    setApp({ pedidos: [pendiente()] });
    credencialesAdminProductos.mockResolvedValue({ ok: true, cred: { p_admin_id: '1', p_admin_pin: '1234' } });
    subirTiposFactura.mockResolvedValue({ ok: false, motivo: 'falta_migracion', mensaje: 'Falta la migración 011 en Supabase' });
    await render();
    await click(boton('Subir tipos de factura'));
    expect(container.textContent).toMatch(/Falta la migración 011/);
    expect(boton('Subir tipos de factura (1)')).toBeTruthy();
  });
});

describe('AC-AGR-2 agrupar al editar el pedido', () => {
  it('AC-AGR-2 el admin agrupa y al guardar el pedido lleva grupos con los renglones separados', async () => {
    setApp();
    await render();
    await click(boton('Editar'));
    const checks = [...container.querySelectorAll('[data-testid="agrupar-renglones"] input[type="checkbox"]')];
    expect(checks).toHaveLength(2);
    await click(checks[0]);
    await click(checks[1]);
    expect(container.querySelector('[aria-label="Nombre del nuevo grupo"]').value).toBe('Saphirus');
    await click(boton('Agrupar (2)'));
    expect(q('grupo-factura')).not.toBeNull();
    await click(boton('Guardar cambios'));
    expect(guardarPedidoOnlineFirst).toHaveBeenCalledTimes(1);
    const guardado = guardarPedidoOnlineFirst.mock.calls[0][0];
    expect(guardado.grupos).toHaveLength(1);
    expect(guardado.grupos[0]).toMatchObject({ nombre: 'Saphirus', itemIds: ['1', '2'] });
    expect(guardado.items).toHaveLength(2);
    expect(guardado.total).toBe(2400);
    expect(guardarPedidoOnlineFirst.mock.calls[0][1]).toBeUndefined();
    expect(mockStock.aplicarStockPedido).not.toHaveBeenCalled();
  });

  it('AC-AGR-2 sin tocar grupos, un pedido sin grupos no manda la clave', async () => {
    setApp();
    await render();
    await click(boton('Editar'));
    await click(boton('Guardar cambios'));
    expect(guardarPedidoOnlineFirst.mock.calls[0][0]).not.toHaveProperty('grupos');
  });

  it('AC-AGR-1 el armador no tiene acceso: Facturación queda bloqueada y no hay agrupador', async () => {
    setApp({ vendedorActual: { id: 3, nombre: 'Arm', permiso: 3 } });
    await render();
    expect(boton('Editar')).toBeUndefined();
    expect(q('agrupar-renglones')).toBeNull();
  });
});
