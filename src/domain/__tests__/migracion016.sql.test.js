// Chequeo estatico de 016_productos_grants_columnas.sql: vuelve a otorgar el select por
// columnas de productos (todas menos las internas) y no abre los costos.
import fs from 'fs';
import path from 'path';

const sql = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'supabase', 'migrations', '016_productos_grants_columnas.sql'), 'utf8');
const codigo = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');

describe('migracion 016 grants por columna de productos', () => {
  it('S-012-01 016 otorga select a las columnas actuales menos las internas, sin select de tabla', () => {
    expect(codigo).toMatch(/column_name not in \('costo_final', 'descuento1', 'descuento2', 'ganancia', 'precio_venta2'\)/);
    expect(codigo).toMatch(/grant select \(%s\) on public\.productos to anon, authenticated/);
    expect(codigo).not.toMatch(/grant select on public\.productos/);
    expect(codigo).not.toMatch(/grant (all|insert|update|delete)/i);
    expect(codigo).toMatch(/revoke select \(costo_final, descuento1, descuento2, ganancia, precio_venta2\) on public\.productos/);
    expect(codigo).not.toMatch(/drop |truncate|delete from/i);
    expect(sql).toMatch(/^begin;/m);
    expect(sql).toMatch(/^commit;/m);
  });
});
