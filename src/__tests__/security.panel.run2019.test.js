// REQ-PAN (AC-PAN-1, seguridad): chequeos estaticos sobre la migracion 015 y el cliente.
import { readFileSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');
const leer = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');
const sql = leer('supabase', 'migrations', '015_lote_operacion_panel.sql');
const sc = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');

describe('AC-PAN-1 migracion 015', () => {
  test('tablas privadas: RLS on, sin policies y sin grants a anon/authenticated', () => {
    ['pedidos_costos', 'pedidos_costos_errores'].forEach(t => {
      expect(sc).toMatch(new RegExp(`alter table public\.${t} enable row level security`));
      expect(sc).toMatch(new RegExp(`revoke all on public\.${t} from public, anon, authenticated`));
    });
    expect(sc).not.toMatch(/create policy/i);
    expect(sc).not.toMatch(/grant (select|insert|update|delete|all)[^;]* on (table )?public\.pedidos_costos/i);
  });
  test('el trigger es security definer con search_path fijo y NUNCA traga el error en silencio', () => {
    expect(sc).toMatch(/function public\.tg_pedidos_costos_snapshot\(\) returns trigger\s+language plpgsql security definer set search_path = public, pg_temp/);
    expect(sc).toMatch(/exception when others then\s+raise warning/);
    expect(sc).toMatch(/insert into public\.pedidos_costos_errores/);
    expect(sc).not.toMatch(/security definer(?! set search_path)/);
  });
  test('el primer costo capturado gana y el trigger es AFTER (no bloquea el guardado)', () => {
    expect(sc).toMatch(/excluded\.costos \|\| c\.costos/);
    expect(sc).toMatch(/create trigger pedidos_costos_snapshot after insert or update of estado, items on public\.pedidos/);
  });
  test('la RPC valida el PIN de admin y es lo unico con grant; helpers sin execute', () => {
    expect(sc).toMatch(/_es_admin_con_pin\(p_admin_id, p_admin_pin\)/);
    expect(sc).toMatch(/grant execute on function public\.admin_costos_venta_bajar\(text, text, jsonb\) to anon, authenticated/);
    expect(sc).toMatch(/revoke all on function public\._costo_neto_producto\(numeric, numeric, numeric\) from public, anon, authenticated/);
    expect(sc).toMatch(/revoke all on function public\.tg_pedidos_costos_snapshot\(\) from public, anon, authenticated/);
    expect((sc.match(/grant execute/g) || []).length).toBe(1);
  });
  test('es idempotente y no destructiva', () => {
    // SEC-PAN-03: unico delete permitido = retencion de 90 dias de la tabla tecnica de errores.
    expect(sc.replace("delete from public.pedidos_costos_errores where created_at < now() - interval '90 days';", '')).not.toMatch(/drop table|drop column|truncate|delete from/i);
    expect(sc).toMatch(/create table if not exists public\.pedidos_costos /);
    expect(sc).toMatch(/drop trigger if exists pedidos_costos_snapshot/);
  });
});

describe('AC-PAN-1 cliente: el costo nunca viaja en pedidos.items', () => {
  test('pedidoRepository y syncService limpian los items antes de subir', () => {
    expect(leer('src', 'services', 'pedidoRepository.js')).toMatch(/items: itemsSinCostos\(p\.items\)/);
    expect(leer('src', 'sync', 'syncService.js')).toMatch(/items:\s+itemsSinCostos\(p\.items\)/);
  });
});
