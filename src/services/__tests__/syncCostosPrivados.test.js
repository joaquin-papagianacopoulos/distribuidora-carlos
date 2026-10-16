// S-012-01 (migracion 013): el pull de productos usa columnas publicas y no pisa costos locales;
// los costos bajan solo con PIN de admin (admin_productos_costos).
const mockLocal = { clientes: [], productos: [] };
jest.mock('../../db', () => {
  const impl = {
    getClientes: async () => mockLocal.clientes.map(c => ({ ...c })),
    getProductos: async () => mockLocal.productos.map(p => ({ ...p })),
    getVendedores: async () => [],
    putClientesBatch: async () => undefined,
    putProductosBatch: async (rows) => {
      for (const r of rows) {
        const i = mockLocal.productos.findIndex(c => c.id === r.id);
        if (i >= 0) mockLocal.productos[i] = { ...r }; else mockLocal.productos.push({ ...r });
      }
    },
    putVendedoresBatch: async () => undefined,
    patchRegistros: async () => undefined,
  };
  const mod = { __impl: impl };
  for (const k of Object.keys(impl)) mod[k] = jest.fn(impl[k]);
  return mod;
});
jest.mock('../../services/imageSearch', () => ({
  isImageSearchConfigured: () => false, fetchProductImage: jest.fn(), ImageSearchQuotaError: class extends Error {},
}));

// Supabase falso: registra las columnas pedidas y simula columnas inexistentes / costos privados.
const mockSb = { selects: [], remoto: {}, faltan: [], sinGrant: [], rpcs: [], rpcResp: [] };
jest.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: (fn, args) => {
      mockSb.rpcs.push({ fn, args });
      return Promise.resolve(mockSb.rpcResp.shift() || { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
    },
    from: (table) => {
      let cols = '*';
      const api = {
        select: (c) => { cols = c; mockSb.selects.push({ table, cols: c }); return api; },
        range: () => api, order: () => api, eq: () => api, gt: () => api, in: () => api,
        then: (res, rej) => {
          let out;
          if (table === 'productos') {
            const lista = String(cols).split(',');
            const falta = mockSb.faltan.find(f => lista.includes(f));
            // 016: columna agregada despues de la 013, sin grant => 42501 sin decir cual.
            const sinGrant = mockSb.sinGrant.some(f => lista.includes(f));
            if (cols === '*' || sinGrant || /costo_final|descuento1|ganancia|precio_venta2/.test(cols)) {
              out = { data: null, error: { code: '42501', message: 'permission denied for table productos' } };
            } else if (falta) {
              out = { data: null, error: { code: '42703', message: `column productos.${falta} does not exist` } };
            } else {
              out = { data: (mockSb.remoto.productos || []).map(r => Object.fromEntries(lista.filter(k => k in r).map(k => [k, r[k]]))), error: null };
            }
          } else {
            out = { data: mockSb.remoto[table] || [], error: null };
          }
          return Promise.resolve(out).then(res, rej);
        },
      };
      return api;
    },
  },
}));

import * as db from '../../db';
import { downloadMaestros } from '../../sync/syncService';
import { bajarCostosProductos } from '../costosProductosService';
import { COLUMNAS_PRODUCTO_PUBLICAS } from '../../domain/productos';

const REMOTO = { id: 3, nombre: 'Alfajor', precio: 900, bulto_x: 12, costo_final: 1, descuento1: 99, ganancia: 1, precio_venta2: 1 };
let warnSpy;
let logSpy;
beforeEach(() => {
  for (const k of Object.keys(db.__impl)) db[k].mockImplementation(db.__impl[k]);
  Object.assign(mockSb, { selects: [], remoto: {}, faltan: [], sinGrant: [], rpcs: [], rpcResp: [] });
  mockLocal.clientes = [];
  mockLocal.productos = [];
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { warnSpy.mockRestore(); logSpy.mockRestore(); });

describe('S-012-01 pull de productos sin PIN', () => {
  it('S-012-01 pide una lista explicita de columnas publicas (nunca "*" ni costos)', async () => {
    mockSb.remoto.productos = [REMOTO];
    await downloadMaestros();
    const sel = mockSb.selects.filter(s => s.table === 'productos');
    expect(sel.length).toBeGreaterThan(0);
    sel.forEach(s => {
      expect(s.cols).not.toBe('*');
      expect(s.cols).not.toMatch(/costo_final|descuento1|descuento2|ganancia|precio_venta2/);
    });
    expect(sel[0].cols).toBe(COLUMNAS_PRODUCTO_PUBLICAS.join(','));
  });

  it('S-012-01 sin PIN conserva los costos locales y NUNCA los pisa con vacio', async () => {
    const costos = { costoFinal: 80, descuento1: 5, descuento2: 2, ganancia: 40, precioVenta2: 130 };
    mockLocal.productos = [{ id: 3, nombre: 'Viejo', precio: 800, ...costos, pendingSync: false }];
    mockSb.remoto.productos = [REMOTO];
    await downloadMaestros();
    expect(mockLocal.productos[0]).toMatchObject({ nombre: 'Alfajor', precio: 900, bultoX: 12, ...costos });
  });

  it('S-012-01 producto nuevo sin costos conocidos: quedan desconocidos (undefined), no 0', async () => {
    mockSb.remoto.productos = [REMOTO];
    await downloadMaestros();
    expect(mockLocal.productos[0].costoFinal).toBeUndefined();
    expect(mockLocal.productos[0].ganancia).toBeUndefined();
  });

  it('S-012-01 sin una migracion vieja (columna inexistente) reintenta sin esa columna', async () => {
    mockSb.faltan = ['stock_minimo'];
    mockSb.remoto.productos = [{ id: 3, nombre: 'Alfajor', precio: 900 }];
    await downloadMaestros();
    const sel = mockSb.selects.filter(s => s.table === 'productos');
    expect(sel).toHaveLength(2);
    expect(sel[1].cols).not.toMatch(/stock_minimo/);
    expect(mockLocal.productos[0]).toMatchObject({ id: 3, nombre: 'Alfajor' });
  });
});

describe('016 columnas sin grant (migracion corrida despues de la 013)', () => {
  it('S-012-01 016 permiso denegado: reintenta sin las columnas nuevas y el sync no se corta', async () => {
    mockSb.sinGrant = ['venta_por'];
    mockLocal.productos = [{ id: 3, nombre: 'Viejo', precio: 800, ventaPor: 'bulto', visibleTienda: false, pendingSync: false }];
    mockSb.remoto.productos = [{ id: 3, nombre: 'Alfajor', precio: 900, venta_por: 'unidad', visible_tienda: true }];
    await downloadMaestros();
    const sel = mockSb.selects.filter(s => s.table === 'productos');
    const ultima = sel[sel.length - 1].cols;
    expect(ultima).not.toMatch(/venta_por/);
    expect(ultima).toMatch(/^id,nombre,codigo,precio,unidad,categoria,imagen_url/);
    // Bajo lo que se pudo leer; lo que no se pudo leer se conserva del dispositivo.
    expect(mockLocal.productos[0]).toMatchObject({ nombre: 'Alfajor', precio: 900, ventaPor: 'bulto' });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/016_productos_grants_columnas/));
  });

  it('S-012-01 016 sin permiso ni en las columnas base, el error sale (no se inventan datos)', async () => {
    mockSb.sinGrant = ['id'];
    await expect(downloadMaestros()).rejects.toMatchObject({ code: '42501' });
  });
});

describe('S-012-01 costos con PIN de admin', () => {
  const CRED = { p_admin_id: 'r1', p_admin_pin: '1234' };

  it('S-012-01 sin PIN no llama al servidor', async () => {
    expect(await bajarCostosProductos(null)).toMatchObject({ ok: false, motivo: 'pin_requerido' });
    expect(mockSb.rpcs).toHaveLength(0);
  });

  it('S-012-01 con PIN baja paginado por id y aplica solo a productos sin cambios pendientes', async () => {
    mockLocal.productos = [
      { id: 1, nombre: 'a', pendingSync: false },
      { id: 2, nombre: 'b', costoFinal: 10, pendingSync: true },
    ];
    const pagina = Array.from({ length: 1000 }, (_, i) => ({ id: i + 1, costo_final: 50, descuento1: 0, descuento2: 0, ganancia: 20, precio_venta2: 0 }));
    mockSb.rpcResp = [{ data: { ok: true, productos: pagina }, error: null }, { data: { ok: true, productos: [] }, error: null }];
    const r = await bajarCostosProductos(CRED);
    expect(r).toMatchObject({ ok: true, actualizados: 1 });
    expect(mockSb.rpcs.map(x => x.fn)).toEqual(['admin_productos_costos', 'admin_productos_costos']);
    expect(mockSb.rpcs[0].args).toMatchObject({ p_admin_pin: '1234', p_desde_id: 0, p_limite: 1000 });
    expect(mockSb.rpcs[1].args.p_desde_id).toBe(1000);
    expect(mockLocal.productos.find(p => p.id === 1)).toMatchObject({ costoFinal: 50, ganancia: 20 });
    expect(mockLocal.productos.find(p => p.id === 2).costoFinal).toBe(10);
  });

  it('S-012-01 sin la 013 o PIN incorrecto no toca los costos locales', async () => {
    mockLocal.productos = [{ id: 1, nombre: 'a', costoFinal: 70 }];
    expect(await bajarCostosProductos(CRED)).toMatchObject({ ok: false, motivo: 'falta_migracion' });
    mockSb.rpcResp = [{ data: { ok: false, motivo: 'no_autorizado' }, error: null }];
    expect(await bajarCostosProductos(CRED)).toMatchObject({ ok: false, motivo: 'no_autorizado' });
    expect(mockLocal.productos[0].costoFinal).toBe(70);
  });
});
