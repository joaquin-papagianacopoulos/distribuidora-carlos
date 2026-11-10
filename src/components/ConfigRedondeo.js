// src/components/ConfigRedondeo.js — REQ-RED (AC-RED-1).
// Tarjeta "Redondeo del total": Sin redondeo / $500 / $1000 (default $500). Solo admin, con PIN y online:
// se guarda en Supabase (RPC admin_guardar_redondeo) y se cachea en el dispositivo.
// El ajuste vale para los pedidos que se facturen desde ahora; los ya facturados conservan el suyo.
import React, { useState } from 'react';
import { useApp } from '../hooks/useAppContext';
import { guardarRedondeo, leerRedondeoLocal } from '../services/ajustesService';
import { normalizarMultiplo } from '../domain/redondeo';

const OPCIONES = [
  { valor: 0, etiqueta: 'Sin redondeo' },
  { valor: 500, etiqueta: 'Redondear a $500' },
  { valor: 1000, etiqueta: 'Redondear a $1000' },
];

const ConfigRedondeo = ({ online = true }) => {
  const { vendedorActual, redondeoTotal, setRedondeoTotal } = useApp();
  const esAdmin = Number(vendedorActual?.permiso || 2) === 1;
  const vigente = normalizarMultiplo(redondeoTotal ?? leerRedondeoLocal());
  const [elegido, setElegido] = useState(vigente);
  const [pin, setPin] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState(null);

  if (!esAdmin) return null;

  const guardar = async () => {
    setMsg(null);
    setGuardando(true);
    try {
      const r = await guardarRedondeo(pin, elegido);
      if (r.ok) {
        if (typeof setRedondeoTotal === 'function') setRedondeoTotal(r.redondeoTotal);
        setPin('');
        setMsg({ ok: true, texto: 'Redondeo guardado. Rige para los pedidos que se facturen desde ahora.' });
      } else {
        setMsg({ ok: false, texto: r.mensaje });
      }
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="card" data-testid="config-redondeo">
      <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 14 }}>Remito: redondeo del total</div>
      <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 10, lineHeight: 1.5 }}>
        Al facturar, el total a cobrar se redondea al múltiplo elegido (la diferencia se muestra como "Redondeo" en el remito).
        Las comisiones y el reporte del contador siguen calculándose sobre los renglones.
      </div>
      {OPCIONES.map(o => (
        <label key={o.valor} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 14 }}>
          <input
            type="radio"
            name="redondeo-total"
            checked={elegido === o.valor}
            onChange={() => { setElegido(o.valor); setMsg(null); }}
          />
          {o.etiqueta}{o.valor === vigente ? ' (vigente)' : ''}
        </label>
      ))}
      <label className="input-label" htmlFor="pin-redondeo" style={{ marginTop: 10 }}>PIN de administrador</label>
      <input
        id="pin-redondeo"
        className="input"
        type="password"
        inputMode="numeric"
        autoComplete="off"
        data-testid="pin-redondeo"
        value={pin}
        onChange={e => setPin(e.target.value)}
        style={{ marginBottom: 10 }}
      />
      {!online && <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 8 }}>Para cambiar el redondeo necesitás conexión.</div>}
      <button className="btn btn-primary" onClick={guardar} disabled={guardando || !online || elegido === vigente || !pin}>
        {guardando ? 'Guardando...' : 'Guardar redondeo'}
      </button>
      {msg && (
        <div role="status" style={{ fontSize: 13, marginTop: 8, color: msg.ok ? 'var(--green, #2e7d32)' : 'var(--red, #c62828)' }}>{msg.texto}</div>
      )}
    </div>
  );
};

export default ConfigRedondeo;
