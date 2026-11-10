// Tanda 1: correcciones de seguridad T1-A-01 (estatico sobre la 024), T1-A-02, T1-A-05, T1-A-06.
import fs from 'fs';
import path from 'path';
import { aplicarEdicion } from '../edicionPedido';
import { puedeEditarPedido } from '../permisos';

const sql = fs.readFileSync(path.join(__dirname, '../../../supabase/migrations/024_pedidos_edicion_vendedor.sql'), 'utf8');
const VEND = { nombre: 'Carlos', permiso: 2 };
const ADMIN = { nombre: 'Jorge', permiso: 1 };

describe('T1-A-01 migracion 024: vendedor inmutable salvo por la RPC con PIN', () => {
  it('T1-A-01 trigger BEFORE UPDATE que conserva vendedor/vendedor_id/cargado_por para anon/authenticated', () => {
    expect(sql).toMatch(/create or replace function public\.tg_pedidos_vendedor_inmutable/);
    expect(sql).toMatch(/current_user not in \('anon', 'authenticated'\)/);
    expect(sql).toMatch(/new\.vendedor := old\.vendedor/);
    expect(sql).toMatch(/create trigger set_vendedor_inmutable before update on public\.pedidos/);
    expect(sql).not.toMatch(/before (insert|insert or update) on public\.pedidos\s+for each row execute function public\.tg_pedidos_vendedor_inmutable/);
  });
  it('T1-A-01 RPC admin_reasignar_vendedor_pedido: security definer, search_path fijo, PIN de admin, flag local', () => {
    const rpc = sql.slice(sql.indexOf('function public.admin_reasignar_vendedor_pedido'));
    expect(rpc).toMatch(/security definer set search_path = public, pg_temp/);
    expect(rpc).toMatch(/public\.verificar_pin\(v_admin_id, p_admin_pin\)/);
    expect(rpc).toMatch(/permiso = 1 and activo/);
    expect(rpc).toMatch(/set_config\('app\.reasignando_vendedor', 'on', true\)/);
    expect(sql).toMatch(/revoke all on function public\.admin_reasignar_vendedor_pedido\(text, text, text, text, text, text\) from public/);
  });
  it('T1-A-06 funciones con search_path fijo', () => {
    expect(sql).toMatch(/tg_set_updated_at\(\) returns trigger language plpgsql set search_path = pg_temp/);
    expect(sql).toMatch(/language sql immutable set search_path = pg_temp/);
  });
});

describe('T1-A-02 congelarPrecios (vendedor)', () => {
  const orig = { id: 1, estado: 'pendiente', vendedor: 'Carlos', items: [{ productoId: 1, nombre: 'A', cantidad: 2, precio: 10, precioOriginal: 10, precioBultoOriginal: 8, precioBultoX: 12 }] };
  const edit = (items, extra = {}) => aplicarEdicion(orig, { items }, { usuario: VEND, now: 1, ...extra }).items;

  it('T1-A-02 cambiar precio sin flag en un renglon existente se descarta', () => {
    const r = edit([{ ...orig.items[0], precio: 1 }]);
    expect(r[0].precio).toBe(10);
  });
  it('T1-A-02 precio manual o descuento en renglon existente o nuevo se ignoran', () => {
    expect(edit([{ ...orig.items[0], precio: 1, precioManual: true }])[0].precio).toBe(10);
    expect(edit([{ ...orig.items[0], precio: 1, descuentoPct: 90 }])[0].precio).toBe(10);
    const nuevo = edit([orig.items[0], { productoId: 2, nombre: 'B', cantidad: 1, precio: 1, precioManual: true, descuentoPct: 50, precioOriginal: 100 }], { productosById: new Map([['2', { id: 2, precio: 50 }]]) });
    expect(nuevo[1].precio).toBe(50);
    expect(nuevo[1].precioManual).toBeUndefined();
  });
  it('T1-A-02 al cruzar el bulto sigue valiendo la regla de precio de bulto', () => {
    expect(edit([{ ...orig.items[0], cantidad: 12 }])[0]).toMatchObject({ precio: 8, precioPorBulto: true });
  });
  it('T1-A-02 el admin si puede poner precio', () => {
    const r = aplicarEdicion(orig, { items: [{ ...orig.items[0], precio: 5, precioManual: true }] }, { usuario: ADMIN, now: 1 }).items;
    expect(r[0].precio).toBe(5);
  });
});

describe('T1-A-05 el vendedor no edita pedidos entregados ni con comisiones cerradas', () => {
  const p = { estado: 'pendiente', vendedor: 'Carlos' };
  it('T1-A-05 entregado y cerradoEn', () => {
    expect(puedeEditarPedido(VEND, p).ok).toBe(true);
    expect(puedeEditarPedido(VEND, { ...p, entregado: true }).ok).toBe(false);
    expect(puedeEditarPedido(VEND, p, { cerradoEn: 'c1' }).ok).toBe(false);
  });
});
