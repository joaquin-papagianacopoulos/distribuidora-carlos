// src/db/index.js - Base de datos local con IndexedDB
import { getLocalTodayStr, normalizePedidoFecha } from '../utils/pedidos';
import { sinPinLocal, tieneCamposSecretos } from '../domain/vendedores';

const DB_NAME = 'distribuidoraDB';
// v6 — S-COM-13: se quita el PIN en texto plano de los vendedores locales.
const DB_VERSION = 6;

let db = null;

export const initDB = () => new Promise((resolve, reject) => {
  if (db) return resolve(db);
  const request = indexedDB.open(DB_NAME, DB_VERSION);

  request.onupgradeneeded = (e) => {
    const d = e.target.result;

    // Productos
    if (!d.objectStoreNames.contains('productos')) {
      const ps = d.createObjectStore('productos', { keyPath: 'id', autoIncrement: true });
      ps.createIndex('nombre', 'nombre', { unique: false });
      ps.createIndex('codigo', 'codigo', { unique: false });
    }

    // Clientes
    if (!d.objectStoreNames.contains('clientes')) {
      const cs = d.createObjectStore('clientes', { keyPath: 'id', autoIncrement: true });
      cs.createIndex('nombre', 'nombre', { unique: false });
    }

    // Pedidos
    if (!d.objectStoreNames.contains('pedidos')) {
      const pes = d.createObjectStore('pedidos', { keyPath: 'id', autoIncrement: true });
      pes.createIndex('fecha', 'fecha', { unique: false });
      pes.createIndex('vendedor', 'vendedor', { unique: false });
      pes.createIndex('clienteId', 'clienteId', { unique: false });
      pes.createIndex('synced', 'synced', { unique: false });
    }

    // Vendedores
    if (!d.objectStoreNames.contains('vendedores')) {
      d.createObjectStore('vendedores', { keyPath: 'id', autoIncrement: true });
    }

    // Faltantes — v2
    if (!d.objectStoreNames.contains('faltantes')) {
      const fs = d.createObjectStore('faltantes', { keyPath: 'id', autoIncrement: true });
      fs.createIndex('fecha', 'fecha', { unique: false });
      fs.createIndex('productoId', 'productoId', { unique: false });
      fs.createIndex('mes', 'mes', { unique: false });
    }

    // Deudas — v3 (deudas de clientes: manuales o de "boleta contra boleta")
    if (!d.objectStoreNames.contains('deudas')) {
      const ds = d.createObjectStore('deudas', { keyPath: 'id', autoIncrement: true });
      ds.createIndex('clienteId', 'clienteId', { unique: false });
      ds.createIndex('pagada', 'pagada', { unique: false });
      ds.createIndex('pedidoId', 'pedidoId', { unique: false });
    }

    // v4 — REQ-PROV / REQ-STK / REQ-ING. Claves UUID (no autoIncrement) para
    // que dos dispositivos nunca generen el mismo id.
    if (!d.objectStoreNames.contains('proveedores')) {
      const prs = d.createObjectStore('proveedores', { keyPath: 'id' });
      prs.createIndex('codigo', 'codigo', { unique: false });
    }
    if (!d.objectStoreNames.contains('movimientosStock')) {
      const ms = d.createObjectStore('movimientosStock', { keyPath: 'id' });
      ms.createIndex('productoId', 'productoId', { unique: false });
      ms.createIndex('ref', 'ref', { unique: false });
    }
    if (!d.objectStoreNames.contains('ingresos')) {
      const is = d.createObjectStore('ingresos', { keyPath: 'id' });
      is.createIndex('proveedorId', 'proveedorId', { unique: false });
    }

    // v5 — REQ-COM (cierre de comisiones). Solo se AGREGAN stores: nada se
    // borra ni se recrea. Claves UUID (cierres) / clave del periodo (borradores).
    if (!d.objectStoreNames.contains('comisionesCierres')) {
      const cc = d.createObjectStore('comisionesCierres', { keyPath: 'id' });
      cc.createIndex('estado', 'estado', { unique: false });
      cc.createIndex('desde', 'desde', { unique: false });
    }
    if (!d.objectStoreNames.contains('comisionesBorradores')) {
      d.createObjectStore('comisionesBorradores', { keyPath: 'id' });
    }

    // v6 — S-COM-13 (login 100 % online). El PIN se verifica solo en el
    // servidor (rpc verificar_pin): se BORRA la propiedad "pin" de cada vendedor
    // local y queda "tienePin" (para el candado). No se borra ni se recrea
    // ningun registro ni store. El PIN no es dato de negocio: es una credencial
    // que ya vive hasheada en Supabase (002 PASO 1), asi que quitarla del
    // dispositivo no pierde informacion del usuario (regla dura 6).
    const upgradeTx = e.target.transaction;
    if (upgradeTx && (e.oldVersion ?? 0) < 6 && d.objectStoreNames.contains('vendedores')) {
      const req = upgradeTx.objectStore('vendedores').openCursor();
      req.onsuccess = (ev) => {
        const cursor = ev.target.result;
        if (!cursor) return;
        if (tieneCamposSecretos(cursor.value)) cursor.update(sinPinLocal(cursor.value));
        cursor.continue();
      };
    }
  };

  // Si otra pestana/ventana tiene abierta la version vieja, el upgrade queda
  // bloqueado: avisar en vez de quedar "cargando" para siempre (no bloqueante 10).
  request.onblocked = () => {
    // eslint-disable-next-line no-alert
    if (typeof window !== 'undefined' && window.alert) window.alert('Hay otra ventana de la app abierta con una version anterior. Cerrala para continuar.');
  };
  request.onsuccess = (e) => {
    db = e.target.result;
    // Y al reves: si una version nueva quiere actualizar, cerrar esta conexion.
    db.onversionchange = () => { try { db.close(); } catch { /* noop */ } db = null; };
    resolve(db);
  };
  request.onerror = () => reject(request.error);
});

const getDB = async () => { if (!db) await initDB(); return db; };

const tx = (store, mode = 'readonly') =>
  getDB().then(d => d.transaction(store, mode).objectStore(store));

const clearStore = async (storeName) => {
  const store = await tx(storeName, 'readwrite');
  return new Promise((res, rej) => {
    const req = store.clear();
    req.onsuccess = () => res();
    req.onerror = () => rej(req.error);
  });
};

// ---- PRODUCTOS ----
export const getProductos = async () => {
  const store = await tx('productos');
  return new Promise((res, rej) => {
    const req = store.getAll();
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
};

export const addProducto = async (p) => {
  const store = await tx('productos', 'readwrite');
  return new Promise((res, rej) => {
    const req = store.add({ ...p, createdAt: Date.now() });
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
};
// Alta local (UI/CSV): marcar como pendiente para subir a Supabase
export const addProductoLocal = async (p) => {
  const store = await tx('productos', 'readwrite');
  return new Promise((res, rej) => {
    const req = store.add({ ...p, createdAt: Date.now(), pendingSync: true });
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
};

// Escritura "neutral" (p.ej. datos remotos): no tocar pendingSync
export const putProducto = async (p) => {
  const store = await tx('productos', 'readwrite');
  return new Promise((res, rej) => {
    const req = store.put(p);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
};

export const putProductosBatch = async (rows) => {
  if (!rows || rows.length === 0) return { ok: true, count: 0 };
  const d = await getDB();
  return new Promise((res, rej) => {
    const t = d.transaction('productos', 'readwrite');
    const store = t.objectStore('productos');
    for (const row of rows) store.put(row);
    t.oncomplete = () => res({ ok: true, count: rows.length });
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
};

export const putClientesBatch = async (rows) => {
  if (!rows || rows.length === 0) return { ok: true, count: 0 };
  const d = await getDB();
  return new Promise((res, rej) => {
    const t = d.transaction('clientes', 'readwrite');
    const store = t.objectStore('clientes');
    for (const row of rows) store.put(row);
    t.oncomplete = () => res({ ok: true, count: rows.length });
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
};

export const putVendedoresBatch = async (rows) => {
  if (!rows || rows.length === 0) return { ok: true, count: 0 };
  const d = await getDB();
  return new Promise((res, rej) => {
    const t = d.transaction('vendedores', 'readwrite');
    const store = t.objectStore('vendedores');
    // S-COM-13: nunca se guarda un PIN en el dispositivo.
    for (const row of rows) store.put(sinPinLocal(row));
    t.oncomplete = () => res({ ok: true, count: rows.length });
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
};
export const updateProducto = async (p) => {
  const store = await tx('productos', 'readwrite');
  return new Promise((res, rej) => {
    const req = store.put({ ...p, pendingSync: true }); // ← marcar pendiente
    req.onsuccess = () => res(req.result);
    req.onerror  = () => rej(req.error);
  });
};

export const deleteProducto = async (id) => {
  const store = await tx('productos', 'readwrite');
  return new Promise((res, rej) => {
    const req = store.delete(id);
    req.onsuccess = () => res();
    req.onerror = () => rej(req.error);
  });
};

// ---- CLIENTES ----
export const getClientes = async () => {
  const store = await tx('clientes');
  return new Promise((res, rej) => {
    const req = store.getAll();
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
};

export const addCliente = async (c) => {
  const store = await tx('clientes', 'readwrite');
  return new Promise((res, rej) => {
    const req = store.add({ ...c, pendingSync: true, createdAt: Date.now() });
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
};

// Limpia pendingSync SOLO de los ids que se pasan (los que de verdad se
// acaban de subir en esta tanda) — nunca "todo lo que este pendiente ahora",
// porque si dos guardados se superponen (ej: asignando varios clientes
// seguido), el segundo edito un cliente MIENTRAS el primero todavia estaba
// subiendo; limpiar "todo lo pendiente" al terminar el primero borraba
// tambien la marca del segundo sin haber subido su dato real, y la proxima
// bajada lo pisaba con el valor viejo de Supabase.
export const clearClientesPendingSync = async (ids) => {
  if (!ids || ids.length === 0) return;
  const store = await tx('clientes', 'readwrite');
  for (const id of ids) {
    const c = await new Promise((res, rej) => {
      const req = store.get(id);
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    if (!c || !c.pendingSync) continue;
    await new Promise((res, rej) => {
      const req = store.put({ ...c, pendingSync: false });
      req.onsuccess = () => res();
      req.onerror = () => rej(req.error);
    });
  }
};
// Igual que clearClientesPendingSync: limpia SOLO los ids que se pasan (los
// que de verdad se acaban de subir en esta tanda), nunca "todo lo pendiente
// ahora" — si no, una edicion de OTRO producto hecha mientras esta subida
// estaba en curso quedaba marcada "ya subida" sin haberlo estado, y la
// proxima bajada la pisaba con el valor viejo de Supabase.
export const clearProductosPendingSync = async (ids) => {
  if (!ids || ids.length === 0) return;
  const store = await tx('productos', 'readwrite');
  for (const id of ids) {
    const p = await new Promise((res, rej) => {
      const req = store.get(id);
      req.onsuccess = () => res(req.result);
      req.onerror  = () => rej(req.error);
    });
    if (!p || !p.pendingSync) continue;
    await new Promise((res, rej) => {
      const req = store.put({ ...p, pendingSync: false });
      req.onsuccess = () => res();
      req.onerror  = () => rej(req.error);
    });
  }
};
// Toda edicion local de un cliente (Config, Orden de entrega) queda marcada
// pendingSync:true, para que syncClientes suba SOLO lo que este dispositivo
// realmente edito — no toda la tabla de clientes en cada sync. Subir todo
// siempre hacia que un dispositivo con datos viejos pisara con null (por
// ejemplo) lo que otro acababa de guardar, apenas sincronizaba.
export const updateCliente = async (c) => {
  const store = await tx('clientes', 'readwrite');
  return new Promise((res, rej) => {
    const req = store.put({ ...c, pendingSync: true });
    req.onsuccess = () => res();
    req.onerror = () => rej(req.error);
  });
};

export const deleteCliente = async (id) => {
  const store = await tx('clientes', 'readwrite');
  return new Promise((res, rej) => {
    const req = store.delete(id);
    req.onsuccess = () => res();
    req.onerror = () => rej(req.error);
  });
};

// ---- VENDEDORES ----
export const getVendedores = async () => {
  const store = await tx('vendedores');
  return new Promise((res, rej) => {
    const req = store.getAll();
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
};

export const addVendedor = async (v) => {
  const store = await tx('vendedores', 'readwrite');
  return new Promise((res, rej) => {
    const req = store.add(sinPinLocal({ ...v, createdAt: Date.now() }));
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
};

export const deleteVendedor = async (id) => {
  const store = await tx('vendedores', 'readwrite');
  return new Promise((res, rej) => {
    const req = store.delete(id);
    req.onsuccess = () => res();
    req.onerror = () => rej(req.error);
  });
};

// ---- PEDIDOS ----
export const getPedidos = async () => {
  const store = await tx('pedidos');
  return new Promise((res, rej) => {
    const req = store.getAll();
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
};

export const getPedidosByFecha = async (fecha) => {
  const todos = await getPedidos();
  return todos.filter(p => p.fecha === fecha);
};

export const addPedido = async (p) => {
  const store = await tx('pedidos', 'readwrite');
  return new Promise((res, rej) => {
    const req = store.add({ ...p, synced: false, createdAt: Date.now(), updatedAt: Date.now() });
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
};

export const addPedidoSynced = async (p) => {
  const store = await tx('pedidos', 'readwrite');
  const now = Date.now();
  return new Promise((res, rej) => {
    const req = store.add({
      ...p,
      synced: true,
      syncLock: false,
      createdAt: p.createdAt ?? now,
      updatedAt: p.updatedAt ?? now,
    });
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
};

export const updatePedido = async (p) => {
  const store = await tx('pedidos', 'readwrite');
  return new Promise((res, rej) => {
    const req = store.put({ ...p, synced: false, updatedAt: Date.now() });
    req.onsuccess = () => res();
    req.onerror  = () => rej(req.error);
  });
};

export const deletePedido = async (id) => {
  const store = await tx('pedidos', 'readwrite');
  return new Promise((res, rej) => {
    const req = store.delete(id);
    req.onsuccess = () => res();
    req.onerror = () => rej(req.error);
  });
};

export const markPedidoSynced = async (id, remoteId) => {
  const todos = await getPedidos();
  const p = todos.find(x => x.id === id);
  if (p) await putPedido({ ...p, synced: true, remoteId: remoteId ?? p.remoteId });
  // Si el pedido se facturo offline, sus movimientos de stock quedaron con
  // ref local; ahora que tiene id remoto se re-keyean para que cualquier
  // dispositivo pueda revertirlos (AC-STK-8).
  if (remoteId) await rekeyMovimientosRef(`pedido-local:${id}`, `pedido:${remoteId}`);
};

// Agrega esto después de markPedidoSynced
export const putPedidoRemoto = async (p) => {
  const store = await tx('pedidos', 'readwrite');
  return new Promise((res, rej) => {
    const req = store.put(p); // no toca synced, guarda tal cual
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
};

export const putPedidosRemotoBatch = async (rows) => {
  if (!rows || rows.length === 0) return { ok: true, count: 0 };
  const d = await getDB();
  return new Promise((res, rej) => {
    const t = d.transaction('pedidos', 'readwrite');
    const store = t.objectStore('pedidos');
    for (const row of rows) store.put(row);
    t.oncomplete = () => res({ ok: true, count: rows.length });
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
};

// putPedido — para escrituras internas que NO deben marcar synced: false
export const putPedido = async (p) => {
  const store = await tx('pedidos', 'readwrite');
  return new Promise((res, rej) => {
    const req = store.put(p); // guarda exactamente lo que recibe
    req.onsuccess = () => res();
    req.onerror  = () => rej(req.error);
  });
};
export const updateVendedor = async (v) => {
  const store = await tx('vendedores', 'readwrite');
  return new Promise((res, rej) => {
    const req = store.put(sinPinLocal(v));
    req.onsuccess = () => res();
    req.onerror = () => rej(req.error);
  });
};

export const markVendedorSynced = async (id, remoteId) => {
  const todos = await getVendedores();
  const v = todos.find(x => x.id === id);
  if (v) await updateVendedor({ ...v, remoteId });
};
// ---- SEED DATA ----
export const seedDemoData = async () => {
  const productos = await getProductos();
  if (productos.length > 0) return;

  // Datos reales de DISTRISULPI importados del backup
  const { SEED_PRODUCTOS, SEED_CLIENTES } = await import('./seedData.js');

  // Insertar en batches para no bloquear el hilo
  const BATCH = 100;
  for (let i = 0; i < SEED_PRODUCTOS.length; i += BATCH) {
    const batch = SEED_PRODUCTOS.slice(i, i + BATCH);
    await Promise.all(batch.map(p => addProducto({
      nombre: p.nombre,
      codigo: p.codigo || '',
      precio: p.precio || 0,
      unidad: p.unidad || 'unidad',
      categoria: p.categoria || '',
    })));
  }
  for (let i = 0; i < SEED_CLIENTES.length; i += BATCH) {
    const batch = SEED_CLIENTES.slice(i, i + BATCH);
    await Promise.all(batch.map(c => addCliente({
      nombre: c.nombre,
      direccion: c.direccion || '',
      telefono: c.telefono || '',
      alias: c.alias || '',
    })));
  }
};

// ---- FALTANTES ----
export const getFaltantes = async () => {
  const store = await tx('faltantes');
  return new Promise((res, rej) => {
    const req = store.getAll();
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
};
// db/index.js — agregar después de deleteFaltante
export const updateFaltante = async (f) => {
  const store = await tx('faltantes', 'readwrite');
  return new Promise((res, rej) => {
    const req = store.put(f);
    req.onsuccess = () => res();
    req.onerror  = () => rej(req.error);
  });
};
export const addFaltante = async (f) => {
  const store = await tx('faltantes', 'readwrite');
  return new Promise((res, rej) => {
    const req = store.add({ ...f, registradoAt: Date.now() });
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
};

export const deleteFaltante = async (id) => {
  const store = await tx('faltantes', 'readwrite');
  return new Promise((res, rej) => {
    const req = store.delete(id);
    req.onsuccess = () => res();
    req.onerror = () => rej(req.error);
  });
};

// ---- DEUDAS ----
export const getDeudas = async () => {
  const store = await tx('deudas');
  return new Promise((res, rej) => {
    const req = store.getAll();
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
};

export const addDeuda = async (d) => {
  const store = await tx('deudas', 'readwrite');
  return new Promise((res, rej) => {
    const req = store.add({ synced: false, ...d, createdAt: Date.now() });
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
};

export const updateDeuda = async (d) => {
  const store = await tx('deudas', 'readwrite');
  return new Promise((res, rej) => {
    const req = store.put(d);
    req.onsuccess = () => res();
    req.onerror = () => rej(req.error);
  });
};

export const deleteDeuda = async (id) => {
  const store = await tx('deudas', 'readwrite');
  return new Promise((res, rej) => {
    const req = store.delete(id);
    req.onsuccess = () => res();
    req.onerror = () => rej(req.error);
  });
};

// ---- BACKUP IMPORT ----
// Espera un JSON con arrays: productos, clientes, pedidos, vendedores, faltantes.
// Reemplaza la base local para poder "ver ventas" de un backup.
export const importBackup = async (backup) => {
  if (!backup || typeof backup !== 'object') throw new Error('Backup inválido');

  const productos = Array.isArray(backup.productos) ? backup.productos : [];
  const clientes = Array.isArray(backup.clientes) ? backup.clientes : [];
  const pedidos = Array.isArray(backup.pedidos) ? backup.pedidos : [];
  // S-COM-13: un backup viejo puede traer PIN en texto plano; no se importa.
  const vendedores = (Array.isArray(backup.vendedores) ? backup.vendedores : []).map(sinPinLocal);
  const faltantes = Array.isArray(backup.faltantes) ? backup.faltantes : [];

  // Limpiar stores primero
  await Promise.all([
    clearStore('productos'),
    clearStore('clientes'),
    clearStore('pedidos'),
    clearStore('vendedores'),
    clearStore('faltantes'),
  ]);

  const dbi = await getDB();
  const doPutAll = (storeName, rows) => new Promise((res, rej) => {
    const t = dbi.transaction(storeName, 'readwrite');
    const store = t.objectStore(storeName);
    for (const row of rows) store.put(row);
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });

  await doPutAll('productos', productos);
  await doPutAll('clientes', clientes);
  await doPutAll('vendedores', vendedores);
  await doPutAll('pedidos', pedidos);
  await doPutAll('faltantes', faltantes);

  return { ok: true };
};

// db/index.js
export const registrarFaltantes = async (pedidoOriginal, itemsNuevos) => {
  // El faltante se archiva bajo la fecha DEL PEDIDO, no el dia en que se
  // edito/armo. Si no, al procesar hoy un pedido pendiente de otro dia, el
  // faltante quedaba fechado "hoy" y aparecia mezclado con clientes/pedidos
  // de otros dias al filtrar "Faltantes" por el dia de hoy.
  const fecha = normalizePedidoFecha(pedidoOriginal.fecha) || getLocalTodayStr();
  const [anio, mesNum] = fecha.split('-');
  const mes = (anio && mesNum) ? `${anio}-${mesNum}` : getLocalTodayStr().slice(0, 7);
  const itemsOriginales = pedidoOriginal.items || [];

  for (const orig of itemsOriginales) {
    const nuevo = itemsNuevos.find(i => i.productoId === orig.productoId);
    const cantNueva = nuevo ? Number(nuevo.cantidad) : 0;
    const diff = Number(orig.cantidad) - cantNueva;
    if (diff > 0) {
      await addFaltante({
        fecha, mes,
        pedidoId:          pedidoOriginal.remoteId ?? null, // ← remoteId, no id local
        clienteNombre:     pedidoOriginal.clienteNombre,
        productoId:        orig.productoId,
        productoNombre:    orig.nombre,
        cantidadFaltante:  diff,
        precioUnitario:    Number(orig.precio),
        dineroNoPercibido: diff * Number(orig.precio),
      });
    }
  }
};

// Aplica un patch a los registros de los ids dados (sin tocar pendingSync).
export const patchRegistros = async (storeName, ids, patch) => {
  if (!ids || ids.length === 0) return;
  const d = await getDB();
  const set = new Set(ids);
  const all = await new Promise((res, rej) => {
    const req = d.transaction(storeName).objectStore(storeName).getAll();
    req.onsuccess = () => res(req.result || []);
    req.onerror = () => rej(req.error);
  });
  const rows = all.filter(r => set.has(r.id)).map(r => ({ ...r, ...patch }));
  if (!rows.length) return;
  await new Promise((res, rej) => {
    const t = d.transaction(storeName, 'readwrite');
    const st = t.objectStore(storeName);
    for (const r of rows) st.put(r);
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
};

// ---- Helpers genericos para stores con clave UUID ----
const getAllFrom = async (storeName) => {
  const store = await tx(storeName);
  return new Promise((res, rej) => {
    const req = store.getAll();
    req.onsuccess = () => res(req.result || []);
    req.onerror = () => rej(req.error);
  });
};

const putManyInto = async (storeName, rows) => {
  if (!rows || rows.length === 0) return { ok: true, count: 0 };
  const d = await getDB();
  return new Promise((res, rej) => {
    const t = d.transaction(storeName, 'readwrite');
    const store = t.objectStore(storeName);
    for (const row of rows) store.put(row);
    t.oncomplete = () => res({ ok: true, count: rows.length });
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
};

const deleteFrom = async (storeName, id) => {
  const store = await tx(storeName, 'readwrite');
  return new Promise((res, rej) => {
    const req = store.delete(id);
    req.onsuccess = () => res();
    req.onerror = () => rej(req.error);
  });
};

// Limpia pendingSync SOLO de los ids indicados (mismo criterio que clientes/productos).
const clearPendingIn = async (storeName, ids) => {
  if (!ids || ids.length === 0) return;
  const all = await getAllFrom(storeName);
  const set = new Set(ids);
  const rows = all.filter(r => set.has(r.id) && r.pendingSync).map(r => ({ ...r, pendingSync: false }));
  await putManyInto(storeName, rows);
};

// ---- PROVEEDORES (REQ-PROV) ----
export const getProveedores = () => getAllFrom('proveedores');
export const putProveedor = (p) => putManyInto('proveedores', [{ ...p, pendingSync: true, updatedAt: Date.now() }]);
export const putProveedoresRemotos = (rows) => putManyInto('proveedores', rows);
export const deleteProveedor = (id) => deleteFrom('proveedores', id);
export const clearProveedoresPendingSync = (ids) => clearPendingIn('proveedores', ids);

// ---- MOVIMIENTOS DE STOCK (REQ-STK) — ledger, solo se agregan ----
export const getMovimientosStock = () => getAllFrom('movimientosStock');
export const addMovimientosStock = (movs) =>
  putManyInto('movimientosStock', (movs || []).map(m => ({ ...m, pendingSync: true, createdAt: Date.now() })));
export const putMovimientosRemotos = (rows) => putManyInto('movimientosStock', rows);
export const clearMovimientosPendingSync = (ids) => clearPendingIn('movimientosStock', ids);
export const rekeyMovimientosRef = async (oldRef, newRef) => {
  if (!oldRef || !newRef || oldRef === newRef) return 0;
  const all = await getAllFrom('movimientosStock');
  const rows = all.filter(m => m.ref === oldRef).map(m => ({ ...m, ref: newRef, pendingSync: true }));
  await putManyInto('movimientosStock', rows);
  return rows.length;
};

// ---- INGRESOS DE MERCADERIA (REQ-ING) ----
export const getIngresos = () => getAllFrom('ingresos');
export const putIngresosRemotos = (rows) => putManyInto('ingresos', rows);
export const clearIngresosPendingSync = (ids) => clearPendingIn('ingresos', ids);

// Graba cabecera + movimientos en UNA transaccion: o se graba todo o nada
// (AC-ING-5: nunca un ingreso sin sus movimientos ni al reves).
export const addIngresoConMovimientos = async (ingreso, movimientos) => {
  const d = await getDB();
  const now = Date.now();
  return new Promise((res, rej) => {
    const t = d.transaction(['ingresos', 'movimientosStock'], 'readwrite');
    t.objectStore('ingresos').add({ ...ingreso, pendingSync: true, createdAt: now });
    const ms = t.objectStore('movimientosStock');
    for (const m of movimientos) ms.add({ ...m, pendingSync: true, createdAt: now });
    t.oncomplete = () => res({ ok: true });
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
};

// ---- COMISIONES (REQ-COM) ----
// Cierres: documento inmutable con id UUID. Se guardan locales con pendingSync
// hasta que el servidor (RPC) los confirma; se limpian SOLO los ids confirmados.
export const getComisionesCierres = () => getAllFrom('comisionesCierres');
export const putComisionCierreLocal = (c) =>
  putManyInto('comisionesCierres', [{ ...c, pendingSync: true, updatedAt: Date.now() }]);
// Escritura "neutral" (respuesta del servidor / pull): guarda tal cual.
export const putComisionesCierresRemotos = (rows) => putManyInto('comisionesCierres', rows);
export const clearComisionesCierresPendingSync = (ids) => clearPendingIn('comisionesCierres', ids);

// Borrador de asignaciones del periodo (AC-COM-9): solo local, no se sincroniza.
export const getComisionBorrador = async (id) => {
  const store = await tx('comisionesBorradores');
  return new Promise((res, rej) => {
    const req = store.get(id);
    req.onsuccess = () => res(req.result || null);
    req.onerror = () => rej(req.error);
  });
};
export const putComisionBorrador = (b) => putManyInto('comisionesBorradores', [{ ...b, updatedAt: Date.now() }]);
