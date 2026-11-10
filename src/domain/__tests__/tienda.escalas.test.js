// AC-ESC-3: la tienda aplica la misma regla de escalas que el servidor (mismo fixture).
import { calcularCarrito, precioUnitarioTienda, textoEscalasTienda, compararConServidor } from '../tienda';
import { CASOS_ESCALAS } from '../__fixtures__/escalasCasos';

const prodDe = (c) => ({
  id: 1, nombre: 'P', precio: c.precio, precioBulto: c.precioBulto > 0 && c.precioBulto < c.precio ? c.precioBulto : null,
  bultoX: c.bultoX > 1 ? c.bultoX : null, escalasBulto: c.escalas, ventaPor: 'unidad', minimoVenta: 1, disponible: true, ofertas: [],
});

describe('AC-ESC-3 tienda = fixture compartido', () => {
  const casos = CASOS_ESCALAS.filter(c => Number.isInteger(c.cantidad));
  it.each(casos.map(c => [c.id, c]))('AC-ESC-3 carrito %s', (_n, c) => {
    const prod = prodDe(c);
    const cat = new Map([['1', prod]]);
    const r = calcularCarrito([{ productoId: 1, cantidad: c.cantidad, modo: 'unidad' }], cat, {}, '2026-11-10');
    // precioBulto no menor al precio: el servidor lo ignora igual (tienda_precio_aplicado usa least)
    expect(r.errores).toEqual([]);
    expect(r.renglones[0].precio).toBe(c.esperado);
  });
  it('AC-ESC-3 precioUnitarioTienda coincide con el carrito', () => {
    const c = CASOS_ESCALAS.find(x => x.id === 'escala-mas-alta');
    expect(precioUnitarioTienda(prodDe(c), c.cantidad)).toBe(c.esperado);
  });
  it('AC-ESC-3 si el cliente vio el precio sin escala el servidor devuelve cambio', () => {
    const c = CASOS_ESCALAS.find(x => x.id === 'borde-5-bultos-si');
    const r = calcularCarrito([{ productoId: 1, cantidad: c.cantidad, modo: 'unidad' }], new Map([['1', prodDe(c)]]), {}, '2026-11-10');
    const visto = { renglones: [{ productoId: 1, precio: 1000, unidades: c.cantidad }] };
    expect(compararConServidor(visto, r).cambio).toBe(true);
  });
});

describe('AC-ESC-3 textoEscalasTienda', () => {
  it('AC-ESC-3 "Llevando 5 displays: 8 % menos"', () => {
    const t = textoEscalasTienda({ bultoX: 10, bultoNombre: 'Display', escalasBulto: [{ desde: 5, pct: 8 }, { desde: 10, pct: 7.5 }] });
    expect(t).toBe('Llevando 5 displays: 8 % menos · Llevando 10 displays: 7,5 % menos');
  });
  it('AC-ESC-3 sin escalas o sin bulto no hay texto', () => {
    expect(textoEscalasTienda({ bultoX: 10, escalasBulto: [] })).toBeNull();
    expect(textoEscalasTienda({ bultoX: 1, escalasBulto: [{ desde: 5, pct: 8 }] })).toBeNull();
    expect(textoEscalasTienda(null)).toBeNull();
  });
});
