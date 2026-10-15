// src/pages/Panel.js — REQ-PAN (AC-PAN-2..5). SOLO ADMIN.
// Panel de ganancia y rentabilidad. Todo el calculo esta en src/domain/panel.js (puro); aca solo se
// elige el periodo, se pide el PIN para bajar costos y se dibuja. El PIN vive solo en este estado.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../hooks/useAppContext';
import { esAdmin } from '../domain/permisos';
import { calcularPanel, periodoMesEnCurso, ordenarFilas } from '../domain/panel';
import { cargarDatosPanel, bajarCostosVenta, sondearMigracion015 } from '../services/panelService';
import { bajarRendiciones } from '../services/rendicionService';
import { bajarCostosProductos } from '../services/costosProductosService';
import { credencialesAdminProductos } from '../services/productosAdminService';
import GraficoBarras from '../components/GraficoBarras';

const pesos = (c) => `$${((Number(c) || 0) / 100).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (bp) => (bp === null || bp === undefined ? '—' : `${(bp / 100).toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`);
const variacion = (bp) => (bp === null || bp === undefined ? 'sin dato anterior' : `${bp > 0 ? '+' : ''}${(bp / 100).toLocaleString('es-AR', { maximumFractionDigits: 1 })} % vs. anterior`);

const DIMENSIONES = [
  { id: 'porProducto', label: 'Producto' }, { id: 'porRubro', label: 'Rubro' }, { id: 'porMarca', label: 'Marca' },
  { id: 'porVendedor', label: 'Vendedor' }, { id: 'porCliente', label: 'Cliente' },
];
const COLUMNAS = [
  { campo: 'etiqueta', label: 'Nombre' }, { campo: 'unidades', label: 'Unidades' }, { campo: 'ventasCents', label: 'Ventas' },
  { campo: 'gananciaCents', label: 'Ganancia' }, { campo: 'margenBp', label: 'Margen' },
];

const Tarjeta = ({ titulo, valor, cmp, id }) => (
  <div className="card" data-testid={`tarjeta-${id}`} style={{ padding: '10px 12px', minWidth: 140, flex: '1 1 140px' }}>
    <div style={{ fontSize: 12, color: 'var(--text-muted, #666)' }}>{titulo}</div>
    <div style={{ fontSize: 18, fontWeight: 700 }}>{valor}</div>
    <div style={{ fontSize: 11, color: 'var(--text-muted, #666)' }}>{variacion(cmp?.variacionBp)}</div>
  </div>
);

const Panel = () => {
  const { vendedorActual, pedidos, productos, recargar } = useApp();
  const admin = esAdmin(vendedorActual?.permiso);
  const [periodo, setPeriodo] = useState(() => periodoMesEnCurso());
  const [agrupacion, setAgrupacion] = useState('semana');
  const [dimension, setDimension] = useState('porProducto');
  const [orden, setOrden] = useState({ campo: 'ventasCents', dir: 'desc' });
  const [locales, setLocales] = useState({ rendiciones: [], costosVenta: new Map() });
  const [falta015, setFalta015] = useState(false);
  const [pin, setPin] = useState('');
  const [msg, setMsg] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const recargarLocales = useCallback(async () => {
    const d = await cargarDatosPanel();
    setLocales({ rendiciones: d.rendiciones, costosVenta: d.costosVenta });
  }, []);
  useEffect(() => { if (admin) { recargarLocales(); sondearMigracion015().then(s => setFalta015(!!s.faltaMigracion)); } }, [admin, recargarLocales]);

  const vm = useMemo(() => (admin && periodo.desde && periodo.hasta && periodo.desde <= periodo.hasta
    ? calcularPanel({ pedidos, productos, rendiciones: locales.rendiciones, costosVenta: locales.costosVenta, periodo, agrupacion })
    : null), [admin, pedidos, productos, locales, periodo, agrupacion]);

  if (!admin) {
    return (
      <div className="page">
        <h1 className="page-title">Panel</h1>
        <div className="empty-state"><div className="empty-text">Esta pantalla es solo para administradores.</div></div>
      </div>
    );
  }

  const actualizar = async () => {
    setMsg('');
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { setMsg('Necesitás conexión para actualizar los costos.'); return; }
    const cr = await credencialesAdminProductos(pin);
    if (!cr.ok) { setMsg(cr.mensaje || 'Ingresá tu PIN de administrador.'); return; }
    setPin('');
    setOcupado(true);
    try {
      const p = await bajarCostosProductos(cr.cred);
      if (!p.ok) { setMsg(p.motivo === 'no_autorizado' ? 'PIN incorrecto o sin permiso de admin.' : 'No se pudieron bajar los costos de productos.'); return; }
      await bajarRendiciones(cr.cred).catch(() => null);
      const v = await bajarCostosVenta(cr.cred);
      setFalta015(v.motivo === 'falta_migracion');
      setMsg(v.ok ? `Costos actualizados (${v.bajados} pedidos con costo del momento).` : v.mensaje);
      await recargarLocales();
      if (recargar) await recargar();
    } finally {
      setOcupado(false);
    }
  };

  const ordenar = (campo) => setOrden(o => ({ campo, dir: o.campo === campo && o.dir === 'desc' ? 'asc' : 'desc' }));
  const filas = vm ? ordenarFilas(vm[dimension], orden.campo, orden.dir) : [];
  const sinCostosBajados = !pedidos?.some(() => true) ? false : (productos || []).every(p => !(Number(p.costoFinal) > 0));
  const r = vm?.resumen;

  return (
    <div className="page">
      <h1 className="page-title">Panel de ganancia</h1>

      <div className="card" style={{ padding: '12px 14px', marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <label>Desde <input type="date" className="input" value={periodo.desde} onChange={e => setPeriodo(p => ({ ...p, desde: e.target.value }))} style={{ width: 150 }} /></label>
          <label>Hasta <input type="date" className="input" value={periodo.hasta} onChange={e => setPeriodo(p => ({ ...p, hasta: e.target.value }))} style={{ width: 150 }} /></label>
          <button type="button" className="btn btn-ghost btn-sm" style={{ width: 'auto' }} onClick={() => setPeriodo(periodoMesEnCurso())}>Mes en curso</button>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
          <input type="password" inputMode="numeric" autoComplete="off" maxLength={32} className="input" aria-label="PIN de administrador"
            placeholder="Tu PIN" value={pin} onChange={e => setPin(e.target.value)} style={{ width: 120 }} />
          <button type="button" className="btn btn-primary btn-sm" style={{ width: 'auto' }} disabled={ocupado} onClick={actualizar}>Actualizar costos (PIN)</button>
        </div>
        {msg && <div role="status" style={{ marginTop: 8, fontSize: 13 }}>{msg}</div>}
        {falta015 && <div data-testid="aviso-015" style={{ marginTop: 8, fontSize: 13, color: 'var(--warning)' }}>Falta la migración 015 en Supabase: se usa el costo actual de cada producto (costo estimado).</div>}
        {sinCostosBajados && <div data-testid="aviso-sin-costos" style={{ marginTop: 8, fontSize: 13, color: 'var(--warning)' }}>Todavía no bajaste los costos en este dispositivo: tocá "Actualizar costos (PIN)".</div>}
      </div>

      {!vm && <div className="empty-state"><div className="empty-text">Elegí un período válido.</div></div>}
      {vm && (
        <>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
            <Tarjeta id="ventas" titulo="Ventas" valor={pesos(r.ventasCents)} cmp={vm.comparacion.ventasCents} />
            <Tarjeta id="costo" titulo="Costo" valor={pesos(r.costoCents)} cmp={vm.comparacion.costoCents} />
            <Tarjeta id="ganancia" titulo="Ganancia bruta" valor={pesos(r.gananciaCents)} cmp={vm.comparacion.gananciaCents} />
            <Tarjeta id="margen" titulo="Margen" valor={pct(r.margenBp)} cmp={vm.comparacion.margenBp} />
            <Tarjeta id="pedidos" titulo="Pedidos" valor={String(r.pedidos)} cmp={vm.comparacion.pedidos} />
            <Tarjeta id="ticket" titulo="Ticket promedio" valor={pesos(r.ticketPromedioCents)} cmp={vm.comparacion.ticketPromedioCents} />
          </div>
          {(r.renglonesEstimados > 0 || r.renglonesSinCosto > 0) && (
            <div data-testid="aviso-estimado" className="card" style={{ padding: '8px 12px', marginBottom: 14, fontSize: 13 }}>
              {r.renglonesEstimados > 0 && <div>{r.renglonesEstimados} renglones con costo estimado (se usó el costo actual del producto).</div>}
              {r.renglonesSinCosto > 0 && <div>{r.renglonesSinCosto} renglones sin costo cargado: la ganancia se ve inflada.</div>}
            </div>
          )}

          <div className="card" style={{ padding: '12px 14px', marginBottom: 14 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              <strong>Tendencia</strong>
              <button type="button" className="btn btn-ghost btn-sm" style={{ width: 'auto' }} aria-pressed={agrupacion === 'semana'} onClick={() => setAgrupacion('semana')}>Semanal</button>
              <button type="button" className="btn btn-ghost btn-sm" style={{ width: 'auto' }} aria-pressed={agrupacion === 'mes'} onClick={() => setAgrupacion('mes')}>Mensual</button>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <GraficoBarras titulo={`Ventas por ${agrupacion === 'mes' ? 'mes' : 'semana'}`} barras={vm.tendencia.map(b => ({ etiqueta: b.etiqueta, valorCents: b.ventasCents }))} />
            </div>
          </div>

          <div className="card" style={{ padding: '12px 14px', marginBottom: 14 }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
              <strong>Rentabilidad por</strong>
              {DIMENSIONES.map(d => (
                <button key={d.id} type="button" className="btn btn-ghost btn-sm" style={{ width: 'auto' }} aria-pressed={dimension === d.id} onClick={() => setDimension(d.id)}>{d.label}</button>
              ))}
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table data-testid="tabla-rentabilidad" style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                <thead>
                  <tr>{COLUMNAS.map(c => (
                    <th key={c.campo} style={{ textAlign: c.campo === 'etiqueta' ? 'left' : 'right', cursor: 'pointer' }} onClick={() => ordenar(c.campo)}>
                      {c.label}{orden.campo === c.campo ? (orden.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                    </th>
                  ))}</tr>
                </thead>
                <tbody>
                  {filas.map(f => (
                    <tr key={f.clave}>
                      <td>{f.etiqueta}{f.estimado ? ' *' : ''}</td>
                      <td style={{ textAlign: 'right' }}>{f.unidades}</td>
                      <td style={{ textAlign: 'right' }}>{pesos(f.ventasCents)}</td>
                      <td style={{ textAlign: 'right', color: f.gananciaCents < 0 ? 'var(--danger, #c0392b)' : undefined }}>{pesos(f.gananciaCents)}</td>
                      <td style={{ textAlign: 'right' }}>{pct(f.margenBp)}</td>
                    </tr>
                  ))}
                  {!filas.length && <tr><td colSpan={5}>Sin ventas en el período.</td></tr>}
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: 11, marginTop: 4 }}>* incluye renglones con costo estimado.</div>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
            <div className="card" data-testid="top-unidades" style={{ padding: '10px 12px', flex: '1 1 240px' }}>
              <strong>Más vendidos (unidades)</strong>
              <ol style={{ paddingLeft: 18, fontSize: 13 }}>{vm.masVendidos.porUnidades.map(f => <li key={f.clave}>{f.etiqueta} — {f.unidades}</li>)}</ol>
            </div>
            <div className="card" data-testid="top-importe" style={{ padding: '10px 12px', flex: '1 1 240px' }}>
              <strong>Más vendidos (importe)</strong>
              <ol style={{ paddingLeft: 18, fontSize: 13 }}>{vm.masVendidos.porImporte.map(f => <li key={f.clave}>{f.etiqueta} — {pesos(f.ventasCents)}</li>)}</ol>
            </div>
            <div className="card" data-testid="en-alza" style={{ padding: '10px 12px', flex: '1 1 240px' }}>
              <strong>En alza</strong>
              <ul style={{ paddingLeft: 18, fontSize: 13 }}>{vm.variacion.alza.map(f => <li key={f.clave}>{f.etiqueta} — {f.nuevo ? 'nuevo' : pct(f.variacionBp)} ({f.unidadesAnterior} → {f.unidades})</li>)}</ul>
            </div>
            <div className="card" data-testid="en-baja" style={{ padding: '10px 12px', flex: '1 1 240px' }}>
              <strong>En baja</strong>
              <ul style={{ paddingLeft: 18, fontSize: 13 }}>{vm.variacion.baja.map(f => <li key={f.clave}>{f.etiqueta} — {pct(f.variacionBp)} ({f.unidadesAnterior} → {f.unidades})</li>)}</ul>
            </div>
          </div>

          <div className="card" data-testid="sin-ventas" style={{ padding: '10px 12px', marginBottom: 14 }}>
            <strong>Sin ventas en el período ({vm.sinVentas.length})</strong>
            <div style={{ fontSize: 13, maxHeight: 160, overflowY: 'auto' }}>{vm.sinVentas.slice(0, 200).map(p => <div key={p.id}>{p.nombre}</div>)}</div>
          </div>

          <div className="card" data-testid="avisos-panel" style={{ padding: '10px 12px', marginBottom: 14, borderColor: 'var(--warning)' }}>
            <strong>Avisos</strong>
            {!vm.avisos.margenNegativo.length && !vm.avisos.sinCosto.length && <div style={{ fontSize: 13 }}>Sin avisos.</div>}
            {vm.avisos.margenNegativo.length > 0 && (
              <div style={{ fontSize: 13 }}>Margen negativo: {vm.avisos.margenNegativo.map(a => `${a.etiqueta}${a.motivo === 'catalogo' ? ' (precio menor al costo)' : ''}`).join(', ')}</div>
            )}
            {vm.avisos.sinCosto.length > 0 && (
              <div style={{ fontSize: 13 }}>Sin costo cargado ({vm.avisos.sinCosto.length}): {vm.avisos.sinCosto.slice(0, 30).map(a => a.etiqueta).join(', ')}</div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default Panel;
