// Chequeos estáticos de supabase/migrations/014_lote_operacion_rendicion.sql (REQ-REN).
// No ejecutan SQL: verifican las garantías escritas (RLS cerrada, PIN en todas las RPC,
// CHECK NOT VALID, cerrar_comisiones = copia de la 005 salvo el total neto).
import fs from 'fs';
import path from 'path';

const dir = path.join(__dirname, '..', '..', '..', 'supabase', 'migrations');
const sql = fs.readFileSync(path.join(dir, '014_lote_operacion_rendicion.sql'), 'utf8');
const sc = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
const sql005 = fs.readFileSync(path.join(dir, '005_comisiones_rubro.sql'), 'utf8');

const cuerpo = (texto, nombre) => {
  const i = texto.indexOf(`function public.${nombre}(`);
  if (i < 0) return '';
  return texto.slice(i, texto.indexOf('$$;', texto.indexOf('as $$', i) + 5) + 3);
};

const TABLAS = ['rendiciones', 'cuenta_clientes'];
const RPCS = [
  ['admin_rendiciones_guardar', 'text, text, jsonb'],
  ['admin_rendicion_anular', 'text, text, uuid, text'],
  ['admin_rendicion_efecto', 'text, text, uuid, jsonb'],
  ['admin_cuenta_clientes_guardar', 'text, text, jsonb'],
  ['admin_rendiciones_bajar', 'text, text, jsonb'],
];

describe('migración 014 rendición (REQ-REN)', () => {
  it('AC-REN-1 transaccional, idempotente, con prerrequisitos y sin borrar datos', () => {
    expect(sql).toMatch(/^begin;/m);
    expect(sql).toMatch(/^commit;/m);
    expect(sc).not.toMatch(/drop (table|column|function|policy)/i);
    expect(sc).not.toMatch(/^\s*truncate/im);
    expect(sc).not.toMatch(/delete from/i);
    expect(sc).toMatch(/Falta la migracion 011/);
    expect(sc).toMatch(/Falta la migracion 012/);
    expect(sc).toMatch(/Falta la migracion 005/);
    TABLAS.forEach(t => expect(sc).toMatch(new RegExp(`create table if not exists public\\.${t} `)));
  });

  it('AC-REN-1 D1: tablas con RLS activo, revoke total y sin policies ni grants', () => {
    TABLAS.forEach(t => {
      expect(sc).toMatch(new RegExp(`alter table public\\.${t} enable row level security`));
      expect(sc).toMatch(new RegExp(`revoke all on public\\.${t} from public, anon, authenticated`));
      expect(sc).not.toMatch(new RegExp(`create policy[^;]*on public\\.${t}`, 'i'));
      expect(sc).not.toMatch(new RegExp(`grant (select|insert|update|delete|all)[^;]*public\\.${t}`, 'i'));
    });
  });

  it('AC-REN-1 todas las RPC son security definer, piden PIN de admin y tienen grants exactos', () => {
    RPCS.forEach(([fn, firma]) => {
      const c = cuerpo(sc, fn);
      expect(c).toMatch(/security definer set search_path = public, pg_temp/);
      expect(c).toMatch(/if not public\._es_admin_con_pin\(p_admin_id, p_admin_pin\) then\s+return jsonb_build_object\('ok', false, 'motivo', 'no_autorizado'\)/);
      expect(sc).toContain(`revoke all on function public.${fn}(${firma}) from public;`);
      expect(sc).toContain(`grant execute on function public.${fn}(${firma}) to anon, authenticated;`);
    });
    ['_pedido_total_comision(text)', 'comision_rubro_base(text)', 'tg_rendicion_inmutable()', 'tg_cuenta_clientes_inmutable()', 'tg_movimiento_rendicion_con_cabecera()']
      .forEach(h => expect(sc).toContain(`revoke all on function public.${h} from public, anon, authenticated;`));
  });

  it('AC-REN-4 rendición inmutable: solo vigente -> anulada, efecto una vez, sin delete', () => {
    const t = cuerpo(sc, 'tg_rendicion_inmutable');
    expect(t).toMatch(/tg_op = 'DELETE'/);
    expect(t).toMatch(/la rendicion ya esta anulada/);
    expect(t).toMatch(/el efecto de la rendicion ya esta registrado/);
    expect(sc).toMatch(/create trigger rendicion_inmutable before update or delete on public\.rendiciones/);
    expect(sc).toMatch(/create trigger cuenta_clientes_inmutable before update or delete on public\.cuenta_clientes/);
    const anular = cuerpo(sc, 'admin_rendicion_anular');
    expect(anular).toMatch(/where id = p_id and estado = 'vigente'/);
    expect(anular).toMatch(/'ya_anulada', true/);
    const efecto = cuerpo(sc, 'admin_rendicion_efecto');
    expect(efecto).toMatch(/efecto is null/);
    expect(efecto).toMatch(/efecto_anulacion is null/);
  });

  it('AC-REN-2 ledger: CHECK reemplazados NOT VALID con devolucion y ref rendicion, y cabecera obligatoria', () => {
    expect(sc).toMatch(/drop constraint if exists movimientos_stock_tipo_check;\s*alter table public\.movimientos_stock add constraint movimientos_stock_tipo_check\s+check \(tipo in \('inicial','ajuste','ingreso','venta','anulacion','devolucion'\)\) not valid;/);
    expect(sc).toMatch(/drop constraint if exists movimientos_signo_chk;/);
    expect(sc).toMatch(/\(tipo = 'devolucion' and cantidad > 0\)/);
    expect(sc).toMatch(/\(tipo = 'anulacion' and \(cantidad > 0 or ref ~ '\^rendicion:'\)\)/);
    expect(sc).toMatch(/drop constraint if exists movimientos_ref_chk;/);
    expect(sc).toMatch(/\^\(pedido\|pedido-local\|ingreso\|ajuste\|rendicion\):/);
    const adds = sc.match(/add constraint movimientos_[a-z_]+[\s\S]*?;/g) || [];
    expect(adds).toHaveLength(3);
    adds.forEach(a => expect(a).toMatch(/not valid;$/));
    const trg = cuerpo(sc, 'tg_movimiento_rendicion_con_cabecera');
    expect(trg).toMatch(/movimiento de devolucion sin rendicion/);
    expect(trg).toMatch(/movimiento de rendicion sin cabecera/);
    expect(trg).toMatch(/anulacion de una rendicion vigente/);
  });

  it('AC-REN-2 alta idempotente: reintento confirma sin duplicar y valida cantidades contra el pedido', () => {
    const g = cuerpo(sc, 'admin_rendiciones_guardar');
    expect(g).toMatch(/on conflict \(id\) do nothing/);
    expect(g).toMatch(/if exists \(select 1 from public\.rendiciones where id = v_uuid\)/);
    expect(g).toMatch(/pg_advisory_xact_lock\(hashtext\('rendicion:' \|\| v_pid\)\)/);
    expect(g).toMatch(/cantidad_excedida/);
    expect(g).toMatch(/v_suma_com <> -v_cred_com/);
    expect(g).toMatch(/monto_excedido/);
    expect(cuerpo(sc, 'admin_cuenta_clientes_guardar')).toMatch(/on conflict \(id\) do nothing/);
  });

  it('AC-REN-5 comisiones: base y total descuentan rendiciones vigentes', () => {
    const base = cuerpo(sc, 'comision_rubro_base');
    expect(base).toMatch(/from public\.rendiciones rd/);
    expect(base).toMatch(/rd\.estado = 'vigente'/);
    expect(base).toMatch(/union all/);
    const tot = cuerpo(sc, '_pedido_total_comision');
    expect(tot).toMatch(/sum\(r\.credito_comision_cents\)/);
    expect(tot).toMatch(/r\.estado = 'vigente'/);
  });

  it('AC-REN-5 S8: cerrar_comisiones es la copia textual de la 005 salvo el total de 5a y 6a', () => {
    const c05 = cuerpo(sql005, 'cerrar_comisiones');
    const c14 = cuerpo(sql, 'cerrar_comisiones');
    expect(c05.length).toBeGreaterThan(1000);
    const viejo = 'greatest(round(coalesce(p.total, 0)::numeric, 2), 0)';
    const nuevo = 'public._pedido_total_comision(p.id::text)';
    expect(c05.split(viejo)).toHaveLength(3);
    expect(c14).not.toContain(viejo);
    expect(c14.split(nuevo)).toHaveLength(3);
    expect(c14).toBe(c05.split(viejo).join(nuevo));
  });
});
