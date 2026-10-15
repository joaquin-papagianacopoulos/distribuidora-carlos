// src/pages/Proveedores.js — REQ-CPR (AC-CPR-1..5). SOLO ADMIN.
// Cuenta corriente con cada proveedor (compras de los ingresos con costo + cargos manuales - pagos),
// comprobantes de pago y pedidos al proveedor. Todo se guarda local (offline-first) y sube con el PIN
// del admin (ComprasSyncBar). Nada de acá toca stock: "recibido" solo abre un Ingreso precargado.
import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../hooks/useAppContext';
import { esAdmin } from '../domain/permisos';
import { hoyISO, toInt } from '../domain/validacion';
import { comprasDeIngresos } from '../domain/compras';
import {
  MEDIOS_PAGO, ETIQUETA_MEDIO, validarMovimientoCuenta, estadoDeCuenta, saldoProveedor, formatearCentavos,
} from '../domain/cuentaProveedores';
import {
  nuevoPedidoProveedor, agregarItems, fijarItem, quitarItem, unidadesItem, textoCompartirPedido,
} from '../domain/pedidosProveedor';
import { buscarProductos, stockBajoDeProveedor } from '../domain/stockBajo';
import { normalizarBultoX } from '../domain/bultos';
import {
  guardarMovimientoCuenta, anularMovimientoCuenta, guardarPedidoProveedor, marcarPedidoEnviado, recibirPedidoProveedor,
} from '../services/comprasLocalService';
import { verComprobante, verComprobanteLocal } from '../services/comprasService';
import { credencialesAdminProductos } from '../services/productosAdminService';
import { getComprobantesPendientes } from '../db';
import { generarEstadoCuentaFile, generarPedidoProveedorFile } from '../utils/pdfGen';
import { descargarArchivo } from '../utils/descargarArchivo';
import { shareFiles, canShareFiles } from '../utils/share';
import ComprasSyncBar from '../components/ComprasSyncBar';

const ETIQUETA_ESTADO = { borrador: 'Borrador', enviado: 'Enviado', recibido: 'Recibido' };
const fechaCorta = (iso) => String(iso || '').slice(0, 10).split('-').reverse().join('/');

// ---------------- Cuenta corriente ----------------
const Cuenta = ({ proveedor, compras, movs, clientes, usuario, recargar }) => {
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [medio, setMedio] = useState('');
  const [form, setForm] = useState(null); // null | { tipo: 'pago'|'cargo', ... }
  const [archivo, setArchivo] = useState(null);
  const [errores, setErrores] = useState({});
  const [msg, setMsg] = useState('');
  const [anulando, setAnulando] = useState(null); // { id, motivo }
  const [verPin, setVerPin] = useState(null); // { id, pin }
  const [pendientesAdj, setPendientesAdj] = useState(new Set());

  const estado = useMemo(() => estadoDeCuenta(compras, movs, { proveedorId: proveedor.id, desde, hasta, medio }), [compras, movs, proveedor.id, desde, hasta, medio]);
  const saldo = useMemo(() => saldoProveedor(compras, movs, proveedor.id), [compras, movs, proveedor.id]);
  const sinCosto = useMemo(() => compras.filter(c => String(c.proveedorId) === String(proveedor.id)).reduce((n, c) => n + (c.renglonesSinCosto || 0), 0), [compras, proveedor.id]);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try { const l = await getComprobantesPendientes(); if (vivo) setPendientesAdj(new Set((l || []).map(x => String(x.id)))); } catch { /* sin store */ }
    })();
    return () => { vivo = false; };
  }, [movs]);

  const abrir = (tipo) => { setMsg(''); setErrores({}); setArchivo(null); setForm({ tipo, fecha: hoyISO(), monto: '', medio: 'efectivo', referencia: '', clienteId: '', pedidoId: '' }); };
  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  const guardar = async () => {
    const r = validarMovimientoCuenta({ ...form, proveedorId: proveedor.id }, { tipo: form.tipo, proveedores: [proveedor], clientes, usuario });
    if (!r.ok) { setErrores(r.errores); return; }
    const g = await guardarMovimientoCuenta(r.mov, form.tipo === 'pago' ? archivo : null);
    if (!g.ok) { setErrores({ archivo: g.mensaje }); return; }
    setForm(null); setArchivo(null); setErrores({});
    setMsg(form.tipo === 'pago' ? 'Pago guardado. Subilo con “Subir datos de compras”.' : 'Cargo guardado. Subilo con “Subir datos de compras”.');
    await recargar?.();
  };

  const confirmarAnulacion = async () => {
    const r = await anularMovimientoCuenta(anulando.id, { motivo: anulando.motivo, usuario });
    if (!r.ok) { setMsg(r.error || 'No se pudo anular.'); return; }
    setAnulando(null);
    setMsg('Movimiento anulado (queda registrado, no se borra).');
    await recargar?.();
  };

  const abrirComprobante = async (m) => {
    setMsg('');
    let r;
    if (m.comprobantePath) {
      const cr = await credencialesAdminProductos(verPin?.pin);
      if (!cr.ok) { setMsg(cr.mensaje || 'Ingresá tu PIN de administrador.'); return; }
      setVerPin(null);
      r = await verComprobante(cr.cred, m.comprobantePath);
    } else {
      r = await verComprobanteLocal(m.id);
    }
    if (!r.ok) { setMsg(r.mensaje || 'No se pudo abrir el comprobante.'); return; }
    window.open(r.url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(r.url), 120_000);
  };

  const pdf = async (compartir) => {
    const file = await generarEstadoCuentaFile(estado, { proveedor: proveedor.descripcion, desde, hasta });
    if (compartir && canShareFiles()) { try { await shareFiles({ title: file.name, files: [file] }); return; } catch { /* cae a descarga */ } }
    descargarArchivo(file);
  };

  const err = (k) => errores[k] && <div role="alert" style={{ color: 'var(--danger)', fontSize: 12, marginTop: 4 }}>{errores[k]}</div>;
  const t = estado.totalesPorMedio;

  return (
    <div data-testid="cuenta-proveedor">
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: 'var(--text3)' }}>Saldo con {proveedor.descripcion}</div>
        <div data-testid="saldo-proveedor" style={{ fontSize: 24, fontWeight: 800, color: saldo > 0 ? 'var(--warning)' : saldo < 0 ? 'var(--success)' : 'var(--text)' }}>
          {formatearCentavos(saldo)}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text3)' }}>
          {saldo > 0 ? 'Le debemos al proveedor.' : saldo < 0 ? 'Saldo a favor nuestro.' : 'Sin deuda.'}
          {sinCosto > 0 ? ` ${sinCosto} renglón(es) de ingresos sin costo no suman.` : ''}
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
          <button className="btn btn-primary btn-sm" style={{ width: 'auto' }} onClick={() => abrir('pago')}>Cargar pago</button>
          <button className="btn btn-ghost btn-sm" style={{ width: 'auto' }} onClick={() => abrir('cargo')}>Cargar cargo</button>
          <button className="btn btn-ghost btn-sm" style={{ width: 'auto' }} onClick={() => pdf(false)}>Estado de cuenta (PDF)</button>
          <button className="btn btn-ghost btn-sm" style={{ width: 'auto' }} onClick={() => pdf(true)}>Compartir</button>
        </div>
      </div>

      {form && (
        <div className="card" style={{ marginBottom: 12 }} data-testid="form-movimiento">
          <div style={{ fontWeight: 700, marginBottom: 8 }}>{form.tipo === 'pago' ? 'Cargar pago' : 'Cargar cargo (compra sin ingreso)'}</div>
          <div className="input-group">
            <label className="input-label" htmlFor="mov-fecha">Fecha</label>
            <input id="mov-fecha" type="date" className="input" value={form.fecha} onChange={e => set('fecha', e.target.value)} />
            {err('fecha')}
          </div>
          <div className="input-group">
            <label className="input-label" htmlFor="mov-monto">Monto</label>
            <input id="mov-monto" className="input" inputMode="decimal" value={form.monto} onChange={e => set('monto', e.target.value)} placeholder="0,00" />
            {err('monto')}
          </div>
          {form.tipo === 'pago' && (
            <div className="input-group">
              <label className="input-label" htmlFor="mov-medio">Medio</label>
              <select id="mov-medio" className="input" value={form.medio} onChange={e => set('medio', e.target.value)}>
                {MEDIOS_PAGO.map(m => <option key={m} value={m}>{ETIQUETA_MEDIO[m]}</option>)}
              </select>
              {err('medio')}
            </div>
          )}
          {form.tipo === 'pago' && form.medio === 'directa' && (
            <>
              <div className="input-group">
                <label className="input-label" htmlFor="mov-cliente">Cliente (opcional)</label>
                <select id="mov-cliente" className="input" value={form.clienteId} onChange={e => set('clienteId', e.target.value)}>
                  <option value="">— Ninguno —</option>
                  {clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
                {err('clienteId')}
              </div>
              <div className="input-group">
                <label className="input-label" htmlFor="mov-pedido">N.º de pedido (opcional)</label>
                <input id="mov-pedido" className="input" value={form.pedidoId} onChange={e => set('pedidoId', e.target.value)} />
              </div>
            </>
          )}
          <div className="input-group">
            <label className="input-label" htmlFor="mov-ref">Referencia / nota</label>
            <input id="mov-ref" className="input" value={form.referencia} onChange={e => set('referencia', e.target.value)} maxLength={300} />
          </div>
          {form.tipo === 'pago' && (
            <div className="input-group">
              <label className="input-label" htmlFor="mov-archivo">Comprobante (imagen o PDF, máx. 5 MB)</label>
              <input id="mov-archivo" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={e => setArchivo(e.target.files?.[0] || null)} />
              {err('archivo')}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary btn-sm" style={{ width: 'auto' }} onClick={guardar}>Guardar</button>
            <button className="btn btn-ghost btn-sm" style={{ width: 'auto' }} onClick={() => setForm(null)}>Cancelar</button>
          </div>
        </div>
      )}

      {msg && <div role="status" style={{ fontSize: 13, marginBottom: 10 }}>{msg}</div>}

      <div className="card">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          <input className="input" type="date" aria-label="Cuenta desde" value={desde} onChange={e => setDesde(e.target.value)} style={{ flex: 1, minWidth: 130 }} />
          <input className="input" type="date" aria-label="Cuenta hasta" value={hasta} onChange={e => setHasta(e.target.value)} style={{ flex: 1, minWidth: 130 }} />
          <select className="input" aria-label="Filtrar por medio" value={medio} onChange={e => setMedio(e.target.value)} style={{ flex: 1, minWidth: 130 }}>
            <option value="">Todos los medios</option>
            {MEDIOS_PAGO.map(m => <option key={m} value={m}>{ETIQUETA_MEDIO[m]}</option>)}
          </select>
        </div>
        {(desde || hasta) && <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6 }}>Saldo inicial: {formatearCentavos(estado.saldoInicial)}</div>}
        {estado.filas.length === 0 && <div style={{ color: 'var(--text3)', fontSize: 14, textAlign: 'center', padding: 16 }}>Sin movimientos</div>}
        {estado.filas.map(f => (
          <div key={`${f.origen}-${f.id}`} className="list-item" data-testid="fila-cuenta" style={{ opacity: f.anulado ? 0.55 : 1 }}>
            <div style={{ flex: 1 }}>
              <div className="list-item-name" style={f.anulado ? { textDecoration: 'line-through' } : undefined}>
                {f.tipo === 'compra' ? 'Compra (ingreso)' : f.tipo === 'cargo' ? 'Cargo' : `Pago · ${ETIQUETA_MEDIO[f.medio] || ''}`}
              </div>
              <div className="list-item-sub">
                {fechaCorta(f.fecha)}{f.referencia ? ` · ${f.referencia}` : ''}
                {f.anulado ? ` · ANULADO (${f.anulado.motivo}${f.anulado.usuario ? `, ${f.anulado.usuario}` : ''})` : ''}
              </div>
              {f.origen === 'cuenta' && !f.anulado && (
                <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                  {(f.comprobantePath || pendientesAdj.has(String(f.id))) && (
                    f.comprobantePath && verPin?.id === f.id ? (
                      <>
                        <input type="password" inputMode="numeric" autoComplete="off" maxLength={32} className="input" aria-label="PIN para ver el comprobante" placeholder="Tu PIN" value={verPin.pin} onChange={e => setVerPin({ id: f.id, pin: e.target.value })} style={{ width: 100 }} />
                        <button className="btn btn-primary btn-sm" style={{ width: 'auto' }} onClick={() => abrirComprobante(f.mov)}>Abrir</button>
                      </>
                    ) : (
                      <button className="btn btn-ghost btn-sm" style={{ width: 'auto' }} onClick={() => (f.comprobantePath ? setVerPin({ id: f.id, pin: '' }) : abrirComprobante(f.mov))}>
                        {f.comprobantePath ? 'Ver comprobante' : 'Ver comprobante (sin subir)'}
                      </button>
                    )
                  )}
                  <button className="btn btn-ghost btn-sm" style={{ width: 'auto', color: 'var(--danger)' }} onClick={() => setAnulando({ id: f.id, motivo: '' })}>Anular</button>
                </div>
              )}
              {anulando?.id === f.id && (
                <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                  <input className="input" aria-label="Motivo de la anulación" placeholder="Motivo (obligatorio)" value={anulando.motivo} onChange={e => setAnulando({ id: f.id, motivo: e.target.value })} style={{ flex: 1, minWidth: 140 }} />
                  <button className="btn btn-primary btn-sm" style={{ width: 'auto' }} onClick={confirmarAnulacion}>Confirmar anulación</button>
                  <button className="btn btn-ghost btn-sm" style={{ width: 'auto' }} onClick={() => setAnulando(null)}>Cancelar</button>
                </div>
              )}
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontWeight: 700, color: f.tipo === 'pago' ? 'var(--success)' : 'var(--text)' }}>{f.tipo === 'pago' ? '-' : ''}{formatearCentavos(f.montoCentavos)}</div>
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>{formatearCentavos(f.saldoAcumulado)}</div>
            </div>
          </div>
        ))}
        <div data-testid="totales-medio" style={{ fontSize: 13, marginTop: 10 }}>
          <div>Pagos en efectivo: {formatearCentavos(t.efectivo)} · transferencia: {formatearCentavos(t.transferencia)} · directa del cliente: {formatearCentavos(t.directa)}</div>
          <div style={{ fontWeight: 700 }}>Total pagado: {formatearCentavos(t.total)}{estado.totalAnulados > 0 ? ` · ${estado.totalAnulados} anulado(s)` : ''}</div>
        </div>
      </div>
    </div>
  );
};

// ---------------- Pedidos al proveedor ----------------
const Pedidos = ({ proveedor, pedidos, productos, stockMap, usuario, recargar, onAbrirIngreso }) => {
  const [abiertoId, setAbiertoId] = useState(null);
  const [q, setQ] = useState('');
  const [drafts, setDrafts] = useState({});
  const [msg, setMsg] = useState('');

  const propios = useMemo(() => pedidos.filter(p => String(p.proveedorId) === String(proveedor.id)).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)), [pedidos, proveedor.id]);
  const pedido = propios.find(p => p.id === abiertoId) || null;
  const porId = useMemo(() => new Map(productos.map(p => [String(p.id), p])), [productos]);
  const editable = pedido && pedido.estado !== 'recibido';
  const sugeridos = useMemo(() => (q.trim() ? buscarProductos(productos, q).slice(0, 6) : []), [productos, q]);

  const guardar = async (nuevo) => { if (nuevo !== pedido) { await guardarPedidoProveedor(nuevo); await recargar?.(); } };

  const crear = async () => {
    const p = nuevoPedidoProveedor(proveedor.id, { usuario });
    await guardarPedidoProveedor(p);
    setAbiertoId(p.id);
    await recargar?.();
  };

  const agregarProducto = async (prod) => {
    const bx = normalizarBultoX(prod.bultoX);
    await guardar(agregarItems(pedido, [{ productoId: prod.id, cantidad: 1, unidad: 'u', bultoX: bx }]));
    setQ('');
  };

  const agregarBajos = async () => {
    const sug = stockBajoDeProveedor(productos, stockMap, proveedor.id);
    if (!sug.length) { setMsg('No hay productos de este proveedor con stock bajo.'); return; }
    await guardar(agregarItems(pedido, sug.map(s => ({ productoId: s.productoId, cantidad: s.sugerido, unidad: 'u', bultoX: porId.get(s.productoId)?.bultoX }))));
    setMsg(`Se agregaron ${sug.length} producto(s) con stock bajo.`);
  };

  const cambiarCantidad = async (it, valor) => {
    setDrafts(d => ({ ...d, [it.productoId]: valor }));
    const n = toInt(valor);
    if (n !== null && n > 0) await guardar(fijarItem(pedido, { ...it, cantidad: n }));
  };
  const cambiarUnidad = async (it, unidad) => guardar(fijarItem(pedido, { ...it, unidad }));

  const filasPdf = () => pedido.items.map(it => ({
    codigo: porId.get(it.productoId)?.codigo || '', nombre: porId.get(it.productoId)?.nombre || `Producto ${it.productoId}`,
    cantidad: it.cantidad, unidad: it.unidad, unidades: unidadesItem(it),
  }));

  const compartirPdf = async () => {
    const file = await generarPedidoProveedorFile(filasPdf(), { proveedor: proveedor.descripcion, fecha: new Date(pedido.updatedAt || Date.now()).toISOString() });
    if (canShareFiles()) { try { await shareFiles({ title: file.name, text: textoCompartirPedido(pedido, productos, proveedor), files: [file] }); return; } catch { /* descarga */ } }
    descargarArchivo(file);
  };
  const compartirTexto = () => window.open(`https://wa.me/?text=${encodeURIComponent(textoCompartirPedido(pedido, productos, proveedor))}`, '_blank', 'noopener');

  const enviar = async () => { await marcarPedidoEnviado(pedido.id); await recargar?.(); };
  const recibir = async () => {
    const r = await recibirPedidoProveedor(pedido.id);
    if (!r.ok) { setMsg(r.mensaje || 'No se pudo marcar como recibido.'); return; }
    await recargar?.();
    if (onAbrirIngreso) onAbrirIngreso(r.formIngreso);
  };

  if (!pedido) {
    return (
      <div className="card" data-testid="lista-pedidos-proveedor">
        <button className="btn btn-primary btn-sm" style={{ width: 'auto', marginBottom: 10 }} onClick={crear}>Nuevo pedido al proveedor</button>
        {msg && <div role="status" style={{ fontSize: 13, marginBottom: 8 }}>{msg}</div>}
        {propios.length === 0 && <div style={{ color: 'var(--text3)', fontSize: 14, textAlign: 'center', padding: 16 }}>Todavía no hay pedidos a este proveedor</div>}
        {propios.map(p => (
          <div key={p.id} className="list-item" style={{ cursor: 'pointer' }} onClick={() => setAbiertoId(p.id)} data-testid="pedido-proveedor">
            <div>
              <div className="list-item-name">{ETIQUETA_ESTADO[p.estado]} · {p.items.length} producto(s)</div>
              <div className="list-item-sub">{new Date(p.updatedAt || 0).toLocaleDateString('es-AR')}</div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="card" data-testid="editor-pedido-proveedor">
      <button className="btn btn-ghost btn-sm" onClick={() => { setAbiertoId(null); setMsg(''); }} style={{ marginBottom: 10 }}>‹ Volver</button>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>Pedido a {proveedor.descripcion} · {ETIQUETA_ESTADO[pedido.estado]}</div>
      {editable && (
        <div style={{ marginBottom: 10 }}>
          <input className="input" type="search" aria-label="Buscar producto para el pedido" placeholder="Agregar producto (nombre, código o marca)" value={q} onChange={e => setQ(e.target.value)} />
          {sugeridos.map(p => (
            <div key={p.id} className="list-item" style={{ cursor: 'pointer' }} onClick={() => agregarProducto(p)} data-testid="sugerido-pedido">
              <div className="list-item-name">{p.nombre}</div>
              <div className="list-item-sub">{p.codigo || '—'}</div>
            </div>
          ))}
          <button className="btn btn-ghost btn-sm" style={{ width: 'auto', marginTop: 8 }} onClick={agregarBajos}>Agregar los de stock bajo</button>
        </div>
      )}
      {msg && <div role="status" style={{ fontSize: 13, marginBottom: 8 }}>{msg}</div>}
      {pedido.items.length === 0 && <div style={{ color: 'var(--text3)', fontSize: 14 }}>El pedido está vacío.</div>}
      {pedido.items.map(it => {
        const prod = porId.get(it.productoId);
        const bx = normalizarBultoX(it.bultoX || prod?.bultoX);
        return (
          <div key={it.productoId} className="list-item" data-testid="renglon-pedido-proveedor">
            <div style={{ flex: 1 }}>
              <div className="list-item-name">{prod?.nombre || `Producto ${it.productoId}`}</div>
              <div className="list-item-sub">{prod?.codigo || '—'} · {unidadesItem(it)} u.</div>
            </div>
            {editable ? (
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <input className="qty-input" aria-label={`Cantidad ${prod?.nombre || ''}`} inputMode="numeric" value={drafts[it.productoId] ?? String(it.cantidad)} onChange={e => cambiarCantidad(it, e.target.value)} style={{ width: 60 }} />
                <select aria-label={`Unidad ${prod?.nombre || ''}`} className="input" value={it.unidad} onChange={e => cambiarUnidad(it, e.target.value)} style={{ width: 84 }}>
                  <option value="u">u.</option>
                  {bx && <option value="bulto">bulto</option>}
                </select>
                <button className="btn-icon" style={{ color: 'var(--danger)' }} aria-label="Quitar" onClick={() => guardar(quitarItem(pedido, it.productoId))}>×</button>
              </div>
            ) : <div style={{ fontWeight: 700 }}>{it.cantidad} {it.unidad === 'bulto' ? 'bulto(s)' : 'u.'}</div>}
          </div>
        );
      })}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
        {pedido.items.length > 0 && <button className="btn btn-ghost btn-sm" style={{ width: 'auto' }} onClick={compartirPdf}>Compartir PDF</button>}
        {pedido.items.length > 0 && <button className="btn btn-ghost btn-sm" style={{ width: 'auto' }} onClick={compartirTexto}>WhatsApp</button>}
        {pedido.estado === 'borrador' && pedido.items.length > 0 && <button className="btn btn-ghost btn-sm" style={{ width: 'auto' }} onClick={enviar}>Marcar enviado</button>}
        {pedido.items.length > 0 && (
          <button className="btn btn-primary btn-sm" style={{ width: 'auto' }} onClick={recibir}>
            {pedido.estado === 'recibido' ? 'Abrir ingreso precargado' : 'Marcar recibido'}
          </button>
        )}
      </div>
      {pedido.estado === 'recibido' && <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 8 }}>{pedido.ingresoId ? 'Ingreso confirmado.' : 'Recibido: falta confirmar el ingreso de mercadería.'}</div>}
    </div>
  );
};

// ---------------- Pantalla ----------------
const Proveedores = ({ onAbrirIngreso }) => {
  const {
    vendedorActual, proveedores = [], clientes = [], productos = [], stockMap, ingresosCostos = [],
    cuentaProveedores = [], pedidosProveedor = [], recargar,
  } = useApp();
  const admin = esAdmin(vendedorActual?.permiso);
  const [sel, setSel] = useState(null);
  const [vista, setVista] = useState('cuenta');

  const compras = useMemo(() => comprasDeIngresos(ingresosCostos), [ingresosCostos]);

  if (!admin) {
    return (
      <div className="page">
        <h1 className="page-title">Proveedores</h1>
        <div className="empty-state"><div className="empty-text">Esta pantalla es solo para administradores.</div></div>
      </div>
    );
  }

  const proveedor = proveedores.find(p => String(p.id) === String(sel)) || null;
  const usuario = vendedorActual?.nombre || '';

  return (
    <div className="page">
      <h1 className="page-title">Proveedores</h1>
      <ComprasSyncBar onDone={recargar} />
      {!proveedor && (
        <div className="card" data-testid="lista-proveedores">
          {proveedores.length === 0 && <div style={{ color: 'var(--text3)', fontSize: 14, textAlign: 'center', padding: 16 }}>Primero cargá al menos un proveedor en Config → Proveedores.</div>}
          {proveedores.map(p => {
            const s = saldoProveedor(compras, cuentaProveedores, p.id);
            return (
              <div key={p.id} className="list-item" style={{ cursor: 'pointer' }} onClick={() => { setSel(p.id); setVista('cuenta'); }} data-testid="fila-proveedor">
                <div>
                  <div className="list-item-name">{p.descripcion}</div>
                  <div className="list-item-sub">{p.codigo || '—'}</div>
                </div>
                <div style={{ fontWeight: 700, color: s > 0 ? 'var(--warning)' : s < 0 ? 'var(--success)' : 'var(--text)' }}>{formatearCentavos(s)}</div>
              </div>
            );
          })}
        </div>
      )}
      {proveedor && (
        <>
          <button className="btn btn-ghost btn-sm" onClick={() => setSel(null)} style={{ marginBottom: 10 }}>‹ Proveedores</button>
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            <button className={`btn btn-sm ${vista === 'cuenta' ? 'btn-primary' : 'btn-ghost'}`} style={{ flex: 1 }} onClick={() => setVista('cuenta')}>Cuenta corriente</button>
            <button className={`btn btn-sm ${vista === 'pedidos' ? 'btn-primary' : 'btn-ghost'}`} style={{ flex: 1 }} onClick={() => setVista('pedidos')}>Pedidos</button>
          </div>
          {vista === 'cuenta'
            ? <Cuenta proveedor={proveedor} compras={compras} movs={cuentaProveedores} clientes={clientes} usuario={usuario} recargar={recargar} />
            : <Pedidos proveedor={proveedor} pedidos={pedidosProveedor} productos={productos} stockMap={stockMap} usuario={usuario} recargar={recargar} onAbrirIngreso={onAbrirIngreso} />}
        </>
      )}
    </div>
  );
};

export default Proveedores;
