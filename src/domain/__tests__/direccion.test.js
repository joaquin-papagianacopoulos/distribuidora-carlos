// REQ-DIR (AC-DIR-3): dirección de entrega exacta (calle y número).
import { direccionExacta, mensajeDireccion, FIXTURES_DIRECCION } from '../direccion';

describe('AC-DIR-3 direccionExacta', () => {
  it.each(FIXTURES_DIRECCION)('AC-DIR-3 %j -> ok=%s', (texto, ok) => {
    expect(direccionExacta(texto).ok).toBe(ok);
  });

  it.each([
    ['AC-DIR-3 vacío', '', 'vacia'],
    ['AC-DIR-3 solo espacios', '    ', 'vacia'],
    ['AC-DIR-3 null', null, 'vacia'],
    ['AC-DIR-3 menos de 5 caracteres', 'Av 1', 'corta'],
    ['AC-DIR-3 solo calle', 'Av. Siempreviva', 'sin_numero'],
    ['AC-DIR-3 solo número', '12345', 'sin_calle'],
  ])('%s -> motivo %s', (_d, texto, motivo) => {
    const r = direccionExacta(texto);
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe(motivo);
    expect(mensajeDireccion(motivo)).not.toBe('');
  });

  it('AC-DIR-3 normaliza espacios y acepta "s/n" y "S/N"', () => {
    expect(direccionExacta('  Av.   Siempreviva   742 ').valor).toBe('Av. Siempreviva 742');
    expect(direccionExacta('Mitre s/n').ok).toBe(true);
    expect(direccionExacta('Mitre S/N').ok).toBe(true);
    expect(direccionExacta('Mitre sn').ok).toBe(false);
  });

  it('AC-DIR-3 acepta tildes y eñes', () => {
    expect(direccionExacta('Ñandú 1500').ok).toBe(true);
    expect(direccionExacta('José Hernández 2020').ok).toBe(true);
  });
});
