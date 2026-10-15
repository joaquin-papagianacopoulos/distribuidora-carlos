// Auditoria de seguridad RUN 20261014-2100 — REQ-TIE + REQ-WEB.
// Chequeos estaticos de 008_tienda.sql y del aislamiento del bundle de la tienda.
// Los tests "HALLAZGO" fijan el comportamiento actual para que un arreglo los haga
// fallar a proposito y obligue a actualizar el reporte.
import { readFileSync, readdirSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const limpio = (s) => s.replace(/--[^\n]*/g, ' ').replace(/\s+/g, ' ').toLowerCase();
const SQL = limpio(readFileSync(path.join(ROOT, 'supabase', 'migrations', '008_tienda.sql'), 'utf8'));
const fn = (nombre) => (SQL.match(new RegExp(`create or replace function public\\.${nombre}\\([\\s\\S]*?end \\$\\$`)) || [''])[0];
const definer = ['tienda_catalogo', 'tienda_crear_pedido', 'admin_resolver_pedido_web', 'admin_token_tienda', 'admin_listar_tokens_tienda', 'admin_listar_pedidos_web', 'tienda_admin_ok'];

describe('S-TIE: funciones definer y grants', () => {
  test.each(definer)('%s es security definer con search_path fijo que termina en pg_temp', (n) => {
    expect(fn(n)).toMatch(/security definer set search_path = public, (extensions, )?pg_temp/);
  });
  test('helpers internos y tablas nuevas sin grant para anon/authenticated', () => {
    for (const t of ['tienda_config', 'tienda_secretos', 'vendedores_tienda_tokens', 'tienda_intentos', 'pedidos_web_contacto']) {
      expect(SQL).toMatch(new RegExp(`revoke all on public\\.${t}\\s+from anon, authenticated`));
      expect(SQL).toMatch(new RegExp(`alter table public\\.${t}\\s+enable row level security`));
      expect(SQL).not.toMatch(new RegExp(`grant [a-z, ]+ on public\\.${t}`));
    }
    expect(SQL).toMatch(/revoke all on function public\.tienda_admin_ok\(text, text\)\s+from public, anon, authenticated/);
    expect(SQL).not.toMatch(/grant execute on function public\.tienda_admin_ok/);
  });
  test('solo las 6 RPC esperadas se otorgan a anon', () => {
    const g = [...SQL.matchAll(/grant execute on function public\.(\w+)/g)].map(m => m[1]).sort();
    expect(g).toEqual(['admin_listar_pedidos_web', 'admin_listar_tokens_tienda', 'admin_resolver_pedido_web', 'admin_token_tienda', 'tienda_catalogo', 'tienda_crear_pedido']);
  });
});

describe('S-TIE: catalogo y pedido', () => {
  test('tienda_catalogo no toca costo, ganancia, precio2 ni devuelve stock exacto', () => {
    const f = fn('tienda_catalogo');
    for (const prohibido of ['costo', 'ganancia', 'precio2', 'precio_venta_2', 'descuento', 'proveedor']) expect(f).not.toContain(prohibido);
    expect(f).toMatch(/'disponible', \(v_cfg\.permitir_sin_stock or coalesce\(\(select sum\(m\.cantidad\)[\s\S]*?, 0\) > 0\)/);
  });
  test('precio y totales salen del servidor; precioVisto solo compara', () => {
    const f = fn('tienda_crear_pedido');
    expect(f).toMatch(/v_precio := public\.tienda_precio_vigente\(v_k, v_prod\.precio/);
    expect(f).not.toMatch(/v_e->>'precio'/);
    expect(f).toMatch(/v_visto->v_k/);
  });
  test('orden: idempotencia, honeypot, topes, limite, recalculo; insert con unique_violation', () => {
    const f = fn('tienda_crear_pedido');
    const idx = ['where idempotencia = v_idem', "p->>'hp'", 'max_renglones', 'limite_por_hora', 'jsonb_array_elements(v_items)', 'insert into public.pedidos'].map(s => f.indexOf(s));
    expect(idx.every(i => i > 0)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    expect(f).toMatch(/exception when unique_violation/);
  });
  test('productoId y cantidad se validan por regex antes de castear; sin SQL dinamico con input', () => {
    const f = fn('tienda_crear_pedido');
    expect(f).toContain("'^[0-9]{1,15}$'");
    expect(f).toContain("'^[0-9]{1,7}$'");
    expect(f).not.toMatch(/execute/);
  });
  test('la IP no se guarda en claro', () => {
    expect(fn('tienda_crear_pedido')).toMatch(/digest\(v_ip \|\| coalesce\(v_sal/);
  });
});

describe('S-WEB: admin y trigger', () => {
  test('toda RPC admin valida PIN de admin por tienda_admin_ok antes de operar', () => {
    for (const n of ['admin_resolver_pedido_web', 'admin_token_tienda', 'admin_listar_tokens_tienda', 'admin_listar_pedidos_web']) {
      const f = fn(n);
      const i = f.indexOf('tienda_admin_ok');
      expect(i).toBeGreaterThan(0);
      expect(f.slice(0, i)).not.toMatch(/\b(update|insert|delete) /);
    }
    expect(fn('tienda_admin_ok')).toMatch(/permiso = 1 and activo/);
    expect(fn('tienda_admin_ok')).toMatch(/verificar_pin\(v_id, p_admin_pin\)/);
  });
  test('resolver usa for update, idempotencia por accion y estado terminal', () => {
    const f = fn('admin_resolver_pedido_web');
    expect(f).toMatch(/origen = 'web' for update/);
    expect(f).toMatch(/web_accion_id = p_accion_id/);
    expect(f).toMatch(/'ya_resuelto'/);
  });
  test('trigger de guarda neutraliza columnas web para anon en insert y update', () => {
    const f = fn('tg_pedidos_web_guard');
    expect(f).toMatch(/current_user in \('anon', 'authenticated'\)/);
    for (const c of ['origen', 'web_estado', 'idempotencia', 'web_accion_id']) {
      expect(f).toContain(`new.${c} := old.${c}`);
    }
    expect(f).toMatch(/return old/);
  });
  test('token: 256 bits aleatorios y respuesta uniforme si es invalido', () => {
    expect(fn('admin_token_tienda')).toContain('gen_random_bytes(32)');
    expect(fn('tienda_crear_pedido')).toMatch(/v_vendedor := coalesce\(v_nombre, ''\)/);
  });
});

describe('HALLAZGOS corregidos en la vuelta 2 (MOD: antes documentaban el defecto)', () => {
  test('S-TIE-01 MOD: el limite usa cf-connecting-ip o el ULTIMO x-forwarded-for, mas tope global', () => {
    const f = fn('tienda_crear_pedido');
    expect(f).toContain("v_headers->>'cf-connecting-ip'");
    expect(f).not.toMatch(/split_part\(coalesce\(v_headers->>'x-forwarded-for'/);
    expect(f).toContain('limite_global_por_hora');
  });
  test('S-TIE-02 MOD: lock advisory antes de contar intentos', () => {
    const f = fn('tienda_crear_pedido');
    expect(f).toMatch(/pg_advisory_xact_lock/);
    expect(f.indexOf('pg_advisory_xact_lock')).toBeLessThan(f.indexOf('select count(*) from public.tienda_intentos'));
  });
  test('S-TIE-03 MOD: productoId se normaliza antes de acumular', () => {
    const f = fn('tienda_crear_pedido');
    expect(f.indexOf('v_pid := (v_pid::bigint)::text')).toBeGreaterThan(0);
    expect(f.indexOf('v_pid := (v_pid::bigint)::text')).toBeLessThan(f.indexOf('v_acum := jsonb_set'));
  });
  test('S-TIE-05 MOD: el catalogo tiene statement_timeout', () => {
    expect(fn('tienda_catalogo')).toContain("set statement_timeout = '3s'");
  });
  test('S-WEB-01 MOD: pedidos ya no tiene web_contacto; el contacto esta en una tabla sin grants', () => {
    expect(SQL).not.toMatch(/add column if not exists web_contacto/);
    expect(SQL).toMatch(/create table if not exists public\.pedidos_web_contacto/);
  });
  test('S-WEB-01 RPC admin_listar_pedidos_web: PIN primero, search_path fijo, sin grant a public', () => {
    const f = SQL.slice(SQL.indexOf('function public.admin_listar_pedidos_web('));
    const cuerpo = f.slice(0, f.indexOf('end $$;'));
    expect(cuerpo).toMatch(/security definer set search_path = public, extensions, pg_temp/);
    expect(cuerpo.indexOf('tienda_admin_ok')).toBeGreaterThan(-1);
    expect(cuerpo.indexOf('tienda_admin_ok')).toBeLessThan(cuerpo.indexOf('pedidos_web_contacto'));
    expect(SQL).toMatch(/revoke all on function public\.admin_listar_pedidos_web\(text, text, text\[\]\)\s+from public/);
  });
  test('S-TIE-04 tokens de vendedor guardados en claro (pendiente)', () => {
    expect(SQL).toMatch(/token\s+text primary key/);
  });
});

describe('Aislamiento del bundle de la tienda (AC-TIE-1)', () => {
  const dir = path.join(ROOT, 'src', 'tienda');
  const fuentes = readdirSync(dir).filter(f => f.endsWith('.js')).map(f => [f, readFileSync(path.join(dir, f), 'utf8')]);
  test('ningun archivo de la tienda importa db, sync, sesion ni paginas internas', () => {
    for (const [f, src] of fuentes) {
      const imports = [...src.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
      for (const i of imports) {
        expect({ f, i, mal: /(^|\/)(db|sync|pages)(\/|$)|useAppContext|services\/(sesion|stockService)/.test(i) }).toEqual({ f, i, mal: false });
      }
    }
  });
  test('la tienda solo usa supabase.rpc (nunca .from)', () => {
    for (const [f, src] of fuentes) expect({ f, from: /supabase\s*\.from\(/.test(src) }).toEqual({ f, from: false });
  });
  test('sin dangerouslySetInnerHTML ni eval en la tienda', () => {
    for (const [, src] of fuentes) expect(src).not.toMatch(/dangerouslySetInnerHTML|eval\(|new Function/);
  });
});
