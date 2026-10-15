// src/tienda/Checkout.js — AC-TIE-12/13/14: datos de entrega y confirmación contra el servidor.
import React, { useRef, useState } from 'react';
import {
  validarCheckout, armarPayloadPedido, formatearPesos, textoEquivalencia, CAMPOS_CHECKOUT, MAX_OBSERVACIONES,
} from '../domain/tienda';
import { PROVINCIAS } from '../domain/clientes';
import { nuevoId } from '../domain/validacion';
import { tokenParaPedido } from '../domain/tiendaLinks';
import { Encabezado } from './Catalogo';
import { armarCalculo } from './Carrito';
import { CLAVE_CONTACTO, leerStorage, escribirStorage } from './useCarrito';

const ETIQUETAS = {
  nombre: 'Nombre o razón social *', telefono: 'Teléfono / WhatsApp *', direccion: 'Dirección de entrega *',
  ciudad: 'Ciudad *', cp: 'Código postal', provincia: 'Provincia', cuit: 'CUIT (opcional)', observaciones: 'Observaciones',
};

const contactoGuardado = () => {
  const vacio = Object.fromEntries(CAMPOS_CHECKOUT.map(k => [k, '']));
  try {
    const o = JSON.parse(leerStorage(CLAVE_CONTACTO) || 'null');
    if (o && typeof o === 'object') for (const k of CAMPOS_CHECKOUT) if (typeof o[k] === 'string') vacio[k] = o[k];
  } catch { /* datos viejos o rotos: se ignoran */ }
  return vacio;
};

const Checkout = ({ lineas, catalogoById, config, token, crearPedido, onExito, onCarritoCorregido, navegar, search, cantidadCarrito, nombreTienda }) => {
  const [valores, setValores] = useState(contactoGuardado);
  const [hp, setHp] = useState('');
  const [errores, setErrores] = useState({});
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  const [corregido, setCorregido] = useState(null);
  const idem = useRef(nuevoId());

  const calc = armarCalculo(lineas, catalogoById, config);
  const cambiar = (k, v) => { setValores(p => ({ ...p, [k]: v })); setErrores(p => ({ ...p, [k]: undefined })); };

  const enviar = async (e) => {
    e.preventDefault();
    if (enviando) return;
    setError('');
    const v = validarCheckout(valores);
    if (!v.ok) { setErrores(v.errores); return; }
    if (lineas.length === 0 || calc.errores.length > 0) { setError('Revisá tu carrito antes de confirmar.'); return; }
    escribirStorage(CLAVE_CONTACTO, JSON.stringify(v.datos));
    setEnviando(true);
    try {
      const payload = armarPayloadPedido({ lineas }, { ...v.datos, hp }, tokenParaPedido(token), idem.current);
      const r = await crearPedido(payload);
      if (r.ok) { onExito(r); return; }
      if (r.motivo === 'cambio' && r.carrito) { setCorregido(r.carrito); return; }
      setError(r.mensaje || 'No pudimos procesar el pedido.');
    } finally {
      setEnviando(false);
    }
  };

  const aceptarCambios = () => {
    onCarritoCorregido(corregido);
    idem.current = nuevoId(); // el carrito cambió: es un pedido nuevo para el servidor
    setCorregido(null);
    navegar(`/tienda/carrito${search}`);
  };

  return (
    <div className="t-pagina">
      <Encabezado cantidadCarrito={cantidadCarrito} navegar={navegar} search={search} nombreTienda={nombreTienda} />
      <main className="t-main t-checkout">
        <h1>Confirmá tu pedido</h1>
        <p className="t-total"><strong data-testid="total-checkout">Total {formatearPesos(calc.total)}</strong> · {calc.totalUnidades} u.</p>
        {corregido ? (
          <div role="alert" className="t-aviso" data-testid="carrito-corregido">
            <strong>Cambiaron algunos precios o la disponibilidad.</strong>
            <ul>
              {corregido.renglones.map(r => {
                const p = catalogoById.get(String(r.productoId));
                return <li key={r.productoId}>{p ? p.nombre : 'Producto'}: {textoEquivalencia(r.unidades, p || {})} a {formatearPesos(r.precio)} c/u{r.disponible ? '' : ' (sin stock)'}</li>;
              })}
            </ul>
            <div>Nuevo total {formatearPesos(corregido.total)}</div>
            <button type="button" className="t-btn t-btn-primario" onClick={aceptarCambios}>Ver el carrito corregido</button>
          </div>
        ) : null}
        <form onSubmit={enviar} noValidate>
          {CAMPOS_CHECKOUT.map(k => (
            <div className="t-campo" key={k}>
              <label htmlFor={`co-${k}`}>{ETIQUETAS[k]}</label>
              {k === 'provincia' ? (
                <select id={`co-${k}`} value={valores[k]} onChange={e => cambiar(k, e.target.value)}>
                  <option value="">Elegí una provincia</option>
                  {PROVINCIAS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              ) : k === 'observaciones' ? (
                <textarea id={`co-${k}`} value={valores[k]} maxLength={MAX_OBSERVACIONES + 100} rows={3} onChange={e => cambiar(k, e.target.value)} />
              ) : (
                <input id={`co-${k}`} type={k === 'telefono' ? 'tel' : 'text'} value={valores[k]} onChange={e => cambiar(k, e.target.value)}
                  autoComplete={k === 'telefono' ? 'tel' : undefined} />
              )}
              {errores[k] ? <div role="alert" className="t-error" data-testid={`error-${k}`}>{errores[k]}</div> : null}
            </div>
          ))}
          {/* Campo trampa (honeypot): los clientes reales no lo ven ni lo completan. */}
          <div className="t-hp" aria-hidden="true">
            <label htmlFor="co-sitio">Sitio web</label>
            <input id="co-sitio" name="sitio_web" tabIndex={-1} autoComplete="off" value={hp} onChange={e => setHp(e.target.value)} />
          </div>
          {error ? <div role="alert" className="t-error" data-testid="error-envio">{error}</div> : null}
          <button type="submit" className="t-btn t-btn-primario" disabled={enviando}>{enviando ? 'Enviando...' : 'Confirmar pedido'}</button>
        </form>
      </main>
    </div>
  );
};

export default Checkout;
