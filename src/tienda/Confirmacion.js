// src/tienda/Confirmacion.js — AC-TIE-14: número de pedido, resumen y total.
import React from 'react';
import { formatearPesos } from '../domain/tienda';
import { Encabezado } from './Catalogo';

const Confirmacion = ({ resultado, navegar, search, cantidadCarrito, nombreTienda }) => (
  <div className="t-pagina">
    <Encabezado cantidadCarrito={cantidadCarrito} navegar={navegar} search={search} nombreTienda={nombreTienda} />
    <main className="t-main t-confirmacion">
      {resultado ? (
        <>
          <h1>¡Recibimos tu pedido!</h1>
          <p>Número de pedido: <strong data-testid="numero-pedido">{String(resultado.pedidoId)}</strong></p>
          <p>Te vamos a contactar para coordinar la entrega.</p>
          <ul className="t-lineas">
            {(resultado.renglones || []).map(r => (
              <li key={String(r.productoId)} className="t-linea">
                {r.nombre} · {r.cantidad} u. · {formatearPesos(r.subtotal)}
              </li>
            ))}
          </ul>
          <p className="t-total"><strong data-testid="total-confirmacion">Total {formatearPesos(resultado.total)}</strong></p>
        </>
      ) : (
        <p>No hay un pedido para mostrar.</p>
      )}
      <a className="t-btn t-btn-sec" href="/tienda" onClick={(e) => { e.preventDefault(); navegar(`/tienda${search}`); }}>Seguir comprando</a>
    </main>
  </div>
);

export default Confirmacion;
