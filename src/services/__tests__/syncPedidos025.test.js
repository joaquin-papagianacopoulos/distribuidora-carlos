// AC-RED-2: el push de pedidos reintenta sin las columnas de la migracion 025 (y de otras que falten a la vez).
jest.mock('../../db', () => ({}));
jest.mock('../../lib/supabase', () => ({ supabase: {} }));
jest.mock('../imageSearch', () => ({ isImageSearchConfigured: () => false, fetchProductImage: jest.fn(), ImageSearchQuotaError: class extends Error {} }));

import { conFallbackEntrega } from '../../sync/syncService';

const falta = (col) => ({ error: { code: 'PGRST204', message: `Could not find the '${col}' column of 'pedidos' in the schema cache` } });

beforeEach(() => jest.spyOn(console, 'warn').mockImplementation(() => {}));
afterEach(() => console.warn.mockRestore());

describe('AC-RED-2 conFallbackEntrega con la migracion 025', () => {
  it('AC-RED-2 sin columnas 025 reintenta sin ellas y conserva el resto', async () => {
    const fila = { total: 1260, redondeo: 240, redondeo_multiplo: 500, total_redondeado: 1500 };
    const ejecutar = jest.fn(async (f) => ('redondeo' in f ? falta('redondeo') : { data: { id: 1 }, error: null }));
    const r = await conFallbackEntrega(ejecutar, fila);
    expect(r.error).toBeNull();
    expect(ejecutar).toHaveBeenCalledTimes(2);
    expect(ejecutar.mock.calls[1][0]).toEqual({ total: 1260 });
  });
  it('AC-RED-2 faltan la 025 y la 024 a la vez: reintenta hasta que sube', async () => {
    const fila = { total: 1, redondeo: 1, cargado_por: 'A', vendedor_id: '1' };
    const ejecutar = jest.fn(async (f) => {
      if ('cargado_por' in f) return falta('cargado_por');
      if ('redondeo' in f) return falta('redondeo');
      return { data: { id: 1 }, error: null };
    });
    const r = await conFallbackEntrega(ejecutar, fila);
    expect(r.error).toBeNull();
    expect(ejecutar.mock.calls.at(-1)[0]).toEqual({ total: 1 });
  });
  it('AC-RED-2 con las columnas presentes no reintenta', async () => {
    const ejecutar = jest.fn(async () => ({ data: { id: 1 }, error: null }));
    await conFallbackEntrega(ejecutar, { total: 1, redondeo: 0 });
    expect(ejecutar).toHaveBeenCalledTimes(1);
  });
});
