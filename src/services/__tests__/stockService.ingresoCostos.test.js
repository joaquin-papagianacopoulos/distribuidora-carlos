// REQ-INA: registrarIngreso con costos y Factura A/B (IndexedDB falsa en memoria).
const mockEstado = { proveedores: [], ingresos: [], movs: [], llamadas: [], productosActualizados: [], fallaProducto: false };

jest.mock('../../db', () => ({
  getProveedores: async () => mockEstado.proveedores,
  getIngresos: async () => mockEstado.ingresos,
  getMovimientosStock: async () => mockEstado.movs,
  addIngresoConMovimientos: async (ing, movs) => { mockEstado.llamadas.push(['simple', ing, movs]); },
  addIngresoCompleto: async (ing, costos, movs) => { mockEstado.llamadas.push(['completo', ing, costos, movs]); },
  updateProducto: async (p, o) => {
    if (mockEstado.fallaProducto) throw new Error('boom');
    mockEstado.productosActualizados.push([p, o]);
  },
}));
jest.mock('../../lib/supabase', () => ({ supabase: {} }));

const { registrarIngreso } = require('../stockService');

const productos = [
  { id: 1, codigo: 'A1', nombre: 'Uno', costoFinal: 100, descuento1: 0, descuento2: 0, ganancia: 50, precio: 150 },
  { id: 2, codigo: 'B2', nombre: 'Dos', costoFinal: 50, descuento1: 0, descuento2: 0, ganancia: 0, precio: 80 },
];
const baseForm = () => ({ facturaProveedor: 'F-100', proveedorId: 'p1', items: [{ productoId: 1, ingreso: 10 }, { productoId: 2, ingreso: 4 }] });

beforeEach(() => {
  Object.assign(mockEstado, { proveedores: [{ id: 'p1', descripcion: 'Prov' }], ingresos: [], movs: [], llamadas: [], productosActualizados: [], fallaProducto: false });
});

describe('AC-INA-5 / AC-ING-5 sin costos todo queda como antes', () => {
  it('AC-INA-5 sin form.costos usa la transacción de siempre y no toca productos', async () => {
    const r = await registrarIngreso(baseForm(), { productos, usuario: 'ana' });
    expect(r.ok).toBe(true);
    expect(mockEstado.llamadas.map(l => l[0])).toEqual(['simple']);
    expect(mockEstado.productosActualizados).toEqual([]);
    expect(r.costos).toBeNull();
  });

  it('AC-ING-5 los movimientos son idénticos con y sin costos (mismo tipo, cantidad y producto)', async () => {
    const sin = await registrarIngreso(baseForm(), { productos });
    mockEstado.ingresos = [];
    const con = await registrarIngreso({ ...baseForm(), facturaProveedor: 'F-101', costos: { tipoCabecera: 'A', items: [{ productoId: 1, costoUnitario: '120' }] } }, { productos });
    const forma = (r) => r.movimientos.map(m => [m.productoId, m.cantidad, m.tipo]);
    expect(forma(con)).toEqual(forma(sin));
    expect(forma(con)).toEqual([['1', 10, 'ingreso'], ['2', 4, 'ingreso']]);
  });

  it('AC-INA-5 el ingreso grabado no lleva costos ni tipo A/B dentro de sus items', async () => {
    await registrarIngreso({ ...baseForm(), costos: { tipoCabecera: 'B', items: [{ productoId: 1, costoUnitario: '120', tipoFactura: 'A' }] } }, { productos });
    const ing = mockEstado.llamadas[0][1];
    expect(JSON.stringify(ing)).not.toMatch(/costo|tipoFactura/i);
  });
});

describe('AC-INA-1 costos y tipo A/B se guardan aparte y en una sola transacción', () => {
  it('AC-INA-1 con costos: addIngresoCompleto con costos del ingreso', async () => {
    const r = await registrarIngreso({ ...baseForm(), costos: {
      tipoCabecera: 'A', facturaA: '0001-1', facturaB: '0002-2',
      items: [{ productoId: 1, costoUnitario: '120' }, { productoId: 2, costoUnitario: '60', tipoFactura: 'B' }] } }, { productos, usuario: 'ana' });
    expect(r.ok).toBe(true);
    expect(mockEstado.llamadas.map(l => l[0])).toEqual(['completo']);
    const costos = mockEstado.llamadas[0][2];
    expect(costos).toMatchObject({ id: r.ingreso.id, proveedorId: 'p1', tipoCabecera: 'A', facturaA: '0001-1', facturaB: '0002-2', pendingSync: true });
    expect(costos.renglones.map(x => [x.productoId, x.costoUnitario, x.tipoFactura, x.unidades])).toEqual([['1', 120, 'A', 10], ['2', 60, 'B', 4]]);
  });

  it('AC-INA-1 un costo inválido frena TODO: no se graba ingreso ni movimientos', async () => {
    const r = await registrarIngreso({ ...baseForm(), costos: { tipoCabecera: 'A', items: [{ productoId: 2, costoUnitario: '-5' }] } }, { productos });
    expect(r.ok).toBe(false);
    expect(r.errores['item:2']).toBeTruthy();
    expect(mockEstado.llamadas).toEqual([]);
    expect(mockEstado.productosActualizados).toEqual([]);
  });

  it('AC-INA-1 los errores del ingreso (factura repetida) siguen primero', async () => {
    mockEstado.ingresos = [{ id: 'x', proveedorId: 'p1', facturaProveedor: 'F-100' }];
    const r = await registrarIngreso({ ...baseForm(), costos: { tipoCabecera: 'A', items: [] } }, { productos });
    expect(r.ok).toBe(false);
    expect(r.errores.facturaProveedor).toBeTruthy();
    expect(mockEstado.llamadas).toEqual([]);
  });
});

describe('AC-INA-4 actualizar el costo del producto', () => {
  const formCon = (actualizarCosto) => ({
    ...baseForm(),
    costos: { tipoCabecera: 'A', actualizarCosto, items: [{ productoId: 1, costoUnitario: '120' }, { productoId: 2, costoUnitario: '50' }] },
  });

  it('AC-INA-4 con el tilde actualiza costoFinal y recalcula el precio (que registra cambiosPrecio vía updateProducto)', async () => {
    const r = await registrarIngreso(formCon(true), { productos, usuario: 'ana' });
    expect(r.productosActualizados).toEqual(['1']); // el 2 tiene el mismo costo: no se toca
    expect(mockEstado.productosActualizados).toHaveLength(1);
    const [prod, opts] = mockEstado.productosActualizados[0];
    expect(prod).toMatchObject({ id: 1, costoFinal: 120, precio: 180, extrasDirty: true });
    expect(opts).toEqual({ usuario: 'ana' });
  });

  it('AC-INA-4 el default (sin actualizarCosto) es que sí actualiza', async () => {
    const r = await registrarIngreso(formCon(undefined), { productos });
    expect(r.productosActualizados).toEqual(['1']);
  });

  it('AC-INA-4 sin el tilde no toca productos pero sí guarda los costos del ingreso', async () => {
    const r = await registrarIngreso(formCon(false), { productos });
    expect(mockEstado.productosActualizados).toEqual([]);
    expect(r.productosActualizados).toEqual([]);
    expect(mockEstado.llamadas.map(l => l[0])).toEqual(['completo']);
  });

  it('AC-INA-4 sin costo en el renglón no toca el producto', async () => {
    await registrarIngreso({ ...baseForm(), costos: { tipoCabecera: 'A', items: [{ productoId: 1, costoUnitario: '' }] } }, { productos });
    expect(mockEstado.productosActualizados).toEqual([]);
  });

  it('AC-INA-4 si falla la actualización del producto el ingreso igual queda grabado y se informa', async () => {
    mockEstado.fallaProducto = true;
    const r = await registrarIngreso(formCon(true), { productos });
    expect(r.ok).toBe(true);
    expect(mockEstado.llamadas.map(l => l[0])).toEqual(['completo']);
    expect(r.erroresProducto).toEqual([{ productoId: '1', error: 'boom' }]);
  });
});
