// REQ-WEB (RUN 20261014-2100): upgrade de IndexedDB v7 -> v8. Solo AGREGA el
// store pedidosWebAcciones (clave UUID); no borra, no vacía ni toca pedidos.
describe('AC-WEB-6 DB_VERSION 8 agrega pedidosWebAcciones sin tocar datos', () => {
  const V7 = ['productos', 'clientes', 'pedidos', 'vendedores', 'faltantes', 'deudas', 'proveedores', 'movimientosStock', 'ingresos', 'comisionesCierres', 'comisionesBorradores', 'comisionesRubro'];

  const correr = async (existentes) => {
    jest.resetModules();
    const creados = [];
    const indices = [];
    const borrados = [];
    const clears = [];
    const tocados = [];
    const stores = new Set(existentes);
    const fakeDb = {
      objectStoreNames: { contains: (n) => stores.has(n) },
      createObjectStore: (n, opts) => {
        stores.add(n);
        creados.push([n, opts]);
        return { createIndex: (nombre, path, o) => indices.push([n, nombre, path, o]) };
      },
      deleteObjectStore: (n) => borrados.push(n),
      transaction: (n) => ({ objectStore: () => ({ clear: () => clears.push(n), put: () => tocados.push(n) }) }),
      close: jest.fn(),
    };
    let version = null;
    global.indexedDB = {
      open: (_n, v) => {
        version = v;
        const req = {};
        setTimeout(() => {
          const target = { result: fakeDb, transaction: { objectStore: () => ({ openCursor: () => { tocados.push('cursor'); return {}; } }) } };
          req.onupgradeneeded && req.onupgradeneeded({ target, oldVersion: 7 });
          req.onsuccess && req.onsuccess({ target: { result: fakeDb } });
        }, 0);
        return req;
      },
    };
    const mod = require('../index');
    await mod.initDB();
    return { creados, indices, borrados, clears, tocados, version };
  };

  it('AC-WEB-6 desde v7 crea SOLO pedidosWebAcciones con keyPath id (UUID) e índice pedidoRemoteId', async () => {
    const r = await correr(V7);
    expect(r.version).toBe(8);
    expect(r.creados).toEqual([['pedidosWebAcciones', { keyPath: 'id' }]]);
    expect(r.indices).toEqual([['pedidosWebAcciones', 'pedidoRemoteId', 'pedidoRemoteId', { unique: false }]]);
  });

  it('AC-WEB-6 no borra ni vacía ningún store ni reescribe pedidos', async () => {
    const r = await correr(V7);
    expect(r.borrados).toEqual([]);
    expect(r.clears).toEqual([]);
    expect(r.tocados).toEqual([]);
  });

  it('AC-WEB-6 es idempotente: si el store ya existe no crea nada', async () => {
    const r = await correr([...V7, 'pedidosWebAcciones']);
    expect(r.creados).toEqual([]);
  });

  it('AC-WEB-6 el upgrade usa if (!contains) y no tiene deleteObjectStore ni clear()', () => {
    const { readFileSync } = require('fs');
    const path = require('path');
    const src = readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
    const upgrade = src.slice(src.indexOf('request.onupgradeneeded'), src.indexOf('request.onblocked'));
    expect(upgrade).toContain("if (!d.objectStoreNames.contains('pedidosWebAcciones'))");
    expect(upgrade).not.toMatch(/deleteObjectStore|\.clear\(/);
  });
});
