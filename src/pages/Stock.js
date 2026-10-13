// src/pages/Stock.js — REQ-STK (AC-STK-7) y REQ-ING (AC-ING-1..6). Solo admin.
import React, { useMemo, useState } from 'react';
import { useApp } from '../hooks/useAppContext';
import { registrarIngreso } from '../services/stockService';
import { stockDe, productosStockBajo } from '../domain/stock';
import { normalize } from '../utils/fuzzy';

const SECCIONES = [
  { id: 'stock', label: 'Stock' },
  { id: 'ingreso', label: 'Ingreso de mercadería' },
  { id: 'historial', label: 'Historial' },
];

const fechaCorta = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
};

// ---------------- Listado de stock ----------------
const ListadoStock = ({ productos, stockMap, movimientos }) => {
  const [q, setQ] = useState('');
  const [soloBajo, setSoloBajo] = useState(false);
  const [detalle, setDetalle] = useState(null);

  const bajos = useMemo(() => new Set(productosStockBajo(productos, stockMap).map(p => p.id)), [productos, stockMap]);
  const lista = useMemo(() => {
    const nq = normalize(q.trim());
    return productos
      .filter(p => !soloBajo || bajos.has(p.id))
      .filter(p => !nq || normalize(p.nombre || '').includes(nq) || normalize(String(p.codigo || '')).includes(nq))
      .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
  }, [productos, q, soloBajo, bajos]);

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
      <input className="input" type="search" placeholder="Buscar por código o descripción..." value={q} onChange={e => setQ(e.target.value)} style={{ marginBottom: 10 }} />
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, marginBottom: 12 }}>
        <input type="checkbox" checked={soloBajo} onChange={e => setSoloBajo(e.target.checked)} />
        Solo stock bajo ({bajos.size})
      </label>
      {lista.length === 0 && <div style={{ color: 'var(--text3)', fontSize: 14, textAlign: 'center', padding: 16 }}>Sin productos</div>}
      {lista.map(p => {
        const s = stockDe(stockMap, p.id);
        const bajo = bajos.has(p.id);
        return (
          <div key={p.id} className="list-item" onClick={() => setDetalle(p)} style={{ cursor: 'pointer' }} data-testid="fila-stock">
            <div>
              <div className="list-item-name">{p.nombre}</div>
              <div className="list-item-sub">{p.codigo || '—'} · mín. venta {p.minimoVenta || 1} · bulto x{p.bultoX || 1}</div>
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

// ---------------- Ingreso de mercadería ----------------
export const IngresoMercaderia = ({ productos, proveedores, stockMap, usuario, onListo }) => {
  const [factura, setFactura] = useState('');
  const [proveedorId, setProveedorId] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [renglones, setRenglones] = useState([]); // [{ productoId, ingreso }]
  const [errores, setErrores] = useState({});
  const [guardando, setGuardando] = useState(false);
  const [ok, setOk] = useState(null);

  const prodById = useMemo(() => new Map(productos.map(p => [String(p.id), p])), [productos]);
  const sugeridos = useMemo(() => {
    const nq = normalize(busqueda.trim());
    if (!nq) return [];
    const exacto = productos.filter(p => normalize(String(p.codigo || '')) === nq);
    const resto = productos.filter(p => !exacto.includes(p) && (normalize(String(p.codigo || '')).includes(nq) || normalize(p.nombre || '').includes(nq)));
    return [...exacto, ...resto].slice(0, 8);
  }, [busqueda, productos]);

  const agregar = (p) => {
    setOk(null);
    setRenglones(prev => (prev.some(r => r.productoId === String(p.id)) ? prev : [...prev, { productoId: String(p.id), ingreso: '' }]));
    setBusqueda('');
  };
  const setIngreso = (pid, v) => setRenglones(prev => prev.map(r => (r.productoId === pid ? { ...r, ingreso: v } : r)));
  const quitar = (pid) => {
    setRenglones(prev => prev.filter(r => r.productoId !== pid));
    setErrores(prev => { const n = { ...prev }; delete n[`item:${pid}`]; return n; });
  };

  const confirmar = async () => {
    setGuardando(true);
    setOk(null);
    try {
      const r = await registrarIngreso({ facturaProveedor: factura, proveedorId, items: renglones }, { productos, usuario });
      if (!r.ok) { setErrores(r.errores); return; }
      setErrores({});
      setOk(`Ingreso registrado: ${r.movimientos.length} producto(s), factura ${r.ingreso.facturaProveedor}.`);
      setFactura(''); setProveedorId(''); setRenglones([]);
      await onListo?.();
    } catch (e) {
      setErrores({ general: e?.message || String(e) });
    } finally {
      setGuardando(false);
    }
  };

  const err = (k) => errores[k] && <div role="alert" style={{ color: 'var(--danger)', fontSize: 12, marginTop: 4 }}>{errores[k]}</div>;

  return (
    <div className="card" data-testid="ingreso-form">
      <div className="input-group">
        <label className="input-label" htmlFor="ing-factura">Factura proveedor *</label>
        <input id="ing-factura" className="input" value={factura} onChange={e => setFactura(e.target.value)} placeholder="Ej: A-0001-00012345" />
        {err('facturaProveedor')}
      </div>
      <div className="input-group">
        <label className="input-label" htmlFor="ing-proveedor">Proveedor *</label>
        <select id="ing-proveedor" className="input" value={proveedorId} onChange={e => setProveedorId(e.target.value)}>
          <option value="">— Elegir —</option>
          {proveedores.map(p => <option key={p.id} value={p.id}>{p.codigo} — {p.descripcion}</option>)}
        </select>
        {err('proveedorId')}
      </div>

      <div className="input-group">
        <label className="input-label" htmlFor="ing-buscar">Código producto</label>
        <input id="ing-buscar" className="input" type="search" value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && sugeridos[0]) agregar(sugeridos[0]); }}
          placeholder="Escribí código o descripción y Enter" autoComplete="off" />
        {sugeridos.map(p => (
          <div key={p.id} className="list-item" style={{ cursor: 'pointer' }} onClick={() => agregar(p)} data-testid="sugerido">
            <div><div className="list-item-name">{p.nombre}</div><div className="list-item-sub">{p.codigo || '—'}</div></div>
            <div style={{ fontSize: 12 }}>Stock {stockDe(stockMap, p.id)}</div>
          </div>
        ))}
        {err('items')}
      </div>

      {renglones.length > 0 && (
        <div style={{ overflowX: 'auto', marginBottom: 14 }}>
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text3)' }}>
                <th>Código</th><th>Descripción</th><th>Stock actual</th><th>Ingreso</th><th>Stock total</th><th />
              </tr>
            </thead>
            <tbody>
              {renglones.map((r) => {
                const p = prodById.get(r.productoId);
                const actual = stockDe(stockMap, r.productoId);
                const n = parseInt(r.ingreso, 10);
                const total = Number.isFinite(n) ? actual + n : actual;
                return (
                  <tr key={r.productoId} data-testid="renglon-ingreso">
                    <td>{p?.codigo || '—'}</td>
                    <td>{p?.nombre || '¿?'}{errores[`item:${r.productoId}`] && <div role="alert" style={{ color: 'var(--danger)', fontSize: 11 }}>{errores[`item:${r.productoId}`]}</div>}</td>
                    <td>{actual}</td>
                    <td><input className="qty-input" aria-label={`Ingreso ${p?.nombre || ''}`} inputMode="numeric" value={r.ingreso} onChange={e => setIngreso(r.productoId, e.target.value)} style={{ width: 70 }} /></td>
                    <td><strong>{total}</strong></td>
                    <td><button className="btn-icon" style={{ color: 'var(--danger)' }} onClick={() => quitar(r.productoId)} aria-label="Quitar">×</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {err('general')}
      {ok && <div role="status" style={{ color: 'var(--success)', fontSize: 13, marginBottom: 10 }}>{ok}</div>}
      <button className="btn btn-primary" onClick={confirmar} disabled={guardando} style={{ width: '100%' }}>
        {guardando ? 'Registrando...' : 'Confirmar ingreso'}
      </button>
    </div>
  );
};

// ---------------- Historial de ingresos ----------------
const HistorialIngresos = ({ ingresos }) => {
  const [abierto, setAbierto] = useState(null);
  const lista = [...ingresos].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  return (
    <div className="card">
      {lista.length === 0 && <div style={{ color: 'var(--text3)', fontSize: 14, textAlign: 'center', padding: 16 }}>Todavía no hay ingresos</div>}
      {lista.map(i => (
        <div key={i.id} style={{ borderBottom: '1px solid var(--border)', padding: '10px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', cursor: 'pointer' }} onClick={() => setAbierto(abierto === i.id ? null : i.id)}>
            <div>
              <div style={{ fontWeight: 600 }}>Fact. {i.facturaProveedor} · {i.proveedorNombre}</div>
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>{fechaCorta(i.fecha)} · {i.usuario || '—'} · {i.items?.length || 0} producto(s)</div>
            </div>
            <span>{abierto === i.id ? '▲' : '▼'}</span>
          </div>
          {abierto === i.id && (
            <table style={{ width: '100%', fontSize: 12, marginTop: 8 }}>
              <thead><tr style={{ textAlign: 'left', color: 'var(--text3)' }}><th>Código</th><th>Descripción</th><th>Stock actual</th><th>Ingreso</th><th>Stock total</th></tr></thead>
              <tbody>
                {(i.items || []).map(r => (
                  <tr key={r.productoId}><td>{r.codigo}</td><td>{r.descripcion}</td><td>{r.stockActual}</td><td>+{r.ingreso}</td><td>{r.stockTotal}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
    </div>
  );
};

const Stock = () => {
  const { productos, proveedores = [], ingresos = [], movimientosStock = [], stockMap, vendedorActual, recargar } = useApp();
  const [seccion, setSeccion] = useState('stock');
  const isAdmin = Number(vendedorActual?.permiso || 2) === 1;

  // AC-SEC-4: solo admin.
  if (!isAdmin) {
    return (
      <div className="page">
        <h1 className="page-title">Stock</h1>
        <div className="empty-state"><div className="empty-text">No tenés permisos para ver el stock</div></div>
      </div>
    );
  }

  return (
    <div className="page">
      <h1 className="page-title">Stock</h1>
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {SECCIONES.map(s => (
          <button key={s.id} className={`btn btn-sm ${seccion === s.id ? 'btn-primary' : 'btn-ghost'}`} style={{ flex: 1 }} onClick={() => setSeccion(s.id)}>
            {s.label}
          </button>
        ))}
      </div>
      {seccion === 'stock' && <ListadoStock productos={productos} stockMap={stockMap} movimientos={movimientosStock} />}
      {seccion === 'ingreso' && (
        proveedores.length === 0
          ? <div className="card" style={{ fontSize: 14 }}>Primero cargá al menos un proveedor en Config → Proveedores.</div>
          : <IngresoMercaderia productos={productos} proveedores={proveedores} stockMap={stockMap} usuario={vendedorActual?.nombre || ''} onListo={recargar} />
      )}
      {seccion === 'historial' && <HistorialIngresos ingresos={ingresos} />}
    </div>
  );
};

export default Stock;
