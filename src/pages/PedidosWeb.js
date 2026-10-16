// src/pages/PedidosWeb.js — REQ-WEB: bandeja "Pedidos web" (solo admin).
// Los pedidos web por revisar NO están en Armado/Facturación/Comisiones ni mueven
// stock hasta que se aceptan (isPedidoOculto + cerrojo en aplicarStockPedido).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../hooks/useAppContext';
import { addCliente } from '../db';
import ClienteForm from '../components/ClienteForm';
import {
  filtrarHistorialWeb, contarPorRevisar, estadoBandeja, sugerirClientes, vendedorAlAceptar,
  validarAccionWeb, clienteDesdeContacto, armarItemsAceptar,
} from '../domain/pedidosWeb';
import { filtrarActivos, vendedoresParaSelector } from '../domain/vendedores';
import { esAdmin } from '../domain/permisos';
import { hoyISO } from '../domain/validacion';
import { normalizePedidoFecha } from '../utils/pedidos';
import { encolarAccion, sincronizarAcciones, cargarAcciones, hayPinEnMemoria, cargarContactos } from '../services/pedidosWebService';

const ETIQUETA_ESTADO = { por_revisar: 'Por revisar', pendiente_subir: 'Pendiente de subir', aceptado: 'Aceptado', rechazado: 'Rechazado' };
const FILTROS = [['por_revisar', 'Por revisar'], ['aceptado', 'Aceptados'], ['rechazado', 'Rechazados'], ['todos', 'Todos']];

const pesos = (n) => `$${Number(n || 0).toLocaleString('es-AR')}`;
const fechaHora = (ms) => (ms ? new Date(ms).toLocaleString('es-AR') : '');

const Detalle = ({ pedido, acciones, clientes, vendedores, productos, onResuelto, pin, avisoContacto }) => {
  const contacto = pedido.webContacto || {};
  const estado = estadoBandeja(pedido, acciones);
  const editable = estado === 'por_revisar';
  const productosById = useMemo(() => new Map(productos.map(p => [String(p.id), p])), [productos]);
  const [items, setItems] = useState(() => (pedido.items || []).map(it => ({ ...it })));
  const [clienteId, setClienteId] = useState(null);
  const [creando, setCreando] = useState(false);
  const [elegido, setElegido] = useState('');
  const [motivo, setMotivo] = useState('');
  const [rechazando, setRechazando] = useState(false);
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);
  // AC-WEB-8: fecha con la que entra al flujo (Pedidos/Armado/Facturar filtran por fecha).
  const fechaOriginal = normalizePedidoFecha(pedido.fecha) || hoyISO();
  const [fecha, setFecha] = useState(fechaOriginal);
  const { recargar } = useApp();

  const sugeridos = useMemo(() => sugerirClientes(contacto, clientes), [contacto, clientes]);
  const cliente = clienteId == null ? null : clientes.find(c => String(c.id) === String(clienteId)) || null;
  const calculo = useMemo(() => armarItemsAceptar(items, productosById, { previos: pedido.items }), [items, productosById, pedido.items]);
  const vend = vendedorAlAceptar(pedido, cliente, elegido);
  const resueltoPorOtro = acciones.find(a => String(a.pedidoRemoteId) === String(pedido.remoteId) && a.resultado === 'ya_resuelto');
  const conError = acciones.find(a => String(a.pedidoRemoteId) === String(pedido.remoteId) && a.resultado === 'error');

  const cambiarCantidad = (i, v) => setItems(prev => prev.map((it, k) => (k === i ? { ...it, cantidad: Number(v) } : it)));
  const quitarItem = (i) => setItems(prev => prev.filter((_, k) => k !== i));

  const guardarCliente = async (data) => {
    const id = await addCliente({ ...data, boletaContraBoleta: false, extrasDirty: true });
    await recargar();
    setClienteId(id);
    setCreando(false);
  };

  const subir = async (r) => {
    if (!r.ok) { setError(r.mensaje || 'No se pudo guardar la acción.'); return; }
    const s = await sincronizarAcciones({ pin: pin || undefined });
    await onResuelto();
    if (!s.ok && s.mensaje) setError(`Quedó pendiente de subir: ${s.mensaje}`);
  };

  const aceptar = async () => {
    setError('');
    const datos = { clienteId, clienteNombre: cliente?.nombre || '', zona: cliente?.zona || '', vendedor: vend.vendedor, items: calculo.items, total: calculo.total,
      fecha: fecha !== fechaOriginal ? fecha : null };
    const v = validarAccionWeb('aceptar', datos);
    if (!v.ok) { setError(Object.values(v.errores)[0]); return; }
    if (calculo.items.length === 0) { setError('El pedido no puede quedar sin renglones: rechazalo si no se puede entregar.'); return; }
    setOcupado(true);
    try { await subir(await encolarAccion(pedido, 'aceptar', datos)); } finally { setOcupado(false); }
  };

  const rechazar = async () => {
    setError('');
    const v = validarAccionWeb('rechazar', { motivo });
    if (!v.ok) { setError(v.errores.motivo); return; }
    setOcupado(true);
    try { await subir(await encolarAccion(pedido, 'rechazar', { motivo })); } finally { setOcupado(false); }
  };

  return (
    <div className="card" style={{ marginTop: 10 }} data-testid="detalle-pedido-web">
      <div style={{ fontWeight: 700 }}>{contacto.nombre || pedido.clienteNombre}</div>
      <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.6 }} data-testid="contacto-web">
        Fecha {pedido.fecha} · Vendedor del link: {pedido.vendedor || 'sin vendedor (link general)'}<br />
        {pedido.webContacto ? (
          <>
            Tel: {contacto.telefono} · {contacto.direccion}, {contacto.ciudad}{contacto.cp ? ` (${contacto.cp})` : ''}{contacto.provincia ? `, ${contacto.provincia}` : ''}
            {contacto.cuit ? <><br />CUIT {contacto.cuit}</> : null}
            {contacto.observaciones ? <><br />Obs: {contacto.observaciones}</> : null}
          </>
        ) : <span data-testid="contacto-no-disponible">Datos de contacto no disponibles{avisoContacto ? `: ${avisoContacto}` : ' todavía'}.</span>}
      </div>

      <div style={{ marginTop: 10, fontWeight: 600 }}>Renglones</div>
      {items.map((it, i) => (
        <div key={`${it.productoId}-${i}`} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0' }} data-testid="renglon-web">
          <div style={{ flex: 1, fontSize: 14 }}>
            {it.nombre}
            {it.bultos ? <span style={{ color: 'var(--text3)' }}> · {it.bultos} {it.bultoNombre || 'Bulto'} ({it.bultos * it.bultoX} u.)</span> : null}
          </div>
          {editable ? (
            <input className="input" type="number" min="0" style={{ width: 80 }} aria-label={`Cantidad de ${it.nombre}`}
              value={it.cantidad} onChange={e => cambiarCantidad(i, e.target.value)} />
          ) : <span>{it.cantidad} u.</span>}
          <span style={{ width: 80, textAlign: 'right' }}>{pesos(it.subtotal ?? it.cantidad * it.precio)}</span>
          {editable ? <button type="button" className="btn-icon" aria-label={`Quitar ${it.nombre}`} onClick={() => quitarItem(i)}>×</button> : null}
        </div>
      ))}
      {editable && calculo.avisos.length > 0 ? (
        <div role="alert" style={{ color: 'var(--warning)', fontSize: 13 }} data-testid="aviso-multiplo">
          {calculo.avisos.map(a => `${a.nombre}: ${a.cantidad} u. no es múltiplo de ${a.bultoX}`).join(' · ')} (como admin podés aceptarlo igual)
        </div>
      ) : null}
      <div style={{ fontWeight: 700, margin: '8px 0' }} data-testid="total-web">Total {pesos(editable ? calculo.total : pedido.total)}</div>

      {resueltoPorOtro ? (
        <div role="alert" className="card" style={{ background: 'var(--accent-dim)' }} data-testid="ya-resuelto">
          Lo resolvió {resueltoPorOtro.detalle?.revisadoPor || 'otro admin'} ({resueltoPorOtro.detalle?.estado || 'resuelto'}). Tu acción no se aplicó.
        </div>
      ) : null}
      {conError ? <div role="alert" className="card" data-testid="accion-error">No se pudo aplicar la acción ({conError.detalle?.motivo || 'error'}). Probá de nuevo.</div> : null}

      {estado === 'aceptado' ? <div data-testid="info-aceptado">Aceptado por {pedido.webRevisadoPor || '—'} el {fechaHora(pedido.webRevisadoAt)} · Cliente: {pedido.clienteNombre}</div> : null}
      {estado === 'rechazado' ? (
        <div data-testid="info-rechazado">Rechazado por {pedido.webRevisadoPor || '—'} el {fechaHora(pedido.webRevisadoAt)}. Motivo: {pedido.webMotivoRechazo}</div>
      ) : null}
      {estado === 'pendiente_subir' ? <div data-testid="info-pendiente">Tu acción está guardada y se sube cuando haya conexión y PIN.</div> : null}

      {editable ? (
        <>
          <div style={{ marginTop: 10, fontWeight: 600 }}>Cliente</div>
          {cliente ? (
            <div data-testid="cliente-vinculado">
              Vinculado a <strong>{cliente.nombre}</strong>{cliente.zona ? ` · zona ${cliente.zona}` : ''}{' '}
              <button type="button" className="btn btn-ghost btn-sm" style={{ width: 'auto' }} onClick={() => setClienteId(null)}>Cambiar</button>
            </div>
          ) : (
            <>
              {sugeridos.length === 0 ? <div style={{ fontSize: 13, color: 'var(--text3)' }}>No hay clientes parecidos.</div> : null}
              {sugeridos.map(s => (
                <div key={s.cliente.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0' }} data-testid="sugerencia">
                  <div style={{ flex: 1, fontSize: 14 }}>{s.cliente.nombre} <small style={{ color: 'var(--text3)' }}>({s.motivos.join(', ')})</small></div>
                  <button type="button" className="btn btn-primary btn-sm" style={{ width: 'auto' }} onClick={() => setClienteId(s.cliente.id)}>Vincular</button>
                </div>
              ))}
              <select className="input" aria-label="Elegir otro cliente" value="" onChange={e => e.target.value && setClienteId(clientes.find(c => String(c.id) === e.target.value)?.id)}>
                <option value="">Elegir otro cliente...</option>
                {clientes.map(c => <option key={c.id} value={String(c.id)}>{c.nombre}</option>)}
              </select>
              <button type="button" className="btn btn-ghost btn-sm" style={{ width: 'auto', marginTop: 6 }} onClick={() => setCreando(true)} data-testid="crear-cliente">Crear cliente nuevo</button>
            </>
          )}
          {creando ? (
            <ClienteForm
              inicial={clienteDesdeContacto(contacto, { vendedor: pedido.vendedor || '' })}
              existentes={clientes}
              vendedores={vendedoresParaSelector(vendedores, pedido.vendedor)}
              onGuardar={guardarCliente}
              onCancelar={() => setCreando(false)}
            />
          ) : null}

          {vend.requiereElegir && cliente ? (
            <div style={{ marginTop: 8 }}>
              <label className="input-label">El link y el cliente no tienen vendedor: elegí uno</label>
              <select className="input" aria-label="Vendedor" value={elegido} onChange={e => setElegido(e.target.value)}>
                <option value="">Elegir vendedor...</option>
                {filtrarActivos(vendedores).map(v => <option key={v.id} value={v.nombre}>{v.nombre}</option>)}
              </select>
            </div>
          ) : (cliente ? <div style={{ fontSize: 13, marginTop: 6 }}>Vendedor: {vend.vendedor}</div> : null)}

          <div style={{ marginTop: 10 }}>
            <label className="input-label" htmlFor="fecha-web">Fecha del pedido (día de entrega)</label>
            <input id="fecha-web" className="input" type="date" value={fecha} onChange={e => setFecha(e.target.value)} data-testid="fecha-web" />
            {fecha !== hoyISO() ? (
              <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }} data-testid="aviso-fecha-web">
                Al aceptarlo, en Pedidos, Armado y Facturar aparece en la fecha {fecha.split('-').reverse().join('/')} (no en la de hoy).
              </div>
            ) : null}
          </div>

          {error ? <div role="alert" style={{ color: 'var(--danger)', marginTop: 8 }} data-testid="error-web">{error}</div> : null}

          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button type="button" className="btn btn-primary" style={{ flex: 1 }} disabled={ocupado || !cliente || !vend.vendedor} onClick={aceptar} data-testid="aceptar-web">Aceptar</button>
            <button type="button" className="btn btn-ghost" disabled={ocupado} onClick={() => setRechazando(r => !r)} data-testid="rechazar-web">Rechazar</button>
          </div>
          {rechazando ? (
            <div style={{ marginTop: 8 }}>
              <label className="input-label">Motivo del rechazo (obligatorio)</label>
              <textarea className="input" rows={2} value={motivo} onChange={e => setMotivo(e.target.value)} data-testid="motivo-rechazo" />
              <button type="button" className="btn btn-primary" disabled={ocupado} onClick={rechazar} data-testid="confirmar-rechazo">Confirmar rechazo</button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
};

const PedidosWeb = () => {
  const { pedidos = [], clientes = [], vendedores = [], productos = [], vendedorActual, online = true, recargar } = useApp();
  const [filtro, setFiltro] = useState('por_revisar');
  const [sel, setSel] = useState(null);
  const [acciones, setAcciones] = useState([]);
  const [pin, setPin] = useState('');
  const [aviso, setAviso] = useState('');
  const [avisoContacto, setAvisoContacto] = useState('');

  const refrescar = useCallback(async () => {
    try { setAcciones((await cargarAcciones()) || []); } catch { setAcciones([]); }
    if (recargar) await recargar();
  }, [recargar]);

  useEffect(() => { cargarAcciones().then(a => setAcciones(a || [])).catch(() => setAcciones([])); }, []);

  // S-WEB-01: trae el contacto con la RPC de admin (PIN en memoria o el tipeado).
  const traerContactos = useCallback(async (pinTipeado) => {
    const r = await cargarContactos({ pin: pinTipeado || undefined });
    setAvisoContacto(r.ok ? '' : (r.mensaje || ''));
    if (r.ok && r.count > 0 && recargar) await recargar();
  }, [recargar]);

  useEffect(() => { if (esAdmin(vendedorActual?.permiso)) traerContactos(); }, [traerContactos, vendedorActual]);

  if (!esAdmin(vendedorActual?.permiso)) {
    return (
      <div className="page">
        <h1 className="page-title">Pedidos web</h1>
        <div className="empty-state"><div className="empty-text">Solo el admin puede ver los pedidos web</div></div>
      </div>
    );
  }

  const lista = filtrarHistorialWeb(pedidos, filtro);
  const pendientesSubir = acciones.filter(a => a.pendingSync).length;

  const subirAhora = async () => {
    setAviso('');
    const r = await sincronizarAcciones({ pin: pin || undefined });
    await refrescar();
    setAviso(r.ok ? 'Acciones subidas.' : r.mensaje);
  };

  return (
    <div className="page">
      <h1 className="page-title">Pedidos web <span data-testid="contador-web">({contarPorRevisar(pedidos)})</span></h1>

      {pendientesSubir > 0 || !hayPinEnMemoria() ? (
        <div className="card" data-testid="subida-web">
          {pendientesSubir > 0 ? <div>{pendientesSubir} acción(es) pendiente(s) de subir{online ? '' : ' (sin conexión)'}.</div> : null}
          <input className="input" type="password" inputMode="numeric" autoComplete="off" placeholder="Tu PIN de admin (solo para subir)"
            value={pin} onChange={e => setPin(e.target.value)} data-testid="pin-web" />
          {pendientesSubir > 0 ? <button type="button" className="btn btn-primary btn-sm" style={{ width: 'auto', marginTop: 6 }} disabled={!online} onClick={subirAhora} data-testid="subir-web">Subir ahora</button> : null}
          {pin ? <button type="button" className="btn btn-ghost btn-sm" style={{ width: 'auto', marginTop: 6 }} disabled={!online} onClick={() => traerContactos(pin)} data-testid="traer-contactos">Ver datos de contacto</button> : null}
          {aviso ? <div role="status" style={{ fontSize: 13 }}>{aviso}</div> : null}
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '10px 0' }}>
        {FILTROS.map(([k, label]) => (
          <button key={k} type="button" className={`btn btn-sm ${filtro === k ? 'btn-primary' : 'btn-ghost'}`} style={{ width: 'auto' }}
            onClick={() => { setFiltro(k); setSel(null); }} data-testid={`filtro-${k}`}>{label}</button>
        ))}
      </div>

      {lista.length === 0 ? <div className="empty-state"><div className="empty-text">No hay pedidos en esta lista</div></div> : null}
      {lista.map(p => {
        const estado = estadoBandeja(p, acciones);
        return (
          <div key={p.id}>
            <div className="list-item" style={{ cursor: 'pointer' }} onClick={() => setSel(sel === p.id ? null : p.id)} data-testid="pedido-web">
              <div style={{ flex: 1 }}>
                <div className="list-item-name">{p.webContacto?.nombre || p.clienteNombre}</div>
                <div className="list-item-sub">{p.fecha} · {(p.items || []).length} renglón(es) · {pesos(p.total)} · {ETIQUETA_ESTADO[estado]}</div>
              </div>
            </div>
            {sel === p.id ? (
              <Detalle key={p.id} pedido={p} acciones={acciones} clientes={clientes} vendedores={vendedores} productos={productos} onResuelto={refrescar} pin={pin} avisoContacto={avisoContacto} />
            ) : null}
          </div>
        );
      })}
    </div>
  );
};

export default PedidosWeb;
