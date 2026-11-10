// Estatico sobre la migracion 025 (no se aplica en ninguna base): AC-RED-1, AC-RED-2, AC-DMP-1.
import fs from 'fs';
import path from 'path';

const sql = fs.readFileSync(path.join(__dirname, '../../../supabase/migrations/025_remito_redondeo_medio_pago.sql'), 'utf8');

describe('migracion 025', () => {
  it('AC-RED-2 columnas de pedidos idempotentes, total no cambia', () => {
    for (const c of ['redondeo', 'redondeo_multiplo', 'total_redondeado']) expect(sql).toMatch(new RegExp(`add column if not exists ${c}\\b`));
    expect(sql).toMatch(/redondeo_multiplo in \(0, 500, 1000\)/);
    expect(sql).not.toMatch(/alter column total\b/i);
  });
  it('AC-DMP-1 columnas de deudas con checks de largo y formato', () => {
    for (const c of ['medio_pago', 'referencia_pago', 'cobros']) expect(sql).toMatch(new RegExp(`add column if not exists ${c}\\b`));
    expect(sql).toMatch(/char_length\(referencia_pago\) <= 60/);
    expect(sql).toMatch(/jsonb_array_length\(cobros\) <= 200/);
  });
  it('AC-RED-1 ajuste en tienda_config con default 500 y RPC de lectura publica', () => {
    expect(sql).toMatch(/add column if not exists redondeo_total integer not null default 500/);
    expect(sql).toMatch(/function public\.ajustes_app_leer\(\)/);
    expect(sql).toMatch(/grant execute on function public\.ajustes_app_leer\(\) to anon, authenticated/);
  });
  it('AC-RED-1 escritura solo con PIN de admin (verificar_pin) y search_path fijo', () => {
    expect(sql).toMatch(/function public\.admin_guardar_redondeo\(p_admin_id text, p_admin_pin text, p_multiplo integer\)/);
    expect(sql).toMatch(/public\.verificar_pin\(v_admin_id, p_admin_pin\)/);
    expect(sql).toMatch(/permiso = 1 and activo/);
    expect(sql).toMatch(/revoke all on function public\.admin_guardar_redondeo\(text, text, integer\) from public/);
    const fns = sql.match(/create or replace function[\s\S]*?\$\$;?/g) || [];
    expect(fns.length).toBe(2);
    for (const f of fns) expect(f).toMatch(/set search_path = /);
  });
  it('tolera tablas ausentes y no borra datos ni toca productos/comisiones', () => {
    for (const t of ['pedidos', 'deudas', 'tienda_config']) expect(sql).toMatch(new RegExp(`to_regclass\\('public\\.${t}'\\) is null`));
    expect(sql).not.toMatch(/drop table/i);
    expect(sql).not.toMatch(/\bdelete from\b/i);
    expect(sql.replace(/--.*$/gm, '')).not.toMatch(/on public\.productos|cerrar_comisiones|admin_facturas_a_emitir/);
  });
});

describe('migracion 025: SQL valido', () => {
  it('los delimitadores de dolar quedan pareados (un "$" suelto rompe la migracion)', () => {
    const sinNombrados = sql.replace(/\$[a-z_]+\$/g, '');
    const dobles = (sinNombrados.match(/\$\$/g) || []).length;
    expect(dobles % 2).toBe(0);
    expect(/\bas \$(?!\$|[a-z_]+\$)/.test(sql)).toBe(false);
    expect(/\bend \$;/.test(sql)).toBe(false);
    // $mig$ tambien en pares (abre y cierra cada DO).
    expect(((sql.match(/\$mig\$/g)) || []).length % 2).toBe(0);
  });
  it('begin/commit balanceados', () => {
    expect(sql.match(/^begin;$/gm)).toHaveLength(1);
    expect(sql.match(/^commit;$/gm)).toHaveLength(1);
  });
});
