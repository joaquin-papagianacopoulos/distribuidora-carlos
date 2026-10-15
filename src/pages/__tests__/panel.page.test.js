// REQ-PAN (AC-PAN-2..5): pantalla Panel (solo admin) con servicios mockeados.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockApp = {};
const mockLlam = { costosProd: [], rend: [], costosVenta: [] };
const mockEstado = { falta015: false, costosVenta: new Map() };
jest.mock('../../hooks/useAppContext', () => ({ useApp: () => mockApp }));
jest.mock('../../services/panelService', () => ({
  cargarDatosPanel: async () => ({ rendiciones: [], costosVenta: mockEstado.costosVenta }),
  sondearMigracion015: async () => ({ faltaMigracion: mockEstado.falta015 }),
  bajarCostosVenta: async (c) => { mockLlam.costosVenta.push(c); return { ok: true, bajados: 3 }; },
}));
jest.mock('../../services/rendicionService', () => ({ bajarRendiciones: async (c) => { mockLlam.rend.push(c); return { ok: true }; } }));
jest.mock('../../services/costosProductosService', () => ({ bajarCostosProductos: async (c) => { mockLlam.costosProd.push(c); return { ok: true }; } }));
jest.mock('../../services/productosAdminService', () => ({
  credencialesAdminProductos: async (pin) => (pin ? { ok: true, cred: { p_admin_id: 'u', p_admin_pin: pin } } : { ok: false, mensaje: 'Ingresá tu PIN' }),
}));

// eslint-disable-next-line import/first
import Panel from '../Panel';
// eslint-disable-next-line import/first
import { periodoMesEnCurso } from '../../domain/panel';

const hoy = periodoMesEnCurso().desde; // primer dia del mes en curso
const prod = (id, extra = {}) => ({ id, nombre: `Prod ${id}`, categoria: 'Golosinas', marca: 'Arcor', precio: 100, costoFinal: 60, ...extra });
let container; let root;
const render = async () => { await act(async () => { root.render(<Panel />); }); await act(async () => {}); };
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
const boton = (t) => [...container.querySelectorAll('button')].find(b => b.textContent.includes(t));
const tipear = async (el, v) => {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set;
  await act(async () => { setter.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); });
};
const setApp = (over = {}) => {
  Object.keys(mockApp).forEach(k => delete mockApp[k]);
  Object.assign(mockApp, {
    vendedorActual: { id: 1, nombre: 'Admin', permiso: 1 },
    pedidos: [{ id: 1, remoteId: 10, clienteId: 5, clienteNombre: 'Kiosco', vendedor: 'Ana', estado: 'facturado', fecha: hoy, items: [{ productoId: 1, nombre: 'Prod 1', cantidad: 10, precio: 100 }] }],
    productos: [prod(1), prod(2, { costoFinal: 0 })],
    recargar: jest.fn(async () => {}),
    ...over,
  });
};

beforeEach(() => {
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  mockLlam.costosProd = []; mockLlam.rend = []; mockLlam.costosVenta = []; mockEstado.falta015 = false; mockEstado.costosVenta = new Map();
  setApp();
});
afterEach(() => { act(() => { root.unmount(); }); container.remove(); });

describe('AC-PAN-2 Panel solo admin', () => {
  it.each([[2], [3]])('AC-PAN-2 permiso %s no ve datos ni controles', async (permiso) => {
    setApp({ vendedorActual: { id: 9, nombre: 'X', permiso } });
    await render();
    expect(container.textContent).toContain('solo para administradores');
    expect(container.querySelector('[data-testid="tarjeta-ventas"]')).toBeNull();
    expect(container.querySelector('input')).toBeNull();
  });
  it('AC-PAN-2 el admin ve tarjetas con ventas, ganancia y margen del mes en curso', async () => {
    await render();
    expect(container.querySelector('[data-testid="tarjeta-ventas"]').textContent).toContain('1.000,00');
    expect(container.querySelector('[data-testid="tarjeta-ganancia"]').textContent).toContain('400,00');
    expect(container.querySelector('[data-testid="tarjeta-margen"]').textContent).toContain('40,0 %');
    expect(container.querySelector('[data-testid="tarjeta-pedidos"]').textContent).toContain('1');
  });
});

describe('AC-PAN-3/4/5 tablas, rankings y avisos', () => {
  it('AC-PAN-3 la tabla cambia de dimensión y se ordena al tocar el encabezado', async () => {
    await render();
    expect(container.querySelector('[data-testid="tabla-rentabilidad"]').textContent).toContain('Prod 1');
    await click(boton('Vendedor'));
    expect(container.querySelector('[data-testid="tabla-rentabilidad"]').textContent).toContain('Ana');
    await click([...container.querySelectorAll('th')].find(t => t.textContent.includes('Unidades')));
    expect(container.querySelector('th').textContent).toContain('Nombre');
  });
  it('AC-PAN-4 más vendidos y sin ventas', async () => {
    await render();
    expect(container.querySelector('[data-testid="top-unidades"]').textContent).toContain('Prod 1 — 10');
    expect(container.querySelector('[data-testid="sin-ventas"]').textContent).toContain('Prod 2');
    expect(container.querySelector('svg[role="img"]')).not.toBeNull();
  });
  it('AC-PAN-5 avisa productos sin costo cargado y el costo estimado', async () => {
    await render();
    expect(container.querySelector('[data-testid="avisos-panel"]').textContent).toContain('Sin costo cargado (1)');
    expect(container.querySelector('[data-testid="aviso-estimado"]').textContent).toContain('costo estimado');
  });
});

describe('AC-PAN-1 actualizar costos con PIN', () => {
  it('AC-PAN-1 sin PIN no llama a ningún servicio', async () => {
    await render();
    await click(boton('Actualizar costos'));
    expect(mockLlam.costosProd).toHaveLength(0);
    expect(mockLlam.costosVenta).toHaveLength(0);
    expect(container.textContent).toContain('Ingresá tu PIN');
  });
  it('AC-PAN-1 con PIN baja costos de productos, rendiciones y costos de venta, y limpia el PIN', async () => {
    await render();
    const input = container.querySelector('input[aria-label="PIN de administrador"]');
    await tipear(input, '1234');
    await click(boton('Actualizar costos'));
    expect(mockLlam.costosProd).toHaveLength(1);
    expect(mockLlam.rend).toHaveLength(1);
    expect(mockLlam.costosVenta[0]).toEqual({ p_admin_id: 'u', p_admin_pin: '1234' });
    expect(container.querySelector('input[aria-label="PIN de administrador"]').value).toBe('');
    expect(container.textContent).toContain('3 pedidos');
    expect(mockApp.recargar).toHaveBeenCalled();
  });
  it('AC-PAN-1 muestra el aviso si falta la migración 015', async () => {
    mockEstado.falta015 = true;
    await render();
    expect(container.querySelector('[data-testid="aviso-015"]').textContent).toContain('015');
  });
});
