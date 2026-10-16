// src/pages/Rendicion.js — REQ-REN (AC-REN-1..4). SOLO ADMIN.
// Devoluciones, cambios y notas de credito sobre pedidos facturados, rendicion del dia con PDF y
// anulacion con motivo (solo online). Toda la logica esta en src/domain/rendicion.js y la
// orquestacion en src/services/rendicionService.js. El PIN vive solo en este estado: no se guarda
// ni se loguea.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../hooks/useAppContext';
import { esAdmin } from '../domain/permisos';
import { hoyISO } from '../domain/validacion';
import { isPedidoVisible, normalizePedidoFecha } from '../utils/pedidos';
import {
  disponiblesParaDevolver, diferenciaCambioCents, resumenRendicionDia, ETIQUETA_TIPO_RENDICION, TIPOS_RENDICION,
} from '../domain/rendicion';
import {
  cargarRendicionesLocales, registrarRendicion, subirRendiciones, bajarRendiciones, anularRendicion, contarPendientesRendicion,
} from '../services/rendicionService';
import { credencialesAdminProductos } from '../services/productosAdminService';
import { generarRendicionDiaFile } from '../utils/pdfGen';

const pesos = (cents) => `$${((Number(cents) || 0) / 100).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fechaCorta = (iso) => String(iso || '').slice(0, 10).split('-').reverse().join('/');
const formVacio = () => ({ tipo: 'devolucion', cant: {}, merma: {}, sale: [], montoNc: '', tipoFactura: '', nroNc: '', motivo: '' });

const Rendicion = () => {
  const { vendedorActual, pedidos, productos, recargar } = useApp();
  const admin = esAdmin(vendedorActual?.permiso);
  const [locales, setLocales] = useState({ rendiciones: [], cuenta: [] });
  const [pendientes, setPendientes] = useState(null);
  const [busqueda, setBusqueda] = useState('');
  // Los pedidos se buscan siempre dentro de un día (por defecto, hoy): nunca la lista entera.
  const [fechaPedido, setFechaPedido] = useState(hoyISO());
  const [pedidoSel, setPedidoSel] = useState(null);
  const [form, setForm] = useState(formVacio());
  const [saleQ, setSaleQ] = useState('');
  const [errores, setErrores] = useState({});
  const [fechaDia, setFechaDia] = useState(hoyISO());
  const [pin, setPin] = useState('');
  const [msg, setMsg] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const recargarLocales = useCallback(async () => {
    setLocales(await cargarRendicionesLocales());
    setPendientes(await contarPendientesRendicion().catch(() => null));
  }, []);
  useEffect(() => { recargarLocales(); }, [recargarLocales]);

  const candidatos = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!fechaPedido) return [];
    return (pedidos || [])
      .filter(isPedidoVisible)
      .filter(p => String(p.estado || '').toLowerCase() === 'facturado')
      .filter(p => normalizePedidoFecha(p.fecha) === fechaPedido)
      .filter(p => !q || String(p.clienteNombre || '').toLowerCase().includes(q) || String(p.remoteId ?? '') === q || String(p.id) === q)
      .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')))
      .slice(0, 20);
  }, [pedidos, busqueda, fechaPedido]);

  const disponibles = useMemo(() => (pedidoSel ? [...disponiblesParaDevolver(pedidoSel, locales.rendiciones).values()] : []), [pedidoSel, locales]);
  const productosPorId = useMemo(() => new Map((productos || []).map(p => [String(p.id), p])), [productos]);
  const sugerenciasSale = useMemo(() => {
    const q = saleQ.trim().toLowerCase();
    if (!q) return [];
    return (productos || []).filter(p => String(p.nombre || '').toLowerCase().includes(q)).slice(0, 8);
  }, [productos, saleQ]);
  const resumen = useMemo(() => resumenRendicionDia(locales.rendiciones, fechaDia), [locales, fechaDia]);

  if (!admin) {
    return (
      <div className="page">
        <h1 className="page-title">Rendición</h1>
        <div className="empty-state"><div className="empty-text">Esta pantalla es solo para administradores.</div></div>
      </div>
    );
  }

  const renglonesEntra = () => Object.entries(form.cant)
    .filter(([, c]) => String(c).trim() !== '')
    .map(([productoId, cantidad]) => ({ productoId, cantidad, vuelveAlStock: !form.merma[productoId] }));

  const diferencia = form.tipo === 'cambio'
    ? diferenciaCambioCents(
      renglonesEntra().map(r => ({ cantidad: Number(r.cantidad) || 0, precioCents: disponibles.find(d => d.productoId === r.productoId)?.precioCents || 0 })),
      form.sale.map(s => ({ cantidad: Number(s.cantidad) || 0, precioCents: Math.round((Number(productosPorId.get(String(s.productoId))?.precio) || 0) * 100) })),
    )
    : 0;

  const registrar = async () => {
    setMsg('');
    setOcupado(true);
    try {
      const f = {
        tipo: form.tipo, motivo: form.motivo, montoNc: form.montoNc, tipoFactura: form.tipoFactura, nroNc: form.nroNc,
        renglones: form.tipo === 'nc' ? [] : renglonesEntra(), sale: form.tipo === 'cambio' ? form.sale : [],
      };
      const r = await registrarRendicion(f, { pedido: pedidoSel, productos, usuario: vendedorActual?.nombre || '' });
      if (!r.ok) { setErrores(r.errores || {}); return; }
      setErrores({});
      setForm(formVacio());
      setPedidoSel(null);
      setMsg('Rendición registrada en este dispositivo. Subila con tu PIN para que impacte en la cuenta del cliente.');
      await recargarLocales();
      if (recargar) await recargar();
    } finally {
      setOcupado(false);
    }
  };

  const credenciales = async () => {
    const cr = await credencialesAdminProductos(pin);
    if (!cr.ok) { setMsg(cr.mensaje || 'Ingresá tu PIN de administrador.'); return null; }
    setPin('');
    return cr.cred;
  };

  const sincronizar = async () => {
    setMsg('');
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { setMsg('Necesitás conexión para subir las rendiciones.'); return; }
    const cred = await credenciales();
    if (!cred) return;
    setOcupado(true);
    try {
      const s = await subirRendiciones(cred, { usuario: vendedorActual?.nombre || '' });
      if (!s.ok) { setMsg(s.mensaje); return; }
      const b = await bajarRendiciones(cred);
      const rech = (s.rechazados || []).map(x => `#${String(x.id).slice(0, 8)}: ${x.mensaje}`).join(' · ');
      setMsg(`Subidas: ${s.subidos}. ${b.ok ? `Bajadas: ${b.bajados.rendiciones}.` : b.mensaje}${rech ? ` Rechazadas (se revirtió el stock): ${rech}` : ''}`);
      await recargarLocales();
      if (recargar) await recargar();
    } finally {
      setOcupado(false);
    }
  };

  const anular = async (fila) => {
    setMsg('');
    // eslint-disable-next-line no-alert
    const motivo = window.prompt(`Motivo de la anulación de la rendición #${fila.idCorto}:`);
    if (motivo === null) return;
    const cred = await credenciales();
    if (!cred) return;
    setOcupado(true);
    try {
      const r = await anularRendicion(cred, fila.id, motivo, { usuario: vendedorActual?.nombre || '' });
      setMsg(r.mensaje || (r.ok ? 'Rendición anulada.' : 'No se pudo anular.'));
      await recargarLocales();
      if (recargar) await recargar();
    } finally {
      setOcupado(false);
    }
  };

  const descargarPdf = async () => {
    const file = await generarRendicionDiaFile(resumen, { fecha: fechaDia });
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const set = (patch) => setForm(prev => ({ ...prev, ...patch }));
  const err = (k) => (errores[k] ? <div role="alert" style={{ color: 'var(--danger)', fontSize: 12 }}>{errores[k]}</div> : null);

  return (
    <div className="page">
      <h1 className="page-title">Rendición</h1>

      <div className="card" style={{ padding: '12px 14px', marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="password" inputMode="numeric" autoComplete="off" maxLength={32} className="input" aria-label="PIN de administrador"
            placeholder="Tu PIN" value={pin} onChange={e => setPin(e.target.value)} style={{ width: 120 }} />
          <button className="btn btn-primary btn-sm" style={{ width: 'auto' }} disabled={ocupado} onClick={sincronizar}>Subir y bajar rendiciones</button>
          {pendientes && pendientes.total > 0 && <span data-testid="pendientes-rendicion" style={{ fontSize: 12, color: 'var(--warning)' }}>{pendientes.total} pendiente(s) de subir</span>}
        </div>
        {msg && <div role="status" style={{ marginTop: 8, fontSize: 13, fontWeight: 700 }}>{msg}</div>}
      </div>

      {!pedidoSel && (
        <div className="card" style={{ padding: '12px 14px', marginBottom: 14 }}>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Buscar pedido facturado</div>
          <input className="input" aria-label="Fecha del pedido" type="date" value={fechaPedido} onChange={e => setFechaPedido(e.target.value)} />
          <input className="input" aria-label="Buscar pedido" placeholder="Cliente o n.º de pedido (de ese día)" value={busqueda} onChange={e => setBusqueda(e.target.value)} style={{ marginTop: 6 }} />
          {candidatos.map(p => (
            <button key={p.id} className="btn btn-ghost btn-sm" data-testid={`pedido-${p.id}`} style={{ width: '100%', marginTop: 6, textAlign: 'left' }}
              onClick={() => { setPedidoSel(p); setForm(formVacio()); setErrores({}); }}>
              {p.clienteNombre} · Pedido {p.remoteId ?? `${p.id} (sin sincronizar)`} · {fechaCorta(p.fecha)} · ${Number(p.total || 0).toLocaleString('es-AR')}
            </button>
          ))}
          {candidatos.length === 0 && (
            <div style={{ fontSize: 13, color: 'var(--text3)', marginTop: 6 }} data-testid="sin-pedidos-fecha">
              {fechaPedido ? `No hay pedidos facturados del ${fechaCorta(fechaPedido)} que coincidan.` : 'Elegí la fecha del pedido para ver los facturados de ese día.'}
            </div>
          )}
        </div>
      )}

      {pedidoSel && (
        <div className="card" data-testid="form-rendicion" style={{ padding: '12px 14px', marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <strong>{pedidoSel.clienteNombre} · Pedido {pedidoSel.remoteId ?? pedidoSel.id}</strong>
            <button className="btn btn-ghost btn-sm" style={{ width: 'auto' }} onClick={() => setPedidoSel(null)}>Cambiar</button>
          </div>
          {err('pedido')}
          <div style={{ display: 'flex', gap: 6, margin: '10px 0' }}>
            {TIPOS_RENDICION.map(t => (
              <button key={t} className={`btn btn-sm ${form.tipo === t ? 'btn-primary' : 'btn-ghost'}`} style={{ width: 'auto' }} onClick={() => set({ tipo: t })}>{ETIQUETA_TIPO_RENDICION[t]}</button>
            ))}
          </div>

          {form.tipo !== 'nc' && (
            <div>
              <div style={{ fontWeight: 700, fontSize: 13 }}>{form.tipo === 'cambio' ? 'Entra (vuelve del cliente)' : 'Productos devueltos'}</div>
              {disponibles.map(d => (
                <div key={d.productoId} style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
                  <span style={{ flex: 1, minWidth: 140 }}>{d.nombre} <small>(hasta {d.disponible} · {pesos(d.precioCents)})</small></span>
                  <input className="input" type="number" min="0" step="1" aria-label={`Cantidad ${d.nombre}`} style={{ width: 80 }}
                    value={form.cant[d.productoId] ?? ''} disabled={d.disponible <= 0}
                    onChange={e => set({ cant: { ...form.cant, [d.productoId]: e.target.value } })} />
                  <label style={{ fontSize: 12 }}>
                    <input type="checkbox" checked={!!form.merma[d.productoId]} onChange={e => set({ merma: { ...form.merma, [d.productoId]: e.target.checked } })} />
                    {' '}No vuelve al stock (roto/vencido)
                  </label>
                  {err(`item:${d.productoId}`)}
                </div>
              ))}
              {err('renglones')}
            </div>
          )}

          {form.tipo === 'cambio' && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>Sale (se lleva el cliente)</div>
              <input className="input" aria-label="Buscar producto que sale" placeholder="Buscar producto" value={saleQ} onChange={e => setSaleQ(e.target.value)} />
              {sugerenciasSale.map(p => (
                <button key={p.id} className="btn btn-ghost btn-sm" style={{ width: '100%', marginTop: 4, textAlign: 'left' }}
                  onClick={() => { if (!form.sale.some(s => String(s.productoId) === String(p.id))) set({ sale: [...form.sale, { productoId: String(p.id), cantidad: '1' }] }); setSaleQ(''); }}>
                  {p.nombre} · ${Number(p.precio || 0).toLocaleString('es-AR')}
                </button>
              ))}
              {form.sale.map((s, i) => (
                <div key={s.productoId} style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
                  <span style={{ flex: 1 }}>{productosPorId.get(String(s.productoId))?.nombre || s.productoId}</span>
                  <input className="input" type="number" min="1" step="1" aria-label={`Cantidad que sale ${s.productoId}`} style={{ width: 80 }} value={s.cantidad}
                    onChange={e => set({ sale: form.sale.map((x, j) => (j === i ? { ...x, cantidad: e.target.value } : x)) })} />
                  <button className="btn btn-ghost btn-sm" style={{ width: 'auto' }} onClick={() => set({ sale: form.sale.filter((_, j) => j !== i) })}>Quitar</button>
                  {err(`sale:${s.productoId}`)}
                </div>
              ))}
              {err('sale')}
              <div data-testid="diferencia-cambio" style={{ marginTop: 8, fontWeight: 700 }}>
                {diferencia >= 0 ? `A favor del cliente: ${pesos(diferencia)}` : `El cliente paga: ${pesos(-diferencia)}`}
              </div>
            </div>
          )}

          {form.tipo === 'nc' && (
            <div>
              <label className="input-label" htmlFor="ren-monto">Monto de la nota de crédito</label>
              <input id="ren-monto" className="input" inputMode="decimal" value={form.montoNc} onChange={e => set({ montoNc: e.target.value })} />
              {err('montoNc')}
              <label className="input-label" htmlFor="ren-tf">Factura</label>
              <select id="ren-tf" className="input" value={form.tipoFactura} onChange={e => set({ tipoFactura: e.target.value })}>
                <option value="">Ninguna</option><option value="A">Factura A</option><option value="B">Factura B</option>
              </select>
              {err('tipoFactura')}
              <label className="input-label" htmlFor="ren-nro">N.º de NC (opcional)</label>
              <input id="ren-nro" className="input" maxLength={30} value={form.nroNc} onChange={e => set({ nroNc: e.target.value })} />
              {err('nroNc')}
            </div>
          )}

          <label className="input-label" htmlFor="ren-motivo" style={{ marginTop: 8 }}>Motivo</label>
          <input id="ren-motivo" className="input" maxLength={300} value={form.motivo} onChange={e => set({ motivo: e.target.value })} />
          {err('motivo')}
          {err('tipo')}
          <button className="btn btn-success" style={{ width: '100%', marginTop: 10 }} disabled={ocupado} onClick={registrar}>Registrar rendición</button>
        </div>
      )}

      <div className="card" style={{ padding: '12px 14px', marginBottom: 80 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <strong style={{ flex: 1 }}>Rendición del día</strong>
          <input className="input" type="date" aria-label="Fecha de la rendición" value={fechaDia} onChange={e => setFechaDia(e.target.value)} style={{ width: 160 }} />
        </div>
        {resumen.filas.length === 0 && <div style={{ fontSize: 13, color: 'var(--text3)', marginTop: 6 }}>Sin rendiciones ese día.</div>}
        {resumen.filas.map(f => (
          <div key={f.id} data-testid={`fila-${f.id}`} style={{ padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 13, opacity: f.anulada || f.rechazada ? 0.6 : 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <strong>#{f.idCorto} · {f.tipoLabel} · {f.clienteNombre}</strong>
              <span>{pesos(f.creditoCents)}</span>
            </div>
            <div style={{ color: 'var(--text3)' }}>{f.detalle || f.motivo}</div>
            <div style={{ fontSize: 12 }}>
              {f.anulada ? `ANULADA: ${f.motivoAnulacion}` : f.rechazada ? 'RECHAZADA por el servidor (stock revertido)' : f.pendiente ? 'Sin subir' : 'Vigente'}
              {!f.anulada && !f.rechazada && !f.pendiente && (
                <button className="btn btn-ghost btn-sm" style={{ width: 'auto', marginLeft: 8 }} disabled={ocupado} onClick={() => anular(f)}>Anular</button>
              )}
            </div>
          </div>
        ))}
        <div data-testid="totales-rendicion" style={{ marginTop: 8, fontSize: 13 }}>
          Devuelto {pesos(resumen.totales.devueltoCents)} · NC {pesos(resumen.totales.ncCents)} · Cambios {pesos(resumen.totales.cambiosCents)} · Mermas {resumen.totales.mermaUnidades} u. ({pesos(resumen.totales.mermaCents)})
        </div>
        <button className="btn btn-success btn-sm" style={{ width: '100%', marginTop: 10 }} disabled={resumen.filas.length === 0} onClick={descargarPdf}>Descargar PDF</button>
      </div>
    </div>
  );
};

export default Rendicion;
