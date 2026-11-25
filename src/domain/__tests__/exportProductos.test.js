// AC-XLS-1: exportación de productos actuales (mismas columnas de la plantilla, re-subible).
import { armarExportProductos, COLUMNAS_PLANTILLA, planificarImportacion } from '../plantillas';

const prod = { id: 1, codigo: 'CC500', nombre: 'Coca 500', categoria: 'Bebidas', marca: 'Coca', precio: 1000, precioBulto: 900, bultoX: 12, bultoNombre: 'Display', ventaPor: 'ambos', escalasBulto: [{ desde: 3, precio: 850 }], visibleTienda: false, proveedorId: 'p1' };

describe('AC-XLS-1 exportar productos actuales', () => {
  test('AC-XLS-1 hoja con las mismas columnas que la plantilla y una fila por producto', () => {
    const r = armarExportProductos([prod], { proveedores: [{ id: 'p1', descripcion: 'Arcor' }] });
    const [head, fila] = r.hojas[0].filas;
    expect(head).toEqual(COLUMNAS_PLANTILLA.productos.map(c => c.label));
    const celda = (k) => fila[COLUMNAS_PLANTILLA.productos.findIndex(c => c.key === k)];
    expect(celda('codigo')).toBe('CC500');
    expect(celda('escalasBulto')).toBe('3=850');
    expect(celda('visibleTienda')).toBe('No');
    expect(celda('proveedorId')).toBe('Arcor');
    expect(celda('stock')).toBe('');
    expect(r.nombreArchivo).toMatch(/^productos_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}\.xlsx$/);
  });
  test('AC-XLS-1 lo exportado se puede volver a importar sin cambios (actualiza, no duplica)', () => {
    const r = armarExportProductos([prod], { proveedores: [{ id: 'p1', descripcion: 'Arcor' }] });
    const plan = planificarImportacion(r.hojas[0].filas, 'productos', { existentes: [prod], proveedores: [{ id: 'p1', descripcion: 'Arcor' }] });
    expect(plan.ok).toBe(true);
    expect(plan.resumen.rechazados).toBe(0);
    expect(plan.resumen.creados).toBe(0);
    expect(plan.entradas[0].accion).toBe('actualizar');
    expect(plan.entradas[0].valor.producto.escalasBulto).toEqual([{ desde: 3, precio: 850 }]);
    expect(plan.entradas[0].valor.producto.precio).toBe(1000);
  });
});
