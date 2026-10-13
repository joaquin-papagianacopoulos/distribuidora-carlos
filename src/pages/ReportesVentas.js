import React, { useMemo, useState } from 'react';
import { getTodayStr, formatFecha } from '../utils/fuzzy';
import { useApp } from '../hooks/useAppContext';
import { isPedidoVisible, normalizePedidoFecha } from '../utils/pedidos';

const ReportesVentas = () => {
  const { pedidos, vendedorActual, vendedores, zonaActiva, setZona } = useApp();
  const isAdmin = Number(vendedorActual?.permiso || 2) === 1;

  const hoy = getTodayStr();
  const [desde, setDesde] = useState(hoy);
  const [hasta, setHasta] = useState(hoy);
  const zona = String(zonaActiva || '');

  if (!isAdmin) {
    return (
      <div className="page">
        <h1 className="page-title">Reportes</h1>
        <div className="empty-state">
          <div className="empty-icon">{'\u26D4'}</div>
          <div className="empty-text">No tenes permisos para ver reportes</div>
        </div>
      </div>
    );
  }

  const rows = useMemo(() => {
    const d = String(desde || '').trim();
    const h = String(hasta || '').trim();
    if (!d || !h) return [];
    const dd = d <= h ? d : h;
    const hh = d <= h ? h : d;

    return (pedidos || [])
      .filter(isPedidoVisible)
      .filter(p => !zona || String(p.zona || '') === zona)
      .filter(p => normalizePedidoFecha(p.fecha) >= dd && normalizePedidoFecha(p.fecha) <= hh);
  }, [pedidos, desde, hasta, zona]);

  const porDia = useMemo(() => {
    const map = new Map();
    for (const r of rows) {
      const k = normalizePedidoFecha(r.fecha);
      const prev = map.get(k) || { fecha: k, pedidos: 0, total: 0 };
      prev.pedidos += 1;
      prev.total += Number(r.total || 0);
      map.set(k, prev);
    }
    return [...map.values()].sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
  }, [rows]);

  const total = porDia.reduce((acc, d) => acc + d.total, 0);
  const pedidosCount = porDia.reduce((acc, d) => acc + d.pedidos, 0);

  return (
    <div className="page">
      <h1 className="page-title">Reportes</h1>

      <div className="card" style={{ padding: '12px 14px', marginBottom: 14 }}>
        <label className="input-label">Zona</label>
        <select className="input" value={zona} onChange={e => setZona(e.target.value)} style={{ marginBottom: 10 }}>
          <option value="">Todas</option>
          {[...new Set((vendedores || []).map(v => v.zona).filter(Boolean))].sort().map(z => (
            <option key={z} value={z}>{z}</option>
          ))}
        </select>

        <label className="input-label">Desde</label>
        <input type="date" className="input" value={desde} onChange={e => setDesde(e.target.value)} style={{ marginBottom: 10 }} />
        <label className="input-label">Hasta</label>
        <input type="date" className="input" value={hasta} onChange={e => setHasta(e.target.value)} />

        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text3)' }}>
          Para actualizar datos remotos, toca Sync.
        </div>
      </div>

      <div className="stats-grid" style={{ marginBottom: 14 }}>
        <div className="stat-card">
          <div className="stat-value">{pedidosCount}</div>
          <div className="stat-label">Pedidos</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ fontSize: 18 }}>${total.toLocaleString('es-AR')}</div>
          <div className="stat-label">Total vendido</div>
        </div>
      </div>

      {porDia.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">{'\u{1F4CA}'}</div>
          <div className="empty-text">Sin datos en el rango</div>
        </div>
      ) : (
        <div className="card">
          <div style={{ fontWeight: 700, marginBottom: 10 }}>Ventas por dia</div>
          {porDia.map(d => (
            <div key={d.fecha} className="list-item">
              <div>
                <div className="list-item-name">{formatFecha(d.fecha)}</div>
                <div className="list-item-sub">{d.pedidos} pedido{d.pedidos !== 1 ? 's' : ''}</div>
              </div>
              <div style={{ fontWeight: 700 }}>${d.total.toLocaleString('es-AR')}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ReportesVentas;
