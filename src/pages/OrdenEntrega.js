// src/pages/OrdenEntrega.js
// Visible para cualquier usuario. Cada cliente tiene un dia habitual de
// reparto y un puesto fijo en la ruta de ese dia (ej: "Garibaldi 420 -
// Miercoles - Orden 5"). Al imprimir los pedidos de un dia de reparto, se
// renumeran sin huecos segun quien realmente tiene pedido ese dia: si el
// puesto 2 no pidio, el que sigue pasa a ser el 2, no el 3. Ese numero
// calculado es el que aparece en la boleta — no se guarda en el pedido.
import React, { useMemo, useState } from 'react';
import { useApp } from '../hooks/useAppContext';
import { fuzzySearch } from '../utils/fuzzy';
import { updateCliente, getPedidos } from '../db';
import { syncClientes } from '../sync/syncService';
import { generarFacturaFile } from '../utils/pdfGen';
import { calcularOrdenDelDia } from '../utils/ordenEntrega';
import { shareFiles, canShareFiles } from '../utils/share';
import { mergePdfFilesToSingleFile } from '../utils/pdfMerge';
import { isPedidoVisible, normalizePedidoFecha, getDeudaPendienteParaPedido } from '../utils/pedidos';
import { DIAS_SEMANA, DIA_LABEL, diaDeFecha, sumarDias } from '../utils/diasSemana';
import { marcarEntregadoOnlineFirst } from '../services/pedidoRepository';
import { puedeMarcarEntregado, puedeDesmarcarEntregado, pedidosEnCierresVigentes, pedidoIdComision } from '../domain/comisiones';

// REQ-COM (AC-COM-1): lista de pedidos facturados de un dia con el boton
// "Marcar entregado" / "Desmarcar". Lo usan admin y armador; el vendedor solo
// ve el estado. No cambia el estado del pedido ni el stock.
export const EntregasDelDia = ({ pedidos, permiso, recargar, cierres = [] }) => {
  // Por defecto: los pedidos que salen HOY a reparto (cargados ayer), mismo
  // criterio que "Imprimir pedidos".
  const [fecha, setFecha] = useState(() => sumarDias(null, -1));
  const [guardandoId, setGuardandoId] = useState(null);
  const cerrados = useMemo(() => pedidosEnCierresVigentes(cierres), [cierres]);
  const cierreDe = (p) => cerrados.get(pedidoIdComision(p)) || null;
  const lista = useMemo(() => (pedidos || [])
    .filter(p => isPedidoVisible(p) && p.estado === 'facturado' && normalizePedidoFecha(p.fecha) === fecha)
    .sort((a, b) => String(a.clienteNombre || '').localeCompare(String(b.clienteNombre || ''), 'es')), [pedidos, fecha]);

  const toggle = async (p) => {
    // Los cierres solo se conocen en el dispositivo del admin; en el resto, si
    // el pedido ya estaba cerrado, el ajuste lo muestra el dashboard (AC-COM-13).
    const chk = p.entregado ? puedeDesmarcarEntregado(p, permiso, cierreDe(p)) : puedeMarcarEntregado(p, permiso);
    if (!chk.ok) { alert(chk.motivo); return; }
    if (chk.requiereConfirmacion && !window.confirm('Este pedido ya está en un cierre de comisiones: si lo desmarcás va a quedar como ajuste pendiente. ¿Desmarcar igual?')) return;
    setGuardandoId(p.id);
    try {
      // S-COM-17: el repositorio tambien valida "solo el admin desmarca un pedido cerrado".
      await marcarEntregadoOnlineFirst(p, !p.entregado, { cerradoEn: cierreDe(p) });
      await recargar();
    } catch (e) {
      alert('No se pudo guardar la entrega: ' + (e?.message || String(e)));
    } finally {
      setGuardandoId(null);
    }
  };

  const entregados = lista.filter(p => p.entregado).length;
  return (
    <div className="card" data-testid="entregas">
      <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 14 }}>Entregas</div>
      <label className="input-label" htmlFor="fecha-entregas">Pedidos del día</label>
      <input id="fecha-entregas" type="date" className="input" value={fecha} onChange={e => setFecha(e.target.value)} style={{ marginBottom: 10 }} />
      {lista.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text3)' }}>No hay pedidos facturados ese día.</div>
      ) : (
        <>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6 }}>{entregados} de {lista.length} entregados</div>
          {lista.map(p => {
            const puede = p.entregado ? puedeDesmarcarEntregado(p, permiso, cierreDe(p)).ok : puedeMarcarEntregado(p, permiso).ok;
            return (
              <div key={p.id} data-testid={`entrega-${p.id}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderTop: '1px solid var(--border)' }}>
                <span style={{ flex: 1, fontSize: 14 }}>{p.clienteNombre}</span>
                {p.entregado
                  ? <span className="badge badge-done">Entregado</span>
                  : <span className="badge badge-pending">Sin entregar</span>}
                {puede && (
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ width: 'auto' }}
                    disabled={guardandoId === p.id}
                    onClick={() => toggle(p)}
                  >
                    {p.entregado ? 'Desmarcar' : 'Marcar entregado'}
                  </button>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
};

const OrdenEntrega = () => {
  const { clientes, deudas, recargar, syncPedidosFecha, pedidos, vendedorActual, comisionesCierres } = useApp();

  // Sube el cliente recien guardado ya mismo y avisa si no llego a Supabase
  // (antes quedaba en el aire: syncClientes puede saltear en silencio un
  // error de permisos de escritura, o directamente no se esperaba la subida).
  const subirClientes = async () => {
    if (!navigator.onLine) return;
    try {
      const r = await syncClientes();
      if (r?.skipped) {
        alert(
          'Se guardó en este dispositivo, pero Supabase rechazó la subida por permisos (RLS) ' +
          'en la tabla "clientes". El día/orden de entrega no va a verse en otros dispositivos ' +
          'hasta que se habilite la escritura ahí.'
        );
      }
    } catch (e) {
      alert('Se guardó en este dispositivo, pero no se subió a Supabase: ' + (e?.message || String(e)));
    }
  };

  const [clienteQ, setClienteQ] = useState('');
  const [clienteSel, setClienteSel] = useState(null);
  const [dia, setDia] = useState('');
  const [orden, setOrden] = useState('');
  const [guardando, setGuardando] = useState(false);

  const [fechasImprimir, setFechasImprimir] = useState([]);
  const [nuevaFecha, setNuevaFecha] = useState('');
  const [imprimiendo, setImprimiendo] = useState(false);

  const clienteSugg = clienteQ.trim().length >= 1 ? fuzzySearch(clienteQ, clientes || [], 'nombre', 8) : [];

  const asignados = useMemo(() => {
    return (clientes || [])
      .filter(c => c.diaEntrega && Number(c.ordenEntrega) > 0)
      .sort((a, b) => a.diaEntrega.localeCompare(b.diaEntrega) || Number(a.ordenEntrega) - Number(b.ordenEntrega));
  }, [clientes]);

  const porDia = useMemo(() => {
    const map = {};
    for (const c of asignados) {
      if (!map[c.diaEntrega]) map[c.diaEntrega] = [];
      map[c.diaEntrega].push(c);
    }
    return map;
  }, [asignados]);

  const seleccionarCliente = (c) => {
    setClienteSel(c);
    setClienteQ('');
    setDia(c.diaEntrega || '');
    setOrden(c.ordenEntrega != null ? String(c.ordenEntrega) : '');
  };

  const guardarAsignacion = async () => {
    if (!clienteSel || !dia || !orden || Number(orden) <= 0) return;
    const ordenNum = Number(orden);
    setGuardando(true);
    try {
      // Si ese numero ya lo tiene otro cliente de ese mismo dia, se corre un
      // lugar a ese cliente y a todos los que le siguen (incluido el que ya
      // estaba en ese numero), para "insertar" a este sin pisar a nadie.
      const otros = (clientes || []).filter(c => c.id !== clienteSel.id && c.diaEntrega === dia);
      const yaUsado = otros.some(c => Number(c.ordenEntrega) === ordenNum);
      if (yaUsado) {
        const aCorrer = otros.filter(c => Number(c.ordenEntrega) >= ordenNum);
        for (const c of aCorrer) {
          await updateCliente({ ...c, ordenEntrega: Number(c.ordenEntrega) + 1 });
        }
      }

      await updateCliente({ ...clienteSel, diaEntrega: dia, ordenEntrega: ordenNum });
      await recargar();
      await subirClientes();
      setClienteSel(null);
      setDia('');
      setOrden('');
    } catch (e) {
      alert('No se pudo guardar: ' + (e?.message || String(e)));
    } finally {
      setGuardando(false);
    }
  };

  const quitarAsignacion = async (c) => {
    if (!window.confirm(`¿Quitar el orden de entrega de "${c.nombre}"?`)) return;
    try {
      await updateCliente({ ...c, diaEntrega: null, ordenEntrega: null });
      await recargar();
      await subirClientes();
    } catch (e) {
      alert('No se pudo quitar: ' + (e?.message || String(e)));
    }
  };

  const editar = (c) => seleccionarCliente(c);

  // "Hoy" = el dia de reparto. Los pedidos que salen hoy son los que se
  // cargaron y armaron AYER.
  const agregarHoy = () => {
    const hoy = sumarDias(null, 0);
    setFechasImprimir(prev => prev.includes(hoy) ? prev : [...prev, hoy].sort());
  };

  const agregarFecha = () => {
    if (!nuevaFecha) return;
    setFechasImprimir(prev => prev.includes(nuevaFecha) ? prev : [...prev, nuevaFecha].sort());
    setNuevaFecha('');
  };

  const quitarFecha = (f) => setFechasImprimir(prev => prev.filter(x => x !== f));

  const imprimirPedidos = async () => {
    if (fechasImprimir.length === 0) return;
    setImprimiendo(true);
    try {
      const files = [];
      for (const fechaEntrega of fechasImprimir) {
        const fechaPedido = sumarDias(fechaEntrega, -1);
        // El "dia" que se le asigna al cliente es el dia en que se le toma el
        // pedido (ej: miercoles), no el dia de entrega (jueves) — por eso se
        // compara contra el dia de fechaPedido, no el de fechaEntrega.
        const diaObjetivo = diaDeFecha(fechaPedido);

        await syncPedidosFecha(fechaPedido);
        const todos = await getPedidos();
        const pedidosDelDia = todos.filter(p =>
          isPedidoVisible(p) && normalizePedidoFecha(p.fecha) === fechaPedido
        );

        const ordenados = calcularOrdenDelDia(pedidosDelDia, clientes, diaObjetivo);
        for (const { pedido, orden: n } of ordenados) {
          const cliente = (clientes || []).find(c => c.id === pedido.clienteId);
          const deudaPendiente = getDeudaPendienteParaPedido(deudas, pedido);
          files.push(await generarFacturaFile(pedido, cliente, { nombre: pedido.vendedorNombre }, deudaPendiente, n));
        }
      }

      if (files.length === 0) {
        alert('No hay pedidos para los dias elegidos.');
        return;
      }

      const nombreArchivo = fechasImprimir.length > 1
        ? `pedidos_${fechasImprimir[0]}_a_${fechasImprimir[fechasImprimir.length - 1]}.pdf`
        : `pedidos_${fechasImprimir[0]}.pdf`;
      const merged = await mergePdfFilesToSingleFile(files, nombreArchivo);

      if (canShareFiles()) {
        try {
          await shareFiles({ title: 'Pedidos para entregar', files: [merged] });
          return;
        } catch (e) {
          // cancelado o no soportado: cae al visor
        }
      }
      const w = window.open('', '_blank');
      const url = URL.createObjectURL(merged);
      if (w) w.location.href = url;
      else window.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      alert('No se pudo generar el PDF: ' + (e?.message || String(e)));
    } finally {
      setImprimiendo(false);
    }
  };

  return (
    <div className="page">
      <h1 className="page-title">Orden de entrega</h1>
      <p style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 16, marginTop: -10, lineHeight: 1.5 }}>
        Asignale a cada cliente su dia habitual de reparto y su puesto en la ruta de ese dia.
        Al imprimir, si algun cliente no tiene pedido ese dia, los que le siguen se renumeran
        para no dejar huecos (1, 2, 3...).
      </p>

      {/* Asignar / editar cliente */}
      <div className="card" style={{ position: 'relative' }}>
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
              <div key={c.id} className="suggestion-item" onClick={() => seleccionarCliente(c)}>
                <div>{c.nombre}</div>
                {c.diaEntrega && (
                  <span className="suggestion-sub">{DIA_LABEL[c.diaEntrega]} · {c.ordenEntrega}</span>
                )}
              </div>
            ))}
          </div>
        )}

        {clienteSel && (
          <>
            <label className="input-label">Día</label>
            <select className="input" value={dia} onChange={e => setDia(e.target.value)} style={{ marginBottom: 10 }}>
              <option value="">Elegir día...</option>
              {DIAS_SEMANA.map(d => (
                <option key={d} value={d}>{DIA_LABEL[d]}</option>
              ))}
            </select>

            <label className="input-label">Orden</label>
            <input
              className="input"
              type="number"
              inputMode="numeric"
              value={orden}
              onChange={e => setOrden(e.target.value)}
              placeholder="Ej: 5"
              style={{ marginBottom: 14 }}
            />

            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-ghost" onClick={() => { setClienteSel(null); setDia(''); setOrden(''); }} disabled={guardando}>
                Cancelar
              </button>
              <button
                className="btn btn-primary"
                style={{ flex: 1 }}
                onClick={guardarAsignacion}
                disabled={guardando || !dia || !orden || Number(orden) <= 0}
              >
                {guardando ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </>
        )}
      </div>

      {/* Imprimir */}
      <div className="card">
        <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 14 }}>Imprimir pedidos</div>

        <button className="btn btn-primary" style={{ marginBottom: 10 }} onClick={agregarHoy}>
          {'\u{1F5A8}️'} Agregar hoy
        </button>

        {fechasImprimir.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
            {fechasImprimir.map(f => (
              <span
                key={f}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  background: 'var(--bg4)', border: '1px solid var(--border)',
                  borderRadius: 8, padding: '4px 8px', fontSize: 13,
                }}
              >
                {f.split('-').reverse().join('/')}
                <button
                  className="btn-icon"
                  style={{ width: 18, height: 18, fontSize: 12, background: 'none', border: 'none' }}
                  onClick={() => quitarFecha(f)}
                >×</button>
              </span>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input
            type="date"
            className="input"
            value={nuevaFecha}
            onChange={e => setNuevaFecha(e.target.value)}
            style={{ flex: 1 }}
          />
          <button className="btn btn-ghost btn-sm" style={{ width: 'auto' }} onClick={agregarFecha}>
            + Agregar día
          </button>
        </div>

        <button
          className="btn btn-success"
          onClick={imprimirPedidos}
          disabled={fechasImprimir.length === 0 || imprimiendo}
        >
          {imprimiendo ? 'Generando...' : `\u{1F5A8}️ Imprimir pedidos para entregar (${fechasImprimir.length || 0} día${fechasImprimir.length === 1 ? '' : 's'})`}
        </button>
        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 6 }}>
          Por cada día elegido se imprimen los pedidos cargados el día anterior, ordenados por su puesto de ruta.
        </div>
      </div>

      {/* Entregas (REQ-COM, AC-COM-1) */}
      <EntregasDelDia pedidos={pedidos} permiso={Number(vendedorActual?.permiso || 2)} recargar={recargar} cierres={comisionesCierres || []} />

      {/* Lista de asignados */}
      {DIAS_SEMANA.filter(d => porDia[d]?.length).length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">{'\u{1F5D3}️'}</div>
          <div className="empty-text">Todavía no asignaste ningún cliente</div>
        </div>
      ) : (
        DIAS_SEMANA.filter(d => porDia[d]?.length).map(d => (
          <div key={d} style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 14, margin: '4px 2px 8px' }}>{DIA_LABEL[d]}</div>
            <div className="card" style={{ padding: '4px 14px' }}>
              {porDia[d].map((c, i) => (
                <div
                  key={c.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 0',
                    borderBottom: i === porDia[d].length - 1 ? 'none' : '1px solid var(--border)',
                  }}
                >
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    minWidth: 26, height: 22, padding: '0 5px',
                    background: 'var(--bg4)', borderRadius: 6, fontSize: 12, fontWeight: 700,
                    color: 'var(--text2)', flex: 'none',
                  }}>
                    {c.ordenEntrega}
                  </span>
                  <span style={{ flex: 1, fontSize: 14 }}>{c.nombre}</span>
                  <button className="btn-icon" style={{ width: 30, height: 30, fontSize: 13 }} onClick={() => editar(c)}>✏</button>
                  <button className="btn-icon" style={{ width: 30, height: 30, fontSize: 13, color: 'var(--danger)' }} onClick={() => quitarAsignacion(c)}>×</button>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
};

export default OrdenEntrega;
