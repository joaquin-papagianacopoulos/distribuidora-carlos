// REQ-AGR (AC-AGR-1, 2, 3, 4): agrupar renglones en la boleta.
import {
  claveRenglon, sugerirNombreGrupo, crearGrupo, renombrarGrupo, deshacerGrupo, normalizarGrupos,
  textoBultosGrupo, filasBoleta, totalFilasBoleta, MAX_GRUPOS, MAX_BYTES_GRUPOS,
} from '../gruposFactura';

const it1 = (productoId, nombre, cantidad, precio, extra = {}) => ({ productoId, nombre, cantidad, precio, ...extra });
const ITEMS = [
  it1(1, 'Saphirus Lavanda', 12, 100, { bultoX: 12 }),
  it1(2, 'Saphirus Rosa', 24, 100, { bultoX: 12 }),
  it1(3, 'Jabon Blanco', 5, 50),
  it1(4, 'Zorro Limpio', 2, 10.5),
];
let n = 0;
const idFn = () => `g${++n}`;

describe('AC-AGR-1 sugerirNombreGrupo', () => {
  const prods = new Map([
    ['1', { marca: 'Saphirus', categoria: 'Aromas' }], ['2', { marca: 'saphirus', categoria: 'Aromas' }],
    ['3', { marca: 'Otra', categoria: 'Aromas' }], ['4', { marca: '', categoria: 'Limpieza' }],
  ]);
  it('AC-AGR-1 marca comun (sin importar mayusculas)', () => {
    expect(sugerirNombreGrupo([ITEMS[0], ITEMS[1]], prods)).toBe('Saphirus');
  });
  it('AC-AGR-1 sin marca comun, rubro comun', () => {
    expect(sugerirNombreGrupo([ITEMS[0], ITEMS[2]], prods)).toBe('Aromas');
  });
  it('AC-AGR-1 mezcla => Grupo', () => {
    expect(sugerirNombreGrupo([ITEMS[0], ITEMS[3]], prods)).toBe('Grupo');
    expect(sugerirNombreGrupo([], prods)).toBe('Grupo');
    expect(sugerirNombreGrupo([ITEMS[0]], undefined)).toBe('Grupo');
  });
  it('AC-AGR-1 usa la marca del renglon si la trae', () => {
    expect(sugerirNombreGrupo([{ productoId: 9, marca: 'Mia' }, { productoId: 8, marca: 'MIA' }], new Map())).toBe('Mia');
  });
});

describe('AC-AGR-1 crear / renombrar / deshacer', () => {
  it('AC-AGR-1 crea un grupo con id inyectable y nombre editable', () => {
    const g = crearGrupo([], ['1', '2'], '  Saphirus  ', idFn);
    expect(g).toEqual([{ id: expect.stringMatching(/^g\d+$/), nombre: 'Saphirus', itemIds: ['1', '2'] }]);
  });
  it('AC-AGR-1 un renglon vive en un solo grupo', () => {
    let g = crearGrupo([], ['1', '2'], 'A', idFn);
    g = crearGrupo(g, ['2', '3'], 'B', idFn);
    expect(g.map(x => x.itemIds)).toEqual([['1'], ['2', '3']]);
    g = crearGrupo(g, ['1', '2', '3'], 'C', idFn);
    expect(g).toHaveLength(1);
    expect(g[0].nombre).toBe('C');
  });
  it('AC-AGR-1 seleccion vacia no cambia nada', () => {
    const base = [{ id: 'x', nombre: 'X', itemIds: ['1'] }];
    expect(crearGrupo(base, [], 'Y', idFn)).toBe(base);
  });
  it('AC-AGR-1 renombrar y deshacer', () => {
    const g = crearGrupo([], ['1'], 'A', () => 'gg');
    expect(renombrarGrupo(g, 'gg', 'Nuevo')[0].nombre).toBe('Nuevo');
    expect(renombrarGrupo(g, 'gg', '   ')[0].nombre).toBe('Grupo');
    expect(deshacerGrupo(g, 'gg')).toEqual([]);
  });
  it('AC-AGR-1 tope de grupos', () => {
    let g = [];
    for (let i = 0; i < MAX_GRUPOS + 5; i++) g = crearGrupo(g, [`k${i}`], 'G', () => `id${i}`);
    expect(g).toHaveLength(MAX_GRUPOS);
  });
});

describe('AC-AGR-4 normalizarGrupos', () => {
  it('AC-AGR-4 descarta renglones eliminados y grupos vacios', () => {
    const g = [{ id: 'a', nombre: 'A', itemIds: ['1', '99'] }, { id: 'b', nombre: 'B', itemIds: ['88'] }];
    expect(normalizarGrupos(g, ITEMS)).toEqual([{ id: 'a', nombre: 'A', itemIds: ['1'] }]);
  });
  it('AC-AGR-4 datos basura', () => {
    expect(normalizarGrupos(null, ITEMS)).toEqual([]);
    expect(normalizarGrupos('x', ITEMS)).toEqual([]);
    expect(normalizarGrupos([null, 3, [], { id: 'a' }, { itemIds: ['1'] }, { id: 'ok', nombre: 5, itemIds: [1, {}, null, '1', ''] }], ITEMS))
      .toEqual([{ id: 'ok', nombre: '5', itemIds: ['1'] }]);
  });
  it('AC-AGR-4 renglon repetido en dos grupos queda en el primero; ids repetidos se descartan', () => {
    const g = [{ id: 'a', nombre: 'A', itemIds: ['1'] }, { id: 'b', nombre: 'B', itemIds: ['1', '2'] }, { id: 'a', nombre: 'Z', itemIds: ['3'] }];
    expect(normalizarGrupos(g, ITEMS).map(x => [x.id, x.itemIds])).toEqual([['a', ['1']], ['b', ['2']]]);
  });
  it('AC-AGR-4 recorta el nombre y limita la cantidad', () => {
    const largo = 'x'.repeat(200);
    expect(normalizarGrupos([{ id: 'a', nombre: largo, itemIds: ['1'] }], ITEMS)[0].nombre).toHaveLength(60);
    const muchos = Array.from({ length: 80 }, (_, i) => ({ id: `i${i}`, nombre: 'G', itemIds: [`k${i}`] }));
    expect(normalizarGrupos(muchos, undefined)).toHaveLength(MAX_GRUPOS);
  });
});

describe('AC-AGR-3 textoBultosGrupo', () => {
  it('AC-AGR-3 mismo bultoX y suma multiplo => bultos', () => {
    expect(textoBultosGrupo([ITEMS[0], ITEMS[1]])).toBe('3 bultos (36 u.)');
    expect(textoBultosGrupo([ITEMS[0]])).toBe('1 bulto (12 u.)');
  });
  it('AC-AGR-4 bultos mixtos => solo unidades', () => {
    expect(textoBultosGrupo([ITEMS[0], { ...ITEMS[1], bultoX: 6 }])).toBe('36 u.');
  });
  it('AC-AGR-4 sin bultoX, suma que no es multiplo o vacio => unidades', () => {
    expect(textoBultosGrupo([ITEMS[0], ITEMS[2]])).toBe('17 u.');
    expect(textoBultosGrupo([it1(1, 'a', 13, 1, { bultoX: 12 })])).toBe('13 u.');
    expect(textoBultosGrupo([it1(1, 'a', 6, 1, { bultoX: 12 })])).toBe('6 u.');
    expect(textoBultosGrupo([])).toBe('0 u.');
    expect(textoBultosGrupo(null)).toBe('0 u.');
  });
});

describe('AC-AGR-3 filasBoleta', () => {
  const grupos = [{ id: 'g', nombre: 'Saphirus', itemIds: ['1', '2'] }];
  const totalItems = ITEMS.reduce((s, i) => s + i.cantidad * i.precio, 0);

  it('AC-AGR-3 sin grupos: una fila por renglon, alfabetico', () => {
    const f = filasBoleta(ITEMS, [], { modo: 'detalle' });
    expect(f.map(x => x.nombre)).toEqual(['Jabon Blanco', 'Saphirus Lavanda', 'Saphirus Rosa', 'Zorro Limpio']);
    expect(f.every(x => x.tipo === 'item')).toBe(true);
    expect(totalFilasBoleta(f)).toBe(totalItems);
  });
  it('AC-AGR-3 modo detalle: grupo con sus renglones debajo, mezclado alfabeticamente', () => {
    const f = filasBoleta(ITEMS, grupos, { modo: 'detalle' });
    expect(f.map(x => [x.tipo, x.nombre.trim()])).toEqual([
      ['item', 'Jabon Blanco'], ['grupo', 'Saphirus'], ['detalle', 'Saphirus Lavanda'], ['detalle', 'Saphirus Rosa'], ['item', 'Zorro Limpio'],
    ]);
    expect(f[1].cantidadTexto).toBe('3 bultos (36 u.)');
    expect(f[1].subtotal).toBe(3600);
  });
  it('AC-AGR-3 modo solo_grupos: sin detalle', () => {
    const f = filasBoleta(ITEMS, grupos, { modo: 'solo_grupos' });
    expect(f.map(x => x.tipo)).toEqual(['item', 'grupo', 'item']);
  });
  it('AC-AGR-3 el total es el mismo con o sin grupos y en ambos modos (sin doble conteo)', () => {
    for (const modo of ['detalle', 'solo_grupos']) {
      expect(totalFilasBoleta(filasBoleta(ITEMS, grupos, { modo }))).toBeCloseTo(totalItems, 6);
    }
  });
  it('AC-AGR-3 grupo con renglon borrado se ignora sin romper', () => {
    const f = filasBoleta(ITEMS.slice(2), grupos, { modo: 'detalle' });
    expect(f.map(x => x.tipo)).toEqual(['item', 'item']);
  });
  it('AC-AGR-2 no modifica los items ni los grupos de entrada', () => {
    const copia = JSON.stringify(ITEMS);
    filasBoleta(ITEMS, grupos);
    expect(JSON.stringify(ITEMS)).toBe(copia);
  });
});

describe('AC-AGR-2 claveRenglon', () => {
  it('AC-AGR-2 productoId, o nombre si no hay', () => {
    expect(claveRenglon({ productoId: 7, nombre: 'x' })).toBe('7');
    expect(claveRenglon({ nombre: 'x' })).toBe('x');
  });
});

describe('AC-AGR-2 sync de grupos', () => {
  const { gruposToRemote, gruposFromRemote, sinColumnas011, nombraColumna011 } = require('../gruposFactura');
  it('AC-AGR-2 no manda la clave si el pedido no tiene grupos (no pisa a otro dispositivo)', () => {
    expect(gruposToRemote({ items: ITEMS })).toEqual({});
    expect(gruposToRemote({ items: ITEMS, grupos: null })).toEqual({});
  });
  it('AC-AGR-2 manda grupos saneados; [] sirve para deshacer todo', () => {
    expect(gruposToRemote({ items: ITEMS, grupos: [] })).toEqual({ grupos: [] });
    expect(gruposToRemote({ items: ITEMS, grupos: [{ id: 'a', nombre: 'A', itemIds: ['1', '99'] }] })).toEqual({ grupos: [{ id: 'a', nombre: 'A', itemIds: ['1'] }] });
  });
  it('AC-AGR-2 al leer: columna ausente o null conserva lo local; basura se sanea', () => {
    const local = { grupos: [{ id: 'l', nombre: 'L', itemIds: ['1'] }] };
    expect(gruposFromRemote({ items: ITEMS }, local)).toBe(local.grupos);
    expect(gruposFromRemote({ items: ITEMS, grupos: null }, local)).toBe(local.grupos);
    expect(gruposFromRemote({ items: ITEMS, grupos: 'x' }, local)).toEqual([]);
    expect(gruposFromRemote({ items: ITEMS, grupos: [{ id: 'r', nombre: 'R', itemIds: ['2', '77'] }] }, local)).toEqual([{ id: 'r', nombre: 'R', itemIds: ['2'] }]);
  });
  it('AC-AGR-2 sinColumnas011 y deteccion', () => {
    expect(sinColumnas011({ a: 1, grupos: [] })).toEqual({ a: 1 });
    expect(nombraColumna011({ message: "Could not find the 'grupos' column of 'pedidos'" })).toBe(true);
    expect(nombraColumna011({ message: "Could not find the 'entregado' column" })).toBe(false);
  });
});

describe('S-011-05 tamano de grupos', () => {
  it('S-011-05 normalizarGrupos nunca devuelve un JSON mayor al tope del server', () => {
    const largo = 'x'.repeat(200);
    const grupos = Array.from({ length: 50 }, (_, g) => ({
      id: 'g' + g, nombre: 'G', itemIds: Array.from({ length: 500 }, (_, i) => `${largo}-${g}-${i}`),
    }));
    const out = normalizarGrupos(grupos);
    expect(JSON.stringify(out).length).toBeLessThan(MAX_BYTES_GRUPOS);
    expect(MAX_BYTES_GRUPOS * 2).toBeLessThan(65536);
  });
});
