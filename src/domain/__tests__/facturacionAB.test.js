// REQ-FAB (AC-FAB-1, 2, 3): facturas A/B, aviso de CUIT y reporte para el contador.
import {
  sugerirTipoFactura, tipoFacturaEfectivo, normalizarTipoFactura, marcarTipoFactura, avisoFacturaA,
  filasTiposFacturaRpc, lotesTiposFactura, interpretarGuardarTiposFactura, interpretarFacturasAEmitir,
  armarReporteFacturas, filaReporteDeRemoto,
} from '../facturacionAB';

describe('AC-FAB-1 sugerirTipoFactura', () => {
  it.each([
    ['Responsable Inscripto', 'A'], ['responsable  inscripto', 'A'], ['Monotributo', 'B'], ['Consumidor Final', 'B'],
    ['Exento', 'B'], ['', 'ninguna'], [null, 'ninguna'], [undefined, 'ninguna'],
  ])('AC-FAB-1 IVA %p => %p', (iva, esp) => expect(sugerirTipoFactura({ tipoIva: iva })).toBe(esp));
  it('AC-FAB-1 sin cliente => ninguna', () => expect(sugerirTipoFactura(null)).toBe('ninguna'));
});

describe('AC-FAB-1 normalizar y efectivo', () => {
  it('AC-FAB-1 rechaza valores raros', () => {
    expect(normalizarTipoFactura('C')).toBeNull();
    expect(normalizarTipoFactura(1)).toBeNull();
    expect(normalizarTipoFactura('a')).toBeNull();
    expect(normalizarTipoFactura('A')).toBe('A');
    expect(normalizarTipoFactura('ninguna')).toBe('ninguna');
  });
  it('AC-FAB-1 guardado manda; si no hay, sugerencia', () => {
    const cli = { tipoIva: 'Responsable Inscripto' };
    expect(tipoFacturaEfectivo({ tipoFactura: 'B' }, cli)).toEqual({ tipo: 'B', sugerido: false });
    expect(tipoFacturaEfectivo({}, cli)).toEqual({ tipo: 'A', sugerido: true });
    expect(tipoFacturaEfectivo({ tipoFactura: 'basura' }, cli)).toEqual({ tipo: 'A', sugerido: true });
  });
});

describe('AC-FAB-1 marcarTipoFactura masivo', () => {
  const ps = [{ id: 1, items: [{ a: 1 }], estado: 'pendiente' }, { id: 2, items: [], estado: 'facturado' }, { id: 3 }];
  it('AC-FAB-1 marca solo los ids y no toca items/estado', () => {
    const r = marcarTipoFactura(ps, [1, 2], 'A', 1000);
    expect(r[0]).toMatchObject({ tipoFactura: 'A', tipoFacturaAt: 1000, tipoFacturaPendiente: true, estado: 'pendiente' });
    expect(r[0].items).toBe(ps[0].items);
    expect(r[1].tipoFactura).toBe('A');
    expect(r[2]).toBe(ps[2]);
    expect(ps[0].tipoFactura).toBeUndefined();
  });
  it('AC-FAB-1 tipo inválido no cambia nada', () => {
    expect(marcarTipoFactura(ps, [1], 'Z')[0]).toBe(ps[0]);
  });
});

describe('AC-FAB-2 avisoFacturaA', () => {
  it('AC-FAB-2 A sin CUIT o inválido avisa', () => {
    expect(avisoFacturaA('A', { cuit: '' })).toMatch(/CUIT/);
    expect(avisoFacturaA('A', { cuit: '11-11111111-1' })).toMatch(/CUIT/);
    expect(avisoFacturaA('A', null)).toMatch(/CUIT/);
  });
  it('AC-FAB-2 CUIT válido o tipo B no avisa', () => {
    expect(avisoFacturaA('A', { cuit: '20-12345678-6' })).toBeNull();
    expect(avisoFacturaA('B', { cuit: '' })).toBeNull();
    expect(avisoFacturaA('ninguna', {})).toBeNull();
  });
});

describe('AC-FAB-1 sync de tipos', () => {
  it('AC-FAB-1 filas solo de pendientes con remoteId', () => {
    const ps = [
      { id: 1, remoteId: 10, tipoFactura: 'A', tipoFacturaAt: 5, tipoFacturaPendiente: true },
      { id: 2, tipoFactura: 'B', tipoFacturaPendiente: true },
      { id: 3, remoteId: 12, tipoFactura: 'B', tipoFacturaPendiente: false },
      { id: 4, remoteId: 13, tipoFactura: 'zzz', tipoFacturaPendiente: true },
    ];
    const f = filasTiposFacturaRpc(ps);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ pedido_id: '10', tipo_factura: 'A' });
  });
  it('AC-FAB-1 lotes de 500', () => {
    expect(lotesTiposFactura(new Array(1001).fill({})).map(l => l.length)).toEqual([500, 500, 1]);
  });
  it('AC-FAB-3 interpretarGuardarTiposFactura', () => {
    expect(interpretarGuardarTiposFactura({ error: { code: 'PGRST202' } }).motivo).toBe('falta_migracion');
    expect(interpretarGuardarTiposFactura({ data: { ok: false, motivo: 'no_autorizado' } }).motivo).toBe('pin_incorrecto');
    expect(interpretarGuardarTiposFactura({ data: null }).motivo).toBe('respuesta_invalida');
    const r = interpretarGuardarTiposFactura({ data: { ok: true, guardados: [10], rechazados: [{ id: 11, motivo: 'pedido_inexistente' }] } });
    expect(r.ok).toBe(true);
    expect(r.guardados).toEqual(['10']);
    expect(r.rechazados).toEqual([{ id: '11', motivo: 'pedido_inexistente' }]);
  });
  it('AC-FAB-3 interpretarFacturasAEmitir', () => {
    expect(interpretarFacturasAEmitir({ error: { message: 'Could not find the function' } }).motivo).toBe('falta_migracion');
    const r = interpretarFacturasAEmitir({ data: { ok: true, filas: [{ pedido_id: 5, fecha: '2026-10-01', total: '100.5', tipo_factura: 'A' }] } });
    expect(r.filas[0]).toMatchObject({ pedidoId: '5', total: 100.5, tipoFactura: 'A' });
  });
});

describe('AC-FAB-3 armarReporteFacturas', () => {
  const f = (o) => filaReporteDeRemoto({ pedido_id: o.id, fecha: o.fecha, cliente_nombre: o.n || 'X', cuit: o.cuit, tipo_iva: o.iva, tipo_factura: o.t, total: o.total });
  const filas = [
    f({ id: 3, fecha: '2026-10-03', total: 300, t: 'B', iva: 'Monotributo' }),
    f({ id: 1, fecha: '2026-10-01', total: 100, t: 'A', iva: 'Responsable Inscripto', cuit: '20123456786' }),
    f({ id: 2, fecha: '2026-10-02', total: 50.25, iva: 'Responsable Inscripto' }),
    f({ id: 4, fecha: '2026-10-02', total: 999, t: 'ninguna' }),
    f({ id: 5, fecha: '2026-09-30', total: 77, t: 'A' }),
    { ...f({ id: 6, fecha: '2026-10-02', total: 10, t: 'A' }), borrado: true },
    { ...f({ id: 7, fecha: '2026-10-02', total: 10, t: 'A' }), estado: 'pendiente' },
    f({ id: 8, fecha: '2026-10-02', total: 5 }),
  ];
  it('AC-FAB-3 agrupa A y B con subtotales y total, filtrando', () => {
    const r = armarReporteFacturas(filas, { desde: '2026-10-01', hasta: '2026-10-31', filtro: 'todas' });
    expect(r.grupos.map(g => g.tipo)).toEqual(['A', 'B']);
    expect(r.grupos[0].filas.map(x => x.pedidoId)).toEqual(['1', '2']);
    expect(r.grupos[0].filas[1].sugerido).toBe(true);
    expect(r.grupos[0].filas[0].cuit).toBe('20-12345678-6');
    expect(r.grupos[0].subtotal).toBe(150.25);
    expect(r.grupos[1].subtotal).toBe(300);
    expect(r.total).toBe(450.25);
  });
  it('AC-FAB-3 filtro A o B', () => {
    const a = armarReporteFacturas(filas, { desde: '2026-10-01', hasta: '2026-10-31', filtro: 'A' });
    expect(a.grupos).toHaveLength(1);
    expect(a.total).toBe(150.25);
    const b = armarReporteFacturas(filas, { desde: '2026-10-01', hasta: '2026-10-31', filtro: 'B' });
    expect(b.total).toBe(300);
  });
  it('AC-FAB-3 vacío', () => {
    expect(armarReporteFacturas([], {})).toEqual({ grupos: [], total: 0 });
    expect(armarReporteFacturas(null, {})).toEqual({ grupos: [], total: 0 });
  });
});

describe('AC-FAB-3 aplicarTiposLocales', () => {
  const { aplicarTiposLocales } = require('../facturacionAB');
  it('AC-FAB-3 lo pendiente local manda sobre lo del servidor; lo demas queda igual', () => {
    const filas = [{ pedidoId: '1', tipoFactura: 'A' }, { pedidoId: '2', tipoFactura: null }, { pedidoId: '3', tipoFactura: 'B' }];
    const r = aplicarTiposLocales(filas, [
      { remoteId: 1, tipoFactura: 'B', tipoFacturaPendiente: true },
      { remoteId: 2, tipoFactura: 'A', tipoFacturaPendiente: true },
      { remoteId: 3, tipoFactura: 'A', tipoFacturaPendiente: false },
    ]);
    expect(r.map(x => x.tipoFactura)).toEqual(['B', 'A', 'B']);
    expect(aplicarTiposLocales(filas, [])).toBe(filas);
    expect(aplicarTiposLocales(null, null)).toEqual([]);
  });
});
