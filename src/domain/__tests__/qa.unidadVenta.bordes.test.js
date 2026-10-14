// QA REQ-VTA: casos borde adicionales (RUN 20261014-1621).
import { unidadesDeBultos, bultosDeUnidades, precioBulto, importeBultos, esMultiploDeBulto, ventaPorEfectivo, validarUnidadVenta, parsearBooleano, normalizarBultoNombre } from '../unidadVenta';
import { listarMarcas, resolverMarca } from '../marcas';

describe('QA AC-VTA-4 bordes', () => {
  it('AC-VTA-4 bultoX como texto con espacios o undefined/null no rompe', () => {
    for (const bx of [undefined, null, '', '  ', 'abc', 0, 1, 1.5, -16, NaN, Infinity, {}, []]) {
      expect(unidadesDeBultos(3, bx)).toBeNull();
      expect(precioBulto(900, bx)).toBeNull();
      expect(esMultiploDeBulto(48, bx)).toBe(false);
      expect(() => ventaPorEfectivo({ bultoX: bx, ventaPor: 'bulto' })).not.toThrow();
      expect(ventaPorEfectivo({ bultoX: bx, ventaPor: 'bulto' })).toBe('unidad');
    }
  });
  it('AC-VTA-4 bultoX texto numerico "16" funciona igual que 16', () => {
    expect(unidadesDeBultos(3, '16')).toBe(48);
    expect(precioBulto('900,50', '16')).toBe(14408);
  });
  it('AC-VTA-4 cantidades decimales, 0 y negativas no son multiplo ni bultos validos', () => {
    expect(esMultiploDeBulto(16.5, 16)).toBe(false);
    expect(esMultiploDeBulto(0, 16)).toBe(false);
    expect(esMultiploDeBulto(-16, 16)).toBe(false);
    expect(unidadesDeBultos(0, 16)).toBeNull();
    expect(unidadesDeBultos(1.5, 16)).toBeNull();
    expect(unidadesDeBultos(null, 16)).toBeNull();
    expect(bultosDeUnidades(-1, 16)).toBeNull();
    expect(bultosDeUnidades(20, 16)).toEqual({ bultos: 1, sueltas: 4 });
  });
  it('AC-VTA-4 precio 0 es valido; precio negativo/NaN/null da null; 0,1+0,2 sin error de float', () => {
    expect(precioBulto(0, 16)).toBe(0);
    expect(precioBulto(-1, 16)).toBeNull();
    expect(precioBulto(NaN, 16)).toBeNull();
    expect(precioBulto(null, 16)).toBeNull();
    expect(importeBultos(3, 3, 0.1).importe).toBe(0.9);
  });
  it('AC-VTA-1 parsearBooleano y bultoNombre toleran basura', () => {
    expect(parsearBooleano(null)).toBeNull();
    expect(parsearBooleano(undefined)).toBeNull();
    expect(parsearBooleano(' SÍ ')).toBe(true);
    expect(parsearBooleano(2)).toBeNull();
    expect(normalizarBultoNombre(null)).toBe('Bulto');
    expect(normalizarBultoNombre(' display ')).toBe('Display');
    expect(normalizarBultoNombre('Pallet')).toBe('Bulto');
  });
  it('AC-VTA-1 validarUnidadVenta sin argumentos y con visibleTienda texto raro', () => {
    expect(validarUnidadVenta().ok).toBe(true);
    expect(validarUnidadVenta({ visibleTienda: 'quizas' }).valor.visibleTienda).toBe(true);
    expect(validarUnidadVenta({ ventaPor: 'bulto' }).ok).toBe(false);
  });
  it('AC-VTA-1 marcas: unicode, espacios internos y null', () => {
    expect(() => listarMarcas([null, undefined, {}, { marca: null }, { marca: '  ' }])).not.toThrow();
    const l = listarMarcas([{ marca: 'Dos Corazones' }, { marca: '  dos corazónes ' }]);
    expect(l.length).toBe(1);
    expect(resolverMarca('ÁRCOR', ['Arcor'])).toMatchObject({ marca: 'Arcor', esNuevo: false });
  });
});
