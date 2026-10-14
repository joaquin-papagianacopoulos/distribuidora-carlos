// REQ-COMR (RUN 20261014-1449): chequeo estático de la migración 005 (se
// aplica a mano en Supabase). AC-COMR-7/8/9/13/14 + AC-SEC-5.
import { readFileSync } from 'fs';
import path from 'path';
import { ACENTOS_DESDE, ACENTOS_HASTA } from '../rubros';

const RAW = readFileSync(path.resolve(__dirname, '..', '..', '..', 'supabase', 'migrations', '005_comisiones_rubro.sql'), 'utf8');
const SQL = RAW
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/--[^\n]*/g, ' ')
  .replace(/\s+/g, ' ')
  .toLowerCase();
const fn = (nombre) => (SQL.match(new RegExp(`create or replace function public\\.${nombre}\\([\\s\\S]*?end \\$\\$`)) || [''])[0];
const GUARDAR = fn('admin_guardar_comisiones_rubro');
const LEER = fn('admin_leer_comisiones_rubro');
const CERRAR = fn('cerrar_comisiones');

describe('AC-COMR-7 migración 005_comisiones_rubro.sql', () => {
  it('AC-COMR-7 idempotente, en una transacción, sin borrar datos', () => {
    expect(SQL.trim().startsWith('begin;')).toBe(true);
    expect(SQL.trim().endsWith('commit;')).toBe(true);
    expect(SQL).not.toMatch(/\bdrop table\b/);
    expect(SQL).not.toMatch(/\bdelete from\b/);
    expect(SQL).not.toMatch(/\btruncate\b/);
    expect(SQL).not.toMatch(/\bdrop column\b/);
    expect(SQL).not.toMatch(/\bdrop function\b/);
    expect(SQL).toContain('create table if not exists public.comisiones_rubro');
    expect(SQL).toContain('add column if not exists modelo text not null default \'cliente\'');
    expect(SQL).toContain('add column if not exists desglose jsonb');
  });

  it('AC-COMR-7 prerrequisitos (002 PASO 1, 003, 004) abortan ANTES de tocar nada', () => {
    const pre = SQL.indexOf("to_regprocedure('public.verificar_pin(text, text)') is null then raise exception");
    expect(pre).toBeGreaterThan(0);
    expect(SQL).toContain("to_regprocedure('public.vendedor_habilitado(text)') is null");
    expect(SQL).toContain("to_regclass('public.comisiones_cierre_pedidos') is null");
    expect(SQL).toMatch(/column_name = 'activo'\) then raise exception/);
    const primerCambio = Math.min(...['create or replace function', 'create table', 'alter table'].map(s => SQL.indexOf(s)));
    expect(pre).toBeLessThan(primerCambio);
  });

  it('AC-COMR-4 AC-COMR-7 rubro_clave usa EXACTAMENTE las mismas cadenas de acentos que src/domain/rubros.js', () => {
    expect(RAW).toContain(`'${ACENTOS_DESDE}'`);
    expect(RAW).toContain(`'${ACENTOS_HASTA}'`);
    expect(SQL).toMatch(/create or replace function public\.rubro_clave\(p text\) returns text language sql immutable set search_path = public, pg_temp/);
    expect(SQL).toMatch(/nullif\(lower\(translate\(public\.rubro_normalizado\(p\)/);
    expect(SQL).not.toContain('unaccent');
  });

  it('AC-COMR-7 tabla única por (vendedor_id, rubro_clave), % 0..100 con 2 decimales, sin borrado', () => {
    expect(SQL).toContain('constraint comisiones_rubro_vendedor_rubro_uq unique (vendedor_id, rubro_clave)');
    expect(SQL).toContain('pct numeric(5,2) check (pct is null or (pct >= 0 and pct <= 100))');
    expect(SQL).toMatch(/create trigger comisiones_rubro_sin_borrado before delete on public\.comisiones_rubro/);
  });

  it('AC-COMR-7 AC-SEC-5 RLS solo admin: enable RLS, revoke all a public/anon/authenticated, SIN políticas ni grants de tabla', () => {
    expect(SQL).toContain('alter table public.comisiones_rubro enable row level security');
    expect(SQL).toContain('revoke all on table public.comisiones_rubro from public, anon, authenticated');
    expect(SQL).not.toMatch(/create policy/);
    expect(SQL).not.toMatch(/grant [^;]* on (table )?public\.comisiones_rubro/);
  });

  it.each([
    ['admin_leer_comisiones_rubro', 'p_admin_id text, p_admin_pin text', 'text, text'],
    ['admin_guardar_comisiones_rubro', 'p_admin_id text, p_admin_pin text, p_filas jsonb', 'text, text, jsonb'],
  ])('AC-COMR-7 %s: security definer, search_path fijo, PIN siempre, no_autorizado sin raise, revoke public + grant de la firma exacta', (nombre, args, firma) => {
    const f = fn(nombre);
    expect(f).toContain(`create or replace function public.${nombre}(${args}) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$`);
    const busca = f.indexOf('from public.vendedores ve where ve.id::text = v_admin_id and ve.permiso = 1 and public.vendedor_habilitado(ve.id::text)');
    const pin = f.indexOf('v_pin_ok := coalesce(public.verificar_pin(v_admin_id, p_admin_pin), false)');
    expect(busca).toBeGreaterThan(0);
    expect(pin).toBeGreaterThan(busca);
    expect(f.slice(busca, pin)).not.toMatch(/return/);
    expect(f.slice(0, pin)).not.toMatch(/raise exception/);
    expect(f).toContain("if not v_pin_ok or v_por is null or length(v_por) = 0 then return jsonb_build_object('ok', false, 'motivo', 'no_autorizado')");
    expect(SQL).toContain(`revoke all on function public.${nombre}(${firma}) from public`);
    expect(SQL).toContain(`grant execute on function public.${nombre}(${firma}) to anon, authenticated`);
  });

  it('AC-COMR-7 guardar: lock global DESPUÉS de autorizar, lote acotado, clave calculada por el servidor, last-write-wins', () => {
    const lock = GUARDAR.indexOf("perform pg_advisory_xact_lock(hashtext('comisiones_global'))");
    expect(lock).toBeGreaterThan(GUARDAR.indexOf('verificar_pin'));
    expect(GUARDAR).toContain('jsonb_array_length(p_filas) > 1000');
    expect(GUARDAR).toContain('v_clave := public.rubro_clave(v_rubro)');
    expect(GUARDAR).toContain('on conflict (vendedor_id, rubro_clave) do update');
    expect(GUARDAR).toContain('where excluded.editado_at >= public.comisiones_rubro.editado_at');
    expect(GUARDAR).toContain('v_at := least(coalesce(v_at, now()), now())');
    // editado_por lo fija el servidor (admin autenticado)
    expect(GUARDAR).toContain('values (v_id, v_vend, v_rubro, v_clave, v_pct, v_at, v_por, v_admin_id)');
    expect(LEER).not.toContain('pg_advisory_xact_lock');
  });

  it('AC-COMR-8 guardar: vendedor por vendedores.id::text; rechaza inexistente, inactivo e id en uso', () => {
    expect(GUARDAR).toContain("'motivo', 'vendedor_inexistente'");
    expect(GUARDAR).toContain("if not public.vendedor_habilitado(v_vend) then");
    expect(GUARDAR).toContain("'motivo', 'vendedor_inactivo'");
    expect(GUARDAR).toContain("'motivo', 'id_en_uso'");
    expect(GUARDAR).toContain("'id_enviado', v_id");
  });

  it('AC-COMR-9 helpers sin execute para anon y con el mismo criterio de redondeo que el dominio', () => {
    for (const f of ['rubro_normalizado(text)', 'rubro_clave(text)', 'comision_rubro_base(text)', 'comision_rubro_partes(text, jsonb, jsonb)']) {
      expect(SQL).toContain(`revoke all on function public.${f} from public, anon, authenticated`);
      expect(SQL).not.toContain(`grant execute on function public.${f}`);
    }
    const base = fn('comision_rubro_base');
    expect(base).toContain("round(round((item->>'precio')::numeric, 2) * (item->>'cantidad')::numeric, 2)");
    expect(base).toContain("coalesce(item->>'eliminado', '') <> 'true'");
    // MOD (RUN 20261014-1449 it.2, S-COMR-05): largo acotado en las regex de precio y cantidad.
    expect(base).toContain("'^[0-9]{1,9}(\\.[0-9]{1,6})?$'");
    expect(base).toContain("'^-?[0-9]{1,12}(\\.[0-9]{1,20})?$'");
    expect(base).toContain("pr.id::text = item->>'productoid'");
    const partes = fn('comision_rubro_partes');
    expect(partes).toContain('round(sum(d.subtotal * coalesce(d.pct, 0)) * pt.division / 10000, 2)');
  });

  it('AC-COMR-13 cerrar_comisiones: MISMA firma, orden autorización -> lock -> idempotencia, modelo_obsoleto y desglose del servidor', () => {
    expect(CERRAR).toContain('create or replace function public.cerrar_comisiones(p_cierre jsonb, p_renglones jsonb, p_admin_id text, p_admin_pin text) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$');
    const pin = CERRAR.indexOf('v_pin_ok := coalesce(public.verificar_pin(v_admin_id, p_admin_pin), false)');
    const lock = CERRAR.indexOf("perform pg_advisory_xact_lock(hashtext('comisiones_global'))");
    const idem = CERRAR.indexOf("return jsonb_build_object('ok', true, 'ya_existia', true)");
    const obsoleto = CERRAR.indexOf("'motivo', 'modelo_obsoleto'");
    expect(pin).toBeGreaterThan(0);
    expect(lock).toBeGreaterThan(pin);
    expect(idem).toBeGreaterThan(lock);
    expect(obsoleto).toBeGreaterThan(idem);
    expect(CERRAR).toContain("r->>'tipo' = 'pedido' and coalesce(r->>'modelo', 'cliente') = 'cliente'");
    expect(CERRAR).toContain('v_calc := public.comision_rubro_partes(v_pid, r->\'partes\', null)');
    expect(CERRAR).toContain("'motivo', 'montos_inconsistentes'");
    // el desglose y el modelo los arma el servidor
    expect(CERRAR).toContain('insert into public.comisiones_cierre_pedidos (cierre_id, pedido_id, tipo, ajuste_seq, total, comision, pct, sin_comision, vigente, modelo, desglose)');
    expect(CERRAR).toContain("then v_desgloses -> (r->>'pedido_id')");
    expect(CERRAR).toContain('total_vendido, total_comision, totales, detalle, lineas, modelo)');
    expect(SQL).toContain('revoke all on function public.cerrar_comisiones(jsonb, jsonb, text, text) from public');
    expect(SQL).toContain('grant execute on function public.cerrar_comisiones(jsonb, jsonb, text, text) to anon, authenticated');
  });

  it('AC-COMR-14 ajustes: base cliente con la fórmula de la 003; base rubro con % congelado y verificación por vendedor', () => {
    expect(CERRAR).toContain("(coalesce(a.base_modelo, 'cliente') = 'cliente' and a.com_env <> round(a.tot_actual * a.pct_base / 100, 2) - a.com_cerrada)");
    expect(CERRAR).toContain('v_calc := public.comision_rubro_partes(v_pid, v_partes_base, v_cong)');
    expect(CERRAR).toContain("v_dif := (v_parte->>'monto')::numeric - v_cerrado_v");
    expect(CERRAR).toContain("'motivo', 'ajuste_invalido'");
  });

  it('AC-COMR-13 triggers de inmutabilidad incluyen modelo y desglose', () => {
    const t1 = fn('tg_cierre_inmutable');
    const t2 = fn('tg_cierre_renglon_inmutable');
    expect(t1).toContain('new.modelo is distinct from old.modelo');
    expect(t2).toContain('new.modelo is distinct from old.modelo');
    expect(t2).toContain('new.desglose is distinct from old.desglose');
    expect(t2).toContain('(new.vigente and not old.vigente)');
  });

  it('AC-COMR-7 la 003 avisa en la cabecera que la 005 la redefine (solo comentario)', () => {
    const sql003 = readFileSync(path.resolve(__dirname, '..', '..', '..', 'supabase', 'migrations', '003_comisiones.sql'), 'utf8');
    expect(sql003).toMatch(/--.*005_comisiones_rubro\.sql REDEFINE/);
  });
});

describe('AC-COMR-7 AC-COMR-13 iteración 2 (S-COMR-01/03/04/05)', () => {
  it('S-COMR-04 AC-COMR-4 rubro_normalizado normaliza Unicode a NFC como normalizarRubro', () => {
    expect(fn('rubro_normalizado')).toContain('normalize(coalesce(p, \'\'), nfc)');
  });

  it('S-COMR-01 AC-COMR-7 se revoca el select de comisiones_cierre_pedidos a anon/authenticated (la PWA no la lee)', () => {
    expect(SQL).toContain('revoke select on public.comisiones_cierre_pedidos from anon, authenticated');
    const { readdirSync } = require('fs');
    const fuentes = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory()
      ? (e.name === '__tests__' ? [] : fuentes(path.join(dir, e.name)))
      : [path.join(dir, e.name)]));
    const src = path.resolve(__dirname, '..', '..');
    for (const f of fuentes(src).filter(x => x.endsWith('.js'))) {
      expect({ f, usa: /comisiones_cierre_pedidos/.test(readFileSync(f, 'utf8')) }).toEqual({ f, usa: false });
    }
  });

  it('S-COMR-05 montos desbordados: error claro con los pedidos (monto_desbordado) antes de grabar', () => {
    expect(CERRAR).toContain("'motivo', 'monto_desbordado'");
    expect(CERRAR).toContain('abs((r->>\'total\')::numeric) >= 10000000000000');
    expect(CERRAR).toContain('v_desbordados := array_append(v_desbordados, v_pid)');
    expect(CERRAR.indexOf("'motivo', 'monto_desbordado'")).toBeLessThan(CERRAR.indexOf('insert into public.comisiones_cierres'));
  });

  it('S-COMR-03 AC-COMR-13 el modelo lo decide el servidor y el desglose de lineas se compara con el calculado', () => {
    expect(CERRAR).toContain("v_modelo := case when exists (select 1 from jsonb_array_elements(p_renglones) r where r->>'tipo' = 'pedido' or r->>'modelo' = 'rubro') then 'rubro' else 'cliente' end");
    expect(CERRAR).not.toContain("v_modelo := coalesce(p_cierre->>'modelo'");
    expect(CERRAR).toContain("'motivo', 'desglose_inconsistente'");
    const cmp = CERRAR.indexOf("'motivo', 'desglose_inconsistente'");
    expect(cmp).toBeGreaterThan(CERRAR.indexOf("'motivo', 'montos_inconsistentes'"));
    expect(cmp).toBeLessThan(CERRAR.indexOf('insert into public.comisiones_cierres'));
  });
});
