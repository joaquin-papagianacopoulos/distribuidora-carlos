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

// ---- Lote 2026-11-25: orden manual y ofertas por bulto ----
import { ordenarProductosCatalogo, moverEnLista, textosOfertasProducto, aplicarOfertasProducto, filasOfertasEditor } from '../catalogoPdf';

describe('AC-CAT-5 orden manual del PDF', () => {
  test('AC-CAT-5 los productos con puesto van primero, el resto por rubro y nombre', () => {
    const m = [{ productoId: 3, orden: 1 }, { productoId: 2, orden: 2 }];
    expect(armarCatalogo(prods, m).map(i => i.id)).toEqual([3, 2, 1]);
    expect(ordenarProductosCatalogo(prods, m).map(p => p.id)).toEqual([3, 2, 1]);
  });
  test('AC-CAT-5 una marca solo con orden se conserva; un orden inválido se ignora', () => {
    expect(indexarMarcas([{ productoId: 1, orden: 4 }]).get('1').orden).toBe(4);
    expect(indexarMarcas([{ productoId: 1, orden: 0 }]).size).toBe(0);
  });
  test('AC-CAT-5 moverEnLista mueve y no rompe con índices fuera de rango', () => {
    expect(moverEnLista([1, 2, 3], 0, 2)).toEqual([2, 3, 1]);
    expect(moverEnLista([1, 2, 3], 2, 9)).toEqual([1, 2, 3]);
  });
});

describe('AC-CAT-6/7 ofertas por bulto', () => {
  const base = { precio: 1000, bultoX: 10, bultoNombre: 'Display', precioBulto: 900, escalasBulto: [{ desde: 3, precio: 850 }, { desde: 5, pct: 20 }] };
  test('AC-CAT-6 el PDF lista precio llevando bulto y cada escala (también las viejas en %)', () => {
    expect(textosOfertasProducto(base)).toEqual([
      'Llevando 1 display (10 u): $900 c/u', 'Desde 3 displays (30 u): $850 c/u', 'Desde 5 displays (50 u): $720 c/u',
    ]);
  });
  test('AC-CAT-6 sin bulto usable o sin oferta que baje el precio no hay líneas, y el item del catálogo las trae', () => {
    expect(textosOfertasProducto({ precio: 1000, bultoX: 1, escalasBulto: [{ desde: 3, precio: 850 }] })).toEqual([]);
    expect(textosOfertasProducto({ precio: 1000, bultoX: 10, escalasBulto: [{ desde: 3, precio: 1200 }] })).toEqual([]);
    expect(armarCatalogo([{ ...base, id: 9, nombre: 'X', codigo: '1' }], [])[0].ofertas).toHaveLength(3);
  });
  test('AC-CAT-7 aplicarOfertasProducto guarda escalas válidas y borra con filas vacías', () => {
    const ok = aplicarOfertasProducto({ id: 1, precio: 1000, bultoX: 1 }, { bultoX: '12', filas: [{ desde: '3', valor: '950' }, { desde: '', valor: '' }] });
    expect(ok.ok).toBe(true);
    expect(ok.producto.bultoX).toBe(12);
    expect(ok.producto.escalasBulto).toEqual([{ desde: 3, precio: 950 }]);
    const borra = aplicarOfertasProducto({ id: 1, precio: 1000, bultoX: 12, escalasBulto: [{ desde: 3, precio: 950 }] }, { filas: filasOfertasEditor({}) });
    expect(borra.producto.escalasBulto).toEqual([]);
  });
  test('AC-CAT-7 sin Bulto x mayor a 1 o con precio inválido no guarda', () => {
    expect(aplicarOfertasProducto({ id: 1, precio: 1000, bultoX: 1 }, { filas: [{ desde: '3', valor: '950' }] }).ok).toBe(false);
    expect(aplicarOfertasProducto({ id: 1, precio: 1000, bultoX: 10 }, { filas: [{ desde: '3', valor: 'abc' }] }).ok).toBe(false);
  });
});
