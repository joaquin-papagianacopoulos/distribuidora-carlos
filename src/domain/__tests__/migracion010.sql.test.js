// Chequeos estáticos de supabase/migrations/010_lote_operacion_precios.sql
// (REQ-PBU, REQ-MIN en la tienda y REQ-HPR). No ejecutan SQL: verifican que las
// garantías de seguridad e idempotencia estén escritas.
import fs from 'fs';
import path from 'path';

const sql = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'supabase', 'migrations', '010_lote_operacion_precios.sql'), 'utf8');
const sinComentarios = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');

const cuerpo = (nombre) => {
  const i = sinComentarios.indexOf(`function public.${nombre}(`);
  if (i < 0) return '';
  const j = sinComentarios.indexOf('$$;', sinComentarios.indexOf('$$', i) + 2);
  return sinComentarios.slice(i, j);
};

describe('migración 010 precios, mínimos e historial', () => {
  it('AC-HPR-1 es idempotente, transaccional y no destructiva', () => {
    expect(sql).toMatch(/^begin;/m);
    expect(sql).toMatch(/^commit;/m);
    expect(sinComentarios).not.toMatch(/drop (table|column|function|policy)/i);
    expect(sinComentarios).not.toMatch(/^\s*truncate/im);
    // El único delete es la limpieza de intentos viejos que ya hacía tienda_crear_pedido (008).
    expect((sinComentarios.match(/delete from\s+[\w.]+/gi) || []).every(d => /tienda_intentos/.test(d))).toBe(true);
    expect(sql).toMatch(/add column if not exists precio_bulto numeric\(14,2\) not null default 0/);
    expect(sql).toMatch(/create table if not exists public\.cambios_precio/);
    expect(sql).toMatch(/create index if not exists cambios_precio_fecha_idx/);
  });

  it('AC-PBU-4 exige las migraciones previas (007, 008/009) y verificar_pin', () => {
    expect(sql).toMatch(/Falta la migracion 007_productos_escritura_admin\.sql/);
    expect(sql).toMatch(/Faltan las migraciones 008_tienda\.sql \/ 009_tienda_portada\.sql/);
    expect(sql).toMatch(/Falta public\.verificar_pin/);
  });

  it('AC-PBU-4 admin_guardar_productos guarda precio_bulto validado (>= 0, tope) solo en la rama extras', () => {
    const c = cuerpo('admin_guardar_productos');
    expect(c).toMatch(/v_pbulto < 0 or v_pbulto > 999999999999/);
    expect(c).toMatch(/precio_bulto = excluded\.precio_bulto/);
    // La rama básica (sin extras) no toca precio_bulto.
    const basica = c.slice(c.indexOf('Solo basicas'));
    expect(basica).not.toMatch(/precio_bulto/);
  });

  it('AC-PBU-4 AC-MIN-3 los helpers existen y NO tienen grant para anon', () => {
    expect(cuerpo('tienda_precio_aplicado')).toMatch(/least\(p_precio, p_precio_bulto\)/);
    expect(cuerpo('tienda_minimo_efectivo')).toMatch(/ceil\(/);
    expect(sinComentarios).toMatch(/revoke all on function public\.tienda_precio_aplicado\(numeric, numeric, integer, numeric\) from public, anon, authenticated/);
    expect(sinComentarios).toMatch(/revoke all on function public\.tienda_minimo_efectivo\(integer, text, integer\) from public, anon, authenticated/);
    expect(sinComentarios).not.toMatch(/grant execute on function public\.tienda_(precio_aplicado|minimo_efectivo)/);
  });

  it('AC-PBU-4 tienda_catalogo y tienda_crear_pedido usan los MISMOS helpers (misma regla que el dominio)', () => {
    const cat = cuerpo('tienda_catalogo');
    expect(cat).toMatch(/'precioBulto'/);
    expect(cat).toMatch(/public\.tienda_minimo_efectivo\(p\.minimo_venta, p\.venta_por, p\.bulto_x\)/);
    expect(cat).not.toMatch(/costo|ganancia|pin_hash/);
    const crear = cuerpo('tienda_crear_pedido');
    expect(crear).toMatch(/public\.tienda_precio_aplicado\(v_unit, v_prod\.precio_bulto, v_prod\.bulto_x, v_u\)/);
    expect(crear).toMatch(/public\.tienda_minimo_efectivo\(v_prod\.minimo_venta, v_prod\.venta_por, v_prod\.bulto_x\)/);
    // El chequeo de precio manipulado de la 008 sigue ahí.
    expect(crear).toMatch(/round\(\(v_visto->>v_k\)::numeric \* 100\)::bigint <> v_cent/);
  });

  it('AC-HPR-1 cambios_precio: RLS, lectura pública y escritura directa revocada (historial inmutable)', () => {
    expect(sql).toMatch(/alter table public\.cambios_precio enable row level security/);
    expect(sql).toMatch(/revoke all on public\.cambios_precio from public, anon, authenticated/);
    expect(sql).toMatch(/grant select \([^)]*\)\s+on public\.cambios_precio to anon, authenticated/);
    expect(sinComentarios).not.toMatch(/grant (insert|update|delete)[a-z, ]* on public\.cambios_precio/);
    const tabla = sinComentarios.slice(sinComentarios.indexOf('create table if not exists public.cambios_precio'), sinComentarios.indexOf('create index if not exists cambios_precio_fecha_idx'));
    expect(tabla).not.toMatch(/costo|ganancia|cliente|pin/);
  });

  it('AC-HPR-1 admin_registrar_cambios_precio exige admin activo con PIN antes de escribir y es idempotente', () => {
    const c = cuerpo('admin_registrar_cambios_precio');
    expect(c).toMatch(/security definer set search_path = public, pg_temp/);
    const auth = c.indexOf('public.verificar_pin(v_admin_id, p_admin_pin)');
    expect(auth).toBeGreaterThan(0);
    expect(c.indexOf('insert into public.cambios_precio')).toBeGreaterThan(auth);
    expect(c).toMatch(/permiso = 1 and activo and pin_hash is not null/);
    expect(c).toMatch(/jsonb_array_length\(p_filas\) > 500/);
    expect(c).toMatch(/on conflict \(id\) do nothing/);
    expect(c).not.toMatch(/\bupdate public\.|delete from/);
    expect(sinComentarios).toMatch(/revoke all on function public\.admin_registrar_cambios_precio\(text, text, jsonb\) from public/);
  });
});
