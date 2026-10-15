// REQ-PBU / REQ-HPR: subirProductosConPin sube también el historial de cambios de
// precio y avisa si falta la migración 010 (el RPC viejo ignoraría precio_bulto).
const mockDb = { vendedores: [{ id: 'loc1', remoteId: 'r1' }], productos: [], parches: [] };
jest.mock('../../db', () => ({
  getVendedores: async () => mockDb.vendedores,
  getProductos: async () => mockDb.productos,
  deleteProducto: async () => undefined,
  patchRegistros: async (store, ids, patch) => { mockDb.parches.push({ store, ids, patch }); },
}));
jest.mock('../../sync/syncService', () => ({ syncProductos: async () => ({ ok: true, subidos: 2 }) }));
jest.mock('../../lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));
const mockCambios = { subir: null, sonda: { faltaMigracion: false }, llamadas: [] };
jest.mock('../cambiosPrecioService', () => ({
  subirCambiosPrecio: async (cred) => { mockCambios.llamadas.push(cred); return mockCambios.subir; },
  sondearMigracion010: async () => mockCambios.sonda,
}));

import { setUsuarioSesion } from '../sesion';
import { subirProductosConPin, MSG_FALTA_010 } from '../productosAdminService';

beforeEach(() => {
  mockDb.productos = []; mockDb.parches = [];
  mockCambios.subir = { ok: true, subidos: 1 }; mockCambios.sonda = { faltaMigracion: false }; mockCambios.llamadas = [];
  setUsuarioSesion({ id: 'loc1', nombre: 'Admin', permiso: 1 });
  Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
});

describe('AC-HPR-1 subir productos con PIN sube también los cambios de precio', () => {
  it('AC-HPR-1 usa la misma credencial y no avisa nada si la 010 está', async () => {
    const r = await subirProductosConPin('1234');
    expect(mockCambios.llamadas).toEqual([{ p_admin_id: 'r1', p_admin_pin: '1234' }]);
    expect(r.ok).toBe(true);
    expect(r.avisoMigracion).toBeUndefined();
    expect(r.cambiosPrecio).toEqual({ ok: true, subidos: 1 });
    expect(mockDb.parches).toEqual([]);
  });

  it('AC-PBU-1 sin la 010: avisa y deja pendientes SOLO los productos con precio por bulto', async () => {
    mockCambios.subir = { ok: false, faltaMigracion: true };
    mockDb.productos = [{ id: 1, precioBulto: 80 }, { id: 2, precioBulto: 0 }, { id: 3 }];
    const r = await subirProductosConPin('1234');
    expect(r.avisoMigracion).toBe(MSG_FALTA_010);
    expect(mockDb.parches).toEqual([{ store: 'productos', ids: [1], patch: { extrasPendientes: true } }]);
  });

  it('AC-HPR-1 un fallo del historial no rompe la subida de productos', async () => {
    mockCambios.subir = null;
    mockCambios.sonda = { faltaMigracion: false };
    const r = await subirProductosConPin('1234');
    expect(r.ok).toBe(true);
  });
});
