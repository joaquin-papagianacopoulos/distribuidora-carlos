// src/components/LinksTienda.js — REQ-WEB (AC-WEB-7): links de tienda por vendedor.
// Generar, copiar y regenerar. El PIN del admin solo vive en este estado.
import React, { useState } from 'react';
import { listarLinks, obtenerLink } from '../services/tiendaLinksService';

const LinksTienda = ({ vendedores = [], online = true }) => {
  const [pin, setPin] = useState('');
  const [links, setLinks] = useState({});
  const [msg, setMsg] = useState('');
  const [ocupado, setOcupado] = useState(null);

  const cargar = async () => {
    setOcupado('lista'); setMsg('');
    const r = await listarLinks(pin);
    setOcupado(null);
    if (!r.ok) { setMsg(r.mensaje); return; }
    setLinks(r.links);
    setMsg('Links cargados.');
  };

  const generar = async (v, regenerar) => {
    if (regenerar && !window.confirm(`El link actual de ${v.nombre} deja de funcionar. ¿Regenerar?`)) return;
    setOcupado(String(v.remoteId)); setMsg('');
    const r = await obtenerLink(pin, v.remoteId, { regenerar });
    setOcupado(null);
    if (!r.ok) { setMsg(r.mensaje); return; }
    setLinks(prev => ({ ...prev, [String(v.remoteId)]: r.link }));
    setMsg(regenerar ? 'Link regenerado: el anterior ya no funciona.' : 'Link listo.');
  };

  const copiar = async (link) => {
    try { await navigator.clipboard.writeText(link); setMsg('Link copiado.'); }
    catch { setMsg('No se pudo copiar: seleccionalo y copialo a mano.'); }
  };

  return (
    <div className="card" style={{ marginTop: 16 }} data-testid="links-tienda">
      <div style={{ fontWeight: 700, marginBottom: 8 }}>Links de la tienda por vendedor</div>
      <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 10 }}>
        Cada vendedor tiene un link propio: los pedidos que entren por él quedan a su nombre.
      </div>
      <div className="input-group">
        <label className="input-label">Tu PIN de admin</label>
        <input className="input" type="password" inputMode="numeric" autoComplete="off" data-testid="pin-links"
          value={pin} onChange={e => setPin(e.target.value)} placeholder="Se verifica en el servidor" />
      </div>
      <button type="button" className="btn btn-ghost btn-sm" style={{ width: 'auto', marginBottom: 10 }}
        disabled={!online || ocupado === 'lista'} onClick={cargar} data-testid="cargar-links">Ver links existentes</button>
      {vendedores.map(v => {
        const link = links[String(v.remoteId)];
        return (
          <div key={v.id} style={{ borderTop: '1px solid var(--border)', padding: '8px 0' }} data-testid={`link-${v.id}`}>
            <div style={{ fontWeight: 600 }}>{v.nombre}</div>
            {v.remoteId == null ? (
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>Sincronizá para poder generar su link.</div>
            ) : (
              <>
                {link ? <input className="input" readOnly value={link} aria-label={`Link de ${v.nombre}`} onFocus={e => e.target.select()} /> : null}
                <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                  {!link ? (
                    <button type="button" className="btn btn-primary btn-sm" style={{ width: 'auto' }} disabled={!online || ocupado === String(v.remoteId)}
                      onClick={() => generar(v, false)}>Generar link</button>
                  ) : (
                    <>
                      <button type="button" className="btn btn-primary btn-sm" style={{ width: 'auto' }} onClick={() => copiar(link)}>Copiar</button>
                      <button type="button" className="btn btn-ghost btn-sm" style={{ width: 'auto' }} disabled={!online || ocupado === String(v.remoteId)}
                        onClick={() => generar(v, true)}>Regenerar</button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        );
      })}
      {msg ? <div role="status" style={{ fontSize: 13, marginTop: 8 }} data-testid="links-msg">{msg}</div> : null}
    </div>
  );
};

export default LinksTienda;
