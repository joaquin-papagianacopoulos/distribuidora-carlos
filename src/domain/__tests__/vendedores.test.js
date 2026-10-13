// S-COM-13 (RUN 20261007-2022, iteracion 3): login 100 % online y PIN fuera del dispositivo.
import {
  tienePin, sinPinLocal, tieneCamposSecretos, vendedorDesdeRemoto, decidirIngreso,
  interpretarVerificacionPin, interpretarEstadoRemoto, validarFormVendedor,
  argsAdminGuardarVendedor, interpretarGuardarVendedor, esErrorDeConexion,
  COLUMNAS_VENDEDOR_REMOTO, COLUMNAS_VENDEDOR_LEGACY,
  MSG_SIN_CONEXION, MSG_BLOQUEADO, MSG_FALTA_MIGRACION, MSG_SIN_SINCRONIZAR,
  vendedorDeSesion, interpretarFilaIngreso, MSG_NO_CONFIRMADO, MSG_DADO_DE_BAJA,
} from '../vendedores';

describe('AC-SEC-4 S-COM-13 el PIN no queda en el dispositivo', () => {
  it('AC-SEC-4 S-COM-13 tienePin: flag nuevo, columna remota o pin legacy no vacio', () => {
    expect(tienePin({ tienePin: true })).toBe(true);
    expect(tienePin({ tiene_pin: true })).toBe(true);
    expect(tienePin({ pin: '1234' })).toBe(true);
    expect(tienePin({ pin: 1234 })).toBe(true);
    expect(tienePin({ pin: '  ' })).toBe(false);
    expect(tienePin({ pin: null })).toBe(false);
    expect(tienePin({ pin: {} })).toBe(false);
    expect(tienePin({ tienePin: 'true' })).toBe(false);
    expect(tienePin(null)).toBe(false);
  });

  it('AC-SEC-4 S-COM-13 sinPinLocal quita pin/pin_hash, conserva el resto y deja tienePin', () => {
    const v = { id: 3, remoteId: 9, nombre: 'Jorge', permiso: 1, zona: 'N', pin: '4321', pin_hash: 'x', pinHash: 'y', tiene_pin: true, createdAt: 5 };
    const out = sinPinLocal(v);
    expect(out).toEqual({ id: 3, remoteId: 9, nombre: 'Jorge', permiso: 1, zona: 'N', tienePin: true, createdAt: 5 });
    expect(JSON.stringify(out)).not.toContain('4321');
    expect(v.pin).toBe('4321'); // no muta la entrada
    expect(sinPinLocal({ id: 1, pin: '' })).toEqual({ id: 1, tienePin: false });
    expect(sinPinLocal(null)).toBeNull();
    expect(sinPinLocal('x')).toBe('x');
  });

  it('AC-SEC-4 S-COM-13 tieneCamposSecretos detecta registros por migrar', () => {
    expect(tieneCamposSecretos({ pin: null })).toBe(true);
    expect(tieneCamposSecretos({ pin_hash: 'h' })).toBe(true);
    expect(tieneCamposSecretos({ tienePin: true })).toBe(false);
    expect(tieneCamposSecretos(null)).toBe(false);
  });

  it('AC-SEC-4 S-COM-13 el select remoto es explicito y nunca pide pin', () => {
    // REQ-VEN (AC-VEN-3): se agrega "activo" (baja logica de la 004).
    expect(COLUMNAS_VENDEDOR_REMOTO.split(',')).toEqual(['id', 'nombre', 'zona', 'permiso', 'tiene_pin', 'activo']);
    expect(COLUMNAS_VENDEDOR_LEGACY.split(',')).not.toContain('pin');
    expect(COLUMNAS_VENDEDOR_REMOTO).not.toMatch(/\*|\bpin\b|pin_hash/);
  });

  it('AC-SEC-4 S-COM-13 vendedorDesdeRemoto: usa tiene_pin, ignora pin remoto y borra el local', () => {
    const local = { id: 1, remoteId: 7, nombre: 'Viejo', permiso: 2, pin: '1111', createdAt: 10 };
    const r = vendedorDesdeRemoto({ id: 7, nombre: 'Jorge', zona: null, permiso: 1, tiene_pin: true, pin: '9999' }, local, 99);
    expect(r).toEqual({ id: 1, remoteId: 7, nombre: 'Jorge', zona: '', permiso: 1, tienePin: true, createdAt: 10 });
    expect(JSON.stringify(r)).not.toMatch(/1111|9999/);
  });

  it('AC-SEC-4 S-COM-13 vendedorDesdeRemoto tolera que falte tiene_pin (002 sin correr) y permisos raros', () => {
    expect(vendedorDesdeRemoto({ id: 2, nombre: 'A', permiso: 3 }, { tienePin: true }, 1)).toMatchObject({ tienePin: true, permiso: 3, remoteId: 2, createdAt: 1 });
    expect(vendedorDesdeRemoto({ id: 2, nombre: 'A' }, null, 1)).toMatchObject({ tienePin: false, permiso: 2, zona: '' });
    expect(vendedorDesdeRemoto({ id: 2, nombre: 'A', permiso: 99, tiene_pin: false }, { permiso: 1 }, 1)).toMatchObject({ permiso: 2, tienePin: false });
    expect(vendedorDesdeRemoto({ id: 2, permiso: '1' }, { nombre: 'Local' }, 1)).toMatchObject({ permiso: 1, nombre: 'Local' });
    expect(vendedorDesdeRemoto(null, null, 1)).toMatchObject({ nombre: '', permiso: 2, tienePin: false });
  });
});

describe('AC-SEC-4 S-COM-13 ingreso 100 % online', () => {
  it('AC-SEC-4 S-COM-13 sin conexion no se entra, con o sin PIN', () => {
    for (const v of [{ remoteId: 1, tienePin: true }, { remoteId: 1 }, { nombre: 'local' }]) {
      expect(decidirIngreso(v, { online: false })).toEqual({ accion: 'sin_conexion', mensaje: MSG_SIN_CONEXION });
      expect(decidirIngreso(v, {})).toMatchObject({ accion: 'sin_conexion' });
    }
    expect(MSG_SIN_CONEXION).toMatch(/Necesitás conexión para ingresar/);
  });

  it('AC-SEC-4 S-COM-13 con conexion: PIN => pedir_pin; sin PIN => consultar al servidor; solo-local => entrar', () => {
    expect(decidirIngreso({ remoteId: 5, tienePin: true }, { online: true }).accion).toBe('pedir_pin');
    expect(decidirIngreso({ remoteId: 5, tienePin: false }, { online: true }).accion).toBe('consultar');
    expect(decidirIngreso({ remoteId: 0 }, { online: true }).accion).toBe('consultar');
    expect(decidirIngreso({ remoteId: null }, { online: true }).accion).toBe('entrar');
    expect(decidirIngreso({ remoteId: '', tienePin: true }, { online: true })).toEqual({ accion: 'sin_sincronizar', mensaje: MSG_SIN_SINCRONIZAR });
    expect(decidirIngreso(null, { online: true }).accion).toBe('invalido');
  });

  it('AC-SEC-4 S-COM-13 interpretarVerificacionPin: solo data === true habilita', () => {
    expect(interpretarVerificacionPin({ data: true, error: null })).toMatchObject({ ok: true });
    for (const data of [false, null, 'true', 1, {}]) {
      expect(interpretarVerificacionPin({ data, error: null })).toMatchObject({ ok: false, motivo: 'pin_incorrecto' });
    }
    expect(interpretarVerificacionPin()).toMatchObject({ ok: false });
  });

  it('AC-SEC-4 S-COM-13 interpretarVerificacionPin: bloqueo por intentos, falta de migracion, red y otros', () => {
    expect(interpretarVerificacionPin({ error: { code: 'P0001', message: 'Demasiados intentos. Proba de nuevo en 15 minutos.' } }))
      .toEqual({ ok: false, motivo: 'bloqueado', mensaje: MSG_BLOQUEADO });
    expect(interpretarVerificacionPin({ error: { code: 'PGRST202', message: 'x' } })).toEqual({ ok: false, motivo: 'falta_migracion', mensaje: MSG_FALTA_MIGRACION });
    expect(interpretarVerificacionPin({ error: { code: '42883', message: 'x' } }).motivo).toBe('falta_migracion');
    expect(interpretarVerificacionPin({ error: { message: 'TypeError: Failed to fetch' } }).motivo).toBe('sin_conexion');
    expect(interpretarVerificacionPin({ error: { code: '500', message: 'network down' } }).motivo).toBe('sin_conexion');
    expect(interpretarVerificacionPin({ error: { code: '500', message: 'boom' } }).motivo).toBe('error');
  });

  it('AC-SEC-4 S-COM-13 esErrorDeConexion', () => {
    expect(esErrorDeConexion(null)).toBe(false);
    expect(esErrorDeConexion({})).toBe(true);
    expect(esErrorDeConexion({ code: 'X', message: 'Load failed' })).toBe(true);
    expect(esErrorDeConexion({ code: 'X', message: 'otra' })).toBe(false);
  });

  it('AC-SEC-4 S-COM-13 interpretarEstadoRemoto', () => {
    expect(interpretarEstadoRemoto({ data: { tiene_pin: true, permiso: 1 } })).toEqual({ ok: true, tienePin: true, permiso: 1 });
    expect(interpretarEstadoRemoto({ data: { tiene_pin: 'si', permiso: 'x' } })).toEqual({ ok: true, tienePin: false, permiso: 2 });
    expect(interpretarEstadoRemoto({ data: null })).toMatchObject({ ok: false, motivo: 'no_existe' });
    expect(interpretarEstadoRemoto({ error: { message: 'Failed to fetch' } })).toMatchObject({ ok: false, motivo: 'sin_conexion' });
    expect(interpretarEstadoRemoto({ error: { code: '42501', message: 'permission denied' } })).toMatchObject({ ok: false, motivo: 'error' });
    expect(interpretarEstadoRemoto()).toMatchObject({ ok: false, motivo: 'no_existe' });
  });
});

describe('AC-SEC-2 S-COM-13 alta/edicion de vendedores por admin_guardar_vendedor', () => {
  it('AC-SEC-2 S-COM-13 valida nombre, zona, permiso y PIN de 4 a 8 digitos', () => {
    expect(validarFormVendedor({ nombre: ' Ana ', zona: ' Sur ', permiso: 3, pin: '' })).toEqual({
      ok: true, errores: {}, datos: { nombre: 'Ana', zona: 'Sur', permiso: 3, pinNuevo: null, borrarPin: false, tienePin: false },
    });
    expect(validarFormVendedor({ nombre: '', permiso: 2 }).errores.nombre).toBeTruthy();
    expect(validarFormVendedor({ nombre: 'x'.repeat(121), permiso: 2 }).errores.nombre).toMatch(/120/);
    expect(validarFormVendedor({ nombre: 'A', zona: 'z'.repeat(81), permiso: 2 }).errores.zona).toBeTruthy();
    expect(validarFormVendedor({ nombre: 'A', permiso: 7 }).errores.permiso).toBeTruthy();
    for (const pin of ['123', '123456789', '12a4', '=1+2']) {
      expect(validarFormVendedor({ nombre: 'A', permiso: 2, pin }).errores.pin).toMatch(/4 y 8/);
    }
    expect(validarFormVendedor({ nombre: 'A', permiso: 2, pin: ' 1234 ' }).datos).toMatchObject({ pinNuevo: '1234', tienePin: true });
    expect(validarFormVendedor(null).ok).toBe(false);
  });

  it('AC-SEC-2 S-COM-13 aviso operativo: un admin (permiso 1) tiene que quedar con PIN', () => {
    expect(validarFormVendedor({ nombre: 'Nuevo admin', permiso: 1 }).errores.pin).toMatch(/admin tiene que tener PIN/);
    expect(validarFormVendedor({ nombre: 'Nuevo admin', permiso: 1, pin: '123456' }).datos).toMatchObject({ permiso: 1, pinNuevo: '123456' });
    // edicion de un admin que ya tiene PIN: no hace falta reescribirlo
    expect(validarFormVendedor({ nombre: 'Jorge', permiso: 1 }, { remoteId: 1, tienePin: true }).ok).toBe(true);
    // quitarle el PIN a un admin no se permite
    expect(validarFormVendedor({ nombre: 'Jorge', permiso: 1, clearPin: true }, { remoteId: 1, tienePin: true }).errores.pin).toBeTruthy();
    // a un vendedor si
    expect(validarFormVendedor({ nombre: 'C', permiso: 2, clearPin: true, pin: '9999' }, { remoteId: 2, tienePin: true }).datos)
      .toMatchObject({ borrarPin: true, pinNuevo: null, tienePin: false });
    // clearPin sin previo (alta) se ignora
    expect(validarFormVendedor({ nombre: 'C', permiso: 2, clearPin: true }).datos.borrarPin).toBe(false);
  });

  it('AC-SEC-2 S-COM-13 argsAdminGuardarVendedor respeta la firma de la 002', () => {
    const datos = { nombre: 'A', zona: '', permiso: 1, pinNuevo: '1234', borrarPin: false };
    expect(argsAdminGuardarVendedor({ adminId: 7, adminPin: '0000', vendedorId: null, datos })).toEqual({
      p_admin_id: '7', p_admin_pin: '0000', p_vendedor_id: null, p_nombre: 'A', p_zona: '', p_permiso: 1, p_pin_nuevo: '1234', p_borrar_pin: false,
    });
    expect(argsAdminGuardarVendedor({ adminId: 7, adminPin: null, vendedorId: 12, datos: { ...datos, borrarPin: true } }))
      .toMatchObject({ p_admin_pin: '', p_vendedor_id: '12', p_borrar_pin: true });
    expect(argsAdminGuardarVendedor({ adminId: 7, datos }).p_vendedor_id).toBeNull();
    expect(argsAdminGuardarVendedor({ adminId: 7, vendedorId: '', datos }).p_vendedor_id).toBeNull();
  });

  it('AC-SEC-2 S-COM-13 S-COM-16 interpretarGuardarVendedor: null = no autorizado (sin distinguir por que)', () => {
    expect(interpretarGuardarVendedor({ data: '15' })).toEqual({ ok: true, id: '15' });
    expect(interpretarGuardarVendedor({ data: 15 })).toEqual({ ok: true, id: '15' });
    for (const data of [null, undefined, '']) {
      expect(interpretarGuardarVendedor({ data })).toMatchObject({ ok: false, motivo: 'no_autorizado' });
    }
    expect(interpretarGuardarVendedor({ error: { message: 'Solo un admin con PIN puede cambiar roles o PINs' , code: 'P0001' } }).motivo).toBe('no_autorizado');
    expect(interpretarGuardarVendedor({ error: { code: 'P0001', message: 'Demasiados intentos.' } }).motivo).toBe('bloqueado');
    expect(interpretarGuardarVendedor({ error: { code: 'PGRST202', message: 'x' } }).motivo).toBe('falta_migracion');
    expect(interpretarGuardarVendedor({ error: { message: 'Failed to fetch' } }).motivo).toBe('sin_conexion');
    expect(interpretarGuardarVendedor({ error: { code: 'P0001', message: 'El PIN debe tener entre 4 y 8 digitos' } }))
      .toMatchObject({ ok: false, motivo: 'error', mensaje: expect.stringMatching(/4 y 8/) });
    expect(interpretarGuardarVendedor()).toMatchObject({ ok: false, motivo: 'no_autorizado' });
  });
});

// C5 (RUN 20261012-2106) — S-COM-18: la sesión se arma con la fila del servidor.
describe('AC-SEC-4 S-COM-18 vendedorDeSesion / interpretarFilaIngreso', () => {
  const LOCAL = { id: 2, remoteId: 99, nombre: 'Forjado', zona: 'X', permiso: 1, tienePin: false, createdAt: 3, pin: '1234', pin_hash: 'h' };

  it('AC-SEC-4 S-COM-18 vendedorDeSesion toma permiso/nombre/zona del servidor e ignora el permiso local', () => {
    const s = vendedorDeSesion(LOCAL, { id: 8, nombre: ' Carlos ', zona: 'Sur', permiso: 2, tiene_pin: true, activo: true, pin_hash: 'zzz' });
    expect(s).toEqual({ id: 2, createdAt: 3, nombre: 'Carlos', zona: 'Sur', permiso: 2, tienePin: true, remoteId: 8, activo: true });
    expect(s).not.toHaveProperty('pin');
    expect(s).not.toHaveProperty('pin_hash');
  });

  it('AC-SEC-4 S-COM-18 activo false o fila ausente => null; permiso inválido => 2', () => {
    expect(vendedorDeSesion(LOCAL, { id: 8, nombre: 'C', permiso: 1, activo: false })).toBeNull();
    expect(vendedorDeSesion(LOCAL, null)).toBeNull();
    expect(vendedorDeSesion(LOCAL, undefined)).toBeNull();
    expect(vendedorDeSesion(LOCAL, [1])).toBeNull();
    expect(vendedorDeSesion(LOCAL, 'fila')).toBeNull();
    expect(vendedorDeSesion(LOCAL, { id: 8, nombre: 'C', permiso: 'admin' }).permiso).toBe(2);
    expect(vendedorDeSesion(LOCAL, { id: 8, nombre: 'C', permiso: 9 }).permiso).toBe(2);
    expect(vendedorDeSesion(LOCAL, { id: 8, nombre: 'C', permiso: 3 }).permiso).toBe(3);
  });

  it('AC-SEC-4 S-COM-18 sin local, sin nombre/zona/tiene_pin/activo en la fila: valores neutros', () => {
    expect(vendedorDeSesion(null, { id: 8, permiso: 2 })).toEqual({ nombre: '', zona: '', permiso: 2, tienePin: false, remoteId: 8 });
    // Si el servidor no manda nombre, se conserva el local (no queda la sesión sin nombre).
    expect(vendedorDeSesion({ id: 1, nombre: 'Local' }, { id: 8, permiso: 2, nombre: null, zona: null, activo: null })).toEqual({
      id: 1, nombre: 'Local', zona: '', permiso: 2, tienePin: false, remoteId: 8,
    });
  });

  it('AC-SEC-4 S-COM-18 decidirIngreso: el solo-local entra con permiso 2', () => {
    expect(decidirIngreso({ id: 5, nombre: 'L', permiso: 1 }, { online: true })).toEqual({ accion: 'entrar', mensaje: null, permiso: 2 });
    expect(decidirIngreso({ id: 5, nombre: 'L', permiso: 1, remoteId: '' }, { online: true })).toMatchObject({ permiso: 2 });
  });

  it('AC-SEC-4 S-COM-18 interpretarFilaIngreso: red, error, sin fila, inactivo, ok', () => {
    expect(interpretarFilaIngreso({ data: null, error: { message: 'Failed to fetch' } })).toEqual({ ok: false, motivo: 'sin_conexion', mensaje: MSG_NO_CONFIRMADO });
    expect(interpretarFilaIngreso({ data: null, error: { code: '42501', message: 'permission denied' } })).toEqual({ ok: false, motivo: 'error', mensaje: MSG_NO_CONFIRMADO });
    expect(interpretarFilaIngreso({ data: null, error: null })).toMatchObject({ ok: false, motivo: 'no_existe' });
    expect(interpretarFilaIngreso({ data: [], error: null })).toMatchObject({ ok: false, motivo: 'no_existe' });
    expect(interpretarFilaIngreso({ data: { id: 1, activo: false }, error: null })).toEqual({ ok: false, motivo: 'inactivo', mensaje: MSG_DADO_DE_BAJA });
    const fila = { id: 1, activo: true };
    expect(interpretarFilaIngreso({ data: fila, error: null })).toEqual({ ok: true, motivo: 'ok', mensaje: null, fila });
    expect(interpretarFilaIngreso()).toMatchObject({ ok: false, motivo: 'no_existe' });
    expect(MSG_NO_CONFIRMADO).toBe('No se pudo confirmar tu usuario. Probá de nuevo.');
  });
});
