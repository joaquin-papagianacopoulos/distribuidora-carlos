import {
  umbralStock, estadoStock, buscarProductos, filtrarStock, contarStockBajo,
  stockBajoDeProveedor, cantidadSugerida, textoContadorStockBajo,
} from '../stockBajo';
import { productosStockBajo } from '../stock';
import { validarProducto, productoExtraFromRemote, productoPreciosToRemote } from '../productos';

const P = (o) => ({ id: 1, nombre: 'Prod', codigo: 'A1', marca: '', categoria: '', minimoVenta: 1, ...o });

describe('AC-STB-1 umbralStock', () => {
  it('AC-STB-1 vacío/undefined/null usa Mínimo venta', () => {
    expect(umbralStock(P({ minimoVenta: 6 }))).toBe(6);
    expect(umbralStock(P({ minimoVenta: 6, stockMinimo: null }))).toBe(6);
    expect(umbralStock(P({ minimoVenta: 6, stockMinimo: '' }))).toBe(6);
    expect(umbralStock({})).toBe(0);
    expect(umbralStock(null)).toBe(0);
  });
  it('AC-STB-1 Stock mínimo cargado manda (0 incluido)', () => {
    expect(umbralStock(P({ minimoVenta: 6, stockMinimo: 10 }))).toBe(10);
    expect(umbralStock(P({ minimoVenta: 6, stockMinimo: 0 }))).toBe(0);
    expect(umbralStock(P({ minimoVenta: 6, stockMinimo: '12' }))).toBe(12);
  });
  it('AC-STB-1 valores inválidos (negativo, decimal, texto) caen al Mínimo venta', () => {
    expect(umbralStock(P({ minimoVenta: 3, stockMinimo: -2 }))).toBe(3);
    expect(umbralStock(P({ minimoVenta: 3, stockMinimo: 1.5 }))).toBe(3);
    expect(umbralStock(P({ minimoVenta: 3, stockMinimo: 'abc' }))).toBe(3);
  });
  it('AC-STK-7 productosStockBajo sin stockMinimo se comporta igual que antes y respeta stockMinimo', () => {
    const prods = [P({ id: 1, minimoVenta: 5 }), P({ id: 2, minimoVenta: 5, stockMinimo: 20 }), P({ id: 3, minimoVenta: 5 })];
    const m = new Map([['1', 5], ['2', 15], ['3', 6]]);
    expect(productosStockBajo(prods, m).map(p => p.id)).toEqual([1, 2]);
  });
  it('AC-STB-1 el formulario valida el campo y lo guarda vacío como null', () => {
    const base = { codigo: 'X1', nombre: 'Algo' };
    expect(validarProducto({ ...base }).producto.stockMinimo).toBeNull();
    expect(validarProducto({ ...base, stockMinimo: '' }).producto.stockMinimo).toBeNull();
    expect(validarProducto({ ...base, stockMinimo: '0' }).producto.stockMinimo).toBe(0);
    expect(validarProducto({ ...base, stockMinimo: '12' }).producto.stockMinimo).toBe(12);
    const mal = validarProducto({ ...base, stockMinimo: '-1' });
    expect(mal.ok).toBe(false);
    expect(mal.errores.stockMinimo).toBeTruthy();
    expect(validarProducto({ ...base, stockMinimo: '1.5' }).ok).toBe(false);
  });
  it('AC-STB-1 round-trip remoto: stock_minimo viaja y vuelve; sin la columna se conserva el local', () => {
    expect(productoPreciosToRemote({ precioBulto: 0, stockMinimo: 8 }).stock_minimo).toBe(8);
    expect(productoPreciosToRemote({ precioBulto: 0, stockMinimo: null }).stock_minimo).toBeNull();
    expect('stock_minimo' in productoPreciosToRemote({ precioBulto: 0 })).toBe(false);
    expect(productoExtraFromRemote({ stock_minimo: 8 }, {}).stockMinimo).toBe(8);
    expect(productoExtraFromRemote({ stock_minimo: null }, { stockMinimo: 3 }).stockMinimo).toBeNull();
    expect(productoExtraFromRemote({}, { stockMinimo: 3 }).stockMinimo).toBe(3);
    expect(productoExtraFromRemote({}, {}).stockMinimo).toBeNull();
  });
});

describe('AC-STB-2 estado y búsqueda', () => {
  it('AC-STB-2 estados: negativo, sin stock, bajo, ok', () => {
    const p = P({ minimoVenta: 5 });
    expect(estadoStock(p, -1)).toBe('negativo');
    expect(estadoStock(p, 0)).toBe('sin_stock');
    expect(estadoStock(p, 5)).toBe('bajo');
    expect(estadoStock(p, 1)).toBe('bajo');
    expect(estadoStock(p, 6)).toBe('ok');
    expect(estadoStock(P({ minimoVenta: 0 }), 0)).toBe('sin_stock');
    expect(estadoStock(P({ minimoVenta: 0 }), 1)).toBe('ok');
  });

  const prods = [
    P({ id: 1, nombre: 'Detergente Ariel Limón', codigo: 'DET-01', marca: 'Ariel', categoria: 'Limpieza', proveedorId: 'p1', minimoVenta: 4 }),
    P({ id: 2, nombre: 'Jabón en polvo', codigo: 'JAB-02', marca: 'Skip', categoria: 'Limpieza', proveedorId: 'p2', minimoVenta: 2 }),
    P({ id: 3, nombre: 'Alfajor Triple', codigo: 'ALF-03', marca: 'Havanna', categoria: 'Golosinas', proveedorId: 'p1', minimoVenta: 1, stockMinimo: 10 }),
  ];
  const mapa = new Map([['1', 3], ['2', 0], ['3', 50]]);

  it('AC-STB-2 busca sin tildes ni mayúsculas, en cualquier orden de palabras', () => {
    expect(buscarProductos(prods, 'LIMON detergente').map(p => p.id)).toEqual([1]);
    expect(buscarProductos(prods, 'jabon').map(p => p.id)).toEqual([2]);
    expect(buscarProductos(prods, '  polvo   jabón ').map(p => p.id)).toEqual([2]);
  });
  it('AC-STB-2 busca por código y por marca', () => {
    expect(buscarProductos(prods, 'alf-03').map(p => p.id)).toEqual([3]);
    expect(buscarProductos(prods, 'havanna').map(p => p.id)).toEqual([3]);
    expect(buscarProductos(prods, 'ariel det').map(p => p.id)).toEqual([1]);
  });
  it('AC-STB-2 búsqueda vacía o sin resultados', () => {
    expect(buscarProductos(prods, '')).toHaveLength(3);
    expect(buscarProductos(prods, '   ')).toHaveLength(3);
    expect(buscarProductos(prods, 'zzz')).toEqual([]);
    expect(buscarProductos(null, 'a')).toEqual([]);
  });
  it('AC-STB-2 filtros por rubro, marca, proveedor y estado', () => {
    expect(filtrarStock(prods, mapa, { rubro: 'limpieza' }).map(f => f.producto.id)).toEqual([1, 2]);
    expect(filtrarStock(prods, mapa, { marca: 'SKIP' }).map(f => f.producto.id)).toEqual([2]);
    expect(filtrarStock(prods, mapa, { proveedorId: 'p1' }).map(f => f.producto.id)).toEqual([1, 3]);
    expect(filtrarStock(prods, mapa, { estado: 'sin_stock' }).map(f => f.producto.id)).toEqual([2]);
    expect(filtrarStock(prods, mapa, { estado: 'bajo' }).map(f => f.producto.id)).toEqual([1]);
    expect(filtrarStock(prods, mapa, { estado: 'alerta' }).map(f => f.producto.id)).toEqual([1, 2]);
    expect(filtrarStock(prods, mapa, { estado: 'ok' }).map(f => f.producto.id)).toEqual([3]);
    expect(filtrarStock(prods, mapa, { estado: 'negativo' })).toEqual([]);
    expect(filtrarStock(prods, mapa, { estado: 'todos' })).toHaveLength(3);
  });
  it('AC-STB-2 combina búsqueda y filtros; producto sin movimientos tiene stock 0', () => {
    const r = filtrarStock(prods, new Map(), { query: 'alfajor', estado: 'sin_stock' });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ stock: 0, estado: 'sin_stock', umbral: 10 });
    expect(filtrarStock(prods, mapa, { query: 'alfajor', rubro: 'Limpieza' })).toEqual([]);
  });
  it('AC-STB-2 el estado negativo se detecta', () => {
    const r = filtrarStock(prods, new Map([['1', -4]]), { estado: 'negativo' });
    expect(r.map(f => f.producto.id)).toEqual([1]);
  });
});

describe('AC-STB-3 contador y reposición', () => {
  const prods = [
    P({ id: 1, minimoVenta: 4, proveedorId: 'p1', bultoX: 1 }),
    P({ id: 2, minimoVenta: 2, proveedorId: 'p2' }),
    P({ id: 3, minimoVenta: 1, stockMinimo: 30, proveedorId: 'p1', bultoX: 12 }),
    P({ id: 4, minimoVenta: 1 }),
  ];
  const mapa = new Map([['1', 3], ['2', 50], ['3', 5], ['4', 0]]);

  it('AC-STB-3 cuenta bajo + sin stock + negativo', () => {
    expect(contarStockBajo(prods, mapa)).toBe(3);
    expect(contarStockBajo(prods, new Map([['2', 50]]))).toBe(3);
    expect(contarStockBajo([], mapa)).toBe(0);
    expect(contarStockBajo(prods.slice(0, 2), new Map([['1', -2], ['2', 50]]))).toBe(1);
  });
  it('AC-STB-3 texto del contador (singular/plural/cero)', () => {
    expect(textoContadorStockBajo(0)).toBe('Sin productos con stock bajo');
    expect(textoContadorStockBajo(1)).toBe('1 producto con stock bajo');
    expect(textoContadorStockBajo(5)).toBe('5 productos con stock bajo');
  });
  it('AC-STB-3 sugerido: lo que falta (mín. 1) redondeado al bulto', () => {
    expect(cantidadSugerida(prods[0], 3)).toBe(1);
    expect(cantidadSugerida(prods[2], 5)).toBe(36); // faltan 25 => 3 bultos de 12
    expect(cantidadSugerida(prods[3], 0)).toBe(1);
    expect(cantidadSugerida(P({ minimoVenta: 10 }), -5)).toBe(15);
  });
  it('AC-STB-3 stock bajo de un proveedor', () => {
    expect(stockBajoDeProveedor(prods, mapa, 'p1')).toEqual([
      { productoId: '1', sugerido: 1 },
      { productoId: '3', sugerido: 36 },
    ]);
    expect(stockBajoDeProveedor(prods, mapa, 'p2')).toEqual([]);
    expect(stockBajoDeProveedor(prods, mapa, 'inexistente')).toEqual([]);
  });
  it('AC-STB-3 sin proveedor elegido devuelve los que tienen proveedor asignado', () => {
    expect(stockBajoDeProveedor(prods, mapa).map(x => x.productoId)).toEqual(['1', '3']);
  });
});
