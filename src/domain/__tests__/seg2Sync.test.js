// REQ-SEG2: idempotencia de pedidos (AC-SEG2-3), guardas del sync (AC-SEG2-4 / AC-SEG2-7) y anulación de deudas (AC-SEG2-1).
import { asegurarClientUuid, clientUuidToRemote, mapearRemoteIds, vincularPorClientUuid } from '../pedidosIdempotencia';
import { idsSinCambios, puedeMarcarSynced, idsFaltantesABorrar } from '../syncGuardas';
import { anularDeuda, esDeudaAnulada } from '../deudas';

describe('AC-SEG2-3 pedidosIdempotencia', () => {
  test('AC-SEG2-3 asegurarClientUuid asigna uno y no pisa el existente', () => {
    expect(asegurarClientUuid({ a: 1 }, () => 'u1')).toEqual({ a: 1, clientUuid: 'u1' });
    expect(asegurarClientUuid({ clientUuid: 'x' }, () => 'u2').clientUuid).toBe('x');
    expect(typeof asegurarClientUuid({}).clientUuid).toBe('string');
  });
  test('AC-SEG2-3 clientUuidToRemote', () => {
    expect(clientUuidToRemote({ clientUuid: 'u' })).toEqual({ client_uuid: 'u' });
    expect(clientUuidToRemote({})).toEqual({});
  });
  test('AC-SEG2-3 mapearRemoteIds cruza por UUID aunque la respuesta venga parcial y desordenada', () => {
    const enviados = [{ localId: 1, clientUuid: 'a' }, { localId: 2, clientUuid: 'b' }, { localId: 3, clientUuid: 'c' }];
    const filas = [{ id: 30, client_uuid: 'c' }, { id: 10, client_uuid: 'a' }];
    expect(mapearRemoteIds(enviados, filas)).toEqual([{ localId: 1, remoteId: 10 }, { localId: 3, remoteId: 30 }]);
    expect(mapearRemoteIds(null, null)).toEqual([]);
  });
  test('AC-SEG2-3 vincularPorClientUuid engancha el remoto al local sin remoteId', () => {
    const locales = [{ id: 5, clientUuid: 'a' }, { id: 6, clientUuid: 'b', remoteId: 99 }, { id: 7 }];
    const remotos = [{ id: 10, clientUuid: 'a' }, { id: 11, clientUuid: 'z' }, { id: 12 }];
    expect(vincularPorClientUuid(locales, remotos)).toEqual({ vinculos: [{ localId: 5, remoteId: 10 }], descartarRemoteIds: [10] });
  });
});

describe('AC-SEG2-4 / AC-SEG2-7 syncGuardas', () => {
  test('AC-SEG2-7 idsSinCambios deja afuera lo editado mientras subía', () => {
    const enviados = [{ id: 1, updatedAt: 10 }, { id: 2, updatedAt: 20 }, { id: 3, updatedAt: 30 }];
    const actuales = [{ id: 1, updatedAt: 10 }, { id: 2, updatedAt: 25 }];
    expect(idsSinCambios(enviados, actuales)).toEqual([1]);
  });
  test('AC-SEG2-7 puedeMarcarSynced', () => {
    expect(puedeMarcarSynced({ updatedAt: 5 }, 5)).toBe(true);
    expect(puedeMarcarSynced({ updatedAt: 6 }, 5)).toBe(false);
    expect(puedeMarcarSynced(null, 5)).toBe(false);
    expect(puedeMarcarSynced({}, undefined)).toBe(true);
  });
  test('AC-SEG2-4 idsFaltantesABorrar solo con lectura completa y remoto no vacío', () => {
    const locales = [{ id: 1, remoteId: 'a' }, { id: 2, remoteId: 'b' }, { id: 3 }, { id: 4, remoteId: 'c', pendingSync: true }];
    const remotos = [{ id: 'a' }];
    expect(idsFaltantesABorrar(locales, remotos, { completo: true })).toEqual([2]);
    expect(idsFaltantesABorrar(locales, remotos, { completo: false })).toEqual([]);
    expect(idsFaltantesABorrar(locales, [], { completo: true })).toEqual([]);
    expect(idsFaltantesABorrar(locales, null, { completo: true })).toEqual([]);
  });
});

describe('AC-SEG2-1 deudas anuladas', () => {
  test('AC-SEG2-1 anularDeuda deja monto 0, pagada y concepto Anulada, pendiente de subir', () => {
    const d = { id: 1, remoteId: 'r', monto: 500, pagada: false, concepto: 'X', synced: true };
    const a = anularDeuda(d, 123);
    expect(a).toMatchObject({ id: 1, remoteId: 'r', monto: 0, pagada: true, concepto: 'Anulada', synced: false, updatedAt: 123 });
    expect(d.monto).toBe(500);
    expect(esDeudaAnulada(a)).toBe(true);
    expect(esDeudaAnulada(d)).toBe(false);
    expect(esDeudaAnulada(null)).toBe(false);
  });
});
