// REQ-RUT (Lote 2026-11-16): la ruta de entrega armada a mano. Lógica pura.
import {
  MAX_RUTA, normalizarRuta, rutaVigente, pedidosDeRuta, agregarARuta, agregarVariosARuta, quitarDeRuta,
  moverEnRuta, moverAPuesto, subirEnRuta, bajarEnRuta, invertirRuta, ordenarRutaPorZona, grupoDeRuta,
  enlaceMapa, claveAlmacenRuta, leerRutaGuardada, serializarRuta,
} from '../ruta';

describe('AC-RUT-1 la ruta es una lista de pedidos en el orden elegido', () => {
  it('normaliza: sin repetidos, sin basura y con tope', () => {
    expect(normalizarRuta(['l:1', 'l:2', 'l:1', '', null, 5, 'r:9'])).toEqual(['l:1', 'l:2', 'r:9']);
    expect(normalizarRuta(null)).toEqual([]);
    expect(normalizarRuta('hola')).toEqual([]);
    expect(normalizarRuta(Array.from({ length: MAX_RUTA + 50 }, (_, i) => `l:${i}`))).toHaveLength(MAX_RUTA);
  });

  it('agregar suma al final y no repite', () => {
    expect(agregarARuta(['l:1'], 'l:2')).toEqual(['l:1', 'l:2']);
    expect(agregarARuta(['l:1'], 'l:1')).toEqual(['l:1']);
    expect(agregarARuta(['l:1'], '')).toEqual(['l:1']);
    expect(agregarVariosARuta(['l:1'], ['l:3', 'l:1', 'l:2'])).toEqual(['l:1', 'l:3', 'l:2']);
  });

  it('quitar saca solo ese pedido', () => {
    expect(quitarDeRuta(['l:1', 'l:2', 'l:3'], 'l:2')).toEqual(['l:1', 'l:3']);
    expect(quitarDeRuta(['l:1'], 'l:9')).toEqual(['l:1']);
  });

  it('no muta lo que recibe', () => {
    const r = Object.freeze(['l:1', 'l:2', 'l:3']);
    expect(() => { moverEnRuta(r, 0, 2); subirEnRuta(r, 'l:3'); invertirRuta(r); quitarDeRuta(r, 'l:1'); }).not.toThrow();
    expect(r).toEqual(['l:1', 'l:2', 'l:3']);
  });
});

describe('AC-RUT-2 cambiar el orden', () => {
  const R = ['a', 'b', 'c', 'd'];

  it('mover de una posición a otra corre a los demás', () => {
    expect(moverEnRuta(R, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moverEnRuta(R, 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(moverEnRuta(R, 1, 1)).toEqual(R);
  });

  it('mover tolera índices fuera de rango', () => {
    expect(moverEnRuta(R, 0, 99)).toEqual(['b', 'c', 'd', 'a']);
    expect(moverEnRuta(R, 3, -5)).toEqual(['d', 'a', 'b', 'c']);
    expect(moverEnRuta(R, 9, 0)).toEqual(R);
    expect(moverEnRuta(R, -1, 0)).toEqual(R);
    expect(moverEnRuta(R, 1.5, 0)).toEqual(R);
    expect(moverEnRuta(R, 0, NaN)).toEqual(R);
  });

  it('subir y bajar de a uno; en los extremos no hacen nada', () => {
    expect(subirEnRuta(R, 'c')).toEqual(['a', 'c', 'b', 'd']);
    expect(subirEnRuta(R, 'a')).toEqual(R);
    expect(bajarEnRuta(R, 'b')).toEqual(['a', 'c', 'b', 'd']);
    expect(bajarEnRuta(R, 'd')).toEqual(R);
    expect(subirEnRuta(R, 'zz')).toEqual(R);
    expect(bajarEnRuta(R, 'zz')).toEqual(R);
  });

  it('escribir el puesto (1..n) lo manda ahí; fuera de rango se ajusta', () => {
    expect(moverAPuesto(R, 'd', 1)).toEqual(['d', 'a', 'b', 'c']);
    expect(moverAPuesto(R, 'a', 3)).toEqual(['b', 'c', 'a', 'd']);
    expect(moverAPuesto(R, 'a', 99)).toEqual(['b', 'c', 'd', 'a']);
    expect(moverAPuesto(R, 'd', 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(moverAPuesto(R, 'a', 'x')).toEqual(R);
    expect(moverAPuesto(R, 'zz', 2)).toEqual(R);
  });

  it('invertir da vuelta el orden', () => {
    expect(invertirRuta(R)).toEqual(['d', 'c', 'b', 'a']);
    expect(invertirRuta([])).toEqual([]);
  });
});

describe('AC-RUT-3 un pedido entregado o borrado sale solo de la ruta', () => {
  const pend = new Map([['l:1', { id: 1 }], ['l:3', { id: 3 }]]);
  it('rutaVigente y pedidosDeRuta ignoran lo que ya no es pendiente, sin cambiar el orden', () => {
    expect(rutaVigente(['l:3', 'l:2', 'l:1'], pend)).toEqual(['l:3', 'l:1']);
    expect(pedidosDeRuta(['l:3', 'l:2', 'l:1'], pend).map(p => p.id)).toEqual([3, 1]);
    expect(rutaVigente(['l:1'], null)).toEqual([]);
  });
});

describe('AC-RUT-4 atajo: ordenar por zona', () => {
  const clientes = [
    { id: 1, nombre: 'Ana', zona: 'Norte', ordenZona: 2 },
    { id: 2, nombre: 'Beto', zona: 'Norte', ordenZona: 1 },
    { id: 3, nombre: 'Cami', zona: 'Sur', ordenZona: 1 },
    { id: 4, nombre: 'Dani', zona: '' },
  ];
  const P = (id, clienteId) => ({ id, clienteId, clienteNombre: `C${clienteId}`, fecha: '2026-11-10' });
  const pedidos = new Map([['l:10', P(10, 4)], ['l:11', P(11, 3)], ['l:12', P(12, 1)], ['l:13', P(13, 2)]]);

  it('agrupa por zona, respeta el puesto de cada cliente y deja "sin zona" al final', () => {
    expect(ordenarRutaPorZona(['l:10', 'l:11', 'l:12', 'l:13'], pedidos, clientes)).toEqual(['l:13', 'l:12', 'l:11', 'l:10']);
  });

  it('solo reordena lo que está en la ruta', () => {
    expect(ordenarRutaPorZona(['l:12', 'l:11'], pedidos, clientes)).toEqual(['l:12', 'l:11']);
    expect(ordenarRutaPorZona([], pedidos, clientes)).toEqual([]);
  });
});

describe('AC-RUT-5 numeración y salida', () => {
  it('grupoDeRuta numera 1..n en el orden recibido, en un solo grupo', () => {
    const g = grupoDeRuta([{ id: 5 }, { id: 2 }, null, { id: 9 }]);
    expect(g).toHaveLength(1);
    expect(g[0].pedidos.map(x => [x.pedido.id, x.orden])).toEqual([[5, 1], [2, 2], [9, 3]]);
    expect(grupoDeRuta(null)[0].pedidos).toEqual([]);
  });

  it('enlaceMapa arma el link de Google Maps con la dirección (y localidad) codificadas', () => {
    expect(enlaceMapa('Av. Siempreviva 742', 'Rosario')).toBe('https://www.google.com/maps/search/?api=1&query=Av.%20Siempreviva%20742%2C%20Rosario');
    expect(enlaceMapa('  San Martín   100 ')).toContain('query=San%20Mart%C3%ADn%20100');
    expect(enlaceMapa('')).toBeNull();
    expect(enlaceMapa(null)).toBeNull();
  });
});

describe('AC-RUT-6 la ruta se guarda en el dispositivo', () => {
  it('serializa y vuelve a leer; datos dañados dan ruta vacía', () => {
    const t = serializarRuta(['l:1', 'r:2', 'l:1']);
    expect(leerRutaGuardada(t)).toEqual(['l:1', 'r:2']);
    expect(leerRutaGuardada('no es json')).toEqual([]);
    expect(leerRutaGuardada('{"version":2,"ruta":["a"]}')).toEqual([]);
    expect(leerRutaGuardada(null)).toEqual([]);
    expect(leerRutaGuardada('')).toEqual([]);
  });

  it('cada usuario tiene su propia clave', () => {
    expect(claveAlmacenRuta({ id: 4 })).toBe('rutaEntrega:4');
    expect(claveAlmacenRuta({ remoteId: 'x', id: 4 })).toBe('rutaEntrega:x');
    expect(claveAlmacenRuta(null)).toBe('rutaEntrega:default');
  });
});
