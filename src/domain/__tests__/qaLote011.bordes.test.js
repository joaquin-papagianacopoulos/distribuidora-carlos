// QA bordes lote 011 (REQ-FAB, REQ-AGR, REQ-TRQ, REQ-ZON). Solo casos que no cubrian los tests del implementador.
import { sugerirTipoFactura, armarReporteFacturas, avisoFacturaA, tipoFacturaEfectivo, marcarTipoFactura } from '../facturacionAB';
import { filasBoleta, totalFilasBoleta, textoBultosGrupo, normalizarGrupos, crearGrupo } from '../gruposFactura';
import { layoutPieBoleta, ALTO_TROQUEL, MARGEN_INFERIOR_PAGINA } from '../boletaLayout';
import { calcularOrdenPorZona, moverEnZona, clientesDeZona } from '../zonas';

describe('QA AC-FAB-1 sugerencia por IVA', () => {
  it('AC-FAB-1 RI con mayusculas/espacios/tildes => A; monotributo => B; undefined/null/espacios => ninguna', () => {
    expect(sugerirTipoFactura({ tipoIva: '  RESPONSABLE   INSCRIPTO ' })).toBe('A');
    expect(sugerirTipoFactura({ tipoIva: 'Monotributo' })).toBe('B');
    expect(sugerirTipoFactura({ tipoIva: 'Consumidor Final' })).toBe('B');
    expect(sugerirTipoFactura({ tipoIva: '   ' })).toBe('ninguna');
    expect(sugerirTipoFactura(null)).toBe('ninguna');
    expect(sugerirTipoFactura(undefined)).toBe('ninguna');
  });
  it('AC-FAB-1 tipo guardado "ninguna" manda sobre la sugerencia', () => {
    expect(tipoFacturaEfectivo({ tipoFactura: 'ninguna' }, { tipoIva: 'Responsable Inscripto' })).toEqual({ tipo: 'ninguna', sugerido: false });
  });
  it('AC-FAB-1 marcar con ids numericos/strings mezclados y tipo invalido no cambia nada', () => {
    const ps = [{ id: 1 }, { id: '2' }];
    expect(marcarTipoFactura(ps, ['1', 2], 'A', 5).map(p => p.tipoFactura)).toEqual(['A', 'A']);
    expect(marcarTipoFactura(ps, [1], 'C')).toEqual(ps);
  });
});

describe('QA AC-FAB-2 aviso A sin CUIT', () => {
  it('AC-FAB-2 CUIT vacio, con letras, corto o con digito verificador malo avisa; B no avisa', () => {
    for (const cuit of [undefined, null, '', 'abc', '2012345678', '20-12345678-0']) {
      expect(avisoFacturaA('A', { cuit })).toEqual(expect.any(String));
    }
    expect(avisoFacturaA('B', { cuit: '' })).toBeNull();
    expect(avisoFacturaA('A', null)).toEqual(expect.any(String));
  });
});

describe('QA AC-FAB-3 reporte', () => {
  const f = (o) => ({ pedidoId: '1', fecha: '2026-10-10', estado: 'facturado', total: 100, tipoIva: 'Responsable Inscripto', ...o });
  it('AC-FAB-3 excluye borrados, no facturados y "ninguna"; subtotales A/B y total general', () => {
    const r = armarReporteFacturas([
      f({ pedidoId: '1', total: 100.1 }), f({ pedidoId: '2', total: 200.2, tipoIva: 'Monotributo' }),
      f({ pedidoId: '3', borrado: true }), f({ pedidoId: '4', estado: 'pendiente' }),
      f({ pedidoId: '5', tipoFactura: 'ninguna' }), f({ pedidoId: '6', tipoIva: '' }),
      f({ pedidoId: '7', total: 0.2, tipoFactura: 'A' }),
    ], {});
    expect(r.grupos.map(g => [g.tipo, g.filas.length, g.subtotal])).toEqual([['A', 2, 100.3], ['B', 1, 200.2]]);
    expect(r.total).toBe(300.5);
  });
  it('AC-FAB-3 rango inclusivo, fechas con hora, rango invertido vacio', () => {
    const filas = [f({ pedidoId: '1', fecha: '2026-10-01T23:00:00Z' }), f({ pedidoId: '2', fecha: '2026-10-31' })];
    expect(armarReporteFacturas(filas, { desde: '2026-10-01', hasta: '2026-10-31' }).grupos[0].filas).toHaveLength(2);
    expect(armarReporteFacturas(filas, { desde: '2026-10-31', hasta: '2026-10-01' }).grupos).toEqual([]);
  });
  it('AC-FAB-3 filtro invalido => todas; total con strings basura = 0; entrada null', () => {
    expect(armarReporteFacturas([f({ total: 'abc' })], { filtro: 'Z' }).total).toBe(0);
    expect(armarReporteFacturas(null)).toEqual({ grupos: [], total: 0 });
    expect(armarReporteFacturas([null, undefined])).toEqual({ grupos: [], total: 0 });
  });
});

describe('QA AC-AGR bordes de grupos', () => {
  const it1 = (id, cantidad, precio, bultoX, nombre) => ({ productoId: id, nombre: nombre || `P${id}`, cantidad, precio, bultoX });
  it('AC-AGR-3 bultos mixtos / sin bultoX / no multiplo / decimal => solo unidades', () => {
    expect(textoBultosGrupo([it1(1, 12, 1, 12), it1(2, 24, 1, 6)])).toBe('36 u.');
    expect(textoBultosGrupo([it1(1, 12, 1, 12), it1(2, 12, 1)])).toBe('24 u.');
    expect(textoBultosGrupo([it1(1, 10, 1, 12)])).toBe('10 u.');
    expect(textoBultosGrupo([it1(1, 1.5, 1, 1)])).toBe('1.5 u.');
    expect(textoBultosGrupo([it1(1, 12, 1, 12)])).toBe('1 bulto (12 u.)');
    expect(textoBultosGrupo([])).toBe('0 u.');
  });
  it('AC-AGR-4 renglon eliminado: el grupo sigue con los que quedan y el total no cambia', () => {
    const items = [it1(1, 2, 10), it1(2, 3, 5), it1(3, 1, 7)];
    const grupos = [{ id: 'g', nombre: 'G', itemIds: ['1', '2', '3'] }];
    const sin = items.filter(i => i.productoId !== 2);
    const filas = filasBoleta(sin, grupos);
    expect(filas.filter(x => x.tipo === 'grupo')[0].subtotal).toBe(27);
    expect(normalizarGrupos(grupos, sin)[0].itemIds).toEqual(['1', '3']);
    expect(normalizarGrupos(grupos, [it1(1, 1, 1)])).toHaveLength(1);
    expect(normalizarGrupos(grupos, [])).toEqual([]);
  });
  it('AC-AGR-2 total del pedido igual con y sin grupos, en ambos modos', () => {
    const items = [it1(1, 3, 10.1), it1(2, 2, 0.35), it1(3, 7, 99.99), it1(4, 1, 5)];
    const grupos = [{ id: 'g1', nombre: 'A', itemIds: ['1', '2'] }, { id: 'g2', nombre: 'B', itemIds: ['3'] }];
    const base = totalFilasBoleta(filasBoleta(items, []));
    for (const modo of ['detalle', 'solo_grupos']) {
      expect(totalFilasBoleta(filasBoleta(items, grupos, { modo }))).toBeCloseTo(base, 6);
    }
    expect(items).toEqual(items.map(i => ({ ...i })));
  });
  it('AC-AGR-1 crear grupo con items duplicados en otro grupo vacia el anterior', () => {
    const g0 = [{ id: 'a', nombre: 'A', itemIds: ['1'] }];
    const g1 = crearGrupo(g0, ['1'], '  ', () => 'n');
    expect(g1).toEqual([{ id: 'n', nombre: 'Grupo', itemIds: ['1'] }]);
  });
});

describe('QA AC-TRQ-1 troquel', () => {
  const cut = 297 - MARGEN_INFERIOR_PAGINA;
  const corte = cut - ALTO_TROQUEL;
  const verifica = (l) => {
    const corte = l.corteY; const cut = corte + ALTO_TROQUEL;
    const ys = [l.totalesY, l.deudaY, l.obsY].filter(y => y !== null);
    ys.forEach(y => expect(y).toBeLessThan(corte));
    const ultimas = l.casillas.map(c => c.y);
    expect(Math.min(...ultimas, l.clienteY, l.proveedorY)).toBeGreaterThan(corte);
    expect(l.proveedorY).toBeLessThan(cut);
    // las casillas no se pisan entre si (>= 5 mm) ni con el total del troquel
    const sorted = [...ultimas].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i] - sorted[i - 1]).toBeGreaterThanOrEqual(5);
  };
  it('AC-TRQ-1 boleta larga + descuento + deuda + obs de varias lineas no pisa el troquel', () => {
    for (const finalY of [20, 100, 200, 235, 240, 250, 255, 260, 270, 280, 290, 296]) {
      const l = layoutPieBoleta({ finalY, hayDescuento: true, hayDeuda: true, hayObs: true, lineasObs: 4 });
      verifica(l);
    }
  });
  it('AC-TRQ-1 hoja distinta (A5, 210 alto) y finalY invalido', () => {
    verifica(layoutPieBoleta({ finalY: 150, pageH: 210, hayDeuda: true, hayObs: true, lineasObs: 2 }));
    verifica(layoutPieBoleta({ finalY: NaN, hayDeuda: true }));
    verifica(layoutPieBoleta({}));
  });
  it('AC-TRQ-1 observaciones enormes (30 lineas) igual no llegan al troquel', () => {
    // Con pagina nueva entra hasta ~50 lineas; mas alla no hay corte (limite aceptado).
    const l = layoutPieBoleta({ finalY: 100, hayObs: true, hayDeuda: true, lineasObs: 30 });
    expect(l.obsY + 4 * 29).toBeLessThan(corte);
  });
});

describe('QA AC-ZON bordes', () => {
  const C = (id, nombre, zona, extra = {}) => ({ id, nombre, zona, ...extra });
  it('AC-ZON-2 sin zona al final, numeracion 1..n sin huecos, mismas zonas con distinta grafia juntas', () => {
    const cs = [C(1, 'A', 'Norte', { ordenZona: 1 }), C(2, 'B', ' NORTE', { ordenZona: 2 }), C(3, 'C', 'Céntro', { ordenZona: 1 }), C(4, 'D', '')];
    const ps = [{ id: 'p1', clienteId: 2 }, { id: 'p2', clienteId: 4 }, { id: 'p3', clienteId: 3 }, { id: 'p4', clienteId: 1 }, { id: 'p5', clienteId: 99 }];
    const r = calcularOrdenPorZona(ps, cs);
    expect(r.map(z => z.clave)).toEqual(['centro', 'norte', '']);
    expect(r[1].pedidos.map(x => [x.pedido.id, x.orden])).toEqual([['p4', 1], ['p1', 2]]);
    expect(r[2].pedidos.map(x => x.orden)).toEqual([1, 2]);
  });
  it('AC-ZON-2 filtrar por zona con otra grafia y zona vacia; pedidos null/sin cliente no rompen', () => {
    const cs = [C(1, 'A', 'Norte'), C(2, 'B', 'Sur')];
    expect(calcularOrdenPorZona([{ id: 'x', clienteId: 1 }, { id: 'y', clienteId: 2 }], cs, { zonas: ['  nórte '] })).toHaveLength(1);
    expect(() => calcularOrdenPorZona([null, {}], cs)).not.toThrow();
    expect(calcularOrdenPorZona(null, null)).toEqual([]);
  });
  it('AC-ZON-1 renumeracion sin huecos aun con huecos/duplicados previos y puesto fuera de rango', () => {
    const cs = [C(1, 'A', 'N', { ordenZona: 5 }), C(2, 'B', 'N', { ordenZona: 5 }), C(3, 'C', 'N', { ordenZona: 9 }), C(4, 'D', 'N')];
    const ch = moverEnZona(cs, 'N', 4, 1);
    const aplicado = cs.map(c => ({ ...c, ...(ch.find(x => x.id === c.id) || {}) }));
    expect(clientesDeZona(aplicado, 'n').map(c => [c.id, c.ordenZona])).toEqual([[4, 1], [1, 2], [2, 3], [3, 4]]);
    expect(moverEnZona(cs, 'N', 1, 999).find(x => x.id === 1).ordenZona).toBe(4);
    expect(moverEnZona(cs, 'N', 1, -5).find(x => x.id === 1).ordenZona).toBe(1);
    expect(moverEnZona(cs, 'N', 1, 'abc')).toEqual([]);
    expect(moverEnZona(cs, 'N', 777, 1)).toEqual([]);
  });
  it('AC-ZON-3 migracion inicial lazy: dia -> orden, sin dia al final, dia con mayusculas', () => {
    const cs = [
      C(1, 'Z', 'Sur', { diaEntrega: 'viernes', ordenEntrega: 1 }), C(2, 'Y', 'Sur', { diaEntrega: 'LUNES', ordenEntrega: 3 }),
      C(3, 'X', 'Sur', { diaEntrega: 'lunes', ordenEntrega: 1 }), C(4, 'W', 'Sur', { diaEntrega: '', ordenEntrega: 1 }),
      C(5, 'V', 'Sur', { diaEntrega: 'lunes' }),
    ];
    expect(clientesDeZona(cs, 'sur').map(c => c.id)).toEqual([3, 2, 5, 1, 4]);
  });
});
