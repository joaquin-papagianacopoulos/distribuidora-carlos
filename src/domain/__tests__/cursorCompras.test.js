// S-012-02: cursor de bajada de compras sobre (synced_at, id) del servidor.
import { leerCursorCompras, cursorConSolape, avanzarCursorCompras } from '../cursorCompras';

describe('S-012-02 cursor de compras', () => {
  it('S-012-02 lee JSON valido; formato viejo o basura => {} (baja todo)', () => {
    expect(leerCursorCompras('2026-10-12T10:00:00Z')).toEqual({});
    expect(leerCursorCompras('{"cuenta":{"ts":"x"}}')).toEqual({});
    expect(leerCursorCompras(null)).toEqual({});
    expect(leerCursorCompras('{"cuenta":{"ts":"2026-10-12T10:00:00Z","id":"a"},"otra":{}}'))
      .toEqual({ cuenta: { ts: '2026-10-12T10:00:00Z', id: 'a' } });
  });

  it('S-012-02 solape de 5 minutos al arrancar, sin id', () => {
    expect(cursorConSolape({ pedidos: { ts: '2026-10-12T10:00:00Z', id: 'p' } }))
      .toEqual({ pedidos: { ts: '2026-10-12T09:55:00.000Z', id: '' } });
  });

  it('S-012-02 avanza con la ultima fila (synced_at, id) y marca las paginas llenas', () => {
    const filas = [{ id: 'a', synced_at: '2026-10-12T10:00:00Z', updated_at: '2020-01-01T00:00:00Z' }, { id: 'b', synced_at: '2026-10-12T10:00:00Z' }];
    const r = avanzarCursorCompras({}, { cuenta: filas, costos: [{ ingreso_id: 'i1', synced_at: '2026-10-12T09:00:00Z' }] }, 2);
    expect(r.cursor).toEqual({ cuenta: { ts: '2026-10-12T10:00:00Z', id: 'b' }, costos: { ts: '2026-10-12T09:00:00Z', id: 'i1' } });
    expect(r.llenas).toEqual(['cuenta']);
  });

  it('S-012-02 el cursor guardado no retrocede con filas del solape', () => {
    const base = { cuenta: { ts: '2026-10-12T10:00:00Z', id: 'z' } };
    const r = avanzarCursorCompras(base, { cuenta: [{ id: 'a', synced_at: '2026-10-12T09:58:00Z' }] }, 1000, { soloAdelante: true });
    expect(r.cursor).toEqual(base);
  });

  it('S-012-02 una fila sin synced_at no mueve el cursor', () => {
    expect(avanzarCursorCompras({}, { pedidos: [{ id: 'x', updated_at: '2026-10-12T10:00:00Z' }] }).cursor).toEqual({});
  });
});
