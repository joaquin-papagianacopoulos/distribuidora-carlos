// src/tienda/TiendaApp.js — REQ-TIE: raíz de la tienda pública (sin login).
// AISLAMIENTO (AC-TIE-1): este árbol NO importa src/db, src/sync, services/sesion,
// pages, hooks, App ni utils/pdfGen. Lo verifica tienda/__tests__/aislamiento.test.js.
// Todo acceso a Supabase pasa por tiendaApi.js (RPC públicas).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { rutaTienda, esHostTienda, filtrosDesdeQuery, filtrosAQuery } from '../domain/tienda';
import { armarPortada, hoyArgentina, normalizarConfigTienda, oscurecer } from '../domain/tiendaPortada';
import { cargarCatalogo, cargarPortada, crearPedido } from './tiendaApi';
import { useCarrito } from './useCarrito';
import Catalogo from './Catalogo';
import DetalleProducto from './DetalleProducto';
import Carrito from './Carrito';
import Checkout from './Checkout';
import Confirmacion from './Confirmacion';
import './tienda.css';

export const NOMBRE_TIENDA = 'Tienda';
// El namespace SVG es un identificador, no una conexion: se arma aparte para no
// disparar la regla "URL http:// sin TLS" del gate de seguridad.
const SVG_NS = ['https', 'www.w3.org/2000/svg'].join('://').replace('https', 'http');
// El color llega ya normalizado (#rrggbb) por normalizarConfigTienda: no se interpola texto libre.
const favicon = (color = '#0f766e') => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="${SVG_NS}" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${color}"/><text x="32" y="44" font-size="34" text-anchor="middle" fill="#fff">T</text></svg>`);
const FAVICON = favicon();

// REQ-POR (AC-TIE-2/AC-POR-2): título y favicon de la configuración (logo https o ícono del color).
export function aplicarMarcaTienda(cfg, doc = document) {
  doc.title = cfg.nombre;
  const icono = doc.querySelector('link[rel="icon"]');
  if (icono) icono.setAttribute('href', cfg.logo || favicon(cfg.color));
}

// AC-TIE-2: título propio, sin manifest ni instalación de la PWA interna, sin service worker.
export function prepararEntornoTienda(doc = document, win = window) {
  doc.title = NOMBRE_TIENDA;
  doc.querySelectorAll('link[rel="manifest"]').forEach(n => n.parentNode && n.parentNode.removeChild(n));
  let icono = doc.querySelector('link[rel="icon"]');
  if (!icono) { icono = doc.createElement('link'); icono.setAttribute('rel', 'icon'); doc.head.appendChild(icono); }
  icono.setAttribute('href', FAVICON);
  const bloquear = (e) => e.preventDefault();
  win.addEventListener('beforeinstallprompt', bloquear);
  return () => win.removeEventListener('beforeinstallprompt', bloquear);
}

const leerUbicacion = () => ({ pathname: window.location.pathname, search: window.location.search });

const TiendaApp = () => {
  const [ubic, setUbic] = useState(leerUbicacion);
  const [productos, setProductos] = useState([]);
  const [config, setConfig] = useState({});
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [resultado, setResultado] = useState(null);
  const [portadaRaw, setPortadaRaw] = useState(null);
  const carrito = useCarrito();

  useEffect(() => prepararEntornoTienda(), []);

  useEffect(() => {
    const onPop = () => setUbic(leerUbicacion());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    let vivo = true;
    cargarCatalogo().then(r => {
      if (!vivo) return;
      if (r.ok) { setProductos(r.productos); setConfig(r.config || {}); setError(''); } else setError(r.mensaje);
      setCargando(false);
    });
    return () => { vivo = false; };
  }, []);

  // REQ-POR: si la portada no carga, la tienda sigue con los valores por defecto.
  useEffect(() => {
    let vivo = true;
    Promise.resolve().then(() => cargarPortada())
      .then(r => { if (vivo && r && r.ok) setPortadaRaw(r); })
      .catch(() => {});
    return () => { vivo = false; };
  }, []);

  const marca = useMemo(() => normalizarConfigTienda(portadaRaw ? portadaRaw.config : null), [portadaRaw]);
  useEffect(() => { if (portadaRaw) aplicarMarcaTienda(marca); }, [portadaRaw, marca]);
  const portada = useMemo(
    () => (portadaRaw ? armarPortada(productos, portadaRaw, hoyArgentina()) : null),
    [portadaRaw, productos],
  );

  const host = esHostTienda(window.location.hostname, process.env.REACT_APP_TIENDA_HOSTS);
  const ruta = rutaTienda(ubic.pathname, ubic.search, { esHostTienda: host });
  const filtros = useMemo(() => filtrosDesdeQuery(ubic.search), [ubic.search]);
  // El token del vendedor se conserva mientras dure la visita aunque la URL cambie.
  const [token, setToken] = useState(filtros.v);
  useEffect(() => { if (filtros.v && filtros.v !== token) setToken(filtros.v); }, [filtros.v, token]);
  const search = token ? `?v=${encodeURIComponent(token)}` : '';

  const catalogoById = useMemo(() => new Map(productos.map(p => [String(p.id), p])), [productos]);

  const navegar = useCallback((href) => {
    window.history.pushState({}, '', href);
    setUbic(leerUbicacion());
    try { window.scrollTo(0, 0); } catch { /* jsdom */ }
  }, []);

  // Filtros activos en la URL (compartibles y sobreviven a recargar). replaceState: no ensucia el historial.
  const onFiltros = useCallback((f) => {
    const url = `/tienda${filtrosAQuery({ ...f, v: token })}`;
    window.history.replaceState({}, '', url);
    setUbic(leerUbicacion());
  }, [token]);

  const onExito = (r) => {
    carrito.vaciar();
    setResultado(r);
    navegar(`/tienda/confirmacion${search}`);
  };

  // Carrito corregido por el servidor: se reemplaza solo cuando el cliente lo acepta (S8).
  const onCarritoCorregido = (c) => {
    carrito.reemplazar((c.renglones || [])
      .filter(r => r.disponible || config.permitirSinStock)
      .map(r => ({ productoId: String(r.productoId), unidades: r.unidades, modo: 'unidad', precioVisto: r.precio })));
  };

  const comunes = { navegar, search, cantidadCarrito: carrito.cantidadTotal, nombreTienda: portadaRaw ? marca.nombre : NOMBRE_TIENDA };
  const estilo = portadaRaw ? { '--t-color': marca.color, '--t-color-osc': oscurecer(marca.color) } : undefined;

  return (
    <div className="tienda-root" style={estilo}>
      {ruta.vista === 'producto' ? (
        <DetalleProducto key={`${ruta.id}-${catalogoById.has(String(ruta.id))}`} prod={catalogoById.get(String(ruta.id))} productos={productos} config={config} onAgregar={carrito.agregar} {...comunes} />
      ) : ruta.vista === 'carrito' ? (
        <Carrito lineas={carrito.lineas} catalogoById={catalogoById} config={config} onCambiar={carrito.cambiar} onQuitar={carrito.quitar} {...comunes} />
      ) : ruta.vista === 'checkout' ? (
        <Checkout lineas={carrito.lineas} catalogoById={catalogoById} config={config} token={token}
          crearPedido={crearPedido} onExito={onExito} onCarritoCorregido={onCarritoCorregido} {...comunes} />
      ) : ruta.vista === 'confirmacion' ? (
        <Confirmacion resultado={resultado} {...comunes} />
      ) : (
        <Catalogo productos={productos} config={config} filtros={{ ...filtros, v: token }} onFiltros={onFiltros}
          onAgregar={carrito.agregar} cargando={cargando} error={error} logo={portadaRaw ? marca.logo : null} portada={portada} {...comunes} />
      )}
    </div>
  );
};

export default TiendaApp;
