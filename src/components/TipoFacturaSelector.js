// src/components/TipoFacturaSelector.js — REQ-FAB (AC-FAB-1, AC-FAB-2).
// Selector "Factura A / Factura B / Sin factura" de un pedido. Si el pedido no tiene un
// tipo confirmado se muestra la sugerencia segun el IVA del cliente (con boton para
// confirmarla). Factura A con cliente sin CUIT valido muestra un aviso; no bloquea.
import React from 'react';
import { TIPOS_FACTURA, ETIQUETA_TIPO_FACTURA, tipoFacturaEfectivo, avisoFacturaA } from '../domain/facturacionAB';

const TipoFacturaSelector = ({ pedido, cliente, onChange, disabled = false }) => {
  const { tipo, sugerido } = tipoFacturaEfectivo(pedido, cliente);
  const aviso = avisoFacturaA(tipo, cliente);
  return (
    <div data-testid="tipo-factura" style={{ margin: '8px 0' }} onClick={e => e.stopPropagation()}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <label className="input-label" style={{ margin: 0 }} htmlFor={`tipo-factura-${pedido?.id}`}>Factura</label>
        <select
          id={`tipo-factura-${pedido?.id}`}
          className="input"
          style={{ width: 'auto', minWidth: 140 }}
          value={tipo}
          disabled={disabled}
          onChange={e => onChange && onChange(e.target.value)}
          aria-label="Tipo de factura"
        >
          {TIPOS_FACTURA.map(t => <option key={t} value={t}>{ETIQUETA_TIPO_FACTURA[t]}</option>)}
        </select>
        {sugerido && (
          <>
            <span style={{ fontSize: 12, color: 'var(--text3)' }}>(sugerido por el IVA del cliente)</span>
            <button type="button" className="btn btn-ghost btn-sm" style={{ width: 'auto' }} disabled={disabled} onClick={() => onChange && onChange(tipo)}>
              Confirmar
            </button>
          </>
        )}
      </div>
      {aviso && (
        <div data-testid="aviso-factura-a" role="alert" style={{ marginTop: 6, fontSize: 13, color: 'var(--warning)', fontWeight: 700 }}>
          {aviso}
        </div>
      )}
    </div>
  );
};

export default TipoFacturaSelector;
