// REQ-ESC (AC-ESC-1, AC-ESC-2, AC-ESC-4): escalas de bultos, funciones puras.
import {
  normalizarEscalasBulto, escalaAlcanzada, aplicarDescuentoEscala, precioConEscala, precioAplicado,
  precioAplicadoRenglon, esPrecioManual, precioBaseRenglon, totalesBoleta, completarPreciosBulto,
  precioMinimoRenglon, etiquetaEscala, validarEscalasBulto, escalasATexto, parsearEscalasTexto,
} from '../precios';
import { CASOS_ESCALAS } from '../__fixtures__/escalasCasos';

describe('AC-ESC-4 fixture compartido cliente/servidor', () => {
  it.each(CASOS_ESCALAS.map(c => [c.id, c]))('AC-ESC-4 caso %s', (_n, c) => {
    const prod = { precio: c.precio, precioBulto: c.precioBulto, bultoX: c.bultoX, escalasBulto: c.escalas };
    const r = precioConEscala(prod, c.cantidad);
    expect(r.precio).toBe(c.esperado);
    expect(r.escala ? r.escala.desde : null).toBe(c.escala);
    // sin escala, el resultado es la base PBU
    if (!r.escala) expect(r.precio).toBe(c.base);
  });
});

describe('AC-ESC-4 normalizarEscalasBulto', () => {
  it('AC-ESC-4 acepta JSON en texto y descarta lo que no es lista', () => {
    expect(normalizarEscalasBulto('[{"desde":5,"pct":8}]')).toEqual([{ desde: 5, pct: 8 }]);
    expect(normalizarEscalasBulto('basura')).toEqual([]);
    expect(normalizarEscalasBulto(null)).toEqual([]);
    expect(normalizarEscalasBulto({})).toEqual([]);
  });
  it('AC-ESC-4 ignora las invalidas una a una sin romper', () => {
    expect(normalizarEscalasBulto([null, 3, { desde: 5, pct: 8 }, { desde: 4, pct: 9 }, { desde: 7, pct: 'x' }, { desde: 8, pct: 10 }]))
      .toEqual([{ desde: 5, pct: 8 }, { desde: 8, pct: 10 }]);
  });
  it('AC-ESC-4 corta en 3', () => {
    expect(normalizarEscalasBulto([2, 3, 4, 5].map((d, i) => ({ desde: d, pct: i + 1 })))).toHaveLength(3);
  });
});

describe('AC-ESC-2 escalaAlcanzada / aplicarDescuentoEscala', () => {
  it('AC-ESC-2 cuenta solo bultos completos', () => {
    const e = [{ desde: 5, pct: 8 }];
    expect(escalaAlcanzada(e, 10, 49)).toBeNull();
    expect(escalaAlcanzada(e, 10, 50)).toEqual({ desde: 5, pct: 8 });
    expect(escalaAlcanzada(e, 1, 500)).toBeNull();
  });
  it('AC-ESC-2 redondea para arriba al peso entero (sin error de float)', () => {
    expect(aplicarDescuentoEscala(815, 8)).toBe(750);
    expect(aplicarDescuentoEscala(800, 8)).toBe(736);
    expect(aplicarDescuentoEscala(1000, 7.5)).toBe(925);
    expect(aplicarDescuentoEscala(0.1, 10)).toBe(1);
  });
});

describe('AC-ESC-4 precioAplicado con y sin escala', () => {
  it('AC-ESC-4 sin escalas conserva el shape {precio, porBulto}', () => {
    expect(precioAplicado({ precio: 900, precioBulto: 800, bultoX: 16 }, 16)).toEqual({ precio: 800, porBulto: true });
  });
  it('AC-ESC-4 con escala agrega escala', () => {
    const r = precioAplicado({ precio: 1000, precioBulto: 0, bultoX: 10, escalasBulto: [{ desde: 5, pct: 8 }] }, 60);
    expect(r).toEqual({ precio: 920, porBulto: false, escala: { desde: 5, pct: 8, bultos: 6 } });
  });
});

const renglon = (over = {}) => ({
  productoId: 1, nombre: 'X', precio: 1000, precioOriginal: 1000, cantidad: 10,
  precioBultoX: 10, escalasBulto: [{ desde: 5, pct: 8 }], ...over,
});

describe('AC-ESC-2 precioAplicadoRenglon', () => {
  it('AC-ESC-2 sube y baja de escala con lo congelado', () => {
    const arriba = precioAplicadoRenglon(renglon(), 50);
    expect(arriba).toMatchObject({ precio: 920, escalaDesde: 5, escalaPct: 8 });
    const abajo = precioAplicadoRenglon(arriba, 40);
    expect(abajo.precio).toBe(1000);
    expect(abajo.escalaPct).toBeUndefined();
    expect(abajo.escalaDesde).toBeUndefined();
  });
  it('AC-ESC-2 no confia en escalaPct que traiga el renglon', () => {
    const r = precioAplicadoRenglon(renglon({ escalaPct: 50, escalaDesde: 2, precio: 1000 }), 10);
    expect(r.escalaPct).toBeUndefined();
  });
  it('AC-ESC-2 respeta el precio manual (AC-PBU-3)', () => {
    const m = renglon({ precio: 900, precioManual: true });
    expect(precioAplicadoRenglon(m, 50)).toBe(m);
    const d = renglon({ precio: 900, descuentoPct: 10 });
    expect(precioAplicadoRenglon(d, 50)).toBe(d);
    const t = renglon({ precio: 950 });
    expect(precioAplicadoRenglon(t, 50)).toBe(t);
  });
  it('AC-ESC-2 convive con precio de bulto', () => {
    const r = precioAplicadoRenglon(renglon({ precioBultoOriginal: 800, precioPorBulto: false }), 50);
    expect(r).toMatchObject({ precio: 736, precioPorBulto: true, escalaPct: 8 });
  });
  it('AC-ESC-2 renglon legacy sin escalas ni precio de bulto no cambia', () => {
    const l = { precio: 100, precioOriginal: 100, cantidad: 5 };
    expect(precioAplicadoRenglon(l, 500)).toBe(l);
  });
  it('AC-ESC-2 las escalas del renglon quedan congeladas', () => {
    const r = precioAplicadoRenglon(renglon({ escalasBulto: [{ desde: 5, pct: 8 }] }), 50);
    expect(r.escalasBulto).toEqual([{ desde: 5, pct: 8 }]);
  });
});

describe('AC-ESC-2 esPrecioManual / precioBaseRenglon / totalesBoleta', () => {
  it('AC-ESC-2 el precio con escala no es manual', () => {
    const r = precioAplicadoRenglon(renglon(), 50);
    expect(esPrecioManual(r)).toBe(false);
    expect(esPrecioManual({ ...r, precio: 900 })).toBe(true);
  });
  it('AC-ESC-3 la escala no cuenta como descuento en el total', () => {
    const r = { ...precioAplicadoRenglon(renglon(), 50), cantidad: 50 };
    expect(precioBaseRenglon(r)).toBe(920);
    const t = totalesBoleta([r]);
    expect(t.total).toBe(46000);
    expect(t.descuento).toBe(0);
  });
  it('AC-ESC-3 el descuento manual si cuenta', () => {
    const r = { ...renglon({ precio: 828, descuentoPct: 10, escalaDesde: 5, escalaPct: 8 }), cantidad: 50 };
    expect(totalesBoleta([r]).descuento).toBeGreaterThan(0);
  });
});

describe('AC-ESC-2 completarPreciosBulto con escalas', () => {
  const prod = { precio: 1000, precioBulto: 0, bultoX: 10, escalasBulto: [{ desde: 5, pct: 8 }] };
  it('AC-ESC-2 congela las escalas aunque no haya precio de bulto', () => {
    const r = completarPreciosBulto({ productoId: 1, precio: 1000, cantidad: 50 }, prod);
    expect(r).toMatchObject({ precio: 920, precioBultoX: 10, escalasBulto: [{ desde: 5, pct: 8 }], escalaPct: 8 });
    expect(r.precioBultoOriginal).toBeUndefined();
  });
  it('AC-ESC-2 si el renglon ya trae escalas no toca', () => {
    const it = { productoId: 1, precio: 1000, precioOriginal: 1000, cantidad: 50, escalasBulto: [{ desde: 9, pct: 1 }], precioBultoX: 10 };
    expect(completarPreciosBulto(it, prod)).toBe(it);
  });
});

describe('AC-ESC-2 precioMinimoRenglon / etiquetaEscala', () => {
  it('AC-ESC-2 piso con la mayor escala', () => {
    expect(precioMinimoRenglon({ precioOriginal: 1000, precioBultoOriginal: 800, precioBultoX: 10, escalasBulto: [{ desde: 5, pct: 8 }, { desde: 10, pct: 12 }] })).toBe(704);
    expect(precioMinimoRenglon({ precioOriginal: 1000, precioBultoOriginal: 0, precioBultoX: 10, escalasBulto: [] })).toBe(1000);
  });
  it('AC-ESC-3 etiqueta con signo menos en pantalla y guion ASCII en PDF', () => {
    expect(etiquetaEscala({ escalaDesde: 5, escalaPct: 8 })).toBe('x5 bultos −8 %');
    expect(etiquetaEscala({ escalaDesde: 5, escalaPct: 7.5 }, { pdf: true })).toBe('x5 bultos -7,5 %');
    expect(etiquetaEscala({ precio: 1 })).toBeNull();
  });
});

describe('AC-ESC-1 validarEscalasBulto y texto', () => {
  const fila = (d, p) => ({ desde: d, pct: p });
  it('AC-ESC-1 filas vacias se ignoran', () => {
    expect(validarEscalasBulto([fila('', ''), fila('', '')], 10)).toEqual({ valor: [], errores: [], avisos: [] });
  });
  it('AC-ESC-1 acepta coma decimal y %', () => {
    expect(validarEscalasBulto([fila('5', '7,5'), fila('10', '12%')], 10).valor).toEqual([{ desde: 5, pct: 7.5 }, { desde: 10, pct: 12 }]);
  });
  it.each([
    ['fila a medias', [fila('5', '')]],
    ['desde 1', [fila('1', '5')]],
    ['desde decimal', [fila('2,5', '5')]],
    ['pct 0', [fila('5', '0')]],
    ['pct 100', [fila('5', '100')]],
    ['pct 3 decimales', [fila('5', '1,234')]],
    ['no creciente', [fila('5', '5'), fila('5', '8')]],
    ['mas de 3', [fila('2', '1'), fila('3', '2'), fila('4', '3'), fila('5', '4')]],
  ])('AC-ESC-1 error: %s', (_n, filas) => {
    expect(validarEscalasBulto(filas, 10).errores.length).toBeGreaterThan(0);
  });
  it('AC-ESC-1 exige Bulto x mayor a 1', () => {
    expect(validarEscalasBulto([fila('5', '8')], 1).errores).toEqual(['Las escalas necesitan Bulto x mayor a 1']);
  });
  it('AC-ESC-1 descuento que no crece es aviso, no error', () => {
    const r = validarEscalasBulto([fila('5', '10'), fila('8', '8')], 10);
    expect(r.errores).toEqual([]);
    expect(r.avisos).toHaveLength(1);
  });
  it('AC-ESC-1 texto de escalas viejas en % ida y vuelta (con "%")', () => {
    const t = escalasATexto([{ desde: 5, pct: 8 }, { desde: 10, pct: 7.5 }]);
    expect(t).toBe('5=8%; 10=7,5%');
    expect(validarEscalasBulto(parsearEscalasTexto(t), 10).valor).toEqual([{ desde: 5, pct: 8 }, { desde: 10, pct: 7.5 }]);
    expect(parsearEscalasTexto('5:8|10:12')).toEqual([{ desde: '5', valor: '8' }, { desde: '10', valor: '12' }]);
  });
  it('AC-ESC2-2 texto 3=950; 10=900,5 ida y vuelta (precio directo)', () => {
    const t = escalasATexto([{ desde: 3, precio: 950 }, { desde: 10, precio: 900.5 }]);
    expect(t).toBe('3=950; 10=900,5');
    expect(validarEscalasBulto(parsearEscalasTexto(t), 10).valor).toEqual([{ desde: 3, precio: 950 }, { desde: 10, precio: 900.5 }]);
  });
});

describe('REQ-ESC2 escalas con precio directo', () => {
  const prod = { precio: 1000, precioBulto: 0, bultoX: 10, escalasBulto: [{ desde: 3, precio: 950 }, { desde: 10, precio: 899.5 }] };

  it('AC-ESC2-1 normalizarEscalasBulto acepta precio y descarta precios invalidos', () => {
    expect(normalizarEscalasBulto([{ desde: 3, precio: 950 }, { desde: 10, precio: 899.5 }])).toEqual([{ desde: 3, precio: 950 }, { desde: 10, precio: 899.5 }]);
    expect(normalizarEscalasBulto([{ desde: 3, precio: 0 }, { desde: 4, precio: -5 }, { desde: 5, precio: '950' }, { desde: 6, precio: 1.234 }, { desde: 7, precio: NaN }])).toEqual([]);
    // precio valido manda sobre el %; precio invalido cae al % si lo hay.
    expect(normalizarEscalasBulto([{ desde: 3, precio: 950, pct: 8 }])).toEqual([{ desde: 3, precio: 950 }]);
    expect(normalizarEscalasBulto([{ desde: 3, precio: 0, pct: 8 }])).toEqual([{ desde: 3, pct: 8 }]);
  });

  it('AC-ESC2-1 con 3 bultos o mas cobra el precio cargado, sin redondear; antes, el precio normal', () => {
    expect(precioConEscala(prod, 29)).toEqual({ precio: 1000, porBulto: false });
    expect(precioConEscala(prod, 30)).toEqual({ precio: 950, porBulto: false, escala: { desde: 3, precio: 950, bultos: 3 } });
    expect(precioConEscala(prod, 100).precio).toBe(899.5);
  });

  it('AC-ESC2-1 un precio de escala que no baja el precio no se aplica', () => {
    expect(precioConEscala({ ...prod, precioBulto: 900, escalasBulto: [{ desde: 3, precio: 950 }] }, 30)).toEqual({ precio: 900, porBulto: true });
  });

  it('AC-ESC2-1 el renglon guarda escalaDesde/escalaPrecio, no es manual y se re-precia al cambiar la cantidad', () => {
    const item = { productoId: 1, cantidad: 10, precio: 1000, precioOriginal: 1000, precioBultoX: 10, escalasBulto: prod.escalasBulto };
    const con = precioAplicadoRenglon({ ...item, cantidad: 30 }, 30);
    expect(con).toMatchObject({ precio: 950, escalaDesde: 3, escalaPrecio: 950 });
    expect(con.escalaPct).toBeUndefined();
    expect(esPrecioManual(con)).toBe(false);
    expect(precioBaseRenglon(con)).toBe(950);
    expect(etiquetaEscala(con)).toBe('x3 bultos');
    const sin = precioAplicadoRenglon({ ...con, cantidad: 10 }, 10);
    expect(sin.precio).toBe(1000);
    expect(sin.escalaDesde).toBeUndefined();
    expect(sin.escalaPrecio).toBeUndefined();
  });

  it('AC-ESC2-1 pedido web (solo escalaDesde, escalaPct null): el precio sale de las escalas congeladas', () => {
    const web = { productoId: 1, cantidad: 30, precio: 950, precioOriginal: 1000, precioBultoX: 10, escalasBulto: prod.escalasBulto, escalaDesde: 3, escalaPct: null };
    expect(esPrecioManual(web)).toBe(false);
    expect(etiquetaEscala(web)).toBe('x3 bultos');
  });

  it('AC-ESC2-2 validarEscalasBulto: precio invalido es error; precio que no baja o sospechosamente bajo es aviso', () => {
    expect(validarEscalasBulto([{ desde: '3', valor: 'abc' }], 10).errores).toHaveLength(1);
    expect(validarEscalasBulto([{ desde: '3', valor: '0' }], 10).errores).toHaveLength(1);
    expect(validarEscalasBulto([{ desde: '3', valor: '950' }, { desde: '10', valor: '960' }], 10).avisos).toHaveLength(1);
    expect(validarEscalasBulto([{ desde: '3', valor: '1100' }], 10, 1000).avisos[0]).toMatch(/no se va a aplicar/);
    expect(validarEscalasBulto([{ desde: '3', valor: '8' }], 10, 1000).avisos[0]).toMatch(/menos de la mitad/);
    expect(validarEscalasBulto([{ desde: '3', valor: '950' }], 10, 1000)).toEqual({ valor: [{ desde: 3, precio: 950 }], errores: [], avisos: [] });
  });
});
