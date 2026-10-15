// Tests de la pantalla Stock (REQ-STK AC-STK-7) e Ingreso de mercadería (REQ-ING).
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockApp = {};
jest.mock('../../hooks/useAppContext', () => ({ useApp: () => mockApp }));
jest.mock('../../services/stockService', () => ({ registrarIngreso: jest.fn() }));

import Stock, { IngresoMercaderia } from '../Stock';
import { registrarIngreso } from '../../services/stockService';

let container;
let root;

const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
const boton = (txt) => [...container.querySelectorAll('button')].find(b => b.textContent.trim() === txt);
const setValue = async (el, value) => {
  const isSelect = el.tagName === 'SELECT';
  const proto = isSelect ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event(isSelect ? 'change' : 'input', { bubbles: true }));
  });
};
const filas = () => [...container.querySelectorAll('[data-testid="fila-stock"]')];
const nombresFilas = () => filas().map(f => f.querySelector('.list-item-name').textContent);

const PRODUCTOS = [
  { id: 1, codigo: 'A1', nombre: 'Alfajor Jorgito', minimoVenta: 6, bultoX: 24 },
  { id: 2, codigo: 'CC500', nombre: 'Coca Cola 500ml', minimoVenta: 1 },
  { id: 3, codigo: 'G7', nombre: 'Galletitas Óreo', minimoVenta: 2 },
];
const PROVEEDORES = [{ id: 'prov-1', codigo: 'ARC', descripcion: 'Arcor' }];
const MOVS = [
  { id: 'm1', productoId: '1', cantidad: 10, tipo: 'inicial', fecha: '2026-10-01T10:00:00Z', usuario: 'Admin', nota: 'Stock inicial' },
  { id: 'm2', productoId: '1', cantidad: -6, tipo: 'venta', fecha: '2026-10-02T10:00:00Z', usuario: 'Admin', nota: 'Kiosco' },
  { id: 'm3', productoId: '2', cantidad: 50, tipo: 'ingreso', fecha: '2026-10-03T10:00:00Z', usuario: 'Admin' },
  { id: 'm4', productoId: '3', cantidad: -2, tipo: 'venta', fecha: '2026-10-03T11:00:00Z', usuario: 'Vend' },
];
const STOCK_MAP = new Map([['1', 4], ['2', 50], ['3', -2]]);

beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(mockApp, {
    productos: PRODUCTOS,
    proveedores: PROVEEDORES,
    ingresos: [],
    movimientosStock: MOVS,
    stockMap: STOCK_MAP,
    vendedorActual: { id: 1, nombre: 'Admin', permiso: 1 },
    recargar: jest.fn(() => Promise.resolve()),
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
});

const renderStock = async () => { await act(async () => { root.render(<Stock />); }); };

describe('Stock — permisos', () => {
  it.each([[2, 'vendedor'], [3, 'armador'], [undefined, 'sin permiso definido']])(
    'AC-SEC-4 AC-ING-1 rol %s (%s) ve mensaje sin permisos y nada del stock',
    async (permiso) => {
      mockApp.vendedorActual = { id: 9, nombre: 'X', permiso };
      await renderStock();
      expect(container.textContent).toContain('No tenés permisos para ver el stock');
      expect(filas()).toHaveLength(0);
      expect(boton('Ingreso de mercadería')).toBeUndefined();
    },
  );

  it('AC-SEC-4 admin ve el listado y las secciones', async () => {
    await renderStock();
    expect(container.textContent).not.toContain('No tenés permisos');
    expect(filas()).toHaveLength(3);
    expect(boton('Ingreso de mercadería')).toBeDefined();
    expect(boton('Historial')).toBeDefined();
  });
});

describe('Stock — listado (AC-STK-7)', () => {
  it('AC-STK-7 muestra el stock de cada producto (Σ movimientos) ordenado por nombre', async () => {
    await renderStock();
    expect(nombresFilas()).toEqual(['Alfajor Jorgito', 'Coca Cola 500ml', 'Galletitas Óreo']);
    const valores = filas().map(f => f.lastElementChild.textContent);
    expect(valores[0]).toBe('4 ⚠'); // 4 <= mínimo 6
    expect(valores[1]).toBe('50');
    expect(valores[2]).toBe('-2 ⚠');
  });

  it('AC-STK-7 filtro por código o descripción (sin tildes)', async () => {
    await renderStock();
    await setValue(container.querySelector('input[type="search"]'), 'oreo');
    expect(nombresFilas()).toEqual(['Galletitas Óreo']);
    await setValue(container.querySelector('input[type="search"]'), 'cc5');
    expect(nombresFilas()).toEqual(['Coca Cola 500ml']);
  });

  it('AC-STK-7 alerta de stock bajo: el filtro "Solo stock bajo" muestra los ≤ mínimo de venta', async () => {
    await renderStock();
    expect(container.textContent).toContain('Solo stock bajo (2)');
    await click(container.querySelector('input[type="checkbox"]'));
    expect(nombresFilas()).toEqual(['Alfajor Jorgito', 'Galletitas Óreo']);
  });

  it('AC-STK-7 al tocar un producto se ven sus movimientos (más nuevo primero)', async () => {
    await renderStock();
    await click(filas()[0]);
    expect(container.textContent).toContain('Stock actual 4');
    const tipos = [...container.querySelectorAll('.list-item-name')].map(e => e.textContent);
    expect(tipos).toEqual(['venta', 'inicial']);
    expect(container.textContent).toContain('-6');
    expect(container.textContent).toContain('+10');
    await click(boton('‹ Volver'));
    expect(filas()).toHaveLength(3);
  });

  it('AC-STK-7 sin stockMap (primer arranque) no rompe y muestra 0', async () => {
    mockApp.stockMap = undefined;
    mockApp.movimientosStock = undefined;
    await renderStock();
    expect(filas()).toHaveLength(3);
    // 0 <= mínimo de venta ⇒ también marcado como bajo
    expect(filas().map(f => f.lastElementChild.textContent)).toEqual(['0 ⚠', '0 ⚠', '0 ⚠']);
  });
});

describe('Ingreso de mercadería (REQ-ING)', () => {
  const irAIngreso = async () => {
    await renderStock();
    await click(boton('Ingreso de mercadería'));
  };
  const buscar = (txt) => setValue(container.querySelector('#ing-buscar'), txt);
  const sugeridos = () => [...container.querySelectorAll('[data-testid="sugerido"]')];
  const renglones = () => [...container.querySelectorAll('[data-testid="renglon-ingreso"]')];
  const celdas = (tr) => [...tr.querySelectorAll('td')].map(td => td.textContent);

  it('AC-ING-1 sin proveedores pide cargar uno primero', async () => {
    mockApp.proveedores = [];
    await irAIngreso();
    expect(container.textContent).toContain('Primero cargá al menos un proveedor');
    expect(container.querySelector('[data-testid="ingreso-form"]')).toBeNull();
  });

  it('AC-ING-1 cabecera con Factura proveedor y Proveedor', async () => {
    await irAIngreso();
    const labels = [...container.querySelectorAll('[data-testid="ingreso-form"] label.input-label')].map(l => l.textContent);
    expect(labels).toEqual(expect.arrayContaining(['Factura proveedor *', 'Proveedor *', 'Código producto']));
    const opts = [...container.querySelector('#ing-proveedor').options].filter(o => o.value).map(o => o.textContent);
    expect(opts).toEqual(['ARC — Arcor']);
  });

  it('AC-ING-2 buscar por código completa descripción y stock actual; columnas Stock actual/Ingreso/Stock total', async () => {
    await irAIngreso();
    await buscar('a1');
    expect(sugeridos()).toHaveLength(1);
    expect(sugeridos()[0].textContent).toContain('Alfajor Jorgito');
    expect(sugeridos()[0].textContent).toContain('Stock 4');
    await click(sugeridos()[0]);
    const ths = [...container.querySelectorAll('thead th')].map(t => t.textContent).filter(Boolean);
    expect(ths).toEqual(['Código', 'Descripción', 'Stock actual', 'Ingreso', 'Stock total']);
    expect(renglones()).toHaveLength(1);
    expect(celdas(renglones()[0]).slice(0, 5)).toEqual(['A1', 'Alfajor Jorgito', '4', '', '4']);
    await setValue(container.querySelector('input[aria-label="Ingreso Alfajor Jorgito"]'), '20');
    expect(celdas(renglones()[0])[4]).toBe('24');
  });

  it('AC-ING-2 buscar por descripción (sin tildes) y Enter agrega el primero', async () => {
    await irAIngreso();
    await buscar('oreo');
    expect(sugeridos().map(s => s.querySelector('.list-item-name').textContent)).toEqual(['Galletitas Óreo']);
    const input = container.querySelector('#ing-buscar');
    await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    expect(renglones()).toHaveLength(1);
    expect(celdas(renglones()[0])[2]).toBe('-2');
    expect(container.querySelector('#ing-buscar').value).toBe('');
  });

  it('AC-ING-2 el código exacto aparece primero en las sugerencias', async () => {
    mockApp.productos = [...PRODUCTOS, { id: 4, codigo: 'A10', nombre: 'Aceite' }, { id: 5, codigo: 'XA1', nombre: 'Arroz' }];
    await irAIngreso();
    await buscar('A1');
    expect(sugeridos()[0].textContent).toContain('Alfajor Jorgito');
  });

  it('AC-ING-3 el mismo producto no se agrega dos veces al comprobante', async () => {
    await irAIngreso();
    await buscar('a1');
    await click(sugeridos()[0]);
    await buscar('a1');
    await click(sugeridos()[0]);
    expect(renglones()).toHaveLength(1);
  });

  it('AC-ING-3 se puede quitar un renglón', async () => {
    await irAIngreso();
    await buscar('a1');
    await click(sugeridos()[0]);
    await click(container.querySelector('button[aria-label="Quitar"]'));
    expect(renglones()).toHaveLength(0);
  });

  it('AC-ING-5 confirmar llama a registrarIngreso con cabecera + renglones y recarga', async () => {
    registrarIngreso.mockResolvedValueOnce({
      ok: true, errores: {}, ingreso: { facturaProveedor: 'A-0001-123' }, movimientos: [{}, {}],
    });
    await irAIngreso();
    await setValue(container.querySelector('#ing-factura'), 'A-0001-123');
    await setValue(container.querySelector('#ing-proveedor'), 'prov-1');
    await buscar('a1');
    await click(sugeridos()[0]);
    await buscar('coca');
    await click(sugeridos()[0]);
    await setValue(container.querySelector('input[aria-label="Ingreso Alfajor Jorgito"]'), '20');
    await setValue(container.querySelector('input[aria-label="Ingreso Coca Cola 500ml"]'), '12');
    await click(boton('Confirmar ingreso'));
    expect(registrarIngreso).toHaveBeenCalledWith(
      { facturaProveedor: 'A-0001-123', proveedorId: 'prov-1', items: [{ productoId: '1', ingreso: '20' }, { productoId: '2', ingreso: '12' }] },
      { productos: PRODUCTOS, usuario: 'Admin' },
    );
    expect(container.querySelector('[role="status"]').textContent).toContain('Ingreso registrado: 2 producto(s), factura A-0001-123');
    expect(mockApp.recargar).toHaveBeenCalled();
    expect(renglones()).toHaveLength(0);
    expect(container.querySelector('#ing-factura').value).toBe('');
  });

  it('AC-ING-4 muestra los errores devueltos por registrarIngreso (cabecera y renglón) y no limpia', async () => {
    registrarIngreso.mockResolvedValueOnce({
      ok: false,
      errores: { facturaProveedor: 'Esa factura de ese proveedor ya fue ingresada', 'item:1': 'Ingreso inválido para "Alfajor Jorgito" (entero > 0)' },
    });
    await irAIngreso();
    await setValue(container.querySelector('#ing-factura'), 'F1');
    await buscar('a1');
    await click(sugeridos()[0]);
    await click(boton('Confirmar ingreso'));
    const alerts = [...container.querySelectorAll('[role="alert"]')].map(a => a.textContent);
    expect(alerts).toEqual(expect.arrayContaining([
      'Esa factura de ese proveedor ya fue ingresada',
      'Ingreso inválido para "Alfajor Jorgito" (entero > 0)',
    ]));
    expect(mockApp.recargar).not.toHaveBeenCalled();
    expect(renglones()).toHaveLength(1);
    expect(container.querySelector('#ing-factura').value).toBe('F1');
  });

  // Antes BUG B5 (errores por índice que "saltaban" de renglón). Corregido en
  // 082c552: los errores son `item:<productoId>` y se borran al quitar.
  it('AC-ING-3 al quitar un renglón con error, el error no se muda a otro renglón', async () => {
    registrarIngreso.mockResolvedValueOnce({ ok: false, errores: { 'item:1': 'Ingreso inválido para "Alfajor Jorgito" (entero > 0)' } });
    await irAIngreso();
    await buscar('a1');
    await click(sugeridos()[0]);
    await buscar('coca');
    await click(sugeridos()[0]);
    await click(boton('Confirmar ingreso'));
    await click(renglones()[0].querySelector('button[aria-label="Quitar"]'));
    expect(renglones()).toHaveLength(1);
    expect(renglones()[0].textContent).not.toContain('Alfajor');
  });

  it('AC-ING-3 el error de un renglón sigue a su producto aunque se quite otro renglón anterior', async () => {
    registrarIngreso.mockResolvedValueOnce({ ok: false, errores: { 'item:2': 'Ingreso inválido para "Coca Cola 500ml" (entero > 0)' } });
    await irAIngreso();
    await buscar('a1');
    await click(sugeridos()[0]);
    await buscar('coca');
    await click(sugeridos()[0]);
    await click(boton('Confirmar ingreso'));
    expect(renglones()[1].textContent).toContain('Ingreso inválido para "Coca Cola 500ml"');
    await click(renglones()[0].querySelector('button[aria-label="Quitar"]'));
    expect(renglones()).toHaveLength(1);
    expect(renglones()[0].textContent).toContain('Ingreso inválido para "Coca Cola 500ml"');
  });

  it('AC-ING-3 error de "items" (comprobante vacío) se muestra', async () => {
    registrarIngreso.mockResolvedValueOnce({ ok: false, errores: { items: 'Agregá al menos un producto', proveedorId: 'Elegí el proveedor' } });
    await irAIngreso();
    await click(boton('Confirmar ingreso'));
    expect(container.textContent).toContain('Agregá al menos un producto');
    expect(container.textContent).toContain('Elegí el proveedor');
  });

  it('AC-ING-5 si registrarIngreso tira excepción se muestra como error general y se rehabilita el botón', async () => {
    registrarIngreso.mockRejectedValueOnce(new Error('ConstraintError: Key already exists'));
    await irAIngreso();
    await click(boton('Confirmar ingreso'));
    expect(container.textContent).toContain('ConstraintError: Key already exists');
    expect(boton('Confirmar ingreso').disabled).toBe(false);
  });

  it('AC-ING-1 IngresoMercaderia se puede montar suelto (export nombrado)', async () => {
    await act(async () => {
      root.render(<IngresoMercaderia productos={PRODUCTOS} proveedores={PROVEEDORES} stockMap={STOCK_MAP} usuario="Admin" />);
    });
    expect(container.querySelector('[data-testid="ingreso-form"]')).not.toBeNull();
  });
});

describe('Historial de ingresos', () => {
  it('AC-ING-6 lista los ingresos (más nuevo primero) y despliega los renglones', async () => {
    mockApp.ingresos = [
      { id: 'i1', facturaProveedor: 'F-1', proveedorNombre: 'Arcor', fecha: '2026-10-01T10:00:00Z', usuario: 'Admin', items: [{ productoId: '1', codigo: 'A1', descripcion: 'Alfajor Jorgito', stockActual: 0, ingreso: 10, stockTotal: 10 }] },
      { id: 'i2', facturaProveedor: 'F-2', proveedorNombre: 'Arcor', fecha: '2026-10-05T10:00:00Z', usuario: 'Admin', items: [] },
    ];
    await renderStock();
    await click(boton('Historial'));
    const titulos = [...container.querySelectorAll('div')].filter(d => /^Fact\. F-\d/.test(d.textContent) && d.children.length === 0).map(d => d.textContent);
    expect(titulos).toEqual(['Fact. F-2 · Arcor', 'Fact. F-1 · Arcor']);
    const cab = [...container.querySelectorAll('div')].find(d => d.textContent.startsWith('Fact. F-1') && d.style.cursor === 'pointer');
    await click(cab);
    expect(container.textContent).toContain('+10');
    expect(container.textContent).toContain('Alfajor Jorgito');
  });

  it('AC-ING-6 sin ingresos muestra mensaje vacío', async () => {
    await renderStock();
    await click(boton('Historial'));
    expect(container.textContent).toContain('Todavía no hay ingresos');
  });
});

describe('Stock — negativo (REQ-SST)', () => {
  it('AC-SST-2 el stock negativo se muestra en rojo', () => {
    // jsdom descarta color:var(--danger); el HTML estático conserva el estilo tal cual.
    const { renderToStaticMarkup } = require('react-dom/server');
    const html = renderToStaticMarkup(<Stock />);
    expect(html).toContain('color:var(--danger)">-2');
  });
});
