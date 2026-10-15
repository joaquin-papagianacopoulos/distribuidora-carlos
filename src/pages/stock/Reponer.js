// src/pages/stock/Reponer.js — REQ-STB (AC-STB-3). Solo admin.
// Lista de productos con stock bajo, agrupados por proveedor, con "Agregar al pedido al proveedor"
// por producto o de todos los de un proveedor. Solo arma el borrador del pedido: no mueve stock.
import React, { useMemo, useState } from 'react';
import { stockDe } from '../../domain/stock';
import { estadoStock, stockBajoDeProveedor, textoContadorStockBajo, contarStockBajo } from '../../domain/stockBajo';
import { agregarAlBorradorProveedor } from '../../services/comprasLocalService';

const Reponer = ({ productos, stockMap, proveedores = [], usuario = '', onListo }) => {
  const [msg, setMsg] = useState('');

  const grupos = useMemo(() => {
    const porId = new Map(productos.map(p => [String(p.id), p]));
    const nombres = new Map(proveedores.map(p => [String(p.id), p.descripcion]));
    const ids = [...new Set(productos.map(p => (p.proveedorId ? String(p.proveedorId) : '')))];
    return ids.map(pid => {
      const sugeridos = pid ? stockBajoDeProveedor(productos, stockMap, pid) : [];
      const filas = pid
        ? sugeridos.map(s => ({ ...s, producto: porId.get(s.productoId) }))
        : productos.filter(p => !p.proveedorId && estadoStock(p, stockDe(stockMap, p.id)) !== 'ok')
          .map(p => ({ productoId: String(p.id), sugerido: null, producto: p }));
      return { proveedorId: pid, nombre: pid ? (nombres.get(pid) || 'Proveedor') : 'Sin proveedor', filas };
    }).filter(g => g.filas.length > 0).sort((a, b) => (a.proveedorId ? 0 : 1) - (b.proveedorId ? 0 : 1) || a.nombre.localeCompare(b.nombre));
  }, [productos, stockMap, proveedores]);

  const agregar = async (proveedorId, filas, etiqueta) => {
    setMsg('');
    const items = filas.map(f => ({ productoId: f.productoId, cantidad: f.sugerido, unidad: 'u', bultoX: f.producto?.bultoX }));
    const r = await agregarAlBorradorProveedor(proveedorId, items, { usuario });
    if (!r.ok) { setMsg(r.mensaje || 'No se pudo agregar al pedido.'); return; }
    setMsg(`Agregado al pedido (borrador) de ${etiqueta}: ${items.length} producto(s). Lo ves en Proveedores.`);
    if (onListo) await onListo();
  };

  const total = contarStockBajo(productos, stockMap);

  return (
    <div className="card" data-testid="reponer">
      <div style={{ fontWeight: 700, marginBottom: 10 }}>{textoContadorStockBajo(total)}</div>
      {msg && <div role="status" style={{ fontSize: 13, color: 'var(--success)', marginBottom: 10 }}>{msg}</div>}
      {grupos.length === 0 && <div style={{ color: 'var(--text3)', fontSize: 14, textAlign: 'center', padding: 16 }}>Todo el stock está por encima del mínimo.</div>}
      {grupos.map(g => (
        <div key={g.proveedorId || 'sin'} style={{ marginBottom: 14 }} data-testid="grupo-reponer">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <strong>{g.nombre}</strong>
            {g.proveedorId && (
              <button className="btn btn-primary btn-sm" style={{ width: 'auto' }} onClick={() => agregar(g.proveedorId, g.filas, g.nombre)}>
                {`Agregar todos al pedido (${g.filas.length})`}
              </button>
            )}
          </div>
          {!g.proveedorId && <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 4 }}>Asignales un proveedor en Config → Productos para poder pedirlos.</div>}
          {g.filas.map(f => (
            <div key={f.productoId} className="list-item" data-testid="fila-reponer">
              <div>
                <div className="list-item-name">{f.producto?.nombre}</div>
                <div className="list-item-sub">{f.producto?.codigo || '—'} · stock {stockDe(stockMap, f.productoId)}{f.sugerido ? ` · sugerido ${f.sugerido}` : ''}</div>
              </div>
              {g.proveedorId && (
                <button className="btn btn-ghost btn-sm" style={{ width: 'auto' }} onClick={() => agregar(g.proveedorId, [f], g.nombre)}>
                  Agregar al pedido al proveedor
                </button>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
};

export default Reponer;
