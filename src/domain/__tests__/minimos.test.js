// REQ-MIN (AC-MIN-1/2/3): mínimo para pedir un producto.
import { minimoEfectivo, cantidadInicialConMinimo, puedeGuardarBajoMinimo, validarMinimosItems } from '../minimos';
import { renglonNuevo } from '../bultos';

const P = (extra) => ({ id: 1, nombre: 'P', precio: 10, ...extra });

describe('AC-MIN-3 minimoEfectivo', () => {
  it.each([
    ['AC-MIN-3 vacío/0/1 = sin restricción', P({ minimoVenta: '' }), 1],
    ['AC-MIN-3 0', P({ minimoVenta: 0 }), 1],
    ['AC-MIN-3 1', P({ minimoVenta: 1 }), 1],
    ['AC-MIN-3 unidad no se redondea', P({ minimoVenta: 10, bultoX: 6, ventaPor: 'unidad' }), 10],
    ['AC-MIN-3 ambos no se redondea', P({ minimoVenta: 10, bultoX: 6, ventaPor: 'ambos' }), 10],
    ['AC-MIN-3 por bulto: 10 con bulto x6 => 12', P({ minimoVenta: 10, bultoX: 6, ventaPor: 'bulto' }), 12],
    ['AC-MIN-3 por bulto: 12 ya es múltiplo', P({ minimoVenta: 12, bultoX: 6, ventaPor: 'bulto' }), 12],
    ['AC-MIN-3 por bulto: 2 con bulto x16 => 16', P({ minimoVenta: 2, bultoX: 16, ventaPor: 'bulto' }), 16],
    ['AC-MIN-3 por bulto con mínimo 1 => 1 (sin restricción)', P({ minimoVenta: 1, bultoX: 16, ventaPor: 'bulto' }), 1],
  ])('%s', (_d, prod, esperado) => expect(minimoEfectivo(prod)).toBe(esperado));
  it('AC-MIN-3 producto inválido', () => {
    expect(minimoEfectivo(undefined)).toBe(1);
  });
});

describe('AC-MIN-1 cantidad inicial', () => {
  it('AC-MIN-1 arranca en el mínimo', () => {
    expect(cantidadInicialConMinimo(P({ minimoVenta: 6 }))).toBe(6);
    expect(cantidadInicialConMinimo(P({}))).toBe(1);
    expect(cantidadInicialConMinimo(P({ minimoVenta: 2, bultoX: 16, ventaPor: 'bulto' }))).toBe(16);
  });
  it('AC-MIN-1 renglonNuevo usa el mínimo', () => {
    expect(renglonNuevo(P({ minimoVenta: 6 })).cantidad).toBe(6);
  });
});

describe('AC-MIN-1/2 validarMinimosItems', () => {
  const prods = new Map([['1', P({ minimoVenta: 6, nombre: 'Seis' })], ['2', P({ id: 2, minimoVenta: 1 })]]);
  it('AC-MIN-1 bajo el mínimo: error en el renglón y no se puede guardar (vendedor)', () => {
    const r = validarMinimosItems([{ productoId: 1, nombre: 'Seis', cantidad: 3 }], prods, { permiso: 2, pantalla: 'nuevoPedido' });
    expect(r.errores).toEqual([{ productoId: 1, nombre: 'Seis', minimo: 6 }]);
    expect(r.requiereConfirmacion).toBe(false);
  });
  it('AC-MIN-1 admin en Nuevo pedido también está bloqueado', () => {
    expect(puedeGuardarBajoMinimo(1, 'nuevoPedido')).toBe('no');
  });
  it('AC-MIN-2 admin en Facturación guarda con confirmación; armador no', () => {
    expect(puedeGuardarBajoMinimo(1, 'facturacion')).toBe('confirmar');
    expect(puedeGuardarBajoMinimo(3, 'armado')).toBe('no');
    expect(puedeGuardarBajoMinimo(1, 'armado')).toBe('no');
    expect(puedeGuardarBajoMinimo(2, 'facturacion')).toBe('no');
    const r = validarMinimosItems([{ productoId: 1, cantidad: 3 }], prods, { permiso: 1, pantalla: 'facturacion' });
    expect(r.requiereConfirmacion).toBe(true);
  });
  it('AC-MIN-1 cumple el mínimo, sin mínimo, eliminados y desconocidos no dan error', () => {
    const items = [
      { productoId: 1, cantidad: 6 }, { productoId: 2, cantidad: 1 },
      { productoId: 1, cantidad: 1, eliminado: true }, { productoId: 99, cantidad: 1 },
    ];
    expect(validarMinimosItems(items, prods, { permiso: 2, pantalla: 'nuevoPedido' }).errores).toEqual([]);
  });
  it('AC-MIN-1 renglón legacy que ya estaba bajo el mínimo no bloquea editar otra cosa', () => {
    const previos = [{ productoId: 1, cantidad: 3 }];
    expect(validarMinimosItems([{ productoId: 1, cantidad: 3 }], prods, { permiso: 2, pantalla: 'nuevoPedido', previos }).errores).toEqual([]);
    expect(validarMinimosItems([{ productoId: 1, cantidad: 2 }], prods, { permiso: 2, pantalla: 'nuevoPedido', previos }).errores).toHaveLength(1);
  });
});
