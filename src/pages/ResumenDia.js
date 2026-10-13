// src/pages/ResumenDia.js
import React, { useMemo, useState } from 'react';
import { useApp } from '../hooks/useAppContext';
import { getTodayStr, formatFecha } from '../utils/fuzzy';
import { generarResumenDia, generarResumenRango } from '../utils/pdfGen';
import { isPedidoVisible, normalizePedidoFecha } from '../utils/pedidos';

const alpha = (a, b) =>
  String(a || '').localeCompare(String(b || ''), 'es', { sensitivity: 'base' });

const ResumenDia = () => {
  const { pedidos, vendedores, vendedorActual, zonaActiva, setZona } = useApp();
  const isAdmin = Number(vendedorActual?.permiso || 2) === 1;

  const hoy = getTodayStr();
  const [desde, setDesde] = useState(hoy);
  const [hasta, setHasta] = useState(hoy);
  const [generando, setGenerando] = useState(false);
  const zona = String(zonaActiva || '');
  const [vendedorFiltro, setVendedorFiltro] = useState('');

  if (!isAdmin) {
    return (
      <div className="page">
        <h1 className="page-title">Resumen</h1>
        <div className="empty-state">
          <div className="empty-icon">{'\u26D4'}</div>
          <div className="empty-text">No tenes permisos para ver el resumen</div>
        </div>
      </div>
    );
  }

  const pedidosRango = useMemo(() => {
    const d = String(desde || '').trim();
    const h = String(hasta || '').trim();
    if (!d || !h) return [];
    const dd = d <= h ? d : h;
    const hh = d <= h ? h : d;
    return (pedidos || [])
      .filter(isPedidoVisible)
      .filter(p => !zona || String(p.zona || '') === zona)
      .filter(p => !vendedorFiltro || String(p.vendedorNombre || p.vendedor || '') === vendedorFiltro)
      .filter(p => normalizePedidoFecha(p.fecha) >= dd && normalizePedidoFecha(p.fecha) <= hh);
  }, [pedidos, desde, hasta, zona, vendedorFiltro]);

  const { totalesPorProducto, totalGeneral, totalUnidades, pedidosCount } = useMemo(() => {
    const map = {};
    for (const pedido of pedidosRango) {
      (pedido.items || []).forEach(item => {
        const k = item.productoId ?? item.nombre;
        if (!map[k]) map[k] = { nombre: item.nombre, cantidad: 0, subtotal: 0 };
        map[k].cantidad += Number(item.cantidad);
        map[k].subtotal += Number(item.cantidad) * Number(item.precio);
      });
    }
    const vals = Object.values(map).sort((a, b) => alpha(a.nombre, b.nombre));
    return {
      totalesPorProducto: vals,
      totalGeneral: vals.reduce((acc, p) => acc + p.subtotal, 0),
      totalUnidades: vals.reduce((acc, p) => acc + p.cantidad, 0),
      pedidosCount: pedidosRango.length,
    };
  }, [pedidosRango]);

  const exportarPDF = async () => {
    const d = desde <= hasta ? desde : hasta;
    const h = desde <= hasta ? hasta : desde;
    setGenerando(true);
    try {
      if (d === h) await generarResumenDia(pedidosRango, d);
      else await generarResumenRango(pedidosRango, d, h);
    } catch (e) {
      console.error(e);
      alert(e?.message || 'No se pudo generar el PDF.');
    }
    setGenerando(false);
  };

  const tituloRango =
    (desde && hasta && desde !== hasta)
      ? `${formatFecha(desde)} a ${formatFecha(hasta)}`
      : formatFecha(desde);

  return (
    <div className="page">
      <h1 className="page-title">Resumen</h1>

      <div className="card" style={{ padding: '12px 14px', marginBottom: 14 }}>
        <label className="input-label">Zona</label>
        <select className="input" value={zona} onChange={e => setZona(e.target.value)} style={{ marginBottom: 10 }}>
          <option value="">Todas</option>
          {[...new Set((vendedores || []).map(v => v.zona).filter(Boolean))].sort().map(z => (
            <option key={z} value={z}>{z}</option>
          ))}
        </select>

        <label className="input-label">Vendedor</label>
        <select className="input" value={vendedorFiltro} onChange={e => setVendedorFiltro(e.target.value)} style={{ marginBottom: 10 }}>
          <option value="">Todos</option>
          {(vendedores || [])
            .filter(v => !zona || String(v.zona || '') === zona)
            .map(v => v.nombre)
            .filter(Boolean)
            .sort((a, b) => String(a).localeCompare(String(b), 'es', { sensitivity: 'base' }))
            .map(n => (
              <option key={n} value={n}>{n}</option>
            ))}
        </select>

        <label className="input-label">Desde</label>
        <input
          type="date"
          className="input"
          value={desde}
          onChange={e => setDesde(e.target.value)}
          style={{ marginBottom: 10 }}
        />
        <label className="input-label">Hasta</label>
        <input
          type="date"
          className="input"
          value={hasta}
          onChange={e => setHasta(e.target.value)}
        />

        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text3)' }}>
          Para actualizar datos remotos, toca Sync.
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value">{pedidosCount}</div>
          <div className="stat-label">Pedidos</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{totalUnidades}</div>
          <div className="stat-label">Unidades totales</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{totalesPorProducto.length}</div>
          <div className="stat-label">Productos distintos</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ fontSize: 15 }}>
            ${totalGeneral.toLocaleString('es-AR')}
          </div>
          <div className="stat-label">Total general</div>
        </div>
      </div>

      {totalesPorProducto.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">{'\u{1F4CA}'}</div>
          <div className="empty-text">No hay pedidos para este rango</div>
        </div>
      ) : (
        <>
          <div className="card">
            <div style={{ fontWeight: 700, marginBottom: 14, fontSize: 15 }}>
              Productos vendidos - {tituloRango}
            </div>
            {totalesPorProducto.map((p, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '7px 0',
                borderBottom: i < totalesPorProducto.length - 1 ? '1px solid var(--border)' : 'none'
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.2 }}>{p.nombre}</div>
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                    ${p.subtotal.toLocaleString('es-AR')}
                  </div>
                </div>
                <div style={{
                  background: 'var(--accent-dim)',
                  color: 'var(--accent2)',
                  fontWeight: 700,
                  fontSize: 15,
                  minWidth: 44,
                  textAlign: 'center',
                  padding: '3px 8px',
                  borderRadius: 8,
                }}>
                  {p.cantidad}
                </div>
              </div>
            ))}
            <div className="total-row">
              <span className="total-label">Total general</span>
              <span className="total-value">${totalGeneral.toLocaleString('es-AR')}</span>
            </div>
          </div>

          <button
            className="btn btn-primary"
            onClick={exportarPDF}
            disabled={generando}
            style={{ marginTop: 4, marginBottom: 80 }}
          >
            {generando ? '\u23F3 Generando PDF...' : '\u{1F4E5} Exportar PDF'}
          </button>
        </>
      )}
    </div>
  );
};

export default ResumenDia;
