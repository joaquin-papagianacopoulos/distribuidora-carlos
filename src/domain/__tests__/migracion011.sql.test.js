// Chequeos estáticos de supabase/migrations/011_lote_operacion_facturacion_zonas.sql
// (REQ-FAB, REQ-AGR, REQ-ZON). No ejecutan SQL: verifican que las garantías de
// seguridad e idempotencia estén escritas.
import fs from 'fs';
import path from 'path';

const sql = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'supabase', 'migrations', '011_lote_operacion_facturacion_zonas.sql'), 'utf8');
const sinComentarios = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');

const cuerpo = (nombre) => {
  const i = sinComentarios.indexOf(`function public.${nombre}(`);
  if (i < 0) return '';
  const j = sinComentarios.indexOf('end $$;', i);
  return sinComentarios.slice(i, j);
};

describe('migración 011 facturación A/B, grupos y zonas', () => {
  it('AC-FAB-1 es idempotente, transaccional y no destructiva', () => {
    expect(sql).toMatch(/^begin;/m);
    expect(sql).toMatch(/^commit;/m);
    expect(sinComentarios).not.toMatch(/drop (table|column|function|policy)/i);
    expect(sinComentarios).not.toMatch(/^\s*truncate/im);
    expect(sinComentarios).not.toMatch(/delete from/i);
    expect(sinComentarios).toMatch(/add column if not exists grupos jsonb/);
    expect(sinComentarios).toMatch(/add column if not exists orden_zona integer/);
    expect(sinComentarios).toMatch(/to_regclass\('public\.pedidos_factura'\) is null/);
    expect((sinComentarios.match(/create or replace function/g) || []).length).toBe(3);
  });

  it('AC-FAB-1 exige verificar_pin (002) y la 010', () => {
    expect(sql).toMatch(/Falta public\.verificar_pin/);
    expect(sql).toMatch(/Falta la migracion 010_lote_operacion_precios\.sql/);
  });

  it('AC-FAB-1 el tipo de factura NO va en pedidos: tabla aparte con RLS y sin grants para anon', () => {
    expect(sinComentarios).not.toMatch(/alter table public\.pedidos add column[^;]*tipo_factura/);
    expect(sinComentarios).toMatch(/alter table public\.pedidos_factura enable row level security/);
    expect(sinComentarios).toMatch(/revoke all on public\.pedidos_factura from public, anon, authenticated/);
    expect(sinComentarios).not.toMatch(/grant (select|insert|update|delete|all)[^;]*pedidos_factura/i);
    expect(sinComentarios).not.toMatch(/create policy[^;]*pedidos_factura/i);
    expect(sinComentarios).toMatch(/check \(tipo_factura in \(''A'',''B'',''ninguna''\)\)/);
  });

  it('AC-FAB-1 admin_guardar_tipos_factura: PIN de admin, lote acotado, LWW y sin retroceso', () => {
    const c = cuerpo('admin_guardar_tipos_factura');
    expect(c).toMatch(/security definer set search_path = public, pg_temp/);
    expect(c).toMatch(/public\._es_admin_con_pin\(p_admin_id, p_admin_pin\)/);
    expect(c).toMatch(/'motivo', 'no_autorizado'/);
    expect(c).toMatch(/jsonb_array_length\(p_filas\) > 500/);
    expect(c).toMatch(/on conflict \(pedido_id\) do update/);
    expect(c).toMatch(/where excluded\.updated_at >= public\.pedidos_factura\.updated_at/);
    expect(c).toMatch(/v_tipo not in \('A','B','ninguna'\)/);
  });

  it('AC-FAB-3 admin_facturas_a_emitir: PIN de admin, rango máximo y solo facturados', () => {
    const c = cuerpo('admin_facturas_a_emitir');
    expect(c).toMatch(/security definer set search_path = public, pg_temp/);
    expect(c).toMatch(/public\._es_admin_con_pin\(p_admin_id, p_admin_pin\)/);
    expect(c).toMatch(/p_hasta - p_desde > 366/);
    expect(c).toMatch(/lower\(coalesce\(p\.estado, ''\)\) = 'facturado'/);
    expect(c).not.toMatch(/pin_hash|costo|ganancia/);
  });

  it('AC-FAB-1 el helper de admin verifica rol, activo y PIN, y no tiene grant', () => {
    const c = cuerpo('_es_admin_con_pin');
    expect(c).toMatch(/permiso = 1 and activo and pin_hash is not null/);
    expect(c).toMatch(/public\.verificar_pin\(v_id, p_admin_pin\)/);
    expect(sinComentarios).toMatch(/revoke all on function public\._es_admin_con_pin\(text, text\) from public, anon, authenticated/);
    expect(sinComentarios).not.toMatch(/grant execute on function public\._es_admin_con_pin/);
  });

  it('AC-FAB-3 las RPC se exponen solo con execute (el PIN es la barrera)', () => {
    expect(sinComentarios).toMatch(/revoke all on function public\.admin_guardar_tipos_factura\(text, text, jsonb\) from public/);
    expect(sinComentarios).toMatch(/grant execute on function public\.admin_guardar_tipos_factura\(text, text, jsonb\) to anon, authenticated/);
    expect(sinComentarios).toMatch(/revoke all on function public\.admin_facturas_a_emitir\(text, text, date, date\) from public/);
    expect(sinComentarios).toMatch(/grant execute on function public\.admin_facturas_a_emitir\(text, text, date, date\) to anon, authenticated/);
  });

  it('AC-ZON-3 inicializa orden_zona una sola vez con día y luego orden, sin tocar dia/orden de entrega', () => {
    expect(sinComentarios).toMatch(/if not exists \(select 1 from public\.clientes where orden_zona is not null\)/);
    expect(sinComentarios).toMatch(/row_number\(\) over \(/);
    expect(sinComentarios).toMatch(/array\['lunes','martes','miercoles','jueves','viernes','sabado','domingo'\]/);
    expect(sinComentarios).toMatch(/coalesce\(orden_entrega, 2147483647\)/);
    expect(sinComentarios).not.toMatch(/set\s+(dia_entrega|orden_entrega)\s*=/i);
    expect(sinComentarios).toMatch(/check \(orden_zona is null or orden_zona > 0\)/);
  });
});

describe('migración 011 vuelta 2', () => {
  it('AC-ZON-3 la inicializacion de orden_zona normaliza dia_entrega (btrim + tildes sin unaccent)', () => {
    expect(sinComentarios).toMatch(/translate\(lower\(btrim\(coalesce\(dia_entrega, ''\)\)\), 'áéíóú', 'aeiou'\)/);
    expect(sinComentarios).not.toMatch(/unaccent/i);
  });
  it('S-011-04 topa el updated_at del cliente a now() + 5 minutos', () => {
    expect(cuerpo('admin_guardar_tipos_factura')).toMatch(/least\([\s\S]*now\(\) \+ interval '5 minutes'\)/);
  });
  it('S-011-05 constraint idempotente de tamano de pedidos.grupos', () => {
    expect(sinComentarios).toMatch(/conname = 'pedidos_grupos_size_chk'/);
    expect(sinComentarios).toMatch(/pg_column_size\(grupos\) < 65536\) not valid/);
  });
});
