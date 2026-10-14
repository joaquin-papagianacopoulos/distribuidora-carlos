// Auditoría de seguridad REQ-COMR (RUN 20261014-1449): servicio de % por rubro.
// Sonda de la 005 sin credenciales, gating por rol, PIN que no se persiste ni
// se loguea. IndexedDB y Supabase mockeados.
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
const mockSb = { llamadas: [], respuestas: {} };
jest.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: (fn, args) => {
      mockSb.llamadas.push({ fn, args });
      const r = mockSb.respuestas[fn];
      const v = typeof r === 'function' ? r(args) : r;
      return Promise.resolve(v || { data: { ok: true, filas: [] }, error: null });
    },
  },
}));

import * as db from '../../db';
import { syncComisionesRubro, guardarPctsVendedor, sondearMigracion005, credencialesAdminRubro } from '../comisionesRubroService';
import { setUsuarioSesion } from '../sesion';

const PIN = '739182';
const ANA = { id: 2, remoteId: 'u-ana', nombre: 'Ana', permiso: 2, activo: true };
const setOnline = (v) => Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => v });
let spies = [];

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(db.__impl)) db[k].mockImplementation(db.__impl[k]);
  mockLocal.tabla = [];
  mockLocal.vendedores = [{ id: 1, remoteId: 'u-jorge', nombre: 'Jorge', permiso: 1 }, ANA];
  mockSb.llamadas = []; mockSb.respuestas = {};
  setOnline(true);
  spies = ['log', 'info', 'warn', 'error', 'debug'].map(m => jest.spyOn(console, m).mockImplementation(() => {}));
});
afterEach(() => {
  setUsuarioSesion(null);
  spies.forEach(s => s.mockRestore());
});

const logueado = () => spies.flatMap(s => s.mock.calls).map(a => JSON.stringify(a)).join('\n');

describe('S-COMR sonda "falta la 005"', () => {
  it('AC-COMR-7 manda id y PIN VACÍOS (nunca credenciales reales) y una sola llamada', async () => {
    setUsuarioSesion({ id: 1, nombre: 'Jorge', permiso: 1 });
    mockSb.respuestas.admin_leer_comisiones_rubro = { data: { ok: false, motivo: 'no_autorizado' }, error: null };
    expect(await sondearMigracion005()).toEqual({ faltaMigracion: false });
    expect(mockSb.llamadas).toEqual([{ fn: 'admin_leer_comisiones_rubro', args: { p_admin_id: '', p_admin_pin: '' } }]);
  });

  it('AC-COMR-7 solo "función inexistente" cuenta como falta; un error cualquiera no (no es oráculo de otra cosa)', async () => {
    mockSb.respuestas.admin_leer_comisiones_rubro = { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };
    expect(await sondearMigracion005()).toEqual({ faltaMigracion: true });
    mockSb.respuestas.admin_leer_comisiones_rubro = { data: null, error: { code: '42501', message: 'permission denied' } };
    expect(await sondearMigracion005()).toEqual({ faltaMigracion: false });
    mockSb.respuestas.admin_leer_comisiones_rubro = () => { throw new Error('boom'); };
    expect(await sondearMigracion005()).toEqual({ faltaMigracion: false });
  });

  it('S-COMR si un servidor hostil devolviera filas a la sonda, el servicio no las guarda', async () => {
    mockSb.respuestas.admin_leer_comisiones_rubro = { data: { ok: true, filas: [{ id: 'x', vendedor_id: 'u-ana', rubro: 'X', rubro_clave: 'x', pct: 50 }] }, error: null };
    await sondearMigracion005();
    expect(db.putComisionesRubroRemotos).not.toHaveBeenCalled();
    expect(mockLocal.tabla).toEqual([]);
  });
});

describe('S-COMR gating por rol (vendedor / armador / permiso forjado)', () => {
  it.each([
    [{ id: 2, nombre: 'Ana', permiso: 2 }],
    [{ id: 3, nombre: 'Armando', permiso: 3 }],
    [null],
  ])('AC-COMR-6 %p no guarda %, no sincroniza y no llama a ninguna RPC', async (sesion) => {
    setUsuarioSesion(sesion);
    const g = await guardarPctsVendedor({ vendedor: ANA, cambios: [{ rubro: 'Golosinas', pct: '50' }], pin: PIN, online: true });
    expect(g).toMatchObject({ ok: false, motivo: 'permiso' });
    expect(await syncComisionesRubro({ pin: PIN })).toMatchObject({ ok: true, skipped: true });
    expect(mockSb.llamadas).toEqual([]);
    expect(db.putComisionesRubroLocal).not.toHaveBeenCalled();
  });

  it('S-COM-11 un permiso "1" en texto no habilita (setUsuarioSesion normaliza con Number, esAdmin exige número)', async () => {
    // la sesión normaliza a número; un valor raro (p. ej. "admin") no da admin
    setUsuarioSesion({ id: 2, nombre: 'Ana', permiso: 'admin' });
    const g = await guardarPctsVendedor({ vendedor: ANA, cambios: [{ rubro: 'Golosinas', pct: '50' }], pin: PIN });
    expect(g.ok).toBe(false);
    expect(mockSb.llamadas).toEqual([]);
  });
});

describe('S-COMR el PIN no se persiste ni se loguea', () => {
  it('AC-COMR-7 viaja solo en la RPC; no queda en IndexedDB ni en console.*', async () => {
    setUsuarioSesion({ id: 1, nombre: 'Jorge', permiso: 1 });
    mockSb.respuestas.admin_guardar_comisiones_rubro = (args) => ({
      data: { ok: true, filas: args.p_filas.map(f => ({ ...f, id_enviado: f.id })), rechazadas: [] }, error: null,
    });
    const r = await guardarPctsVendedor({ vendedor: ANA, cambios: [{ rubro: 'Golosinas', pct: '5' }], pin: PIN, online: true });
    expect(r.ok).toBe(true);
    const guardar = mockSb.llamadas.find(x => x.fn === 'admin_guardar_comisiones_rubro');
    expect(guardar.args.p_admin_pin).toBe(PIN);
    expect(JSON.stringify(guardar.args.p_filas)).not.toContain(PIN);
    expect(JSON.stringify(mockLocal.tabla)).not.toContain(PIN);
    for (const k of Object.keys(db.__impl)) {
      expect(JSON.stringify(db[k].mock.calls)).not.toContain(PIN);
    }
    expect(logueado()).not.toContain(PIN);
    expect(JSON.stringify(r)).not.toContain(PIN);
  });

  it('S-COMR con error del servidor el mensaje no repite el PIN', async () => {
    setUsuarioSesion({ id: 1, nombre: 'Jorge', permiso: 1 });
    mockLocal.tabla = [{ id: 'f1', vendedorId: 'u-ana', rubro: 'Golosinas', rubroClave: 'golosinas', pct: 5, editadoAt: 1, pendingSync: true }];
    mockSb.respuestas.admin_guardar_comisiones_rubro = { data: null, error: { code: 'P0001', message: 'Demasiados intentos. Proba de nuevo en 15 minutos.' } };
    const r = await syncComisionesRubro({ pin: PIN });
    expect(r).toMatchObject({ ok: false, motivo: 'pin_bloqueado' });
    expect(JSON.stringify(r)).not.toContain(PIN);
    expect(logueado()).not.toContain(PIN);
    expect(mockLocal.tabla[0].pendingSync).toBe(true);
  });

  it('S-COMR credencialesAdminRubro usa el remoteId del admin de la SESIÓN (no uno elegido por parámetro)', async () => {
    setUsuarioSesion({ id: 1, nombre: 'Jorge', permiso: 1 });
    const c = await credencialesAdminRubro(PIN);
    expect(c).toMatchObject({ ok: true, cred: { p_admin_id: 'u-jorge', p_admin_pin: PIN } });
    expect(await credencialesAdminRubro('')).toMatchObject({ ok: false, motivo: 'pin_requerido' });
    expect(await credencialesAdminRubro('1\u0000')).toMatchObject({ ok: false });
  });
});
