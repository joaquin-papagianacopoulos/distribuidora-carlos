// REQ-COM AC-COM-17 — confirmar la asignación de un pedido en el borrador.
import {
  armarDashboard, armarLinea, calcularAvisos, puedeCerrar, construirCierre, cierreToRemote, filasPdfCierre,
  claveBorrador, borradorVacio, setAsignacionBorrador, confirmarAsignacionBorrador, asignacionLineaValida,
  podarBorrador, buscarCliente, firmaDashboard,
} from '../comisiones';

const VENDEDORES = [
  { id: 1, nombre: 'Jorge', permiso: 1 },
  { id: 2, nombre: 'Carlos', permiso: 2 },
  { id: 3, nombre: 'Lucía', permiso: 2 },
];
const CLIENTES = [
  { id: 10, nombre: 'Kiosco Pepe', vendedor: 'Carlos', comision: 5 },
  { id: 12, nombre: 'Sin Vendedor SA', vendedor: '', comision: 10 },
];
const PERIODO = { desde: '2026-10-01', hasta: '2026-10-31' };
const ped = (o) => ({
  id: o.id ?? 1, remoteId: `R${o.id ?? 1}`, clienteId: 10, clienteNombre: 'Kiosco Pepe',
  vendedor: 'Carlos', fecha: '2026-10-10', estado: 'facturado', entregado: true, total: 1000, items: [], ...o,
});
const PEDIDOS = [
  ped({ id: 1 }),
  ped({ id: 3, vendedor: 'Lucía' }), // aviso (a)
  ped({ id: 4, clienteId: 12, clienteNombre: 'Sin Vendedor SA', total: 500 }), // aviso (b)
  ped({ id: 5, clienteId: 12, clienteNombre: 'Sin Vendedor SA', total: 300 }), // aviso (b), mismo cliente
];
const ctx = (pid) => {
  const pedido = PEDIDOS.find(p => p.remoteId === pid);
  return { pedido, cliente: buscarCliente(pedido, CLIENTES).cliente, vendedores: VENDEDORES };
};
const dash = (borrador) => armarDashboard({ pedidos: PEDIDOS, clientes: CLIENTES, vendedores: VENDEDORES, cierres: [], borrador, periodo: PERIODO });
const confirmar = (b, pid) => confirmarAsignacionBorrador(b, PERIODO, pid, ctx(pid), 123);

describe('AC-COM-17 confirmarAsignacionBorrador', () => {
  it('AC-COM-17 confirma una asignación válida (otro vendedor, sin comisión, dividir 100, default de ficha)', () => {
    let b = setAsignacionBorrador(null, PERIODO, 'R4', { modo: 'otro', vendedor: 'Lucía' }, 1);
    let r = confirmar(b, 'R4');
    expect(r.ok).toBe(true);
    expect(r.borrador.asignaciones.R4).toEqual({ modo: 'otro', vendedor: 'Lucía', confirmada: true });
    expect(r.borrador.updatedAt).toBe(123);
    expect(b.asignaciones.R4.confirmada).toBeUndefined(); // no muta el original

    b = setAsignacionBorrador(null, PERIODO, 'R4', { modo: 'sin_comision' }, 1);
    expect(confirmar(b, 'R4').ok).toBe(true);

    b = setAsignacionBorrador(null, PERIODO, 'R3', { modo: 'dividir', pctFicha: '70', pctCargador: '30' }, 1);
    expect(confirmar(b, 'R3').borrador.asignaciones.R3).toEqual({ modo: 'dividir', pctFicha: '70', pctCargador: '30', confirmada: true });

    // sin entrada en el borrador: confirma el default (ficha) del pedido con aviso (a)
    r = confirmar(borradorVacio(PERIODO), 'R3');
    expect(r.ok).toBe(true);
    expect(r.borrador.asignaciones.R3).toEqual({ modo: 'ficha', confirmada: true });
  });

  it('AC-COM-17 rechaza una asignación inválida y no cambia el borrador', () => {
    const vacio = borradorVacio(PERIODO);
    // cliente sin vendedor y sin elegir nada
    let r = confirmar(vacio, 'R4');
    expect(r.ok).toBe(false);
    expect(r.borrador).toBe(vacio);
    expect(r.errores.modo).toMatch(/Elegí/);
    // "otro" sin vendedor
    let b = setAsignacionBorrador(null, PERIODO, 'R4', { modo: 'otro' }, 1);
    r = confirmar(b, 'R4');
    expect(r.ok).toBe(false);
    expect(r.borrador.asignaciones.R4.confirmada).toBeUndefined();
    // división que no suma 100
    b = setAsignacionBorrador(null, PERIODO, 'R3', { modo: 'dividir', pctFicha: '70', pctCargador: '20' }, 1);
    r = confirmar(b, 'R3');
    expect(r.ok).toBe(false);
    expect(r.errores.suma).toMatch(/100/);
    // vendedor inexistente / pedido que no coincide / sin contexto
    b = setAsignacionBorrador(null, PERIODO, 'R4', { modo: 'otro', vendedor: 'Fantasma' }, 1);
    expect(confirmar(b, 'R4').ok).toBe(false);
    expect(confirmarAsignacionBorrador(b, PERIODO, 'R4', ctx('R3')).ok).toBe(false);
    expect(confirmarAsignacionBorrador(b, PERIODO, 'R4', undefined).ok).toBe(false);
    expect(confirmarAsignacionBorrador(b, PERIODO, null, ctx('R4')).ok).toBe(false);
  });

  it('AC-COM-17 cualquier cambio posterior con setAsignacionBorrador la desconfirma', () => {
    const b = confirmar(setAsignacionBorrador(null, PERIODO, 'R4', { modo: 'sin_comision' }, 1), 'R4').borrador;
    expect(b.asignaciones.R4.confirmada).toBe(true);
    const b2 = setAsignacionBorrador(b, PERIODO, 'R4', { ...b.asignaciones.R4, modo: 'otro', vendedor: 'Carlos' }, 2);
    expect(b2.asignaciones.R4.confirmada).toBeUndefined();
    expect(dash(b2).lineas.find(l => l.pedidoId === 'R4').asignacionConfirmada).toBe(false);
    // mismo valor reenviado (con la marca en el input) también la desconfirma
    const b3 = setAsignacionBorrador(b, PERIODO, 'R4', b.asignaciones.R4, 3);
    expect(b3.asignaciones.R4.confirmada).toBeUndefined();
    // volver al default
    expect(setAsignacionBorrador(b, PERIODO, 'R4', null, 4).asignaciones.R4).toBeUndefined();
  });

  it('AC-COM-17 borradores viejos sin la marca (o con marca no booleana) se tratan como no confirmados', () => {
    const viejo = { id: claveBorrador(PERIODO), asignaciones: { R3: { modo: 'cargador' }, R4: { modo: 'sin_comision', confirmada: 'true' } } };
    const d = dash(viejo);
    expect(d.lineas.every(l => l.asignacionConfirmada === false)).toBe(true);
    expect(d.avisos.contadores.a).toBe(1);
    expect(d.avisos.contadores.b).toBe(1);
  });

  it('AC-COM-17 una confirmada que deja de ser válida (vendedor borrado) vuelve a pendiente', () => {
    const b = confirmar(setAsignacionBorrador(null, PERIODO, 'R4', { modo: 'otro', vendedor: 'Lucía' }, 1), 'R4').borrador;
    const sinLucia = VENDEDORES.filter(v => v.nombre !== 'Lucía');
    const l = armarLinea(PEDIDOS[2], { clientes: CLIENTES, vendedores: sinLucia, asignacionBorrador: b.asignaciones.R4 });
    expect(l.asignacionConfirmada).toBe(false);
    expect(asignacionLineaValida(l)).toBe(false);
  });

  it('AC-COM-17 asignacionLineaValida', () => {
    const d = dash(borradorVacio(PERIODO));
    expect(asignacionLineaValida(d.lineas.find(l => l.pedidoId === 'R3'))).toBe(true); // ficha por defecto
    expect(asignacionLineaValida(d.lineas.find(l => l.pedidoId === 'R4'))).toBe(false); // sin vendedor
    expect(asignacionLineaValida(null)).toBe(false);
    expect(asignacionLineaValida({ tipo: 'ajuste', asignacion: { modo: 'ficha' } })).toBe(false);
  });
});

describe('AC-COM-17 avisos (a) y (b) excluyen confirmadas', () => {
  it('AC-COM-17 el pedido con aviso (a) confirmado sale del aviso', () => {
    expect(dash(borradorVacio(PERIODO)).avisos.contadores.a).toBe(1);
    const b = confirmar(borradorVacio(PERIODO), 'R3').borrador;
    const d = dash(b);
    expect(d.avisos.contadores.a).toBe(0);
    expect(d.avisos.cargadoPorOtro).toEqual([]);
  });

  it('AC-COM-17 un cliente con 2 pedidos sale del aviso (b) solo con ambos confirmados', () => {
    let b = setAsignacionBorrador(null, PERIODO, 'R4', { modo: 'otro', vendedor: 'Lucía' }, 1);
    b = setAsignacionBorrador(b, PERIODO, 'R5', { modo: 'sin_comision' }, 1);
    let d = dash(b);
    expect(d.avisos.contadores.b).toBe(1);
    expect(d.avisos.clienteSinVendedor[0]).toMatchObject({ clienteNombre: 'Sin Vendedor SA', pedidos: 2 });

    b = confirmar(b, 'R4').borrador;
    d = dash(b);
    expect(d.avisos.contadores.b).toBe(1); // falta R5
    expect(d.avisos.clienteSinVendedor[0].pedidos).toBe(1);

    b = confirmar(b, 'R5').borrador;
    d = dash(b);
    expect(d.avisos.contadores.b).toBe(0);
    expect(d.avisos.clienteSinVendedor).toEqual([]);

    // desconfirmar uno solo lo vuelve a poner
    b = setAsignacionBorrador(b, PERIODO, 'R5', { modo: 'otro', vendedor: 'Carlos' }, 2);
    expect(dash(b).avisos.contadores.b).toBe(1);
  });

  it('AC-COM-17 calcularAvisos solo excluye con asignacionConfirmada === true', () => {
    const ls = [
      { pedidoId: 'A', cargaDeOtro: true, asignacionConfirmada: true },
      { pedidoId: 'B', cargaDeOtro: true },
      { pedidoId: 'C', sinVendedor: true, clienteId: 1, asignacionConfirmada: true },
      { pedidoId: 'D', sinVendedor: true, clienteId: 2 },
    ];
    const a = calcularAvisos(ls);
    expect(a.cargadoPorOtro.map(l => l.pedidoId)).toEqual(['B']);
    expect(a.clienteSinVendedor.map(c => c.clienteId)).toEqual([2]);
  });
});

describe('AC-COM-17 no cambia cálculos, bloqueo de cierre ni el payload', () => {
  const asignado = () => {
    let b = setAsignacionBorrador(null, PERIODO, 'R4', { modo: 'otro', vendedor: 'Lucía' }, 1);
    b = setAsignacionBorrador(b, PERIODO, 'R5', { modo: 'sin_comision' }, 1);
    b = setAsignacionBorrador(b, PERIODO, 'R3', { modo: 'dividir', pctFicha: '60', pctCargador: '40' }, 1);
    return b;
  };
  const confirmado = () => ['R3', 'R4', 'R5'].reduce((b, pid) => confirmar(b, pid).borrador, asignado());

  it('AC-COM-17 totales, resumen, partes, firma y puedeCerrar quedan iguales', () => {
    const d1 = dash(asignado());
    const d2 = dash(confirmado());
    expect(d2.totales).toEqual(d1.totales);
    expect(d2.resumenPorVendedor).toEqual(d1.resumenPorVendedor);
    expect(d2.lineas.map(l => l.partes)).toEqual(d1.lineas.map(l => l.partes));
    expect(firmaDashboard(d2)).toBe(firmaDashboard(d1));
    expect(puedeCerrar(d2)).toEqual(puedeCerrar(d1));
  });

  it('AC-COM-17 AC-COM-8 confirmar no destraba el cierre si falta asignar otro pedido sin vendedor', () => {
    let b = setAsignacionBorrador(null, PERIODO, 'R4', { modo: 'otro', vendedor: 'Lucía' }, 1);
    b = confirmar(b, 'R4').borrador;
    const chk = puedeCerrar(dash(b));
    expect(chk.ok).toBe(false);
    expect(chk.motivos.join(' ')).toMatch(/sin vendedor/);
  });

  it('AC-COM-17 la marca confirmada no llega al payload de la RPC ni al PDF', () => {
    const d1 = dash(asignado());
    const d2 = dash(confirmado());
    const opts = { admin: 'Jorge', now: new Date(Date.UTC(2026, 9, 31)), genId: () => 'c-1' };
    const c1 = construirCierre(d1, opts);
    const c2 = construirCierre(d2, opts);
    expect(c2).toEqual(c1);
    const payload = cierreToRemote(c2);
    expect(payload).toEqual(cierreToRemote(c1));
    const json = JSON.stringify(payload);
    expect(json).not.toMatch(/confirmada/i);
    expect(JSON.stringify(c2)).not.toMatch(/confirmada/i);
    expect(JSON.stringify(filasPdfCierre(c2))).not.toMatch(/confirmada|✓/i);
  });

  it('AC-COM-17 podarBorrador conserva la confirmación de los pedidos que siguen', () => {
    const b = podarBorrador(confirmado(), ['R4']);
    expect(b.asignaciones).toEqual({ R4: { modo: 'otro', vendedor: 'Lucía', confirmada: true } });
  });
});
