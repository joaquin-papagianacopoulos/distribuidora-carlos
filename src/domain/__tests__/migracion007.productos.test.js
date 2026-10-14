// S-VTA-01: chequeo estatico de la migracion 007 (se aplica a mano en Supabase).
import { readFileSync } from 'fs';
import path from 'path';

const RAW = readFileSync(path.resolve(__dirname, '..', '..', '..', 'supabase', 'migrations', '007_productos_escritura_admin.sql'), 'utf8');
const SQL = RAW.replace(/--[^\n]*/g, ' ').replace(/\s+/g, ' ').toLowerCase();

describe('S01-1 migracion 007: cierre de escritura', () => {
  it('S01-1 revoca insert/update/delete a anon y authenticated y mantiene select', () => {
    expect(SQL).toContain('revoke insert, update, delete on public.productos from anon, authenticated;');
    expect(SQL).toContain('grant select on public.productos to anon, authenticated;');
    expect(SQL).not.toMatch(/grant\s+(insert|update|delete|all)[^;]*on public\.productos/);
    expect(SQL).not.toMatch(/revoke\s+select/);
  });
  it('S01-1 idempotente y no destructiva', () => {
    expect(SQL.trim().startsWith('begin;')).toBe(true);
    expect(SQL.trim().endsWith('commit;')).toBe(true);
    expect(SQL).toContain('create or replace function public.admin_guardar_productos');
    expect(SQL).toContain('create or replace function public.admin_baja_producto');
    for (const prohibido of [/\bdrop\b/, /\btruncate\b/, /\bdrop policy\b/, /\bdisable row level\b/, /\bdrop table\b/]) {
      expect(SQL).not.toMatch(prohibido);
    }
    // el unico delete es el de admin_baja_producto
    expect((SQL.match(/delete from public\.productos/g) || []).length).toBe(1);
    const iBaja = SQL.indexOf('function public.admin_baja_producto');
    expect(SQL.indexOf('delete from public.productos')).toBeGreaterThan(iBaja);
  });
  it('S01-1 prerrequisitos (verificar_pin, activo, columnas 006) sin SQL dinamico', () => {
    expect(SQL).toContain("to_regprocedure('public.verificar_pin(text, text)')");
    expect(SQL).toContain("column_name = 'activo'");
    expect(SQL).toContain("'venta_por', 'bulto_nombre', 'visible_tienda'");
  });
});

describe('S01-2 / S01-7 RPC de productos', () => {
  it('S01-2 security definer, search_path fijo, permisos de ejecucion', () => {
    expect((SQL.match(/security definer set search_path = public, pg_temp/g) || []).length).toBe(2);
    expect(SQL).toContain('revoke all on function public.admin_guardar_productos(text, text, jsonb) from public;');
    expect(SQL).toContain('grant execute on function public.admin_guardar_productos(text, text, jsonb) to anon, authenticated;');
    expect(SQL).toContain('revoke all on function public.admin_baja_producto(text, text, bigint) from public;');
    expect(SQL).toContain('grant execute on function public.admin_baja_producto(text, text, bigint) to anon, authenticated;');
  });
  it('S01-2 autoriza solo admin activo con PIN y responde no_autorizado generico', () => {
    expect((SQL.match(/public\.verificar_pin\(v_admin_id, p_admin_pin\)/g) || []).length).toBe(2);
    expect((SQL.match(/permiso = 1 and activo and pin_hash is not null/g) || []).length).toBe(2);
    expect((SQL.match(/'motivo', 'no_autorizado'/g) || []).length).toBeGreaterThanOrEqual(4);
  });
  it('S01-2 sin execute, format ni select *; lote de hasta 500', () => {
    expect(SQL).not.toMatch(/\bexecute\s+(format|'|\$)/);
    expect(SQL).not.toContain('format(');
    expect(SQL).not.toMatch(/select \*/);
    expect(SQL).toContain('jsonb_array_length(p_filas) > 500');
    expect(SQL).toContain("'lote_invalido'");
  });
  it('S01-7 el stock no es una columna escrita por las RPC', () => {
    expect(SQL).not.toMatch(/insert into public\.productos[^;]*\bstock\b\s*,/);
    expect(SQL).not.toContain('movimientos_stock');
  });
});
