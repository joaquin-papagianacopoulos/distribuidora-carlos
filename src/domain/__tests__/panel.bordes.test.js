// REQ-PAN: casos borde de QA (run 20261015-2019). Complementa panel.test.js.
import {
  renglonesVenta, ajustesRendicion, resumenPeriodo, rentabilidadPor, enAlzaEnBaja, sinVentas,
  tendencia, avisosPanel, calcularPanel, periodoAnterior, compararPeriodos, masVendidos,
} from '../panel';

const prod = (id, extra = {}) => ({ id, nombre: `Prod ${id}`, categoria: 'R', marca: 'M', precio: 100, costoFinal: 60, descuento1: 0, descuento2: 0, ...extra });
const item = (productoId, cantidad, precio, extra = {}) => ({ productoId, cantidad, precio, ...extra });
const ped = (extra = {}) => ({ id: 1, remoteId: 10, clienteId: 5, clienteNombre: 'K', vendedor: 'Ana', estado: 'facturado', fecha: '2026-10-10', items: [item(1, 1, 100)], ...extra });
const porId = (ps) => new Map(ps.map(p => [String(p.id), p]));
const PER = { desde: '2026-10-01', hasta: '2026-10-31' };

describe('REQ-PAN bordes', () => {
  it('AC-PAN-1 centavos: cantidad decimal y precio con centavos no derivan', () => {
    const p = [prod(1, { costoFinal: 33.33 })];
    const [r] = renglonesVenta([ped({ items: [item(1, 2.5, 1.15)] })], { productosById: porId(p), periodo: PER });
    expect(r.ventaCents).toBe(288); // 2.5 * 115 = 287.5 -> 288
    expect(r.costoCents).toBe(8333); // 2.5 * 3333 = 8332.5 -> 8333
    expect(Number.isInteger(resumenPeriodo([r]).gananciaCents)).toBe(true);
  });
  it('AC-PAN-1 snapshot con costo 0 es un costo valido (no estimado)', () => {
    const cv = new Map([['10', { costos: { 1: 0 } }]]);
    const [r] = renglonesVenta([ped()], { costosVenta: cv, productosById: porId([prod(1)]), periodo: PER });
    expect(r).toMatchObject({ costoCents: 0, costoEstimado: false });
  });
  it('AC-PAN-1 snapshot null cae al costo actual estimado', () => {
    const cv = new Map([['10', { costos: { 1: null } }]]);
    const [r] = renglonesVenta([ped()], { costosVenta: cv, productosById: porId([prod(1)]), periodo: PER });
    expect(r).toMatchObject({ costoCents: 6000, costoEstimado: true });
  });
  it('AC-PAN-2 margen negativo y ganancia negativa con centavos', () => {
    const r = resumenPeriodo([{ tipo: 'venta', pedidoId: 'a', ventaCents: 333, costoCents: 500, costoEstimado: false }]);
    expect(r.gananciaCents).toBe(-167);
    expect(r.margenBp).toBe(-5015);
  });
  it('AC-PAN-2 ganancia cero con ventas no devuelve -0', () => {
    const r = resumenPeriodo([{ tipo: 'venta', pedidoId: 'a', ventaCents: 100, costoCents: 100 }]);
    expect(Object.is(r.margenBp, 0)).toBe(true);
  });
  it('AC-PAN-2 devolucion total deja ventas 0 => margen null y sin dividir por cero', () => {
    const vs = [{ tipo: 'venta', pedidoId: 'a', ventaCents: 1000, costoCents: 600 }, { tipo: 'devolucion', pedidoId: 'a', ventaCents: -1000, costoCents: -600 }];
    expect(resumenPeriodo(vs)).toMatchObject({ ventasCents: 0, gananciaCents: 0, margenBp: null, ticketPromedioCents: 0 });
  });
  it('AC-PAN-2 NC mayor que ventas: ventas negativas, margen no engana', () => {
    // Con ventas < 0 el margen se calcula contra un denominador negativo (signo invertido).
    const r = resumenPeriodo([{ tipo: 'venta', pedidoId: 'a', ventaCents: 1000, costoCents: 500 }, { tipo: 'nc', pedidoId: 'a', ventaCents: -3000, costoCents: 0 }]);
    expect(r.ventasCents).toBe(-2000);
    expect(r.margenBp === null || r.margenBp <= 0).toBe(true);
  });
  it('AC-PAN-2 periodo anterior: marzo->febrero (28/29), enero->diciembre, un dia, cruce de anio', () => {
    expect(periodoAnterior({ desde: '2026-03-01', hasta: '2026-03-31' })).toEqual({ desde: '2026-02-01', hasta: '2026-02-28' });
    expect(periodoAnterior({ desde: '2028-03-01', hasta: '2028-03-31' })).toEqual({ desde: '2028-02-01', hasta: '2028-02-29' });
    expect(periodoAnterior({ desde: '2027-01-01', hasta: '2027-01-31' })).toEqual({ desde: '2026-12-01', hasta: '2026-12-31' });
    expect(periodoAnterior({ desde: '2026-10-15', hasta: '2026-10-15' })).toEqual({ desde: '2026-10-14', hasta: '2026-10-14' });
    expect(periodoAnterior({ desde: '2027-01-01', hasta: '2027-01-10' })).toEqual({ desde: '2026-12-22', hasta: '2026-12-31' });
    expect(periodoAnterior({ desde: '2026-10-31', hasta: '2026-11-02' })).toEqual({ desde: '2026-10-28', hasta: '2026-10-30' });
  });
  it('AC-PAN-2 rendicion de pedido inexistente localmente no rompe y marca producto borrado', () => {
    const r = { id: 'r', pedidoId: '999', estado: 'vigente', tipo: 'devolucion', fecha: '2026-10-05', clienteNombre: 'X',
      renglones: [{ productoId: '77', cantidad: 1, precioCents: 500, sentido: 'entra', vuelveAlStock: true }] };
    const [a] = ajustesRendicion([r], { productosById: new Map(), periodo: PER });
    expect(a).toMatchObject({ ventaCents: -500, costoCents: null, productoBorrado: true, vendedor: '' });
  });
  it('AC-PAN-2 rendicion rechazada y renglones invalidos se ignoran', () => {
    const base = { pedidoId: '10', estado: 'vigente', tipo: 'devolucion', fecha: '2026-10-05' };
    const rs = [{ ...base, syncEstado: 'rechazada', renglones: [{ productoId: '1', cantidad: 1, precioCents: 1, sentido: 'entra' }] },
      { ...base, renglones: [{ productoId: '1', cantidad: 0, precioCents: 1, sentido: 'entra' }, { productoId: '1', cantidad: 1, precioCents: 1, sentido: 'x' }, null] }];
    expect(ajustesRendicion(rs, { productosById: porId([prod(1)]), periodo: PER })).toEqual([]);
  });
  it('AC-PAN-2 compararPeriodos con anterior negativo usa magnitud; margen null => variacion null', () => {
    const c = compararPeriodos({ gananciaCents: -50, margenBp: null }, { gananciaCents: -100, margenBp: null });
    expect(c.gananciaCents.variacionBp).toBe(5000);
    expect(c.margenBp.variacionBp).toBeNull();
  });
  it('AC-PAN-2 no facturados, web sin aceptar, sin items y nulos quedan afuera; estado en mayuscula cuenta', () => {
    const peds = [ped({ estado: 'cancelado' }), ped({ remoteId: 11, origen: 'web', webEstado: 'nuevo' }), ped({ remoteId: 12, items: null }), null, undefined,
      ped({ remoteId: 13, estado: 'Facturado' })];
    expect(renglonesVenta(peds, { productosById: porId([prod(1)]), periodo: PER })).toHaveLength(1);
  });
  it('AC-PAN-2 pedido sin remoteId igual cuenta (id local) con costo estimado', () => {
    const [r] = renglonesVenta([ped({ remoteId: null, id: 7 })], { productosById: porId([prod(1)]), periodo: PER });
    expect(r).toMatchObject({ pedidoId: 'local:7', costoEstimado: true });
  });
  it('AC-PAN-2 fecha ISO con hora: no se corre de dia por zona horaria Argentina', () => {
    // normalizePedidoFecha corta el string en UTC. 2026-10-11T01:30:00Z son las 22:30 del 10/10 en Argentina (UTC-3).
    const [r] = renglonesVenta([ped({ fecha: '2026-10-11T01:30:00.000Z' })], { productosById: porId([prod(1)]), periodo: PER });
    expect(r.fecha).toBe('2026-10-10');
  });
  it('AC-PAN-3 producto borrado sin snapshot ni costo => costo null y cuenta como renglon sin costo', () => {
    const [r] = renglonesVenta([ped({ items: [item(99, 1, 100)] })], { productosById: porId([prod(1)]), periodo: PER });
    expect(r).toMatchObject({ productoBorrado: true, costoCents: null });
    expect(resumenPeriodo([r])).toMatchObject({ renglonesSinCosto: 1, costoCents: 0 });
  });
  it('AC-PAN-3 item sin productoId no entra por producto pero si por vendedor', () => {
    const rs = renglonesVenta([ped({ items: [item(null, 1, 100), item('', 1, 50)] })], { productosById: porId([prod(1)]), periodo: PER });
    expect(rentabilidadPor(rs, 'producto')).toEqual([]);
    expect(rentabilidadPor(rs, 'vendedor')[0].ventasCents).toBe(15000);
  });
  it('AC-PAN-3 rubro agrupa sin distinguir mayusculas/espacios; vendedor vacio => Sin vendedor; dimension invalida', () => {
    const ps = [prod(1, { categoria: 'Bebidas ' }), prod(2, { categoria: 'bebidas', marca: '' })];
    const rs = renglonesVenta([ped({ vendedor: '', items: [item(1, 1, 10), item(2, 1, 10)] })], { productosById: porId(ps), periodo: PER });
    expect(rentabilidadPor(rs, 'rubro')).toHaveLength(1);
    expect(rentabilidadPor(rs, 'vendedor')[0].etiqueta).toBe('Sin vendedor');
    expect(rentabilidadPor(rs, 'marca').map(f => f.etiqueta).sort()).toEqual(['M', 'Sin marca']);
    expect(rentabilidadPor(rs, 'inexistente')).toEqual([]);
  });
  it('AC-PAN-4 en alza/en baja: producto nuevo, producto que dejo de venderse, igual y tope n', () => {
    const f = (clave, unidades) => ({ clave, etiqueta: clave, unidades });
    const r = enAlzaEnBaja([f('nuevo', 5), f('igual', 3), f('sube', 6)], [f('igual', 3), f('sube', 2), f('muerto', 8)]);
    expect(r.alza.map(x => x.clave)).toEqual(['nuevo', 'sube']);
    expect(r.alza[0]).toMatchObject({ nuevo: true, variacionBp: null });
    expect(r.alza[1]).toMatchObject({ nuevo: false, variacionBp: 20000 });
    expect(r.baja).toEqual([expect.objectContaining({ clave: 'muerto', unidades: 0, delta: -8, variacionBp: -10000 })]);
    expect(enAlzaEnBaja(null, null)).toEqual({ alza: [], baja: [] });
    expect(enAlzaEnBaja([f('a', 3), f('b', 2)], [], 1).alza).toHaveLength(1);
  });
  it('AC-PAN-4 en alza con anterior negativo (solo devoluciones) no da %', () => {
    const r = enAlzaEnBaja([{ clave: 'a', etiqueta: 'a', unidades: 2 }], [{ clave: 'a', etiqueta: 'a', unidades: -1 }]);
    expect(r.alza[0].variacionBp).toBeNull();
  });
  it('AC-PAN-4 sin ventas excluye borrados/inactivos; devuelto por completo cuenta como sin ventas', () => {
    const ps = [prod(1), prod(2, { eliminado: true }), prod(3, { borrado: true }), prod(4, { activo: false }), prod(5)];
    const filas = [{ clave: '1', unidades: 3 }, { clave: '5', unidades: 0 }];
    expect(sinVentas(ps, filas).map(p => p.id)).toEqual([5]);
    expect(sinVentas(null, null)).toEqual([]);
  });
  it('AC-PAN-4 mas vendidos ignora unidades <= 0', () => {
    const filas = [{ clave: 'a', unidades: 0, ventasCents: 0 }, { clave: 'b', unidades: -2, ventasCents: -5 }, { clave: 'c', unidades: 1, ventasCents: 9 }];
    const m = masVendidos(filas, 5);
    expect(m.porUnidades.map(f => f.clave)).toEqual(['c']);
    expect(m.porImporte.map(f => f.clave)).toEqual(['c']);
  });
  it('AC-PAN-4 tendencia semanal: limite domingo/lunes y cambio de anio', () => {
    const rs = [{ fecha: '2026-10-11', ventaCents: 1, costoCents: 0 }, { fecha: '2026-10-12', ventaCents: 10, costoCents: 0 }, { fecha: '2026-10-19', ventaCents: 100, costoCents: 0 }];
    const t = tendencia(rs, { agrupacion: 'semana', hasta: '2026-10-18', cantidad: 2 });
    expect(t.map(b => b.ventasCents)).toEqual([1, 10]);
    const y = tendencia([{ fecha: '2026-12-31', ventaCents: 5, costoCents: 0 }, { fecha: '2027-01-03', ventaCents: 7, costoCents: 0 }], { agrupacion: 'semana', hasta: '2027-01-03', cantidad: 2 });
    expect(y.map(b => b.desde)).toEqual(['2026-12-21', '2026-12-28']);
    expect(y.map(b => b.ventasCents)).toEqual([0, 12]);
  });
  it('AC-PAN-4 tendencia mensual cruza el anio; sin hasta devuelve vacio', () => {
    const t = tendencia([{ fecha: '2026-12-15', ventaCents: 3, costoCents: 1 }], { agrupacion: 'mes', hasta: '2027-01-20', cantidad: 3 });
    expect(t.map(b => b.etiqueta)).toEqual(['11/2026', '12/2026', '01/2027']);
    expect(t[1]).toMatchObject({ ventasCents: 3, gananciaCents: 2 });
    expect(tendencia([], {})).toEqual([]);
  });
  it('AC-PAN-5 avisos: margen negativo del periodo no se duplica con catalogo; sin costo; borrados fuera', () => {
    const ps = [prod(1, { precio: 50, costoFinal: 60 }), prod(2, { costoFinal: '' }), prod(3, { precio: 10, costoFinal: 60, eliminado: true }), prod(4, { precio: 60, costoFinal: 60 })];
    const a = avisosPanel(ps, [{ clave: '1', etiqueta: 'P1', ventasCents: 100, gananciaCents: -10 }, { clave: '9', etiqueta: 'borrado', ventasCents: 100, gananciaCents: -1 }]);
    expect(a.margenNegativo.map(x => `${x.clave}:${x.motivo}`)).toEqual(['1:periodo', '9:periodo']);
    expect(a.sinCosto.map(x => x.clave)).toEqual(['2']);
  });
  it('AC-PAN-5 avisos: precio igual al costo no es negativo; descuentos bajan el costo', () => {
    const a = avisosPanel([prod(1, { precio: 54, costoFinal: 60, descuento1: 10 }), prod(2, { precio: 59.99, costoFinal: 60 })], []);
    expect(a.margenNegativo.map(x => x.clave)).toEqual(['2']);
    expect(a.margenNegativo[0].gananciaCents).toBe(-1);
  });
  it('AC-PAN-6 calcularPanel: periodo vacio y entradas null no rompen', () => {
    const p = calcularPanel({ pedidos: null, productos: null, rendiciones: null, periodo: PER });
    expect(p.resumen).toMatchObject({ ventasCents: 0, margenBp: null, pedidos: 0 });
    expect(p.tendencia).toHaveLength(12);
    expect(calcularPanel({ now: new Date(2026, 9, 15) }).periodo).toEqual(PER);
  });
  it('AC-PAN-6 calcularPanel: pedido de la semana previa al mes entra en tendencia y en periodo anterior, no en resumen', () => {
    const peds = [ped({ fecha: '2026-09-29' }), ped({ remoteId: 11, fecha: '2026-10-02' })];
    const p = calcularPanel({ pedidos: peds, productos: [prod(1)], periodo: PER, agrupacion: 'semana', cantidadBarras: 6 });
    expect(p.resumen.pedidos).toBe(1);
    expect(p.resumenAnterior.pedidos).toBe(1);
    expect(p.tendencia.reduce((s, b) => s + b.ventasCents, 0)).toBe(20000);
  });
  it('AC-PAN-6 calcularPanel: devolucion y NC vigentes netean, anulada no; producto borrado sin costo', () => {
    const rends = [
      { id: 'a', pedidoId: '10', estado: 'vigente', tipo: 'devolucion', fecha: '2026-10-12', renglones: [{ productoId: '1', cantidad: 1, precioCents: 10000, sentido: 'entra', vuelveAlStock: true }] },
      { id: 'b', pedidoId: '10', estado: 'anulada', tipo: 'nc', fecha: '2026-10-12', creditoCents: 99999, renglones: [] },
      { id: 'c', pedidoId: '10', estado: 'vigente', tipo: 'nc', fecha: '2026-10-13', creditoCents: 1000, renglones: [] },
    ];
    const peds = [ped({ items: [item(1, 3, 100), item(99, 1, 40)] })];
    const p = calcularPanel({ pedidos: peds, productos: [prod(1)], rendiciones: rends, periodo: PER });
    expect(p.resumen.ventasCents).toBe(30000 + 4000 - 10000 - 1000);
    expect(p.resumen.costoCents).toBe(18000 - 6000);
    expect(p.resumen.renglonesSinCosto).toBe(1);
    expect(p.porProducto.find(f => f.clave === '1').unidades).toBe(2);
  });
});
