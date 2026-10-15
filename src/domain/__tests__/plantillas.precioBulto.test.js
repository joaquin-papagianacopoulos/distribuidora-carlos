// AC-PBU-2: plantilla Excel con "Precio por unidad" y "Precio por unidad llevando bulto".
import { COLUMNAS_PLANTILLA, mapearEncabezados, planificarImportacion } from '../plantillas';
import { filaProductoRpc } from '../productosRpc';

describe('AC-PBU-2 plantilla de productos', () => {
  it('AC-PBU-2 la plantilla trae las dos columnas nuevas y ya no "Precio venta 1"', () => {
    const labels = COLUMNAS_PLANTILLA.productos.map(c => c.label);
    expect(labels).toContain('Precio por unidad');
    expect(labels).toContain('Precio por unidad llevando bulto');
    expect(labels).not.toContain('Precio venta 1');
  });
  it('AC-PBU-2 un Excel viejo con "Precio venta 1" se sigue importando', () => {
    const m = mapearEncabezados(['Código', 'Descripción', 'Precio venta 1'], 'productos');
    expect(m.indices.precio).toBe(2);
    const plan = planificarImportacion([['Código', 'Descripción', 'Precio venta 1'], ['A1', 'Algo', '150']], 'productos', { existentes: [] });
    expect(plan.entradas[0].errores).toEqual([]);
    expect(plan.entradas[0].valor.producto.precio).toBe(150);
    expect(plan.entradas[0].valor.producto.precioBulto).toBe(0);
  });
  it('AC-PBU-2 importa precio llevando bulto y lo conserva si la celda viene vacía o con "-"', () => {
    const cab = ['Código', 'Descripción', 'Precio por unidad', 'Precio por unidad llevando bulto'];
    const nuevo = planificarImportacion([cab, ['A1', 'Algo', '900', '800']], 'productos', { existentes: [] });
    expect(nuevo.entradas[0].valor.producto).toMatchObject({ precio: 900, precioBulto: 800 });
    const existentes = [{ id: 5, codigo: 'A1', nombre: 'Algo', precio: 900, precioBulto: 800 }];
    for (const celda of ['', '-']) {
      const plan = planificarImportacion([cab, ['A1', 'Algo', '950', celda]], 'productos', { existentes });
      expect(plan.entradas[0].valor.producto).toMatchObject({ precio: 950, precioBulto: 800 });
    }
  });
  it('AC-PBU-2 precio llevando bulto negativo se rechaza', () => {
    const cab = ['Código', 'Descripción', 'Precio por unidad', 'Precio por unidad llevando bulto'];
    const plan = planificarImportacion([cab, ['A1', 'Algo', '900', '-5']], 'productos', { existentes: [] });
    expect(plan.entradas[0].errores.length).toBeGreaterThan(0);
  });
  it('AC-PBU-2 el RPC de productos con extras lleva precio_bulto', () => {
    expect(filaProductoRpc({ id: 1, precio: 900, precioBulto: 800 }, { conExtras: true }).precio_bulto).toBe(800);
    expect(filaProductoRpc({ id: 1, precio: 900, precioBulto: 800 }, { conExtras: false })).not.toHaveProperty('precio_bulto');
  });
});
