// REQ-VTA (AC-VTA-1): normalizacion y dedupe de marcas (misma regla que el rubro, AC-COMR-4).
import { normalizarMarca, claveMarca, listarMarcas, resolverMarca, marcaParaGuardar } from '../marcas';

describe('AC-VTA-1 normalizacion de marcas', () => {
  it('AC-VTA-1 mayusculas, espacios y tildes dan la misma clave', () => {
    const claves = ['Dos Corazones', 'DOS CORAZONES', '  dos   corazones ', 'dós corazónes'].map(claveMarca);
    expect(new Set(claves).size).toBe(1);
  });
  it('AC-VTA-1 NFC: la tilde combinante es la misma marca', () => {
    expect(claveMarca('Cássero')).toBe(claveMarca('Cássero'));
    expect(normalizarMarca('Cássero')).toBe('Cássero');
  });
  it('AC-VTA-1 entradas no texto => vacio', () => {
    for (const v of [null, undefined, {}, [], NaN]) expect(normalizarMarca(v)).toBe('');
  });
  it('AC-VTA-1 listarMarcas dedupe por clave, usa la escritura del mas viejo y ordena', () => {
    const productos = [
      { id: 1, marca: 'ARCOR', createdAt: 5 },
      { id: 2, marca: 'Arcor', createdAt: 1 },
      { id: 3, marca: ' Bagley ', createdAt: 2 },
      { id: 4, marca: '' },
      { id: 5 },
      null,
    ];
    expect(listarMarcas(productos, ['bagley', 'Zeta'])).toEqual(['Arcor', 'Bagley', 'Zeta']);
    expect(listarMarcas(null)).toEqual([]);
  });
  it('AC-VTA-1 resolverMarca reutiliza la existente', () => {
    expect(resolverMarca('ARCOR ', ['Arcor'])).toEqual({ marca: 'Arcor', clave: 'arcor', esNuevo: false });
    expect(resolverMarca('Nueva', ['Arcor'])).toMatchObject({ marca: 'Nueva', esNuevo: true });
    expect(resolverMarca('   ', ['Arcor'])).toEqual({ marca: '', clave: '', esNuevo: false });
  });
});

describe('AC-VTA-1 marcaParaGuardar', () => {
  const detectar = (n) => (/coca/i.test(n) ? 'Coca-Cola' : '');
  it('AC-VTA-1 prioridad: tipeada > existente > detectada', () => {
    expect(marcaParaGuardar({ marcaForm: 'Pepsi', marcaExistente: 'Arcor', nombre: 'Coca 500', detectar })).toBe('Pepsi');
    expect(marcaParaGuardar({ marcaForm: '', marcaExistente: 'Arcor', nombre: 'Coca 500', detectar })).toBe('Arcor');
    expect(marcaParaGuardar({ marcaForm: '', marcaExistente: '', nombre: 'Coca 500', detectar })).toBe('Coca-Cola');
    expect(marcaParaGuardar({ nombre: 'Algo', detectar })).toBe('');
    expect(marcaParaGuardar({})).toBe('');
  });
  it('AC-VTA-1 siempre pasa por el dedupe con las marcas existentes', () => {
    expect(marcaParaGuardar({ marcaForm: 'COCA-COLA', marcas: ['Coca-Cola'] })).toBe('Coca-Cola');
    expect(marcaParaGuardar({ nombre: 'coca', marcas: ['coca-cola'], detectar })).toBe('coca-cola');
  });
  it('AC-VTA-1 un detector que falla no rompe el guardado', () => {
    expect(marcaParaGuardar({ nombre: 'x', detectar: () => { throw new Error('boom'); } })).toBe('');
  });
});
