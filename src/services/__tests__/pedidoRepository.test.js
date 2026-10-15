// Hooks de stock en el repositorio de pedidos (REQ-STK): todo guardado/borrado
// de pedido re-alinea el stock, y un fallo de stock nunca rompe el guardado.
const mockDbPedidos = { lista: [] };
jest.mock('../../db', () => {
  const impl = {
    addPedido: async () => 1,
    addPedidoSynced: async () => 1,
    getPedidos: async () => mockDbPedidos.lista.map(p => ({ ...p })),
    putPedido: async () => undefined,
    updatePedido: async () => undefined,
  };
  const mod = { __impl: impl };
  for (const k of Object.keys(impl)) mod[k] = jest.fn(impl[k]);
  return mod;
});

const mockSb = { calls: [], respuesta: { data: { id: 'R-NEW' }, error: null } };
jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table) => {
      const q = { table, op: null };
      const api = {
        insert: (row) => { q.op = 'insert'; q.row = row; return api; },
        update: (row) => { q.op = 'update'; q.row = row; return api; },
        eq: () => api,
        select: () => api,
        single: () => api,
        then: (res, rej) => { mockSb.calls.push(q); return Promise.resolve(mockSb.respuesta).then(res, rej); },
      };
      return api;
    },
  },
}));

jest.mock('../stockService', () => ({ aplicarStockPedido: jest.fn() }));

import * as db from '../../db';
import { guardarPedidoOnlineFirst, borrarPedidoOnlineFirst } from '../pedidoRepository';
import { aplicarStockPedido } from '../stockService';
import { setUsuarioSesion } from '../sesion';

const setOnline = (v) => Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => v });

const PEDIDO = {
  id: 5, clienteNombre: 'Kiosco', estado: 'facturado', fecha: '2026-10-07',
  items: [{ productoId: 1, cantidad: 3, precio: 100 }], total: 300,
};

let errSpy;
beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(db.__impl)) db[k].mockImplementation(db.__impl[k]);
  aplicarStockPedido.mockResolvedValue([]);
  mockDbPedidos.lista = [{ ...PEDIDO, estado: 'pendiente' }];
  mockSb.calls = [];
  mockSb.respuesta = { data: { id: 'R-NEW' }, error: null };
  // S-20 (iter 3): el usuario sale de la sesion en memoria, no de localStorage.
  setUsuarioSesion({ id: 1, nombre: 'Admin', permiso: 1 });
  localStorage.setItem('vendedorActual', JSON.stringify({ nombre: 'Admin' }));
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { errSpy.mockRestore(); localStorage.clear(); setUsuarioSesion(null); });

describe('guardarPedidoOnlineFirst + stock', () => {
  it('AC-STK-8 offline: guarda local y aplica stock con el pedido y el usuario actual', async () => {
    setOnline(false);
    const r = await guardarPedidoOnlineFirst(PEDIDO);
    expect(r).toEqual({ mode: 'offline' });
    expect(db.updatePedido).toHaveBeenCalledWith(expect.objectContaining({ id: 5, estado: 'facturado' }));
    expect(aplicarStockPedido).toHaveBeenCalledTimes(1);
    expect(aplicarStockPedido).toHaveBeenCalledWith(expect.objectContaining({ id: 5, estado: 'facturado', items: PEDIDO.items }), { usuario: 'Admin' });
    expect(mockSb.calls).toHaveLength(0);
  });

  it('AC-STK-8 offline: si el stock falla, el guardado NO tira y se loguea el error', async () => {
    setOnline(false);
    aplicarStockPedido.mockRejectedValueOnce(new Error('IndexedDB lleno'));
    await expect(guardarPedidoOnlineFirst(PEDIDO)).resolves.toEqual({ mode: 'offline' });
    expect(db.updatePedido).toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('stock'), 'IndexedDB lleno');
  });

  it('AC-STK-2 online sin remoteId: inserta y aplica stock con el remoteId nuevo', async () => {
    setOnline(true);
    const r = await guardarPedidoOnlineFirst(PEDIDO);
    expect(r).toEqual({ remoteId: 'R-NEW', mode: 'online' });
    expect(mockSb.calls[0]).toMatchObject({ table: 'pedidos', op: 'insert' });
    expect(aplicarStockPedido).toHaveBeenCalledWith(expect.objectContaining({ id: 5, remoteId: 'R-NEW' }), { usuario: 'Admin' });
  });

  it('AC-STK-4 online con remoteId: actualiza y aplica stock con ese remoteId', async () => {
    setOnline(true);
    mockSb.respuesta = { data: { id: 'R-1' }, error: null };
    await guardarPedidoOnlineFirst({ ...PEDIDO, remoteId: 'R-1' });
    expect(mockSb.calls[0]).toMatchObject({ op: 'update' });
    expect(aplicarStockPedido).toHaveBeenCalledWith(expect.objectContaining({ remoteId: 'R-1' }), expect.anything());
  });

  it('AC-STK-5 online: si Supabase falla, NO se toca el stock y se restaura el pedido original', async () => {
    setOnline(true);
    mockSb.respuesta = { data: null, error: { message: 'timeout' } };
    await expect(guardarPedidoOnlineFirst(PEDIDO)).rejects.toMatchObject({ message: 'timeout' });
    expect(aplicarStockPedido).not.toHaveBeenCalled();
    expect(db.putPedido).toHaveBeenCalledWith(expect.objectContaining({ id: 5, estado: 'pendiente' }));
  });

  it('AC-STK-8 online: un fallo de stock tampoco rompe el guardado', async () => {
    setOnline(true);
    aplicarStockPedido.mockRejectedValueOnce(new Error('boom'));
    await expect(guardarPedidoOnlineFirst(PEDIDO)).resolves.toMatchObject({ mode: 'online' });
  });

  it('AC-STK-2 sin sesion usa usuario vacío (no rompe)', async () => {
    setOnline(false);
    setUsuarioSesion(null);
    localStorage.setItem('vendedorActual', '{no es json');
    await guardarPedidoOnlineFirst(PEDIDO);
    expect(aplicarStockPedido).toHaveBeenCalledWith(expect.anything(), { usuario: '' });
  });
});

describe('Fix B2 (iter 2): solo "Facturar" inicia el stock', () => {
  it('AC-STK-2 guardarPedidoOnlineFirst(p, { iniciarStock: true }) pasa iniciar:true a aplicarStockPedido (offline)', async () => {
    setOnline(false);
    await guardarPedidoOnlineFirst(PEDIDO, { iniciarStock: true });
    expect(aplicarStockPedido).toHaveBeenCalledWith(expect.objectContaining({ id: 5 }), { usuario: 'Admin', iniciar: true });
  });

  it('AC-STK-2 online también propaga iniciar:true con el remoteId nuevo', async () => {
    setOnline(true);
    await guardarPedidoOnlineFirst(PEDIDO, { iniciarStock: true });
    expect(aplicarStockPedido).toHaveBeenCalledWith(expect.objectContaining({ remoteId: 'R-NEW' }), { usuario: 'Admin', iniciar: true });
  });

  it.each([
    ['sin opciones', undefined],
    ['iniciarStock:false', { iniciarStock: false }],
    ['opción desconocida', { iniciar: true }],
  ])('AC-STK-5 cualquier otro guardado (%s) solo reconcilia: no pasa iniciar', async (_n, opts) => {
    setOnline(false);
    await guardarPedidoOnlineFirst({ ...PEDIDO, deudaGenerada: true }, opts);
    expect(aplicarStockPedido).toHaveBeenCalledWith(expect.anything(), { usuario: 'Admin' });
  });

  it('AC-STK-3 borrar nunca inicia stock', async () => {
    setOnline(false);
    await borrarPedidoOnlineFirst(PEDIDO);
    expect(aplicarStockPedido.mock.calls[0][1]).toEqual({ usuario: 'Admin' });
  });

  it('AC-STK-2 S-20 "Facturar" firma con la sesión aunque localStorage diga otro nombre', async () => {
    setOnline(false);
    localStorage.setItem('vendedorActual', JSON.stringify({ id: 2, nombre: 'Jorge' }));
    await guardarPedidoOnlineFirst(PEDIDO, { iniciarStock: true });
    expect(aplicarStockPedido).toHaveBeenCalledWith(expect.anything(), { usuario: 'Admin', iniciar: true });
  });
});

describe('borrarPedidoOnlineFirst + stock', () => {
  it('AC-STK-3 offline: borrar aplica stock con borrado=true y estado eliminado (devuelve stock)', async () => {
    setOnline(false);
    const r = await borrarPedidoOnlineFirst({ ...PEDIDO, remoteId: 'R-1' });
    expect(r).toEqual({ mode: 'offline' });
    expect(aplicarStockPedido).toHaveBeenCalledWith(
      expect.objectContaining({ id: 5, remoteId: 'R-1', borrado: true, estado: 'eliminado' }), { usuario: 'Admin' },
    );
  });

  it('AC-STK-3 online: borrar (soft delete) aplica stock y un fallo de stock no rompe', async () => {
    setOnline(true);
    mockSb.respuesta = { data: null, error: null };
    aplicarStockPedido.mockRejectedValueOnce(new Error('boom'));
    await expect(borrarPedidoOnlineFirst({ ...PEDIDO, remoteId: 'R-1' })).resolves.toEqual({ mode: 'online', softDeleted: true });
    expect(aplicarStockPedido).toHaveBeenCalledWith(expect.objectContaining({ borrado: true, estado: 'eliminado' }), expect.anything());
  });
});

describe('S-20 firma de movimientos', () => {
  it('S-20 un nombre forjado en localStorage NO firma el movimiento: se usa la sesion', async () => {
    setOnline(false);
    setUsuarioSesion({ id: 2, nombre: 'Vendedor Juan', permiso: 2 });
    localStorage.setItem('vendedorActual', JSON.stringify({ id: 2, nombre: 'Admin' }));
    await guardarPedidoOnlineFirst(PEDIDO);
    expect(aplicarStockPedido).toHaveBeenCalledWith(expect.anything(), { usuario: 'Vendedor Juan' });
  });
});

describe('AC-PAN-1 (seguridad) costos nunca viajan en pedidos.items', () => {
  it('AC-PAN-1 toRemoteRow no emite costoUnitario ni descuentos aunque el item local los tenga', async () => {
    setOnline(true);
    const conCosto = { ...PEDIDO, items: [{ productoId: 1, cantidad: 3, precio: 100, costoUnitario: 60, costoFinal: 70, descuento1: 5 }] };
    await guardarPedidoOnlineFirst(conCosto);
    const enviado = JSON.stringify(mockSb.calls[0].row);
    expect(enviado).not.toMatch(/costoUnitario|costoFinal|descuento1/);
    expect(mockSb.calls[0].row.items[0]).toEqual({ productoId: 1, cantidad: 3, precio: 100 });
  });
});
