import { validarCheckout } from '../tienda';

const ok = { nombre: 'Ana López', telefono: '11 5555-1234', direccion: 'Calle 1 123', ciudad: 'Rosario' };

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

describe('AC-DIR-1 checkout exige dirección exacta', () => {
  it.each([
    ['AC-DIR-1 solo calle', 'Calle Mitre'],
    ['AC-DIR-1 solo número', '12345'],
    ['AC-DIR-1 muy corta', 'A 1'],
    ['AC-DIR-1 vacía', '   '],
  ])('%s se rechaza con mensaje', (_d, direccion) => {
    const r = validarCheckout({ ...ok, direccion });
    expect(r.ok).toBe(false);
    expect(r.errores.direccion).toBeTruthy();
  });
  it('AC-DIR-1 acepta calle y número, y "s/n"', () => {
    expect(validarCheckout({ ...ok, direccion: 'Av. Siempreviva 742' }).ok).toBe(true);
    expect(validarCheckout({ ...ok, direccion: 'Ruta 9 S/N' }).ok).toBe(true);
  });
});
