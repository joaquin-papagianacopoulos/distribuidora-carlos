// REQ-SEG2 (AC-SEG2-1): borrar un cliente por la RPC con PIN; sin la 023 cae al delete directo.
const mockDb = { borrados: [] };
jest.mock('../../db', () => ({ deleteCliente: async (id) => { mockDb.borrados.push(id); } }));
jest.mock('../productosAdminService', () => ({
  credencialesAdminProductos: async (pin) => (pin ? { ok: true, cred: { p_admin_id: '1', p_admin_pin: pin } } : { ok: false, motivo: 'pin_requerido', mensaje: 'PIN' }),
}));
const mockSb = { rpc: [], deletes: [], rpcRespuesta: null };
jest.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: (fn, args) => { mockSb.rpc.push({ fn, args }); return Promise.resolve(mockSb.rpcRespuesta); },
    from: () => ({ delete: () => ({ eq: (c, v) => { mockSb.deletes.push([c, v]); return Promise.resolve({ error: null }); } }) }),
  },
}));

import { borrarClienteAdmin } from '../clientesAdminService';
import { setUsuarioSesion } from '../sesion';

beforeEach(() => {
  mockDb.borrados = []; mockSb.rpc = []; mockSb.deletes = [];
  mockSb.rpcRespuesta = { data: { ok: true }, error: null };
  setUsuarioSesion({ id: 1, nombre: 'Admin', permiso: 1 });
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => true });
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { console.warn.mockRestore(); setUsuarioSesion(null); });

describe('AC-SEG2-1 borrarClienteAdmin', () => {
  test('AC-SEG2-1 llama a admin_borrar_cliente con el PIN y borra local', async () => {
    const r = await borrarClienteAdmin({ pin: '1234', cliente: { id: 7 } });
    expect(r.ok).toBe(true);
    expect(mockSb.rpc[0]).toEqual({ fn: 'admin_borrar_cliente', args: { p_admin_id: '1', p_admin_pin: '1234', p_cliente_id: '7' } });
    expect(mockSb.deletes).toEqual([]);
    expect(mockDb.borrados).toEqual([7]);
  });
  test('AC-SEG2-1 PIN incorrecto o con referencias: no borra local', async () => {
    mockSb.rpcRespuesta = { data: { ok: false, motivo: 'no_autorizado' }, error: null };
    expect(await borrarClienteAdmin({ pin: '0000', cliente: { id: 7 } })).toMatchObject({ ok: false, motivo: 'no_autorizado' });
    mockSb.rpcRespuesta = { data: { ok: false, motivo: 'tiene_referencias' }, error: null };
    expect(await borrarClienteAdmin({ pin: '1234', cliente: { id: 7 } })).toMatchObject({ ok: false, motivo: 'tiene_referencias' });
    expect(mockDb.borrados).toEqual([]);
  });
  test('AC-SEG2-1 sin la 023 (RPC inexistente) usa el delete directo', async () => {
    mockSb.rpcRespuesta = { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };
    const r = await borrarClienteAdmin({ pin: '1234', cliente: { id: 7 } });
    expect(r).toMatchObject({ ok: true, sinMigracion: true });
    expect(mockSb.deletes).toEqual([['id', 7]]);
    expect(mockDb.borrados).toEqual([7]);
  });
  test('AC-SEG2-1 sin PIN o no admin: no llama al servidor', async () => {
    expect((await borrarClienteAdmin({ pin: '', cliente: { id: 7 } })).ok).toBe(false);
    setUsuarioSesion({ id: 2, nombre: 'V', permiso: 2 });
    expect((await borrarClienteAdmin({ pin: '1234', cliente: { id: 7 } })).motivo).toBe('no_admin');
    expect(mockSb.rpc).toHaveLength(0);
  });
});
