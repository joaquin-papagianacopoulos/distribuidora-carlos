// Auditoria de seguridad RUN 20261012-2106 — REQ-VEN + C5/C5b/C6/C7.
// Chequeos estaticos del SQL (002/003/004) y del dominio de sesion.
import { readFileSync } from 'fs';
import path from 'path';
import { vendedorDeSesion, decidirIngreso, chequeoUltimoAdmin, puedeDarDeBaja, validarNombreNuevoVendedor, MSG_NOMBRE_DADO_DE_BAJA } from '../vendedores';

const MIG = path.resolve(__dirname, '..', '..', '..', 'supabase', 'migrations');
const raw = (f) => readFileSync(path.join(MIG, f), 'utf8');
const limpio = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ').replace(/\s+/g, ' ').toLowerCase();
const S002 = limpio(raw('002_seguridad_recomendada.sql'));
const S003 = limpio(raw('003_comisiones.sql'));
const S004 = limpio(raw('004_baja_vendedores.sql'));
const fn = (sql, nombre) => (sql.match(new RegExp(`create or replace function public\\.${nombre}\\([\\s\\S]*?end \\$\\$`)) || [''])[0];
const locks = (s) => [...s.matchAll(/pg_advisory_xact_lock\(hashtext\('([^']+)'/g)].map(m => m[1]);

describe('AC-COM-16 AC-VEN-4 C7: lock global de la 003 vs. lock de bajas de la 004 (sin deadlock)', () => {
  test('AC-COM-16 la 003 usa solo la clave comisiones_global y la 004 solo vendedores_baja (claves disjuntas)', () => {
    expect([...new Set(locks(S003))]).toEqual(['comisiones_global']);
    expect([...new Set(locks(S004))]).toEqual(['vendedores_baja']);
  });

  test('AC-COM-16 las RPC de la 003 no bloquean filas de vendedores y la 004 no toca tablas de comisiones', () => {
    for (const n of ['cerrar_comisiones', 'anular_cierre_comisiones']) {
      const f = fn(S003, n);
      expect(f).not.toBe('');
      expect(f).not.toMatch(/from public\.vendedores[^;]*for (update|share|no key update|key share)/);
      expect(f).not.toMatch(/update public\.vendedores/);
    }
    expect(S004).not.toMatch(/comisiones_/);
  });

  test('AC-VEN-4 en la 004 el orden es siempre lock global y despues lock de fila (for update)', () => {
    for (const n of ['admin_baja_vendedor', 'admin_guardar_vendedor']) {
      const f = fn(S004, n);
      const lk = f.indexOf("pg_advisory_xact_lock(hashtext('vendedores_baja'))");
      const fu = f.indexOf('for update');
      expect(lk).toBeGreaterThan(0);
      expect(fu).toBeGreaterThan(lk);
    }
  });
});

describe('AC-VEN-2 S-COM-20 C6: re-correr la 002 despues de la 004', () => {
  test('AC-VEN-2 la 002 PASO 2 (comentado) arma el grant por columnas excluyendo SOLO pin y pin_hash: si se re-corre, activo sigue legible', () => {
    expect(raw('002_seguridad_recomendada.sql')).toMatch(/column_name not in \('pin', 'pin_hash'\)/);
  });

  test('AC-VEN-2 la 002 y la 004 avisan que re-correr la 002 PASO 1 pisa admin_guardar_vendedor', () => {
    expect(raw('002_seguridad_recomendada.sql')).toMatch(/volver a\s+correr la 004/i);
    expect(raw('004_baja_vendedores.sql')).toMatch(/volver a correr esta 004/i);
    // La version de la 002 no conoce "activo": por eso la 004 tiene que quedar ultima.
    expect(fn(S002, 'admin_guardar_vendedor')).not.toMatch(/\bactivo\b/);
    expect(fn(S004, 'admin_guardar_vendedor')).toMatch(/\bactivo\b/);
  });

  test('AC-VEN-2 la 004 nunca otorga select de pin/pin_hash ni update directo de activo', () => {
    expect(S004).not.toMatch(/grant [^;]*(pin|pin_hash)[^;]* on public\.vendedores/);
    expect(S004).not.toMatch(/grant [^;]*\bupdate\b[^;]* on public\.vendedores/);
  });
});

describe('AC-SEC-4 S-COM-18 C5: la sesion sale de la fila del servidor', () => {
  test('AC-SEC-4 ataque B: el registro local del admin con remoteId ajeno => la sesion es del duenio del PIN', () => {
    const localAdmin = { id: 1, nombre: 'Admin', permiso: 1, remoteId: 99, tienePin: true };
    const filaDelPin = { id: 7, nombre: 'Vendedor', zona: 'Sur', permiso: 2, tiene_pin: true, activo: true };
    const s = vendedorDeSesion(localAdmin, filaDelPin);
    expect(s).toMatchObject({ id: 1, nombre: 'Vendedor', permiso: 2, remoteId: 7 });
    expect(s).not.toHaveProperty('pin');
  });

  test.each([['1'], [1.5], ['admin'], [99], [null], [-1], [{ valueOf: () => 1 }]])('AC-SEC-4 permiso del servidor %p raro => nunca admin salvo el entero 1', (p) => {
    const s = vendedorDeSesion({ id: 1, permiso: 1 }, { id: 2, nombre: 'X', permiso: p });
    if (Number(p) === 1 && Number.isInteger(Number(p))) expect([1, 2]).toContain(s.permiso);
    else expect(s.permiso).toBe(2);
  });

  test('AC-SEC-4 un solo-local (sin remoteId) entra siempre como vendedor (2)', () => {
    expect(decidirIngreso({ id: 5, nombre: 'X', permiso: 1 }, { online: true })).toMatchObject({ accion: 'entrar', permiso: 2 });
  });

  // S-VEN-02 (Bajo, ABIERTO): un admin del servidor SIN PIN entra con UI de
  // admin con un toque (la 004 impide crear nuevos, pero no limpia los viejos).
  test.todo('S-VEN-02 vendedorDeSesion degrada a 2 una fila permiso 1 con tiene_pin false');
});

describe('AC-VEN-4 C5b: espejo en el cliente del ultimo admin con PIN', () => {
  const adminA = { id: 1, remoteId: 11, nombre: 'A', permiso: 1, tienePin: true };
  const adminSinPin = { id: 2, remoteId: 12, nombre: 'B', permiso: 1, tienePin: false };
  const adminBaja = { id: 3, remoteId: 13, nombre: 'C', permiso: 1, tienePin: true, activo: false };

  test('AC-VEN-4 un admin sin PIN o dado de baja no cuenta como "otro admin"', () => {
    const r = chequeoUltimoAdmin({ previo: adminA, datos: { permiso: 2, borrarPin: false, tienePin: true }, vendedores: [adminA, adminSinPin, adminBaja] });
    expect(r).toMatchObject({ ok: false, motivo: 'ultimo_admin' });
    const b = puedeDarDeBaja({ admin: { ...adminSinPin, permiso: 1 }, vendedor: adminA, vendedores: [adminA, adminSinPin, adminBaja] });
    expect(b).toMatchObject({ ok: false, motivo: 'ultimo_admin' });
  });

  // S-VEN-01 (Medio): CORREGIDO en la iteracion 2 (alta local y alta/renombre
  // del admin). La auto-alta en si sigue (S-COM-19: decision del dueño).
  test('S-VEN-01 la auto-alta rechaza un nombre igual (claveUnica) al de un vendedor existente, activo o dado de baja', () => {
    const lista = [{ id: 1, nombre: 'Carlos Pérez', activo: false }, { id: 2, nombre: 'Ana' }];
    expect(validarNombreNuevoVendedor('  carlos   PEREZ ', lista)).toMatchObject({ ok: false, motivo: 'nombre_dado_de_baja', mensaje: MSG_NOMBRE_DADO_DE_BAJA });
    expect(validarNombreNuevoVendedor('ANA', lista)).toMatchObject({ ok: false, motivo: 'nombre_existente' });
    expect(validarNombreNuevoVendedor('Carla', lista)).toMatchObject({ ok: true });
    // editar a uno sin cambiarle el nombre no choca consigo mismo
    expect(validarNombreNuevoVendedor('Ana', lista, { excluido: lista[1] })).toMatchObject({ ok: true });
  });
});
