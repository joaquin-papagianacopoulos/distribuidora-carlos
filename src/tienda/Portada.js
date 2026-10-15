// src/tienda/Portada.js — REQ-POR (AC-POR-1): banners rotativos, fila de Ofertas,
// filas de Destacados por rubro y acceso a todos los rubros. Solo presentación:
// recibe la portada ya armada (domain/tiendaPortada.armarPortada). La usa también
// la vista previa de Configuración → Tienda (AC-POR-5), por eso no toca Supabase.
import React, { useEffect, useState } from 'react';
import { destinoHref, linkWhatsapp } from '../domain/tiendaPortada';
import { filtrosAQuery } from '../domain/tienda';
import TarjetaProducto, { imagenSegura } from './TarjetaProducto';

export const ROTACION_MS = 6000;

const Banners = ({ banners, navegar, token }) => {
  const [i, setI] = useState(0);
  const n = banners.length;
  useEffect(() => {
    if (n < 2) return undefined;
    const t = setInterval(() => setI(x => (x + 1) % n), ROTACION_MS);
    return () => clearInterval(t);
  }, [n]);
  if (n === 0) return null;
  const actual = banners[Math.min(i, n - 1)];
  const href = destinoHref(actual.destino, token);
  const img = imagenSegura(actual.imagen);
  return (
    <section className="t-banners" aria-label="Novedades" data-testid="banners">
      <a className="t-banner" href={href} onClick={(e) => { e.preventDefault(); navegar(href); }} data-testid="banner-actual">
        {img ? <img src={img} alt="" /> : null}
        {actual.titulo || actual.subtitulo ? (
          <span className="t-banner-texto">
            {actual.titulo ? <strong>{actual.titulo}</strong> : null}
            {actual.subtitulo ? <span>{actual.subtitulo}</span> : null}
          </span>
        ) : null}
      </a>
      {n > 1 ? (
        <div className="t-banner-puntos">
          {banners.map((b, k) => (
            <button key={k} type="button" aria-label={`Ver banner ${k + 1}`} aria-current={k === i}
              className={k === i ? 'activo' : ''} onClick={() => setI(k)} />
          ))}
        </div>
      ) : null}
    </section>
  );
};

const Fila = ({ titulo, productos, verMas, permitirSinStock, onAgregar, navegar, search, testid }) => (
  <section className="t-fila" data-testid={testid}>
    <div className="t-fila-cab">
      <h2>{titulo}</h2>
      {verMas ? <a href={verMas} onClick={(e) => { e.preventDefault(); navegar(verMas); }}>Ver todo</a> : null}
    </div>
    <div className="t-fila-scroll">
      {productos.map(p => (
        <TarjetaProducto key={p.id} prod={p} permitirSinStock={permitirSinStock} onAgregar={onAgregar} navegar={navegar} search={search} />
      ))}
    </div>
  </section>
);

export const Pie = ({ config }) => {
  const c = config || {};
  const wa = linkWhatsapp(c.whatsapp);
  if (!c.contacto && !wa) return null;
  return (
    <footer className="t-pie" data-testid="pie-tienda">
      {c.contacto ? <p>{c.contacto}</p> : null}
      {wa ? <a href={wa} target="_blank" rel="noopener noreferrer">WhatsApp: {c.whatsapp}</a> : null}
    </footer>
  );
};

const Portada = ({ portada, permitirSinStock = false, onAgregar, navegar, token = '' }) => {
  const { config = {}, banners = [], ofertas = [], destacados = [], rubros = [] } = portada || {};
  const search = token ? `?v=${encodeURIComponent(token)}` : '';
  const vacia = !config.bienvenida && banners.length === 0 && ofertas.length === 0 && destacados.length === 0 && rubros.length === 0;
  if (vacia) return null;
  return (
    <div className="t-portada" data-testid="portada">
      <Banners banners={banners} navegar={navegar} token={token} />
      <div className="t-main">
        {config.bienvenida ? <p className="t-bienvenida">{config.bienvenida}</p> : null}
        {ofertas.length ? (
          <Fila titulo="Ofertas" productos={ofertas} verMas={destinoHref({ tipo: 'ofertas' }, token)} testid="fila-ofertas"
            permitirSinStock={permitirSinStock} onAgregar={onAgregar} navegar={navegar} search={search} />
        ) : null}
        {destacados.map(f => (
          <Fila key={f.rubro} titulo={f.rubro} productos={f.productos} verMas={destinoHref({ tipo: 'rubro', valor: f.rubro }, token)}
            testid="fila-destacados" permitirSinStock={permitirSinStock} onAgregar={onAgregar} navegar={navegar} search={search} />
        ))}
        {rubros.length ? (
          <nav className="t-rubros" aria-label="Rubros" data-testid="rubros">
            {rubros.map(r => {
              const href = `/tienda${filtrosAQuery({ v: token, rubros: [r.rubro] })}`;
              return (
                <a key={r.rubro} href={href} onClick={(e) => { e.preventDefault(); navegar(href); }}>
                  {r.rubro} <small>({r.cantidad})</small>
                </a>
              );
            })}
          </nav>
        ) : null}
      </div>
    </div>
  );
};

export default Portada;
