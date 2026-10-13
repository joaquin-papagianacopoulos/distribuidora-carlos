// AC-SEC-5: las migraciones SQL habilitan RLS en toda tabla nueva y el
// ledger de stock no se puede borrar ni modificar con la anon key.
// AC-SEC-6: existe el reporte de auditoria con hallazgos priorizados.
import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');
const MIG_DIR = path.join(ROOT, 'supabase', 'migrations');

// Quita comentarios SQL (-- linea y /* bloque */) y normaliza espacios.
const limpiarSql = (sql) => sql
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/--[^\n]*/g, ' ')
  .replace(/\s+/g, ' ')
  .toLowerCase();

const nombreTabla = (t) => t.replace(/^public\./, '').replace(/"/g, '');

const tablasCreadas = (sql) => [...sql.matchAll(/create table (?:if not exists )?((?:public\.)?"?[a-z_][a-z0-9_]*"?)/g)].map(m => nombreTabla(m[1]));
const tablasConRls = (sql) => new Set([...sql.matchAll(/alter table (?:if exists )?(?:only )?((?:public\.)?"?[a-z_][a-z0-9_]*"?) enable row level security/g)].map(m => nombreTabla(m[1])));
const politicas = (sql) => [...sql.matchAll(/create policy "?([a-z0-9_]+)"? on ((?:public\.)?[a-z_][a-z0-9_]*)(?: as (?:permissive|restrictive))?(?: for (all|select|insert|update|delete))?/g)]
  .map(m => ({ nombre: m[1], tabla: nombreTabla(m[2]), cmd: m[3] || 'all' }));

const migraciones = () => readdirSync(MIG_DIR).filter(f => f.endsWith('.sql')).sort();
const SQL_001 = limpiarSql(readFileSync(path.join(MIG_DIR, '001_altas_y_stock.sql'), 'utf8'));

describe('AC-SEC-5 RLS en migraciones', () => {
  test('AC-SEC-5 hay al menos una migracion y la 001 crea las tablas nuevas', () => {
    expect(migraciones().length).toBeGreaterThan(0);
    expect(tablasCreadas(SQL_001)).toEqual(expect.arrayContaining(['proveedores', 'movimientos_stock', 'ingresos_mercaderia']));
  });

  test.each(migraciones().map(f => [f]))('AC-SEC-5 %s: toda create table tiene enable row level security', (file) => {
    const sql = limpiarSql(readFileSync(path.join(MIG_DIR, file), 'utf8'));
    const rls = tablasConRls(sql);
    const sinRls = tablasCreadas(sql).filter(t => !rls.has(t));
    expect(sinRls).toEqual([]);
  });

  test('AC-SEC-5 movimientos_stock no tiene politica de DELETE (ni FOR ALL)', () => {
    for (const file of migraciones()) {
      const sql = limpiarSql(readFileSync(path.join(MIG_DIR, file), 'utf8'));
      const malas = politicas(sql).filter(p => p.tabla === 'movimientos_stock' && ['delete', 'all'].includes(p.cmd));
      expect({ file, malas }).toEqual({ file, malas: [] });
    }
  });

  test('AC-SEC-5 ingresos_mercaderia no tiene politica de DELETE (ni FOR ALL)', () => {
    for (const file of migraciones()) {
      const sql = limpiarSql(readFileSync(path.join(MIG_DIR, file), 'utf8'));
      const malas = politicas(sql).filter(p => p.tabla === 'ingresos_mercaderia' && ['delete', 'all'].includes(p.cmd));
      expect({ file, malas }).toEqual({ file, malas: [] });
    }
  });

  test('AC-SEC-5 ninguna migracion otorga DELETE sobre el ledger a anon', () => {
    for (const file of migraciones()) {
      const sql = limpiarSql(readFileSync(path.join(MIG_DIR, file), 'utf8'));
      expect(sql).not.toMatch(/grant [^;]*\b(delete|all)\b[^;]* on (table )?(public\.)?movimientos_stock[^;]* to [^;]*\banon\b/);
    }
  });

  test('AC-SEC-5 movimientos_stock tiene el trigger de inmutabilidad (cantidad/producto/tipo)', () => {
    expect(SQL_001).toMatch(/create trigger movimiento_inmutable before update on public\.movimientos_stock for each row execute function public\.tg_movimiento_inmutable\(\)/);
    const fn = SQL_001.match(/create or replace function public\.tg_movimiento_inmutable\(\)[\s\S]*?end \$\$/);
    expect(fn).not.toBeNull();
    expect(fn[0]).toMatch(/new\.producto_id is distinct from old\.producto_id/);
    expect(fn[0]).toMatch(/new\.cantidad is distinct from old\.cantidad/);
    expect(fn[0]).toMatch(/new\.tipo is distinct from old\.tipo/);
    expect(fn[0]).toMatch(/raise exception/);
  });

  test('AC-SEC-5 movimientos_stock acota la cantidad y valida el tipo', () => {
    expect(SQL_001).toMatch(/cantidad integer not null check \(cantidad <> 0 and abs\(cantidad\) <= 1000000\)/);
    expect(SQL_001).toMatch(/tipo text not null check \(tipo in \('inicial','ajuste','ingreso','venta','anulacion'\)\)/);
  });

  test('AC-SEC-5 la vista stock_actual usa security_invoker (respeta RLS)', () => {
    expect(SQL_001).toMatch(/create or replace view public\.stock_actual with \(security_invoker = true\)/);
  });
});

describe('AC-SEC-6 reporte de auditoria de seguridad', () => {
  const REPORTS = path.join(ROOT, 'harness', 'reports');
  const reportes = () => (existsSync(REPORTS) ? readdirSync(REPORTS) : [])
    .map(d => path.join(REPORTS, d, 'security-report.md'))
    .filter(p => existsSync(p))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);

  test('AC-SEC-6 existe al menos un security-report.md', () => {
    expect(reportes().length).toBeGreaterThan(0);
  });

  test('AC-SEC-6 el reporte tiene tabla de severidades y secciones obligatorias', () => {
    const md = readFileSync(reportes()[0], 'utf8');
    expect(md).toMatch(/\|\s*Severidad\s*\|\s*Hallazgo\s*\|\s*Evidencia\s*\|\s*Estado[^|]*\|\s*D.nde se corrige[^|]*\|/);
    expect(md).toMatch(/\|\s*:?-{3,}:?\s*\|/);
    expect(md).toMatch(/Cr.tico/);
    expect(md).toMatch(/\bAlto\b/);
    expect(md).toMatch(/\bMedio\b/);
    expect(md).toMatch(/\bBajo\b/);
    expect(md).toMatch(/ABIERTO/);
    expect(md).toMatch(/CORREGIDO/);
    for (const s of ['Resumen ejecutivo', 'Tabla de hallazgos', 'Detalle', 'Corregido en esta corrida', 'Requiere acci']) {
      expect(md).toContain(s);
    }
  });

  test('AC-SEC-6 el reporte no filtra secretos (JWT / claves)', () => {
    const md = readFileSync(reportes()[0], 'utf8');
    expect(md).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/);
  });
});
