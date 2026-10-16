import { sugerenciasCarrito, porcentajeOff } from '../tienda';

const P = (id, rubro, extra = {}) => ({ id, nombre: `Prod ${id}`, rubro, marca: '', precio: 100, disponible: true, ...extra });

const catalogo = [
  P(1, 'Golosinas', { marca: 'Arcor' }),
  P(2, 'Golosinas', { marca: 'Arcor' }),
  P(3, 'Golosinas', { marca: 'Felfort', precio: 80, precioAnterior: 100 }),
  P(4, 'Golosinas', { disponible: false }),
  P(5, 'Bebidas'),
  P(6, 'Bebidas'),
  P(7, 'Limpieza'),
  P(8, 'golosinas ', { nombre: 'Alfajor' }),
];

describe('TIE-SUG sugerencias del carrito (mismo rubro, no elegidos)', () => {
  test('solo trae productos de los rubros del carrito que no están en el carrito', () => {
    const s = sugerenciasCarrito([{ productoId: '1' }], catalogo);
    const ids = s.map(p => p.id);
    expect(ids).not.toContain(1);
    expect(ids).not.toContain(5);
    expect(ids).not.toContain(7);
    expect(ids.sort()).toEqual([2, 3, 8]);
  });

  test('ofertas primero, después la marca que ya compra, después por nombre', () => {
    const s = sugerenciasCarrito([{ productoId: '1' }], catalogo);
    expect(s.map(p => p.id)).toEqual([3, 2, 8]);
  });

  test('sin stock queda afuera salvo que la tienda permita pedir sin stock', () => {
    expect(sugerenciasCarrito([{ productoId: '1' }], catalogo).map(p => p.id)).not.toContain(4);
    expect(sugerenciasCarrito([{ productoId: '1' }], catalogo, { permitirSinStock: true }).map(p => p.id)).toContain(4);
  });

  test('reparte por turnos entre rubros y respeta el máximo', () => {
    const s = sugerenciasCarrito([{ productoId: '1' }, { productoId: '2' }, { productoId: '5' }], catalogo, { max: 3 });
    expect(s.map(p => p.rubro.trim().toLowerCase())).toEqual(['golosinas', 'bebidas', 'golosinas']);
    expect(s).toHaveLength(3);
  });

  test('carrito vacío, ids desconocidos, productos sin rubro o entradas inválidas devuelven lista vacía', () => {
    expect(sugerenciasCarrito([], catalogo)).toEqual([]);
    expect(sugerenciasCarrito([{ productoId: '999' }], catalogo)).toEqual([]);
    expect(sugerenciasCarrito([{ productoId: 'x' }], [{ id: 'x', nombre: 'Sin rubro' }])).toEqual([]);
    expect(sugerenciasCarrito(null, null)).toEqual([]);
    expect(sugerenciasCarrito([{ productoId: '1' }], catalogo, { max: 0 })).toEqual([]);
  });
});

describe('TIE-SUG porcentajeOff', () => {
  test('calcula el descuento entero solo con oferta real', () => {
    expect(porcentajeOff({ precio: 80, precioAnterior: 100 })).toBe(20);
    expect(porcentajeOff({ precio: 100, precioAnterior: 100 })).toBeNull();
    expect(porcentajeOff({ precio: 120, precioAnterior: 100 })).toBeNull();
    expect(porcentajeOff({ precio: 100 })).toBeNull();
    expect(porcentajeOff({ precio: 0.5, precioAnterior: 1000 })).toBe(99);
    expect(porcentajeOff(null)).toBeNull();
  });
});
