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

  it('AC-COM-16 desde v4 crea solo comisionesCierres y comisionesBorradores y no borra ni vacía nada', async () => {
    const r = await correrUpgrade(V4);
    // Iteracion 3: la version actual es 6 (S-COM-13); el paso v4 -> v5 sigue creando solo estos stores.
    expect(r.version).toBe(6);
    expect(r.creados.map(c => c[0]).sort()).toEqual(['comisionesBorradores', 'comisionesCierres']);
    expect(r.creados.every(c => c[1].keyPath === 'id' && !c[1].autoIncrement)).toBe(true);
    expect(r.borrados).toEqual([]);
    expect(r.clears).toEqual([]);
  });

  it('AC-COM-16 es idempotente: si los stores ya existen no vuelve a crear nada', async () => {
    const r = await correrUpgrade([...V4, 'comisionesCierres', 'comisionesBorradores']);
    expect(r.creados).toEqual([]);
    expect(r.borrados).toEqual([]);
  });
});
