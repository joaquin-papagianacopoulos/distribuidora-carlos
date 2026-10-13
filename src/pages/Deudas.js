// src/pages/Deudas.js
// Solo Admin. Cada pedido que se factura genera una deuda del cliente por su
// total; aca se van cancelando (total o parcial) al hacer el recuento de plata
// del dia. Lo que no se cobra queda como saldo y se ve en la proxima boleta.
import React, { useMemo, useState } from 'react';
import { useApp } from '../hooks/useAppContext';
import { fuzzySearch, normalize } from '../utils/fuzzy';
import { saldoDeuda } from '../utils/pedidos';
import {
  cobrarDeuda, cobrarTodoDelCliente, deshacerCobros, crearDeudaManual, borrarDeuda,
} from '../services/deudaRepository';

const fmt = (n) => `$${Number(n || 0).toLocaleString('es-AR')}`;

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

  const [mostrarForm, setMostrarForm] = useState(false);
  const [clienteQ, setClienteQ] = useState('');
  const [clienteSel, setClienteSel] = useState(null);
  const [monto, setMonto] = useState('');
  const [concepto, setConcepto] = useState('');

  const deudasVisibles = useMemo(() => {
    const q = normalize(busqueda);
    return (deudas || []).filter(d => {
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

  const cobrarTotal = (d) => ejecutar(() => cobrarDeuda(d, null, por));

  const cobrarParcial = (d) => {
    const n = parseFloat(String(parcial.texto).replace(',', '.'));
    if (isNaN(n) || n <= 0) return;
    ejecutar(async () => {
      await cobrarDeuda(d, n, por);
      setParcial({ id: null, texto: '' });
    });
  };

  const cobrarCliente = (cli) => {
    if (!window.confirm(`¿Marcar como pagado todo lo que debe "${cli.clienteNombre}" (${fmt(cli.total)})?`)) return;
    ejecutar(() => cobrarTodoDelCliente(cli.ocurrencias, por));
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
