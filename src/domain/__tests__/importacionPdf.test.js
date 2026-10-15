// REQ-PDF: precios desde la lista de precios del proveedor en PDF (dominio puro).
import {
  validarArchivoPdf, agruparRenglones, parsearPrecio, parsearRenglon, filasDesdeRenglones,
  columnasDePrecio, precioDeFila, planificarPreciosPdf, cambiosAplicables, MAX_PDF_BYTES,
} from '../importacionPdf';
import { itemsListaProveedor } from '../__fixtures__/pdfListaItems';

const PRODUCTOS = [
  { id: 1, codigo: 'dc', nombre: 'Dos Corazones', precio: 800, costoFinal: 600, descuento1: 0, descuento2: 0, ganancia: 25 },
  { id: 2, codigo: 'G1', nombre: 'Gaseosa Cola', precio: 1250.5, costoFinal: 1033.47, ganancia: 21 },
  { id: 3, codigo: 'X9', nombre: 'Alfajor Triple Choc.', precio: 100, costoFinal: 80, ganancia: 25 },
];

describe('lectura del PDF (AC-PDF-1)', () => {
  it('AC-PDF-1 acepta solo PDF de hasta 10 MB', () => {
    expect(validarArchivoPdf({ name: 'lista.pdf', type: 'application/pdf', size: 1000 }).ok).toBe(true);
    expect(validarArchivoPdf({ name: 'LISTA.PDF', type: '', size: 10 }).ok).toBe(true);
    expect(validarArchivoPdf({ name: 'lista.xlsx', type: 'application/vnd.ms-excel', size: 10 }).error).toMatch(/PDF/);
    expect(validarArchivoPdf({ name: 'a.pdf', type: 'application/pdf', size: MAX_PDF_BYTES + 1 }).error).toMatch(/10 MB/);
    expect(validarArchivoPdf({ name: 'a.pdf', type: 'application/pdf', size: 0 }).ok).toBe(false);
    expect(validarArchivoPdf(null).ok).toBe(false);
  });

  it('AC-PDF-1 arma los renglones de una lista real (salida de pdfjs) en orden y por columnas', () => {
    const r = agruparRenglones(itemsListaProveedor);
    expect(r.map(x => x.texto)).toEqual([
      'LISTA DE PRECIOS OCTUBRE 2026',
      'Codigo Descripcion Precio s/IVA Precio c/IVA',
      'DC Dos Corazones x16 $ 743,80 $ 900,00',
      'G1 Gaseosa Cola 2.25 L 1.033,47 1.250,50',
      'A-77 Alfajor Triple Choc. 12.500 15.125',
    ]);
    // Fragmentos pegados de la misma palabra se unen; páginas en orden.
    expect(agruparRenglones([
      { str: '1.2', x: 10, y: 50, w: 10, pagina: 2 }, { str: '50', x: 20, y: 50, w: 8, pagina: 2 },
      { str: 'Hola', x: 0, y: 50, w: 5, pagina: 1 }, { str: '', x: 0, y: 0, pagina: 1 }, null,
    ])).toEqual([{ pagina: 1, texto: 'Hola' }, { pagina: 2, texto: '1.250' }]);
  });
});

describe('detección de precios (AC-PDF-2)', () => {
  it.each([
    ['$ 1.234,56', 1234.56], ['1.234,56', 1234.56], ['12.500', 12500], ['1234.56', 1234.56], ['1,234.56', 1234.56],
    ['900,00', 900], ['12,5', 12.5], ['120', 120], ['1.250.000', 1250000], ['$900', 900],
  ])('AC-PDF-2 parsea %s', (txt, n) => { expect(parsearPrecio(txt)).toBe(n); });

  it.each(['abc', '', null, '1.2.3,4,5', '12,345,6', '1234.567', '-5'])('AC-PDF-2 rechaza %s', (txt) => {
    expect(parsearPrecio(txt)).toBeNull();
  });

  it('AC-PDF-2 separa código, descripción (con números) y columnas de precio', () => {
    expect(parsearRenglon('G1 Gaseosa Cola 2.25 L 1.033,47 1.250,50')).toEqual({ codigo: 'G1', descripcion: 'Gaseosa Cola 2.25 L', precios: [1033.47, 1250.5] });
    expect(parsearRenglon('Fernet 750 cc $ 12.500')).toEqual({ codigo: '', descripcion: 'Fernet 750 cc', precios: [12500] });
    expect(parsearRenglon('77 Yerba 1kg 3500')).toEqual({ codigo: '77', descripcion: 'Yerba 1kg', precios: [3500] });
    expect(parsearRenglon('DC Dos Corazones x16 $ 743,80 $ 900,00')).toEqual({ codigo: 'DC', descripcion: 'Dos Corazones x16', precios: [743.8, 900] });
    expect(parsearRenglon('Codigo Descripcion Precio')).toBeNull();
    expect(parsearRenglon('')).toBeNull();
  });

  it('AC-PDF-2 elige la columna de precio (la última por defecto)', () => {
    const filas = filasDesdeRenglones(agruparRenglones(itemsListaProveedor));
    expect(columnasDePrecio(filas)).toBe(2);
    const dc = filas.find(f => f.codigo === 'DC');
    expect(precioDeFila(dc)).toBe(900);
    expect(precioDeFila(dc, 0)).toBe(743.8);
    expect(precioDeFila(dc, 5)).toBe(900);
    expect(precioDeFila({ precios: [] })).toBeNull();
  });
});

describe('plan de actualización (AC-PDF-3, AC-PDF-4, AC-PDF-5)', () => {
  const filas = filasDesdeRenglones(agruparRenglones(itemsListaProveedor));

  it('AC-PDF-3 busca por código sin distinguir mayúsculas y nunca crea productos ni toca stock', () => {
    const plan = planificarPreciosPdf(filas, PRODUCTOS, { modo: 'venta' });
    const dc = plan.entradas.find(e => e.fila.codigo === 'DC');
    expect(dc.producto.id).toBe(1);
    expect(dc.por).toBe('codigo');
    const titulo = plan.entradas.find(e => e.fila.texto.startsWith('LISTA'));
    expect(titulo.estado).toBe('sin_producto');
    const cambios = cambiosAplicables(plan);
    expect(cambios.every(c => PRODUCTOS.some(p => p.id === c.id))).toBe(true);
    expect(cambios.every(c => !('stock' in c.cambios))).toBe(true);
  });

  it('AC-PDF-3 por nombre exacto solo sugiere (sin tildar) y un producto repetido se toma una vez', () => {
    const plan = planificarPreciosPdf([
      ...filas,
      { codigo: 'DC', descripcion: 'Dos Corazones otra vez', precios: [1] },
    ], PRODUCTOS, { modo: 'venta' });
    const alfa = plan.entradas.find(e => e.fila.codigo === 'A-77');
    expect(alfa.por).toBe('nombre');
    expect(alfa.seleccionado).toBe(false);
    expect(plan.entradas[plan.entradas.length - 1].estado).toBe('duplicado');
  });

  it('AC-PDF-4 vista previa: actual -> nuevo, variación, sin cambios y cambios grandes sin tildar', () => {
    const plan = planificarPreciosPdf(filas, PRODUCTOS, { modo: 'venta' });
    const dc = plan.entradas.find(e => e.fila.codigo === 'DC');
    expect(dc).toMatchObject({ estado: 'actualizar', precioActual: 800, precioNuevo: 900, variacion: 12.5, seleccionado: true });
    expect(plan.entradas.find(e => e.fila.codigo === 'G1').estado).toBe('sin_cambios');
    const grande = planificarPreciosPdf([{ codigo: 'DC', descripcion: 'x', precios: [1600] }], PRODUCTOS, { modo: 'venta' }).entradas[0];
    expect(grande.aviso).toMatch(/Cambio grande \(\+100%\)/);
    expect(grande.seleccionado).toBe(false);
    expect(plan.resumen).toMatchObject({ actualizar: 2, sinCambios: 1 });
    // Solo se aplica lo tildado (o la selección del admin).
    expect(cambiosAplicables(plan).map(c => c.id)).toEqual([1]);
    const iAlfa = plan.entradas.findIndex(e => e.fila.codigo === 'A-77');
    expect(cambiosAplicables(plan, new Set([iAlfa])).map(c => c.id)).toEqual([3]);
    expect(cambiosAplicables(null)).toEqual([]);
  });

  it('AC-PDF-5 modo costo: guarda Costo final y recalcula Precio venta 1 con descuentos y ganancia', () => {
    const plan = planificarPreciosPdf([{ codigo: 'DC', descripcion: 'x', precios: [700] }], PRODUCTOS, { modo: 'costo' });
    expect(plan.entradas[0].cambios).toEqual({ costoFinal: 700, precio: 875 });
    const conDesc = planificarPreciosPdf([{ codigo: 'P', descripcion: 'x', precios: [1000] }],
      [{ id: 9, codigo: 'P', nombre: 'P', precio: 100, descuento1: 10, descuento2: 10, ganancia: 50 }], { modo: 'costo' });
    expect(conDesc.entradas[0].cambios).toEqual({ costoFinal: 1000, precio: 1215 });
    const sinGanancia = planificarPreciosPdf([{ codigo: 'P', descripcion: 'x', precios: [0.001] }],
      [{ id: 9, codigo: 'P', nombre: 'P', precio: 100 }], { modo: 'costo' });
    expect(sinGanancia.entradas[0].estado).toBe('invalido');
    expect(planificarPreciosPdf([], [], { modo: 'raro' }).modo).toBe('costo');
  });

  it('AC-PDF-3 si el primer token no es un código conocido, busca por la descripción completa', () => {
    const plan = planificarPreciosPdf([{ codigo: 'COCA', descripcion: 'COLA 500', precios: [1500] }],
      [{ id: 5, codigo: 'CC500', nombre: 'Coca Cola 500', precio: 1400 }], { modo: 'venta' });
    expect(plan.entradas[0]).toMatchObject({ por: 'nombre', estado: 'actualizar', seleccionado: false });
  });

  it('AC-PDF-5 modo venta: el precio del PDF va directo a Precio venta 1', () => {
    const plan = planificarPreciosPdf([{ codigo: 'X9', descripcion: 'x', precios: [120] }], PRODUCTOS, { modo: 'venta' });
    expect(plan.entradas[0].cambios).toEqual({ precio: 120 });
    expect(planificarPreciosPdf([{ codigo: 'X9', descripcion: 'x', precios: [] }], PRODUCTOS).entradas[0].estado).toBe('invalido');
  });
});
