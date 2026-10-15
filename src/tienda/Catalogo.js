// src/tienda/Catalogo.js — AC-TIE-4/5/6: encabezado fijo, buscador con debounce y grilla.
// El buscador filtra el catálogo ya descargado: no hace consultas al servidor por tecla.
import React, { useEffect, useMemo, useState } from 'react';
import { filtrarCatalogo, DEBOUNCE_BUSQUEDA_MS } from '../domain/tienda';
import TarjetaProducto from './TarjetaProducto';
import Filtros from './Filtros';

export const Encabezado = ({ texto, onTexto, cantidadCarrito, navegar, search, nombreTienda }) => (
  <header className="t-header">
    <a className="t-logo" href="/tienda" onClick={(e) => { e.preventDefault(); navegar(`/tienda${search}`); }}>{nombreTienda}</a>
    {onTexto ? (
      <input
        className="t-buscador" type="search" placeholder="Buscar productos" aria-label="Buscar productos"
        value={texto} onChange={e => onTexto(e.target.value)}
      />
    ) : (
      <input
        className="t-buscador" type="search" placeholder="Buscar productos" aria-label="Buscar productos"
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          const q = e.currentTarget.value.trim();
          const sp = new URLSearchParams(search);
          if (q) sp.set('q', q);
          const qs = sp.toString();
          navegar(qs ? `/tienda?${qs}` : '/tienda');
        }}
      />
    )}
    <a className="t-carrito-btn" href="/tienda/carrito" aria-label={`Carrito, ${cantidadCarrito} productos`}
      onClick={(e) => { e.preventDefault(); navegar(`/tienda/carrito${search}`); }}>
      Carrito <span className="t-contador" data-testid="contador-carrito">{cantidadCarrito}</span>
    </a>
  </header>
);

const Catalogo = ({ productos, config, filtros, onFiltros, onAgregar, navegar, cantidadCarrito, cargando, error, nombreTienda }) => {
  const [texto, setTexto] = useState(filtros.q);
  const [panel, setPanel] = useState(false);
  const search = filtros.v ? `?v=${encodeURIComponent(filtros.v)}` : '';

  // Debounce: la URL y el filtro se actualizan recién cuando el cliente deja de tipear.
  useEffect(() => {
    if (texto === filtros.q) return undefined;
    const t = setTimeout(() => onFiltros({ ...filtros, q: texto }), DEBOUNCE_BUSQUEDA_MS);
    return () => clearTimeout(t);
  }, [texto, filtros, onFiltros]);

  const { items, contadores } = useMemo(() => filtrarCatalogo(productos, filtros), [productos, filtros]);

  return (
    <div className="t-pagina">
      <Encabezado texto={texto} onTexto={setTexto} cantidadCarrito={cantidadCarrito} navegar={navegar} search={search} nombreTienda={nombreTienda} />
      <main className="t-main">
        <Filtros filtros={filtros} contadores={contadores} abierto={panel} onToggle={() => setPanel(p => !p)} onCambio={onFiltros} cantidad={items.length} />
        <div className="t-resultados">
          <p className="t-contador-resultados" data-testid="contador-resultados">{items.length} {items.length === 1 ? 'producto' : 'productos'}</p>
          {cargando ? <p>Cargando catálogo...</p> : null}
          {error ? <p role="alert" className="t-error">{error}</p> : null}
          {!cargando && !error && items.length === 0 ? <p>No encontramos productos con esa búsqueda.</p> : null}
          <div className="t-grilla" data-testid="grilla">
            {items.map(p => (
              <TarjetaProducto key={p.id} prod={p} permitirSinStock={config.permitirSinStock} onAgregar={onAgregar} navegar={navegar} search={search} />
            ))}
          </div>
        </div>
      </main>
    </div>
  );
};

export default Catalogo;
