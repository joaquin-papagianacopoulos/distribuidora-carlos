// REQ-PBU / REQ-MIN en la tienda (AC-PBU-4, AC-MIN-1, AC-MIN-3, AC-SST-3).
import { calcularCarrito, validarRenglon, unidadesIniciales, textoPrecioBulto, minimoDe } from '../tienda';
import { conPrecioBulto, minimoRedondeado, casosPrecioBulto, catalogoBulto, catalogoMap, dosCorazones, gaseosa, alfajor } from '../__fixtures__/tiendaCasos';

describe('tienda: precio por bulto y mínimo', () => {
  it.each(casosPrecioBulto)('AC-PBU-4 %s', (_d, unidades, total) => {
    const r = calcularCarrito([{ productoId: 'p-bulto', cantidad: unidades, modo: 'unidad' }], catalogoMap(catalogoBulto), {}, '2026-10-14');
    expect(r.errores).toEqual([]);
    expect(r.total).toBe(total);
  });
  it('AC-PBU-4 oferta vigente + precio por bulto: se cobra el menor', () => {
    const prod = { ...conPrecioBulto, ofertas: [{ productoId: 'p-bulto', precio: 700, desde: '2026-10-10', hasta: '2026-10-20' }] };
    const r = calcularCarrito([{ productoId: 'p-bulto', cantidad: 16, modo: 'unidad' }], catalogoMap([prod]), {}, '2026-10-14');
    expect(r.total).toBe(11200);
  });
  it('AC-PBU-4 texto "Llevando el display: $800 c/u"', () => {
    expect(textoPrecioBulto(conPrecioBulto)).toBe('Llevando el display: $800 c/u');
    expect(textoPrecioBulto(dosCorazones)).toBeNull();
    expect(textoPrecioBulto({ ...conPrecioBulto, precioBulto: 900 })).toBeNull();
  });
  it('AC-MIN-3 mínimo efectivo en la tienda: 10 por bulto x6 => 12, arranca en 12 y 6 no pasa', () => {
    expect(minimoDe(minimoRedondeado)).toBe(12);
    expect(unidadesIniciales(minimoRedondeado)).toBe(12);
    expect(validarRenglon({ cantidad: 6, modo: 'unidad' }, minimoRedondeado).ok).toBe(false);
    expect(validarRenglon({ cantidad: 12, modo: 'unidad' }, minimoRedondeado).ok).toBe(true);
  });
  it('AC-MIN-1 mínimo común en la tienda sin cambios (gaseosa mín 2)', () => {
    expect(minimoDe(gaseosa)).toBe(2);
    expect(validarRenglon({ cantidad: 1, modo: 'unidad' }, gaseosa).ok).toBe(false);
  });
  it('AC-SST-3 la tienda sigue con su permitirSinStock propio', () => {
    expect(validarRenglon({ cantidad: 2, modo: 'unidad' }, alfajor, { permitirSinStock: false }).errores).toContain('Sin stock');
    expect(validarRenglon({ cantidad: 2, modo: 'unidad' }, alfajor, { permitirSinStock: true }).ok).toBe(true);
  });
});
