import {
  aCentavos, formatearPesos, precioVigente, unidadesRenglon, validarRenglon, calcularCarrito,
  compararConServidor, textoBulto, textoEquivalencia, serializarCarrito, restaurarCarrito,
  armarPayloadPedido, unidadesIniciales, pasoUnidades, MAX_RENGLONES,
} from '../tienda';
import { dosCorazones, gaseosa, alfajor, catalogoMap, casosCarrito, ofertaBorde } from '../__fixtures__/tiendaCasos';

describe('tienda carrito (AC-TIE-9, AC-TIE-10, AC-TIE-11, AC-TIE-15)', () => {
  it('AC-TIE-11 aCentavos: half-up y entradas inválidas', () => {
    expect(aCentavos(14.4)).toBe(1440);
    expect(aCentavos(1.005)).toBe(101);
    expect(aCentavos(0.1 + 0.2)).toBe(30);
    for (const x of [NaN, null, undefined, '12', -1, Infinity]) expect(aCentavos(x)).toBeNull();
  });

  it('AC-TIE-7 formatearPesos y textoBulto "Display x16 · $14.400"', () => {
    expect(formatearPesos(14400)).toBe('$14.400');
    expect(formatearPesos(1234567.5)).toBe('$1.234.567,50');
    expect(textoBulto(dosCorazones)).toBe('Display x16 · $14.400');
    expect(textoBulto(alfajor)).toBeNull();
  });

  it.each(casosCarrito)('AC-TIE-11 caso compartido: %s', (_d, lineas, total, unidades) => {
    const r = calcularCarrito(lineas, catalogoMap(), { permitirSinStock: false }, '2026-10-14');
    expect(r.errores).toEqual([]);
    expect(r.total).toBe(total);
    expect(r.totalUnidades).toBe(unidades);
  });

  it('AC-TIE-9 modos: bulto en producto solo-unidad se rechaza; ambos acepta ambos', () => {
    expect(unidadesRenglon({ cantidad: 1, modo: 'bulto' }, alfajor)).toBeNull();
    expect(unidadesRenglon({ cantidad: 2, modo: 'bulto' }, gaseosa)).toBe(12);
    expect(unidadesRenglon({ cantidad: 5, modo: 'unidad' }, gaseosa)).toBe(5);
    expect(unidadesRenglon({ cantidad: 0, modo: 'unidad' }, gaseosa)).toBeNull();
    expect(unidadesRenglon({ cantidad: 1.5 }, gaseosa)).toBeNull();
    expect(unidadesRenglon({ cantidad: 10000000 }, gaseosa)).toBeNull();
    expect(unidadesIniciales(dosCorazones)).toBe(16);
    expect(unidadesIniciales(gaseosa)).toBe(2);
    expect(pasoUnidades(dosCorazones)).toBe(16);
    expect(pasoUnidades(gaseosa, 'bulto')).toBe(6);
    expect(pasoUnidades(gaseosa, 'unidad')).toBe(1);
  });

  it('AC-TIE-9 minimoVenta, múltiplos y sin stock', () => {
    expect(validarRenglon({ cantidad: 1 }, gaseosa).errores[0]).toMatch(/mínimo/);
    expect(validarRenglon({ cantidad: 20 }, dosCorazones).ok).toBe(false);
    expect(validarRenglon({ cantidad: 32 }, dosCorazones).ok).toBe(true);
    expect(validarRenglon({ cantidad: 1 }, alfajor).errores).toContain('Sin stock');
    expect(validarRenglon({ cantidad: 1 }, alfajor, { permitirSinStock: true }).ok).toBe(true);
  });

  it('AC-TIE-15 topes: renglones, unidades por renglón y total', () => {
    const muchos = {};
    const lineas = [];
    for (let i = 0; i < MAX_RENGLONES + 1; i++) {
      muchos[`x${i}`] = { ...alfajor, id: `x${i}`, precio: 1, disponible: true };
      lineas.push({ productoId: `x${i}`, cantidad: 1 });
    }
    expect(calcularCarrito(lineas, muchos).errores.some(e => /Máximo 150/.test(e.mensaje))).toBe(true);
    expect(calcularCarrito([{ productoId: 'p-gaseosa', cantidad: 50 }], catalogoMap(), { maxUnidadesRenglon: 10 }).errores.length).toBe(1);
    const grande = calcularCarrito([{ productoId: 'p-gaseosa', cantidad: 900000 }], catalogoMap(), { maxTotal: 1000 });
    expect(grande.errores.some(e => /máximo/.test(e.mensaje))).toBe(true);
    expect(grande.total).toBe(1125450000);
  });

  it('AC-TIE-11 entradas inválidas no rompen', () => {
    const r = calcularCarrito([null, { productoId: 'nope', cantidad: 1 }, { productoId: 'p-gaseosa', cantidad: NaN }, { productoId: 'p-gaseosa', cantidad: -3 }], catalogoMap());
    expect(r.renglones).toEqual([]);
    expect(r.errores.length).toBe(4);
    expect(calcularCarrito(undefined, undefined).total).toBe(0);
  });

  it('AC-TIE-11 oferta vigente, vencida y en el borde del día', () => {
    const o = [ofertaBorde];
    expect(precioVigente(dosCorazones, o, '2026-10-14')).toEqual({ precio: 800, enOferta: true });
    expect(precioVigente(dosCorazones, o, '2026-10-10')).toEqual({ precio: 800, enOferta: true });
    expect(precioVigente(dosCorazones, o, '2026-10-15')).toEqual({ precio: 900, enOferta: false });
    expect(precioVigente(dosCorazones, o, '2026-10-09')).toEqual({ precio: 900, enOferta: false });
    expect(precioVigente(dosCorazones, [{ ...ofertaBorde, productoId: 'otro' }], '2026-10-12').enOferta).toBe(false);
  });

  it('AC-TIE-13 compararConServidor detecta precio, disponibilidad y producto faltante', () => {
    const visto = { renglones: [{ productoId: 'a', precio: 10, disponible: true, unidades: 2 }] };
    expect(compararConServidor(visto, { renglones: [{ productoId: 'a', precio: 10, disponible: true, unidades: 2 }] }).cambio).toBe(false);
    expect(compararConServidor(visto, { renglones: [{ productoId: 'a', precio: 11, disponible: true, unidades: 2 }] }).diffs[0].campo).toBe('precio');
    expect(compararConServidor(visto, { renglones: [{ productoId: 'a', precio: 10, disponible: false, unidades: 2 }] }).cambio).toBe(true);
    expect(compararConServidor(visto, { renglones: [] }).diffs[0].campo).toBe('producto');
  });

  it('AC-TIE-9 textoEquivalencia', () => {
    expect(textoEquivalencia(48, dosCorazones)).toBe('48 u. (3 Display)');
    expect(textoEquivalencia(20, dosCorazones)).toBe('20 u. (1 Display + 4 u.)');
    expect(textoEquivalencia(5, alfajor)).toBe('5 u.');
  });

  it('AC-TIE-10 serializar/restaurar: ida y vuelta, 7 días y JSON roto', () => {
    const now = Date.UTC(2026, 9, 14);
    const c = { lineas: [{ productoId: 'p1', unidades: 16, modo: 'bulto', precioVisto: 900 }] };
    expect(restaurarCarrito(serializarCarrito(c, now), now + 1000)).toEqual({ lineas: [{ productoId: 'p1', unidades: 16, modo: 'bulto', precioVisto: 900 }] });
    expect(restaurarCarrito(serializarCarrito(c, now), now + 8 * 86400000)).toBeNull();
    expect(restaurarCarrito('{no json', now)).toBeNull();
    expect(restaurarCarrito(null, now)).toBeNull();
    expect(restaurarCarrito('{"v":1,"at":1,"carrito":5}', now)).toBeNull();
    const sucio = JSON.stringify({ v: 1, at: now, carrito: { lineas: [{ productoId: 'x', unidades: -1 }, { unidades: 2 }] } });
    expect(restaurarCarrito(sucio, now).lineas).toEqual([]);
  });

  it('AC-TIE-13 armarPayloadPedido: forma, modo unidad y honeypot', () => {
    const p = armarPayloadPedido({ lineas: [{ productoId: 'p1', unidades: 48, precioVisto: 900 }] }, { nombre: 'Ana', hp: '' }, 'tok', 'idem-1');
    expect(p).toMatchObject({ idempotencia: 'idem-1', token: 'tok', hp: '' });
    expect(p.items).toEqual([{ productoId: 'p1', cantidad: 48, modo: 'unidad', precioVisto: 900 }]);
    expect(armarPayloadPedido({ lineas: [] }, null, '', 'i').token).toBeNull();
  });
});
