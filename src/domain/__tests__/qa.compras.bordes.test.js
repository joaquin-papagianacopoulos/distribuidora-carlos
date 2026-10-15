// QA REQ-INA / REQ-CPR / REQ-STB: casos borde sobre lo que dejo el implementador.
import { validarCostosIngreso, subtotalesIngreso, comprasDeIngresos, costoProductoDesdeIngreso, aCentavos } from '../compras';
import { estadoDeCuenta, saldoProveedor, validarMovimientoCuenta, anularMovimiento } from '../cuentaProveedores';
import { marcarRecibido, agregarItems, marcarEnviado, nuevoPedidoProveedor, unidadesItem } from '../pedidosProveedor';
import { estadoStock, buscarProductos, filtrarStock, contarStockBajo, stockBajoDeProveedor, umbralStock } from '../stockBajo';
import { ingresoToRemote } from '../stock';

const ingreso = { id: 'i1', proveedorId: 'p1', fecha: '2026-10-01', items: [
  { productoId: 1, descripcion: 'X', ingreso: 10 }, { productoId: 2, descripcion: 'Y', ingreso: 3 }, { productoId: 3, descripcion: 'Z', ingreso: 5 }] };

describe('QA INA', () => {
  it('AC-INA-2 ingreso mixto A/B: subtotales y total exactos en centavos, renglon sin costo cuenta unidades pero no importe', () => {
    const { ok, costos } = validarCostosIngreso({ tipoCabecera: 'A', items: [
      { productoId: 1, costoUnitario: '10,10' }, { productoId: 2, costoUnitario: '0,10', tipoFactura: 'B' }, { productoId: 3, tipoFactura: 'B' }] }, { ingreso });
    expect(ok).toBe(true);
    const s = subtotalesIngreso(ingreso, costos);
    expect(s.A).toEqual({ unidades: 10, costoCentavos: 10100 });
    expect(s.B).toEqual({ unidades: 8, costoCentavos: 30 });
    expect(s.total).toEqual({ unidades: 18, costoCentavos: 10130 });
    expect(s.renglonesSinCosto).toBe(1);
  });
  it('AC-INA-5 ingreso viejo sin costos: todo sinDato y no genera compra', () => {
    const s = subtotalesIngreso(ingreso, null);
    expect(s.sinDato.unidades).toBe(18);
    expect(s.total.costoCentavos).toBe(0);
    expect(comprasDeIngresos([])).toEqual([]);
  });
  it('AC-INA-1 costo 0 valido, negativo y texto invalido rechazados, tipo sin cabecera pide cabecera', () => {
    expect(validarCostosIngreso({ tipoCabecera: 'B', items: [{ productoId: 1, costoUnitario: 0 }] }, { ingreso }).ok).toBe(true);
    expect(validarCostosIngreso({ tipoCabecera: 'B', items: [{ productoId: 1, costoUnitario: -1 }] }, { ingreso }).ok).toBe(false);
    expect(validarCostosIngreso({ tipoCabecera: 'B', items: [{ productoId: 1, costoUnitario: 'abc' }] }, { ingreso }).ok).toBe(false);
    expect(validarCostosIngreso({ items: [{ productoId: 1, costoUnitario: 5 }] }, { ingreso }).errores.tipoCabecera).toBeTruthy();
    expect(validarCostosIngreso({ items: [] }, { ingreso })).toMatchObject({ ok: true, costos: null });
  });
  it('AC-INA-4 costo final solo cambia si difiere; vacio/igual => null; precio manual se respeta', () => {
    const p = { costoFinal: 100, ganancia: 20, precio: 120 };
    expect(costoProductoDesdeIngreso(p, 100)).toBeNull();
    expect(costoProductoDesdeIngreso(p, '')).toBeNull();
    expect(costoProductoDesdeIngreso(null, 50)).toMatchObject({ costoFinal: 50 });
    expect(costoProductoDesdeIngreso(p, 200).precio).toBe(240);
    expect(costoProductoDesdeIngreso({ ...p, precio: 999 }, 200).precio).toBe(999);
  });
  it('AC-INA-1 aCentavos 0.1+0.2 y 1.005 no pierden centavo', () => {
    expect(aCentavos(0.1 + 0.2)).toBe(30);
    expect(aCentavos('1.005')).toBe(101);
  });
  it('AC-INA-1 D2 ingresoToRemote no filtra costo ni tipo aunque el renglon los traiga', () => {
    const r = ingresoToRemote({ id: 'a', items: [{ productoId: 1, ingreso: 2, costoUnitario: 9, tipoFactura: 'A', costo: 1, tipo: 'B', precio: 5 }] });
    expect(Object.keys(r.items[0])).toEqual(['productoId', 'ingreso']);
    expect(JSON.stringify(r)).not.toMatch(/costo|tipo/i);
    expect(ingresoToRemote({ id: 'a' }).items).toEqual([]);
  });
});

describe('QA CPR', () => {
  const compras = [{ id: 'c1', proveedorId: 'p1', fecha: '2026-10-01', montoCentavos: 10010 }];
  const mov = (o) => ({ proveedorId: 'p1', tipo: 'pago', fecha: '2026-10-02', montoCentavos: 1, medio: 'efectivo', creadoAt: 1, anulado: null, ...o });
  it('AC-CPR-1 saldo = compras - pagos, anulados excluidos, centavos exactos, saldo a favor negativo', () => {
    const movs = [mov({ id: 'a', montoCentavos: 3333 }), mov({ id: 'b', montoCentavos: 9999, anulado: { motivo: 'x' } }), mov({ id: 'c', tipo: 'cargo', montoCentavos: 1, medio: null })];
    expect(saldoProveedor(compras, movs, 'p1')).toBe(10010 - 3333 + 1);
    expect(saldoProveedor(compras, [mov({ id: 'd', montoCentavos: 20000 })], 'p1')).toBe(-9990);
    expect(saldoProveedor(compras, movs, 'otro')).toBe(0);
  });
  it('AC-CPR-3 totales por medio sin anulados, filtro de medio no altera saldo, rango da saldo inicial', () => {
    const movs = [mov({ id: 'a', montoCentavos: 1000, medio: 'directa' }), mov({ id: 'b', montoCentavos: 500, medio: 'transferencia', fecha: '2026-10-05' }),
      mov({ id: 'c', montoCentavos: 700, medio: 'directa', anulado: { motivo: 'm' } })];
    const e = estadoDeCuenta(compras, movs, { proveedorId: 'p1', medio: 'directa' });
    expect(e.totalesPorMedio).toMatchObject({ directa: 1000, transferencia: 0, total: 1000 });
    expect(e.saldoFinal).toBe(10010 - 1000 - 500);
    const r = estadoDeCuenta(compras, movs, { proveedorId: 'p1', desde: '2026-10-03' });
    expect(r.saldoInicial).toBe(10010 - 1000);
    expect(r.filas.map(f => f.id)).toEqual(['b']);
  });
  it('AC-CPR-2 transferencia directa con cliente y pedido opcionales; en efectivo se descartan', () => {
    const prov = [{ id: 'p1' }];
    const base = { proveedorId: 'p1', monto: '100,50', medio: 'directa' };
    expect(validarMovimientoCuenta(base, { tipo: 'pago', proveedores: prov }).ok).toBe(true);
    const c = validarMovimientoCuenta({ ...base, clienteId: 'k1', pedidoId: 'ped1' }, { tipo: 'pago', proveedores: prov });
    expect(c.mov).toMatchObject({ clienteId: 'k1', pedidoId: 'ped1', montoCentavos: 10050 });
    const e = validarMovimientoCuenta({ ...base, medio: 'efectivo', clienteId: 'k1' }, { tipo: 'pago', proveedores: prov });
    expect(e.mov.clienteId).toBeNull();
    expect(validarMovimientoCuenta({ ...base, monto: 0 }, { tipo: 'pago', proveedores: prov }).ok).toBe(false);
    expect(validarMovimientoCuenta({ ...base, medio: '' }, { tipo: 'pago', proveedores: prov }).errores.medio).toBeTruthy();
  });
  it('AC-CPR-5 anular: motivo en blanco => error, doble anulacion => error, no muta el original', () => {
    const m = mov({ id: 'a' });
    expect(anularMovimiento(m, { motivo: '   ' }).ok).toBe(false);
    const r = anularMovimiento(m, { motivo: 'error', usuario: 'ana' });
    expect(r.mov.anulado).toMatchObject({ motivo: 'error', usuario: 'ana' });
    expect(m.anulado).toBeNull();
    expect(anularMovimiento(r.mov, { motivo: 'otra' }).ok).toBe(false);
  });
  it('AC-CPR-4 recibido: bultos a unidades, idempotente, no vuelve a enviado ni admite agregar', () => {
    let p = nuevoPedidoProveedor('p1', { genId: () => 'ped' });
    p = agregarItems(p, [{ productoId: 1, cantidad: 2, unidad: 'bulto', bultoX: 12 }, { productoId: 2, cantidad: 5 }, { productoId: 3, cantidad: 0 }, { productoId: 4, cantidad: 1.5 }]);
    expect(p.items).toHaveLength(2);
    expect(unidadesItem({ cantidad: 2, unidad: 'bulto', bultoX: 1 })).toBe(2);
    const r = marcarRecibido(p);
    expect(r.formIngreso.items).toEqual([{ productoId: '1', ingreso: 24 }, { productoId: '2', ingreso: 5 }]);
    expect(r.pedido.estado).toBe('recibido');
    expect(marcarEnviado(r.pedido).estado).toBe('recibido');
    expect(agregarItems(r.pedido, [{ productoId: 9, cantidad: 1 }])).toBe(r.pedido);
    const r2 = marcarRecibido(r.pedido);
    expect(r2.ok).toBe(true);
    expect(r2.pedido).toBe(r.pedido);
    expect(r2.formIngreso).toEqual(r.formIngreso);
    expect(marcarRecibido(nuevoPedidoProveedor('p1')).ok).toBe(false);
  });
});

describe('QA STB', () => {
  const P = (o) => ({ id: 1, nombre: 'Aceite Cañuelas', codigo: 'AC1', marca: 'Cañuelas', minimoVenta: 5, ...o });
  it('AC-STB-1 stockMinimo vacio/null/negativo usa minimoVenta; 0 explicito gana', () => {
    expect(umbralStock(P({ stockMinimo: '' }))).toBe(5);
    expect(umbralStock(P({ stockMinimo: null }))).toBe(5);
    expect(umbralStock(P({ stockMinimo: -3 }))).toBe(5);
    expect(umbralStock(P({ stockMinimo: 0 }))).toBe(0);
    expect(umbralStock(P({ stockMinimo: 8 }))).toBe(8);
    expect(umbralStock(null)).toBe(0);
  });
  it('AC-STB-2 estados: negativo, sin stock, bajo (<= umbral), ok', () => {
    const p = P({});
    expect([-1, 0, 1, 5, 6].map(s => estadoStock(p, s))).toEqual(['negativo', 'sin_stock', 'bajo', 'bajo', 'ok']);
    expect(estadoStock(P({ minimoVenta: 0 }), 1)).toBe('ok');
    expect(estadoStock(p, undefined)).toBe('sin_stock');
  });
  it('AC-STB-2 busqueda sin tildes, mayusculas, orden libre, espacios; sin resultados', () => {
    const lista = [P({}), P({ id: 2, nombre: 'Yerba Mate', codigo: 'YM', marca: 'Taragüi' })];
    expect(buscarProductos(lista, '  CANUELAS   aceite ').map(p => p.id)).toEqual([1]);
    expect(buscarProductos(lista, 'taragui').map(p => p.id)).toEqual([2]);
    expect(buscarProductos(lista, 'ym').map(p => p.id)).toEqual([2]);
    expect(buscarProductos(lista, 'zzz')).toEqual([]);
    expect(buscarProductos(lista, '   ')).toHaveLength(2);
    expect(buscarProductos(lista, null)).toHaveLength(2);
  });
  it('AC-STB-3 contador incluye negativos y sin stock; sugerido a bulto; filtro por proveedor', () => {
    const lista = [P({ id: 1, proveedorId: 'p1', bultoX: 12 }), P({ id: 2, proveedorId: 'p2' }), P({ id: 3, proveedorId: 'p1' })];
    const m = new Map([['1', 2], ['2', -4], ['3', 50]]);
    expect(contarStockBajo(lista, m)).toBe(2);
    expect(stockBajoDeProveedor(lista, m, 'p1')).toEqual([{ productoId: '1', sugerido: 12 }]);
    expect(filtrarStock(lista, m, { estado: 'negativo' }).map(f => f.producto.id)).toEqual([2]);
  });
  it('AC-STB-3 id numerico del producto resuelve stock con Map de claves string (contrato de calcularStock)', () => {
    expect(filtrarStock([P({})], new Map([['1', 50]]), {})[0].stock).toBe(50);
    expect(filtrarStock([P({})], new Map(), {})[0].estado).toBe('sin_stock');
  });
});
