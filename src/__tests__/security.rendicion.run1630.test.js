// Auditoria RUN 20261015-1630 (REQ-REN, migracion 014). Chequeos estaticos sobre el SQL y el cliente.
import { readFileSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');
const leer = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');
const sql014 = leer('supabase', 'migrations', '014_lote_operacion_rendicion.sql');
const sql005 = leer('supabase', 'migrations', '005_comisiones_rubro.sql');
const sinComentarios = (s) => s.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
const sc = sinComentarios(sql014);

const cuerpoFn = (texto, nombre) => {
  const i = texto.indexOf(`function public.${nombre}(`);
  const ini = texto.indexOf('as $$', i) + 5;
  return texto.slice(ini, texto.indexOf('\nend $$;', ini));
};
const norm = (s) => s.split('\n').map(l => l.replace(/\s+$/, '')).filter(l => !l.trim().startsWith('--')).join('\n');

describe('SEC 20261015-1630 migracion 014', () => {
  test('cerrar_comisiones difiere de la 005 SOLO en el total del pedido (5a y 6a)', () => {
    const a = norm(cuerpoFn(sql005, 'cerrar_comisiones')).split('\n');
    const b = norm(cuerpoFn(sql014, 'cerrar_comisiones')).split('\n');
    expect(b.length).toBe(a.length);
    const difs = a.map((l, i) => [l, b[i]]).filter(([x, y]) => x !== y);
    expect(difs.length).toBe(2);
    difs.forEach(([x, y]) => {
      expect(x).toMatch(/greatest\(round\(coalesce\(p\.total, 0\)::numeric, 2\), 0\)/);
      expect(y).toMatch(/public\._pedido_total_comision\(p\.id::text\)/);
    });
  });

  test('toda funcion security definer fija search_path y toda RPC admin valida PIN', () => {
    const defs = [...sc.matchAll(/create or replace function public\.([a-z_0-9]+)\([^)]*\)\s*returns [^\n]+\s*language \w+ security definer set search_path = public, pg_temp/g)].map(m => m[1]);
    ['admin_rendiciones_guardar', 'admin_rendicion_anular', 'admin_rendicion_efecto', 'admin_cuenta_clientes_guardar', 'admin_rendiciones_bajar'].forEach(f => {
      expect(defs).toContain(f);
      expect(cuerpoFn(sql014, f)).toMatch(/_es_admin_con_pin\(p_admin_id, p_admin_pin\)/);
    });
    expect(sc).not.toMatch(/security definer(?! set search_path)/);
  });

  test('rendiciones y cuenta_clientes: RLS, sin policies ni grants a anon', () => {
    ['rendiciones', 'cuenta_clientes'].forEach(t => {
      expect(sc).toMatch(new RegExp(`alter table public\.${t} enable row level security`));
      expect(sc).toMatch(new RegExp(`revoke all on public\.${t} from public, anon, authenticated`));
    });
    expect(sc).not.toMatch(/create policy/i);
    expect(sc).not.toMatch(/grant (select|insert|update|delete|all)[^;]* on (table )?public\.(rendiciones|cuenta_clientes)/i);
  });

  test('anulacion de una sola vez: update condicionado a estado vigente y trigger sin anulada->vigente', () => {
    expect(cuerpoFn(sql014, 'admin_rendicion_anular')).toMatch(/where id = p_id and estado = 'vigente'/);
    expect(cuerpoFn(sql014, 'tg_rendicion_inmutable')).toMatch(/old\.estado = 'anulada' and \(new\.estado is distinct from old\.estado/);
    expect(cuerpoFn(sql014, 'tg_rendicion_inmutable')).toMatch(/rendiciones no se borran/);
  });

  test('alta idempotente (on conflict do nothing) y lotes acotados', () => {
    expect(cuerpoFn(sql014, 'admin_rendiciones_guardar')).toMatch(/on conflict \(id\) do nothing/);
    expect(cuerpoFn(sql014, 'admin_rendiciones_guardar')).toMatch(/> 200/);
    expect(cuerpoFn(sql014, 'admin_cuenta_clientes_guardar')).toMatch(/on conflict \(id\) do nothing/);
  });

  test('helpers y triggers sin execute para anon; RPC admin solo a anon/authenticated con firma exacta', () => {
    ['_pedido_total_comision(text)', 'comision_rubro_base(text)', 'tg_movimiento_rendicion_con_cabecera()'].forEach(f => {
      expect(sc).toContain(`revoke all on function public.${f} from public, anon, authenticated`);
    });
  });

  test('el CHECK relajado no abre signos arbitrarios fuera de rendicion', () => {
    const chk = sc.slice(sc.indexOf('add constraint movimientos_signo_chk'), sc.indexOf('add constraint movimientos_ref_chk'));
    expect(chk).toMatch(/tipo = 'venta' and cantidad < 0/);
    expect(chk).toMatch(/tipo = 'anulacion' and \(cantidad > 0 or ref ~ '\^rendicion:'\)/);
    expect(chk).toMatch(/tipo = 'devolucion' and cantidad > 0/);
  });
});

describe('SEC 20261015-1630 cliente', () => {
  test('el servicio no guarda ni loguea el PIN', () => {
    const svc = leer('src', 'services', 'rendicionService.js');
    expect(svc).not.toMatch(/console\.\w+\([^)]*(pin|cred)/i);
    expect(svc).not.toMatch(/localStorage\.setItem\([^)]*(pin|cred)/i);
  });
  test('pantalla Rendicion solo admin y sin dangerouslySetInnerHTML; App la gatea con isAdmin', () => {
    expect(leer('src', 'pages', 'Rendicion.js')).not.toMatch(/dangerouslySetInnerHTML/);
    expect(leer('src', 'App.js')).toMatch(/tab === 'rendicion' && isAdmin/);
  });
  test('syncStock retiene movimientos rendicion:* sin rendicion confirmada', () => {
    const { retenerMovimientoRendicion } = require('../services/stockService');
    expect(retenerMovimientoRendicion({ ref: 'rendicion:abc' }, new Map())).toBe(true);
    expect(retenerMovimientoRendicion({ ref: 'rendicion:abc' }, new Map([['abc', { syncEstado: 'pendiente' }]]))).toBe(true);
    expect(retenerMovimientoRendicion({ ref: 'rendicion:abc' }, new Map([['abc', { syncEstado: 'confirmada' }]]))).toBe(false);
  });
});

describe('SEC 20261015-1630 vuelta 2 (S-REN-01..06)', () => {
  const trg = cuerpoFn(sql014, 'tg_movimiento_rendicion_con_cabecera');
  const guardar = cuerpoFn(sql014, 'admin_rendiciones_guardar');
  const cuenta = cuerpoFn(sql014, 'admin_cuenta_clientes_guardar');

  test('S-REN-01 tg_movimiento_rendicion_con_cabecera es security definer con search_path fijo y sin execute para anon', () => {
    expect(sc).toMatch(/function public\.tg_movimiento_rendicion_con_cabecera\(\) returns trigger\s+language plpgsql security definer set search_path = public, pg_temp as \$\$/);
    expect(sc).toContain('revoke all on function public.tg_movimiento_rendicion_con_cabecera() from public, anon, authenticated');
    expect(sc).not.toMatch(/grant execute on function public\.tg_movimiento_rendicion_con_cabecera/);
  });

  test('S-REN-02 el trigger valida id, producto, tipo, signo y cantidad contra el renglon de la rendicion', () => {
    expect(trg).toMatch(/regexp_match\(coalesce\(new\.id, ''\), '\^\(\[0-9a-f-\]\{36\}\):\(\[0-9\]\{1,3\}\):\(\[ax\]\)\$'\)/);
    expect(trg).toMatch(/'rendicion:' \|\| v_partes\[1\] <> new\.ref/);
    expect(trg).toMatch(/v_renglones -> \(v_partes\[2\]::integer\)/);
    expect(trg).toMatch(/v_ren->>'productoId' is distinct from new\.producto_id/);
    expect(trg).toMatch(/vuelveAlStock', 'true'\) <> 'false'/);
    expect(trg).toMatch(/v_tipo_esp := 'devolucion';\s+v_cant_esp := v_cant;/);
    expect(trg).toMatch(/v_tipo_esp := 'venta';\s+v_cant_esp := -v_cant;/);
    expect(trg).toMatch(/v_partes\[3\] = 'x'[\s\S]*v_estado <> 'anulada'[\s\S]*v_tipo_esp := 'anulacion';\s+v_cant_esp := -v_cant_esp;/);
    expect(trg).toMatch(/new\.tipo <> v_tipo_esp or new\.cantidad <> v_cant_esp/);
    expect(sc).toMatch(/create trigger movimiento_rendicion_con_cabecera before insert or update on public\.movimientos_stock/);
  });

  test('S-REN-02 los ids que arma el dominio coinciden con el formato que exige el trigger', () => {
    const { movimientosRendicion, movimientosAnulacionRendicion } = require('../domain/rendicion');
    const r = { id: '11111111-2222-4333-8444-555555555555', usuario: 'A', createdAt: '2026-10-15T00:00:00Z', renglones: [
      { productoId: '1', cantidad: 2, sentido: 'entra', vuelveAlStock: false },
      { productoId: '2', cantidad: 3, sentido: 'entra' },
      { productoId: '3', cantidad: 1, sentido: 'sale' },
    ] };
    const re = /^([0-9a-f-]{36}):([0-9]{1,3}):([ax])$/;
    const alta = movimientosRendicion(r);
    expect(alta.map(m => [m.id, m.tipo, m.cantidad])).toEqual([[`${r.id}:1:a`, 'devolucion', 3], [`${r.id}:2:a`, 'venta', -1]]);
    alta.forEach(m => {
      const [, uuid, idx] = m.id.match(re);
      expect(`rendicion:${uuid}`).toBe(m.ref);
      expect(r.renglones[Number(idx)].productoId).toBe(m.productoId);
    });
    movimientosAnulacionRendicion(r).forEach(m => expect(m.id).toMatch(re));
  });

  test('S-REN-03 admin_rendicion_efecto (alta) exige estado vigente', () => {
    expect(cuerpoFn(sql014, 'admin_rendicion_efecto')).toMatch(/set efecto = p_efecto\s+where id = p_id and efecto is null and estado = 'vigente'/);
  });

  test('S-REN-04 el servidor recalcula el credito desde los renglones, topa por precio facturado y por total del pedido', () => {
    expect(guardar).toMatch(/v_tipo = 'devolucion' and v_cred::numeric <> v_suma_e/);
    expect(guardar).toMatch(/v_tipo = 'cambio' and v_cred::numeric <> v_suma_e - v_suma_s/);
    expect(guardar).toMatch(/or v_cred_com <> v_cred then/);
    expect(guardar).toMatch(/'credito_inconsistente'/);
    expect(guardar).toMatch(/if v_prod\.pmax > coalesce\(v_pmin, 0\) then/);
    expect(guardar).toMatch(/if greatest\(v_cred, 0\) > round\(coalesce\(v_total, 0\)::numeric \* 100\) - v_previo then/);
    expect(guardar).not.toMatch(/if v_tipo = 'nc' then\s+select coalesce\(sum\(greatest/);
  });

  test('S-REN-06 admin_cuenta_clientes_guardar exige rendicion del cliente en creditos y controla el saldo en uso_saldo', () => {
    expect(cuenta).toMatch(/pg_advisory_xact_lock\(hashtext\('cuenta_clientes:' \|\| v_cli\)\)/);
    expect(cuenta).toMatch(/r\.id = nullif\(v_fila->>'rendicion_id', ''\)::uuid and r\.cliente_id = v_cli/);
    expect(cuenta).toMatch(/v_cred is null or abs\(v_monto\) > v_cred/);
    expect(cuenta).toMatch(/v_monto >= 0 or -v_monto > v_saldo/);
    expect(cuenta).toMatch(/'saldo_insuficiente'/);
    expect(cuenta).toMatch(/'sin_rendicion'/);
  });
});
