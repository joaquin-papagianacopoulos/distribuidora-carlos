// Auditoria run 20261015-1513 (REQ-FAB, REQ-AGR, REQ-ZON): migracion 011, grupos hostiles, frontera de datos fiscales.
import { readFileSync } from 'fs';
import path from 'path';
import { normalizarGrupos, filasBoleta, totalFilasBoleta, MAX_NOMBRE_GRUPO, MAX_GRUPOS } from '../domain/gruposFactura';

const ROOT = path.resolve(__dirname, '..', '..');
const leer = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const sql = leer('supabase/migrations/011_lote_operacion_facturacion_zonas.sql').replace(/--[^\n]*/g, ' ');

describe('SEC-011 migracion', () => {
  test('pedidos_factura: RLS, sin grants ni policies para anon', () => {
    expect(sql).toMatch(/alter table public\.pedidos_factura enable row level security/);
    expect(sql).toMatch(/revoke all on public\.pedidos_factura from public, anon, authenticated/);
    expect(sql).not.toMatch(/grant [a-z, ]+ on (table )?public\.pedidos_factura/i);
    expect(sql).not.toMatch(/create policy/i);
  });
  test('toda funcion security definer fija search_path', () => {
    const defs = sql.match(/create or replace function[\s\S]*?language plpgsql[^$]*\$\$/g) || [];
    expect(defs.length).toBe(3);
    defs.forEach(d => { expect(d).toMatch(/security definer set search_path = public, pg_temp/); });
  });
  test('helper interno sin grant a anon; RPC con PIN de admin', () => {
    expect(sql).toMatch(/revoke all on function public\._es_admin_con_pin\(text, text\) from public, anon, authenticated/);
    expect(sql).not.toMatch(/grant execute on function public\._es_admin_con_pin/);
    expect((sql.match(/if not public\._es_admin_con_pin\(p_admin_id, p_admin_pin\)/g) || []).length).toBe(2);
    expect(sql).toMatch(/permiso = 1 and activo/);
  });
  test('limites: 500 filas, rango 366 dias, regex de id', () => {
    expect(sql).toMatch(/jsonb_array_length\(p_filas\) > 500/);
    expect(sql).toMatch(/p_hasta - p_desde > 366/);
    expect(sql).toMatch(/\^\[0-9a-zA-Z-\]\{1,64\}\$/);
  });
});

describe('SEC-011 grupos hostiles', () => {
  const items = [{ productoId: 1, nombre: 'A', cantidad: 2, precio: 10 }, { productoId: 2, nombre: 'B', cantidad: 1, precio: 5 }];
  test('nombre largo/con control/html se acota y no cambia totales', () => {
    const nombre = '<img src=x onerror=alert(1)>\n\u0000=cmd|calc' + 'x'.repeat(5000);
    const gs = normalizarGrupos([{ id: 'g1', nombre, itemIds: ['1', 2] }], items);
    expect(gs[0].nombre.length).toBeLessThanOrEqual(MAX_NOMBRE_GRUPO);
    expect(gs[0].nombre).not.toMatch(/[\u0000-\u001F]/);
    const filas = filasBoleta(items, gs);
    expect(totalFilasBoleta(filas)).toBe(25);
  });
  test('basura estructural no rompe ni duplica renglones', () => {
    const basura = [null, 5, 'x', [], { id: 'a', itemIds: 'no' }, { id: 'a', itemIds: ['1', '1', { x: 1 }] },
      { id: 'a', itemIds: ['2'] }, { id: 'b', itemIds: ['1'] }, { __proto__: { id: 'p' }, itemIds: ['2'] }];
    const gs = normalizarGrupos(basura, items);
    const claves = gs.flatMap(g => g.itemIds);
    expect(new Set(claves).size).toBe(claves.length);
    expect(totalFilasBoleta(filasBoleta(items, gs))).toBe(25);
  });
  test('tope de grupos y de claves', () => {
    const muchos = Array.from({ length: 500 }, (_, i) => ({ id: `g${i}`, itemIds: [String(i)] }));
    expect(normalizarGrupos(muchos).length).toBeLessThanOrEqual(MAX_GRUPOS);
  });
});

describe('SEC-011 frontera fiscal en el cliente', () => {
  test('tipoFactura no viaja en la fila de pedidos (ni sync ni repositorio)', () => {
    ['src/sync/syncService.js', 'src/services/pedidoRepository.js'].forEach(f => {
      const src = leer(f);
      expect(src).not.toMatch(/tipo_factura/);
    });
  });
  test('reporte A emitir: sin console, sin localStorage, sin innerHTML, solo admin en App', () => {
    const pag = leer('src/pages/FacturasAEmitir.js') + leer('src/services/facturacionService.js');
    expect(pag).not.toMatch(/console\.|localStorage|sessionStorage|dangerouslySetInnerHTML|innerHTML/);
    expect(leer('src/App.js')).toMatch(/tab === 'facturasemitir' && isAdmin/);
  });
  test('pdf: nombre de archivo del reporte sin CUIT', () => {
    const pdf = leer('src/utils/pdfGen.js');
    const m = pdf.match(/const filename = `facturas_a_emitir_[^`]*`/);
    expect(m).not.toBeNull();
    expect(m[0]).not.toMatch(/cuit/i);
  });
});
