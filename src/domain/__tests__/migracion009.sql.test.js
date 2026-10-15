// Chequeos estáticos de supabase/migrations/009_tienda_portada.sql (REQ-POR).
// No ejecutan SQL: verifican que las garantías de seguridad estén escritas.
import fs from 'fs';
import path from 'path';

const sql = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'supabase', 'migrations', '009_tienda_portada.sql'), 'utf8');
const sinComentarios = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');

const cuerpo = (nombre) => {
  const i = sinComentarios.indexOf(`function public.${nombre}(`);
  if (i < 0) return '';
  const j = sinComentarios.indexOf('$$;', sinComentarios.indexOf('$$', i) + 2);
  return sinComentarios.slice(i, j);
};

describe('migración 009 portada de la tienda', () => {
  it('AC-POR-5 es idempotente, no destructiva y exige la 008', () => {
    expect(sql).toMatch(/^begin;/m);
    expect(sql).toMatch(/^commit;/m);
    expect(sinComentarios).not.toMatch(/drop (table|column|policy)/i);
    expect(sinComentarios).not.toMatch(/truncate/i);
    expect(sql).toMatch(/Falta la migracion 008_tienda\.sql/);
    for (const col of ['nombre', 'logo_url', 'color', 'bienvenida', 'contacto', 'whatsapp', 'destacados']) {
      expect(sql).toMatch(new RegExp(`alter table public\\.tienda_config add column if not exists ${col}\\s`));
    }
  });

  it('AC-POR-5 tienda_portada es la lectura pública: security definer, search_path fijo y solo datos de vitrina', () => {
    const c = cuerpo('tienda_portada');
    expect(c).toMatch(/security definer set search_path = public, extensions, pg_temp/);
    for (const prohibido of ['costo', 'ganancia', 'pin', 'token', 'limite_por_hora', 'movimientos_stock']) expect(c).not.toMatch(new RegExp(prohibido));
    expect(c).toMatch(/America\/Argentina\/Buenos_Aires/);
    expect(sql).toMatch(/grant execute on function public\.tienda_portada\(\)\s+to anon/);
  });

  it('AC-POR-2 las tablas nuevas tienen RLS y ningún grant directo para anon/authenticated', () => {
    for (const t of ['tienda_banners', 'tienda_ofertas', 'tienda_subidas']) {
      expect(sql).toMatch(new RegExp(`alter table public\\.${t} enable row level security`));
      expect(sql).toMatch(new RegExp(`revoke all on public\\.${t} from anon, authenticated`));
      expect(sinComentarios).not.toMatch(new RegExp(`grant [a-z, ]+ on public\\.${t}`));
    }
  });

  it('AC-POR-2 escribir la config es solo admin (PIN verificado en el servidor antes de tocar nada)', () => {
    for (const f of ['admin_tienda_leer', 'admin_tienda_guardar', 'admin_tienda_subida']) {
      const c = cuerpo(f);
      expect(c).toMatch(/security definer set search_path = public, extensions, pg_temp/);
      const auth = c.indexOf('tienda_admin_ok(p_admin_id, p_admin_pin) is null');
      expect(auth).toBeGreaterThan(0);
      for (const w of ['update public.', 'delete from', 'insert into', 'select * into']) {
        const k = c.indexOf(w);
        if (k >= 0) expect(k).toBeGreaterThan(auth);
      }
    }
  });

  it('AC-POR-2 admin_tienda_guardar valida en el servidor (color, URLs https, destinos, topes y producto existente)', () => {
    const c = cuerpo('admin_tienda_guardar');
    expect(c).toMatch(/\^#\[0-9a-f\]\{6\}\$/);
    expect(c).toMatch(/!~\* '\^https:\/\/\[\^\[:space:\]/);
    expect(c).toMatch(/not in \('rubro', 'marca', 'producto', 'ofertas'\)/);
    expect(c).toMatch(/jsonb_array_length\(v_b\) > 10/);
    expect(c).toMatch(/jsonb_array_length\(v_o\) > 200/);
    expect(c).toMatch(/not exists \(select 1 from public\.productos/);
    expect(c).toMatch(/between 1 and 1000/);
  });

  it('AC-POR-3 ofertas con precio opcional > 0 y vigencia; el catálogo marca precio anterior con el precio que cobra el servidor', () => {
    expect(sql).toMatch(/precio\s+numeric\(14,2\) check \(precio is null or \(precio > 0 and precio <> 'NaN'::numeric\)\)/); // SEC-POR-3
    expect(sql).toMatch(/desde\s+date not null/);
    expect(sql).toMatch(/check \(desde <= hasta\)/);
    const cat = cuerpo('tienda_catalogo');
    expect(cat).toMatch(/tienda_precio_vigente\(p\.id::text, p\.precio, v_hoy\)/);
    expect(cat).toMatch(/'precioAnterior'/);
    expect(cat).toMatch(/'enOferta'/);
    for (const prohibido of ['costo', 'ganancia', 'descuento', 'precio_venta2', 'proveedor']) expect(cat).not.toMatch(new RegExp(prohibido));
    expect(cat).not.toMatch(/'stock'/);
  });

  it('AC-POR-2 SEC-POR-2 las URLs se validan en el servidor con la regla estricta (sin espacios, comillas ni <>)', () => {
    const estricta = `'^https://[^[:space:]"''<>]+$'`;
    expect(sql.split(estricta).length - 1).toBe(4); // logo_url, imagen_url y las 2 de admin_tienda_guardar
    expect(sinComentarios).not.toMatch(/~\* '\^https:\/\/'/); // ya no queda la regla floja
  });

  it('AC-POR-3 SEC-POR-4 tienda_portada no publica ofertas de productos ocultos ni sin precio', () => {
    const c = cuerpo('tienda_portada');
    expect(c).toMatch(/p\.id::text = o\.producto_id and coalesce\(p\.visible_tienda, true\) and p\.precio > 0/);
  });

  it('AC-POR-4 bucket "tienda" público, 2 MB, solo jpg/png/webp; insert solo con nombre habilitado; sin update ni delete', () => {
    expect(sql).toMatch(/insert into storage\.buckets \(id, name, public, file_size_limit, allowed_mime_types\)/);
    expect(sql).toMatch(/'tienda', 'tienda', true, 2097152, array\['image\/jpeg', 'image\/png', 'image\/webp'\]/);
    expect(sql).toMatch(/on storage\.objects for insert to anon, authenticated/);
    expect(sql).toMatch(/with check \(bucket_id = 'tienda' and public\.tienda_subida_habilitada\(name\)\)/);
    expect(sinComentarios).not.toMatch(/on storage\.objects for (update|delete|all|select)/);
    const h = cuerpo('tienda_subida_habilitada');
    expect(h).toMatch(/expira_at > now\(\)/);
    expect(h).toMatch(/\^img\/\[0-9a-f-\]\{36\}\\\.\(jpg\|png\|webp\)\$/);
    const s = cuerpo('admin_tienda_subida');
    expect(s).toMatch(/gen_random_uuid\(\)/);
    expect(s).toMatch(/interval '10 minutes'/);
  });
});
