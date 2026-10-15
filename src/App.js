// src/App.js
import React, { useState, useEffect } from 'react';
import { AppProvider, useApp } from './hooks/useAppContext';
import NuevoPedido from './pages/NuevoPedido';
import ListaPedidos from './pages/ListaPedidos';
import Facturacion from './pages/Facturacion';
import ResumenDia from './pages/ResumenDia';
import ReportesVentas from './pages/ReportesVentas';
import Configuracion from './pages/Configuracion';
import Faltantes from './pages/Faltantes';
import Deudas from './pages/Deudas';
import OrdenEntrega from './pages/OrdenEntrega';
import Armado from './pages/Armado';
import Stock from './pages/Stock';
import Comisiones from './pages/Comisiones';
import FacturasAEmitir from './pages/FacturasAEmitir';
import PedidosWeb from './pages/PedidosWeb';
import Proveedores from './pages/Proveedores';
import Rendicion from './pages/Rendicion';
import { contarPorRevisar } from './domain/pedidosWeb';
import { contarStockBajo } from './domain/stockBajo';
import SelectorVendedor from './components/SelectorVendedor';
import { useSync } from './sync/useSync';
import { esAdmin, esArmador } from './domain/permisos';
import './App.css';

const TABS = [
  // Emojis con escapes Unicode para mantener el archivo ASCII y evitar mojibake.
  { id: 'nuevo', label: 'Pedido', icon: '\u2795' }, // ➕
  { id: 'lista', label: 'Pedidos', icon: '\u{1F4CB}' }, // 📋
  { id: 'armado', label: 'Armado', icon: '\u{1F4E6}' }, // 📦
  { id: 'facturacion', label: 'Facturar', icon: '\u{1F9FE}' }, // 🧾
  { id: 'stock', label: 'Stock', icon: '\u{1F3F7}\uFE0F' }, // 🏷️ (solo admin)
  { id: 'proveedores', label: 'Proveedores', icon: '\u{1F69A}' }, // 🚚 solo admin (REQ-CPR)
  { id: 'faltantes', label: 'Faltantes', icon: '\u26A0\uFE0F' }, // ⚠️
  { id: 'deudas', label: 'Deudas', icon: '\u{1F4B0}' }, // 💰
  { id: 'rendicion', label: 'Rendición', icon: '↩️' }, // ↩️ solo admin (REQ-REN)
  { id: 'ordenentrega', label: 'Orden', icon: '\u{1F5FA}️' }, // 🗺️
  { id: 'resumen', label: 'Resumen', icon: '\u{1F4CA}' }, // 📊
  { id: 'comisiones', label: 'Comisiones', icon: '\u{1F4B5}' }, // solo admin (REQ-COM)
  { id: 'facturasemitir', label: 'A emitir', icon: '\u{1F4D1}' }, // solo admin (REQ-FAB, AC-FAB-3)
  { id: 'pedidosweb', label: 'Web', icon: '\u{1F6D2}' }, // carrito, solo admin (REQ-WEB)
  { id: 'reportes', label: 'Reportes', icon: '\u{1F4C8}' }, // 📈
  { id: 'config', label: 'Config', icon: '\u2699\uFE0F' }, // ⚙️
];

const AppContent = () => {
  const [tab, setTab] = useState('nuevo');
  const { vendedorActual, online, faltantes, pedidos, seleccionarVendedor, productos, stockMap } = useApp();
  // REQ-CPR (AC-CPR-4): al marcar recibido un pedido al proveedor se abre Stock -> Ingreso precargado.
  const [ingresoPrecargado, setIngresoPrecargado] = useState(null);
  const { syncing, lastSync, error, syncNote, syncNow } = useSync();
  // S-COM-11: permiso entero validado (src/domain/permisos). Un "1" en texto o
  // cualquier valor raro no habilita admin/armador: cae en las pestañas de vendedor.
  const isAdmin = esAdmin(vendedorActual?.permiso);
  const isArmador = esArmador(vendedorActual?.permiso);

  const mesActual = (() => {
    const h = new Date();
    return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}`;
  })();
  const hoyStr = (() => {
    const h = new Date();
    return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}-${String(h.getDate()).padStart(2, '0')}`;
  })();
  // El armador solo ve lo de hoy en Faltantes, asi que su badge cuenta lo de hoy;
  // el admin ve todo el mes, asi que su badge cuenta lo del mes.
  const faltantesMes = isArmador
    ? (faltantes || []).filter(f => f.fecha === hoyStr).length
    : (faltantes || []).filter(f => f.mes === mesActual).length;

  // REQ-WEB (AC-WEB-1): contador de pedidos web por revisar (solo se muestra al admin).
  const webPorRevisar = isAdmin ? contarPorRevisar(pedidos) : 0;

  // REQ-STB (AC-STB-3): contador de productos con stock bajo en la pestaña Stock (solo admin, AC-SEC-4).
  const stockBajo = isAdmin ? contarStockBajo(productos || [], stockMap) : 0;

  // "Orden de entrega" lo puede ver cualquier usuario, sea cual sea su rol.
  const visibleTabs = isAdmin
    ? TABS
    : isArmador
      ? TABS.filter(t => t.id === 'armado' || t.id === 'faltantes' || t.id === 'ordenentrega')
      : TABS.filter(t => t.id === 'nuevo' || t.id === 'lista' || t.id === 'ordenentrega');

  // Si el usuario quedo en una pestaña restringida (por cache), volver a la pestaña por defecto de su rol.
  useEffect(() => {
    if (isAdmin) return;
    if (isArmador) {
      if (tab === 'armado' || tab === 'faltantes' || tab === 'ordenentrega') return;
      setTab('armado');
      return;
    }
    if (tab === 'nuevo' || tab === 'lista' || tab === 'ordenentrega') return;
    setTab('nuevo');
  }, [isAdmin, isArmador, tab]);

  const cambiarUsuario = () => {
    if (!window.confirm('¿Cambiar de usuario? Vas a volver a la pantalla de inicio.')) return;
    seleccionarVendedor(null);
  };

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      // Evitar que Safari se quede con una version vieja cacheada.
      navigator.serviceWorker.getRegistrations()
        .then(regs => regs.forEach(r => r.unregister()))
        .catch(() => {});
    }
  }, []);

  if (!vendedorActual) return <SelectorVendedor />;

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-left">
          <span className="app-logo">D</span>
          <div>
            <span className="app-title">DISTRIBUIDORA APP</span>
            <span className="vendedor-badge">{vendedorActual.nombre}</span>
          </div>
        </div>

        <div className="header-right" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {syncing && (
            <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
              {syncNote || 'Sincronizando...'}
            </span>
          )}
          {!syncing && error && (
            <span
              style={{ fontSize: 11, color: 'var(--danger)', cursor: 'pointer' }}
              title={error}
              onClick={syncNow}
            >
              {'\u26A0\uFE0F'} Error sync
            </span>
          )}
          {!syncing && !error && lastSync && (
            <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
              {'\u2713'} {lastSync.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}

          {online && !syncing && (
            <button
              onClick={syncNow}
              title="Sincronizar ahora"
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 12, padding: '0 2px', color: 'var(--text-secondary)',
              }}
            >
              {'\u21BB'} Sync
            </button>
          )}

          <div
            className={`sync-dot ${online ? 'online' : 'offline'}`}
            title={online ? 'En linea' : 'Sin conexion'}
          />

          {!isAdmin && (
            <button
              onClick={cambiarUsuario}
              title="Cambiar de usuario"
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 12, padding: '0 2px', color: 'var(--text-secondary)',
              }}
            >
              {'\u{1F464}'} Cambiar usuario
            </button>
          )}
        </div>
      </header>

      <nav className="top-nav">
        {visibleTabs.map(t => (
          <button
            key={t.id}
            className={`nav-btn ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            <span className="nav-icon" style={{ position: 'relative' }}>
              {t.icon}
              {t.id === 'pedidosweb' && webPorRevisar > 0 && (
                <span data-testid="badge-web" style={{
                  position: 'absolute', top: -2, right: -2,
                  background: 'var(--danger)', color: 'white',
                  borderRadius: '50%', width: 14, height: 14,
                  fontSize: 9, fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  lineHeight: 1,
                }}>
                  {webPorRevisar > 99 ? '99+' : webPorRevisar}
                </span>
              )}
              {t.id === 'stock' && stockBajo > 0 && (
                <span data-testid="badge-stock" style={{
                  position: 'absolute', top: -2, right: -2,
                  background: 'var(--danger)', color: 'white',
                  borderRadius: '50%', minWidth: 14, height: 14,
                  fontSize: 9, fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  lineHeight: 1,
                }}>
                  {stockBajo > 99 ? '99+' : stockBajo}
                </span>
              )}
              {t.id === 'faltantes' && faltantesMes > 0 && (
                <span style={{
                  position: 'absolute', top: -2, right: -2,
                  background: 'var(--danger)', color: 'white',
                  borderRadius: '50%', width: 14, height: 14,
                  fontSize: 9, fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  lineHeight: 1,
                }}>
                  {faltantesMes > 99 ? '99+' : faltantesMes}
                </span>
              )}
            </span>
            <span className="nav-label">{t.label}</span>
          </button>
        ))}
      </nav>

      <main className="app-main">
        {tab === 'nuevo' && <NuevoPedido />}
        {tab === 'lista' && <ListaPedidos />}
        {tab === 'armado' && <Armado />}
        {tab === 'facturacion' && <Facturacion />}
        {tab === 'stock' && isAdmin && <Stock precarga={ingresoPrecargado} onPrecargaUsada={() => setIngresoPrecargado(null)} />}
        {tab === 'proveedores' && isAdmin && <Proveedores onAbrirIngreso={(form) => { setIngresoPrecargado(form); setTab('stock'); }} />}
        {tab === 'faltantes' && <Faltantes />}
        {tab === 'deudas' && <Deudas />}
        {tab === 'rendicion' && isAdmin && <Rendicion />}
        {tab === 'ordenentrega' && <OrdenEntrega />}
        {tab === 'resumen' && <ResumenDia />}
        {tab === 'reportes' && <ReportesVentas />}
        {tab === 'comisiones' && isAdmin && <Comisiones />}
        {tab === 'facturasemitir' && isAdmin && <FacturasAEmitir />}
        {tab === 'pedidosweb' && isAdmin && <PedidosWeb />}
        {tab === 'config' && <Configuracion />}
      </main>
    </div>
  );
};

const App = () => (
  <AppProvider>
    <AppContent />
  </AppProvider>
);

export default App;
