// AC-ESC-2 / AC-ESC-3: escalas con grupos combinables (REQ-GBU), renglones, edicion y boleta.
import { renglonNuevo } from '../bultos';
import { preciosPorGrupoBulto, progresoGrupoBulto, lineaGrupoBulto } from '../grupoBulto';
import { aplicarEdicion } from '../edicionPedido';
import { filasBoleta, columnasRenglonBoleta } from '../gruposFactura';
import { completarPreciosBulto, totalesBoleta, precioAplicadoRenglon } from '../precios';

const ESC = [{ desde: 5, pct: 8 }, { desde: 10, pct: 12 }];
const prod = (id, over = {}) => ({ id, nombre: `Prime ${id}`, precio: 1000, precioBulto: 0, bultoX: 10, grupoBulto: 'Prime', escalasBulto: ESC, ...over });
const reng = (p, cantidad) => ({ ...renglonNuevo(p), cantidad });

describe('AC-ESC-2 renglonNuevo congela escalas', () => {
  it('AC-ESC-2 congela escalasBulto y precioBultoX aunque no haya precio de bulto', () => {
    const r = renglonNuevo(prod(1));
    expect(r).toMatchObject({ precio: 1000, precioOriginal: 1000, precioBultoX: 10, escalasBulto: ESC });
    expect(r.precioBultoOriginal).toBeUndefined();
    expect(r.escalaPct).toBeUndefined();
  });
  it('AC-ESC-2 un producto sin escalas queda igual que antes (sin claves nuevas)', () => {
    const r = renglonNuevo({ id: 2, nombre: 'X', precio: 50, bultoX: 6 });
    expect(r).not.toHaveProperty('escalasBulto');
    expect(r).not.toHaveProperty('precioBultoX');
  });
  it('AC-ESC-2 "solo bulto" que arranca en el minimo ya puede traer escala', () => {
    const r = renglonNuevo(prod(3, { escalasBulto: [{ desde: 2, pct: 10 }], minimoVenta: 20, ventaPor: 'bulto' }));
    expect(r.cantidad).toBeGreaterThanOrEqual(10);
  });
  it('AC-ESC-2 cambiar las escalas del producto despues no toca el renglon ya creado', () => {
    const p = prod(1);
    const r = renglonNuevo(p);
    p.escalasBulto = [];
    expect(r.escalasBulto).toEqual(ESC);
  });
  it('AC-ESC-2 completarPreciosBulto congela escalas en un renglon de pedido web', () => {
    const r = completarPreciosBulto({ productoId: 1, precio: 1000, cantidad: 50 }, prod(1));
    expect(r).toMatchObject({ precio: 920, escalaPct: 8, escalaDesde: 5 });
  });
});

describe('AC-ESC-2 grupo combinable suma bultos para la escala', () => {
  const items3 = (a, b, c) => [reng(prod(1), a), reng(prod(2), b), reng(prod(3), c)];
  it('AC-ESC-2 Prime x3 productos: 20+20+10 u. = 5 bultos => -8 % en todos', () => {
    const r = preciosPorGrupoBulto(items3(20, 20, 10));
    expect(r.map(i => i.precio)).toEqual([920, 920, 920]);
    expect(r.every(i => i.escalaPct === 8 && i.escalaDesde === 5)).toBe(true);
  });
  it('AC-ESC-2 al bajar del umbral vuelve al precio de lista', () => {
    const arriba = preciosPorGrupoBulto(items3(20, 20, 10));
    const abajo = preciosPorGrupoBulto(arriba.map((i, k) => (k === 2 ? { ...i, cantidad: 9 } : i)));
    expect(abajo.map(i => i.precio)).toEqual([1000, 1000, 1000]);
    expect(abajo.every(i => i.escalaPct === undefined)).toBe(true);
  });
  it('AC-ESC-2 escala mas alta con 10 bultos del grupo', () => {
    const r = preciosPorGrupoBulto(items3(40, 30, 30));
    expect(r.map(i => i.precio)).toEqual([880, 880, 880]);
  });
  it('AC-ESC-2 un renglon con precio manual no se toca (AC-PBU-3) y el resto si', () => {
    const items = items3(20, 20, 10);
    items[0] = { ...items[0], precio: 900, precioManual: true };
    const r = preciosPorGrupoBulto(items);
    expect(r[0].precio).toBe(900);
    expect(r[1].precio).toBe(920);
  });
  it('AC-ESC-3 progreso del grupo muestra la escala', () => {
    const r = preciosPorGrupoBulto(items3(20, 20, 10));
    expect(progresoGrupoBulto(r[0], r).texto).toContain('x5 bultos');
  });
  it('AC-ESC-3 linea del grupo en la boleta: sufijo ASCII', () => {
    const r = preciosPorGrupoBulto(items3(20, 20, 10));
    const l = lineaGrupoBulto(r, { peso: n => `$${n}` });
    expect(l.nombre).toContain('(x5 bultos -8 %)');
    expect(/^[\x20-\x7e]*$/.test(l.nombre)).toBe(true);
    expect(l.subtotal).toBe(50 * 920);
  });
});

describe('AC-ESC-3 edicion del vendedor (REQ-EDP): nunca confia en el cliente', () => {
  const original = { id: 1, estado: 'pendiente', items: [{ ...renglonNuevo(prod(1)), cantidad: 10 }] };
  const vendedor = { permiso: 2, nombre: 'Ana' };
  it('AC-ESC-3 recalcula escalaDesde/escalaPct desde lo congelado', () => {
    const forjado = { ...original.items[0], cantidad: 50, precio: 1, escalaPct: 99, escalaDesde: 2, escalasBulto: [{ desde: 2, pct: 99 }] };
    const out = aplicarEdicion(original, { items: [forjado] }, { usuario: vendedor });
    expect(out.items[0]).toMatchObject({ precio: 920, escalaPct: 8, escalaDesde: 5, escalasBulto: ESC });
  });
  it('AC-ESC-3 sin llegar a la escala no queda ninguna marca', () => {
    const forjado = { ...original.items[0], cantidad: 20, escalaPct: 50, escalaDesde: 2 };
    const out = aplicarEdicion(original, { items: [forjado] }, { usuario: vendedor });
    expect(out.items[0].precio).toBe(1000);
    expect(out.items[0].escalaPct).toBeUndefined();
  });
  it('AC-ESC-3 renglon nuevo toma las escalas del catalogo', () => {
    const nuevo = { productoId: 7, nombre: 'N', cantidad: 50, precio: 1 };
    const out = aplicarEdicion(original, { items: [nuevo] }, { usuario: vendedor, productosById: new Map([['7', prod(7, { grupoBulto: '' })]]) });
    expect(out.items[0]).toMatchObject({ precio: 920, escalaPct: 8 });
  });
  it('AC-ESC-3 en grupo combinable acepta el precio entre el piso y el del renglon y deduce la escala', () => {
    const it1 = { ...renglonNuevo(prod(1)), cantidad: 20 };
    const o = { ...original, items: [it1] };
    const out = aplicarEdicion(o, { items: [{ ...it1, precio: 920 }] }, { usuario: vendedor });
    expect(out.items[0]).toMatchObject({ precio: 920, escalaPct: 8, escalaDesde: 5 });
    const ilegal = aplicarEdicion(o, { items: [{ ...it1, precio: 100 }] }, { usuario: vendedor });
    expect(ilegal.items[0].precio).toBe(1000);
  });
  it('AC-ESC-3 el admin puede tocar el precio (precio manual)', () => {
    const out = aplicarEdicion(original, { items: [{ ...original.items[0], precio: 500, precioManual: true }] }, { usuario: { permiso: 1 } });
    expect(out.items[0].precio).toBe(500);
  });
});

describe('AC-ESC-3 remito/boleta con escala', () => {
  const r = [precioAplicadoRenglon(reng(prod(1, { grupoBulto: '' }), 50), 50)];
  it('AC-ESC-3 columnasRenglonBoleta agrega la escala en ASCII', () => {
    const c = columnasRenglonBoleta(r[0], 'Prime 1');
    expect(c.nombre).toBe('Prime 1 (bulto x10) (x5 bultos -8 %)');
    expect(c.cantidadTexto).toBe('5');
    expect(/^[\x20-\x7e]*$/.test(c.nombre)).toBe(true);
  });
  it('AC-ESC-3 filasBoleta y totales coinciden con la pantalla', () => {
    const filas = filasBoleta(r, [], {});
    expect(filas.length).toBeGreaterThan(0);
    const t = totalesBoleta(r);
    expect(t.total).toBe(50 * 920);
    expect(t.descuento).toBe(0);
  });
});
