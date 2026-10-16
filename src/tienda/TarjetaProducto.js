// src/tienda/TarjetaProducto.js — AC-TIE-7: tarjeta del catálogo.
import React from 'react';
import { formatearPesos, textoBulto, textoPrecioBulto, hrefTienda, porcentajeOff } from '../domain/tienda';

// Solo se muestran imágenes https (SEC-POR-7: sin contenido mixto): nada de http, javascript: ni data:.
export const imagenSegura = (url) => (typeof url === 'string' && /^https:\/\//i.test(url) ? url : null);

export const puedeAgregar = (prod, permitirSinStock) => !!prod.disponible || !!permitirSinStock;

// Las primeras tarjetas entran escalonadas; después de la 12 ya no se nota y se evita el retraso.
const MAX_ESCALON = 12;

const TarjetaProducto = ({ prod, permitirSinStock = false, onAgregar, navegar, search = '', indice = 0 }) => {
  const img = imagenSegura(prod.imagen);
  const bulto = textoBulto(prod);
  const precioBultoTxt = textoPrecioBulto(prod);
  const off = porcentajeOff(prod);
  const ok = puedeAgregar(prod, permitirSinStock);
  const href = hrefTienda('producto', { id: prod.id, search });
  const ir = (e) => { e.preventDefault(); navegar(href); };
  return (
    <article className="t-card" data-testid="tarjeta-producto" style={{ '--i': Math.min(indice, MAX_ESCALON) }}>
      <a className="t-card-img" href={href} onClick={ir} tabIndex={-1} aria-hidden="true">
        {img ? <img src={img} alt="" loading="lazy" /> : <span className="t-placeholder">Sin foto</span>}
        {off ? <span className="t-sello-oferta">Oferta</span> : null}
      </a>
      <div className="t-card-body">
        <a className="t-nombre" href={href} onClick={ir}>{prod.nombre}</a>
        {prod.marca ? <div className="t-marca">{prod.marca}</div> : null}
        {prod.precioAnterior ? <s className="t-precio-anterior" data-testid="precio-anterior">{formatearPesos(prod.precioAnterior)}</s> : null}
        <div className="t-precio">
          {formatearPesos(prod.precio)} <small>por unidad</small>
          {off ? <span className="t-off">{off}% OFF</span> : null}
        </div>
        {bulto ? <div className="t-bulto">{bulto}</div> : null}
        {precioBultoTxt ? <div className="t-bulto t-bulto-ahorro" data-testid="precio-bulto">{precioBultoTxt}</div> : null}
        <button type="button" className="t-btn t-btn-primario" disabled={!ok} onClick={(e) => onAgregar(prod, undefined, undefined, e.currentTarget)}>
          {ok ? 'Agregar' : 'Sin stock'}
        </button>
      </div>
    </article>
  );
};

export default TarjetaProducto;
