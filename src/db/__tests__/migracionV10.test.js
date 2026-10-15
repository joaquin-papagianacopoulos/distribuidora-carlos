// REQ-INA / REQ-CPR: upgrade de IndexedDB v9 -> v10. Solo AGREGA 4 stores
// (ingresosCostos, cuentaProveedores, comprobantesPendientes, pedidosProveedor);
// no borra, no vacía ni reescribe nada.
describe('AC-INA-1 AC-CPR-1 DB_VERSION 10 agrega stores sin tocar datos', () => {
  const V9 = ['productos', 'clientes', 'pedidos', 'vendedores', 'faltantes', 'deudas', 'proveedores', 'movimientosStock', 'ingresos', 'comisionesCierres', 'comisionesBorradores', 'comisionesRubro', 'pedidosWebAcciones', 'cambiosPrecio'];

  const correr = async (existentes, { oldVersion = 9 } = {}) => {
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

  it('AC-INA-1 desde v9 crea SOLO los 4 stores nuevos, con keyPath id (UUID) e índices', async () => {
    const r = await correr(V9);
    expect(r.version).toBe(10);
    expect(r.creados).toEqual([
      ['ingresosCostos', { keyPath: 'id' }],
      ['cuentaProveedores', { keyPath: 'id' }],
      ['comprobantesPendientes', { keyPath: 'id' }],
      ['pedidosProveedor', { keyPath: 'id' }],
    ]);
    expect(r.creados.every(c => c[1].autoIncrement === undefined)).toBe(true);
    expect(r.indices).toEqual([
      ['ingresosCostos', 'proveedorId', 'proveedorId', { unique: false }],
      ['ingresosCostos', 'fecha', 'fecha', { unique: false }],
      ['cuentaProveedores', 'proveedorId', 'proveedorId', { unique: false }],
      ['cuentaProveedores', 'fecha', 'fecha', { unique: false }],
      ['pedidosProveedor', 'proveedorId', 'proveedorId', { unique: false }],
      ['pedidosProveedor', 'estado', 'estado', { unique: false }],
    ]);
  });

  it('AC-INA-5 no borra ni vacía ningún store ni reescribe datos existentes', async () => {
    const r = await correr(V9);
    expect(r.borrados).toEqual([]);
    expect(r.clears).toEqual([]);
    expect(r.tocados).toEqual([]);
  });

  it('AC-INA-5 es idempotente: si los stores ya existen no crea nada', async () => {
    const r = await correr([...V9, 'ingresosCostos', 'cuentaProveedores', 'comprobantesPendientes', 'pedidosProveedor']);
    expect(r.creados).toEqual([]);
    expect(r.borrados).toEqual([]);
  });

  it('AC-INA-5 desde una base vieja (v1) también termina sin borrar nada', async () => {
    const r = await correr([], { oldVersion: 0 });
    expect(r.borrados).toEqual([]);
    expect(r.clears).toEqual([]);
    expect(r.creados.map(c => c[0])).toEqual(expect.arrayContaining(['ingresosCostos', 'cuentaProveedores', 'comprobantesPendientes', 'pedidosProveedor', 'ingresos', 'movimientosStock']));
  });

  it('AC-INA-5 el upgrade usa if (!contains) y no tiene deleteObjectStore ni clear()', () => {
    const { readFileSync } = require('fs');
    const path = require('path');
    const src = readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
    const upgrade = src.slice(src.indexOf('request.onupgradeneeded'), src.indexOf('request.onblocked'));
    for (const s of ['ingresosCostos', 'cuentaProveedores', 'comprobantesPendientes', 'pedidosProveedor']) {
      expect(upgrade).toContain(`if (!d.objectStoreNames.contains('${s}'))`);
    }
    expect(upgrade).not.toMatch(/deleteObjectStore|\.clear\(/);
    expect(src).toMatch(/const DB_VERSION = 10;/);
  });
});

describe('AC-INA-1 addIngresoCompleto: una sola transacción', () => {
  const montar = async () => {
    jest.resetModules();
    const llamadas = [];
    const t = { };
    const fakeDb = {
      objectStoreNames: { contains: () => true },
      transaction: (stores, modo) => {
        llamadas.push(['tx', stores, modo]);
        setTimeout(() => t.oncomplete && t.oncomplete(), 0);
        t.objectStore = (n) => ({
          add: (v) => llamadas.push(['add', n, v]),
          put: (v) => llamadas.push(['put', n, v]),
        });
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
    return { mod, llamadas };
  };

  it('AC-INA-1 con costos: ingreso + costos + movimientos en la misma transacción', async () => {
    const { mod, llamadas } = await montar();
    await mod.addIngresoCompleto({ id: 'i1', items: [] }, { renglones: [] }, [{ id: 'm1' }, { id: 'm2' }]);
    expect(llamadas.filter(l => l[0] === 'tx')).toHaveLength(1);
    expect(llamadas[0][1]).toEqual(['ingresos', 'ingresosCostos', 'movimientosStock']);
    expect(llamadas.find(l => l[0] === 'put' && l[1] === 'ingresosCostos')[2]).toMatchObject({ id: 'i1', pendingSync: true });
    expect(llamadas.filter(l => l[0] === 'add' && l[1] === 'movimientosStock')).toHaveLength(2);
    expect(llamadas.find(l => l[0] === 'add' && l[1] === 'ingresos')[2]).toMatchObject({ id: 'i1', pendingSync: true });
  });

  it('AC-INA-5 sin costos: no toca ingresosCostos y graba lo mismo que antes', async () => {
    const { mod, llamadas } = await montar();
    await mod.addIngresoCompleto({ id: 'i2', items: [] }, null, [{ id: 'm1' }]);
    expect(llamadas[0][1]).toEqual(['ingresos', 'movimientosStock']);
    expect(llamadas.some(l => l[1] === 'ingresosCostos')).toBe(false);
  });
});
