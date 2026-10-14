// src/components/ComisionRubroGrid.js — REQ-COMR (AC-COMR-6, 8, 11).
// Grilla Rubro -> % de un vendedor (solo admin). Valida cada fila con el
// dominio (validarPctRubro) y guarda con el servicio. Sin cálculos propios.
// El PIN (opcional, para subir al servidor) vive solo en el estado mientras
// dura el guardado: no se guarda en IndexedDB ni en localStorage.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { filasGrillaVendedor, validarPctRubro, claveRubro } from '../domain/rubros';
import { cargarTablaRubros, guardarPctsVendedor } from '../services/comisionesRubroService';

const pctTexto = (pct) => (pct === null || pct === undefined ? '' : String(pct).replace('.', ','));
const MOTIVO_RECHAZO = {
  vendedor_inactivo: 'el vendedor está dado de baja',
  vendedor_inexistente: 'el vendedor no existe en el servidor',
  id_en_uso: 'registro duplicado',
  fila_invalida: 'dato inválido',
};

const ComisionRubroGrid = ({ vendedor, rubros = [], rubroFoco = null, online = true, onGuardado, onCerrar }) => {
  const [filas, setFilas] = useState([]);
  const [textos, setTextos] = useState({});
  const [pin, setPin] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState(null);
  const [erroresServicio, setErroresServicio] = useState({});
  const cont = useRef(null);
  const vendedorId = vendedor?.remoteId === null || vendedor?.remoteId === undefined || vendedor?.remoteId === '' ? null : String(vendedor.remoteId);
  const habilitada = !!vendedorId;

  const cargar = useCallback(async () => {
    try { setFilas(await cargarTablaRubros()); } catch (e) { setMensaje({ tipo: 'error', texto: `No se pudieron leer los %: ${e?.message || String(e)}` }); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const grilla = useMemo(() => filasGrillaVendedor({ vendedorId, rubros, filas }), [vendedorId, rubros, filas]);

  useEffect(() => {
    setTextos(Object.fromEntries(grilla.map(f => [f.clave, pctTexto(f.pct)])));
  }, [grilla]);

  useEffect(() => {
    if (!rubroFoco || !cont.current) return;
    const el = cont.current.querySelector(`[data-clave="${claveRubro(rubroFoco)}"]`);
    if (el && typeof el.focus === 'function') el.focus();
  }, [rubroFoco, grilla]);

  const errores = useMemo(() => {
    const out = {};
    for (const f of grilla) {
      const v = validarPctRubro(textos[f.clave] ?? '');
      if (!v.ok) out[f.clave] = v.error;
    }
    return out;
  }, [grilla, textos]);

  const cambios = grilla.filter(f => (textos[f.clave] ?? '') !== pctTexto(f.pct));
  const hayErrores = Object.keys(errores).length > 0;

  const guardar = async () => {
    if (hayErrores || cambios.length === 0) return;
    setGuardando(true);
    setMensaje(null);
    setErroresServicio({});
    const pinUsado = pin;
    setPin('');
    try {
      const r = await guardarPctsVendedor({
        vendedor,
        cambios: cambios.map(f => ({ rubro: f.rubro, pct: textos[f.clave] ?? '' })),
        pin: pinUsado,
        online,
      });
      if (!r.ok) {
        setErroresServicio(r.errores || {});
        setMensaje({ tipo: 'error', texto: r.mensaje || 'No se pudieron guardar los %.' });
      } else {
        setMensaje({ tipo: r.sync && !r.sync.ok ? 'error' : 'ok', texto: r.mensaje || 'Guardado.' });
        await cargar();
        if (onGuardado) onGuardado(r);
      }
    } catch (e) {
      setMensaje({ tipo: 'error', texto: `No se pudieron guardar los %: ${e?.message || String(e)}` });
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="card" data-testid="comision-rubro-grid" ref={cont} style={{ marginTop: 12 }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>% de comisión por rubro · {vendedor?.nombre || '—'}</div>
      {!habilitada && (
        <div role="alert" data-testid="grid-sin-id" style={{ color: 'var(--warning)', fontSize: 13, marginBottom: 8 }}>
          Sincronizá el vendedor primero: todavía no tiene id en el servidor.
        </div>
      )}
      <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 8 }}>
        Vacío = sin % (sus ventas de ese rubro comisionan 0 y aparece un aviso). Acepta coma decimal, hasta 2 decimales.
      </div>
      {grilla.length === 0 && <div style={{ fontSize: 13, color: 'var(--text3)' }}>Todavía no hay rubros cargados en los productos.</div>}
      {grilla.map(f => (
        <div key={f.clave} data-testid={`fila-rubro-${f.clave}`} style={{ display: 'flex', alignItems: 'center', gap: 8, borderTop: '1px solid var(--border)', padding: '6px 0' }}>
          <label htmlFor={`pct-${f.clave}`} style={{ flex: 1, fontSize: 14 }}>
            {f.rubro}
            {f.pendiente && <span data-testid={`pendiente-${f.clave}`} style={{ marginLeft: 6, fontSize: 11, color: 'var(--warning)' }}>sin sincronizar</span>}
            {f.rechazo && <span data-testid={`rechazo-${f.clave}`} style={{ marginLeft: 6, fontSize: 11, color: 'var(--danger)' }}>rechazado: {MOTIVO_RECHAZO[f.rechazo] || f.rechazo}</span>}
          </label>
          <div style={{ width: 110 }}>
            <input
              id={`pct-${f.clave}`}
              data-clave={f.clave}
              className="input"
              inputMode="decimal"
              autoComplete="off"
              aria-label={`% ${f.rubro}`}
              aria-invalid={errores[f.clave] || erroresServicio[f.rubro] ? 'true' : 'false'}
              disabled={!habilitada || guardando}
              value={textos[f.clave] ?? ''}
              onChange={e => { const v = e.target.value; setTextos(prev => ({ ...prev, [f.clave]: v })); }}
            />
            {(errores[f.clave] || erroresServicio[f.rubro]) && (
              <div role="alert" data-error-for={`pct-${f.clave}`} style={{ color: 'var(--danger)', fontSize: 11, marginTop: 2 }}>
                {errores[f.clave] || erroresServicio[f.rubro]}
              </div>
            )}
          </div>
        </div>
      ))}
      {habilitada && (
        <label htmlFor={`pin-rubro-${vendedorId}`} style={{ display: 'block', marginTop: 8 }}>
          <span className="input-label">Tu PIN de admin (opcional: para subir ya al servidor)</span>
          <input
            id={`pin-rubro-${vendedorId}`}
            className="input"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={32}
            aria-label="PIN de admin para los %"
            value={pin}
            onChange={e => setPin(e.target.value)}
          />
        </label>
      )}
      {mensaje && (
        <div role="status" data-testid="grid-mensaje" style={{ marginTop: 6, fontSize: 13, color: mensaje.tipo === 'ok' ? 'var(--success)' : 'var(--danger)' }}>{mensaje.texto}</div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        {onCerrar && <button type="button" className="btn btn-ghost btn-sm" style={{ width: 'auto' }} onClick={onCerrar}>Cerrar</button>}
        <button
          type="button"
          className="btn btn-primary btn-sm"
          style={{ width: 'auto' }}
          disabled={!habilitada || guardando || hayErrores || cambios.length === 0}
          onClick={guardar}
        >
          {guardando ? 'Guardando…' : 'Guardar %'}
        </button>
      </div>
    </div>
  );
};

export default ComisionRubroGrid;
