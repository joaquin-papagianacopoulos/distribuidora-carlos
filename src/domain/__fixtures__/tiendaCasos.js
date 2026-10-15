// Casos compartidos entre el dominio (JS) y la migración 008 (SQL): la RPC
// tienda_crear_pedido replica estas reglas y el test del SQL cita estos casos.
export const dosCorazones = {
  id: 'p-dos-corazones', codigo: 'DC', nombre: 'Dos Corazones', marca: 'Dos Corazones', rubro: 'Golosinas',
  precio: 900, ventaPor: 'bulto', bultoX: 16, bultoNombre: 'Display', minimoVenta: 1, disponible: true,
};

export const gaseosa = {
  id: 'p-gaseosa', codigo: 'G1', nombre: 'Gaseosa Cola', marca: 'Cola', rubro: 'Bebidas',
  precio: 1250.5, ventaPor: 'ambos', bultoX: 6, bultoNombre: 'Pack', minimoVenta: 2, disponible: true,
};

export const alfajor = {
  id: 'p-alfajor', codigo: 'A1', nombre: 'Alfajor Triple', marca: 'Dulces', rubro: 'Golosinas',
  precio: 0.1, ventaPor: 'unidad', bultoX: null, bultoNombre: 'Bulto', minimoVenta: 1, disponible: false,
};

export const catalogoEjemplo = [dosCorazones, gaseosa, alfajor];

export const catalogoMap = (lista = catalogoEjemplo) => new Map(lista.map(p => [String(p.id), p]));

// [descripcion, lineas, totalEsperado, unidadesEsperadas]
export const casosCarrito = [
  ['Dos Corazones x1 display = 16 u. / $14.400', [{ productoId: 'p-dos-corazones', cantidad: 1, modo: 'bulto' }], 14400, 16],
  ['Dos Corazones x3 displays = 48 u. / $43.200', [{ productoId: 'p-dos-corazones', cantidad: 3, modo: 'bulto' }], 43200, 48],
  ['Dos Corazones 32 u. sueltas (múltiplo) = $28.800', [{ productoId: 'p-dos-corazones', cantidad: 32, modo: 'unidad' }], 28800, 32],
  ['Gaseosa con centavos 3 u. = $3.751,50', [{ productoId: 'p-gaseosa', cantidad: 3, modo: 'unidad' }], 3751.5, 3],
  ['Renglones repetidos se suman', [
    { productoId: 'p-gaseosa', cantidad: 2, modo: 'unidad' },
    { productoId: 'p-gaseosa', cantidad: 1, modo: 'bulto' },
  ], 10004, 8],
];

export const ofertaBorde = { productoId: 'p-dos-corazones', precio: 800, desde: '2026-10-10', hasta: '2026-10-14' };
