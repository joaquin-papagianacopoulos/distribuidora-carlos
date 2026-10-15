// REQ-PBU (AC-PBU-1/3/5) y REQ-HPR (AC-HPR-1/2/3): funciones puras de precios.
import {
  precioAplicado, precioAplicadoRenglon, esPrecioManual, precioBaseRenglon, avisoPrecioBulto,
  cambioDePrecio, resumirCambiosPrecio, filasPdfSoloPrecioNuevo, cambioPrecioToRemote, cambioPrecioFromRemote, fechaArgentina,
} from '../precios';
import { renglonNuevo } from '../bultos';
import { validarProducto } from '../productos';

const DC = { id: 1, precio: 900, precioBulto: 800, bultoX: 16 };

describe('AC-PBU-5 precioAplicado', () => {
  it.each([
    ['AC-PBU-5 10 u. -> $900 (ejemplo de la tabla)', DC, 10, 900, false],
    ['AC-PBU-5 15 u. -> $900', DC, 15, 900, false],
    ['AC-PBU-5 16 u. -> $800', DC, 16, 800, true],
    ['AC-PBU-5 20 u. -> $800', DC, 20, 800, true],
    ['AC-PBU-5 bultoX 0 -> sin precio por bulto', { ...DC, bultoX: 0 }, 50, 900, false],
    ['AC-PBU-5 bultoX 1 -> sin precio por bulto', { ...DC, bultoX: 1 }, 50, 900, false],
    ['AC-PBU-5 bultoX vacío -> sin precio por bulto', { ...DC, bultoX: '' }, 50, 900, false],
    ['AC-PBU-5 precioBulto vacío', { ...DC, precioBulto: '' }, 20, 900, false],
    ['AC-PBU-5 precioBulto 0', { ...DC, precioBulto: 0 }, 20, 900, false],
    ['AC-PBU-5 precioBulto mayor que el unitario: se cobra el menor', { ...DC, precioBulto: 1000 }, 20, 900, true],
    ['AC-PBU-5 cantidad decimal 16,5 (>= bulto)', DC, 16.5, 800, true],
    ['AC-PBU-5 cantidad decimal 15,9 (< bulto)', DC, 15.9, 900, false],
    ['AC-PBU-5 centavos', { precio: 10.005, precioBulto: 9.994, bultoX: 2 }, 2, 9.99, true],
    ['AC-PBU-5 cantidad inválida', DC, 'x', 900, false],
  ])('%s', (_d, prod, cant, precio, porBulto) => {
    expect(precioAplicado(prod, cant)).toEqual({ precio, porBulto });
  });
  it('AC-PBU-5 producto indefinido no explota', () => {
    expect(precioAplicado(undefined, 3)).toEqual({ precio: 0, porBulto: false });
  });
  it('AC-PBU-5 importes del ejemplo: 10 u. $9.000, 16 u. $12.800, 20 u. $16.000', () => {
    const imp = (c) => precioAplicado(DC, c).precio * c;
    expect([imp(10), imp(16), imp(20)]).toEqual([9000, 12800, 16000]);
  });
});

describe('AC-PBU-3 renglón: re-precio al cambiar la cantidad', () => {
  const prod = { ...DC, nombre: 'DC', ventaPor: 'ambos' };
  it('AC-PBU-3 renglonNuevo congela precios y arranca a precio por unidad', () => {
    const r = renglonNuevo(prod);
    expect(r).toMatchObject({ precio: 900, precioOriginal: 900, precioBultoOriginal: 800, precioPorBulto: false, cantidad: 1 });
  });
  it('AC-PBU-3 subir a un bulto baja el precio y bajar lo devuelve', () => {
    const r = renglonNuevo(prod);
    const arriba = precioAplicadoRenglon(r, 16);
    expect(arriba).toMatchObject({ precio: 800, precioOriginal: 900, precioPorBulto: true });
    expect(precioAplicadoRenglon(arriba, 10)).toMatchObject({ precio: 900, precioPorBulto: false });
  });
  it('AC-PBU-3 precio manual o descuento se respeta', () => {
    const r = renglonNuevo(prod);
    expect(precioAplicadoRenglon({ ...r, precio: 850, precioManual: true }, 16).precio).toBe(850);
    expect(precioAplicadoRenglon({ ...r, precio: 810, descuentoPct: 10 }, 16).precio).toBe(810);
    expect(precioAplicadoRenglon({ ...r, precio: 700 }, 16).precio).toBe(700);
  });
  it('AC-PBU-3 renglón legacy (sin precioBultoOriginal) nunca usa precio por bulto', () => {
    const legacy = { productoId: 1, precio: 900, precioOriginal: 900, cantidad: 1 };
    expect(precioAplicadoRenglon(legacy, 32)).toBe(legacy);
  });
  it('AC-PBU-3 esPrecioManual y precioBaseRenglon', () => {
    const r = renglonNuevo(prod);
    expect(esPrecioManual(r)).toBe(false);
    expect(esPrecioManual({ ...r, precio: 1 })).toBe(true);
    expect(esPrecioManual({ ...r, precio: 800, precioPorBulto: true })).toBe(false);
    expect(esPrecioManual({ ...r, descuentoPct: 5 })).toBe(true);
    expect(esPrecioManual(null)).toBe(false);
    expect(precioBaseRenglon({ ...r, precio: 800, precioPorBulto: true })).toBe(800);
    expect(precioBaseRenglon(r)).toBe(900);
  });
});

describe('AC-PBU-1 formulario de producto', () => {
  it('AC-PBU-1 precioBulto >= 0; vacío = 0', () => {
    expect(validarProducto({ codigo: 'A', nombre: 'A', precio: '900', precioBulto: '' }).producto.precioBulto).toBe(0);
    const r = validarProducto({ codigo: 'A', nombre: 'A', precio: '900', precioBulto: '800,5' });
    expect(r.ok).toBe(true);
    expect(r.producto.precioBulto).toBe(800.5);
    expect(validarProducto({ codigo: 'A', nombre: 'A', precio: '900', precioBulto: '-1' }).errores.precioBulto).toBeTruthy();
  });
  it('AC-PBU-1 mayor que el unitario: se avisa pero no se bloquea', () => {
    const r = validarProducto({ codigo: 'A', nombre: 'A', precio: '900', precioBulto: '1000' });
    expect(r.ok).toBe(true);
    expect(avisoPrecioBulto(900, 1000)).toMatch(/mayor/);
    expect(avisoPrecioBulto(900, 800)).toBeNull();
    expect(avisoPrecioBulto(900, 0)).toBeNull();
  });
});

describe('AC-HPR-1 cambioDePrecio', () => {
  const now = new Date('2026-10-15T02:30:00Z'); // 23:30 del 14 en Argentina
  const opts = { usuario: { id: 'u1', nombre: 'Admin' }, now, genId: () => 'uuid-1' };
  const previo = { id: 7, codigo: 'A1', nombre: 'Alfajor', categoria: 'Golosinas', precio: 100, precioBulto: 0 };
  it('AC-HPR-1 sin cambio real no registra (mismo valor en centavos)', () => {
    expect(cambioDePrecio(previo, { ...previo, precio: 100.001 }, opts)).toBeNull();
    expect(cambioDePrecio(previo, { ...previo, nombre: 'Otro' }, opts)).toBeNull();
  });
  it('AC-HPR-1 cambia precio: anterior -> nuevo, fecha AR, usuario, UUID', () => {
    const c = cambioDePrecio(previo, { ...previo, precio: 120 }, opts);
    expect(c).toMatchObject({ id: 'uuid-1', productoId: '7', codigo: 'A1', rubro: 'Golosinas', precioAnterior: 100, precioNuevo: 120, precioBultoAnterior: 0, precioBultoNuevo: 0, fecha: '2026-10-14', usuarioNombre: 'Admin', pendingSync: true });
    expect(c.creadoEn).toBe(now.toISOString());
  });
  it('AC-HPR-1 cambia solo precioBulto', () => {
    const c = cambioDePrecio(previo, { ...previo, precioBulto: 90 }, opts);
    expect(c).toMatchObject({ precioAnterior: 100, precioNuevo: 100, precioBultoAnterior: 0, precioBultoNuevo: 90 });
  });
  it('AC-HPR-1 alta con precio: anterior null; alta sin precio no registra', () => {
    expect(cambioDePrecio(null, { id: 1, codigo: 'N', nombre: 'N', precio: 50 }, opts)).toMatchObject({ precioAnterior: null, precioBultoAnterior: null, precioNuevo: 50 });
    expect(cambioDePrecio(null, { id: 1, codigo: 'N', nombre: 'N', precio: 0 }, opts)).toBeNull();
  });
  it('AC-HPR-1 ida y vuelta remota', () => {
    const c = cambioDePrecio(previo, { ...previo, precio: 120 }, opts);
    const r = cambioPrecioToRemote(c);
    expect(r).toMatchObject({ id: 'uuid-1', producto_id: '7', precio_nuevo: 120, fecha: '2026-10-14' });
    expect(cambioPrecioFromRemote(r)).toMatchObject({ id: 'uuid-1', productoId: '7', precioNuevo: 120, pendingSync: false });
  });
  it('AC-HPR-1 fechaArgentina usa UTC-3', () => {
    expect(fechaArgentina(new Date('2026-10-15T02:59:00Z'))).toBe('2026-10-14');
    expect(fechaArgentina(new Date('2026-10-15T03:00:00Z'))).toBe('2026-10-15');
  });
});

describe('AC-HPR-2 / AC-HPR-3 resumen y PDF', () => {
  const c = (id, productoId, nombre, rubro, ant, nue, creadoEn, fecha = '2026-10-15', extra = {}) => ({
    id, productoId, codigo: `C${productoId}`, nombre, rubro, precioAnterior: ant, precioNuevo: nue,
    precioBultoAnterior: 0, precioBultoNuevo: 0, fecha, creadoEn, ...extra,
  });
  const cambios = [
    c('a2', 1, 'Zeta', 'Bebidas', 110, 130, '2026-10-15T15:00:00Z'),
    c('a1', 1, 'Zeta', 'Bebidas', 100, 110, '2026-10-15T12:00:00Z'),
    c('b1', 2, 'Alfa', 'Bebidas', 50, 60, '2026-10-15T12:00:00Z'),
    c('c1', 3, 'Beta', 'Almacen', null, 20, '2026-10-15T12:00:00Z'),
    c('d1', 4, 'Viejo', 'Almacen', 10, 11, '2026-10-01T12:00:00Z', '2026-10-01'),
    c('e1', 5, 'Vuelve', 'Bebidas', 10, 12, '2026-10-15T10:00:00Z'),
    c('e2', 5, 'Vuelve', 'Bebidas', 12, 10, '2026-10-15T11:00:00Z'),
  ];
  it('AC-HPR-2 primer anterior, último nuevo, variación % y orden rubro/nombre', () => {
    const f = resumirCambiosPrecio(cambios, { desde: '2026-10-15', hasta: '2026-10-15' });
    expect(f.map(x => x.nombre)).toEqual(['Beta', 'Alfa', 'Zeta']);
    expect(f[2]).toMatchObject({ precioAnterior: 100, precioNuevo: 130, variacionPct: 30 });
    expect(f[0]).toMatchObject({ precioAnterior: null, variacionPct: null });
  });
  it('AC-HPR-2 rango incluye más días y el que queda igual no aparece', () => {
    const f = resumirCambiosPrecio(cambios, { desde: '2026-10-01', hasta: '2026-10-31' });
    expect(f.map(x => x.nombre)).toEqual(['Beta', 'Viejo', 'Alfa', 'Zeta']);
  });
  it('AC-HPR-2 mismo creadoEn desempata por id y entrada vacía no explota', () => {
    const f = resumirCambiosPrecio([c('x2', 9, 'P', 'R', 5, 7, 'T'), c('x1', 9, 'P', 'R', 3, 5, 'T')]);
    expect(f[0]).toMatchObject({ precioAnterior: 3, precioNuevo: 7 });
    expect(resumirCambiosPrecio(undefined)).toEqual([]);
  });
  it('AC-HPR-3 solo precio nuevo: código, producto, precio y precio llevando bulto', () => {
    const filas = resumirCambiosPrecio([c('z', 1, 'Zeta', 'B', 1, 2, 'T', '2026-10-15', { precioBultoNuevo: 1.5 })]);
    expect(filasPdfSoloPrecioNuevo(filas, new Map())).toEqual([{ codigo: 'C1', nombre: 'Zeta', precio: 2, precioBulto: 1.5 }]);
    expect(filasPdfSoloPrecioNuevo([{ productoId: 1, precioNuevo: 3, precioBultoNuevo: 0 }], new Map([['1', { codigo: 'K', nombre: 'Actual' }]])))
      .toEqual([{ codigo: 'K', nombre: 'Actual', precio: 3, precioBulto: null }]);
  });
});
