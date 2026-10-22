// QA RUN 20261022-1200: casos borde de REQ-DIR, REQ-FRB y REQ-CON.
import { direccionExacta } from '../direccion';
import { completarPreciosBulto, precioAplicadoRenglon, totalesBoleta } from '../precios';
import { resumenCliente, clienteExtraFromRemote, clienteExtraToRemote, validarCliente } from '../clientes';

describe('AC-DIR-3 bordes', () => {
  it.each([
    ['undefined', undefined, false],
    ['numero como Number', 742, false],
    ['objeto', {}, false],
    ['s/n solo', 's/n', false],
    ['Mitre s/nada', 'Mitre s/nada', false],
    ['letra pegada a digito', 'abc1', false],
    ['Mitre S/N con punto', 'Mitre S/N.', true],
    ['tab como separador', 'Mitre\t742', true],
    ['salto de linea', 'Mitre\n742', true],
    ['minimo 5 chars', 'Av 12', true],
    ['Calle con numero ordinal', 'Calle 5a', true],
    ['altura con letra', 'Mitre 742B', true],
  ])('AC-DIR-3 %s', (_n, texto, ok) => {
    expect(direccionExacta(texto).ok).toBe(ok);
  });
  it('AC-DIR-1 texto sin letras con simbolos no pasa', () => {
    expect(direccionExacta('!!! 123').ok).toBe(false);
  });
});

describe('AC-FRB-1 bordes', () => {
  const DC = { id: 1, precio: 900, precioBulto: 800, bultoX: 16 };
  const lin = (cantidad, precio = 900) => ({ productoId: 1, cantidad, precio, precioOriginal: precio });

  it('AC-FRB-1 15.99 u. no llega al bulto, 16 u. exacto sí', () => {
    expect(completarPreciosBulto(lin(15.99), DC).precio).toBe(900);
    expect(completarPreciosBulto(lin(16), DC)).toMatchObject({ precio: 800, precioPorBulto: true });
  });
  it('AC-FRB-1 bultoX 1 o ausente no activa precio de bulto', () => {
    const l = lin(50);
    expect(completarPreciosBulto(l, { ...DC, bultoX: 1 })).toBe(l);
    expect(completarPreciosBulto(l, { ...DC, bultoX: undefined })).toBe(l);
  });
  it('AC-FRB-1 precioBulto mayor al unitario: se cobra el menor', () => {
    expect(completarPreciosBulto(lin(16), { ...DC, precioBulto: 1200 }).precio).toBe(900);
  });
  it('AC-FRB-2 renglón con descuentoPct no se toca', () => {
    const l = { ...lin(16, 810), precioOriginal: 900, descuentoPct: 10 };
    expect(completarPreciosBulto(l, DC)).toBe(l);
  });
  it('AC-FRB-1 null/undefined no rompen', () => {
    expect(completarPreciosBulto(null, DC)).toBeNull();
    expect(completarPreciosBulto(undefined, DC)).toBeUndefined();
    expect(precioAplicadoRenglon(null, 3)).toBeNull();
  });
  it('AC-FRB-1 idempotente: completar dos veces da lo mismo', () => {
    const a = completarPreciosBulto(lin(16), DC);
    expect(completarPreciosBulto(a, DC)).toBe(a);
  });
  it('AC-FRB-3 totalesBoleta con lista vacía, null y cantidades inválidas', () => {
    const cero = { total: 0, totalSinDescuento: 0, descuento: 0, descuentoPct: 0 };
    expect(totalesBoleta([])).toEqual(cero);
    expect(totalesBoleta(null)).toEqual(cero);
    expect(totalesBoleta([{ cantidad: 'x', precio: 'y' }])).toEqual(cero);
  });
  it('AC-FRB-3 renglón legacy (sin datos de bulto) mantiene total y descuento previo', () => {
    const t = totalesBoleta([{ cantidad: 2, precio: 90, precioOriginal: 100 }]);
    expect(t).toMatchObject({ total: 180, totalSinDescuento: 200, descuento: 20, descuentoPct: 10 });
  });
  it('AC-FRB-3 mezcla bulto + unidad: 10 u. ($9.000) y 16 u. ($12.800) suman 21.800 sin descuento', () => {
    const b = { precioBultoOriginal: 800, precioBultoX: 16, precioOriginal: 900 };
    const t = totalesBoleta([{ ...b, cantidad: 10, precio: 900, precioPorBulto: false }, { ...b, cantidad: 16, precio: 800, precioPorBulto: true }]);
    expect(t.total).toBe(21800);
    expect(t.descuento).toBe(0);
  });
});

describe('AC-CON-1 bordes (clientes viejos)', () => {
  it('AC-CON-1 resumenCliente tolera undefined, null y espacios', () => {
    expect(resumenCliente()).toBe('');
    expect(resumenCliente({ contacto: '   ', telefono: '341' })).toBe('341');
    expect(resumenCliente({ contacto: null, telefono: null, codigo: '1' })).toBe('1');
  });
  it('AC-CON-1 fromRemote con contacto null remoto usa el local o vacío', () => {
    expect(clienteExtraFromRemote({ contacto: null }, {}).contacto).toBe('');
  });
  it('AC-CON-1 toRemote con contacto solo espacios', () => {
    // BUG (menor): toRemote no recorta; un contacto '   ' sin pasar por validarCliente se sube como espacios.
    const v = clienteExtraToRemote({ contacto: '   ' }).contacto;
    expect(v === null || v === '').toBe(true);
  });
  it('AC-CON-1 contacto con unicode se conserva', () => {
    const base = { codigo: '1', nombre: 'X', direccion: 'Mitre 1', fechaAlta: '2026-10-22' };
    expect(validarCliente({ ...base, contacto: '  José Ñandú ' }).cliente.contacto).toBe('José Ñandú');
  });
});
