// S-012-01 (migracion 013): costos de productos privados. Dominio puro.
import {
  COLUMNAS_PRODUCTO_PUBLICAS, COSTOS_PRODUCTO, columnasSinFaltante, conservarCostosDesconocidos,
  productoExtraToRemote, productoExtraFromRemote, aplicarCostosRemotos,
} from '../productos';

const INTERNAS = ['costo_final', 'descuento1', 'descuento2', 'ganancia', 'precio_venta2'];

describe('S-012-01 columnas publicas de productos', () => {
  it('S-012-01 la lista publica no incluye costos ni "*"', () => {
    INTERNAS.forEach(c => expect(COLUMNAS_PRODUCTO_PUBLICAS).not.toContain(c));
    expect(COLUMNAS_PRODUCTO_PUBLICAS).not.toContain('*');
    expect(COSTOS_PRODUCTO.map(([c]) => c)).toEqual(INTERNAS);
    ['id', 'nombre', 'precio', 'imagen_url', 'visible_tienda', 'precio_bulto', 'stock_minimo'].forEach(c => expect(COLUMNAS_PRODUCTO_PUBLICAS).toContain(c));
  });

  it('S-012-01 columnasSinFaltante descarta la columna que nombra el error (migracion sin aplicar)', () => {
    const cols = ['id', 'nombre', 'precio_bulto', 'stock_minimo'];
    expect(columnasSinFaltante(cols, { code: '42703', message: 'column productos.stock_minimo does not exist' })).toEqual(['id', 'nombre', 'precio_bulto']);
    expect(columnasSinFaltante(cols, { message: 'column "precio_bulto" does not exist' })).toEqual(['id', 'nombre', 'stock_minimo']);
    expect(columnasSinFaltante(cols, { message: 'permission denied for table productos' })).toBeNull();
    expect(columnasSinFaltante(cols, { message: 'column productos.id does not exist' })).toBeNull();
    expect(columnasSinFaltante(cols, { message: 'column productos.otra does not exist' })).toBeNull();
  });
});

describe('S-012-01 sin PIN el dispositivo conserva sus costos y nunca los pisa con vacio', () => {
  it('S-012-01 fila remota sin columnas de costo => se conservan los locales', () => {
    const local = { costoFinal: 80, descuento1: 5, descuento2: 0, ganancia: 40, precioVenta2: 130 };
    expect(productoExtraFromRemote({ bulto_x: 2 }, local)).toMatchObject(local);
  });

  it('S-012-01 sin dato local ni remoto el costo queda desconocido (undefined), no 0', () => {
    const r = productoExtraFromRemote({ bulto_x: 2 }, {});
    INTERNAS.forEach((_, i) => expect(r[COSTOS_PRODUCTO[i][1]]).toBeUndefined());
    expect(r.bultoX).toBe(2);
  });

  it('S-012-01 productoExtraToRemote no manda costos desconocidos (el servidor conserva los suyos)', () => {
    const fila = productoExtraToRemote({ costoFinal: 120, bultoX: 2 });
    expect(fila).toMatchObject({ costo_final: 120, bulto_x: 2 });
    ['descuento1', 'descuento2', 'ganancia', 'precio_venta2'].forEach(c => expect(fila).not.toHaveProperty(c));
    expect(productoExtraToRemote({ costoFinal: 0, descuento1: 0, ganancia: 0, descuento2: 0, precioVenta2: 0 })).toMatchObject({ costo_final: 0, ganancia: 0 });
  });

  it('S-012-01 conservarCostosDesconocidos: el 0 por defecto del form no pisa un costo desconocido', () => {
    const previo = { id: 1 };
    const out = conservarCostosDesconocidos(previo, { nombre: 'x', costoFinal: 0, descuento1: 0, ganancia: 30, precioVenta2: '' });
    expect(out.costoFinal).toBeUndefined();
    expect(out.descuento1).toBeUndefined();
    expect(out.precioVenta2).toBeUndefined();
    expect(out.ganancia).toBe(30);
    // Con costo conocido, el 0 cargado a mano si viaja.
    expect(conservarCostosDesconocidos({ costoFinal: 50 }, { costoFinal: 0 }).costoFinal).toBe(0);
  });

  it('S-012-01 aplicarCostosRemotos: aplica solo sobre productos sin cambios pendientes', () => {
    const locales = [
      { id: 1, nombre: 'a', costoFinal: undefined },
      { id: 2, nombre: 'b', costoFinal: 10, pendingSync: true },
      { id: 3, nombre: 'c', costoFinal: 5, descuento1: 0, descuento2: 0, ganancia: 10, precioVenta2: 0 },
    ];
    const remotos = [
      { id: 1, costo_final: '100.50', descuento1: 5, descuento2: 0, ganancia: 30, precio_venta2: 0 },
      { id: 2, costo_final: 999, descuento1: 0, descuento2: 0, ganancia: 0, precio_venta2: 0 },
      { id: 3, costo_final: 5, descuento1: 0, descuento2: 0, ganancia: 10, precio_venta2: 0 },
      { id: 9, costo_final: 1 },
    ];
    const out = aplicarCostosRemotos(locales, remotos);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 1, nombre: 'a', costoFinal: 100.5, descuento1: 5, ganancia: 30 });
  });
});
