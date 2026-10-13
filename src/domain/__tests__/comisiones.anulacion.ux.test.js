// REQ-COM AC-COM-12 — C2 (RUN 20261012-2106): ayuda visible del botón
// "Confirmar anulación". Tiene que coincidir con validarAnulacion.
import { ayudaAnulacion, AYUDA_ANULACION, validarAnulacion, MIN_MOTIVO, MAX_MOTIVO } from '../comisiones';

const VIGENTE = { id: 'c1', estado: 'vigente' };

describe('AC-COM-12 ayudaAnulacion', () => {
  it('AC-COM-12 textos exactos', () => {
    expect(AYUDA_ANULACION).toEqual({
      procesando: 'Anulando...',
      motivoCorto: 'Escribí el motivo (mínimo 3 letras)',
      motivoLargo: 'El motivo no puede superar 300 caracteres',
      sinPin: 'Ingresá tu PIN de admin',
    });
    expect(MIN_MOTIVO).toBe(3);
    expect(MAX_MOTIVO).toBe(300);
  });

  it.each([
    ['vacío', '', '1234'],
    ['"ab"', 'ab', '1234'],
    ['"  ab  " (se normaliza con trim)', '  ab  ', '1234'],
    ['solo espacios y saltos', ' \n\t ', '1234'],
  ])('AC-COM-12 motivo %s => deshabilitado con "Escribí el motivo"', (_l, motivo, pin) => {
    expect(ayudaAnulacion({ motivo, pin })).toEqual({ habilitado: false, ayuda: 'Escribí el motivo (mínimo 3 letras)' });
  });

  it('AC-COM-12 3 letras sin PIN => "Ingresá tu PIN de admin"', () => {
    expect(ayudaAnulacion({ motivo: 'abc', pin: '' })).toEqual({ habilitado: false, ayuda: 'Ingresá tu PIN de admin' });
    expect(ayudaAnulacion({ motivo: 'abc', pin: '   ' })).toEqual({ habilitado: false, ayuda: 'Ingresá tu PIN de admin' });
    expect(ayudaAnulacion({ motivo: 'abc' })).toEqual({ habilitado: false, ayuda: 'Ingresá tu PIN de admin' });
  });

  it('AC-COM-12 válido => habilitado y sin ayuda (PIN como número también)', () => {
    expect(ayudaAnulacion({ motivo: 'abc', pin: '1234' })).toEqual({ habilitado: true, ayuda: null });
    expect(ayudaAnulacion({ motivo: 'Error de carga', pin: 1234 })).toEqual({ habilitado: true, ayuda: null });
  });

  it('AC-COM-12 más de 300 caracteres => deshabilitado', () => {
    expect(ayudaAnulacion({ motivo: 'x'.repeat(301), pin: '1' })).toEqual({ habilitado: false, ayuda: 'El motivo no puede superar 300 caracteres' });
    expect(ayudaAnulacion({ motivo: 'x'.repeat(300), pin: '1' }).habilitado).toBe(true);
  });

  it('AC-COM-12 procesando gana sobre todo', () => {
    expect(ayudaAnulacion({ motivo: 'abc', pin: '1', procesando: true })).toEqual({ habilitado: false, ayuda: 'Anulando...' });
    expect(ayudaAnulacion({ procesando: true })).toEqual({ habilitado: false, ayuda: 'Anulando...' });
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['número', 5],
    ['string', 'abc'],
    ['objeto vacío', {}],
    ['motivo objeto', { motivo: { toString: () => 'motivo largo' }, pin: '1' }],
    ['motivo array', { motivo: ['abc'], pin: '1' }],
    ['pin objeto', { motivo: 'abc', pin: { a: 1 } }],
    ['motivo null', { motivo: null, pin: null }],
  ])('AC-COM-12 entradas hostiles (%s) no lanzan y quedan deshabilitadas', (_l, entrada) => {
    let r;
    expect(() => { r = ayudaAnulacion(entrada); }).not.toThrow();
    expect(r.habilitado).toBe(false);
    expect(typeof r.ayuda).toBe('string');
  });

  it.each(['', 'ab', '  ab  ', 'abc', '  abc  ', 'a  b', 'x'.repeat(300), 'x'.repeat(301), 'Motivo con\nsalto'])(
    'AC-COM-12 coherente con validarAnulacion para el motivo %j',
    (motivo) => {
      const ux = ayudaAnulacion({ motivo, pin: '1234' });
      const dom = validarAnulacion(VIGENTE, motivo, 'Jorge', 1);
      expect(ux.habilitado).toBe(dom.ok);
    },
  );
});
