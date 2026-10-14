// REQ-COMR (RUN 20261014-1449): servicio de la tabla de % por vendedor y rubro
// (AC-COMR-6, 7, 8) con IndexedDB y Supabase mockeados.
const mockLocal = { tabla: [], vendedores: [] };
jest.mock('../../db', () => {
  const impl = {
    getVendedores: async () => mockLocal.vendedores,
    getComisionesRubro: async () => mockLocal.tabla.map(f => ({ ...f })),
    putComisionesRubroLocal: async (rows) => impl.putComisionesRubroRemotos(rows.map(r => ({ ...r, pendingSync: true }))),
    putComisionesRubroRemotos: async (rows) => {
      for (const r of rows || []) {
        const i = mockLocal.tabla.findIndex(f => f.id === r.id);
        if (i >= 0) mockLocal.tabla[i] = { ...r }; else mockLocal.tabla.push({ ...r });
      }
    },
    clearComisionesRubroPendingSync: async (ids) => {
      const set = new Set(ids || []);
      mockLocal.tabla = mockLocal.tabla.map(f => (set.has(f.id) && f.pendingSync ? { ...f, pendingSync: false } : f));
    },
  };
  const mod = { __impl: impl };
  for (const k of Object.keys(impl)) mod[k] = jest.fn(impl[k]);
  return mod;
});
const mockSb = { llamadas: [], respuestas: {}, hook: null };
jest.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: (fn, args) => {
      mockSb.llamadas.push({ fn, args });
      if (mockSb.hook) mockSb.hook(fn, args);
      const r = mockSb.respuestas[fn];
      const v = typeof r === 'function' ? r(args) : r;
      return Promise.resolve(v || { data: { ok: true, filas: [] }, error: null });
    },
  },
}));

import * as db from '../../db';
import {
  syncComisionesRubro, guardarPctsVendedor, contarPendientesRubro, cargarTablaRubros, sondearMigracion005,
  credencialesAdminRubro, MSG_FALTA_MIGRACION_005,
} from '../comisionesRubroService';
import { setUsuarioSesion } from '../sesion';

const PIN = '481516';
const CRED = { p_admin_id: 'u-jorge', p_admin_pin: PIN };
const ANA = { id: 2, remoteId: 'u-ana', nombre: 'Ana', permiso: 2 };
const fila = (o) => ({ id: 'f1', vendedorId: 'u-ana', vendedorNombre: 'Ana', rubro: 'Golosinas', rubroClave: 'golosinas', clave: 'u-ana|golosinas', pct: 5, editadoAt: 10, pendingSync: true, ...o });
// Respuesta de guardar: acepta todo con el mismo id (o el que diga `canon`).
const aceptarTodo = (canon = {}) => (args) => ({
  data: { ok: true, filas: args.p_filas.map(f => ({ ...f, id_enviado: f.id, id: canon[f.id] || f.id })), rechazadas: [] }, error: null,
});
const setOnline = (v) => Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => v });

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(db.__impl)) db[k].mockImplementation(db.__impl[k]);
  mockLocal.tabla = [];
  mockLocal.vendedores = [{ id: 1, remoteId: 'u-jorge', nombre: 'Jorge', permiso: 1 }, ANA];
  mockSb.llamadas = []; mockSb.respuestas = {}; mockSb.hook = null;
  setUsuarioSesion({ id: 1, nombre: 'Jorge', permiso: 1 });
  setOnline(true);
});
afterEach(() => setUsuarioSesion(null));

describe('AC-COMR-7 syncComisionesRubro', () => {
  it('AC-COMR-7 sube SOLO los pendientes y limpia SOLO los ids aceptados; después baja y mezcla', async () => {
    mockLocal.tabla = [fila({}), fila({ id: 'f2', rubro: 'Bebidas', rubroClave: 'bebidas', clave: 'u-ana|bebidas', pendingSync: false })];
    mockSb.respuestas.admin_guardar_comisiones_rubro = aceptarTodo();
    mockSb.respuestas.admin_leer_comisiones_rubro = { data: { ok: true, filas: [
      { id: 'f1', vendedor_id: 'u-ana', rubro: 'Golosinas', rubro_clave: 'golosinas', pct: 5 },
      { id: 'f3', vendedor_id: 'u-ana', rubro: 'Lácteos', rubro_clave: 'lacteos', pct: 2 },
    ] }, error: null };
    const r = await syncComisionesRubro({ pin: PIN });
    expect(r).toMatchObject({ ok: true, subidos: 1, pendientes: 0 });
    const guardar = mockSb.llamadas.find(x => x.fn === 'admin_guardar_comisiones_rubro');
    expect(guardar.args).toMatchObject(CRED);
    expect(guardar.args.p_filas.map(f => f.id)).toEqual(['f1']);
    expect(db.clearComisionesRubroPendingSync).toHaveBeenCalledWith(['f1']);
    expect(mockLocal.tabla.map(f => [f.id, f.pendingSync, f.pct])).toEqual([['f1', false, 5], ['f2', false, 5], ['f3', false, 2]]);
  });

  it('AC-COMR-7 un % editado DURANTE la subida sigue pendiente (no se limpia)', async () => {
    mockLocal.tabla = [fila({})];
    mockSb.hook = (fn) => {
      if (fn === 'admin_guardar_comisiones_rubro') mockLocal.tabla[0] = { ...mockLocal.tabla[0], pct: 7, editadoAt: 99, pendingSync: true };
    };
    mockSb.respuestas.admin_guardar_comisiones_rubro = aceptarTodo();
    const r = await syncComisionesRubro({ pin: PIN });
    expect(db.clearComisionesRubroPendingSync).toHaveBeenCalledWith([]);
    expect(mockLocal.tabla[0]).toMatchObject({ pct: 7, pendingSync: true });
    expect(r.pendientes).toBe(1);
  });

  it('AC-COMR-7 rechazadas quedan marcadas (syncRechazo) y no bloquean como pendientes', async () => {
    mockLocal.tabla = [fila({})];
    mockSb.respuestas.admin_guardar_comisiones_rubro = { data: { ok: true, filas: [], rechazadas: [{ id: 'f1', motivo: 'vendedor_inactivo' }] }, error: null };
    const r = await syncComisionesRubro({ pin: PIN });
    expect(r.rechazados).toEqual([{ id: 'f1', motivo: 'vendedor_inactivo', mensaje: expect.stringMatching(/baja/) }]);
    expect(mockLocal.tabla[0]).toMatchObject({ pendingSync: false, syncRechazo: 'vendedor_inactivo' });
  });

  it('AC-COMR-7 id canónico distinto (otro dispositivo cargó lo mismo): la local queda obsoleta y NO se borra', async () => {
    mockLocal.tabla = [fila({ id: 'mio' })];
    mockSb.respuestas.admin_guardar_comisiones_rubro = aceptarTodo({ mio: 'canon' });
    mockSb.respuestas.admin_leer_comisiones_rubro = { data: { ok: true, filas: [{ id: 'canon', vendedor_id: 'u-ana', rubro: 'Golosinas', rubro_clave: 'golosinas', pct: 5 }] }, error: null };
    await syncComisionesRubro({ pin: PIN });
    expect(mockLocal.tabla.map(f => [f.id, !!f.obsoleto, f.pendingSync])).toEqual([['mio', true, false], ['canon', false, false]]);
    expect(await contarPendientesRubro()).toBe(0);
  });

  it('AC-COMR-7 falta la 005: no lanza, los pendientes siguen pendientes y avisa', async () => {
    mockLocal.tabla = [fila({})];
    mockSb.respuestas.admin_guardar_comisiones_rubro = { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };
    const r = await syncComisionesRubro({ pin: PIN });
    expect(r).toMatchObject({ ok: false, faltaMigracion: true, motivo: 'falta_migracion', mensaje: MSG_FALTA_MIGRACION_005, pendientes: 1 });
    expect(mockLocal.tabla[0].pendingSync).toBe(true);
    // sin pendientes, la lectura también tolera la RPC inexistente
    mockLocal.tabla = [];
    mockSb.respuestas.admin_leer_comisiones_rubro = { data: null, error: { code: '42883', message: 'function does not exist' } };
    expect(await syncComisionesRubro({ pin: PIN })).toMatchObject({ ok: false, faltaMigracion: true });
    expect(await sondearMigracion005()).toEqual({ faltaMigracion: true });
  });

  it('AC-COMR-7 sin PIN (runSync en segundo plano) no llama a la RPC: solo cuenta pendientes', async () => {
    mockLocal.tabla = [fila({}), fila({ id: 'f2', obsoleto: true })];
    expect(await syncComisionesRubro()).toEqual({ ok: true, skipped: true, sinPin: true, pendientes: 1 });
    expect(mockSb.llamadas).toEqual([]);
  });

  it('AC-COMR-7 no admin: no hace nada; admin sin id remoto o PIN inválido: no llama', async () => {
    setUsuarioSesion({ id: 2, nombre: 'Ana', permiso: 2 });
    expect(await syncComisionesRubro({ pin: PIN })).toEqual({ ok: true, skipped: true });
    expect(await guardarPctsVendedor({ vendedor: ANA, cambios: [{ rubro: 'X', pct: '1' }] })).toMatchObject({ ok: false, motivo: 'permiso' });
    setUsuarioSesion({ id: 1, nombre: 'Jorge', permiso: 1 });
    expect(await syncComisionesRubro({ pin: '   ' })).toMatchObject({ ok: false, motivo: 'pin_requerido' });
    mockLocal.vendedores = [{ id: 1, nombre: 'Jorge', permiso: 1 }];
    expect(await credencialesAdminRubro(PIN)).toMatchObject({ ok: false, motivo: 'sin_id_remoto' });
    expect(mockSb.llamadas).toEqual([]);
  });

  it('AC-COMR-7 PIN incorrecto o bloqueado: corta y no limpia nada', async () => {
    mockLocal.tabla = [fila({})];
    mockSb.respuestas.admin_guardar_comisiones_rubro = { data: { ok: false, motivo: 'no_autorizado' }, error: null };
    expect(await syncComisionesRubro({ pin: PIN })).toMatchObject({ ok: false, motivo: 'no_autorizado', pendientes: 1 });
    mockSb.respuestas.admin_guardar_comisiones_rubro = { data: null, error: { code: 'P0001', message: 'Demasiados intentos' } };
    expect(await syncComisionesRubro({ pin: PIN })).toMatchObject({ ok: false, motivo: 'pin_bloqueado' });
    expect(db.clearComisionesRubroPendingSync).not.toHaveBeenCalled();
  });

  it('AC-COMR-7 sondearMigracion005 no manda credenciales y tolera errores de red', async () => {
    expect(await sondearMigracion005()).toEqual({ faltaMigracion: false });
    expect(mockSb.llamadas[0]).toEqual({ fn: 'admin_leer_comisiones_rubro', args: { p_admin_id: '', p_admin_pin: '' } });
    mockSb.respuestas.admin_leer_comisiones_rubro = { data: null, error: { message: 'Failed to fetch' } };
    expect(await sondearMigracion005()).toEqual({ faltaMigracion: false });
    mockSb.respuestas.admin_leer_comisiones_rubro = () => { throw new Error('boom'); };
    expect(await sondearMigracion005()).toEqual({ faltaMigracion: false });
  });
});

describe('AC-COMR-6 AC-COMR-8 guardarPctsVendedor', () => {
  it('AC-COMR-6 valida TODO antes de escribir: una fila inválida no guarda ninguna', async () => {
    const r = await guardarPctsVendedor({ vendedor: ANA, cambios: [{ rubro: 'Golosinas', pct: '5' }, { rubro: 'Bebidas', pct: '100,01' }] });
    expect(r).toMatchObject({ ok: false, motivo: 'validacion', errores: { Bebidas: expect.any(String) } });
    expect(db.putComisionesRubroLocal).not.toHaveBeenCalled();
  });

  it('AC-COMR-6 sin PIN: guarda local con pendingSync (vaciar = null) y avisa que falta subir', async () => {
    const r = await guardarPctsVendedor({ vendedor: ANA, cambios: [{ rubro: 'Golosinas', pct: '5,5' }, { rubro: 'Bebidas', pct: '' }] });
    expect(r).toMatchObject({ ok: true, guardados: 2, sincronizado: false });
    expect(mockLocal.tabla.map(f => [f.vendedorId, f.rubro, f.pct, f.pendingSync, f.editadoPor])).toEqual([
      ['u-ana', 'Golosinas', 5.5, true, 'Jorge'], ['u-ana', 'Bebidas', null, true, 'Jorge'],
    ]);
    expect(mockLocal.tabla[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(mockSb.llamadas).toEqual([]);
    // editar el mismo rubro reutiliza el id (único por vendedor + rubro)
    const id = mockLocal.tabla[0].id;
    await guardarPctsVendedor({ vendedor: ANA, cambios: [{ rubro: 'GOLOSINAS', pct: '6' }] });
    expect(mockLocal.tabla.filter(f => f.rubroClave === 'golosinas')).toHaveLength(1);
    expect(mockLocal.tabla[0]).toMatchObject({ id, pct: 6 });
    expect(await guardarPctsVendedor({ vendedor: ANA, cambios: [] })).toEqual({ ok: true, guardados: 0 });
  });

  it('AC-COMR-7 con PIN y conexión: guarda y sincroniza; el PIN no queda en IndexedDB', async () => {
    mockSb.respuestas.admin_guardar_comisiones_rubro = aceptarTodo();
    const r = await guardarPctsVendedor({ vendedor: ANA, cambios: [{ rubro: 'Golosinas', pct: '5' }], pin: PIN });
    expect(r).toMatchObject({ ok: true, sincronizado: true, mensaje: 'Guardado y sincronizado.' });
    expect(mockLocal.tabla[0].pendingSync).toBe(false);
    expect(JSON.stringify(mockLocal)).not.toContain(PIN);
    for (const k of Object.keys(db.__impl)) expect(JSON.stringify(db[k].mock.calls)).not.toContain(PIN);
    // si la sync falla, queda guardado local con el motivo
    mockSb.respuestas.admin_guardar_comisiones_rubro = { data: { ok: false, motivo: 'no_autorizado' }, error: null };
    const r2 = await guardarPctsVendedor({ vendedor: ANA, cambios: [{ rubro: 'Golosinas', pct: '9' }], pin: PIN });
    expect(r2).toMatchObject({ ok: true, sincronizado: false, mensaje: expect.stringMatching(/Guardado en este dispositivo\. PIN incorrecto/) });
    // offline: no intenta subir
    mockSb.llamadas = [];
    await guardarPctsVendedor({ vendedor: ANA, cambios: [{ rubro: 'Golosinas', pct: '8' }], pin: PIN, online: false });
    expect(mockSb.llamadas).toEqual([]);
  });

  it('AC-COMR-8 vendedor sin remoteId o dado de baja: no se le cargan %', async () => {
    expect(await guardarPctsVendedor({ vendedor: { id: 9, nombre: 'Nuevo' }, cambios: [{ rubro: 'X', pct: '1' }] })).toMatchObject({ ok: false, motivo: 'sin_id_remoto' });
    expect(await guardarPctsVendedor({ vendedor: { ...ANA, activo: false }, cambios: [{ rubro: 'X', pct: '1' }] })).toMatchObject({ ok: false, motivo: 'vendedor_inactivo' });
    expect(await guardarPctsVendedor()).toMatchObject({ ok: false });
    expect(await cargarTablaRubros()).toEqual([]);
  });
});
