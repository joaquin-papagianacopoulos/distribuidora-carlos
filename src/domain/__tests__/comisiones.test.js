// REQ-COM — funciones puras de src/domain/comisiones.js (AC-COM-1, 3..15).
import {
  CONFIG_COMISIONES, puedeVerComisiones, puedeMarcarEntregado, puedeDesmarcarEntregado,
  marcarEntregado, pedidoEntregaToRemote, pedidoEntregaFromRemote, sinColumnasEntrega, estaEntregado,
  periodoPorDefecto, validarPeriodo, aCentavos, deCentavos, porcentajeValido, calcularComision, repartirComision,
  pedidoIdComision, vendedorDeFicha, vendedorQueCargo, buscarCliente, esCargaDeOtroVendedor,
  asignacionPorDefecto, validarAsignacion, pedidosEnCierresVigentes, renglonesDeCierre, clasificarPedidos,
  armarLinea, calcularAjustesPendientes, calcularAvisos, resumirPorVendedor, armarDashboard, firmaDashboard,
  puedeCerrar, construirCierre, validarAnulacion, cierreToRemote, cierreFromRemote, mezclarCierres,
  claveBorrador, borradorVacio, setAsignacionBorrador, podarBorrador, filasPdfCierre, enRango,
} from '../comisiones';

const VENDEDORES = [
  { id: 1, nombre: 'Jorge', permiso: 1 },
  { id: 2, nombre: 'Carlos', permiso: 2 },
  { id: 3, nombre: 'Lucía', permiso: 2 },
  { id: 4, nombre: 'Ana', permiso: 3 },
];
const CLIENTES = [
  { id: 10, nombre: 'Kiosco Pepe', vendedor: 'Carlos', comision: 5 },
  { id: 11, nombre: 'Almacén Rosa', vendedor: 'Lucía', comision: '7,5' },
  { id: 12, nombre: 'Sin Vendedor SA', vendedor: '', comision: 10 },
  { id: 13, nombre: 'Sin Pct', vendedor: 'Carlos', comision: null },
];
const PERIODO = { desde: '2026-10-01', hasta: '2026-10-31' };
const ped = (o) => ({
  id: o.id ?? 1, remoteId: o.remoteId === undefined ? `R${o.id ?? 1}` : o.remoteId, clienteId: 10, clienteNombre: 'Kiosco Pepe',
  vendedor: 'Carlos', vendedorNombre: 'Carlos', fecha: '2026-10-10', estado: 'facturado', entregado: true, total: 1000, items: [], ...o,
});

describe('AC-COM-2 permisos', () => {
  it.each([[1, true], [2, false], [3, false], ['1', false], [undefined, false], [null, false], [NaN, false]])(
    'AC-COM-2 puedeVerComisiones(%p) => %p', (p, esperado) => { expect(puedeVerComisiones(p)).toBe(esperado); },
  );
});

describe('AC-COM-1 marca de entregado', () => {
  it('AC-COM-1 marcarEntregado setea los 3 campos y no toca estado/items/total', () => {
    const p = ped({ items: [{ productoId: 1, cantidad: 2 }] });
    const r = marcarEntregado({ ...p, entregado: false }, true, '  Ana ', 1000);
    expect(r).toMatchObject({ entregado: true, entregadoAt: 1000, entregadoPor: 'Ana', updatedAt: 1000 });
    expect(r.estado).toBe('facturado');
    expect(r.items).toBe(p.items);
    expect(r.total).toBe(1000);
  });

  it('AC-COM-1 desmarcar limpia fecha y usuario', () => {
    const r = marcarEntregado(ped({ entregadoAt: 5, entregadoPor: 'Ana' }), false, 'Ana', 9);
    expect(r).toMatchObject({ entregado: false, entregadoAt: null, entregadoPor: null });
  });

  it('AC-COM-1 marcarEntregado sin usuario deja entregadoPor null y usa Date.now por defecto', () => {
    const r = marcarEntregado(ped({}), true, '');
    expect(r.entregadoPor).toBeNull();
    expect(typeof r.entregadoAt).toBe('number');
  });

  it('AC-COM-1 puedeMarcarEntregado: admin y armador sobre facturados; no vendedor ni pendientes ni borrados', () => {
    expect(puedeMarcarEntregado(ped({}), 1).ok).toBe(true);
    expect(puedeMarcarEntregado(ped({}), 3).ok).toBe(true);
    expect(puedeMarcarEntregado(ped({}), 2).ok).toBe(false);
    expect(puedeMarcarEntregado(ped({ estado: 'pendiente' }), 1)).toMatchObject({ ok: false, motivo: expect.stringMatching(/facturado/) });
    expect(puedeMarcarEntregado(ped({ borrado: true }), 1).ok).toBe(false);
    expect(puedeMarcarEntregado(ped({ estado: 'cancelado' }), 1).ok).toBe(false);
    expect(puedeMarcarEntregado(null, 1).ok).toBe(false);
  });

  it('AC-COM-1 AC-COM-13 puedeDesmarcarEntregado: si está cerrado solo admin y con confirmación', () => {
    expect(puedeDesmarcarEntregado(ped({ entregado: false }), 1).ok).toBe(false);
    expect(puedeDesmarcarEntregado(ped({}), 3)).toEqual({ ok: true, requiereConfirmacion: false });
    expect(puedeDesmarcarEntregado(ped({}), 2).ok).toBe(false);
    expect(puedeDesmarcarEntregado(ped({}), 1, 'cierre-1')).toEqual({ ok: true, requiereConfirmacion: true });
    expect(puedeDesmarcarEntregado(ped({}), 3, 'cierre-1').ok).toBe(false);
  });

  it('AC-COM-1 pedidoEntregaToRemote mapea a columnas snake_case con ISO', () => {
    expect(pedidoEntregaToRemote({ entregado: true, entregadoAt: Date.UTC(2026, 9, 7), entregadoPor: 'Ana' }))
      .toEqual({ entregado: true, entregado_at: '2026-10-07T00:00:00.000Z', entregado_por: 'Ana' });
    expect(pedidoEntregaToRemote({ entregado: false, entregadoAt: 5, entregadoPor: 'x' }))
      .toEqual({ entregado: false, entregado_at: null, entregado_por: null });
    expect(pedidoEntregaToRemote({ entregado: true, entregadoAt: 'basura' }).entregado_at).toBeNull();
    expect(pedidoEntregaToRemote(undefined)).toEqual({ entregado: false, entregado_at: null, entregado_por: null });
  });

  it('AC-COM-1 sinColumnasEntrega saca solo las columnas nuevas', () => {
    expect(sinColumnasEntrega({ id: 1, estado: 'facturado', entregado: true, entregado_at: 'x', entregado_por: 'y' })).toEqual({ id: 1, estado: 'facturado' });
    expect(sinColumnasEntrega(null)).toEqual({});
  });

  it('AC-COM-1 AC-CLI-5 pedidoEntregaFromRemote: columna inexistente (undefined) conserva lo local', () => {
    const local = { entregado: true, entregadoAt: 77, entregadoPor: 'Ana' };
    expect(pedidoEntregaFromRemote({ id: 'R1' }, local)).toEqual({ entregado: true, entregadoAt: 77, entregadoPor: 'Ana' });
    expect(pedidoEntregaFromRemote({ id: 'R1' }, null)).toEqual({ entregado: false, entregadoAt: null, entregadoPor: null });
    expect(pedidoEntregaFromRemote(null, null)).toEqual({ entregado: false, entregadoAt: null, entregadoPor: null });
  });

  it('AC-COM-1 pedidoEntregaFromRemote: con columnas baja el valor remoto', () => {
    expect(pedidoEntregaFromRemote({ entregado: true, entregado_at: '2026-10-07T00:00:00.000Z', entregado_por: 'Ana' }, { entregado: false }))
      .toEqual({ entregado: true, entregadoAt: Date.UTC(2026, 9, 7), entregadoPor: 'Ana' });
    expect(pedidoEntregaFromRemote({ entregado: false, entregado_at: null, entregado_por: null }, { entregado: true, entregadoAt: 1 }))
      .toEqual({ entregado: false, entregadoAt: null, entregadoPor: null });
    expect(pedidoEntregaFromRemote({ entregado: true, entregado_at: 'no-fecha', entregado_por: null }).entregadoAt).toBeNull();
  });

  it('AC-COM-1 pedidoEntregaFromRemote: marca local sin subir (entregaPendiente) manda sobre el remoto', () => {
    const local = { entregado: true, entregadoAt: 5, entregadoPor: 'Ana', entregaPendiente: true };
    expect(pedidoEntregaFromRemote({ entregado: false, entregado_at: null }, local)).toEqual({ entregado: true, entregadoAt: 5, entregadoPor: 'Ana' });
    expect(pedidoEntregaFromRemote({}, { entregaPendiente: true })).toEqual({ entregado: false, entregadoAt: null, entregadoPor: null });
  });

  it('AC-COM-1 estaEntregado respeta el criterio configurable (entregado / aReparto)', () => {
    expect(estaEntregado({ entregado: true })).toBe(true);
    expect(estaEntregado({ aReparto: true })).toBe(false);
    expect(estaEntregado({ aReparto: true }, { ...CONFIG_COMISIONES, criterioEntregado: 'aReparto' })).toBe(true);
  });
});

describe('AC-COM-3 período', () => {
  it('AC-COM-3 por defecto es el mes en curso (incluye febrero bisiesto y diciembre)', () => {
    expect(periodoPorDefecto(new Date(2026, 9, 7))).toEqual({ desde: '2026-10-01', hasta: '2026-10-31' });
    expect(periodoPorDefecto(new Date(2028, 1, 10))).toEqual({ desde: '2028-02-01', hasta: '2028-02-29' });
    expect(periodoPorDefecto(new Date(2026, 11, 31))).toEqual({ desde: '2026-12-01', hasta: '2026-12-31' });
    expect(periodoPorDefecto().desde).toMatch(/^\d{4}-\d{2}-01$/);
  });

  it('AC-COM-3 validarPeriodo', () => {
    expect(validarPeriodo(PERIODO)).toMatchObject({ ok: true, periodo: PERIODO });
    expect(validarPeriodo({ desde: '2026-10-31', hasta: '2026-10-01' })).toMatchObject({ ok: false, errores: { hasta: expect.any(String) } });
    expect(validarPeriodo({ desde: '2026-02-30', hasta: 'x' }).errores).toMatchObject({ desde: expect.any(String), hasta: expect.any(String) });
    expect(validarPeriodo({ desde: '2025-01-01', hasta: '2026-01-02' }).ok).toBe(false); // 367 días
    expect(validarPeriodo({ desde: '2026-01-01', hasta: '2026-12-31' }).ok).toBe(true);
    expect(validarPeriodo(null).ok).toBe(false);
    expect(validarPeriodo({ desde: '2026-10-05', hasta: '2026-10-05' }).ok).toBe(true);
  });

  it('AC-COM-3 enRango normaliza la fecha con hora y es inclusivo en ambos extremos', () => {
    expect(enRango('2026-10-31T23:00:00', PERIODO)).toBe(true);
    expect(enRango('2026-10-01', PERIODO)).toBe(true);
    expect(enRango('2026-11-01', PERIODO)).toBe(false);
    expect(enRango('', PERIODO)).toBe(false);
  });

  it('AC-COM-3 clasificarPedidos: facturado+entregado+en rango+no cerrado', () => {
    const pedidos = [
      ped({ id: 1 }),
      ped({ id: 2, entregado: false }),
      ped({ id: 3, estado: 'pendiente' }),
      ped({ id: 4, estado: 'eliminado', borrado: true }),
      ped({ id: 5, estado: 'cancelado' }),
      ped({ id: 6, borrado: true }),
      ped({ id: 7, fecha: '2026-10-31T23:00:00' }),
      ped({ id: 8, fecha: '2026-11-01' }),
      ped({ id: 9 }),
      ped({ id: 10, remoteId: null }),
      ped({ id: 11, remoteId: 'R1' }), // duplicado de R1
      ped({ id: 12, estado: 'FACTURADO' }),
    ];
    const r = clasificarPedidos(pedidos, PERIODO, new Map([['R9', 'c1']]));
    expect(r.incluidos.map(p => p.id)).toEqual([1, 7, 12]);
    expect(r.noEntregados.map(p => p.id)).toEqual([2]);
    expect(r.yaCerrados.map(p => p.id)).toEqual([9]);
    expect(r.sinSincronizar.map(p => p.id)).toEqual([10]);
    expect(clasificarPedidos(null, PERIODO)).toEqual({ incluidos: [], noEntregados: [], sinSincronizar: [], yaCerrados: [] });
  });
});

describe('AC-COM-4 AC-COM-15 cálculo de comisión', () => {
  it.each([
    [1000, 5, 50, null],
    [333.33, 7.5, 25, null],
    [1.005, 10, 0.1, null],
    [0.005, 100, 0.01, null],
    [1000, '10,5', 105, null],
    [1000, 0, 0, null],
    [1000, 100, 1000, null],
    ['1.234,50', 10, 123.45, null],
    [1000, null, 0, 'sin_pct'],
    [1000, '', 0, 'sin_pct'],
    [1000, 'abc', 0, 'sin_pct'],
    [1000, 150, 0, 'sin_pct'],
    [1000, -1, 0, 'sin_pct'],
    [NaN, 5, 0, 'total_invalido'],
    [-100, 5, 0, 'total_invalido'],
    ['x', 5, 0, 'total_invalido'],
    [Infinity, 5, 0, 'total_invalido'],
    [null, 5, 0, 'total_invalido'],
  ])('AC-COM-4 AC-COM-15 calcularComision(%p, %p) => %p (%p)', (total, pct, comision, aviso) => {
    expect(calcularComision(total, pct)).toEqual({ comision, aviso });
  });

  it('AC-COM-15 aCentavos / deCentavos / porcentajeValido', () => {
    expect(aCentavos(1.005)).toBe(101);
    expect(aCentavos(-1.005)).toBe(-101);
    expect(aCentavos('12,34')).toBe(1234);
    expect(aCentavos(NaN)).toBeNull();
    expect(aCentavos(Infinity)).toBeNull();
    expect(aCentavos(1e20)).toBeNull();
    expect(deCentavos(-0)).toBe(0);
    expect(deCentavos(1234)).toBe(12.34);
    expect(porcentajeValido('10,5')).toBe(10.5);
    expect(porcentajeValido(101)).toBeNull();
    expect(porcentajeValido(undefined)).toBeNull();
  });
});

describe('AC-COM-7 reparto y asignación', () => {
  const pedA = ped({ vendedor: 'Lucía', vendedorNombre: 'Lucía' }); // cargó Lucía, ficha Carlos
  const cliA = CLIENTES[0];

  it('AC-COM-7 repartirComision: suma exacta al centavo', () => {
    const div = (a, b) => ({ modo: 'dividir', partes: [{ vendedor: 'Carlos', pct: a }, { vendedor: 'Lucía', pct: b }] });
    expect(repartirComision(10, div(50, 50)).map(p => p.monto)).toEqual([5, 5]);
    expect(repartirComision(0.01, div(50, 50)).map(p => p.monto)).toEqual([0.01, 0]);
    expect(repartirComision(100, div(33.33, 66.67)).map(p => p.monto)).toEqual([33.33, 66.67]);
    expect(repartirComision(-10, div(50, 50)).map(p => p.monto)).toEqual([-5, -5]);
    expect(repartirComision(10, { modo: 'ficha', partes: [{ vendedor: 'Carlos', pct: 100 }] })).toEqual([{ vendedor: 'Carlos', pct: 100, monto: 10 }]);
    expect(repartirComision(10, { modo: 'sin_comision', partes: [] })).toEqual([]);
    expect(repartirComision(10, null)).toEqual([]);
    expect(repartirComision('x', div(50, 50))).toEqual([]);
    expect(repartirComision(10, { modo: 'ficha' })).toEqual([]);
  });

  it('AC-COM-7 identidades: pedidoId, ficha, cargador, cliente por id o por nombre', () => {
    expect(pedidoIdComision({ remoteId: 55 })).toBe('55');
    expect(pedidoIdComision({ remoteId: '' })).toBeNull();
    expect(pedidoIdComision(null)).toBeNull();
    expect(vendedorDeFicha({ vendedor: '  Carlos ' })).toBe('Carlos');
    expect(vendedorDeFicha(null)).toBeNull();
    expect(vendedorQueCargo({ vendedor: '', vendedorNombre: 'Lucía' })).toBe('Lucía');
    expect(vendedorQueCargo({})).toBeNull();
    expect(buscarCliente({ clienteId: 11 }, CLIENTES)).toEqual({ cliente: CLIENTES[1], porNombre: false });
    expect(buscarCliente({ clienteId: null, clienteNombre: 'kiosco pepe' }, CLIENTES)).toEqual({ cliente: CLIENTES[0], porNombre: true });
    expect(buscarCliente({ clienteId: 999, clienteNombre: 'Nadie' }, CLIENTES)).toEqual({ cliente: null, porNombre: false });
    expect(buscarCliente({}, null)).toEqual({ cliente: null, porNombre: false });
  });

  it('AC-COM-6 AC-COM-7 esCargaDeOtroVendedor: solo si cargó un vendedor (permiso 2) distinto al de la ficha', () => {
    expect(esCargaDeOtroVendedor(pedA, cliA, VENDEDORES)).toBe(true);
    expect(esCargaDeOtroVendedor(ped({ vendedor: 'CARLOS' }), cliA, VENDEDORES)).toBe(false);
    expect(esCargaDeOtroVendedor(ped({ vendedor: 'Jorge' }), cliA, VENDEDORES)).toBe(false); // admin
    expect(esCargaDeOtroVendedor(ped({ vendedor: 'WEB' }), cliA, VENDEDORES)).toBe(false); // no existe
    expect(esCargaDeOtroVendedor(pedA, CLIENTES[2], VENDEDORES)).toBe(false); // sin ficha
  });

  it('AC-COM-7 asignacionPorDefecto = vendedor de la ficha; ficha inexistente => sin vendedor', () => {
    expect(asignacionPorDefecto(pedA, cliA, VENDEDORES)).toEqual({ modo: 'ficha', partes: [{ vendedor: 'Carlos', pct: 100 }] });
    expect(asignacionPorDefecto(pedA, { vendedor: 'Renombrado' }, VENDEDORES)).toEqual({ modo: null, partes: [] });
    expect(asignacionPorDefecto(pedA, { vendedor: 'Cualquiera' }, [])).toEqual({ modo: 'ficha', partes: [{ vendedor: 'Cualquiera', pct: 100 }] });
  });

  it('AC-COM-7 validarAsignacion: ficha / cargador / dividir 50/50 por defecto', () => {
    const ctx = { pedido: pedA, cliente: cliA, vendedores: VENDEDORES };
    expect(validarAsignacion({ modo: 'ficha' }, ctx).asignacion.partes).toEqual([{ vendedor: 'Carlos', pct: 100 }]);
    expect(validarAsignacion({ modo: 'cargador' }, ctx).asignacion.partes).toEqual([{ vendedor: 'Lucía', pct: 100 }]);
    expect(validarAsignacion({ modo: 'dividir' }, ctx).asignacion.partes).toEqual([{ vendedor: 'Carlos', pct: 50 }, { vendedor: 'Lucía', pct: 50 }]);
    expect(validarAsignacion({ modo: 'dividir', pctFicha: '70', pctCargador: '30' }, ctx).asignacion.partes.map(p => p.pct)).toEqual([70, 30]);
    expect(validarAsignacion({ modo: 'dividir', pctFicha: '33,33', pctCargador: 66.67 }, ctx).ok).toBe(true);
  });

  it.each([
    [{ modo: 'dividir', pctFicha: 60, pctCargador: 50 }, 'suma'],
    [{ modo: 'dividir', pctFicha: 99.99, pctCargador: 0 }, 'suma'],
    [{ modo: 'dividir', pctFicha: 50.005, pctCargador: 49.995 }, 'pctFicha'],
    [{ modo: 'dividir', pctFicha: NaN, pctCargador: 100 }, 'pctFicha'],
    [{ modo: 'dividir', pctFicha: -10, pctCargador: 110 }, 'pctFicha'],
    [{ modo: 'dividir', pctFicha: 50 }, 'pctCargador'],
    [{ modo: 'nada' }, 'modo'],
    [null, 'modo'],
    [{ modo: 'otro', vendedor: 'Fantasma' }, 'vendedor'],
  ])('AC-COM-7 AC-COM-15 validarAsignacion rechaza %o (%s)', (input, campo) => {
    const r = validarAsignacion(input, { pedido: pedA, cliente: cliA, vendedores: VENDEDORES });
    expect(r.ok).toBe(false);
    expect(r.errores[campo]).toEqual(expect.any(String));
    expect(r.asignacion).toBeNull();
  });

  it('AC-COM-7 dividir exige dos vendedores distintos; ficha exige ficha; cargador exige que exista', () => {
    expect(validarAsignacion({ modo: 'dividir' }, { pedido: ped({}), cliente: cliA, vendedores: VENDEDORES }).ok).toBe(false);
    expect(validarAsignacion({ modo: 'ficha' }, { pedido: pedA, cliente: CLIENTES[2], vendedores: VENDEDORES }).ok).toBe(false);
    expect(validarAsignacion({ modo: 'cargador' }, { pedido: ped({ vendedor: 'WEB', vendedorNombre: 'WEB' }), cliente: cliA, vendedores: VENDEDORES }).ok).toBe(false);
    expect(validarAsignacion({ modo: 'ficha' }).ok).toBe(false);
  });

  it('AC-COM-8 cliente sin vendedor: "otro" (de la lista) o "sin comisión" son válidos', () => {
    const ctx = { pedido: pedA, cliente: CLIENTES[2], vendedores: VENDEDORES };
    expect(validarAsignacion({ modo: 'otro', vendedor: 'lucia' }, ctx)).toMatchObject({ ok: true, asignacion: { modo: 'otro', partes: [{ vendedor: 'Lucía', pct: 100 }] } });
    expect(validarAsignacion({ modo: 'sin_comision' }, ctx)).toMatchObject({ ok: true, asignacion: { modo: 'sin_comision', partes: [] } });
  });
});

// ---- Cierres de ejemplo ----
const lineaCerrada = (o) => ({
  tipo: 'pedido', pedidoId: 'R1', fecha: '2026-09-10', clienteId: 10, clienteNombre: 'Kiosco Pepe', total: 1000, pct: 5, comision: 50,
  asignacion: { modo: 'ficha', partes: [{ vendedor: 'Carlos', pct: 100 }] }, partes: [{ vendedor: 'Carlos', pct: 100, monto: 50, total: 1000 }], ajusteSeq: 0, ...o,
});
const cierre = (o) => ({ id: 'c1', estado: 'vigente', desde: '2026-09-01', hasta: '2026-09-30', lineas: [lineaCerrada({})], ...o });

describe('AC-COM-11 pedidos en cierres vigentes', () => {
  it('AC-COM-11 vigentes y pendientes ocupan el pedido; anulados y rechazados no; los ajustes no cuentan', () => {
    const m = pedidosEnCierresVigentes([
      cierre({}),
      cierre({ id: 'c2', estado: 'pendiente', lineas: [lineaCerrada({ pedidoId: 'R2' })] }),
      cierre({ id: 'c3', estado: 'anulado', lineas: [lineaCerrada({ pedidoId: 'R3' })] }),
      cierre({ id: 'c4', estado: 'rechazado', lineas: [lineaCerrada({ pedidoId: 'R4' })] }),
      cierre({ id: 'c5', lineas: [lineaCerrada({ pedidoId: 'R5', tipo: 'ajuste', ajusteSeq: 1 })] }),
      null,
    ]);
    expect([...m.entries()]).toEqual([['R1', 'c1'], ['R2', 'c2']]);
    expect(pedidosEnCierresVigentes(undefined).size).toBe(0);
  });

  it('AC-COM-11 un pedido cerrado no aparece en otro período ni en el mismo', () => {
    const d = armarDashboard({ pedidos: [ped({ id: 1, fecha: '2026-09-10' })], clientes: CLIENTES, vendedores: VENDEDORES, cierres: [cierre({})], periodo: { desde: '2026-09-01', hasta: '2026-12-31' } });
    expect(d.lineas).toHaveLength(0);
    expect(d.yaCerrados).toHaveLength(1);
  });

  it('AC-COM-12 un cierre anulado libera sus pedidos (vuelven a incluidos) y no genera ajustes', () => {
    const d = armarDashboard({ pedidos: [ped({ id: 1, fecha: '2026-09-10', total: 2000 })], clientes: CLIENTES, vendedores: VENDEDORES, cierres: [cierre({ estado: 'anulado' })], periodo: { desde: '2026-09-01', hasta: '2026-09-30' } });
    expect(d.lineas.map(l => l.pedidoId)).toEqual(['R1']);
    expect(d.ajustes).toEqual([]);
  });

  it('AC-COM-16 renglonesDeCierre aplana pedido/ajuste con secuencia', () => {
    expect(renglonesDeCierre(cierre({ lineas: [lineaCerrada({}), lineaCerrada({ tipo: 'ajuste', ajusteSeq: 2, comision: -5, total: -100 })] }))).toEqual([
      { pedidoId: 'R1', tipo: 'pedido', ajusteSeq: 0, total: 1000, comision: 50 },
      { pedidoId: 'R1', tipo: 'ajuste', ajusteSeq: 2, total: -100, comision: -5 },
    ]);
    expect(renglonesDeCierre(null)).toEqual([]);
    expect(renglonesDeCierre({ lineas: [{ pedidoId: 1, tipo: 'ajuste' }] })).toEqual([{ pedidoId: '1', tipo: 'ajuste', ajusteSeq: 0, total: 0, comision: 0 }]);
  });
});

describe('AC-COM-13 ajustes pendientes', () => {
  it('AC-COM-13 total editado de 1000 a 1200 al 5 % => ajuste +10 con el % y la asignación congelados', () => {
    const [a] = calcularAjustesPendientes([ped({ id: 1, total: 1200 })], [cierre({})]);
    expect(a).toMatchObject({ pedidoId: 'R1', ajusteDeCierreId: 'c1', comisionCerrada: 50, comisionActual: 60, diferencia: 10, total: 200, ajusteSeq: 1, pct: 5 });
    expect(a.partes).toEqual([{ vendedor: 'Carlos', pct: 100, monto: 10, total: 200 }]);
  });

  it.each([
    ['revertido a pendiente', { estado: 'pendiente' }],
    ['borrado', { estado: 'eliminado', borrado: true }],
    ['desmarcado como entregado', { entregado: false }],
  ])('AC-COM-13 pedido cerrado %s => ajuste -50', (_l, cambio) => {
    const [a] = calcularAjustesPendientes([ped({ id: 1, ...cambio })], [cierre({})]);
    expect(a).toMatchObject({ diferencia: -50, comisionActual: 0, total: -1000, motivo: 'ya_no_cuenta' });
  });

  it('AC-COM-13 un ajuste ya incluido en otro cierre vigente no reaparece; uno nuevo toma la siguiente secuencia', () => {
    const c2 = cierre({ id: 'c2', desde: '2026-10-01', hasta: '2026-10-31', lineas: [lineaCerrada({ tipo: 'ajuste', ajusteSeq: 1, comision: 10, total: 200 })] });
    expect(calcularAjustesPendientes([ped({ id: 1, total: 1200 })], [cierre({}), c2])).toEqual([]);
    const [a] = calcularAjustesPendientes([ped({ id: 1, total: 1000 })], [cierre({}), c2]);
    expect(a).toMatchObject({ diferencia: -10, ajusteSeq: 2 });
  });

  it('AC-COM-13 sin cambios, sin datos locales, cierre anulado o sin comisión => sin ajuste', () => {
    expect(calcularAjustesPendientes([ped({ id: 1 })], [cierre({})])).toEqual([]);
    expect(calcularAjustesPendientes([], [cierre({})])).toEqual([]);
    expect(calcularAjustesPendientes([ped({ id: 1, total: 5 })], [cierre({ estado: 'anulado' })])).toEqual([]);
    expect(calcularAjustesPendientes([ped({ id: 1, total: 5 })], [cierre({ lineas: [lineaCerrada({ asignacion: { modo: 'sin_comision', partes: [] } })] })])).toEqual([]);
    expect(calcularAjustesPendientes(null, null)).toEqual([]);
  });

  it('AC-COM-13 ajuste de un pedido dividido reparte la diferencia con la misma división', () => {
    const asig = { modo: 'dividir', partes: [{ vendedor: 'Carlos', pct: 50 }, { vendedor: 'Lucía', pct: 50 }] };
    const [a] = calcularAjustesPendientes([ped({ id: 1, total: 1100 })], [cierre({ lineas: [lineaCerrada({ asignacion: asig })] })]);
    expect(a.partes.map(p => p.monto)).toEqual([2.5, 2.5]);
  });

  it('AC-COM-13 ordena ajustes por fecha y pedido; sin asignación congelada no reparte', () => {
    const cs = [cierre({ lineas: [lineaCerrada({ pedidoId: 'R2', fecha: '2026-09-20', asignacion: undefined }), lineaCerrada({ pedidoId: 'R1', fecha: '2026-09-20' })] })];
    const r = calcularAjustesPendientes([ped({ id: 1, remoteId: 'R1', total: 0 }), ped({ id: 2, remoteId: 'R2', total: 0 }), ped({ id: 3, remoteId: 'R2' })], cs);
    expect(r.map(a => a.pedidoId)).toEqual(['R1', 'R2']);
    expect(r[1].partes).toEqual([]);
  });
});

describe('AC-COM-5 AC-COM-6 dashboard, avisos y resumen por vendedor', () => {
  const pedidos = [
    ped({ id: 1, total: 1000 }), // Kiosco (Carlos 5 %)
    ped({ id: 2, total: 2000, clienteId: 11, clienteNombre: 'Almacén Rosa', vendedor: 'Lucía' }), // Lucía 7,5 %
    ped({ id: 3, total: 1000, vendedor: 'Lucía', vendedorNombre: 'Lucía' }), // (a): Kiosco cargado por Lucía
    ped({ id: 4, total: 500, clienteId: 12, clienteNombre: 'Sin Vendedor SA' }), // (b)
    ped({ id: 5, total: 800, clienteId: 13, clienteNombre: 'Sin Pct' }), // (c)
    ped({ id: 6, total: 999, entregado: false }), // (d)
    ped({ id: 7, total: 100, remoteId: null }), // sin sincronizar
    ped({ id: 8, total: 'abc', clienteId: 10 }), // monto inválido
  ];

  it('AC-COM-6 avisos (a)(b)(c)(d) con contadores', () => {
    const d = armarDashboard({ pedidos, clientes: CLIENTES, vendedores: VENDEDORES, cierres: [], borrador: null, periodo: PERIODO });
    expect(d.avisos.contadores).toEqual({ a: 1, b: 1, c: 1, d: 1, sinSincronizar: 1, montoInvalido: 1, total: 6 });
    expect(d.avisos.cargadoPorOtro.map(l => l.pedidoId)).toEqual(['R3']);
    expect(d.avisos.clienteSinVendedor).toEqual([{ clienteId: 12, clienteNombre: 'Sin Vendedor SA', pedidos: 1 }]);
    expect(d.avisos.clienteSinPct[0].clienteNombre).toBe('Sin Pct');
    expect(d.avisos.noEntregados.map(p => p.id)).toEqual([6]);
  });

  it('AC-COM-5 resumen por vendedor: pedidos, clientes, total vendido y comisión con detalle cliente → pedido', () => {
    const d = armarDashboard({ pedidos, clientes: CLIENTES, vendedores: VENDEDORES, cierres: [], borrador: null, periodo: PERIODO });
    const carlos = d.resumenPorVendedor.find(v => v.vendedor === 'Carlos');
    // Carlos: R1 (1000 → 50), R3 (1000 → 50, ficha por defecto), R5 (800 sin % → 0), R8 (monto inválido → 0)
    expect(carlos).toMatchObject({ pedidos: 4, clientes: 2, totalVendido: 2800, totalComision: 100 });
    expect(carlos.detalle.map(c => c.clienteNombre)).toEqual(['Kiosco Pepe', 'Sin Pct']);
    expect(carlos.detalle[0].pedidos.map(p => p.pedidoId)).toEqual(['R1', 'R3', 'R8']);
    const lucia = d.resumenPorVendedor.find(v => v.vendedor === 'Lucía');
    expect(lucia).toMatchObject({ pedidos: 1, clientes: 1, totalVendido: 2000, totalComision: 150 });
    expect(d.totales).toMatchObject({ pedidos: 6, clientes: 4, totalVendido: 5300, totalComision: 250, ajustes: 0 });
  });

  it('AC-COM-5 AC-COM-7 pedido dividido cuenta 1 pedido para cada vendedor y reparte vendido y comisión', () => {
    const borrador = setAsignacionBorrador(null, PERIODO, 'R3', { modo: 'dividir', pctFicha: '50', pctCargador: '50' }, 1);
    const d = armarDashboard({ pedidos: [ped({ id: 3, total: 1000, vendedor: 'Lucía' })], clientes: CLIENTES, vendedores: VENDEDORES, cierres: [], borrador, periodo: PERIODO });
    expect(d.resumenPorVendedor.map(v => [v.vendedor, v.pedidos, v.clientes, v.totalVendido, v.totalComision])).toEqual([
      ['Carlos', 1, 1, 500, 25], ['Lucía', 1, 1, 500, 25],
    ]);
    expect(d.totales.totalComision).toBe(50);
  });

  it('AC-COM-5 resumen incluye ajustes (sin contarlos como pedido ni cliente nuevo)', () => {
    const d = armarDashboard({ pedidos: [ped({ id: 1, total: 1200, fecha: '2026-09-10' })], clientes: CLIENTES, vendedores: VENDEDORES, cierres: [cierre({})], periodo: PERIODO });
    expect(d.lineas).toEqual([]);
    expect(d.resumenPorVendedor).toEqual([expect.objectContaining({ vendedor: 'Carlos', pedidos: 0, clientes: 0, totalComision: 10, totalVendido: 200 })]);
    expect(d.resumenPorVendedor[0].detalle[0].pedidos[0]).toMatchObject({ tipo: 'ajuste', ajusteSeq: 1, ajusteDeCierreId: 'c1' });
    expect(d.totales).toMatchObject({ ajustes: 1, totalAjustes: 10 });
  });

  it('AC-COM-3 período inválido => dashboard vacío y no se puede cerrar', () => {
    const d = armarDashboard({ pedidos, clientes: CLIENTES, vendedores: VENDEDORES, cierres: [], periodo: { desde: 'x', hasta: '2026-10-01' } });
    expect(d.periodoValido).toBe(false);
    expect(d.lineas).toEqual([]);
    expect(puedeCerrar(d).motivos).toContain('El período no es válido');
  });

  it('AC-COM-6 calcularAvisos tolera listas vacías', () => {
    expect(calcularAvisos(undefined).contadores.total).toBe(0);
    expect(calcularAvisos([], null, null).noEntregados).toEqual([]);
  });

  it('AC-COM-5 resumirPorVendedor sin líneas => []', () => {
    expect(resumirPorVendedor(undefined, undefined)).toEqual([]);
    expect(resumirPorVendedor([{ tipo: 'pedido', partes: [] }])).toEqual([]);
  });

  it('AC-COM-4 armarLinea: cliente sin % => comisión 0 y aviso; total inválido => 0', () => {
    expect(armarLinea(ped({ clienteId: 13 }), { clientes: CLIENTES, vendedores: VENDEDORES })).toMatchObject({ comision: 0, aviso: 'sin_pct', pct: null });
    expect(armarLinea(ped({ total: -5 }), { clientes: CLIENTES, vendedores: VENDEDORES })).toMatchObject({ comision: 0, total: 0, aviso: 'total_invalido' });
    expect(armarLinea(ped({ clienteId: null, clienteNombre: 'Desconocido' }), {})).toMatchObject({ clienteNombre: 'Desconocido', sinVendedor: true, aviso: 'sin_pct' });
  });
});

describe('AC-COM-8 AC-COM-10 cierre', () => {
  const pedidos = [ped({ id: 1, total: 1000 }), ped({ id: 4, total: 500, clienteId: 12, clienteNombre: 'Sin Vendedor SA' })];

  it('AC-COM-8 bloquea mientras haya clientes sin vendedor sin asignar; se libera con "otro" o "sin comisión"', () => {
    const d0 = armarDashboard({ pedidos, clientes: CLIENTES, vendedores: VENDEDORES, cierres: [], periodo: PERIODO });
    expect(puedeCerrar(d0)).toMatchObject({ ok: false, motivos: [expect.stringMatching(/sin vendedor/)] });
    const b1 = setAsignacionBorrador(null, PERIODO, 'R4', { modo: 'otro', vendedor: 'Lucía' }, 1);
    expect(puedeCerrar(armarDashboard({ pedidos, clientes: CLIENTES, vendedores: VENDEDORES, cierres: [], borrador: b1, periodo: PERIODO })).ok).toBe(true);
    const b2 = setAsignacionBorrador(null, PERIODO, 'R4', { modo: 'sin_comision' }, 1);
    const d2 = armarDashboard({ pedidos, clientes: CLIENTES, vendedores: VENDEDORES, cierres: [], borrador: b2, periodo: PERIODO });
    expect(puedeCerrar(d2).ok).toBe(true);
    expect(d2.lineas.find(l => l.pedidoId === 'R4').partes).toEqual([]);
  });

  it('AC-COM-8 asignación inválida en el borrador, sin sincronizar o nada para cerrar también bloquean', () => {
    const b = setAsignacionBorrador(null, PERIODO, 'R1', { modo: 'dividir', pctFicha: 10, pctCargador: 10 }, 1);
    const d = armarDashboard({ pedidos: [ped({ id: 1, vendedor: 'Lucía' }), ped({ id: 2, remoteId: null })], clientes: CLIENTES, vendedores: VENDEDORES, cierres: [], borrador: b, periodo: PERIODO });
    const m = puedeCerrar(d).motivos.join(' | ');
    expect(m).toMatch(/inválida/);
    expect(m).toMatch(/sin sincronizar/);
    expect(d.lineas[0].asignacionErrores).toMatchObject({ suma: expect.any(String) });
    const vacio = armarDashboard({ pedidos: [], clientes: CLIENTES, vendedores: VENDEDORES, cierres: [], periodo: PERIODO });
    expect(puedeCerrar(vacio).motivos).toEqual(['No hay pedidos ni ajustes para cerrar en este período']);
    expect(puedeCerrar(null).ok).toBe(false);
  });

  it('AC-COM-10 construirCierre: UUID, período, fecha, admin y detalle vendedor → cliente → pedido congelado', () => {
    const b = setAsignacionBorrador(null, PERIODO, 'R4', { modo: 'otro', vendedor: 'Lucía' }, 1);
    const d = armarDashboard({ pedidos, clientes: CLIENTES, vendedores: VENDEDORES, cierres: [], borrador: b, periodo: PERIODO });
    const c = construirCierre(d, { admin: 'Jorge', now: new Date(Date.UTC(2026, 10, 1)), genId: () => 'uuid-1' });
    expect(c).toMatchObject({ id: 'uuid-1', desde: '2026-10-01', hasta: '2026-10-31', cerradoPor: 'Jorge', cerradoAt: Date.UTC(2026, 10, 1), estado: 'pendiente' });
    expect(c.totales.porVendedor).toEqual([
      { vendedor: 'Carlos', pedidos: 1, clientes: 1, totalVendido: 1000, totalComision: 50 },
      { vendedor: 'Lucía', pedidos: 1, clientes: 1, totalVendido: 500, totalComision: 50 },
    ]);
    expect(c.detalle[1]).toMatchObject({ vendedor: 'Lucía', clientes: [{ clienteNombre: 'Sin Vendedor SA', pedidos: [expect.objectContaining({ pedidoId: 'R4', total: 500, pct: 10, comision: 50, asignacion: 'otro' })] }] });
    expect(c.lineas.map(l => [l.pedidoId, l.tipo, l.ajusteSeq])).toEqual([['R1', 'pedido', 0], ['R4', 'pedido', 0]]);
    // Congelado: mutar el dashboard no cambia el cierre.
    d.resumenPorVendedor[0].totalComision = 999;
    d.lineas[0].asignacion.partes[0].vendedor = 'Otro';
    expect(c.totales.porVendedor[0].totalComision).toBe(50);
    expect(c.lineas[0].asignacion.partes[0].vendedor).toBe('Carlos');
  });

  it('AC-COM-10 construirCierre incluye ajustes con su secuencia y usa nuevoId por defecto', () => {
    const d = armarDashboard({ pedidos: [ped({ id: 1, total: 1200, fecha: '2026-09-10' })], clientes: CLIENTES, vendedores: VENDEDORES, cierres: [cierre({})], periodo: PERIODO });
    const c = construirCierre(d, { admin: 'Jorge', now: 5 });
    expect(c.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(c.cerradoAt).toBe(5);
    expect(c.lineas).toEqual([expect.objectContaining({ tipo: 'ajuste', pedidoId: 'R1', ajusteSeq: 1, ajusteDeCierreId: 'c1', comision: 10, comisionCerrada: 50, comisionActual: 60 })]);
  });

  it('AC-COM-10 construirCierre tira si no se puede cerrar o falta el admin', () => {
    const vacio = armarDashboard({ pedidos: [], clientes: [], vendedores: [], cierres: [], periodo: PERIODO });
    expect(() => construirCierre(vacio, { admin: 'Jorge' })).toThrow(/No hay pedidos/);
    const d = armarDashboard({ pedidos: [ped({ id: 1 })], clientes: CLIENTES, vendedores: VENDEDORES, cierres: [], periodo: PERIODO });
    expect(() => construirCierre(d, { admin: '  ' })).toThrow(/admin/);
    expect(() => construirCierre(d)).toThrow(/admin/);
  });

  it('AC-COM-10 firmaDashboard cambia si cambia un total', () => {
    const d1 = armarDashboard({ pedidos: [ped({ id: 1 })], clientes: CLIENTES, vendedores: VENDEDORES, cierres: [], periodo: PERIODO });
    const d2 = armarDashboard({ pedidos: [ped({ id: 1, total: 1001 })], clientes: CLIENTES, vendedores: VENDEDORES, cierres: [], periodo: PERIODO });
    expect(firmaDashboard(d1)).toBe(firmaDashboard(armarDashboard({ pedidos: [ped({ id: 1 })], clientes: CLIENTES, vendedores: VENDEDORES, cierres: [], periodo: PERIODO })));
    expect(firmaDashboard(d1)).not.toBe(firmaDashboard(d2));
    expect(firmaDashboard(null)).toBe('{"l":[],"a":[]}');
  });
});

describe('AC-COM-12 anulación', () => {
  it('AC-COM-12 motivo obligatorio (3..300), solo vigente, registra quién y cuándo', () => {
    expect(validarAnulacion(cierre({}), 'Error en el % de un cliente', 'Jorge', 9)).toEqual({
      ok: true, errores: {}, patch: { estado: 'anulado', anuladoAt: 9, anuladoPor: 'Jorge', motivoAnulacion: 'Error en el % de un cliente' },
    });
    expect(validarAnulacion(cierre({}), '', 'Jorge').errores.motivo).toBeDefined();
    expect(validarAnulacion(cierre({}), '   ', 'Jorge').errores.motivo).toBeDefined();
    expect(validarAnulacion(cierre({}), 'ab', 'Jorge').errores.motivo).toBeDefined();
    expect(validarAnulacion(cierre({}), 'x'.repeat(301), 'Jorge').errores.motivo).toMatch(/300/);
    expect(validarAnulacion(cierre({}), 'motivo ok', '').errores.usuario).toBeDefined();
    expect(validarAnulacion(cierre({ estado: 'anulado' }), 'motivo ok', 'Jorge').errores.estado).toBeDefined();
    expect(validarAnulacion(cierre({ anulacionPendiente: { por: 'x' } }), 'motivo ok', 'Jorge').errores.estado).toMatch(/en curso/);
    expect(validarAnulacion(null, 'motivo ok', 'Jorge').ok).toBe(false);
    expect(typeof validarAnulacion(cierre({}), 'motivo ok', 'Jorge').patch.anuladoAt).toBe('number');
  });
});

describe('AC-COM-16 mapeo remoto de cierres', () => {
  const c = {
    ...cierre({}), cerradoAt: Date.UTC(2026, 9, 1), cerradoPor: 'Jorge', estado: 'pendiente',
    totales: { totalVendido: 1000, totalComision: 50, porVendedor: [] }, detalle: [{ vendedor: 'Carlos' }],
  };

  it('AC-COM-16 cierreToRemote arma p_cierre y p_renglones para la RPC', () => {
    const r = cierreToRemote(c);
    expect(r.p_cierre).toMatchObject({ id: 'c1', desde: '2026-09-01', hasta: '2026-09-30', cerrado_at: '2026-10-01T00:00:00.000Z', cerrado_por: 'Jorge', total_vendido: 1000, total_comision: 50 });
    expect(r.p_renglones).toEqual([{ pedido_id: 'R1', tipo: 'pedido', ajuste_seq: 0, total: 1000, comision: 50, pct: 5, sin_comision: false }]);
    expect(cierreToRemote({ id: 'x' }).p_cierre).toMatchObject({ total_vendido: 0, totales: {}, detalle: [], lineas: [], cerrado_at: null });
  });

  it('AC-COM-16 cierreFromRemote / mezclarCierres no pisan locales pendientes', () => {
    const remoto = { id: 'c1', desde: '2026-09-01', hasta: '2026-09-30', cerrado_at: '2026-10-01T00:00:00Z', cerrado_por: 'Jorge', estado: 'anulado', anulado_at: '2026-10-02T00:00:00Z', anulado_por: 'Jorge', motivo_anulacion: 'mal', totales: { a: 1 }, detalle: [], lineas: [lineaCerrada({})], updated_at: '2026-10-02T00:00:00Z' };
    expect(cierreFromRemote(remoto)).toMatchObject({ id: 'c1', estado: 'anulado', cerradoAt: Date.parse('2026-10-01T00:00:00Z'), anuladoAt: Date.parse('2026-10-02T00:00:00Z'), motivoAnulacion: 'mal', pendingSync: false, anulacionPendiente: null });
    expect(cierreFromRemote({ id: 5, estado: 'raro', detalle: 'x' }, { lineas: [1] })).toMatchObject({ id: '5', estado: 'vigente', detalle: [], lineas: [1], cerradoAt: null, cerradoPor: '' });
    expect(cierreFromRemote({ id: 5, estado: 'vigente', cerrado_at: 'no' }, { anulacionPendiente: { por: 'x' } }).anulacionPendiente).toEqual({ por: 'x' });
    const locales = [{ id: 'c1', pendingSync: true }, { id: 'c2', anulacionPendiente: {} }, { id: 'c3' }];
    const m = mezclarCierres(locales, [{ id: 'c1' }, { id: 'c2' }, { id: 'c3', estado: 'vigente' }, { id: 'c4', estado: 'vigente' }]);
    expect(m.map(x => x.id)).toEqual(['c3', 'c4']);
    expect(mezclarCierres(null, null)).toEqual([]);
  });
});

describe('AC-COM-9 borrador del período', () => {
  it('AC-COM-9 claveBorrador y setAsignacionBorrador (sanea, reemplaza y quita)', () => {
    expect(claveBorrador(PERIODO)).toBe('periodo:2026-10-01:2026-10-31');
    expect(borradorVacio(PERIODO)).toEqual({ id: 'periodo:2026-10-01:2026-10-31', desde: '2026-10-01', hasta: '2026-10-31', asignaciones: {}, updatedAt: null });
    let b = setAsignacionBorrador(null, PERIODO, 'R3', { modo: 'dividir', pctFicha: 60, pctCargador: '40', extra: 'x' }, 7);
    expect(b.asignaciones).toEqual({ R3: { modo: 'dividir', pctFicha: '60', pctCargador: '40' } });
    expect(b.updatedAt).toBe(7);
    b = setAsignacionBorrador(b, PERIODO, 'R4', { modo: 'hack', vendedor: 'Lucía\u0000' }, 8);
    expect(b.asignaciones.R4).toEqual({ modo: null, vendedor: 'Lucía' });
    b = setAsignacionBorrador(b, PERIODO, 'R3', null, 9);
    expect(Object.keys(b.asignaciones)).toEqual(['R4']);
    // Otro período: arranca vacío
    const otro = setAsignacionBorrador(b, { desde: '2026-11-01', hasta: '2026-11-30' }, 'R9', { modo: 'ficha' });
    expect(Object.keys(otro.asignaciones)).toEqual(['R9']);
  });

  it('AC-COM-9 podarBorrador ignora asignaciones de pedidos que ya no están', () => {
    const b = { id: 'x', asignaciones: { R1: { modo: 'ficha' }, R2: { modo: 'ficha' } } };
    expect(podarBorrador(b, ['R2']).asignaciones).toEqual({ R2: { modo: 'ficha' } });
    expect(podarBorrador(null, [])).toBeNull();
    expect(podarBorrador({ id: 'y' }, null).asignaciones).toEqual({});
  });

  it('AC-COM-9 una asignación del borrador de un pedido que ya no está no rompe el dashboard', () => {
    const b = setAsignacionBorrador(null, PERIODO, 'R999', { modo: 'sin_comision' }, 1);
    const d = armarDashboard({ pedidos: [ped({ id: 1 })], clientes: CLIENTES, vendedores: VENDEDORES, cierres: [], borrador: b, periodo: PERIODO });
    expect(d.lineas).toHaveLength(1);
    expect(d.lineas[0].asignacion.modo).toBe('ficha');
  });
});

describe('AC-COM-14 filas del PDF del cierre', () => {
  it('AC-COM-14 resumen por vendedor + total + detalle; marca ANULADO', () => {
    const b = setAsignacionBorrador(null, PERIODO, 'R3', { modo: 'dividir' }, 1);
    const d = armarDashboard({ pedidos: [ped({ id: 1 }), ped({ id: 3, vendedor: 'Lucía' })], clientes: CLIENTES, vendedores: VENDEDORES, cierres: [], borrador: b, periodo: PERIODO });
    const c = construirCierre(d, { admin: 'Jorge', now: new Date(2026, 10, 1), genId: () => 'abcdef12-0000' });
    const f = filasPdfCierre(c);
    expect(f.titulo).toBe('Cierre de comisiones 01/10/2026 al 31/10/2026');
    expect(f.subtitulo).toMatch(/Cerrado por Jorge/);
    expect(f.anulado).toBeNull();
    expect(f.resumen.map(r => r[0])).toEqual(['Carlos', 'Lucía', 'TOTAL']);
    expect(f.resumen[2][4]).toMatch(/100,00/);
    expect(f.detalle).toHaveLength(3);
    expect(f.detalle.some(r => r[6] === 'Dividido 50 %')).toBe(true);
    expect(f.filename).toBe('comisiones_2026-10-01_2026-10-31.pdf');
    const an = filasPdfCierre({ ...c, estado: 'anulado', anuladoPor: 'Jorge', motivoAnulacion: 'Error' });
    expect(an.anulado).toBe('ANULADO por Jorge: Error');
    expect(an.filename).toMatch(/_ANULADO\.pdf$/);
  });

  it('AC-COM-14 tolera un cierre incompleto y ajustes', () => {
    const f = filasPdfCierre(null);
    expect(f.resumen).toEqual([['TOTAL', '', '', '$ 0,00', '$ 0,00']]);
    expect(f.detalle).toEqual([]);
    const g = filasPdfCierre({ estado: 'anulado', detalle: [{ vendedor: 'C', clientes: [{ clienteNombre: 'K', pedidos: [{ tipo: 'ajuste', pedidoId: 'R1', pct: null, total: -1, comision: -1 }] }] }] });
    expect(g.detalle[0]).toEqual(['C', 'K', 'Ajuste #R1', '', '$ -1,00', '-', '-', '$ -1,00']);
    expect(g.anulado).toBe('ANULADO por -: ');
  });
});
