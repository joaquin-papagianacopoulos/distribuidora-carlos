// REQ-FRB (AC-FRB-4/5): paso de a bulto desde el bulto y boleta en bultos.
import { cantidadConPaso } from '../unidadVenta';
import { filasBoleta, columnasRenglonBoleta, SUFIJO_PRECIO_BULTO } from '../gruposFactura';
import { MAX_CANTIDAD } from '../stock';

const fragancia = { id: 'f1', nombre: 'Fragancia X', precio: 900, precioBulto: 800, bultoX: 6, ventaPor: 'ambos' };

describe('AC-FRB-4 cantidadConPaso', () => {
  test('por debajo del bulto va de a 1', () => {
    expect(cantidadConPaso(1, fragancia, 'sumar')).toBe(2);
    expect(cantidadConPaso(5, fragancia, 'sumar')).toBe(6);
  });
  test('desde el bulto suma de a bulto entero', () => {
    expect(cantidadConPaso(6, fragancia, 'sumar')).toBe(12);
    expect(cantidadConPaso(12, fragancia, 'sumar')).toBe(18);
    expect(cantidadConPaso(7, fragancia, 'sumar')).toBe(12);
  });
  test('al restar vuelve al multiplo anterior y despues de a 1', () => {
    expect(cantidadConPaso(12, fragancia, 'restar')).toBe(6);
    expect(cantidadConPaso(7, fragancia, 'restar')).toBe(6);
    expect(cantidadConPaso(6, fragancia, 'restar')).toBe(5);
    expect(cantidadConPaso(1, fragancia, 'restar')).toBe(1);
  });
  test('producto por unidad o solo bulto no cambia', () => {
    expect(cantidadConPaso(6, { ...fragancia, ventaPor: 'unidad' }, 'sumar')).toBe(7);
    expect(cantidadConPaso(6, { ...fragancia, ventaPor: 'bulto' }, 'sumar')).toBe(12);
    expect(cantidadConPaso(12, { ...fragancia, ventaPor: 'bulto' }, 'restar')).toBe(6);
    expect(cantidadConPaso(3, { id: 'x', precio: 10 }, 'sumar')).toBe(4);
  });
  test('no supera MAX_CANTIDAD', () => {
    expect(cantidadConPaso(MAX_CANTIDAD, fragancia, 'sumar')).toBe(MAX_CANTIDAD);
  });
});

describe('AC-FRB-5 boleta en bultos', () => {
  const item = (cantidad, extra = {}) => ({ productoId: 'f1', nombre: 'Fragancia X', cantidad, precio: 800, precioOriginal: 900, precioBultoOriginal: 800, precioBultoX: 6, precioPorBulto: true, ...extra });

  test('6 u. (1 bulto) sale como 1 con el precio del bulto', () => {
    const [f] = filasBoleta([item(6)]);
    expect(f.nombre).toBe(`Fragancia X (bulto x6)${SUFIJO_PRECIO_BULTO}`);
    expect(f.cantidadTexto).toBe('1');
    expect(f.precioTexto).toBe(`$${(4800).toLocaleString('es-AR')}`);
    expect(f.subtotal).toBe(4800);
  });
  test('12 u. sale como 2 bultos', () => {
    const [f] = filasBoleta([item(12)]);
    expect(f.cantidadTexto).toBe('2');
    expect(f.subtotal).toBe(9600);
  });
  test('con sueltas o bajo el bulto queda en unidades', () => {
    const [f] = filasBoleta([item(7)]);
    expect(f.cantidadTexto).toBe('7');
    expect(f.precioTexto).toBe(`$${(800).toLocaleString('es-AR')}`);
    const [g] = filasBoleta([item(3, { precio: 900, precioPorBulto: false })]);
    expect(g.cantidadTexto).toBe('3');
  });
  test('usa el bultoX congelado de REQ-VTA si no hay precio de bulto', () => {
    const r = columnasRenglonBoleta({ nombre: 'Jabon', cantidad: 24, precio: 100, bultoX: 12 }, 'Jabon');
    expect(r).toMatchObject({ nombre: 'Jabon (bulto x12)', cantidadTexto: '2', enBultos: true });
  });
  test('renglon sin bulto conocido no cambia', () => {
    const r = columnasRenglonBoleta({ nombre: 'Legacy', cantidad: 6, precio: 100 }, 'Legacy');
    expect(r.cantidadTexto).toBe('6');
    expect(r.nombre).toBe('Legacy');
  });
});
