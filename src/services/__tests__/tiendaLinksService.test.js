// REQ-WEB AC-WEB-7: el servicio de links usa las RPC con PIN de admin y arma el link.
const mockSb = { llamadas: [], respuesta: null };
jest.mock('../../lib/supabase', () => ({
  supabase: { rpc: async (n, a) => { mockSb.llamadas.push([n, a]); return mockSb.respuesta; } },
}));
jest.mock('../../db', () => ({ getVendedores: async () => [{ id: 1, remoteId: 'adm-9', nombre: 'Jorge', permiso: 1 }] }));

import { setUsuarioSesion } from '../sesion';
import { obtenerLink, listarLinks } from '../tiendaLinksService';

const TOKEN = 'Xk3_aB9-QmZ1pL0wRtYvUe7sDfGhJkNc2oIuPqAbCdE';

beforeEach(() => { mockSb.llamadas = []; mockSb.respuesta = { data: { ok: true, token: TOKEN }, error: null }; setUsuarioSesion({ id: 1, nombre: 'Jorge', permiso: 1 }); });
afterEach(() => setUsuarioSesion(null));

describe('tiendaLinksService', () => {
  it('AC-WEB-7 generar manda id remoto del admin, PIN y regenerar=false; arma /tienda?v=<token>', async () => {
    const r = await obtenerLink('1234', 'v-1', { origin: 'https://app.com' });
    expect(r).toEqual({ ok: true, link: `https://app.com/tienda?v=${TOKEN}` });
    expect(mockSb.llamadas[0]).toEqual(['admin_token_tienda', { p_admin_id: 'adm-9', p_admin_pin: '1234', p_vendedor_id: 'v-1', p_regenerar: false }]);
  });

  it('AC-WEB-7 regenerar manda p_regenerar=true', async () => {
    await obtenerLink('1234', 'v-1', { regenerar: true, origin: 'https://app.com' });
    expect(mockSb.llamadas[0][1].p_regenerar).toBe(true);
  });

  it('AC-WEB-7 sin sesión de admin, sin PIN o con PIN incorrecto no devuelve link', async () => {
    expect((await obtenerLink('', 'v-1')).ok).toBe(false);
    mockSb.respuesta = { data: { ok: false, motivo: 'no_autorizado' }, error: null };
    expect((await obtenerLink('9999', 'v-1')).ok).toBe(false);
    setUsuarioSesion({ id: 1, nombre: 'Juan', permiso: 2 });
    expect((await obtenerLink('1234', 'v-1')).ok).toBe(false);
    expect(mockSb.llamadas).toHaveLength(1); // solo la del PIN incorrecto llegó al servidor
  });

  it('AC-WEB-7 migración sin aplicar: mensaje claro', async () => {
    mockSb.respuesta = { data: null, error: { code: 'PGRST202', message: 'x' } };
    expect((await obtenerLink('1234', 'v-1')).mensaje).toContain('008_tienda.sql');
  });

  it('AC-WEB-7 listarLinks devuelve un mapa vendedor -> link y descarta tokens inválidos', async () => {
    mockSb.respuesta = { data: { ok: true, tokens: [{ vendedor_id: 'v-1', token: TOKEN }, { vendedor_id: 'v-2', token: 'x' }] }, error: null };
    const r = await listarLinks('1234', 'https://app.com');
    expect(r.links['v-1']).toBe(`https://app.com/tienda?v=${TOKEN}`);
    expect(r.links['v-2']).toBeNull();
  });
});
