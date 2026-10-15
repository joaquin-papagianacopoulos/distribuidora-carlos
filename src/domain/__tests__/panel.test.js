// REQ-PAN (AC-PAN-1..6): panel de ganancia y rentabilidad (dominio puro).
import {
  costoNetoProductoCents, itemsSinCostos, periodoMesEnCurso, periodoAnterior, renglonesVenta, ajustesRendicion,
  resumenPeriodo, compararPeriodos, rentabilidadPor, ordenarFilas, masVendidos, enAlzaEnBaja, sinVentas,
  tendencia, avisosPanel, calcularPanel,
} from '../panel';
import { calcularPrecioVenta } from '../productos';

const prod = (id, extra = {}) => ({ id, nombre: `Prod ${id}`, codigo: `C${id}`, categoria: 'Golosinas', marca: 'Arcor', precio: 100, costoFinal: 60, descuento1: 0, descuento2: 0, ...extra });
const productos = [prod(1), prod(2, { categoria: 'Bebidas', marca: 'Coca', precio: 200, costoFinal: 100 }), prod(3, { costoFinal: 0 })];
const item = (productoId, cantidad, precio, extra = {}) => ({ productoId, nombre: `Prod ${productoId}`, cantidad, precio, ...extra });
const ped = (extra = {}) => ({ id: 1, remoteId: 10, clienteId: 5, clienteNombre: 'Kiosco', vendedor: 'Ana', estado: 'facturado', fecha: '2026-10-10', items: [item(1, 10, 100)], ...extra });
const mapa = (o) => new Map(Object.entries(o));
const porId = new Map(productos.map(p => [String(p.id), p]));
const PER = { desde: '2026-10-01', hasta: '2026-10-31' };

describe('AC-PAN-1 costo del momento', () => {
  it('AC-PAN-1 costoNetoProductoCents coincide con calcularPrecioVenta().costoNeto (d1/d2 fuera de rango y vacíos)', () => {
    const casos = [
      { costoFinal: 100, descuento1: 10, descuento2: 5 }, { costoFinal: 100, descuento1: 150, descuento2: -3 },
      { costoFinal: '80,5', descuento1: '', descuento2: null }, { costoFinal: 33.333, descuento1: 12.5, descuento2: 7.25 },
    ];
    for (const c of casos) expect(costoNetoProductoCents(c)).toBe(Math.round(calcularPrecioVenta(c).costoNeto * 100));
  });
  it('AC-PAN-1 costo vacío, 0 o negativo => null', () => {
    expect(costoNetoProductoCents({ costoFinal: '' })).toBeNull();
    expect(costoNetoProductoCents({ costoFinal: 0 })).toBeNull();
    expect(costoNetoProductoCents({ costoFinal: -5 })).toBeNull();
    expect(costoNetoProductoCents(null)).toBeNull();
  });
  it('AC-PAN-1 el snapshot gana sobre el costo actual y no es estimado', () => {
    const cv = new Map([['10', { costos: { 1: 50 } }]]);
    const [r] = renglonesVenta([ped()], { costosVenta: cv, productosById: porId, periodo: PER });
    expect(r.costoCents).toBe(50000);
    expect(r.costoEstimado).toBe(false);
  });
  it('AC-PAN-1 sin snapshot usa el costo actual y marca "costo estimado"', () => {
    const [r] = renglonesVenta([ped()], { costosVenta: new Map(), productosById: porId, periodo: PER });
    expect(r.costoCents).toBe(60000);
    expect(r.costoEstimado).toBe(true);
  });
  it('AC-PAN-1 sin snapshot y sin costo => costoCents null', () => {
    const [r] = renglonesVenta([ped({ items: [item(3, 2, 100)] })], { costosVenta: new Map(), productosById: porId, periodo: PER });
    expect(r.costoCents).toBeNull();
    expect(r.costoEstimado).toBe(false);
  });
  it('AC-PAN-1 (seguridad) itemsSinCostos quita todas las claves de costo y no muta el original', () => {
    const orig = [{ productoId: 1, cantidad: 2, precio: 9, costoUnitario: 5, costoFinal: 4, descuento1: 1, descuento2: 2, ganancia: 30 }, { productoId: 2, cantidad: 1 }];
    const sin = itemsSinCostos(orig);
    expect(sin[0]).toEqual({ productoId: 1, cantidad: 2, precio: 9 });
    expect(sin[1]).toBe(orig[1]);
    expect(orig[0].costoUnitario).toBe(5);
    expect(itemsSinCostos(undefined)).toBeUndefined();
  });
});

describe('AC-PAN-2 período, totales y neteo de rendiciones', () => {
  it('AC-PAN-2 período anterior: mes completo => mes anterior completo (incluye enero y año bisiesto)', () => {
    expect(periodoMesEnCurso(new Date(2026, 9, 15))).toEqual(PER);
    expect(periodoAnterior(PER)).toEqual({ desde: '2026-09-01', hasta: '2026-09-30' });
    expect(periodoAnterior({ desde: '2026-01-01', hasta: '2026-01-31' })).toEqual({ desde: '2025-12-01', hasta: '2025-12-31' });
    expect(periodoAnterior({ desde: '2024-03-01', hasta: '2024-03-31' })).toEqual({ desde: '2024-02-01', hasta: '2024-02-29' });
  });
  it('AC-PAN-2 período anterior: rango libre => misma cantidad de días inmediatamente antes', () => {
    expect(periodoAnterior({ desde: '2026-10-10', hasta: '2026-10-16' })).toEqual({ desde: '2026-10-03', hasta: '2026-10-09' });
  });
  it('AC-PAN-2 totales: ventas, costo, ganancia, margen, pedidos y ticket', () => {
    const rs = renglonesVenta([ped(), ped({ id: 2, remoteId: 11, items: [item(2, 1, 200)] })], { costosVenta: new Map(), productosById: porId, periodo: PER });
    const r = resumenPeriodo(rs);
    expect(r).toMatchObject({ ventasCents: 120000, costoCents: 70000, gananciaCents: 50000, margenBp: 4167, pedidos: 2, ticketPromedioCents: 60000, renglonesEstimados: 2 });
  });
  it('AC-PAN-2 solo cuentan facturados, no ocultos, ítems no eliminados y cantidad > 0, dentro del período', () => {
    const peds = [
      ped({ id: 1, remoteId: 1, estado: 'pendiente' }), ped({ id: 2, remoteId: 2, borrado: true }), ped({ id: 3, remoteId: 3, fecha: '2026-09-30' }),
      ped({ id: 4, remoteId: 4, items: [item(1, 1, 10, { eliminado: true }), item(1, 0, 10), item(1, 2, 10)] }),
    ];
    const rs = renglonesVenta(peds, { productosById: porId, periodo: PER });
    expect(rs).toHaveLength(1);
    expect(rs[0].ventaCents).toBe(2000);
  });
  it('AC-PAN-2 devolución que vuelve al stock resta venta y costo; merma resta venta pero no costo', () => {
    const cv = new Map([['10', { costos: { 1: 60 } }]]);
    const rend = (vuelve) => ({ id: 'r', pedidoId: '10', estado: 'vigente', syncEstado: 'confirmada', tipo: 'devolucion', fecha: '2026-10-12', clienteId: 5, clienteNombre: 'Kiosco',
      renglones: [{ productoId: '1', nombre: 'Prod 1', cantidad: 2, precioCents: 10000, sentido: 'entra', vuelveAlStock: vuelve }] });
    const base = { pedidosById: new Map([['10', ped()]]), costosVenta: cv, productosById: porId, periodo: PER };
    const [v] = ajustesRendicion([rend(true)], base);
    expect(v).toMatchObject({ unidades: -2, ventaCents: -20000, costoCents: -12000, vendedor: 'Ana' });
    const [m] = ajustesRendicion([rend(false)], base);
    expect(m).toMatchObject({ unidades: -2, ventaCents: -20000, costoCents: 0 });
  });
  it('AC-PAN-2 cambio: entra resta, sale suma; NC resta venta sin costo ni unidades', () => {
    const r = { id: 'c', pedidoId: '10', estado: 'vigente', tipo: 'cambio', fecha: '2026-10-12', clienteId: 5,
      renglones: [{ productoId: '1', cantidad: 1, precioCents: 10000, sentido: 'entra', vuelveAlStock: true }, { productoId: '2', cantidad: 1, precioCents: 20000, sentido: 'sale' }] };
    const nc = { id: 'n', pedidoId: '10', estado: 'vigente', tipo: 'nc', fecha: '2026-10-12', creditoCents: 5000, clienteId: 5, renglones: [] };
    const aj = ajustesRendicion([r, nc], { pedidosById: new Map(), productosById: porId, periodo: PER });
    expect(aj.map(a => a.ventaCents)).toEqual([-10000, 20000, -5000]);
    expect(aj[2]).toMatchObject({ tipo: 'nc', productoId: null, costoCents: 0, unidades: 0 });
    expect(resumenPeriodo(aj).ventasCents).toBe(5000);
  });
  it('AC-PAN-2 rendición anulada o rechazada no cuenta; se imputa por la fecha de la rendición', () => {
    const base = { id: 'x', pedidoId: '10', tipo: 'nc', creditoCents: 100, renglones: [], fecha: '2026-10-12' };
    const aj = ajustesRendicion([{ ...base, estado: 'anulada' }, { ...base, estado: 'vigente', syncEstado: 'rechazada' }, { ...base, estado: 'vigente', fecha: '2026-11-02' }], { periodo: PER });
    expect(aj).toEqual([]);
  });
  it('AC-PAN-2 compararPeriodos: variación en bp y null si el anterior es 0', () => {
    const c = compararPeriodos({ ventasCents: 150, pedidos: 3, margenBp: null }, { ventasCents: 100, pedidos: 0, margenBp: 2000 });
    expect(c.ventasCents.variacionBp).toBe(5000);
    expect(c.pedidos.variacionBp).toBeNull();
    expect(c.margenBp.variacionBp).toBeNull();
  });
});

describe('AC-PAN-3 rentabilidad y orden', () => {
  const rs = () => renglonesVenta([
    ped({ items: [item(1, 10, 100), item(2, 1, 200)] }),
    ped({ id: 2, remoteId: 11, vendedor: 'Beto', clienteId: 6, clienteNombre: 'Super', items: [item(1, 5, 100), item(99, 1, 50)] }),
  ], { productosById: porId, periodo: PER });
  it('AC-PAN-3 agrupa por producto, rubro, marca, vendedor y cliente', () => {
    const r = rs();
    const prodF = rentabilidadPor(r, 'producto');
    expect(prodF.find(f => f.clave === '1')).toMatchObject({ unidades: 15, ventasCents: 150000, costoCents: 90000, gananciaCents: 60000, margenBp: 4000 });
    expect(rentabilidadPor(r, 'rubro').map(f => f.etiqueta).sort()).toEqual(['Bebidas', 'Golosinas', 'Sin rubro']);
    expect(rentabilidadPor(r, 'marca').find(f => f.etiqueta === 'Coca').ventasCents).toBe(20000);
    expect(rentabilidadPor(r, 'vendedor').map(f => f.etiqueta).sort()).toEqual(['Ana', 'Beto']);
    expect(rentabilidadPor(r, 'cliente')).toHaveLength(2);
    expect(rentabilidadPor(r, 'otra')).toEqual([]);
  });
  it('AC-PAN-3 producto borrado conserva el nombre del renglón y queda marcado', () => {
    const r = rs().find(x => x.productoId === '99');
    expect(r).toMatchObject({ productoBorrado: true, nombre: 'Prod 99', costoCents: null });
  });
  it('AC-PAN-3 la NC cuenta en vendedor/cliente pero no en producto/rubro/marca', () => {
    const nc = ajustesRendicion([{ id: 'n', pedidoId: '10', estado: 'vigente', tipo: 'nc', fecha: '2026-10-12', creditoCents: 1000, clienteId: 5, clienteNombre: 'Kiosco', renglones: [] }],
      { pedidosById: new Map([['10', ped()]]), periodo: PER });
    expect(rentabilidadPor(nc, 'producto')).toEqual([]);
    expect(rentabilidadPor(nc, 'rubro')).toEqual([]);
    expect(rentabilidadPor(nc, 'vendedor')[0].ventasCents).toBe(-1000);
  });
  it('AC-PAN-3 ordenarFilas por cada campo, estable y con nulos al final', () => {
    const f = [{ e: 'b', v: 5, m: null }, { e: 'a', v: 9, m: 10 }, { e: 'c', v: 5, m: 20 }];
    expect(ordenarFilas(f, 'v', 'desc').map(x => x.e)).toEqual(['a', 'b', 'c']);
    expect(ordenarFilas(f, 'v', 'asc').map(x => x.e)).toEqual(['b', 'c', 'a']);
    expect(ordenarFilas(f, 'e', 'asc').map(x => x.e)).toEqual(['a', 'b', 'c']);
    expect(ordenarFilas(f, 'm', 'asc').map(x => x.e)).toEqual(['a', 'c', 'b']);
    expect(ordenarFilas(f, 'm', 'desc').map(x => x.e)).toEqual(['c', 'a', 'b']);
  });
});

describe('AC-PAN-4 rankings y tendencia', () => {
  const fila = (clave, unidades, ventasCents, gan = 0) => ({ clave, etiqueta: clave, unidades, ventasCents, costoCents: ventasCents - gan, gananciaCents: gan });
  it('AC-PAN-4 top 10 por unidades y por importe', () => {
    const filas = Array.from({ length: 15 }, (_, i) => fila(`p${i}`, i + 1, (15 - i) * 100));
    const m = masVendidos(filas);
    expect(m.porUnidades).toHaveLength(10);
    expect(m.porUnidades[0].clave).toBe('p14');
    expect(m.porImporte[0].clave).toBe('p0');
  });
  it('AC-PAN-4 en alza / en baja con anterior 0 => nuevo', () => {
    const r = enAlzaEnBaja([fila('a', 20, 0), fila('b', 5, 0), fila('n', 3, 0)], [fila('a', 10, 0), fila('b', 10, 0), fila('z', 4, 0)]);
    expect(r.alza.map(x => x.clave)).toEqual(['a', 'n']);
    expect(r.alza[0].variacionBp).toBe(10000);
    expect(r.alza[1]).toMatchObject({ nuevo: true, variacionBp: null });
    expect(r.baja.map(x => x.clave)).toEqual(['b', 'z']);
    expect(r.baja[1].variacionBp).toBe(-10000);
  });
  it('AC-PAN-4 sin ventas: catálogo vigente con 0 unidades netas', () => {
    const r = sinVentas([prod(1), prod(2), prod(4, { eliminado: true })], [fila('1', 3, 0), fila('2', 0, 0)]);
    expect(r.map(p => p.id)).toEqual([2]);
  });
  it('AC-PAN-4 tendencia semanal (lunes a domingo) con buckets vacíos en 0', () => {
    const rs = [{ fecha: '2026-10-12', ventaCents: 100, costoCents: 40 }, { fecha: '2026-10-18', ventaCents: 50, costoCents: null }, { fecha: '2026-10-05', ventaCents: 10, costoCents: 0 }];
    const t = tendencia(rs, { agrupacion: 'semana', hasta: '2026-10-18', cantidad: 3 });
    expect(t.map(b => b.desde)).toEqual(['2026-09-28', '2026-10-05', '2026-10-12']);
    expect(t.map(b => b.ventasCents)).toEqual([0, 10, 150]);
    expect(t[2].gananciaCents).toBe(110);
  });
  it('AC-PAN-4 tendencia mensual con buckets vacíos', () => {
    const t = tendencia([{ fecha: '2026-10-03', ventaCents: 7, costoCents: 2 }], { agrupacion: 'mes', hasta: '2026-10-31', cantidad: 3 });
    expect(t.map(b => b.etiqueta)).toEqual(['08/2026', '09/2026', '10/2026']);
    expect(t.map(b => b.ventasCents)).toEqual([0, 0, 7]);
  });
});

describe('AC-PAN-5 avisos', () => {
  it('AC-PAN-5 margen negativo en el período o precio < costo en catálogo; sin costo cargado', () => {
    const ps = [prod(1), prod(2, { precio: 50 }), prod(3, { costoFinal: '' }), prod(4, { costoFinal: 0 })];
    const a = avisosPanel(ps, [{ clave: '1', etiqueta: 'Prod 1', ventasCents: 1000, gananciaCents: -100 }]);
    expect(a.margenNegativo.map(x => [x.clave, x.motivo])).toEqual([['1', 'periodo'], ['2', 'catalogo']]);
    expect(a.sinCosto.map(x => x.clave)).toEqual(['3', '4']);
  });
});

describe('AC-PAN-6 exactitud y rendimiento', () => {
  it('AC-PAN-6 centavos enteros: 0,1 + 0,2 no deriva', () => {
    const rs = renglonesVenta([ped({ items: [item(1, 1, 0.1), item(1, 1, 0.2)] })], { productosById: new Map(), periodo: PER });
    expect(resumenPeriodo(rs).ventasCents).toBe(30);
  });
  it('AC-PAN-6 período vacío => ceros y margen null', () => {
    const vm = calcularPanel({ pedidos: [], productos, rendiciones: [], periodo: PER });
    expect(vm.resumen).toMatchObject({ ventasCents: 0, costoCents: 0, gananciaCents: 0, margenBp: null, pedidos: 0, ticketPromedioCents: 0 });
    expect(vm.tendencia).toHaveLength(12);
    expect(vm.sinVentas).toHaveLength(3);
  });
  it('AC-PAN-6 calcularPanel integra período actual, anterior, rendiciones y costo estimado', () => {
    const peds = [ped(), ped({ id: 2, remoteId: 11, fecha: '2026-09-15', items: [item(1, 5, 100)] })];
    const rends = [{ id: 'n', pedidoId: '10', estado: 'vigente', tipo: 'nc', fecha: '2026-10-20', creditoCents: 10000, clienteId: 5, renglones: [] }];
    const vm = calcularPanel({ pedidos: peds, productos, rendiciones: rends, costosVenta: mapa({ 10: { costos: { 1: 55 } } }), periodo: PER });
    expect(vm.resumen).toMatchObject({ ventasCents: 90000, costoCents: 55000, gananciaCents: 35000, pedidos: 1, renglonesEstimados: 0 });
    expect(vm.resumenAnterior).toMatchObject({ ventasCents: 50000, renglonesEstimados: 1 });
    expect(vm.comparacion.ventasCents.variacionBp).toBe(8000);
    expect(vm.periodoAnterior).toEqual({ desde: '2026-09-01', hasta: '2026-09-30' });
  });
  it('AC-PAN-6 20.000 renglones se calculan en menos de 1 segundo', () => {
    const muchos = [];
    for (let p = 0; p < 2000; p += 1) {
      const items = [];
      for (let i = 0; i < 10; i += 1) items.push(item((p + i) % 300, 1 + (i % 5), 100 + i));
      muchos.push(ped({ id: p, remoteId: p + 1000, fecha: `2026-10-${String((p % 28) + 1).padStart(2, '0')}`, vendedor: `V${p % 7}`, clienteId: p % 150, clienteNombre: `C${p % 150}`, items }));
    }
    const prods = Array.from({ length: 300 }, (_, i) => prod(i, { categoria: `R${i % 12}`, marca: `M${i % 20}` }));
    const t0 = performance.now();
    const vm = calcularPanel({ pedidos: muchos, productos: prods, rendiciones: [], costosVenta: new Map(), periodo: PER });
    const ms = performance.now() - t0;
    expect(vm.resumen.pedidos).toBe(2000);
    expect(vm.porProducto.reduce((a, f) => a + f.unidades, 0)).toBe(2000 * 30);
    expect(ms).toBeLessThan(1000);
  });
});
