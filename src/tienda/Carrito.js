// src/tienda/Carrito.js — AC-TIE-9/10: renglones, cambiar cantidad, quitar y total.
import React from 'react';
import { calcularCarrito, formatearPesos, textoEquivalencia, pasoUnidades, minimoDe } from '../domain/tienda';
import { Encabezado } from './Catalogo';

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

const Carrito = ({ lineas, catalogoById, config, onCambiar, onQuitar, navegar, search, cantidadCarrito, nombreTienda }) => {
  const calc = armarCalculo(lineas, catalogoById, config);
  const errPorId = new Map();
  for (const e of calc.errores) {
    if (e.productoId === null) continue;
    errPorId.set(String(e.productoId), [...(errPorId.get(String(e.productoId)) || []), e.mensaje]);
  }
  const erroresGenerales = calc.errores.filter(e => e.productoId === null);
  const puedeContinuar = lineas.length > 0 && calc.errores.length === 0;

  return (
    <div className="t-pagina">
      <Encabezado cantidadCarrito={cantidadCarrito} navegar={navegar} search={search} nombreTienda={nombreTienda} />
      <main className="t-main t-carrito">
        <h1>Tu carrito</h1>
        {lineas.length === 0 ? (
          <p>Todavía no agregaste productos. <a href="/tienda" onClick={(e) => { e.preventDefault(); navegar(`/tienda${search}`); }}>Ver la tienda</a></p>
        ) : null}
        <ul className="t-lineas">
          {lineas.map(l => {
            const prod = catalogoById.get(String(l.productoId));
            const ren = calc.renglones.find(r => String(r.productoId) === String(l.productoId));
            const errs = errPorId.get(String(l.productoId)) || [];
            const paso = prod ? pasoUnidades(prod, l.modo) : 1;
            const min = prod ? minimoDe(prod) : 1;
            return (
              <li key={l.productoId} className="t-linea" data-testid="linea-carrito">
                <div className="t-linea-nombre">{prod ? prod.nombre : 'Producto no disponible'}</div>
                {prod ? (
                  <>
                    <div className="t-linea-detalle">
                      {textoEquivalencia(l.unidades, prod)} · {formatearPesos(prod.precio)} c/u
                    </div>
                    <div className="t-cantidad">
                      <button type="button" className="t-btn t-btn-sec" aria-label={`Menos ${prod.nombre}`}
                        onClick={() => onCambiar(l.productoId, Math.max(Math.max(min, paso), l.unidades - paso), prod)}>-</button>
                      <span>{l.unidades} u.</span>
                      <button type="button" className="t-btn t-btn-sec" aria-label={`Más ${prod.nombre}`}
                        onClick={() => onCambiar(l.productoId, l.unidades + paso, prod)}>+</button>
                    </div>
                    <div className="t-subtotal">{ren ? formatearPesos(ren.subtotal) : ''}</div>
                  </>
                ) : null}
                {errs.map(m => <div key={m} role="alert" className="t-error">{m}</div>)}
                <button type="button" className="t-btn t-btn-link" onClick={() => onQuitar(l.productoId)}>Quitar</button>
              </li>
            );
          })}
        </ul>
        {erroresGenerales.map(e => <div key={e.mensaje} role="alert" className="t-error">{e.mensaje}</div>)}
        {lineas.length > 0 ? (
          <div className="t-total">
            <span>{calc.totalUnidades} u. en total</span>
            <strong data-testid="total-carrito">Total {formatearPesos(calc.total)}</strong>
          </div>
        ) : null}
        <button type="button" className="t-btn t-btn-primario" disabled={!puedeContinuar}
          onClick={() => navegar(`/tienda/checkout${search}`)}>Continuar</button>
      </main>
    </div>
  );
};

export default Carrito;
