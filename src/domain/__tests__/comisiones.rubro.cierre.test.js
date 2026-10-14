// REQ-COMR (RUN 20261014-1449): cierre con modelo 'rubro' (AC-COMR-13), PDF,
// mapeo con el servidor y bloqueos (AC-COMR-7/8).
import {
  armarDashboard, construirCierre, cierreToRemote, cierreFromRemote, modeloDeCierre, filasPdfCierre, firmaDashboard, puedeCerrar,
} from '../comisiones';

const PERIODO = { desde: '2026-10-01', hasta: '2026-10-31' };
const VENDEDORES = [{ id: 1, remoteId: 'u-ana', nombre: 'Ana', permiso: 2 }, { id: 2, remoteId: 'u-beto', nombre: 'Beto', permiso: 2 }];
const CLIENTES = [{ id: 10, nombre: 'Kiosco', vendedor: 'Ana' }];
const PRODUCTOS = [{ id: 'g', categoria: 'Golosinas' }, { id: 'b', categoria: 'Bebidas' }];
const TABLA = [
  { id: 't1', vendedorId: 'u-ana', rubro: 'Golosinas', pct: 5 },
  { id: 't2', vendedorId: 'u-ana', rubro: 'Bebidas', pct: 10 },
  { id: 't3', vendedorId: 'u-beto', rubro: 'Golosinas', pct: 3 },
];
const ped = (o) => ({ id: 1, remoteId: 'R1', clienteId: 10, clienteNombre: 'Kiosco', vendedor: 'Beto', fecha: '2026-10-10', estado: 'facturado', entregado: true, total: 1500, items: [{ productoId: 'g', precio: 1000, cantidad: 1 }, { productoId: 'b', precio: 500, cantidad: 1 }], ...o });
const dash = (over = {}) => armarDashboard({
  pedidos: [ped({})], clientes: CLIENTES, vendedores: VENDEDORES, cierres: [], periodo: PERIODO,
  borrador: { asignaciones: { R1: { modo: 'dividir' } } }, modelo: 'rubro', productos: PRODUCTOS, tablaRubros: TABLA, ...over,
});
const cerrar = (d = dash()) => construirCierre(d, { admin: 'Jorge', genId: () => 'c1', now: new Date(Date.UTC(2026, 10, 1)) });

describe('AC-COMR-13 cierre con el modelo por rubro', () => {
  it('AC-COMR-13 construirCierre congela modelo, vendedorId y desglose por rubro de cada parte', () => {
    const c = cerrar();
    expect(c.modelo).toBe('rubro');
    expect(modeloDeCierre(c)).toBe('rubro');
    const l = c.lineas[0];
    expect(l).toMatchObject({ modelo: 'rubro', tipo: 'pedido', pedidoId: 'R1', total: 1500, pct: null, comision: 65, ajusteSeq: 0 });
    expect(l.partes).toEqual([
      {
        vendedor: 'Ana', vendedorId: 'u-ana', pct: 50, monto: 50, total: 750,
        desglose: [
          { rubro: 'Bebidas', rubroClave: 'bebidas', subtotal: 500, pct: 10, comision: 25 },
          { rubro: 'Golosinas', rubroClave: 'golosinas', subtotal: 1000, pct: 5, comision: 25 },
        ],
      },
      {
        vendedor: 'Beto', vendedorId: 'u-beto', pct: 50, monto: 15, total: 750,
        desglose: [
          { rubro: 'Bebidas', rubroClave: 'bebidas', subtotal: 500, pct: null, comision: 0 },
          { rubro: 'Golosinas', rubroClave: 'golosinas', subtotal: 1000, pct: 3, comision: 15 },
        ],
      },
    ]);
    // el detalle por vendedor (historial / PDF) también lleva el desglose
    expect(c.detalle.find(v => v.vendedor === 'Ana').clientes[0].pedidos[0]).toMatchObject({ modelo: 'rubro', vendedorId: 'u-ana', comisionPedido: null });
    expect(c.totales).toMatchObject({ totalVendido: 1500, totalComision: 65 });
    // una línea congelada no viaja con datos de pantalla (avisos, borrador)
    expect(l).not.toHaveProperty('avisosRubro');
    expect(l).not.toHaveProperty('asignacionConfirmada');
  });

  it('AC-COMR-13 cierreToRemote: renglones con modelo y partes {vendedor_id, pct, monto}; pct null', () => {
    const r = cierreToRemote(cerrar());
    expect(r.p_cierre.modelo).toBe('rubro');
    expect(r.p_renglones).toEqual([{
      pedido_id: 'R1', tipo: 'pedido', ajuste_seq: 0, total: 1500, comision: 65, pct: null, sin_comision: false, modelo: 'rubro',
      partes: [{ vendedor_id: 'u-ana', pct: 50, monto: 50 }, { vendedor_id: 'u-beto', pct: 50, monto: 15 }],
    }]);
    // sin vendorId (no debería pasar: puedeCerrar lo bloquea) viaja null y el servidor lo rechaza
    const c = cerrar();
    c.lineas[0].partes[0].vendedorId = null;
    c.lineas[0].partes[1].monto = undefined;
    expect(cierreToRemote(c).p_renglones[0].partes).toEqual([{ vendedor_id: null, pct: 50, monto: 50 }, { vendedor_id: 'u-beto', pct: 50, monto: 0 }]);
    const sinPartes = { ...cerrar(), lineas: [{ ...cerrar().lineas[0], partes: undefined }] };
    expect(cierreToRemote(sinPartes).p_renglones[0].partes).toEqual([]);
  });

  it('AC-COMR-13 el cierre legacy (modelo cliente) se manda idéntico a antes', () => {
    const legacy = armarDashboard({ pedidos: [ped({})], clientes: [{ ...CLIENTES[0], comision: 5 }], vendedores: VENDEDORES, cierres: [], periodo: PERIODO });
    const c = construirCierre(legacy, { admin: 'Jorge', genId: () => 'c0', now: 0 });
    expect(c).not.toHaveProperty('modelo');
    expect(modeloDeCierre(c)).toBe('cliente');
    const r = cierreToRemote(c);
    expect(r.p_cierre).not.toHaveProperty('modelo');
    expect(r.p_renglones).toEqual([{ pedido_id: 'R1', tipo: 'pedido', ajuste_seq: 0, total: 1500, comision: 75, pct: 5, sin_comision: false }]);
  });

  it('AC-COMR-13 cierreFromRemote / modeloDeCierre: sin campo => cliente; con modelo rubro (en el cierre o en una línea) => rubro', () => {
    expect(cierreFromRemote({ id: 'x', estado: 'vigente', lineas: [] })).not.toHaveProperty('modelo');
    expect(cierreFromRemote({ id: 'x', estado: 'vigente', modelo: 'rubro', lineas: [] }).modelo).toBe('rubro');
    expect(modeloDeCierre(cierreFromRemote({ id: 'x', modelo: 'cliente', lineas: [] }))).toBe('cliente');
    expect(modeloDeCierre({ lineas: [{ modelo: 'rubro' }] })).toBe('rubro');
    expect(modeloDeCierre({ lineas: 'raro' })).toBe('cliente');
    expect(modeloDeCierre(null)).toBe('cliente');
  });
});

describe('AC-COMR-13 PDF del cierre', () => {
  it('AC-COMR-13 cierre por rubro: detalle con Rubro y Subtotal, una fila por (vendedor, pedido, rubro)', () => {
    const f = filasPdfCierre({ ...cerrar(), estado: 'vigente' });
    expect(f.headDetalle).toEqual(['Vendedor', 'Cliente', 'Pedido', 'Fecha', 'Rubro', 'Subtotal', '%', 'Comisión']);
    expect(f.headResumen).toEqual(['Vendedor', 'Pedidos', 'Clientes', 'Total vendido', 'Comisión']);
    expect(f.detalle).toHaveLength(4);
    expect(f.detalle[0]).toEqual(['Ana', 'Kiosco', '#R1 (50 %)', '10/10/2026', 'Bebidas', '$ 500,00', '10 %', '$ 25,00']);
    expect(f.detalle[3]).toEqual(['Beto', 'Kiosco', '#R1 (50 %)', '10/10/2026', 'Golosinas', '$ 1.000,00', '3 %', '$ 15,00']);
    expect(f.detalle[2][6]).toBe('-'); // Beto sin % en Bebidas
    expect(f.detalle.flat().every(c => typeof c === 'string')).toBe(true);
    expect(f.filename).toBe('comisiones_2026-10-01_2026-10-31.pdf');
  });

  it('AC-COMR-13 ajuste de una base vieja dentro de un cierre por rubro: Rubro "-"; desglose con "Sin rubro"; anulado', () => {
    const c = {
      id: 'c9', modelo: 'rubro', estado: 'anulado', anuladoPor: 'Jorge', motivoAnulacion: 'error', desde: '2026-11-01', hasta: '2026-11-30',
      totales: { porVendedor: [] },
      detalle: [{ vendedor: 'Ana', clientes: [{ clienteNombre: 'Kiosco', pedidos: [
        { tipo: 'ajuste', pedidoId: 'R7', fecha: '2026-10-05', total: 200, pct: 5, comision: 10, asignacion: 'ficha' },
        { tipo: 'pedido', modelo: 'rubro', pedidoId: 'R8', fecha: '2026-11-02', total: 30, comision: 0, desglose: [{ rubro: '', subtotal: 30, pct: null, comision: 0 }] },
      ] }] }],
    };
    const f = filasPdfCierre(c);
    expect(f.detalle[0]).toEqual(['Ana', 'Kiosco', 'Ajuste #R7', '05/10/2026', '-', '$ 200,00', '5 %', '$ 10,00']);
    expect(f.detalle[1][4]).toBe('Sin rubro');
    expect(f.anulado).toMatch(/ANULADO por Jorge/);
    expect(f.filename).toMatch(/_ANULADO\.pdf$/);
    expect(filasPdfCierre({ modelo: 'rubro', detalle: 'x' }).detalle).toEqual([]);
  });
});

describe('AC-COMR-7 AC-COMR-9 firma y bloqueos', () => {
  it('AC-COMR-9 firmaDashboard cambia si cambia un % de la tabla (y no si no cambia nada)', () => {
    const f1 = firmaDashboard(dash());
    expect(firmaDashboard(dash())).toBe(f1);
    const otra = TABLA.map(t => (t.id === 't3' ? { ...t, pct: 4 } : t));
    expect(firmaDashboard(dash({ tablaRubros: otra }))).not.toBe(f1);
  });

  it('AC-COMR-14 firmaDashboard incluye las partes de los ajustes por rubro', () => {
    const c = { ...cerrar(), estado: 'vigente' };
    const base = { pedidos: [ped({ total: 2500, items: [{ productoId: 'g', precio: 2000, cantidad: 1 }, { productoId: 'b', precio: 500, cantidad: 1 }] })], clientes: CLIENTES, vendedores: VENDEDORES, cierres: [c], periodo: { desde: '2026-11-01', hasta: '2026-11-30' }, modelo: 'rubro', productos: PRODUCTOS, tablaRubros: TABLA };
    const d = armarDashboard(base);
    expect(d.ajustes).toHaveLength(1);
    expect(JSON.parse(firmaDashboard(d)).a[0][3]).toEqual([['Ana', 25, 'u-ana'], ['Beto', 15, 'u-beto']]);
  });

  it('AC-COMR-8 puedeCerrar no deja cerrar con un vendedor sin remoteId, con la 005 faltante ni con % pendientes', () => {
    const sinId = dash({ vendedores: [{ id: 1, nombre: 'Ana', permiso: 2 }, ...VENDEDORES.slice(1)] });
    const chk = puedeCerrar(sinId);
    expect(chk.ok).toBe(false);
    expect(chk.motivos[0]).toMatch(/vendedor sin sincronizar/);
    expect(() => construirCierre(sinId, { admin: 'Jorge' })).toThrow(/sincronizá los vendedores/);
    expect(puedeCerrar(dash({ faltaMigracion005: true })).ok).toBe(false);
    expect(puedeCerrar(dash({ pendientesRubro: 1 })).ok).toBe(false);
    expect(puedeCerrar(dash()).ok).toBe(true);
  });
});
