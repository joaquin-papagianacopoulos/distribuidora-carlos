// REQ-CAT (AC-CAT-1): upgrade de IndexedDB v12 -> v13. Solo AGREGA catalogoMarcas.
describe('AC-CAT-1 DB_VERSION 13 agrega catalogoMarcas sin tocar datos', () => {
  const V12 = ['productos', 'clientes', 'pedidos', 'vendedores', 'faltantes', 'deudas', 'proveedores', 'movimientosStock', 'ingresos',
    'comisionesCierres', 'comisionesBorradores', 'comisionesRubro', 'pedidosWebAcciones', 'cambiosPrecio',
    'ingresosCostos', 'cuentaProveedores', 'comprobantesPendientes', 'pedidosProveedor', 'rendiciones', 'cuentaClientes', 'costosVenta'];

  const correr = async (existentes) => {
    jest.resetModules();
    const creados = []; const borrados = []; const clears = [];
    const stores = new Set(existentes);
    const fakeDb = {
      objectStoreNames: { contains: (n) => stores.has(n) },
      createObjectStore: (n, opts) => { stores.add(n); creados.push([n, opts]); return { createIndex: () => {} }; },
      deleteObjectStore: (n) => borrados.push(n),
      transaction: (n) => ({ objectStore: () => ({ clear: () => clears.push(n) }) }),
      close: jest.fn(),
    };
    let version = null;
    global.indexedDB = {
      open: (_n, v) => {
        version = v;
        const req = {};
        setTimeout(() => {
          req.onupgradeneeded && req.onupgradeneeded({ target: { result: fakeDb, transaction: { objectStore: () => ({ openCursor: () => ({}) }) } }, oldVersion: 12 });
          req.onsuccess && req.onsuccess({ target: { result: fakeDb } });
        }, 0);
        return req;
      },
    };
    await require('../index').initDB();
    return { creados, borrados, clears, version };
  };

  it('desde v12 crea SOLO catalogoMarcas (clave productoId) y no borra nada', async () => {
    const r = await correr(V12);
    expect(r.version).toBe(13);
    expect(r.creados).toEqual([['catalogoMarcas', { keyPath: 'productoId' }]]);
    expect(r.borrados).toEqual([]);
    expect(r.clears).toEqual([]);
  });

  it('es idempotente', async () => {
    expect((await correr([...V12, 'catalogoMarcas'])).creados).toEqual([]);
  });
});
