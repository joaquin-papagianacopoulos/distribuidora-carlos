// REQ-VEN: baja logica de vendedores por rpc('admin_baja_vendedor') (004) y
// pull que no "resucita" al dado de baja. Supabase e IndexedDB falsos.
// Funciones planas (CRA usa resetMocks: un jest.fn perderia la implementacion).
const mockLocal = { vendedores: [], updates: [] };
jest.mock('../../db', () => ({
  getVendedores: async () => mockLocal.vendedores.map(v => ({ ...v })),
  putVendedoresBatch: async (rows) => {
    for (const r of rows) {
      const i = mockLocal.vendedores.findIndex(x => x.id !== undefined && x.id === r.id);
      if (i >= 0) mockLocal.vendedores[i] = { ...r };
      else mockLocal.vendedores.push({ ...r, id: r.id ?? 100 + mockLocal.vendedores.length });
    }
  },
  addVendedor: async () => 99,
  updateVendedor: async (v) => { mockLocal.updates.push({ ...v }); mockLocal.vendedores = mockLocal.vendedores.map(x => (x.id === v.id ? { ...v } : x)); },
  deleteVendedor: async () => { throw new Error('REQ-VEN: nunca se borra el registro local'); },
}));
jest.mock('../../services/imageSearch', () => ({
  isImageSearchConfigured: () => false, fetchProductImage: jest.fn(), ImageSearchQuotaError: class extends Error {},
}));

// Servidor falso: filas remotas + RPC que aplica la baja (como la 004).
const mockSb = { remoto: [], rpc: [], rpcRespuestas: [], selects: [], lanzar: false, sinColumnaActivo: false };
jest.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: (fn, args) => {
      mockSb.rpc.push({ fn, args });
      if (mockSb.lanzar) return Promise.reject(new TypeError('Failed to fetch'));
      const r = mockSb.rpcRespuestas.shift() || { data: null, error: null };
      if (r.data?.ok === true) {
        mockSb.remoto = mockSb.remoto.map(x => (String(x.id) === args.p_vendedor_id ? { ...x, activo: false, tiene_pin: false } : x));
      }
      return Promise.resolve(r);
    },
    from: (table) => {
      const q = { table, cols: null };
      const api = {
        select: (cols) => { q.cols = cols; mockSb.selects.push(q); return api; },
        eq: () => api,
        range: () => api,
        then: (res, rej) => {
          let r;
          if (mockSb.sinColumnaActivo && /activo/.test(q.cols)) r = { data: null, error: { code: '42703', message: 'column vendedores.activo does not exist' } };
          else {
            const cols = q.cols.split(',');
            r = { data: mockSb.remoto.map(x => Object.fromEntries(cols.filter(c => c in x).map(c => [c, x[c]]))), error: null };
          }
          return Promise.resolve(r).then(res, rej);
        },
      };
      return api;
    },
  },
}));

// eslint-disable-next-line import/first
import { darDeBajaVendedorAdmin } from '../vendedoresService';
// eslint-disable-next-line import/first
import { downloadVendedores } from '../../sync/syncService';
// eslint-disable-next-line import/first
import { filtrarActivos } from '../../domain/vendedores';

const ADMIN = { id: 1, remoteId: 7, nombre: 'Jorge', permiso: 1, tienePin: true };
const VEND = { id: 2, remoteId: 8, nombre: 'Carlos', permiso: 2, tienePin: true, createdAt: 3 };
const PIN = '4821';

beforeEach(() => {
  mockLocal.vendedores = [{ ...ADMIN }, { ...VEND }];
  mockLocal.updates = [];
  Object.assign(mockSb, {
    remoto: [
      { id: 7, nombre: 'Jorge', zona: '', permiso: 1, tiene_pin: true, activo: true },
      { id: 8, nombre: 'Carlos', zona: 'Norte', permiso: 2, tiene_pin: true, activo: true },
    ],
    rpc: [], rpcRespuestas: [], selects: [], lanzar: false, sinColumnaActivo: false,
  });
});

describe('AC-VEN-1 AC-VEN-2 baja por admin_baja_vendedor', () => {
  it('AC-VEN-1 AC-VEN-2 con PIN ok: RPC con ids en texto, local activo:false sin borrar el registro', async () => {
    mockSb.rpcRespuestas = [{ data: { ok: true }, error: null }];
    const r = await darDeBajaVendedorAdmin({ admin: ADMIN, adminPin: ` ${PIN} `, vendedor: VEND, online: true });
    expect(r).toMatchObject({ ok: true });
    expect(mockSb.rpc).toEqual([{ fn: 'admin_baja_vendedor', args: { p_admin_id: '7', p_admin_pin: PIN, p_vendedor_id: '8' } }]);
    expect(mockLocal.vendedores).toHaveLength(2); // no se borra nada
    expect(mockLocal.vendedores.find(v => v.id === 2)).toMatchObject({ id: 2, remoteId: 8, nombre: 'Carlos', activo: false, tienePin: false, createdAt: 3 });
    expect(JSON.stringify(mockLocal.vendedores)).not.toContain(PIN);
  });

  it('AC-VEN-3 tras la baja, el pull NO lo vuelve a mostrar activo', async () => {
    mockSb.rpcRespuestas = [{ data: { ok: true }, error: null }];
    await darDeBajaVendedorAdmin({ admin: ADMIN, adminPin: PIN, vendedor: VEND, online: true });
    await downloadVendedores();
    expect(mockSb.selects.map(s => s.cols)).toEqual(['id,nombre,zona,permiso,tiene_pin,activo']);
    expect(mockLocal.vendedores).toHaveLength(2);
    expect(filtrarActivos(mockLocal.vendedores).map(v => v.nombre)).toEqual(['Jorge']);
  });

  it('AC-VEN-3 un vendedor dado de baja desde otro dispositivo queda inactivo con el pull', async () => {
    mockSb.remoto[1] = { ...mockSb.remoto[1], activo: false, tiene_pin: false };
    await downloadVendedores();
    expect(mockLocal.vendedores.find(v => v.id === 2)).toMatchObject({ activo: false, tienePin: false });
  });

  it('AC-VEN-5 sin la 004 el pull reintenta sin "activo" y conserva lo local', async () => {
    mockSb.sinColumnaActivo = true;
    expect(await downloadVendedores()).toMatchObject({ ok: true, count: 2 });
    expect(mockSb.selects.map(s => s.cols)).toEqual(['id,nombre,zona,permiso,tiene_pin,activo', 'id,nombre,zona,permiso,tiene_pin']);
    expect(filtrarActivos(mockLocal.vendedores)).toHaveLength(2);
  });

  it('AC-VEN-1 sin conexion: avisa y no llama al servidor ni toca lo local', async () => {
    const r = await darDeBajaVendedorAdmin({ admin: ADMIN, adminPin: PIN, vendedor: VEND, online: false });
    expect(r).toMatchObject({ ok: false, motivo: 'sin_conexion', mensaje: expect.stringMatching(/Necesitás conexión/) });
    expect(mockSb.rpc).toEqual([]);
    expect(mockLocal.updates).toEqual([]);
  });

  it('AC-VEN-1 red caida durante la RPC: no toca lo local', async () => {
    mockSb.lanzar = true;
    expect(await darDeBajaVendedorAdmin({ admin: ADMIN, adminPin: PIN, vendedor: VEND, online: true })).toMatchObject({ ok: false, motivo: 'sin_conexion' });
    expect(mockLocal.updates).toEqual([]);
  });

  it('AC-VEN-1 PIN de admin incorrecto: no autorizado y no toca lo local', async () => {
    mockSb.rpcRespuestas = [{ data: { ok: false, motivo: 'no_autorizado' }, error: null }];
    expect(await darDeBajaVendedorAdmin({ admin: ADMIN, adminPin: '0000', vendedor: VEND, online: true }))
      .toMatchObject({ ok: false, motivo: 'no_autorizado', mensaje: 'PIN de admin incorrecto.' });
    expect(mockLocal.updates).toEqual([]);
    expect(filtrarActivos(mockLocal.vendedores)).toHaveLength(2);
  });

  it('AC-VEN-5 falta la 004: mensaje claro y no borra nada (ni local)', async () => {
    mockSb.rpcRespuestas = [{ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.admin_baja_vendedor' } }];
    expect(await darDeBajaVendedorAdmin({ admin: ADMIN, adminPin: PIN, vendedor: VEND, online: true }))
      .toMatchObject({ ok: false, motivo: 'falta_migracion', mensaje: expect.stringMatching(/^Falta la migración 004 en Supabase/) });
    expect(mockLocal.updates).toEqual([]);
    expect(mockLocal.vendedores).toHaveLength(2);
  });

  it('AC-VEN-4 propio admin y ultimo admin: se frena en el cliente sin llamar al servidor', async () => {
    expect(await darDeBajaVendedorAdmin({ admin: ADMIN, adminPin: PIN, vendedor: ADMIN, online: true })).toMatchObject({ ok: false, motivo: 'propio_admin' });
    const otroAdmin = { id: 5, remoteId: 11, nombre: 'Marta', permiso: 1 };
    // lista local donde Marta es la unica admin activa
    const lista = [{ ...ADMIN, activo: false }, otroAdmin, VEND];
    expect(await darDeBajaVendedorAdmin({ admin: { ...ADMIN, id: 60, remoteId: 60 }, adminPin: PIN, vendedor: otroAdmin, vendedores: lista, online: true }))
      .toMatchObject({ ok: false, motivo: 'ultimo_admin' });
    expect(mockSb.rpc).toEqual([]);
  });

  it('AC-VEN-4 si el servidor dice ultimo_admin (otro dispositivo), no se toca lo local', async () => {
    const otroAdmin = { id: 5, remoteId: 11, nombre: 'Marta', permiso: 1 };
    mockLocal.vendedores.push(otroAdmin);
    mockSb.rpcRespuestas = [{ data: { ok: false, motivo: 'ultimo_admin' }, error: null }];
    expect(await darDeBajaVendedorAdmin({ admin: ADMIN, adminPin: PIN, vendedor: otroAdmin, online: true })).toMatchObject({ ok: false, motivo: 'ultimo_admin' });
    expect(mockLocal.updates).toEqual([]);
  });

  it('AC-VEN-1 precondiciones: admin sin remoteId y PIN vacio no llaman al servidor', async () => {
    expect(await darDeBajaVendedorAdmin({ admin: { ...ADMIN, remoteId: null }, adminPin: PIN, vendedor: VEND, online: true })).toMatchObject({ motivo: 'sin_id_remoto' });
    expect(await darDeBajaVendedorAdmin({ admin: ADMIN, adminPin: '  ', vendedor: VEND, online: true })).toMatchObject({ motivo: 'pin_requerido' });
    expect(await darDeBajaVendedorAdmin({ admin: { ...ADMIN, permiso: 2 }, adminPin: PIN, vendedor: VEND, online: true })).toMatchObject({ motivo: 'permiso' });
    expect(mockSb.rpc).toEqual([]);
  });
});
