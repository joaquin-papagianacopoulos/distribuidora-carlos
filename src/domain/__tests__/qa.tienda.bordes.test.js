// QA REQ-TIE bordes (corrida 20261014-2100).
import {
  aCentavos, formatearPesos, precioVigente, calcularCarrito, unidadesRenglon,
  filtrarCatalogo, filtrosDesdeQuery, filtrosAQuery, normalizarBusqueda,
} from '../tienda';

const dos = { id: 'p1', nombre: 'Dos Corazones', precio: 900, bultoX: 16, ventaPor: 'bulto', disponible: true };

describe('QA tienda bordes', () => {
  it('AC-TIE-9 Dos Corazones: 1 bulto = 16 u / 14400 y 3 = 48 u / 43200', () => {
    const cat = { p1: dos };
    const a = calcularCarrito([{ productoId: 'p1', cantidad: 1, modo: 'bulto' }], cat);
    expect(a.renglones[0].unidades).toBe(16);
    expect(a.total).toBe(14400);
    const b = calcularCarrito([{ productoId: 'p1', cantidad: 3, modo: 'bulto' }], cat);
    expect(b.renglones[0].unidades).toBe(48);
    expect(b.total).toBe(43200);
  });

  it('AC-TIE-11 entradas invalidas no rompen ni suman', () => {
    for (const bad of [NaN, -1, 0, 1.5, 'abc', null, undefined, Infinity]) {
      expect(unidadesRenglon({ cantidad: bad, modo: 'unidad' }, { ...dos, ventaPor: 'unidad' })).toBeNull();
    }
    expect(calcularCarrito(null, null).total).toBe(0);
    expect(calcularCarrito([null, {}], {}).errores.length).toBe(2);
    expect(aCentavos('10')).toBeNull();
    expect(formatearPesos(NaN)).toBe('');
  });

  it('AC-TIE-11 centavos y redondeo sin error de coma flotante', () => {
    expect(aCentavos(0.1 + 0.2)).toBe(30);
    expect(aCentavos(1.005)).toBe(101);
    expect(formatearPesos(1234.5)).toBe('$1.234,50');
    const cat = { x: { id: 'x', nombre: 'X', precio: 0.1, disponible: true } };
    expect(calcularCarrito([{ productoId: 'x', cantidad: 3, modo: 'unidad' }], cat).total).toBe(0.3);
  });

  it('AC-TIE-11 oferta: vigente en el borde del dia, vencida y futura', () => {
    const of = [{ productoId: 'p1', precio: 500, desde: '2026-10-10', hasta: '2026-10-14' }];
    expect(precioVigente(dos, of, '2026-10-14').enOferta).toBe(true);
    expect(precioVigente(dos, of, '2026-10-10').enOferta).toBe(true);
    expect(precioVigente(dos, of, '2026-10-15')).toEqual({ precio: 900, enOferta: false });
    expect(precioVigente(dos, of, '2026-10-09').enOferta).toBe(false);
    expect(precioVigente(null, of, '2026-10-14').precio).toBeNull();
  });

  it('AC-TIE-11 totales grandes y tope de total', () => {
    const cat = { g: { id: 'g', nombre: 'G', precio: 999999.99, disponible: true } };
    const r = calcularCarrito([{ productoId: 'g', cantidad: 1000, modo: 'unidad' }], cat, { maxTotal: 1000000 });
    expect(Number.isFinite(r.total)).toBe(true);
    expect(r.errores.some(e => /m[aá]ximo/i.test(e.mensaje))).toBe(true);
  });

  it('AC-TIE-15 tope de 150 renglones', () => {
    const cat = {}; const ls = [];
    for (let i = 0; i < 151; i++) { cat['i' + i] = { id: 'i' + i, nombre: 'n' + i, precio: 1, disponible: true }; ls.push({ productoId: 'i' + i, cantidad: 1 }); }
    expect(calcularCarrito(ls, cat).errores.some(e => /150/.test(e.mensaje))).toBe(true);
  });

  it('AC-TIE-5 tildes, mayusculas y orden de palabras; combinada con rubro y marca', () => {
    const cat = [
      { id: 1, nombre: 'Azúcar Ledesma 1kg', rubro: 'Almacén', marca: 'Ledesma', precio: 10 },
      { id: 2, nombre: 'Azucar Chango', rubro: 'Almacén', marca: 'Chango', precio: 8 },
      { id: 3, nombre: 'Yerba Ledesma', rubro: 'Infusiones', marca: 'Ledesma', precio: 5 },
    ];
    expect(normalizarBusqueda('  AZÚCAR!! ')).toBe('azucar');
    expect(filtrarCatalogo(cat, { q: 'KG ledesma AZUCAR' }).items.map(p => p.id)).toEqual([1]);
    expect(filtrarCatalogo(cat, { q: 'ledesma', rubros: ['Almacén'] }).items.map(p => p.id)).toEqual([1]);
    expect(filtrarCatalogo(cat, { q: 'azucar', marcas: ['Chango'], rubros: ['Infusiones'] }).items).toEqual([]);
    expect(filtrarCatalogo(cat, { orden: 'precio_asc' }).items.map(p => p.id)).toEqual([3, 2, 1]);
    expect(filtrarCatalogo(null, { q: null }).items).toEqual([]);
  });

  it('AC-TIE-6 filtros en la URL: ida y vuelta, orden invalido y valores con caracteres raros', () => {
    const f = { q: 'azúcar & sal', rubros: ['Almacén', 'A/B'], marcas: ['X'], orden: 'precio_desc' };
    expect(filtrosDesdeQuery(filtrosAQuery(f))).toMatchObject(f);
    expect(filtrosDesdeQuery('?orden=hack').orden).toBe('relevancia');
    expect(filtrosDesdeQuery(null).rubros).toEqual([]);
    expect(filtrosAQuery({})).toBe('');
  });
});
