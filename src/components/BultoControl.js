// src/components/BultoControl.js — botones "+ Bulto (x N)" / "− Bulto" y desglose (REQ-BUL).
// Presentacional: no calcula cantidades, solo dispara onSumar/onRestar.
// El cálculo vive en src/domain/bultos.js y en el handler del padre.
import React from 'react';
import { etiquetaBotonBulto, desgloseBultos, CANTIDAD_MINIMA_RENGLON } from '../domain/bultos';

// REQ-VTA (AC-VTA-3): `nombre` (Bulto/Display/Caja/Pack) y `precioBulto` (precio unitario × bultoX).
const BultoControl = ({ bultoX, cantidad, onSumar, onRestar, puedeRestar, visible = true, nombre = 'Bulto', precioBulto = null }) => {
  const etiqueta = etiquetaBotonBulto(bultoX, nombre);
  if (!visible || etiqueta === null) return null; // AC-BUL-1, AC-BUL-8

  const desglose = desgloseBultos(cantidad, bultoX); // AC-BUL-4
  const restarHabilitado = puedeRestar !== undefined
    ? !!puedeRestar
    : Number(cantidad) > CANTIDAD_MINIMA_RENGLON;

  return (
    <div className="bulto-control" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <button
        type="button"
        className="btn-icon"
        data-testid="bulto-mas"
        style={{ width: 'auto', padding: '0 10px', height: 30, fontSize: 12 }}
        onClick={() => onSumar && onSumar()}
      >{etiqueta}</button>
      <button
        type="button"
        className="btn-icon"
        data-testid="bulto-menos"
        style={{ width: 'auto', padding: '0 10px', height: 30, fontSize: 12, opacity: restarHabilitado ? 1 : 0.4 }}
        disabled={!restarHabilitado}
        onClick={() => restarHabilitado && onRestar && onRestar()}
      >{`− ${nombre}`}</button>
      {precioBulto !== null && precioBulto !== undefined && (
        <span data-testid="bulto-precio" style={{ fontSize: 11, color: 'var(--text3)' }}>{nombre}: ${Number(precioBulto).toLocaleString('es-AR')}</span>
      )}
      {desglose && (
        <span data-testid="bulto-desglose" style={{ fontSize: 11, color: 'var(--text3)' }}>{desglose.texto}</span>
      )}
    </div>
  );
};

export default BultoControl;
