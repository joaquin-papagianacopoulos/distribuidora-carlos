// S-COM-13 (iteracion 3): upgrade de IndexedDB v5 -> v6. Solo quita la
// propiedad "pin" de los vendedores; no borra registros ni stores.
describe('AC-SEC-4 S-COM-13 DB_VERSION 6 quita el PIN local sin borrar datos', () => {
  // MOD (RUN 20261014-1449, AC-COMR-7): TODOS incluye el store de v7.
  const TODOS = ['productos', 'clientes', 'pedidos', 'vendedores', 'faltantes', 'deudas', 'proveedores', 'movimientosStock', 'ingresos', 'comisionesCierres', 'comisionesBorradores', 'comisionesRubro'];

  const correr = async ({ oldVersion, vendedores, conTx = true }) => {
    jest.resetModules();
    const filas = vendedores.map(v => ({ ...v }));
    const actualizados = [];
    const borrados = [];
    const stores = new Set(TODOS);
    const cursorStore = {
      openCursor: () => {
        const req = {};
        let i = 0;
        const emitir = () => {
          const cursor = i < filas.length ? {
            value: filas[i],
            update: (v) => { actualizados.push(v); filas[i] = v; },
            delete: () => borrados.push(filas[i]),
            continue: () => { i += 1; setTimeout(emitir, 0); },
          } : null;
          req.onsuccess && req.onsuccess({ target: { result: cursor } });
        };
        setTimeout(emitir, 0);
        return req;
      },
    };
    const fakeDb = {
      objectStoreNames: { contains: (n) => stores.has(n) },
      createObjectStore: jest.fn(),
      deleteObjectStore: jest.fn(),
      close: jest.fn(),
    };
    let version = null;
    global.indexedDB = {
      open: (_n, v) => {
        version = v;
        const req = {};
        setTimeout(() => {
          const target = { result: fakeDb, transaction: conTx ? { objectStore: () => cursorStore } : null };
          req.onupgradeneeded && req.onupgradeneeded({ target, oldVersion });
          setTimeout(() => req.onsuccess && req.onsuccess({ target: { result: fakeDb } }), 20);
        }, 0);
        return req;
      },
    };
    const mod = require('../index');
    await mod.initDB();
    await new Promise(r => setTimeout(r, 30));
    return { filas, actualizados, borrados, version, fakeDb };
  };

  it('AC-SEC-4 S-COM-13 desde v5 borra solo la propiedad pin, deja tienePin y conserva todos los registros', async () => {
    const r = await correr({
      oldVersion: 5,
      vendedores: [
        { id: 1, remoteId: 7, nombre: 'Jorge', permiso: 1, pin: '4821', zona: '' },
        { id: 2, remoteId: 8, nombre: 'Carlos', permiso: 2, pin: null },
        { id: 3, remoteId: 9, nombre: 'Ana', permiso: 3, tienePin: false },
      ],
    });
    // MOD (RUN 20261014-1449, AC-COMR-7): la versión actual pasó a 7.
    expect(r.version).toBe(8); // MOD (RUN 20261014-2100, REQ-WEB)
    expect(r.filas).toEqual([
      { id: 1, remoteId: 7, nombre: 'Jorge', permiso: 1, zona: '', tienePin: true },
      { id: 2, remoteId: 8, nombre: 'Carlos', permiso: 2, tienePin: false },
      { id: 3, remoteId: 9, nombre: 'Ana', permiso: 3, tienePin: false },
    ]);
    expect(r.actualizados).toHaveLength(2); // el que no tenia pin no se reescribe
    expect(r.borrados).toEqual([]);
    expect(r.fakeDb.deleteObjectStore).not.toHaveBeenCalled();
    expect(JSON.stringify(r.filas)).not.toContain('4821');
  });

  it('AC-SEC-4 S-COM-13 ya en v6 (o sin transaccion de upgrade) no toca los vendedores', async () => {
    const r6 = await correr({ oldVersion: 6, vendedores: [{ id: 1, pin: '1' }] });
    expect(r6.actualizados).toEqual([]);
    const sinTx = await correr({ oldVersion: 5, vendedores: [{ id: 1, pin: '1' }], conTx: false });
    expect(sinTx.actualizados).toEqual([]);
  });
});
