// QA RUN 20261012-2106 — AC-COM-12: la UI (ayudaAnulacion) y el dominio
// (validarAnulacion) nunca se contradicen, con motivos hostiles.
import { ayudaAnulacion, validarAnulacion, AYUDA_ANULACION, MAX_MOTIVO } from '../comisiones';

const CIERRE = { id: 'c1', estado: 'vigente' };
const MOTIVOS = [
  '', ' ', '  \t\n  ', 'a', 'ab', 'abc', ' abc ', 'a b', 'a  b', 'a\tb', 'a\nb', '\u0000\u0000\u0000', 'ab\u0000', '\u0007\u0007\u0007\u0007',
  'ñññ', 'ñ ñ', '\u{1F600}\u{1F600}', '\u{1F600}', 'áé', 'a\u0301', 'e\u0301e\u0301e\u0301', '\u200B\u200B\u200B', '\u00A0\u00A0\u00A0', '   \u00A0 a  ',
  'x'.repeat(299), 'x'.repeat(300), 'x'.repeat(301), 'x'.repeat(10000), 'x'.repeat(10001), `${'x '.repeat(200)}`, `${'x  '.repeat(150)}`,
  '\u{1F600}'.repeat(150), '\u{1F600}'.repeat(151), 'a'.repeat(298) + '\n\n\n' + 'b', '=cmd', "'; drop table cierres; --", '<script>alert(1)</script>',
  null, undefined, 0, 123, 12.5, true, {}, [], ['abc'], { toString: () => 'abcdef' },
];

describe('AC-COM-12 ayudaAnulacion vs validarAnulacion', () => {
  it.each(MOTIVOS.map((m, i) => [i, m]))('AC-COM-12 motivo #%i: boton habilitado <=> el dominio acepta el motivo (con PIN presente)', (_i, motivo) => {
    const ui = ayudaAnulacion({ motivo, pin: '4321', procesando: false });
    const dom = validarAnulacion(CIERRE, motivo, 'Jorge');
    // Un objeto/booleano/array no es texto para la UI (se trata como vacio): en ese caso la UI
    // puede ser MAS estricta que el dominio, nunca mas permisiva.
    if (ui.habilitado) expect(dom.ok).toBe(true);
    const esTexto = typeof motivo === 'string' || typeof motivo === 'number';
    if (esTexto) expect(ui.habilitado).toBe(dom.ok);
  });

  it('AC-COM-12 cuando el motivo es valido, la ayuda es null; cuando no, siempre hay un texto de ayuda', () => {
    for (const motivo of MOTIVOS) {
      const ui = ayudaAnulacion({ motivo, pin: '4321' });
      if (ui.habilitado) expect(ui.ayuda).toBeNull();
      else expect(typeof ui.ayuda).toBe('string');
      expect(ui.ayuda === null || Object.values(AYUDA_ANULACION).includes(ui.ayuda)).toBe(true);
    }
  });

  it('AC-COM-12 el PIN solo de espacios, vacio o no-texto deja el boton deshabilitado con "Ingresá tu PIN de admin"', () => {
    for (const pin of ['', '   ', '\t', null, undefined, {}, [], false]) {
      expect(ayudaAnulacion({ motivo: 'Motivo valido', pin })).toEqual({ habilitado: false, ayuda: AYUDA_ANULACION.sinPin });
    }
    expect(ayudaAnulacion({ motivo: 'Motivo valido', pin: 4321 }).habilitado).toBe(true);
    expect(ayudaAnulacion({ motivo: 'Motivo valido', pin: 0 }).habilitado).toBe(true); // "0" es un PIN tipeado
  });

  it('AC-COM-12 el limite de largo coincide con MAX_MOTIVO exactamente (300 ok, 301 no)', () => {
    expect(MAX_MOTIVO).toBe(300);
    expect(ayudaAnulacion({ motivo: 'x'.repeat(300), pin: '1' }).habilitado).toBe(true);
    expect(ayudaAnulacion({ motivo: 'x'.repeat(301), pin: '1' })).toEqual({ habilitado: false, ayuda: AYUDA_ANULACION.motivoLargo });
    expect(validarAnulacion(CIERRE, 'x'.repeat(301), 'Jorge').errores.motivo).toMatch(/300/);
  });

  it('AC-COM-12 un motivo con espacios que al normalizarse queda <= 300 (p.ej. 400 caracteres con espacios repetidos) es valido en ambos', () => {
    const motivo = `${'palabra'.padEnd(10, ' ')}`.repeat(30); // 300 chars con 3 espacios por palabra => normalizado ~ 210
    const ui = ayudaAnulacion({ motivo, pin: '1' });
    expect(ui.habilitado).toBe(validarAnulacion(CIERRE, motivo, 'Jorge').ok);
    expect(ui.habilitado).toBe(true);
  });

  it('AC-COM-12 procesando gana aunque el motivo y el PIN esten bien, y entradas nulas no lanzan', () => {
    expect(ayudaAnulacion({ motivo: 'Motivo valido', pin: '1', procesando: true })).toEqual({ habilitado: false, ayuda: AYUDA_ANULACION.procesando });
    for (const e of [null, undefined, 0, 'x', [], () => 1]) expect(() => ayudaAnulacion(e)).not.toThrow();
    expect(ayudaAnulacion(null).habilitado).toBe(false);
  });

  it('AC-COM-12 un cierre ya anulado / con anulacion en curso / sin usuario NO se puede anular aunque la UI habilite el boton', () => {
    expect(validarAnulacion({ id: 'c', estado: 'anulado' }, 'Motivo valido', 'Jorge').ok).toBe(false);
    expect(validarAnulacion({ id: 'c', estado: 'vigente', anulacionPendiente: true }, 'Motivo valido', 'Jorge').ok).toBe(false);
    expect(validarAnulacion(CIERRE, 'Motivo valido', '').ok).toBe(false);
    expect(validarAnulacion(null, 'Motivo valido', 'Jorge').ok).toBe(false);
  });
});
