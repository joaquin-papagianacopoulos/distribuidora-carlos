// REQ-HPR (AC-HPR-1): upgrade de IndexedDB v8 -> v9. Solo AGREGA el store
// cambiosPrecio (clave UUID); no borra, no vacía ni reescribe nada.
describe('AC-HPR-1 DB_VERSION 9 agrega cambiosPrecio sin tocar datos', () => {
  const V8 = ['productos', 'clientes', 'pedidos', 'vendedores', 'faltantes', 'deudas', 'proveedores', 'movimientosStock', 'ingresos', 'comisionesCierres', 'comisionesBorradores', 'comisionesRubro', 'pedidosWebAcciones', 'ingresosCostos', 'cuentaProveedores', 'comprobantesPendientes', 'pedidosProveedor', 'rendiciones', 'cuentaClientes', 'costosVenta']; // MOD (RUN 20261015-1541): los de v10 ya existen

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
          req.onupgradeneeded && req.onupgradeneeded({ target, oldVersion: 8 });
          req.onsuccess && req.onsuccess({ target: { result: fakeDb } });
        }, 0);
        return req;
      },
    };
    const mod = require('../index');
    await mod.initDB();
    return { creados, indices, borrados, clears, tocados, version };
  };

  it('AC-HPR-1 desde v8 crea SOLO cambiosPrecio con keyPath id (UUID) e índices productoId y fecha', async () => {
    const r = await correr(V8);
    expect(r.version).toBe(12); // MOD (RUN 20261015-2019, REQ-PAN): v12 suma costosVenta. // MOD (RUN 20261015-1630, REQ-REN): v11 suma rendiciones y cuentaClientes.
    expect(r.creados).toEqual([['cambiosPrecio', { keyPath: 'id' }]]);
    expect(r.indices).toEqual([
      ['cambiosPrecio', 'productoId', 'productoId', { unique: false }],
      ['cambiosPrecio', 'fecha', 'fecha', { unique: false }],
    ]);
  });

  it('AC-HPR-1 no borra ni vacía ningún store ni reescribe productos', async () => {
    const r = await correr(V8);
    expect(r.borrados).toEqual([]);
    expect(r.clears).toEqual([]);
    expect(r.tocados).toEqual([]);
  });

  it('AC-HPR-1 es idempotente: si el store ya existe no crea nada', async () => {
    const r = await correr([...V8, 'cambiosPrecio']);
    expect(r.creados).toEqual([]);
  });

  it('AC-HPR-1 el upgrade usa if (!contains) y no tiene deleteObjectStore ni clear()', () => {
    const { readFileSync } = require('fs');
    const path = require('path');
    const src = readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
    const upgrade = src.slice(src.indexOf('request.onupgradeneeded'), src.indexOf('request.onblocked'));
    expect(upgrade).toContain("if (!d.objectStoreNames.contains('cambiosPrecio'))");
    expect(upgrade).not.toMatch(/deleteObjectStore|\.clear\(/);
    expect(src).toMatch(/const DB_VERSION = 12;/);
  });
});
