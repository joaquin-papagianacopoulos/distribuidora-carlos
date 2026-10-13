// Integración del control de stock (REQ-STK / REQ-ING) con una IndexedDB
// falsa en memoria y un Supabase falso.
const mockDb = { movs: [], ingresos: [], proveedores: [] };

jest.mock('../../db', () => {
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const clearIn = (key) => async (ids) => {
    const set = new Set(ids);
    mockDb[key] = mockDb[key].map(r => (set.has(r.id) ? { ...r, pendingSync: false } : r));
  };
  const putIn = (key) => async (rows) => {
    for (const row of rows || []) {
      const i = mockDb[key].findIndex(r => r.id === row.id);
      if (i >= 0) mockDb[key][i] = clone(row); else mockDb[key].push(clone(row));
    }
  };
  // CRA usa resetMocks:true ⇒ las implementaciones se re-instalan en beforeEach.
  const impl = {
    getMovimientosStock: async () => clone(mockDb.movs),
    addMovimientosStock: async (movs) => putIn('movs')((movs || []).map(m => ({ ...m, pendingSync: true }))),
    putMovimientosRemotos: async (rows) => putIn('movs')(rows),
    clearMovimientosPendingSync: async (ids) => clearIn('movs')(ids),
    rekeyMovimientosRef: async (oldRef, newRef) => {
      let n = 0;
      mockDb.movs = mockDb.movs.map(m => (m.ref === oldRef ? (n++, { ...m, ref: newRef, pendingSync: true }) : m));
      return n;
    },
    getIngresos: async () => clone(mockDb.ingresos),
    putIngresosRemotos: async (rows) => putIn('ingresos')(rows),
    clearIngresosPendingSync: async (ids) => clearIn('ingresos')(ids),
    addIngresoConMovimientos: async (ing, movs) => {
      mockDb.ingresos.push({ ...ing, pendingSync: true });
      for (const m of movs) mockDb.movs.push({ ...m, pendingSync: true });
    },
    getProveedores: async () => clone(mockDb.proveedores),
    putProveedoresRemotos: async (rows) => putIn('proveedores')(rows),
    clearProveedoresPendingSync: async (ids) => clearIn('proveedores')(ids),
    deleteProveedor: async (id) => { mockDb.proveedores = mockDb.proveedores.filter(p => p.id !== id); },
  };
  const mod = { __impl: impl };
  for (const k of Object.keys(impl)) mod[k] = jest.fn(impl[k]);
  return mod;
});

// Supabase falso: registra upserts y devuelve filas remotas por tabla.
const mockSb = { upserts: [], remoto: {}, upsertError: {}, upsertQueue: [], selectError: null, filtrosGt: [] };
jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table) => {
      const q = {
        upsert: (rows, opts) => {
          mockSb.upserts.push({ table, rows, opts });
          // upsertQueue (si tiene elementos) manda sobre upsertError: una respuesta por llamada.
          if (mockSb.upsertQueue.length) return Promise.resolve({ error: mockSb.upsertQueue.shift() || null });
          return Promise.resolve({ error: mockSb.upsertError[table] || null });
        },
        select: () => q,
        order: () => q,
        range: () => q,
        gt: (col, val) => { mockSb.filtrosGt.push({ table, col, val }); return q; },
        then: (res, rej) => Promise.resolve(
          mockSb.selectError ? { data: null, error: mockSb.selectError } : { data: mockSb.remoto[table] || [], error: null },
        ).then(res, rej),
      };
      return q;
    },
  },
}));

import {
  aplicarStockPedido, getStockMap, previsualizarStockPedido, ajustarStock, registrarIngreso, syncStock,
} from '../stockService';
import * as db from '../../db';
import { addMovimientosStock, clearMovimientosPendingSync, putMovimientosRemotos } from '../../db';

// "Facturar" es la única acción que inicia el control de stock de un pedido
// (iter 2, fix B2). El resto de los guardados llama sin `iniciar` y solo reconcilia.
const facturar = (p, opts = {}) => aplicarStockPedido(p, { ...opts, iniciar: true });
const stock = async (pid) => (await getStockMap()).get(String(pid)) || 0;
const seed = (movs) => { mockDb.movs = movs.map(m => ({ pendingSync: false, ...m })); };

const PRODUCTOS = [
  { id: 1, codigo: 'A1', nombre: 'Alfajor' },
  { id: 2, codigo: 'CC', nombre: 'Coca' },
];

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(db.__impl)) db[k].mockImplementation(db.__impl[k]);
  mockDb.movs = [];
  mockDb.ingresos = [];
  mockDb.proveedores = [];
  mockSb.upserts = [];
  mockSb.remoto = {};
  mockSb.upsertError = {};
  mockSb.upsertQueue = [];
  mockSb.selectError = null;
  mockSb.filtrosGt = [];
  localStorage.clear();
  seed([
    { id: 'ini-1', productoId: '1', cantidad: 10, tipo: 'inicial', ref: 'ajuste:1' },
    { id: 'ini-2', productoId: '2', cantidad: 10, tipo: 'inicial', ref: 'ajuste:2' },
  ]);
});

const pedido = (over = {}) => ({
  id: 5,
  clienteNombre: 'Kiosco',
  estado: 'facturado',
  items: [{ productoId: 1, nombre: 'Alfajor', cantidad: 3 }, { productoId: 2, nombre: 'Coca', cantidad: 2 }],
  ...over,
});

describe('aplicarStockPedido — ciclo de vida del pedido', () => {
  it('AC-STK-2 facturar genera movimientos "venta" negativos por ítem', async () => {
    const nuevos = await facturar(pedido(), { usuario: 'Admin' });
    expect(nuevos).toHaveLength(2);
    expect(nuevos.every(m => m.tipo === 'venta' && m.cantidad < 0 && m.ref === 'pedido-local:5' && m.usuario === 'Admin')).toBe(true);
    expect(await stock(1)).toBe(7);
    expect(await stock(2)).toBe(8);
    expect(mockDb.movs.filter(m => m.tipo === 'venta').every(m => m.pendingSync)).toBe(true);
  });

  it('AC-STK-2 un pedido pendiente no toca el stock', async () => {
    const nuevos = await aplicarStockPedido(pedido({ estado: 'pendiente' }));
    expect(nuevos).toEqual([]);
    expect(addMovimientosStock).not.toHaveBeenCalled();
    expect(await stock(1)).toBe(10);
  });

  it('AC-STK-5 facturar dos veces no descuenta doble', async () => {
    await facturar(pedido());
    const segunda = await facturar(pedido());
    expect(segunda).toEqual([]);
    expect(await stock(1)).toBe(7);
    expect(await stock(2)).toBe(8);
    expect(addMovimientosStock).toHaveBeenCalledTimes(1);
  });

  it('AC-STK-4 editar un pedido facturado registra solo la diferencia', async () => {
    await facturar(pedido());
    const edit = await aplicarStockPedido(pedido({ items: [{ productoId: 1, cantidad: 5 }, { productoId: 2, cantidad: 2 }] }));
    expect(edit).toHaveLength(1);
    expect(edit[0]).toMatchObject({ productoId: '1', cantidad: -2, tipo: 'venta' });
    expect(await stock(1)).toBe(5);
    // Bajar cantidad devuelve stock con "anulacion"
    const baja = await aplicarStockPedido(pedido({ items: [{ productoId: 1, cantidad: 1 }, { productoId: 2, cantidad: 2 }] }));
    expect(baja[0]).toMatchObject({ productoId: '1', cantidad: 4, tipo: 'anulacion' });
    expect(await stock(1)).toBe(9);
  });

  it('AC-STK-4 quitar un ítem de un pedido facturado devuelve ese stock', async () => {
    await facturar(pedido());
    await aplicarStockPedido(pedido({ items: [{ productoId: 1, cantidad: 3 }] }));
    expect(await stock(2)).toBe(10);
    expect(await stock(1)).toBe(7);
  });

  it('AC-STK-3 facturar → revertir a pendiente → facturar → borrar deja el stock como estaba', async () => {
    await facturar(pedido());
    expect(await stock(1)).toBe(7);
    const rev = await aplicarStockPedido(pedido({ estado: 'pendiente' }));
    expect(rev.every(m => m.tipo === 'anulacion')).toBe(true);
    expect(await stock(1)).toBe(10);
    expect(await stock(2)).toBe(10);
    await facturar(pedido());
    expect(await stock(1)).toBe(7);
    await aplicarStockPedido(pedido({ borrado: true, estado: 'eliminado' }));
    expect(await stock(1)).toBe(10);
    expect(await stock(2)).toBe(10);
    // Borrar otra vez no vuelve a sumar
    expect(await aplicarStockPedido(pedido({ borrado: true, estado: 'eliminado' }))).toEqual([]);
    expect(await stock(1)).toBe(10);
  });

  it('AC-STK-3 un pedido facturado y "cancelado" (fallback de borrado) también devuelve el stock', async () => {
    await facturar(pedido());
    await aplicarStockPedido(pedido({ estado: 'cancelado', borrado: true }));
    expect(await stock(1)).toBe(10);
  });

  it('AC-STK-2 cantidades decimales / inválidas: ignora <=0 y NaN', async () => {
    const nuevos = await facturar(pedido({ items: [
      { productoId: 1, cantidad: 1.5 }, { productoId: 2, cantidad: 0 }, { productoId: 2, cantidad: 'abc' }, { cantidad: 4 },
    ] }));
    expect(nuevos).toHaveLength(1);
    expect(await stock(1)).toBe(8.5);
    expect(await stock(2)).toBe(10);
  });

  it('AC-STK-2 pedido null/undefined no hace nada', async () => {
    expect(await aplicarStockPedido(null)).toEqual([]);
    expect(await aplicarStockPedido(undefined)).toEqual([]);
  });
});

describe('aplicarStockPedido — offline → online (AC-STK-8)', () => {
  it('AC-STK-8 facturado offline (ref local) y después con remoteId: re-keyea y no duplica', async () => {
    await facturar(pedido()); // offline: ref pedido-local:5
    mockDb.movs.forEach(m => { m.pendingSync = false; }); // ya se subieron
    const nuevos = await aplicarStockPedido(pedido({ remoteId: 'R-1' }));
    expect(nuevos).toEqual([]);
    const ventas = mockDb.movs.filter(m => m.tipo === 'venta');
    expect(ventas.every(m => m.ref === 'pedido:R-1')).toBe(true);
    // el re-key se vuelve a subir (upsert por id, sin duplicar)
    expect(ventas.every(m => m.pendingSync === true)).toBe(true);
    expect(await stock(1)).toBe(7);
  });

  it('AC-STK-8 otro dispositivo (otro id local) revierte un pedido facturado usando el remoteId', async () => {
    await facturar(pedido({ remoteId: 'R-1' }));
    // Dispositivo B: mismo pedido con id local 99
    const rev = await aplicarStockPedido(pedido({ id: 99, remoteId: 'R-1', estado: 'pendiente' }));
    expect(rev).toHaveLength(2);
    expect(rev.every(m => m.ref === 'pedido:R-1')).toBe(true);
    expect(await stock(1)).toBe(10);
  });

  it('AC-STK-8 movimientos con ref local + remoto del mismo pedido se suman (no duplica al facturar)', async () => {
    await facturar(pedido()); // pedido-local:5
    // Simula que el re-key no llegó a correr y el pedido ya tiene remoteId: aplicarStockPedido lo re-keyea antes
    const r = await aplicarStockPedido(pedido({ remoteId: 'R-7' }));
    expect(r).toEqual([]);
    expect(await stock(1)).toBe(7);
  });

  // B3 residual — CERRADO como "no alcanzable" (iter 3). Una fila con ref
  // "pedido-local:*" solo podría llegar a Supabase si algún dispositivo la
  // subiera, y syncStock las retiene siempre (S-11), también en el camino de
  // reintento fila por fila (S-12) y en lotes de más de 200. Este test fija
  // ese invariante sobre una secuencia offline completa.
  it('AC-STK-8 B3 (no alcanzable): syncStock NUNCA sube refs locales, en ningún camino', async () => {
    // facturar → editar → revertir → re-facturar → borrar, todo offline
    await facturar(pedido());
    await aplicarStockPedido(pedido({ items: [{ productoId: 1, cantidad: 5 }] }));
    await aplicarStockPedido(pedido({ estado: 'pendiente' }));
    await facturar(pedido({ id: 6 }));
    await aplicarStockPedido(pedido({ id: 6, borrado: true, estado: 'eliminado' }));
    // + 250 movimientos de otros pedidos locales (fuerza > 1 lote de 200)
    for (let i = 0; i < 250; i++) {
      mockDb.movs.push({ id: `loc-${i}`, productoId: '1', cantidad: -1, tipo: 'venta', ref: `pedido-local:${100 + i}`, pendingSync: true });
    }
    mockDb.movs.push({ id: 'ok', productoId: '2', cantidad: 1, tipo: 'ingreso', ref: 'ingreso:z', pendingSync: true });
    const locales = mockDb.movs.filter(m => String(m.ref).startsWith('pedido-local:')).length;
    expect(locales).toBeGreaterThan(250);
    // camino normal
    await syncStock({ full: true });
    // camino de error de dato → reintento fila por fila
    mockDb.movs.find(m => m.id === 'ok').pendingSync = true;
    mockSb.upsertQueue = [{ code: '23514', message: 'check' }];
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await syncStock({ full: true });
    warn.mockRestore();
    const subidas = mockSb.upserts.filter(u => u.table === 'movimientos_stock').flatMap(u => u.rows);
    expect(subidas.length).toBeGreaterThan(0);
    expect(subidas.filter(r => String(r.ref).startsWith('pedido-local:'))).toEqual([]);
    expect(mockDb.movs.filter(m => String(m.ref).startsWith('pedido-local:')).every(m => m.pendingSync)).toBe(true);
  });
});

describe('Fix B2 (iter 2): solo "Facturar" inicia el control de stock de un pedido', () => {
  // Antes era BUG B2: re-guardar un pedido facturado antes del ledger
  // ("Pasar a deudas", armado, a reparto, cambio de vendedor/fecha) lo
  // descontaba entero como venta nueva. Corregido en 082c552.
  it('AC-STK-5 re-guardar un pedido facturado antes del ledger (sin movimientos) no descuenta stock retroactivamente', async () => {
    const legacy = pedido({ remoteId: 'R-OLD', deudaGenerada: true });
    const nuevos = await aplicarStockPedido(legacy, { usuario: 'Admin' });
    expect(nuevos).toEqual([]);
    expect(addMovimientosStock).not.toHaveBeenCalled();
    expect(await stock(1)).toBe(10);
  });

  it('AC-STK-5 tampoco al marcar armado / a reparto / revertir un pedido legacy', async () => {
    for (const p of [
      pedido({ armado: true }), pedido({ aReparto: true }), pedido({ estado: 'pendiente' }),
      pedido({ borrado: true, estado: 'eliminado' }),
    ]) {
      expect(await aplicarStockPedido(p)).toEqual([]);
    }
    expect(await stock(1)).toBe(10);
  });

  it('AC-STK-2 "Facturar" (iniciar:true) sí descuenta un pedido sin movimientos', async () => {
    const nuevos = await aplicarStockPedido(pedido(), { iniciar: true });
    expect(nuevos).toHaveLength(2);
    expect(await stock(1)).toBe(7);
  });

  it('AC-STK-4 un pedido que ya tiene movimientos se sigue reconciliando sin iniciar (editar/revertir)', async () => {
    await facturar(pedido());
    await aplicarStockPedido(pedido({ items: [{ productoId: 1, cantidad: 4 }, { productoId: 2, cantidad: 2 }] }));
    expect(await stock(1)).toBe(6);
    await aplicarStockPedido(pedido({ estado: 'pendiente' }));
    expect(await stock(1)).toBe(10);
    // Revertido: los movimientos existen (netos 0) → re-facturar sin iniciar vuelve a descontar
    // (el pedido ya estaba bajo control de stock).
    await aplicarStockPedido(pedido());
    expect(await stock(1)).toBe(7);
  });

  it('AC-STK-8 movimientos facturados offline (ref local) se reconocen después del re-key sin iniciar', async () => {
    await facturar(pedido());
    expect(await aplicarStockPedido(pedido({ remoteId: 'R-9', armado: true }))).toEqual([]);
    expect(mockDb.movs.filter(m => m.tipo === 'venta').every(m => m.ref === 'pedido:R-9')).toBe(true);
    expect(await stock(1)).toBe(7);
  });
});

describe('previsualizarStockPedido (AC-STK-6)', () => {
  it('AC-STK-6 sin faltantes decide "ok" y no graba nada', async () => {
    const r = await previsualizarStockPedido(pedido(), PRODUCTOS);
    expect(r.decision).toBe('ok');
    expect(r.nuevos).toHaveLength(2);
    expect(addMovimientosStock).not.toHaveBeenCalled();
  });

  it('AC-STK-6 iter 4: facturar productos SIN inventario cargado (sin movimientos) no pide confirmación', async () => {
    mockDb.movs = [];
    const r = await previsualizarStockPedido(pedido(), PRODUCTOS);
    expect(r.decision).toBe('ok');
    expect(r.faltantes).toEqual([]);
    expect(r.nuevos).toHaveLength(2); // igual se descontará al facturar
    const b = await previsualizarStockPedido(pedido(), PRODUCTOS, 'bloquear');
    expect(b.decision).toBe('ok');
  });

  it('AC-STK-6 iter 4: con inventario solo de algunos productos, controla esos y no los otros', async () => {
    mockDb.movs = [{ id: 'i1', productoId: '1', cantidad: 2, tipo: 'inicial', ref: 'ajuste:1', pendingSync: false }];
    const r = await previsualizarStockPedido(pedido({ items: [{ productoId: 1, cantidad: 3 }, { productoId: 2, cantidad: 99 }] }), PRODUCTOS);
    expect(r.decision).toBe('confirmar');
    expect(r.faltantes.map(f => f.productoId)).toEqual(['1']);
  });

  it('AC-STK-6 iter 4: un producto con inventario cargado en 0 (movimientos netos 0) SÍ se controla', async () => {
    mockDb.movs = [
      { id: 'i1', productoId: '1', cantidad: 5, tipo: 'inicial', ref: 'ajuste:1' },
      { id: 'a1', productoId: '1', cantidad: -5, tipo: 'ajuste', ref: 'ajuste:1' },
    ];
    const r = await previsualizarStockPedido(pedido({ items: [{ productoId: 1, cantidad: 1 }] }), PRODUCTOS);
    expect(r.decision).toBe('confirmar');
  });

  it('AC-STK-6 con faltantes: "confirmar" con política advertir, "bloquear" con bloquear', async () => {
    const p = pedido({ items: [{ productoId: 1, cantidad: 15 }] });
    const r = await previsualizarStockPedido(p, PRODUCTOS);
    expect(r.decision).toBe('confirmar');
    expect(r.faltantes).toEqual([{ productoId: '1', nombre: 'Alfajor', disponible: 10, requerido: 15, resultante: -5 }]);
    const b = await previsualizarStockPedido(p, PRODUCTOS, 'bloquear');
    expect(b.decision).toBe('bloquear');
  });

  it('AC-STK-6 re-facturar un pedido ya facturado no reporta faltante (ya está descontado)', async () => {
    await facturar(pedido({ items: [{ productoId: 1, cantidad: 10 }] }));
    const r = await previsualizarStockPedido(pedido({ items: [{ productoId: 1, cantidad: 10 }] }), PRODUCTOS);
    expect(r.decision).toBe('ok');
    expect(r.nuevos).toEqual([]);
  });
});

describe('ajustarStock (AC-PROD-3)', () => {
  it('AC-PROD-3 stock inicial genera movimiento "inicial" y la edición un "ajuste" por la diferencia', async () => {
    mockDb.movs = [];
    const ini = await ajustarStock(30, 12, { usuario: 'Admin', inicial: true });
    expect(ini).toMatchObject({ productoId: '30', cantidad: 12, tipo: 'inicial' });
    const aj = await ajustarStock(30, 9, { usuario: 'Admin' });
    expect(aj).toMatchObject({ productoId: '30', cantidad: -3, tipo: 'ajuste' });
    expect(await stock(30)).toBe(9);
    expect(await ajustarStock(30, 9)).toBeNull();
    expect(addMovimientosStock).toHaveBeenCalledTimes(2);
  });

  it('AC-PROD-3 iter 4 (bloqueante 2): con `base` el ajuste es nuevo − base, sin pisar lo que llegó mientras tanto', async () => {
    mockDb.movs = [{ id: 'i', productoId: '40', cantidad: 10, tipo: 'inicial', ref: 'ajuste:40' }];
    // el usuario vio 10; mientras editaba se facturaron 3 en otro dispositivo
    mockDb.movs.push({ id: 'v', productoId: '40', cantidad: -3, tipo: 'venta', ref: 'pedido:R' });
    const mov = await ajustarStock(40, 12, { usuario: 'Admin', base: 10 });
    expect(mov).toMatchObject({ cantidad: 2, tipo: 'ajuste' });
    expect(await stock(40)).toBe(9);
  });

  it('AC-PROD-3 iter 4: base igual al nuevo ⇒ no registra nada aunque el ledger haya cambiado', async () => {
    mockDb.movs = [{ id: 'i', productoId: '40', cantidad: 7, tipo: 'inicial', ref: 'ajuste:40' }];
    expect(await ajustarStock(40, 10, { base: 10 })).toBeNull();
    expect(addMovimientosStock).not.toHaveBeenCalled();
  });

  it('AC-PROD-3 iter 4: base 0 explícita se respeta (no cae al ledger)', async () => {
    mockDb.movs = [{ id: 'i', productoId: '40', cantidad: 7, tipo: 'inicial', ref: 'ajuste:40' }];
    const mov = await ajustarStock(40, 4, { base: 0 });
    expect(mov.cantidad).toBe(4);
  });

  it('AC-PROD-3 stock inválido tira error y no graba', async () => {
    await expect(ajustarStock(1, -1)).rejects.toThrow(/Stock inválido/);
    await expect(ajustarStock(1, '2.5')).rejects.toThrow(/Stock inválido/);
    expect(addMovimientosStock).not.toHaveBeenCalled();
  });
});

describe('registrarIngreso (REQ-ING)', () => {
  beforeEach(() => { mockDb.proveedores = [{ id: 'prov-1', codigo: 'ARC', descripcion: 'Arcor' }]; });

  it('AC-ING-5 graba 1 cabecera + N movimientos "ingreso" y el stock sube exactamente', async () => {
    const r = await registrarIngreso(
      { facturaProveedor: 'A-1', proveedorId: 'prov-1', items: [{ productoId: '1', ingreso: '5' }, { productoId: '2', ingreso: 7 }] },
      { productos: PRODUCTOS, usuario: 'Admin' },
    );
    expect(r.ok).toBe(true);
    expect(mockDb.ingresos).toHaveLength(1);
    expect(mockDb.ingresos[0].items.map(i => [i.stockActual, i.ingreso, i.stockTotal])).toEqual([[10, 5, 15], [10, 7, 17]]);
    expect(r.movimientos.every(m => m.tipo === 'ingreso' && m.ref === `ingreso:${r.ingreso.id}`)).toBe(true);
    expect(await stock(1)).toBe(15);
    expect(await stock(2)).toBe(17);
  });

  it('AC-ING-4 la misma factura del mismo proveedor no se ingresa dos veces', async () => {
    const form = { facturaProveedor: 'A-1', proveedorId: 'prov-1', items: [{ productoId: '1', ingreso: '5' }] };
    await registrarIngreso(form, { productos: PRODUCTOS });
    const r2 = await registrarIngreso({ ...form, facturaProveedor: ' a-1 ' }, { productos: PRODUCTOS });
    expect(r2.ok).toBe(false);
    expect(r2.errores.facturaProveedor).toMatch(/ya fue ingresada/);
    expect(await stock(1)).toBe(15);
  });

  it('AC-ING-3 ingreso no entero / cero / repetido se rechaza sin grabar', async () => {
    const r = await registrarIngreso(
      { facturaProveedor: 'B', proveedorId: 'prov-1', items: [{ productoId: '1', ingreso: '1.5' }, { productoId: '2', ingreso: '0' }] },
      { productos: PRODUCTOS },
    );
    expect(r.ok).toBe(false);
    // iter 2 (fix B5): errores de renglón por producto, no por posición
    expect(Object.keys(r.errores)).toEqual(['item:1', 'item:2']);
    const rep = await registrarIngreso(
      { facturaProveedor: 'B', proveedorId: 'prov-1', items: [{ productoId: '1', ingreso: '1' }, { productoId: 1, ingreso: '2' }] },
      { productos: PRODUCTOS },
    );
    expect(rep.errores['item:1']).toMatch(/repetido/);
    expect(mockDb.ingresos).toHaveLength(0);
  });
});

describe('syncStock (AC-STK-8)', () => {
  it('AC-STK-8 sube solo lo pendiente con upsert onConflict id y limpia solo esos ids', async () => {
    mockDb.movs.push({ id: 'p1', productoId: '1', cantidad: -2, tipo: 'venta', ref: 'pedido:R', fecha: '2026-10-07T00:00:00Z', pendingSync: true });
    mockDb.movs.push({ id: 'p2', productoId: '2', cantidad: 3, tipo: 'ingreso', ref: 'ingreso:x', fecha: '2026-10-07T00:00:00Z', pendingSync: true });
    const r = await syncStock();
    expect(r.ok).toBe(true);
    expect(r.subidos).toEqual({
      proveedores: { subidos: 0, fallidos: [] },
      ingresos: { subidos: 0, fallidos: [] },
      movimientos: { subidos: 2, fallidos: [] },
    });
    const up = mockSb.upserts.filter(u => u.table === 'movimientos_stock');
    expect(up).toHaveLength(1);
    expect(up[0].opts).toEqual({ onConflict: 'id' });
    expect(up[0].rows.map(x => x.id)).toEqual(['p1', 'p2']);
    expect(up[0].rows[0]).toEqual({ id: 'p1', producto_id: '1', cantidad: -2, tipo: 'venta', ref: 'pedido:R', fecha: '2026-10-07T00:00:00Z', usuario: null, nota: null });
    expect(clearMovimientosPendingSync).toHaveBeenCalledWith(['p1', 'p2']);
    // no hay tablas proveedores/ingresos con pendientes ⇒ no se llama upsert vacío
    expect(mockSb.upserts.filter(u => u.table !== 'movimientos_stock')).toHaveLength(0);
  });

  it('AC-STK-8 reintentar el sync no vuelve a subir lo ya subido', async () => {
    mockDb.movs.push({ id: 'p1', productoId: '1', cantidad: -2, tipo: 'venta', ref: 'pedido:R', pendingSync: true });
    await syncStock();
    mockSb.upserts = [];
    const r = await syncStock();
    expect(r.subidos.movimientos).toEqual({ subidos: 0, fallidos: [] });
    expect(mockSb.upserts).toHaveLength(0);
  });

  it('AC-STK-8 si falla el upsert no limpia pendingSync (se reintenta)', async () => {
    mockDb.movs.push({ id: 'p1', productoId: '1', cantidad: -2, tipo: 'venta', ref: 'pedido:R', pendingSync: true });
    mockSb.upsertError.movimientos_stock = { code: '500', message: 'boom' };
    await expect(syncStock()).rejects.toMatchObject({ message: 'boom' });
    expect(clearMovimientosPendingSync).not.toHaveBeenCalled();
    expect(mockDb.movs.find(m => m.id === 'p1').pendingSync).toBe(true);
  });

  it('AC-STK-8 baja movimientos remotos sin pisar los locales pendientes y guarda el cursor', async () => {
    mockDb.movs.push({ id: 'local-pend', productoId: '1', cantidad: -1, tipo: 'venta', ref: 'pedido:Z', pendingSync: true });
    mockSb.upsertError.movimientos_stock = null;
    // El push limpia local-pend; para probar el merge, el remoto trae otro.
    mockSb.remoto.movimientos_stock = [
      { id: 'rem-1', producto_id: '1', cantidad: -4, tipo: 'venta', ref: 'pedido:Q', fecha: 'f', updated_at: '2026-10-07T10:00:00Z' },
      { id: 'rem-2', producto_id: '2', cantidad: 6, tipo: 'ingreso', ref: 'ingreso:y', fecha: 'f', updated_at: '2026-10-07T11:00:00Z' },
    ];
    const r = await syncStock();
    expect(r.bajados.movimientos).toBe(2);
    expect(putMovimientosRemotos).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'rem-1', productoId: '1', cantidad: -4, pendingSync: false }),
      expect.objectContaining({ id: 'rem-2', productoId: '2', cantidad: 6, pendingSync: false }),
    ]);
    expect(await stock(1)).toBe(10 - 1 - 4);
    expect(localStorage.getItem('stockSyncCursor')).toBe('2026-10-07T11:00:00Z');
    // Siguiente sync liviano usa el cursor (incremental)
    mockSb.filtrosGt = [];
    await syncStock();
    // iter 4: el cursor se usa con 5 min de solape (11:00 − 5 min)
    expect(mockSb.filtrosGt).toEqual(expect.arrayContaining([{ table: 'movimientos_stock', col: 'updated_at', val: '2026-10-07T10:55:00.000Z' }]));
    // full ignora el cursor
    mockSb.filtrosGt = [];
    await syncStock({ full: true });
    expect(mockSb.filtrosGt.filter(f => f.table === 'movimientos_stock')).toHaveLength(0);
  });

  it('AC-STK-8 el mismo movimiento bajado dos veces no duplica (upsert por UUID local)', async () => {
    mockSb.remoto.movimientos_stock = [{ id: 'rem-1', producto_id: '1', cantidad: -4, tipo: 'venta', ref: 'pedido:Q', updated_at: '2026-10-07T10:00:00Z' }];
    await syncStock({ full: true });
    await syncStock({ full: true });
    expect(mockDb.movs.filter(m => m.id === 'rem-1')).toHaveLength(1);
    expect(await stock(1)).toBe(6);
  });

  it.each([
    [{ code: '42P01', message: 'relation "public.movimientos_stock" does not exist' }],
    [{ code: 'PGRST205', message: "Could not find the table 'public.proveedores' in the schema cache" }],
  ])('AC-STK-8 si la tabla no existe en Supabase devuelve {skipped:true} sin romper (%o)', async (error) => {
    mockDb.movs.push({ id: 'p1', productoId: '1', cantidad: -2, tipo: 'venta', ref: 'pedido:R', pendingSync: true });
    mockSb.upsertError.movimientos_stock = error;
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(syncStock()).resolves.toEqual({ ok: true, skipped: true });
    expect(mockDb.movs.find(m => m.id === 'p1').pendingSync).toBe(true);
    warn.mockRestore();
  });

  it('AC-STK-8 también tolera tabla inexistente en el pull', async () => {
    mockSb.selectError = { code: '42P01', message: 'relation does not exist' };
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(syncStock()).resolves.toEqual({ ok: true, skipped: true });
    warn.mockRestore();
  });

  // ---- Fix B3 / S-11 (iter 2): retención de refs locales ----
  it('AC-STK-8 S-11 NO sube movimientos con ref "pedido-local:*" (esperan el re-key) y los deja pendientes', async () => {
    await facturar(pedido()); // offline: 2 ventas con ref pedido-local:5
    mockDb.movs.push({ id: 'ing-1', productoId: '1', cantidad: 4, tipo: 'ingreso', ref: 'ingreso:x', pendingSync: true });
    const r = await syncStock();
    const up = mockSb.upserts.filter(u => u.table === 'movimientos_stock');
    expect(up).toHaveLength(1);
    expect(up[0].rows.map(x => x.id)).toEqual(['ing-1']);
    expect(up.flatMap(u => u.rows).some(x => String(x.ref).startsWith('pedido-local:'))).toBe(false);
    expect(r.subidos.movimientos).toEqual({ subidos: 1, fallidos: [] });
    expect(mockDb.movs.filter(m => m.ref === 'pedido-local:5').every(m => m.pendingSync)).toBe(true);
  });

  it('AC-STK-8 S-11 después del re-key (pedido con remoteId) esos movimientos sí se suben', async () => {
    await facturar(pedido());
    await syncStock();
    mockSb.upserts = [];
    await aplicarStockPedido(pedido({ remoteId: 'R-5' })); // guardado posterior: re-key
    const r = await syncStock();
    const rows = mockSb.upserts.filter(u => u.table === 'movimientos_stock').flatMap(u => u.rows);
    expect(rows).toHaveLength(2);
    expect(rows.every(x => x.ref === 'pedido:R-5')).toBe(true);
    expect(r.subidos.movimientos.subidos).toBe(2);
  });

  // ---- S-12 (iter 2): errores de dato fila por fila ----
  it('AC-STK-8 S-12 ante un error de dato (23514) reintenta fila por fila, sube las buenas y deja pendiente la mala', async () => {
    mockDb.movs.push({ id: 'ok-1', productoId: '1', cantidad: -1, tipo: 'venta', ref: 'pedido:A', pendingSync: true });
    mockDb.movs.push({ id: 'bad', productoId: '1', cantidad: 9e9, tipo: 'ajuste', ref: 'ajuste:1', pendingSync: true });
    mockDb.movs.push({ id: 'ok-2', productoId: '2', cantidad: 2, tipo: 'ingreso', ref: 'ingreso:z', pendingSync: true });
    const chk = { code: '23514', message: 'violates check constraint "movimientos_cantidad_chk"' };
    // 1° lote completo falla; después fila por fila: ok-1 ok, bad falla, ok-2 ok
    mockSb.upsertQueue = [chk, null, chk, null];
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await syncStock();
    warn.mockRestore();
    expect(r.subidos.movimientos.subidos).toBe(2);
    expect(r.subidos.movimientos.fallidos).toEqual([{ id: 'bad', error: chk.message }]);
    const pend = Object.fromEntries(mockDb.movs.map(m => [m.id, m.pendingSync]));
    expect(pend).toMatchObject({ 'ok-1': false, bad: true, 'ok-2': false });
  });

  it('AC-STK-8 S-12 un error que no es de dato (red/500) sigue cortando sin limpiar nada', async () => {
    mockDb.movs.push({ id: 'p1', productoId: '1', cantidad: -2, tipo: 'venta', ref: 'pedido:R', pendingSync: true });
    mockSb.upsertQueue = [{ code: '503', message: 'Service Unavailable' }];
    await expect(syncStock()).rejects.toMatchObject({ code: '503' });
    expect(clearMovimientosPendingSync).not.toHaveBeenCalled();
  });

  it('AC-PROV-4 sube proveedores pendientes a la tabla proveedores (PK UUID)', async () => {
    mockDb.proveedores = [
      { id: 'uuid-a', codigo: 'ARC', descripcion: 'Arcor', pendingSync: true },
      { id: 'uuid-b', codigo: 'MOL', descripcion: 'Molinos', pendingSync: false },
    ];
    mockSb.remoto.proveedores = [{ id: 'uuid-b', codigo: 'MOL', descripcion: 'Molinos' }];
    await syncStock();
    const up = mockSb.upserts.find(u => u.table === 'proveedores');
    expect(up.rows).toEqual([{ id: 'uuid-a', codigo: 'ARC', descripcion: 'Arcor' }]);
    expect(up.opts).toEqual({ onConflict: 'id' });
  });

  // ---- iter 4 (no bloqueante 8): proveedores borrados en otro dispositivo ----
  it('AC-PROV-4 un proveedor borrado en Supabase (no vino en el pull completo) se borra local', async () => {
    mockDb.proveedores = [
      { id: 'uuid-x', codigo: 'X', descripcion: 'Borrado en otro celu', pendingSync: false },
      { id: 'uuid-b', codigo: 'MOL', descripcion: 'Molinos', pendingSync: false },
    ];
    mockSb.remoto.proveedores = [{ id: 'uuid-b', codigo: 'MOL', descripcion: 'Molinos' }];
    await syncStock();
    expect(mockDb.proveedores.map(p => p.id)).toEqual(['uuid-b']);
    expect(db.deleteProveedor).toHaveBeenCalledWith('uuid-x');
    expect(db.deleteProveedor).toHaveBeenCalledTimes(1);
  });

  it('AC-PROV-4 si Supabase devuelve 0 proveedores (lectura mal configurada) no se borra nada local', async () => {
    mockDb.proveedores = [{ id: 'uuid-b', codigo: 'MOL', descripcion: 'Molinos', pendingSync: false }];
    mockSb.remoto.proveedores = [];
    await syncStock();
    expect(mockDb.proveedores.map(p => p.id)).toEqual(['uuid-b']);
    expect(db.deleteProveedor).not.toHaveBeenCalled();
  });

  it('AC-PROV-4 un proveedor local pendiente de subir NO se borra aunque no esté en el remoto', async () => {
    // El upsert del push falla con error de dato ⇒ queda pendingSync y no está en el pull.
    mockDb.proveedores = [{ id: 'uuid-nuevo', codigo: 'N', descripcion: 'Nuevo', pendingSync: true }];
    mockSb.upsertQueue = [{ code: '23505', message: 'dup' }, { code: '23505', message: 'dup' }];
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await syncStock();
    warn.mockRestore();
    expect(mockDb.proveedores.map(p => p.id)).toEqual(['uuid-nuevo']);
    expect(db.deleteProveedor).not.toHaveBeenCalled();
  });

  it('AC-PROV-4 si la tabla proveedores no existe (skipped) no se borra nada local', async () => {
    mockDb.proveedores = [{ id: 'uuid-b', codigo: 'MOL', descripcion: 'Molinos', pendingSync: false }];
    mockSb.selectError = { code: '42P01', message: 'relation does not exist' };
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(syncStock()).resolves.toEqual({ ok: true, skipped: true });
    warn.mockRestore();
    expect(mockDb.proveedores).toHaveLength(1);
  });
});

// REQ-BUL: el botón "Bulto" solo cambia item.cantidad; el stock lo reconcilia
// aplicarStockPedido por diferencia (mismo mecanismo de AC-STK-4).
describe('REQ-BUL: sumar bultos a un pedido facturado (AC-BUL-7)', () => {
  const { sumarBulto } = jest.requireActual('../../domain/bultos');

  beforeEach(() => {
    seed([{ id: 'ini-1', productoId: '1', cantidad: 100, tipo: 'inicial', ref: 'ajuste:1' }]);
  });

  it('AC-BUL-7 pasar de 5 a 41 con 3 bultos x12 emite solo la diferencia (-36) y re-aplicar no emite nada', async () => {
    const original = pedido({ items: [{ productoId: 1, nombre: 'Alfajor', cantidad: 5 }] });
    await facturar(original);
    expect(await stock(1)).toBe(95);

    const cantidad = sumarBulto(5, 12, 3);
    expect(cantidad).toBe(41);
    const editado = pedido({ items: [{ productoId: 1, nombre: 'Alfajor', cantidad }] });
    const nuevos = await aplicarStockPedido(editado);
    expect(nuevos).toHaveLength(1);
    expect(nuevos[0]).toMatchObject({ productoId: '1', cantidad: -36, tipo: 'venta' });
    expect(await stock(1)).toBe(100 - 41);

    // Doble toque de Guardar / reintento: idempotente.
    expect(await aplicarStockPedido(editado)).toEqual([]);
    expect(await stock(1)).toBe(59);
  });

  it('AC-BUL-7 un pedido facturado sin movimientos (legacy) no descuenta al sumar bultos sin iniciar', async () => {
    const legacy = pedido({ remoteId: 'R-LEG', items: [{ productoId: 1, nombre: 'Alfajor', cantidad: sumarBulto(5, 12, 3) }] });
    expect(await aplicarStockPedido(legacy)).toEqual([]);
    expect(addMovimientosStock).not.toHaveBeenCalled();
    expect(await stock(1)).toBe(100);
  });
});
