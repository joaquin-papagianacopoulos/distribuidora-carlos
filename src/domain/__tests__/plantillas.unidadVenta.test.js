// REQ-VTA (AC-VTA-1): la plantilla Excel de productos suma Marca, Se vende por,
// Etiqueta del bulto y Mostrar en tienda; un Excel viejo sin ellas importa igual.
import {
  COLUMNAS_PLANTILLA, mapearEncabezados, validarFilaProducto, planificarImportacion, filasInstrucciones, armarPlantilla,
} from '../plantillas';

const LABELS_NUEVAS = ['Marca', 'Se vende por', 'Etiqueta del bulto', 'Mostrar en tienda'];
const LABELS_P = COLUMNAS_PLANTILLA.productos.map(c => c.label);
const fila = (obj) => LABELS_P.map(l => obj[l] ?? '');

describe('AC-VTA-1 plantilla de productos con unidad de venta', () => {
  it('AC-VTA-1 las 4 columnas nuevas estan en la plantilla, con instrucciones', () => {
    for (const l of LABELS_NUEVAS) expect(LABELS_P).toContain(l);
    const texto = JSON.stringify(filasInstrucciones('productos'));
    for (const l of LABELS_NUEVAS) expect(texto).toContain(l);
    const libro = armarPlantilla('productos');
    expect(JSON.stringify(libro)).toContain('Se vende por');
  });

  it('AC-VTA-1 los encabezados nuevos no los captura ningun parcial de productos', () => {
    const m = mapearEncabezados(LABELS_P, 'productos');
    expect(m.ignoradas).toEqual([]);
    expect(m.modo).toBe('plantilla');
    COLUMNAS_PLANTILLA.productos.forEach((c, i) => expect(m.indices[c.key]).toBe(i));
  });

  it('AC-VTA-1 alias: "Tipo bulto", "Tienda", "Marca" mapean a sus campos', () => {
    const m = mapearEncabezados(['Código', 'Descripción', 'Marca', 'Tipo bulto', 'Tienda', 'Se vende por'], 'productos');
    expect(m.indices).toMatchObject({ marca: 2, bultoNombre: 3, visibleTienda: 4, ventaPor: 5 });
  });

  it('AC-VTA-1 Dos Corazones en el Excel: Display, bulto x16, Bulto, Si', () => {
    const rows = [LABELS_P, fila({
      'Código': 'DC1', 'Descripción': 'Dos Corazones', 'Marca': 'Dos Corazones', 'Precio por unidad': '900', 'Bulto x': '16',
      'Se vende por': 'Bulto', 'Etiqueta del bulto': 'display', 'Mostrar en tienda': 'Sí',
    })];
    const plan = planificarImportacion(rows, 'productos', { existentes: [], proveedores: [] });
    expect(plan.entradas[0].errores).toEqual([]);
    expect(plan.entradas[0].valor.producto).toMatchObject({
      marca: 'Dos Corazones', ventaPor: 'bulto', bultoNombre: 'Display', visibleTienda: true, bultoX: 16, precio: 900,
    });
  });

  it('AC-VTA-1 "Bulto" con Bulto x 1 (o vacio) rechaza la fila', () => {
    for (const bx of ['1', '']) {
      const rows = [LABELS_P, fila({ 'Código': 'DC1', 'Descripción': 'X', 'Precio por unidad': '5', 'Bulto x': bx, 'Se vende por': 'Bulto' })];
      const plan = planificarImportacion(rows, 'productos', { existentes: [], proveedores: [] });
      expect(plan.entradas[0].accion).toBe('rechazar');
      expect(plan.entradas[0].errores.join(' ')).toMatch(/Bulto x/);
    }
  });

  it('AC-VTA-1 "Mostrar en tienda" acepta Si/No y rechaza otra cosa', () => {
    const f = (v) => validarFilaProducto({ codigo: 'A', nombre: 'A', precio: '5', visibleTienda: v }, { modo: 'plantilla' });
    expect(f('No').valor.producto.visibleTienda).toBe(false);
    expect(f('si').valor.producto.visibleTienda).toBe(true);
    expect(f('').valor.producto.visibleTienda).toBe(true);
    const mal = f('tal vez');
    expect(mal.ok).toBe(false);
    expect(mal.errores.join(' ')).toMatch(/Mostrar en tienda/);
  });

  it('AC-VTA-1 un Excel viejo (sin columnas nuevas) importa igual con defaults', () => {
    const viejas = ['Código', 'Descripción', 'Rubro', 'Proveedor', 'Costo final', 'Precio venta 1', 'Bulto x'];
    const rows = [viejas, ['V1', 'Coca 500', 'Bebidas', '', '', '1500', '12'], ['V2', 'Alfajor', '', '', '', '300', '']];
    const plan = planificarImportacion(rows, 'productos', { existentes: [], proveedores: [] });
    expect(plan.entradas.map(e => e.accion)).toEqual(['crear', 'crear']);
    expect(plan.entradas[0].valor.producto).toMatchObject({ ventaPor: 'ambos', bultoNombre: 'Bulto', visibleTienda: true, marca: '' });
    expect(plan.entradas[1].valor.producto).toMatchObject({ ventaPor: 'unidad', bultoNombre: 'Bulto', visibleTienda: true });
  });

  it('AC-VTA-1 columnas vacias en un producto existente conservan lo que ya tenia', () => {
    const existente = { id: 1, codigo: 'DC1', nombre: 'Dos Corazones', precio: 900, bultoX: 16, ventaPor: 'bulto', bultoNombre: 'Display', visibleTienda: false, marca: 'Dos Corazones' };
    const rows = [LABELS_P, fila({ 'Código': 'DC1', 'Descripción': 'Dos Corazones', 'Precio por unidad': '950' })];
    const plan = planificarImportacion(rows, 'productos', { existentes: [existente], proveedores: [] });
    expect(plan.entradas[0].accion).toBe('actualizar');
    expect(plan.entradas[0].valor.producto).toMatchObject({ ventaPor: 'bulto', bultoNombre: 'Display', visibleTienda: false, marca: 'Dos Corazones', precio: 950, bultoX: 16 });
  });

  it('AC-VTA-1 la marca se deduplica contra las existentes y contra las del propio archivo', () => {
    const existentes = [{ id: 1, codigo: 'X', nombre: 'X', precio: 1, marca: 'Arcor', createdAt: 1 }];
    const rows = [LABELS_P,
      fila({ 'Código': 'A1', 'Descripción': 'A1', 'Precio por unidad': '5', 'Marca': 'ARCOR' }),
      fila({ 'Código': 'A2', 'Descripción': 'A2', 'Precio por unidad': '5', 'Marca': 'bagley' }),
      fila({ 'Código': 'A3', 'Descripción': 'A3', 'Precio por unidad': '5', 'Marca': 'BAGLEY ' }),
    ];
    const plan = planificarImportacion(rows, 'productos', { existentes, proveedores: [] });
    expect(plan.entradas.map(e => e.valor.producto.marca)).toEqual(['Arcor', 'bagley', 'bagley']);
  });
});
