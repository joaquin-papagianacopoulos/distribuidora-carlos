// Seguridad REQ-POR (corrida 20261014-2342-sec). Chequeos estáticos del SQL 009 y de la
// sanitización de dominio. No ejecuta SQL: falla si alguien rompe una garantía escrita.
import fs from 'fs';
import path from 'path';
import {
  urlSegura, normalizarConfigTienda, normalizarHex, linkWhatsapp, destinoHref,
  bannersVigentes, validarConfigTienda, validarImagen,
} from '../tiendaPortada';

const raiz = path.join(__dirname, '..', '..', '..');
const sql = fs.readFileSync(path.join(raiz, 'supabase', 'migrations', '009_tienda_portada.sql'), 'utf8');
const code = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
const fn = (nombre) => {
  const i = code.indexOf(`function public.${nombre}(`);
  if (i < 0) return '';
  return code.slice(i, code.indexOf('$$;', code.indexOf('$$', i) + 2));
};

describe('SEC SQL 009: aislamiento de tablas y funciones', () => {
  it('las tablas nuevas tienen RLS y sin grants para anon/authenticated', () => {
    for (const t of ['tienda_banners', 'tienda_ofertas', 'tienda_subidas']) {
      expect(code).toMatch(new RegExp(`alter table public\\.${t} enable row level security`));
      expect(code).toMatch(new RegExp(`revoke all on public\\.${t}\\s+from anon, authenticated`));
      expect(code).not.toMatch(new RegExp(`grant [^;]*on (table )?public\\.${t}`, 'i'));
      expect(code).not.toMatch(new RegExp(`create policy [^;]*on public\\.${t}`, 'i'));
    }
  });

  it('toda RPC admin verifica tienda_admin_ok ANTES de cualquier delete/update/insert', () => {
    for (const f of ['admin_tienda_leer', 'admin_tienda_guardar', 'admin_tienda_subida']) {
      const c = fn(f);
      expect(c).toBeTruthy();
      const auth = c.indexOf('tienda_admin_ok(p_admin_id, p_admin_pin)');
      expect(auth).toBeGreaterThan(-1);
      const mut = c.search(/\b(delete from|update public|insert into)\b/i);
      if (mut >= 0) expect(auth).toBeLessThan(mut);
    }
  });

  it('las RPC son security definer con search_path fijo y sin SQL dinámico', () => {
    for (const f of ['tienda_portada', 'tienda_catalogo', 'admin_tienda_leer', 'admin_tienda_guardar', 'admin_tienda_subida', 'tienda_subida_habilitada']) {
      const c = fn(f);
      expect(c).toMatch(/security definer set search_path = public/i);
      expect(c).not.toMatch(/\bexecute\b/i);
    }
  });

  it('el delete masivo de banners/ofertas ocurre después de la autorización', () => {
    const c = fn('admin_tienda_guardar');
    const auth = c.indexOf('tienda_admin_ok');
    expect(auth).toBeGreaterThan(-1);
    for (const t of ['tienda_banners', 'tienda_ofertas']) {
      const d = c.indexOf(`delete from public.${t}`);
      expect(d).toBeGreaterThan(auth);
    }
    expect(c).toMatch(/exception\s+when invalid_parameter_value/); // todo-o-nada
  });

  it('tienda_portada y tienda_catalogo no exponen costo, ganancia, stock exacto, PIN ni tokens', () => {
    for (const f of ['tienda_portada', 'tienda_catalogo']) {
      const c = fn(f);
      expect(c).not.toMatch(/costo|ganancia|pin_hash|\bpin\b|token|limite_por_hora|vendedores|tienda_pedidos/i);
    }
    expect(fn('tienda_catalogo')).not.toMatch(/'stock'/i);
    expect(fn('tienda_catalogo')).toMatch(/'disponible'/);
  });

  it('solo anon puede ejecutar lo público; las admin exigen PIN, no hay grant a tienda_admin_ok', () => {
    expect(code).toMatch(/revoke all on function public\.admin_tienda_guardar\(text, text, jsonb\)\s+from public/);
    expect(code).not.toMatch(/grant execute on function public\.tienda_admin_ok/i);
  });
});

describe('SEC SQL 009: validación servidor', () => {
  it('config: color hex estricto, https, whatsapp solo dígitos, topes', () => {
    const c = fn('admin_tienda_guardar');
    expect(c).toContain("!~ '^#[0-9a-f]{6}$'");
    expect(c).toMatch(/!~\* '\^https:\/\/\[\^\[:space:\]/);
    expect(c).toContain("!~ '^[0-9]{0,15}$'");
    expect(c).toMatch(/jsonb_array_length\(v_b\) > 10/);
    expect(c).toMatch(/jsonb_array_length\(v_o\) > 200/);
    expect(c).toMatch(/v_lim not between 1 and 1000/);
  });

  it('las tablas repiten los checks (defensa en profundidad)', () => {
    expect(code).toMatch(/logo_url[^\n]*~\* '\^https:\/\/\[\^\[:space:\]/);
    expect(code).toMatch(/imagen_url[^\n]*~\* '\^https:\/\/\[\^\[:space:\]/);
    expect(code).toMatch(/color[^\n]*check \(color ~ '\^#\[0-9a-f\]\{6\}\$'\)/);
    expect(code).toMatch(/destino_tipo in \('rubro', 'marca', 'producto', 'ofertas'\)/);
    expect(code).toMatch(/precio is null or \(precio > 0 and precio <> 'NaN'::numeric\)/); // SEC-POR-3
    expect(code).toMatch(/check \(desde <= hasta\)/);
  });

  it('la oferta exige que el producto exista', () => {
    expect(fn('admin_tienda_guardar')).toMatch(/not exists \(select 1 from public\.productos pr where pr\.id::text = v_x->>'productoId'\)/);
  });
});

describe('SEC SQL 009: tickets de subida y bucket', () => {
  it('bucket público con 2 MB y solo jpg/png/webp (sin svg ni html)', () => {
    expect(code).toMatch(/values \('tienda', 'tienda', true, 2097152, array\['image\/jpeg', 'image\/png', 'image\/webp'\]\)/);
    expect(code).not.toMatch(/svg|text\/html/i);
  });

  it('insert solo con ticket vigente; sin policy select/update/delete sobre storage.objects', () => {
    expect(code).toMatch(/create policy tienda_insert_con_permiso on storage\.objects for insert/);
    expect(code).toMatch(/bucket_id = 'tienda' and public\.tienda_subida_habilitada\(name\)/);
    expect(code).not.toMatch(/on storage\.objects for (select|update|delete|all)/i);
    const h = fn('tienda_subida_habilitada');
    expect(h).toMatch(/\^img\/\[0-9a-f-\]\{36\}\\\.\(jpg\|png\|webp\)\$/);
    expect(h).toMatch(/expira_at > now\(\)/);
  });

  it('el nombre es aleatorio (uuid del servidor), el tipo se mapea desde una lista cerrada y expira en 10 min', () => {
    const c = fn('admin_tienda_subida');
    expect(c).toContain('gen_random_uuid()');
    expect(c).toMatch(/'image\/jpeg' then 'jpg' when 'image\/png' then 'png' when 'image\/webp' then 'webp'/);
    expect(c).toContain("interval '10 minutes'");
    expect(c).not.toMatch(/p_nombre|p_tipo\s*\|\|/); // el cliente no elige el nombre
  });
});

describe('SEC dominio: URLs, colores y destinos', () => {
  const malas = ['javascript:alert(1)', 'data:text/html,<script>1</script>', 'http://x.com/a.png', '//x.com/a.png',
    'https://x.com/a b.png', 'https://x.com/"onerror=1', "https://x.com/'x", 'https://x.com/<svg>', 'vbscript:x', ' javascript:alert(1)', '',
    null, undefined, 'https://' + 'a'.repeat(500)];
  it('urlSegura rechaza todo lo que no sea https limpio', () => {
    for (const u of malas) expect(urlSegura(u)).toBeNull();
    expect(urlSegura('https://abc.supabase.co/storage/v1/object/public/tienda/img/x.jpg')).not.toBeNull();
  });

  it('normalizarConfigTienda no deja pasar logo/color inyectables ni whatsapp con símbolos', () => {
    const c = normalizarConfigTienda({ logo: 'javascript:alert(1)', color: '#fff"/><script>', whatsapp: '+54 9 11 <b>1234</b>5678', nombre: 'x'.repeat(200) });
    expect(c.logo).toBeNull();
    expect(c.color).toBe('#0f766e');
    expect(c.whatsapp).toMatch(/^[0-9]{0,15}$/);
    expect(c.nombre.length).toBeLessThanOrEqual(60);
  });

  it('el color que llega al favicon SVG / style siempre es #rrggbb', () => {
    for (const x of ['red;background:url(x)', '#12345g', '"><script>', '#ffffff</svg>', '#00000"']) {
      const c = normalizarConfigTienda({ color: x }).color;
      expect(c).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(normalizarHex('#ABC')).toBe('#aabbcc');
  });

  it('linkWhatsapp solo produce https://wa.me/<dígitos>', () => {
    expect(linkWhatsapp('javascript:1')).toBeNull();
    expect(linkWhatsapp('54911234567"><x')).toMatch(/^https:\/\/wa\.me\/\d+$/);
  });

  it('destinoHref siempre es una ruta relativa /tienda (sin open redirect ni esquemas)', () => {
    const valores = ['//evil.com', 'https://evil.com', 'javascript:alert(1)', '../../x', '"><a>', '/\\evil.com'];
    for (const tipo of ['rubro', 'marca', 'producto', 'ofertas', 'zzz']) {
      for (const valor of valores) {
        const h = destinoHref({ tipo, valor }, 'tok');
        expect(h.startsWith('/tienda')).toBe(true);
        expect(h).not.toMatch(/^\/\//);
        expect(h).not.toMatch(/[<>"\s\\]/);
      }
    }
  });

  it('bannersVigentes descarta imágenes http, javascript: y data:', () => {
    const b = ['http://x/a.png', 'javascript:1', 'data:image/svg+xml,<svg/>', 'https://x/a.png'].map(imagen => ({ imagen, destino: { tipo: 'ofertas' } }));
    expect(bannersVigentes(b, '2026-01-01')).toHaveLength(1);
  });

  it('validarConfigTienda rechaza payloads hostiles del borrador', () => {
    const r = validarConfigTienda({
      config: { nombre: '', color: 'url(x)', logo: 'javascript:1', whatsapp: '12', limitePorHora: -5, bienvenida: 'x'.repeat(301) },
      banners: Array.from({ length: 11 }, () => ({ imagen: 'http://x', destino: { tipo: 'evil', valor: '' } })),
      ofertas: [{ productoId: '', precio: -1, desde: '2026-13-45', hasta: '' }, { productoId: 'a', precio: NaN, desde: '2026-01-01', hasta: '2026-01-02' },
        { productoId: 'a', precio: Infinity, desde: '2026-01-01', hasta: '2026-01-02' }],
    });
    expect(r.ok).toBe(false);
    expect(Object.keys(r.errores)).toEqual(expect.arrayContaining(['nombre', 'color', 'logo', 'whatsapp', 'limitePorHora', 'bienvenida', 'banners']));
    expect(r.errores.ofertasDetalle[0].precio).toBeTruthy();
    expect(r.errores.ofertasDetalle[1].precio).toBeTruthy();
    expect(r.errores.ofertasDetalle[2].precio).toBeTruthy();
  });

  it('validarImagen: solo jpg/png/webp <= 2 MB (nada de svg)', () => {
    expect(validarImagen({ type: 'image/svg+xml', size: 10 }).ok).toBe(false);
    expect(validarImagen({ type: 'text/html', size: 10 }).ok).toBe(false);
    expect(validarImagen({ type: 'image/png', size: 2 * 1024 * 1024 + 1 }).ok).toBe(false);
    expect(validarImagen({ type: 'image/png', size: NaN }).ok).toBe(false);
    expect(validarImagen({ type: 'image/webp', size: 1000 }).ok).toBe(true);
  });
});

describe('SEC front: sin sinks peligrosos en src/tienda', () => {
  const dir = path.join(raiz, 'src', 'tienda');
  const archivos = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
  it('no usa dangerouslySetInnerHTML, innerHTML, eval ni window.open', () => {
    for (const f of archivos) {
      const t = fs.readFileSync(path.join(dir, f), 'utf8');
      expect(t).not.toMatch(/dangerouslySetInnerHTML|\.innerHTML|\beval\(|new Function\(|window\.open|document\.write/);
    }
  });
  it('tiendaApi solo usa rpc (nunca .from) y no importa db/sync', () => {
    const t = fs.readFileSync(path.join(dir, 'tiendaApi.js'), 'utf8').split('\n').filter(l => !l.trim().startsWith('//')).join(' ');
    expect(t).not.toMatch(/\.from\(/);
    expect(t).not.toMatch(/from '\.\.\/(db|sync)/);
  });
  it('los href externos usan rel noopener', () => {
    const t = fs.readFileSync(path.join(dir, 'Portada.js'), 'utf8');
    expect(t).toMatch(/target="_blank" rel="noopener noreferrer"/);
  });
});

describe('SEC headers', () => {
  const h = fs.readFileSync(path.join(raiz, 'public', '_headers'), 'utf8');
  it('hay CSP (al menos report-only) que permite imágenes https (Storage) sin script inline', () => {
    expect(h).toMatch(/Content-Security-Policy(-Report-Only)?:/);
    expect(h).toMatch(/img-src [^;]*https:/);
    expect(h).toMatch(/script-src 'self'(;|\s*$)/m);
    expect(h).not.toMatch(/script-src[^;]*unsafe-(inline|eval)/);
    expect(h).toMatch(/X-Frame-Options: DENY/);
  });
});
