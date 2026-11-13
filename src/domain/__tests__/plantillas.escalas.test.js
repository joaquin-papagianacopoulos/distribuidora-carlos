// AC-ESC-1: columna "Escalas por bulto" en la plantilla Excel.
import { COLUMNAS_PLANTILLA, mapearEncabezados, planificarImportacion, validarFilaProducto } from '../plantillas';

const CAB = ['Código', 'Descripción', 'Precio por unidad', 'Bulto x', 'Escalas por bulto'];

describe('AC-ESC-1 plantilla de productos con escalas', () => {
  it('AC-ESC-1 la plantilla trae la columna al final con instrucciones y ejemplo', () => {
    const cols = COLUMNAS_PLANTILLA.productos;
    const c = cols[cols.length - 1];
    expect(c.key).toBe('escalasBulto');
    expect(c.formato).toMatch(/3=950; 10=900/);
    expect(c.formato).toMatch(/POR UNIDAD/);
    expect(c.formato).toMatch(/Vacío = se conserva/);
    expect(c.formato).toMatch(/"-"/);
  });
  it.each(['Escalas', 'Escalas bulto', 'escalas por bulto', 'Descuento por escala'])('AC-ESC-1 alias de encabezado %s', (h) => {
    expect(mapearEncabezados(['Código', 'Descripción', h], 'productos').indices.escalasBulto).toBe(2);
  });
  it('AC-ESC2-2 importa precios directos 3=950; 10=900,50', () => {
    const plan = planificarImportacion([CAB, ['A1', 'Algo', '1000', '10', '3=950; 10=900,50']], 'productos', { existentes: [] });
    expect(plan.entradas[0].errores).toEqual([]);
    expect(plan.entradas[0].valor.producto.escalasBulto).toEqual([{ desde: 3, precio: 950 }, { desde: 10, precio: 900.5 }]);
  });
  it('AC-ESC2-2 acepta $ y punto de miles: 3=$1.250', () => {
    const plan = planificarImportacion([CAB, ['A1', 'Algo', '1500', '10', '3=$1.250']], 'productos', { existentes: [] });
    expect(plan.entradas[0].errores).toEqual([]);
    expect(plan.entradas[0].valor.producto.escalasBulto).toEqual([{ desde: 3, precio: 1250 }]);
  });
  it('AC-ESC2-2 con "%" sigue importando el formato viejo: 5=8%; 10=7,5%', () => {
    const plan = planificarImportacion([CAB, ['A1', 'Algo', '1000', '10', '5=8%; 10=7,5%']], 'productos', { existentes: [] });
    expect(plan.entradas[0].errores).toEqual([]);
    expect(plan.entradas[0].valor.producto.escalasBulto).toEqual([{ desde: 5, pct: 8 }, { desde: 10, pct: 7.5 }]);
  });
  it('AC-ESC2-2 vacío conserva las escalas con precio del existente', () => {
    const existentes = [{ id: 5, codigo: 'A1', nombre: 'Algo', precio: 1000, bultoX: 10, escalasBulto: [{ desde: 3, precio: 950 }] }];
    const vacio = planificarImportacion([CAB, ['A1', 'Algo', '1000', '10', '']], 'productos', { existentes });
    expect(vacio.entradas[0].valor.producto.escalasBulto).toEqual([{ desde: 3, precio: 950 }]);
  });
  it('AC-ESC-1 vacío conserva las del existente y "-" las borra', () => {
    const existentes = [{ id: 5, codigo: 'A1', nombre: 'Algo', precio: 1000, bultoX: 10, escalasBulto: [{ desde: 5, pct: 8 }] }];
    const vacio = planificarImportacion([CAB, ['A1', 'Algo', '1000', '10', '']], 'productos', { existentes });
    expect(vacio.entradas[0].valor.producto.escalasBulto).toEqual([{ desde: 5, pct: 8 }]);
    const borra = planificarImportacion([CAB, ['A1', 'Algo', '1000', '10', '-']], 'productos', { existentes });
    expect(borra.entradas[0].errores).toEqual([]);
    expect(borra.entradas[0].valor.producto.escalasBulto).toEqual([]);
  });
  it('AC-ESC2-4 una escala inválida NO rechaza la fila: se importa sin escalas y se avisa con el motivo', () => {
    for (const celda of ['5=150%', '5=0', '5=-10', '10=8; 5=9', 'hola', '1=5', '5=8; 6=9; 7=10; 8=11']) {
      const plan = planificarImportacion([CAB, ['A1', 'Algo', '1000', '10', celda]], 'productos', { existentes: [] });
      const e = plan.entradas[0];
      expect(e.accion).toBe('crear');
      expect(e.errores).toEqual([]);
      expect(e.valor.producto.precio).toBe(1000);
      expect(e.valor.producto.escalasBulto).toEqual([]);
      expect(e.avisos.join(' ')).toMatch(/Escalas por bulto no importadas/);
    }
  });
  it('AC-ESC2-4 escalas con Bulto x = 1: la fila entra sin escalas y el aviso nombra Bulto x', () => {
    const plan = planificarImportacion([CAB, ['A1', 'Algo', '1000', '1', '5=800']], 'productos', { existentes: [] });
    expect(plan.entradas[0].accion).toBe('crear');
    expect(plan.entradas[0].valor.producto.escalasBulto).toEqual([]);
    expect(plan.entradas[0].avisos.join(' ')).toMatch(/Bulto x/);
  });
  it('AC-ESC2-4 producto existente con precio igual al costo: una escala inválida no impide corregir el precio', () => {
    const existentes = [{ id: 5, codigo: '1150', nombre: 'Alcohol', precio: 1383.6, costoFinal: 1383.6, ganancia: 0, bultoX: 12, escalasBulto: [{ desde: 3, precio: 1650 }] }];
    const cab = ['Código', 'Descripción', 'Costo final', 'Precio por unidad', 'Precio por unidad llevando bulto', 'Bulto x', 'Escalas por bulto'];
    const plan = planificarImportacion([cab, ['1150', 'Alcohol', '1,383.60', '1,780.00', '1700', '12', '1=1700; 3=1620']], 'productos', { existentes });
    const e = plan.entradas[0];
    expect(e.accion).toBe('actualizar');
    expect(e.valor.producto).toMatchObject({ precio: 1780, precioBulto: 1700, costoFinal: 1383.6 });
    // se conservan las escalas válidas que ya tenía
    expect(e.valor.producto.escalasBulto).toEqual([{ desde: 3, precio: 1650 }]);
    expect(e.avisos.join(' ')).toMatch(/Escalas por bulto no importadas/);
    expect(plan.resumen.rechazados).toBe(0);
  });
  it('AC-ESC2-4 un error en otra columna sigue rechazando la fila', () => {
    const plan = planificarImportacion([CAB, ['A1', 'Algo', 'abc', '10', '1=5']], 'productos', { existentes: [] });
    expect(plan.entradas[0].accion).toBe('rechazar');
  });
  it('AC-ESC-1 el texto con fórmula no se interpreta (anti formula injection): se descarta la escala', () => {
    const r = validarFilaProducto({ codigo: 'A1', nombre: 'Algo', precio: '1000', bultoX: '10', escalasBulto: '=cmd|x' });
    expect(r.ok).toBe(true);
    expect(r.valor.producto.escalasBulto).toEqual([]);
    expect(r.avisos.join(' ')).toMatch(/Escalas por bulto no importadas/);
  });
  it('AC-ESC-1 ida y vuelta: lo exportado se vuelve a importar igual', () => {
    const plan = planificarImportacion([CAB, ['A1', 'Algo', '1000', '10', '3=950; 10=900']], 'productos', { existentes: [] });
    expect(plan.entradas[0].valor.producto.escalasBulto).toEqual([{ desde: 3, precio: 950 }, { desde: 10, precio: 900 }]);
  });
});
