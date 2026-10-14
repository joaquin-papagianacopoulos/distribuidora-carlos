// S-VTA-01: src/services/productosAdminService.js
const mockDb = { vendedores: [{ id: 'loc1', remoteId: 'r1' }], productos: [], borrados: [] };
jest.mock('../../db', () => ({
  getVendedores: async () => mockDb.vendedores,
  getProductos: async () => mockDb.productos,
  deleteProducto: async (id) => { mockDb.borrados.push(id); },
}));
const mockSync = { llamadas: [] };
jest.mock('../../sync/syncService', () => ({
  syncProductos: async (arg) => { mockSync.llamadas.push(arg); return { ok: true, subidos: 1 }; },
}));

const mockSb = { rpcs: [], resp: {}, delete: [], sel: { data: [], error: null } };
jest.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: (fn, args) => {
      mockSb.rpcs.push({ fn, args });
      const r = mockSb.resp[fn];
      if (r instanceof Error) return Promise.reject(r);
      return Promise.resolve(typeof r === 'function' ? r(args) : (r || { data: { ok: true }, error: null }));
    },
    from: () => ({
      delete: () => ({ eq: (c, id) => { mockSb.delete.push(id); return Promise.resolve({ error: null }); } }),
      select: () => ({ eq: () => Promise.resolve(mockSb.sel) }),
    }),
  },
}));

import { setUsuarioSesion } from '../sesion';
import {
  sondearMigracion007, borrarProductoAdmin, subirProductosConPin, contarProductosPendientes, credencialesAdminProductos,
} from '../productosAdminService';

const SIN_007 = { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.admin_baja_producto' } };
const SONDA_OK = { data: { ok: false, motivo: 'no_autorizado' }, error: null };

beforeEach(() => {
  mockSync.llamadas = [];
  mockDb.borrados = []; mockDb.productos = [];
  mockSb.rpcs = []; mockSb.resp = {}; mockSb.delete = []; mockSb.sel = { data: [], error: null };
  setUsuarioSesion({ id: 'loc1', nombre: 'Admin', permiso: 1 });
  Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
});

describe('S01-5 sonda y borrado', () => {
  it('S01-5 la sonda detecta 007 faltante y presente; excepcion => flujo viejo', async () => {
    mockSb.resp.admin_baja_producto = SIN_007;
    expect(await sondearMigracion007()).toEqual({ faltaMigracion: true });
    mockSb.resp.admin_baja_producto = SONDA_OK;
    expect(await sondearMigracion007()).toEqual({ faltaMigracion: false });
    mockSb.resp.admin_baja_producto = new Error('red');
    expect(await sondearMigracion007()).toEqual({ faltaMigracion: true });
  });
  it('S01-5 con 007: RPC ok => borra local', async () => {
    mockSb.resp.admin_baja_producto = (a) => (a.p_admin_id === '' ? SONDA_OK : { data: { ok: true }, error: null });
    const r = await borrarProductoAdmin({ pin: '1234', producto: { id: 5 } });
    expect(r.ok).toBe(true);
    expect(mockDb.borrados).toEqual([5]);
    const real = mockSb.rpcs.find(c => c.args.p_admin_id === 'r1');
    expect(real.args).toMatchObject({ p_admin_pin: '1234', p_producto_id: 5 });
  });
  it('S01-5 con 007: no_autorizado => NO borra local', async () => {
    mockSb.resp.admin_baja_producto = (a) => (a.p_admin_id === '' ? SONDA_OK : { data: { ok: false, motivo: 'no_autorizado' }, error: null });
    const r = await borrarProductoAdmin({ pin: '1234', producto: { id: 5 } });
    expect(r).toMatchObject({ ok: false, motivo: 'no_autorizado' });
    expect(mockDb.borrados).toEqual([]);
  });
  it('S01-5 sin 007: flujo viejo (delete + verificacion) y borra local', async () => {
    mockSb.resp.admin_baja_producto = SIN_007;
    const r = await borrarProductoAdmin({ pin: '', producto: { id: 5 } });
    expect(r.ok).toBe(true);
    expect(mockSb.delete).toEqual([5]);
    expect(mockDb.borrados).toEqual([5]);
  });
  it('S01-5 sin 007 y la fila sigue existiendo: error y no borra local', async () => {
    mockSb.resp.admin_baja_producto = SIN_007;
    mockSb.sel = { data: [{ id: 5 }], error: null };
    const r = await borrarProductoAdmin({ pin: '', producto: { id: 5 } });
    expect(r.ok).toBe(false);
    expect(mockDb.borrados).toEqual([]);
  });
  it('S01-5 offline no toca nada', async () => {
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
    const r = await borrarProductoAdmin({ pin: '1234', producto: { id: 5 } });
    expect(r).toMatchObject({ ok: false, motivo: 'offline' });
    expect(mockSb.rpcs).toHaveLength(0);
    expect(mockDb.borrados).toEqual([]);
  });
});

describe('S01-6 usuario no admin / PIN', () => {
  it('S01-6 permiso 2 y 3: nunca llama a las RPC admin', async () => {
    for (const permiso of [2, 3]) {
      setUsuarioSesion({ id: 'loc1', nombre: 'V', permiso });
      expect((await subirProductosConPin('1234')).motivo).toBe('no_admin');
      expect((await borrarProductoAdmin({ pin: '1234', producto: { id: 1 } })).motivo).toBe('no_admin');
    }
    expect(mockSb.rpcs).toHaveLength(0);
    expect(mockSync.llamadas).toHaveLength(0);
  });
  it('S01-6 sin sesion tampoco', async () => {
    setUsuarioSesion(null);
    expect((await subirProductosConPin('1234')).ok).toBe(false);
    expect(mockSync.llamadas).toHaveLength(0);
  });
  it('S01-3 subirProductosConPin pasa la credencial a syncProductos y el PIN no se guarda', async () => {
    mockDb.productos = [{ id: 1, pendingSync: true }];
    await subirProductosConPin('1234');
    expect(mockSync.llamadas).toEqual([{ cred: { p_admin_id: 'r1', p_admin_pin: '1234' } }]);
    expect(JSON.stringify(localStorage)).not.toMatch(/1234/);
    expect(JSON.stringify(sessionStorage)).not.toMatch(/1234/);
  });
  it('credenciales: PIN vacio o admin sin id remoto', async () => {
    expect((await credencialesAdminProductos('')).ok).toBe(false);
    mockDb.vendedores = [{ id: 'loc1' }];
    expect((await credencialesAdminProductos('1234')).motivo).toBe('sin_id_remoto');
    mockDb.vendedores = [{ id: 'loc1', remoteId: 'r1' }];
  });
  it('S01-3 offline no sube', async () => {
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
    expect((await subirProductosConPin('1234')).motivo).toBe('offline');
  });
  it('contarProductosPendientes cuenta pendingSync y extrasPendientes', async () => {
    mockDb.productos = [{ id: 1, pendingSync: true }, { id: 2, extrasPendientes: true }, { id: 3 }];
    expect(await contarProductosPendientes()).toBe(2);
  });
});
