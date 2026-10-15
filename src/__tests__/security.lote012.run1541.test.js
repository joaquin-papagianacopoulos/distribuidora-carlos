// Auditoria run 20261015-1541 (REQ-INA, REQ-CPR, REQ-STB): migracion 012, frontera de costos, whitelist de ingresos.
import { readFileSync } from 'fs';
import path from 'path';
import { ingresoToRemote, umbralStock } from '../domain/stock';

const ROOT = path.resolve(__dirname, '..', '..');
const leer = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const sql = leer('supabase/migrations/012_lote_operacion_compras_stock.sql').replace(/--[^\n]*/g, ' ');
const sql010 = leer('supabase/migrations/010_lote_operacion_precios.sql').replace(/--[^\n]*/g, ' ');

const TABLAS = ['ingresos_costos', 'cuenta_proveedores', 'pedidos_proveedor', 'comprobantes_habilitados'];

describe('SEC-012 tablas nuevas cerradas a anon', () => {
  test.each(TABLAS)('%s: RLS on, revoke all, sin grant ni policy', (t) => {
    expect(sql).toMatch(new RegExp(`alter table public\\.${t} enable row level security`));
    expect(sql).toMatch(new RegExp(`revoke all on public\\.${t} from public, anon, authenticated`));
    expect(sql).not.toMatch(new RegExp(`grant [a-z, ()_]+ on (table )?public\\.${t}`, 'i'));
    expect(sql).not.toMatch(new RegExp(`create policy \\w+ on public\\.${t}`, 'i'));
  });
  test('ingresos_costos y cuenta no viajan por vistas ni por ingresos_mercaderia', () => {
    expect(sql).not.toMatch(/alter table public\.ingresos_mercaderia/i);
    expect(sql).not.toMatch(/create (or replace )?view/i);
  });
});

describe('SEC-012 RPC', () => {
  const defs = sql.match(/create or replace function[\s\S]*?\$\$/g) || [];
  test('toda security definer fija search_path', () => {
    const sd = defs.filter(d => /security definer/i.test(d));
    expect(sd.length).toBeGreaterThanOrEqual(6);
    sd.forEach(d => expect(d).toMatch(/security definer set search_path = public, pg_temp/));
  });
  test('las 4 RPC de compras exigen PIN de admin y el helper no se concede', () => {
    expect((sql.match(/if not public\._es_admin_con_pin\(p_admin_id, p_admin_pin\)/g) || []).length).toBe(4);
    expect(sql).not.toMatch(/grant execute on function public\._es_admin_con_pin/);
    expect(sql).toMatch(/revoke all on function public\.tg_cuenta_prov_inmutable\(\) from public, anon, authenticated/);
  });
  test('limites: 500 filas por lote, 1000 por pagina, montos acotados', () => {
    expect(sql).toMatch(/v_total > 500/);
    expect((sql.match(/limit 1000/g) || []).length).toBe(3);
    expect(sql).toMatch(/monto_centavos > 0 and monto_centavos <= 100000000000/);
  });
  test('admin_guardar_productos conserva las protecciones de 010', () => {
    const f = (s) => (s.match(/create or replace function public\.admin_guardar_productos[\s\S]*?end \$\$;/) || [''])[0];
    const a = f(sql010), b = f(sql);
    expect(a.length).toBeGreaterThan(500);
    for (const frag of ['permiso = 1 and activo and pin_hash is not null', 'verificar_pin(v_admin_id, p_admin_pin)',
      "jsonb_array_length(p_filas) > 500", "'^[0-9]{1,15}$'", "v_precio = 'NaN'::numeric", "'^https?://'", 'security definer set search_path = public, pg_temp']) {
      expect(a).toContain(frag);
      expect(b).toContain(frag);
    }
    expect(sql).toMatch(/revoke all on function public\.admin_guardar_productos\(text, text, jsonb\) from public/);
  });
});

describe('SEC-012 bucket privado de comprobantes', () => {
  test('bucket no publico, 5 MB, solo imagenes y pdf', () => {
    expect(sql).toMatch(/'comprobantes-proveedores', 'comprobantes-proveedores', false, 5242880/);
    expect(sql).toMatch(/set public = false/);
    expect(sql).toMatch(/array\['image\/jpeg', 'image\/png', 'image\/webp', 'application\/pdf'\]/);
  });
  test('solo policies insert/select acotadas al bucket y al nombre habilitado; sin update/delete', () => {
    const pol = [...sql.matchAll(/create policy (\w+) on storage\.objects for (\w+)/g)].map(m => m[2]).sort();
    expect(pol).toEqual(['insert', 'select']);
    expect(sql).toMatch(/with check \(bucket_id = 'comprobantes-proveedores' and public\.comprobante_habilitado\(name, 'subir'\)\)/);
    expect(sql).toMatch(/using \(bucket_id = 'comprobantes-proveedores' and public\.comprobante_habilitado\(name, 'leer'\)\)/);
  });
  test('el nombre lo arma el servidor con uuid aleatorio y expira', () => {
    expect(sql).toMatch(/gen_random_uuid\(\)::text/);
    expect(sql).toMatch(/interval '10 minutes'/);
    expect(sql).toMatch(/interval '2 minutes'/);
  });
});

describe('SEC-012 frontera de costos hacia anon (D2)', () => {
  test('ingresoToRemote descarta costos, tipo A/B y claves desconocidas', () => {
    const r = ingresoToRemote({
      id: 'i1', facturaProveedor: 'F', proveedorId: 'p', proveedorNombre: 'P', fecha: 'x', usuario: 'u',
      items: [{ productoId: '1', codigo: 'c', descripcion: 'd', stockActual: 1, ingreso: 2, stockTotal: 3,
        costoUnitario: 99, tipoFactura: 'A', costo_final: 5, __proto__x: 1 }],
    });
    expect(Object.keys(r.items[0]).sort()).toEqual(['codigo', 'descripcion', 'ingreso', 'productoId', 'stockActual', 'stockTotal']);
    expect(JSON.stringify(r)).not.toMatch(/costo|tipoFactura|99/);
  });
  test('items no-array o basura no rompe ni filtra', () => {
    expect(ingresoToRemote({ id: 'i', items: 'x' }).items).toEqual([]);
    expect(ingresoToRemote({ id: 'i', items: [null, 5] }).items).toEqual([{}, {}]);
  });
  test('comprasService no persiste el PIN', () => {
    const src = leer('src/services/comprasService.js');
    expect(src).not.toMatch(/localStorage\.setItem\([^)]*(pin|cred)/i);
    expect(src).not.toMatch(/console\.(log|info|debug)/);
  });
});

describe('SEC-012 stock minimo', () => {
  test('umbral tolera basura sin NaN/negativos', () => {
    expect(umbralStock({ stockMinimo: -5, minimoVenta: 3 })).toBe(3);
    expect(umbralStock({ stockMinimo: 'abc', minimoVenta: 2 })).toBe(2);
    expect(umbralStock({ stockMinimo: 0, minimoVenta: 2 })).toBe(0);
    expect(umbralStock(null)).toBe(0);
  });
});
