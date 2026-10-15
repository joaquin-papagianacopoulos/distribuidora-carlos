// Chequeos estaticos de las correcciones de seguridad de la vuelta 2 (run 20261015-1541):
// 013 (S-012-01) y 012 (S-012-02, S-012-03, S-012-06). No ejecutan SQL.
import fs from 'fs';
import path from 'path';

const leer = (f) => fs.readFileSync(path.join(__dirname, '..', '..', '..', 'supabase', 'migrations', f), 'utf8');
const sinComentarios = (sql) => sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
const s13 = sinComentarios(leer('013_productos_costos_privados.sql'));
const s12 = sinComentarios(leer('012_lote_operacion_compras_stock.sql'));
const cuerpo = (sc, nombre) => {
  const i = sc.indexOf(`function public.${nombre}(`);
  if (i < 0) return '';
  return sc.slice(i, sc.indexOf('end $$;', i));
};
const INTERNAS = ['costo_final', 'descuento1', 'descuento2', 'ganancia', 'precio_venta2'];

describe('S-012-01 migracion 013: costos de productos fuera del alcance de la anon key', () => {
  it('S-012-01 transaccional, idempotente y no destructiva', () => {
    expect(s13).toMatch(/^begin;/m);
    expect(s13).toMatch(/^commit;/m);
    expect(s13).not.toMatch(/drop (table|column|function|policy)/i);
    expect(s13).not.toMatch(/\bdelete from\b|\bupdate public\.|\btruncate\b|alter table[^;]*drop/i);
    expect(s13).toMatch(/Falta la migracion 012/);
  });

  it('S-012-01 revoca el select de tabla y otorga select solo por columnas publicas', () => {
    expect(s13).toMatch(/revoke select on public\.productos from anon, authenticated;/);
    expect(s13).not.toMatch(/grant select on public\.productos/i);
    expect(s13).toMatch(/grant select \(%s\) on public\.productos to anon, authenticated/);
    expect(s13).toMatch(new RegExp(`column_name not in \\(${INTERNAS.map(c => `'${c}'`).join(', ')}\\)`));
    expect(s13).toMatch(new RegExp(`revoke select \\(${INTERNAS.join(', ')}\\) on public\\.productos from anon, authenticated`));
    // El select de tabla se revoca ANTES de otorgar por columna (revocar la tabla revoca las columnas).
    expect(s13.indexOf('revoke select on public.productos')).toBeLessThan(s13.indexOf('grant select (%s)'));
  });

  it('S-012-01 admin_productos_costos: PIN de admin, search_path fijo, paginada y solo execute', () => {
    const c = cuerpo(s13, 'admin_productos_costos');
    expect(c).toMatch(/security definer set search_path = public, pg_temp/);
    expect(c).toMatch(/public\._es_admin_con_pin\(p_admin_id, p_admin_pin\)/);
    expect(c).toMatch(/'motivo', 'no_autorizado'/);
    expect(c).toMatch(/where id > v_desde/);
    expect(c).toMatch(/order by id/);
    expect(c).toMatch(/limit v_limite/);
    expect(c).toMatch(/least\(greatest\(coalesce\(p_limite, 1000\), 1\), 1000\)/);
    expect(s13).toMatch(/revoke all on function public\.admin_productos_costos\(text, text, bigint, integer\) from public;/);
    expect(s13).toMatch(/grant execute on function public\.admin_productos_costos\(text, text, bigint, integer\) to anon, authenticated;/);
  });

  it('S-012-01 admin_guardar_productos conserva los costos si la clave no viene', () => {
    const c = cuerpo(s12, 'admin_guardar_productos');
    INTERNAS.forEach(col => {
      expect(c).toMatch(new RegExp(`${col}\\s*= case when v_fila \\? '${col}' then excluded\\.${col} else public\\.productos\\.${col} end`));
    });
  });
});

describe('S-012-02 cursor de bajada por synced_at del servidor', () => {
  it('S-012-02 synced_at en las 3 tablas, puesto por trigger con clock_timestamp e indexado con el id', () => {
    ['ingresos_costos', 'cuenta_proveedores', 'pedidos_proveedor'].forEach(t => {
      expect(s12).toMatch(new RegExp(`alter table public\\.${t}\\s+add column if not exists synced_at timestamptz not null default now\\(\\)`));
      expect(s12).toMatch(new RegExp(`before insert or update on public\\.${t}\\s+for each row execute function public\\.tg_compras_synced_at\\(\\)`));
    });
    expect(cuerpo(s12, 'tg_compras_synced_at')).toMatch(/new\.synced_at := clock_timestamp\(\)/);
    expect(s12).toMatch(/on public\.ingresos_costos \(synced_at, ingreso_id\)/);
    expect(s12).toMatch(/on public\.cuenta_proveedores \(synced_at, id\)/);
    expect(s12).toMatch(/on public\.pedidos_proveedor \(synced_at, id\)/);
  });

  it('S-012-02 admin_compras_bajar pagina por (synced_at, id), nunca por updated_at', () => {
    const c = cuerpo(s12, 'admin_compras_bajar');
    expect(c).toMatch(/p_cursor jsonb/);
    expect(c).toMatch(/where \(synced_at, ingreso_id\) > \(v_ts_c, v_id_c\)/);
    expect(c).toMatch(/where \(synced_at, id::text\) > \(v_ts_m, v_id_m\)/);
    expect(c).toMatch(/where \(synced_at, id::text\) > \(v_ts_p, v_id_p\)/);
    expect(c).not.toMatch(/where updated_at >/);
    expect(c).toMatch(/limit 1000/);
    expect(s12).toMatch(/grant execute on function public\.admin_compras_bajar\(text, text, jsonb\)/);
    expect(s12).not.toMatch(/admin_compras_bajar\(text, text, timestamptz\)/);
  });
});

describe('S-012-03 admin_compras_guardar no esconde errores reales', () => {
  it('S-012-03 sin "when others": solo errores de dato esperados', () => {
    const c = cuerpo(s12, 'admin_compras_guardar');
    expect(c).not.toMatch(/when others/i);
    expect(s12).not.toMatch(/when others/i);
    const capturas = c.match(/when check_violation[\s\S]*?then/g) || [];
    expect(capturas).toHaveLength(3);
    capturas.forEach(x => {
      expect(x).toMatch(/invalid_text_representation/);
      expect(x).toMatch(/invalid_parameter_value/);
      expect(x).toMatch(/raise_exception/);
      expect(x).not.toMatch(/query_canceled|insufficient_privilege|undefined_function/);
    });
  });
});

describe('S-012-06 admin_guardar_productos acota costos, descuentos, ganancia y precio', () => {
  it('S-012-06 rechaza NaN/Infinity/-Infinity y aplica los topes del dominio', () => {
    const c = cuerpo(s12, 'admin_guardar_productos');
    ['v_precio', 'v_pbulto', 'v_costo', 'v_d1', 'v_d2', 'v_gan', 'v_pv2'].forEach(v => {
      expect(c).toMatch(new RegExp(`${v}::text in \\('NaN', 'Infinity', '-Infinity'\\)`));
    });
    expect(c).toMatch(/v_precio < 0 or v_precio > 999999999999/);
    expect(c).toMatch(/v_costo < 0 or v_costo > 999999999999/);
    expect(c).toMatch(/v_pv2 < 0 or v_pv2 > 999999999999/);
    expect(c).toMatch(/v_d1 < 0 or v_d1 > 100/);
    expect(c).toMatch(/v_d2 < 0 or v_d2 > 100/);
    expect(c).toMatch(/v_gan < 0 or v_gan > 1000/);
  });

  it('S-012-06 los topes coinciden con MAX_IMPORTE del dominio', () => {
    // eslint-disable-next-line global-require
    const { MAX_IMPORTE } = require('../productos');
    expect(MAX_IMPORTE).toBe(999999999999);
  });
});
