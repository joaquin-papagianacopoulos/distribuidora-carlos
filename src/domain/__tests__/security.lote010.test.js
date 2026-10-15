// Seguridad del lote operacion (migracion 010): chequeos estaticos del SQL y del PDF.
// Corrida 20261015-0043.
import fs from 'fs';
import path from 'path';

const sql = fs.readFileSync(path.join(__dirname, '../../../supabase/migrations/010_lote_operacion_precios.sql'), 'utf8');
const funcion = (nombre) => {
  const i = sql.indexOf(`create or replace function public.${nombre}`);
  expect(i).toBeGreaterThan(-1);
  const f = sql.indexOf('end $$;', i);
  return sql.slice(i, f > -1 ? f : undefined);
};

describe('010: RPC security definer con search_path fijo', () => {
  test.each(['admin_guardar_productos', 'tienda_crear_pedido', 'tienda_catalogo', 'admin_registrar_cambios_precio'])('%s', (n) => {
    const f = funcion(n);
    expect(f).toMatch(/security definer/);
    expect(f).toMatch(/set search_path = public(, extensions)?, pg_temp/);
  });
  test('helpers con search_path fijo', () => {
    expect(funcion('tienda_precio_aplicado')).toMatch(/set search_path = public, pg_temp/);
    expect(funcion('tienda_minimo_efectivo')).toMatch(/set search_path = public, pg_temp/);
  });
});

describe('010: grants', () => {
  test('helpers sin acceso para anon/authenticated/public', () => {
    expect(sql).toMatch(/revoke all on function public\.tienda_precio_aplicado\([^)]*\) from public, anon, authenticated/);
    expect(sql).toMatch(/revoke all on function public\.tienda_minimo_efectivo\([^)]*\) from public, anon, authenticated/);
    expect(sql).not.toMatch(/grant execute on function public\.tienda_(precio_aplicado|minimo_efectivo)/);
  });
  test('cambios_precio: RLS, solo select, sin escritura directa', () => {
    expect(sql).toMatch(/alter table public\.cambios_precio enable row level security/);
    expect(sql).toMatch(/revoke all on public\.cambios_precio from public, anon, authenticated/);
    expect(sql).not.toMatch(/create policy[^;]*cambios_precio[^;]*for (insert|update|delete|all)/i);
  });
  test('RPC de escritura exigen admin activo + verificar_pin', () => {
    for (const n of ['admin_guardar_productos', 'admin_registrar_cambios_precio']) {
      const f = funcion(n);
      expect(f).toMatch(/permiso = 1 and activo/);
      expect(f).toMatch(/verificar_pin/);
    }
  });
});

describe('010: el servidor es la autoridad del precio', () => {
  test('crear_pedido recalcula con helpers y no lee precio del cliente', () => {
    const f = funcion('tienda_crear_pedido');
    expect(f).toMatch(/tienda_precio_aplicado\(v_unit, v_prod\.precio_bulto, v_prod\.bulto_x, v_u\)/);
    expect(f).toMatch(/tienda_minimo_efectivo\(/);
    // el unico dato de precio del cliente es precioVisto y solo se COMPARA
    expect(f.match(/precioVisto/g).length).toBe(1);
    expect(f).not.toMatch(/v_e->>'precio'/);
  });
  test('precio_bulto no se escribe en la rama basica', () => {
    const f = funcion('admin_guardar_productos');
    const basica = f.slice(f.indexOf('-- Solo basicas'));
    expect(basica).not.toMatch(/precio_bulto/);
  });
});

describe('PDF de cambios de precio', () => {
  test('no usa HTML ni html()/fromHTML y sanea el nombre de archivo', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../utils/pdfGen.js'), 'utf8');
    const i = src.indexOf('generarCambiosPrecioFile');
    const bloque = src.slice(i);
    expect(bloque).not.toMatch(/\.html\(|fromHTML|innerHTML/);
    expect(bloque).toMatch(/replace\(\/\[\^0-9-\]\/g, ''\)/);
  });
});

describe('010 vuelta 2: hallazgos S-010-01..04', () => {
  test('S-010-01 cambios_precio no expone usuario_id a anon (grant por columnas)', () => {
    const g = sql.match(/grant select \(([^)]*)\)\s+on public\.cambios_precio to anon, authenticated/);
    expect(g).not.toBeNull();
    expect(g[1]).not.toMatch(/usuario_id/);
    expect(g[1]).toMatch(/usuario_nombre/);
    expect(sql).not.toMatch(/grant select on public\.cambios_precio/);
    const svc = fs.readFileSync(path.join(__dirname, '../../services/cambiosPrecioService.js'), 'utf8');
    expect(svc).not.toMatch(/from\('cambios_precio'\)\.select\('\*'\)/);
    expect(svc).not.toMatch(/COLUMNAS_CAMBIOS = '[^']*usuario_id/);
  });
  test('S-010-02 rechaza NaN en precio, precio_bulto y cambios_precio', () => {
    expect(funcion('admin_guardar_productos')).toMatch(/v_precio = 'NaN'::numeric/);
    expect(funcion('admin_guardar_productos')).toMatch(/v_pbulto = 'NaN'::numeric/);
    const f = funcion('admin_registrar_cambios_precio');
    ['v_pn', 'v_bn', 'v_pa', 'v_ba'].forEach(v => expect(f).toContain(`${v} = 'NaN'::numeric`));
  });
  test('S-010-03 revoke all sobre cambios_precio antes del grant select', () => {
    const r = sql.indexOf('revoke all on public.cambios_precio from public, anon, authenticated');
    expect(r).toBeGreaterThan(-1);
    expect(sql.indexOf('grant select (', r)).toBeGreaterThan(r);
  });
  test('S-010-04 re-emite revoke/grant de tienda_catalogo y tienda_crear_pedido al final', () => {
    const cola = sql.slice(sql.lastIndexOf('create or replace function'));
    expect(cola).toMatch(/revoke all on function public\.tienda_catalogo\(\) from public/);
    expect(cola).toMatch(/revoke all on function public\.tienda_crear_pedido\(jsonb\) from public/);
    expect(cola).toMatch(/grant execute on function public\.tienda_catalogo\(\) to anon, authenticated/);
    expect(cola).toMatch(/grant execute on function public\.tienda_crear_pedido\(jsonb\) to anon, authenticated/);
  });
});
