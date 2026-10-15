// QA REQ-PBU / REQ-MIN / REQ-HPR: bordes y paridad cliente/servidor (tienda).
import { precioAplicado, cambioDePrecio, resumirCambiosPrecio } from '../precios';
import { minimoEfectivo, validarMinimosItems, puedeGuardarBajoMinimo } from '../minimos';
import { calcularCarrito } from '../tienda';
import { conPrecioBulto, catalogoBulto, catalogoMap } from '../__fixtures__/tiendaCasos';

describe('QA paridad cliente/tienda', () => {
  it.each([1, 2, 10, 15, 16, 17, 20, 32, 100])('AC-PBU-4 tienda == precioAplicado con %s u.', (u) => {
    const r = calcularCarrito([{ productoId: 'p-bulto', cantidad: u, modo: 'unidad' }], catalogoMap(catalogoBulto), {}, '2026-10-14');
    expect(r.total).toBeCloseTo(precioAplicado(conPrecioBulto, u).precio * u, 2);
  });
  it('AC-PBU-4 precio manipulado en el carrito no pasa', () => {
    const r = calcularCarrito([{ productoId: 'p-bulto', cantidad: 16, modo: 'unidad', precio: 1 }], catalogoMap(catalogoBulto), {}, '2026-10-14');
    expect(r.total).toBe(12800);
  });
});

describe('QA minimos bordes', () => {
  it.each([
    [null, 1], [undefined, 1], ['', 1], [0, 1], [1, 1], [-5, 1], ['abc', 1], [5, 5],
  ])('AC-MIN-1 minimoVenta %p -> %p', (m, esp) => {
    expect(minimoEfectivo({ minimoVenta: m, bultoX: 6, ventaPor: 'unidad' })).toBe(esp);
  });
  it('AC-MIN-3 mínimo ya múltiplo no cambia; 13 con bulto x6 -> 18', () => {
    expect(minimoEfectivo({ minimoVenta: 12, bultoX: 6, ventaPor: 'bulto' })).toBe(12);
    expect(minimoEfectivo({ minimoVenta: 13, bultoX: 6, ventaPor: 'bulto' })).toBe(18);
  });
  it('AC-MIN-3 ventaPor bulto con bultoX inválido no explota', () => {
    expect(minimoEfectivo({ minimoVenta: 10, bultoX: 0, ventaPor: 'bulto' })).toBe(10);
    expect(minimoEfectivo(null)).toBe(1);
  });
  it('AC-MIN-2 armador y vendedor nunca confirman; admin solo en facturación', () => {
    expect(puedeGuardarBajoMinimo(3, 'facturacion')).toBe('no');
    expect(puedeGuardarBajoMinimo(2, 'facturacion')).toBe('no');
    expect(puedeGuardarBajoMinimo(1, 'pedido')).toBe('no');
    expect(puedeGuardarBajoMinimo(1, 'facturacion')).toBe('confirmar');
  });
  it('AC-MIN-1 renglón eliminado y cantidad decimal bajo mínimo', () => {
    const m = new Map([['1', { id: 1, nombre: 'A', minimoVenta: 5 }]]);
    expect(validarMinimosItems([{ productoId: 1, cantidad: 1, eliminado: true }], m, { permiso: 2, pantalla: 'pedido' }).errores).toEqual([]);
    expect(validarMinimosItems([{ productoId: 1, cantidad: 4.5 }], m, { permiso: 2, pantalla: 'pedido' }).errores).toHaveLength(1);
  });
});

describe('QA cambioDePrecio / resumen', () => {
  const ahora = new Date('2026-10-15T12:00:00Z');
  const base = { id: 1, codigo: 'A', nombre: 'A', categoria: 'Golosinas' };
  it('AC-HPR-1 mismo valor con distinto formato (900 vs "900.00") no registra', () => {
    expect(cambioDePrecio({ ...base, precio: 900, precioBulto: 800 }, { ...base, precio: '900.00', precioBulto: '800' }, { now: ahora })).toBeNull();
  });
  it('AC-HPR-1 solo cambia precioBulto registra', () => {
    const c = cambioDePrecio({ ...base, precio: 900, precioBulto: 800 }, { ...base, precio: 900, precioBulto: 750 }, { now: ahora });
    expect(c).toMatchObject({ precioAnterior: 900, precioNuevo: 900, precioBultoAnterior: 800, precioBultoNuevo: 750 });
  });
  it('AC-HPR-1 nuevo null/undefined no explota; alta en 0 no registra', () => {
    expect(cambioDePrecio(null, null)).toBeNull();
    expect(cambioDePrecio(undefined, undefined)).toBeNull();
    expect(cambioDePrecio(null, { ...base, precio: 0 }, { now: ahora })).toBeNull();
  });
  it('AC-HPR-1 fecha cerca de medianoche usa día argentino', () => {
    const c = cambioDePrecio({ ...base, precio: 1 }, { ...base, precio: 2 }, { now: new Date('2026-10-15T02:30:00Z') });
    expect(c.fecha).toBe('2026-10-14');
  });
  it('AC-HPR-2 anterior 0 -> variación null, no Infinity/NaN', () => {
    const f = resumirCambiosPrecio([{ productoId: '1', precioAnterior: 0, precioNuevo: 10, precioBultoNuevo: 0, fecha: '2026-10-15', creadoEn: 'a' }]);
    expect(f[0].variacionPct).toBeNull();
  });
  it('AC-HPR-2 varios cambios: primero anterior, último nuevo, rango excluye otros días', () => {
    const mk = (id, ant, nue, creadoEn, fecha = '2026-10-15') => ({ id, productoId: '1', precioAnterior: ant, precioNuevo: nue, precioBultoAnterior: 0, precioBultoNuevo: 0, fecha, creadoEn });
    const f = resumirCambiosPrecio([mk('b', 110, 120, '2'), mk('a', 100, 110, '1'), mk('z', 1, 2, '0', '2026-10-01')], { desde: '2026-10-15', hasta: '2026-10-15' });
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ precioAnterior: 100, precioNuevo: 120, variacionPct: 20 });
  });
  it('AC-HPR-2 entrada inválida', () => {
    expect(resumirCambiosPrecio(null)).toEqual([]);
    expect(resumirCambiosPrecio([null, 5])).toEqual([]);
  });
});
