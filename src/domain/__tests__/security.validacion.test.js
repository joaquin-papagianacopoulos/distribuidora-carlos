// AC-SEC-2 (validacion en dominio contra entradas maliciosas) y
// AC-SEC-3 (proteccion contra formula injection en CSV/XLSX).
import { readFileSync } from 'fs';
import path from 'path';
import { texto, toNum, toInt, csvSafe } from '../validacion';
import { validarProducto } from '../productos';
import { validarFilaProducto } from '../plantillas';
import { validarCliente } from '../clientes';
import { validarProveedor } from '../proveedores';
import {
  calcularStock, movimientoAjuste, validarIngreso, movimientosParaPedido, efectoDeseado,
} from '../stock';

const ENORME = 'A'.repeat(100_000);
const NUMERO_GIGANTE = `1${'0'.repeat(400)}`; // Number() => Infinity
const MALOS_NUMEROS = ['NaN', 'Infinity', '-Infinity', NaN, Infinity, -Infinity, '1e309', NUMERO_GIGANTE, 'abc', '0x10', '1;DROP TABLE', {}, []];

describe('AC-SEC-2 helpers de normalizacion', () => {
  test('AC-SEC-2 toNum/toInt rechazan NaN, Infinity, notacion cientifica y basura', () => {
    for (const v of MALOS_NUMEROS) {
      expect(toNum(v)).toBeNull();
      expect(toInt(v)).toBeNull();
    }
    expect(toInt('1.5')).toBeNull();
    expect(toNum('1.234,50')).toBe(1234.5);
  });

  test('AC-SEC-2 texto() elimina caracteres de control y acota el largo', () => {
    const t = texto(`a\u0000b\u001Fc\u007F\r\n\t${ENORME}`, 50);
    expect(t.length).toBeLessThanOrEqual(50);
    // eslint-disable-next-line no-control-regex
    expect(t).not.toMatch(/[\u0000-\u001F\u007F]/);
    expect(texto(ENORME).length).toBeLessThanOrEqual(200);
    expect(texto(null)).toBe('');
    expect(texto(undefined)).toBe('');
  });
});

describe('AC-SEC-2 validarProducto', () => {
  test.each(MALOS_NUMEROS.map(v => [v]))('AC-SEC-2 costoFinal invalido (%p) se rechaza y no queda NaN/Infinity', (v) => {
    const r = validarProducto({ codigo: 'P1', nombre: 'Prod', costoFinal: v });
    expect(r.ok).toBe(false);
    expect(r.errores.costoFinal).toBeTruthy();
    expect(Number.isFinite(r.producto.costoFinal)).toBe(true);
    expect(Number.isFinite(r.producto.precio)).toBe(true);
  });

  test('AC-SEC-2 precios/porcentajes negativos o fuera de rango se rechazan', () => {
    const r = validarProducto({
      codigo: 'P1', nombre: 'Prod', costoFinal: '-10', descuento1: '101', descuento2: '-1',
      ganancia: '100000', precio: '-5', precioVenta2: 'Infinity', bultoX: '0', minimoVenta: '2.5', stock: '-3',
    });
    expect(r.ok).toBe(false);
    for (const k of ['costoFinal', 'descuento1', 'descuento2', 'ganancia', 'precio', 'precioVenta2', 'bultoX', 'minimoVenta', 'stock']) {
      expect(r.errores[k]).toBeTruthy();
    }
    for (const k of ['costoFinal', 'descuento1', 'descuento2', 'ganancia', 'precio', 'precioVenta2', 'bultoX', 'minimoVenta']) {
      expect(Number.isFinite(r.producto[k])).toBe(true);
      expect(r.producto[k]).toBeGreaterThanOrEqual(0);
    }
    expect(r.stock).toBeNull();
  });

  test('AC-SEC-2 stock NaN/Infinity/decimal no se acepta', () => {
    for (const s of ['NaN', 'Infinity', NaN, Infinity, '1.5', 'abc']) {
      const r = validarProducto({ codigo: 'P1', nombre: 'Prod', stock: s });
      expect(r.errores.stock).toBeTruthy();
      expect(r.stock).toBeNull();
    }
  });

  test('AC-SEC-2 textos enormes se truncan', () => {
    const r = validarProducto({ codigo: ENORME, nombre: ENORME, categoria: ENORME });
    expect(r.producto.codigo.length).toBeLessThanOrEqual(40);
    expect(r.producto.nombre.length).toBeLessThanOrEqual(160);
    expect(r.producto.categoria.length).toBeLessThanOrEqual(60);
  });

  test('AC-SEC-2 proveedor inexistente se rechaza', () => {
    const r = validarProducto({ codigo: 'P1', nombre: 'Prod', proveedorId: 'no-existe' }, { proveedores: [{ id: 'x' }] });
    expect(r.errores.proveedorId).toBeTruthy();
  });
});

describe('AC-SEC-2 validarCliente / validarProveedor', () => {
  test('AC-SEC-2 cliente con campos enormes y de control queda acotado', () => {
    const r = validarCliente({
      codigo: ENORME, nombre: `<script>alert(1)</script>${ENORME}`, direccion: `\u0000${ENORME}`,
      telefono: `+54 9 ${ENORME}`, comision: 'Infinity', cuit: '20-12345678-0', fechaAlta: '2026-02-30',
      provincia: 'Narnia', tipoIva: 'Inventado',
    });
    expect(r.ok).toBe(false);
    expect(r.cliente.codigo.length).toBeLessThanOrEqual(30);
    expect(r.cliente.nombre.length).toBeLessThanOrEqual(120);
    expect(r.cliente.direccion.length).toBeLessThanOrEqual(160);
    expect(r.cliente.telefono).toMatch(/^\d{0,15}$/);
    expect(r.cliente.comision).toBeNull();
    expect(r.errores.comision).toBeTruthy();
    expect(r.errores.cuit).toBeTruthy();
    expect(r.errores.fechaAlta).toBeTruthy();
    expect(r.errores.provincia).toBeTruthy();
    expect(r.errores.tipoIva).toBeTruthy();
  });

  test('AC-SEC-2 comision negativa o mayor a 100 se rechaza', () => {
    for (const c of ['-1', '100.01', NaN, 'NaN']) {
      const r = validarCliente({ codigo: 'C1', nombre: 'X', direccion: 'Y', comision: c });
      expect(r.errores.comision).toBeTruthy();
    }
  });

  test('AC-SEC-2 proveedor: textos acotados y obligatorios', () => {
    const r = validarProveedor({ codigo: ENORME, descripcion: ENORME });
    expect(r.proveedor.codigo.length).toBeLessThanOrEqual(30);
    expect(r.proveedor.descripcion.length).toBeLessThanOrEqual(120);
    expect(validarProveedor({ codigo: '   ', descripcion: '\u0000' }).ok).toBe(false);
  });
});

describe('AC-SEC-2 integridad del ledger de stock ante entradas maliciosas', () => {
  test('AC-SEC-2 calcularStock ignora cantidades NaN/Infinity/no numericas', () => {
    const m = calcularStock([
      { productoId: 'a', cantidad: 5 },
      { productoId: 'a', cantidad: Infinity },
      { productoId: 'a', cantidad: NaN },
      { productoId: 'a', cantidad: 'abc' },
      { productoId: null, cantidad: 100 },
      null,
    ]);
    expect(m.get('a')).toBe(5);
    expect(m.size).toBe(1);
  });

  test('AC-SEC-2 movimientoAjuste rechaza stock negativo, decimal, NaN e Infinity', () => {
    for (const v of ['-1', -1, '1.5', 'NaN', NaN, Infinity, 'Infinity', NUMERO_GIGANTE, '']) {
      expect(() => movimientoAjuste('p1', 0, v, { genId: () => 'id' })).toThrow();
    }
  });

  test('AC-SEC-2 validarIngreso rechaza cantidades 0, negativas, decimales, enormes o no numericas', () => {
    const ctx = {
      productos: [{ id: 'p1', nombre: 'Prod 1' }],
      proveedores: [{ id: 'pv', descripcion: 'Prov' }],
      genId: () => 'id',
    };
    for (const ingreso of [0, -5, '1.5', 1_000_001, 'NaN', Infinity, 'abc', NUMERO_GIGANTE]) {
      const r = validarIngreso({ facturaProveedor: 'F1', proveedorId: 'pv', items: [{ productoId: 'p1', ingreso }] }, ctx);
      expect(r.ok).toBe(false);
      expect(r.movimientos).toBeUndefined();
    }
  });

  test('AC-SEC-2 validarIngreso rechaza productos repetidos, inexistentes y facturas duplicadas', () => {
    const ctx = {
      productos: [{ id: 'p1', nombre: 'Prod 1' }],
      proveedores: [{ id: 'pv', descripcion: 'Prov' }],
      ingresosExistentes: [{ proveedorId: 'pv', facturaProveedor: 'A-0001' }],
      genId: () => 'id',
    };
    expect(validarIngreso({ facturaProveedor: 'F1', proveedorId: 'pv', items: [{ productoId: 'p1', ingreso: 1 }, { productoId: 'p1', ingreso: 1 }] }, ctx).ok).toBe(false);
    expect(validarIngreso({ facturaProveedor: 'F1', proveedorId: 'pv', items: [{ productoId: 'zzz', ingreso: 1 }] }, ctx).ok).toBe(false);
    expect(validarIngreso({ facturaProveedor: ' a-0001 ', proveedorId: 'pv', items: [{ productoId: 'p1', ingreso: 1 }] }, ctx).ok).toBe(false);
    expect(validarIngreso({ facturaProveedor: 'F1', proveedorId: 'otro', items: [{ productoId: 'p1', ingreso: 1 }] }, ctx).ok).toBe(false);
  });

  test('AC-SEC-2 un pedido con cantidades negativas/NaN no puede SUMAR stock', () => {
    const pedido = {
      id: 7, estado: 'facturado',
      items: [
        { productoId: 'p1', cantidad: -100 },
        { productoId: 'p2', cantidad: NaN },
        { productoId: 'p3', cantidad: Infinity },
        { productoId: 'p4', cantidad: 'abc' },
      ],
    };
    expect(efectoDeseado(pedido).size).toBe(0);
    expect(movimientosParaPedido(pedido, [], { genId: () => 'id' })).toEqual([]);
  });

  test('AC-SEC-2 movimientosParaPedido es idempotente (reintentos no duplican descuentos)', () => {
    let n = 0;
    const genId = () => `m${++n}`;
    const pedido = { id: 1, remoteId: 'r1', estado: 'facturado', items: [{ productoId: 'p1', cantidad: 3 }] };
    const primera = movimientosParaPedido(pedido, [], { genId });
    expect(primera).toHaveLength(1);
    expect(primera[0].cantidad).toBe(-3);
    expect(movimientosParaPedido(pedido, primera, { genId })).toEqual([]);
    expect(movimientosParaPedido(pedido, primera, { genId })).toEqual([]);
  });
});

describe('AC-SEC-3 csvSafe (formula injection)', () => {
  test.each([
    ['=1+1', "'=1+1"],
    ['=HYPERLINK("http://evil.example","clic")', '\'=HYPERLINK("http://evil.example","clic")'],
    ['+cmd|\' /C calc\'!A0', "'+cmd|' /C calc'!A0"],
    ['-2+3', "'-2+3"],
    ['@SUM(A1:A2)', "'@SUM(A1:A2)"],
    ['\t=1+1', "'\t=1+1"],
    ['\r=1+1', "'\r=1+1"],
  ])('AC-SEC-3 neutraliza %p', (entrada, esperado) => {
    expect(csvSafe(entrada)).toBe(esperado);
  });

  test('AC-SEC-3 respeta numeros y texto normal', () => {
    expect(csvSafe(42)).toBe(42);
    expect(csvSafe(-3.5)).toBe(-3.5);
    expect(csvSafe('-5')).toBe('-5');
    expect(csvSafe('1234,50')).toBe('1234,50');
    expect(csvSafe('Coca Cola 500ml')).toBe('Coca Cola 500ml');
    expect(csvSafe('a=b')).toBe('a=b');
    expect(csvSafe(null)).toBe('');
    expect(csvSafe(undefined)).toBe('');
  });

  test('AC-SEC-3 texto() + csvSafe() combinados no dejan formulas aunque vengan con control chars', () => {
    expect(csvSafe(texto('\t\u0000=cmd()'))).toBe("'=cmd()");
    expect(csvSafe(texto('   +1+1'))).toBe("'+1+1");
  });

  // REQ-PLA: la importacion se movio de Configuracion.js (importarRows) a
  // src/domain/plantillas.js. Se verifica lo mismo en su nuevo lugar, en el
  // codigo y en el comportamiento.
  const srcPlantillas = () => readFileSync(path.join(__dirname, '..', 'plantillas.js'), 'utf8');
  const srcConfiguracion = () => readFileSync(path.join(__dirname, '..', '..', 'pages', 'Configuracion.js'), 'utf8');

  test('AC-SEC-3 la importacion de Configuracion aplica csvSafe a nombre y categoria', () => {
    expect(srcConfiguracion()).toMatch(/planificarImportacion\(rows, 'productos'/);
    const src = srcPlantillas();
    expect(src).toMatch(/const textoSeguro = \(v, max\) => csvSafe\(texto\(v, max\)\)/);
    expect(src).toMatch(/form\.nombre = textoSeguro\(/);
    expect(src).toMatch(/form\.categoria = textoSeguro\(/);
    const r = validarFilaProducto({ codigo: 'X', nombre: '=cmd()', categoria: '@SUM(A1)', precio: '1' });
    expect(r.valor.producto.nombre).toBe("'=cmd()");
    expect(r.valor.producto.categoria).toBe("'@SUM(A1)");
  });

  test('AC-SEC-3 S-13 la importacion limpia codigo/unidad y no usa parseFloat para el precio', () => {
    const src = srcPlantillas();
    expect(src).toMatch(/form\.codigo = textoSeguro\(/);
    expect(src).toMatch(/csvSafe\(unidadCelda\)/);
    expect(src).not.toMatch(/parseFloat\(/);
    expect(srcConfiguracion()).not.toMatch(/parseFloat\(precioRaw\)/);
    const r = validarFilaProducto({ nombre: 'A', precio: '1.234,50', codigo: '+x', unidad: '-u' }, { modo: 'legacy' });
    expect(r.valor.producto).toMatchObject({ precio: 1234.5, codigo: "'+x", unidad: "'-u" });
  });

  test('AC-SEC-3 S-21 la importacion descarta precios mayores a MAX_IMPORTE', () => {
    // validarProducto (misma regla del formulario) rechaza precio > MAX_IMPORTE.
    expect(srcPlantillas()).toMatch(/validarProducto\(form,/);
    expect(validarFilaProducto({ nombre: 'Caro', precio: '9999999999999' }, { modo: 'legacy' }).ok).toBe(false);
    expect(validarFilaProducto({ nombre: 'Justo', precio: '999999999999' }, { modo: 'legacy' }).ok).toBe(true);
  });

  test('AC-SEC-2 S-20 pedidoRepository firma movimientos desde la sesion, no desde localStorage', () => {
    const src = readFileSync(path.join(__dirname, '..', '..', 'services', 'pedidoRepository.js'), 'utf8');
    expect(src).toMatch(/getNombreUsuarioSesion\(\)/);
    expect(src).not.toMatch(/localStorage\.getItem\(['"]vendedorActual['"]\)/);
  });
});
