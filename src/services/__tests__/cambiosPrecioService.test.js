// REQ-HPR (AC-HPR-1): servicio de sincronización del historial de cambios de precio.
// IndexedDB y Supabase mockeados.
const mockLocal = { cambios: [] };
jest.mock('../../db', () => {
  const impl = {
    getCambiosPrecio: async () => mockLocal.cambios.map(c => ({ ...c })),
    putCambiosPrecioRemotos: async (rows) => {
      for (const r of rows || []) {
        const i = mockLocal.cambios.findIndex(c => c.id === r.id);
        if (i >= 0) mockLocal.cambios[i] = { ...r }; else mockLocal.cambios.push({ ...r });
      }
    },
    clearCambiosPrecioPendingSync: async (ids) => {
      const set = new Set(ids || []);
      mockLocal.cambios = mockLocal.cambios.map(c => (set.has(c.id) && c.pendingSync ? { ...c, pendingSync: false } : c));
    },
  };
  const mod = { __impl: impl };
  for (const k of Object.keys(impl)) mod[k] = jest.fn(impl[k]);
  return mod;
});
const mockSb = { llamadas: [], rpc: {}, selectRows: [] };
jest.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: (fn, args) => {
      mockSb.llamadas.push({ fn, args });
      const r = mockSb.rpc[fn];
      return Promise.resolve(typeof r === 'function' ? r(args) : (r || { data: { ok: true, aceptados: [], rechazados: [] }, error: null }));
    },
    from: (tabla) => {
      const q = { tabla };
      const api = {
        select: () => api,
        gte: () => api,
        lte: () => api,
        order: () => api,
        range: () => Promise.resolve({ data: mockSb.selectRows, error: null }),
      };
      return api;
    },
  },
}));

import * as db from '../../db';
import { subirCambiosPrecio, bajarCambiosPrecio, sondearMigracion010, contarCambiosPrecioPendientes } from '../cambiosPrecioService';

const CRED = { p_admin_id: 'u-jorge', p_admin_pin: '739182' };
const cambio = (id, extra = {}) => ({
  id, productoId: '1', codigo: 'A1', nombre: 'Alfajor', rubro: 'Golosinas', precioAnterior: 100, precioNuevo: 120,
  precioBultoAnterior: 0, precioBultoNuevo: 0, fecha: '2026-10-15', creadoEn: '2026-10-15T12:00:00Z', pendingSync: true, ...extra,
});

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(db.__impl)) db[k].mockImplementation(db.__impl[k]);
  mockLocal.cambios = [];
  mockSb.llamadas = []; mockSb.rpc = {}; mockSb.selectRows = [];
});

describe('AC-HPR-1 subir cambios de precio', () => {
  it('AC-HPR-1 limpia SOLO los ids aceptados; el resto sigue pendiente', async () => {
    mockLocal.cambios = [cambio('a'), cambio('b'), cambio('c')];
    mockSb.rpc.admin_registrar_cambios_precio = { data: { ok: true, aceptados: ['a', 'c'], rechazados: [] }, error: null };
    const r = await subirCambiosPrecio(CRED);
    expect(r.ok).toBe(true);
    expect(r.subidos).toBe(2);
    expect(mockLocal.cambios.find(c => c.id === 'a').pendingSync).toBe(false);
    expect(mockLocal.cambios.find(c => c.id === 'b').pendingSync).toBe(true);
    expect(mockLocal.cambios.find(c => c.id === 'c').pendingSync).toBe(false);
    expect(await contarCambiosPrecioPendientes()).toBe(1);
  });

  it('AC-HPR-1 manda columnas snake_case y las credenciales del admin', async () => {
    mockLocal.cambios = [cambio('a')];
    mockSb.rpc.admin_registrar_cambios_precio = { data: { ok: true, aceptados: ['a'], rechazados: [] }, error: null };
    await subirCambiosPrecio(CRED);
    const { args } = mockSb.llamadas[0];
    expect(args).toMatchObject({ p_admin_id: 'u-jorge', p_admin_pin: '739182' });
    expect(args.p_filas[0]).toMatchObject({ id: 'a', producto_id: '1', precio_anterior: 100, precio_nuevo: 120, fecha: '2026-10-15' });
  });

  it('AC-HPR-1 un reintento es idempotente: sin pendientes no llama al servidor', async () => {
    mockLocal.cambios = [cambio('a', { pendingSync: false })];
    const r = await subirCambiosPrecio(CRED);
    expect(r.ok).toBe(true);
    expect(mockSb.llamadas).toEqual([]);
  });

  it('AC-HPR-1 error del servidor: nada se limpia y se informa', async () => {
    mockLocal.cambios = [cambio('a')];
    mockSb.rpc.admin_registrar_cambios_precio = { data: { ok: false, motivo: 'no_autorizado' }, error: null };
    const r = await subirCambiosPrecio(CRED);
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe('no_autorizado');
    expect(mockLocal.cambios[0].pendingSync).toBe(true);
  });

  it('AC-HPR-1 sin la migración 010 los cambios quedan pendientes y se avisa', async () => {
    mockLocal.cambios = [cambio('a')];
    mockSb.rpc.admin_registrar_cambios_precio = { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };
    const r = await subirCambiosPrecio(CRED);
    expect(r.ok).toBe(false);
    expect(r.faltaMigracion).toBe(true);
    expect(mockLocal.cambios[0].pendingSync).toBe(true);
  });

  it('AC-HPR-1 un registro rechazado por datos inválidos no se reintenta para siempre', async () => {
    mockLocal.cambios = [cambio('a')];
    mockSb.rpc.admin_registrar_cambios_precio = { data: { ok: true, aceptados: [], rechazados: [{ id: 'a', motivo: 'datos_invalidos' }] }, error: null };
    const r = await subirCambiosPrecio(CRED);
    expect(r.rechazados).toHaveLength(1);
    expect(mockLocal.cambios[0]).toMatchObject({ pendingSync: false, syncRechazo: 'datos_invalidos' });
    expect(await contarCambiosPrecioPendientes()).toBe(0);
  });

  it('AC-HPR-1 sin credenciales no sube nada', async () => {
    mockLocal.cambios = [cambio('a')];
    const r = await subirCambiosPrecio(null);
    expect(r.skipped).toBe(true);
    expect(mockSb.llamadas).toEqual([]);
  });

  it('AC-HPR-1 la sonda de la 010 va con id vacío (no gasta intentos de PIN)', async () => {
    mockSb.rpc.admin_registrar_cambios_precio = { data: { ok: false, motivo: 'no_autorizado' }, error: null };
    expect((await sondearMigracion010()).faltaMigracion).toBe(false);
    expect(mockSb.llamadas[0].args.p_admin_id).toBe('');
    mockSb.rpc.admin_registrar_cambios_precio = { data: null, error: { code: '42883', message: 'function does not exist' } };
    expect((await sondearMigracion010()).faltaMigracion).toBe(true);
  });
});

describe('AC-HPR-1 bajar cambios de precio', () => {
  it('AC-HPR-1 guarda lo remoto sin pisar los pendientes locales', async () => {
    mockLocal.cambios = [cambio('local', { pendingSync: true, precioNuevo: 999 })];
    mockSb.selectRows = [
      { id: 'local', producto_id: '1', precio_nuevo: 1, fecha: '2026-10-15', creado_en: '2026-10-15T10:00:00Z' },
      { id: 'remoto', producto_id: '2', codigo: 'B', nombre: 'Otro', rubro: 'Bebidas', precio_anterior: 10, precio_nuevo: 12, precio_bulto_nuevo: 0, fecha: '2026-10-14', creado_en: '2026-10-14T10:00:00Z' },
    ];
    const r = await bajarCambiosPrecio({ now: new Date('2026-10-15T15:00:00Z') });
    expect(r).toMatchObject({ ok: true, count: 1 });
    expect(mockLocal.cambios.find(c => c.id === 'local').precioNuevo).toBe(999);
    expect(mockLocal.cambios.find(c => c.id === 'remoto')).toMatchObject({ productoId: '2', precioNuevo: 12, pendingSync: false });
  });
});
