// Auditoria run 20261015-1541, vuelta 2: migracion 013 (costos privados), synced_at, sin when others.
import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import { COLUMNAS_PRODUCTO_PUBLICAS } from '../domain/productos';

const ROOT = path.resolve(__dirname, '..', '..');
const leer = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const q = (s) => s.replace(/--[^\n]*/g, ' ');
const s013 = q(leer('supabase/migrations/013_productos_costos_privados.sql'));
const s012 = q(leer('supabase/migrations/012_lote_operacion_compras_stock.sql'));
const INTERNAS = ['costo_final', 'descuento1', 'descuento2', 'ganancia', 'precio_venta2'];

describe('SEC-013 productos: costos fuera de la anon key', () => {
  test('revoca select de tabla y excluye las 5 columnas internas del grant', () => {
    expect(s013).toMatch(/revoke select on public\.productos from anon, authenticated/);
    expect(s013).toMatch(/column_name not in \('costo_final', 'descuento1', 'descuento2', 'ganancia', 'precio_venta2'\)/);
    expect(s013).toMatch(/revoke select \(costo_final, descuento1, descuento2, ganancia, precio_venta2\) on public\.productos from anon, authenticated/);
    expect(s013).not.toMatch(/grant select on public\.productos/i);
  });
  test('RPC admin_productos_costos: security definer, search_path, PIN, tope 1000, grants', () => {
    expect(s013).toMatch(/admin_productos_costos[\s\S]*?security definer set search_path = public, pg_temp/);
    expect(s013).toMatch(/if not public\._es_admin_con_pin\(p_admin_id, p_admin_pin\)/);
    expect(s013).toMatch(/least\(greatest\(coalesce\(p_limite, 1000\), 1\), 1000\)/);
    expect(s013).toMatch(/revoke all on function public\.admin_productos_costos\(text, text, bigint, integer\) from public/);
  });
  test('la lista de columnas publicas del cliente no incluye costos', () => {
    INTERNAS.forEach(c => expect(COLUMNAS_PRODUCTO_PUBLICAS).not.toContain(c));
  });
  test('ningun select("*") sobre productos en el cliente', () => {
    const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory()
      ? (e.name === '__tests__' || e.name === 'node_modules' ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]);
    const malos = walk(path.join(ROOT, 'src')).filter(f => /\.js$/.test(f) && !/\.test\.js$/.test(f))
      .filter(f => /from\('productos'\)[\s\S]{0,40}\.select\((['"`])\*\1/.test(readFileSync(f, 'utf8')));
    expect(malos).toEqual([]);
    expect(leer('src/sync/syncService.js')).not.toMatch(/fetchAll\('productos'\s*\)/);
  });
});

describe('SEC-012 v2', () => {
  test('sin "when others" en la 012 (S-012-03)', () => {
    expect(s012).not.toMatch(/when others/i);
  });
  test('synced_at lo pone el servidor por trigger y la bajada pagina por (synced_at, id)', () => {
    expect(s012).toMatch(/new\.synced_at := clock_timestamp\(\)/);
    expect((s012.match(/before insert or update on public\.(ingresos_costos|cuenta_proveedores|pedidos_proveedor)/g) || []).length).toBe(3);
    expect((s012.match(/limit 1000/g) || []).length).toBe(3);
    expect(s012).toMatch(/revoke all on function public\.tg_compras_synced_at\(\) from public, anon, authenticated/);
  });
  test('admin_guardar_productos acota costos, descuentos y rechaza Infinity', () => {
    expect(s012).toMatch(/v_d1 < 0 or v_d1 > 100/);
    expect(s012).toMatch(/v_costo::text in \('NaN', 'Infinity', '-Infinity'\)/);
  });
});
