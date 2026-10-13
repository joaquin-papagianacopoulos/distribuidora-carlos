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
    // MOD (RUN 20261012-2106, C6): el conteo de "otros admins" ahora exige
    // también pin_hash (más estricto; ver T-18 abajo).
    expect(RPC).toMatch(/where permiso = 1 and activo and pin_hash is not null and id::text <> v_vend_id; if v_otros_admin = 0 then return jsonb_build_object\('ok', false, 'motivo', 'ultimo_admin'\)/);
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

// C6 (RUN 20261012-2106) — S-COM-20 / AC-VEN-2 / AC-VEN-4 en el servidor.
const SQL002 = readFileSync(path.resolve(__dirname, '..', '..', '..', 'supabase', 'migrations', '002_seguridad_recomendada.sql'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/--[^\n]*/g, ' ')
  .replace(/\s+/g, ' ')
  .toLowerCase();
const GUARDAR = (SQL.match(/create or replace function public\.admin_guardar_vendedor\([\s\S]*?end \$\$/) || [''])[0];
const firma = (sql) => (sql.match(/create or replace function public\.admin_guardar_vendedor\(([^)]*)\) returns text/) || [])[1]?.trim();

describe('AC-VEN-4 AC-VEN-2 S-COM-20 migración 004 (C6)', () => {
  it('AC-VEN-4 admin_baja_vendedor cuenta solo admins activos con pin_hash', () => {
    const conteo = RPC.match(/select count\(\*\) into v_otros_admin from public\.vendedores where ([^;]*);/);
    expect(conteo).not.toBeNull();
    expect(conteo[1]).toBe('permiso = 1 and activo and pin_hash is not null and id::text <> v_vend_id');
  });

  it('AC-VEN-2 AC-VEN-4 S-COM-20 la 004 redefine admin_guardar_vendedor con la firma y los defaults de la 002', () => {
    expect(GUARDAR).not.toBe('');
    // Misma firma y mismos defaults (si no, create or replace falla en Postgres).
    expect(firma(SQL)).toBe(firma(SQL002));
    expect(firma(SQL)).toBe('p_admin_id text, p_admin_pin text, p_vendedor_id text, p_nombre text, p_zona text, p_permiso int, p_pin_nuevo text default null, p_borrar_pin boolean default false');
    // security definer + search_path fijo
    expect(GUARDAR).toMatch(/returns text language plpgsql security definer set search_path = public, extensions, pg_temp as \$\$/);
    expect(SQL).toContain('revoke all on function public.admin_guardar_vendedor(text, text, text, text, text, int, text, boolean) from public');
    expect(SQL).toContain('grant execute on function public.admin_guardar_vendedor(text, text, text, text, text, int, text, boolean) to anon, authenticated');
  });

  it('AC-VEN-2 S-COM-20 autoriza primero: verificar_pin siempre, return null sin raise y exige admin activo con PIN', () => {
    const pin = GUARDAR.indexOf('coalesce(public.verificar_pin(p_admin_id, p_admin_pin), false)');
    const retNull = GUARDAR.indexOf('return null;');
    expect(pin).toBeGreaterThan(0);
    expect(retNull).toBeGreaterThan(pin);
    expect(GUARDAR.slice(0, retNull)).not.toMatch(/raise exception/);
    expect(GUARDAR.slice(pin, retNull)).toMatch(/where id::text = p_admin_id and permiso = 1 and activo and pin_hash is not null/);
  });

  it('AC-VEN-4 S-COM-20 lock vendedores_baja después de autorizar y los raise nuevos después del lock y antes del insert/update', () => {
    const retNull = GUARDAR.indexOf('return null;');
    const lock = GUARDAR.indexOf("perform pg_advisory_xact_lock(hashtext('vendedores_baja'))");
    expect(lock).toBeGreaterThan(retNull);
    const insert = GUARDAR.indexOf('insert into public.vendedores');
    const update = GUARDAR.indexOf('update public.vendedores set nombre');
    expect(insert).toBeGreaterThan(0);
    expect(update).toBeGreaterThan(0);
    for (const motivo of ['vendedor_inexistente', 'vendedor_inactivo', 'admin_sin_pin', 'ultimo_admin']) {
      const i = GUARDAR.indexOf(`raise exception '${motivo}'`);
      expect(i).toBeGreaterThan(lock);
      expect(i).toBeLessThan(Math.min(insert, update));
    }
    // Un solo lock, con la misma clave que la baja
    expect(GUARDAR.match(/pg_advisory_xact_lock/g)).toHaveLength(1);
    expect(RPC).toContain("pg_advisory_xact_lock(hashtext('vendedores_baja'))");
    // el último admin se cuenta como en la baja: activo y con pin_hash
    expect(GUARDAR).toMatch(/where permiso = 1 and activo and pin_hash is not null and id::text <> p_vendedor_id/);
    // destino inactivo: no se le vuelve a poner PIN (AC-VEN-2)
    expect(GUARDAR).toMatch(/if v_destino\.activo = false then raise exception 'vendedor_inactivo'/);
  });

  it('AC-VEN-2 S-COM-20 sin delete y todo dentro de begin/commit, después del chequeo del PASO 1', () => {
    expect(GUARDAR).not.toMatch(/\bdelete\b/);
    const chk = SQL.indexOf("if to_regprocedure('public.verificar_pin(text, text)') is null then raise exception");
    const alterActivo = SQL.indexOf('alter table public.vendedores add column if not exists activo');
    const def = SQL.indexOf('create or replace function public.admin_guardar_vendedor(');
    expect(chk).toBeGreaterThan(SQL.indexOf('begin;'));
    expect(def).toBeGreaterThan(chk);
    expect(def).toBeGreaterThan(alterActivo);
    expect(def).toBeLessThan(SQL.lastIndexOf('commit;'));
  });

  it('AC-VEN-5 la cabecera de la 004 y la 002 documentan la redefinición', () => {
    expect(SQL_RAW).toMatch(/Modificada en RUN 20261012-2106 antes de aplicarse/);
    expect(SQL_RAW).toMatch(/REDEFINE admin_guardar_vendedor de la 002/);
    const raw002 = readFileSync(path.resolve(__dirname, '..', '..', '..', 'supabase', 'migrations', '002_seguridad_recomendada.sql'), 'utf8');
    expect(raw002).toMatch(/La 004 la redefine \(S-COM-20 \+ activo\)/);
  });
});
