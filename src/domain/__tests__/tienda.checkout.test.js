import { validarCheckout } from '../tienda';

const ok = { nombre: 'Ana López', telefono: '11 5555-1234', direccion: 'Calle 1', ciudad: 'Rosario' };

describe('tienda checkout (AC-TIE-12)', () => {
  it('AC-TIE-12 mínimo válido', () => {
    const r = validarCheckout(ok);
    expect(r.ok).toBe(true);
    expect(r.datos.nombre).toBe('Ana López');
  });
  it('AC-TIE-12 errores por campo', () => {
    const r = validarCheckout({});
    expect(Object.keys(r.errores).sort()).toEqual(['ciudad', 'direccion', 'nombre', 'telefono']);
    expect(validarCheckout({ ...ok, telefono: '123' }).errores.telefono).toBeTruthy();
  });
  it('AC-TIE-12 CUIT con dígito verificador (opcional)', () => {
    expect(validarCheckout({ ...ok, cuit: '20-12345678-0' }).errores.cuit).toBeTruthy();
    const v = validarCheckout({ ...ok, cuit: '20123456786' });
    expect(v.ok).toBe(true);
    expect(v.datos.cuit).toBe('20-12345678-6');
  });
  it('AC-TIE-12 provincia, cp y observaciones (máx. 500)', () => {
    expect(validarCheckout({ ...ok, provincia: 'Narnia' }).errores.provincia).toBeTruthy();
    expect(validarCheckout({ ...ok, provincia: 'Santa Fe', cp: '2000' }).ok).toBe(true);
    expect(validarCheckout({ ...ok, cp: '!!' }).errores.cp).toBeTruthy();
    expect(validarCheckout({ ...ok, observaciones: 'a'.repeat(500) }).ok).toBe(true);
    expect(validarCheckout({ ...ok, observaciones: 'a'.repeat(501) }).errores.observaciones).toBeTruthy();
  });
});
