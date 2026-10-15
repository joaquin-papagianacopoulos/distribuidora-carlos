// QA REQ-COM (AC-COM-16): el upgrade de IndexedDB v4 -> v5 solo agrega stores.
// Se simula indexedDB para ejecutar el onupgradeneeded real de src/db/index.js.
describe('AC-COM-16 DB_VERSION 5 migra sin borrar datos de v4', () => {
  const V4 = ['productos', 'clientes', 'pedidos', 'vendedores', 'faltantes', 'deudas', 'proveedores', 'movimientosStock', 'ingresos'];

  const correrUpgrade = async (existentes) => {
    jest.resetModules();
    const creados = [];
    const borrados = [];
    const clears = [];
    const stores = new Set(existentes);
    const fakeDb = {
      objectStoreNames: { contains: (n) => stores.has(n) },
      createObjectStore: (n, opts) => { stores.add(n); creados.push([n, opts]); return { createIndex: jest.fn() }; },
      deleteObjectStore: (n) => borrados.push(n),
      transaction: () => ({ objectStore: () => ({ clear: () => clears.push(1) }) }),
      close: jest.fn(),
    };
    let version = null;
    global.indexedDB = {
      open: (_n, v) => {
        version = v;
        const req = {};
        setTimeout(() => {
          req.result = fakeDb;
          req.onupgradeneeded && req.onupgradeneeded({ target: { result: fakeDb } });
          req.onsuccess && req.onsuccess({ target: { result: fakeDb } });
        }, 0);
        return req;
      },
    };
    const mod = require('../index');
    await (mod.initDB ? mod.initDB() : mod.getProductos());
    return { creados, borrados, clears, version };
  };

  // MOD (RUN 20261014-1449, AC-COMR-7): antes la versión era 6 y desde v4 se
  // creaban 2 stores; ahora la versión es 7 y desde v4 también se crea
  // comisionesRubro (v7). Sigue sin borrar ni vaciar nada.
  it('AC-COM-16 AC-COMR-7 desde v4 crea solo comisionesCierres, comisionesBorradores y comisionesRubro y no borra ni vacía nada', async () => {
    const r = await correrUpgrade(V4);
    // MOD (RUN 20261014-2100, REQ-WEB): la versión pasó a 8 y suma pedidosWebAcciones.
    expect(r.version).toBe(8);
    expect(r.creados.map(c => c[0]).sort()).toEqual(['comisionesBorradores', 'comisionesCierres', 'comisionesRubro', 'pedidosWebAcciones']);
    expect(r.creados.every(c => c[1].keyPath === 'id' && !c[1].autoIncrement)).toBe(true);
    expect(r.borrados).toEqual([]);
    expect(r.clears).toEqual([]);
  });

  it('AC-COM-16 es idempotente: si los stores ya existen no vuelve a crear nada', async () => {
    // MOD (RUN 20261014-1449, AC-COMR-7): comisionesRubro se suma a los existentes.
    const r = await correrUpgrade([...V4, 'comisionesCierres', 'comisionesBorradores', 'comisionesRubro', 'pedidosWebAcciones']);
    expect(r.creados).toEqual([]);
    expect(r.borrados).toEqual([]);
  });
});
