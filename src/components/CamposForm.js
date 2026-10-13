// src/components/CamposForm.js — render genérico de campos a partir de las
// definiciones del dominio (CAMPOS_CLIENTE, CAMPOS_PRODUCTO, CAMPOS_PROVEEDOR).
import React from 'react';

const errorStyle = { color: 'var(--danger)', fontSize: 12, marginTop: 4 };

const CamposForm = ({ campos, valores, errores = {}, onChange, opcionesDinamicas = {}, ayudas = {}, deshabilitados = {} }) => (
  <>
    {campos.map(c => {
      const id = `campo-${c.key}`;
      const val = valores[c.key] ?? '';
      const set = (v) => onChange(c.key, v);
      const opciones = c.opciones
        ? c.opciones.map(o => ({ value: o, label: o }))
        : opcionesDinamicas[c.tipo] || opcionesDinamicas[c.key] || null;
      let input;
      if (opciones) {
        input = (
          <select id={id} name={c.key} className="input" value={val} onChange={e => set(e.target.value)} disabled={!!deshabilitados[c.key]}>
            <option value="">— Elegir —</option>
            {opciones.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        );
      } else {
        input = (
          <input
            id={id}
            name={c.key}
            className="input"
            type={c.tipo === 'number' ? 'text' : (c.tipo || 'text')}
            inputMode={c.tipo === 'number' ? 'decimal' : (c.tipo === 'tel' ? 'tel' : undefined)}
            value={val}
            onChange={e => set(e.target.value)}
            disabled={!!deshabilitados[c.key]}
            autoComplete="off"
            aria-invalid={errores[c.key] ? 'true' : 'false'}
          />
        );
      }
      return (
        <div className="input-group" key={c.key}>
          <label className="input-label" htmlFor={id}>
            {c.label}{c.requerido ? ' *' : ''}{c.sufijo ? ` (${c.sufijo})` : ''}{c.prefijo ? ` (${c.prefijo})` : ''}
          </label>
          {input}
          {ayudas[c.key] && <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>{ayudas[c.key]}</div>}
          {errores[c.key] && <div role="alert" data-error-for={c.key} style={errorStyle}>{errores[c.key]}</div>}
        </div>
      );
    })}
  </>
);

export default CamposForm;
