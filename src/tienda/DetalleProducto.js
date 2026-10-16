// src/tienda/DetalleProducto.js — AC-TIE-8 y AC-TIE-9: detalle compartible con selector de cantidad.
import React, { useState } from 'react';
import {
  formatearPesos, textoBulto, textoEquivalencia, unidadesIniciales, pasoUnidades, minimoDe, textoPrecioBulto, precioUnitarioTienda, porcentajeOff,
} from '../domain/tienda';
import { ventaPorEfectivo, normalizarBultoNombre } from '../domain/unidadVenta';
import { normalizarBultoX } from '../domain/bultos';
import TarjetaProducto, { imagenSegura, puedeAgregar } from './TarjetaProducto';
import { Encabezado } from './Catalogo';

const DetalleProducto = ({ prod, productos, config, onAgregar, navegar, cantidadCarrito, search, nombreTienda }) => {
  const [modo, setModo] = useState(() => (ventaPorEfectivo(prod || {}) === 'bulto' ? 'bulto' : 'unidad'));
  const [unidades, setUnidades] = useState(() => (prod ? unidadesIniciales(prod) : 1));

  if (!prod) {
    return (
      <div className="t-pagina">
        <Encabezado cantidadCarrito={cantidadCarrito} navegar={navegar} search={search} nombreTienda={nombreTienda} />
        <main className="t-main"><p>Ese producto ya no está disponible.</p>
          <a href="/tienda" onClick={(e) => { e.preventDefault(); navegar(`/tienda${search}`); }}>Volver a la tienda</a></main>
      </div>
    );
  }

  const vp = ventaPorEfectivo(prod);
  const bx = normalizarBultoX(prod.bultoX);
  const nombreBulto = normalizarBultoNombre(prod.bultoNombre);
  const paso = pasoUnidades(prod, modo);
  const min = minimoDe(prod);
  const ok = puedeAgregar(prod, config.permitirSinStock);
  const img = imagenSegura(prod.imagen);
  const bulto = textoBulto(prod);
  const precioBultoTxt = textoPrecioBulto(prod);
  const relacionados = productos.filter(p => p.rubro && p.rubro === prod.rubro && String(p.id) !== String(prod.id)).slice(0, 4);

  const mas = () => setUnidades(u => u + paso);
  const menos = () => setUnidades(u => Math.max(Math.max(min, paso), u - paso));
  const elegirModo = (m) => { setModo(m); setUnidades(m === 'bulto' && bx ? Math.max(bx, min) : Math.max(1, min)); };

  return (
    <div className="t-pagina">
      <Encabezado cantidadCarrito={cantidadCarrito} navegar={navegar} search={search} nombreTienda={nombreTienda} />
      <main className="t-main t-detalle">
        <a href="/tienda" className="t-volver" onClick={(e) => { e.preventDefault(); navegar(`/tienda${search}`); }}>Volver</a>
        <div className="t-detalle-img">{img ? <img src={img} alt={prod.nombre} /> : <span className="t-placeholder">Sin foto</span>}</div>
        <div className="t-detalle-datos t-panel">
          {prod.marca ? <div className="t-marca">{prod.marca}</div> : null}
          <h1>{prod.nombre}</h1>
          {prod.codigo ? <div className="t-codigo">Código {prod.codigo}</div> : null}
          {prod.rubro ? <div className="t-codigo">Rubro {prod.rubro}</div> : null}
          {prod.precioAnterior ? <s className="t-precio-anterior">{formatearPesos(prod.precioAnterior)}</s> : null}
          <div className="t-precio t-precio-grande">
            {formatearPesos(prod.precio)} <small>por unidad</small>
            {porcentajeOff(prod) ? <span className="t-off">{porcentajeOff(prod)}% OFF</span> : null}
          </div>
          {bulto ? <div className="t-bulto">{bulto}</div> : null}
          {precioBultoTxt ? <div className="t-bulto" data-testid="precio-bulto">{precioBultoTxt}</div> : null}
          {min > 1 ? <div className="t-aviso">Compra mínima: {min} u.</div> : null}

          {vp === 'ambos' ? (
            <div className="t-modo" role="group" aria-label="Comprar por">
              <label><input type="radio" name="modo" checked={modo === 'unidad'} onChange={() => elegirModo('unidad')} /> Unidad</label>
              <label><input type="radio" name="modo" checked={modo === 'bulto'} onChange={() => elegirModo('bulto')} /> {nombreBulto} x{bx}</label>
            </div>
          ) : null}
          {vp === 'bulto' ? <div className="t-aviso">Se vende por {nombreBulto} de {bx} u.</div> : null}

          <div className="t-cantidad t-pildora">
            <button type="button" aria-label="Menos" onClick={menos}>−</button>
            <span data-testid="cantidad-detalle">{textoEquivalencia(unidades, prod)}</span>
            <button type="button" aria-label="Más" onClick={mas}>+</button>
          </div>
          <div className="t-subtotal">Subtotal {formatearPesos(Math.round(precioUnitarioTienda(prod, unidades) * 100) * unidades / 100)}</div>
          <button type="button" className="t-btn t-btn-primario t-btn-ancho" disabled={!ok} onClick={(e) => onAgregar(prod, unidades, vp === 'bulto' ? 'bulto' : modo, e.currentTarget)}>
            {ok ? 'Agregar al carrito' : 'Sin stock'}
          </button>
        </div>
        {relacionados.length ? (
          <section className="t-relacionados">
            <h2>Más de {prod.rubro}</h2>
            <div className="t-grilla">
              {relacionados.map((p, i) => (
                <TarjetaProducto key={p.id} indice={i} prod={p} permitirSinStock={config.permitirSinStock} onAgregar={onAgregar} navegar={navegar} search={search} />
              ))}
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
};

export default DetalleProducto;
