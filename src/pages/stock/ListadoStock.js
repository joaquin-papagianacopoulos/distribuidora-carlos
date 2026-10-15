// src/pages/stock/ListadoStock.js — REQ-STK (AC-STK-7) y REQ-STB (AC-STB-2/3). Solo admin.
import React, { useMemo, useState } from 'react';
import { stockDe } from '../../domain/stock';
import { filtrarStock, contarStockBajo, textoContadorStockBajo, ESTADOS_STOCK } from '../../domain/stockBajo';

const fechaCorta = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
};

const ETIQUETA_ESTADO = { negativo: 'Negativo', sin_stock: 'Sin stock', bajo: 'Bajo', ok: 'Ok' };

const unicos = (productos, campo) => [...new Set(productos.map(p => String(p[campo] || '').trim()).filter(Boolean))]
  .sort((a, b) => a.localeCompare(b));

const ListadoStock = ({ productos, stockMap, movimientos, proveedores = [] }) => {
  const [q, setQ] = useState('');
  const [soloBajo, setSoloBajo] = useState(false);
  const [rubro, setRubro] = useState('');
  const [marca, setMarca] = useState('');
  const [proveedorId, setProveedorId] = useState('');
  const [estado, setEstado] = useState('');
  const [detalle, setDetalle] = useState(null);

  const cantBajos = useMemo(() => contarStockBajo(productos, stockMap), [productos, stockMap]);
  const rubros = useMemo(() => unicos(productos, 'categoria'), [productos]);
  const marcas = useMemo(() => unicos(productos, 'marca'), [productos]);

  const lista = useMemo(() => filtrarStock(productos, stockMap, {
    query: q, rubro, marca, proveedorId, estado: estado || (soloBajo ? 'alerta' : ''),
  }).sort((a, b) => String(a.producto.nombre).localeCompare(String(b.producto.nombre))), [productos, stockMap, q, rubro, marca, proveedorId, estado, soloBajo]);

  const movsDetalle = useMemo(() => (detalle
    ? movimientos.filter(m => String(m.productoId) === String(detalle.id)).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))
    : []), [detalle, movimientos]);

  if (detalle) {
    return (
      <div className="card">
        <button className="btn btn-ghost btn-sm" onClick={() => setDetalle(null)} style={{ marginBottom: 12 }}>‹ Volver</button>
        <div style={{ fontWeight: 700 }}>{detalle.nombre}</div>
        <div style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 12 }}>
          Código {detalle.codigo || '—'} · Stock actual <strong>{stockDe(stockMap, detalle.id)}</strong>
        </div>
        {movsDetalle.length === 0 && <div style={{ color: 'var(--text3)', fontSize: 14 }}>Sin movimientos.</div>}
        {movsDetalle.map(m => (
          <div key={m.id} className="list-item">
            <div>
              <div className="list-item-name" style={{ textTransform: 'capitalize' }}>{m.tipo}</div>
              <div className="list-item-sub">{fechaCorta(m.fecha)} · {m.usuario || '—'} {m.nota ? `· ${m.nota}` : ''}</div>
            </div>
            <div style={{ fontWeight: 700, color: m.cantidad < 0 ? 'var(--danger)' : 'var(--success)' }}>
              {m.cantidad > 0 ? `+${m.cantidad}` : m.cantidad}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="card">
      <div data-testid="contador-stock-bajo" style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: cantBajos > 0 ? 'var(--warning)' : 'var(--text3)' }}>
        {textoContadorStockBajo(cantBajos)}
      </div>
      <input className="input" type="search" placeholder="Buscar por nombre, código o marca..." value={q} onChange={e => setQ(e.target.value)} style={{ marginBottom: 10 }} />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        <select className="input" aria-label="Filtrar por rubro" value={rubro} onChange={e => setRubro(e.target.value)} style={{ flex: 1, minWidth: 110 }}>
          <option value="">Todos los rubros</option>
          {rubros.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <select className="input" aria-label="Filtrar por marca" value={marca} onChange={e => setMarca(e.target.value)} style={{ flex: 1, minWidth: 110 }}>
          <option value="">Todas las marcas</option>
          {marcas.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <select className="input" aria-label="Filtrar por proveedor" value={proveedorId} onChange={e => setProveedorId(e.target.value)} style={{ flex: 1, minWidth: 110 }}>
          <option value="">Todos los proveedores</option>
          {proveedores.map(p => <option key={p.id} value={p.id}>{p.descripcion}</option>)}
        </select>
        <select className="input" aria-label="Filtrar por estado" value={estado} onChange={e => setEstado(e.target.value)} style={{ flex: 1, minWidth: 110 }}>
          <option value="">Todos los estados</option>
          {ESTADOS_STOCK.map(s => <option key={s} value={s}>{ETIQUETA_ESTADO[s]}</option>)}
        </select>
      </div>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, marginBottom: 12 }}>
        <input type="checkbox" checked={soloBajo} onChange={e => setSoloBajo(e.target.checked)} />
        Solo stock bajo ({cantBajos})
      </label>
      {lista.length === 0 && <div style={{ color: 'var(--text3)', fontSize: 14, textAlign: 'center', padding: 16 }}>Sin productos</div>}
      {lista.map(({ producto: p, stock: s, estado: est, umbral }) => {
        const bajo = est !== 'ok';
        return (
          <div key={p.id} className="list-item" onClick={() => setDetalle(p)} style={{ cursor: 'pointer' }} data-testid="fila-stock">
            <div>
              <div className="list-item-name">{p.nombre}</div>
              <div className="list-item-sub">{p.codigo || '—'} · mín. venta {p.minimoVenta || 1}{p.stockMinimo !== null && p.stockMinimo !== undefined && p.stockMinimo !== '' ? ` · stock mín. ${umbral}` : ''} · bulto x{p.bultoX || 1}</div>
            </div>
            <div style={{ fontWeight: 700, color: s < 0 ? 'var(--danger)' : bajo ? 'var(--warning)' : 'var(--text)' }}>
              {s}{bajo ? ' ⚠' : ''}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default ListadoStock;
