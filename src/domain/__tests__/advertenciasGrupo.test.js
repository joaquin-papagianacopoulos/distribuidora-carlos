// AC-AGR-5: avisos al agrupar renglones distintos.
import { advertenciasGrupo } from '../gruposFactura';

describe('AC-AGR-5 advertenciasGrupo', () => {
  test('AC-AGR-5 mismo bulto y mismo precio: sin avisos', () => {
    expect(advertenciasGrupo([{ bultoX: 12, precio: 100 }, { bultoX: 12, precio: 100 }])).toEqual([]);
  });
  test('AC-AGR-5 bultos distintos o uno sin bulto avisan; precios con centavos distintos también', () => {
    expect(advertenciasGrupo([{ bultoX: 12, precio: 100 }, { bultoX: 24, precio: 100 }])).toHaveLength(1);
    expect(advertenciasGrupo([{ bultoX: 12, precio: 100 }, { precio: 100 }])[0]).toContain('sin bulto');
    expect(advertenciasGrupo([{ bultoX: 1, precio: 100 }, { bultoX: 1, precio: 100.5 }])[0]).toContain('precios distintos');
  });
  test('AC-AGR-5 con menos de 2 renglones o datos inválidos no avisa', () => {
    expect(advertenciasGrupo([{ bultoX: 12 }])).toEqual([]);
    expect(advertenciasGrupo(null)).toEqual([]);
  });
});
