// REQ-STB (AC-STB-2/3) y REQ-INA (AC-INA-1/2/3) en la pantalla Stock.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockApp = {};
jest.mock('../../hooks/useAppContext', () => ({ useApp: () => mockApp }));
jest.mock('../../services/stockService', () => ({ registrarIngreso: jest.fn() }));
jest.mock('../../services/comprasLocalService', () => ({
  vincularPedidoConIngreso: jest.fn(),
  agregarAlBorradorProveedor: jest.fn(),
}));
jest.mock('../../utils/pdfGen', () => ({
  generarComprobanteIngresoFile: jest.fn(),
  generarIngresosFile: jest.fn(),
}));
jest.mock('../../utils/descargarArchivo', () => ({ descargarArchivo: jest.fn() }));

import Stock from '../Stock';
import { registrarIngreso } from '../../services/stockService';
import { agregarAlBorradorProveedor, vincularPedidoConIngreso } from '../../services/comprasLocalService';
import { generarComprobanteIngresoFile, generarIngresosFile } from '../../utils/pdfGen';
import { descargarArchivo } from '../../utils/descargarArchivo';

let container;
let root;

const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
const boton = (txt) => [...container.querySelectorAll('button')].find(b => b.textContent.trim() === txt);
const botonesQueEmpiezan = (txt) => [...container.querySelectorAll('button')].filter(b => b.textContent.trim().startsWith(txt));
const setValue = async (el, value) => {
  const isSelect = el.tagName === 'SELECT';
  const proto = isSelect ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event(isSelect ? 'change' : 'input', { bubbles: true }));
  });
};
const nombresFilas = () => [...container.querySelectorAll('[data-testid="fila-stock"]')].map(f => f.querySelector('.list-item-name').textContent);
const porLabel = (txt) => container.querySelector(`[aria-label="${txt}"]`);

const PRODUCTOS = [
  { id: 1, codigo: 'DET-1', nombre: 'Detergente Limón', marca: 'Ariel', categoria: 'Limpieza', proveedorId: 'prov-1', minimoVenta: 4, bultoX: 12 },
  { id: 2, codigo: 'JAB-2', nombre: 'Jabón en polvo', marca: 'Skip', categoria: 'Limpieza', proveedorId: 'prov-2', minimoVenta: 2 },
  { id: 3, codigo: 'ALF-3', nombre: 'Alfajor Triple', marca: 'Havanna', categoria: 'Golosinas', proveedorId: 'prov-1', minimoVenta: 1, stockMinimo: 10 },
  { id: 4, codigo: 'SUE-4', nombre: 'Suelto sin proveedor', marca: '', categoria: 'Varios', minimoVenta: 1 },
];
const PROVEEDORES = [{ id: 'prov-1', codigo: 'ARC', descripcion: 'Arcor' }, { id: 'prov-2', codigo: 'UNI', descripcion: 'Unilever' }];
// 1 bajo (3 <= 4), 2 ok, 3 bajo por Stock mínimo (5 <= 10), 4 sin stock (0)
const STOCK_MAP = new Map([['1', 3], ['2', 50], ['3', 5], ['4', 0]]);

beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(mockApp, {
    productos: PRODUCTOS, proveedores: PROVEEDORES, ingresos: [], ingresosCostos: [], movimientosStock: [],
    stockMap: STOCK_MAP, vendedorActual: { id: 1, nombre: 'Admin', permiso: 1 }, recargar: jest.fn(() => Promise.resolve()),
  });
  agregarAlBorradorProveedor.mockResolvedValue({ ok: true, pedido: { id: 'ped' } });
  vincularPedidoConIngreso.mockResolvedValue({ ok: true });
  generarComprobanteIngresoFile.mockResolvedValue({ name: 'x.pdf' });
  generarIngresosFile.mockResolvedValue({ name: 'y.pdf' });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => { act(() => { root.unmount(); }); container.remove(); });

const renderStock = async (props = {}) => { await act(async () => { root.render(<Stock {...props} />); }); };

describe('AC-STB-1 / AC-STB-3 contador de stock bajo', () => {
  it('AC-STB-3 arriba de la pantalla y en la sección Reponer se ve "N productos con stock bajo"', async () => {
    await renderStock();
    expect(container.querySelector('[data-testid="contador-stock-bajo"]').textContent).toBe('3 productos con stock bajo');
    expect(boton('Reponer (3)')).toBeDefined();
  });
  it('AC-STB-1 el Stock mínimo manda sobre el Mínimo venta (5 <= 10 es bajo aunque mínimo venta sea 1)', async () => {
    await renderStock();
    await click(container.querySelector('input[type="checkbox"]'));
    expect(nombresFilas()).toEqual(['Alfajor Triple', 'Detergente Limón', 'Suelto sin proveedor']);
    expect(container.textContent).toContain('stock mín. 10');
  });
  it('AC-STB-3 sin nada bajo dice que no hay', async () => {
    mockApp.stockMap = new Map([['1', 50], ['2', 50], ['3', 50], ['4', 50]]);
    await renderStock();
    expect(container.querySelector('[data-testid="contador-stock-bajo"]').textContent).toBe('Sin productos con stock bajo');
  });
});

describe('AC-STB-2 búsqueda y filtros', () => {
  it('AC-STB-2 busca por marca, sin tildes, palabras en cualquier orden', async () => {
    await renderStock();
    await setValue(container.querySelector('input[type="search"]'), 'ARIEL limon');
    expect(nombresFilas()).toEqual(['Detergente Limón']);
    await setValue(container.querySelector('input[type="search"]'), 'polvo jabon');
    expect(nombresFilas()).toEqual(['Jabón en polvo']);
  });
  it('AC-STB-2 filtra por rubro, marca y proveedor', async () => {
    await renderStock();
    await setValue(porLabel('Filtrar por rubro'), 'Golosinas');
    expect(nombresFilas()).toEqual(['Alfajor Triple']);
    await setValue(porLabel('Filtrar por rubro'), '');
    await setValue(porLabel('Filtrar por marca'), 'Skip');
    expect(nombresFilas()).toEqual(['Jabón en polvo']);
    await setValue(porLabel('Filtrar por marca'), '');
    await setValue(porLabel('Filtrar por proveedor'), 'prov-1');
    expect(nombresFilas()).toEqual(['Alfajor Triple', 'Detergente Limón']);
  });
  it('AC-STB-2 filtra por estado sin stock / bajo / ok / negativo', async () => {
    mockApp.stockMap = new Map([['1', 3], ['2', 50], ['3', -1], ['4', 0]]);
    await renderStock();
    await setValue(porLabel('Filtrar por estado'), 'sin_stock');
    expect(nombresFilas()).toEqual(['Suelto sin proveedor']);
    await setValue(porLabel('Filtrar por estado'), 'negativo');
    expect(nombresFilas()).toEqual(['Alfajor Triple']);
    await setValue(porLabel('Filtrar por estado'), 'bajo');
    expect(nombresFilas()).toEqual(['Detergente Limón']);
    await setValue(porLabel('Filtrar por estado'), 'ok');
    expect(nombresFilas()).toEqual(['Jabón en polvo']);
  });
});

describe('AC-STB-3 Reponer: agregar al pedido al proveedor', () => {
  const irAReponer = async () => { await renderStock(); await click(boton('Reponer (3)')); };

  it('AC-STB-3 agrupa por proveedor y deja los sin proveedor sin botón', async () => {
    await irAReponer();
    const grupos = [...container.querySelectorAll('[data-testid="grupo-reponer"]')].map(g => g.querySelector('strong').textContent);
    expect(grupos).toEqual(['Arcor', 'Sin proveedor']);
    expect(botonesQueEmpiezan('Agregar al pedido al proveedor')).toHaveLength(2);
    expect(container.textContent).toContain('Asignales un proveedor');
  });
  it('AC-STB-3 por producto: agrega al borrador del proveedor la cantidad sugerida (redondeada al bulto)', async () => {
    await irAReponer();
    await click(botonesQueEmpiezan('Agregar al pedido al proveedor')[0]);
    expect(agregarAlBorradorProveedor).toHaveBeenCalledTimes(1);
    const [prov, items, opts] = agregarAlBorradorProveedor.mock.calls[0];
    expect(prov).toBe('prov-1');
    expect(items).toEqual([{ productoId: '1', cantidad: 12, unidad: 'u', bultoX: 12 }]);
    expect(opts).toEqual({ usuario: 'Admin' });
    expect(container.querySelector('[role="status"]').textContent).toContain('Agregado al pedido (borrador) de Arcor');
  });
  it('AC-STB-3 todos los de un proveedor en un solo paso', async () => {
    await irAReponer();
    await click(botonesQueEmpiezan('Agregar todos al pedido')[0]);
    const [prov, items] = agregarAlBorradorProveedor.mock.calls[0];
    expect(prov).toBe('prov-1');
    expect(items.map(i => i.productoId)).toEqual(['1', '3']);
    expect(items.map(i => i.cantidad)).toEqual([12, 5]);
  });
  it('AC-STB-3 si el servicio falla muestra el motivo', async () => {
    agregarAlBorradorProveedor.mockResolvedValueOnce({ ok: false, mensaje: 'No hay cantidades válidas para agregar' });
    await irAReponer();
    await click(botonesQueEmpiezan('Agregar al pedido al proveedor')[0]);
    expect(container.textContent).toContain('No hay cantidades válidas para agregar');
  });
  it('AC-STB-3 sin stock bajo muestra el mensaje vacío', async () => {
    mockApp.stockMap = new Map([['1', 50], ['2', 50], ['3', 50], ['4', 50]]);
    await renderStock();
    await click(boton('Reponer (0)'));
    expect(container.textContent).toContain('Todo el stock está por encima del mínimo');
  });
});

describe('AC-INA-1 / AC-INA-2 ingreso con costo y Factura A/B', () => {
  const irAIngreso = async (props) => { await renderStock(props); await click(boton('Ingreso de mercadería')); };
  const agregarProducto = async (busqueda) => {
    await setValue(container.querySelector('#ing-buscar'), busqueda);
    await click(container.querySelector('[data-testid="sugerido"]'));
  };

  it('AC-INA-1 sin tocar costos ni A/B el ingreso se registra como siempre (sin form.costos)', async () => {
    registrarIngreso.mockResolvedValueOnce({ ok: true, errores: {}, ingreso: { facturaProveedor: 'F1' }, movimientos: [{}], costos: null });
    await irAIngreso();
    await setValue(container.querySelector('#ing-factura'), 'F1');
    await setValue(container.querySelector('#ing-proveedor'), 'prov-1');
    await agregarProducto('det');
    await setValue(porLabel('Ingreso Detergente Limón'), '10');
    await click(boton('Confirmar ingreso'));
    expect(registrarIngreso.mock.calls[0][0]).toEqual({ facturaProveedor: 'F1', proveedorId: 'prov-1', items: [{ productoId: '1', ingreso: '10' }] });
    expect(container.querySelector('[data-testid="comprobante-ingreso"]')).toBeNull();
  });

  it('AC-INA-1 con costo y A/B manda form.costos con cabecera, números de factura y renglones', async () => {
    registrarIngreso.mockResolvedValueOnce({
      ok: true, errores: {}, movimientos: [{}, {}],
      ingreso: { id: 'i1', facturaProveedor: 'F2', items: [{ productoId: '1', ingreso: 10 }, { productoId: '2', ingreso: 5 }] },
      costos: { id: 'i1', tipoCabecera: 'A', renglones: [
        { productoId: '1', costoUnitario: 10, tipoFactura: 'A', unidades: 10 }, { productoId: '2', costoUnitario: 4, tipoFactura: 'B', unidades: 5 }] },
      productosActualizados: ['1'],
    });
    await irAIngreso();
    await setValue(container.querySelector('#ing-factura'), 'F2');
    await setValue(container.querySelector('#ing-proveedor'), 'prov-1');
    await setValue(container.querySelector('#ing-tipo'), 'A');
    await setValue(container.querySelector('#ing-fa'), '0001-55');
    await setValue(container.querySelector('#ing-fb'), '0002-66');
    await agregarProducto('det');
    await agregarProducto('jabon');
    await setValue(porLabel('Ingreso Detergente Limón'), '10');
    await setValue(porLabel('Ingreso Jabón en polvo'), '5');
    await setValue(porLabel('Costo unitario Detergente Limón'), '10');
    await setValue(porLabel('Costo unitario Jabón en polvo'), '4');
    await setValue(porLabel('Factura Jabón en polvo'), 'B');
    // AC-INA-2: subtotales en vivo por A y por B
    const previo = container.querySelector('[data-testid="subtotales-previo"]').textContent;
    expect(previo).toContain('Factura A: 10 u. · $100,00');
    expect(previo).toContain('Factura B: 5 u. · $20,00');
    expect(previo).toContain('Total: 15 u. · $120,00');
    await click(boton('Confirmar ingreso'));
    expect(registrarIngreso.mock.calls[0][0]).toEqual({
      facturaProveedor: 'F2', proveedorId: 'prov-1',
      items: [{ productoId: '1', ingreso: '10' }, { productoId: '2', ingreso: '5' }],
      costos: {
        tipoCabecera: 'A', facturaA: '0001-55', facturaB: '0002-66', actualizarCosto: true,
        items: [{ productoId: '1', costoUnitario: '10', tipoFactura: '' }, { productoId: '2', costoUnitario: '4', tipoFactura: 'B' }],
      },
    });
    // AC-INA-2: el comprobante muestra los subtotales y se puede bajar en PDF
    const comp = container.querySelector('[data-testid="comprobante-ingreso"]').textContent;
    expect(comp).toContain('Factura A: 10 u. · $100,00');
    expect(comp).toContain('Factura B: 5 u. · $20,00');
    expect(comp).toContain('Costo final actualizado en 1 producto(s)');
    await click(boton('Descargar comprobante (PDF)'));
    expect(generarComprobanteIngresoFile).toHaveBeenCalledTimes(1);
    expect(descargarArchivo).toHaveBeenCalledTimes(1);
  });

  it('AC-INA-4 el tilde de actualizar costo aparece con costo cargado y se puede sacar', async () => {
    registrarIngreso.mockResolvedValueOnce({ ok: true, errores: {}, ingreso: { facturaProveedor: 'F3' }, movimientos: [{}], costos: null });
    await irAIngreso();
    await agregarProducto('det');
    expect(container.textContent).not.toContain('Actualizar el costo final');
    await setValue(porLabel('Costo unitario Detergente Limón'), '9,5');
    expect(container.textContent).toContain('Actualizar el costo final de los productos');
    await click([...container.querySelectorAll('input[type="checkbox"]')].pop());
    await click(boton('Confirmar ingreso'));
    expect(registrarIngreso.mock.calls[0][0].costos.actualizarCosto).toBe(false);
  });

  it('AC-INA-1 los errores de costo vuelven por renglón (item:<id>) y no limpian el formulario', async () => {
    registrarIngreso.mockResolvedValueOnce({ ok: false, errores: { 'item:1': 'Costo inválido para "Detergente Limón"' } });
    await irAIngreso();
    await setValue(container.querySelector('#ing-factura'), 'F4');
    await agregarProducto('det');
    await setValue(porLabel('Costo unitario Detergente Limón'), '-3');
    await click(boton('Confirmar ingreso'));
    expect(container.querySelector('[data-testid="renglon-ingreso"]').textContent).toContain('Costo inválido');
    expect(container.querySelector('#ing-factura').value).toBe('F4');
  });

  it('AC-CPR-4 precarga desde un pedido recibido: proveedor y renglones listos; al confirmar vincula el pedido', async () => {
    const precarga = { proveedorId: 'prov-1', pedidoProveedorId: 'ped-9', items: [{ productoId: '1', ingreso: 24 }] };
    const usada = jest.fn();
    registrarIngreso.mockResolvedValueOnce({ ok: true, errores: {}, ingreso: { id: 'ing-7', facturaProveedor: 'F9' }, movimientos: [{}], costos: null });
    await renderStock({ precarga, onPrecargaUsada: usada });
    expect(container.querySelector('[data-testid="aviso-precarga"]')).not.toBeNull();
    expect(container.querySelector('#ing-proveedor').value).toBe('prov-1');
    expect(porLabel('Ingreso Detergente Limón').value).toBe('24');
    await setValue(container.querySelector('#ing-factura'), 'F9');
    await click(boton('Confirmar ingreso'));
    expect(registrarIngreso.mock.calls[0][0]).toMatchObject({ proveedorId: 'prov-1', items: [{ productoId: '1', ingreso: '24' }] });
    expect(vincularPedidoConIngreso).toHaveBeenCalledWith('ped-9', 'ing-7');
    expect(usada).toHaveBeenCalled();
  });
});

describe('AC-INA-3 / AC-INA-5 historial con A/B', () => {
  const ING = [
    { id: 'i1', facturaProveedor: 'F-1', proveedorId: 'prov-1', proveedorNombre: 'Arcor', fecha: '2026-10-10T15:00:00.000Z', usuario: 'Admin', items: [{ productoId: '1', codigo: 'DET-1', descripcion: 'Detergente Limón', stockActual: 0, ingreso: 10, stockTotal: 10 }, { productoId: '2', codigo: 'JAB-2', descripcion: 'Jabón en polvo', stockActual: 0, ingreso: 5, stockTotal: 5 }] },
    { id: 'i2', facturaProveedor: 'F-2', proveedorId: 'prov-2', proveedorNombre: 'Unilever', fecha: '2026-10-12T15:00:00.000Z', usuario: 'Admin', items: [{ productoId: '2', codigo: 'JAB-2', descripcion: 'Jabón en polvo', stockActual: 5, ingreso: 4, stockTotal: 9 }] },
    { id: 'i3', facturaProveedor: 'F-3', proveedorId: 'prov-1', proveedorNombre: 'Arcor', fecha: '2026-10-14T15:00:00.000Z', usuario: 'Admin', items: [{ productoId: '1', codigo: 'DET-1', descripcion: 'Detergente Limón', stockActual: 10, ingreso: 2, stockTotal: 12 }] },
  ];
  const COSTOS = [
    { id: 'i1', tipoCabecera: 'A', facturaA: 'A-1', renglones: [{ productoId: '1', costoUnitario: 10, tipoFactura: 'A', unidades: 10 }, { productoId: '2', costoUnitario: 2, tipoFactura: 'B', unidades: 5 }] },
    { id: 'i2', tipoCabecera: 'B', renglones: [{ productoId: '2', costoUnitario: 5, tipoFactura: 'B', unidades: 4 }] },
  ];
  const irAHistorial = async () => { Object.assign(mockApp, { ingresos: ING, ingresosCostos: COSTOS }); await renderStock(); await click(boton('Historial')); };
  const titulos = () => [...container.querySelectorAll('div')].filter(d => /^Fact\. F-\d/.test(d.textContent) && d.children.length === 0).map(d => d.textContent);
  const totales = () => container.querySelector('[data-testid="totales-historial"]').textContent;

  it('AC-INA-3 totales A vs B y los ingresos viejos (sin costo) se ven como "sin dato"', async () => {
    await irAHistorial();
    expect(titulos()).toEqual(['Fact. F-3 · Arcor', 'Fact. F-2 · Unilever', 'Fact. F-1 · Arcor']);
    expect(totales()).toContain('Total Factura A: 10 u. · $100,00');
    expect(totales()).toContain('Total Factura B: 9 u. · $30,00');
    expect(totales()).toContain('Sin dato: 2 u.');
    const res = [...container.querySelectorAll('[data-testid="resumen-ingreso"]')].map(e => e.textContent);
    expect(res).toContain('sin dato: 2 u.');
  });
  it('AC-INA-3 filtra por tipo A: solo los ingresos con renglones A y solo ese tipo en los totales', async () => {
    await irAHistorial();
    await setValue(porLabel('Filtrar ingresos por tipo de factura'), 'A');
    expect(titulos()).toEqual(['Fact. F-1 · Arcor']);
    expect(totales()).toContain('Total Factura B: 0 u. · $0,00');
  });
  it('AC-INA-3 filtra por proveedor y por fechas', async () => {
    await irAHistorial();
    await setValue(porLabel('Filtrar ingresos por proveedor'), 'prov-2');
    expect(titulos()).toEqual(['Fact. F-2 · Unilever']);
    await setValue(porLabel('Filtrar ingresos por proveedor'), '');
    await setValue(porLabel('Ingresos desde'), '2026-10-11');
    await setValue(porLabel('Ingresos hasta'), '2026-10-13');
    expect(titulos()).toEqual(['Fact. F-2 · Unilever']);
    await setValue(porLabel('Ingresos desde'), '2027-01-01');
    expect(container.textContent).toContain('No hay ingresos con esos filtros');
  });
  it('AC-INA-3 por producto: qué entró en A y qué en B', async () => {
    await irAHistorial();
    await setValue(porLabel('Buscar producto del historial'), 'jabon');
    await click([...container.querySelectorAll('[data-testid="historial-producto"] .list-item')][0]);
    const filas = [...container.querySelectorAll('[data-testid="fila-ingreso-producto"]')].map(f => f.textContent);
    expect(filas[0]).toContain('Factura B · +4 u.');
    expect(filas[1]).toContain('Factura B · +5 u.');
  });
  it('AC-INA-3 exporta a PDF con las filas filtradas', async () => {
    await irAHistorial();
    await setValue(porLabel('Filtrar ingresos por proveedor'), 'prov-1');
    await click(boton('Exportar a PDF'));
    expect(generarIngresosFile).toHaveBeenCalledTimes(1);
    const [filas, tot, opts] = generarIngresosFile.mock.calls[0];
    expect(filas.map(f => f.id)).toEqual(['i3', 'i1']);
    expect(tot.A.unidades).toBe(10);
    expect(opts.proveedor).toBe('Arcor');
    expect(descargarArchivo).toHaveBeenCalled();
  });
});

// REQ-NEG: compras "En negro" (sin factura).
describe('AC-NEG-1 / AC-NEG-2 ingreso en negro', () => {
  const irAIngreso = async () => { await renderStock(); await click(boton('Ingreso de mercadería')); };
  const agregarProducto = async (busqueda) => {
    await setValue(container.querySelector('#ing-buscar'), busqueda);
    await click(container.querySelector('[data-testid="sugerido"]'));
  };

  it('AC-NEG-1 AC-NEG-2 la cabecera y el renglón ofrecen "En negro", el subtotal lo separa y se manda como tipo N', async () => {
    registrarIngreso.mockResolvedValueOnce({ ok: true, errores: {}, ingreso: { facturaProveedor: 'S/F' }, movimientos: [{}, {}], costos: null });
    await irAIngreso();
    const opcionesCab = [...container.querySelector('#ing-tipo').options].map(o => [o.value, o.textContent]);
    expect(opcionesCab).toEqual(expect.arrayContaining([['A', 'Factura A'], ['B', 'Factura B'], ['N', 'En negro']]));
    await setValue(container.querySelector('#ing-factura'), 'S/F');
    await setValue(container.querySelector('#ing-proveedor'), 'prov-1');
    await setValue(container.querySelector('#ing-tipo'), 'N');
    await agregarProducto('det');
    await agregarProducto('jabon');
    expect([...porLabel('Factura Jabón en polvo').options].map(o => o.textContent)).toEqual(['Cabecera (En negro)', 'A', 'B', 'En negro']);
    await setValue(porLabel('Ingreso Detergente Limón'), '10');
    await setValue(porLabel('Ingreso Jabón en polvo'), '5');
    await setValue(porLabel('Costo unitario Detergente Limón'), '10');
    await setValue(porLabel('Costo unitario Jabón en polvo'), '4');
    await setValue(porLabel('Factura Jabón en polvo'), 'A');
    const previo = container.querySelector('[data-testid="subtotales-previo"]').textContent;
    expect(previo).toContain('En negro: 10 u. · $100,00');
    expect(previo).toContain('Factura A: 5 u. · $20,00');
    await click(boton('Confirmar ingreso'));
    expect(registrarIngreso.mock.calls[0][0].costos).toMatchObject({
      tipoCabecera: 'N',
      items: [{ productoId: '1', costoUnitario: '10', tipoFactura: '' }, { productoId: '2', costoUnitario: '4', tipoFactura: 'A' }],
    });
  });
});
