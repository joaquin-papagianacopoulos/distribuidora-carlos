// Iteracion 2 de REQ-COM: helpers de rol y PIN (S-COM-11, S-COM-01) y guard
// de la marca de entregado (S-COM-05).
import { ROLES, permisoValido, esAdmin, esArmador, validarPinIngresado, MAX_PIN } from '../permisos';
import { validarCambioEntrega, esPendienteDeServidor, contarPendientesServidor } from '../comisiones';

describe('AC-SEC-4 S-COM-11 permiso entero validado', () => {
  it('AC-SEC-4 S-COM-11 solo los numeros 1, 2 y 3 son permisos validos', () => {
    expect([1, 2, 3].map(permisoValido)).toEqual([1, 2, 3]);
    for (const p of ['1', '2', '3', 1.5, 0, 4, 99, -1, NaN, Infinity, true, [1], { valueOf: () => 1 }, null, undefined, '']) {
      expect(permisoValido(p)).toBeNull();
    }
  });

  it('AC-SEC-4 S-COM-11 esAdmin / esArmador son estrictos (un "1" forjado en texto no es admin)', () => {
    expect(esAdmin(ROLES.ADMIN)).toBe(true);
    expect(esArmador(ROLES.ARMADOR)).toBe(true);
    for (const p of ['1', 1.0001, true, [1], 2, 3, null, undefined]) expect(esAdmin(p)).toBe(false);
    for (const p of ['3', 3.5, 1, 2, null]) expect(esArmador(p)).toBe(false);
  });
});

describe('AC-SEC-2 S-COM-01 PIN del admin ingresado', () => {
  it('AC-SEC-2 S-COM-01 acepta texto o numero, recorta espacios; vacio, largo o con control => error', () => {
    expect(validarPinIngresado(' 1234 ')).toEqual({ ok: true, pin: '1234', error: null });
    expect(validarPinIngresado(4321)).toEqual({ ok: true, pin: '4321', error: null });
    for (const p of [undefined, null, '', '   ', {}, ['1']]) expect(validarPinIngresado(p)).toMatchObject({ ok: false, pin: null, error: expect.stringMatching(/PIN/) });
    expect(validarPinIngresado('1'.repeat(MAX_PIN + 1))).toMatchObject({ ok: false, error: 'PIN inválido' });
    expect(validarPinIngresado('12\u000034')).toMatchObject({ ok: false, error: 'PIN inválido' });
  });
});

describe('AC-COM-1 S-COM-05 guard de cambio de entrega (mismos roles que la UI)', () => {
  const fact = { id: 1, estado: 'facturado', entregado: false };
  const entregado = { ...fact, entregado: true };

  it('AC-COM-1 S-COM-05 marcar: admin y armador si; vendedor, desconocido o "1" en texto no', () => {
    expect(validarCambioEntrega(fact, true, 1).ok).toBe(true);
    expect(validarCambioEntrega(fact, true, 3).ok).toBe(true);
    for (const p of [2, '1', '3', null, undefined, 99]) expect(validarCambioEntrega(fact, true, p)).toMatchObject({ ok: false, motivo: expect.stringMatching(/permiso/) });
    expect(validarCambioEntrega({ ...fact, estado: 'pendiente' }, true, 1)).toMatchObject({ ok: false, motivo: expect.stringMatching(/facturado/) });
  });

  it('AC-COM-1 S-COM-05 desmarcar: requiere que este entregado; si esta en un cierre, solo admin', () => {
    expect(validarCambioEntrega(entregado, false, 3).ok).toBe(true);
    expect(validarCambioEntrega(entregado, false, 2).ok).toBe(false);
    expect(validarCambioEntrega(fact, false, 1).ok).toBe(false);
    expect(validarCambioEntrega(entregado, false, 3, 'cierre-1').ok).toBe(false);
    expect(validarCambioEntrega(entregado, false, 1, 'cierre-1')).toMatchObject({ ok: true, requiereConfirmacion: true });
  });
});

describe('AC-COM-16 S-COM-01 pendientes de confirmar por el servidor', () => {
  it('AC-COM-16 S-COM-01 cierre pendiente con pendingSync o vigente con anulacion pendiente', () => {
    const cierres = [
      { estado: 'pendiente', pendingSync: true },
      { estado: 'pendiente', pendingSync: false },
      { estado: 'vigente', anulacionPendiente: { por: 'Jorge', motivo: 'x' } },
      { estado: 'vigente' },
      { estado: 'rechazado', pendingSync: true },
      null,
    ];
    expect(cierres.map(esPendienteDeServidor)).toEqual([true, false, true, false, false, false]);
    expect(contarPendientesServidor(cierres)).toBe(2);
    expect(contarPendientesServidor(null)).toBe(0);
    expect(contarPendientesServidor('x')).toBe(0);
  });
});
