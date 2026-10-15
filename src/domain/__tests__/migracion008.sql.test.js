// Chequeos estáticos de supabase/migrations/008_tienda.sql (REQ-TIE / REQ-WEB).
// No ejecutan SQL: verifican que las garantías de seguridad estén escritas.
import fs from 'fs';
import path from 'path';

const sql = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'supabase', 'migrations', '008_tienda.sql'), 'utf8');
const sinComentarios = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');

const cuerpo = (nombre) => {
  const i = sinComentarios.indexOf(`function public.${nombre}`);
  if (i < 0) return '';
  const j = sinComentarios.indexOf('end $$;', i);
  return sinComentarios.slice(i, j);
};

describe('migración 008 tienda (AC-TIE-3, AC-TIE-13, AC-TIE-15, AC-WEB-4..7)', () => {
  it('AC-TIE-13 agrega las columnas web de pedidos de forma idempotente', () => {
    for (const col of ['origen', 'web_estado', 'web_revisado_por', 'web_revisado_at', 'web_motivo_rechazo', 'idempotencia', 'web_accion_id']) {
      expect(sql).toMatch(new RegExp(`add column if not exists ${col}\\s`));
    }
    expect(sql).toMatch(/create unique index if not exists pedidos_idempotencia_uq/);
    expect(sql).not.toMatch(/drop (table|column)/i);
    // MOD vuelta 2 (S-WEB-01): el contacto ya no vive en pedidos.
    expect(sinComentarios).not.toMatch(/add column if not exists web_contacto/);
  });

  it('AC-WEB-3 S-WEB-01 el contacto vive en pedidos_web_contacto (sin grants) y se lee solo con la RPC admin', () => {
    expect(sql).toMatch(/alter table public\.pedidos_web_contacto\s+enable row level security/);
    expect(sql).toMatch(/revoke all on public\.pedidos_web_contacto\s+from anon, authenticated/);
    expect(sinComentarios).not.toMatch(/grant [a-z, ]+ on public\.pedidos_web_contacto/);
    expect(cuerpo('tienda_crear_pedido')).toMatch(/insert into public\.pedidos_web_contacto/);
    const l = cuerpo('admin_listar_pedidos_web');
    expect(l).toMatch(/security definer set search_path = public, extensions, pg_temp/);
    expect(l.indexOf('tienda_admin_ok')).toBeGreaterThan(0);
    expect(l.indexOf('pedidos_web_contacto')).toBeGreaterThan(l.indexOf('tienda_admin_ok'));
    expect(sql).toMatch(/grant execute on function public\.admin_listar_pedidos_web\(text, text, text\[\]\)\s+to anon/);
  });

  it('AC-TIE-3 tienda_catalogo no expone costo, ganancia ni stock exacto', () => {
    const c = cuerpo('tienda_catalogo');
    expect(c).toMatch(/visible_tienda/);
    expect(c).toMatch(/set statement_timeout = '3s'/); // S-TIE-05
    expect(c).toMatch(/precio > 0/);
    for (const prohibido of ['costo', 'ganancia', 'descuento', 'precio_venta2', 'proveedor']) expect(c).not.toMatch(new RegExp(prohibido));
    expect(c).toMatch(/'disponible'/);
    expect(c).not.toMatch(/'stock'/);
  });

  it('AC-TIE-3 las RPC son security definer con search_path fijo y solo catálogo/crear van a anon', () => {
    for (const f of ['tienda_catalogo', 'tienda_crear_pedido', 'admin_resolver_pedido_web', 'admin_token_tienda', 'admin_listar_tokens_tienda', 'admin_listar_pedidos_web']) {
      expect(cuerpo(f)).toMatch(/security definer set search_path = public, extensions, pg_temp/);
    }
    expect(sql).toMatch(/grant execute on function public\.tienda_catalogo\(\)\s+to anon/);
    expect(sql).toMatch(/grant execute on function public\.tienda_crear_pedido\(jsonb\)\s+to anon/);
    expect(sql).toMatch(/revoke all on function public\.tienda_admin_ok\(text, text\)\s+from public, anon, authenticated/);
  });

  it('AC-TIE-3 las tablas nuevas tienen RLS y ningún grant para anon', () => {
    for (const t of ['tienda_config', 'tienda_secretos', 'vendedores_tienda_tokens', 'tienda_intentos']) {
      expect(sql).toMatch(new RegExp(`alter table public\\.${t}\\s+enable row level security`));
      expect(sql).toMatch(new RegExp(`revoke all on public\\.${t}\\s+from anon, authenticated`));
      expect(sinComentarios).not.toMatch(new RegExp(`grant [a-z, ]+ on public\\.${t}`));
    }
  });

  it('AC-TIE-13 recalcula en el servidor, compara con lo visto, es idempotente y usa fecha de Argentina', () => {
    const c = cuerpo('tienda_crear_pedido');
    expect(c).toMatch(/idempotencia = v_idem/);
    expect(c).toMatch(/unique_violation/);
    expect(c).toMatch(/precioVisto/);
    expect(c).toMatch(/'motivo', 'cambio'/);
    expect(c).toMatch(/America\/Argentina\/Buenos_Aires/);
    expect(c).toMatch(/'web', 'por_revisar'/);
    expect(c).toMatch(/'pendiente'/);
    expect(c).toMatch(/tienda_precio_vigente/);
    // el precio del insert sale de productos, nunca del navegador
    expect(c).not.toMatch(/v_e->>'precio'\b/);
  });

  it('AC-TIE-13 comparte los casos del dominio: Dos Corazones multiplica por bulto_x y exige múltiplos', () => {
    const c = cuerpo('tienda_crear_pedido');
    expect(c).toMatch(/v_cant \* v_prod\.bulto_x/);
    expect(c).toMatch(/v_u % v_bx <> 0/);
    expect(c).toMatch(/v_total_c := v_total_c \+ v_cent \* v_u/);
  });

  it('AC-TIE-15 antiabuso: honeypot, topes, límite por hora y hash con sal', () => {
    const c = cuerpo('tienda_crear_pedido');
    expect(c.indexOf("'hp'")).toBeGreaterThan(c.indexOf('idempotencia = v_idem'));
    expect(c).toMatch(/max_renglones/);
    expect(c).toMatch(/limite_por_hora/);
    expect(c).toMatch(/interval '1 hour'/);
    expect(c).toMatch(/digest\(v_ip \|\| coalesce\(v_sal/);
    expect(c).not.toMatch(/insert into public\.tienda_intentos \(origen_hash\) values \(v_ip/);
    // S-TIE-01/02/03: IP no falsificable, tope global, lock y producto normalizado.
    expect(c).toMatch(/cf-connecting-ip/);
    expect(c).toMatch(/regexp_replace\(coalesce\(v_headers->>'x-forwarded-for'/);
    expect(c).toMatch(/limite_global_por_hora/);
    expect(c).toMatch(/pg_advisory_xact_lock/);
    expect(c.indexOf('pg_advisory_xact_lock')).toBeLessThan(c.indexOf('count(*)'));
    expect(c).toMatch(/v_pid := \(v_pid::bigint\)::text/);
    expect(sql).toMatch(/limite_por_hora\s+integer not null default 5/);
    expect(sql).toMatch(/max_renglones\s+integer not null default 150/);
  });

  it('AC-WEB-6 resolver: PIN, for update, transición solo desde por_revisar y web_accion_id', () => {
    const c = cuerpo('admin_resolver_pedido_web');
    expect(c).toMatch(/tienda_admin_ok/);
    expect(c).toMatch(/for update/);
    expect(c).toMatch(/'ya_resuelto'/);
    expect(c).toMatch(/web_accion_id = p_accion_id/);
    expect(c).toMatch(/'repetido', true/);
    expect(c).toMatch(/char_length\(v_motivo\) < 3/);
  });

  it('AC-WEB-1 trigger: anon/authenticated no crean ni pisan pedidos web', () => {
    const c = cuerpo('tg_pedidos_web_guard');
    expect(c).toMatch(/current_user in \('anon', 'authenticated'\)/);
    expect(c).toMatch(/new\.origen := 'interna'/);
    expect(c).toMatch(/return old/);
    expect(c).toMatch(/new\.web_estado := old\.web_estado/);
  });

  it('AC-WEB-7 tokens: 256 bits con gen_random_bytes, regenerar revoca el anterior', () => {
    const c = cuerpo('admin_token_tienda');
    expect(c).toMatch(/gen_random_bytes\(32\)/);
    expect(c).toMatch(/revocado_at = now\(\)/);
    expect(c).toMatch(/tienda_admin_ok/);
    expect(cuerpo('admin_listar_tokens_tienda')).toMatch(/revocado_at is null/);
    expect(cuerpo('tienda_crear_pedido')).toMatch(/revocado_at is null and ve\.activo/);
  });

  it('AC-TIE-3 la oferta tolera que tienda_ofertas no exista (REQ-POR)', () => {
    expect(cuerpo('tienda_precio_vigente')).toMatch(/to_regclass\('public\.tienda_ofertas'\) is null/);
  });
});
