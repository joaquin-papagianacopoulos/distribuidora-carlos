// Estatico sobre la migracion 026 (no se aplica en ninguna base): AC-ESC-1, AC-ESC-3, AC-ESC-4.
// Y sobre supabase/verificacion/026_escalas_casos.sql: tiene que tener EXACTAMENTE los casos del fixture
// que usa el cliente JS (mismo centavo cliente/servidor).
import fs from 'fs';
import path from 'path';
import { CASOS_ESCALAS } from '../__fixtures__/escalasCasos';
import { COLUMNAS_PRODUCTO_PUBLICAS } from '../productos';

const MIG = path.join(__dirname, '../../../supabase/migrations');
const leer = (n) => fs.readFileSync(path.join(MIG, n), 'utf8').replace(/\r\n/g, '\n');
const sql = leer('026_escalas_bulto.sql');
const ver = fs.readFileSync(path.join(__dirname, '../../../supabase/verificacion/026_escalas_casos.sql'), 'utf8').replace(/\r\n/g, '\n');

const funcion = (txt, nombre, delim = '$$') => {
  const a = txt.indexOf(`create or replace function public.${nombre}`);
  if (a < 0) return null;
  const abre = txt.indexOf(delim, a);
  const cierra = txt.indexOf(delim, abre + delim.length);
  return txt.slice(a, cierra + delim.length);
};

const lineasUtiles = (f) => f.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('--'));

// Lineas de la version anterior que la 026 cambia a propósito (todo lo demás tiene que seguir igual).
const CAMBIADAS = {
  admin: [
    "or char_length(coalesce(v_gbulto, '')) > 40 then",
    'bulto_x, minimo_venta, venta_por, bulto_nombre, visible_tienda, precio_bulto, stock_minimo, grupo_bulto)',
    'v_pbulto, v_smin, v_gbulto)',
    "grupo_bulto = case when v_fila ? 'grupo_bulto' then excluded.grupo_bulto else public.productos.grupo_bulto end;",
  ],
  catalogo: [],
  pedido: [
    'select p3.id, p3.nombre, p3.precio, p3.precio_bulto, p3.bulto_x, p3.minimo_venta, p3.venta_por, p3.bulto_nombre into v_prod',
    'v_precio := public.tienda_precio_aplicado(v_unit, v_prod.precio_bulto, v_prod.bulto_x, v_u);',
    "'precioOriginal', v_unit, 'precioPorBulto', (v_precio < v_unit));",
  ],
};

describe('migracion 026: columna y grants (AC-ESC-1)', () => {
  it('AC-ESC-1 columna jsonb idempotente con check de forma y tope de 3', () => {
    expect(sql).toMatch(/alter table public\.productos add column if not exists escalas_bulto jsonb;/);
    expect(sql).toMatch(/conname = 'productos_escalas_bulto_chk'/);
    expect(sql).toMatch(/jsonb_array_length\(escalas_bulto\) <= 3/);
  });
  it('AC-ESC-1 grant select por columna (regla 8) y la columna esta en COLUMNAS_PRODUCTO_PUBLICAS', () => {
    expect(sql).toMatch(/grant select \(escalas_bulto\) on public\.productos to anon, authenticated;/);
    expect(COLUMNAS_PRODUCTO_PUBLICAS).toContain('escalas_bulto');
  });
  it('AC-ESC-1 no expone costos, descuentos ni ganancia', () => {
    const sinComentarios = sql.replace(/--.*$/gm, '');
    expect(sinComentarios).not.toMatch(/grant select \((?:[^)]*)(costo_final|descuento1|descuento2|ganancia|precio_venta2)/);
    const catalogo = funcion(sinComentarios, 'tienda_catalogo');
    expect(catalogo).not.toMatch(/costo_final|descuento1|descuento2|ganancia|precio_venta2/);
  });
  it('guardas de dependencias con el nombre de la migracion que falta', () => {
    for (const m of ['022_grupo_bulto.sql', '024_pedidos_edicion_vendedor.sql', '010_lote_operacion_precios.sql']) expect(sql).toContain(m);
  });
});

describe('migracion 026: helpers (AC-ESC-4)', () => {
  const helpers = [
    ['escalas_bulto_normalizar', 'jsonb'],
    ['tienda_escala_alcanzada', 'jsonb, integer, numeric'],
    ['tienda_escala_pct', 'jsonb, integer, numeric'],
    ['tienda_precio_con_escala', 'numeric, jsonb, integer, numeric'],
  ];
  it('AC-ESC-4 search_path fijo, inmutables y sin grant a anon', () => {
    for (const [n, args] of helpers) {
      const f = funcion(sql, n, '$fn$');
      expect(f).not.toBeNull();
      expect(f).toMatch(/immutable set search_path = public, pg_temp/);
      expect(sql).toContain(`revoke all on function public.${n}(${args}) from public, anon, authenticated;`);
      expect(sql).not.toMatch(new RegExp(`grant execute on function public\\.${n}`));
    }
  });
  it('AC-ESC-4 redondeo para arriba al peso entero con numeric (ceil y round a 2)', () => {
    const f = funcion(sql, 'tienda_precio_con_escala', '$fn$');
    expect(f).toMatch(/ceil\(round\(p_precio, 2\) \* 100 \* \(10000 - round\(/);
    expect(f).toMatch(/round\(p_precio, 2\)/);
  });
  it('AC-ESC-4 normalizar: primeros 10, desde 2..9999 entero, pct 0..100 con 2 decimales, creciente, max 3', () => {
    const f = funcion(sql, 'escalas_bulto_normalizar', '$fn$');
    expect(f).toMatch(/t\.ord <= 10/);
    expect(f).toMatch(/v_desde < 2 or v_desde > 9999/);
    expect(f).toMatch(/v_pct > 0 and v_pct < 100/);
    expect(f).toMatch(/v_pct <> round\(v_pct, 2\)/);
    expect(f).toMatch(/v_desde <= v_ult/);
    expect(f).toMatch(/v_n >= 3/);
  });
});

describe('migracion 026: las 3 RPC conservan todo lo de la version anterior (AC-ESC-3)', () => {
  const casos = [
    ['admin', 'admin_guardar_productos', '022_grupo_bulto.sql'],
    ['catalogo', 'tienda_catalogo', '010_lote_operacion_precios.sql'],
    ['pedido', 'tienda_crear_pedido', '024_pedidos_edicion_vendedor.sql'],
  ];
  it.each(casos)('AC-ESC-3 %s: cada linea de la version previa sigue (salvo las cambiadas a proposito)', (clave, nombre, archivo) => {
    const antes = funcion(leer(archivo), nombre);
    const ahora = funcion(sql, nombre);
    expect(antes).not.toBeNull();
    expect(ahora).not.toBeNull();
    const nuevas = new Set(lineasUtiles(ahora));
    const perdidas = lineasUtiles(antes).filter(l => !nuevas.has(l));
    expect(perdidas.sort()).toEqual([...CAMBIADAS[clave]].sort());
  });
  it('AC-ESC-3 search_path y statement_timeout se mantienen; mismos revoke/grant', () => {
    expect(funcion(sql, 'admin_guardar_productos')).toMatch(/security definer set search_path = public, pg_temp as \$\$/);
    expect(funcion(sql, 'tienda_catalogo')).toMatch(/security definer set search_path = public, extensions, pg_temp\nset statement_timeout = '3s' as \$\$/);
    expect(funcion(sql, 'tienda_crear_pedido')).toMatch(/security definer set search_path = public, extensions, pg_temp as \$\$/);
    expect(sql).toContain('revoke all on function public.admin_guardar_productos(text, text, jsonb) from public;');
    expect(sql).toContain('grant execute on function public.admin_guardar_productos(text, text, jsonb) to anon, authenticated;');
    expect(sql).toContain('revoke all on function public.tienda_catalogo() from public;');
    expect(sql).toContain('grant execute on function public.tienda_catalogo() to anon, authenticated;');
    expect(sql).toContain('revoke all on function public.tienda_crear_pedido(jsonb) from public;');
    expect(sql).toContain('grant execute on function public.tienda_crear_pedido(jsonb) to anon, authenticated;');
  });
  it('AC-ESC-1 admin_guardar_productos conserva las escalas si la clave no viene y rechaza formas raras', () => {
    const f = funcion(sql, 'admin_guardar_productos');
    expect(f).toMatch(/escalas_bulto = case when v_fila \? 'escalas_bulto' then excluded\.escalas_bulto else public\.productos\.escalas_bulto end/);
    expect(f).toMatch(/jsonb_array_length\(v_fila->'escalas_bulto'\) > 3/);
    expect(f).toMatch(/or v_esc_mal then/);
    expect(f).toMatch(/public\.verificar_pin\(v_admin_id, p_admin_pin\)/);
  });
  it('AC-ESC-3 tienda_catalogo expone escalasBulto normalizadas', () => {
    expect(funcion(sql, 'tienda_catalogo')).toMatch(/'escalasBulto',\s+case when coalesce\(p\.bulto_x, 0\) > 1 then public\.escalas_bulto_normalizar\(p\.escalas_bulto\)/);
  });
  it('AC-ESC-2 tienda_crear_pedido: el servidor recalcula con la escala y congela el renglon', () => {
    const f = funcion(sql, 'tienda_crear_pedido');
    expect(f).toMatch(/v_precio := public\.tienda_precio_con_escala\(v_base, v_prod\.escalas_bulto, v_prod\.bulto_x, v_u\)/);
    expect(f).toMatch(/'precioPorBulto', \(v_base < v_unit\)/);
    expect(f).toMatch(/'escalasBulto', v_escs, 'precioBultoX', v_bx/);
    expect(f).toMatch(/'escalaDesde'/);
    expect(f).toMatch(/'escalaPct'/);
  });
});

describe('migracion 026: SQL valido y no destructiva', () => {
  it('los delimitadores de dolar quedan pareados (un "$" suelto rompe la migracion)', () => {
    const sinNombrados = sql.replace(/\$[a-z_]+\$/g, '');
    expect((sinNombrados.match(/\$\$/g) || []).length % 2).toBe(0);
    expect((sinNombrados.match(/\$\$/g) || []).length).toBe(6); // 3 RPC
    expect(/\bas \$(?!\$|[a-z_]+\$)/.test(sql)).toBe(false);
    expect(/\bend \$;/.test(sql)).toBe(false);
    expect((sql.match(/\$mig\$/g) || []).length % 2).toBe(0);
    expect((sql.match(/\$fn\$/g) || []).length % 2).toBe(0);
    expect((sql.match(/\$fn\$/g) || []).length).toBe(8); // 4 helpers
    // cada "as $fn$" tiene su cierre "$fn$" solo en una linea de cierre
    expect((sql.match(/as \$fn\$/g) || []).length).toBe(4);
  });
  it('begin/commit balanceados', () => {
    expect(sql.match(/^begin;$/gm)).toHaveLength(1);
    expect(sql.match(/^commit;$/gm)).toHaveLength(1);
  });
  it('sin drop, delete ni revoke de grants existentes de anon sobre productos', () => {
    const limpio = sql.replace(/--.*$/gm, '');
    expect(limpio).not.toMatch(/\bdrop\b/i);
    // El unico delete es la limpieza de intentos de la tienda, que ya traia la 024.
    expect((limpio.match(/\bdelete from\b[^;]*/gi) || []).every(d => /tienda_intentos/.test(d))).toBe(true);
    expect(limpio).not.toMatch(/revoke [^;]*on public\.productos/i);
  });
});

describe('verificacion 026: mismos casos que el fixture (AC-ESC-2, AC-ESC-4)', () => {
  const filas = ver.split('\n').filter(l => /^\s+\('[a-z0-9-]+',/.test(l));
  const analizar = (l) => {
    const m = l.match(/^\s+\('([a-z0-9-]+)', ([\d.]+), ([\d.]+), ([\d.]+), (null::jsonb|'.*'::jsonb), ([\d.]+), ([\d.]+), ([\d.]+), (null::integer|\d+)\)[,]?$/);
    expect(m).not.toBeNull();
    return {
      id: m[1], precio: Number(m[2]), precioBulto: Number(m[3]), bultoX: Number(m[4]),
      escalas: m[5] === 'null::jsonb' ? null : JSON.parse(m[5].slice(1, -'\'::jsonb'.length)),
      cantidad: Number(m[6]), base: Number(m[7]), esperado: Number(m[8]), escala: m[9] === 'null::integer' ? null : Number(m[9]),
    };
  };
  it('AC-ESC-4 tiene exactamente los casos del fixture, en el mismo orden', () => {
    expect(filas.length).toBeGreaterThanOrEqual(15);
    expect(filas.map(analizar)).toEqual(CASOS_ESCALAS);
  });
  it('AC-ESC-4 devuelve solo las filas que no coinciden (usa las funciones de la 026)', () => {
    expect(ver).toMatch(/public\.tienda_precio_aplicado\(c\.precio, c\.precio_bulto, c\.bulto_x, c\.cantidad\)/);
    expect(ver).toMatch(/public\.tienda_precio_con_escala\(k\.base_srv, k\.escalas, k\.bulto_x, k\.cantidad\)/);
    expect(ver).toMatch(/is distinct from r\.esperado::numeric/);
    expect(ver.replace(/--.*$/gm, '')).not.toMatch(/\b(insert|update|delete|drop|alter)\b/i);
  });
});
