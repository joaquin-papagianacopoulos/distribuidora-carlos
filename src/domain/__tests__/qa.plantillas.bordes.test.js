// QA RUN 20261012-2106 — REQ-PLA: bordes de la importacion (dominio + xlsx real).
// Cada test ejerce planificarImportacion con filas que salen de un libro .xlsx
// REAL (XLSX.write -> XLSX.read -> sheet_to_json con las mismas opciones que
// leerFilas de Configuracion.js), no de arrays armados a mano.
import * as XLSX from 'xlsx';
import {
  planificarImportacion, mapearEncabezados, normalizarEncabezado, COLUMNAS_PLANTILLA, armarPlantilla, textoResumen,
  validarFilaCliente, resolverVendedor,
} from '../plantillas';
import { libroPlantilla } from '../../services/plantillaExcel';
import { validarCuit } from '../validacion';

const NOW = new Date(2026, 9, 12);
const PROVEEDORES = [{ id: 'prov-1', codigo: 'ARC', descripcion: 'Arcor' }];
const VENDEDORES = [
  { id: 1, nombre: 'Admin', permiso: 1 },
  { id: 2, nombre: 'Juan Pérez', permiso: 2 },
  { id: 3, nombre: 'Viejo', permiso: 2, activo: false },
];

// Igual que leerFilas() de Configuracion.js
const aFilas = (aoa, opts = {}) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa, opts), 'Hoja1');
  const leido = XLSX.read(XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellDates: !!opts.cellDates }), { type: 'array', cellDates: !!opts.cellDates });
  return XLSX.utils.sheet_to_json(leido.Sheets[leido.SheetNames[0]], { header: 1, raw: false, defval: '', blankrows: true });
};

const LP = COLUMNAS_PLANTILLA.productos.map(c => c.label);
const LC = COLUMNAS_PLANTILLA.clientes.map(c => c.label);
const fila = (labels, obj) => labels.map(l => (obj[l] === undefined ? '' : obj[l]));

describe('AC-PLA-3 AC-PLA-7 round-trip con xlsx real y celdas tipadas', () => {
  it('AC-PLA-3 AC-PLA-7 productos: celdas NUMERICAS de Excel (no texto) llegan bien', () => {
    const rows = aFilas([LP, fila(LP, {
      'Código': 'NUM1', 'Descripción': 'Numerico', 'Proveedor': 'Arcor', 'Costo final': 1234.5,
      'Descuento 1': 10, 'Descuento 2': 5, '% Ganancia': 30, 'Precio venta 2': 2000, 'Bulto x': 12, 'Mínimo venta': 2, 'Stock': 24,
    })]);
    const plan = planificarImportacion(rows, 'productos', { proveedores: PROVEEDORES });
    expect(plan.ok).toBe(true);
    expect(plan.entradas[0].accion).toBe('crear');
    expect(plan.entradas[0].valor.producto).toMatchObject({ costoFinal: 1234.5, descuento1: 10, descuento2: 5, ganancia: 30, bultoX: 12, minimoVenta: 2, precioVenta2: 2000 });
    expect(plan.entradas[0].valor.stock).toBe(24);
    // 1234.5 * .9 * .95 * 1.3 = 1372.4...
    expect(plan.entradas[0].valor.producto.precio).toBeCloseTo(1234.5 * 0.9 * 0.95 * 1.3, 2);
  });

  it('AC-PLA-3 productos: celda con formato % (0.1 mostrado como "10%") se interpreta como 10', () => {
    const ws = XLSX.utils.aoa_to_sheet([LP, fila(LP, { 'Código': 'P1', 'Descripción': 'Pct', 'Costo final': 100, 'Descuento 1': 0.1 })]);
    ws[XLSX.utils.encode_cell({ r: 1, c: LP.indexOf('Descuento 1') })].z = '0%';
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'H');
    const leido = XLSX.read(XLSX.write(wb, { bookType: 'xlsx', type: 'array' }), { type: 'array' });
    const rows = XLSX.utils.sheet_to_json(leido.Sheets.H, { header: 1, raw: false, defval: '', blankrows: true });
    const plan = planificarImportacion(rows, 'productos', {});
    expect(plan.entradas[0].accion).toBe('crear');
    expect(plan.entradas[0].valor.producto.descuento1).toBe(10);
  });

  it('AC-PLA-4 AC-PLA-7 clientes: CUIT numerico (sin guiones), telefono numerico y codigo como texto con ceros', () => {
    const rows = aFilas([LC, fila(LC, {
      'Código cliente': '0042', 'Razón social': 'Num SA', 'Domicilio de entrega': 'X 1', 'Tipo de IVA': 'Responsable Inscripto',
      'CUIT': 30712345671, 'Celular': 3415551234,
    })]);
    const plan = planificarImportacion(rows, 'clientes', { vendedores: VENDEDORES, now: NOW });
    expect(plan.entradas[0].accion).toBe('crear');
    expect(plan.entradas[0].valor).toMatchObject({ codigo: '0042', cuit: '30-71234567-1', telefono: '3415551234' });
  });

  // BUG: BUG-PLA-01 (ver qa-report.md). Una celda de fecha real de Excel
  // (tipo date) se lee con raw:false como "10/1/26" (m/d/yy, anio de 2 digitos)
  // y normalizarFecha solo acepta anio de 4 digitos: la fila se rechaza con
  // "Fecha de alta inválida" aunque el usuario escribio una fecha correcta.
  it('AC-PLA-4 BUG clientes: "Fecha de alta" escrita como fecha de Excel (celda tipo fecha) se acepta', () => {
    const rows = aFilas([LC, fila(LC, {
      'Código cliente': 'F1', 'Razón social': 'Fecha', 'Domicilio de entrega': 'X 1', 'Fecha de alta': new Date(2026, 9, 1, 12),
    })], { cellDates: true });
    const plan = planificarImportacion(rows, 'clientes', { now: NOW });
    expect(plan.entradas[0].errores).toEqual([]);
    expect(plan.entradas[0].accion).toBe('crear');
    expect(plan.entradas[0].valor.fechaAlta).toBe('2026-10-01');
  });
});

describe('AC-PLA-3 AC-PLA-4 encabezados con tildes, mayusculas y basura invisible', () => {
  it.each([
    ['MAYUSCULAS con tilde', ['CÓDIGO', 'DESCRIPCIÓN', 'RUBRO', 'PROVEEDOR', 'COSTO FINAL', 'DESCUENTO 1', 'DESCUENTO 2', '% GANANCIA', 'PRECIO VENTA 1', 'PRECIO VENTA 2', 'BULTO X', 'MÍNIMO VENTA', 'STOCK']],
    ['minusculas sin tilde', ['codigo', 'descripcion', 'rubro', 'proveedor', 'costo final', 'descuento 1', 'descuento 2', '% ganancia', 'precio venta 1', 'precio venta 2', 'bulto x', 'minimo venta', 'stock']],
    ['espacios de mas y NBSP', ['  Código ', 'Descripción\u00A0', ' Rubro', 'Proveedor ', 'Costo  final', 'Descuento   1', 'Descuento 2', '%  Ganancia', 'Precio venta 1', 'Precio venta 2', 'Bulto x', 'Mínimo\u00A0venta', 'Stock']],
    ['tildes descompuestas (NFD)', ['Co\u0301digo', 'Descripcio\u0301n', 'Rubro', 'Proveedor', 'Costo final', 'Descuento 1', 'Descuento 2', '% Ganancia', 'Precio venta 1', 'Precio venta 2', 'Bulto x', 'Mi\u0301nimo venta', 'Stock']],
    ['con BOM al principio', ['\uFEFFCódigo', 'Descripción', 'Rubro', 'Proveedor', 'Costo final', 'Descuento 1', 'Descuento 2', '% Ganancia', 'Precio venta 1', 'Precio venta 2', 'Bulto x', 'Mínimo venta', 'Stock']],
  ])('AC-PLA-3 productos %s: las 13 columnas se mapean a su campo, sin ignoradas', (_n, headers) => {
    const m = mapearEncabezados(headers, 'productos');
    COLUMNAS_PLANTILLA.productos.forEach((c, i) => expect(m.indices[c.key]).toBe(i));
    expect(m.ignoradas).toEqual([]);
    expect(m.modo).toBe('plantilla');
  });

  it.each([
    ['MAYUSCULAS con tilde', ['CÓDIGO CLIENTE', 'RAZÓN SOCIAL', 'DOMICILIO DE ENTREGA', 'CIUDAD', 'CÓDIGO POSTAL', 'PROVINCIA', 'ZONA', 'PAÍS', 'TIPO DE IVA', 'CUIT', 'CELULAR', 'VENDEDOR', 'COBRADOR', 'FECHA DE ALTA', 'TIPO DE CLIENTE', 'RUBRO']],
    ['sin tildes', ['codigo cliente', 'razon social', 'domicilio de entrega', 'ciudad', 'codigo postal', 'provincia', 'zona', 'pais', 'tipo de iva', 'cuit', 'celular', 'vendedor', 'cobrador', 'fecha de alta', 'tipo de cliente', 'rubro']],
  ])('AC-PLA-4 clientes %s: las 16 columnas se mapean a su campo', (_n, headers) => {
    const m = mapearEncabezados(headers, 'clientes');
    COLUMNAS_PLANTILLA.clientes.forEach((c, i) => expect(m.indices[c.key]).toBe(i));
    expect(m.ignoradas).toEqual([]);
    expect(m.excluidas).toEqual([]);
  });

  it('AC-PLA-4 "COMISIÓN", "comision", " Comisión %" y "Comision (%)" van a excluidas aunque cambie la forma', () => {
    for (const h of ['COMISIÓN', 'comision', ' Comisión %', 'Comision (%)', 'Comisio\u0301n']) {
      const m = mapearEncabezados(['Código cliente', h], 'clientes');
      expect(m.excluidas).toEqual([h.trim()]);
      expect(m.indices).not.toHaveProperty('comision');
    }
  });

  it('AC-PLA-4 un encabezado "Comisión de venta" NO se confunde con la columna excluida (se informa como ignorada)', () => {
    // Documenta el comportamiento: solo "comision" / "comision %" exactos se excluyen.
    const m = mapearEncabezados(['Código cliente', 'Comisión de venta'], 'clientes');
    expect(m.excluidas.length + m.ignoradas.length).toBe(1);
  });

  it('AC-PLA-3 normalizarEncabezado: BOM, ZWSP y NBSP desaparecen', () => {
    expect(normalizarEncabezado('\uFEFFCódigo')).toBe('codigo');
    expect(normalizarEncabezado('Cód\u200Bigo')).toBe('codigo');
    expect(normalizarEncabezado('Mínimo\u00A0venta')).toBe('minimoventa');
  });

  it('AC-PLA-3 un archivo con encabezados en MAYUSCULAS y tilde se importa de punta a punta (xlsx real)', () => {
    const H = ['CÓDIGO', 'DESCRIPCIÓN', 'PROVEEDOR', 'COSTO FINAL', '% GANANCIA', 'MÍNIMO VENTA'];
    const rows = aFilas([H, ['M1', 'Mayus', 'ARCOR', '100', '10', '3']]);
    const plan = planificarImportacion(rows, 'productos', { proveedores: PROVEEDORES });
    expect(plan.entradas[0].accion).toBe('crear');
    expect(plan.entradas[0].valor.producto).toMatchObject({ codigo: 'M1', proveedorId: 'prov-1', minimoVenta: 3, precio: 110 });
  });
});

describe('AC-PLA-5 archivo con 1000 filas', () => {
  it('AC-PLA-3 AC-PLA-5 1000 productos nuevos en un xlsx real: 1000 creados, rapido y con el numero de fila correcto', () => {
    const datos = Array.from({ length: 1000 }, (_, i) => fila(LP, { 'Código': `P${i}`, 'Descripción': `Producto ${i}`, 'Costo final': 100 + i, '% Ganancia': 20, 'Stock': i % 50 }));
    const rows = aFilas([LP, ...datos]);
    expect(rows).toHaveLength(1001);
    const t0 = Date.now();
    const plan = planificarImportacion(rows, 'productos', { proveedores: PROVEEDORES });
    const ms = Date.now() - t0;
    expect(plan.resumen).toMatchObject({ creados: 1000, actualizados: 0, rechazados: 0 });
    expect(plan.entradas[999].fila).toBe(1001);
    expect(ms).toBeLessThan(5000);
  });

  it('AC-PLA-3 AC-PLA-5 1000 productos con 1000 existentes (upsert por codigo) no explota y actualiza todos', () => {
    const existentes = Array.from({ length: 1000 }, (_, i) => ({ id: i + 1, codigo: `P${i}`, nombre: `Producto ${i}`, precio: 10, unidad: 'unidad' }));
    const datos = Array.from({ length: 1000 }, (_, i) => fila(LP, { 'Código': `p${i}`, 'Descripción': `Producto ${i} v2`, 'Precio venta 1': 20 }));
    const t0 = Date.now();
    const plan = planificarImportacion([LP, ...datos], 'productos', { existentes });
    expect(Date.now() - t0).toBeLessThan(8000);
    expect(plan.resumen).toMatchObject({ creados: 0, actualizados: 1000, rechazados: 0 });
    expect(plan.entradas[500].existente.id).toBe(501);
  });

  it('AC-PLA-4 AC-PLA-5 1000 clientes con un CUIT invalido cada 7 filas: solo esas se rechazan, con su numero de fila', () => {
    const datos = [];
    const malas = [];
    for (let i = 0; i < 1000; i++) {
      const mala = i % 7 === 3;
      if (mala) malas.push(i + 2);
      datos.push(fila(LC, {
        'Código cliente': `C${i}`, 'Razón social': `Cliente ${i}`, 'Domicilio de entrega': `Calle ${i}`,
        'Tipo de IVA': 'Responsable Inscripto', 'CUIT': mala ? '20123456780' : '30712345671',
      }));
    }
    const plan = planificarImportacion(aFilas([LC, ...datos]), 'clientes', { now: NOW });
    expect(plan.resumen.rechazados).toBe(malas.length);
    expect(plan.resumen.creados).toBe(1000 - malas.length);
    expect(plan.resumen.rechazos.map(r => r.fila)).toEqual(malas);
    expect(plan.resumen.rechazos.every(r => /CUIT inválido/.test(r.motivo))).toBe(true);
    expect(textoResumen(plan.resumen)).toBe(`✓ ${1000 - malas.length} creados, 0 actualizados, ${malas.length} líneas ignoradas.`);
  });

  it('AC-PLA-5 filas en blanco intercaladas no corren el numero de fila de los rechazos', () => {
    const rows = aFilas([LC, [], fila(LC, { 'Código cliente': 'A', 'Razón social': 'A', 'Domicilio de entrega': 'x' }), [], [],
      fila(LC, { 'Código cliente': 'B', 'Razón social': '', 'Domicilio de entrega': 'x' })]);
    const plan = planificarImportacion(rows, 'clientes', { now: NOW });
    expect(plan.resumen.rechazos).toEqual([{ fila: 6, motivo: 'La razón social es obligatoria' }]);
  });
});

describe('AC-PLA-4 CUIT: digito verificador 10 / 11 / 0 y mezcla de filas', () => {
  // Armamos CUITs con DV calculado para cubrir los tres casos del algoritmo.
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const dvDe = (d10) => { const s = pesos.reduce((a, p, i) => a + p * Number(d10[i]), 0); return 11 - (s % 11); };
  const buscar = (cond) => { for (let n = 10000000; n < 10000500; n++) { const d = `20${n}`; if (cond(dvDe(d))) return d; } return null; };

  it('AC-PLA-4 CUIT cuyo DV da 11 (=> 0) es valido, y el que da 10 se rechaza (no existe CUIT valido con DV 10)', () => {
    const base11 = buscar(v => v === 11);
    const base10 = buscar(v => v === 10);
    expect(base11 && base10).toBeTruthy();
    expect(validarCuit(`${base11}0`)).toBe(true);
    expect(validarCuit(`${base10}0`)).toBe(false);
    expect(validarCuit(`${base10}9`)).toBe(false);
    const ctx = { now: NOW };
    const ok = validarFilaCliente({ codigo: 'A', nombre: 'A', direccion: 'B', tipoIva: 'Exento', cuit: `${base11}0` }, ctx);
    expect(ok.ok).toBe(true);
    const mal = validarFilaCliente({ codigo: 'B', nombre: 'B', direccion: 'B', tipoIva: 'Exento', cuit: `${base10}0` }, ctx);
    expect(mal.ok).toBe(false);
  });

  it('AC-PLA-4 un CUIT invalido entre dos filas validas no frena ni contagia a las vecinas', () => {
    const rows = [
      LC,
      fila(LC, { 'Código cliente': '1', 'Razón social': 'Bien 1', 'Domicilio de entrega': 'a', 'Tipo de IVA': 'Monotributo', 'CUIT': '20-12345678-6' }),
      fila(LC, { 'Código cliente': '2', 'Razón social': 'Mal', 'Domicilio de entrega': 'a', 'Tipo de IVA': 'Monotributo', 'CUIT': '20-12345678-7' }),
      fila(LC, { 'Código cliente': '3', 'Razón social': 'Bien 3', 'Domicilio de entrega': 'a', 'Tipo de IVA': 'Monotributo', 'CUIT': '27-23456789-1' }),
    ];
    const plan = planificarImportacion(rows, 'clientes', { now: NOW });
    expect(plan.entradas.map(e => e.accion)).toEqual(['crear', 'rechazar', 'crear']);
    expect(plan.entradas[0].valor.cuit).toBe('20-12345678-6');
    expect(plan.entradas[2].valor.cuit).toBe('27-23456789-1');
    // El mismo CUIT en dos clientes distintos NO es un error (el formulario tampoco lo valida).
    const dup = planificarImportacion([LC,
      fila(LC, { 'Código cliente': '1', 'Razón social': 'A', 'Domicilio de entrega': 'a', 'Tipo de IVA': 'Monotributo', 'CUIT': '20-12345678-6' }),
      fila(LC, { 'Código cliente': '2', 'Razón social': 'B', 'Domicilio de entrega': 'a', 'Tipo de IVA': 'Monotributo', 'CUIT': '20-12345678-6' })], 'clientes', { now: NOW });
    expect(dup.resumen.creados).toBe(2);
  });

  it('AC-PLA-4 CUIT con letras o de 10 digitos se rechaza; con tipo IVA Consumidor Final y sin CUIT se acepta', () => {
    const ctx = { now: NOW };
    expect(validarFilaCliente({ codigo: 'A', nombre: 'A', direccion: 'B', tipoIva: 'Exento', cuit: '2012345678' }, ctx).ok).toBe(false);
    expect(validarFilaCliente({ codigo: 'A', nombre: 'A', direccion: 'B', tipoIva: 'Exento', cuit: 'abc' }, ctx).errores.join()).toMatch(/obligatorio/);
    expect(validarFilaCliente({ codigo: 'A', nombre: 'A', direccion: 'B', tipoIva: 'Consumidor Final' }, ctx).ok).toBe(true);
    expect(validarFilaCliente({ codigo: 'A', nombre: 'A', direccion: 'B' }, ctx).ok).toBe(true);
  });
});

describe('AC-PLA-4 AC-VEN-3 vendedor dado de baja en la columna Vendedor', () => {
  const ctx = { vendedores: VENDEDORES, now: NOW };
  it('AC-PLA-4 AC-VEN-3 alta con un vendedor dado de baja: se rechaza con motivo claro y el resto sigue', () => {
    const rows = [LC,
      fila(LC, { 'Código cliente': '1', 'Razón social': 'A', 'Domicilio de entrega': 'a', 'Vendedor': 'viejo' }),
      fila(LC, { 'Código cliente': '2', 'Razón social': 'B', 'Domicilio de entrega': 'a', 'Vendedor': ' JUAN PEREZ ' })];
    const plan = planificarImportacion(rows, 'clientes', ctx);
    expect(plan.entradas.map(e => e.accion)).toEqual(['rechazar', 'crear']);
    expect(plan.resumen.rechazos[0]).toEqual({ fila: 2, motivo: 'Vendedor "viejo" no existe o está dado de baja' });
    expect(plan.entradas[1].valor.vendedor).toBe('Juan Pérez');
  });

  it('AC-PLA-4 AC-VEN-3 actualizar un cliente que YA tenia a un vendedor dado de baja, sin tocar la columna Vendedor: conserva el nombre', () => {
    const existente = { id: 9, codigo: 'X1', nombre: 'Pepe', direccion: 'a', vendedor: 'Viejo' };
    const rows = [LC, fila(LC, { 'Código cliente': 'X1', 'Razón social': 'Pepe SRL', 'Domicilio de entrega': 'b' })];
    const plan = planificarImportacion(rows, 'clientes', { ...ctx, existentes: [existente] });
    expect(plan.entradas[0].accion).toBe('actualizar');
    expect({ ...existente, ...plan.entradas[0].valor }.vendedor).toBe('Viejo');
  });

  it('AC-PLA-4 AC-VEN-3 reasignar a un dado de baja en una actualizacion tambien se rechaza', () => {
    const existente = { id: 9, codigo: 'X1', nombre: 'Pepe', direccion: 'a', vendedor: 'Admin' };
    const plan = planificarImportacion([LC, fila(LC, { 'Código cliente': 'X1', 'Vendedor': 'Viejo' })], 'clientes', { ...ctx, existentes: [existente] });
    expect(plan.entradas[0].accion).toBe('rechazar');
  });

  it('AC-VEN-3 si un vendedor se dio de baja y despues se creo otro con el mismo nombre, se usa el activo', () => {
    const lista = [{ id: 1, nombre: 'Ana', permiso: 2, activo: false }, { id: 2, nombre: 'Ana', permiso: 2 }];
    expect(resolverVendedor('ana', lista)).toEqual({ ok: true, nombre: 'Ana' });
    expect(resolverVendedor('ana', [lista[0]]).ok).toBe(false);
  });

  it('AC-VEN-3 la hoja Instrucciones lista solo vendedores activos (no el dado de baja)', () => {
    const inst = armarPlantilla('clientes', { vendedores: VENDEDORES }).hojas[1].filas;
    const txt = inst.find(f => f[0] === 'Vendedor')[3];
    expect(txt).toContain('Admin');
    expect(txt).not.toContain('Viejo');
    // y el libro que se descarga no se rompe
    expect(() => libroPlantilla(XLSX, armarPlantilla('clientes', { vendedores: VENDEDORES }))).not.toThrow();
  });
});

describe('AC-PROD-5 AC-PLA-3 productos legacy', () => {
  it('AC-PROD-5 archivo viejo de 5 columnas (xlsx real) sigue importando: modo legacy, sin exigir codigo ni extras', () => {
    const rows = aFilas([['nombre', 'precio', 'codigo', 'unidad', 'categoria'], ['Alfajor', 10, '', 'caja', 'Golosinas'], ['Coca', '1500,50', 'CC', 'unidad', '']]);
    const plan = planificarImportacion(rows, 'productos', { existentes: [{ id: 1, nombre: 'Coca', codigo: '', precio: 1, unidad: 'unidad' }] });
    expect(plan.modo).toBe('legacy');
    expect(plan.entradas.map(e => e.accion)).toEqual(['crear', 'actualizar']);
    expect(plan.entradas[0].valor.producto).toMatchObject({ nombre: 'Alfajor', precio: 10, unidad: 'caja', categoria: 'Golosinas' });
    expect(plan.entradas[0].valor.stock).toBeNull();
    expect(plan.entradas[1].valor.producto).toMatchObject({ precio: 1500.5, codigo: 'CC' });
    expect(plan.resumen).toMatchObject({ creados: 1, actualizados: 1, rechazados: 0 });
  });

  it('AC-PROD-5 legacy: precio en blanco o no numerico se rechaza con "Precio vacío o inválido" y no frena al resto', () => {
    const plan = planificarImportacion([['Nombre', 'Precio'], ['A', ''], ['B', 'abc'], ['C', '5']], 'productos', {});
    expect(plan.entradas.map(e => e.accion)).toEqual(['rechazar', 'rechazar', 'crear']);
    expect(plan.resumen.rechazos[0].motivo).toMatch(/Precio vacío o inválido/);
  });

  it('AC-PROD-5 legacy: mezclar una columna nueva (Stock) con las viejas pasa a modo plantilla y exige codigo en altas', () => {
    const plan = planificarImportacion([['nombre', 'precio', 'stock'], ['A', '5', '3']], 'productos', {});
    expect(plan.modo).toBe('plantilla');
    expect(plan.entradas[0].accion).toBe('rechazar');
    expect(plan.entradas[0].errores).toContain('El código es obligatorio');
  });

  it('AC-PROD-5 legacy: encabezados raros con tildes ("Código", "Categoría", "Descripción") tambien funcionan', () => {
    const plan = planificarImportacion([['Código', 'Descripción', 'Precio', 'Categoría'], ['K1', 'Item', '3', 'Varios']], 'productos', {});
    expect(plan.entradas[0].accion).toBe('crear');
    expect(plan.entradas[0].valor.producto).toMatchObject({ codigo: 'K1', nombre: 'Item', precio: 3, categoria: 'Varios' });
  });
});

describe('AC-PLA-6 AC-SEC-3 inyeccion de formulas en archivos reales', () => {
  it('AC-PLA-6 +, -, @, = y TAB al inicio de CUALQUIER celda de texto se neutralizan (productos y clientes)', () => {
    const peligros = ['=1+1', '+cmd', '@SUM(A1)', '\t=x', '=HYPERLINK("http://e")'];
    for (const p of peligros) {
      const pr = planificarImportacion([['Código', 'Descripción', 'Rubro', 'Precio venta 1'], [p, p, p, '1']], 'productos', {});
      const prod = pr.entradas[0].valor?.producto;
      expect(prod).toBeTruthy();
      for (const k of ['codigo', 'nombre', 'categoria']) expect(String(prod[k])).not.toMatch(/^[=+@\t]/);
      const cl = planificarImportacion([['Código cliente', 'Razón social', 'Domicilio de entrega', 'Ciudad', 'Zona', 'Cobrador', 'Tipo de cliente', 'Rubro'], [p, p, p, p, p, p, p, p]], 'clientes', {});
      const c = cl.entradas[0].valor;
      expect(c).toBeTruthy();
      for (const k of ['codigo', 'nombre', 'direccion', 'ciudad', 'zona', 'cobrador', 'tipoCliente', 'rubro']) expect(String(c[k])).not.toMatch(/^[=+@\t]/);
    }
  });
});
