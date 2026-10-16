// src/tienda/Catalogo.js — AC-TIE-4/5/6: encabezado fijo, buscador con debounce y grilla.
// El buscador filtra el catálogo ya descargado: no hace consultas al servidor por tecla.
import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { filtrarCatalogo, filtrosAQuery, DEBOUNCE_BUSQUEDA_MS } from '../domain/tienda';
import { TiendaUiContext, IconoLupa, IconoCarrito } from './ui';
import TarjetaProducto from './TarjetaProducto';
import Filtros from './Filtros';
import Portada, { Pie } from './Portada';

// Encabezado fijo tipo marketplace: franja del color de la marca con buscador,
// carrito y, abajo, el menú de rubros (se desplaza de costado en el celular).
const MenuRubros = ({ navegar }) => {
  const { rubrosMenu = [], token = '' } = useContext(TiendaUiContext);
  if (!rubrosMenu.length) return null;
  return (
    <nav className="t-menu-rubros" aria-label="Rubros">
      {rubrosMenu.map(r => {
        const href = `/tienda${filtrosAQuery({ v: token, rubros: [r] })}`;
        return <a key={r} href={href} onClick={(e) => { e.preventDefault(); navegar(href); }}>{r}</a>;
      })}
    </nav>
  );
};

export const Encabezado = ({ texto, onTexto, cantidadCarrito, navegar, search, nombreTienda, logo }) => {
  const entrada = useRef(null);
  const irABuscar = (q) => {
    const sp = new URLSearchParams(search);
    if (q) sp.set('q', q);
    const qs = sp.toString();
    navegar(qs ? `/tienda?${qs}` : '/tienda');
  };
  return (
    <header className="t-header">
      <div className="t-header-fila">
        <a className="t-logo" href="/tienda" onClick={(e) => { e.preventDefault(); navegar(`/tienda${search}`); }}>
          {logo ? <img className="t-logo-img" src={logo} alt="" /> : null}{nombreTienda}
        </a>
        {/* No es un <form>: la página de checkout tiene el suyo y no deben mezclarse. */}
        <div className="t-buscador-caja" role="search">
          {onTexto ? (
            <input
              className="t-buscador" type="search" placeholder="Buscar productos, marcas y más" aria-label="Buscar productos"
              value={texto} onChange={e => onTexto(e.target.value)}
            />
          ) : (
            <input
              ref={entrada} className="t-buscador" type="search" placeholder="Buscar productos, marcas y más" aria-label="Buscar productos"
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); irABuscar(e.currentTarget.value.trim()); } }}
            />
          )}
          <button type="button" className="t-buscador-btn" aria-label="Buscar"
            onClick={() => (onTexto ? onTexto(texto) : irABuscar(entrada.current ? entrada.current.value.trim() : ''))}><IconoLupa /></button>
        </div>
        <a className="t-carrito-btn" href="/tienda/carrito" aria-label={`Carrito, ${cantidadCarrito} productos`}
          onClick={(e) => { e.preventDefault(); navegar(`/tienda/carrito${search}`); }}>
          <IconoCarrito />
          <span className="t-contador" data-testid="contador-carrito">{cantidadCarrito}</span>
        </a>
      </div>
      <MenuRubros navegar={navegar} />
    </header>
  );
};

const Catalogo = ({ productos, config, filtros, onFiltros, onAgregar, navegar, cantidadCarrito, cargando, error, nombreTienda, logo, portada }) => {
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
  // REQ-POR (AC-POR-1): la portada se muestra en el inicio, sin búsqueda ni filtros activos.
  const enInicio = !filtros.q && !texto && filtros.rubros.length === 0 && filtros.marcas.length === 0 && !filtros.ofertas;

  return (
    <div className="t-pagina">
      <Encabezado texto={texto} onTexto={setTexto} cantidadCarrito={cantidadCarrito} navegar={navegar} search={search} nombreTienda={nombreTienda} logo={logo} />
      {enInicio && portada ? (
        <Portada portada={portada} permitirSinStock={config.permitirSinStock} onAgregar={onAgregar} navegar={navegar} token={filtros.v} />
      ) : null}
      <main className="t-main">
        {filtros.ofertas ? (
          <p className="t-chip-activo">Mostrando ofertas <button type="button" className="t-btn-link" onClick={() => onFiltros({ ...filtros, ofertas: false })}>Quitar</button></p>
        ) : null}
        <Filtros filtros={filtros} contadores={contadores} abierto={panel} onToggle={() => setPanel(p => !p)} onCambio={onFiltros} cantidad={items.length} />
        <div className="t-resultados">
          <p className="t-contador-resultados" data-testid="contador-resultados">{items.length} {items.length === 1 ? 'producto' : 'productos'}</p>
          {cargando ? <p>Cargando catálogo...</p> : null}
          {error ? <p role="alert" className="t-error">{error}</p> : null}
          {!cargando && !error && items.length === 0 ? <p>No encontramos productos con esa búsqueda.</p> : null}
          <div className="t-grilla" data-testid="grilla">
            {items.map((p, i) => (
              <TarjetaProducto key={p.id} prod={p} indice={i} permitirSinStock={config.permitirSinStock} onAgregar={onAgregar} navegar={navegar} search={search} />
            ))}
          </div>
        </div>
      </main>
      {portada ? <Pie config={portada.config} /> : null}
    </div>
  );
};

export default Catalogo;
