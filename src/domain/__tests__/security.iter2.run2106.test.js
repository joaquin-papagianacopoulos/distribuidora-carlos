// RUN 20261012-2106 iteracion 2 — seguridad corregible en codigo:
// S-BUL-09 (ledger), S-BUL-01 (revalidacion de sesion), S-VEN-01 (nombres),
// S-VEN-03 (SQL 003/004).
import { readFileSync } from 'fs';
import path from 'path';
import {
  revisarMovimientosPedido, movimientosParaPedido, mensajeMovimientosInvalidos, MAX_CANTIDAD,
} from '../stock';
import {
  decidirRevalidacion, validarNombreNuevoVendedor, claveNombreVendedor, MSG_NOMBRE_EXISTENTE,
} from '../vendedores';

const MIG = path.resolve(__dirname, '..', '..', '..', 'supabase', 'migrations');
const limpio = (f) => readFileSync(path.join(MIG, f), 'utf8').replace(/--[^\n]*/g, ' ').replace(/\s+/g, ' ').toLowerCase();

describe('AC-STK-8 S-BUL-09 el ledger topa y exige enteros', () => {
  const opts = { genId: (() => { let i = 0; return () => `m${++i}`; })(), now: new Date('2026-10-13T10:00:00Z') };
  const pedido = (items) => ({ id: 5, estado: 'facturado', clienteNombre: 'Pepe', items });

  test('AC-STK-8 S-BUL-09 cantidades decimales o > MAX_CANTIDAD se omiten y se reportan; las validas se emiten', () => {
    const r = revisarMovimientosPedido(pedido([
      { productoId: 1, nombre: 'Ok', cantidad: 3 },
      { productoId: 2, nombre: 'Decimal', cantidad: 2.5 },
      { productoId: 3, nombre: 'Enorme', cantidad: MAX_CANTIDAD + 1 },
      { productoId: 4, nombre: 'Tope', cantidad: MAX_CANTIDAD },
    ]), [], opts);
    expect(r.movimientos.map(m => [m.productoId, m.cantidad])).toEqual([['1', -3], ['4', -MAX_CANTIDAD]]);
    expect(r.invalidos).toEqual([
      { productoId: '2', nombre: 'Decimal', delta: -2.5 },
      { productoId: '3', nombre: 'Enorme', delta: -(MAX_CANTIDAD + 1) },
    ]);
    expect(mensajeMovimientosInvalidos(r.invalidos)).toMatch(/Decimal, Enorme .*1\.000\.000/);
  });

  test('AC-STK-8 S-BUL-09 movimientosParaPedido mantiene el contrato (array) y sin invalidos no hay aviso', () => {
    const movs = movimientosParaPedido(pedido([{ productoId: 1, cantidad: 2 }, { productoId: 2, cantidad: 0.5 }]), [], opts);
    expect(Array.isArray(movs)).toBe(true);
    expect(movs).toHaveLength(1);
    expect(mensajeMovimientosInvalidos([])).toBe('');
    expect(mensajeMovimientosInvalidos(null)).toBe('');
    expect(mensajeMovimientosInvalidos([{ productoId: '9' }])).toMatch(/de: 9/);
  });
});

describe('AC-SEC-4 S-BUL-01 revalidacion de la sesion contra el servidor', () => {
  const local = { id: 2, remoteId: 'u2', nombre: 'Carlos', zona: 'Norte', permiso: 1, tienePin: false, createdAt: 5 };
  const fila = { id: 'u2', nombre: 'Carlos', zona: 'Norte', permiso: 2, tiene_pin: false, activo: true };

  test('AC-SEC-4 S-BUL-01 permiso adulterado en IndexedDB => manda el del servidor', () => {
    const d = decidirRevalidacion(local, { data: fila, error: null });
    expect(d.accion).toBe('actualizar');
    expect(d.sesion).toMatchObject({ id: 2, remoteId: 'u2', permiso: 2, nombre: 'Carlos', createdAt: 5 });
    expect(d.sesion).not.toHaveProperty('pin');
  });

  test('AC-SEC-4 S-BUL-01 igual al servidor => mantener; error de lectura (sin red) => mantener', () => {
    expect(decidirRevalidacion({ ...local, permiso: 2 }, { data: fila })).toMatchObject({ accion: 'mantener', motivo: 'igual' });
    expect(decidirRevalidacion(local, { data: null, error: { message: 'Failed to fetch' } })).toMatchObject({ accion: 'mantener', motivo: 'error_lectura' });
    expect(decidirRevalidacion(null, { data: fila })).toMatchObject({ accion: 'mantener' });
  });

  test('AC-VEN-4 S-BUL-01 fila inexistente o dada de baja => cerrar sesion', () => {
    expect(decidirRevalidacion(local, { data: null, error: null })).toMatchObject({ accion: 'cerrar', motivo: 'no_existe' });
    expect(decidirRevalidacion(local, {})).toMatchObject({ accion: 'cerrar' });
    expect(decidirRevalidacion(local, { data: { ...fila, activo: false } })).toMatchObject({ accion: 'cerrar', motivo: 'inactivo' });
  });

  test('AC-SEC-4 S-BUL-01 sin la columna tiene_pin (002 sin correr) se conserva el candado local', () => {
    const { tiene_pin: _t, ...legacy } = fila;
    const d = decidirRevalidacion({ ...local, tienePin: true }, { data: legacy });
    expect(d.sesion.tienePin).toBe(true);
    expect(d.sesion.permiso).toBe(2);
  });
});

describe('AC-VEN-2 S-VEN-01 nombres unicos', () => {
  test('AC-VEN-2 S-VEN-01 nombre vacio, normalizacion y entradas raras', () => {
    expect(validarNombreNuevoVendedor('   ', [])).toMatchObject({ ok: false, motivo: 'vacio' });
    expect(claveNombreVendedor('  José   María ')).toBe('jose maria');
    expect(validarNombreNuevoVendedor('Jose Maria', [null, 'x', { nombre: 'JOSÉ MARÍA' }])).toMatchObject({ ok: false, mensaje: MSG_NOMBRE_EXISTENTE });
    expect(validarNombreNuevoVendedor('Nuevo', null)).toMatchObject({ ok: true });
  });
});

describe('AC-VEN-2 S-VEN-03 SQL: dado de baja sin PIN y RPC de comisiones solo con admin activo', () => {
  const S003 = limpio('003_comisiones.sql');
  const S004 = limpio('004_baja_vendedores.sql');

  test('AC-VEN-2 S-VEN-03 la 004 tiene el trigger "zz" que impide pin/pin_hash con activo=false (idempotente)', () => {
    expect(S004).toMatch(/create or replace function public\.tg_vendedor_inactivo_sin_pin\(\) returns trigger/);
    expect(S004).toMatch(/if new\.activo = false and \(new\.pin_hash is not null or nullif\(trim\(coalesce\(new\.pin::text, ''\)\), ''\) is not null\) then raise exception 'vendedor_inactivo/);
    expect(S004).toMatch(/drop trigger if exists vendedor_zz_inactivo_sin_pin on public\.vendedores; create trigger vendedor_zz_inactivo_sin_pin before insert or update on public\.vendedores/);
    // "zz" > "vendedor_hashear_pin": corre despues del hash (orden alfabetico).
    expect('vendedor_zz_inactivo_sin_pin' > 'vendedor_hashear_pin').toBe(true);
    // sigue exigiendo la 002 PASO 1 al principio
    expect(S004.indexOf("to_regprocedure('public.verificar_pin(text, text)') is null")).toBeLessThan(S004.indexOf('tg_vendedor_inactivo_sin_pin'));
  });

  test('AC-COM-16 S-VEN-03 la 003 exige admin activo con chequeo dinamico (la columna la crea la 004)', () => {
    expect(S003).toMatch(/create or replace function public\.vendedor_habilitado\(p_id text\) returns boolean/);
    expect(S003).toMatch(/column_name = 'activo'\) then return true; end if; execute 'select activo from public\.vendedores where id::text = \$1' into v_activo using p_id; return coalesce\(v_activo, false\)/);
    expect(S003).toMatch(/revoke all on function public\.vendedor_habilitado\(text\) from anon, authenticated/);
    const usos = S003.match(/where ve\.id::text = v_admin_id and ve\.permiso = 1 and public\.vendedor_habilitado\(ve\.id::text\);/g) || [];
    expect(usos).toHaveLength(2);
    // la 003 no referencia ve.activo en forma estatica (romperia antes de la 004)
    expect(S003).not.toMatch(/ve\.activo/);
  });
});
