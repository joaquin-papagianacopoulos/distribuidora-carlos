// REQ-CAT: catálogo PDF (ocultos, sin stock, paginado, fotos por código).
import {
  armarCatalogo, paginar, indexarMarcas, aplicarCambioMarca, resumenCatalogo, layoutPagina,
  emparejarFotosPorCodigo, codigoDesdeArchivo, formatoPrecio, partirEnRenglones, textoPdfSeguro, nombreArchivoCatalogo,
} from '../catalogoPdf';

const prods = [
  { id: 1, codigo: '66', nombre: 'Topline 7 Rojo x16', categoria: 'Chicles', precio: 834.13, imagen_url: 'https://x/1.jpg' },
  { id: 2, codigo: '65', nombre: 'Topline 7 Tutti x16', categoria: 'Chicles', precio: 834.13, imagen_url: null },
  { id: 3, codigo: 'A-9', nombre: 'Alfajor', categoria: 'Golosinas', precio: 500 },
];

describe('AC-CAT-1 ocultos y sin stock', () => {
  test('un producto oculto no sale del catálogo', () => {
    const m = [{ productoId: 2, oculto: true }];
    expect(armarCatalogo(prods, m).map(i => i.id)).toEqual([1, 3]);
  });
  test('sin stock manual lo deja en el catálogo marcado', () => {
    const r = armarCatalogo(prods, [{ productoId: 3, sinStock: true }]);
    expect(r.find(i => i.id === 3).sinStock).toBe(true);
    expect(r.find(i => i.id === 1).sinStock).toBe(false);
  });
  test('autoSinStock marca stock <= 0 pero no esconde nada', () => {
    const r = armarCatalogo(prods, [], { autoSinStock: true, stockDe: (id) => (id === 1 ? 0 : 5) });
    expect(r).toHaveLength(3);
    expect(r.filter(i => i.sinStock).map(i => i.id)).toEqual([1]);
  });
  test('sin autoSinStock el stock real no influye', () => {
    expect(armarCatalogo(prods, [], { stockDe: () => 0 }).some(i => i.sinStock)).toBe(false);
  });
  test('soloConFoto deja afuera los que no tienen foto', () => {
    expect(armarCatalogo(prods, [], { soloConFoto: true }).map(i => i.id)).toEqual([1]);
  });
  test('ordena por rubro y nombre; trae código, nombre y precio', () => {
    const r = armarCatalogo(prods, []);
    expect(r.map(i => i.id)).toEqual([1, 2, 3]);
    expect(r[0]).toMatchObject({ codigo: '66', nombre: 'Topline 7 Rojo x16', precio: 834.13 });
  });
  test('marcas: aplicar cambios y volver a blanco', () => {
    const a = aplicarCambioMarca(undefined, 1, { oculto: true });
    expect(a).toEqual({ productoId: 1, oculto: true, sinStock: false });
    const b = aplicarCambioMarca(a, 1, { oculto: false });
    expect(indexarMarcas([b]).size).toBe(0);
  });
  test('resumen cuenta visibles, ocultos, sin stock y sin foto', () => {
    const r = resumenCatalogo(prods, [{ productoId: 2, oculto: true }, { productoId: 3, sinStock: true }]);
    expect(r).toEqual({ total: 3, visibles: 2, ocultos: 1, sinStock: 1, sinFoto: 1 });
  });
});

describe('AC-CAT-2 paginado y layout', () => {
  test('16 por página', () => {
    const p = paginar(Array.from({ length: 33 }, (_, i) => i));
    expect(p.map(x => x.length)).toEqual([16, 16, 1]);
  });
  test('sin items no hay páginas', () => expect(paginar([])).toEqual([]));
  test('las 16 celdas entran en la hoja A4 y no se pisan', () => {
    const { celdas } = layoutPagina();
    expect(celdas).toHaveLength(16);
    celdas.forEach(c => { expect(c.x).toBeGreaterThanOrEqual(0); expect(c.x + c.w).toBeLessThanOrEqual(595.28); expect(c.y).toBeGreaterThanOrEqual(0); expect(c.y + c.h).toBeLessThanOrEqual(841.89); });
    expect(celdas[0].x + celdas[0].w).toBeLessThan(celdas[1].x);
    expect(celdas[0].y).toBeGreaterThan(celdas[4].y + celdas[4].h);
  });
});

describe('AC-CAT-3 fotos por código', () => {
  const f = (name) => ({ name });
  test('codigoDesdeArchivo', () => {
    expect(codigoDesdeArchivo('66.jpg')).toBe('66');
    expect(codigoDesdeArchivo('66 (1).PNG')).toBe('66');
    expect(codigoDesdeArchivo('A-9.webp')).toBe('A-9');
  });
  test('empareja por código sin importar mayúsculas e informa lo que no coincide', () => {
    const r = emparejarFotosPorCodigo([f('66.jpg'), f('a-9.png'), f('999.jpg')], prods);
    expect(r.asignaciones.map(a => a.producto.id)).toEqual([1, 3]);
    expect(r.sinProducto).toEqual(['999.jpg']);
  });
  test('dos archivos para el mismo producto: gana el último y se avisa', () => {
    const r = emparejarFotosPorCodigo([f('66.jpg'), f('66 (1).jpg')], prods);
    expect(r.asignaciones).toHaveLength(1);
    expect(r.asignaciones[0].file.name).toBe('66 (1).jpg');
    expect(r.repetidos).toEqual(['66.jpg']);
  });
});

describe('AC-CAT-4 texto del PDF', () => {
  test('formatoPrecio rioplatense', () => expect(formatoPrecio(1667.5).replace(/ /g, ' ')).toBe('$ 1.667,50'));
  test('textoPdfSeguro no rompe pdf-lib con caracteres fuera de WinAnsi', () => {
    expect(textoPdfSeguro('Café – “x” ✓')).toBe('Café - "x" ?');
  });
  test('partirEnRenglones respeta el máximo y agrega puntos suspensivos', () => {
    const medir = (s) => s.length;
    const r = partirEnRenglones('uno dos tres cuatro cinco seis siete ocho', medir, 10, 2);
    expect(r).toHaveLength(2);
    expect(r[1].endsWith('...')).toBe(true);
    expect(r.every(x => medir(x) <= 10)).toBe(true);
  });
  test('nombre del archivo con fecha y hora', () => {
    expect(nombreArchivoCatalogo(new Date(2026, 10, 16, 20, 17, 8), 'Distri Sulpi')).toBe('Catalogo-DistriSulpi-2026-11-16_20-17-08.pdf');
  });
});
