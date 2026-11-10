// REQ-SEG2 (AC-SEG2-2, AC-SEG2-6): pendientes, borrado de caché y respaldo.
import { esPendiente, contarPendientes, textoPendientes, decidirBorradoCache, confirmacionEscritaValida, armarRespaldo, nombreArchivoRespaldo } from '../respaldo';

describe('AC-SEG2-2 esPendiente / contarPendientes', () => {
  test('AC-SEG2-2 reconoce los flags de pendiente', () => {
    expect(esPendiente('pedidos', { synced: false })).toBe(true);
    expect(esPendiente('pedidos', { synced: true })).toBe(false);
    expect(esPendiente('clientes', { pendingSync: true })).toBe(true);
    expect(esPendiente('productos', { extrasPendientes: true })).toBe(true);
    expect(esPendiente('pedidos', { entregaPendiente: true })).toBe(true);
    expect(esPendiente('movimientosStock', { pendingSync: false })).toBe(false);
  });
  test('AC-SEG2-2 faltantes sin remoteId, borradores y comprobantes siempre; costosVenta nunca', () => {
    expect(esPendiente('faltantes', { id: 1 })).toBe(true);
    expect(esPendiente('faltantes', { id: 1, remoteId: 'x' })).toBe(false);
    expect(esPendiente('comisionesBorradores', { id: 'a' })).toBe(true);
    expect(esPendiente('comprobantesPendientes', { id: 'a' })).toBe(true);
    expect(esPendiente('costosVenta', { pendingSync: true })).toBe(false);
    expect(esPendiente('storeNuevo', { pendingSync: true })).toBe(true);
    expect(esPendiente('storeNuevo', null)).toBe(false);
  });
  test('AC-SEG2-2 contarPendientes suma por store y textoPendientes lo nombra', () => {
    const r = contarPendientes({ pedidos: [{ synced: false }, { synced: true }], clientes: [{ pendingSync: true }, { pendingSync: true }], deudas: [{}] });
    expect(r).toEqual({ total: 3, porStore: { pedidos: 1, clientes: 2 } });
    expect(textoPendientes(r.porStore)).toBe('1 en pedidos, 2 en clientes');
    expect(contarPendientes(null)).toEqual({ total: 0, porStore: {} });
  });
  test('AC-SEG2-2 decidirBorradoCache: pendientes u offline no borra', () => {
    expect(decidirBorradoCache({ total: 2, online: true })).toEqual({ permitir: false, motivo: 'pendientes' });
    expect(decidirBorradoCache({ total: 0, online: false })).toEqual({ permitir: false, motivo: 'offline' });
    expect(decidirBorradoCache({ total: 0, online: true })).toEqual({ permitir: true, motivo: 'ok' });
  });
  test('AC-SEG2-2 confirmacionEscritaValida pide BORRAR', () => {
    expect(confirmacionEscritaValida(' borrar ')).toBe(true);
    expect(confirmacionEscritaValida('BORRAR')).toBe(true);
    expect(confirmacionEscritaValida('borra')).toBe(false);
    expect(confirmacionEscritaValida(null)).toBe(false);
  });
});

describe('AC-SEG2-6 armarRespaldo', () => {
  test('AC-SEG2-6 saca pin y pinHash en cualquier nivel y no incluye binarios', () => {
    const r = armarRespaldo({
      vendedores: [{ id: 1, nombre: 'A', pin: '1234', pinHash: 'x', pin_hash: 'y', adminPin: 'z', anidado: { pinAdmin: '9', ok: 1 } }],
      comprobantesPendientes: [{ id: 'a', blob: new Blob(['hola']), buf: new ArrayBuffer(4) }],
    }, { now: new Date(2026, 10, 10, 9, 5), dbVersion: 12 });
    const txt = JSON.stringify(r);
    expect(txt).not.toMatch(/1234|pinHash|pin_hash|adminPin|pinAdmin/);
    expect(r.stores.vendedores[0].anidado).toEqual({ ok: 1 });
    expect(r.stores.comprobantesPendientes[0]).toEqual({ id: 'a', blob: '[archivo no incluido]', buf: '[archivo no incluido]' });
    expect(r.dbVersion).toBe(12);
  });
  test('AC-SEG2-6 nombre de archivo con fecha y hora', () => {
    expect(nombreArchivoRespaldo(new Date(2026, 10, 10, 9, 5))).toBe('respaldo-distribuidora-2026-11-10-0905.json');
  });
});

describe('AC-SEG2-6 respaldo sin datos financieros para no-admin', () => {
  const snap = {
    costosVenta: [{ id: 1, costoUnitario: 5 }],
    ingresosCostos: [{ id: 1 }],
    cuentaProveedores: [{ id: 1 }],
    productos: [{ id: 1, nombre: 'A', precio: 10, costoFinal: 4, descuento1: 5, ganancia: 30, pin: '1234' }],
    pedidos: [{ id: 1, items: [{ productoId: 1, costoUnitario: 4, precio: 10 }] }],
  };
  test('AC-SEG2-6 no-admin: sin stores financieros ni claves de costo/ganancia/descuento', () => {
    const r = armarRespaldo(snap).stores;
    expect(r.costosVenta).toBeUndefined();
    expect(r.ingresosCostos).toBeUndefined();
    expect(r.cuentaProveedores).toBeUndefined();
    expect(r.productos[0]).toEqual({ id: 1, nombre: 'A', precio: 10 });
    expect(r.pedidos[0].items[0]).toEqual({ productoId: 1, precio: 10 });
  });
  test('AC-SEG2-6 admin: incluye costos pero nunca el pin', () => {
    const r = armarRespaldo(snap, { esAdmin: true }).stores;
    expect(r.costosVenta).toHaveLength(1);
    expect(r.productos[0].costoFinal).toBe(4);
    expect('pin' in r.productos[0]).toBe(false);
  });
});

describe('AC-SEG2-6 respaldo sin claves secretas', () => {
  test('AC-SEG2-6 filtra token, apikey, password, clave y secret aun para admin', () => {
    const r = armarRespaldo({ config: [{ id: 1, accessToken: 'a', api_key: 'b', apiKey: 'c', password: 'd', clave: 'e', clientSecret: 'f', nombre: 'ok' }] }, { esAdmin: true }).stores.config[0];
    expect(r).toEqual({ id: 1, nombre: 'ok' });
  });
});
