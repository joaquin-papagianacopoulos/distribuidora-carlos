import { readFileSync } from 'fs';
import path from 'path';

const sql = readFileSync(path.resolve(__dirname, '..', '..', 'supabase', 'migrations', '015_lote_operacion_panel.sql'), 'utf8');

describe('SEC-PAN-01 captura de costos solo en la transicion a facturado', () => {
  test('SEC-PAN-01 un UPDATE con OLD facturado no recaptura', () => {
    expect(sql).toMatch(/tg_op = 'UPDATE' and lower\(coalesce\(old\.estado, ''\)\) = 'facturado'/);
    expect(sql).not.toMatch(/old\.items is not distinct from new\.items/);
  });
});

describe('SEC-PAN-03 tope a pedidos_costos_errores', () => {
  test('SEC-PAN-03 el trigger borra errores de mas de 90 dias antes de insertar', () => {
    const i = sql.indexOf("delete from public.pedidos_costos_errores where created_at < now() - interval '90 days'");
    const j = sql.indexOf('insert into public.pedidos_costos_errores');
    expect(i).toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(i);
  });
});
