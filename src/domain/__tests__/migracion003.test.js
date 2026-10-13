// REQ-COM: la migración 003 (se aplica a mano en Supabase) cumple AC-COM-16 y
// AC-SEC-5: idempotente, RLS, sin borrado, restricción única contra doble cierre.
import { readFileSync } from 'fs';
import path from 'path';

const SQL_RAW = readFileSync(path.resolve(__dirname, '..', '..', '..', 'supabase', 'migrations', '003_comisiones.sql'), 'utf8');
const SQL = SQL_RAW
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/--[^\n]*/g, ' ')
  .replace(/\s+/g, ' ')
  .toLowerCase();

describe('AC-COM-16 AC-SEC-5 migración 003_comisiones.sql', () => {
  it('AC-COM-1 agrega las columnas de entregado a pedidos con if not exists', () => {
    for (const col of ['entregado boolean not null default false', 'entregado_at timestamptz', 'entregado_por text']) {
      expect(SQL).toContain(`alter table public.pedidos add column if not exists ${col}`);
    }
  });

  it('AC-COM-16 crea las tablas con if not exists y RLS habilitado en ambas', () => {
    for (const t of ['comisiones_cierres', 'comisiones_cierre_pedidos']) {
      expect(SQL).toContain(`create table if not exists public.${t}`);
      expect(SQL).toContain(`alter table public.${t} enable row level security`);
    }
  });

  it('AC-COM-16 índice único parcial: un pedido no puede estar en dos cierres vigentes', () => {
    expect(SQL).toMatch(/create unique index if not exists \w+ on public\.comisiones_cierre_pedidos \(pedido_id\) where vigente and tipo = 'pedido'/);
    expect(SQL).toMatch(/create unique index if not exists \w+ on public\.comisiones_cierre_pedidos \(pedido_id, ajuste_seq\) where vigente and tipo = 'ajuste'/);
  });

  it('AC-COM-16 AC-SEC-5 sin políticas de insert/update/delete/all: solo select', () => {
    const politicas = [...SQL.matchAll(/create policy (\w+) on public\.(comisiones_\w+) for (\w+)/g)].map(m => m[3]);
    expect(politicas.length).toBe(2);
    expect(politicas.every(c => c === 'select')).toBe(true);
    expect(SQL).not.toMatch(/grant [^;]*\b(insert|update|delete|all)\b[^;]* on (table )?public\.comisiones_/);
    expect(SQL).toContain('revoke insert, update, delete, truncate on public.comisiones_cierres from anon, authenticated');
    expect(SQL).toContain('revoke insert, update, delete, truncate on public.comisiones_cierre_pedidos from anon, authenticated');
  });

  it('AC-COM-11 trigger de inmutabilidad del cierre y de sus renglones', () => {
    expect(SQL).toContain('create trigger cierre_inmutable before update or delete on public.comisiones_cierres');
    expect(SQL).toContain('create trigger cierre_renglon_inmutable before update or delete on public.comisiones_cierre_pedidos');
    const fn = SQL.match(/create or replace function public\.tg_cierre_inmutable\(\)[\s\S]*?end \$\$/)[0];
    for (const c of ['detalle', 'lineas', 'totales', 'total_comision', 'desde', 'hasta', 'cerrado_por']) {
      expect(fn).toContain(`new.${c} is distinct from old.${c}`);
    }
    expect(fn).toMatch(/raise exception/);
  });

  it('AC-COM-10 AC-COM-12 AC-COM-16 RPC security definer con search_path fijo, idempotente y con manejo de unique_violation', () => {
    for (const f of ['cerrar_comisiones\\(p_cierre jsonb, p_renglones jsonb, p_admin_id text, p_admin_pin text\\)', 'anular_cierre_comisiones\\(p_id text, p_admin_id text, p_admin_pin text, p_motivo text\\)']) {
      expect(SQL).toMatch(new RegExp(`create or replace function public\\.${f} returns jsonb language plpgsql security definer set search_path = public`));
    }
    expect(SQL).toContain("'ya_existia', true");
    expect(SQL).toContain('exception when unique_violation');
    expect(SQL).toContain("'ya_cerrado'");
    expect(SQL).toMatch(/length\(v_motivo\) < 3 or length\(v_motivo\) > 300/);
    expect(SQL).toContain('update public.comisiones_cierre_pedidos set vigente = false where cierre_id = p_id');
    expect(SQL).toContain('revoke all on function public.cerrar_comisiones(jsonb, jsonb, text, text) from public');
    expect(SQL).toContain('revoke all on function public.anular_cierre_comisiones(text, text, text, text) from public');
  });

  it('AC-COM-16 no borra datos y corre en una transacción', () => {
    expect(SQL).not.toMatch(/\bdrop table\b/);
    expect(SQL).not.toMatch(/\bdelete from\b/);
    expect(SQL).not.toMatch(/\btruncate table\b/);
    expect(SQL.trim().startsWith('begin;')).toBe(true);
    expect(SQL.trim().endsWith('commit;')).toBe(true);
  });
});

describe('AC-COM-16 IndexedDB v5 (src/db/index.js)', () => {
  const DB = readFileSync(path.resolve(__dirname, '..', '..', 'db', 'index.js'), 'utf8');

  // Iteracion 3: DB_VERSION pasa a 6 (S-COM-13, quitar el PIN local); los stores de la v5 siguen igual.
  it('AC-COM-16 DB_VERSION >= 5 y los stores nuevos se crean con if (!contains), clave id sin autoIncrement', () => {
    expect(Number(DB.match(/const DB_VERSION = (\d+);/)[1])).toBeGreaterThanOrEqual(5);
    for (const s of ['comisionesCierres', 'comisionesBorradores']) {
      expect(DB).toContain(`if (!d.objectStoreNames.contains('${s}'))`);
      expect(DB).toMatch(new RegExp(`createObjectStore\\('${s}', \\{ keyPath: 'id' \\}\\)`));
    }
    expect(DB).not.toMatch(/deleteObjectStore/);
  });
});
