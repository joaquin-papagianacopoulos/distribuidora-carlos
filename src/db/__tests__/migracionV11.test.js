// REQ-REN: upgrade de IndexedDB v10 -> v11. Solo AGREGA rendiciones y cuentaClientes;
// no borra, no vacía ni reescribe nada.
describe('AC-REN-2 DB_VERSION 11 agrega stores de rendición sin tocar datos', () => {
  const V10 = ['productos', 'clientes', 'pedidos', 'vendedores', 'faltantes', 'deudas', 'proveedores', 'movimientosStock', 'ingresos',
    'comisionesCierres', 'comisionesBorradores', 'comisionesRubro', 'pedidosWebAcciones', 'cambiosPrecio',
    'ingresosCostos', 'cuentaProveedores', 'comprobantesPendientes', 'pedidosProveedor'];

  const correr = async (existentes, { oldVersion = 10 } = {}) => {
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
          req.onupgradeneeded && req.onupgradeneeded({ target, oldVersion });
          req.onsuccess && req.onsuccess({ target: { result: fakeDb } });
        }, 0);
        return req;
      },
    };
    const mod = require('../index');
    await mod.initDB();
    return { creados, indices, borrados, clears, tocados, version };
  };

  it('AC-REN-2 desde v10 crea SOLO rendiciones y cuentaClientes, keyPath id (sin autoIncrement) e índices', async () => {
    const r = await correr(V10);
    expect(r.version).toBe(11);
    expect(r.creados).toEqual([['rendiciones', { keyPath: 'id' }], ['cuentaClientes', { keyPath: 'id' }]]);
    expect(r.indices).toEqual([
      ['rendiciones', 'pedidoId', 'pedidoId', { unique: false }],
      ['rendiciones', 'clienteId', 'clienteId', { unique: false }],
      ['rendiciones', 'fecha', 'fecha', { unique: false }],
      ['rendiciones', 'estado', 'estado', { unique: false }],
      ['cuentaClientes', 'clienteId', 'clienteId', { unique: false }],
      ['cuentaClientes', 'rendicionId', 'rendicionId', { unique: false }],
    ]);
  });

  it('AC-REN-4 no borra ni vacía ningún store ni reescribe datos; es idempotente', async () => {
    const r = await correr(V10);
    expect(r.borrados).toEqual([]);
    expect(r.clears).toEqual([]);
    expect(r.tocados).toEqual([]);
    const r2 = await correr([...V10, 'rendiciones', 'cuentaClientes']);
    expect(r2.creados).toEqual([]);
  });

  it('AC-REN-4 el upgrade usa if (!contains) y no tiene deleteObjectStore ni clear()', () => {
    const { readFileSync } = require('fs');
    const path = require('path');
    const src = readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
    const upgrade = src.slice(src.indexOf('request.onupgradeneeded'), src.indexOf('request.onblocked'));
    for (const s of ['rendiciones', 'cuentaClientes']) expect(upgrade).toContain(`if (!d.objectStoreNames.contains('${s}'))`);
    expect(upgrade).not.toMatch(/deleteObjectStore|\.clear\(/);
    expect(src).toMatch(/const DB_VERSION = 11;/);
  });
});

describe('AC-REN-2 addRendicionConMovimientos: una sola transacción', () => {
  it('AC-REN-2 rendición + movimientos en la misma transacción, todo pendiente de subir', async () => {
    jest.resetModules();
    const llamadas = [];
    const t = {};
    const fakeDb = {
      objectStoreNames: { contains: () => true },
      transaction: (stores, modo) => {
        llamadas.push(['tx', stores, modo]);
        setTimeout(() => t.oncomplete && t.oncomplete(), 0);
        t.objectStore = (n) => ({ add: (v) => llamadas.push(['add', n, v]) });
        return t;
      },
    };
    global.indexedDB = {
      open: () => {
        const req = {};
        setTimeout(() => req.onsuccess && req.onsuccess({ target: { result: fakeDb } }), 0);
        return req;
      },
    };
    const mod = require('../index');
    await mod.initDB();
    await mod.addRendicionConMovimientos({ id: 'r1', estado: 'vigente' }, [{ id: 'r1:0:a' }, { id: 'r1:1:a' }]);
    expect(llamadas.filter(l => l[0] === 'tx')).toEqual([['tx', ['rendiciones', 'movimientosStock'], 'readwrite']]);
    expect(llamadas.find(l => l[1] === 'rendiciones')[2]).toMatchObject({ id: 'r1', pendingSync: true });
    expect(llamadas.filter(l => l[1] === 'movimientosStock').map(l => l[2])).toEqual([
      expect.objectContaining({ id: 'r1:0:a', pendingSync: true }), expect.objectContaining({ id: 'r1:1:a', pendingSync: true }),
    ]);
  });
});
