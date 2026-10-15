// REQ-ZON (AC-ZON-1, 2, 3, 4): orden de entrega por zona.
import {
  claveZona, listarZonas, clientesDeZona, moverEnZona, ordenZonaTrasCambioZona, calcularOrdenPorZona, ordenLegacy,
} from '../zonas';

const C = (id, nombre, zona, extra = {}) => ({ id, nombre, zona, ...extra });

describe('AC-ZON-4 claveZona', () => {
  it('AC-ZON-4 mayusculas, espacios y tildes son la misma zona', () => {
    const k = claveZona('Centro');
    for (const v of ['centro', '  CENTRO ', 'Céntro', 'Centro  ']) expect(claveZona(v)).toBe(k);
    expect(claveZona('Zona  Norte')).toBe(claveZona(' zona norte'));
  });
  it('AC-ZON-4 vacio, null y solo espacios => sin zona', () => {
    expect(claveZona('')).toBe('');
    expect(claveZona(null)).toBe('');
    expect(claveZona('   ')).toBe('');
  });
});

describe('AC-ZON-4 listarZonas', () => {
  it('AC-ZON-4 junta variantes, usa la mas frecuente y deja Sin zona al final', () => {
    const z = listarZonas([C(1, 'a', 'Norte'), C(2, 'b', 'norte'), C(3, 'c', 'NORTE '), C(4, 'd', ''), C(5, 'e', 'Centro'), C(6, 'f')]);
    expect(z.map(x => [x.clave, x.cantidad])).toEqual([['centro', 1], ['norte', 3], ['', 2]]);
  });
  it('AC-ZON-4 etiqueta = variante mas usada', () => {
    const z = listarZonas([C(1, 'a', 'norte'), C(2, 'b', 'Norte'), C(3, 'c', 'Norte')]);
    expect(z).toHaveLength(1);
    expect(z[0].etiqueta).toBe('Norte');
  });
});

describe('AC-ZON-3 clientesDeZona', () => {
  it('AC-ZON-3 sin ordenZona usa dia y luego orden de entrega', () => {
    const cs = [
      C(1, 'Zeta', 'Norte', { diaEntrega: 'martes', ordenEntrega: 1 }),
      C(2, 'Beta', 'Norte', { diaEntrega: 'lunes', ordenEntrega: 2 }),
      C(3, 'Alfa', 'Norte', { diaEntrega: 'lunes', ordenEntrega: 1 }),
      C(4, 'Sin dia', 'Norte'),
      C(5, 'Otra', 'Sur', { diaEntrega: 'lunes', ordenEntrega: 1 }),
    ];
    expect(clientesDeZona(cs, 'norte').map(c => c.id)).toEqual([3, 2, 1, 4]);
  });
  it('AC-ZON-3 los que tienen ordenZona van primero, empates por nombre', () => {
    const cs = [
      C(1, 'Zeta', 'Norte', { ordenZona: 2 }), C(2, 'Beta', 'Norte', { ordenZona: 2 }),
      C(3, 'Nuevo', 'Norte'), C(4, 'Alfa', 'Norte', { ordenZona: 1 }), C(5, 'Basura', 'Norte', { ordenZona: 'x' }),
    ];
    expect(clientesDeZona(cs, 'Norte').map(c => c.id)).toEqual([4, 2, 1, 5, 3]);
  });
  it('AC-ZON-3 clientes sin zona quedan en la clave vacia', () => {
    const cs = [C(1, 'a', ''), C(2, 'b'), C(3, 'c', 'Norte')];
    expect(clientesDeZona(cs, '').map(c => c.id)).toEqual([1, 2]);
  });
  it('AC-ZON-3 ordenLegacy no rompe con datos faltantes', () => {
    expect(typeof ordenLegacy({}, {})).toBe('number');
  });
});

describe('AC-ZON-1 moverEnZona', () => {
  const cs = [
    C(1, 'A', 'Norte', { ordenZona: 1 }), C(2, 'B', 'Norte', { ordenZona: 2 }),
    C(3, 'C', 'Norte', { ordenZona: 3 }), C(4, 'D', 'Norte', { ordenZona: 4 }), C(9, 'X', 'Sur', { ordenZona: 1 }),
  ];
  it('AC-ZON-1 bajar: corre a los demas y devuelve solo los cambiados', () => {
    const r = moverEnZona(cs, 'norte', 1, 3);
    expect(r).toEqual([{ id: 2, ordenZona: 1 }, { id: 3, ordenZona: 2 }, { id: 1, ordenZona: 3 }]);
  });
  it('AC-ZON-1 subir (escribir un numero menor)', () => {
    expect(moverEnZona(cs, 'Norte', 4, 2)).toEqual([{ id: 4, ordenZona: 2 }, { id: 2, ordenZona: 3 }, { id: 3, ordenZona: 4 }]);
  });
  it('AC-ZON-1 numero mayor al ultimo => al final; menor a 1 => al principio', () => {
    expect(moverEnZona(cs, 'Norte', 1, 99).map(c => c.id)).toEqual([2, 3, 4, 1]);
    expect(moverEnZona(cs, 'Norte', 3, 0).map(c => c.id)).toEqual([3, 1, 2]);
  });
  it('AC-ZON-1 mover a su propio puesto no cambia nada', () => {
    expect(moverEnZona(cs, 'Norte', 2, 2)).toEqual([]);
  });
  it('AC-ZON-1 no toca a los de otra zona; cliente o puesto invalido => nada', () => {
    expect(moverEnZona(cs, 'Norte', 9, 1)).toEqual([]);
    expect(moverEnZona(cs, 'Norte', 1, 'abc')).toEqual([]);
    expect(moverEnZona(cs, 'Norte', 99, 1)).toEqual([]);
  });
  it('AC-ZON-3 renumera sin huecos y persiste los que no tenian ordenZona', () => {
    const viejos = [C(1, 'A', 'Norte', { diaEntrega: 'lunes', ordenEntrega: 5 }), C(2, 'B', 'Norte', { diaEntrega: 'lunes', ordenEntrega: 9 }), C(3, 'C', 'Norte', { ordenZona: 7 })];
    const r = moverEnZona(viejos, 'Norte', 2, 1);
    expect(r.sort((a, b) => a.ordenZona - b.ordenZona)).toEqual([{ id: 2, ordenZona: 1 }, { id: 3, ordenZona: 2 }, { id: 1, ordenZona: 3 }]);
  });
  it('AC-ZON-3 no muta los clientes (diaEntrega/ordenEntrega se conservan)', () => {
    const c = [C(1, 'A', 'Norte', { diaEntrega: 'lunes', ordenEntrega: 5 }), C(2, 'B', 'Norte')];
    const antes = JSON.stringify(c);
    moverEnZona(c, 'Norte', 2, 1);
    expect(JSON.stringify(c)).toBe(antes);
  });
});

describe('AC-ZON-1 ordenZonaTrasCambioZona', () => {
  it('AC-ZON-1 cambio de zona => null; misma zona (aunque con otra escritura) conserva', () => {
    expect(ordenZonaTrasCambioZona({ zona: 'Norte', ordenZona: 3 }, { zona: 'Sur', ordenZona: 3 })).toBeNull();
    expect(ordenZonaTrasCambioZona({ zona: 'Norte', ordenZona: 3 }, { zona: ' norte', ordenZona: 3 })).toBe(3);
    expect(ordenZonaTrasCambioZona('Norte', 'Sur')).toBeNull();
    expect(ordenZonaTrasCambioZona({ zona: 'Norte' }, { zona: 'Norte' })).toBeNull();
  });
});

describe('AC-ZON-2 calcularOrdenPorZona', () => {
  const clientes = [
    C(1, 'Ana', 'Norte', { ordenZona: 1 }), C(2, 'Beto', 'Norte', { ordenZona: 2 }), C(3, 'Cami', 'Norte', { ordenZona: 3 }),
    C(4, 'Dani', 'Sur', { ordenZona: 1 }), C(5, 'Eli', 'sur ', { ordenZona: 2 }), C(6, 'Fede', '', {}),
  ];
  const P = (id, clienteId, clienteNombre) => ({ id, clienteId, clienteNombre, fecha: '2026-10-14' });
  it('AC-ZON-2 numera sin huecos dentro de cada zona segun quien tiene pedido', () => {
    const r = calcularOrdenPorZona([P(10, 3, 'Cami'), P(11, 1, 'Ana'), P(12, 5, 'Eli')], clientes);
    expect(r.map(z => z.etiqueta)).toEqual(['Norte', 'Sur']);
    expect(r[0].pedidos.map(x => [x.pedido.id, x.orden])).toEqual([[11, 1], [10, 2]]);
    expect(r[1].pedidos.map(x => [x.pedido.id, x.orden])).toEqual([[12, 1]]);
  });
  it('AC-ZON-2 mayusculas/espacios distintos son la misma zona', () => {
    const r = calcularOrdenPorZona([P(1, 4, 'Dani'), P(2, 5, 'Eli')], clientes);
    expect(r).toHaveLength(1);
    expect(r[0].pedidos.map(x => x.orden)).toEqual([1, 2]);
  });
  it('AC-ZON-2 sin zona o sin cliente => Sin zona al final', () => {
    const r = calcularOrdenPorZona([P(1, 6, 'Fede'), P(2, 1, 'Ana'), P(3, 999, 'Fantasma'), P(4, null, 'Mostrador')], clientes);
    expect(r.map(z => z.etiqueta)).toEqual(['Norte', 'Sin zona']);
    expect(r[1].pedidos.map(x => [x.pedido.clienteNombre, x.orden])).toEqual([['Fede', 1], ['Fantasma', 2], ['Mostrador', 3]]);
  });
  it('AC-ZON-2 filtra por las zonas elegidas', () => {
    const r = calcularOrdenPorZona([P(1, 1, 'Ana'), P(2, 4, 'Dani')], clientes, { zonas: ['sur'] });
    expect(r.map(z => z.etiqueta)).toEqual(['Sur']);
    expect(calcularOrdenPorZona([P(1, 1, 'Ana')], clientes, { zonas: [] })).toHaveLength(1);
  });
  it('AC-ZON-2 sin pedidos => vacio', () => {
    expect(calcularOrdenPorZona([], clientes)).toEqual([]);
    expect(calcularOrdenPorZona(null, null)).toEqual([]);
  });
  it('AC-ZON-3 clientes sin ordenZona respetan el orden legacy', () => {
    const viejos = [C(1, 'Zeta', 'Norte', { diaEntrega: 'lunes', ordenEntrega: 1 }), C(2, 'Alfa', 'Norte', { diaEntrega: 'lunes', ordenEntrega: 2 })];
    const r = calcularOrdenPorZona([P(1, 2, 'Alfa'), P(2, 1, 'Zeta')], viejos);
    expect(r[0].pedidos.map(x => x.pedido.clienteNombre)).toEqual(['Zeta', 'Alfa']);
  });
});
