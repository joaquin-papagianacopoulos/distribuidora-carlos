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

// AC-PBU-4 / AC-MIN-3: unidad $900, llevando bulto (x16) $800.
export const conPrecioBulto = {
  id: 'p-bulto', codigo: 'PB', nombre: 'Producto con precio por bulto', marca: 'X', rubro: 'Golosinas',
  precio: 900, precioBulto: 800, ventaPor: 'ambos', bultoX: 16, bultoNombre: 'Display', minimoVenta: 1, disponible: true,
};

// AC-MIN-3: se vende por bulto (x6) y pide mínimo 10 => mínimo efectivo 12.
export const minimoRedondeado = {
  id: 'p-minimo', codigo: 'MR', nombre: 'Minimo redondeado', marca: 'X', rubro: 'Bebidas',
  precio: 100, ventaPor: 'bulto', bultoX: 6, bultoNombre: 'Caja', minimoVenta: 10, disponible: true,
};

export const catalogoEjemplo = [dosCorazones, gaseosa, alfajor];
export const catalogoBulto = [conPrecioBulto, minimoRedondeado];

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

// [descripcion, unidades, totalEsperado] sobre conPrecioBulto (modo unidad).
export const casosPrecioBulto = [
  ['10 u. (menos de un bulto) a $900 = $9.000', 10, 9000],
  ['15 u. a $900 = $13.500', 15, 13500],
  ['16 u. (1 bulto) a $800 = $12.800', 16, 12800],
  ['20 u. a $800 = $16.000', 20, 16000],
];

export const ofertaBorde = { productoId: 'p-dos-corazones', precio: 800, desde: '2026-10-10', hasta: '2026-10-14' };
