// REQ-RED (AC-RED-1): ajuste "Redondeo del total" sincronizado; default 500; tolera falta de migracion.
const mockRpc = jest.fn();
jest.mock('../../lib/supabase', () => ({ supabase: { rpc: (...a) => mockRpc(...a) } }));
jest.mock('../../db', () => ({ getVendedores: async () => [{ id: 3, remoteId: 'uuid-admin', nombre: 'Admin' }] }));
jest.mock('../sesion', () => ({ getUsuarioSesion: () => ({ id: 3, permiso: 1, nombre: 'Admin' }) }));

import { leerRedondeoLocal, bajarAjustes, guardarRedondeo } from '../ajustesService';

beforeEach(() => {
  localStorage.clear();
  mockRpc.mockReset();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
});
afterEach(() => console.warn.mockRestore());

describe('AC-RED-1 ajustesService', () => {
  it('AC-RED-1 default 500 si nunca se bajo', () => {
    expect(leerRedondeoLocal()).toBe(500);
  });
  it('AC-RED-1 baja el ajuste y lo cachea (incluido "sin redondeo" = 0)', async () => {
    mockRpc.mockResolvedValueOnce({ data: { redondeo_total: 1000 }, error: null });
    expect(await bajarAjustes()).toEqual({ ok: true, redondeoTotal: 1000 });
    expect(leerRedondeoLocal()).toBe(1000);
    mockRpc.mockResolvedValueOnce({ data: { redondeo_total: 0 }, error: null });
    await bajarAjustes();
    expect(leerRedondeoLocal()).toBe(0);
  });
  it('AC-RED-1 sin la migracion 025 conserva el cache y no lanza', async () => {
    localStorage.setItem('ajustesApp', JSON.stringify({ redondeoTotal: 1000 }));
    mockRpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.ajustes_app_leer' } });
    expect(await bajarAjustes()).toEqual({ ok: false, redondeoTotal: 1000 });
    mockRpc.mockRejectedValueOnce(new Error('red'));
    expect((await bajarAjustes()).ok).toBe(false);
    mockRpc.mockResolvedValueOnce({ data: { redondeo_total: 777 }, error: null });
    expect((await bajarAjustes()).ok).toBe(false);
    expect(leerRedondeoLocal()).toBe(1000);
  });
  it('AC-RED-1 offline no consulta', async () => {
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
    expect((await bajarAjustes()).ok).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
  });
  it('AC-RED-1 guardar manda id remoto y PIN al RPC y actualiza el cache', async () => {
    mockRpc.mockResolvedValueOnce({ data: { ok: true, redondeo_total: 1000 }, error: null });
    expect(await guardarRedondeo('1234', 1000)).toEqual({ ok: true, redondeoTotal: 1000 });
    expect(mockRpc).toHaveBeenCalledWith('admin_guardar_redondeo', { p_admin_id: 'uuid-admin', p_admin_pin: '1234', p_multiplo: 1000 });
    expect(leerRedondeoLocal()).toBe(1000);
    expect(localStorage.getItem('ajustesApp')).not.toMatch(/1234/);
  });
  it('AC-RED-1 PIN malo, sin PIN, multiplo invalido y offline no cambian el cache', async () => {
    mockRpc.mockResolvedValueOnce({ data: { ok: false, motivo: 'no_autorizado' }, error: null });
    expect(await guardarRedondeo('0000', 1000)).toMatchObject({ ok: false, motivo: 'no_autorizado' });
    expect((await guardarRedondeo('', 1000)).ok).toBe(false);
    expect((await guardarRedondeo('1234', 300)).motivo).toBe('multiplo_invalido');
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
    expect((await guardarRedondeo('1234', 500)).motivo).toBe('offline');
    expect(leerRedondeoLocal()).toBe(500);
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });
  it('AC-RED-1 falta la migracion => mensaje claro', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { code: '42883', message: 'function does not exist' } });
    expect((await guardarRedondeo('1234', 500)).motivo).toBe('falta_migracion');
  });
});
