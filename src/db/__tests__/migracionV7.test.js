// REQ-COMR (RUN 20261014-1449): upgrade de IndexedDB v6 -> v7. Solo AGREGA el
// store comisionesRubro (clave UUID); no borra, no vacía y no recorre ningún
// store. Los clientes conservan su `comision` vieja (AC-COMR-1 / AC-COMR-7).
describe('AC-COMR-7 DB_VERSION 7 agrega comisionesRubro sin tocar datos', () => {
  const V6 = ['productos', 'clientes', 'pedidos', 'vendedores', 'faltantes', 'deudas', 'proveedores', 'movimientosStock', 'ingresos', 'comisionesCierres', 'comisionesBorradores'];

  const correr = async ({ existentes, oldVersion = 6, clientes = [] }) => {
    jest.resetModules();
    const creados = [];
    const indices = [];
    const borrados = [];
    const clears = [];
    const storesTocados = [];
    const filasClientes = clientes.map(c => ({ ...c }));
    const stores = new Set(existentes);
    const storeFalso = (nombre) => {
      storesTocados.push(nombre);
      return {
        clear: () => clears.push(nombre),
        openCursor: () => { storesTocados.push(`cursor:${nombre}`); return {}; },
        put: () => storesTocados.push(`put:${nombre}`),
        delete: () => borrados.push(`fila:${nombre}`),
      };
    };
    const fakeDb = {
      objectStoreNames: { contains: (n) => stores.has(n) },
      createObjectStore: (n, opts) => {
        stores.add(n);
        creados.push([n, opts]);
        return { createIndex: (nombre, path, o) => indices.push([n, nombre, path, o]) };
      },
      deleteObjectStore: (n) => borrados.push(n),
      transaction: (n) => ({ objectStore: () => storeFalso(n) }),
      close: jest.fn(),
    };
    let version = null;
    global.indexedDB = {
      open: (_n, v) => {
        version = v;
        const req = {};
        setTimeout(() => {
          const target = { result: fakeDb, transaction: { objectStore: storeFalso } };
          req.onupgradeneeded && req.onupgradeneeded({ target, oldVersion });
          req.onsuccess && req.onsuccess({ target: { result: fakeDb } });
        }, 0);
        return req;
      },
    };
    const mod = require('../index');
    await mod.initDB();
    return { creados, indices, borrados, clears, storesTocados, version, filasClientes };
  };

  it('AC-COMR-7 desde v6 crea SOLO comisionesRubro con keyPath id (UUID, sin autoIncrement) e índices vendedorId y clave', async () => {
    const r = await correr({ existentes: V6 });
    // MOD (RUN 20261014-2100, REQ-WEB): la versión pasó a 8; desde v6 también se crea pedidosWebAcciones.
    expect(r.version).toBe(9);
    expect(r.creados).toEqual([['pedidosWebAcciones', { keyPath: 'id' }], ['comisionesRubro', { keyPath: 'id' }], ['cambiosPrecio', { keyPath: 'id' }]]);
    expect(r.creados[1][1].autoIncrement).toBeUndefined();
    expect(r.indices).toEqual([
      ['pedidosWebAcciones', 'pedidoRemoteId', 'pedidoRemoteId', { unique: false }],
      ['comisionesRubro', 'vendedorId', 'vendedorId', { unique: false }],
      ['comisionesRubro', 'clave', 'clave', { unique: false }],
      ['cambiosPrecio', 'productoId', 'productoId', { unique: false }],
      ['cambiosPrecio', 'fecha', 'fecha', { unique: false }],
    ]);
  });

  it('AC-COMR-7 AC-COMR-1 no borra ni vacía ningún store, no recorre clientes y la comision vieja queda igual', async () => {
    const r = await correr({ existentes: V6, clientes: [{ id: 1, nombre: 'Kiosco', comision: 4 }] });
    expect(r.borrados).toEqual([]);
    expect(r.clears).toEqual([]);
    expect(r.storesTocados).toEqual([]);
    expect(r.filasClientes).toEqual([{ id: 1, nombre: 'Kiosco', comision: 4 }]);
  });

  it('AC-COMR-7 es idempotente: si comisionesRubro ya existe no crea nada', async () => {
    const r = await correr({ existentes: [...V6, 'comisionesRubro', 'pedidosWebAcciones', 'cambiosPrecio'] });
    expect(r.creados).toEqual([]);
    expect(r.borrados).toEqual([]);
  });

  it('AC-COMR-7 el código del upgrade no tiene deleteObjectStore ni clear() y usa if (!contains)', () => {
    const { readFileSync } = require('fs');
    const path = require('path');
    const src = readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
    const upgrade = src.slice(src.indexOf('request.onupgradeneeded'), src.indexOf('request.onblocked'));
    expect(upgrade).toContain("if (!d.objectStoreNames.contains('comisionesRubro'))");
    expect(upgrade).not.toMatch(/deleteObjectStore|\.clear\(/);
    expect(src).toMatch(/const DB_VERSION = 9;/);
  });
});
