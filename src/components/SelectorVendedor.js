import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../hooks/useAppContext';
import { addVendedor, markVendedorSynced } from '../db';
import { syncVendedor, downloadVendedores } from '../sync/syncService';
import { iniciarIngreso, ingresarConPin } from '../services/vendedoresService';
import { tienePin, filtrarActivos, validarNombreNuevoVendedor, MSG_SIN_CONEXION } from '../domain/vendedores';

const SelectorVendedor = () => {
  const { vendedores, seleccionarVendedor, recargar, online } = useApp();
  const [nuevoNombre, setNuevoNombre] = useState('');
  const [nuevaZona, setNuevaZona] = useState('');
  const [mostrarForm, setMostrarForm] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [altaError, setAltaError] = useState(null);

  const [pinVendedor, setPinVendedor] = useState(null);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState(null);
  const [verificandoPin, setVerificandoPin] = useState(false);
  // Error del ingreso fuera del modal (sin conexion, usuario sin sincronizar...).
  const [ingresoError, setIngresoError] = useState(null);
  const [ingresando, setIngresando] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncErr, setSyncErr] = useState(null);
  // Evita loop infinito: solo intenta el auto-sync una vez por montaje.
  const autoSyncDone = useRef(false);

  const syncVendedoresNow = useCallback(async () => {
    if (!online) return;
    setSyncing(true);
    setSyncErr(null);
    try {
      await downloadVendedores();
      await recargar();
    } catch (e) {
      setSyncErr(e?.message || String(e));
    } finally {
      setSyncing(false);
    }
  }, [online, recargar]);

  useEffect(() => {
    // Si el usuario borro cache/IndexedDB, la lista queda vacia.
    // Traer vendedores una sola vez al montar (no en cada cambio de estado).
    if ((vendedores || []).length > 0) return;
    if (!online) return;
    if (autoSyncDone.current) return;
    autoSyncDone.current = true;
    syncVendedoresNow();
  }, [online]); // eslint-disable-line

  const handleAgregar = async () => {
    if (!nuevoNombre.trim()) return;
    // S-VEN-01: no se puede crear un vendedor con el nombre de otro (activo o
    // dado de baja): pedidos y comisiones se atribuyen por nombre.
    const chk = validarNombreNuevoVendedor(nuevoNombre, vendedores);
    if (!chk.ok) { setAltaError(chk.mensaje); return; }
    setAltaError(null);
    setGuardando(true);
    try {
      const localId = await addVendedor({
        nombre: nuevoNombre.trim(),
        zona: nuevaZona.trim(),
        permiso: 2,
        tienePin: false,
      });

      try {
        // Auto-alta: vendedor comun sin PIN (S-COM-13: nunca se manda pin).
        const remoteId = await syncVendedor({
          nombre: nuevoNombre.trim(),
          zona: nuevaZona.trim(),
        });
        await markVendedorSynced(localId, remoteId);
      } catch (e) {
        console.warn('No se pudo sincronizar vendedor:', e?.message || String(e));
      }

      await recargar();
      setNuevoNombre('');
      setNuevaZona('');
      setMostrarForm(false);
    } finally {
      setGuardando(false);
    }
  };

  const initials = (n) => String(n || '')
    .split(' ')
    .filter(Boolean)
    .map(p => p[0])
    .join('')
    .substring(0, 2)
    .toUpperCase();

  // S-COM-13 (decision del dueño): el ingreso es 100 % online. El PIN se
  // verifica SOLO en el servidor (rpc verificar_pin); nunca se compara contra
  // nada guardado en el dispositivo. Una sesion ya iniciada sigue funcionando
  // offline (useAppContext la restaura); lo que pide conexion es entrar de nuevo.
  const trySelect = async (v) => {
    if (ingresando) return;
    setIngresoError(null);
    if (!online) { setIngresoError(MSG_SIN_CONEXION); return; }
    setIngresando(true);
    try {
      const r = await iniciarIngreso(v, { online });
      // C5 / S-COM-18: la sesión se abre con el registro que devuelve el
      // servicio (datos del servidor), nunca con el `v` local.
      if (r.accion === 'entrar') {
        if (r.vendedor) seleccionarVendedor(r.vendedor);
        else setIngresoError('No se pudo ingresar.');
        return;
      }
      if (r.accion === 'pedir_pin') {
        setPinVendedor(v);
        setPin('');
        setPinError(null);
        return;
      }
      setIngresoError(r.mensaje || 'No se pudo ingresar.');
    } finally {
      setIngresando(false);
    }
  };

  const cerrarPin = () => { setPinVendedor(null); setPin(''); setPinError(null); };

  const confirmarPin = async () => {
    if (!pinVendedor) return;
    const pinTipeado = String(pin || '').trim();
    if (!pinTipeado) { setPinError('Ingresá tu PIN'); return; }
    // El PIN sale del estado antes de llamar: no queda en memoria del componente.
    setPin('');
    setVerificandoPin(true);
    setPinError(null);
    try {
      // C5 / S-COM-18: verifica el PIN y lee la fila del servidor por el mismo
      // remoteId; la sesión sale de esa fila (nombre y permiso reales).
      const r = await ingresarConPin(pinVendedor, pinTipeado, { online });
      if (!r.ok || !r.vendedor) {
        setPinError(r.mensaje || 'No se pudo ingresar.');
        return;
      }
      seleccionarVendedor(r.vendedor);
      setPinVendedor(null);
    } finally {
      setVerificandoPin(false);
    }
  };

  return (
    <div className="selector-overlay">
      <div className="selector-logo">D</div>
      <h1 className="selector-title">Distribuidora</h1>
      <p className="selector-sub">Quien sos? Elegi tu nombre para comenzar</p>

      <div className="vendedor-list">
        {online && (
          <div style={{ marginBottom: 10 }}>
            <button className="btn btn-ghost btn-sm" onClick={syncVendedoresNow} disabled={syncing}>
              {syncing ? 'Sincronizando...' : 'Sincronizar vendedores'}
            </button>
            {syncErr && (
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--danger)' }}>
                {syncErr}
              </div>
            )}
          </div>
        )}
        {!online && (
          <div data-testid="ingreso-offline" style={{ marginBottom: 10, fontSize: 13, color: 'var(--danger)' }}>
            {MSG_SIN_CONEXION}
          </div>
        )}
        {ingresoError && online && (
          <div data-testid="ingreso-error" style={{ marginBottom: 10, fontSize: 13, color: 'var(--danger)' }}>
            {ingresoError}
          </div>
        )}
        {/* AC-VEN-3: los dados de baja no aparecen en el ingreso */}
        {filtrarActivos(vendedores).map(v => (
          <button key={v.id} className="vendedor-option" onClick={() => trySelect(v)} disabled={ingresando}>
            <div className="vendedor-avatar">{initials(v.nombre)}</div>
            <div className="vendedor-info">
              <div className="vendedor-name">{v.nombre}</div>
              {v.zona && <div className="vendedor-zona">Zona: {v.zona}</div>}
            </div>
            {tienePin(v) && <span style={{ color: 'var(--text3)', fontSize: 14, marginRight: 6 }}>{'\u{1F512}'}</span>}
            <span style={{ color: 'var(--text3)', fontSize: 20 }}>{'\u203A'}</span>
          </button>
        ))}

        {!mostrarForm ? (
          <button className="btn btn-ghost" onClick={() => setMostrarForm(true)} style={{ marginTop: 8 }}>
            + Agregar vendedor
          </button>
        ) : (
          <div className="card" style={{ margin: 0 }}>
            <div className="input-group">
              <label className="input-label">Nombre</label>
              <input
                className="input"
                value={nuevoNombre}
                onChange={e => { setNuevoNombre(e.target.value); setAltaError(null); }}
                placeholder="Ej: Carlos Rodriguez"
                autoFocus
              />
              {altaError && (
                <div role="alert" data-testid="alta-vendedor-error" style={{ marginTop: 6, fontSize: 12, color: 'var(--danger)' }}>
                  {altaError}
                </div>
              )}
            </div>
            <div className="input-group">
              <label className="input-label">Zona (opcional)</label>
              <input
                className="input"
                value={nuevaZona}
                onChange={e => setNuevaZona(e.target.value)}
                placeholder="Ej: Norte"
              />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setMostrarForm(false)} disabled={guardando}>
                Cancelar
              </button>
              <button className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={handleAgregar} disabled={guardando}>
                {guardando ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        )}
      </div>

      {pinVendedor && (
        <div className="modal-overlay">
          <div className="card" style={{ width: 'min(420px, 92vw)' }}>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>Ingresar PIN</div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 12 }}>
              Vendedor: {pinVendedor.nombre}
            </div>
            <input
              className="input"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={pin}
              onChange={e => setPin(e.target.value)}
              placeholder="PIN..."
              autoFocus
            />
            {pinError && (
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--danger)' }}>{pinError}</div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button
                className="btn btn-ghost btn-sm"
                onClick={cerrarPin}
                disabled={verificandoPin}
              >
                Cancelar
              </button>
              <button className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={confirmarPin} disabled={verificandoPin}>
                {verificandoPin ? 'Verificando...' : 'Entrar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SelectorVendedor;
