// REQ-VEN: la migración 004 (se aplica a mano en Supabase) hace baja LÓGICA de
// vendedores por RPC autorizada con el PIN del admin. Chequeo estático del SQL.
import { readFileSync } from 'fs';
import path from 'path';

const SQL_RAW = readFileSync(path.resolve(__dirname, '..', '..', '..', 'supabase', 'migrations', '004_baja_vendedores.sql'), 'utf8');
const SQL = SQL_RAW
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/--[^\n]*/g, ' ')
  .replace(/\s+/g, ' ')
  .toLowerCase();

const RPC = (SQL.match(/create or replace function public\.admin_baja_vendedor\([\s\S]*?end \$\$/) || [''])[0];

describe('AC-VEN-5 migración 004_baja_vendedores.sql', () => {
  it('AC-VEN-5 idempotente, en una transacción y sin borrar datos', () => {
    expect(SQL.trim().startsWith('begin;')).toBe(true);
    expect(SQL.trim().endsWith('commit;')).toBe(true);
    expect(SQL).not.toMatch(/\bdrop table\b/);
    expect(SQL).not.toMatch(/\bdelete from\b/);
    expect(SQL).not.toMatch(/\btruncate\b/);
    expect(SQL).not.toMatch(/\bdrop column\b/);
    expect(SQL).toContain('alter table public.vendedores add column if not exists activo boolean not null default true');
    expect(SQL).toContain('drop trigger if exists vendedor_activo_solo_rpc on public.vendedores');
  });

  it('AC-VEN-5 requiere la 002 PASO 1 con el mismo chequeo inicial que la 003', () => {
    const chk = "if to_regprocedure('public.verificar_pin(text, text)') is null then raise exception";
    expect(SQL).toContain(chk);
    // va antes que cualquier cambio
    expect(SQL.indexOf(chk)).toBeLessThan(SQL.indexOf('alter table public.vendedores'));
  });

  it('AC-VEN-1 RPC security definer con search_path fijo, revoke public y grant a anon/authenticated', () => {
    expect(SQL).toMatch(/create or replace function public\.admin_baja_vendedor\(p_admin_id text, p_admin_pin text, p_vendedor_id text\) returns jsonb language plpgsql security definer set search_path = public, pg_temp as \$\$/);
    expect(SQL).toContain('revoke all on function public.admin_baja_vendedor(text, text, text) from public');
    expect(SQL).toContain('grant execute on function public.admin_baja_vendedor(text, text, text) to anon, authenticated');
  });

  it('AC-VEN-1 autorización: verificar_pin SIEMPRE y una sola respuesta no_autorizado (S-COM-16)', () => {
    const pin = RPC.indexOf('v_pin_ok := coalesce(public.verificar_pin(v_admin_id, p_admin_pin), false)');
    expect(pin).toBeGreaterThan(0);
    // entre buscar al admin y verificar el PIN no hay salida temprana (sin oráculo de admins)
    const busca = RPC.indexOf('from public.vendedores where id::text = v_admin_id and permiso = 1');
    expect(busca).toBeGreaterThan(0);
    expect(busca).toBeLessThan(pin);
    expect(RPC.slice(busca, pin)).not.toMatch(/return/);
    expect(RPC).toContain("if not v_pin_ok or not v_es_admin then return jsonb_build_object('ok', false, 'motivo', 'no_autorizado')");
    // el admin tiene que estar activo y con PIN
    expect(RPC).toMatch(/permiso = 1 and activo and pin_hash is not null/);
    // return (no raise) para que el intento fallido cuente para el bloqueo
    expect(RPC.slice(0, pin)).not.toMatch(/raise exception/);
  });

  it('AC-VEN-4 rechaza la baja del propio admin y del último admin activo', () => {
    expect(RPC).toContain("if v_vend_id = v_admin_id then return jsonb_build_object('ok', false, 'motivo', 'propio_admin')");
    expect(RPC).toMatch(/where permiso = 1 and activo and id::text <> v_vend_id; if v_otros_admin = 0 then return jsonb_build_object\('ok', false, 'motivo', 'ultimo_admin'\)/);
    expect(RPC).toContain('pg_advisory_xact_lock');
  });

  it('AC-VEN-2 baja lógica: activo = false y borra el PIN; nunca delete', () => {
    expect(RPC).toContain('update public.vendedores set activo = false, pin = null, pin_hash = null, tiene_pin = false where id::text = v_vend_id');
    expect(RPC).not.toMatch(/\bdelete\b/);
  });

  it('AC-VEN-3 la anon key puede leer activo (PASO 2 de la 002) pero no cambiarlo sin la RPC', () => {
    expect(SQL).toContain('grant select (activo) on public.vendedores to anon, authenticated');
    expect(SQL).not.toMatch(/grant select \([^)]*pin/);
    const tg = SQL.match(/create or replace function public\.tg_vendedor_activo_solo_rpc\(\)[\s\S]*?end \$\$/)[0];
    expect(tg).toContain("current_user in ('anon', 'authenticated')");
    expect(tg).toContain('new.activo is distinct from old.activo then raise exception');
    expect(tg).not.toContain('security definer');
    expect(SQL).toContain('create trigger vendedor_activo_solo_rpc before insert or update on public.vendedores');
  });
});
