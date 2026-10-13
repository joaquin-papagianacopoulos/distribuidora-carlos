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
import { iniciarIngreso, verificarPinIngreso, guardarVendedorAdmin, ingresarConPin } from '../vendedoresService';
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
    // MOD (RUN 20261012-2106, C5 / S-COM-18): ahora se lee la fila completa
    // (COLUMNAS_VENDEDOR_REMOTO, sigue incluyendo activo y nunca pin) porque la
    // sesión se arma con nombre/zona/permiso del servidor.
    expect(mockSb.selects[0]).toMatchObject({ table: 'vendedores', cols: 'id,nombre,zona,permiso,tiene_pin,activo', filtros: [['id', 8]] });
    mockSb.selectRespuestas = [{ data: { id: 8, tiene_pin: false, permiso: 2 }, error: null }];
    expect(await iniciarIngreso(sinPin, { online: true })).toMatchObject({ accion: 'entrar' });
    mockSb.selectRespuestas = [{ data: null, error: null }];
    expect(await iniciarIngreso(sinPin, { online: true })).toMatchObject({ accion: 'no_existe' });
    // 002 PASO 1 sin correr (no existe tiene_pin): se respeta lo local.
    // REQ-VEN: primero falla por "activo" (004) y el reintento sin activo falla por tiene_pin.
    // MOD (RUN 20261012-2106, C5): con el fail-open de S-COM-22(1) se lee igual
    // la fila LEGACY del servidor (3.a consulta) y la sesión sale de ahí.
    mockSb.selectRespuestas = [
      { data: null, error: { code: '42703', message: 'column vendedores.activo does not exist' } },
      { data: null, error: { code: '42703', message: 'column vendedores.tiene_pin does not exist' } },
      { data: { id: 8, nombre: 'Carlos', zona: '', permiso: 2 }, error: null },
    ];
    expect(await iniciarIngreso(sinPin, { online: true })).toMatchObject({ accion: 'entrar', vendedor: { permiso: 2, nombre: 'Carlos', remoteId: 8 } });
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

// C5 (RUN 20261012-2106) — S-COM-18: la sesión sale de la fila del servidor.
describe('AC-SEC-4 S-COM-18 ingresarConPin / iniciarIngreso con la fila del servidor', () => {
  const FILA = { id: 7, nombre: 'Jorge', zona: 'Centro', permiso: 1, tiene_pin: true, activo: true };

  it('AC-SEC-4 S-COM-18 ingresarConPin: PIN OK -> lee la fila por el remoteId verificado -> updateVendedor con los datos del servidor', async () => {
    const local = { id: 1, remoteId: 7, nombre: 'Jorge', permiso: 1, tienePin: true, createdAt: 5, extra: 'x' };
    mockLocal.vendedores = [local];
    mockSb.rpcRespuestas = [{ data: true, error: null }];
    mockSb.selectRespuestas = [{ data: { ...FILA, permiso: 2, nombre: 'Jorge S' }, error: null }];
    const r = await ingresarConPin(local, PIN, { online: true });
    expect(r.ok).toBe(true);
    expect(r.vendedor).toEqual({ id: 1, createdAt: 5, nombre: 'Jorge S', zona: 'Centro', permiso: 2, tienePin: true, remoteId: 7, activo: true });
    expect(mockSb.rpc).toEqual([{ fn: 'verificar_pin', args: { p_vendedor_id: '7', p_pin: PIN } }]);
    expect(mockSb.selects).toEqual([expect.objectContaining({ table: 'vendedores', cols: 'id,nombre,zona,permiso,tiene_pin,activo', filtros: [['id', 7]] })]);
    // Se actualiza el registro local existente (mismo id), sin borrar otros campos.
    expect(mockLocal.updates).toEqual([expect.objectContaining({ id: 1, permiso: 2, nombre: 'Jorge S', extra: 'x' })]);
    expect(mockLocal.adds).toEqual([]);
  });

  it('AC-SEC-4 S-COM-18 PIN incorrecto: no lee la fila ni toca nada local', async () => {
    mockSb.rpcRespuestas = [{ data: false, error: null }];
    expect(await ingresarConPin(ADMIN, '0000', { online: true })).toMatchObject({ ok: false, motivo: 'pin_incorrecto' });
    expect(mockSb.selects).toEqual([]);
    expect(mockLocal.updates).toEqual([]);
  });

  it('AC-SEC-4 S-COM-18 falla la lectura -> no entra', async () => {
    mockSb.rpcRespuestas = [{ data: true, error: null }];
    mockSb.selectRespuestas = [{ data: null, error: { code: '500', message: 'boom' } }];
    expect(await ingresarConPin(ADMIN, PIN, { online: true })).toMatchObject({ ok: false, motivo: 'error', mensaje: 'No se pudo confirmar tu usuario. Probá de nuevo.' });
    mockSb.rpcRespuestas = [{ data: true, error: null }];
    mockSb.selectRespuestas = [{ data: null, error: null }];
    expect(await ingresarConPin(ADMIN, PIN, { online: true })).toMatchObject({ ok: false, motivo: 'no_existe' });
    expect(mockLocal.updates).toEqual([]);
  });

  it('AC-SEC-4 S-COM-18 se cae la red entre verificar_pin y la lectura -> no entra', async () => {
    mockSb.rpcRespuestas = [{ data: true, error: null }];
    const { supabase } = require('../../lib/supabase');
    const original = supabase.from;
    supabase.from = () => { throw new TypeError('Failed to fetch'); };
    try {
      expect(await ingresarConPin(ADMIN, PIN, { online: true })).toMatchObject({ ok: false, motivo: 'sin_conexion', mensaje: 'No se pudo confirmar tu usuario. Probá de nuevo.' });
    } finally {
      supabase.from = original;
    }
  });

  it('AC-VEN-2 S-COM-18 fila inactiva -> MSG_DADO_DE_BAJA', async () => {
    mockSb.rpcRespuestas = [{ data: true, error: null }];
    mockSb.selectRespuestas = [{ data: { ...FILA, activo: false }, error: null }];
    expect(await ingresarConPin(ADMIN, PIN, { online: true })).toMatchObject({ ok: false, motivo: 'inactivo', mensaje: 'Este usuario fue dado de baja. Sincronizá vendedores.' });
  });

  it('AC-VEN-5 S-COM-18 sin la 004 -> fallback de columnas (SIN_ACTIVO)', async () => {
    mockSb.rpcRespuestas = [{ data: true, error: null }];
    mockSb.selectRespuestas = [
      { data: null, error: { code: '42703', message: 'column vendedores.activo does not exist' } },
      { data: { id: 7, nombre: 'Jorge', zona: '', permiso: 1, tiene_pin: true }, error: null },
    ];
    const r = await ingresarConPin(ADMIN, PIN, { online: true });
    expect(r).toMatchObject({ ok: true, vendedor: { permiso: 1, remoteId: 7 } });
    expect(r.vendedor).not.toHaveProperty('activo');
    expect(mockSb.selects.map(s => s.cols)).toEqual(['id,nombre,zona,permiso,tiene_pin,activo', 'id,nombre,zona,permiso,tiene_pin']);
  });

  it('AC-SEC-4 S-COM-18 si no se puede persistir la sesión local, no entra', async () => {
    const db = require('../../db');
    const original = db.updateVendedor;
    db.updateVendedor = async () => { throw new Error('IDB'); };
    try {
      mockSb.rpcRespuestas = [{ data: true, error: null }];
      mockSb.selectRespuestas = [{ data: FILA, error: null }];
      expect(await ingresarConPin(ADMIN, PIN, { online: true })).toMatchObject({ ok: false, motivo: 'error' });
      mockSb.selectRespuestas = [{ data: { id: 8, nombre: 'C', permiso: 2, tiene_pin: false, activo: true }, error: null }];
      expect(await iniciarIngreso({ id: 2, remoteId: 8, nombre: 'C', permiso: 2, tienePin: false }, { online: true })).toMatchObject({ accion: 'error' });
      expect(await iniciarIngreso({ id: 3, nombre: 'Local', permiso: 1 }, { online: true })).toMatchObject({ accion: 'error' });
    } finally {
      db.updateVendedor = original;
    }
  });

  it('AC-SEC-4 S-COM-18 iniciarIngreso consultar -> vendedor del servidor (ignora el permiso local)', async () => {
    const forjado = { id: 2, remoteId: 8, nombre: 'Carlos', permiso: 1, tienePin: false };
    mockSb.selectRespuestas = [{ data: { id: 8, nombre: 'Carlos', zona: 'Sur', permiso: 2, tiene_pin: false, activo: true }, error: null }];
    const r = await iniciarIngreso(forjado, { online: true });
    expect(r).toMatchObject({ accion: 'entrar', permiso: 2, vendedor: { id: 2, remoteId: 8, permiso: 2, zona: 'Sur' } });
    expect(mockLocal.updates).toEqual([expect.objectContaining({ id: 2, permiso: 2 })]);
  });

  it('AC-SEC-4 S-COM-18 iniciarIngreso: un solo-local entra con permiso 2 (y solo se actualiza si era distinto)', async () => {
    expect(await iniciarIngreso({ id: 3, nombre: 'Local', permiso: 1 }, { online: true })).toMatchObject({ accion: 'entrar', vendedor: { id: 3, permiso: 2 } });
    expect(mockLocal.updates).toEqual([expect.objectContaining({ id: 3, permiso: 2 })]);
    mockLocal.updates = [];
    expect(await iniciarIngreso({ id: 4, nombre: 'Local2', permiso: 2 }, { online: true })).toMatchObject({ accion: 'entrar', vendedor: { id: 4, permiso: 2 } });
    expect(mockLocal.updates).toEqual([]);
  });

  it('AC-SEC-4 sin la 002 PASO 1 y sin fila en el servidor: no_existe', async () => {
    mockSb.selectRespuestas = [
      { data: null, error: { code: '42703', message: 'column vendedores.activo does not exist' } },
      { data: null, error: { code: '42703', message: 'column vendedores.tiene_pin does not exist' } },
      { data: null, error: null },
    ];
    expect(await iniciarIngreso({ id: 2, remoteId: 8, nombre: 'C', tienePin: false }, { online: true })).toMatchObject({ accion: 'no_existe' });
  });
});

// C5b (RUN 20261012-2106) — AC-VEN-4 / S-COM-20 en el cliente.
describe('AC-VEN-4 S-COM-20 guardarVendedorAdmin no deja la base sin admin con PIN', () => {
  it('AC-VEN-4 S-COM-20 guardarVendedorAdmin no llama a la RPC si deja la base sin admin con PIN', async () => {
    const otroSinPin = { id: 2, remoteId: 8, nombre: 'Marta', permiso: 1, tienePin: false };
    mockLocal.vendedores = [{ ...ADMIN }, otroSinPin];
    // Degradar al único admin con PIN (lista leída de IndexedDB)
    expect(await guardarVendedorAdmin({ admin: ADMIN, adminPin: PIN, form: { nombre: 'Jorge', permiso: 2 }, previo: ADMIN, online: true }))
      .toMatchObject({ ok: false, motivo: 'ultimo_admin', mensaje: 'No se puede quitar el último admin activo con PIN.' });
    // Con la lista explícita también
    expect(await guardarVendedorAdmin({ admin: ADMIN, adminPin: PIN, form: { nombre: 'Jorge', permiso: 3 }, previo: ADMIN, vendedores: [ADMIN], online: true }))
      .toMatchObject({ ok: false, motivo: 'ultimo_admin' });
    expect(mockSb.rpc).toEqual([]);
    expect(mockLocal.updates).toEqual([]);
  });

  it('AC-VEN-4 S-COM-20 con otro admin activo con PIN, degradar sí llama a la RPC', async () => {
    const otro = { id: 2, remoteId: 8, nombre: 'Marta', permiso: 1, tienePin: true };
    mockSb.rpcRespuestas = [{ data: '7', error: null }];
    const r = await guardarVendedorAdmin({ admin: otro, adminPin: PIN, form: { nombre: 'Jorge', permiso: 2 }, previo: ADMIN, vendedores: [ADMIN, otro], online: true });
    expect(r.ok).toBe(true);
    expect(mockSb.rpc).toHaveLength(1);
  });

  it('AC-VEN-4 S-COM-20 los motivos nuevos de la 004 llegan como mensajes claros', async () => {
    mockSb.rpcRespuestas = [{ data: null, error: { code: 'P0001', message: 'vendedor_inactivo' } }];
    expect(await guardarVendedorAdmin({ admin: ADMIN, adminPin: PIN, form: { nombre: 'X', permiso: 2 }, previo: { id: 9, remoteId: 99, nombre: 'X', permiso: 2 }, vendedores: [ADMIN], online: true }))
      .toMatchObject({ ok: false, motivo: 'vendedor_inactivo', mensaje: 'Ese vendedor está dado de baja.' });
  });
});
