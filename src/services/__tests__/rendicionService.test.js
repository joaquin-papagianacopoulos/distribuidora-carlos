// REQ-REN (AC-REN-1..4): orquestacion de la rendicion con IndexedDB y Supabase falsos.
const mockDb = { rends: [], cuenta: [], movs: [], deudas: [] };
const mockSb = { rpc: [], respuestas: {} };
const mockDeuda = { cobros: [], creadas: [], anuladas: [], ajustadas: [] };

jest.mock('../../db', () => {
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const putIn = (key) => async (rows) => {
    for (const row of rows || []) {
      const i = mockDb[key].findIndex(r => r.id === row.id);
      if (i >= 0) mockDb[key][i] = clone(row); else mockDb[key].push(clone(row));
    }
  };
  return {
    getRendiciones: async () => clone(mockDb.rends),
    putRendicionesRaw: async (rows) => putIn('rends')(rows),
    getCuentaClientes: async () => clone(mockDb.cuenta),
    putCuentaClientesRaw: async (rows) => putIn('cuenta')(rows),
    clearCuentaClientesPendingSync: async (ids) => { const s = new Set(ids); mockDb.cuenta = mockDb.cuenta.map(c => (s.has(c.id) ? { ...c, pendingSync: false } : c)); },
    addRendicionConMovimientos: async (r, movs) => {
      if (mockDb.rends.some(x => x.id === r.id)) throw new Error('ConstraintError');
      mockDb.rends.push(clone({ ...r, pendingSync: true }));
      movs.forEach(m => mockDb.movs.push({ ...m, pendingSync: true }));
    },
    addMovimientosStock: async (movs) => putIn('movs')(movs.map(m => ({ ...m, pendingSync: true }))),
    clearMovimientosPendingSync: async (ids) => { const s = new Set(ids); mockDb.movs = mockDb.movs.map(m => (s.has(m.id) ? { ...m, pendingSync: false } : m)); },
    getMovimientosStock: async () => clone(mockDb.movs),
    getDeudas: async () => clone(mockDb.deudas),
  };
});

jest.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: (fn, args) => {
      mockSb.rpc.push({ fn, args });
      const r = mockSb.respuestas[fn];
      return Promise.resolve(typeof r === 'function' ? r(args) : (r || { data: { ok: true }, error: null }));
    },
  },
}));

jest.mock('../stockService', () => ({ syncStock: jest.fn(async () => ({ ok: true })) }));
jest.mock('../deudaRepository', () => ({
  aplicarCobrosRendicion: jest.fn(async (cobros, por) => { mockDeuda.cobros.push({ cobros, por }); return cobros.length; }),
  crearDeudaRendicion: jest.fn(async (d) => { mockDeuda.creadas.push(d); return true; }),
  anularDeudaRendicion: jest.fn(async (id) => { mockDeuda.anuladas.push(id); return true; }),
  ajustarDeudaRendicion: jest.fn(async (id, c) => { mockDeuda.ajustadas.push([id, c]); return true; }),
}));

import {
  registrarRendicion, subirRendiciones, anularRendicion, bajarRendiciones, saldoAFavor, contarPendientesRendicion,
  cargarRendicionesLocales, sondearMigracion014, subirCuentaClientes,
} from '../rendicionService';
import * as deudaRepo from '../deudaRepository';

const CRED = { p_admin_id: 'u-admin', p_admin_pin: '1234' };
const pedido = { id: 7, remoteId: 70, clienteId: 5, clienteNombre: 'Kiosco', estado: 'facturado', total: 1000, items: [{ productoId: 1, nombre: 'Alfajor', cantidad: 10, precio: 100 }] };
const productos = [{ id: 1, nombre: 'Alfajor', precio: 100, categoria: 'Golosinas' }];
const rpcs = (fn) => mockSb.rpc.filter(r => r.fn === fn);
const guardarOk = (args) => ({ data: { ok: true, confirmados: args.p_lote.rendiciones.map(r => r.id), rechazados: [] }, error: null });

beforeEach(() => {
  mockDb.rends = []; mockDb.cuenta = []; mockDb.movs = []; mockDb.deudas = [];
  mockSb.rpc = []; mockSb.respuestas = {
    admin_rendiciones_guardar: guardarOk,
    admin_rendicion_efecto: { data: { ok: true, aplicado: true }, error: null },
    admin_cuenta_clientes_guardar: (args) => ({ data: { ok: true, confirmados: args.p_lote.map(c => c.id), rechazados: [] }, error: null }),
    admin_rendiciones_bajar: { data: { ok: true, rendiciones: [], cuenta: [] }, error: null },
    admin_rendicion_anular: { data: { ok: true, ya_anulada: false }, error: null },
  };
  mockDeuda.cobros = []; mockDeuda.creadas = []; mockDeuda.anuladas = []; mockDeuda.ajustadas = [];
  localStorage.clear();
  Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
  deudaRepo.aplicarCobrosRendicion.mockImplementation(async (cobros, por) => { mockDeuda.cobros.push({ cobros, por }); return cobros.length; });
  deudaRepo.crearDeudaRendicion.mockImplementation(async (d) => { mockDeuda.creadas.push(d); return true; });
  deudaRepo.anularDeudaRendicion.mockImplementation(async (id) => { mockDeuda.anuladas.push(id); return true; });
  deudaRepo.ajustarDeudaRendicion.mockImplementation(async (id, c) => { mockDeuda.ajustadas.push([id, c]); return true; });
});

const registrar = (form = { tipo: 'devolucion', motivo: 'Vencido', renglones: [{ productoId: 1, cantidad: 2 }] }) =>
  registrarRendicion(form, { pedido, productos, usuario: 'Admin' });

describe('AC-REN-1 registrarRendicion (offline)', () => {
  it('AC-REN-1 graba rendición + movimientos pendientes en una sola operación', async () => {
    const r = await registrar();
    expect(r.ok).toBe(true);
    expect(mockDb.rends[0]).toMatchObject({ id: r.rendicion.id, syncEstado: 'pendiente', creadaAqui: true, efectoAplicado: false, pendingSync: true });
    expect(mockDb.movs).toEqual([expect.objectContaining({ id: `${r.rendicion.id}:0:a`, cantidad: 2, tipo: 'devolucion', pendingSync: true })]);
    expect(mockSb.rpc).toEqual([]);
  });

  it('AC-REN-1 inválida: no graba nada', async () => {
    const r = await registrar({ tipo: 'devolucion', motivo: 'x', renglones: [{ productoId: 1, cantidad: 99 }] });
    expect(r.ok).toBe(false);
    expect(mockDb.rends).toEqual([]);
    expect(mockDb.movs).toEqual([]);
  });
});

describe('AC-REN-3 subirRendiciones: confirmación y efecto UNA sola vez', () => {
  it('AC-REN-3 sin PIN no sube nada', async () => {
    await registrar();
    expect(await subirRendiciones(null)).toMatchObject({ ok: false, motivo: 'pin_requerido' });
    expect(mockSb.rpc).toEqual([]);
  });

  it('AC-REN-3 sin deuda: confirma, reclama el efecto y deja saldo a favor; el reintento no lo reaplica', async () => {
    const { rendicion } = await registrar();
    const r = await subirRendiciones(CRED, { usuario: 'Admin' });
    expect(r).toMatchObject({ ok: true, subidos: 1, efectos: 1, rechazados: [] });
    expect(rpcs('admin_rendiciones_guardar')[0].args.p_lote.rendiciones[0]).toMatchObject({ id: rendicion.id, pedido_id: '70', credito_cents: 20000 });
    expect(rpcs('admin_rendicion_efecto')[0].args.p_efecto).toMatchObject({ clase: 'alta', saldoFavorCents: 20000, cargoCents: 0, cobros: [] });
    expect(mockDb.rends[0]).toMatchObject({ syncEstado: 'confirmada', pendingSync: false, efectoAplicado: true });
    expect(mockDb.cuenta).toEqual([expect.objectContaining({ id: `${rendicion.id}:favor:a`, montoCents: 20000, clienteId: '5', pendingSync: false })]);
    expect(await saldoAFavor(5)).toBe(20000);
    mockSb.rpc = [];
    const r2 = await subirRendiciones(CRED);
    expect(r2).toMatchObject({ ok: true, subidos: 0, efectos: 0 });
    expect(rpcs('admin_rendicion_efecto')).toEqual([]);
    expect(mockDb.cuenta).toHaveLength(1);
  });

  it('AC-REN-3 con deuda: cobra la deuda con "Rendición #id"; el cargo de un cambio suma una deuda nueva', async () => {
    mockDb.deudas = [{ id: 1, clienteId: 5, fecha: '2026-10-01', monto: 50, montoPagado: 0 }];
    const { rendicion } = await registrar();
    await subirRendiciones(CRED);
    expect(mockDeuda.cobros).toEqual([{ cobros: [{ deudaId: 1, deudaRemoteId: null, montoCents: 5000 }], por: `Rendición #${rendicion.id.slice(0, 8)}` }]);
    expect(mockDb.cuenta[0].montoCents).toBe(15000);

    const caro = await registrarRendicion({ tipo: 'cambio', motivo: 'Cambio', renglones: [{ productoId: 1, cantidad: 1 }], sale: [{ productoId: 2, cantidad: 1 }] },
      { pedido, productos: [...productos, { id: 2, nombre: 'Coca', precio: 300, categoria: 'Bebidas' }] });
    await subirRendiciones(CRED);
    expect(mockDeuda.creadas).toEqual([expect.objectContaining({ montoCents: 20000, concepto: `Cambio rendición #${caro.rendicion.id.slice(0, 8)}`, clienteId: '5' })]);
  });

  it('AC-REN-3 si otro dispositivo ya registró el efecto (aplicado:false) NO se aplica acá', async () => {
    mockSb.respuestas.admin_rendicion_efecto = { data: { ok: true, aplicado: false }, error: null };
    await registrar();
    const r = await subirRendiciones(CRED);
    expect(r.efectos).toBe(0);
    expect(mockDeuda.cobros).toEqual([]);
    expect(mockDb.cuenta).toEqual([]);
    expect(mockDb.rends[0].efectoAplicado).toBe(true);
  });

  it('AC-REN-2 rechazada por el servidor: se compensa el stock localmente y nada queda pendiente', async () => {
    const { rendicion } = await registrar();
    mockSb.respuestas.admin_rendiciones_guardar = { data: { ok: true, confirmados: [], rechazados: [{ id: rendicion.id, motivo: 'cantidad_excedida' }] }, error: null };
    const r = await subirRendiciones(CRED);
    expect(r.rechazados).toEqual([{ id: rendicion.id, motivo: 'cantidad_excedida', mensaje: expect.stringMatching(/otro dispositivo/) }]);
    expect(mockDb.rends[0]).toMatchObject({ syncEstado: 'rechazada', pendingSync: false });
    expect(mockDb.movs.map(m => [m.id, m.cantidad, m.pendingSync])).toEqual([[`${rendicion.id}:0:a`, 2, false], [`${rendicion.id}:0:x`, -2, false]]);
    expect(rpcs('admin_rendicion_efecto')).toEqual([]);
  });

  it('AC-REN-1 PIN incorrecto o falta la 014: queda todo pendiente', async () => {
    await registrar();
    mockSb.respuestas.admin_rendiciones_guardar = { data: { ok: false, motivo: 'no_autorizado' }, error: null };
    expect(await subirRendiciones(CRED)).toMatchObject({ ok: false, motivo: 'pin_incorrecto' });
    mockSb.respuestas.admin_rendiciones_guardar = { data: null, error: { code: 'PGRST202' } };
    expect(await subirRendiciones(CRED)).toMatchObject({ ok: false, faltaMigracion: true });
    expect(mockDb.rends[0]).toMatchObject({ pendingSync: true, syncEstado: 'pendiente' });
    expect(await contarPendientesRendicion()).toMatchObject({ rendiciones: 1, total: 1 });
  });

  it('AC-REN-3 si falla el reclamo del efecto se reintenta después sin duplicar', async () => {
    await registrar();
    mockSb.respuestas.admin_rendicion_efecto = { data: null, error: { message: 'Failed to fetch' } };
    expect((await subirRendiciones(CRED)).ok).toBe(false);
    expect(await contarPendientesRendicion()).toMatchObject({ rendiciones: 0, efectos: 1 });
    mockSb.respuestas.admin_rendicion_efecto = { data: { ok: true, aplicado: true }, error: null };
    expect(await subirRendiciones(CRED)).toMatchObject({ ok: true, efectos: 1 });
    expect(mockDb.cuenta).toHaveLength(1);
  });
});

describe('AC-REN-4 anularRendicion (online, atómica, sin borrar)', () => {
  const confirmada = async () => {
    const { rendicion } = await registrar();
    await subirRendiciones(CRED);
    mockSb.rpc = [];
    return rendicion;
  };

  it('AC-REN-4 sin conexión no se puede anular', async () => {
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
    expect(await anularRendicion(CRED, 'x', 'Error de carga')).toMatchObject({ ok: false, motivo: 'offline' });
  });

  it('AC-REN-4 motivo obligatorio y la rendición tiene que estar subida', async () => {
    expect(await anularRendicion(CRED, 'x', 'ab')).toMatchObject({ ok: false, motivo: 'motivo' });
    expect(await anularRendicion(null, 'x', 'Error')).toMatchObject({ motivo: 'pin_requerido' });
    const { rendicion } = await registrar();
    expect(await anularRendicion(CRED, rendicion.id, 'Error de carga')).toMatchObject({ ok: false, motivo: 'inexistente' });
  });

  it('AC-REN-4 el ganador revierte stock y saldo a favor; nada se borra', async () => {
    const r = await confirmada();
    const res = await anularRendicion(CRED, r.id, 'Error de carga', { usuario: 'Admin' });
    expect(res).toMatchObject({ ok: true, yaAnulada: false });
    expect(rpcs('admin_rendicion_anular')[0].args).toMatchObject({ p_id: r.id, p_motivo: 'Error de carga' });
    expect(mockDb.rends).toHaveLength(1);
    expect(mockDb.rends[0]).toMatchObject({ estado: 'anulada', motivoAnulacion: 'Error de carga', efectoAnulacion: expect.objectContaining({ clase: 'anulacion', saldoFavorCompensaCents: 20000 }) });
    expect(mockDb.movs.map(m => [m.id, m.cantidad])).toEqual([[`${r.id}:0:a`, 2], [`${r.id}:0:x`, -2]]);
    expect(mockDb.cuenta.map(c => [c.id, c.montoCents])).toEqual([[`${r.id}:favor:a`, 20000], [`${r.id}:favor:x`, -20000]]);
    expect(await saldoAFavor('5')).toBe(0);
  });

  it('AC-REN-4 con cobros aplicados: deuda de reversión; cargo sin cobros se anula', async () => {
    mockDb.deudas = [{ id: 1, clienteId: 5, fecha: '2026-10-01', monto: 500, montoPagado: 0 }];
    const r = await confirmada();
    await anularRendicion(CRED, r.id, 'Error de carga');
    expect(mockDeuda.creadas).toEqual([expect.objectContaining({ montoCents: 20000, concepto: `Reversión rendición #${r.id.slice(0, 8)}` })]);

    const caro = await registrarRendicion({ tipo: 'cambio', motivo: 'Cambio', renglones: [{ productoId: 1, cantidad: 1 }], sale: [{ productoId: 2, cantidad: 1 }] },
      { pedido, productos: [...productos, { id: 2, nombre: 'Coca', precio: 300 }] });
    await subirRendiciones(CRED);
    mockDb.deudas.push({ id: 9, clienteId: 5, concepto: `Cambio rendición #${caro.rendicion.id.slice(0, 8)}`, monto: 200, montoPagado: 50 });
    await anularRendicion(CRED, caro.rendicion.id, 'Error de carga');
    expect(mockDeuda.ajustadas).toEqual([[9, 5000]]);
    expect(mockDb.cuenta.find(c => c.id === `${caro.rendicion.id}:cargo:x`)).toMatchObject({ montoCents: 5000 });
    mockDb.deudas[1].montoPagado = 0;
  });

  it('AC-REN-4 ya_anulada por otro dispositivo: no reaplica la plata (solo stock idempotente)', async () => {
    const r = await confirmada();
    mockSb.respuestas.admin_rendicion_anular = { data: { ok: true, ya_anulada: true }, error: null };
    const res = await anularRendicion(CRED, r.id, 'Error de carga');
    expect(res).toMatchObject({ ok: true, yaAnulada: true });
    expect(rpcs('admin_rendicion_efecto')).toEqual([]);
    expect(mockDb.cuenta).toHaveLength(1);
    expect(mockDb.movs.filter(m => m.id.endsWith(':x'))).toHaveLength(1);
    expect(await anularRendicion(CRED, r.id, 'Otra vez')).toMatchObject({ ok: true, yaAnulada: true });
  });

  it('AC-REN-4 PIN incorrecto al anular: no cambia nada', async () => {
    const r = await confirmada();
    mockSb.respuestas.admin_rendicion_anular = { data: { ok: false, motivo: 'no_autorizado' }, error: null };
    expect(await anularRendicion(CRED, r.id, 'Error de carga')).toMatchObject({ ok: false, motivo: 'pin_incorrecto' });
    expect(mockDb.rends[0].estado).toBe('vigente');
  });
});

describe('AC-REN-4 bajarRendiciones y utilidades', () => {
  it('AC-REN-4 baja rendiciones ajenas (sin efecto local), anuladas compensan el stock que hay acá', async () => {
    const { rendicion } = await registrar();
    await subirRendiciones(CRED);
    mockSb.respuestas.admin_rendiciones_bajar = { data: { ok: true, rendiciones: [
      { id: rendicion.id, pedido_id: '70', estado: 'anulada', fecha: '2026-10-15', tipo: 'devolucion', renglones: mockDb.rends[0].renglones, credito_cents: 20000, synced_at: '2026-10-15T10:00:00Z', efecto: { clase: 'alta' } },
      { id: 'ajena', pedido_id: '71', estado: 'vigente', fecha: '2026-10-15', tipo: 'nc', credito_cents: 100, synced_at: '2026-10-15T10:01:00Z' },
    ], cuenta: [{ id: 'ajena:favor:a', cliente_id: '6', rendicion_id: 'ajena', tipo: 'saldo_favor', monto_cents: 100, fecha: '2026-10-15', synced_at: '2026-10-15T10:01:00Z' }] }, error: null };
    const r = await bajarRendiciones(CRED);
    expect(r).toEqual({ ok: true, bajados: { rendiciones: 2, cuenta: 1 } });
    expect(mockDb.rends.find(x => x.id === 'ajena')).toMatchObject({ efectoAplicado: true, creadaAqui: false, syncEstado: 'confirmada' });
    expect(mockDb.rends.find(x => x.id === rendicion.id)).toMatchObject({ estado: 'anulada', creadaAqui: true });
    expect(mockDb.movs.filter(m => m.id.endsWith(':x'))).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem('rendicionesSyncCursor'))).toMatchObject({ rendiciones: { id: 'ajena' }, cuenta: { id: 'ajena:favor:a' } });
    expect(await saldoAFavor(6)).toBe(100);
    expect(await bajarRendiciones(null)).toMatchObject({ motivo: 'pin_requerido' });
    mockSb.respuestas.admin_rendiciones_bajar = { data: null, error: { code: '42883' } };
    expect(await bajarRendiciones(CRED)).toMatchObject({ ok: false, faltaMigracion: true });
  });

  it('AC-REN-3 utilidades: carga local tolerante, sonda de la 014 y cuenta sin PIN', async () => {
    expect(await cargarRendicionesLocales()).toEqual({ rendiciones: [], cuenta: [] });
    mockSb.respuestas.admin_rendiciones_bajar = { data: null, error: { code: 'PGRST202' } };
    expect(await sondearMigracion014()).toEqual({ faltaMigracion: true });
    mockSb.respuestas.admin_rendiciones_bajar = { data: { ok: false, motivo: 'no_autorizado' }, error: null };
    expect(await sondearMigracion014()).toEqual({ faltaMigracion: false });
    expect(await subirCuentaClientes(null)).toMatchObject({ motivo: 'pin_requerido' });
    mockDb.cuenta = [{ id: 'c1', clienteId: '5', tipo: 'saldo_favor', montoCents: 1, fecha: '2026-10-15', pendingSync: true }];
    mockSb.respuestas.admin_cuenta_clientes_guardar = { data: { ok: false, motivo: 'no_autorizado' }, error: null };
    expect(await subirCuentaClientes(CRED)).toMatchObject({ ok: false, motivo: 'pin_incorrecto', subidos: 0 });
  });
});
