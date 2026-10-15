// Chequeos estáticos de supabase/migrations/012_lote_operacion_compras_stock.sql
// (REQ-INA, REQ-CPR, REQ-STB). No ejecutan SQL: verifican que las garantías escritas.
import fs from 'fs';
import path from 'path';

const sql = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'supabase', 'migrations', '012_lote_operacion_compras_stock.sql'), 'utf8');
const sc = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');

const cuerpo = (nombre) => {
  const i = sc.indexOf(`function public.${nombre}(`);
  if (i < 0) return '';
  return sc.slice(i, sc.indexOf('end $$;', i));
};

const TABLAS = ['ingresos_costos', 'cuenta_proveedores', 'pedidos_proveedor', 'comprobantes_habilitados'];

describe('migración 012 compras, cuenta con proveedores y stock mínimo', () => {
  it('AC-INA-1 es transaccional, idempotente y no destructiva', () => {
    expect(sql).toMatch(/^begin;/m);
    expect(sql).toMatch(/^commit;/m);
    expect(sc).not.toMatch(/drop (table|column|function|policy)/i);
    expect(sc).not.toMatch(/^\s*truncate/im);
    expect(sc).not.toMatch(/alter table[^;]*drop/i);
    // Único delete permitido: permisos de comprobantes ya vencidos.
    const deletes = sc.match(/delete from [a-z_.]+/gi) || [];
    deletes.forEach(d => expect(d).toBe('delete from public.comprobantes_habilitados'));
    expect(sc).toMatch(/Falta la migracion 011/);
    expect(sc).toMatch(/add column if not exists stock_minimo integer/);
    TABLAS.forEach(t => expect(sc).toMatch(new RegExp(`create table if not exists public\\.${t}`)));
  });

  it('AC-SEC-4 tablas nuevas: RLS activo, revoke total y sin policies ni grants', () => {
    TABLAS.forEach(t => {
      expect(sc).toMatch(new RegExp(`alter table public\\.${t} enable row level security`));
      expect(sc).toMatch(new RegExp(`revoke all on public\\.${t} from public, anon, authenticated`));
      expect(sc).not.toMatch(new RegExp(`create policy[^;]*on public\\.${t}`, 'i'));
      expect(sc).not.toMatch(new RegExp(`grant (select|insert|update|delete|all)[^;]*public\\.${t}`, 'i'));
    });
  });

  it('AC-INA-1 los costos NO van en ingresos_mercaderia (legible con anon)', () => {
    expect(sc).not.toMatch(/alter table public\.ingresos_mercaderia/i);
    expect(sc).not.toMatch(/create policy[^;]*ingresos_mercaderia/i);
  });

  it('AC-SEC-5 las 4 RPC exigen _es_admin_con_pin, son security definer y se exponen solo con execute', () => {
    ['admin_compras_guardar', 'admin_compras_bajar', 'admin_comprobante_subida', 'admin_comprobante_lectura'].forEach(f => {
      const c = cuerpo(f);
      expect(c).toMatch(/security definer set search_path = public, pg_temp/);
      expect(c).toMatch(/public\._es_admin_con_pin\(p_admin_id, p_admin_pin\)/);
      expect(c).toMatch(/'motivo', 'no_autorizado'/);
      expect(sc).toMatch(new RegExp(`revoke all on function public\\.${f}\\(`));
      expect(sc).toMatch(new RegExp(`grant execute on function public\\.${f}\\(`));
    });
    expect(sc).not.toMatch(/grant execute on function public\._es_admin_con_pin/);
  });

  it('AC-CPR-2 lote acotado, reloj topado, LWW y recibido no retrocede', () => {
    const c = cuerpo('admin_compras_guardar');
    expect(c).toMatch(/v_total > 500/);
    expect(c).toMatch(/now\(\) \+ interval '5 minutes'/);
    expect(c).toMatch(/where excluded\.updated_at >= public\.ingresos_costos\.updated_at/);
    expect(c).toMatch(/public\.pedidos_proveedor\.estado <> 'recibido'/);
    expect(c).toMatch(/ingreso_inexistente/);
    expect(c).toMatch(/costo_unitario/);
  });

  it('AC-CPR-5 cuenta_proveedores solo se anula (trigger de inmutabilidad)', () => {
    const c = cuerpo('tg_cuenta_prov_inmutable');
    expect(c).toMatch(/monto_centavos is distinct from old\.monto_centavos/);
    expect(c).toMatch(/raise exception/);
    expect(sc).toMatch(/create trigger cuenta_prov_inmutable before update on public\.cuenta_proveedores/);
    expect(sc).toMatch(/monto_centavos > 0/);
  });

  it('AC-CPR-2 bucket privado de 5 MB, sin update/delete y con permiso por nombre', () => {
    expect(sc).toMatch(/'comprobantes-proveedores', 'comprobantes-proveedores', false, 5242880/);
    expect(sc).toMatch(/set public = false/);
    expect(sc).toMatch(/application\/pdf/);
    expect(sc).toMatch(/create policy comprob_insert_habilitado on storage\.objects for insert/);
    expect(sc).toMatch(/create policy comprob_select_habilitado on storage\.objects for select/);
    expect(sc).not.toMatch(/on storage\.objects for (update|delete|all)/i);
    expect(sc).toMatch(/interval '10 minutes'/);
    expect(sc).toMatch(/interval '2 minutes'/);
  });

  it('AC-STB-1 admin_guardar_productos conserva stock_minimo si la clave no viene', () => {
    const c = cuerpo('admin_guardar_productos');
    expect(c).toMatch(/_es_admin_con_pin|verificar_pin/);
    expect(c).toMatch(/precio_bulto = excluded\.precio_bulto/);
    expect(c).toMatch(/v_smin >= 0|v_smin < 0/);
    expect(c).toMatch(/case when v_fila \? 'stock_minimo' then excluded\.stock_minimo else public\.productos\.stock_minimo end/);
    expect(sc).toMatch(/productos_stock_minimo_chk/);
  });
});
