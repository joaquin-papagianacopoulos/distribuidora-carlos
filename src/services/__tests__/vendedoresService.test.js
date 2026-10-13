// S-COM-13 (iteracion 3): login online, pull de vendedores sin pin y alta/edicion
// por rpc('admin_guardar_vendedor'). Supabase e IndexedDB falsos.
// Funciones planas (CRA usa resetMocks: un jest.fn perderia la implementacion).
const mockLocal = { vendedores: [], adds: [], updates: [] };
jest.mock('../../db', () => ({
  getVendedores: async () => mockLocal.vendedores.map(v => ({ ...v })),
  putVendedoresBatch: async (rows) => { for (const r of rows) mockLocal.vendedores.push({ ...r }); },
  addVendedor: async (v) => { mockLocal.adds.push({ ...v }); mockLocal.vendedores.push({ ...v }); return 99; },
  updateVendedor: async (v) => { mockLocal.updates.push({ ...v }); mockLocal.vendedores = mockLocal.vendedores.map(x => (x.id === v.id ? { ...v } : x)); },
}));
jest.mock('../../services/imageSearch', () => ({
  isImageSearchConfigured: () => false, fetchProductImage: jest.fn(), ImageSearchQuotaError: class extends Error {},
}));

const mockSb = { rpc: [], rpcRespuestas: [], selects: [], selectRespuestas: [], inserts: [], lanzar: false };
jest.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: (fn, args) => {
      mockSb.rpc.push({ fn, args });
      if (mockSb.lanzar) return Promise.reject(new TypeError('Failed to fetch'));
      return Promise.resolve(mockSb.rpcRespuestas.shift() || { data: null, error: null });
    },
    from: (table) => {
      const q = { table, cols: null, filtros: [] };
      const api = {
        select: (cols) => { q.cols = cols; mockSb.selects.push(q); return api; },
        insert: (row) => { mockSb.inserts.push({ table, row }); return api; },
        eq: (c, v) => { q.filtros.push([c, v]); return api; },
        range: () => api,
        single: () => Promise.resolve({ data: { id: 50 }, error: null }),
        maybeSingle: () => {
          if (mockSb.lanzar) return Promise.reject(new TypeError('Failed to fetch'));
          return Promise.resolve(mockSb.selectRespuestas.shift() || { data: null, error: null });
        },
        then: (res, rej) => Promise.resolve(mockSb.selectRespuestas.shift() || { data: [], error: null }).then(res, rej),
      };
      return api;
    },
  },
}));

// eslint-disable-next-line import/first
import { iniciarIngreso, verificarPinIngreso, guardarVendedorAdmin } from '../vendedoresService';
// eslint-disable-next-line import/first
import { downloadVendedores, syncVendedor } from '../../sync/syncService';

const ADMIN = { id: 1, remoteId: 7, nombre: 'Jorge', permiso: 1, tienePin: true };
const PIN = '4821';

beforeEach(() => {
  jest.clearAllMocks();
  mockLocal.vendedores = [];
  mockLocal.adds = [];
  mockLocal.updates = [];
  Object.assign(mockSb, { rpc: [], rpcRespuestas: [], selects: [], selectRespuestas: [], inserts: [], lanzar: false });
});

describe('AC-SEC-4 S-COM-13 ingreso 100 % online', () => {
  it('AC-SEC-4 S-COM-13 sin conexion no llama al servidor y no deja entrar', async () => {
    expect(await iniciarIngreso(ADMIN, { online: false })).toMatchObject({ accion: 'sin_conexion', mensaje: expect.stringMatching(/Necesitás conexión/) });
    expect(await verificarPinIngreso(ADMIN, PIN, { online: false })).toMatchObject({ ok: false, motivo: 'sin_conexion' });
    expect(mockSb.rpc).toEqual([]);
    expect(mockSb.selects).toEqual([]);
  });

  it('AC-SEC-4 S-COM-13 con PIN: verifica con rpc verificar_pin (id remoto en texto); true => ok', async () => {
    expect(await iniciarIngreso(ADMIN, { online: true })).toMatchObject({ accion: 'pedir_pin' });
    mockSb.rpcRespuestas = [{ data: true, error: null }];
    expect(await verificarPinIngreso(ADMIN, ` ${PIN} `, { online: true })).toMatchObject({ ok: true });
    expect(mockSb.rpc).toEqual([{ fn: 'verificar_pin', args: { p_vendedor_id: '7', p_pin: PIN } }]);
  });

  it('AC-SEC-4 S-COM-13 un pin legacy en el registro local NO alcanza: manda el servidor', async () => {
    const legacy = { ...ADMIN, tienePin: undefined, pin: PIN };
    mockSb.rpcRespuestas = [{ data: false, error: null }];
    expect(await verificarPinIngreso(legacy, PIN, { online: true })).toMatchObject({ ok: false, motivo: 'pin_incorrecto' });
  });

  it('AC-SEC-4 S-COM-13 bloqueo por intentos y red caida durante la verificacion', async () => {
    mockSb.rpcRespuestas = [{ data: null, error: { code: 'P0001', message: 'Demasiados intentos. Proba de nuevo en 15 minutos.' } }];
    expect(await verificarPinIngreso(ADMIN, '0000', { online: true })).toMatchObject({ ok: false, motivo: 'bloqueado', mensaje: expect.stringMatching(/15 minutos/) });
    mockSb.lanzar = true;
    expect(await verificarPinIngreso(ADMIN, '0000', { online: true })).toMatchObject({ ok: false, motivo: 'sin_conexion' });
    expect(await iniciarIngreso({ ...ADMIN, tienePin: false }, { online: true })).toMatchObject({ accion: 'sin_conexion' });
  });

  it('AC-SEC-4 S-COM-13 usuario con PIN sin remoteId no se puede verificar', async () => {
    expect(await verificarPinIngreso({ ...ADMIN, remoteId: null }, PIN, { online: true })).toMatchObject({ ok: false, motivo: 'sin_sincronizar' });
    expect(mockSb.rpc).toEqual([]);
  });

  it('AC-SEC-4 S-COM-13 sin PIN local: se confirma con el servidor (si el servidor dice que tiene PIN, se pide)', async () => {
    const sinPin = { id: 2, remoteId: 8, nombre: 'Carlos', permiso: 2, tienePin: false };
    mockSb.selectRespuestas = [{ data: { id: 8, tiene_pin: true, permiso: 2 }, error: null }];
    expect(await iniciarIngreso(sinPin, { online: true })).toMatchObject({ accion: 'pedir_pin' });
    // REQ-VEN: la consulta incluye "activo" (004) para no dejar entrar a un dado de baja.
    expect(mockSb.selects[0]).toMatchObject({ table: 'vendedores', cols: 'id,tiene_pin,permiso,activo', filtros: [['id', 8]] });
    mockSb.selectRespuestas = [{ data: { id: 8, tiene_pin: false, permiso: 2 }, error: null }];
    expect(await iniciarIngreso(sinPin, { online: true })).toMatchObject({ accion: 'entrar' });
    mockSb.selectRespuestas = [{ data: null, error: null }];
    expect(await iniciarIngreso(sinPin, { online: true })).toMatchObject({ accion: 'no_existe' });
    // 002 PASO 1 sin correr (no existe tiene_pin): se respeta lo local.
    // REQ-VEN: primero falla por "activo" (004) y el reintento sin activo falla por tiene_pin.
    mockSb.selectRespuestas = [
      { data: null, error: { code: '42703', message: 'column vendedores.activo does not exist' } },
      { data: null, error: { code: '42703', message: 'column vendedores.tiene_pin does not exist' } },
    ];
    expect(await iniciarIngreso(sinPin, { online: true })).toMatchObject({ accion: 'entrar' });
    // vendedor solo-local (nunca llego al servidor)
    expect(await iniciarIngreso({ id: 3, nombre: 'Nuevo' }, { online: true })).toMatchObject({ accion: 'entrar' });
  });
});

describe('AC-SEC-4 S-COM-13 pull de vendedores sin pin', () => {
  it('AC-SEC-4 S-COM-13 downloadVendedores: select explicito y no guarda pin (aunque el servidor lo mande)', async () => {
    mockLocal.vendedores = [{ id: 1, remoteId: 7, nombre: 'Jorge', permiso: 1, pin: '4821', createdAt: 1 }];
    mockSb.selectRespuestas = [{ data: [{ id: 7, nombre: 'Jorge', zona: '', permiso: 1, tiene_pin: true, pin: '4821' }], error: null }];
    await downloadVendedores();
    expect(mockSb.selects.map(s => s.cols)).toEqual(['id,nombre,zona,permiso,tiene_pin,activo']);
    const guardado = mockLocal.vendedores[mockLocal.vendedores.length - 1];
    expect(guardado).toMatchObject({ id: 1, remoteId: 7, permiso: 1, tienePin: true });
    expect(guardado).not.toHaveProperty('pin');
    expect(JSON.stringify(guardado)).not.toContain('4821');
  });

  it('AC-SEC-4 S-COM-13 si falta tiene_pin (002 sin correr) reintenta con las columnas basicas', async () => {
    // REQ-VEN: sin 002 tampoco hay 004; primero cae "activo", despues "tiene_pin".
    mockSb.selectRespuestas = [
      { data: null, error: { code: '42703', message: 'column vendedores.activo does not exist' } },
      { data: null, error: { code: '42703', message: 'column vendedores.tiene_pin does not exist' } },
      { data: [{ id: 9, nombre: 'Ana', permiso: 3 }], error: null },
    ];
    expect(await downloadVendedores()).toMatchObject({ ok: true, count: 1 });
    expect(mockSb.selects.map(s => s.cols)).toEqual(['id,nombre,zona,permiso,tiene_pin,activo', 'id,nombre,zona,permiso,tiene_pin', 'id,nombre,zona,permiso']);
  });

  it('AC-SEC-4 S-COM-13 otros errores del pull se propagan', async () => {
    mockSb.selectRespuestas = [{ data: null, error: { code: '42501', message: 'permission denied' } }];
    await expect(downloadVendedores()).rejects.toMatchObject({ code: '42501' });
  });

  it('AC-SEC-4 S-COM-13 auto-alta desde el ingreso: insert sin pin y con permiso 2', async () => {
    expect(await syncVendedor({ nombre: 'Nuevo', zona: 'Sur', permiso: 1, pin: '1234' })).toBe(50);
    expect(mockSb.inserts).toEqual([{ table: 'vendedores', row: { nombre: 'Nuevo', zona: 'Sur', permiso: 2 } }]);
  });
});

describe('AC-SEC-2 S-COM-13 alta/edicion por admin_guardar_vendedor', () => {
  it('AC-SEC-2 S-COM-13 alta de un admin con PIN: RPC con PIN del admin y local SIN pin', async () => {
    mockSb.rpcRespuestas = [{ data: '15', error: null }];
    const r = await guardarVendedorAdmin({ admin: ADMIN, adminPin: PIN, form: { nombre: 'Marta', zona: 'Centro', permiso: 1, pin: '987654' }, online: true });
    expect(r).toEqual({ ok: true, id: '15' });
    expect(mockSb.rpc).toEqual([{ fn: 'admin_guardar_vendedor', args: {
      p_admin_id: '7', p_admin_pin: PIN, p_vendedor_id: null, p_nombre: 'Marta', p_zona: 'Centro', p_permiso: 1, p_pin_nuevo: '987654', p_borrar_pin: false,
    } }]);
    expect(mockLocal.adds).toEqual([{ nombre: 'Marta', zona: 'Centro', permiso: 1, tienePin: true, remoteId: 15 }]);
    expect(JSON.stringify(mockLocal.vendedores)).not.toMatch(/987654|4821/);
    expect(mockSb.inserts).toEqual([]); // nunca insert/upsert directo
  });

  it('AC-SEC-2 S-COM-13 edicion: usa el remoteId del editado y conserva su id local', async () => {
    mockLocal.vendedores = [{ id: 3, remoteId: 'uuid-3', nombre: 'Carlos', permiso: 2, tienePin: true }];
    mockSb.rpcRespuestas = [{ data: 'uuid-3', error: null }];
    const r = await guardarVendedorAdmin({ admin: ADMIN, adminPin: PIN, form: { nombre: 'Carlos R', permiso: 3, clearPin: true }, previo: mockLocal.vendedores[0], online: true });
    expect(r.ok).toBe(true);
    expect(mockSb.rpc[0].args).toMatchObject({ p_vendedor_id: 'uuid-3', p_permiso: 3, p_borrar_pin: true, p_pin_nuevo: null });
    expect(mockLocal.updates).toEqual([expect.objectContaining({ id: 3, remoteId: 'uuid-3', permiso: 3, tienePin: false })]);
  });

  it('AC-SEC-2 S-COM-13 PIN de admin incorrecto o no admin: no se escribe nada local', async () => {
    mockSb.rpcRespuestas = [{ data: null, error: null }];
    const r = await guardarVendedorAdmin({ admin: ADMIN, adminPin: '0000', form: { nombre: 'X', permiso: 2 }, online: true });
    expect(r).toMatchObject({ ok: false, motivo: 'no_autorizado' });
    expect(mockLocal.adds).toEqual([]);
    expect(mockLocal.updates).toEqual([]);
  });

  it('AC-SEC-2 S-COM-13 precondiciones: admin, validacion, conexion, remoteId y PIN del admin', async () => {
    const form = { nombre: 'X', permiso: 2 };
    expect(await guardarVendedorAdmin({ admin: { ...ADMIN, permiso: 2 }, adminPin: PIN, form, online: true })).toMatchObject({ motivo: 'permiso' });
    expect(await guardarVendedorAdmin({ admin: null, adminPin: PIN, form, online: true })).toMatchObject({ motivo: 'permiso' });
    expect(await guardarVendedorAdmin({ admin: ADMIN, adminPin: PIN, form: { nombre: 'Admin2', permiso: 1 }, online: true })).toMatchObject({ motivo: 'validacion', mensaje: expect.stringMatching(/admin tiene que tener PIN/) });
    expect(await guardarVendedorAdmin({ admin: ADMIN, adminPin: PIN, form, online: false })).toMatchObject({ motivo: 'sin_conexion' });
    expect(await guardarVendedorAdmin({ admin: { ...ADMIN, remoteId: null }, adminPin: PIN, form, online: true })).toMatchObject({ motivo: 'sin_id_remoto' });
    expect(await guardarVendedorAdmin({ admin: ADMIN, adminPin: '  ', form, online: true })).toMatchObject({ motivo: 'pin_requerido' });
    expect(mockSb.rpc).toEqual([]);
  });

  it('AC-SEC-2 S-COM-13 red caida o bloqueo en la RPC', async () => {
    mockSb.rpcRespuestas = [{ data: null, error: { code: 'P0001', message: 'Demasiados intentos.' } }];
    expect(await guardarVendedorAdmin({ admin: ADMIN, adminPin: PIN, form: { nombre: 'X', permiso: 2 }, online: true })).toMatchObject({ motivo: 'bloqueado' });
    mockSb.lanzar = true;
    expect(await guardarVendedorAdmin({ admin: ADMIN, adminPin: PIN, form: { nombre: 'X', permiso: 2 }, online: true })).toMatchObject({ motivo: 'sin_conexion' });
    expect(mockLocal.adds).toEqual([]);
  });
});
