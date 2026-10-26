import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import {
  initDB,
  seedDemoData,
  getProductos,
  getClientes,
  getVendedores,
  getPedidos,
  getFaltantes,
  getDeudas,
  getProveedores,
  getMovimientosStock,
  getIngresos,
  getComisionesCierres,
  getIngresosCostos,
  getCuentaProveedores,
  getPedidosProveedor,
} from '../db';
import { calcularStock } from '../domain/stock';
import { tienePin, estaActivo } from '../domain/vendedores';
import { syncStock } from '../services/stockService';
import { syncComisiones } from '../services/comisionesService';
import { setUsuarioSesion, datosPersistibles, marcarSesionValidada, sesionValidada, limpiarSesion } from '../services/sesion';
import {
  syncPedidosPendientes,
  downloadMaestros,
  pullPedidosRecientes,
  pullPedidosByFecha,
  pullPedidosByClienteNombre,
  syncFaltantes,
  syncDeudas,
  syncProductos,
  syncClientes,
  pullPedidosWebPorRevisar,
  pullPedidosWebRecientes,
  pullPedidosByRango,
} from '../sync/syncService';

const AppContext = createContext(null);

const SYNC_INTERVAL = 180_000;
// Productos/clientes: se bajan en cada sync liviano (antes cada 30 min y el celular quedaba con datos viejos).
const MAESTROS_SYNC_INTERVAL = 2 * 60_000;
const FALTANTES_SYNC_INTERVAL = 10 * 60_000;

export const AppProvider = ({ children }) => {
  const [productos, setProductos] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [vendedores, setVendedores] = useState([]);
  const [pedidos, setPedidos] = useState([]);
  const [faltantes, setFaltantes] = useState([]);
  const [deudas, setDeudas] = useState([]);
  const [proveedores, setProveedores] = useState([]);
  const [movimientosStock, setMovimientosStock] = useState([]);
  const [ingresos, setIngresos] = useState([]);
  const [stockMap, setStockMap] = useState(() => new Map());
  // REQ-COM: cierres de comisiones locales (para el badge "Cerrado" en Facturacion).
  const [comisionesCierres, setComisionesCierres] = useState([]);
  // REQ-INA / REQ-CPR: costos de ingresos, cuenta con proveedores y pedidos al proveedor (solo locales; suben con PIN).
  const [ingresosCostos, setIngresosCostos] = useState([]);
  const [cuentaProveedores, setCuentaProveedores] = useState([]);
  const [pedidosProveedor, setPedidosProveedor] = useState([]);
  const [vendedorActual, setVendedorActual] = useState(null);
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(navigator.onLine);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const [syncError, setSyncError] = useState(null);
  const [syncNote, setSyncNote] = useState(null);
  const isSyncing = useRef(false);
  const lastMaestrosSyncRef = useRef(0);
  const lastFaltantesSyncRef = useRef(0);
  const startupSyncVendorRef = useRef(null);
  const [zonaActiva, setZonaActiva] = useState(() => localStorage.getItem('zonaActiva') || '');

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const recargar = useCallback(async () => {
    const [p, c, v, ped, fal, deu, prov, movs, ing] = await Promise.all([
      getProductos(),
      getClientes(),
      getVendedores(),
      getPedidos(),
      getFaltantes(),
      getDeudas(),
      getProveedores(),
      getMovimientosStock(),
      getIngresos(),
    ]);
    setProveedores(prov);
    setMovimientosStock(movs);
    setIngresos(ing);
    setStockMap(calcularStock(movs));
    setProductos(p);
    setClientes(c);
    setVendedores(v);
    setPedidos(ped);
    setFaltantes(fal);
    setDeudas(deu);
    // Aparte y tolerante: si el store v5 no esta (upgrade bloqueado por otra
    // pestana) no se rompe el resto de la app.
    try {
      setComisionesCierres((await getComisionesCierres()) || []);
    } catch (e) {
      setComisionesCierres([]);
    }
    // Tolerante igual que arriba: si faltan los stores v10 no se rompe el resto.
    try {
      const [ic, cp, pp] = await Promise.all([getIngresosCostos(), getCuentaProveedores(), getPedidosProveedor()]);
      setIngresosCostos(ic || []);
      setCuentaProveedores(cp || []);
      setPedidosProveedor(pp || []);
    } catch (e) {
      setIngresosCostos([]);
      setCuentaProveedores([]);
      setPedidosProveedor([]);
    }
  }, []);

  // S-BUL-01 (mitigacion parcial, RUN 20261012-2106 iteracion 2): con red, la
  // sesion abierta se revalida contra la fila del servidor al restaurarla y
  // despues de cada pull de vendedores. Si difiere, manda el servidor; si no
  // existe o esta dada de baja, se cierra la sesion. Sin red no cambia nada
  // (offline-first). El servicio se importa recien aca: offline no se carga.
  const vendedorActualRef = useRef(null);
  useEffect(() => { vendedorActualRef.current = vendedorActual; }, [vendedorActual]);
  const revalidandoRef = useRef(false);
  const revalidarSesionActual = useCallback(async (v) => {
    if (!v || !navigator.onLine || revalidandoRef.current) return;
    revalidandoRef.current = true;
    try {
      const { revalidarSesion } = await import('../services/vendedoresService');
      const r = await revalidarSesion(v, { online: navigator.onLine });
      // Si mientras tanto cambio la sesion (otro usuario), no se toca.
      const actual = vendedorActualRef.current;
      if (actual && actual.id !== v.id) return;
      if (r.accion === 'cerrar') {
        setVendedorActual(null);
        setUsuarioSesion(null);
        limpiarSesion();
        startupSyncVendorRef.current = null;
        localStorage.removeItem('vendedorActual');
      } else if (r.accion === 'actualizar' && r.sesion) {
        // El registro local ya quedo corregido (persistirSesion): primero se
        // recarga, para que el merge no vuelva a mezclar el dato viejo.
        await recargar();
        const next = { ...r.sesion, permiso: Number(r.sesion.permiso || 2) };
        vendedorActualRef.current = next;
        setVendedorActual(next);
        setUsuarioSesion(next);
        localStorage.setItem('vendedorActual', JSON.stringify(datosPersistibles(next)));
      }
    } catch (e) {
      console.warn('No se pudo revalidar la sesion (se mantiene):', e?.message || String(e));
    } finally {
      revalidandoRef.current = false;
    }
  }, [recargar]);

  const runSync = useCallback(async ({ full = false, reason = 'auto' } = {}) => {
    if (isSyncing.current) return;
    if (!navigator.onLine) return;
    if (!full && typeof document !== 'undefined' && document.visibilityState === 'hidden') return;

    isSyncing.current = true;
    setSyncing(true);
    setSyncError(null);
    setSyncNote(null);

    const now = Date.now();
    const shouldSyncMaestros = full || (now - lastMaestrosSyncRef.current) >= MAESTROS_SYNC_INTERVAL;
    const shouldSyncFaltantes = full || (now - lastFaltantesSyncRef.current) >= FALTANTES_SYNC_INTERVAL;
    const recentLimit = full ? 300 : 120;
    const maxPedidoLoops = full ? 50 : 3;

    let step = 'syncPedidosPendientes';
    let avisoProductos = null;
    try {
      console.log(`Sync ${reason}: inicio${full ? ' completo' : ' liviano'}`);

      if (shouldSyncMaestros) {
        step = 'syncProductos';
        console.log('1. syncProductos...');
        const rp = await syncProductos();
        if (rp?.requierePinAdmin) {
          avisoProductos = `Hay ${rp.pendientes} producto(s) sin subir: un admin los sube desde Configuración con su PIN.`;
          setSyncNote(avisoProductos);
        }

        step = 'syncClientes';
        console.log('2. syncClientes...');
        await syncClientes();

        step = 'downloadMaestros';
        console.log('3. downloadMaestros...');
        await downloadMaestros();
        lastMaestrosSyncRef.current = Date.now();
        // S-BUL-01: vendedores recien bajados => revalidar la sesion.
        await revalidarSesionActual(vendedorActual);
      }

      step = 'syncPedidosPendientes';
      console.log('4. syncPedidosPendientes...');
      // En sync liviano subimos pocas tandas para no calentar moviles.
      // El boton Sync hace el recorrido completo para backups/importaciones.
      {
        let loops = 0;
        while (true) {
          const r = await syncPedidosPendientes();
          const remaining = Number(r?.remaining || 0);
          if (remaining > 0) {
            setSyncNote(`Subiendo pedidos... faltan ${remaining}`);
            loops += 1;
            if (loops >= maxPedidoLoops) break; // seguridad (no dejar sync infinito)
            await new Promise(res => setTimeout(res, 150));
            continue;
          }
          setSyncNote(avisoProductos);
          break;
        }
      }

      step = 'pullPedidosRecientes';
      console.log(`5. pullPedidosRecientes (${recentLimit})...`);
      {
        // Admin y Armador ven pedidos de todas las zonas/vendedores (el armador prepara pedidos de todos).
        const permisoActual = Number(vendedorActual?.permiso || 2);
        const verTodo = permisoActual === 1 || permisoActual === 3;
        const vendedorNombre = verTodo ? null : (vendedorActual?.nombre || null);
        const zona = verTodo ? (zonaActiva || null) : (vendedorActual?.zona || null);
        await pullPedidosRecientes(recentLimit, { vendedorNombre, zona });
      }

      if (shouldSyncFaltantes) {
        step = 'syncFaltantes';
        console.log('6. syncFaltantes...');
        await syncFaltantes();

        // Deudas es aparte: si falla (tabla sin crear, sin permisos) no debe
        // cortar el resto de la sincronizacion ni impedir el recargar. Pero el
        // fallo tiene que quedar visible (banner "Error sync" del header) y no
        // solo en la consola, si no nadie se entera de que no esta llegando
        // a los demas dispositivos.
        try {
          console.log('6b. syncDeudas...');
          await syncDeudas();
        } catch (e) {
          const msg = e?.message || String(e);
          console.warn('syncDeudas fallo (se reintenta en el proximo sync):', msg);
          setSyncError(`syncDeudas: ${msg}`);
        }

        lastFaltantesSyncRef.current = Date.now();
      }

      // Stock (proveedores, ingresos y movimientos). Va DESPUES de subir los
      // pedidos para que los movimientos de pedidos facturados offline ya
      // tengan la ref con el id remoto. Si falla, no corta el resto.
      step = 'syncStock';
      try {
        console.log('6c. syncStock...');
        // Pull completo del ledger solo con el boton Sync manual; el arranque usa
        // el cursor incremental (con solape), que alcanza para estar al dia.
        await syncStock({ full: reason === 'manual' });
      } catch (e) {
        const msg = e?.message || String(e);
        console.warn('syncStock fallo (se reintenta en el proximo sync):', msg);
        setSyncError(`syncStock: ${msg}`);
      }

      // Comisiones (REQ-COM): solo admin. Reintenta cierres/anulaciones que
      // quedaron sin respuesta y baja los cierres de otros dispositivos.
      if (Number(vendedorActual?.permiso || 2) === 1) {
        step = 'syncComisiones';
        try {
          console.log('6d. syncComisiones...');
          await syncComisiones();
        } catch (e) {
          const msg = e?.message || String(e);
          console.warn('syncComisiones fallo (se reintenta en el proximo sync):', msg);
          setSyncError(`syncComisiones: ${msg}`);
        }
      }

      // Pedidos web (REQ-WEB): admin y armador. El admin ademas baja los por revisar sin
      // limite de fecha; ambos bajan los web recientes sin filtro de zona (entran con zona ''),
      // asi el armador recibe los que el admin acepto desde otro dispositivo.
      {
        const permWeb = Number(vendedorActual?.permiso || 2);
        if (permWeb === 1 || permWeb === 3) {
          step = 'pullPedidosWeb';
          try {
            if (permWeb === 1) await pullPedidosWebPorRevisar();
            await pullPedidosWebRecientes();
          } catch (e) {
            const msg = e?.message || String(e);
            console.warn('pullPedidosWeb fallo (se reintenta en el proximo sync):', msg);
            setSyncError(`pullPedidosWeb: ${msg}`);
          }
        }
      }

      step = 'recargar';
      console.log('7. recargar...');
      await recargar();
      setLastSync(new Date());
      console.log('Sync completo');
    } catch (e) {
      console.error('ERROR EN SYNC:', e);
      const msg = String(e?.message || e);
      setSyncError(`${step}: ${msg}`);
    } finally {
      isSyncing.current = false;
      setSyncing(false);
    }
  }, [recargar, vendedorActual, zonaActiva, revalidarSesionActual]);

  useEffect(() => {
    const init = async () => {
      await initDB();
      if (localStorage.getItem('demoSeed') === '1') {
        await seedDemoData();
      }
      await recargar();
      // S-03: el rol (permiso) NO se toma de localStorage, que cualquiera puede
      // editar desde la consola. Solo se usa el id guardado para buscar al
      // vendedor en la base local; si no existe, se vuelve a la pantalla de
      // seleccion. (El arreglo de fondo requiere autenticacion en Supabase.)
      let saved = null;
      try { saved = JSON.parse(localStorage.getItem('vendedorActual') || 'null'); } catch { saved = null; }
      if (saved) {
        const lista = await getVendedores();
        const found = lista.find(x => (saved.id !== undefined && x.id === saved.id)
          || (saved.remoteId !== undefined && saved.remoteId !== null && x.remoteId === saved.remoteId));
        // Si el vendedor tiene PIN, se vuelve a pedir en cada sesion nueva de la
        // app (S-03 residual): conocer el id del admin ya no alcanza para entrar.
        // S-COM-13: el PIN ya no esta en el dispositivo; se usa tienePin.
        // La sesion ya validada (12 h) se restaura offline, como antes.
        // REQ-VEN (AC-VEN-4): un vendedor dado de baja no restaura sesion.
        if (found && estaActivo(found) && (!tienePin(found) || sesionValidada(found.id))) {
          const vv = { ...found, permiso: Number(found?.permiso || 2) };
          setVendedorActual(vv);
          setUsuarioSesion(vv);
          vendedorActualRef.current = vv;
          localStorage.setItem('vendedorActual', JSON.stringify(datosPersistibles(vv)));
          // S-BUL-01: con red, se revalida en segundo plano (no frena el arranque).
          if (navigator.onLine) revalidarSesionActual(vv);
        } else if (!found || !estaActivo(found)) {
          localStorage.removeItem('vendedorActual');
        }
      }
      const z = localStorage.getItem('zonaActiva');
      if (z != null) setZonaActiva(z);
      setLoading(false);
    };
    init();
  }, [recargar, revalidarSesionActual]);

  // Auto-sync eficiente: completo al iniciar, liviano al volver online/visible y por intervalo.
  useEffect(() => {
    if (loading) return;
    if (!navigator.onLine) return;
    if (!vendedorActual) return;
    const vendedorKey = String(vendedorActual?.remoteId || vendedorActual?.id || vendedorActual?.nombre || '');
    if (startupSyncVendorRef.current === vendedorKey) return;
    startupSyncVendorRef.current = vendedorKey;
    runSync({ full: true, reason: 'startup' });
  }, [loading, vendedorActual, runSync]);

  useEffect(() => {
    if (loading) return;
    if (!vendedorActual) return;
    const handleOnlineAuto = () => runSync({ full: false, reason: 'online' });
    const handleVisibleAuto = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        runSync({ full: false, reason: 'visible' });
      }
    };
    window.addEventListener('online', handleOnlineAuto);
    document.addEventListener('visibilitychange', handleVisibleAuto);
    const id = window.setInterval(() => {
      if (navigator.onLine && document.visibilityState === 'visible') {
        runSync({ full: false, reason: 'interval' });
      }
    }, SYNC_INTERVAL);
    return () => {
      window.removeEventListener('online', handleOnlineAuto);
      document.removeEventListener('visibilitychange', handleVisibleAuto);
      window.clearInterval(id);
    };
  }, [loading, vendedorActual, runSync]);

  const syncNow = useCallback(() => runSync({ full: true, reason: 'manual' }), [runSync]);

  const syncPedidosFecha = useCallback(async (fecha) => {
    if (!navigator.onLine) return;
    const permisoActual = Number(vendedorActual?.permiso || 2);
    const verTodo = permisoActual === 1 || permisoActual === 3;
    const vendedorNombre = verTodo ? null : (vendedorActual?.nombre || null);
    const zona = verTodo ? (zonaActiva || null) : (vendedorActual?.zona || null);
    try {
      await pullPedidosByFecha(fecha, { vendedorNombre, zona });
      // Los pedidos web aceptados tienen zona '' o distinta: no entran en el filtro de zona.
      if (verTodo) await pullPedidosWebRecientes();
    } catch (e) {
      console.warn('syncPedidosFecha error:', e?.message || e);
    }
    await recargar();
  }, [recargar, vendedorActual, zonaActiva]);

  // Resumen: sube lo pendiente y baja TODOS los pedidos del rango (sin filtro de zona/vendedor).
  const syncPedidosRango = useCallback(async (desde, hasta) => {
    if (!navigator.onLine) return { ok: false, motivo: 'offline' };
    try {
      await syncPedidosPendientes();
      const r = await pullPedidosByRango(desde, hasta);
      const permisoActual = Number(vendedorActual?.permiso || 2);
      if (permisoActual === 1 || permisoActual === 3) await pullPedidosWebRecientes();
      await recargar();
      return { ok: true, count: r?.count || 0, incompleto: !!r?.incompleto };
    } catch (e) {
      console.warn('syncPedidosRango error:', e?.message || e);
      await recargar();
      return { ok: false, motivo: 'error', mensaje: e?.message || String(e) };
    }
  }, [recargar, vendedorActual]);

  const syncPedidosCliente = useCallback(async (q) => {
    if (!navigator.onLine) return;
    const permisoActual = Number(vendedorActual?.permiso || 2);
    const verTodo = permisoActual === 1 || permisoActual === 3;
    const vendedorNombre = verTodo ? null : (vendedorActual?.nombre || null);
    const zona = verTodo ? (zonaActiva || null) : (vendedorActual?.zona || null);
    try {
      await pullPedidosByClienteNombre(q, 1200, { vendedorNombre, zona });
    } catch (e) {
      console.warn('syncPedidosCliente error:', e?.message || e);
    }
    await recargar();
  }, [recargar, vendedorActual, zonaActiva]);

  const seleccionarVendedor = (v) => {
    if (!v) {
      setVendedorActual(null);
      setUsuarioSesion(null);
      limpiarSesion();
      startupSyncVendorRef.current = null;
      localStorage.removeItem('vendedorActual');
      return;
    }
    const vv = { ...v, permiso: Number(v?.permiso || 2) };
    setVendedorActual(vv);
    setUsuarioSesion(vv);
    marcarSesionValidada(vv.id);
    // Solo id/nombre: nunca el PIN ni el permiso (S-03).
    localStorage.setItem('vendedorActual', JSON.stringify(datosPersistibles(vv)));
    // Si es vendedor limitado, fijar zonaActiva a su zona.
    if (Number(vv?.permiso || 2) !== 1) {
      const z = String(vv?.zona || '');
      setZonaActiva(z);
      localStorage.setItem('zonaActiva', z);
    }
  };

  const setZona = useCallback((z) => {
    const zz = String(z ?? '');
    setZonaActiva(zz);
    localStorage.setItem('zonaActiva', zz);
  }, []);

  // Mantener vendedorActual actualizado con lo que viene de la DB (permiso / tienePin, etc.)
  useEffect(() => {
    if (!vendedorActual) return;
    const found = (vendedores || []).find(v => v.id === vendedorActual.id);
    if (!found) return;
    // REQ-VEN (AC-VEN-4): si lo dieron de baja (aca o en otro dispositivo, via
    // pull), se cierra la sesion.
    if (!estaActivo(found)) {
      setVendedorActual(null);
      setUsuarioSesion(null);
      limpiarSesion();
      startupSyncVendorRef.current = null;
      localStorage.removeItem('vendedorActual');
      return;
    }
    const next = { ...vendedorActual, ...found, permiso: Number(found?.permiso || 2) };
    if (JSON.stringify(next) === JSON.stringify(vendedorActual)) return;
    setVendedorActual(next);
    setUsuarioSesion(next);
    localStorage.setItem('vendedorActual', JSON.stringify(datosPersistibles(next)));
  }, [vendedores, vendedorActual]);

  return (
    <AppContext.Provider value={{
      productos,
      clientes,
      vendedores,
      pedidos,
      faltantes,
      deudas,
      proveedores,
      movimientosStock,
      ingresos,
      stockMap,
      comisionesCierres,
      ingresosCostos,
      cuentaProveedores,
      pedidosProveedor,
      vendedorActual,
      seleccionarVendedor,
      loading,
      online,
      recargar,
      syncing,
      lastSync,
      syncError,
      syncNote,
      zonaActiva,
      setZona,
      syncNow,
      syncPedidosFecha,
      syncPedidosRango,
      syncPedidosCliente,
    }}>
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => useContext(AppContext);
