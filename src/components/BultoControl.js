// src/components/BultoControl.js — botones "+ Bulto (x N)" / "− Bulto" y desglose (REQ-BUL).
// Presentacional: no calcula cantidades, solo dispara onSumar/onRestar.
// El cálculo vive en src/domain/bultos.js y en el handler del padre.
import React from 'react';
import { etiquetaBotonBulto, desgloseBultos, partirBultos, CANTIDAD_MINIMA_RENGLON } from '../domain/bultos';

// REQ-VTA (AC-VTA-3): `nombre` (Bulto/Display/Caja/Pack) y `precioBulto` (precio unitario × bultoX).
const BultoControl = ({ bultoX, cantidad, onSumar, onRestar, onSumarSueltas, onRestarSueltas, puedeRestar, visible = true, nombre = 'Bulto', precioBulto = null }) => {
  const etiqueta = etiquetaBotonBulto(bultoX, nombre);
  if (!visible || etiqueta === null) return null; // AC-BUL-1, AC-BUL-8

  const desglose = desgloseBultos(cantidad, bultoX); // AC-BUL-4
  const partesRestar = partirBultos(Number(cantidad), bultoX);
  // AC-CBU-2 (BUG-1): con 0 bultos (solo sueltas) "− Bulto" no hace nada.
  const restarHabilitado = (puedeRestar !== undefined
    ? !!puedeRestar
    : Number(cantidad) > CANTIDAD_MINIMA_RENGLON) && !(partesRestar && partesRestar.bultos === 0);

  // AC-CBU-2: casillero "Bultos" (contador) y "Unidades sueltas"; la cantidad sigue siendo el total en unidades.
  const partes = partirBultos(Number(cantidad), bultoX);
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
      {partes && (
        <span data-testid="bulto-casillero" style={{ fontSize: 12, color: 'var(--text2)' }}>
          Bultos: <b data-testid="bulto-casillero-valor">{partes.bultos}</b>
          {' · '}Unidades sueltas: <b data-testid="sueltas-casillero-valor">{partes.sueltas}</b>
          <button type="button" className="btn-icon" data-testid="sueltas-menos" aria-label="Menos unidades sueltas" disabled={partes.sueltas === 0} style={{ width: 28, height: 26, marginLeft: 6, opacity: partes.sueltas === 0 ? 0.4 : 1 }} onClick={() => onRestarSueltas && onRestarSueltas()}>−</button>
          <button type="button" className="btn-icon" data-testid="sueltas-mas" aria-label="Más unidades sueltas" style={{ width: 28, height: 26, marginLeft: 4 }} onClick={() => onSumarSueltas && onSumarSueltas()}>+</button>
        </span>
      )}
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
