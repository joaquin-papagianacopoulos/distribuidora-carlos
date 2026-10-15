// REQ-PAN (AC-PAN-1): upgrade de IndexedDB v11 -> v12. Solo AGREGA costosVenta (cache de solo
// lectura de los costos que captura el servidor); no borra, no vacía ni reescribe nada.
describe('AC-PAN-1 DB_VERSION 12 agrega costosVenta sin tocar datos', () => {
  const V11 = ['productos', 'clientes', 'pedidos', 'vendedores', 'faltantes', 'deudas', 'proveedores', 'movimientosStock', 'ingresos',
    'comisionesCierres', 'comisionesBorradores', 'comisionesRubro', 'pedidosWebAcciones', 'cambiosPrecio',
    'ingresosCostos', 'cuentaProveedores', 'comprobantesPendientes', 'pedidosProveedor', 'rendiciones', 'cuentaClientes'];

  const correr = async (existentes) => {
    jest.resetModules();
    const creados = []; const borrados = []; const clears = []; const tocados = [];
    const stores = new Set(existentes);
    const fakeDb = {
      objectStoreNames: { contains: (n) => stores.has(n) },
      createObjectStore: (n, opts) => { stores.add(n); creados.push([n, opts]); return { createIndex: () => tocados.push('index') }; },
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
          req.onupgradeneeded && req.onupgradeneeded({ target, oldVersion: 11 });
          req.onsuccess && req.onsuccess({ target: { result: fakeDb } });
        }, 0);
        return req;
      },
    };
    const mod = require('../index');
    await mod.initDB();
    return { creados, borrados, clears, tocados, version };
  };

  it('AC-PAN-1 desde v11 crea SOLO costosVenta (clave pedidoId, sin pendingSync ni autoIncrement)', async () => {
    const r = await correr(V11);
    expect(r.version).toBe(12);
    expect(r.creados).toEqual([['costosVenta', { keyPath: 'pedidoId' }]]);
  });

  it('AC-PAN-1 no borra ni vacía nada, no reescribe datos y es idempotente', async () => {
    const r = await correr(V11);
    expect(r.borrados).toEqual([]);
    expect(r.clears).toEqual([]);
    expect(r.tocados).toEqual([]);
    expect((await correr([...V11, 'costosVenta'])).creados).toEqual([]);
  });

  it('AC-PAN-1 el upgrade usa if (!contains) y no tiene deleteObjectStore ni clear()', () => {
    const { readFileSync } = require('fs');
    const path = require('path');
    const src = readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
    const upgrade = src.slice(src.indexOf('request.onupgradeneeded'), src.indexOf('request.onblocked'));
    expect(upgrade).toContain("if (!d.objectStoreNames.contains('costosVenta'))");
    expect(upgrade).not.toMatch(/deleteObjectStore|\.clear\(/);
    expect(src).toMatch(/const DB_VERSION = 12;/);
  });
});
