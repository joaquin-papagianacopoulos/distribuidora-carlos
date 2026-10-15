import {
  normalizarTipoAB, validarCostosIngreso, subtotalesIngreso, filtrarHistorial, totalesHistorial,
  ingresosPorProducto, costoProductoDesdeIngreso, comprasDeIngresos, costosToRemote, costosFromRemote,
} from '../compras';

const ingreso = (o = {}) => ({
  id: 'i1', proveedorId: 'p1', proveedorNombre: 'Prov Uno', facturaProveedor: 'F-1', fecha: '2026-10-10T15:00:00.000Z', usuario: 'ana',
  items: [
    { productoId: '1', descripcion: 'Uno', ingreso: 10 },
    { productoId: '2', descripcion: 'Dos', ingreso: 5 },
  ], ...o,
});

describe('AC-INA-1 validarCostosIngreso', () => {
  it('AC-INA-1 normaliza tipo A/B', () => {
    expect(normalizarTipoAB('a')).toBe('A');
    expect(normalizarTipoAB(' Factura b ')).toBe('B');
    expect(normalizarTipoAB('C')).toBeNull();
    expect(normalizarTipoAB(null)).toBeNull();
  });
  it('AC-INA-1 sin ningún dato cargado => costos null (ingreso sin dato)', () => {
    const r = validarCostosIngreso({ items: [{ productoId: '1', costoUnitario: '' }] }, { ingreso: ingreso() });
    expect(r).toEqual({ ok: true, errores: {}, costos: null });
    expect(validarCostosIngreso(undefined, { ingreso: ingreso() }).costos).toBeNull();
  });
  it('AC-INA-1 costo vacío = null, 0 válido, decimales a 2, tipo de renglón default = cabecera', () => {
    const r = validarCostosIngreso({ tipoCabecera: 'A', facturaA: ' 0001-123 ', items: [
      { productoId: '1', costoUnitario: '' }, { productoId: '2', costoUnitario: '10,555' }] }, { ingreso: ingreso() });
    expect(r.ok).toBe(true);
    expect(r.costos.renglones).toEqual([
      { productoId: '1', costoUnitario: null, tipoFactura: 'A', unidades: 10 },
      { productoId: '2', costoUnitario: 10.56, tipoFactura: 'A', unidades: 5 },
    ]);
    expect(r.costos.facturaA).toBe('0001-123');
    expect(r.costos.pendingSync).toBe(true);
    const cero = validarCostosIngreso({ tipoCabecera: 'B', items: [{ productoId: '1', costoUnitario: '0' }] }, { ingreso: ingreso() });
    expect(cero.costos.renglones[0].costoUnitario).toBe(0);
  });
  it('AC-INA-1 un ingreso puede tener renglones A y B', () => {
    const r = validarCostosIngreso({ tipoCabecera: 'A', items: [
      { productoId: '1', costoUnitario: '5' }, { productoId: '2', costoUnitario: '7', tipoFactura: 'B' }] }, { ingreso: ingreso() });
    expect(r.costos.renglones.map(x => x.tipoFactura)).toEqual(['A', 'B']);
  });
  it('AC-INA-1 costo negativo, texto o gigante => error por item:<productoId>', () => {
    for (const mal of ['-1', 'abc', '1000000000']) {
      const r = validarCostosIngreso({ tipoCabecera: 'A', items: [{ productoId: '2', costoUnitario: mal }] }, { ingreso: ingreso() });
      expect(r.ok).toBe(false);
      expect(r.errores['item:2']).toBeTruthy();
      expect(r.errores['item:1']).toBeUndefined();
    }
  });
  it('AC-INA-1 con costo cargado la cabecera A/B es obligatoria; tipo inválido se rechaza', () => {
    expect(validarCostosIngreso({ items: [{ productoId: '1', costoUnitario: '5' }] }, { ingreso: ingreso() }).errores.tipoCabecera).toBeTruthy();
    expect(validarCostosIngreso({ tipoCabecera: 'X', items: [] }, { ingreso: ingreso() }).ok).toBe(false);
    const r = validarCostosIngreso({ tipoCabecera: 'A', items: [{ productoId: '1', tipoFactura: 'Z' }] }, { ingreso: ingreso() });
    expect(r.errores['item:1']).toBeTruthy();
  });
  it('AC-INA-1 solo A/B de cabecera (sin costos) igual se guarda: el tipo es dato', () => {
    const r = validarCostosIngreso({ tipoCabecera: 'B', facturaB: 'B-9' }, { ingreso: ingreso() });
    expect(r.costos.renglones.every(x => x.tipoFactura === 'B' && x.costoUnitario === null)).toBe(true);
  });
  it('AC-INA-1 factura A/B se recorta a 40 caracteres', () => {
    const r = validarCostosIngreso({ tipoCabecera: 'A', facturaA: 'x'.repeat(80), items: [] }, { ingreso: ingreso() });
    expect(r.costos.facturaA).toHaveLength(40);
  });
  it('AC-INA-1 no toca el ingreso (los movimientos no cambian)', () => {
    const ing = ingreso();
    const copia = JSON.stringify(ing);
    validarCostosIngreso({ tipoCabecera: 'A', items: [{ productoId: '1', costoUnitario: '5' }] }, { ingreso: ing });
    expect(JSON.stringify(ing)).toBe(copia);
  });
});

describe('AC-INA-2 / AC-INA-5 subtotalesIngreso', () => {
  const costos = {
    tipoCabecera: 'A',
    renglones: [
      { productoId: '1', costoUnitario: 10.1, tipoFactura: 'A', unidades: 10 },
      { productoId: '2', costoUnitario: 3.3, tipoFactura: 'B', unidades: 5 },
    ],
  };
  it('AC-INA-2 subtotales por A, B y total en centavos', () => {
    const s = subtotalesIngreso(ingreso(), costos);
    expect(s.A).toEqual({ unidades: 10, costoCentavos: 10100 });
    expect(s.B).toEqual({ unidades: 5, costoCentavos: 1650 });
    expect(s.total).toEqual({ unidades: 15, costoCentavos: 11750 });
    expect(s.sinDato.unidades).toBe(0);
  });
  it('AC-INA-2 renglón sin costo cuenta unidades pero no importe', () => {
    const s = subtotalesIngreso(ingreso(), { ...costos, renglones: [{ productoId: '1', costoUnitario: null, tipoFactura: 'A' }, costos.renglones[1]] });
    expect(s.A).toEqual({ unidades: 10, costoCentavos: 0 });
    expect(s.renglonesSinCosto).toBe(1);
    expect(s.total.costoCentavos).toBe(1650);
  });
  it('AC-INA-5 ingreso viejo sin costos => todo "sin dato"', () => {
    const s = subtotalesIngreso(ingreso(), null);
    expect(s.sinDato.unidades).toBe(15);
    expect(s.total).toEqual({ unidades: 15, costoCentavos: 0 });
    expect(s.A.unidades + s.B.unidades).toBe(0);
  });
  it('AC-INA-5 producto del ingreso que no está en costos => sin dato', () => {
    const s = subtotalesIngreso(ingreso(), { tipoCabecera: 'A', renglones: [costos.renglones[0]] });
    expect(s.sinDato.unidades).toBe(5);
  });
  it('AC-INA-2 sin errores de redondeo en flotantes (0,1 + 0,2)', () => {
    const ing = ingreso({ items: [{ productoId: '1', ingreso: 3 }, { productoId: '2', ingreso: 3 }] });
    const s = subtotalesIngreso(ing, { tipoCabecera: 'A', renglones: [
      { productoId: '1', costoUnitario: 0.1, tipoFactura: 'A' }, { productoId: '2', costoUnitario: 0.2, tipoFactura: 'A' }] });
    expect(s.A.costoCentavos).toBe(90);
  });
});

describe('AC-INA-3 historial', () => {
  const ings = [
    ingreso({ id: 'i1', fecha: '2026-10-10T15:00:00.000Z' }),
    ingreso({ id: 'i2', proveedorId: 'p2', proveedorNombre: 'Prov Dos', fecha: '2026-10-12T15:00:00.000Z', items: [{ productoId: '1', ingreso: 4 }] }),
    ingreso({ id: 'i3', fecha: '2026-10-14T15:00:00.000Z', items: [{ productoId: '1', ingreso: 2 }] }),
  ];
  const costos = new Map([
    ['i1', { id: 'i1', tipoCabecera: 'A', facturaA: 'A-1', renglones: [
      { productoId: '1', costoUnitario: 10, tipoFactura: 'A', unidades: 10 }, { productoId: '2', costoUnitario: 2, tipoFactura: 'B', unidades: 5 }] }],
    ['i2', { id: 'i2', tipoCabecera: 'B', renglones: [{ productoId: '1', costoUnitario: 5, tipoFactura: 'B', unidades: 4 }] }],
  ]);
  it('AC-INA-3 filtra por proveedor, fechas y orden descendente', () => {
    expect(filtrarHistorial(ings, costos).map(f => f.id)).toEqual(['i3', 'i2', 'i1']);
    expect(filtrarHistorial(ings, costos, { proveedorId: 'p1' }).map(f => f.id)).toEqual(['i3', 'i1']);
    expect(filtrarHistorial(ings, costos, { desde: '2026-10-11', hasta: '2026-10-13' }).map(f => f.id)).toEqual(['i2']);
    expect(filtrarHistorial(ings, costos, { desde: '2026-10-10', hasta: '2026-10-10' }).map(f => f.id)).toEqual(['i1']);
  });
  it('AC-INA-3 filtra por A / B / sin dato mostrando solo ese tipo', () => {
    const a = filtrarHistorial(ings, costos, { tipo: 'A' });
    expect(a.map(f => f.id)).toEqual(['i1']);
    expect(a[0].subtotales.B.unidades).toBe(0);
    expect(a[0].subtotales.total).toEqual({ unidades: 10, costoCentavos: 10000 });
    expect(filtrarHistorial(ings, costos, { tipo: 'B' }).map(f => f.id)).toEqual(['i2', 'i1']);
    expect(filtrarHistorial(ings, costos, { tipo: 'sinDato' }).map(f => f.id)).toEqual(['i3']);
  });
  it('AC-INA-3 totales A vs B', () => {
    const t = totalesHistorial(filtrarHistorial(ings, costos));
    expect(t.A).toEqual({ unidades: 10, costoCentavos: 10000 });
    expect(t.B).toEqual({ unidades: 9, costoCentavos: 3000 });
    expect(t.sinDato.unidades).toBe(2);
    expect(t.total).toEqual({ unidades: 21, costoCentavos: 13000 });
    expect(totalesHistorial([]).total).toEqual({ unidades: 0, costoCentavos: 0 });
  });
  it('AC-INA-3 por producto: qué entró en A y qué en B (también con objeto plano de costos)', () => {
    const r = ingresosPorProducto(ings, Object.fromEntries(costos), '1');
    expect(r.map(x => [x.ingresoId, x.tipo, x.unidades, x.costoUnitario])).toEqual([['i3', null, 2, null], ['i2', 'B', 4, 5], ['i1', 'A', 10, 10]]);
    expect(ingresosPorProducto(ings, costos, '99')).toEqual([]);
  });
});

describe('AC-INA-4 costoProductoDesdeIngreso', () => {
  const prod = { costoFinal: 100, descuento1: 0, descuento2: 0, ganancia: 50, precio: 150 };
  it('AC-INA-4 costo nuevo => costo final y precio recalculado si era automático', () => {
    expect(costoProductoDesdeIngreso(prod, '120')).toEqual({ costoFinal: 120, precio: 180, precioCambia: true });
  });
  it('AC-INA-4 vacío, inválido o igual al actual => null', () => {
    expect(costoProductoDesdeIngreso(prod, '')).toBeNull();
    expect(costoProductoDesdeIngreso(prod, null)).toBeNull();
    expect(costoProductoDesdeIngreso(prod, 'x')).toBeNull();
    expect(costoProductoDesdeIngreso(prod, '-3')).toBeNull();
    expect(costoProductoDesdeIngreso(prod, 100)).toBeNull();
  });
  it('AC-INA-4 precio puesto a mano o sin ganancia no se recalcula', () => {
    expect(costoProductoDesdeIngreso({ ...prod, precio: 199 }, 120)).toEqual({ costoFinal: 120, precio: 199, precioCambia: false });
    expect(costoProductoDesdeIngreso({ ...prod, ganancia: 0, precio: 100 }, 120).precioCambia).toBe(false);
  });
  it('AC-INA-4 / QA obs 1: costo 0 o vacío NO pisa el costo final del producto', () => {
    expect(costoProductoDesdeIngreso(prod, '0')).toBeNull();
    expect(costoProductoDesdeIngreso(prod, 0)).toBeNull();
    expect(costoProductoDesdeIngreso(prod, '0,00')).toBeNull();
    expect(costoProductoDesdeIngreso(prod, '  ')).toBeNull();
    expect(costoProductoDesdeIngreso({ ...prod, costoFinal: 0 }, 0)).toBeNull();
  });
});

describe('AC-CPR-1 comprasDeIngresos y mapeos', () => {
  it('AC-CPR-1 compra = Σ costo × unidades en centavos; sin costo no suma', () => {
    const c = [
      { id: 'i1', proveedorId: 'p1', fecha: 'f', renglones: [
        { productoId: '1', costoUnitario: 10.1, unidades: 10 }, { productoId: '2', costoUnitario: null, unidades: 5 }] },
      { id: 'i2', proveedorId: 'p1', fecha: 'f', renglones: [{ productoId: '1', costoUnitario: null, unidades: 3 }] },
      { id: 'i3', proveedorId: 'p1', fecha: 'f', renglones: [{ productoId: '1', costoUnitario: 0, unidades: 3 }] },
    ];
    expect(comprasDeIngresos(c)).toEqual([{ id: 'i1', proveedorId: 'p1', fecha: 'f', tipo: 'compra', montoCentavos: 10100, renglonesSinCosto: 1 }]);
  });
  it('AC-INA-1 round-trip remoto de costos', () => {
    const c = {
      id: 'i1', proveedorId: 'p1', fecha: '2026-10-10T15:00:00.000Z', tipoCabecera: 'A', facturaA: 'A-1', facturaB: '',
      renglones: [{ productoId: '1', costoUnitario: 10.5, tipoFactura: 'A', unidades: 3 }, { productoId: '2', costoUnitario: null, tipoFactura: 'B', unidades: 2 }],
      updatedAt: 1760000000000,
    };
    const r = costosToRemote(c);
    expect(r).toMatchObject({ ingreso_id: 'i1', tipo_cabecera: 'A', factura_a: 'A-1', factura_b: null });
    expect(r.renglones[1]).toEqual({ producto_id: '2', costo_unitario: null, tipo_factura: 'B', unidades: 2 });
    const back = costosFromRemote(r);
    expect(back).toMatchObject({ id: 'i1', proveedorId: 'p1', tipoCabecera: 'A', facturaA: 'A-1', pendingSync: false, updatedAt: 1760000000000 });
    expect(back.renglones).toEqual(c.renglones);
  });
});
