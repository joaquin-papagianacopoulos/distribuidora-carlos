// REQ-VTA (run 20261014-1621): entradas maliciosas en marca/ventaPor/bultoNombre/visibleTienda.
import { readFileSync } from 'fs';
import path from 'path';
import { validarProducto, productoVentaToRemote, productoExtraFromRemote } from '../productos';
import { validarFilaProducto } from '../plantillas';
import { validarUnidadVenta, ventaPorEfectivo, normalizarBultoNombre, parsearBooleano } from '../unidadVenta';
import { normalizarMarca } from '../marcas';

const base = { codigo: 'A1', nombre: 'Prod', precio: '10' };

describe('REQ-VTA seguridad', () => {
  test('marca enorme se recorta a 60 y sin caracteres de control', () => {
    expect(normalizarMarca('A'.repeat(100000)).length).toBeLessThanOrEqual(60);
    expect(normalizarMarca('Mar\u0000ca\u0007')).not.toMatch(/[\u0000-\u001f]/);
  });
  test('ventaPor/bultoNombre con payloads no pasan al remoto', () => {
    for (const mal of ["'; drop table productos;--", '<script>', 'bulto\u0000', {}, [], 'Infinity', NaN]) {
      const r = validarUnidadVenta({ ventaPor: mal, bultoX: 12, bultoNombre: mal, visibleTienda: mal });
      expect(['unidad', 'bulto', 'ambos']).toContain(r.valor.ventaPor);
      expect(['Bulto', 'Display', 'Caja', 'Pack']).toContain(r.valor.bultoNombre);
      expect(typeof r.valor.visibleTienda).toBe('boolean');
    }
    expect(normalizarBultoNombre('<img onerror=1>')).toBe('Bulto');
  });
  test('ventaPor=bulto sin bultoX>1 se rechaza (incl. 0, negativo, NaN, Infinity)', () => {
    for (const bx of [undefined, 0, 1, -5, NaN, Infinity, '1e309', 'abc']) {
      expect(validarUnidadVenta({ ventaPor: 'bulto', bultoX: bx }).ok).toBe(false);
    }
  });
  test('remoto manipulado: bulto sin bultoX degrada a unidad; valores raros no rompen', () => {
    expect(ventaPorEfectivo({ ventaPor: 'bulto', bultoX: 1 })).toBe('unidad');
    expect(ventaPorEfectivo({ ventaPor: '__proto__', bultoX: 6 })).toBe('ambos');
    const r = productoVentaToRemote({ ventaPor: 'xx', bultoNombre: 'zz', visibleTienda: 'no', bultoX: 1 });
    expect(r).toEqual({ venta_por: 'unidad', bulto_nombre: 'Bulto', visible_tienda: false });
    const l = productoExtraFromRemote({ bulto_nombre: '<b>', visible_tienda: 'false' }, {});
    expect(l.bultoNombre).toBe('Bulto');
  });
  test('validarProducto: payload completo no deja valores fuera de lista', () => {
    const r = validarProducto({ ...base, marca: '=cmd|"/c calc"!A1', ventaPor: 'x', bultoNombre: 'y', visibleTienda: 'z' });
    const v = r.valor || r.producto || r.datos;
    if (v) expect(['Bulto', 'Display', 'Caja', 'Pack']).toContain(v.bultoNombre);
    else expect(r.ok).toBe(false);
  });
  test('plantilla: marca con formula injection se neutraliza', () => {
    for (const f of ['=1+1', '+SUM(A1)', '-2+3', '@SUM(1)']) {
      const r = validarFilaProducto({ ...base, marca: f }, { modo: 'plantilla' });
      expect(String(r.valor?.producto?.marca ?? '')).not.toMatch(/^[=+\-@]/);
    }
  });
  test('plantilla: visibleTienda invalido da error y no valor', () => {
    const r = validarFilaProducto({ ...base, visibleTienda: 'quizas' }, { modo: 'plantilla' });
    expect(r.errores.join(' ')).toMatch(/Sí o No/);
    expect(parsearBooleano('<script>')).toBeNull();
  });
  test('plantilla: ventaPor invalido o bulto sin bultoX es error', () => {
    expect(validarFilaProducto({ ...base, ventaPor: 'mayorista' }, { modo: 'plantilla' }).errores.length).toBeGreaterThan(0);
    expect(validarFilaProducto({ ...base, ventaPor: 'bulto', bultoX: '1' }, { modo: 'plantilla' }).errores.length).toBeGreaterThan(0);
  });
  test('migracion 006: sin grants/policies, constraints idempotentes, sin drop/delete', () => {
    const sql = readFileSync(path.join(__dirname, '../../../supabase/migrations/006_unidad_venta.sql'), 'utf8')
      .split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
    expect(sql).not.toMatch(/\b(grant|create policy|drop table|delete from|truncate)\b/i);
    expect(sql).toMatch(/productos_venta_por_chk/);
    expect(sql).toMatch(/productos_bulto_nombre_chk/);
    expect(sql).toMatch(/productos_venta_bulto_chk/);
  });
});
