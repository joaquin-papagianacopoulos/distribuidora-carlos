// REQ-PAN auditoria AppSec (run 20261015-2019): invariantes de la 015 que no deben regresar.
import { readFileSync } from 'fs';
import path from 'path';

const sql = readFileSync(path.resolve(__dirname, '..', '..', 'supabase', 'migrations', '015_lote_operacion_panel.sql'), 'utf8');
const sc = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');

describe('AC-PAN-1 auditoria 015', () => {
  test('el costo sale SOLO del servidor (productos), nunca de new.items', () => {
    expect(sc).toMatch(/_costo_neto_producto\(p\.costo_final, p\.descuento1, p\.descuento2\)/);
    expect(sc).not.toMatch(/e->>?'(costo|costoUnitario|costoNeto|costoFinal)/);
  });
  test('el join a productos usa la pk y el cast del id esta protegido por regex', () => {
    expect(sc).toMatch(/join public\.productos p on p\.id = it\.pid/);
    expect(sc).toMatch(/~ '\^\[0-9\]\{1,18\}\$'/);
    expect(sc).not.toMatch(/p\.id::text/);
  });
  test('la RPC rechaza antes de tocar datos y acota la pagina', () => {
    expect(sc).toMatch(/not public\._es_admin_con_pin[\s\S]*no_autorizado/);
    expect(sc).toMatch(/limit 1000/);
    expect(sc).toMatch(/admin_costos_venta_bajar[\s\S]*security definer set search_path = public, pg_temp/);
  });
  test('ninguna tabla/vista nueva es legible por anon', () => {
    expect(sc).not.toMatch(/grant\s+(select|all)/i);
    expect(sc).not.toMatch(/create (or replace )?view/i);
  });
});
