// REQ-WEB AC-WEB-6: aceptar/rechazar offline queda pendingSync y se sube con la RPC
// del servidor. Se limpia SOLO la acción resuelta; 'ya_resuelto' no se reintenta.
const mockLocal = { acciones: [], clientes: [], pedidos: [] };
jest.mock('../../db', () => ({
  getPedidosWebAcciones: async () => mockLocal.acciones.map(a => ({ ...a })),
  putPedidosWebAccionesRaw: async (rows) => {
    for (const r of rows) {
      const i = mockLocal.acciones.findIndex(a => a.id === r.id);
      if (i >= 0) mockLocal.acciones[i] = { ...r }; else mockLocal.acciones.push({ ...r });
    }
  },
  getClientes: async () => mockLocal.clientes.map(c => ({ ...c })),
  getPedidos: async () => mockLocal.pedidos.map(p => ({ ...p })),
  putPedidosRemotoBatch: async () => undefined,
  patchRegistros: async (store, ids, patch) => { mockLocal.pedidos = mockLocal.pedidos.map(p => (ids.includes(p.id) ? { ...p, ...patch } : p)); },
}));
jest.mock('../stockService', () => ({ aplicarStockPedido: jest.fn() }));
jest.mock('../../services/imageSearch', () => ({ isImageSearchConfigured: () => false, fetchProductImage: jest.fn(), ImageSearchQuotaError: class extends Error {} }));

const mockSb = { rpcCalls: [], rpcRespuestas: [], remoto: [] };
jest.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: async (nombre, args) => {
      mockSb.rpcCalls.push([nombre, args]);
      return mockSb.rpcRespuestas.shift() || { data: { ok: true }, error: null };
    },
    from: () => {
      const api = { select: () => api, in: () => api, eq: () => api, order: () => api, range: () => api, then: (res, rej) => Promise.resolve({ data: mockSb.remoto, error: null }).then(res, rej) };
      return api;
    },
  },
}));

import { syncPedidosWeb, pullContactosPedidosWeb } from '../../sync/syncService';

const CRED = { p_admin_id: 'adm-1', p_admin_pin: '1234' };
const acc = (id, extra = {}) => ({ id, pedidoRemoteId: Number(id.slice(-1)), tipo: 'rechazar', motivo: 'No llegamos', por: 'Jorge', at: Number(id.slice(-1)), pendingSync: true, resultado: null, ...extra });

beforeEach(() => {
  mockLocal.acciones = []; mockLocal.clientes = []; mockLocal.pedidos = [];
  mockSb.rpcCalls = []; mockSb.rpcRespuestas = []; mockSb.remoto = [];
});

describe('AC-WEB-6 syncPedidosWeb', () => {
  it('AC-WEB-6 sin credencial no sube nada y pide el PIN (la acción sigue pendiente)', async () => {
    mockLocal.acciones = [acc('a-1')];
    const r = await syncPedidosWeb({ cred: null });
    expect(r.requierePinAdmin).toBe(true);
    expect(mockSb.rpcCalls).toHaveLength(0);
    expect(mockLocal.acciones[0].pendingSync).toBe(true);
  });

  it('AC-WEB-6 con ok limpia pendingSync SOLO de la acción subida y manda el id de acción', async () => {
    mockLocal.acciones = [acc('a-1'), acc('a-2', { tipo: 'aceptar', clienteId: 'c-9', vendedor: 'Ana', items: [], total: 0 })];
    mockLocal.clientes = [{ id: 'c-9', pendingSync: true }]; // cliente nuevo todavía sin subir
    const r = await syncPedidosWeb({ cred: CRED });
    expect(r.count).toBe(1);
    expect(r.esperando).toBe(1);
    expect(mockSb.rpcCalls).toHaveLength(1);
    expect(mockSb.rpcCalls[0][0]).toBe('admin_resolver_pedido_web');
    expect(mockSb.rpcCalls[0][1]).toMatchObject({ p_accion_id: 'a-1', p_tipo: 'rechazar', p_admin_id: 'adm-1', p_pedido_id: '1' });
    expect(mockLocal.acciones.find(a => a.id === 'a-1')).toMatchObject({ pendingSync: false, resultado: 'ok' });
    expect(mockLocal.acciones.find(a => a.id === 'a-2').pendingSync).toBe(true);
  });

  it('AC-WEB-6 la aceptación espera a que el cliente nuevo esté subido y después sube', async () => {
    mockLocal.acciones = [acc('a-2', { tipo: 'aceptar', clienteId: 'c-9', vendedor: 'Ana', items: [{ productoId: 1, cantidad: 2 }], total: 20 })];
    mockLocal.clientes = [{ id: 'c-9', pendingSync: false }];
    const r = await syncPedidosWeb({ cred: CRED });
    expect(r.count).toBe(1);
    expect(mockSb.rpcCalls[0][1].p_datos).toMatchObject({ cliente_id: 'c-9', vendedor: 'Ana', total: 20 });
    expect(mockLocal.acciones[0].pendingSync).toBe(false);
  });

  it('AC-WEB-6 ya_resuelto: se marca, no se reintenta y guarda quién lo resolvió', async () => {
    mockLocal.acciones = [acc('a-1', { tipo: 'aceptar', clienteId: 'c-1', vendedor: 'Ana', items: [], total: 0 })];
    mockSb.rpcRespuestas = [{ data: { ok: false, motivo: 'ya_resuelto', estado: 'aceptado', revisado_por: 'Otro Admin', cliente_id: '7' }, error: null }];
    await syncPedidosWeb({ cred: CRED });
    expect(mockLocal.acciones[0]).toMatchObject({ pendingSync: false, resultado: 'ya_resuelto' });
    expect(mockLocal.acciones[0].detalle).toMatchObject({ revisadoPor: 'Otro Admin', estado: 'aceptado' });
    mockSb.rpcCalls = [];
    await syncPedidosWeb({ cred: CRED });
    expect(mockSb.rpcCalls).toHaveLength(0);
  });

  it('AC-WEB-6 error de red: la acción queda pendiente y el reintento manda el MISMO id', async () => {
    mockLocal.acciones = [acc('a-1')];
    mockSb.rpcRespuestas = [{ data: null, error: { message: 'Failed to fetch' } }];
    await expect(syncPedidosWeb({ cred: CRED })).rejects.toBeTruthy();
    expect(mockLocal.acciones[0].pendingSync).toBe(true);
    await syncPedidosWeb({ cred: CRED });
    expect(mockSb.rpcCalls.map(c => c[1].p_accion_id)).toEqual(['a-1', 'a-1']);
    expect(mockLocal.acciones[0].pendingSync).toBe(false);
  });

  it('AC-WEB-6 migración 008 sin aplicar: avisa y deja todo pendiente', async () => {
    mockLocal.acciones = [acc('a-1')];
    mockSb.rpcRespuestas = [{ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }];
    const r = await syncPedidosWeb({ cred: CRED });
    expect(r.faltaMigracion).toBe(true);
    expect(mockLocal.acciones[0].pendingSync).toBe(true);
  });

  it('AC-WEB-6 no_autorizado corta sin marcar nada como resuelto', async () => {
    mockLocal.acciones = [acc('a-1'), acc('a-2')];
    mockSb.rpcRespuestas = [{ data: { ok: false, motivo: 'no_autorizado' }, error: null }];
    const r = await syncPedidosWeb({ cred: CRED });
    expect(r.motivo).toBe('no_autorizado');
    expect(mockSb.rpcCalls).toHaveLength(1);
    expect(mockLocal.acciones.every(a => a.pendingSync)).toBe(true);
  });

  it('AC-WEB-6 el PIN no se guarda en la acción local', async () => {
    mockLocal.acciones = [acc('a-1')];
    await syncPedidosWeb({ cred: CRED });
    expect(JSON.stringify(mockLocal.acciones)).not.toContain('1234');
  });
});

describe('AC-WEB-3 S-WEB-01 contactos por RPC admin', () => {
  const ped = (id, extra = {}) => ({ id, remoteId: 100 + id, origen: 'web', webEstado: 'por_revisar', ...extra });
  it('AC-WEB-3 sin PIN no llama a la RPC y no hay contacto', async () => {
    mockLocal.pedidos = [ped(1)];
    const r = await pullContactosPedidosWeb({ cred: null });
    expect(r).toMatchObject({ ok: false, motivo: 'pin_requerido' });
    expect(mockSb.rpcCalls).toHaveLength(0);
  });
  it('AC-WEB-3 con PIN guarda el contacto local solo de los pedidos que faltan', async () => {
    mockLocal.pedidos = [ped(1), ped(2, { webContacto: { nombre: 'Ya' } })];
    mockSb.rpcRespuestas = [{ data: { ok: true, contactos: { 101: { nombre: 'Ana' } } }, error: null }];
    const r = await pullContactosPedidosWeb({ cred: CRED });
    expect(r).toMatchObject({ ok: true, count: 1 });
    expect(mockSb.rpcCalls[0][0]).toBe('admin_listar_pedidos_web');
    expect(mockSb.rpcCalls[0][1].p_ids).toEqual(['101']);
    expect(mockLocal.pedidos[0].webContacto).toEqual({ nombre: 'Ana' });
  });
  it('AC-WEB-3 si la RPC falla o el PIN es incorrecto no pisa nada y no tira', async () => {
    mockLocal.pedidos = [ped(1)];
    mockSb.rpcRespuestas = [{ data: null, error: { code: '500', message: 'x' } }];
    expect(await pullContactosPedidosWeb({ cred: CRED })).toMatchObject({ ok: false, motivo: 'red' });
    mockSb.rpcRespuestas = [{ data: { ok: false, motivo: 'no_autorizado' }, error: null }];
    expect(await pullContactosPedidosWeb({ cred: CRED })).toMatchObject({ ok: false, motivo: 'no_autorizado' });
    mockSb.rpcRespuestas = [{ data: null, error: { code: 'PGRST202' } }];
    expect(await pullContactosPedidosWeb({ cred: CRED })).toMatchObject({ ok: false, faltaMigracion: true });
    expect(mockLocal.pedidos[0].webContacto).toBeUndefined();
  });
});
