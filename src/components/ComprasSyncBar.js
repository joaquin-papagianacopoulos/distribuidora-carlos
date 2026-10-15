// src/components/ComprasSyncBar.js — REQ-INA / REQ-CPR. SOLO ADMIN.
// Sube/baja los datos de compras (costos de ingresos, cuenta con proveedores, pedidos al proveedor
// y comprobantes) con el PIN del admin. El PIN vive solo en este estado: se borra al usar, no se
// guarda ni se loguea. Sin conexion o sin PIN, todo sigue guardado en este dispositivo.
import React, { useCallback, useEffect, useState } from 'react';
import { credencialesAdminProductos } from '../services/productosAdminService';
import {
  contarComprasPendientes, subirCompras, subirComprobantes, bajarCompras, sondearMigracion012,
} from '../services/comprasService';
import { bajarCostosProductos } from '../services/costosProductosService';

const ComprasSyncBar = ({ onDone, bajar = true }) => {
  const [pin, setPin] = useState('');
  const [msg, setMsg] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [pend, setPend] = useState(0);
  const [falta, setFalta] = useState(false);

  const contar = useCallback(async () => {
    try { setPend((await contarComprasPendientes()).total); } catch { setPend(0); }
  }, []);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const c = await contarComprasPendientes();
        if (vivo) setPend(c.total);
        if (typeof navigator === 'undefined' || navigator.onLine !== false) {
          const s = await sondearMigracion012();
          if (vivo) setFalta(!!s.faltaMigracion);
        }
      } catch { /* sin stores o sin red: se muestra sin contador */ }
    })();
    return () => { vivo = false; };
  }, []);

  const conCredenciales = async (fn) => {
    setMsg('');
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { setMsg('Sin conexión: los datos siguen guardados en este dispositivo.'); return; }
    const cr = await credencialesAdminProductos(pin);
    if (!cr.ok) { setMsg(cr.mensaje || 'Ingresá tu PIN de administrador.'); return; }
    setPin('');
    setOcupado(true);
    try {
      await fn(cr.cred);
    } catch {
      setMsg('No se pudo completar la operación. Probá de nuevo con conexión.');
    } finally {
      setOcupado(false);
      await contar();
      if (onDone) await onDone();
    }
  };

  const subir = () => conCredenciales(async (cred) => {
    const c = await subirComprobantes(cred);
    if (!c.ok) { setFalta(c.faltaMigracion === true); setMsg(c.mensaje || 'No se pudieron subir los comprobantes.'); return; }
    const r = await subirCompras(cred);
    if (!r.ok) { setFalta(r.faltaMigracion === true); setMsg(r.mensaje || 'No se pudo subir.'); return; }
    const total = r.subidos.costos + r.subidos.cuenta + r.subidos.pedidos;
    const rech = r.rechazados.length;
    setMsg(`Subido: ${total} registro(s)${c.subidos ? `, ${c.subidos} comprobante(s)` : ''}.${rech ? ` ${rech} quedaron pendientes (se reintentan).` : ''}`);
  });

  const bajarTodo = () => conCredenciales(async (cred) => {
    const r = await bajarCompras(cred);
    if (!r.ok) { setFalta(r.faltaMigracion === true); setMsg(r.mensaje || 'No se pudo bajar.'); return; }
    const n = r.bajados.costos + r.bajados.cuenta + r.bajados.pedidos;
    setMsg(`Actualizado desde otros dispositivos: ${n} registro(s).`);
    // S-012-01: los costos de productos bajan solo con PIN (migracion 013). Sin la 013 no hace nada.
    await bajarCostosProductos(cred);
  });

  return (
    <div className="card" style={{ padding: '12px 14px', marginBottom: 14 }} data-testid="compras-sync">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
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
        <button className="btn btn-primary btn-sm" style={{ width: 'auto' }} disabled={ocupado} onClick={subir}>
          {`Subir datos de compras (${pend} pendientes)`}
        </button>
        {bajar && (
          <button className="btn btn-ghost btn-sm" style={{ width: 'auto' }} disabled={ocupado} onClick={bajarTodo}>
            Bajar de otros dispositivos
          </button>
        )}
      </div>
      {falta && <div role="alert" style={{ marginTop: 8, fontSize: 13, color: 'var(--warning)', fontWeight: 700 }}>Falta la migración 012 en Supabase: los datos de compras siguen guardados en este dispositivo.</div>}
      {msg && <div role="status" style={{ marginTop: 8, fontSize: 13 }}>{msg}</div>}
    </div>
  );
};

export default ComprasSyncBar;
