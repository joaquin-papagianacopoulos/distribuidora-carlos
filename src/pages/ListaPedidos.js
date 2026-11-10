// src/pages/ListaPedidos.js
import { totalACobrar } from '../domain/redondeo';
import React, { useState, useEffect, useMemo } from 'react';
import { useApp } from '../hooks/useAppContext';
import { getTodayStr, formatFecha } from '../utils/fuzzy';
import { generarFacturaFile } from '../utils/pdfGen';
import { shareFiles } from '../utils/share';
import { mergePdfFilesToSingleFile } from '../utils/pdfMerge';
import { borrarPedidoOnlineFirst, guardarPedidoOnlineFirst, asignarVendedorOnlineFirst, reasignarVendedorAdmin, resolverConflictoEdicion } from '../services/pedidoRepository';
import { puedeEditarPedido, puedeAsignarVendedor } from '../domain/permisos';
import { pedidosPendientesVisibles } from '../domain/pedidosPendientes';
import { esSinVendedor } from '../domain/vendedorPedido';
import { isPedidoVisible, normalizePedidoFecha, getDeudaPendienteParaPedido } from '../utils/pedidos';
import { quitarDeudaDePedido } from '../services/deudaRepository';
import { filtrarActivos } from '../domain/vendedores';
import { cargarRendicionesLocales } from '../services/rendicionService';
import { pedidoTieneRendicionVigente, MSG_PEDIDO_CON_RENDICION } from '../domain/rendicion';

const ESTADOS = ['todos', 'pendiente', 'facturado'];

// onEditar (REQ-EDP): abre el pedido en Nuevo pedido en modo edicion.
const ListaPedidos = ({ onEditar = null } = {}) => {
  const {
    pedidos,
    clientes,
    vendedores,
    deudas,
    vendedorActual,
    zonaActiva,
    setZona,
    recargar,
    syncNow,
    syncPedidosFecha,
    syncPedidosCliente,
    traerPedidosPendientes,
  } = useApp();
  const isAdmin = Number(vendedorActual?.permiso || 2) === 1;
  const zonaLocked = isAdmin ? null : (vendedorActual?.zona || '');
  const zona = isAdmin ? (zonaActiva || '') : (zonaLocked || '');

  const [filtroFecha, setFiltroFecha] = useState(getTodayStr());
  const [filtroEstado, setFiltroEstado] = useState('todos');
  const [expandido, setExpandido] = useState(null);
  const [fechaEditById, setFechaEditById] = useState({});
  const [clienteNombreEditById, setClienteNombreEditById] = useState({});
  const [clienteQ, setClienteQ] = useState('');
  const [modoSeleccion, setModoSeleccion] = useState(false);
  const [seleccion, setSeleccion] = useState(new Set());
  const [vendedorAsignById, setVendedorAsignById] = useState({});
  const [asignandoId, setAsignandoId] = useState(null);

  useEffect(() => {
    // Cuando cambias de dia, traer del remoto solo esa fecha (evita bajar miles de pedidos).
    syncPedidosFecha(filtroFecha);
  }, [filtroFecha, syncPedidosFecha]);

  // REQ-PEN (AC-PEN-1): al abrir en la fecha de hoy se bajan los no facturados de cualquier fecha.
  useEffect(() => {
    if (filtroFecha === getTodayStr() && typeof traerPedidosPendientes === 'function') traerPedidosPendientes();
  }, [filtroFecha, traerPedidosPendientes]);

  useEffect(() => {
    if (!isAdmin) setZona(zonaLocked || '');
  }, [isAdmin, zonaLocked, setZona]);

  useEffect(() => {
    const q = clienteQ.trim();
    if (!q) return;
    const t = setTimeout(() => {
      // Traer historial por cliente desde Supabase (limitado) para mostrar pedidos de otras fechas.
      syncPedidosCliente(q);
    }, 450);
    return () => clearTimeout(t);
  }, [clienteQ, syncPedidosCliente]);

  const toggleSel = (id) => {
    setSeleccion(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const compartirSeleccion = async () => {
    const pedidosSel = (pedidos || [])
      .filter(p => seleccion.has(p.id))
      .filter(isPedidoVisible);
    if (pedidosSel.length === 0) return;

    const files = [];
    for (const p of pedidosSel) {
      const cliente = (clientes || []).find(c => c.id === p.clienteId);
      const deudaPendiente = getDeudaPendienteParaPedido(deudas, p);
      files.push(await generarFacturaFile(p, cliente, { nombre: p.vendedorNombre }, deudaPendiente));
    }

    try {
      // WhatsApp / Web Share en iOS/Android suele mandar 1 solo archivo cuando le pasas muchos.
      // Solucion: SIEMPRE unir en 1 PDF multi-pagina y compartir un unico archivo.
      const merged = await mergePdfFilesToSingleFile(files, `boletas_${filtroFecha}.pdf`);
      await shareFiles({ title: 'Boletas', files: [merged] });
      setSeleccion(new Set());
      setModoSeleccion(false);
    } catch (e) {
      const msg = String(e?.message || e);
      if (/permission/i.test(msg) || /denied/i.test(msg)) {
        try {
          const merged = await mergePdfFilesToSingleFile(files, `boletas_${filtroFecha}.pdf`);
          await shareFiles({ title: 'Boletas', files: [merged] });
          setSeleccion(new Set());
          setModoSeleccion(false);
          return;
        } catch (e2) {
          alert(e2?.message || msg || 'No se pudo compartir.');
          return;
        }
      }
      alert(msg || 'No se pudo compartir.');
    }
  };

  // AC-EDP-1 / AC-ASV-1: el vendedor ve sus pedidos (como dueno o porque los cargo); admin y armador ven todo.
  const esDelUsuario = (p) => {
    if (isAdmin) return true;
    const yo = String(vendedorActual?.nombre || '');
    return String(p.vendedorNombre || p.vendedor || '') === yo || String(p.cargadoPor || '') === yo;
  };
  const usuarioActual = { nombre: vendedorActual?.nombre, permiso: Number(vendedorActual?.permiso || 2) };

  const filtrados = useMemo(() => {
    // Defensa contra duplicados visuales: si por cualquier motivo entran pedidos repetidos
    // (por rehidratacion/caches en iOS), nos quedamos con uno solo por remoteId/id.
    const dedup = new Map();
    for (const p of (pedidos || [])) {
      if (!isPedidoVisible(p)) continue;
      const k = p.remoteId ? `r:${p.remoteId}` : `l:${p.id}`;
      const prev = dedup.get(k);
      if (!prev) dedup.set(k, p);
      else {
        const a = Number(prev.updatedAt || prev.createdAt || 0);
        const b = Number(p.updatedAt || p.createdAt || 0);
        if (b >= a) dedup.set(k, p);
      }
    }

    return [...dedup.values()].filter(p => {
      if (!esDelUsuario(p)) return false;
      const zonaPedido = String(p.zona || '');
      if (zona && zonaPedido !== zona) return false;
      const q = clienteQ.trim().toLowerCase();
      const clienteOk = !q || String(p.clienteNombre || '').toLowerCase().includes(q);
      const fechaOk = q ? true : (!filtroFecha || normalizePedidoFecha(p.fecha) === filtroFecha);
      const estadoOk = filtroEstado === 'todos' || p.estado === filtroEstado;
      return clienteOk && fechaOk && estadoOk;
    }).sort((a, b) => (Number(b.createdAt || 0) - Number(a.createdAt || 0)));
  }, [pedidos, isAdmin, vendedorActual, zona, clienteQ, filtroFecha, filtroEstado]);

  // AC-PEN-1: bloque "Pendientes" (no facturados de otras fechas), solo en la fecha de hoy y sin busqueda por cliente.
  const pendientes = useMemo(() => {
    if (filtroFecha !== getTodayStr() || clienteQ.trim()) return [];
    const base = (pedidos || []).filter(p => esDelUsuario(p) && (!zona || String(p.zona || '') === zona));
    return pedidosPendientesVisibles(base, getTodayStr());
  }, [pedidos, filtroFecha, clienteQ, zona, isAdmin, vendedorActual]);

  const totalDia = filtrados
    .filter(isPedidoVisible)
    .reduce((acc, p) => acc + totalACobrar(p), 0);

  const handleAsignarVendedor = async (p) => {
    const nombreVendedor = vendedorAsignById[p.id];
    if (!nombreVendedor) return;
    const vend = (vendedores || []).find(v => v.nombre === nombreVendedor);
    setAsignandoId(p.id);
    try {
      // T1-A-01: con la migracion 024 la reasignacion pasa por una RPC con el PIN del admin.
      if (typeof reasignarVendedorAdmin === 'function' && vend) {
        const pin = p.remoteId ? window.prompt('PIN de admin para asignar el vendedor del pedido') : '';
        if (p.remoteId && !pin) { setAsignandoId(null); return; }
        await reasignarVendedorAdmin({ pin, pedido: p, vendedor: vend });
      } else if (typeof asignarVendedorOnlineFirst === 'function' && vend) await asignarVendedorOnlineFirst(p, vend);
      else await guardarPedidoOnlineFirst({ ...p, vendedor: nombreVendedor, vendedorNombre: nombreVendedor, zona: vend?.zona || p.zona });
      await recargar();
      setVendedorAsignById(prev => { const n = { ...prev }; delete n[p.id]; return n; });
    } catch (e) {
      alert('No se pudo asignar: ' + (e?.message || String(e)));
    } finally {
      setAsignandoId(null);
    }
  };

  // AC-EDP-3: el usuario decide cuando una edicion offline choco con otra del servidor.
  const handleConflicto = async (p, eleccion) => {
    try {
      const r = await resolverConflictoEdicion(p, eleccion);
      if (r && r.mode === 'conflicto') alert('El pedido volvió a cambiar en el servidor. Probá de nuevo.');
      await recargar();
    } catch (e) {
      alert('No se pudo resolver: ' + (e?.message || String(e)));
    }
  };

  const botonEditar = (p) => {
    const chk = puedeEditarPedido(usuarioActual, p);
    if (!onEditar || !chk.ok || chk.pantalla !== 'pedido') return null;
    return (
      <button className="btn btn-primary btn-sm" data-testid="btn-editar-pedido" style={{ width: 'auto', marginRight: 8 }} onClick={() => onEditar(p)}>
        Editar
      </button>
    );
  };

  const handleCancelar = async (p) => {
    // REQ-REN (AC-REN-4): con rendicion vigente no se borra (devolveria el stock dos veces).
    if (p.estado === 'facturado') {
      const { rendiciones } = (await cargarRendicionesLocales()) || {};
      if (pedidoTieneRendicionVigente(p, rendiciones || [])) { alert(MSG_PEDIDO_CON_RENDICION); return; }
    }
    const msg = p.estado === 'facturado'
      ? `Este pedido ya está FACTURADO. ¿Borrar igualmente el pedido de "${p.clienteNombre}"?`
      : '¿Borrar este pedido?';
    if (!window.confirm(msg)) return;
    try {
      if (p.deudaGenerada) await quitarDeudaDePedido(p);
      await borrarPedidoOnlineFirst(p);
      await recargar();
    } catch (e) {
      console.error('Error cancelando pedido:', e);
      alert('No se pudo borrar: ' + (e?.message || String(e)));
    }
  };

  return (
    <div className="page">
      <h1 className="page-title">Pedidos</h1>

      <div className="card" style={{ padding: '12px 14px' }}>
        {isAdmin && (
          <>
            <label className="input-label">Zona</label>
            <select className="input" value={zona} onChange={e => setZona(e.target.value)} style={{ marginBottom: 10 }}>
              <option value="">Todas</option>
              {[...new Set((vendedores || []).map(v => v.zona).filter(Boolean))].sort().map(z => (
                <option key={z} value={z}>{z}</option>
              ))}
            </select>
          </>
        )}
        <input
          type="date"
          className="input"
          value={filtroFecha}
          onChange={e => setFiltroFecha(e.target.value)}
          style={{ marginBottom: 10 }}
        />

        <input
          className="input"
          value={clienteQ}
          onChange={e => setClienteQ(e.target.value)}
          placeholder="Buscar por cliente..."
          style={{ marginBottom: 10 }}
        />

        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <button
            className={`btn btn-sm ${modoSeleccion ? 'btn-primary' : 'btn-ghost'}`}
            style={{ width: 'auto' }}
            onClick={() => { setModoSeleccion(v => !v); setSeleccion(new Set()); }}
          >
            Seleccionar
          </button>
          {modoSeleccion && (
            <button
              className="btn btn-primary btn-sm"
              style={{ width: 'auto' }}
              onClick={compartirSeleccion}
              disabled={seleccion.size === 0}
            >
              {'\u{1F4E4}'} Enviar boletas
            </button>
          )}
        </div>

        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
          {ESTADOS.map(e => (
            <button
              key={e}
              className={`btn btn-sm ${filtroEstado === e ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setFiltroEstado(e)}
              style={{ whiteSpace: 'nowrap', flex: 'none' }}
            >
              {e.charAt(0).toUpperCase() + e.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="stats-grid" style={{ marginBottom: 12 }}>
        <div className="stat-card">
          <div className="stat-value">{filtrados.filter(isPedidoVisible).length}</div>
          <div className="stat-label">Pedidos activos</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ fontSize: 18 }}>${totalDia.toLocaleString('es-AR')}</div>
          <div className="stat-label">Total</div>
        </div>
      </div>

      {filtrados.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">-</div>
          <div className="empty-text">Sin pedidos para el filtro</div>
        </div>
      ) : (
        filtrados.map(p => (
          <div key={p.id}>
            <div
              className="pedido-card"
              onClick={() => {
                if (modoSeleccion) toggleSel(p.id);
                else setExpandido(expandido === p.id ? null : p.id);
              }}
              style={modoSeleccion ? { cursor: 'pointer' } : undefined}
            >
              <div className="pedido-header">
                <div>
                  <div className="pedido-cliente">{p.clienteNombre}</div>
                  <div className="pedido-vendedor">
                    {(p.vendedor === 'WEB' || p.vendedorNombre === 'WEB') && (
                      <span style={{ background: '#1a56db', color: '#fff', borderRadius: 4, fontSize: 11, fontWeight: 700, padding: '1px 6px', marginRight: 5 }}>🌐 WEB</span>
                    )}
                    {p.vendedorNombre}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="pedido-total">${totalACobrar(p).toLocaleString('es-AR')}</div>
                  <div className="pedido-fecha">{formatFecha(normalizePedidoFecha(p.fecha))}</div>
                </div>
              </div>

              {false && <>
                  {(p.items || []).length} producto{(p.items || []).length !== 1 ? 's' : ''} ·{' '}
                  {(p.items || []).map(i => `${String(i.nombre || '').split(' ')[0]} ×${i.cantidad}`).join(', ')}
                {null}
                <span className={`badge badge-${p.estado === 'pendiente' ? 'pending' : p.estado === 'facturado' ? 'facturado' : 'cancelled'}`}>
                  {p.estado}
                </span>
              </>}

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                {/* AC-SEG2-3: pedido guardado en este dispositivo que todavia no subio. */}
                {!p.synced && !p.borrado && (
                  <span className="badge badge-pending" data-testid="badge-sin-subir">Sin subir</span>
                )}
                {esSinVendedor(p) && p.origen === 'web' && (
                  <span className="badge badge-pending" data-testid="badge-sin-vendedor">Sin vendedor</span>
                )}
                {p.modificadoTrasArmado && (
                  <span className="badge badge-pending" data-testid="badge-modificado">Modificado</span>
                )}
                {p.conflictoEdicion && (
                  <span className="badge badge-cancelled" data-testid="badge-conflicto">Conflicto</span>
                )}
                <span className={`badge badge-${p.estado === 'pendiente' ? 'pending' : p.estado === 'facturado' ? 'facturado' : 'cancelled'}`}>
                  {p.estado}
                </span>
              </div>

              {modoSeleccion && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
                  <input type="checkbox" checked={seleccion.has(p.id)} readOnly />
                </div>
              )}

              {p.observaciones && (
                <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 6, fontStyle: 'italic' }}>
                  Obs: {p.observaciones}
                </div>
              )}
            </div>

            {expandido === p.id && (
              <div className="card" style={{ marginTop: -8, borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
                <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 14 }}>Detalle del pedido</div>
                {p.conflictoEdicion && (
                  <div role="alert" data-testid="aviso-conflicto" style={{ marginBottom: 12, background: '#fdecea', borderRadius: 8, padding: '10px 12px', fontSize: 13 }}>
                    Este pedido se editó en otro dispositivo mientras vos lo editabas sin conexión. Elegí qué versión queda.
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      <button className="btn btn-ghost btn-sm" style={{ width: 'auto' }} onClick={() => handleConflicto(p, 'servidor')}>Usar la del servidor</button>
                      <button className="btn btn-primary btn-sm" style={{ width: 'auto' }} onClick={() => handleConflicto(p, 'mia')}>Subir la mía igual</button>
                    </div>
                  </div>
                )}
                {puedeAsignarVendedor(usuarioActual, p) && !p.borrado && (
                  <div style={{ marginBottom: 14, background: '#e8f0fe', borderRadius: 8, padding: '10px 12px' }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: '#1a56db', marginBottom: 8 }}>{(p.vendedor === 'WEB' || p.vendedorNombre === 'WEB') ? '🌐 Pedido recibido por web — Asignar vendedor' : 'Cambiar el vendedor del pedido (la comisión va al nuevo)'}</div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <select
                        className="input"
                        value={vendedorAsignById[p.id] || ''}
                        onChange={e => setVendedorAsignById(prev => ({ ...prev, [p.id]: e.target.value }))}
                        style={{ flex: 1 }}
                      >
                        <option value="">— Seleccionar vendedor —</option>
                        {filtrarActivos(vendedores).filter(v => !v.borrado).map(v => (
                          <option key={v.id} value={v.nombre}>{v.nombre}{v.zona ? ` (${v.zona})` : ''}</option>
                        ))}
                      </select>
                      <button
                        className="btn btn-primary btn-sm"
                        style={{ width: 'auto', whiteSpace: 'nowrap' }}
                        disabled={!vendedorAsignById[p.id] || asignandoId === p.id}
                        onClick={() => handleAsignarVendedor(p)}
                      >
                        {asignandoId === p.id ? 'Guardando...' : 'Asignar'}
                      </button>
                    </div>
                  </div>
                )}
                {(isAdmin || p.estado === 'pendiente') && (
                  <div style={{ marginBottom: 10 }}>
                    <label className="input-label">Cliente</label>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
                      <input
                        className="input"
                        value={clienteNombreEditById[p.id] ?? p.clienteNombre}
                        onChange={e => setClienteNombreEditById(prev => ({ ...prev, [p.id]: e.target.value }))}
                        placeholder="Nombre del cliente..."
                      />
                      <button
                        className="btn btn-primary btn-sm"
                        style={{ width: 'auto' }}
                        onClick={async () => {
                          try {
                            const nuevoNombre = (clienteNombreEditById[p.id] ?? p.clienteNombre ?? '').trim();
                            if (!nuevoNombre) return;
                            await guardarPedidoOnlineFirst({ ...p, clienteNombre: nuevoNombre });
                            await recargar();
                          } catch (e) {
                            console.error('Error guardando cliente:', e);
                            alert('No se pudo guardar: ' + (e?.message || String(e)));
                          }
                        }}
                      >
                        Guardar
                      </button>
                    </div>
                    <label className="input-label">Fecha</label>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input
                        type="date"
                        className="input"
                        value={fechaEditById[p.id] ?? normalizePedidoFecha(p.fecha)}
                        onChange={e => setFechaEditById(prev => ({ ...prev, [p.id]: e.target.value }))}
                      />
                      <button
                        className="btn btn-primary btn-sm"
                        style={{ width: 'auto' }}
                        onClick={async () => {
                          try {
                            const nueva = normalizePedidoFecha(fechaEditById[p.id] ?? p.fecha);
                            await guardarPedidoOnlineFirst({ ...p, fecha: nueva });
                            await recargar();
                          } catch (e) {
                            console.error('Error guardando fecha:', e);
                            alert('No se pudo guardar: ' + (e?.message || String(e)));
                          }
                        }}
                      >
                        Guardar
                      </button>
                    </div>
                  </div>
                )}
                {(p.items || []).map((item, i) => (
                  <div key={i} className="item-row">
                    <span style={{ flex: 1, fontSize: 14 }}>{item.nombre}</span>
                    <span style={{ color: 'var(--text3)', fontSize: 13 }}>×{item.cantidad}</span>
                    <span style={{ color: 'var(--success)', fontWeight: 600, fontSize: 14, marginLeft: 12 }}>
                      ${(item.cantidad * item.precio).toLocaleString('es-AR')}
                    </span>
                  </div>
                ))}
                <div className="divider" />
                {botonEditar(p)}
                {!p.borrado && (
                  <button
                    className="btn btn-danger btn-sm"
                    style={{ width: 'auto' }}
                    onClick={() => handleCancelar(p)}
                  >
                    Borrar pedido
                  </button>
                )}
              </div>
            )}
          </div>
        ))
      )}
      {pendientes.length > 0 && (
        <div data-testid="bloque-pendientes">
          <h2 style={{ fontSize: 16, margin: '16px 0 8px' }}>Pendientes ({pendientes.length})</h2>
          {pendientes.map(({ pedido: p, fecha, etiqueta, dias }) => (
            <div key={p.remoteId ? `r:${p.remoteId}` : `l:${p.id}`} className="pedido-card" data-testid="pendiente-item">
              <div className="pedido-header">
                <div>
                  <div className="pedido-cliente">{p.clienteNombre}</div>
                  <div className="pedido-vendedor">{p.vendedorNombre || p.vendedor || 'Sin vendedor'}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="pedido-total">${totalACobrar(p).toLocaleString('es-AR')}</div>
                  <div className="pedido-fecha">{fecha ? formatFecha(fecha) : 'Sin fecha'}</div>
                  <div style={{ fontSize: 11, color: dias !== null && dias < 0 ? 'var(--danger)' : 'var(--text3)' }}>{etiqueta}</div>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>{botonEditar(p)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ListaPedidos;
