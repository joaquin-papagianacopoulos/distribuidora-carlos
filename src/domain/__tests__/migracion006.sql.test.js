// REQ-VTA (AC-VTA-5): chequeo estatico de la migracion 006 (se aplica a mano en Supabase).
import { readFileSync } from 'fs';
import path from 'path';

const RAW = readFileSync(path.resolve(__dirname, '..', '..', '..', 'supabase', 'migrations', '006_unidad_venta.sql'), 'utf8');
const SQL = RAW.replace(/--[^\n]*/g, ' ').replace(/\s+/g, ' ').toLowerCase();

describe('AC-VTA-5 migracion 006_unidad_venta.sql', () => {
  it('AC-VTA-5 idempotente, en una transaccion, sin borrar datos', () => {
    expect(SQL.trim().startsWith('begin;')).toBe(true);
    expect(SQL.trim().endsWith('commit;')).toBe(true);
    for (const prohibido of [/\bdrop\b/, /\bdelete\b/, /\btruncate\b/, /\bgrant\b/, /\bdisable row level\b/, /\bupdate public\./]) {
      expect(SQL).not.toMatch(prohibido);
    }
  });
  it('AC-VTA-5 agrega las columnas con if not exists', () => {
    expect(SQL).toContain('alter table public.productos add column if not exists marca text');
    expect(SQL).toContain('add column if not exists venta_por text');
    expect(SQL).toContain('add column if not exists bulto_nombre text');
    expect(SQL).toContain('add column if not exists visible_tienda boolean not null default true');
    // venta_por sin default: null = "derivar de bulto_x"
    expect(SQL).not.toMatch(/venta_por text default/);
  });
  it('AC-VTA-5 CHECKs idempotentes y las reglas de la app', () => {
    expect((SQL.match(/exception when duplicate_object then null/g) || []).length).toBe(4);
    expect(SQL).toContain("venta_por in ('unidad','bulto','ambos')");
    expect(SQL).toContain("bulto_nombre in ('bulto','display','caja','pack')");
    expect(SQL).toContain("venta_por is distinct from 'bulto' or coalesce(bulto_x, 1) > 1");
    expect(SQL).toContain('char_length(marca) <= 60');
  });
});
