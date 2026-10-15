import { normalizarBusqueda, coincide, puntaje, filtrarCatalogo, filtrosDesdeQuery, filtrosAQuery } from '../tienda';

const cat = [
  { id: '1', nombre: 'Dos Corazones', codigo: 'DC1', marca: 'Arcor', rubro: 'Golosinas', precio: 900 },
  { id: '2', nombre: 'Café Molido', codigo: 'CM', marca: 'La Virginia', rubro: 'Almacén', precio: 3000 },
  { id: '3', nombre: 'Caramelos Corazón', codigo: 'CC', marca: 'Arcor', rubro: 'Golosinas', precio: 500 },
  { id: '4', nombre: 'Yerba', codigo: 'Y1', marca: 'La Virginia', rubro: 'Almacén', precio: 2000 },
];

describe('tienda búsqueda y filtros (AC-TIE-5, AC-TIE-6)', () => {
  it('AC-TIE-5 normaliza tildes y mayúsculas', () => {
    expect(normalizarBusqueda('  CAFÉ   Molído ')).toBe('cafe molido');
    expect(normalizarBusqueda(null)).toBe('');
  });
  it('AC-TIE-5 tolera palabras en cualquier orden', () => {
    expect(coincide(cat[0], 'corazones dos')).toBe(true);
    expect(coincide(cat[1], 'CAFE')).toBe(true);
    expect(coincide(cat[1], 'cafe te')).toBe(false);
    expect(coincide(cat[0], 'arcor')).toBe(true);
    expect(coincide(cat[0], 'dc1')).toBe(true);
    expect(coincide(cat[0], '')).toBe(true);
  });
  it('AC-TIE-5 puntaje: nombre exacto antes que parcial', () => {
    expect(puntaje(cat[3], 'yerba')).toBeGreaterThan(puntaje(cat[0], 'yerba'));
    expect(puntaje(cat[0], '')).toBe(0);
  });
  it('AC-TIE-6 combina búsqueda + rubro + marca con contadores', () => {
    const r = filtrarCatalogo(cat, { q: 'corazon', rubros: ['Golosinas'], marcas: ['Arcor'] });
    expect(r.items.map(i => i.id).sort()).toEqual(['1', '3']);
    expect(r.contadores.rubros).toEqual({ Golosinas: 2 });
    const sinFiltro = filtrarCatalogo(cat, {});
    expect(sinFiltro.contadores.marcas).toEqual({ Arcor: 2, 'La Virginia': 2 });
    expect(filtrarCatalogo(cat, { rubros: ['Almacén'] }).contadores.rubros).toEqual({ Almacén: 2, Golosinas: 2 });
    expect(filtrarCatalogo(null, {}).items).toEqual([]);
  });
  it('AC-TIE-6 orden por precio y nombre', () => {
    expect(filtrarCatalogo(cat, { orden: 'precio_asc' }).items[0].id).toBe('3');
    expect(filtrarCatalogo(cat, { orden: 'precio_desc' }).items[0].id).toBe('2');
    expect(filtrarCatalogo(cat, { orden: 'nombre' }).items[0].nombre).toBe('Café Molido');
    expect(filtrarCatalogo(cat, { q: 'corazon', orden: 'relevancia' }).items.length).toBe(2);
  });
  it('AC-TIE-6 filtros en la URL: ida y vuelta estable', () => {
    const f = { q: 'dos corazones', rubros: ['Golosinas', 'Almacén'], marcas: ['La Virginia'], orden: 'precio_asc', v: 'tok' };
    const qs = filtrosAQuery(f);
    expect(filtrosDesdeQuery(qs)).toEqual(f);
    expect(filtrosAQuery(filtrosDesdeQuery(qs))).toBe(qs);
    expect(filtrosAQuery({})).toBe('');
    expect(filtrosDesdeQuery('?orden=raro').orden).toBe('relevancia');
    expect(filtrosDesdeQuery(undefined).rubros).toEqual([]);
  });
});
