// REQ-HPR (AC-HPR-1): addProductoLocal / updateProducto registran el cambio de
// precio en la MISMA transacción que el producto, leyendo el previo dentro de ella.
describe('AC-HPR-1 cambios de precio atómicos con el producto', () => {
  const montar = async (productosIniciales = []) => {
    jest.resetModules();
    const mem = { productos: new Map(productosIniciales.map(p => [p.id, { ...p }])), cambiosPrecio: new Map() };
    const transacciones = [];
    let seq = 100;
    const crearTx = (nombres) => {
      const t = { nombres: [].concat(nombres) };
      let abiertas = 0;
      const cerrar = () => setTimeout(() => { if (abiertas === 0 && t.oncomplete) t.oncomplete(); }, 0);
      const pedir = (fn) => {
        const req = {};
        abiertas += 1;
        setTimeout(() => {
          req.result = fn();
          if (req.onsuccess) req.onsuccess();
          abiertas -= 1;
          cerrar();
        }, 0);
        return req;
      };
      t.objectStore = (n) => ({
        get: (k) => pedir(() => { const v = mem[n].get(k); return v ? { ...v } : undefined; }),
        put: (v) => pedir(() => { mem[n].set(v.id, { ...v }); return v.id; }),
        add: (v) => pedir(() => {
          const id = v.id !== undefined ? v.id : ++seq;
          mem[n].set(id, { ...v, id });
          return id;
        }),
      });
      transacciones.push(t);
      return t;
    };
    const fakeDb = {
      objectStoreNames: { contains: () => true },
      transaction: (n) => crearTx(n),
      close: jest.fn(),
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
    return { mod, mem, transacciones };
  };

  it('AC-HPR-1 editar el precio guarda producto y cambio en una sola transacción, con el previo de la base', async () => {
    const { mod, mem, transacciones } = await montar([{ id: 7, codigo: 'A1', nombre: 'Alfajor', categoria: 'Golosinas', precio: 100, precioBulto: 0 }]);
    // El estado de pantalla trae un precio viejo (95): el "anterior" tiene que salir de la base (100).
    await mod.updateProducto({ id: 7, codigo: 'A1', nombre: 'Alfajor', categoria: 'Golosinas', precio: 120, precioBulto: 0 }, { usuario: { id: 'u1', nombre: 'Admin' } });
    expect(transacciones).toHaveLength(1);
    expect(transacciones[0].nombres.sort()).toEqual(['cambiosPrecio', 'productos']);
    expect(mem.productos.get(7)).toMatchObject({ precio: 120, pendingSync: true });
    const cambios = [...mem.cambiosPrecio.values()];
    expect(cambios).toHaveLength(1);
    expect(cambios[0]).toMatchObject({ productoId: '7', precioAnterior: 100, precioNuevo: 120, usuarioNombre: 'Admin', pendingSync: true });
    expect(typeof cambios[0].id).toBe('string');
  });

  it('AC-HPR-1 editar sin cambiar precio ni precioBulto no registra nada', async () => {
    const { mod, mem } = await montar([{ id: 7, codigo: 'A1', nombre: 'Alfajor', precio: 100, precioBulto: 0 }]);
    await mod.updateProducto({ id: 7, codigo: 'A1', nombre: 'Alfajor Triple', precio: 100, precioBulto: 0 });
    expect(mem.cambiosPrecio.size).toBe(0);
    expect(mem.productos.get(7).nombre).toBe('Alfajor Triple');
  });

  it('AC-HPR-1 cambiar solo el precio por bulto también registra', async () => {
    const { mod, mem } = await montar([{ id: 7, codigo: 'A1', nombre: 'Alfajor', precio: 100, precioBulto: 90 }]);
    await mod.updateProducto({ id: 7, codigo: 'A1', nombre: 'Alfajor', precio: 100, precioBulto: 85 });
    const c = [...mem.cambiosPrecio.values()][0];
    expect(c).toMatchObject({ precioBultoAnterior: 90, precioBultoNuevo: 85 });
  });

  it('AC-HPR-1 el alta con precio registra "anterior: null" con el id nuevo del producto', async () => {
    const { mod, mem } = await montar([]);
    const id = await mod.addProductoLocal({ codigo: 'N1', nombre: 'Nuevo', precio: 50, precioBulto: 0 }, { usuario: 'Admin' });
    const c = [...mem.cambiosPrecio.values()][0];
    expect(c).toMatchObject({ productoId: String(id), precioAnterior: null, precioNuevo: 50, usuarioNombre: 'Admin' });
  });

  it('AC-HPR-1 alta sin precio no registra y devuelve el id', async () => {
    const { mod, mem } = await montar([]);
    const id = await mod.addProductoLocal({ codigo: 'N2', nombre: 'Sin precio', precio: 0 });
    expect(id).toBeGreaterThan(0);
    expect(mem.cambiosPrecio.size).toBe(0);
  });
});
