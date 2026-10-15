// src/tienda/TarjetaProducto.js — AC-TIE-7: tarjeta del catálogo.
import React from 'react';
import { formatearPesos, textoBulto, textoPrecioBulto, hrefTienda } from '../domain/tienda';

// Solo se muestran imágenes https (SEC-POR-7: sin contenido mixto): nada de http, javascript: ni data:.
export const imagenSegura = (url) => (typeof url === 'string' && /^https:\/\//i.test(url) ? url : null);

export const puedeAgregar = (prod, permitirSinStock) => !!prod.disponible || !!permitirSinStock;

const TarjetaProducto = ({ prod, permitirSinStock = false, onAgregar, navegar, search = '' }) => {
  const img = imagenSegura(prod.imagen);
  const bulto = textoBulto(prod);
  const precioBultoTxt = textoPrecioBulto(prod);
  const ok = puedeAgregar(prod, permitirSinStock);
  const href = hrefTienda('producto', { id: prod.id, search });
  return (
    <article className="t-card" data-testid="tarjeta-producto">
      <a className="t-card-img" href={href} onClick={(e) => { e.preventDefault(); navegar(href); }}>
        {img ? <img src={img} alt={prod.nombre} loading="lazy" /> : <span className="t-placeholder" aria-hidden="true">Sin foto</span>}
      </a>
      <div className="t-card-body">
        {prod.marca ? <div className="t-marca">{prod.marca}</div> : null}
        <a className="t-nombre" href={href} onClick={(e) => { e.preventDefault(); navegar(href); }}>{prod.nombre}</a>
        {prod.precioAnterior ? <s className="t-precio-anterior" data-testid="precio-anterior">{formatearPesos(prod.precioAnterior)}</s> : null}
        <div className="t-precio">{formatearPesos(prod.precio)} <small>por unidad</small></div>
        {bulto ? <div className="t-bulto">{bulto}</div> : null}
        {precioBultoTxt ? <div className="t-bulto" data-testid="precio-bulto">{precioBultoTxt}</div> : null}
        <button type="button" className="t-btn t-btn-primario" disabled={!ok} onClick={() => onAgregar(prod)}>
          {ok ? 'Agregar' : 'Sin stock'}
        </button>
      </div>
    </article>
  );
};

export default TarjetaProducto;
