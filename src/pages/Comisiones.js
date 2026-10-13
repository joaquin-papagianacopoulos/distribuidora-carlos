// src/pages/Comisiones.js — REQ-COM (AC-COM-2..14). Solo admin.
// Dashboard del período, avisos, asignación de comisiones, cierre e historial.
// Toda la lógica está en src/domain/comisiones.js; acá solo se muestra.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../hooks/useAppContext';
import {
  armarDashboard, puedeCerrar, firmaDashboard, periodoPorDefecto, validarPeriodo,
  setAsignacionBorrador, CONFIG_COMISIONES, puedeVerComisiones, contarPendientesServidor,
  confirmarAsignacionBorrador, asignacionLineaValida, pedidoIdComision, buscarCliente,
  ayudaAnulacion,
} from '../domain/comisiones';
import { permisoValido } from '../domain/permisos';
import { vendedoresParaSelector } from '../domain/vendedores';
import {
  cargarDatosComisiones, guardarBorrador, confirmarCierre, anularCierre, syncComisiones,
} from '../services/comisionesService';
import { generarCierreComisionesFile } from '../utils/pdfGen';

const pesos = (n) => `$${Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fechaCorta = (iso) => String(iso || '').slice(0, 10).split('-').reverse().join('/');
const fechaHora = (ms) => {
  const d = new Date(Number(ms));
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
};
const ESTADO_LABEL = { vigente: 'Vigente', anulado: 'Anulado', pendiente: 'Pendiente de confirmar', rechazado: 'Rechazado' };

// ---------------- PIN del admin (S-COM-01) ----------------
// Vive solo en el estado del componente mientras dura la operación: no se
// guarda en IndexedDB ni en localStorage y se borra al terminar.
const CampoPin = ({ id, value, onChange }) => (
  <label htmlFor={id} style={{ display: 'block', marginTop: 6 }}>
    <span className="input-label">Tu PIN de admin (lo verifica el servidor)</span>
    <input
      id={id}
      className="input"
      type="password"
      inputMode="numeric"
      autoComplete="off"
      maxLength={32}
      aria-label="PIN de admin"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  </label>
);

// ---------------- Avisos (AC-COM-6) ----------------
const Avisos = ({ avisos }) => {
  const c = avisos.contadores;
  const filas = [
    ['a', c.a, 'pedido(s) cargado(s) por un vendedor distinto al de la ficha', avisos.cargadoPorOtro.map(l => `${l.clienteNombre} (cargó ${l.cargadoPor})`)],
    ['b', c.b, 'cliente(s) sin vendedor en la ficha', avisos.clienteSinVendedor.map(x => x.clienteNombre)],
    ['c', c.c, 'cliente(s) sin % de comisión (comisión 0)', avisos.clienteSinPct.map(x => x.clienteNombre)],
    ['d', c.d, 'pedido(s) facturado(s) sin marcar como entregado (no se cuentan)', avisos.noEntregados.map(p => p.clienteNombre)],
    ['s', c.sinSincronizar, 'pedido(s) sin sincronizar (bloquean el cierre)', avisos.sinSincronizar.map(p => p.clienteNombre)],
    ['m', c.montoInvalido, 'pedido(s) con total inválido (comisión 0)', avisos.montoInvalido.map(l => l.clienteNombre)],
  ].filter(f => f[1] > 0);
  if (filas.length === 0) return <div className="card" data-testid="avisos" style={{ color: 'var(--success)', fontSize: 13 }}>Sin avisos.</div>;
  return (
    <div className="card" data-testid="avisos" style={{ borderColor: 'var(--warning)' }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>{'⚠️'} Avisos ({c.total})</div>
      {filas.map(([k, n, txt, nombres]) => (
        <div key={k} data-testid={`aviso-${k}`} style={{ fontSize: 13, marginBottom: 4 }}>
          <strong>{n}</strong> {txt}
          {nombres.length > 0 && <span style={{ color: 'var(--text3)' }}>{': '}{[...new Set(nombres)].slice(0, 5).join(', ')}{nombres.length > 5 ? '…' : ''}</span>}
        </div>
      ))}
    </div>
  );
};

// AC-COM-17: texto corto de una asignación confirmada.
const resumenAsignacion = (a) => {
  const partes = a?.partes || [];
  if (a?.modo === 'sin_comision') return 'Sin comisión ✓';
  if (a?.modo === 'dividir' && partes.length === 2) return `Dividido ${partes[0].pct}/${partes[1].pct} ✓ (${partes[0].vendedor} / ${partes[1].vendedor})`;
  return `Asignado a ${partes[0]?.vendedor || '—'} ✓`;
};

// ---------------- Asignación de un pedido (AC-COM-7, AC-COM-8, AC-COM-17) ----------------
const AsignacionPedido = ({ linea, asignacionBorrador, vendedores, onCambiar, onConfirmar }) => {
  const [editando, setEditando] = useState(false);
  const modo = asignacionBorrador?.modo || linea.asignacion?.modo || '';
  const set = (patch) => onCambiar(linea.pedidoId, { ...(asignacionBorrador || {}), modo, ...patch });
  const encabezado = (
    <div style={{ fontWeight: 600 }}>
      {linea.clienteNombre} · {fechaCorta(linea.fecha)} · {pesos(linea.total)} · comisión {pesos(linea.comision)}
    </div>
  );
  if (linea.asignacionConfirmada && !editando) {
    return (
      <div data-testid={`asignacion-${linea.pedidoId}`} data-confirmada="true" style={{ borderTop: '1px solid var(--border)', padding: '8px 0', fontSize: 13 }}>
        {encabezado}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span data-testid={`asignacion-resumen-${linea.pedidoId}`} style={{ color: 'var(--success)' }}>{resumenAsignacion(linea.asignacion)}</span>
          <button type="button" className="btn btn-ghost btn-sm" style={{ width: 'auto' }} onClick={() => setEditando(true)}>Editar</button>
        </div>
      </div>
    );
  }
  return (
    <div data-testid={`asignacion-${linea.pedidoId}`} style={{ borderTop: '1px solid var(--border)', padding: '8px 0', fontSize: 13 }}>
      {encabezado}
      <div style={{ color: 'var(--text3)', marginBottom: 6 }}>
        {linea.sinVendedor ? 'Cliente sin vendedor en la ficha' : `Ficha: ${linea.vendedorFicha}`}
        {linea.cargadoPor ? ` · Cargó: ${linea.cargadoPor}` : ''}
      </div>
      <select
        className="input"
        aria-label={`Asignación del pedido ${linea.pedidoId}`}
        value={modo}
        onChange={(e) => onCambiar(linea.pedidoId, e.target.value ? { modo: e.target.value } : null)}
        style={{ marginBottom: 6 }}
      >
        {linea.sinVendedor && <option value="">Elegir a quién va la comisión…</option>}
        {!linea.sinVendedor && <option value="ficha">100 % a {linea.vendedorFicha} (ficha)</option>}
        {linea.cargadoPor && <option value="cargador">100 % a {linea.cargadoPor} (cargó el pedido)</option>}
        {linea.cargaDeOtro && <option value="dividir">Dividir entre los dos</option>}
        {linea.sinVendedor && <option value="otro">Asignar a un vendedor…</option>}
        <option value="sin_comision">Sin comisión</option>
      </select>
      {modo === 'dividir' && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ flex: 1 }}>
            {linea.vendedorFicha} %
            <input className="input" inputMode="decimal" aria-label="% ficha"
              value={asignacionBorrador?.pctFicha ?? String(CONFIG_COMISIONES.divisionPorDefecto[0])}
              onChange={(e) => set({ pctFicha: e.target.value, pctCargador: asignacionBorrador?.pctCargador ?? String(CONFIG_COMISIONES.divisionPorDefecto[1]) })} />
          </label>
          <label style={{ flex: 1 }}>
            {linea.cargadoPor} %
            <input className="input" inputMode="decimal" aria-label="% cargador"
              value={asignacionBorrador?.pctCargador ?? String(CONFIG_COMISIONES.divisionPorDefecto[1])}
              onChange={(e) => set({ pctCargador: e.target.value, pctFicha: asignacionBorrador?.pctFicha ?? String(CONFIG_COMISIONES.divisionPorDefecto[0]) })} />
          </label>
        </div>
      )}
      {modo === 'otro' && (
        <select className="input" aria-label="Vendedor asignado" value={asignacionBorrador?.vendedor || ''} onChange={(e) => set({ vendedor: e.target.value })}>
          <option value="">Elegir vendedor…</option>
          {/* AC-VEN-3: solo activos (se conserva el ya elegido para no perderlo) */}
          {vendedoresParaSelector(vendedores, asignacionBorrador?.vendedor).map(v => <option key={v.id ?? v.nombre} value={v.nombre}>{v.nombre}</option>)}
        </select>
      )}
      {linea.asignacionErrores && (
        <div role="alert" style={{ color: 'var(--danger)', marginTop: 4 }}>{Object.values(linea.asignacionErrores).join(' · ')}</div>
      )}
      <button
        type="button"
        className="btn btn-primary btn-sm"
        style={{ width: 'auto', marginTop: 6 }}
        disabled={!asignacionLineaValida(linea)}
        onClick={() => { if (onConfirmar(linea.pedidoId)) setEditando(false); }}
      >
        Confirmar asignación
      </button>
    </div>
  );
};

// ---------------- Resumen por vendedor (AC-COM-5) ----------------
const ResumenVendedores = ({ resumen, abierto, setAbierto }) => (
  <div className="card" data-testid="resumen">
    <div style={{ fontWeight: 700, marginBottom: 8 }}>Resumen por vendedor</div>
    {resumen.length === 0 && <div style={{ color: 'var(--text3)', fontSize: 13 }}>No hay comisiones en este período.</div>}
    {resumen.map(v => (
      <div key={v.vendedor} style={{ borderTop: '1px solid var(--border)', padding: '8px 0' }}>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          data-testid={`vendedor-${v.vendedor}`}
          onClick={() => setAbierto(abierto === v.vendedor ? null : v.vendedor)}
          style={{ width: '100%', display: 'flex', justifyContent: 'space-between', textAlign: 'left' }}
        >
          <span><strong>{v.vendedor}</strong> · {v.pedidos} pedidos · {v.clientes} clientes</span>
          <span>{pesos(v.totalVendido)} · <strong>{pesos(v.totalComision)}</strong></span>
        </button>
        {abierto === v.vendedor && (
          <div data-testid={`detalle-${v.vendedor}`} style={{ fontSize: 13, padding: '6px 4px' }}>
            {v.detalle.map(c => (
              <div key={`${c.clienteId}-${c.clienteNombre}`} style={{ marginBottom: 6 }}>
                <div style={{ fontWeight: 600 }}>{c.clienteNombre}</div>
                {c.pedidos.map(p => (
                  <div key={`${p.tipo}-${p.pedidoId}-${p.ajusteSeq || 0}`} style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text2)' }}>
                    <span>
                      {p.tipo === 'ajuste' ? 'Ajuste ' : ''}#{p.pedidoId} · {fechaCorta(p.fecha)} · {p.pct === null || p.pct === undefined ? 'sin %' : `${p.pct} %`}
                      {p.asignacion === 'dividir' ? ` · dividido ${p.division} %` : ''}
                    </span>
                    <span>{pesos(p.total)} → {pesos(p.comision)}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    ))}
  </div>
);

// ---------------- Historial (AC-COM-12, AC-COM-14) ----------------
const Historial = ({ cierres, onPdf, onAnular, procesando }) => {
  const [anulando, setAnulando] = useState(null);
  const [motivo, setMotivo] = useState('');
  const [pin, setPin] = useState('');
  // C2 (AC-COM-12): error del servidor mostrado debajo del formulario, que
  // queda abierto. Se limpia al editar el motivo o el PIN, o con "Volver".
  const [errorAnular, setErrorAnular] = useState(null);
  const cerrarForm = () => { setAnulando(null); setPin(''); setErrorAnular(null); };
  const lista = [...(cierres || [])].sort((a, b) => Number(b.cerradoAt || 0) - Number(a.cerradoAt || 0));
  return (
    <div className="card" data-testid="historial">
      <div style={{ fontWeight: 700, marginBottom: 8 }}>Historial de cierres</div>
      {lista.length === 0 && <div style={{ color: 'var(--text3)', fontSize: 13 }}>Todavía no hay cierres.</div>}
      {lista.map(c => (
        <div key={c.id} data-testid={`cierre-${c.id}`} style={{ borderTop: '1px solid var(--border)', padding: '8px 0', fontSize: 13 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <strong>{fechaCorta(c.desde)} al {fechaCorta(c.hasta)}</strong>
            <span className={`badge ${c.estado === 'vigente' ? 'badge-done' : 'badge-pending'}`}>
              {ESTADO_LABEL[c.estado] || c.estado}{c.anulacionPendiente ? ' (anulación pendiente)' : ''}
            </span>
          </div>
          <div style={{ color: 'var(--text3)' }}>
            Cerrado por {c.cerradoPor || '—'} el {fechaHora(c.cerradoAt)} · {c.totales?.pedidos ?? 0} pedidos · vendido {pesos(c.totales?.totalVendido)} · comisión <strong>{pesos(c.totales?.totalComision)}</strong>
          </div>
          {(c.totales?.porVendedor || []).map(v => (
            <div key={v.vendedor} style={{ color: 'var(--text2)' }}>{v.vendedor}: {pesos(v.totalComision)}</div>
          ))}
          {c.estado === 'anulado' && (
            <div style={{ color: 'var(--danger)' }}>Anulado por {c.anuladoPor || '—'} el {fechaHora(c.anuladoAt)}: {c.motivoAnulacion}</div>
          )}
          {c.estado === 'rechazado' && (
            <div style={{ color: 'var(--danger)' }}>
              No se confirmó en el servidor ({c.motivoRechazo || 'rechazado'}){c.conflictos?.length ? ` · pedidos en otro cierre: ${c.conflictos.join(', ')}` : ''}. No cuenta.
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            {c.estado !== 'rechazado' && (
              <button type="button" className="btn btn-ghost btn-sm" style={{ width: 'auto' }} onClick={() => onPdf(c)}>PDF</button>
            )}
            {c.estado === 'vigente' && !c.anulacionPendiente && anulando !== c.id && (
              <button type="button" className="btn btn-danger btn-sm" style={{ width: 'auto' }} onClick={() => { setAnulando(c.id); setMotivo(''); setPin(''); setErrorAnular(null); }}>Anular</button>
            )}
          </div>
          {anulando === c.id && (() => {
            const estadoBoton = ayudaAnulacion({ motivo, pin, procesando });
            return (
              <div style={{ marginTop: 6 }}>
                <label className="input-label" htmlFor={`motivo-${c.id}`}>Motivo de la anulación (obligatorio)</label>
                <textarea id={`motivo-${c.id}`} className="input" maxLength={300} value={motivo} onChange={(e) => { setMotivo(e.target.value); setErrorAnular(null); }} />
                <CampoPin id={`pin-anular-${c.id}`} value={pin} onChange={(v) => { setPin(v); setErrorAnular(null); }} />
                <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                  <button type="button" className="btn btn-ghost btn-sm" style={{ width: 'auto' }} onClick={cerrarForm}>Volver</button>
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    style={{ width: 'auto' }}
                    disabled={!estadoBoton.habilitado}
                    aria-describedby={estadoBoton.ayuda ? `ayuda-anular-${c.id}` : undefined}
                    onClick={async () => {
                      const pinUsado = pin;
                      setPin('');
                      setErrorAnular(null);
                      const r = await onAnular(c, motivo, pinUsado);
                      if (r?.ok) cerrarForm();
                      else setErrorAnular(r?.mensaje || 'No se pudo anular el cierre.');
                    }}
                  >
                    Confirmar anulación
                  </button>
                </div>
                {estadoBoton.ayuda && (
                  <div id={`ayuda-anular-${c.id}`} data-testid={`ayuda-anular-${c.id}`} style={{ marginTop: 4, fontSize: 12, color: 'var(--text3)' }}>
                    {estadoBoton.ayuda}
                  </div>
                )}
                {errorAnular && (
                  <div role="alert" data-testid={`error-anular-${c.id}`} style={{ marginTop: 4, fontSize: 13, color: 'var(--danger)' }}>
                    {errorAnular}
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      ))}
    </div>
  );
};

// ---------------- Pantalla ----------------
const Comisiones = () => {
  const { vendedorActual, online } = useApp();
  // AC-COM-2 / AC-SEC-4 / S-COM-11: permiso entero validado, solo el número 1
  // (sin Number(): un "1" en texto no habilita la pantalla).
  const esAdmin = puedeVerComisiones(permisoValido(vendedorActual?.permiso));
  const [periodo, setPeriodo] = useState(() => periodoPorDefecto());
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [mensaje, setMensaje] = useState(null);
  const [abierto, setAbierto] = useState(null);
  const [confirmando, setConfirmando] = useState(null); // firma vista
  const [procesando, setProcesando] = useState(false);
  const [pin, setPin] = useState(''); // S-COM-01: solo en memoria durante la confirmación
  const [pinReintento, setPinReintento] = useState('');

  const vp = useMemo(() => validarPeriodo(periodo), [periodo]);

  const cargar = useCallback(async () => {
    if (!esAdmin || !vp.ok) return;
    setCargando(true);
    try {
      setDatos(await cargarDatosComisiones(vp.periodo, { online: !!online }));
    } catch (e) {
      setMensaje({ tipo: 'error', texto: `No se pudieron cargar los datos: ${e?.message || String(e)}` });
    } finally {
      setCargando(false);
    }
  }, [esAdmin, vp, online]);

  useEffect(() => { cargar(); }, [cargar]);

  const dashboard = useMemo(() => (datos ? armarDashboard({ ...datos, periodo: vp.periodo }) : null), [datos, vp]);
  const chequeo = useMemo(() => (dashboard ? puedeCerrar(dashboard) : { ok: false, motivos: [] }), [dashboard]);

  if (!esAdmin) {
    return (
      <div className="page">
        <h1 className="page-title">Comisiones</h1>
        <div className="empty-state">
          <div className="empty-icon">{'⛔'}</div>
          <div className="empty-text">No tenés permisos para ver comisiones</div>
        </div>
      </div>
    );
  }

  const cambiarAsignacion = (pedidoId, input) => {
    if (!datos) return;
    const nb = setAsignacionBorrador(datos.borrador, vp.periodo, pedidoId, input);
    setDatos({ ...datos, borrador: nb });
    // AC-COM-9: el borrador se guarda en IndexedDB al instante (no se pierde al salir).
    guardarBorrador(nb).catch(e => setMensaje({ tipo: 'error', texto: `No se pudo guardar el borrador: ${e?.message || String(e)}` }));
  };

  // AC-COM-17: confirma la asignación de un pedido (solo si es válida) y la
  // guarda en el borrador del período, igual que cambiarAsignacion.
  const confirmarAsignacion = (pedidoId) => {
    if (!datos) return false;
    const pedido = (datos.pedidos || []).find(p => pedidoIdComision(p) === String(pedidoId)) || null;
    const { cliente } = buscarCliente(pedido, datos.clientes);
    const r = confirmarAsignacionBorrador(datos.borrador, vp.periodo, pedidoId, { pedido, cliente, vendedores: datos.vendedores });
    if (!r.ok) {
      setMensaje({ tipo: 'error', texto: `No se pudo confirmar la asignación: ${Object.values(r.errores).join(' · ')}` });
      return false;
    }
    setDatos({ ...datos, borrador: r.borrador });
    guardarBorrador(r.borrador).catch(e => setMensaje({ tipo: 'error', texto: `No se pudo guardar el borrador: ${e?.message || String(e)}` }));
    return true;
  };

  const confirmar = async () => {
    setProcesando(true);
    const pinUsado = pin;
    setPin('');
    try {
      const r = await confirmarCierre({ periodo: vp.periodo, borrador: datos.borrador, firmaVista: confirmando, pin: pinUsado });
      setConfirmando(null);
      setMensaje({ tipo: r.ok ? 'ok' : 'error', texto: r.ok ? 'Cierre confirmado.' : r.mensaje });
      await cargar();
    } finally {
      setProcesando(false);
    }
  };

  const anular = async (cierre, motivo, pinAnular) => {
    setProcesando(true);
    try {
      const r = await anularCierre(cierre, motivo, pinAnular);
      setMensaje({ tipo: r.ok ? 'ok' : 'error', texto: r.ok ? 'Cierre anulado: sus pedidos vuelven a estar disponibles.' : r.mensaje });
      await cargar();
      // C2: { ok, mensaje } para que el Historial muestre el error inline.
      return { ok: !!r.ok, mensaje: r.ok ? null : r.mensaje };
    } catch (err) {
      // BUG-COM-01: si el servicio lanza (p. ej. un error de IndexedDB), el
      // error se muestra inline en el formulario en vez de perderse.
      const texto = `No se pudo anular el cierre: ${err?.message || String(err)}`;
      setMensaje({ tipo: 'error', texto });
      return { ok: false, mensaje: texto };
    } finally {
      setProcesando(false);
    }
  };

  // S-COM-01: cierres/anulaciones sin confirmar por el servidor. El sync en
  // segundo plano no los reenvía (no guarda el PIN): se reintentan acá.
  const reintentar = async () => {
    setProcesando(true);
    const pinUsado = pinReintento;
    setPinReintento('');
    try {
      const r = await syncComisiones({ pin: pinUsado });
      const ok = r?.ok && !r?.pendientes;
      setMensaje({ tipo: ok ? 'ok' : 'error', texto: ok ? 'Pendientes confirmados con el servidor.' : (r?.mensaje || 'Quedan operaciones sin confirmar: revisá la conexión y reintentá.') });
      await cargar();
    } catch (e) {
      setMensaje({ tipo: 'error', texto: `No se pudo reintentar: ${e?.message || String(e)}` });
    } finally {
      setProcesando(false);
    }
  };

  const verPdf = async (cierre) => {
    const w = window.open('', '_blank');
    try {
      const file = await generarCierreComisionesFile(cierre);
      const url = URL.createObjectURL(file);
      if (w) w.location.href = url;
      else window.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      if (w) w.close();
      setMensaje({ tipo: 'error', texto: `No se pudo generar el PDF: ${e?.message || String(e)}` });
    }
  };

  const asign = datos?.borrador?.asignaciones || {};
  const pendientesServidor = contarPendientesServidor(datos?.cierres);
  const aRevisar = (dashboard?.lineas || []).filter(l => l.cargaDeOtro || l.sinVendedor || l.asignacionEditada);

  return (
    <div className="page">
      <h1 className="page-title">Comisiones</h1>

      <div className="card">
        <div style={{ display: 'flex', gap: 8 }}>
          <label style={{ flex: 1 }}>
            <span className="input-label">Desde</span>
            <input className="input" type="date" aria-label="Desde" value={periodo.desde} onChange={(e) => setPeriodo(p => ({ ...p, desde: e.target.value }))} />
          </label>
          <label style={{ flex: 1 }}>
            <span className="input-label">Hasta</span>
            <input className="input" type="date" aria-label="Hasta" value={periodo.hasta} onChange={(e) => setPeriodo(p => ({ ...p, hasta: e.target.value }))} />
          </label>
        </div>
        {!vp.ok && <div role="alert" style={{ color: 'var(--danger)', fontSize: 13 }}>{Object.values(vp.errores).join(' · ')}</div>}
        <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 6 }}>
          Cuentan los pedidos facturados y {CONFIG_COMISIONES.criterioEntregado === 'aReparto' ? 'marcados "A reparto"' : 'marcados como entregados'}, por fecha del pedido, que no estén en un cierre vigente.
        </div>
        {(!online || datos?.incompleto) && (
          <div style={{ fontSize: 12, color: 'var(--warning)', marginTop: 6 }}>
            Datos posiblemente incompletos (sin conexión o sin actualizar). Conectate para cerrar.
          </div>
        )}
        {datos?.faltaMigracion && <div role="alert" style={{ fontSize: 12, color: 'var(--danger)', marginTop: 6 }}>Falta correr la migración 003 en Supabase: no se puede cerrar todavía.</div>}
      </div>

      {mensaje && (
        <div className="card" role="status" style={{ color: mensaje.tipo === 'ok' ? 'var(--success)' : 'var(--danger)', fontSize: 13 }}>{mensaje.texto}</div>
      )}

      {pendientesServidor > 0 && (
        <div className="card" data-testid="pendientes-servidor" style={{ borderColor: 'var(--warning)', fontSize: 13 }}>
          <div><strong>{pendientesServidor}</strong> cierre(s) o anulación(es) sin confirmar en el servidor. Mientras tanto, sus pedidos siguen contando como cerrados.</div>
          <CampoPin id="pin-reintento" value={pinReintento} onChange={setPinReintento} />
          <button
            type="button"
            className="btn btn-primary btn-sm"
            style={{ width: 'auto', marginTop: 6 }}
            disabled={procesando || !online || !pinReintento.trim()}
            onClick={reintentar}
          >
            Reintentar con el servidor
          </button>
        </div>
      )}

      {cargando && !dashboard && <div className="card">Cargando…</div>}

      {dashboard && (
        <>
          <Avisos avisos={dashboard.avisos} />

          <div className="card" data-testid="totales" style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <span>{dashboard.totales.pedidos} pedidos · {dashboard.totales.clientes} clientes</span>
            <span>Vendido {pesos(dashboard.totales.totalVendido)} · Comisión <strong>{pesos(dashboard.totales.totalComision)}</strong></span>
          </div>

          <ResumenVendedores resumen={dashboard.resumenPorVendedor} abierto={abierto} setAbierto={setAbierto} />

          {aRevisar.length > 0 && (
            <div className="card" data-testid="a-revisar">
              <div style={{ fontWeight: 700 }}>Pedidos para asignar ({aRevisar.length})</div>
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>Las asignaciones se guardan como borrador del período hasta cerrar. Confirmá cada una para sacarla de los avisos.</div>
              {aRevisar.map(l => (
                <AsignacionPedido key={l.pedidoId} linea={l} asignacionBorrador={asign[l.pedidoId]} vendedores={datos.vendedores} onCambiar={cambiarAsignacion} onConfirmar={confirmarAsignacion} />
              ))}
            </div>
          )}

          {dashboard.ajustes.length > 0 && (
            <div className="card" data-testid="ajustes">
              <div style={{ fontWeight: 700 }}>Ajustes pendientes ({dashboard.ajustes.length})</div>
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>Pedidos ya cerrados que cambiaron después. Se incluyen en este cierre.</div>
              {dashboard.ajustes.map(a => (
                <div key={`${a.pedidoId}-${a.ajusteSeq}`} style={{ fontSize: 13, borderTop: '1px solid var(--border)', padding: '6px 0' }}>
                  {a.clienteNombre} · #{a.pedidoId} · cerrado {pesos(a.comisionCerrada)} → ahora {pesos(a.comisionActual)} ·{' '}
                  <strong style={{ color: a.diferencia < 0 ? 'var(--danger)' : 'var(--success)' }}>{a.diferencia > 0 ? '+' : ''}{pesos(a.diferencia)}</strong>
                  {a.motivo === 'ya_no_cuenta' ? ' (ya no cuenta: revertido, borrado o desmarcado)' : ''}
                </div>
              ))}
            </div>
          )}

          <div className="card">
            {!chequeo.ok && (
              <ul data-testid="motivos-bloqueo" style={{ color: 'var(--danger)', fontSize: 13, margin: '0 0 8px', paddingLeft: 18 }}>
                {chequeo.motivos.map(m => <li key={m}>{m}</li>)}
              </ul>
            )}
            <button
              type="button"
              className="btn btn-primary"
              disabled={!chequeo.ok || !online || procesando || datos?.faltaMigracion}
              onClick={() => { setPin(''); setConfirmando(firmaDashboard(dashboard)); }}
            >
              Cerrar comisiones
            </button>
          </div>

          {confirmando && (
            <div className="card" role="dialog" aria-label="Confirmar cierre" data-testid="confirmacion" style={{ borderColor: 'var(--primary)' }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>¿Cerrar comisiones del {fechaCorta(vp.periodo.desde)} al {fechaCorta(vp.periodo.hasta)}?</div>
              {dashboard.resumenPorVendedor.map(v => (
                <div key={v.vendedor} style={{ fontSize: 13, display: 'flex', justifyContent: 'space-between' }}>
                  <span>{v.vendedor} ({v.pedidos} pedidos)</span><strong>{pesos(v.totalComision)}</strong>
                </div>
              ))}
              <div style={{ fontSize: 13, marginTop: 6 }}>Total comisión: <strong>{pesos(dashboard.totales.totalComision)}</strong></div>
              <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>Una vez cerrado no se puede editar (solo anular con motivo).</div>
              <CampoPin id="pin-cierre" value={pin} onChange={setPin} />
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button type="button" className="btn btn-ghost" onClick={() => { setPin(''); setConfirmando(null); }} disabled={procesando}>Volver</button>
                <button type="button" className="btn btn-primary" onClick={confirmar} disabled={procesando || !pin.trim()}>{procesando ? 'Cerrando…' : 'Confirmar cierre'}</button>
              </div>
            </div>
          )}

          <Historial cierres={datos.cierres} onPdf={verPdf} onAnular={anular} procesando={procesando} />
        </>
      )}
    </div>
  );
};

export default Comisiones;
