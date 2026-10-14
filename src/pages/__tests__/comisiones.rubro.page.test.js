// REQ-COMR (RUN 20261014-1449): pantalla Comisiones con el modelo por vendedor
// y rubro (AC-COMR-10, 11, 12, 13) y acceso solo admin.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockApp = {};
jest.mock('../../hooks/useAppContext', () => ({ useApp: () => mockApp }));
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn(() => { throw new Error('no deberia llamar a Supabase'); }), rpc: jest.fn(() => { throw new Error('no deberia llamar a Supabase'); }) } }));
jest.mock('../../services/comisionesService', () => ({
  cargarDatosComisiones: jest.fn(), guardarBorrador: jest.fn(), confirmarCierre: jest.fn(), anularCierre: jest.fn(), syncComisiones: jest.fn(),
}));
jest.mock('../../services/comisionesRubroService', () => ({
  syncComisionesRubro: jest.fn(), cargarTablaRubros: jest.fn(), guardarPctsVendedor: jest.fn(),
}));
jest.mock('../../utils/pdfGen', () => ({ generarCierreComisionesFile: jest.fn() }));

// eslint-disable-next-line import/first
import Comisiones from '../Comisiones';
// eslint-disable-next-line import/first
import { cargarDatosComisiones } from '../../services/comisionesService';
// eslint-disable-next-line import/first
import { syncComisionesRubro, cargarTablaRubros } from '../../services/comisionesRubroService';
// eslint-disable-next-line import/first
import { periodoPorDefecto, claveBorrador, armarDashboard, construirCierre } from '../../domain/comisiones';

const PERIODO = periodoPorDefecto();
const F = `${PERIODO.desde.slice(0, 8)}10`;
const VENDEDORES = [
  { id: 1, remoteId: 'u-jorge', nombre: 'Jorge', permiso: 1 },
  { id: 2, remoteId: 'u-ana', nombre: 'Ana', permiso: 2 },
  { id: 3, remoteId: 'u-beto', nombre: 'Beto', permiso: 2 },
];
const CLIENTES = [{ id: 10, nombre: 'Kiosco', vendedor: 'Ana' }];
const PRODUCTOS = [{ id: 'g', nombre: 'Alfajor', categoria: 'Golosinas' }, { id: 'l', nombre: 'Yogur', categoria: 'Lácteos' }, { id: 's', nombre: 'Varios', categoria: '' }];
const TABLA = [
  { id: 't1', vendedorId: 'u-ana', rubro: 'Golosinas', pct: 5 },
  { id: 't3', vendedorId: 'u-beto', rubro: 'Golosinas', pct: 3 },
];
const ped = (o) => ({ id: 1, remoteId: 'R1', clienteId: 10, clienteNombre: 'Kiosco', vendedor: 'Ana', fecha: F, estado: 'facturado', entregado: true, total: 1000, items: [{ productoId: 'g', nombre: 'Alfajor', precio: 1000, cantidad: 1 }], ...o });
const PEDIDOS = [
  ped({}),
  ped({ id: 2, remoteId: 'R2', vendedor: 'Beto' }), // dividido Ana/Beto 50/50
  ped({ id: 3, remoteId: 'R3', total: 300, items: [{ productoId: 'l', nombre: 'Yogur', precio: 300, cantidad: 1 }, { productoId: 's', nombre: 'Varios', precio: 0, cantidad: 1 }] }),
];
const datos = (over = {}) => ({
  pedidos: PEDIDOS, clientes: CLIENTES, vendedores: VENDEDORES, cierres: [], productos: PRODUCTOS, tablaRubros: TABLA,
  modelo: 'rubro', pendientesRubro: 0, faltaMigracion005: false,
  borrador: { id: claveBorrador(PERIODO), asignaciones: { R2: { modo: 'dividir', confirmada: true } } },
  incompleto: false, faltaMigracion: false, avisos: [], ...over,
});

let container;
let root;
const setApp = (vendedorActual) => {
  Object.keys(mockApp).forEach(k => delete mockApp[k]);
  Object.assign(mockApp, { vendedorActual, online: true });
};
const flush = async () => { await act(async () => { await new Promise(r => setTimeout(r, 0)); }); };
const render = async () => { await act(async () => { root.render(<Comisiones />); }); await flush(); await flush(); };
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); await flush(); };
const escribir = async (el, v) => {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, v);
  await act(async () => { el.dispatchEvent(new Event('input', { bubbles: true })); });
};
const q = (id) => container.querySelector(`[data-testid="${id}"]`);
const boton = (t, raiz = container) => [...raiz.querySelectorAll('button')].find(b => b.textContent.includes(t));
const ADMIN = VENDEDORES[0];

beforeEach(() => {
  cargarDatosComisiones.mockImplementation(async () => datos());
  syncComisionesRubro.mockImplementation(async () => ({ ok: true, pendientes: 0 }));
  cargarTablaRubros.mockImplementation(async () => TABLA);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

describe('AC-COMR-12 desglose por rubro y por vendedor', () => {
  it('AC-COMR-12 el detalle del vendedor muestra rubro, subtotal, % y comisión de cada pedido', async () => {
    setApp(ADMIN);
    await render();
    await click(q('vendedor-Ana'));
    const det = q('detalle-Ana');
    expect(det.textContent).toContain('por rubro');
    const d1 = q('desglose-Ana-R1');
    expect(d1.textContent).toContain('Golosinas · $1.000,00 · 5 %');
    expect(d1.textContent).toContain('$50,00');
    const d3 = q('desglose-Ana-R3');
    expect(d3.textContent).toContain('Lácteos · $300,00 · sin %');
    expect(d3.textContent).toContain('Sin rubro');
  });

  it('AC-COMR-10 en un pedido dividido no se muestra una comisión única: una por vendedor', async () => {
    setApp(ADMIN);
    await render();
    const asig = q('asignacion-R2');
    expect(asig.textContent).toContain('comisión Ana $25,00 / Beto $15,00');
    expect(asig.textContent).not.toContain('comisión $40,00');
    await click(q('vendedor-Beto'));
    expect(q('desglose-Beto-R2').textContent).toContain('Golosinas · $1.000,00 · 3 %');
    expect(q('detalle-Beto').textContent).toContain('dividido 50 %');
  });
});

describe('AC-COMR-11 avisos (c1) y (c2)', () => {
  it('AC-COMR-11 (c1) vendedor + rubro con contador y monto; "Cargar %" abre la grilla con el rubro enfocado', async () => {
    setApp(ADMIN);
    await render();
    const c1 = q('aviso-c1-u-ana-lacteos');
    expect(c1.textContent).toContain('Ana · Lácteos · 1 pedido(s) · $300,00 vendido');
    expect(q('aviso-c2').textContent).toContain('Varios');
    await click(boton('Cargar %', c1));
    const grid = q('comision-rubro-grid');
    expect(grid.textContent).toContain('Ana');
    expect(document.activeElement).toBe(container.querySelector('#pct-lacteos'));
    await click(boton('Cerrar', grid));
    expect(q('comision-rubro-grid')).toBeNull();
  });
});

describe('AC-COMR-7 estado de la tabla de % en Comisiones', () => {
  it('AC-COMR-7 banner de % pendientes y "Actualizar % de comisión" con PIN (bloquea el cierre)', async () => {
    cargarDatosComisiones.mockImplementation(async () => datos({ pendientesRubro: 2 }));
    setApp(ADMIN);
    await render();
    expect(q('pendientes-rubro').textContent).toContain('2');
    expect(q('motivos-bloqueo').textContent).toMatch(/2 % de comisión sin sincronizar/);
    const b = boton('Actualizar % de comisión');
    expect(b.disabled).toBe(true);
    await escribir(container.querySelector('#pin-rubro'), '4815');
    expect(b.disabled).toBe(false);
    await click(b);
    expect(syncComisionesRubro).toHaveBeenCalledWith({ pin: '4815' });
    expect(container.querySelector('#pin-rubro').value).toBe('');
  });

  it('AC-COMR-7 banner de migración 005 faltante y cierre bloqueado', async () => {
    cargarDatosComisiones.mockImplementation(async () => datos({ faltaMigracion005: true }));
    setApp(ADMIN);
    await render();
    expect(q('falta-005').textContent).toMatch(/migración 005/);
    expect(boton('Cerrar comisiones').disabled).toBe(true);
    expect(boton('Actualizar % de comisión').disabled).toBe(true);
  });

  it('AC-COMR-7 si actualizar los % falla se muestra el motivo', async () => {
    syncComisionesRubro.mockImplementation(async () => ({ ok: false, mensaje: 'PIN incorrecto o tu usuario no está autorizado como admin en el servidor.' }));
    setApp(ADMIN);
    await render();
    await escribir(container.querySelector('#pin-rubro'), '1');
    await click(boton('Actualizar % de comisión'));
    expect(container.textContent).toContain('PIN incorrecto o tu usuario no está autorizado');
    syncComisionesRubro.mockImplementation(async () => { throw new Error('caída'); });
    await escribir(container.querySelector('#pin-rubro'), '1');
    await click(boton('Actualizar % de comisión'));
    expect(container.textContent).toContain('No se pudieron actualizar los %: caída');
  });
});

describe('AC-COMR-13 historial: cierres por rubro con desglose; viejos como antes', () => {
  it('AC-COMR-13 un cierre por rubro muestra "Desglose por rubro"; uno viejo no', async () => {
    const d = armarDashboard({ ...datos(), periodo: PERIODO });
    const cierreRubro = { ...construirCierre(d, { admin: 'Jorge', genId: () => 'c-r', now: 1 }), estado: 'vigente' };
    const viejo = { id: 'c-v', estado: 'vigente', desde: '2020-01-01', hasta: '2020-01-31', cerradoAt: 1, totales: {}, lineas: [{ tipo: 'pedido', pedidoId: 'R9', total: 1, comision: 0, pct: 0 }] };
    cargarDatosComisiones.mockImplementation(async () => datos({ cierres: [cierreRubro, viejo], pedidos: [] }));
    setApp(ADMIN);
    await render();
    expect(q('desglose-cierre-c-r').textContent).toContain('Golosinas');
    expect(q('desglose-cierre-c-v')).toBeNull();
  });
});

describe('AC-COMR-6 AC-COMR-11 solo el admin', () => {
  it.each([[VENDEDORES[1]], [{ id: 5, nombre: 'Armador', permiso: 3 }]])('AC-COMR-6 vendedor/armador (%o) no ven el dashboard ni la grilla', async (u) => {
    setApp(u);
    await render();
    expect(container.textContent).toMatch(/No tenés permisos para ver comisiones/);
    expect(q('avisos')).toBeNull();
    expect(q('comision-rubro-grid')).toBeNull();
    expect(cargarDatosComisiones).not.toHaveBeenCalled();
  });
});
