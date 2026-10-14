// REQ-PLA — plantillas Excel e importacion de productos y clientes (dominio).
import {
  COLUMNAS_PLANTILLA, NOMBRE_ARCHIVO_PLANTILLA, ENCABEZADO_INSTRUCCIONES,
  normalizarEncabezado, mapearEncabezados, normalizarFecha,
  resolverProveedor, resolverVendedor,
  validarFilaProducto, validarFilaCliente,
  planificarImportacion, resumirEntradas, textoResumen,
  filasInstrucciones, armarPlantilla,
  CAMPOS_EXCLUIDOS_PLANTILLA, avisoColumnasExcluidas,
} from '../plantillas';
import { CAMPOS_PRODUCTO, calcularPrecioVenta } from '../productos';
import { CAMPOS_CLIENTE, PROVINCIAS, TIPOS_IVA } from '../clientes';

const NOW = new Date(2026, 9, 12);
const PROVEEDORES = [
  { id: 'prov-1', codigo: 'ARC', descripcion: 'Arcor' },
  { id: 'prov-2', codigo: 'MOL', descripcion: 'Molinos' },
];
const VENDEDORES = [
  { id: 1, nombre: 'Admin', permiso: 1 },
  { id: 2, nombre: 'Juan Pérez', permiso: 2 },
  { id: 3, nombre: 'Baja', permiso: 2, activo: false },
];
const PRODUCTOS = [
  { id: 1, nombre: 'Bon o Bon', codigo: 'B1', precio: 300, unidad: 'unidad', proveedorId: 'prov-1', costoFinal: 200, ganancia: 50 },
  { id: 2, nombre: 'Coca Cola 500ml', codigo: 'CC500', precio: 1500, unidad: 'unidad' },
  { id: 3, nombre: 'Sin Codigo', precio: 10, unidad: 'caja' },
];
const CLIENTES = [{ id: 10, codigo: '0010', nombre: 'Kiosco Pepe', direccion: 'Mitre 1', vendedor: 'Admin', comision: 3 }];

const LABELS_P = CAMPOS_PRODUCTO.map(c => c.label);
// AC-PLA-2 (decision del dueño 2026-10-12): la plantilla de clientes es la del
// formulario MENOS "Comisión" (16 columnas).
const LABELS_C = CAMPOS_CLIENTE.filter(c => c.key !== 'comision').map(c => c.label);
const filaP = (obj) => LABELS_P.map(l => obj[l] ?? '');
const filaC = (obj) => LABELS_C.map(l => obj[l] ?? '');

describe('AC-PLA-1 / AC-PLA-2 / AC-PLA-7 columnas = campos del formulario', () => {
  it('AC-PLA-1 productos: mismas etiquetas, mismo orden y mismas keys que ProductoForm (CAMPOS_PRODUCTO)', () => {
    expect(COLUMNAS_PLANTILLA.productos.map(c => c.label)).toEqual(LABELS_P);
    expect(COLUMNAS_PLANTILLA.productos.map(c => c.key)).toEqual(CAMPOS_PRODUCTO.map(c => c.key));
    expect(LABELS_P).toEqual(['Código', 'Descripción', 'Rubro', 'Marca', 'Proveedor', 'Costo final', 'Descuento 1', 'Descuento 2',
      '% Ganancia', 'Precio venta 1', 'Precio venta 2', 'Bulto x', 'Se vende por', 'Etiqueta del bulto', 'Mostrar en tienda', 'Mínimo venta', 'Stock']);
    expect(NOMBRE_ARCHIVO_PLANTILLA.productos).toBe('plantilla_productos.xlsx');
  });

  // MOD (RUN 20261012-2106): antes esperaba los 17 campos de REQ-CLI. El dueño
  // decidio (AC-PLA-2, 2026-10-12) sacar Comisión de la plantilla: quedan 16,
  // en el mismo orden y con las mismas etiquetas del formulario.
  it('AC-PLA-2 clientes: los 16 campos de REQ-CLI en orden (CAMPOS_CLIENTE sin Comisión)', () => {
    expect(COLUMNAS_PLANTILLA.clientes.map(c => c.label)).toEqual(LABELS_C);
    expect(LABELS_C).toHaveLength(16);
    expect(LABELS_C[0]).toBe('Código cliente');
    expect(LABELS_C[15]).toBe('Rubro');
    expect(NOMBRE_ARCHIVO_PLANTILLA.clientes).toBe('plantilla_clientes.xlsx');
  });

  it('AC-PLA-2 la plantilla de clientes no tiene Comisión (ni columna ni instrucciones)', () => {
    expect(CAMPOS_EXCLUIDOS_PLANTILLA.clientes).toEqual(['comision']);
    expect(CAMPOS_EXCLUIDOS_PLANTILLA.productos).toEqual([]);
    expect(COLUMNAS_PLANTILLA.clientes.map(c => c.key)).not.toContain('comision');
    // MOD (RUN 20261014-1449, AC-COMR-1/2): antes el formulario seguía teniendo
    // 'comision' (17); ahora tampoco la tiene (16) y 'comision' queda solo
    // como alias legacy en CAMPOS_EXCLUIDOS_PLANTILLA.
    expect(CAMPOS_CLIENTE.map(c => c.key)).not.toContain('comision');
    const p = armarPlantilla('clientes');
    expect(p.hojas[0].filas[0]).toHaveLength(16);
    expect(p.hojas.flatMap(h => h.filas).flat().some(c => /comisi[oó]n/i.test(String(c)))).toBe(false);
    // El orden relativo del resto es el del formulario.
    expect(COLUMNAS_PLANTILLA.clientes.map(c => c.label)).toEqual(CAMPOS_CLIENTE.filter(c => c.key !== 'comision').map(c => c.label));
  });

  it('AC-PLA-7 cada columna tiene instrucciones (obligatorio, formato, ejemplo)', () => {
    for (const ent of ['productos', 'clientes']) {
      for (const c of COLUMNAS_PLANTILLA[ent]) {
        expect(c.obligatorio).toBeTruthy();
        expect(c.formato).toBeTruthy();
        expect(c).toHaveProperty('ejemplo');
      }
    }
  });

  it('AC-PLA-7 todas las etiquetas de la plantilla se mapean a su propio campo al importar', () => {
    for (const ent of ['productos', 'clientes']) {
      const cols = COLUMNAS_PLANTILLA[ent];
      const { indices, ignoradas } = mapearEncabezados(cols.map(c => c.label), ent);
      cols.forEach((c, i) => expect(indices[c.key]).toBe(i));
      expect(ignoradas).toEqual([]);
    }
  });

  it('AC-PLA-7 entidad desconocida lanza error', () => {
    expect(() => armarPlantilla('pedidos')).toThrow('Entidad desconocida');
    expect(() => mapearEncabezados(['a'], 'pedidos')).toThrow();
  });
});

describe('AC-PLA-3 mapeo de encabezados (nuevos y viejos)', () => {
  it('AC-PLA-3 normaliza sin tildes, mayúsculas ni espacios', () => {
    expect(normalizarEncabezado(' % GANANCIA ')).toBe('ganancia');
    expect(normalizarEncabezado('Mínimo  venta')).toBe('minimoventa');
    expect(normalizarEncabezado(null)).toBe('');
  });

  it('AC-PLA-3 tolerante: "codigo", "DESCRIPCION", "precio venta 1", "minimo venta" => modo plantilla', () => {
    const m = mapearEncabezados(['codigo', 'DESCRIPCION', 'precio venta 1', 'precio venta 2', 'minimo venta', 'cualquiera'], 'productos');
    expect(m.indices).toMatchObject({ codigo: 0, nombre: 1, precio: 2, precioVenta2: 3, minimoVenta: 4 });
    expect(m.ignoradas).toEqual(['cualquiera']);
    expect(m.modo).toBe('plantilla');
  });

  it('AC-PROD-5 AC-PLA-3 encabezados viejos (nombre/precio/codigo/unidad/categoria) => modo legacy', () => {
    const m = mapearEncabezados(['nombre', 'precio', 'codigo', 'unidad', 'categoria'], 'productos');
    expect(m.indices).toEqual({ nombre: 0, precio: 1, codigo: 2, unidad: 3, categoria: 4 });
    expect(m.modo).toBe('legacy');
  });

  it('AC-PROD-5 AC-PLA-3 coincidencias parciales viejas (Nombre del producto, Precio de venta, SKU, Familia, Unit)', () => {
    const m = mapearEncabezados(['Nombre del producto', 'Precio de Venta $', 'SKU interno', 'Familia', 'Units'], 'productos');
    expect(m.indices).toEqual({ nombre: 0, precio: 1, codigo: 2, categoria: 3, unidad: 4 });
    expect(m.modo).toBe('legacy');
    expect(mapearEncabezados(['art', 'PCIO', 'ref'], 'productos').indices).toMatchObject({ precio: 1, codigo: 2 });
  });

  it('AC-PLA-3 clientes: alias razon social / domicilio / cp / iva', () => {
    const m = mapearEncabezados(['Codigo', 'Razon Social', 'Domicilio', 'CP', 'IVA', 'telefono'], 'clientes');
    expect(m.indices).toEqual({ codigo: 0, nombre: 1, direccion: 2, codigoPostal: 3, tipoIva: 4, telefono: 5 });
  });
});

describe('AC-PLA-3 validación por fila de productos', () => {
  const ctx = { existentes: PRODUCTOS, proveedores: PROVEEDORES };

  it('AC-PLA-3 fila completa válida: proveedor por nombre, % y precios normalizados', () => {
    const r = validarFilaProducto({
      codigo: 'N1', nombre: 'Nuevo', categoria: 'Golosinas', proveedorId: '  arcor ', costoFinal: '1.000,00',
      descuento1: '10%', descuento2: '0', ganancia: '50', precio: '', precioVenta2: '1300', bultoX: '12', minimoVenta: '2', stock: '24',
    }, ctx);
    expect(r.ok).toBe(true);
    expect(r.valor.producto).toMatchObject({ codigo: 'N1', proveedorId: 'prov-1', costoFinal: 1000, descuento1: 10, bultoX: 12, minimoVenta: 2, precioVenta2: 1300, unidad: 'unidad' });
    expect(r.valor.stock).toBe(24);
  });

  it('AC-PLA-3 Precio venta 1 vacío se calcula con AC-PROD-1', () => {
    const v = { codigo: 'N2', nombre: 'X', costoFinal: '1000', descuento1: '10', descuento2: '5', ganancia: '30', precio: '' };
    const r = validarFilaProducto(v, ctx);
    expect(r.valor.producto.precio).toBe(calcularPrecioVenta(v).precioVenta1);
    expect(r.valor.producto.precio).toBe(1111.5);
  });

  it('AC-PLA-3 Precio venta 1 cargado se respeta', () => {
    expect(validarFilaProducto({ codigo: 'N3', nombre: 'X', costoFinal: '100', precio: '999' }, ctx).valor.producto.precio).toBe(999);
  });

  it('AC-PLA-3 % fuera de rango, bulto 0, mínimo decimal y precio negativo se rechazan', () => {
    const r = validarFilaProducto({ codigo: 'N4', nombre: 'X', descuento1: '150', descuento2: '-1', bultoX: '0', minimoVenta: '1.5', precioVenta2: '-3' }, ctx);
    expect(r.ok).toBe(false);
    const txt = r.errores.join(' | ');
    expect(txt).toMatch(/Descuento 1: % entre 0 y 100/);
    expect(txt).toMatch(/Descuento 2: % entre 0 y 100/);
    expect(txt).toMatch(/Bulto x: entero/);
    expect(txt).toMatch(/Mínimo venta: entero/);
    expect(txt).toMatch(/Precio venta 2 inválido/);
  });

  it('AC-PLA-3 proveedor inexistente rechaza la fila', () => {
    const r = validarFilaProducto({ codigo: 'N5', nombre: 'X', proveedorId: 'Nestle' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.errores).toContain('Proveedor "Nestle" no existe');
  });

  it('AC-PLA-3 código obligatorio en alta de plantilla', () => {
    const r = validarFilaProducto({ codigo: '', nombre: 'X', precio: '1' }, ctx);
    expect(r.errores).toContain('El código es obligatorio');
  });

  it('AC-PLA-3 código de otro producto existente se rechaza', () => {
    const r = validarFilaProducto({ codigo: 'cc500', nombre: 'Bon o Bon', precio: '1' }, { ...ctx, existente: PRODUCTOS[0] });
    expect(r.ok).toBe(false);
    expect(r.errores.join()).toMatch(/ya está usado por "Coca Cola 500ml"/);
  });

  it('AC-PLA-3 stock solo en nuevos: en un existente se ignora y se avisa', () => {
    const r = validarFilaProducto({ codigo: 'B1', nombre: 'Bon o Bon', stock: '99' }, { ...ctx, existente: PRODUCTOS[0] });
    expect(r.ok).toBe(true);
    expect(r.valor.stock).toBeNull();
    expect(r.stockIgnorado).toBe(true);
  });

  it('AC-PLA-3 existente sin cambios de costo conserva precio y proveedor; con costo nuevo y precio vacío recalcula', () => {
    const r = validarFilaProducto({ codigo: 'B1', nombre: 'Bon o Bon', precio: '' }, { ...ctx, existente: PRODUCTOS[0] });
    expect(r.valor.producto).toMatchObject({ precio: 300, proveedorId: 'prov-1', costoFinal: 200 });
    const r2 = validarFilaProducto({ codigo: 'B1', costoFinal: '400', precio: '' }, { ...ctx, existente: PRODUCTOS[0] });
    expect(r2.valor.producto.precio).toBe(600);
  });

  it('AC-PLA-3 proveedor por código y por etiqueta "COD — Descripción"; ambiguo se rechaza', () => {
    expect(resolverProveedor('mol', PROVEEDORES)).toEqual({ ok: true, id: 'prov-2' });
    expect(resolverProveedor('ARC — Arcor', PROVEEDORES)).toEqual({ ok: true, id: 'prov-1' });
    expect(resolverProveedor('', PROVEEDORES)).toEqual({ ok: true, id: null });
    const dobles = [...PROVEEDORES, { id: 'prov-3', codigo: 'AR2', descripcion: 'ARCOR' }];
    expect(resolverProveedor('arcor', dobles).ok).toBe(false);
    expect(resolverProveedor('x', null).ok).toBe(false);
  });

  it('AC-PLA-6 AC-SEC-3 formula injection =cmd en texto queda neutralizada', () => {
    const r = validarFilaProducto({ codigo: '=cmd()', nombre: '+SUM(A1)', categoria: '@x', precio: '1' }, ctx);
    expect(r.valor.producto).toMatchObject({ codigo: "'=cmd()", nombre: "'+SUM(A1)", categoria: "'@x" });
  });

  it('AC-PROD-5 modo legacy: sin código se acepta y precio vacío se rechaza', () => {
    expect(validarFilaProducto({ nombre: 'Viejo', precio: '10' }, { modo: 'legacy' }).ok).toBe(true);
    const r = validarFilaProducto({ nombre: 'Viejo', precio: '' }, { modo: 'legacy' });
    expect(r.errores).toContain('Precio vacío o inválido');
  });

  it('AC-PROD-5 unidad: "-" o vacía conserva la existente, otra se aplica', () => {
    expect(validarFilaProducto({ nombre: 'Sin Codigo', precio: '1', unidad: '-' }, { modo: 'legacy', existente: PRODUCTOS[2] }).valor.producto.unidad).toBe('caja');
    expect(validarFilaProducto({ nombre: 'A', precio: '1', unidad: 'kg' }, { modo: 'legacy' }).valor.producto.unidad).toBe('kg');
  });
});

describe('AC-PLA-4 validación por fila de clientes', () => {
  const ctx = { existentes: CLIENTES, vendedores: VENDEDORES, now: NOW };

  // MOD (RUN 20261012-2106): antes esperaba comision: 5 desde la celda '5%'.
  // Con AC-PLA-4 (dueño, 2026-10-12) la comisión del archivo se ignora: en un
  // alta queda null y se carga desde la ficha.
  it('AC-PLA-4 fila válida: CUIT normalizado, provincia/IVA sin tildes, vendedor por nombre, fecha default hoy', () => {
    const r = validarFilaCliente({
      codigo: '0042', nombre: 'Almacén Sol', direccion: 'San Martín 50', provincia: 'cordoba', tipoIva: 'responsable inscripto',
      cuit: '20123456786', telefono: '341 555-1234', vendedor: ' juan perez ', comision: '5%', fechaAlta: '',
    }, ctx);
    expect(r.ok).toBe(true);
    expect(r.valor).toMatchObject({
      codigo: '0042', provincia: 'Córdoba', tipoIva: 'Responsable Inscripto', cuit: '20-12345678-6',
      telefono: '3415551234', vendedor: 'Juan Pérez', fechaAlta: '2026-10-12', pais: 'Argentina',
    });
    // MOD (RUN 20261014-1449, AC-COMR-2): antes comision: null en el alta; ahora la clave no existe.
    expect(r.valor).not.toHaveProperty('comision');
  });

  it('AC-PLA-4 la comisión del archivo no se valida ni se toma (alta: null; actualización: la de la ficha)', () => {
    // Un valor fuera de rango ya no rechaza la fila: se ignora.
    const alta = validarFilaCliente({ codigo: 'N9', nombre: 'A', direccion: 'B', comision: '150' }, ctx);
    expect(alta.ok).toBe(true);
    // MOD (RUN 20261014-1449, AC-COMR-2): antes alta.valor.comision era null; ahora la clave no existe.
    expect(alta.valor).not.toHaveProperty('comision');
    const upd = validarFilaCliente({ codigo: '0010', nombre: 'Kiosco Pepe', direccion: 'Mitre 1', comision: '99' }, { ...ctx, existente: CLIENTES[0] });
    expect(upd.ok).toBe(true);
    expect(upd.valor).not.toHaveProperty('comision');
    expect({ ...CLIENTES[0], ...upd.valor }.comision).toBe(3);
    // Una comisión legacy inválida en la ficha no frena la importación.
    const legacy = { id: 11, codigo: 'L1', nombre: 'Legacy', direccion: 'X', comision: 150 };
    const r2 = validarFilaCliente({ codigo: 'L1', direccion: 'Y' }, { ...ctx, existentes: [...CLIENTES, legacy], existente: legacy });
    expect(r2.ok).toBe(true);
    expect({ ...legacy, ...r2.valor }.comision).toBe(150);
  });

  it('AC-PLA-4 CUIT inválido se rechaza', () => {
    const r = validarFilaCliente({ codigo: 'X1', nombre: 'A', direccion: 'B', tipoIva: 'Monotributo', cuit: '20-12345678-0' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.errores.join()).toMatch(/CUIT inválido/);
  });

  // MOD (RUN 20261012-2106): antes tambien esperaba el error "comisión debe
  // ser un % entre 0 y 100". AC-PLA-4 ya no valida la comisión del archivo
  // (se ignora): ahora se verifica que ese error NO aparezca.
  it('AC-PLA-4 obligatorios, provincia/IVA fuera de lista y fecha inválida (la comisión no se valida)', () => {
    const r = validarFilaCliente({ codigo: '', nombre: '', direccion: '', provincia: 'Narnia', tipoIva: 'Otro', comision: '150', fechaAlta: '31/02/2026' }, ctx);
    const txt = r.errores.join(' | ');
    expect(txt).toMatch(/código es obligatorio/);
    expect(txt).toMatch(/razón social es obligatoria/);
    expect(txt).toMatch(/domicilio de entrega es obligatorio/);
    expect(txt).toMatch(/Provincia inválida/);
    expect(txt).toMatch(/Tipo de IVA inválido/);
    expect(txt).not.toMatch(/comisi/i);
    expect(txt).toMatch(/Fecha de alta inválida/);
  });

  it('AC-PLA-4 vendedor inexistente o dado de baja se rechaza', () => {
    expect(validarFilaCliente({ codigo: 'A', nombre: 'A', direccion: 'B', vendedor: 'Nadie' }, ctx).errores)
      .toContain('Vendedor "Nadie" no existe o está dado de baja');
    expect(validarFilaCliente({ codigo: 'A', nombre: 'A', direccion: 'B', vendedor: 'baja' }, ctx).ok).toBe(false);
    expect(resolverVendedor('', VENDEDORES)).toEqual({ ok: true, nombre: '' });
  });

  it('AC-PLA-4 actualizar: celdas vacías conservan lo que tenía el cliente', () => {
    const r = validarFilaCliente({ codigo: '0010', nombre: '', direccion: 'Nueva 2' }, { ...ctx, existente: CLIENTES[0] });
    expect(r.ok).toBe(true);
    // MOD (RUN 20261012-2106): la comisión ya no viaja en `valor` de una
    // actualización (AC-PLA-4); se conserva la de la ficha al hacer el merge.
    expect(r.valor).toMatchObject({ nombre: 'Kiosco Pepe', direccion: 'Nueva 2', vendedor: 'Admin' });
    expect({ ...CLIENTES[0], ...r.valor }.comision).toBe(3);
  });

  it('AC-PLA-4 fecha DD/MM/AAAA se pasa a ISO', () => {
    expect(normalizarFecha('5/3/2026')).toBe('2026-03-05');
    expect(normalizarFecha('2026-03-05')).toBe('2026-03-05');
    expect(normalizarFecha('31/02/2026')).toBe('31/02/2026');
    expect(normalizarFecha(null)).toBe('');
  });

  it('AC-PLA-6 AC-SEC-3 formula injection en razón social / domicilio queda neutralizada', () => {
    const r = validarFilaCliente({ codigo: 'Z1', nombre: '=cmd|"/c calc"!A1', direccion: '@SUM(1)' }, ctx);
    expect(r.valor.nombre.startsWith("'=")).toBe(true);
    expect(r.valor.direccion).toBe("'@SUM(1)");
  });
});

describe('AC-PLA-3 / AC-PLA-4 / AC-PLA-5 planificarImportacion', () => {
  it('AC-PLA-5 productos: crea, actualiza y rechaza con número de fila y motivo; una fila mala no frena el resto', () => {
    const rows = [
      LABELS_P,
      filaP({ 'Código': 'N1', 'Descripción': 'Nuevo', 'Costo final': '100', '% Ganancia': '20', 'Stock': '5' }),
      [],
      filaP({ 'Código': 'b1', 'Descripción': 'Bon o Bon XL', 'Stock': '7' }),
      filaP({ 'Código': 'N2', 'Descripción': 'Malo', 'Descuento 1': '200' }),
      filaP({ 'Código': 'N3', 'Descripción': 'Otro', 'Proveedor': 'Inexistente' }),
      filaP({ 'Código': 'n1', 'Descripción': 'Repetido' }),
    ];
    const plan = planificarImportacion(rows, 'productos', { existentes: PRODUCTOS, proveedores: PROVEEDORES });
    expect(plan.ok).toBe(true);
    expect(plan.modo).toBe('plantilla');
    expect(plan.entradas.map(e => [e.fila, e.accion])).toEqual([[2, 'crear'], [4, 'actualizar'], [5, 'rechazar'], [6, 'rechazar'], [7, 'rechazar']]);
    expect(plan.entradas[0].valor.producto.precio).toBe(120);
    expect(plan.entradas[0].valor.stock).toBe(5);
    expect(plan.entradas[1].existente.id).toBe(1);
    expect(plan.entradas[1].valor.stock).toBeNull();
    expect(plan.resumen).toMatchObject({ creados: 1, actualizados: 1, rechazados: 3, stockIgnorado: 1 });
    expect(plan.resumen.rechazos[0]).toEqual({ fila: 5, motivo: 'Descuento 1: % entre 0 y 100' });
    expect(plan.resumen.rechazos[1].motivo).toMatch(/Proveedor "Inexistente" no existe/);
    expect(plan.resumen.rechazos[2].motivo).toMatch(/Código repetido en el archivo \(ya está en la fila 2\)/);
  });

  it('AC-PLA-3 sin código busca por nombre (como hoy)', () => {
    const rows = [LABELS_P, filaP({ 'Descripción': 'sin codigo', 'Precio venta 1': '20' })];
    const plan = planificarImportacion(rows, 'productos', { existentes: PRODUCTOS });
    expect(plan.entradas[0]).toMatchObject({ accion: 'actualizar' });
    expect(plan.entradas[0].existente.id).toBe(3);
    expect(plan.entradas[0].valor.producto.precio).toBe(20);
  });

  it('AC-PROD-5 archivo viejo: modo legacy, la última fila repetida gana (fusionada)', () => {
    const rows = [['nombre', 'precio', 'codigo'], ['Alfajor', '10', 'A1'], ['Alfajor', '12', 'A1'], ['Coca Cola 500ml', '1600', ''], ['coca cola 500ml', '1700', '']];
    const plan = planificarImportacion(rows, 'productos', { existentes: PRODUCTOS });
    expect(plan.modo).toBe('legacy');
    expect(plan.entradas.map(e => e.accion)).toEqual(['crear', 'fusionada', 'actualizar', 'fusionada']);
    expect(plan.entradas[0].valor.producto.precio).toBe(12);
    expect(plan.entradas[2].valor.producto.precio).toBe(1700);
    expect(plan.entradas[2].valor.producto.codigo).toBe('CC500');
    expect(textoResumen(plan.resumen)).toBe('✓ 1 creado, 3 actualizados.');
  });

  it('AC-PROD-5 archivo viejo: fila repetida inválida se rechaza sin pisar la previa', () => {
    const plan = planificarImportacion([['nombre', 'precio'], ['A', '1'], ['A', 'abc']], 'productos', {});
    expect(plan.entradas.map(e => e.accion)).toEqual(['crear', 'rechazar']);
    expect(plan.entradas[0].valor.producto.precio).toBe(1);
  });

  it('AC-PROD-5 errores de estructura: sin datos, sin nombre, sin precio', () => {
    expect(planificarImportacion([['nombre', 'precio']], 'productos').error).toBe('El archivo no tiene datos suficientes.');
    expect(planificarImportacion(null, 'productos').ok).toBe(false);
    expect(planificarImportacion([['precio'], ['1']], 'productos').error).toMatch(/No se encontró columna de nombre/);
    expect(planificarImportacion([['nombre', 'costo'], ['a', '1']], 'productos').error).toMatch(/No se encontró columna de precio/);
  });

  it('AC-PLA-4 clientes: upsert por código, duplicado en el archivo y faltantes', () => {
    const rows = [
      LABELS_C,
      filaC({ 'Código cliente': '0042', 'Razón social': 'Nuevo', 'Domicilio de entrega': 'X 1', 'Tipo de IVA': 'Consumidor Final' }),
      filaC({ 'Código cliente': '0010', 'Razón social': 'Kiosco Pepe SRL', 'Domicilio de entrega': 'Mitre 1' }),
      filaC({ 'Código cliente': ' 0042 ', 'Razón social': 'Dup', 'Domicilio de entrega': 'Y' }),
      filaC({ 'Código cliente': '0050', 'Razón social': 'Malo', 'Domicilio de entrega': 'Z', 'Tipo de IVA': 'Monotributo', 'CUIT': '20123456780' }),
      filaC({ 'Código cliente': '0051', 'Razón social': 'Vend', 'Domicilio de entrega': 'Z', 'Vendedor': 'Fantasma' }),
    ];
    const plan = planificarImportacion(rows, 'clientes', { existentes: CLIENTES, vendedores: VENDEDORES, now: NOW });
    expect(plan.entradas.map(e => [e.fila, e.accion])).toEqual([[2, 'crear'], [3, 'actualizar'], [4, 'rechazar'], [5, 'rechazar'], [6, 'rechazar']]);
    expect(plan.entradas[1].existente.id).toBe(10);
    expect(plan.resumen.rechazos.map(r => r.fila)).toEqual([4, 5, 6]);
    expect(plan.resumen.rechazos[0].motivo).toMatch(/Código repetido en el archivo/);
    expect(plan.resumen.rechazos[1].motivo).toMatch(/CUIT inválido/);
    expect(plan.resumen.rechazos[2].motivo).toMatch(/Vendedor "Fantasma"/);
  });

  it('AC-PLA-4 clientes sin columnas obligatorias => error de estructura', () => {
    const plan = planificarImportacion([['Razón social'], ['A']], 'clientes');
    expect(plan.ok).toBe(false);
    expect(plan.error).toMatch(/Faltan columnas obligatorias: Código cliente, Domicilio de entrega/);
  });

  it('AC-PLA-5 resumirEntradas / textoResumen', () => {
    const r = resumirEntradas([{ accion: 'crear' }, { accion: 'rechazar', fila: 3 }, { accion: 'rechazar', fila: 4, errores: ['a', 'b'] }]);
    expect(r).toMatchObject({ creados: 1, actualizados: 0, rechazados: 2 });
    expect(r.rechazos).toEqual([{ fila: 3, motivo: 'Fila inválida' }, { fila: 4, motivo: 'a; b' }]);
    expect(textoResumen(r)).toBe('✓ 1 creado, 0 actualizados, 2 líneas ignoradas.');
    expect(textoResumen({ rechazados: 1 })).toBe('✓ 0 creados, 0 actualizados, 1 línea ignorada.');
    expect(textoResumen()).toBe('✓ 0 creados, 0 actualizados.');
    expect(resumirEntradas()).toMatchObject({ creados: 0 });
  });
});

describe('AC-PLA-1 / AC-PLA-2 / AC-PLA-6 armado de la plantilla', () => {
  it('AC-PLA-1 hoja 1 solo encabezados, hoja 2 "Instrucciones" con una fila por columna', () => {
    const p = armarPlantilla('productos', { proveedores: PROVEEDORES });
    expect(p.nombreArchivo).toBe('plantilla_productos.xlsx');
    expect(p.hojas.map(h => h.nombre)).toEqual(['Productos', 'Instrucciones']);
    expect(p.hojas[0].filas).toEqual([LABELS_P]);
    const inst = p.hojas[1].filas;
    expect(inst[0]).toEqual(ENCABEZADO_INSTRUCCIONES);
    expect(inst.slice(1, 1 + LABELS_P.length).map(f => f[0])).toEqual(LABELS_P);
    expect(inst.find(f => f[0] === 'Proveedor')[3]).toBe('Arcor, Molinos');
    expect(inst.find(f => f[0] === 'Stock')[2]).toMatch(/Solo para productos NUEVOS/);
  });

  it('AC-PLA-2 clientes: provincias, tipos de IVA y vendedores activos en "Valores válidos"', () => {
    const inst = filasInstrucciones('clientes', { vendedores: VENDEDORES });
    expect(inst.find(f => f[0] === 'Provincia')[3]).toBe(PROVINCIAS.join(', '));
    expect(inst.find(f => f[0] === 'Tipo de IVA')[3]).toBe(TIPOS_IVA.join(', '));
    expect(inst.find(f => f[0] === 'Vendedor')[3]).toBe('Admin, Juan Pérez');
    expect(armarPlantilla('clientes').hojas[0].filas[0]).toEqual(LABELS_C);
    // Sin listas cargadas, un texto de ayuda
    expect(filasInstrucciones('clientes').find(f => f[0] === 'Vendedor')[3]).toMatch(/Vendedores activos/);
    expect(filasInstrucciones('productos').find(f => f[0] === 'Proveedor')[3]).toMatch(/Proveedores de/);
  });

  it('AC-PLA-6 AC-SEC-3 nombres de proveedores/vendedores con fórmula se exportan neutralizados', () => {
    const inst = filasInstrucciones('productos', { proveedores: [{ id: 'p', codigo: 'X', descripcion: '=HYPERLINK("http://x")' }] });
    const celdas = inst.flat();
    expect(celdas.some(c => typeof c === 'string' && /^[=+@]/.test(c))).toBe(false);
    expect(inst.find(f => f[0] === 'Proveedor')[3].startsWith("'=")).toBe(true);
  });
});

describe('AC-PLA-4 columna "Comisión" en el archivo de clientes se ignora y se avisa', () => {
  // MOD (RUN 20261014-1449, AC-COMR-2): antes salía de CAMPOS_CLIENTE (17);
  // ahora CAMPOS_CLIENTE no tiene Comisión, así que el archivo viejo se arma
  // explícito: las 16 etiquetas con 'Comisión' en su lugar original.
  const LABELS_C16 = CAMPOS_CLIENTE.map(c => c.label);
  const LABELS_CON_COMISION = [...LABELS_C16.slice(0, 13), 'Comisión', ...LABELS_C16.slice(13)];
  const filaCC = (obj) => LABELS_CON_COMISION.map(l => obj[l] ?? '');

  it('AC-PLA-4 mapearEncabezados: "Comisión" va a excluidas (no a indices ni a ignoradas)', () => {
    const m = mapearEncabezados(['Código cliente', 'Comisión', 'Razón social', 'Domicilio de entrega', 'Otra'], 'clientes');
    expect(m.indices).not.toHaveProperty('comision');
    expect(m.excluidas).toEqual(['Comisión']);
    expect(m.ignoradas).toEqual(['Otra']);
    expect(mapearEncabezados(['codigo', 'COMISION %'], 'clientes').excluidas).toEqual(['COMISION %']);
    expect(mapearEncabezados(['Código', 'Descripción'], 'productos').excluidas).toEqual([]);
  });

  it('AC-PLA-4 importar con Comisión no cambia la ficha de un existente ni la pone en uno nuevo', () => {
    const rows = [
      LABELS_CON_COMISION,
      filaCC({ 'Código cliente': '0099', 'Razón social': 'Nuevo', 'Domicilio de entrega': 'X 1', 'Comisión': '7' }),
      filaCC({ 'Código cliente': '0010', 'Razón social': 'Kiosco Pepe SRL', 'Domicilio de entrega': 'Mitre 1', 'Comisión': '9' }),
      filaCC({ 'Código cliente': '0098', 'Razón social': 'Fuera de rango', 'Domicilio de entrega': 'Z', 'Comisión': '150' }),
    ];
    const plan = planificarImportacion(rows, 'clientes', { existentes: CLIENTES, vendedores: VENDEDORES, now: NOW });
    expect(plan.ok).toBe(true);
    expect(plan.excluidas).toEqual(['Comisión']);
    expect(plan.ignoradas).toEqual([]);
    expect(plan.entradas.map(e => e.accion)).toEqual(['crear', 'actualizar', 'crear']);
    // MOD (RUN 20261014-1449, AC-COMR-2): antes las altas traían comision: null; ahora no traen la clave.
    expect(plan.entradas[0].valor).not.toHaveProperty('comision');
    expect(plan.entradas[2].valor).not.toHaveProperty('comision');
    expect(plan.entradas[1].valor).not.toHaveProperty('comision');
    expect({ ...CLIENTES[0], ...plan.entradas[1].valor }.comision).toBe(3);
    expect(plan.resumen).toMatchObject({ creados: 2, actualizados: 1, rechazados: 0, columnasExcluidas: ['Comisión'] });
  });

  it('AC-PLA-4 AC-PLA-5 el resumen avisa que la columna Comisión se ignoró', () => {
    const rows = [['Código cliente', 'Razón social', 'Domicilio de entrega', 'Comisión'], ['0099', 'Nuevo', 'X', '5']];
    const plan = planificarImportacion(rows, 'clientes', { existentes: [], now: NOW });
    const txt = textoResumen(plan.resumen);
    // MOD (RUN 20261014-1449, AC-COMR-2): texto nuevo; el viejo ("desde la ficha del cliente") quedó falso.
    expect(txt).toBe('✓ 1 creado, 0 actualizados. La columna "Comisión" se ignoró: ahora la comisión se carga por vendedor y rubro (Configuración → Vendedores).');
    // Sin la columna, el texto es el de siempre.
    const sin = planificarImportacion([['Código cliente', 'Razón social', 'Domicilio de entrega'], ['0099', 'Nuevo', 'X']], 'clientes', { now: NOW });
    expect(sin.resumen.columnasExcluidas).toEqual([]);
    expect(textoResumen(sin.resumen)).toBe('✓ 1 creado, 0 actualizados.');
  });

  it('AC-PLA-4 avisoColumnasExcluidas tolera entradas hostiles', () => {
    expect(avisoColumnasExcluidas()).toBe('');
    expect(avisoColumnasExcluidas(null)).toBe('');
    expect(avisoColumnasExcluidas('Comisión')).toBe('');
    expect(avisoColumnasExcluidas(['', null])).toBe('');
    expect(avisoColumnasExcluidas(['Comisión', 'Comision %'])).toMatch(/^La columna "Comisión", "Comision %" se ignoró/);
    expect(resumirEntradas([], { excluidas: 'x' }).columnasExcluidas).toEqual([]);
    expect(resumirEntradas([], { excluidas: ['Comisión', null] }).columnasExcluidas).toEqual(['Comisión']);
  });
});

describe('AC-PLA-5 AC-PROD-3 C9 stock inicial fallido en una importación parcial', () => {
  it('AC-PLA-5 AC-PROD-3 resumirEntradas cuenta stockFallido como creado y textoResumen lo avisa', () => {
    const r = resumirEntradas([
      { accion: 'crear', fila: 2 },
      { accion: 'crear', fila: 3, stockFallido: true, errores: ['Stock inicial no cargado: boom'] },
      { accion: 'crear', fila: 4, stockFallido: true },
      { accion: 'rechazar', fila: 5, errores: ['x'] },
    ]);
    expect(r).toMatchObject({ creados: 3, actualizados: 0, rechazados: 1 });
    expect(r.rechazos).toEqual([{ fila: 5, motivo: 'x' }]);
    expect(r.stockFallido).toEqual([
      { fila: 3, motivo: 'Stock inicial no cargado: boom' },
      { fila: 4, motivo: 'No se pudo cargar el stock inicial' },
    ]);
    expect(textoResumen(r)).toBe('✓ 3 creados, 0 actualizados, 1 línea ignorada. 2 producto(s) creados SIN stock inicial: cargalo desde Stock (Ajuste).');
  });

  it('AC-PLA-5 AC-PROD-3 sin el flag, el resultado es idéntico al de antes', () => {
    const entradas = [{ accion: 'crear', fila: 2 }, { accion: 'actualizar', fila: 3, stockIgnorado: true }, { accion: 'fusionada', fila: 4 }, { accion: 'rechazar', fila: 5 }];
    expect(resumirEntradas(entradas)).toEqual({
      creados: 1, actualizados: 2, rechazados: 1, rechazos: [{ fila: 5, motivo: 'Fila inválida' }], stockIgnorado: 1,
      stockFallido: [], columnasExcluidas: [],
    });
    expect(textoResumen(resumirEntradas(entradas))).toBe('✓ 1 creado, 2 actualizados, 1 línea ignorada.');
    // stockFallido en algo que no es un alta no cuenta.
    expect(resumirEntradas([{ accion: 'actualizar', stockFallido: true }]).stockFallido).toEqual([]);
    expect(resumirEntradas(null)).toMatchObject({ creados: 0, stockFallido: [] });
    expect(textoResumen({ creados: 1, stockFallido: 'x' })).toBe('✓ 1 creado, 0 actualizados.');
  });
});

// REQ-COMR (RUN 20261014-1449): plantillas e importación sin la comisión del
// cliente (AC-COMR-2) y con el Rubro de productos normalizado (AC-COMR-4).
describe('AC-COMR-2 AC-COMR-4 plantillas con el modelo por vendedor y rubro', () => {
  it('AC-COMR-2 la plantilla de clientes no tiene Comisión: 16 columnas = CAMPOS_CLIENTE', () => {
    expect(COLUMNAS_PLANTILLA.clientes.map(c => c.label)).toEqual(CAMPOS_CLIENTE.map(c => c.label));
    expect(armarPlantilla('clientes').hojas[0].filas[0]).toHaveLength(16);
  });

  it('AC-COMR-2 un Excel viejo con "Comisión" se importa, avisa (informativo, texto nuevo) y no pisa la comision de existentes', () => {
    const rows = [
      ['Código cliente', 'Razón social', 'Domicilio de entrega', '% Comisión'],
      ['0010', 'Kiosco Pepe', 'Mitre 9', '99'],
      ['0500', 'Nuevo', 'Calle 1', '7'],
    ];
    const plan = planificarImportacion(rows, 'clientes', { existentes: CLIENTES, vendedores: VENDEDORES, now: NOW });
    expect(plan.ok).toBe(true);
    expect(plan.excluidas).toEqual(['% Comisión']);
    expect(plan.resumen).toMatchObject({ creados: 1, actualizados: 1, rechazados: 0 });
    for (const e of plan.entradas) expect(e.valor).not.toHaveProperty('comision');
    expect({ ...CLIENTES[0], ...plan.entradas[0].valor }.comision).toBe(3);
    expect(textoResumen(plan.resumen)).toContain('ahora la comisión se carga por vendedor y rubro (Configuración → Vendedores)');
  });

  it('AC-COMR-4 importación de productos: "golosinas" / "GOLOSINAS " se canonizan a la escritura existente', () => {
    const existentes = [...PRODUCTOS, { id: 9, nombre: 'Alfajor', codigo: 'AL', precio: 5, categoria: 'Golosinas', createdAt: 1 }];
    const rows = [
      ['Código', 'Descripción', 'Rubro', 'Precio venta 1'],
      ['N1', 'Chupetín', 'golosinas', '10'],
      ['N2', 'Caramelo', ' GOLOSINAS ', '10'],
      ['N3', 'Turrón', 'Golosínas', '10'],
    ];
    const plan = planificarImportacion(rows, 'productos', { existentes, proveedores: PROVEEDORES, now: NOW });
    expect(plan.entradas.map(e => e.valor.producto.categoria)).toEqual(['Golosinas', 'Golosinas', 'Golosinas']);
  });

  it('AC-COMR-4 rubros nuevos dentro del mismo archivo también se deduplican (gana la primera escritura)', () => {
    const rows = [
      ['nombre', 'precio', 'categoria'],
      ['Leche', '10', 'lácteos'],
      ['Yogur', '20', 'LACTEOS  '],
      ['Queso', '30', 'Lacteos'],
      ['Sin rubro', '40', ''],
    ];
    const plan = planificarImportacion(rows, 'productos', { existentes: [], now: NOW });
    expect(plan.modo).toBe('legacy');
    expect(plan.entradas.map(e => e.valor.producto.categoria)).toEqual(['lácteos', 'lácteos', 'lácteos', '']);
    // archivo viejo con la misma descripción repetida: se fusiona y también canoniza
    const fus = planificarImportacion([['nombre', 'precio', 'categoria'], ['Leche', '10', 'Lácteos'], ['Leche', '11', 'LACTEOS']], 'productos', { existentes: [], now: NOW });
    expect(fus.entradas[0].valor.producto).toMatchObject({ precio: 11, categoria: 'Lácteos' });
  });

  it('AC-COMR-4 validarFilaProducto sin lista de rubros solo normaliza (y respeta csvSafe)', () => {
    expect(validarFilaProducto({ codigo: 'X', nombre: 'A', categoria: '  Bebidas   frías ', precio: '1' }).valor.producto.categoria).toBe('Bebidas frías');
    expect(validarFilaProducto({ codigo: 'X', nombre: 'A', categoria: 'bebidas', precio: '1' }, { rubros: ['Bebidas'] }).valor.producto.categoria).toBe('Bebidas');
  });
});
