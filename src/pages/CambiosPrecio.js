// src/pages/CambiosPrecio.js — REQ-HPR (AC-HPR-2/3/4). Solo admin.
// Lista los cambios de precio de un día (o rango) y baja el PDF. El historial se
// registra desde la versión que lo introdujo: no se reconstruye el pasado.
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useApp } from '../hooks/useAppContext';
import { esAdmin } from '../domain/permisos';
import { getCambiosPrecio } from '../db';
import {
  resumirCambiosPrecio, filasPdfSoloPrecioNuevo, fechaArgentina,
} from '../domain/precios';
import { bajarCambiosPrecio, consultarCambiosPrecioOnline, DIAS_HISTORIAL_LOCAL } from '../services/cambiosPrecioService';
import { generarCambiosPrecioFile } from '../utils/pdfGen';

export const LEYENDA_HISTORIAL = 'Se registra desde esta versión: los cambios de precio anteriores no figuran acá.';

const pesos = (n) => (n === null || n === undefined ? '—' : `$${Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const fechaCorta = (iso) => String(iso || '').split('-').reverse().join('/');

const CambiosPrecio = ({ onVolver }) => {
  const { productos, vendedorActual, online = true } = useApp();
  const admin = esAdmin(vendedorActual?.permiso);
  const hoy = fechaArgentina(new Date());
  const [desde, setDesde] = useState(hoy);
  const [hasta, setHasta] = useState(hoy);
  const [soloNuevo, setSoloNuevo] = useState(false);
  const [locales, setLocales] = useState([]);
  const [online_, setOnline] = useState([]);
  const [msg, setMsg] = useState('');
  const [generando, setGenerando] = useState(false);

  const cargarLocales = useCallback(async () => {
    setLocales((await getCambiosPrecio()) || []);
  }, []);

  useEffect(() => {
    if (!admin) return undefined;
    let vivo = true;
    (async () => {
      await cargarLocales();
      if (online) {
        await bajarCambiosPrecio();
        if (vivo) await cargarLocales();
      }
    })();
    return () => { vivo = false; };
  }, [admin, online, cargarLocales]);

  // Rangos más viejos que el historial guardado en el dispositivo: se consultan online.
  const limiteLocal = fechaArgentina(new Date(Date.now() - DIAS_HISTORIAL_LOCAL * 86400000));
  useEffect(() => {
    if (!admin || !online || desde >= limiteLocal || !desde) { setOnline([]); return undefined; }
    let vivo = true;
    consultarCambiosPrecioOnline(desde, hasta || desde).then(r => {
      if (!vivo) return;
      setOnline(r.cambios || []);
      if (!r.ok) setMsg('No se pudo consultar el historial más viejo: queda lo guardado en este dispositivo.');
    });
    return () => { vivo = false; };
  }, [admin, online, desde, hasta, limiteLocal]);

  const todos = useMemo(() => {
    const porId = new Map();
    for (const c of [...online_, ...locales]) porId.set(c.id, c);
    return [...porId.values()];
  }, [locales, online_]);

  const productosById = useMemo(() => new Map((productos || []).map(p => [String(p.id), p])), [productos]);
  const rangoValido = !!desde && !!hasta && desde <= hasta;
  const filas = useMemo(() => (rangoValido ? resumirCambiosPrecio(todos, { desde, hasta }) : []), [todos, desde, hasta, rangoValido]);

  if (!admin) {
    return (
      <div className="card" data-testid="cambios-precio-solo-admin">Solo el admin puede ver los cambios de precio.</div>
    );
  }

  const bajarPdf = async () => {
    if (!filas.length) return;
    setGenerando(true);
    setMsg('');
    const w = window.open('', '_blank');
    try {
      const datos = soloNuevo ? filasPdfSoloPrecioNuevo(filas, productosById) : filas;
      const file = await generarCambiosPrecioFile(datos, { desde, hasta, soloNuevo });
      const url = URL.createObjectURL(file);
      if (w) w.location.href = url;
      else window.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      if (w) w.close();
      setMsg(`No se pudo generar el PDF: ${e?.message || String(e)}`);
    } finally {
      setGenerando(false);
    }
  };

  return (
    <div className="card" style={{ marginBottom: 16 }} data-testid="cambios-precio">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ fontWeight: 700 }}>Cambios de precio</div>
        {onVolver && <button className="btn btn-ghost btn-sm" style={{ width: 'auto' }} onClick={onVolver}>Cerrar</button>}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 10 }} data-testid="cambios-precio-leyenda">{LEYENDA_HISTORIAL}</div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <label style={{ flex: 1, minWidth: 130 }}>
          <span className="input-label">Desde</span>
          <input className="input" type="date" value={desde} max={hoy} onChange={e => { setDesde(e.target.value); if (hasta < e.target.value) setHasta(e.target.value); }} data-testid="cambios-desde" />
        </label>
        <label style={{ flex: 1, minWidth: 130 }}>
          <span className="input-label">Hasta</span>
          <input className="input" type="date" value={hasta} max={hoy} onChange={e => setHasta(e.target.value)} data-testid="cambios-hasta" />
        </label>
      </div>
      {!rangoValido && <div role="alert" style={{ fontSize: 12, color: 'var(--danger)', marginBottom: 8 }}>Elegí un rango válido (desde no puede ser posterior a hasta).</div>}
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, fontSize: 13 }}>
        <input type="checkbox" checked={soloNuevo} onChange={e => setSoloNuevo(e.target.checked)} data-testid="cambios-solo-nuevo" />
        Solo precio nuevo (lista para pasar a clientes y vendedores)
      </label>

      {filas.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text3)', padding: '10px 0' }} data-testid="cambios-vacio">
          No hay cambios de precio entre {fechaCorta(desde)} y {fechaCorta(hasta)}.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }} data-testid="cambios-tabla">
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text3)' }}>
                <th>Código</th><th>Producto</th><th>Rubro</th><th>Anterior</th><th>Nuevo</th><th>Var. %</th>
              </tr>
            </thead>
            <tbody>
              {filas.map(f => (
                <tr key={f.productoId} data-testid="cambios-fila">
                  <td>{f.codigo}</td>
                  <td>{f.nombre}</td>
                  <td>{f.rubro}</td>
                  <td>{f.precioAnterior === null ? 'Nuevo' : pesos(f.precioAnterior)}</td>
                  <td>{pesos(f.precioNuevo)}{f.precioBultoNuevo > 0 ? ` (bulto ${pesos(f.precioBultoNuevo)})` : ''}</td>
                  <td>{f.variacionPct === null ? '' : `${f.variacionPct > 0 ? '+' : ''}${String(f.variacionPct).replace('.', ',')}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {msg && <div role="alert" style={{ fontSize: 12, color: 'var(--warning)', marginTop: 8 }}>{msg}</div>}
      <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={bajarPdf} disabled={!filas.length || generando} data-testid="cambios-pdf">
        {generando ? 'Generando...' : 'Bajar PDF'}
      </button>
    </div>
  );
};

export default CambiosPrecio;
