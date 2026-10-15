// src/pages/FacturasAEmitir.js — REQ-FAB (AC-FAB-3). SOLO ADMIN.
// Reporte para el contador: pedidos facturados (no borrados) con su tipo de factura A/B,
// agrupados con subtotales y total general, mas el PDF. Los datos vienen de una RPC con el
// PIN del admin (migracion 011): el PIN vive solo en este estado, no se guarda ni se loguea,
// y las filas (CUIT incluido) nunca se escriben en consola. Requiere conexion.
import React, { useMemo, useState } from 'react';
import { useApp } from '../hooks/useAppContext';
import { esAdmin } from '../domain/permisos';
import { armarReporteFacturas, aplicarTiposLocales, filasTiposFacturaRpc } from '../domain/facturacionAB';
import { hoyISO } from '../domain/validacion';
import { consultarFacturasAEmitir, aplicarTiposRemotos } from '../services/facturacionService';
import { credencialesAdminProductos } from '../services/productosAdminService';
import { generarFacturasAEmitirFile } from '../utils/pdfGen';

const pesos = (n) => `$${Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fechaCorta = (iso) => String(iso || '').slice(0, 10).split('-').reverse().join('/');
const primeroDelMes = () => `${hoyISO().slice(0, 8)}01`;

const FacturasAEmitir = () => {
  const { vendedorActual, pedidos, recargar } = useApp();
  const admin = esAdmin(vendedorActual?.permiso);
  const [desde, setDesde] = useState(primeroDelMes());
  const [hasta, setHasta] = useState(hoyISO());
  const [filtro, setFiltro] = useState('todas');
  const [pin, setPin] = useState('');
  const [filas, setFilas] = useState(null);
  const [msg, setMsg] = useState('');
  const [cargando, setCargando] = useState(false);

  const sinSubir = useMemo(() => filasTiposFacturaRpc(pedidos || []).length, [pedidos]);
  const reporte = useMemo(
    () => (filas ? armarReporteFacturas(aplicarTiposLocales(filas, pedidos), { desde, hasta, filtro }) : null),
    [filas, pedidos, desde, hasta, filtro],
  );

  if (!admin) {
    return (
      <div className="page">
        <h1 className="page-title">Facturas a emitir</h1>
        <div className="empty-state"><div className="empty-text">Esta pantalla es solo para administradores.</div></div>
      </div>
    );
  }

  const consultar = async () => {
    setMsg('');
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { setMsg('Necesitás conexión para armar el reporte (reúne los pedidos de todos los dispositivos).'); return; }
    const cr = await credencialesAdminProductos(pin);
    if (!cr.ok) { setMsg(cr.mensaje || 'Ingresá tu PIN de administrador.'); return; }
    setPin('');
    setCargando(true);
    try {
      const r = await consultarFacturasAEmitir(cr.cred, desde, hasta);
      if (!r.ok) { setFilas(null); setMsg(r.mensaje || 'No se pudo armar el reporte.'); return; }
      setFilas(r.filas);
      // Best effort: trae a este dispositivo los tipos que marcaron otros (no pisa lo pendiente).
      const ap = await aplicarTiposRemotos(r.filas);
      if (ap.count > 0 && recargar) await recargar();
    } catch {
      setFilas(null);
      setMsg('No se pudo armar el reporte. Probá de nuevo con conexión.');
    } finally {
      setCargando(false);
    }
  };

  const descargarPdf = async () => {
    if (!reporte) return;
    const file = await generarFacturasAEmitirFile(reporte, { desde, hasta, filtro });
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  return (
    <div className="page">
      <h1 className="page-title">Facturas a emitir</h1>

      <div className="card" style={{ padding: '12px 14px', marginBottom: 14 }}>
        <label className="input-label" htmlFor="fe-desde">Desde</label>
        <input id="fe-desde" type="date" className="input" value={desde} onChange={e => setDesde(e.target.value)} />
        <label className="input-label" htmlFor="fe-hasta" style={{ marginTop: 8 }}>Hasta</label>
        <input id="fe-hasta" type="date" className="input" value={hasta} onChange={e => setHasta(e.target.value)} />
        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          {[['todas', 'A y B'], ['A', 'Solo A'], ['B', 'Solo B']].map(([v, l]) => (
            <button key={v} className={`btn btn-sm ${filtro === v ? 'btn-primary' : 'btn-ghost'}`} style={{ width: 'auto' }} onClick={() => setFiltro(v)}>{l}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={32}
            className="input"
            aria-label="PIN de administrador"
            placeholder="Tu PIN"
            value={pin}
            onChange={e => setPin(e.target.value)}
            style={{ width: 120 }}
          />
          <button className="btn btn-primary btn-sm" style={{ width: 'auto' }} disabled={cargando} onClick={consultar}>
            {cargando ? 'Consultando...' : 'Armar reporte'}
          </button>
        </div>
        {msg && <div role="alert" style={{ marginTop: 8, fontSize: 13, color: 'var(--warning)', fontWeight: 700 }}>{msg}</div>}
        {sinSubir > 0 && (
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text3)' }} data-testid="aviso-sin-subir">
            Hay {sinSubir} tipo(s) de factura marcados en este dispositivo sin subir: el reporte los toma igual. Subilos desde Facturación.
          </div>
        )}
      </div>

      {reporte && reporte.grupos.length === 0 && (
        <div className="empty-state"><div className="empty-text">No hay pedidos facturados con factura A o B en ese período.</div></div>
      )}

      {reporte && reporte.grupos.map(g => (
        <div key={g.tipo} className="card" data-testid={`grupo-${g.tipo}`} style={{ marginBottom: 14 }}>
          <div style={{ fontWeight: 800, marginBottom: 8 }}>Factura {g.tipo}</div>
          {g.filas.map(f => (
            <div key={`${g.tipo}-${f.pedidoId}`} style={{ padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <strong>{f.clienteNombre}</strong>
                <span>{pesos(f.total)}</span>
              </div>
              <div style={{ color: 'var(--text3)' }}>
                CUIT {f.cuit || '-'} · {f.tipoIva || 'sin tipo de IVA'} · Pedido {f.pedidoId} · {fechaCorta(f.fecha)}{f.sugerido ? ' · (sugerido)' : ''}
              </div>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontWeight: 800 }}>
            <span>Subtotal {g.tipo}</span><span>{pesos(g.subtotal)}</span>
          </div>
        </div>
      ))}

      {reporte && reporte.grupos.length > 0 && (
        <>
          <div className="total-row" data-testid="total-general">
            <span className="total-label">Total general</span>
            <span className="total-value">{pesos(reporte.total)}</span>
          </div>
          <button className="btn btn-success" style={{ width: '100%', marginTop: 10, marginBottom: 80 }} onClick={descargarPdf}>
            Descargar PDF
          </button>
        </>
      )}
    </div>
  );
};

export default FacturasAEmitir;
