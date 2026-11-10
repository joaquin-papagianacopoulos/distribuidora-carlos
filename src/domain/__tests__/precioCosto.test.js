// REQ-PVC (AC-PVC-1..5): el precio de venta nunca queda igual al costo por omisión.
import { gananciaConocida, precioEsCalculado, debeRecalcularPrecio, autocompletarPrecio, productosConPrecioSospechoso } from '../precioCosto';
import { validarProducto } from '../productos';
import { COLUMNAS_PLANTILLA, planificarImportacion, filasInstrucciones, validarFilaProducto } from '../plantillas';

const LP = COLUMNAS_PLANTILLA.productos.map(c => c.label);
const fila = (obj) => LP.map(l => (obj[l] === undefined ? '' : obj[l]));
const EXISTENTE = { id: 7, codigo: 'E1', nombre: 'Existente', costoFinal: 1000, descuento1: 0, descuento2: 0, ganancia: 30, precio: 1300, bultoX: 1, minimoVenta: 1 };

describe('AC-PVC-1 importar sin precio conserva el existente', () => {
  test('AC-PVC-1 caso A: costo nuevo con precio y ganancia vacíos conserva el precio actual', () => {
    const ex = { ...EXISTENTE, ganancia: 0, precio: 1500 };
    const plan = planificarImportacion([LP, fila({ 'Código': 'E1', 'Costo final': 1200 })], 'productos', { existentes: [ex] });
    expect(plan.entradas[0].accion).toBe('actualizar');
    expect(plan.entradas[0].valor.producto.precio).toBe(1500);
  });
  test('AC-PVC-1 caso B: con ganancia > 0 y precio que era el calculado se recalcula', () => {
    const plan = planificarImportacion([LP, fila({ 'Código': 'E1', 'Costo final': 2000 })], 'productos', { existentes: [EXISTENTE] });
    expect(plan.entradas[0].valor.producto.precio).toBe(2600);
  });
  test('AC-PVC-1 caso C: con ganancia > 0 pero precio puesto a mano distinto del calculado se conserva', () => {
    const ex = { ...EXISTENTE, precio: 1777 };
    const plan = planificarImportacion([LP, fila({ 'Código': 'E1', 'Costo final': 2000 })], 'productos', { existentes: [ex] });
    expect(plan.entradas[0].valor.producto.precio).toBe(1777);
  });
  test('AC-PVC-1 caso D: existente con costos desconocidos (undefined) no se recalcula', () => {
    const ex = { id: 9, codigo: 'E9', nombre: 'Sin costos', precio: 800 };
    const plan = planificarImportacion([LP, fila({ 'Código': 'E9', 'Costo final': 500 })], 'productos', { existentes: [ex] });
    expect(plan.entradas[0].accion).toBe('actualizar');
    expect(plan.entradas[0].valor.producto.precio).toBe(800);
  });
  test('AC-PVC-1 debeRecalcularPrecio: reglas', () => {
    expect(debeRecalcularPrecio(EXISTENTE, { ganancia: '30' })).toBe(true);
    expect(debeRecalcularPrecio(EXISTENTE, { ganancia: '0' })).toBe(false);
    expect(debeRecalcularPrecio(EXISTENTE, { ganancia: '' })).toBe(false);
    expect(debeRecalcularPrecio({ ...EXISTENTE, precio: 0 }, { ganancia: '10' })).toBe(true);
    expect(debeRecalcularPrecio({ ...EXISTENTE, precio: 1 }, { ganancia: '10' })).toBe(false);
  });
  test('AC-PVC-1 gananciaConocida / precioEsCalculado', () => {
    expect(gananciaConocida({ ganancia: 0 })).toBe(true);
    expect(gananciaConocida({})).toBe(false);
    expect(gananciaConocida({ ganancia: '' })).toBe(false);
    expect(precioEsCalculado(EXISTENTE)).toBe(true);
    expect(precioEsCalculado({ ...EXISTENTE, costoFinal: undefined })).toBe(false);
  });
});

describe('AC-PVC-2 sin precio ni ganancia con costo es error', () => {
  test('AC-PVC-2 validarProducto: error en el campo precio y no guarda el costo como precio', () => {
    const r = validarProducto({ codigo: 'A', nombre: 'A', costoFinal: '100', precio: '', ganancia: '' });
    expect(r.ok).toBe(false);
    expect(r.errores.precio).toBe('Falta el precio de venta o el % de ganancia');
    expect(validarProducto({ codigo: 'A', nombre: 'A', costoFinal: '100', ganancia: '0' }).errores.precio).toBeTruthy();
  });
  test('AC-PVC-2 con ganancia > 0 se calcula; sin costo no hay error', () => {
    expect(validarProducto({ codigo: 'A', nombre: 'A', costoFinal: '100', ganancia: '20' }).producto.precio).toBe(120);
    expect(validarProducto({ codigo: 'A', nombre: 'A' }).errores.precio).toBeUndefined();
  });
  test('AC-PVC-2 precio manual igual al costo se acepta con aviso', () => {
    const r = validarProducto({ codigo: 'A', nombre: 'A', costoFinal: '100', precio: '100' });
    expect(r.ok).toBe(true);
    expect(r.avisos.precio).toMatch(/igual al costo/);
  });
  test('AC-PVC-2 alta por planilla con costo y sin precio ni ganancia se rechaza', () => {
    const plan = planificarImportacion([LP, fila({ 'Código': 'N1', 'Descripción': 'Nuevo', 'Costo final': 100 })], 'productos');
    expect(plan.entradas[0].accion).toBe('rechazar');
    expect(plan.entradas[0].errores.join(' ')).toMatch(/Falta el precio de venta o el % de ganancia/);
  });
  test('AC-PVC-2 la fila propaga avisos (precio = costo)', () => {
    const r = validarFilaProducto({ codigo: 'N1', nombre: 'Nuevo', costoFinal: '100', precio: '100' });
    expect(r.ok).toBe(true);
    expect(r.avisos).toHaveLength(1);
  });
});

describe('AC-PVC-3 autocompletar precio', () => {
  test('AC-PVC-3 sin ganancia > 0 no autocompleta', () => {
    expect(autocompletarPrecio({ costoFinal: '1000', ganancia: '' }, {})).toBeNull();
    expect(autocompletarPrecio({ costoFinal: '1000', ganancia: '0' }, {})).toBeNull();
  });
  test('AC-PVC-3 con ganancia > 0 autocompleta salvo precio manual o ganancia desconocida', () => {
    expect(autocompletarPrecio({ costoFinal: '1000', ganancia: '10' }, {})).toBe('1100');
    expect(autocompletarPrecio({ costoFinal: '1000', ganancia: '10' }, { precioManual: true })).toBeNull();
    expect(autocompletarPrecio({ costoFinal: '1000', ganancia: '10' }, { gananciaDesconocida: true })).toBeNull();
  });
});

describe('AC-PVC-4 productosConPrecioSospechoso', () => {
  test('AC-PVC-4 precio <= costo neto con costo > 0; saltea costos desconocidos y costo 0', () => {
    const lista = [
      { id: 1, codigo: 'A', nombre: 'a', costoFinal: 100, precio: 100 },
      { id: 2, codigo: 'B', nombre: 'b', costoFinal: 100, precio: 90 },
      { id: 3, codigo: 'C', nombre: 'c', costoFinal: 100, precio: 150 },
      { id: 4, codigo: 'D', nombre: 'd', precio: 5 },
      { id: 5, codigo: 'E', nombre: 'e', costoFinal: 0, precio: 0 },
      { id: 6, codigo: 'F', nombre: 'f', costoFinal: 200, descuento1: 50, precio: 100 },
    ];
    expect(productosConPrecioSospechoso(lista).map(x => x.id)).toEqual([1, 2, 6]);
    expect(productosConPrecioSospechoso(null)).toEqual([]);
  });
});

describe('AC-PVC-5 texto de ayuda', () => {
  test('AC-PVC-5 la hoja de instrucciones aclara que sin precio ni ganancia se rechaza', () => {
    const txt = JSON.stringify(filasInstrucciones('productos'));
    expect(txt).toMatch(/nunca se guarda el costo como precio/);
    expect(txt).not.toMatch(/Si queda vacío se calcula: costo/);
  });
});
