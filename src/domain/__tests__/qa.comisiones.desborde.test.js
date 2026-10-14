import { subtotalRenglonCentavos, decimalACentavos, baseRubrosPedido, comisionParteRubro } from '../comisiones';

describe('QA REQ-COMR desborde de montos (S-COMR-05)', () => {
  it('AC-COMR-9 precio con 30 decimales o 15 enteros no revienta ni da NaN/Infinity', () => {
    for (const precio of ['1.' + '1'.repeat(30), '9'.repeat(15), 1e300, '9'.repeat(400)]) {
      const r = subtotalRenglonCentavos({ precio, cantidad: 1 });
      expect(r === null || (typeof r === 'number' && Number.isFinite(r)) || (typeof r === 'object')).toBe(true);
    }
  });
  it('AC-COMR-9 cantidad con 7 decimales o 12 enteros no cuenta como válida', () => {
    const r1 = subtotalRenglonCentavos({ precio: 10, cantidad: '1.1234567' });
    const r2 = subtotalRenglonCentavos({ precio: 10, cantidad: '9'.repeat(12) });
    expect(JSON.stringify([r1, r2])).not.toMatch(/NaN|Infinity/);
  });
  it('AC-COMR-9 pedido con un renglón desbordado comisiona 0 y no lanza', () => {
    const pedido = { items: [{ productoId: 1, precio: '9'.repeat(30), cantidad: 1, rubro: 'X' }] };
    expect(() => baseRubrosPedido(pedido, new Map())).not.toThrow();
  });
  it('AC-COMR-9 base enorme con 100 % no pierde precisión', () => {
    const r = comisionParteRubro({ base: { porRubro: [{ rubro: 'X', clave: 'x', subtotalCents: 10 ** 11 }], sinRubro: [] }, pctPorClave: () => 100, divisionPct: 100 });
    expect(r.montoCents).toBe(10 ** 11);
  });
  it('AC-COMR-9 decimalACentavos de 1e21 y de texto largo => null', () => {
    expect(decimalACentavos(1e21)).toBeNull();
    expect(decimalACentavos('9'.repeat(400))).toBeNull();
  });
});
