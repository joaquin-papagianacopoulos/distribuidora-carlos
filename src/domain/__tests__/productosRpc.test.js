// S-VTA-01: funciones puras de src/domain/productosRpc.js
import {
  filaProductoRpc, huellaProductoSync, armarLotesProductosRpc, interpretarGuardarProductos,
  interpretarBajaProducto, argsAdminProductos, puedeEditarProductos, MENSAJES_PRODUCTOS,
} from '../productosRpc';

const P = { id: 5, nombre: 'Coca', codigo: 'C1', precio: 100, unidad: 'unidad', categoria: 'Bebidas', marca: 'Coca', stock: 99, costoFinal: 50, bultoX: 6 };

describe('S01-2 / S01-7 filaProductoRpc', () => {
  it('S01-7 nunca lleva stock, con o sin extras', () => {
    expect(filaProductoRpc(P, { conExtras: true })).not.toHaveProperty('stock');
    expect(filaProductoRpc(P)).not.toHaveProperty('stock');
  });
  it('S01-2 sin extras solo basicas y extras:false', () => {
    const f = filaProductoRpc(P);
    expect(f.extras).toBe(false);
    expect(f).not.toHaveProperty('costo_final');
    expect(f).not.toHaveProperty('venta_por');
  });
  it('S01-2 con extras suma 001 y 006', () => {
    const f = filaProductoRpc(P, { conExtras: true });
    expect(f.extras).toBe(true);
    expect(f.costo_final).toBe(50);
    expect(f.bulto_x).toBe(6);
    expect(f).toHaveProperty('venta_por');
    expect(f.visible_tienda).toBe(true);
  });
  it('S01-2 defaults de productos viejos', () => {
    const f = filaProductoRpc({ id: 1, nombre: 'X' });
    expect(f).toMatchObject({ codigo: '', precio: 0, unidad: 'unidad', categoria: '', marca: '', imagen_url: null });
  });
});

describe('S01-4 huellaProductoSync / armarLotesProductosRpc', () => {
  it('S01-4 huella estable y sensible a cambios', () => {
    expect(huellaProductoSync(P)).toBe(huellaProductoSync({ ...P }));
    expect(huellaProductoSync(P)).not.toBe(huellaProductoSync({ ...P, precio: 101 }));
    expect(huellaProductoSync(P)).not.toBe(huellaProductoSync({ ...P, costoFinal: 51 }));
  });
  it('S01-4 lotes de 500 y huellas por id', () => {
    const lista = Array.from({ length: 1200 }, (_, i) => ({ id: i + 1, nombre: `P${i}`, pendingSync: true }));
    const lotes = armarLotesProductosRpc(lista);
    expect(lotes.map(l => l.filas.length)).toEqual([500, 500, 200]);
    expect(lotes[0].huellas.get(1)).toBe(huellaProductoSync(lista[0]));
    expect(lotes[0].ids).toHaveLength(500);
  });
  it('S01-4 ids no enteros seguros se reportan aparte', () => {
    const lotes = armarLotesProductosRpc([{ id: 1.5, nombre: 'a' }, { id: 'x', nombre: 'b' }, { id: 7, nombre: 'c' }]);
    expect(lotes).toHaveLength(1);
    expect(lotes[0].ids).toEqual([7]);
    expect(lotes.invalidos).toHaveLength(2);
  });
  it('S01-4 extrasDirty manda extras en esa fila', () => {
    const [l] = armarLotesProductosRpc([{ id: 1, nombre: 'a', extrasDirty: true }, { id: 2, nombre: 'b' }]);
    expect(l.filas[0].extras).toBe(true);
    expect(l.filas[1].extras).toBe(false);
  });
});

describe('S01-2 interpretarGuardarProductos', () => {
  it('ok con aceptados y rechazados', () => {
    const r = interpretarGuardarProductos({ data: { ok: true, aceptados: [1, 2], rechazados: [{ id: 3, motivo: 'datos_invalidos' }] } });
    expect(r).toMatchObject({ ok: true, aceptados: [1, 2], rechazados: [{ id: 3, motivo: 'datos_invalidos' }] });
  });
  it('no_autorizado y lote_invalido', () => {
    expect(interpretarGuardarProductos({ data: { ok: false, motivo: 'no_autorizado' } })).toMatchObject({ ok: false, motivo: 'no_autorizado', aceptados: [] });
    expect(interpretarGuardarProductos({ data: { ok: false, motivo: 'lote_invalido' } }).motivo).toBe('lote_invalido');
  });
  it('bloqueado por intentos (P0001)', () => {
    expect(interpretarGuardarProductos({ error: { code: 'P0001', message: 'Demasiados intentos, espera' } }).motivo).toBe('bloqueado');
  });
  it('falta_migracion con PGRST202 / 42883', () => {
    expect(interpretarGuardarProductos({ error: { code: 'PGRST202', message: 'x' } }).motivo).toBe('falta_migracion');
    expect(interpretarGuardarProductos({ error: { code: '42883', message: 'x' } }).motivo).toBe('falta_migracion');
  });
  it('respuesta de forma rara => respuesta_invalida, sin aceptados', () => {
    for (const data of [null, 'x', { ok: true }, { ok: true, aceptados: 'a', rechazados: [] }, {}]) {
      const r = interpretarGuardarProductos({ data });
      expect(r.ok).toBe(false);
      expect(r.motivo).toBe('respuesta_invalida');
      expect(r.aceptados).toEqual([]);
    }
  });
  it('otro error => error generico sin detalles del servidor', () => {
    const r = interpretarGuardarProductos({ error: { code: 'XX', message: 'detalle interno secreto' } });
    expect(r.motivo).toBe('error');
    expect(r.mensaje).toBe(MENSAJES_PRODUCTOS.error);
    expect(r.mensaje).not.toMatch(/secreto/);
  });
});

describe('S01-5 interpretarBajaProducto / S01-6 / AC-SEC-2', () => {
  it('ok, ya_borrado y fallas', () => {
    expect(interpretarBajaProducto({ data: { ok: true } })).toMatchObject({ ok: true, yaBorrado: false });
    expect(interpretarBajaProducto({ data: { ok: true, ya_borrado: true } }).yaBorrado).toBe(true);
    expect(interpretarBajaProducto({ data: { ok: false, motivo: 'no_autorizado' } }).motivo).toBe('no_autorizado');
    expect(interpretarBajaProducto({ error: { code: 'PGRST202' } }).motivo).toBe('falta_migracion');
    expect(interpretarBajaProducto({ data: null }).motivo).toBe('respuesta_invalida');
  });
  it('argsAdminProductos recorta y fuerza string', () => {
    expect(argsAdminProductos({ adminId: ' 12 ', adminPin: ' 1234 ' })).toEqual({ p_admin_id: '12', p_admin_pin: '1234' });
    expect(argsAdminProductos({ adminId: 7, adminPin: 55 })).toEqual({ p_admin_id: '7', p_admin_pin: '55' });
    expect(argsAdminProductos()).toEqual({ p_admin_id: '', p_admin_pin: '' });
  });
  it('AC-SEC-4 puedeEditarProductos solo admin', () => {
    expect(puedeEditarProductos(1)).toBe(true);
    for (const p of [2, 3, '1', null, undefined, 0, 99]) expect(puedeEditarProductos(p)).toBe(false);
  });
});
