// src/components/AgruparRenglones.js — REQ-AGR (AC-AGR-1, AC-AGR-2).
// El admin elige renglones, toca "Agrupar" y el grupo sale como UNA linea en la boleta.
// El nombre se sugiere (marca o rubro comun) y se puede editar. Los grupos se pueden
// deshacer. Solo cambia `grupos`: los renglones (items) quedan separados (stock, armado,
// comisiones y estadisticas no se tocan).
import React, { useState } from 'react';
import { claveRenglon, sugerirNombreGrupo, crearGrupo, renombrarGrupo, deshacerGrupo, normalizarGrupos, textoBultosGrupo } from '../domain/gruposFactura';

const AgruparRenglones = ({ items = [], grupos = [], productosById, onChange }) => {
  const [sel, setSel] = useState(new Set());
  const [nombreManual, setNombreManual] = useState(null);

  const vigentes = normalizarGrupos(grupos, items);
  const agrupadas = new Set(vigentes.flatMap(g => g.itemIds));
  const sueltos = items.filter(i => !agrupadas.has(claveRenglon(i)));
  const seleccionados = sueltos.filter(i => sel.has(claveRenglon(i)));
  const sugerido = sugerirNombreGrupo(seleccionados, productosById);
  const nombre = nombreManual ?? sugerido;

  const toggle = (clave) => setSel(prev => {
    const n = new Set(prev);
    if (n.has(clave)) n.delete(clave); else n.add(clave);
    return n;
  });

  const agrupar = () => {
    if (seleccionados.length < 2) return;
    onChange(crearGrupo(vigentes, seleccionados.map(claveRenglon), nombre));
    setSel(new Set());
    setNombreManual(null);
  };

  if (items.length < 2 && vigentes.length === 0) return null;

  return (
    <div className="card" data-testid="agrupar-renglones" style={{ marginBottom: 12 }}>
      <div style={{ fontWeight: 800, marginBottom: 6 }}>Agrupar renglones en la boleta</div>

      {vigentes.map(g => {
        const rengs = items.filter(i => g.itemIds.includes(claveRenglon(i)));
        return (
          <div key={g.id} data-testid="grupo-factura" style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 8, marginBottom: 8 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                className="input"
                aria-label="Nombre del grupo"
                value={g.nombre}
                maxLength={60}
                onChange={e => onChange(renombrarGrupo(vigentes, g.id, e.target.value))}
              />
              <button type="button" className="btn btn-ghost btn-sm" style={{ width: 'auto' }} onClick={() => onChange(deshacerGrupo(vigentes, g.id))}>
                Deshacer
              </button>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>
              {textoBultosGrupo(rengs)} · {rengs.map(r => r.nombre).join(', ')}
            </div>
          </div>
        );
      })}

      {sueltos.length > 0 && (
        <>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 4 }}>Marcá los renglones que van juntos:</div>
          {sueltos.map(i => (
            <label key={claveRenglon(i)} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '3px 0' }}>
              <input type="checkbox" checked={sel.has(claveRenglon(i))} onChange={() => toggle(claveRenglon(i))} />
              <span>{i.nombre} ({i.cantidad})</span>
            </label>
          ))}
          {seleccionados.length >= 2 && (
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <input
                className="input"
                aria-label="Nombre del nuevo grupo"
                value={nombre}
                maxLength={60}
                onChange={e => setNombreManual(e.target.value)}
              />
              <button type="button" className="btn btn-primary btn-sm" style={{ width: 'auto' }} onClick={agrupar}>
                Agrupar ({seleccionados.length})
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default AgruparRenglones;
