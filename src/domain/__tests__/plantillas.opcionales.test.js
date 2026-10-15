// AC-PLA-3b (decision del dueño, 2026-10-13): en la importacion de productos
// Descuento 1, Descuento 2, % Ganancia, Precio venta 2 y Minimo venta no son
// obligatorios. Vacio / espacios / "-" / "–" = vacio. Dominio + round-trip xlsx.
import * as XLSX from 'xlsx';
import {
  COLUMNAS_PLANTILLA, planificarImportacion, validarFilaProducto, filasInstrucciones,
  CAMPOS_OPCIONALES_PRODUCTO, celdaSinDato,
} from '../plantillas';
import { validarProducto } from '../productos';
import { filasDesdeLibro } from '../../services/planillaXlsx';

const LP = COLUMNAS_PLANTILLA.productos.map(c => c.label);
const fila = (obj) => LP.map(l => (obj[l] === undefined ? '' : obj[l]));
const BASE = { 'Código': 'N1', 'Descripción': 'Nuevo', 'Costo final': '100' };
const EXISTENTE = { id: 7, codigo: 'E1', nombre: 'Existente', costoFinal: 100, descuento1: 10, descuento2: 5, ganancia: 30, precio: 111.15, precioVenta2: 150, bultoX: 6, minimoVenta: 3 };

const roundTrip = (aoa) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Productos');
  return filasDesdeLibro(XLSX, XLSX.write(wb, { bookType: 'xlsx', type: 'array' })).filas;
};

describe('AC-PLA-3b campos opcionales de productos', () => {
  test('AC-PLA-3b son exactamente Descuento 1, Descuento 2, % Ganancia, Precio venta 2 y Mínimo venta', () => {
    expect([...CAMPOS_OPCIONALES_PRODUCTO]).toEqual(['descuento1', 'descuento2', 'ganancia', 'precioBulto', 'precioVenta2', 'minimoVenta', 'stockMinimo']);
    for (const v of ['', '   ', '-', ' - ', '–', '—', null, undefined]) expect(celdaSinDato(v)).toBe(true);
    for (const v of ['0', '10', '-5', 'x']) expect(celdaSinDato(v)).toBe(false);
  });

  test.each([[''], ['   '], ['-'], ['–']])('AC-PLA-3b producto NUEVO con %j en los 5 opcionales: se crea con 0 y minimo 1', (v) => {
    const rows = [LP, fila({ ...BASE, 'Descuento 1': v, 'Descuento 2': v, '% Ganancia': v, 'Precio venta 2': v, 'Mínimo venta': v })];
    const plan = planificarImportacion(rows, 'productos');
    expect(plan.entradas[0]).toMatchObject({ accion: 'crear', errores: [] });
    expect(plan.entradas[0].valor.producto).toMatchObject({ descuento1: 0, descuento2: 0, ganancia: 0, precioVenta2: 0, minimoVenta: 1, precio: 100 });
  });

  test.each([[''], ['-'], ['–'], ['  ']])('AC-PLA-3b producto EXISTENTE con %j en los opcionales: conserva sus valores', (v) => {
    const rows = [LP, fila({ 'Código': 'E1', 'Descuento 1': v, 'Descuento 2': v, '% Ganancia': v, 'Precio venta 2': v, 'Mínimo venta': v })];
    const plan = planificarImportacion(rows, 'productos', { existentes: [EXISTENTE] });
    expect(plan.entradas[0]).toMatchObject({ accion: 'actualizar', errores: [] });
    expect(plan.entradas[0].valor.producto).toMatchObject({ descuento1: 10, descuento2: 5, ganancia: 30, precioVenta2: 150, minimoVenta: 3, precio: 111.15 });
  });

  test('AC-PLA-3b "10%" se lee como 10 y minimo venta 0 se toma como 1', () => {
    const r = validarFilaProducto({ codigo: 'P', nombre: 'Pct', costoFinal: '100', descuento1: '10%', descuento2: '5 %', ganancia: '20%', minimoVenta: '0' });
    expect(r.ok).toBe(true);
    expect(r.valor.producto).toMatchObject({ descuento1: 10, descuento2: 5, ganancia: 20, minimoVenta: 1 });
    const r2 = validarFilaProducto({ codigo: 'P', nombre: 'Pct', minimoVenta: '0,0' }, { existente: EXISTENTE });
    expect(r2.valor.producto.minimoVenta).toBe(1);
  });

  test('AC-PLA-3b un "-" en un descuento no cuenta como cambio de costo: el precio del existente se conserva', () => {
    const r = validarFilaProducto({ descuento1: '-' }, { existente: EXISTENTE });
    expect(r.ok).toBe(true);
    expect(r.valor.producto.precio).toBe(111.15);
  });

  test('AC-PLA-3b no afloja el formulario manual: validarProducto sigue rechazando "-" y valores invalidos', () => {
    expect(validarProducto({ codigo: 'X', nombre: 'Y', descuento1: '-' }).ok).toBe(false);
    expect(validarProducto({ codigo: 'X', nombre: 'Y', minimoVenta: '0' }).ok).toBe(false);
    // y en la importacion un valor de verdad invalido sigue rechazando la fila
    expect(validarFilaProducto({ codigo: 'P', nombre: 'Q', descuento1: '150' }).ok).toBe(false);
    expect(validarFilaProducto({ codigo: 'P', nombre: 'Q', minimoVenta: '-3' }).ok).toBe(false);
  });

  test('AC-PLA-3b la hoja Instrucciones dice "No (vacío = 0)" / "No (vacío = 1)"', () => {
    const inst = filasInstrucciones('productos');
    const de = (label) => inst.find(f => f[0] === label);
    for (const l of ['Descuento 1', 'Descuento 2', '% Ganancia', 'Precio venta 2']) expect(de(l)[1]).toBe('No (vacío = 0)');
    expect(de('Mínimo venta')[1]).toBe('No (vacío = 1)');
  });

  test('AC-PLA-3b AC-PLA-7 round-trip xlsx: celdas vacias, "-" y "10%" en un libro real', () => {
    const rows = roundTrip([LP,
      fila({ ...BASE, 'Descuento 1': '10%', 'Descuento 2': '-', '% Ganancia': '', 'Precio venta 2': '–', 'Mínimo venta': 0 }),
      fila({ 'Código': 'E1', 'Descuento 1': '-', 'Mínimo venta': '' }),
    ]);
    const plan = planificarImportacion(rows, 'productos', { existentes: [EXISTENTE] });
    expect(plan.entradas.map(e => e.accion)).toEqual(['crear', 'actualizar']);
    expect(plan.entradas[0].valor.producto).toMatchObject({ descuento1: 10, descuento2: 0, ganancia: 0, precioVenta2: 0, minimoVenta: 1, precio: 90 });
    expect(plan.entradas[1].valor.producto).toMatchObject({ descuento1: 10, minimoVenta: 3, precio: 111.15 });
  });
});
