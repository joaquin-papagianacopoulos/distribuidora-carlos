// REQ-COM: servicio de comisiones (AC-COM-9, 10, 11, 12, 16) con Supabase,
// IndexedDB y sync mockeados.
// MOD (RUN 20261014-1449, AC-COMR-9/13): el servicio ahora arma el dashboard
// con el modelo vigente (por vendedor y rubro). Los fixtures suman items con
// rubro, productos y la tabla de % (Carlos: rubro X = 5 %), así los montos
// esperados (50 / 25 / total 75) se mantienen. Las RPC de la tabla de %
// (admin_leer/guardar_comisiones_rubro) se registran aparte (mockSb.rubro).
const mockLocal = { pedidos: [], clientes: [], vendedores: [], cierres: [], borradores: {}, productos: [], tablaRubros: [] };
const mockOrden = [];
jest.mock('../../db', () => {
  const impl = {
    getPedidos: async () => mockLocal.pedidos.map(p => ({ ...p })),
    getClientes: async () => mockLocal.clientes,
    getVendedores: async () => mockLocal.vendedores,
    getComisionesCierres: async () => mockLocal.cierres.map(c => JSON.parse(JSON.stringify(c))),
    putComisionCierreLocal: async (c) => { impl.putComisionesCierresRemotos([{ ...c, pendingSync: true }]); },
    putComisionesCierresRemotos: async (rows) => {
      for (const r of rows) {
        const i = mockLocal.cierres.findIndex(c => c.id === r.id);
        if (i >= 0) mockLocal.cierres[i] = { ...r }; else mockLocal.cierres.push({ ...r });
      }
    },
    getComisionBorrador: async (id) => mockLocal.borradores[id] || null,
    putComisionBorrador: async (b) => { mockLocal.borradores[b.id] = { ...b }; },
    getProductos: async () => mockLocal.productos.map(p => ({ ...p })),
    getComisionesRubro: async () => mockLocal.tablaRubros.map(f => ({ ...f })),
    putComisionesRubroLocal: async (rows) => impl.putComisionesRubroRemotos(rows.map(r => ({ ...r, pendingSync: true }))),
    putComisionesRubroRemotos: async (rows) => {
      for (const r of rows || []) {
        const i = mockLocal.tablaRubros.findIndex(f => f.id === r.id);
        if (i >= 0) mockLocal.tablaRubros[i] = { ...r }; else mockLocal.tablaRubros.push({ ...r });
      }
    },
    clearComisionesRubroPendingSync: async (ids) => {
      const set = new Set(ids || []);
      mockLocal.tablaRubros = mockLocal.tablaRubros.map(f => (set.has(f.id) ? { ...f, pendingSync: false } : f));
    },
  };
  const mod = { __impl: impl };
  for (const k of Object.keys(impl)) mod[k] = jest.fn(impl[k]);
  return mod;
});
jest.mock('../../sync/syncService', () => ({
  pullPedidosByRango: jest.fn(async () => ({ ok: true, count: 0 })),
  syncPedidosPendientes: jest.fn(async () => ({ ok: true })),
  syncProductos: jest.fn(async () => ({ ok: true })),
  downloadMaestros: jest.fn(async () => ({ ok: true })),
}));
const mockSb = { rpc: [], rpcRespuestas: [], remoto: [], selectError: null, rubro: [], rubroError: null, rubroRemoto: [] };
// RPC de la tabla de % (REQ-COMR): sondeo sin credenciales => no_autorizado;
// leer => la tabla remota; guardar => acepta todo con el mismo id.
const mockRpcRubro = (fn, args) => {
  mockSb.rubro.push({ fn, args });
  mockOrden.push(`rubro:${fn}`);
  if (mockSb.rubroError) return Promise.resolve({ data: null, error: mockSb.rubroError });
  if (!args?.p_admin_id) return Promise.resolve({ data: { ok: false, motivo: 'no_autorizado' }, error: null });
  if (fn === 'admin_leer_comisiones_rubro') return Promise.resolve({ data: { ok: true, filas: mockSb.rubroRemoto }, error: null });
  return Promise.resolve({ data: { ok: true, filas: (args.p_filas || []).map(f => ({ ...f, id_enviado: f.id })), rechazadas: [] }, error: null });
};
jest.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: (fn, args) => {
      if (/comisiones_rubro/.test(fn)) return mockRpcRubro(fn, args);
      mockOrden.push(`rpc:${fn}`);
      mockSb.rpc.push({ fn, args });
      return Promise.resolve(mockSb.rpcRespuestas.shift() || { data: { ok: true }, error: null });
    },
    from: () => {
      const api = {
        select: () => api, order: () => api, range: () => api,
        then: (res, rej) => Promise.resolve(mockSb.selectError ? { data: null, error: mockSb.selectError } : { data: mockSb.remoto, error: null }).then(res, rej),
      };
      return api;
    },
  },
}));

import * as db from '../../db';
import { pullPedidosByRango, syncPedidosPendientes, syncProductos, downloadMaestros } from '../../sync/syncService';
import {
  cargarDatosComisiones, guardarBorrador, confirmarCierre, anularCierre, syncComisiones, pullCierres,
  enviarCierre, esFaltaMigracion, esErrorDeRed, MSG_FALTA_MIGRACION, mensajeRechazo,
} from '../comisionesService';
import { setUsuarioSesion } from '../sesion';
import { armarDashboard, firmaDashboard, setAsignacionBorrador, claveBorrador } from '../../domain/comisiones';

const setOnline = (v) => Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => v });
const PERIODO = { desde: '2026-10-01', hasta: '2026-10-31' };
const ped = (o) => {
  const p = { id: 1, remoteId: 'R1', clienteId: 10, clienteNombre: 'Kiosco', vendedor: 'Carlos', fecha: '2026-10-10', estado: 'facturado', entregado: true, total: 1000, synced: true, ...o };
  return { items: [{ productoId: 'p1', nombre: 'Alfajor', precio: p.total, cantidad: 1, rubro: 'X' }], ...p };
};
const FILA_CARLOS_X = { id: 't-carlos-x', vendedorId: 'uuid-carlos', vendedorNombre: 'Carlos', rubro: 'X', rubroClave: 'x', clave: 'uuid-carlos|x', pct: 5, editadoAt: 1, pendingSync: false };
const ERR_RED = { message: 'TypeError: Failed to fetch' };
const ERR_SIN_RPC = { code: 'PGRST202', message: 'Could not find the function public.cerrar_comisiones' };
const PIN = '1234';
const CRED = { p_admin_id: 'uuid-jorge', p_admin_pin: PIN };
const ERR_BLOQUEO = { code: 'P0001', message: 'Demasiados intentos. Proba de nuevo en 15 minutos.' };

let warnSpy;
beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(db.__impl)) db[k].mockImplementation(db.__impl[k]);
  pullPedidosByRango.mockImplementation(async () => ({ ok: true, count: 0 }));
  syncPedidosPendientes.mockImplementation(async () => { mockOrden.push('pedidos'); return { ok: true }; });
  syncProductos.mockImplementation(async () => { mockOrden.push('productos'); return { ok: true }; });
  downloadMaestros.mockImplementation(async () => { mockOrden.push('maestros'); return { ok: true }; });
  mockLocal.pedidos = [ped({}), ped({ id: 2, remoteId: 'R2', total: 500 })];
  mockLocal.clientes = [{ id: 10, nombre: 'Kiosco', vendedor: 'Carlos', comision: 5 }];
  mockLocal.vendedores = [{ id: 1, remoteId: 'uuid-jorge', nombre: 'Jorge', permiso: 1 }, { id: 2, remoteId: 'uuid-carlos', nombre: 'Carlos', permiso: 2 }];
  mockLocal.cierres = [];
  mockLocal.borradores = {};
  mockLocal.productos = [{ id: 'p1', nombre: 'Alfajor', categoria: 'X' }];
  mockLocal.tablaRubros = [{ ...FILA_CARLOS_X }];
  mockSb.rpc = []; mockSb.rpcRespuestas = []; mockSb.remoto = []; mockSb.selectError = null;
  mockSb.rubro = []; mockSb.rubroError = null;
  mockSb.rubroRemoto = [{ id: 't-carlos-x', vendedor_id: 'uuid-carlos', rubro: 'X', rubro_clave: 'x', pct: 5, editado_at: '1970-01-01T00:00:00.001Z' }];
  mockOrden.length = 0;
  setUsuarioSesion({ id: 1, nombre: 'Jorge', permiso: 1 });
  setOnline(true);
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { warnSpy.mockRestore(); setUsuarioSesion(null); });

describe('clasificación de errores', () => {
  it.each([
    [ERR_SIN_RPC, true], [{ code: '42883' }, true], [{ code: '42P01' }, true], [{ message: 'relation "comisiones_cierres" does not exist' }, true], [{ code: '23505' }, false], [null, false],
  ])('AC-COM-16 esFaltaMigracion(%o) => %p', (e, r) => { expect(esFaltaMigracion(e)).toBe(r); });
  it('AC-COM-16 esErrorDeRed', () => {
    expect(esErrorDeRed(ERR_RED)).toBe(true);
    expect(esErrorDeRed({ code: 'P0001', message: 'x' })).toBe(false);
    expect(esErrorDeRed({ code: 'X', message: 'network timeout' })).toBe(true);
  });
});

describe('AC-COM-3 AC-COM-9 carga de datos y borrador', () => {
  it('AC-COM-3 online: baja los pedidos del período y los cierres; devuelve borrador vacío si no hay', async () => {
    const d = await cargarDatosComisiones(PERIODO, { online: true });
    expect(pullPedidosByRango).toHaveBeenCalledWith('2026-10-01', '2026-10-31');
    expect(d).toMatchObject({ incompleto: false, faltaMigracion: false, borrador: { id: claveBorrador(PERIODO), asignaciones: {} } });
    expect(d.pedidos).toHaveLength(2);
  });

  it('AC-COM-3 offline: no llama a la red y marca datos incompletos', async () => {
    const d = await cargarDatosComisiones(PERIODO, { online: false });
    expect(pullPedidosByRango).not.toHaveBeenCalled();
    expect(d.incompleto).toBe(true);
  });

  it('AC-COM-3 errores de red al bajar => incompleto con aviso; tabla inexistente => faltaMigracion', async () => {
    pullPedidosByRango.mockRejectedValueOnce(new Error('timeout'));
    mockSb.selectError = { code: '42P01', message: 'relation does not exist' };
    const d = await cargarDatosComisiones(PERIODO);
    expect(d).toMatchObject({ incompleto: true, faltaMigracion: true });
    expect(d.avisos[0]).toMatch(/timeout/);
    pullPedidosByRango.mockResolvedValueOnce({ ok: true, incompleto: true });
    mockSb.selectError = { code: '500', message: 'boom' };
    const d2 = await cargarDatosComisiones(PERIODO);
    expect(d2.incompleto).toBe(true);
    expect(d2.avisos.join(' ')).toMatch(/una parte|boom/);
  });

  it('AC-COM-9 guardar borrador y volver a cargarlo restaura las asignaciones', async () => {
    const b = setAsignacionBorrador(null, PERIODO, 'R1', { modo: 'cargador' }, 1);
    await guardarBorrador(b);
    const d = await cargarDatosComisiones(PERIODO, { online: false });
    expect(d.borrador.asignaciones).toEqual({ R1: { modo: 'cargador' } });
  });
});

describe('AC-COM-10 AC-COM-16 confirmar cierre', () => {
  const firma = async () => {
    const datos = await cargarDatosComisiones(PERIODO, { online: false });
    return firmaDashboard(armarDashboard({ ...datos, periodo: PERIODO }));
  };

  it('AC-COM-10 guarda primero local (pendiente) y con la RPC ok queda vigente', async () => {
    const f = await firma();
    const r = await confirmarCierre({ pin: PIN, periodo: PERIODO, firmaVista: f });
    expect(r).toMatchObject({ ok: true, yaExistia: false });
    expect(syncPedidosPendientes).toHaveBeenCalled();
    expect(db.putComisionCierreLocal).toHaveBeenCalledWith(expect.objectContaining({ id: r.cierreId, estado: 'pendiente', cerradoPor: 'Jorge' }));
    expect(mockSb.rpc[0].fn).toBe('cerrar_comisiones');
    expect(mockSb.rpc[0].args.p_cierre).toMatchObject({ id: r.cierreId, desde: '2026-10-01', hasta: '2026-10-31', cerrado_por: 'Jorge', total_comision: 75 });
    // MOD (RUN 20261014-1449, AC-COMR-13): antes pct: 5 (el del cliente); ahora
    // pct: null, modelo 'rubro' y las partes por vendedor (el servidor recalcula).
    expect(mockSb.rpc[0].args.p_cierre.modelo).toBe('rubro');
    expect(mockSb.rpc[0].args.p_renglones).toEqual([
      { pedido_id: 'R1', tipo: 'pedido', ajuste_seq: 0, total: 1000, comision: 50, pct: null, sin_comision: false, modelo: 'rubro', partes: [{ vendedor_id: 'uuid-carlos', pct: 100, monto: 50 }] },
      { pedido_id: 'R2', tipo: 'pedido', ajuste_seq: 0, total: 500, comision: 25, pct: null, sin_comision: false, modelo: 'rubro', partes: [{ vendedor_id: 'uuid-carlos', pct: 100, monto: 25 }] },
    ]);
    // S-COM-01: id remoto + PIN viajan solo en la llamada
    expect(mockSb.rpc[0].args).toMatchObject(CRED);
    expect(mockLocal.cierres).toEqual([expect.objectContaining({ id: r.cierreId, estado: 'vigente', pendingSync: false })]);
    expect(r.cierreId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('AC-COM-11 después de cerrar, esos pedidos no vuelven a aparecer en el dashboard', async () => {
    await confirmarCierre({ pin: PIN, periodo: PERIODO });
    const datos = await cargarDatosComisiones(PERIODO, { online: false });
    const d = armarDashboard({ ...datos, periodo: PERIODO });
    expect(d.lineas).toEqual([]);
    expect(d.yaCerrados).toHaveLength(2);
  });

  it('S01-3 confirmarCierre pasa la credencial del admin a syncProductos', async () => {
    await confirmarCierre({ pin: PIN, periodo: PERIODO });
    const arg = syncProductos.mock.calls[0][0];
    expect(arg.cred).toMatchObject({ p_admin_pin: PIN });
    expect(typeof arg.cred.p_admin_id).toBe('string');
  });

  it('AC-COM-16 reintento del mismo UUID (ya_existia) => vigente sin duplicar', async () => {
    mockSb.rpcRespuestas = [{ data: { ok: true, ya_existia: true }, error: null }];
    const r = await confirmarCierre({ pin: PIN, periodo: PERIODO });
    expect(r).toMatchObject({ ok: true, yaExistia: true });
    expect(mockLocal.cierres).toHaveLength(1);
  });

  it('AC-COM-16 otro admin ya cerró esos pedidos => rechazado (no vigente) con la lista', async () => {
    mockSb.rpcRespuestas = [{ data: { ok: false, motivo: 'ya_cerrado', conflictos: ['R1'] }, error: null }];
    const r = await confirmarCierre({ pin: PIN, periodo: PERIODO });
    expect(r).toMatchObject({ ok: false, motivo: 'ya_cerrado', conflictos: ['R1'], mensaje: expect.stringMatching(/Otro admin/) });
    expect(mockLocal.cierres[0]).toMatchObject({ estado: 'rechazado', conflictos: ['R1'], pendingSync: false });
    // Un rechazado no ocupa los pedidos
    const datos = await cargarDatosComisiones(PERIODO, { online: false });
    expect(armarDashboard({ ...datos, periodo: PERIODO }).lineas).toHaveLength(2);
  });

  it('AC-COM-16 RPC inexistente (migración sin correr) => mensaje y el cierre no queda vigente', async () => {
    mockSb.rpcRespuestas = [{ data: null, error: ERR_SIN_RPC }];
    const r = await confirmarCierre({ pin: PIN, periodo: PERIODO });
    expect(r).toMatchObject({ ok: false, motivo: 'falta_migracion', mensaje: MSG_FALTA_MIGRACION });
    expect(mockLocal.cierres[0]).toMatchObject({ estado: 'rechazado', motivoRechazo: 'falta_migracion' });
  });

  it('AC-COM-16 sin respuesta (red) => queda pendiente y syncComisiones lo reintenta con el MISMO UUID', async () => {
    mockSb.rpcRespuestas = [{ data: null, error: ERR_RED }];
    const r = await confirmarCierre({ pin: PIN, periodo: PERIODO });
    expect(r).toMatchObject({ ok: false, pendiente: true });
    expect(mockLocal.cierres[0]).toMatchObject({ estado: 'pendiente', pendingSync: true });
    // Mientras está pendiente, los pedidos se consideran cerrados (conservador)
    const datos = await cargarDatosComisiones(PERIODO, { online: false });
    expect(armarDashboard({ ...datos, periodo: PERIODO }).lineas).toEqual([]);
    mockSb.rpcRespuestas = [{ data: { ok: true, ya_existia: true }, error: null }];
    mockSb.remoto = [];
    // S-COM-01: sin PIN (runSync en segundo plano) no reenvía, solo cuenta.
    expect(await syncComisiones()).toMatchObject({ ok: true, reintentos: 0, pendientes: 1 });
    expect(mockSb.rpc).toHaveLength(1);
    const s = await syncComisiones({ pin: PIN });
    expect(s).toMatchObject({ ok: true, reintentos: 1, pendientes: 0 });
    expect(mockSb.rpc[1].args).toMatchObject(CRED);
    expect(mockSb.rpc[1].args.p_cierre.id).toBe(r.cierreId);
    expect(mockLocal.cierres[0]).toMatchObject({ estado: 'vigente', pendingSync: false });
  });

  it('AC-COM-10 si los datos cambiaron desde lo que vio el admin, no cierra y devuelve el dashboard nuevo', async () => {
    const f = await firma();
    mockLocal.pedidos[0].total = 2000;
    const r = await confirmarCierre({ pin: PIN, periodo: PERIODO, firmaVista: f });
    expect(r).toMatchObject({ ok: false, motivo: 'cambio' });
    expect(r.dashboard.totales.totalVendido).toBe(2500);
    expect(mockSb.rpc).toHaveLength(0);
    expect(mockLocal.cierres).toEqual([]);
  });

  it('AC-COM-2 AC-COM-10 bloqueos: no admin, offline, sync fallido, falta migración, datos incompletos, nada para cerrar', async () => {
    setUsuarioSesion({ id: 2, nombre: 'Carlos', permiso: 2 });
    expect(await confirmarCierre({ pin: PIN, periodo: PERIODO })).toMatchObject({ ok: false, motivo: 'permiso' });
    setUsuarioSesion({ id: 1, nombre: 'Jorge', permiso: 1 });
    setOnline(false);
    expect(await confirmarCierre({ pin: PIN, periodo: PERIODO })).toMatchObject({ ok: false, motivo: 'offline' });
    setOnline(true);
    syncPedidosPendientes.mockRejectedValueOnce(new Error('red'));
    expect(await confirmarCierre({ pin: PIN, periodo: PERIODO })).toMatchObject({ ok: false, motivo: 'sync' });
    mockSb.selectError = { code: '42P01', message: 'x' };
    expect(await confirmarCierre({ pin: PIN, periodo: PERIODO })).toMatchObject({ ok: false, motivo: 'falta_migracion' });
    mockSb.selectError = null;
    pullPedidosByRango.mockRejectedValueOnce(new Error('caido'));
    expect(await confirmarCierre({ pin: PIN, periodo: PERIODO })).toMatchObject({ ok: false, motivo: 'datos_incompletos', mensaje: expect.stringMatching(/caido/) });
    mockLocal.pedidos = [];
    expect(await confirmarCierre({ pin: PIN, periodo: PERIODO })).toMatchObject({ ok: false, motivo: 'no_se_puede' });
    expect(mockSb.rpc).toHaveLength(0);
  });

  it('AC-COM-16 enviarCierre: otros rechazos del servidor (no_admin / error SQL)', async () => {
    const c = { id: 'c-x', desde: '2026-10-01', hasta: '2026-10-31', lineas: [], totales: {} };
    mockSb.rpcRespuestas = [{ data: { ok: false, motivo: 'no_admin' }, error: null }, { data: null, error: { code: 'P0001', message: 'pedido raro' } }, { data: { ok: false }, error: null }];
    expect(await enviarCierre(c)).toMatchObject({ ok: false, motivo: 'no_admin', mensaje: expect.stringMatching(/admin/) });
    expect(await enviarCierre(c)).toMatchObject({ ok: false, motivo: 'error', mensaje: expect.stringMatching(/pedido raro/) });
    expect(await enviarCierre(c)).toMatchObject({ ok: false, motivo: 'rechazado' });
    expect(mockLocal.cierres[0].estado).toBe('rechazado');
  });
});

describe('AC-COM-12 anular cierre', () => {
  const VIG = { id: 'c1', estado: 'vigente', desde: '2026-10-01', hasta: '2026-10-31', lineas: [{ tipo: 'pedido', pedidoId: 'R1', total: 1000, comision: 50, pct: 5 }] };
  beforeEach(() => { mockLocal.cierres = [{ ...VIG }]; });

  it('AC-COM-12 con motivo: RPC y queda anulado con quién/cuándo/motivo; los pedidos vuelven a estar disponibles', async () => {
    const r = await anularCierre(VIG, '  Mal cargado el % ', PIN);
    expect(r.ok).toBe(true);
    expect(mockSb.rpc[0]).toEqual({ fn: 'anular_cierre_comisiones', args: { p_id: 'c1', p_admin_id: 'uuid-jorge', p_admin_pin: PIN, p_motivo: 'Mal cargado el %' } });
    expect(mockLocal.cierres[0]).toMatchObject({ estado: 'anulado', anuladoPor: 'Jorge', motivoAnulacion: 'Mal cargado el %', pendingSync: false });
    const datos = await cargarDatosComisiones(PERIODO, { online: false });
    expect(armarDashboard({ ...datos, periodo: PERIODO }).lineas.map(l => l.pedidoId)).toContain('R1');
  });

  it('AC-COM-12 motivo vacío o no admin => no llama al servidor', async () => {
    expect(await anularCierre(VIG, '  ')).toMatchObject({ ok: false, motivo: 'validacion', errores: { motivo: expect.any(String) } });
    setUsuarioSesion({ id: 4, nombre: 'Ana', permiso: 3 });
    expect(await anularCierre(VIG, 'motivo válido', PIN)).toMatchObject({ ok: false, motivo: 'permiso' });
    expect(mockSb.rpc).toHaveLength(0);
  });

  it('AC-COM-12 red caída => anulación pendiente y el cierre SIGUE vigente localmente; el sync la completa', async () => {
    mockSb.rpcRespuestas = [{ data: null, error: ERR_RED }];
    const r = await anularCierre(VIG, 'motivo válido', PIN);
    expect(r).toMatchObject({ ok: false, pendiente: true });
    expect(mockLocal.cierres[0]).toMatchObject({ estado: 'vigente', anulacionPendiente: { por: 'Jorge', motivo: 'motivo válido' } });
    const datos = await cargarDatosComisiones(PERIODO, { online: false });
    expect(armarDashboard({ ...datos, periodo: PERIODO }).lineas.map(l => l.pedidoId)).toEqual(['R2']);
    mockSb.rpcRespuestas = [{ data: { ok: true }, error: null }];
    await syncComisiones({ pin: PIN });
    expect(mockSb.rpc[1].fn).toBe('anular_cierre_comisiones');
    expect(mockSb.rpc[1].args).toEqual({ p_id: 'c1', ...CRED, p_motivo: 'motivo válido' });
    expect(mockLocal.cierres[0]).toMatchObject({ estado: 'anulado', anulacionPendiente: null, motivoAnulacion: 'motivo válido' });
  });

  it('AC-COM-12 offline, falta migración, error o rechazo del servidor', async () => {
    setOnline(false);
    expect(await anularCierre(VIG, 'motivo válido', PIN)).toMatchObject({ motivo: 'offline' });
    setOnline(true);
    mockSb.rpcRespuestas = [{ data: null, error: ERR_SIN_RPC }, { data: null, error: { code: 'P0001', message: 'x' } }, { data: { ok: false, motivo: 'no_admin' }, error: null }];
    expect(await anularCierre(VIG, 'motivo válido', PIN)).toMatchObject({ motivo: 'falta_migracion' });
    expect(await anularCierre(VIG, 'motivo válido', PIN)).toMatchObject({ motivo: 'error' });
    expect(await anularCierre(VIG, 'motivo válido', PIN)).toMatchObject({ motivo: 'no_admin' });
    expect(mockLocal.cierres[0].estado).toBe('vigente');
  });

  // Iteracion 3: S-COM-16 (respuesta unica) y S-COM-15 (no anular una base con ajustes vigentes).
  it('AC-COM-12 S-COM-16 no_autorizado se trata como rechazo de autenticacion', async () => {
    mockSb.rpcRespuestas = [{ data: { ok: false, motivo: 'no_autorizado' }, error: null }];
    expect(await anularCierre(VIG, 'motivo válido', PIN)).toMatchObject({ ok: false, motivo: 'no_autorizado', mensaje: expect.stringMatching(/PIN incorrecto o tu usuario no está autorizado/) });
    expect(mockLocal.cierres[0].estado).toBe('vigente');
  });

  it('AC-COM-12 S-COM-15 con ajustes vigentes en otro cierre no se llama a la RPC; si el servidor lo detecta, avisa', async () => {
    mockLocal.cierres = [{ ...VIG }, { id: 'c2', estado: 'vigente', desde: '2026-11-01', hasta: '2026-11-30', lineas: [{ tipo: 'ajuste', pedidoId: 'R1', ajusteSeq: 1, total: 10, comision: 0.5 }] }];
    const r = await anularCierre(VIG, 'motivo válido', PIN);
    expect(r).toMatchObject({ ok: false, motivo: 'tiene_ajustes_vigentes', conflictos: ['c2'], mensaje: expect.stringMatching(/anulalos primero/) });
    expect(mockSb.rpc).toHaveLength(0);
    mockLocal.cierres = [{ ...VIG }];
    mockSb.rpcRespuestas = [{ data: { ok: false, motivo: 'tiene_ajustes_vigentes', conflictos: ['c9'] }, error: null }];
    expect(await anularCierre(VIG, 'motivo válido', PIN)).toMatchObject({ ok: false, motivo: 'tiene_ajustes_vigentes', conflictos: ['c9'] });
    expect(mockLocal.cierres[0].estado).toBe('vigente');
  });
});

describe('AC-COM-16 syncComisiones / pullCierres', () => {
  it('AC-COM-16 solo corre para admin', async () => {
    setUsuarioSesion({ id: 2, nombre: 'Carlos', permiso: 2 });
    expect(await syncComisiones()).toEqual({ ok: true, skipped: true });
    expect(db.getComisionesCierres).not.toHaveBeenCalled();
  });

  it('AC-COM-16 pull baja cierres de otros dispositivos sin pisar locales pendientes ni rechazados', async () => {
    mockLocal.cierres = [
      { id: 'local-pend', estado: 'pendiente', pendingSync: true, lineas: [] },
      { id: 'local-rech', estado: 'rechazado', pendingSync: false, lineas: [] },
    ];
    mockSb.rpcRespuestas = [{ data: null, error: ERR_RED }];
    mockSb.remoto = [
      { id: 'otro', desde: '2026-09-01', hasta: '2026-09-30', estado: 'vigente', cerrado_por: 'Jorge', cerrado_at: '2026-10-01T00:00:00Z', lineas: [{ tipo: 'pedido', pedidoId: 'R9' }] },
      { id: 'local-pend', estado: 'vigente' },
    ];
    await syncComisiones();
    expect(mockLocal.cierres.map(c => [c.id, c.estado])).toEqual([['local-pend', 'pendiente'], ['local-rech', 'rechazado'], ['otro', 'vigente']]);
  });

  it('AC-COM-16 tabla inexistente => skipped sin romper; error real => throw', async () => {
    mockSb.selectError = { code: 'PGRST205', message: "Could not find the table 'public.comisiones_cierres'" };
    expect(await pullCierres()).toMatchObject({ ok: true, skipped: true, faltaMigracion: true });
    expect(await syncComisiones()).toMatchObject({ ok: true, skipped: true, faltaMigracion: true });
    mockSb.selectError = { code: '500', message: 'boom' };
    await expect(pullCierres()).rejects.toMatchObject({ message: 'boom' });
  });

  it('AC-COM-16 sync: RPC inexistente corta los reintentos; anulación rechazada se descarta', async () => {
    mockLocal.cierres = [{ id: 'p1', estado: 'pendiente', pendingSync: true, lineas: [] }];
    mockSb.rpcRespuestas = [{ data: null, error: ERR_SIN_RPC }];
    expect(await syncComisiones({ pin: PIN })).toMatchObject({ skipped: true, faltaMigracion: true });
    mockLocal.cierres = [{ id: 'v1', estado: 'vigente', anulacionPendiente: { por: 'Jorge', motivo: 'xyz' }, lineas: [] }];
    mockSb.rpcRespuestas = [{ data: { ok: false, motivo: 'no_existe' }, error: null }];
    await syncComisiones({ pin: PIN });
    expect(mockLocal.cierres[0]).toMatchObject({ estado: 'vigente', anulacionPendiente: null, motivoRechazo: 'no_existe' });
    mockLocal.cierres = [{ id: 'v2', estado: 'vigente', anulacionPendiente: { por: 'Jorge', motivo: 'xyz' }, lineas: [] }];
    mockSb.rpcRespuestas = [{ data: null, error: ERR_RED }];
    expect(await syncComisiones({ pin: PIN })).toMatchObject({ ok: true, reintentos: 1, pendientes: 1 });
    expect(mockLocal.cierres[0].anulacionPendiente).toEqual({ por: 'Jorge', motivo: 'xyz' });
    mockSb.rpcRespuestas = [{ data: null, error: ERR_SIN_RPC }];
    expect(await syncComisiones({ pin: PIN })).toMatchObject({ faltaMigracion: true });
  });
});

describe('AC-SEC-4 S-COM-01 PIN del admin en cerrar / anular / reintentar', () => {
  const PIN_RARO = '987654';
  const VIG = { id: 'c1', estado: 'vigente', desde: '2026-10-01', hasta: '2026-10-31', lineas: [{ tipo: 'pedido', pedidoId: 'R1', total: 1000, comision: 50, pct: 5 }] };
  let logSpy;
  let errSpy;
  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => { logSpy.mockRestore(); errSpy.mockRestore(); });

  const nuncaPersistido = () => {
    // Ni IndexedDB (mock) ni localStorage ni la consola ven el PIN.
    expect(JSON.stringify(mockLocal)).not.toContain(PIN_RARO);
    expect(JSON.stringify({ ...localStorage })).not.toContain(PIN_RARO);
    for (const spy of [warnSpy, logSpy, errSpy]) expect(JSON.stringify(spy.mock.calls)).not.toContain(PIN_RARO);
    for (const fn of Object.keys(db.__impl)) expect(JSON.stringify(db[fn].mock.calls)).not.toContain(PIN_RARO);
  };

  it('AC-SEC-4 S-COM-01 sin PIN no se cierra ni se guarda nada; sin id remoto del admin, tampoco', async () => {
    for (const pin of [undefined, '', '   ']) {
      expect(await confirmarCierre({ periodo: PERIODO, pin })).toMatchObject({ ok: false, motivo: 'pin_requerido' });
    }
    mockLocal.vendedores = [{ id: 1, nombre: 'Jorge', permiso: 1 }];
    expect(await confirmarCierre({ periodo: PERIODO, pin: PIN })).toMatchObject({ ok: false, motivo: 'sin_id_remoto', mensaje: expect.stringMatching(/sincroniz/) });
    setUsuarioSesion({ id: 77, nombre: 'Jorge', permiso: 1 });
    expect(await anularCierre(VIG, 'motivo válido', PIN)).toMatchObject({ ok: false, motivo: 'sin_id_remoto' });
    expect(mockSb.rpc).toHaveLength(0);
    expect(db.putComisionCierreLocal).not.toHaveBeenCalled();
    expect(syncPedidosPendientes).not.toHaveBeenCalled();
  });

  it('AC-SEC-4 S-COM-01 un permiso "1" en texto (forjado) no puede cerrar ni anular', async () => {
    setUsuarioSesion({ id: 1, nombre: 'Jorge', permiso: 1 });
    // setUsuarioSesion normaliza con Number(); el guard del servicio es esAdmin estricto.
    const sesion = require('../sesion');
    const spy = jest.spyOn(sesion, 'getUsuarioSesion').mockReturnValue({ id: 1, nombre: 'Jorge', permiso: '1' });
    expect(await confirmarCierre({ periodo: PERIODO, pin: PIN })).toMatchObject({ ok: false, motivo: 'permiso' });
    expect(await anularCierre(VIG, 'motivo válido', PIN)).toMatchObject({ ok: false, motivo: 'permiso' });
    expect(await syncComisiones({ pin: PIN })).toEqual({ ok: true, skipped: true });
    spy.mockRestore();
    expect(mockSb.rpc).toHaveLength(0);
  });

  it('AC-SEC-4 S-COM-01 PIN incorrecto en el primer envío => rechazado (libera pedidos) con mensaje claro', async () => {
    mockSb.rpcRespuestas = [{ data: { ok: false, motivo: 'pin_incorrecto' }, error: null }];
    const r = await confirmarCierre({ periodo: PERIODO, pin: PIN_RARO });
    expect(r).toMatchObject({ ok: false, motivo: 'pin_incorrecto', mensaje: expect.stringMatching(/PIN incorrecto/) });
    expect(mockSb.rpc[0].args).toMatchObject({ p_admin_id: 'uuid-jorge', p_admin_pin: PIN_RARO });
    expect(mockLocal.cierres[0]).toMatchObject({ estado: 'rechazado', motivoRechazo: 'pin_incorrecto', pendingSync: false });
    nuncaPersistido();
  });

  it('AC-SEC-4 S-COM-01 bloqueo por intentos (raise de verificar_pin): primer envío => rechazado; reintento => sigue pendiente', async () => {
    mockSb.rpcRespuestas = [{ data: null, error: ERR_BLOQUEO }];
    const r = await confirmarCierre({ periodo: PERIODO, pin: PIN_RARO });
    expect(r).toMatchObject({ ok: false, motivo: 'pin_bloqueado', mensaje: expect.stringMatching(/15 minutos/) });
    expect(mockLocal.cierres[0]).toMatchObject({ estado: 'rechazado', motivoRechazo: 'pin_bloqueado' });

    mockLocal.cierres = [{ id: 'p1', estado: 'pendiente', pendingSync: true, lineas: [] }];
    mockSb.rpcRespuestas = [{ data: null, error: ERR_BLOQUEO }];
    expect(await syncComisiones({ pin: PIN_RARO })).toMatchObject({ ok: false, motivo: 'pin_bloqueado', reintentos: 1 });
    expect(mockLocal.cierres[0]).toMatchObject({ estado: 'pendiente', pendingSync: true });
    nuncaPersistido();
  });

  it('AC-COM-16 S-COM-01 red caída: el cierre queda pendiente SIN el PIN; el reintento con PIN incorrecto no lo marca rechazado y corta', async () => {
    mockSb.rpcRespuestas = [{ data: null, error: ERR_RED }];
    const r = await confirmarCierre({ periodo: PERIODO, pin: PIN_RARO });
    expect(r).toMatchObject({ pendiente: true, mensaje: expect.stringMatching(/PIN/) });
    mockLocal.cierres.push({ id: 'p2', estado: 'pendiente', pendingSync: true, lineas: [] });
    mockSb.rpcRespuestas = [{ data: { ok: false, motivo: 'pin_incorrecto' }, error: null }];
    expect(await syncComisiones({ pin: PIN_RARO })).toMatchObject({ ok: false, motivo: 'pin_incorrecto', reintentos: 1 });
    expect(mockSb.rpc).toHaveLength(2); // no siguió con p2
    expect(mockLocal.cierres.map(c => c.estado)).toEqual(['pendiente', 'pendiente']);
    // pin inválido en el reintento: ni llama
    expect(await syncComisiones({ pin: '' })).toMatchObject({ ok: false, motivo: 'pin_requerido', pendientes: 2 });
    expect(mockSb.rpc).toHaveLength(2);
    nuncaPersistido();
  });

  it('AC-COM-12 S-COM-01 anular: PIN obligatorio, rechazo por PIN o bloqueo con mensaje; la anulación pendiente no guarda el PIN', async () => {
    mockLocal.cierres = [{ ...VIG }];
    expect(await anularCierre(VIG, 'motivo válido')).toMatchObject({ ok: false, motivo: 'pin_requerido' });
    mockSb.rpcRespuestas = [
      { data: { ok: false, motivo: 'pin_incorrecto' }, error: null },
      { data: null, error: ERR_BLOQUEO },
      { data: null, error: ERR_RED },
    ];
    expect(await anularCierre(VIG, 'motivo válido', PIN_RARO)).toMatchObject({ ok: false, motivo: 'pin_incorrecto', mensaje: expect.stringMatching(/PIN incorrecto/) });
    expect(await anularCierre(VIG, 'motivo válido', PIN_RARO)).toMatchObject({ ok: false, motivo: 'pin_bloqueado' });
    expect(await anularCierre(VIG, 'motivo válido', PIN_RARO)).toMatchObject({ pendiente: true });
    expect(mockLocal.cierres[0].anulacionPendiente).toMatchObject({ por: 'Jorge', motivo: 'motivo válido' });
    expect(Object.keys(mockLocal.cierres[0].anulacionPendiente).sort()).toEqual(['at', 'motivo', 'por']);
    // Reintento de la anulación con PIN mal: se conserva pendiente y corta
    mockSb.rpcRespuestas = [{ data: { ok: false, motivo: 'pin_incorrecto' }, error: null }];
    expect(await syncComisiones({ pin: PIN_RARO })).toMatchObject({ ok: false, motivo: 'pin_incorrecto' });
    expect(mockLocal.cierres[0].anulacionPendiente).not.toBeNull();
    mockSb.rpcRespuestas = [{ data: null, error: ERR_BLOQUEO }];
    expect(await syncComisiones({ pin: PIN_RARO })).toMatchObject({ ok: false, motivo: 'pin_bloqueado' });
    expect(mockLocal.cierres[0].anulacionPendiente).not.toBeNull();
    nuncaPersistido();
  });

  it('AC-COM-16 S-COM-02 mensajes de rechazo del servidor (montos, totales, ajustes, pedidos, id en uso)', () => {
    expect(mensajeRechazo('montos_inconsistentes', ['R1'])).toMatch(/1 pedido/);
    expect(mensajeRechazo('totales_inconsistentes')).toMatch(/totales/);
    expect(mensajeRechazo('ajuste_invalido', ['R1', 'R2'])).toMatch(/2 ajuste/);
    expect(mensajeRechazo('pedido_invalido', ['R1'])).toMatch(/no entregados/);
    expect(mensajeRechazo('id_en_uso')).toMatch(/otro admin/);
    expect(mensajeRechazo('no_admin')).toMatch(/admin/);
    expect(mensajeRechazo('raro')).toMatch(/raro/);
    expect(mensajeRechazo(undefined)).toMatch(/sin motivo/);
  });
});

// REQ-COMR (RUN 20261014-1449): el servicio usa el modelo vigente por rubro.
describe('AC-COMR-9 AC-COMR-13 comisionesService con el modelo por vendedor y rubro', () => {
  it('AC-COMR-9 cargarDatosComisiones devuelve modelo rubro, productos, tabla de % y pendientes', async () => {
    mockLocal.tablaRubros.push({ id: 't2', vendedorId: 'uuid-carlos', rubro: 'Y', rubroClave: 'y', pct: 3, pendingSync: true });
    const d = await cargarDatosComisiones(PERIODO, { online: true });
    expect(d).toMatchObject({ modelo: 'rubro', pendientesRubro: 1, faltaMigracion005: false });
    expect(d.productos).toHaveLength(1);
    expect(d.tablaRubros).toHaveLength(2);
    // la sonda de la 005 no manda credenciales
    expect(mockSb.rubro[0]).toEqual({ fn: 'admin_leer_comisiones_rubro', args: { p_admin_id: '', p_admin_pin: '' } });
    const dash = armarDashboard({ ...d, periodo: PERIODO });
    expect(dash.modelo).toBe('rubro');
    expect(dash.totales.totalComision).toBe(75);
  });

  it('AC-COMR-9 AC-COMR-7 confirmarCierre: orden pedidos -> productos/maestros -> % (con la MISMA cred) -> RPC de cierre', async () => {
    mockLocal.tablaRubros = [{ ...FILA_CARLOS_X, pendingSync: true, editadoAt: 5 }];
    const r = await confirmarCierre({ pin: PIN, periodo: PERIODO });
    expect(r.ok).toBe(true);
    const i = (x) => mockOrden.indexOf(x);
    expect(i('pedidos')).toBeGreaterThanOrEqual(0);
    expect(i('pedidos')).toBeLessThan(i('productos'));
    expect(i('productos')).toBeLessThan(i('maestros'));
    expect(i('maestros')).toBeLessThan(i('rubro:admin_guardar_comisiones_rubro'));
    expect(i('rubro:admin_guardar_comisiones_rubro')).toBeLessThan(i('rpc:cerrar_comisiones'));
    const guardar = mockSb.rubro.find(x => x.fn === 'admin_guardar_comisiones_rubro');
    expect(guardar.args).toMatchObject(CRED);
    expect(mockSb.rpc[0].args).toMatchObject(CRED);
    // el % quedó subido (pendingSync limpio) y no se guardó el PIN
    expect(mockLocal.tablaRubros[0].pendingSync).toBe(false);
    expect(JSON.stringify(mockLocal)).not.toContain(`"${PIN}"`);
  });

  it('AC-COMR-7 con la 005 faltante no se llama a cerrar_comisiones', async () => {
    mockSb.rubroError = { code: 'PGRST202', message: 'Could not find the function public.admin_leer_comisiones_rubro' };
    const d = await cargarDatosComisiones(PERIODO, { online: true });
    expect(d.faltaMigracion005).toBe(true);
    const r = await confirmarCierre({ pin: PIN, periodo: PERIODO });
    expect(r).toMatchObject({ ok: false, motivo: 'falta_migracion_005', mensaje: expect.stringMatching(/005/) });
    expect(mockSb.rpc).toHaveLength(0);
    expect(mockLocal.cierres).toEqual([]);
  });

  it('AC-COMR-13 modelo_obsoleto y cierre_invalido se mapean a su mensaje', () => {
    expect(mensajeRechazo('modelo_obsoleto')).toBe('Actualizá la app: el cierre se calcula por vendedor y rubro.');
    expect(mensajeRechazo('cierre_invalido')).toMatch(/formato inválido/);
  });

  it('AC-COMR-7 si falla la sync de los % (PIN mal) no se cierra', async () => {
    mockLocal.tablaRubros = [{ ...FILA_CARLOS_X, pendingSync: true }];
    const sb = require('../../lib/supabase').supabase;
    const orig = sb.rpc;
    sb.rpc = (fn, args) => (fn === 'admin_guardar_comisiones_rubro'
      ? Promise.resolve({ data: { ok: false, motivo: 'no_autorizado' }, error: null })
      : orig(fn, args));
    try {
      const r = await confirmarCierre({ pin: PIN, periodo: PERIODO });
      expect(r).toMatchObject({ ok: false, motivo: 'no_autorizado' });
      expect(mockSb.rpc).toHaveLength(0);
    } finally {
      sb.rpc = orig;
    }
  });
});

describe('S-COMR-05 AC-COMR-13 mensajes de rechazo nuevos identifican los pedidos', () => {
  it('S-COMR-05 monto_desbordado y desglose_inconsistente listan los pedidos', () => {
    expect(mensajeRechazo('monto_desbordado', ['R7', 'R9'])).toMatch(/2 pedido\(s\).*R7, R9/);
    expect(mensajeRechazo('desglose_inconsistente', ['R3'])).toMatch(/1 pedido\(s\).*R3/);
  });
});
