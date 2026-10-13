// RUN 20261012-2106 iteracion 2 — S-VEN-01 (nombres de vendedor unicos en el
// alta/renombre del admin) y S-BUL-01 (revalidarSesion). Supabase e IndexedDB falsos.
const mockLocal = { vendedores: [], adds: [], updates: [], fallaUpdate: false };
jest.mock('../../db', () => ({
  getVendedores: async () => mockLocal.vendedores.map(v => ({ ...v })),
  addVendedor: async (v) => { mockLocal.adds.push({ ...v }); return 99; },
  updateVendedor: async (v) => {
    if (mockLocal.fallaUpdate) throw new Error('QuotaExceededError');
    mockLocal.updates.push({ ...v });
  },
}));

const mockSb = { rpc: [], selectRespuestas: [], lanzar: false };
jest.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: (fn, args) => { mockSb.rpc.push({ fn, args }); return Promise.resolve({ data: '15', error: null }); },
    from: () => {
      const api = {
        select: () => api,
        eq: () => api,
        maybeSingle: () => {
          if (mockSb.lanzar) return Promise.reject(new TypeError('Failed to fetch'));
          return Promise.resolve(mockSb.selectRespuestas.shift() || { data: null, error: null });
        },
      };
      return api;
    },
  },
}));

// eslint-disable-next-line import/first
import { guardarVendedorAdmin, revalidarSesion } from '../vendedoresService';

const ADMIN = { id: 1, remoteId: 7, nombre: 'Jorge', permiso: 1, tienePin: true };
const PIN = '4821';

beforeEach(() => {
  Object.assign(mockLocal, { vendedores: [], adds: [], updates: [], fallaUpdate: false });
  Object.assign(mockSb, { rpc: [], selectRespuestas: [], lanzar: false });
});

describe('AC-VEN-2 S-VEN-01 el admin no puede crear ni renombrar con el nombre de otro', () => {
  const BAJA = { id: 4, remoteId: 40, nombre: 'Carlos', permiso: 2, activo: false };
  const ANA = { id: 5, remoteId: 50, nombre: 'Ana', permiso: 2 };

  it('AC-VEN-2 S-VEN-01 alta con el nombre de un dado de baja: no llama al servidor', async () => {
    const r = await guardarVendedorAdmin({ admin: ADMIN, adminPin: PIN, form: { nombre: ' carlos ', permiso: 2 }, vendedores: [ADMIN, BAJA], online: true });
    expect(r).toMatchObject({ ok: false, motivo: 'nombre_dado_de_baja' });
    expect(mockSb.rpc).toEqual([]);
    expect(mockLocal.adds).toEqual([]);
  });

  it('AC-VEN-2 S-VEN-01 renombrar a Ana con el nombre de otro activo: no; editar sin cambiar el nombre: si', async () => {
    mockLocal.vendedores = [ADMIN, BAJA, ANA];
    const r = await guardarVendedorAdmin({ admin: ADMIN, adminPin: PIN, form: { nombre: 'Jorge', permiso: 2 }, previo: ANA, online: true });
    expect(r).toMatchObject({ ok: false, motivo: 'nombre_existente' });
    const ok = await guardarVendedorAdmin({ admin: ADMIN, adminPin: PIN, form: { nombre: 'ANA', zona: 'Sur', permiso: 2 }, previo: ANA, online: true });
    expect(ok).toEqual({ ok: true, id: '15' });
  });

  it('AC-VEN-2 S-VEN-01 un nombre libre se da de alta normalmente', async () => {
    const r = await guardarVendedorAdmin({ admin: ADMIN, adminPin: PIN, form: { nombre: 'Marta', permiso: 2 }, vendedores: [ADMIN, BAJA], online: true });
    expect(r).toEqual({ ok: true, id: '15' });
    expect(mockLocal.adds).toHaveLength(1);
  });
});

describe('AC-SEC-4 S-BUL-01 revalidarSesion', () => {
  const sesion = { id: 2, remoteId: 'u2', nombre: 'Carlos', zona: 'Norte', permiso: 1, tienePin: false };
  const fila = { id: 'u2', nombre: 'Carlos', zona: 'Norte', permiso: 2, tiene_pin: false, activo: true };

  it('AC-SEC-4 S-BUL-01 sin red o sin remoteId no consulta y mantiene', async () => {
    expect(await revalidarSesion(sesion, { online: false })).toMatchObject({ accion: 'mantener' });
    expect(await revalidarSesion({ ...sesion, remoteId: null }, { online: true })).toMatchObject({ accion: 'mantener' });
    expect(await revalidarSesion(null, { online: true })).toMatchObject({ accion: 'mantener' });
  });

  it('AC-SEC-4 S-BUL-01 permiso adulterado: actualiza y persiste la fila del servidor en el registro local', async () => {
    mockSb.selectRespuestas = [{ data: fila, error: null }];
    const r = await revalidarSesion(sesion, { online: true });
    expect(r).toMatchObject({ accion: 'actualizar', sesion: { id: 2, permiso: 2 } });
    expect(mockLocal.updates).toEqual([expect.objectContaining({ id: 2, permiso: 2, remoteId: 'u2' })]);
  });

  it('AC-SEC-4 S-BUL-01 si no se puede persistir, igual devuelve la sesion corregida', async () => {
    mockLocal.fallaUpdate = true;
    mockSb.selectRespuestas = [{ data: fila, error: null }];
    expect(await revalidarSesion(sesion, { online: true })).toMatchObject({ accion: 'actualizar' });
  });

  it('AC-VEN-4 S-BUL-01 dado de baja en el servidor => cerrar; red caida => mantener (offline-first)', async () => {
    mockSb.selectRespuestas = [{ data: { ...fila, activo: false }, error: null }];
    expect(await revalidarSesion(sesion, { online: true })).toMatchObject({ accion: 'cerrar' });
    mockSb.lanzar = true;
    expect(await revalidarSesion(sesion, { online: true })).toMatchObject({ accion: 'mantener', motivo: 'error_lectura' });
    mockSb.lanzar = false;
    mockSb.selectRespuestas = [{ data: null, error: { message: 'Failed to fetch' } }];
    expect(await revalidarSesion(sesion, { online: true })).toMatchObject({ accion: 'mantener' });
    expect(mockLocal.updates).toEqual([]);
  });
});
