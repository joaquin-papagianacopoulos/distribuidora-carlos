// src/components/SelectorRubro.js — REQ-COMR (AC-COMR-3, AC-COMR-4).
// "Rubro" del producto: selector con los rubros existentes (orden alfabético)
// + "Agregar rubro nuevo…", sin salir del formulario. Si el nombre nuevo ya
// existe (sin importar mayúsculas, tildes ni espacios) se usa el existente.
// La normalización y el dedupe son del dominio (src/domain/rubros.js).
import React, { useMemo, useState } from 'react';
import { listarRubros, resolverRubro, claveRubro, normalizarRubro } from '../domain/rubros';

export const OPCION_NUEVO = '__nuevo__';

// REQ-VTA (AC-VTA-1): se reutiliza para la Marca con `name`, `etiqueta` y `testId`
// (los defaults son los del Rubro, sin cambios para REQ-COMR).
const SelectorRubro = ({ id = 'campo-categoria', value = '', onChange, rubros = [], disabled = false, name = 'categoria', etiqueta = 'rubro', testId = 'selector-rubro', errorTestId = 'rubro-error', avisoTestId = 'rubro-aviso' }) => {
  const vacio = etiqueta === 'marca' ? '— Sin marca —' : '— Sin rubro —';
  const esMarca = etiqueta === 'marca';
  const textoNuevo = `Agregar ${etiqueta} nuev${esMarca ? 'a' : 'o'}…`;
  const [agregados, setAgregados] = useState([]);
  const [agregando, setAgregando] = useState(false);
  const [nuevo, setNuevo] = useState('');
  const [aviso, setAviso] = useState(null);
  const [error, setError] = useState(null);

  const actual = normalizarRubro(value);
  // Rubros existentes + los agregados en este formulario + el valor actual
  // (un producto viejo con un rubro que ya no usa nadie no lo pierde).
  const opciones = useMemo(() => listarRubros([], [...(rubros || []), ...agregados, ...(actual ? [actual] : [])]), [rubros, agregados, actual]);
  const seleccionado = actual ? (opciones.find(r => claveRubro(r) === claveRubro(actual)) || actual) : '';

  const elegir = (v) => {
    setAviso(null);
    if (v === OPCION_NUEVO) { setAgregando(true); setNuevo(''); setError(null); return; }
    setAgregando(false);
    onChange(v);
  };

  const usarNuevo = () => {
    const r = resolverRubro(nuevo, opciones);
    if (!r.rubro) { setError(`Escribí el nombre de${etiqueta === 'marca' ? ' la' : 'l'} ${etiqueta}`); return; }
    if (!r.esNuevo) setAviso(`Ya existe: se usa «${r.rubro}»`);
    else setAgregados(prev => [...prev, r.rubro]);
    setAgregando(false);
    setNuevo('');
    setError(null);
    onChange(r.rubro);
  };

  return (
    <div data-testid={testId}>
      <select
        id={id}
        name={name}
        className="input"
        value={agregando ? OPCION_NUEVO : seleccionado}
        onChange={e => elegir(e.target.value)}
        disabled={disabled}
      >
        <option value="">{vacio}</option>
        {opciones.map(r => <option key={claveRubro(r)} value={r}>{r}</option>)}
        <option value={OPCION_NUEVO}>{textoNuevo}</option>
      </select>
      {agregando && (
        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          <input
            id={`${id}-nuevo`}
            className="input"
            aria-label={`Nombre de${etiqueta === 'marca' ? ' la' : 'l'} ${etiqueta} nuev${etiqueta === 'marca' ? 'a' : 'o'}`}
            maxLength={60}
            autoComplete="off"
            value={nuevo}
            onChange={e => { setNuevo(e.target.value); setError(null); }}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); usarNuevo(); } }}
          />
          <button type="button" className="btn btn-primary btn-sm" style={{ width: 'auto' }} onClick={usarNuevo}>Usar</button>
          <button type="button" className="btn btn-ghost btn-sm" style={{ width: 'auto' }} onClick={() => { setAgregando(false); setError(null); }}>Cancelar</button>
        </div>
      )}
      {error && <div role="alert" data-testid={errorTestId} style={{ color: 'var(--danger)', fontSize: 12, marginTop: 4 }}>{error}</div>}
      {aviso && <div data-testid={avisoTestId} style={{ color: 'var(--text3)', fontSize: 12, marginTop: 4 }}>{aviso}</div>}
    </div>
  );
};

export default SelectorRubro;
