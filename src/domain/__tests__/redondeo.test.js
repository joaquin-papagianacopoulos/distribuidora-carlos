import {
  redondearTotal, normalizarMultiplo, aplicarRedondeoPedido, totalACobrar, desgloseTotalRemito,
  alFacturar, alRevertirPendiente, recalcularRedondeoCongelado, redondeoToRemote, redondeoFromRemote, sinColumnas025, nombraColumna025,
} from '../redondeo';
import { baseRubrosPedido, pedidoNetoParaComision } from '../comisiones';

describe('AC-RED-2 redondearTotal', () => {
  it.each([
    [0, 500, 0],
    [1249, 500, 1000],
    [1250, 500, 1500], // mitad exacta para arriba
    [1500, 1000, 2000], // mitad exacta para arriba
    [1499, 1000, 1000],
    [-250, 500, 0], // mitad exacta para arriba tambien en negativos
    [-251, 500, -500],
    [1249.99, 500, 1000],
    [1250.01, 500, 1500],
    [12345, 0, 12345],
    [12345.678, 0, 12345.68],
  ])('AC-RED-2 %p a %p => %p', (t, m, esp) => expect(redondearTotal(t, m)).toBe(esp));

  it('AC-RED-2 sin redondeo con multiplo undefined/invalido y no finito => 0', () => {
    expect(redondearTotal(1234.5, undefined)).toBe(1234.5);
    expect(redondearTotal(1234.5, 'x')).toBe(1234.5);
    expect(redondearTotal(1234.5, 300)).toBe(1234.5);
    expect(redondearTotal(NaN, 500)).toBe(0);
    expect(redondearTotal(Infinity, 500)).toBe(0);
    expect(redondearTotal(undefined, 500)).toBe(0);
  });
});

describe('AC-RED-1 normalizarMultiplo', () => {
  it('AC-RED-1 default 500 y valores validos', () => {
    expect(normalizarMultiplo(undefined)).toBe(500);
    expect(normalizarMultiplo(null)).toBe(500);
    expect(normalizarMultiplo('x')).toBe(500);
    expect(normalizarMultiplo(0)).toBe(0);
    expect(normalizarMultiplo('1000')).toBe(1000);
  });
});

describe('AC-RED-2 pedido', () => {
  it('AC-RED-2 aplicarRedondeoPedido no muta y guarda el ajuste', () => {
    const p = { total: 1260 };
    expect(aplicarRedondeoPedido(p, 500)).toEqual({ redondeo: 240, redondeoMultiplo: 500, totalRedondeado: 1500 });
    expect(p).toEqual({ total: 1260 });
    expect(aplicarRedondeoPedido({ total: 1240 }, 500)).toEqual({ redondeo: -240, redondeoMultiplo: 500, totalRedondeado: 1000 });
    expect(aplicarRedondeoPedido({ total: 1240 }, 0)).toEqual({ redondeo: 0, redondeoMultiplo: 0, totalRedondeado: 1240 });
  });
  it('AC-RED-2 si el redondeo dejaria un pedido > 0 en $0 no se redondea', () => {
    expect(aplicarRedondeoPedido({ total: 200 }, 500)).toEqual({ redondeo: 0, redondeoMultiplo: 500, totalRedondeado: 200 });
    expect(aplicarRedondeoPedido({ total: 0 }, 500).totalRedondeado).toBe(0);
  });
  it('AC-RED-2 alFacturar congela el multiplo y es idempotente', () => {
    const f = alFacturar({ total: 1260, estado: 'facturado' }, 500);
    expect(f).toMatchObject({ redondeo: 240, redondeoMultiplo: 500, totalRedondeado: 1500 });
    // cambia el ajuste: el pedido ya congelado no cambia de multiplo
    expect(alFacturar(f, 1000).redondeoMultiplo).toBe(500);
    // editar items recalcula con SU multiplo congelado
    expect(alFacturar({ ...f, total: 1010 }, 1000)).toMatchObject({ redondeoMultiplo: 500, totalRedondeado: 1000, redondeo: -10 });
  });
  it('AC-RED-2 recalcularRedondeoCongelado solo toca pedidos con multiplo congelado', () => {
    const f = alFacturar({ total: 1260 }, 500);
    expect(recalcularRedondeoCongelado({ ...f, total: 2010 })).toMatchObject({ redondeo: -10, totalRedondeado: 2000, redondeoMultiplo: 500 });
    const legacy = { total: 2010, estado: 'facturado' };
    expect(recalcularRedondeoCongelado(legacy)).toBe(legacy);
    const pend = { total: 2010, redondeoMultiplo: null };
    expect(recalcularRedondeoCongelado(pend)).toBe(pend);
  });
  it('AC-RED-2 alRevertirPendiente limpia las 3 claves y re-facturar usa el ajuste vigente', () => {
    const f = alFacturar({ total: 1260 }, 500);
    const p = alRevertirPendiente(f);
    expect(p).toMatchObject({ redondeo: null, redondeoMultiplo: null, totalRedondeado: null });
    expect(alFacturar(p, 1000)).toMatchObject({ redondeoMultiplo: 1000, totalRedondeado: 1000 });
  });
  it('AC-RED-2 totalACobrar: legacy facturado, congelado y vista previa de pendiente', () => {
    expect(totalACobrar({ total: 1260, estado: 'facturado' })).toBe(1260); // pedido facturado antes: no se recalcula
    expect(totalACobrar({ total: 1260, estado: 'facturado' }, { multiploVistaPrevia: 500 })).toBe(1260);
    expect(totalACobrar({ total: 1260, estado: 'facturado', redondeoMultiplo: 500 })).toBe(1500);
    // una app vieja edita el total y deja el redondeo viejo: se deriva del multiplo congelado
    expect(totalACobrar({ total: 1010, estado: 'facturado', redondeoMultiplo: 500, redondeo: 240 })).toBe(1000);
    expect(totalACobrar({ total: 1260, estado: 'pendiente' })).toBe(1260);
    expect(totalACobrar({ total: 1260, estado: 'pendiente' }, { multiploVistaPrevia: 500 })).toBe(1500);
    expect(totalACobrar(null)).toBe(0);
  });
  it('AC-RED-2 desgloseTotalRemito: subtotal, redondeo y total', () => {
    expect(desgloseTotalRemito({ total: 1260, redondeoMultiplo: 500 })).toEqual({ subtotal: 1260, redondeo: 240, total: 1500 });
    expect(desgloseTotalRemito({ total: 1260, estado: 'facturado' })).toEqual({ subtotal: 1260, redondeo: 0, total: 1260 });
  });
  it('AC-RED-2 las comisiones se calculan sobre los renglones (no cambian con el redondeo)', () => {
    const base = { id: 'p1', estado: 'facturado', entregado: true, vendedor: 'Ana', clienteNombre: 'C', fecha: '2026-11-01', total: 1260,
      items: [{ productoId: 1, nombre: 'X', cantidad: 1, precio: 1260 }] };
    const conRed = { ...base, ...aplicarRedondeoPedido(base, 500) };
    const productosById = new Map();
    expect(JSON.stringify(baseRubrosPedido(conRed, productosById))).toBe(JSON.stringify(baseRubrosPedido(base, productosById)));
    const neto = (p) => { const n = pedidoNetoParaComision(p, []); return { total: n.total, items: n.items }; };
    expect(neto(conRed)).toEqual(neto(base));
    expect(conRed.total).toBe(1260); // total = suma de renglones; el redondeado va aparte
    expect(conRed.totalRedondeado).toBe(1500);
  });
});

describe('AC-RED-2 sync 025 tolerante', () => {
  it('AC-RED-2 toRemote solo manda las claves conocidas', () => {
    expect(redondeoToRemote({})).toEqual({});
    expect(redondeoToRemote(null)).toEqual({});
    expect(redondeoToRemote({ redondeo: 240, redondeoMultiplo: 500, totalRedondeado: 1500 }))
      .toEqual({ redondeo: 240, redondeo_multiplo: 500, total_redondeado: 1500 });
    expect(redondeoToRemote({ redondeo: null, redondeoMultiplo: null, totalRedondeado: null }))
      .toEqual({ redondeo: null, redondeo_multiplo: null, total_redondeado: null });
  });
  it('AC-RED-2 fromRemote conserva lo local si la columna no existe y sanea', () => {
    const local = { redondeo: 240, redondeoMultiplo: 500, totalRedondeado: 1500 };
    expect(redondeoFromRemote({}, local)).toEqual(local);
    expect(redondeoFromRemote({}, undefined)).toEqual({});
    expect(redondeoFromRemote({ redondeo: '10', redondeo_multiplo: 1000, total_redondeado: '1010' }, null))
      .toEqual({ redondeo: 10, redondeoMultiplo: 1000, totalRedondeado: 1010 });
    expect(redondeoFromRemote({ redondeo_multiplo: 7 }, null)).toEqual({}); // invalido sin local: no se agrega
    expect(redondeoFromRemote({ redondeo_multiplo: 7 }, { redondeoMultiplo: 500 })).toEqual({ redondeoMultiplo: 500 });
    // null remoto sobre un valor local = revertido a pendiente
    expect(redondeoFromRemote({ redondeo: null, redondeo_multiplo: null, total_redondeado: null }, local))
      .toEqual({ redondeo: null, redondeoMultiplo: null, totalRedondeado: null });
    // null remoto sin clave local: no se agregan claves
    expect(redondeoFromRemote({ redondeo: null, redondeo_multiplo: null, total_redondeado: null }, {})).toEqual({});
  });
  it('AC-RED-2 sinColumnas025 y nombraColumna025', () => {
    expect(sinColumnas025({ a: 1, redondeo: 1, redondeo_multiplo: 500, total_redondeado: 2 })).toEqual({ a: 1 });
    expect(nombraColumna025({ message: "Could not find the 'redondeo' column of 'pedidos' in the schema cache" })).toBe(true);
    expect(nombraColumna025({ message: 'column "total_redondeado" does not exist' })).toBe(true);
    expect(nombraColumna025({ message: 'column "grupos" does not exist' })).toBe(false);
  });
});
