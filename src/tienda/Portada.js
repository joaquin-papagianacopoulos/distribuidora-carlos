// src/tienda/Portada.js — REQ-POR (AC-POR-1): banners rotativos, fila de Ofertas,
// filas de Destacados por rubro y acceso a todos los rubros. Solo presentación:
// recibe la portada ya armada (domain/tiendaPortada.armarPortada). La usa también
// la vista previa de Configuración → Tienda (AC-POR-5), por eso no toca Supabase.
import React, { useEffect, useState } from 'react';
import { destinoHref, linkWhatsapp } from '../domain/tiendaPortada';
import { filtrosAQuery } from '../domain/tienda';
import TarjetaProducto, { imagenSegura } from './TarjetaProducto';
import { IconoFlecha } from './ui';

export const ROTACION_MS = 6000;

const Banners = ({ banners, navegar, token }) => {
  const [i, setI] = useState(0);
  const [pausa, setPausa] = useState(false);
  const n = banners.length;
  useEffect(() => {
    if (n < 2 || pausa) return undefined;
    const t = setInterval(() => setI(x => (x + 1) % n), ROTACION_MS);
    return () => clearInterval(t);
  }, [n, pausa]);
  if (n === 0) return null;
  const actual = Math.min(i, n - 1);
  const mover = (d) => setI(x => (x + d + n) % n);
  return (
    <section className="t-hero" aria-label="Novedades" data-testid="banners"
      onMouseEnter={() => setPausa(true)} onMouseLeave={() => setPausa(false)}
      onFocus={() => setPausa(true)} onBlur={() => setPausa(false)}>
      <div className="t-banners">
        <div className="t-banners-pista" style={{ transform: `translateX(-${actual * 100}%)` }}>
          {banners.map((b, k) => {
            const href = destinoHref(b.destino, token);
            const img = imagenSegura(b.imagen);
            const visible = k === actual;
            return (
              <a key={k} className={`t-banner${visible ? ' activo' : ''}`} href={href} tabIndex={visible ? 0 : -1} aria-hidden={!visible}
                onClick={(e) => { e.preventDefault(); navegar(href); }} {...(visible ? { 'data-testid': 'banner-actual' } : {})}>
                {img ? <img src={img} alt="" /> : null}
                {b.titulo || b.subtitulo ? (
                  <span className="t-banner-texto">
                    {b.titulo ? <strong>{b.titulo}</strong> : null}
                    {b.subtitulo ? <span>{b.subtitulo}</span> : null}
                  </span>
                ) : null}
              </a>
            );
          })}
        </div>
        {n > 1 ? (
          <>
            <button type="button" className="t-banner-flecha izq" aria-label="Banner anterior" onClick={() => mover(-1)}><IconoFlecha izquierda /></button>
            <button type="button" className="t-banner-flecha der" aria-label="Banner siguiente" onClick={() => mover(1)}><IconoFlecha /></button>
            <div className="t-banner-puntos">
              {banners.map((b, k) => (
                <button key={k} type="button" aria-label={`Ver banner ${k + 1}`} aria-current={k === actual}
                  className={k === actual ? 'activo' : ''} onClick={() => setI(k)} />
              ))}
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
};

const Fila = ({ titulo, productos, verMas, permitirSinStock, onAgregar, navegar, search, testid }) => (
  <section className="t-fila t-panel" data-testid={testid}>
    <div className="t-fila-cab">
      <h2>{titulo}</h2>
      {verMas ? <a href={verMas} onClick={(e) => { e.preventDefault(); navegar(verMas); }}>Ver todo</a> : null}
    </div>
    <div className="t-fila-scroll">
      {productos.map((p, i) => (
        <TarjetaProducto key={p.id} indice={i} prod={p} permitirSinStock={permitirSinStock} onAgregar={onAgregar} navegar={navegar} search={search} />
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
