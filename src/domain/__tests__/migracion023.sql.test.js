// Test estático de supabase/migrations/023_no_perder_datos.sql (REQ-SEG2: AC-SEG2-1, AC-SEG2-3, AC-SEG2-5, AC-SEG2-6).
import fs from 'fs';
import path from 'path';

const RAIZ = path.resolve(__dirname, '..', '..', '..');
const SQL = fs.readFileSync(path.join(RAIZ, 'supabase', 'migrations', '023_no_perder_datos.sql'), 'utf8');
// Sin comentarios de línea, para no confundir texto explicativo con sentencias.
const CODIGO = SQL.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');

describe('AC-SEG2-1 migración 023: sin DELETE/TRUNCATE para anon', () => {
  test('AC-SEG2-1 revoca delete y truncate sobre las 5 tablas y borra las policies de DELETE', () => {
    for (const t of ['clientes', 'deudas', 'faltantes', 'proveedores', 'pedidos']) expect(CODIGO).toContain(`'${t}'`);
    expect(CODIGO).toMatch(/revoke delete, truncate on public\.%I from anon, authenticated/);
    expect(CODIGO).toMatch(/cmd = 'DELETE'/);
    expect(CODIGO).toMatch(/drop policy if exists %I on public\.%I/);
    expect(CODIGO).toMatch(/to_regclass\('public\.' \|\| t\)/);
  });
  test('AC-SEG2-1 no concede delete a anon ni borra datos fuera de los RPC', () => {
    expect(CODIGO).not.toMatch(/grant\s+[^;]*delete/i);
    expect(CODIGO).not.toMatch(/drop\s+table/i);
    expect(CODIGO).not.toMatch(/^\s*truncate\s/im);
    // Los únicos delete son los de los RPC (clientes y faltantes por id).
    const deletes = CODIGO.match(/^\s*delete\s+from\s+public\.\w+/gim) || [];
    expect(deletes.map(d => d.trim().replace(/\s+/g, ' ')).sort()).toEqual(['delete from public.clientes', 'delete from public.faltantes']);
  });
  test('AC-SEG2-1 tablas de archivo con RLS y sin acceso para anon', () => {
    for (const t of ['clientes_borrados', 'faltantes_borrados']) {
      expect(CODIGO).toMatch(new RegExp(`create table if not exists public\\.${t}`));
      expect(CODIGO).toMatch(new RegExp(`alter table public\\.${t}\\s+enable row level security`));
      expect(CODIGO).toMatch(new RegExp(`revoke all on public\\.${t}\\s+from anon, authenticated`));
    }
  });
  test('AC-SEG2-1 admin_borrar_cliente: definer, search_path, PIN de admin, revoke/grant', () => {
    const f = CODIGO.slice(CODIGO.indexOf('function public.admin_borrar_cliente'), CODIGO.indexOf('function public.borrar_faltantes'));
    expect(f).toMatch(/security definer set search_path = public, pg_temp/);
    expect(f).toMatch(/permiso = 1 and activo/);
    expect(f).toMatch(/public\.verificar_pin\(v_admin_id, p_admin_pin\)/);
    expect(f).toMatch(/insert into public\.clientes_borrados/);
    expect(f).toMatch(/foreign_key_violation/);
    expect(f).toMatch(/tiene_referencias/);
    expect(f).toMatch(/ya_borrado/);
    expect(CODIGO).toMatch(/revoke all on function public\.admin_borrar_cliente\(text, text, text\) from public/);
    expect(CODIGO).toMatch(/grant execute on function public\.admin_borrar_cliente\(text, text, text\) to anon, authenticated/);
  });
  test('AC-SEG2-1 borrar_faltantes: definer, tope 200 y archivo previo', () => {
    const f = CODIGO.slice(CODIGO.indexOf('function public.borrar_faltantes'), CODIGO.indexOf('4. Pedidos') > 0 ? undefined : undefined);
    expect(f).toMatch(/security definer set search_path = public, pg_temp/);
    expect(f).toMatch(/cardinality\(p_ids\) > 200/);
    expect(f).toMatch(/insert into public\.faltantes_borrados/);
    expect(CODIGO).toMatch(/grant execute on function public\.borrar_faltantes\(text\[\]\) to anon, authenticated/);
  });
});

describe('AC-SEG2-3 migración 023: pedidos idempotentes', () => {
  test('AC-SEG2-3 agrega client_uuid con índice único no parcial', () => {
    expect(CODIGO).toMatch(/add column if not exists client_uuid uuid/);
    expect(CODIGO).toMatch(/create unique index if not exists pedidos_client_uuid_uk on public\.pedidos \(client_uuid\);/);
  });
});

describe('AC-SEG2-5 migración 023: ledger', () => {
  test('AC-SEG2-5 check de cantidad not valid y trigger SECURITY INVOKER con errcode 23514', () => {
    expect(CODIGO).toMatch(/movimientos_cantidad_chk check \(cantidad <> 0 and abs\(cantidad\) <= 1000000\) not valid/);
    const f = CODIGO.slice(CODIGO.indexOf('function public.tg_movimiento_tipo_admin'), CODIGO.indexOf('movimiento_tipo_admin on public.movimientos_stock'));
    expect(f).not.toMatch(/security definer/i);
    expect(f).toMatch(/current_user not in \('anon', 'authenticated'\)/);
    expect(f).toMatch(/errcode = '23514'/);
    expect(CODIGO).toMatch(/drop trigger if exists movimiento_tipo_admin/);
    expect(CODIGO).toMatch(/before insert or update on public\.movimientos_stock/);
  });
  test('AC-SEG2-5 admin_registrar_ajustes_stock: PIN, tope, tipos y ref', () => {
    const f = CODIGO.slice(CODIGO.indexOf('function public.admin_registrar_ajustes_stock'));
    expect(f).toMatch(/security definer set search_path = public, pg_temp/);
    expect(f).toMatch(/public\.verificar_pin\(v_admin_id, p_admin_pin\)/);
    expect(f).toMatch(/jsonb_array_length\(p_movs\) > 500/);
    expect(f).toMatch(/not in \('inicial', 'ajuste'\)/);
    expect(f).toMatch(/\^ajuste:/);
    expect(f).toMatch(/on conflict \(id\) do nothing/);
    expect(CODIGO).toMatch(/grant execute on function public\.admin_registrar_ajustes_stock\(text, text, jsonb\) to anon, authenticated/);
  });
});

describe('AC-SEG2-6 .gitignore', () => {
  test('AC-SEG2-6 backups/ y los .sql sueltos de limpieza están ignorados', () => {
    const gi = fs.readFileSync(path.join(RAIZ, '.gitignore'), 'utf8').split(/\r?\n/).map(l => l.trim());
    expect(gi).toContain('backups/');
    expect(gi).toContain('supabase/limpieza_datos.sql');
    expect(gi).toContain('supabase/truncate_todas.sql');
  });
});

describe('AC-SEG2-1 migración 023: borrar_faltantes con tope por ventana', () => {
  test('AC-SEG2-1 limita el total borrado en 10 minutos contando faltantes_borrados', () => {
    expect(CODIGO).toMatch(/interval '10 minutes'/);
    expect(CODIGO).toMatch(/limite_ventana/);
  });
});
