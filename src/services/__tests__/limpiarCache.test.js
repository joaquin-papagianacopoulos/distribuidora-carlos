// REQ-SEG2 (AC-SEG2-2): "Borrar caché" no borra con pendientes u offline, salvo el camino forzado.
const mockEv = { valor: null };
jest.mock('../../db', () => ({ cerrarDB: jest.fn() }));
jest.mock('../respaldoService', () => ({ evaluarBorradoCache: async () => mockEv.valor }));

import { limpiarCacheLocal } from '../limpiarCache';

beforeEach(() => { localStorage.clear(); localStorage.setItem('algo', '1'); });

describe('AC-SEG2-2 limpiarCacheLocal', () => {
  test('AC-SEG2-2 con pendientes no borra y dice qué falta', async () => {
    mockEv.valor = { permitir: false, motivo: 'pendientes', total: 3, porStore: { pedidos: 3 } };
    const r = await limpiarCacheLocal();
    expect(r).toMatchObject({ bloqueado: true, motivo: 'pendientes', total: 3, porStore: { pedidos: 3 } });
    expect(localStorage.getItem('algo')).toBe('1');
  });
  test('AC-SEG2-2 sin conexión no borra', async () => {
    mockEv.valor = { permitir: false, motivo: 'offline', total: 0, porStore: {} };
    expect((await limpiarCacheLocal()).bloqueado).toBe(true);
    expect(localStorage.getItem('algo')).toBe('1');
  });
  test('AC-SEG2-2 con todo subido borra', async () => {
    mockEv.valor = { permitir: true, motivo: 'ok', total: 0, porStore: {} };
    const r = await limpiarCacheLocal();
    expect(r.bloqueado).toBeUndefined();
    expect(localStorage.getItem('algo')).toBeNull();
  });
  test('AC-SEG2-2 si leer la base lanza, falla cerrado: no borra', async () => {
    mockEv.valor = Promise.reject(new Error('IDB bloqueada'));
    mockEv.valor.catch(() => {});
    const r = await limpiarCacheLocal();
    expect(r).toMatchObject({ bloqueado: true, motivo: 'no_se_pudo_leer' });
    expect(localStorage.getItem('algo')).toBe('1');
  });
  test('AC-SEG2-2 forzado (tras respaldo y BORRAR) borra aunque haya pendientes', async () => {
    mockEv.valor = { permitir: false, motivo: 'pendientes', total: 3, porStore: { pedidos: 3 } };
    const r = await limpiarCacheLocal({ forzado: true });
    expect(r.bloqueado).toBeUndefined();
    expect(localStorage.getItem('algo')).toBeNull();
  });
});
