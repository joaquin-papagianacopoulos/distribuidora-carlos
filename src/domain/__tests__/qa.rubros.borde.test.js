import { claveRubro, normalizarRubro, listarRubros, resolverRubro, validarPctRubro } from '../rubros';

describe('QA REQ-COMR bordes de rubros', () => {
  // BUG: claveRubro no normaliza NFD (tilde como marca combinante U+0301): "La0301cteos" no iguala a "Lácteos" => rubros duplicados al importar Excel/pegar desde Mac.
  it('AC-COMR-4 "Lácteos" descompuesto (NFD) y compuesto (NFC) son el mismo rubro', () => {
    const nfd = 'Lácteos';
    const nfc = 'Lácteos';
    expect(claveRubro(nfd)).toBe(claveRubro(nfc));
  });
  it('AC-COMR-4 tabs, saltos de línea y espacios dobles se colapsan', () => {
    expect(normalizarRubro('  Gol\t\tosinas \n  Varias ')).toBe('Gol osinas Varias');
  });
  it('AC-COMR-3 listarRubros con productos null/undefined/basura no revienta', () => {
    expect(listarRubros([null, undefined, {}, { categoria: null }, { categoria: ' x ' }])).toEqual(['x']);
  });
  it('AC-COMR-4 resolverRubro con existentes en otra escritura reutiliza la original', () => {
    expect(resolverRubro('  GOLOSINAS ', ['Golosinas'])).toMatchObject({ rubro: 'Golosinas' });
  });
  it('AC-COMR-6 % con 3 decimales, texto, "1,5,5" y negativo cero se tratan', () => {
    expect(validarPctRubro('5,555').ok).toBe(false);
    expect(validarPctRubro('abc').ok).toBe(false);
    expect(validarPctRubro('1,5,5').ok).toBe(false);
    expect(validarPctRubro('100,01').ok).toBe(false);
    expect(validarPctRubro('-0').ok).toBe(false);
  });
});
