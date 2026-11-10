// QA REQ-ESC (tanda 3): casos borde adicionales. No duplica precios.escalas.test.js.
import {
  normalizarEscalasBulto, escalaAlcanzada, aplicarDescuentoEscala, precioConEscala, precioAplicado,
  precioAplicadoRenglon, totalesBoleta, etiquetaEscala, validarEscalasBulto, parsearEscalasTexto,
} from '../precios';
import { renglonNuevo } from '../bultos';
import { preciosPorGrupoBulto } from '../grupoBulto';
import { aplicarEdicion } from '../edicionPedido';
import { planificarImportacion } from '../plantillas';

const E = [{ desde: 5, pct: 8 }];

describe('AC-ESC-4 regresion: sin escalas igual que antes (REQ-PBU)', () => {
  const p = { precio: 900, precioBulto: 800, bultoX: 16 };
  it('AC-ESC-4 unidad $900, bulto $800 x16: 10 u -> $9.000 y 16 u -> $12.800', () => {
    expect(precioAplicado(p, 10).precio * 10).toBe(9000);
    expect(precioAplicado(p, 16).precio * 16).toBe(12800);
    expect(precioAplicado(p, 10)).toEqual({ precio: 900, porBulto: false });
  });
  it('AC-ESC-4 escalas vacias, null o invalidas no cambian el resultado ni agregan clave', () => {
    for (const escalasBulto of [[], null, undefined, 'x', [{ desde: 1, pct: 5 }]]) {
      expect(precioAplicado({ ...p, escalasBulto }, 16)).toEqual({ precio: 800, porBulto: true });
    }
  });
  it('AC-ESC-4 producto null/undefined y cantidad rara no rompen', () => {
    for (const prod of [null, undefined, 5, 'a']) expect(() => precioAplicado(prod, 10)).not.toThrow();
    for (const c of [null, undefined, NaN, -5, '16']) expect(() => precioAplicado({ ...p, escalasBulto: E }, c)).not.toThrow();
    expect(precioAplicado({ ...p, escalasBulto: E }, null).escala).toBeUndefined();
  });
});

describe('AC-ESC-2 borde exacto y bultos completos', () => {
  const prod = { precio: 1000, precioBulto: 0, bultoX: 12, escalasBulto: E };
  it('AC-ESC-2 N-1 bultos + sueltas no aplica; N bultos si', () => {
    expect(precioAplicado(prod, 4 * 12 + 11).escala).toBeUndefined();
    expect(precioAplicado(prod, 5 * 12).precio).toBe(920);
    expect(precioAplicado(prod, 5 * 12 + 11).precio).toBe(920); // sueltas de mas igual
  });
  it('AC-ESC-2 la escala va a TODAS las unidades del renglon (incluidas sueltas)', () => {
    const r = precioAplicado(prod, 71);
    expect(r.precio).toBe(920);
    expect(r.escala.bultos).toBe(5);
  });
  it('AC-ESC-2 escala mas alta alcanzada con tres escalas', () => {
    const es = [{ desde: 2, pct: 3 }, { desde: 5, pct: 8 }, { desde: 20, pct: 15 }];
    expect(escalaAlcanzada(es, 10, 19 * 10)).toEqual({ desde: 5, pct: 8 });
    expect(escalaAlcanzada(es, 10, 20 * 10)).toEqual({ desde: 20, pct: 15 });
    expect(escalaAlcanzada(es, 10, 10)).toBeNull();
  });
});

describe('AC-ESC-2 redondeo para arriba', () => {
  it('AC-ESC-2 $800 -8 % = 736 exacto; $333 -7 % = 309,69 -> 310', () => {
    expect(aplicarDescuentoEscala(800, 8)).toBe(736);
    expect(aplicarDescuentoEscala(333, 7)).toBe(310);
    expect(aplicarDescuentoEscala(100.4, 50)).toBe(51);
  });
  it('AC-ESC-2 el total del renglon usa el unitario ya redondeado', () => {
    const r = precioAplicado({ precio: 333, bultoX: 10, escalasBulto: [{ desde: 2, pct: 7 }] }, 20);
    expect(r.precio * 20).toBe(6200);
  });
  it('AC-ESC-2 aplicarDescuentoEscala con precio/pct basura no tira', () => {
    for (const [a, b] of [[NaN, 8], [null, 8], [undefined, undefined], [-5, 8], [100, -5], [100, 500], ['abc', 'x']]) {
      expect(() => aplicarDescuentoEscala(a, b)).not.toThrow();
    }
  });
  // (corregido) precio Infinity hace BigInt(Infinity) -> RangeError (funcion exportada). precioConEscala filtra antes con aPrecio.
  it('AC-ESC-2 aplicarDescuentoEscala(Infinity) no tira', () => {
    expect(() => aplicarDescuentoEscala(Infinity, 8)).not.toThrow();
  });
});

describe('AC-ESC-1/4 escalas invalidas se ignoran sin romper', () => {
  it('AC-ESC-4 N<2, pct 0/100/negativo/NaN/Infinity/texto, desde decimal o enorme', () => {
    const malas = [
      { desde: 1, pct: 5 }, { desde: 0, pct: 5 }, { desde: -3, pct: 5 }, { desde: 2.5, pct: 5 }, { desde: 10000, pct: 5 },
      { desde: 3, pct: 0 }, { desde: 3, pct: 100 }, { desde: 3, pct: -8 }, { desde: 3, pct: NaN }, { desde: 3, pct: Infinity },
      { desde: 3, pct: '8' }, { desde: '3', pct: 8 }, { desde: 3 }, { pct: 8 }, {}, [], 'x', 7, true,
    ];
    expect(normalizarEscalasBulto(malas)).toEqual([]);
    expect(normalizarEscalasBulto(undefined)).toEqual([]);
    expect(precioAplicado({ precio: 100, bultoX: 5, escalasBulto: malas }, 500)).toEqual({ precio: 100, porBulto: false });
  });
  it('AC-ESC-4 desordenadas: se toma el orden de carga y se descartan las que no crecen', () => {
    // Observacion: [10,5] deja solo la de 10 (la de 5 se pierde); no rompe.
    expect(normalizarEscalasBulto([{ desde: 10, pct: 12 }, { desde: 5, pct: 8 }])).toEqual([{ desde: 10, pct: 12 }]);
  });
  it('AC-ESC-4 duplicadas: gana la primera', () => {
    expect(normalizarEscalasBulto([{ desde: 5, pct: 8 }, { desde: 5, pct: 9 }])).toEqual([{ desde: 5, pct: 8 }]);
  });
  it('AC-ESC-4 mas de 3 validas: se queda con 3', () => {
    const r = normalizarEscalasBulto([2, 3, 4, 5, 6].map(d => ({ desde: d, pct: d })));
    expect(r.map(e => e.desde)).toEqual([2, 3, 4]);
  });
  it('AC-ESC-1 Bulto x <= 1 no admite escalas (validar)', () => {
    for (const bx of [1, 0, null, undefined, '', -4]) {
      expect(validarEscalasBulto([{ desde: '5', pct: '8' }], bx).errores.length).toBeGreaterThan(0);
    }
    expect(validarEscalasBulto([{ desde: '', pct: '' }], 1).errores).toEqual([]);
  });
  it('AC-ESC-1 validar: 4 filas, pct 100, negativo, desde 1 son errores y valor vacio', () => {
    for (const f of [
      [{ desde: 2, pct: 1 }, { desde: 3, pct: 2 }, { desde: 4, pct: 3 }, { desde: 5, pct: 4 }],
      [{ desde: 2, pct: 100 }], [{ desde: 2, pct: -1 }], [{ desde: 1, pct: 5 }], [{ desde: '2', pct: 'abc' }],
    ]) {
      const r = validarEscalasBulto(f, 10);
      expect(r.errores.length).toBeGreaterThan(0);
      expect(r.valor).toEqual([]);
    }
  });
  it('AC-ESC-1 parsearEscalasTexto tolera basura', () => {
    for (const t of [null, undefined, 5, '', ';;;', '=', '5=']) expect(() => parsearEscalasTexto(t)).not.toThrow();
  });
});

describe('AC-ESC-2 precio manual y congelado', () => {
  const r0 = { productoId: 1, precio: 1000, precioOriginal: 1000, cantidad: 10, precioBultoX: 10, escalasBulto: E };
  it('AC-ESC-2 precioManual:true se respeta aunque haya escala', () => {
    const m = { ...r0, precio: 700, precioManual: true };
    expect(precioAplicadoRenglon(m, 50)).toBe(m);
  });
  it('AC-ESC-2 renglon ya hecho no cambia si despues cambian las escalas del producto', () => {
    const prod = { id: 1, nombre: 'X', precio: 1000, bultoX: 10, escalasBulto: E };
    const r = renglonNuevo(prod);
    prod.escalasBulto = [{ desde: 2, pct: 50 }];
    const x = precioAplicadoRenglon({ ...r, cantidad: 50 }, 50);
    expect(x.precio).toBe(920);
    expect(x.escalaPct).toBe(8);
  });
  it('AC-ESC-2 escalaDesde/escalaPct del cliente se ignoran y se recalculan (sin llegar al umbral)', () => {
    const x = precioAplicadoRenglon({ ...r0, escalaDesde: 2, escalaPct: 90, precio: 100 }, 10);
    expect(x.escalaPct).toBeUndefined();
  });
  it('AC-ESC-2 renglon con escalasBulto basura y sin bulto no rompe', () => {
    expect(() => precioAplicadoRenglon({ ...r0, escalasBulto: 'zzz' }, 50)).not.toThrow();
  });
});

describe('AC-ESC-2 grupo combinable (REQ-GBU)', () => {
  const p = (id, escalasBulto) => ({ id, nombre: `P${id}`, precio: 1000, bultoX: 10, grupoBulto: 'G', escalasBulto });
  const rg = (pr, c) => ({ ...renglonNuevo(pr), cantidad: c });
  it('AC-ESC-2 cuenta la suma, pero cada producto usa su escala congelada', () => {
    const items = [rg(p(1, [{ desde: 5, pct: 8 }]), 30), rg(p(2, [{ desde: 5, pct: 20 }]), 20), rg(p(3, []), 10)];
    const r = preciosPorGrupoBulto(items);
    expect(r[0].precio).toBe(920);
    expect(r[1].precio).toBe(800);
    expect(r[2].precio).toBe(1000);
  });
  it('AC-ESC-2 grupo a 4 bultos (borde N-1) no aplica', () => {
    const r = preciosPorGrupoBulto([rg(p(1, E), 20), rg(p(2, E), 20)]);
    expect(r.map(i => i.precio)).toEqual([1000, 1000]);
  });
});

describe('AC-ESC-3 edicion hostil y boleta', () => {
  const original = { id: 1, estado: 'pendiente', items: [{ ...renglonNuevo({ id: 1, nombre: 'X', precio: 1000, bultoX: 10, escalasBulto: E }), cantidad: 10 }] };
  it('AC-ESC-3 vendedor no puede inventar escala en renglon sin escalas congeladas', () => {
    const o = { id: 2, estado: 'pendiente', items: [{ ...renglonNuevo({ id: 9, nombre: 'Y', precio: 500, bultoX: 10 }), cantidad: 10 }] };
    const f = { ...o.items[0], cantidad: 100, precio: 1, escalaPct: 50, escalaDesde: 2, escalasBulto: [{ desde: 2, pct: 50 }], precioBultoX: 10 };
    const out = aplicarEdicion(o, { items: [f] }, { usuario: { permiso: 2, nombre: 'v' } });
    expect(out.items[0].precio).toBe(500);
    expect(out.items[0].escalaPct).toBeUndefined();
  });
  it('AC-ESC-3 total correcto y guion ASCII en etiqueta PDF', () => {
    const it = precioAplicadoRenglon({ ...original.items[0], cantidad: 50 }, 50);
    expect(totalesBoleta([{ ...it, cantidad: 50 }]).total).toBe(46000);
    const pdf = etiquetaEscala(it, { pdf: true });
    expect(/^[\x20-\x7e]+$/.test(pdf)).toBe(true);
    expect(pdf).toBe('x5 bultos -8 %');
  });
  it('AC-ESC-3 etiquetaEscala con datos basura devuelve null', () => {
    for (const x of [null, undefined, {}, { escalaDesde: 1, escalaPct: 5 }, { escalaDesde: 5, escalaPct: 0 }, { escalaDesde: 5, escalaPct: -3 }]) {
      expect(etiquetaEscala(x)).toBeNull();
    }
  });
});

describe('AC-ESC-1 plantilla: importacion vieja sin columna', () => {
  it('AC-ESC-1 archivo sin columna de escalas conserva las del existente', () => {
    const existentes = [{ id: 5, codigo: 'A1', nombre: 'Algo', precio: 1000, bultoX: 10, escalasBulto: E }];
    const plan = planificarImportacion([['Código', 'Descripción', 'Precio por unidad', 'Bulto x'], ['A1', 'Algo', '1000', '10']], 'productos', { existentes });
    expect(plan.entradas[0].errores).toEqual([]);
    expect(plan.entradas[0].valor.producto.escalasBulto).toEqual(E);
  });
  it('AC-ESC-1 alta nueva sin columna queda sin escalas', () => {
    const plan = planificarImportacion([['Código', 'Descripción', 'Precio por unidad', 'Bulto x'], ['Z', 'Nuevo', '10', '5']], 'productos', { existentes: [] });
    expect(plan.entradas[0].valor.producto.escalasBulto || []).toEqual([]);
  });
});
