// src/tienda/Carrito.js — AC-TIE-9/10: renglones con foto, cambiar cantidad, quitar y total,
// más sugerencias de productos de los mismos rubros que el cliente todavía no eligió.
import React, { useMemo } from 'react';
import {
  calcularCarrito, formatearPesos, textoEquivalencia, pasoUnidades, minimoDe, hrefTienda, sugerenciasCarrito, porcentajeOff,
} from '../domain/tienda';
import { Encabezado } from './Catalogo';
import { imagenSegura, puedeAgregar } from './TarjetaProducto';

const hoyLocalISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Cálculo del carrito con las reglas de dominio (las mismas que aplica el servidor).
export const armarCalculo = (lineas, catalogoById, config) =>
  calcularCarrito(
    lineas.map(l => ({ productoId: l.productoId, cantidad: l.unidades, modo: 'unidad' })),
    catalogoById,
    { permitirSinStock: !!config.permitirSinStock },
    hoyLocalISO(),
  );

export const MAX_SUGERENCIAS = 8;

const Foto = ({ prod, href, navegar }) => {
  const img = prod ? imagenSegura(prod.imagen) : null;
  const contenido = img ? <img src={img} alt="" loading="lazy" /> : <span className="t-placeholder">Sin foto</span>;
  if (!prod) return <div className="t-linea-foto">{contenido}</div>;
  return (
    <a className="t-linea-foto" href={href} tabIndex={-1} aria-hidden="true" onClick={(e) => { e.preventDefault(); navegar(href); }}>
      {contenido}
    </a>
  );
};

// Fila "Sumá a tu pedido": tarjetas compactas con agregado rápido.
const Sugerencias = ({ productos, rubroUnico, config, onAgregar, navegar, search }) => {
  if (!productos.length) return null;
  return (
    <section className="t-sugerencias" aria-labelledby="t-sug-titulo" data-testid="sugerencias-carrito">
      <h2 id="t-sug-titulo">{rubroUnico ? `Sumá más de ${rubroUnico}` : 'Sumá a tu pedido'}</h2>
      <div className="t-sugerencias-fila">
        {productos.map((p, i) => {
          const href = hrefTienda('producto', { id: p.id, search });
          const img = imagenSegura(p.imagen);
          const off = porcentajeOff(p);
          return (
            <article key={p.id} className="t-sugerencia" data-testid="sugerencia" style={{ '--i': i }}>
              <a className="t-sugerencia-img" href={href} tabIndex={-1} aria-hidden="true" onClick={(e) => { e.preventDefault(); navegar(href); }}>
                {img ? <img src={img} alt="" loading="lazy" /> : <span className="t-placeholder">Sin foto</span>}
              </a>
              <a className="t-sugerencia-nombre" href={href} onClick={(e) => { e.preventDefault(); navegar(href); }}>{p.nombre}</a>
              <div className="t-sugerencia-precio">
                {formatearPesos(p.precio)}{off ? <span className="t-off">{off}% OFF</span> : null}
              </div>
              <button type="button" className="t-btn t-btn-suave" disabled={!puedeAgregar(p, config.permitirSinStock)}
                aria-label={`Agregar ${p.nombre}`} onClick={(e) => onAgregar(p, undefined, undefined, e.currentTarget)}>
                Agregar
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
};

const Carrito = ({ lineas, catalogoById, productos = [], config, onCambiar, onQuitar, onAgregar = () => {}, navegar, search, cantidadCarrito, nombreTienda }) => {
  const calc = armarCalculo(lineas, catalogoById, config);
  const errPorId = new Map();
  for (const e of calc.errores) {
    if (e.productoId === null) continue;
    errPorId.set(String(e.productoId), [...(errPorId.get(String(e.productoId)) || []), e.mensaje]);
  }
  const erroresGenerales = calc.errores.filter(e => e.productoId === null);
  const puedeContinuar = lineas.length > 0 && calc.errores.length === 0;

  const sugeridos = useMemo(
    () => sugerenciasCarrito(lineas, productos, { max: MAX_SUGERENCIAS, permitirSinStock: !!config.permitirSinStock }),
    [lineas, productos, config.permitirSinStock],
  );
  const rubrosCarrito = new Set(lineas.map(l => catalogoById.get(String(l.productoId))).filter(Boolean).map(p => p.rubro).filter(Boolean));
  const rubroUnico = rubrosCarrito.size === 1 ? Array.from(rubrosCarrito)[0] : '';

  return (
    <div className="t-pagina">
      <Encabezado cantidadCarrito={cantidadCarrito} navegar={navegar} search={search} nombreTienda={nombreTienda} />
      <main className="t-main t-carrito">
        <h1>Tu carrito</h1>
        {lineas.length === 0 ? (
          <div className="t-vacio">
            <p>Todavía no agregaste productos.</p>
            <a className="t-btn t-btn-primario" href="/tienda" onClick={(e) => { e.preventDefault(); navegar(`/tienda${search}`); }}>Ver la tienda</a>
          </div>
        ) : (
          <div className="t-carrito-cuerpo">
            <section className="t-panel">
              <ul className="t-lineas">
                {lineas.map(l => {
                  const prod = catalogoById.get(String(l.productoId));
                  const ren = calc.renglones.find(r => String(r.productoId) === String(l.productoId));
                  const errs = errPorId.get(String(l.productoId)) || [];
                  const paso = prod ? pasoUnidades(prod, l.modo) : 1;
                  const min = prod ? minimoDe(prod) : 1;
                  const href = prod ? hrefTienda('producto', { id: prod.id, search }) : '';
                  return (
                    <li key={l.productoId} className="t-linea" data-testid="linea-carrito">
                      <Foto prod={prod} href={href} navegar={navegar} />
                      <div className="t-linea-info">
                        {prod ? (
                          <a className="t-linea-nombre" href={href} onClick={(e) => { e.preventDefault(); navegar(href); }}>{prod.nombre}</a>
                        ) : <div className="t-linea-nombre">Producto no disponible</div>}
                        {prod ? (
                          <div className="t-linea-detalle">
                            {textoEquivalencia(l.unidades, prod)} · {formatearPesos(ren ? ren.precio : prod.precio)} c/u
                          </div>
                        ) : null}
                        {errs.map(m => <div key={m} role="alert" className="t-error">{m}</div>)}
                        <button type="button" className="t-btn t-btn-link" onClick={() => onQuitar(l.productoId)}>Quitar</button>
                      </div>
                      {prod ? (
                        <div className="t-linea-montos">
                          <div className="t-cantidad t-pildora">
                            <button type="button" aria-label={`Menos ${prod.nombre}`}
                              onClick={() => onCambiar(l.productoId, Math.max(Math.max(min, paso), l.unidades - paso), prod)}>−</button>
                            <span key={l.unidades} className="t-cantidad-valor">{l.unidades} u.</span>
                            <button type="button" aria-label={`Más ${prod.nombre}`}
                              onClick={() => onCambiar(l.productoId, l.unidades + paso, prod)}>+</button>
                          </div>
                          <div className="t-subtotal">{ren ? formatearPesos(ren.subtotal) : ''}</div>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
            <aside className="t-panel t-resumen" aria-label="Resumen de compra">
              <h2>Resumen de compra</h2>
              <div className="t-resumen-fila"><span>Productos ({lineas.length})</span><span>{calc.totalUnidades} u.</span></div>
              {erroresGenerales.map(e => <div key={e.mensaje} role="alert" className="t-error">{e.mensaje}</div>)}
              <div className="t-total">
                <strong data-testid="total-carrito">Total {formatearPesos(calc.total)}</strong>
              </div>
              <button type="button" className="t-btn t-btn-primario t-btn-ancho" disabled={!puedeContinuar}
                onClick={() => navegar(`/tienda/checkout${search}`)}>Continuar</button>
            </aside>
          </div>
        )}
        <Sugerencias productos={sugeridos} rubroUnico={rubroUnico} config={config} onAgregar={onAgregar} navegar={navegar} search={search} />
      </main>
    </div>
  );
};

export default Carrito;
