// Estatico sobre la migracion 024 (no se aplica en ninguna base): AC-EDP-2/3, AC-ASV-1, AC-PEN-1, AC-MUL-2.
import fs from 'fs';
import path from 'path';

const sql = fs.readFileSync(path.join(__dirname, '../../../supabase/migrations/024_pedidos_edicion_vendedor.sql'), 'utf8');

describe('migracion 024', () => {
  it('AC-ASV-1 / AC-EDP-2 columnas nuevas idempotentes con checks', () => {
    for (const c of ['cargado_por', 'vendedor_id', 'modificado_tras_armado']) expect(sql).toMatch(new RegExp(`add column if not exists ${c}`));
    expect(sql).toMatch(/pg_column_size\(modificado_tras_armado\) <= 16384/);
  });
  it('AC-EDP-3 trigger de updated_at del servidor y AC-PEN-1 indice parcial', () => {
    expect(sql).toMatch(/drop trigger if exists set_updated_at on public\.pedidos/);
    expect(sql).toMatch(/create index if not exists pedidos_no_facturados_idx/);
  });
  it('AC-MUL-2 helper y uso en tienda_crear_pedido con mismos grants', () => {
    expect(sql).toMatch(/function public\.tienda_cantidad_valida/);
    expect(sql).toMatch(/not public\.tienda_cantidad_valida\(v_u, v_prod\.minimo_venta, v_vp, v_bx\)/);
    expect(sql).toMatch(/revoke all on function public\.tienda_crear_pedido\(jsonb\) from public/);
    expect(sql).toMatch(/grant execute on function public\.tienda_crear_pedido\(jsonb\) to anon, authenticated/);
  });
  it('no borra datos ni revoca permisos existentes', () => {
    expect(sql).not.toMatch(/\bdelete from public\.(pedidos|clientes|productos)\b/i);
    expect(sql).not.toMatch(/drop table/i);
  });
});

describe('AC-EDP-3 migracion 024: SQL valido', () => {
  it('AC-EDP-3 los delimitadores de dolar quedan pareados (un "$" suelto rompe la migracion)', () => {
    // Saca los delimitadores con nombre ($mig$, $fn$) y cuenta los "$$": tiene que ser par.
    const sinNombrados = sql.replace(/\$[a-z_]+\$/g, '');
    const dobles = (sinNombrados.match(/\$\$/g) || []).length;
    expect(dobles % 2).toBe(0);
    // Ningun "$" suelto: ni "as $" ni "end $;" con un solo dolar.
    expect(/\bas \$(?!\$|[a-z_]+\$)/.test(sql)).toBe(false);
    expect(/\bend \$;/.test(sql)).toBe(false);
  });
});
