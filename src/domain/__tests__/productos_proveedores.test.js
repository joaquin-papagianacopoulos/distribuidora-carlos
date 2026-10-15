import { calcularPrecioVenta, validarProducto, CAMPOS_PRODUCTO, productoExtraToRemote, productoExtraFromRemote, avisosItemPedido } from '../productos';
import { validarProveedor, puedeBorrarProveedor, proveedorToRemote, proveedorFromRemote, CAMPOS_PROVEEDOR } from '../proveedores';

const proveedores = [{ id: 'p-1', codigo: 'ARC', descripcion: 'Arcor' }];

describe('REQ-PROV proveedores', () => {
  it('AC-PROV-1 campos código y descripción', () => {
    expect(CAMPOS_PROVEEDOR.map(c => c.label)).toEqual(['Código', 'Descripción']);
    expect(validarProveedor({ codigo: 'X', descripcion: 'Y' }).ok).toBe(true);
    expect(Object.keys(validarProveedor({}).errores)).toEqual(['codigo', 'descripcion']);
  });
  it('AC-PROV-2 rechaza código duplicado salvo al editar el mismo', () => {
    expect(validarProveedor({ codigo: 'arc', descripcion: 'Otro' }, proveedores).errores.codigo).toMatch(/Arcor/);
    expect(validarProveedor({ codigo: 'arc', descripcion: 'Arcor SA' }, proveedores, { editId: 'p-1' }).ok).toBe(true);
  });
  it('AC-PROV-3 no se borra con productos asociados', () => {
    expect(puedeBorrarProveedor('p-1', [{ proveedorId: 'p-1' }, { proveedorId: 'p-2' }, null])).toEqual({ ok: false, asociados: 1 });
    expect(puedeBorrarProveedor('p-9', [{ proveedorId: 'p-1' }]).ok).toBe(true);
  });
  it('AC-PROV-4 mapeo a/desde Supabase con id UUID', () => {
    expect(proveedorToRemote({ id: 'u', codigo: 'c', descripcion: 'd', pendingSync: true })).toEqual({ id: 'u', codigo: 'c', descripcion: 'd' });
    expect(proveedorFromRemote({ id: 'u', codigo: null, descripcion: 'd' })).toEqual({ id: 'u', codigo: '', descripcion: 'd', pendingSync: false });
  });
});

describe('REQ-PROD productos', () => {
  it('AC-PROD-1 fórmula de precio: costo, descuentos en cascada y ganancia', () => {
    // 1000 −10% = 900 −5% = 855 ; +30% = 1111.5
    expect(calcularPrecioVenta({ costoFinal: 1000, descuento1: 10, descuento2: 5, ganancia: 30 })).toEqual({ costoNeto: 855, precioVenta1: 1111.5 });
    expect(calcularPrecioVenta({ costoFinal: '1.234,50', descuento1: '', descuento2: null, ganancia: '0' })).toEqual({ costoNeto: 1234.5, precioVenta1: 1234.5 });
    expect(calcularPrecioVenta({ costoFinal: 100, descuento1: 100, ganancia: 50 }).precioVenta1).toBe(0);
    expect(calcularPrecioVenta({}).precioVenta1).toBe(0);
    // valores fuera de rango se acotan
    expect(calcularPrecioVenta({ costoFinal: 100, descuento1: 150, ganancia: -20 }).precioVenta1).toBe(0);
    expect(calcularPrecioVenta({ costoFinal: 100, descuento1: -10, ganancia: -20 }).precioVenta1).toBe(100);
  });
  it('AC-PROD-1 redondea a 2 decimales', () => {
    expect(calcularPrecioVenta({ costoFinal: 10, descuento1: 33.333, ganancia: 0 }).precioVenta1).toBe(6.67);
  });
  it('AC-PROD-2 precio = precio venta 1 (calculado si no se carga a mano)', () => {
    const r = validarProducto({ codigo: 'A1', nombre: 'Alfajor', costoFinal: '100', ganancia: '50' }, { proveedores });
    expect(r.ok).toBe(true);
    expect(r.producto.precio).toBe(150);
    const manual = validarProducto({ codigo: 'A1', nombre: 'Alfajor', costoFinal: '100', ganancia: '50', precio: '199,90' }, { proveedores });
    expect(manual.producto.precio).toBe(199.9);
  });
  it('AC-PROD-1 tiene las 13 etiquetas pedidas', () => {
    expect(CAMPOS_PRODUCTO.map(c => c.label)).toEqual(['Código', 'Descripción', 'Rubro', 'Marca', 'Proveedor', 'Costo final', 'Descuento 1', 'Descuento 2', '% Ganancia', 'Precio por unidad', 'Precio por unidad llevando bulto', 'Precio venta 2', 'Bulto x', 'Se vende por', 'Etiqueta del bulto', 'Mostrar en tienda', 'Mínimo venta', 'Stock']);
  });
  it('obligatorios, duplicados y proveedor inexistente', () => {
    const r = validarProducto({ codigo: 'dup', nombre: '', proveedorId: 'nope' }, { existentes: [{ id: 5, codigo: 'DUP', nombre: 'X' }], proveedores });
    expect(Object.keys(r.errores)).toEqual(expect.arrayContaining(['codigo', 'nombre', 'proveedorId']));
    expect(validarProducto({ codigo: 'dup', nombre: 'Y' }, { existentes: [{ id: 5, codigo: 'DUP' }], editId: 5 }).ok).toBe(true);
  });
  it('rechaza números inválidos (negativos, NaN, decimales en enteros)', () => {
    const r = validarProducto({
      codigo: 'Z', nombre: 'Z', costoFinal: '-1', descuento1: '101', descuento2: 'abc', ganancia: '-5',
      precio: '-3', precioVenta2: 'x', bultoX: '1.5', minimoVenta: '0', stock: '-2',
    });
    expect(Object.keys(r.errores)).toEqual(expect.arrayContaining(['costoFinal', 'descuento1', 'descuento2', 'ganancia', 'precio', 'precioVenta2', 'bultoX', 'minimoVenta', 'stock']));
    expect(validarProducto({ codigo: 'Z', nombre: 'Z', ganancia: '5000' }).errores.ganancia).toBeTruthy();
  });
  it('AC-PROD-3 devuelve stock aparte (no dentro del producto)', () => {
    const r = validarProducto({ codigo: 'S', nombre: 'S', stock: '24' });
    expect(r.stock).toBe(24);
    expect(r.producto.stock).toBeUndefined();
    expect(validarProducto({ codigo: 'S', nombre: 'S' }).stock).toBeNull();
    expect(validarProducto({ codigo: 'S', nombre: 'S', bultoX: '', minimoVenta: '' }).producto).toMatchObject({ bultoX: 1, minimoVenta: 1 });
  });
  it('AC-PROD-4 avisos de mínimo de venta y stock al cargar pedido', () => {
    expect(avisosItemPedido({ minimoVenta: 6 }, 2, 10)).toEqual(['Mínimo de venta: 6']);
    expect(avisosItemPedido({ minimoVenta: 1 }, 12, 10)).toEqual(['Sin stock (hay 10)']);
    expect(avisosItemPedido(undefined, 1, undefined)).toEqual([]);
  });
  it('mapeo de columnas nuevas de productos (tolerante)', () => {
    expect(productoExtraToRemote({ proveedorId: 'p-1', costoFinal: '10', bultoX: 0 })).toMatchObject({ proveedor_id: 'p-1', costo_final: 10, bulto_x: 1, minimo_venta: 1 });
    expect(productoExtraFromRemote({ costo_final: '50', bulto_x: null }, { ganancia: 20 })).toMatchObject({ costoFinal: 50, bultoX: 1, ganancia: 20, proveedorId: null });
    expect(productoExtraFromRemote(undefined, undefined).minimoVenta).toBe(1);
  });
});
