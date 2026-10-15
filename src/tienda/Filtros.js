// src/tienda/Filtros.js — AC-TIE-6: filtros por rubro y marca con contador y orden.
// En celular van dentro de un panel desplegable (botón "Filtros").
import React from 'react';

const alternar = (lista, valor) => (lista.includes(valor) ? lista.filter(x => x !== valor) : [...lista, valor]);

const Grupo = ({ titulo, contadores, seleccion, onCambio, nombre }) => {
  // Se muestran también los seleccionados que quedaron en 0 para poder destildarlos.
  const claves = Array.from(new Set([...Object.keys(contadores), ...seleccion])).sort((a, b) => a.localeCompare(b, 'es'));
  if (claves.length === 0) return null;
  return (
    <fieldset className="t-grupo">
      <legend>{titulo}</legend>
      {claves.map(k => (
        <label key={k} className="t-check">
          <input type="checkbox" name={nombre} checked={seleccion.includes(k)} onChange={() => onCambio(alternar(seleccion, k))} />
          <span>{k}</span> <small>({contadores[k] || 0})</small>
        </label>
      ))}
    </fieldset>
  );
};

const Filtros = ({ filtros, contadores, abierto, onToggle, onCambio, cantidad }) => {
  const activos = filtros.rubros.length + filtros.marcas.length;
  return (
    <section className="t-filtros" aria-label="Filtros">
      <button type="button" className="t-btn t-btn-sec t-filtros-toggle" aria-expanded={abierto} onClick={onToggle}>
        Filtros{activos ? ` (${activos})` : ''}
      </button>
      <div className={`t-filtros-panel${abierto ? ' abierto' : ''}`} data-testid="panel-filtros">
        <label className="t-orden">
          Ordenar por{' '}
          <select value={filtros.orden} onChange={e => onCambio({ ...filtros, orden: e.target.value })} aria-label="Ordenar por">
            <option value="relevancia">Relevancia</option>
            <option value="precio_asc">Precio: menor a mayor</option>
            <option value="precio_desc">Precio: mayor a menor</option>
            <option value="nombre">Nombre</option>
          </select>
        </label>
        <Grupo titulo="Rubro" nombre="rubro" contadores={contadores.rubros} seleccion={filtros.rubros} onCambio={(rubros) => onCambio({ ...filtros, rubros })} />
        <Grupo titulo="Marca" nombre="marca" contadores={contadores.marcas} seleccion={filtros.marcas} onCambio={(marcas) => onCambio({ ...filtros, marcas })} />
        {activos > 0 ? (
          <button type="button" className="t-btn t-btn-sec" onClick={() => onCambio({ ...filtros, rubros: [], marcas: [] })}>
            Quitar filtros ({cantidad} resultados)
          </button>
        ) : null}
      </div>
    </section>
  );
};

export default Filtros;
