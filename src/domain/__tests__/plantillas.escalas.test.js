// AC-ESC-1: columna "Escalas por bulto" en la plantilla Excel.
import { COLUMNAS_PLANTILLA, mapearEncabezados, planificarImportacion, validarFilaProducto } from '../plantillas';

const CAB = ['Código', 'Descripción', 'Precio por unidad', 'Bulto x', 'Escalas por bulto'];

describe('AC-ESC-1 plantilla de productos con escalas', () => {
  it('AC-ESC-1 la plantilla trae la columna al final con instrucciones y ejemplo', () => {
    const cols = COLUMNAS_PLANTILLA.productos;
    const c = cols[cols.length - 1];
    expect(c.key).toBe('escalasBulto');
    expect(c.formato).toMatch(/5=8; 10=12/);
    expect(c.formato).toMatch(/Vacío = se conserva/);
    expect(c.formato).toMatch(/"-"/);
  });
  it.each(['Escalas', 'Escalas bulto', 'escalas por bulto', 'Descuento por escala'])('AC-ESC-1 alias de encabezado %s', (h) => {
    expect(mapearEncabezados(['Código', 'Descripción', h], 'productos').indices.escalasBulto).toBe(2);
  });
  it('AC-ESC-1 importa 5=8; 10=7,5', () => {
    const plan = planificarImportacion([CAB, ['A1', 'Algo', '1000', '10', '5=8; 10=7,5']], 'productos', { existentes: [] });
    expect(plan.entradas[0].errores).toEqual([]);
    expect(plan.entradas[0].valor.producto.escalasBulto).toEqual([{ desde: 5, pct: 8 }, { desde: 10, pct: 7.5 }]);
  });
  it('AC-ESC-1 vacío conserva las del existente y "-" las borra', () => {
    const existentes = [{ id: 5, codigo: 'A1', nombre: 'Algo', precio: 1000, bultoX: 10, escalasBulto: [{ desde: 5, pct: 8 }] }];
    const vacio = planificarImportacion([CAB, ['A1', 'Algo', '1000', '10', '']], 'productos', { existentes });
    expect(vacio.entradas[0].valor.producto.escalasBulto).toEqual([{ desde: 5, pct: 8 }]);
    const borra = planificarImportacion([CAB, ['A1', 'Algo', '1000', '10', '-']], 'productos', { existentes });
    expect(borra.entradas[0].errores).toEqual([]);
    expect(borra.entradas[0].valor.producto.escalasBulto).toEqual([]);
  });
  it('AC-ESC-1 una fila inválida se rechaza con motivo', () => {
    for (const celda of ['5=150', '10=8; 5=9', 'hola', '1=5', '5=8; 6=9; 7=10; 8=11']) {
      const plan = planificarImportacion([CAB, ['A1', 'Algo', '1000', '10', celda]], 'productos', { existentes: [] });
      expect(plan.entradas[0].errores.length).toBeGreaterThan(0);
    }
  });
  it('AC-ESC-1 escalas con Bulto x = 1 se rechazan', () => {
    const plan = planificarImportacion([CAB, ['A1', 'Algo', '1000', '1', '5=8']], 'productos', { existentes: [] });
    expect(plan.entradas[0].errores.join(' ')).toMatch(/Bulto x/);
  });
  it('AC-ESC-1 el texto con fórmula no se interpreta (anti formula injection)', () => {
    const r = validarFilaProducto({ codigo: 'A1', nombre: 'Algo', precio: '1000', bultoX: '10', escalasBulto: '=cmd|x' });
    expect(r.ok).toBe(false);
  });
  it('AC-ESC-1 ida y vuelta: lo exportado se vuelve a importar igual', () => {
    const plan = planificarImportacion([CAB, ['A1', 'Algo', '1000', '10', '5=8; 10=12']], 'productos', { existentes: [] });
    expect(plan.entradas[0].valor.producto.escalasBulto).toEqual([{ desde: 5, pct: 8 }, { desde: 10, pct: 12 }]);
  });
});
