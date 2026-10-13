// REQ-VEN: baja logica de vendedores. Logica pura de src/domain/vendedores.js.
import {
  estaActivo, filtrarActivos, vendedoresParaSelector, puedeDarDeBaja,
  argsAdminBajaVendedor, interpretarBajaVendedor, vendedorDesdeRemoto,
  interpretarEstadoRemoto, COLUMNAS_VENDEDOR_REMOTO, COLUMNAS_VENDEDOR_SIN_ACTIVO,
  MSG_FALTA_MIGRACION_004, MSG_BLOQUEADO,
} from '../vendedores';

const ADMIN = { id: 1, remoteId: 7, nombre: 'Jorge', permiso: 1, tienePin: true };
const ADMIN2 = { id: 4, remoteId: 10, nombre: 'Marta', permiso: 1, tienePin: true };
const VEND = { id: 2, remoteId: 8, nombre: 'Carlos', permiso: 2 };
const ARM = { id: 3, remoteId: 9, nombre: 'Ana', permiso: 3, activo: true };

describe('AC-VEN-6 AC-VEN-3 filtrado de activos', () => {
  it('AC-VEN-6 estaActivo: sin campo (registro viejo o 004 sin correr) = activo; solo false lo da de baja', () => {
    expect(estaActivo(VEND)).toBe(true);
    expect(estaActivo(ARM)).toBe(true);
    expect(estaActivo({ ...VEND, activo: false })).toBe(false);
    expect(estaActivo({ ...VEND, activo: null })).toBe(true);
    expect(estaActivo(null)).toBe(false);
    expect(estaActivo('x')).toBe(false);
  });

  it('AC-VEN-3 filtrarActivos saca a los dados de baja y tolera entradas raras', () => {
    const lista = [ADMIN, { ...VEND, activo: false }, ARM, null];
    expect(filtrarActivos(lista).map(v => v.nombre)).toEqual(['Jorge', 'Ana']);
    expect(filtrarActivos(undefined)).toEqual([]);
    expect(filtrarActivos('nada')).toEqual([]);
  });

  it('AC-VEN-3 vendedoresParaSelector: solo activos, pero conserva el ya elegido aunque este de baja', () => {
    const lista = [ADMIN, { ...VEND, activo: false }, ARM];
    expect(vendedoresParaSelector(lista).map(v => v.nombre)).toEqual(['Jorge', 'Ana']);
    expect(vendedoresParaSelector(lista, 'Carlos').map(v => v.nombre)).toEqual(['Jorge', 'Carlos', 'Ana']);
    expect(vendedoresParaSelector(lista, ' Carlos ').map(v => v.nombre)).toEqual(['Jorge', 'Carlos', 'Ana']);
    expect(vendedoresParaSelector(lista, '').map(v => v.nombre)).toEqual(['Jorge', 'Ana']);
    expect(vendedoresParaSelector(null, 'X')).toEqual([]);
  });
});

describe('AC-VEN-3 AC-VEN-5 pull de vendedores con "activo"', () => {
  it('AC-VEN-3 el select remoto pide activo y el fallback no (sin pin nunca)', () => {
    expect(COLUMNAS_VENDEDOR_REMOTO.split(',')).toContain('activo');
    expect(COLUMNAS_VENDEDOR_SIN_ACTIVO.split(',')).not.toContain('activo');
    expect(COLUMNAS_VENDEDOR_SIN_ACTIVO).not.toMatch(/\bpin\b|pin_hash/);
  });

  it('AC-VEN-3 vendedorDesdeRemoto: activo=false del servidor marca inactivo (no reaparece)', () => {
    const local = { id: 2, remoteId: 8, nombre: 'Carlos', permiso: 2, createdAt: 1 };
    expect(vendedorDesdeRemoto({ id: 8, nombre: 'Carlos', permiso: 2, tiene_pin: false, activo: false }, local, 5))
      .toMatchObject({ id: 2, activo: false, tienePin: false });
    // el servidor manda: si lo reactivan a mano en Supabase, vuelve
    expect(vendedorDesdeRemoto({ id: 8, nombre: 'Carlos', activo: true }, { ...local, activo: false }, 5)).toMatchObject({ activo: true });
  });

  it('AC-VEN-5 vendedorDesdeRemoto: sin la columna (004 sin correr) conserva lo local y no inventa el campo', () => {
    expect(vendedorDesdeRemoto({ id: 8, nombre: 'Carlos' }, { id: 2, activo: false }, 5)).toMatchObject({ activo: false });
    expect(vendedorDesdeRemoto({ id: 8, nombre: 'Carlos' }, { id: 2 }, 5)).not.toHaveProperty('activo');
    expect(vendedorDesdeRemoto({ id: 8, nombre: 'Carlos', activo: null }, { id: 2 }, 5)).not.toHaveProperty('activo');
  });

  it('AC-VEN-2 el ingreso consulta el servidor: un dado de baja no entra', () => {
    expect(interpretarEstadoRemoto({ data: { id: 8, tiene_pin: false, permiso: 2, activo: false }, error: null }))
      .toMatchObject({ ok: false, motivo: 'inactivo' });
    expect(interpretarEstadoRemoto({ data: { id: 8, tiene_pin: false, permiso: 2, activo: true }, error: null })).toMatchObject({ ok: true });
    expect(interpretarEstadoRemoto({ data: { id: 8, tiene_pin: false, permiso: 2 }, error: null })).toMatchObject({ ok: true });
  });
});

describe('AC-VEN-4 AC-VEN-6 puedeDarDeBaja', () => {
  const todos = [ADMIN, ADMIN2, VEND, ARM];

  it('AC-VEN-6 un admin puede dar de baja a un vendedor o armador sincronizado', () => {
    expect(puedeDarDeBaja({ admin: ADMIN, vendedor: VEND, vendedores: todos })).toEqual({ ok: true, motivo: 'ok', mensaje: null });
    expect(puedeDarDeBaja({ admin: ADMIN, vendedor: ARM, vendedores: todos }).ok).toBe(true);
    expect(puedeDarDeBaja({ admin: ADMIN, vendedor: ADMIN2, vendedores: todos }).ok).toBe(true);
  });

  it('AC-VEN-4 no se puede dar de baja al propio admin (por id local o remoto)', () => {
    expect(puedeDarDeBaja({ admin: ADMIN, vendedor: ADMIN, vendedores: todos })).toMatchObject({ ok: false, motivo: 'propio_admin' });
    expect(puedeDarDeBaja({ admin: ADMIN, vendedor: { ...ADMIN, id: 99 }, vendedores: todos })).toMatchObject({ ok: false, motivo: 'propio_admin' });
  });

  it('AC-VEN-4 no se puede dar de baja al ultimo admin activo', () => {
    // Marta es la unica admin activa ademas de... nadie: Jorge (operador) esta de baja en la lista
    const lista = [{ ...ADMIN, activo: false }, ADMIN2, VEND];
    const operador = { id: 50, remoteId: 50, nombre: 'Otro', permiso: 1 };
    expect(puedeDarDeBaja({ admin: operador, vendedor: ADMIN2, vendedores: lista })).toMatchObject({ ok: false, motivo: 'ultimo_admin' });
    // con otro admin activo si se puede
    expect(puedeDarDeBaja({ admin: operador, vendedor: ADMIN2, vendedores: [...lista, { ...ADMIN, id: 6, remoteId: 66 }] }).ok).toBe(true);
    // un vendedor comun no es "ultimo admin"
    expect(puedeDarDeBaja({ admin: ADMIN, vendedor: VEND, vendedores: [ADMIN, VEND] }).ok).toBe(true);
  });

  it('AC-VEN-6 solo un admin activo, vendedor valido, activo y sincronizado', () => {
    expect(puedeDarDeBaja({ admin: VEND, vendedor: ARM, vendedores: todos })).toMatchObject({ motivo: 'permiso' });
    expect(puedeDarDeBaja({ admin: null, vendedor: ARM, vendedores: todos })).toMatchObject({ motivo: 'permiso' });
    expect(puedeDarDeBaja({ admin: { ...ADMIN, activo: false }, vendedor: ARM, vendedores: todos })).toMatchObject({ motivo: 'permiso' });
    expect(puedeDarDeBaja({ admin: ADMIN, vendedor: null, vendedores: todos })).toMatchObject({ motivo: 'invalido' });
    expect(puedeDarDeBaja({ admin: ADMIN, vendedor: { ...VEND, activo: false }, vendedores: todos })).toMatchObject({ motivo: 'ya_inactivo' });
    expect(puedeDarDeBaja({ admin: ADMIN, vendedor: { ...VEND, remoteId: null }, vendedores: todos })).toMatchObject({ motivo: 'sin_sincronizar' });
    expect(puedeDarDeBaja()).toMatchObject({ ok: false, motivo: 'permiso' });
  });
});

describe('AC-VEN-1 AC-VEN-5 RPC admin_baja_vendedor', () => {
  it('AC-VEN-1 argumentos de la RPC en texto (firma de la 004)', () => {
    expect(argsAdminBajaVendedor({ adminId: 7, adminPin: ' 4821 ', vendedorId: 8 }))
      .toEqual({ p_admin_id: '7', p_admin_pin: '4821', p_vendedor_id: '8' });
  });

  it('AC-VEN-1 solo { ok: true } confirma; cualquier otra respuesta es no autorizado', () => {
    expect(interpretarBajaVendedor({ data: { ok: true }, error: null })).toMatchObject({ ok: true });
    expect(interpretarBajaVendedor({ data: { ok: true, ya_inactivo: true }, error: null })).toMatchObject({ ok: true });
    expect(interpretarBajaVendedor({ data: { ok: false, motivo: 'no_autorizado' } })).toMatchObject({ ok: false, motivo: 'no_autorizado', mensaje: 'PIN de admin incorrecto.' });
    expect(interpretarBajaVendedor({ data: null })).toMatchObject({ ok: false, motivo: 'no_autorizado' });
    expect(interpretarBajaVendedor({ data: true })).toMatchObject({ ok: false, motivo: 'no_autorizado' });
    expect(interpretarBajaVendedor({ data: { ok: false, motivo: 'raro' } })).toMatchObject({ ok: false, motivo: 'no_autorizado' });
    expect(interpretarBajaVendedor()).toMatchObject({ ok: false, motivo: 'no_autorizado' });
  });

  it('AC-VEN-4 el servidor rechaza propio admin / ultimo admin con su mensaje', () => {
    expect(interpretarBajaVendedor({ data: { ok: false, motivo: 'ultimo_admin' } })).toMatchObject({ motivo: 'ultimo_admin', mensaje: expect.stringMatching(/último admin/) });
    expect(interpretarBajaVendedor({ data: { ok: false, motivo: 'propio_admin' } })).toMatchObject({ motivo: 'propio_admin' });
    expect(interpretarBajaVendedor({ data: { ok: false, motivo: 'no_existe' } })).toMatchObject({ motivo: 'no_existe' });
  });

  it('AC-VEN-5 RPC o columna inexistente => "Falta la migración 004 en Supabase"', () => {
    for (const error of [
      { code: 'PGRST202', message: 'Could not find the function public.admin_baja_vendedor' },
      { code: '42883', message: 'function public.admin_baja_vendedor(text, text, text) does not exist' },
      { code: '42703', message: 'column "activo" does not exist' },
    ]) {
      expect(interpretarBajaVendedor({ data: null, error })).toEqual({ ok: false, motivo: 'falta_migracion', mensaje: MSG_FALTA_MIGRACION_004 });
    }
    expect(MSG_FALTA_MIGRACION_004).toMatch(/^Falta la migración 004 en Supabase/);
  });

  it('AC-VEN-1 red caida, bloqueo por intentos y otros errores', () => {
    expect(interpretarBajaVendedor({ error: { message: 'TypeError: Failed to fetch' } })).toMatchObject({ motivo: 'sin_conexion' });
    expect(interpretarBajaVendedor({ error: { code: 'P0001', message: 'Demasiados intentos. Proba de nuevo en 15 minutos.' } })).toMatchObject({ motivo: 'bloqueado', mensaje: MSG_BLOQUEADO });
    expect(interpretarBajaVendedor({ error: { code: '42501', message: 'permission denied' } })).toMatchObject({ motivo: 'error', mensaje: expect.stringMatching(/permission denied/) });
  });
});
