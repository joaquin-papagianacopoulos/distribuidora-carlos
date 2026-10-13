// QA RUN 20261012-2106 — REQ-VEN / S-COM-18: un vendedor dado de baja intenta
// ingresar desde un dispositivo que NO sincronizo (todavia lo ve activo).
// Servidor falso con ESTADO (filas + pin + rpc verificar_pin / admin_baja_vendedor)
// y IndexedDB falsa, con el dominio y el servicio reales.
// Funciones planas (CRA usa resetMocks).
const mockLocal = { vendedores: [], updates: [] };
jest.mock('../../db', () => ({
  getVendedores: async () => mockLocal.vendedores.map(v => ({ ...v })),
  putVendedoresBatch: async (rows) => {
    for (const r of rows) {
      const i = mockLocal.vendedores.findIndex(x => x.id !== undefined && x.id === r.id);
      if (i >= 0) mockLocal.vendedores[i] = { ...r };
      else mockLocal.vendedores.push({ ...r, id: r.id ?? 100 + mockLocal.vendedores.length });
    }
  },
  addVendedor: async () => 99,
  updateVendedor: async (v) => { mockLocal.updates.push({ ...v }); mockLocal.vendedores = mockLocal.vendedores.map(x => (x.id === v.id ? { ...v } : x)); },
  deleteVendedor: async () => { throw new Error('nunca se borra'); },
}));
jest.mock('../../services/imageSearch', () => ({
  isImageSearchConfigured: () => false, fetchProductImage: jest.fn(), ImageSearchQuotaError: class extends Error {},
}));

// Servidor: remoto[] con { id, nombre, zona, permiso, activo, pin } (pin en claro SOLO
// dentro del servidor falso; nunca se devuelve en un select).
const mockSb = { remoto: [], rpcLog: [], selectLog: [], red: true, sinActivo: false, verificarSiempreTrue: false };
const proyectar = (fila, cols) => Object.fromEntries(cols.split(',').map(c => {
  if (c === 'tiene_pin') return [c, fila.pin != null];
  return [c, fila[c]];
}).filter(([c]) => !(mockSb.sinActivo && c === 'activo')));
jest.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: (fn, args) => {
      mockSb.rpcLog.push({ fn, args });
      if (!mockSb.red) return Promise.reject(new TypeError('Failed to fetch'));
      if (fn === 'verificar_pin') {
        const f = mockSb.remoto.find(x => String(x.id) === args.p_vendedor_id);
        // como la 002: sin pin_hash => false
        const ok = mockSb.verificarSiempreTrue ? true : !!f && f.pin != null && f.pin === args.p_pin;
        return Promise.resolve({ data: ok, error: null });
      }
      if (fn === 'admin_baja_vendedor') {
        const admin = mockSb.remoto.find(x => String(x.id) === args.p_admin_id);
        if (!admin || admin.permiso !== 1 || admin.activo === false || admin.pin !== args.p_admin_pin) return Promise.resolve({ data: { ok: false, motivo: 'no_autorizado' }, error: null });
        const f = mockSb.remoto.find(x => String(x.id) === args.p_vendedor_id);
        if (!f) return Promise.resolve({ data: { ok: false, motivo: 'no_existe' }, error: null });
        f.activo = false; f.pin = null;
        return Promise.resolve({ data: { ok: true }, error: null });
      }
      return Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
    },
    from: () => {
      const q = { cols: '', id: null };
      const api = {
        select: (cols) => { q.cols = cols; mockSb.selectLog.push(cols); return api; },
        eq: (_c, v) => { q.id = v; return api; },
        range: () => api,
        maybeSingle: () => {
          if (!mockSb.red) return Promise.reject(new TypeError('Failed to fetch'));
          if (mockSb.sinActivo && /activo/.test(q.cols)) return Promise.resolve({ data: null, error: { code: '42703', message: 'column vendedores.activo does not exist' } });
          const f = mockSb.remoto.find(x => String(x.id) === String(q.id));
          return Promise.resolve({ data: f ? proyectar(f, q.cols) : null, error: null });
        },
        then: (res, rej) => {
          if (mockSb.sinActivo && /activo/.test(q.cols)) return Promise.resolve({ data: null, error: { code: '42703', message: 'column vendedores.activo does not exist' } }).then(res, rej);
          return Promise.resolve({ data: mockSb.remoto.map(f => proyectar(f, q.cols)), error: null }).then(res, rej);
        },
      };
      return api;
    },
  },
}));

// eslint-disable-next-line import/first
import { iniciarIngreso, ingresarConPin, verificarPinIngreso, darDeBajaVendedorAdmin } from '../vendedoresService';
// eslint-disable-next-line import/first
import { downloadVendedores } from '../../sync/syncService';
// eslint-disable-next-line import/first
import { filtrarActivos, vendedoresParaSelector, MSG_DADO_DE_BAJA } from '../../domain/vendedores';

const ADMIN_LOCAL = { id: 1, remoteId: 7, nombre: 'Jorge', permiso: 1, tienePin: true };
// Dispositivo B: nunca se entero de la baja de Carlos.
const carlosLocal = (extra = {}) => ({ id: 2, remoteId: 8, nombre: 'Carlos', zona: 'Norte', permiso: 2, tienePin: true, createdAt: 3, ...extra });

beforeEach(() => {
  mockLocal.vendedores = [{ ...ADMIN_LOCAL }, carlosLocal()];
  mockLocal.updates = [];
  Object.assign(mockSb, {
    remoto: [
      { id: 7, nombre: 'Jorge', zona: '', permiso: 1, activo: true, pin: '4821' },
      { id: 8, nombre: 'Carlos', zona: 'Norte', permiso: 2, activo: true, pin: '1234' },
      { id: 9, nombre: 'Sin Pin', zona: '', permiso: 2, activo: true, pin: null },
    ],
    rpcLog: [], selectLog: [], red: true, sinActivo: false, verificarSiempreTrue: false,
  });
});

const bajaEnServidor = async () => {
  const r = await darDeBajaVendedorAdmin({ admin: ADMIN_LOCAL, adminPin: '4821', vendedor: { id: 2, remoteId: 8, nombre: 'Carlos', permiso: 2, tienePin: true }, vendedores: [ADMIN_LOCAL, carlosLocal()], online: true });
  expect(r.ok).toBe(true);
  // la baja actualizo ESTE dispositivo (el A); el B (el que prueba) se reconstruye viejo:
  mockLocal.vendedores = [{ ...ADMIN_LOCAL }, carlosLocal()];
  mockLocal.updates = [];
  mockSb.rpcLog = [];
  mockSb.selectLog = [];
};

describe('AC-VEN-2 AC-SEC-4 login de un vendedor dado de baja desde un dispositivo sin sincronizar', () => {
  it('AC-VEN-2 el servidor dejo a Carlos sin PIN y activo=false (precondicion del escenario)', async () => {
    await bajaEnServidor();
    expect(mockSb.remoto.find(x => x.id === 8)).toMatchObject({ activo: false, pin: null });
  });

  it('AC-VEN-2 local con tienePin=true: pide PIN, el PIN viejo ya no sirve y no se escribe nada local', async () => {
    await bajaEnServidor();
    const loc = mockLocal.vendedores.find(v => v.id === 2);
    const paso1 = await iniciarIngreso(loc, { online: true });
    expect(paso1.accion).toBe('pedir_pin');
    const r = await ingresarConPin(loc, '1234', { online: true });
    expect(r).toMatchObject({ ok: false, motivo: 'pin_incorrecto' });
    expect(r.vendedor).toBeUndefined();
    expect(mockLocal.updates).toEqual([]);
    expect(mockSb.selectLog).toEqual([]); // ni siquiera lee la fila despues de un PIN malo
  });

  it('AC-VEN-2 local con tienePin=false (vendedor sin PIN): el servidor dice inactivo, no entra ni persiste', async () => {
    mockLocal.vendedores.push({ id: 3, remoteId: 9, nombre: 'Sin Pin', permiso: 2, tienePin: false });
    mockSb.remoto.find(x => x.id === 9).activo = false;
    const r = await iniciarIngreso(mockLocal.vendedores.find(v => v.id === 3), { online: true });
    expect(r).toMatchObject({ accion: 'inactivo', mensaje: MSG_DADO_DE_BAJA });
    expect(r.vendedor).toBeUndefined();
    expect(mockLocal.updates).toEqual([]);
  });

  it('AC-VEN-2 S-COM-18 hasta con un verificar_pin que dijera true (servidor viejo/roto), la fila activo=false lo frena y no persiste', async () => {
    await bajaEnServidor();
    mockSb.verificarSiempreTrue = true;
    const loc = mockLocal.vendedores.find(v => v.id === 2);
    const r = await ingresarConPin(loc, '0000', { online: true });
    expect(r).toMatchObject({ ok: false, motivo: 'inactivo', mensaje: MSG_DADO_DE_BAJA });
    expect(mockLocal.updates).toEqual([]);
  });

  it('AC-VEN-2 sin la 004 en el servidor (no hay columna activo) el flujo no se rompe: entra solo con PIN valido', async () => {
    mockSb.sinActivo = true;
    const loc = mockLocal.vendedores.find(v => v.id === 2);
    const mal = await ingresarConPin(loc, '9999', { online: true });
    expect(mal).toMatchObject({ ok: false, motivo: 'pin_incorrecto' });
    const ok = await ingresarConPin(loc, '1234', { online: true });
    expect(ok).toMatchObject({ ok: true, vendedor: { nombre: 'Carlos', permiso: 2, remoteId: 8, id: 2 } });
    expect(ok.vendedor).not.toHaveProperty('activo');
  });

  it('AC-VEN-2 la fila del servidor desapareció (borrada a mano): no_existe, no entra', async () => {
    mockSb.remoto = mockSb.remoto.filter(x => x.id !== 8);
    const loc = mockLocal.vendedores.find(v => v.id === 2);
    mockSb.verificarSiempreTrue = true;
    expect(await ingresarConPin(loc, '1234', { online: true })).toMatchObject({ ok: false, motivo: 'no_existe' });
    mockLocal.vendedores[1] = { ...loc, tienePin: false };
    expect(await iniciarIngreso(mockLocal.vendedores[1], { online: true })).toMatchObject({ accion: 'no_existe' });
    expect(mockLocal.updates).toEqual([]);
  });

  it('AC-VEN-2 red caida justo al consultar: no entra (fail-closed) y no persiste', async () => {
    mockLocal.vendedores[1] = carlosLocal({ tienePin: false });
    mockSb.red = false;
    expect(await iniciarIngreso(mockLocal.vendedores[1], { online: true })).toMatchObject({ accion: 'sin_conexion' });
    expect(mockLocal.updates).toEqual([]);
  });

  it('AC-VEN-3 despues de sincronizar (pull), Carlos queda inactivo, sin PIN y fuera de ingreso/selectores, y un objeto viejo en la pantalla de ingreso igual es rechazado por el servidor', async () => {
    await bajaEnServidor();
    await downloadVendedores();
    const carlos = mockLocal.vendedores.find(v => v.id === 2);
    expect(carlos).toMatchObject({ activo: false, tienePin: false, nombre: 'Carlos', remoteId: 8 });
    expect(mockLocal.vendedores).toHaveLength(3); // el pull no duplica ni borra (Sin Pin llega nuevo)
    expect(filtrarActivos(mockLocal.vendedores).map(v => v.nombre)).not.toContain('Carlos');
    expect(vendedoresParaSelector(mockLocal.vendedores, null).map(v => v.nombre)).not.toContain('Carlos');
    // ...pero el historial lo sigue pudiendo nombrar (se conserva el ya elegido)
    expect(vendedoresParaSelector(mockLocal.vendedores, 'Carlos').map(v => v.nombre)).toContain('Carlos');
    // y aunque la pantalla de ingreso todavia tuviera el objeto viejo, el servidor manda:
    mockSb.rpcLog = [];
    const r = await iniciarIngreso({ ...carlos, activo: undefined, tienePin: false }, { online: true });
    expect(r.accion).toBe('inactivo');
  });

  it('AC-VEN-2 el PIN no queda en ningun registro local ni en el log de llamadas del select', async () => {
    const loc = mockLocal.vendedores.find(v => v.id === 2);
    const ok = await ingresarConPin(loc, '1234', { online: true });
    expect(ok.ok).toBe(true);
    expect(JSON.stringify(mockLocal.vendedores)).not.toContain('1234');
    expect(JSON.stringify(mockLocal.updates)).not.toContain('1234');
    expect(JSON.stringify(ok)).not.toContain('1234');
    expect(mockSb.selectLog.every(c => !/\bpin(_hash)?\b/.test(c))).toBe(true);
  });

  it('AC-VEN-2 un vendedor activo del mismo dispositivo sigue entrando normalmente (no se rompio el camino feliz)', async () => {
    const loc = mockLocal.vendedores.find(v => v.id === 2);
    expect(await verificarPinIngreso(loc, '1234', { online: true })).toMatchObject({ ok: true });
    const r = await ingresarConPin(loc, '1234', { online: true });
    expect(r).toMatchObject({ ok: true, vendedor: { id: 2, remoteId: 8, nombre: 'Carlos', permiso: 2, activo: true, tienePin: true } });
  });
});

describe('AC-VEN-1 AC-VEN-4 secuencia completa de bajas', () => {
  it('AC-VEN-4 AC-VEN-1 lista local vieja: dar de baja a un admin que el servidor ya tenia inactivo es idempotente y no toca al admin que opera', async () => {
    // El cliente cree que hay otro admin (lista vieja) pero en el servidor ya no.
    const otro = { id: 5, remoteId: 11, nombre: 'Marta', permiso: 1, tienePin: true };
    mockSb.remoto.push({ id: 11, nombre: 'Marta', zona: '', permiso: 1, activo: false, pin: null });
    const r = await darDeBajaVendedorAdmin({ admin: ADMIN_LOCAL, adminPin: '4821', vendedor: otro, vendedores: [ADMIN_LOCAL, otro], online: true });
    // Marta ya estaba inactiva en el servidor: el RPC falso la deja inactiva sin romper nada y el local se marca igual.
    expect(r.ok).toBe(true);
    expect(mockSb.remoto.find(x => x.id === 11)).toMatchObject({ activo: false, pin: null });
    expect(mockSb.remoto.find(x => x.id === 7).activo).toBe(true);
  });

  it('AC-VEN-1 AC-VEN-2 baja idempotente: darla dos veces no rompe y no borra el registro local', async () => {
    const carlos = carlosLocal();
    const a = await darDeBajaVendedorAdmin({ admin: ADMIN_LOCAL, adminPin: '4821', vendedor: carlos, vendedores: [ADMIN_LOCAL, carlos], online: true });
    expect(a.ok).toBe(true);
    const inactivo = mockLocal.vendedores.find(v => v.id === 2);
    expect(inactivo).toMatchObject({ activo: false });
    // segunda vez: el cliente ya la frena como "ya_inactivo" (no llama al servidor)
    mockSb.rpcLog = [];
    const b = await darDeBajaVendedorAdmin({ admin: ADMIN_LOCAL, adminPin: '4821', vendedor: inactivo, vendedores: mockLocal.vendedores, online: true });
    expect(b).toMatchObject({ ok: false, motivo: 'ya_inactivo' });
    expect(mockSb.rpcLog).toEqual([]);
    expect(mockLocal.vendedores).toHaveLength(2);
  });
});
