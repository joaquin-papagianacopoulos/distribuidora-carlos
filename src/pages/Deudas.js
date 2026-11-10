// src/pages/Deudas.js
// Solo Admin. Cada pedido que se factura genera una deuda del cliente por su
// total; aca se van cancelando (total o parcial) al hacer el recuento de plata
// del dia. Lo que no se cobra queda como saldo y se ve en la proxima boleta.
import { esDeudaAnulada } from '../domain/deudas';
import React, { useMemo, useState } from 'react';
import { useApp } from '../hooks/useAppContext';
import { fuzzySearch, normalize } from '../utils/fuzzy';
import { saldoDeuda } from '../utils/pedidos';
import { MEDIOS_PAGO, ETIQUETA_MEDIO, MAX_REFERENCIA, validarCobro, totalesPorMedio } from '../domain/cobranza';
import {
  cobrarDeuda, cobrarTodoDelCliente, deshacerCobros, crearDeudaManual, borrarDeuda,
} from '../services/deudaRepository';

const fmt = (n) => `$${Number(n || 0).toLocaleString('es-AR')}`;
const fmtCents = (c) => fmt(Number(c || 0) / 100);
const fmtFechaCobro = (ms) => { const d = new Date(Number(ms)); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('es-AR'); };

const ORDENES = [
  { id: 'monto', label: 'Mayor deuda' },
  { id: 'reciente', label: 'Mas reciente' },
  { id: 'antigua', label: 'Mas antigua' },
];

const Deudas = () => {
  const { deudas, clientes, vendedorActual, recargar } = useApp();
  const isAdmin = Number(vendedorActual?.permiso || 2) === 1;
  const por = vendedorActual?.nombre || null;

  const [verPagadas, setVerPagadas] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const [orden, setOrden] = useState('monto');
  const [fechaFiltro, setFechaFiltro] = useState('');
  const [expandidoCliente, setExpandidoCliente] = useState(null);
  const [parcial, setParcial] = useState({ id: null, texto: '' });
  const [trabajando, setTrabajando] = useState(false);
  // REQ-DMP (AC-DMP-1): cobro en curso. El medio de pago es OBLIGATORIO (no hay valor por defecto).
  // { tipo: 'total' | 'parcial' | 'cliente', deuda?, cli?, monto?, medio: '', referencia: '', error? }
  const [cobro, setCobro] = useState(null);

  const [mostrarForm, setMostrarForm] = useState(false);
  const [clienteQ, setClienteQ] = useState('');
  const [clienteSel, setClienteSel] = useState(null);
  const [monto, setMonto] = useState('');
  const [concepto, setConcepto] = useState('');

  const deudasVisibles = useMemo(() => {
    const q = normalize(busqueda);
    return (deudas || []).filter(d => {
      if (esDeudaAnulada(d)) return false; // AC-SEG2-1: las anuladas no se muestran
      if (verPagadas ? !d.pagada : d.pagada) return false;
      if (fechaFiltro && String(d.fecha || '') !== fechaFiltro) return false;
      return !q || normalize(d.clienteNombre || '').includes(q);
    });
  }, [deudas, verPagadas, busqueda, fechaFiltro]);

  const porCliente = useMemo(() => {
    const map = {};
    for (const d of deudasVisibles) {
      const k = d.clienteId ?? d.clienteNombre;
      if (!map[k]) map[k] = { key: k, clienteNombre: d.clienteNombre, total: 0, ocurrencias: [], ultima: '', primera: '9999-99-99' };
      const f = String(d.fecha || '');
      if (f > map[k].ultima) map[k].ultima = f;
      if (f < map[k].primera) map[k].primera = f;
      map[k].total += verPagadas ? Number(d.monto || 0) : saldoDeuda(d);
      map[k].ocurrencias.push(d);
    }
    // Dentro de cada cliente las boletas van de la mas nueva a la mas vieja
    // (o al reves si se ordena por "mas antigua", para cobrar primero lo viejo).
    const dir = orden === 'antigua' ? 1 : -1;
    const lista = Object.values(map).map(c => ({
      ...c,
      ocurrencias: c.ocurrencias.sort((a, b) => dir * String(a.fecha).localeCompare(String(b.fecha))),
    }));
    if (orden === 'reciente') lista.sort((a, b) => b.ultima.localeCompare(a.ultima) || b.total - a.total);
    else if (orden === 'antigua') lista.sort((a, b) => a.primera.localeCompare(b.primera) || b.total - a.total);
    else lista.sort((a, b) => b.total - a.total);
    return lista;
  }, [deudasVisibles, verPagadas, orden]);

  // AC-DMP-1: totales cobrados por medio (deudas vigentes que pasan el filtro de busqueda y fecha).
  const porMedio = useMemo(() => {
    const q = normalize(busqueda);
    return totalesPorMedio((deudas || []).filter(d =>
      !esDeudaAnulada(d)
      && (!fechaFiltro || String(d.fecha || '') === fechaFiltro)
      && (!q || normalize(d.clienteNombre || '').includes(q))));
  }, [deudas, busqueda, fechaFiltro]);

  const totalGeneral = porCliente.reduce((acc, c) => acc + c.total, 0);
  const clienteSugg = clienteQ.trim() ? fuzzySearch(clienteQ, clientes || [], 'nombre', 8) : [];

  if (!isAdmin) {
    return (
      <div className="page">
        <h1 className="page-title">Deudas</h1>
        <div className="empty-state">
          <div className="empty-icon">{'⛔'}</div>
          <div className="empty-text">No tenes permisos para ver deudas</div>
        </div>
      </div>
    );
  }

  const ejecutar = async (fn) => {
    setTrabajando(true);
    try {
      await fn();
      await recargar();
    } catch (e) {
      alert('No se pudo completar: ' + (e?.message || String(e)));
    } finally {
      setTrabajando(false);
    }
  };

  // Los tres cobros (total, parcial, todo del cliente) abren el mismo modal: sin medio no se cobra.
  const cobrarTotal = (d) => setCobro({ tipo: 'total', deuda: d, medio: '', referencia: '' });

  const cobrarParcial = (d) => {
    const n = parseFloat(String(parcial.texto).replace(',', '.'));
    if (isNaN(n) || n <= 0) return;
    setCobro({ tipo: 'parcial', deuda: d, monto: n, medio: '', referencia: '' });
  };

  const cobrarCliente = (cli) => setCobro({ tipo: 'cliente', cli, medio: '', referencia: '' });

  const confirmarCobro = () => {
    if (!cobro) return;
    const { tipo, deuda, cli, monto: montoCobro, medio, referencia } = cobro;
    // Para "todo del cliente" el monto lo fija cada deuda: se valida contra la primera con saldo (medio y referencia).
    const base = tipo === 'cliente' ? cli.ocurrencias.find(d => saldoDeuda(d) > 0) : deuda;
    const v = validarCobro({ medio, referencia, monto: tipo === 'parcial' ? montoCobro : undefined }, base || null);
    if (!v.ok) { setCobro(c => ({ ...c, error: v.errores[0] })); return; }
    const opciones = { medio: v.cobro.medio, referencia: v.cobro.referencia };
    ejecutar(async () => {
      if (tipo === 'cliente') await cobrarTodoDelCliente(cli.ocurrencias, por, opciones);
      else if (tipo === 'parcial') {
        await cobrarDeuda(deuda, montoCobro, por, opciones);
        setParcial({ id: null, texto: '' });
      } else await cobrarDeuda(deuda, null, por, opciones);
      setCobro(null);
    });
  };

  const eliminar = (d) => {
    if (!window.confirm('¿Eliminar este registro de deuda?')) return;
    ejecutar(() => borrarDeuda(d));
  };

  const guardarManual = () => {
    if (!clienteSel || !monto || Number(monto) <= 0) return;
    ejecutar(async () => {
      await crearDeudaManual({ cliente: clienteSel, monto, concepto });
      setMostrarForm(false);
    });
  };

  return (
    <div className="page">
      <h1 className="page-title">Deudas</h1>
      <p style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 16, marginTop: -10, lineHeight: 1.5 }}>
        Un pedido facturado pasa a deuda cuando lo mandas con el boton "Pasar a deudas" en Facturación
        (asi queda el monto exacto, por si el cliente descuenta algo al recibirlo). Al contar la plata del dia,
        cancelala completa o solo una parte: lo que falte queda anotado y aparece como "Deuda pendiente" en su proxima boleta.
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button className={`btn btn-sm ${!verPagadas ? 'btn-primary' : 'btn-ghost'}`} style={{ flex: 1 }} onClick={() => setVerPagadas(false)}>
          Pendientes
        </button>
        <button className={`btn btn-sm ${verPagadas ? 'btn-primary' : 'btn-ghost'}`} style={{ flex: 1 }} onClick={() => setVerPagadas(true)}>
          Pagadas
        </button>
      </div>

      <input
        className="input"
        value={busqueda}
        onChange={e => setBusqueda(e.target.value)}
        placeholder="Buscar cliente..."
        autoComplete="off"
        style={{ marginBottom: 12 }}
      />

      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2, marginBottom: 10 }}>
        {ORDENES.map(o => (
          <button
            key={o.id}
            className={`btn btn-sm ${orden === o.id ? 'btn-primary' : 'btn-ghost'}`}
            style={{ whiteSpace: 'nowrap', flex: 'none' }}
            onClick={() => setOrden(o.id)}
          >
            {o.label}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 600, flex: 'none' }}>Dia:</span>
        <input type="date" className="input" value={fechaFiltro} onChange={e => setFechaFiltro(e.target.value)} style={{ flex: 1 }} />
        {fechaFiltro && (
          <button className="btn btn-ghost btn-sm" style={{ width: 'auto' }} onClick={() => setFechaFiltro('')}>Todos</button>
        )}
      </div>

      <div className="stats-grid" style={{ marginBottom: 14 }}>
        <div className="stat-card">
          <div className="stat-value" style={{ color: verPagadas ? 'var(--success)' : 'var(--danger)' }}>{fmt(totalGeneral)}</div>
          <div className="stat-label">{verPagadas ? 'Total cobrado' : 'Total pendiente'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{porCliente.length}</div>
          <div className="stat-label">Clientes</div>
        </div>
      </div>

      <button className="btn btn-primary" style={{ marginBottom: 16 }} onClick={() => { setClienteQ(''); setClienteSel(null); setMonto(''); setConcepto(''); setMostrarForm(true); }}>
        {'+'} Anotar deuda
      </button>

      {mostrarForm && (
        <div className="card" style={{ marginBottom: 16, position: 'relative' }}>
          <label className="input-label">Cliente</label>
          <input
            className="input"
            value={clienteSel ? clienteSel.nombre : clienteQ}
            onChange={e => { setClienteSel(null); setClienteQ(e.target.value); }}
            placeholder="Buscar cliente..."
            autoComplete="off"
            style={{ marginBottom: 10 }}
          />
          {!clienteSel && clienteSugg.length > 0 && (
            <div className="suggestions" style={{ position: 'absolute', top: 66, left: 14, right: 14 }}>
              {clienteSugg.map(c => (
                <div key={c.id} className="suggestion-item" onClick={() => { setClienteSel(c); setClienteQ(''); }}>
                  <div>{c.nombre}</div>
                </div>
              ))}
            </div>
          )}
          <label className="input-label">Monto</label>
          <input className="input" type="number" inputMode="decimal" value={monto} onChange={e => setMonto(e.target.value)} placeholder="0" style={{ marginBottom: 10 }} />
          <label className="input-label">Motivo (opcional)</label>
          <input className="input" value={concepto} onChange={e => setConcepto(e.target.value)} placeholder="Ej: adelanto, saldo de mercaderia..." style={{ marginBottom: 14 }} />
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-ghost" onClick={() => setMostrarForm(false)} disabled={trabajando}>Cancelar</button>
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={guardarManual} disabled={trabajando || !clienteSel || !monto || Number(monto) <= 0}>
              {trabajando ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </div>
      )}

      {(porMedio.efectivo + porMedio.transferencia + porMedio.rendicion + porMedio.sinDato) > 0 && (
        <div className="card" data-testid="totales-por-medio">
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Cobrado por medio de pago</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, fontSize: 13 }}>
            <span>Efectivo: <b>{fmtCents(porMedio.efectivo)}</b></span>
            <span>Transferencia: <b>{fmtCents(porMedio.transferencia)}</b></span>
            {porMedio.rendicion > 0 && <span>Rendición: <b>{fmtCents(porMedio.rendicion)}</b></span>}
            {porMedio.sinDato > 0 && <span>Sin dato: <b>{fmtCents(porMedio.sinDato)}</b></span>}
          </div>
        </div>
      )}

      {cobro && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Registrar cobro"
          data-testid="modal-cobro"
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}
        >
          <div className="card" style={{ width: '100%', maxWidth: 420, margin: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>
              {cobro.tipo === 'cliente' ? 'Cobrar todo lo que debe' : cobro.tipo === 'parcial' ? 'Cobro parcial' : 'Cobrar total'}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 12 }}>
              {cobro.tipo === 'cliente'
                ? `${cobro.cli.clienteNombre}: ${fmt(cobro.cli.total)}`
                : `${cobro.deuda.clienteNombre}: ${fmt(cobro.tipo === 'parcial' ? Math.min(cobro.monto, saldoDeuda(cobro.deuda)) : saldoDeuda(cobro.deuda))}`}
            </div>
            <div className="input-label">Medio de pago (obligatorio)</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              {MEDIOS_PAGO.map(m => (
                <button
                  key={m}
                  type="button"
                  className={cobro.medio === m ? 'btn btn-primary' : 'btn btn-ghost'}
                  style={{ flex: 1 }}
                  aria-pressed={cobro.medio === m}
                  onClick={() => setCobro(c => ({ ...c, medio: m, error: null }))}
                >
                  {ETIQUETA_MEDIO[m]}
                </button>
              ))}
            </div>
            <label className="input-label" htmlFor="cobro-referencia">Referencia (opcional)</label>
            <input
              id="cobro-referencia"
              className="input"
              maxLength={MAX_REFERENCIA}
              value={cobro.referencia}
              onChange={e => setCobro(c => ({ ...c, referencia: e.target.value }))}
              placeholder="Ej: n.º de transferencia o comprobante"
              style={{ marginBottom: 10 }}
            />
            {cobro.error && <div role="alert" style={{ fontSize: 12, color: 'var(--danger)', marginBottom: 8 }}>{cobro.error}</div>}
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-ghost" onClick={() => setCobro(null)} disabled={trabajando}>Cancelar</button>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={confirmarCobro} disabled={trabajando || !cobro.medio}>
                {trabajando ? 'Guardando...' : 'Confirmar cobro'}
              </button>
            </div>
          </div>
        </div>
      )}

      {porCliente.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon" style={{ fontSize: 40 }}>✅</div>
          <div className="empty-text" style={{ color: 'var(--success)', fontWeight: 600 }}>
            {verPagadas ? 'Sin deudas pagadas' : 'Sin deudas pendientes'}
          </div>
        </div>
      ) : (
        porCliente.map(cli => {
          const abierto = expandidoCliente === cli.key;
          return (
            <div key={cli.key}>
              <div
                className="card"
                style={{ cursor: 'pointer', borderLeft: `3px solid ${verPagadas ? 'var(--success)' : 'var(--danger)'}` }}
                onClick={() => setExpandidoCliente(abierto ? null : cli.key)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{cli.clienteNombre}</div>
                    <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 3 }}>
                      {cli.ocurrencias.length} boleta{cli.ocurrencias.length !== 1 ? 's' : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 'none' }}>
                    <div style={{ fontWeight: 700, fontSize: 16, color: verPagadas ? 'var(--success)' : 'var(--danger)' }}>{fmt(cli.total)}</div>
                    {!verPagadas && (
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ width: 'auto', color: 'var(--success)', borderColor: 'var(--success)' }}
                        disabled={trabajando}
                        onClick={(e) => { e.stopPropagation(); cobrarCliente(cli); }}
                      >
                        ✓ Todo
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {abierto && (
                <div className="card" style={{ marginTop: -10, borderTopLeftRadius: 0, borderTopRightRadius: 0, borderTop: 'none' }}>
                  {cli.ocurrencias.map(d => {
                    const saldo = saldoDeuda(d);
                    const cobrado = Number(d.montoPagado || 0);
                    const editandoParcial = parcial.id === d.id;
                    const parcialNum = parseFloat(String(parcial.texto).replace(',', '.'));
                    return (
                      <div key={d.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600 }}>{d.concepto || 'Deuda'}</div>
                            <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                              {String(d.fecha || '').split('-').reverse().join('/')}
                              {d.pagada && d.pagadaPor ? ` · cobrada por ${d.pagadaPor}` : ''}
                            </div>
                            {!d.pagada && cobrado > 0 && (
                              <div style={{ fontSize: 12, color: 'var(--warning)', marginTop: 2 }}>
                                Cobrado {fmt(cobrado)} de {fmt(d.monto)}
                              </div>
                            )}
                            {/* AC-DMP-1: historial de cobros con su medio ("Sin dato" para los anteriores a este cambio) */}
                            {Array.isArray(d.cobros) && d.cobros.length > 0 ? (
                              <div data-testid={`historial-${d.id}`} style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
                                {d.cobros.map(c => (
                                  <div key={c.id}>
                                    {fmtFechaCobro(c.at)} · {fmtCents(c.montoCents)} · {ETIQUETA_MEDIO[c.medio] || ETIQUETA_MEDIO.sinDato}
                                    {c.referencia ? ` · Ref: ${c.referencia}` : ''}
                                  </div>
                                ))}
                              </div>
                            ) : cobrado > 0 ? (
                              <div data-testid={`historial-${d.id}`} style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
                                Cobrado {fmt(cobrado)} · {ETIQUETA_MEDIO.sinDato}
                              </div>
                            ) : null}
                          </div>
                          <div style={{ textAlign: 'right', flex: 'none' }}>
                            <div style={{ fontWeight: 700, fontSize: 14, color: d.pagada ? 'var(--success)' : 'var(--danger)' }}>
                              {fmt(d.pagada ? d.monto : saldo)}
                            </div>
                            {!d.pagada && cobrado > 0 && <div style={{ fontSize: 10, color: 'var(--text3)' }}>debe</div>}
                          </div>
                          <button className="btn-icon" style={{ color: 'var(--text3)', fontSize: 14, width: 28, height: 28 }} onClick={() => eliminar(d)} disabled={trabajando}>×</button>
                        </div>

                        {!d.pagada ? (
                          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                            <button
                              className="btn btn-sm"
                              style={{ flex: 1, background: 'var(--success)', color: '#fff' }}
                              disabled={trabajando}
                              onClick={() => cobrarTotal(d)}
                            >
                              ✓ Cobrar total
                            </button>
                            <button
                              className="btn btn-ghost btn-sm"
                              style={{ flex: 1 }}
                              disabled={trabajando}
                              onClick={() => setParcial(editandoParcial ? { id: null, texto: '' } : { id: d.id, texto: '' })}
                            >
                              Cobro parcial
                            </button>
                          </div>
                        ) : (
                          <div style={{ marginTop: 8 }}>
                            <button
                              className="btn btn-ghost btn-sm"
                              style={{ color: 'var(--warning)', borderColor: 'var(--warning)' }}
                              disabled={trabajando}
                              onClick={() => ejecutar(() => deshacerCobros(d))}
                            >
                              Deshacer
                            </button>
                          </div>
                        )}

                        {!d.pagada && editandoParcial && (
                          <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
                            <input
                              className="input"
                              type="number"
                              inputMode="decimal"
                              autoFocus
                              value={parcial.texto}
                              onChange={e => setParcial({ id: d.id, texto: e.target.value })}
                              placeholder={`Cuanto pago (debe ${fmt(saldo)})`}
                              style={{ flex: 1 }}
                            />
                            <button
                              className="btn btn-primary btn-sm"
                              style={{ width: 'auto' }}
                              disabled={trabajando || isNaN(parcialNum) || parcialNum <= 0 || parcialNum > saldo}
                              onClick={() => cobrarParcial(d)}
                            >
                              Cobrar
                            </button>
                          </div>
                        )}
                        {!d.pagada && editandoParcial && !isNaN(parcialNum) && parcialNum > 0 && parcialNum <= saldo && (
                          <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 6 }}>
                            Va a quedar debiendo {fmt(saldo - parcialNum)}.
                          </div>
                        )}
                        {!d.pagada && editandoParcial && !isNaN(parcialNum) && parcialNum > saldo && (
                          <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 6 }}>
                            No puede ser mas de lo que debe ({fmt(saldo)}).
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
};

export default Deudas;
