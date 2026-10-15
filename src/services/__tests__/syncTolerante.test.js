// Sync tolerante de columnas nuevas (AC-CLI-5) en src/sync/syncService.js.
const mockLocal = { clientes: [], productos: [] };
jest.mock('../../db', () => {
  const impl = {
    getClientes: async () => mockLocal.clientes.map(c => ({ ...c })),
    getProductos: async () => mockLocal.productos.map(p => ({ ...p })),
    getVendedores: async () => [],
    clearClientesPendingSync: async (ids) => {
      const s = new Set(ids);
      mockLocal.clientes = mockLocal.clientes.map(c => (s.has(c.id) ? { ...c, pendingSync: false } : c));
    },
    clearProductosPendingSync: async (ids) => {
      const s = new Set(ids);
      mockLocal.productos = mockLocal.productos.map(p => (s.has(p.id) ? { ...p, pendingSync: false } : p));
    },
    putClientesBatch: async (rows) => {
      for (const r of rows) {
        const i = mockLocal.clientes.findIndex(c => c.id === r.id);
        if (i >= 0) mockLocal.clientes[i] = { ...r }; else mockLocal.clientes.push({ ...r });
      }
    },
    putProductosBatch: async (rows) => {
      for (const r of rows) {
        const i = mockLocal.productos.findIndex(c => c.id === r.id);
        if (i >= 0) mockLocal.productos[i] = { ...r }; else mockLocal.productos.push({ ...r });
      }
    },
    putVendedoresBatch: async () => undefined,
    // iter 2: patch sin tocar pendingSync (extrasPendientes / syncConflicto).
    patchRegistros: async (store, ids, patch) => {
      const s = new Set(ids || []);
      mockLocal[store] = (mockLocal[store] || []).map(r => (s.has(r.id) ? { ...r, ...patch } : r));
    },
  };
  const mod = { __impl: impl };
  for (const k of Object.keys(impl)) mod[k] = jest.fn(impl[k]);
  return mod;
});
jest.mock('../../services/imageSearch', () => ({
  isImageSearchConfigured: () => false, fetchProductImage: jest.fn(), ImageSearchQuotaError: class extends Error {},
}));

// Supabase falso: cola de respuestas para upsert y filas remotas para select.
const mockSb = { upserts: [], respuestas: [], remoto: {} };
jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table) => {
      const api = {
        upsert: (rows, opts) => {
          mockSb.upserts.push({ table, rows, opts });
          return Promise.resolve(mockSb.respuestas.shift() || { error: null });
        },
        select: () => api,
        range: () => api,
        then: (res, rej) => Promise.resolve({ data: mockSb.remoto[table] || [], error: null }).then(res, rej),
      };
      return api;
    },
  },
}));

import * as db from '../../db';
import { upsertTolerante, esColumnaInexistente, syncClientes, syncProductos, downloadMaestros } from '../../sync/syncService';

const ERR_DUP = { code: '23505', message: 'duplicate key value violates unique constraint "clientes_codigo_uq"' };
const ERR_COL = { code: 'PGRST204', message: "Could not find the 'ciudad' column of 'clientes' in the schema cache" };
let warnSpy;

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(db.__impl)) db[k].mockImplementation(db.__impl[k]);
  mockSb.upserts = [];
  mockSb.respuestas = [];
  mockSb.remoto = {};
  mockLocal.clientes = [];
  mockLocal.productos = [];
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => warnSpy.mockRestore());

describe('esColumnaInexistente', () => {
  it.each([
    [{ code: 'PGRST204' }, true],
    [{ code: '42703', message: 'column "ciudad" of relation "clientes" does not exist' }, true],
    [{ message: "Could not find the 'tipo_iva' column of 'clientes'" }, true],
    [{ code: '23505', message: 'duplicate key value violates unique constraint' }, false],
    [{ code: '42501', message: 'permission denied' }, false],
    [null, false],
    [undefined, false],
  ])('AC-CLI-5 %o → %s', (err, esperado) => {
    expect(esColumnaInexistente(err)).toBe(esperado);
  });
});

describe('upsertTolerante', () => {
  it('AC-CLI-5 con PGRST204 reintenta con las filas legacy y devuelve legacy:true', async () => {
    mockSb.respuestas = [{ error: ERR_COL }, { error: null }];
    const completas = [{ id: 1, nombre: 'A', ciudad: 'Rosario' }];
    const legacy = [{ id: 1, nombre: 'A' }];
    const r = await upsertTolerante('clientes', completas, legacy);
    expect(r).toEqual({ error: null, legacy: true });
    expect(mockSb.upserts).toHaveLength(2);
    expect(mockSb.upserts[0]).toEqual({ table: 'clientes', rows: completas, opts: { onConflict: 'id' } });
    expect(mockSb.upserts[1]).toEqual({ table: 'clientes', rows: legacy, opts: { onConflict: 'id' } });
  });

  it('AC-CLI-5 sin error no reintenta', async () => {
    const r = await upsertTolerante('clientes', [{ id: 1 }], [{ id: 1 }]);
    expect(r).toEqual({ error: null, legacy: false });
    expect(mockSb.upserts).toHaveLength(1);
  });

  it('AC-CLI-5 un error que no es de columna se devuelve sin reintentar', async () => {
    const err = { code: '42501', message: 'permission denied' };
    mockSb.respuestas = [{ error: err }];
    const r = await upsertTolerante('clientes', [{ id: 1 }], [{ id: 1 }]);
    expect(r).toEqual({ error: err, legacy: false });
    expect(mockSb.upserts).toHaveLength(1);
  });

  it('AC-CLI-5 si el reintento legacy también falla, devuelve ese error', async () => {
    const err2 = { code: '500', message: 'boom' };
    mockSb.respuestas = [{ error: ERR_COL }, { error: err2 }];
    const r = await upsertTolerante('clientes', [{ id: 1 }], [{ id: 1 }]);
    expect(r).toEqual({ error: err2, legacy: true });
  });
});

describe('syncClientes / syncProductos con columnas nuevas', () => {
  const CLIENTE = {
    id: 7, nombre: 'Kiosco', direccion: 'Mitre 1', telefono: '1144445555', pendingSync: true,
    codigo: 'C7', ciudad: 'Rosario', codigoPostal: 'S2000', provincia: 'Santa Fe', tipoIva: 'Monotributo',
    cuit: '20-12345678-6', comision: 2.5, fechaAlta: '2026-10-07',
    // iter 4: guardado desde el formulario de alta ⇒ extrasDirty
    extrasDirty: true,
  };

  it('AC-CLI-5 sube los campos nuevos en snake_case y limpia pendingSync', async () => {
    mockLocal.clientes = [CLIENTE, { id: 8, nombre: 'No pend', pendingSync: false }];
    await syncClientes();
    expect(mockSb.upserts).toHaveLength(1);
    const [row] = mockSb.upserts[0].rows;
    expect(mockSb.upserts[0].rows).toHaveLength(1);
    // MOD (RUN 20261014-1449, AC-COMR-1): antes el payload llevaba comision: 2.5;
    // ahora la clave no viaja (el upsert no pisa la columna en Supabase).
    expect(row).toMatchObject({
      id: 7, nombre: 'Kiosco', direccion: 'Mitre 1', codigo: 'C7', ciudad: 'Rosario', codigo_postal: 'S2000',
      provincia: 'Santa Fe', tipo_iva: 'Monotributo', cuit: '20-12345678-6', fecha_alta: '2026-10-07',
    });
    expect(row).not.toHaveProperty('comision');
    expect(db.clearClientesPendingSync).toHaveBeenCalledWith([7]);
  });

  it('AC-CLI-5 si la columna no existe en Supabase reintenta solo con columnas legacy y no corta el sync', async () => {
    mockLocal.clientes = [CLIENTE];
    mockSb.respuestas = [{ error: ERR_COL }, { error: null }];
    await expect(syncClientes()).resolves.toEqual({ ok: true });
    expect(mockSb.upserts[1].rows[0]).not.toHaveProperty('ciudad');
    expect(mockSb.upserts[1].rows[0]).toMatchObject({ id: 7, nombre: 'Kiosco', direccion: 'Mitre 1' });
    // (el console.warn de "faltan columnas" se emite una sola vez por sesión)
  });

  it('AC-PROD-2 syncProductos sube precio (Precio venta 1) y los campos nuevos; tolera columna faltante', async () => {
    mockLocal.productos = [{ id: 3, nombre: 'Alfajor', precio: 1111.5, costoFinal: 1000, descuento1: 10, ganancia: 30, bultoX: 12, minimoVenta: 6, proveedorId: 'prov-1', pendingSync: true, extrasDirty: true }];
    mockSb.respuestas = [{ error: { code: 'PGRST204', message: "Could not find the 'costo_final' column" } }, { error: null }];
    await syncProductos();
    expect(mockSb.upserts[0].rows[0]).toMatchObject({ id: 3, precio: 1111.5, costo_final: 1000, descuento1: 10, ganancia: 30, bulto_x: 12, minimo_venta: 6, proveedor_id: 'prov-1' });
    expect(mockSb.upserts[1].rows[0]).not.toHaveProperty('costo_final');
    expect(db.clearProductosPendingSync).toHaveBeenCalledWith([3]);
  });

  it('AC-PBU-1 syncProductos sube precio_bulto; sin la 010 sube igual lo demás y deja el precio por bulto pendiente', async () => {
    mockLocal.productos = [{ id: 3, nombre: 'Alfajor', precio: 900, precioBulto: 800, bultoX: 16, pendingSync: true, extrasDirty: true }];
    mockSb.respuestas = [{ error: { code: 'PGRST204', message: "Could not find the 'precio_bulto' column" } }, { error: null }];
    await syncProductos();
    expect(mockSb.upserts[0].rows[0]).toMatchObject({ id: 3, precio_bulto: 800, venta_por: 'ambos' });
    // Segundo intento: mantiene 001 + 006 (bulto_x, venta_por) y saca solo precio_bulto.
    expect(mockSb.upserts[1].rows[0]).not.toHaveProperty('precio_bulto');
    expect(mockSb.upserts[1].rows[0]).toMatchObject({ id: 3, bulto_x: 16, venta_por: 'ambos' });
    expect(db.clearProductosPendingSync).toHaveBeenCalledWith([3]);
    expect(mockLocal.productos[0].extrasPendientes).toBe(true);
  });

  it('AC-PBU-1 downloadMaestros baja precio_bulto y, si la columna no existe, conserva el local', async () => {
    mockLocal.productos = [{ id: 3, nombre: 'Alfajor', precio: 900, precioBulto: 800, pendingSync: false }];
    mockSb.remoto.productos = [{ id: 3, nombre: 'Alfajor', precio: 900 }];
    await downloadMaestros();
    expect(mockLocal.productos[0].precioBulto).toBe(800);
    mockSb.remoto.productos = [{ id: 3, nombre: 'Alfajor', precio: 900, precio_bulto: 750 }];
    await downloadMaestros();
    expect(mockLocal.productos[0].precioBulto).toBe(750);
  });

  it('AC-CLI-5 AC-CLI-6 downloadMaestros: si Supabase no tiene las columnas (undefined) conserva los valores locales', async () => {
    mockLocal.clientes = [{ ...CLIENTE, pendingSync: false }];
    mockSb.remoto.clientes = [{ id: 7, nombre: 'Kiosco SRL', direccion: 'Mitre 1', telefono: '1144445555' }];
    await downloadMaestros();
    const c = mockLocal.clientes.find(x => x.id === 7);
    expect(c).toMatchObject({ nombre: 'Kiosco SRL', codigo: 'C7', ciudad: 'Rosario', cuit: '20-12345678-6', comision: 2.5 });
  });

  it('AC-CLI-5 downloadMaestros: los campos nuevos que vienen de otro dispositivo se bajan', async () => {
    mockLocal.clientes = [{ id: 7, nombre: 'Kiosco', direccion: 'Mitre 1' }];
    mockSb.remoto.clientes = [{ id: 7, nombre: 'Kiosco', direccion: 'Mitre 1', codigo: 'C7', ciudad: 'Rosario', tipo_iva: 'Exento', codigo_postal: 'S2000', fecha_alta: '2026-10-01' }];
    await downloadMaestros();
    expect(mockLocal.clientes[0]).toMatchObject({ codigo: 'C7', ciudad: 'Rosario', tipoIva: 'Exento', codigoPostal: 'S2000', fechaAlta: '2026-10-01' });
  });

  // Antes BUG B1 (pérdida de campos nuevos al correr la migración tarde).
  // Corregido en 082c552: el upsert legacy marca extrasPendientes, y
  // downloadMaestros conserva los extras locales mientras esa marca esté.
  it('AC-CLI-5 después de un sync legacy y de correr la migración, los campos nuevos locales no se pierden', async () => {
    mockLocal.clientes = [CLIENTE];
    mockSb.respuestas = [{ error: ERR_COL }, { error: null }];
    await syncClientes(); // sin migración: sube legacy y limpia pendingSync
    expect(mockLocal.clientes[0]).toMatchObject({ pendingSync: false, extrasPendientes: true });
    // Migración corrida: las columnas existen pero en NULL para esa fila
    mockSb.remoto.clientes = [{
      id: 7, nombre: 'Kiosco', direccion: 'Mitre 1', telefono: '1144445555',
      codigo: null, ciudad: null, codigo_postal: null, provincia: null, zona: null, pais: 'Argentina',
      tipo_iva: null, cuit: null, vendedor: null, cobrador: null, comision: null, fecha_alta: null, tipo_cliente: null, rubro: null,
    }];
    await downloadMaestros();
    const c = mockLocal.clientes.find(x => x.id === 7);
    expect(c).toMatchObject({ codigo: 'C7', ciudad: 'Rosario', cuit: '20-12345678-6', tipoIva: 'Monotributo' });
  });

  // Antes BUG B4 (23505 por código repetido cortaba todo el sync). Corregido
  // en 082c552: fila por fila, las que chocan quedan pendientes con syncConflicto.
  it('AC-CLI-4 un código duplicado en Supabase (23505) no corta el sync de clientes', async () => {
    mockLocal.clientes = [CLIENTE];
    mockSb.respuestas = [{ error: ERR_DUP }, { error: ERR_DUP }];
    await expect(syncClientes()).resolves.toEqual({ ok: true });
    expect(mockLocal.clientes[0].pendingSync).toBe(true);
    expect(mockLocal.clientes[0].syncConflicto).toMatch(/repetido/i);
  });

  it('AC-CLI-4 con 23505 en un lote sube fila por fila: limpia las OK y marca solo la que choca', async () => {
    const OTRO = { ...CLIENTE, id: 8, codigo: 'C8', nombre: 'Almacén', syncConflicto: 'viejo' };
    mockLocal.clientes = [CLIENTE, OTRO];
    // lote → 23505; fila 7 → 23505 (choca); fila 8 → ok
    mockSb.respuestas = [{ error: ERR_DUP }, { error: ERR_DUP }, { error: null }];
    await syncClientes();
    expect(mockSb.upserts.map(u => u.rows.map(r => r.id))).toEqual([[7, 8], [7], [8]]);
    expect(db.clearClientesPendingSync).toHaveBeenCalledWith([8]);
    const [c7, c8] = mockLocal.clientes;
    expect(c7).toMatchObject({ pendingSync: true, syncConflicto: expect.stringMatching(/repetido/i) });
    expect(c8).toMatchObject({ pendingSync: false, syncConflicto: null, extrasPendientes: false });
  });

  it('AC-CLI-4 resuelto el conflicto (código cambiado) el próximo sync limpia syncConflicto', async () => {
    mockLocal.clientes = [{ ...CLIENTE, codigo: 'C7-B', syncConflicto: 'Código de cliente repetido' }];
    await syncClientes();
    expect(mockLocal.clientes[0]).toMatchObject({ pendingSync: false, syncConflicto: null });
  });

  it('AC-CLI-4 un error que no es 23505 ni RLS sigue lanzando (no se marca como conflicto)', async () => {
    mockLocal.clientes = [CLIENTE];
    mockSb.respuestas = [{ error: { code: '500', message: 'boom' } }];
    await expect(syncClientes()).rejects.toMatchObject({ message: 'boom' });
    expect(mockLocal.clientes[0].syncConflicto).toBeUndefined();
  });

  it('AC-CLI-5 extrasPendientes: el sync siguiente reintenta las columnas nuevas y, con la migración corrida, limpia la marca', async () => {
    mockLocal.clientes = [{ ...CLIENTE, pendingSync: false, extrasPendientes: true }];
    await syncClientes();
    expect(mockSb.upserts[0].rows[0]).toMatchObject({ id: 7, codigo: 'C7', ciudad: 'Rosario' });
    expect(mockLocal.clientes[0].extrasPendientes).toBe(false);
  });

  it('AC-CLI-5 productos: upsert legacy marca extrasPendientes y downloadMaestros no pisa costo/proveedor', async () => {
    mockLocal.productos = [{ id: 3, nombre: 'Alfajor', codigo: 'A', precio: 100, unidad: 'unidad', categoria: '', costoFinal: 80, proveedorId: 'prov-1', ganancia: 25, pendingSync: true, extrasDirty: true }];
    mockSb.respuestas = [{ error: { code: 'PGRST204', message: "Could not find the 'costo_final' column" } }, { error: null }];
    await syncProductos();
    expect(mockLocal.productos[0]).toMatchObject({ pendingSync: false, extrasPendientes: true });
    mockSb.remoto.productos = [{ id: 3, nombre: 'Alfajor', codigo: 'A', precio: 100, unidad: 'unidad', categoria: '', costo_final: null, proveedor_id: null, ganancia: null }];
    await downloadMaestros();
    expect(mockLocal.productos[0]).toMatchObject({ costoFinal: 80, proveedorId: 'prov-1', ganancia: 25, extrasPendientes: true });
  });

  // ---- iter 4, bloqueante 1 del revisor: extrasDirty ----
  it('AC-CLI-5 bloqueante 1: un cliente pendingSync SIN extrasDirty (reordenado desde Orden) NO manda codigo/cuit', async () => {
    mockLocal.clientes = [{
      id: 9, nombre: 'Kiosco', direccion: 'Mitre 1', telefono: '', pendingSync: true, ordenEntrega: 4, diaEntrega: 'lunes',
      // datos viejos en ESTE dispositivo (vendedor): no deben pisar lo que cargó el admin
      codigo: '', cuit: '', ciudad: '',
    }];
    await syncClientes();
    expect(mockSb.upserts).toHaveLength(1);
    const [row] = mockSb.upserts[0].rows;
    expect(row).toMatchObject({ id: 9, orden_entrega: 4, dia_entrega: 'lunes' });
    for (const col of ['codigo', 'cuit', 'ciudad', 'codigo_postal', 'provincia', 'tipo_iva', 'comision', 'fecha_alta', 'vendedor', 'rubro']) {
      expect(row).not.toHaveProperty(col);
    }
    expect(mockSb.upserts[0].opts).toEqual({ onConflict: 'id' });
    expect(mockLocal.clientes[0]).toMatchObject({ pendingSync: false, syncConflicto: null });
    expect(mockLocal.clientes[0].extrasPendientes).toBeUndefined();
  });

  it('AC-CLI-5 bloqueante 1: lote mixto ⇒ 1 upsert con extras (solo los dirty) + 1 upsert básico', async () => {
    mockLocal.clientes = [CLIENTE, { id: 9, nombre: 'Otro', direccion: 'X', pendingSync: true, codigo: 'VIEJO' }];
    await syncClientes();
    expect(mockSb.upserts).toHaveLength(2);
    const [conExtras, basico] = mockSb.upserts;
    expect(conExtras.rows.map(r => r.id)).toEqual([7]);
    expect(conExtras.rows[0]).toMatchObject({ codigo: 'C7', cuit: '20-12345678-6' });
    expect(basico.rows.map(r => r.id)).toEqual([9]);
    expect(basico.rows[0]).not.toHaveProperty('codigo');
    expect(mockLocal.clientes.find(c => c.id === 7)).toMatchObject({ extrasDirty: false, extrasPendientes: false });
  });

  it('AC-CLI-5 bloqueante 1: una vez subido, extrasDirty se limpia y el próximo guardado no-form sube solo lo básico', async () => {
    mockLocal.clientes = [CLIENTE];
    await syncClientes();
    mockSb.upserts = [];
    mockLocal.clientes = mockLocal.clientes.map(c => ({ ...c, pendingSync: true, ordenEntrega: 2 }));
    await syncClientes();
    expect(mockSb.upserts[0].rows[0]).not.toHaveProperty('codigo');
    expect(mockSb.upserts[0].rows[0]).toMatchObject({ id: 7, orden_entrega: 2 });
  });

  it('AC-CLI-4 iter 4: en el camino 23505 fila por fila, un error que NO es 23505 se relanza', async () => {
    mockLocal.clientes = [CLIENTE, { ...CLIENTE, id: 8, codigo: 'C8' }];
    mockSb.respuestas = [{ error: ERR_DUP }, { error: { code: '401', message: 'JWT expired' } }];
    await expect(syncClientes()).rejects.toMatchObject({ code: '401' });
    expect(mockLocal.clientes.every(c => !c.syncConflicto)).toBe(true);
  });

  it('AC-PROD-5 bloqueante 1: un producto importado por CSV (sin extrasDirty) sube solo columnas básicas', async () => {
    mockLocal.productos = [{ id: 4, nombre: 'Coca', codigo: 'CC', precio: 1600, unidad: 'unidad', categoria: 'Bebidas', costoFinal: 0, proveedorId: null, pendingSync: true }];
    await syncProductos();
    expect(mockSb.upserts).toHaveLength(1);
    const [row] = mockSb.upserts[0].rows;
    expect(row).toMatchObject({ id: 4, precio: 1600 });
    for (const col of ['costo_final', 'proveedor_id', 'descuento1', 'ganancia', 'bulto_x', 'minimo_venta', 'precio_venta2']) {
      expect(row).not.toHaveProperty(col);
    }
  });

  it('AC-CLI-5 iter 4: downloadMaestros no da por "igual" un producto pendiente con extrasDirty (no lo pisa)', async () => {
    mockLocal.productos = [{ id: 5, nombre: 'Alfajor', codigo: 'A', precio: 100, unidad: 'unidad', categoria: '', minimoVenta: 6, pendingSync: true, extrasDirty: true }];
    mockSb.remoto.productos = [{ id: 5, nombre: 'Alfajor', codigo: 'A', precio: 100, unidad: 'unidad', categoria: '', minimo_venta: 1 }];
    await downloadMaestros();
    expect(mockLocal.productos[0]).toMatchObject({ minimoVenta: 6, pendingSync: true, extrasDirty: true });
  });

  it('AC-CLI-5 iter 4: un producto pendiente que difiere solo en un campo nuevo (mínimo venta) no se pisa', async () => {
    mockLocal.productos = [{ id: 5, nombre: 'Alfajor', codigo: 'A', precio: 100, unidad: 'unidad', categoria: '', minimoVenta: 6, pendingSync: true }];
    mockSb.remoto.productos = [{ id: 5, nombre: 'Alfajor', codigo: 'A', precio: 100, unidad: 'unidad', categoria: '', minimo_venta: 1 }];
    await downloadMaestros();
    expect(mockLocal.productos[0]).toMatchObject({ minimoVenta: 6, pendingSync: true });
  });

  it('AC-CLI-5 iter 4: un producto pendiente idéntico al remoto (incluidos campos nuevos) se limpia', async () => {
    mockLocal.productos = [{ id: 5, nombre: 'Alfajor', codigo: 'A', precio: 100, unidad: 'unidad', categoria: '', pendingSync: true,
      proveedorId: null, costoFinal: 0, descuento1: 0, descuento2: 0, ganancia: 0, precioVenta2: 0, bultoX: 1, minimoVenta: 1 }];
    mockSb.remoto.productos = [{ id: 5, nombre: 'Alfajor', codigo: 'A', precio: 100, unidad: 'unidad', categoria: '' }];
    await downloadMaestros();
    expect(mockLocal.productos[0].pendingSync).toBe(false);
  });
});

// REQ-COMR (RUN 20261014-1449): el upsert de clientes no pisa ni borra la
// columna `comision` de Supabase (AC-COMR-1). Decisión del plan (1.3): la clave
// no viaja en ninguna fila; el dato viejo local se conserva tras el pull.
describe('AC-COMR-1 sync de clientes sin comision', () => {
  const BASE = { direccion: 'Mitre 1', telefono: '1144445555', pendingSync: true };

  it('AC-COMR-1 lote mixto (extrasDirty + básicos + uno con comision local): ninguna fila lleva la clave comision', async () => {
    mockLocal.clientes = [
      { ...BASE, id: 1, nombre: 'Con extras', codigo: 'A1', comision: 4, extrasDirty: true },
      { ...BASE, id: 2, nombre: 'Básico con comision', comision: 7 },
      { ...BASE, id: 3, nombre: 'Extras sin comision', codigo: 'A3', extrasDirty: true },
      { ...BASE, id: 4, nombre: 'Extras pendientes', codigo: 'A4', comision: 1.5, pendingSync: false, extrasPendientes: true },
    ];
    await syncClientes();
    expect(mockSb.upserts.length).toBeGreaterThan(0);
    const filas = mockSb.upserts.flatMap(u => u.rows);
    expect(filas.map(f => f.id).sort()).toEqual([1, 2, 3, 4]);
    for (const f of filas) expect(f).not.toHaveProperty('comision');
  });

  it('AC-COMR-1 con fallback legacy (PGRST204) tampoco viaja comision', async () => {
    mockLocal.clientes = [{ ...BASE, id: 1, nombre: 'Con extras', codigo: 'A1', comision: 4, extrasDirty: true }];
    mockSb.respuestas = [{ error: ERR_COL }, { error: null }];
    await syncClientes();
    expect(mockSb.upserts).toHaveLength(2);
    for (const u of mockSb.upserts) for (const f of u.rows) expect(f).not.toHaveProperty('comision');
  });

  it('AC-COMR-1 después del pull la comision local sigue igual aunque Supabase traiga otra (o null)', async () => {
    mockLocal.clientes = [
      { id: 1, nombre: 'A', direccion: 'X', comision: 4, pendingSync: false },
      { id: 2, nombre: 'B', direccion: 'Y', comision: 2.5, pendingSync: false },
    ];
    mockSb.remoto.clientes = [
      { id: 1, nombre: 'A', direccion: 'X', comision: 9 },
      { id: 2, nombre: 'B', direccion: 'Y', comision: null },
    ];
    await downloadMaestros();
    expect(mockLocal.clientes.find(c => c.id === 1).comision).toBe(4);
    expect(mockLocal.clientes.find(c => c.id === 2).comision).toBe(2.5);
  });
});

// REQ-VTA (AC-VTA-5): columnas de la migracion 006 escalonadas sobre las de la 001.
describe('AC-VTA-5 syncProductos / downloadMaestros con las columnas de la 006', () => {
  const DOS_CORAZONES = {
    id: 21, nombre: 'Dos Corazones', codigo: 'DC1', precio: 900, unidad: 'unidad', categoria: 'Golosinas', marca: 'Dos Corazones',
    costoFinal: 700, bultoX: 16, minimoVenta: 1, ventaPor: 'bulto', bultoNombre: 'Display', visibleTienda: false,
    pendingSync: true, extrasDirty: true,
  };
  const ERR_006 = { code: 'PGRST204', message: "Could not find the 'venta_por' column of 'productos' in the schema cache" };
  const ERR_001 = { code: 'PGRST204', message: "Could not find the 'costo_final' column of 'productos' in the schema cache" };

  it('AC-VTA-5 con las migraciones 001 y 006 sube todo en un solo upsert y no deja extras pendientes', async () => {
    mockLocal.productos = [DOS_CORAZONES];
    await syncProductos();
    expect(mockSb.upserts).toHaveLength(1);
    expect(mockSb.upserts[0].rows[0]).toMatchObject({
      id: 21, marca: 'Dos Corazones', bulto_x: 16, costo_final: 700, venta_por: 'bulto', bulto_nombre: 'Display', visible_tienda: false,
    });
    expect(mockLocal.productos[0]).toMatchObject({ pendingSync: false, extrasPendientes: false, extrasDirty: false });
  });

  it('AC-VTA-5 sin la 006 baja al escalon 001: bulto_x y costo_final suben igual, sin las 3 columnas nuevas', async () => {
    mockLocal.productos = [DOS_CORAZONES];
    mockSb.respuestas = [{ error: ERR_006 }, { error: null }];
    await syncProductos();
    expect(mockSb.upserts).toHaveLength(2);
    const r2 = mockSb.upserts[1].rows[0];
    expect(r2).toMatchObject({ id: 21, bulto_x: 16, costo_final: 700, marca: 'Dos Corazones' });
    for (const col of ['venta_por', 'bulto_nombre', 'visible_tienda']) expect(r2).not.toHaveProperty(col);
    expect(db.clearProductosPendingSync).toHaveBeenCalledWith([21]);
    expect(mockLocal.productos[0]).toMatchObject({ pendingSync: false, extrasPendientes: true });
  });

  it('AC-VTA-5 sin la 006 ni la 001 llega al basico (id, nombre, precio, marca) y no corta el sync', async () => {
    mockLocal.productos = [DOS_CORAZONES];
    mockSb.respuestas = [{ error: ERR_006 }, { error: ERR_001 }, { error: null }];
    await syncProductos();
    expect(mockSb.upserts).toHaveLength(3);
    const r3 = mockSb.upserts[2].rows[0];
    expect(r3).toMatchObject({ id: 21, precio: 900, marca: 'Dos Corazones' });
    for (const col of ['venta_por', 'bulto_nombre', 'visible_tienda', 'costo_final', 'bulto_x']) expect(r3).not.toHaveProperty(col);
    expect(mockLocal.productos[0]).toMatchObject({ pendingSync: false, extrasPendientes: true });
  });

  it('AC-VTA-5 un error que no es de columna faltante se propaga y no limpia pendingSync', async () => {
    mockLocal.productos = [DOS_CORAZONES];
    mockSb.respuestas = [{ error: { code: '23514', message: 'new row violates check constraint "productos_venta_bulto_chk"' } }];
    await expect(syncProductos()).rejects.toMatchObject({ code: '23514' });
    expect(mockSb.upserts).toHaveLength(1);
    expect(db.clearProductosPendingSync).not.toHaveBeenCalled();
    expect(mockLocal.productos[0].pendingSync).toBe(true);
  });

  it('AC-VTA-5 un producto sin extrasDirty (CSV) sigue subiendo solo lo basico, sin columnas de la 006', async () => {
    mockLocal.productos = [{ ...DOS_CORAZONES, extrasDirty: false }];
    await syncProductos();
    expect(mockSb.upserts).toHaveLength(1);
    for (const col of ['venta_por', 'bulto_nombre', 'visible_tienda']) expect(mockSb.upserts[0].rows[0]).not.toHaveProperty(col);
  });

  it('AC-VTA-5 downloadMaestros desde un Supabase sin la 006: conserva los valores locales y los defaults', async () => {
    mockLocal.productos = [{ ...DOS_CORAZONES, pendingSync: false, extrasDirty: false }, { id: 22, nombre: 'Viejo', codigo: 'V', precio: 5 }];
    mockSb.remoto.productos = [
      { id: 21, nombre: 'Dos Corazones', codigo: 'DC1', precio: 900, unidad: 'unidad', categoria: 'Golosinas', marca: 'Dos Corazones', bulto_x: 16 },
      { id: 22, nombre: 'Viejo', codigo: 'V', precio: 5 },
    ];
    await downloadMaestros();
    expect(mockLocal.productos.find(p => p.id === 21)).toMatchObject({ ventaPor: 'bulto', bultoNombre: 'Display', visibleTienda: false });
    expect(mockLocal.productos.find(p => p.id === 22)).toMatchObject({ bultoNombre: 'Bulto', visibleTienda: true });
  });

  it('AC-VTA-5 downloadMaestros con la 006: baja venta_por, bulto_nombre y visible_tienda de otro dispositivo', async () => {
    mockLocal.productos = [{ id: 21, nombre: 'Dos Corazones', codigo: 'DC1', precio: 900 }];
    mockSb.remoto.productos = [{ id: 21, nombre: 'Dos Corazones', codigo: 'DC1', precio: 900, bulto_x: 16, venta_por: 'bulto', bulto_nombre: 'Display', visible_tienda: false, marca: 'Dos Corazones' }];
    await downloadMaestros();
    expect(mockLocal.productos[0]).toMatchObject({ ventaPor: 'bulto', bultoNombre: 'Display', visibleTienda: false, marca: 'Dos Corazones', bultoX: 16 });
  });

  it('AC-VTA-5 un producto pendiente igual al remoto (con defaults en ambos lados) se limpia y no queda "diferente" para siempre', async () => {
    mockLocal.productos = [{ id: 23, nombre: 'Viejo', codigo: 'V', precio: 5, unidad: 'unidad', categoria: '', marca: '', pendingSync: true,
      proveedorId: null, costoFinal: 0, descuento1: 0, descuento2: 0, ganancia: 0, precioVenta2: 0, bultoX: 1, minimoVenta: 1 }];
    mockSb.remoto.productos = [{ id: 23, nombre: 'Viejo', codigo: 'V', precio: 5, unidad: 'unidad', categoria: '', marca: '', bulto_nombre: null, visible_tienda: true, venta_por: null }];
    await downloadMaestros();
    expect(mockLocal.productos[0].pendingSync).toBe(false);
  });
});
