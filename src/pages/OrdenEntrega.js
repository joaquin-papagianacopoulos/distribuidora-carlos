// src/pages/OrdenEntrega.js
// Visible para cualquier usuario. REQ-ZON: la logistica se organiza por ZONA (la de la
// ficha del cliente). Cada cliente tiene un puesto (ordenZona) dentro de su zona. Al
// imprimir los pedidos de una o varias fechas y zonas, se numeran sin huecos segun quien
// realmente tiene pedido: si el puesto 2 no pidio, el que sigue pasa a ser el 2, no el 3.
// Ese numero calculado es el que aparece en la boleta — no se guarda en el pedido.
// diaEntrega / ordenEntrega (modelo viejo por dia) se conservan en los datos, pero ya no se
// muestran ni se usan.
import React, { useMemo, useState } from 'react';
import { useApp } from '../hooks/useAppContext';
import { updateCliente, getPedidos } from '../db';
import { syncClientes } from '../sync/syncService';
import { generarFacturaFile } from '../utils/pdfGen';
import { listarZonas, clientesDeZona, moverEnZona, calcularOrdenPorZona } from '../domain/zonas';
import { shareFiles, canShareFiles } from '../utils/share';
import { mergePdfFilesToSingleFile } from '../utils/pdfMerge';
import { isPedidoVisible, normalizePedidoFecha, getDeudaPendienteParaPedido } from '../utils/pedidos';
import { sumarDias } from '../utils/diasSemana';
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

  // Sube los clientes recien guardados ya mismo y avisa si no llegaron a Supabase
  // (syncClientes puede saltear en silencio un error de permisos de escritura).
  const subirClientes = async () => {
    if (!navigator.onLine) return;
    try {
      const r = await syncClientes();
      if (r?.skipped) {
        alert(
          'Se guardó en este dispositivo, pero Supabase rechazó la subida por permisos (RLS) ' +
          'en la tabla "clientes". El orden de la zona no va a verse en otros dispositivos ' +
          'hasta que se habilite la escritura ahí.'
        );
      }
    } catch (e) {
      alert('Se guardó en este dispositivo, pero no se subió a Supabase: ' + (e?.message || String(e)));
    }
  };

  // REQ-ZON (AC-ZON-1): la zona sale de la ficha del cliente. '' = "Sin zona".
  const zonasLista = useMemo(() => listarZonas(clientes || []), [clientes]);
  const [zonaSel, setZonaSel] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [puestoEdit, setPuestoEdit] = useState({});

  const clientesZona = useMemo(
    () => (zonaSel === null ? [] : clientesDeZona(clientes || [], zonaSel)),
    [clientes, zonaSel],
  );

  // Mueve al cliente al puesto indicado y corre a los demas. Solo se guardan los que cambian
  // (con spread: diaEntrega / ordenEntrega se conservan tal cual).
  const moverCliente = async (clienteId, nuevoPuesto) => {
    const cambios = moverEnZona(clientes || [], zonaSel, clienteId, nuevoPuesto);
    if (cambios.length === 0) return;
    setGuardando(true);
    try {
      const porId = new Map((clientes || []).map(c => [String(c.id), c]));
      for (const cambio of cambios) {
        const c = porId.get(String(cambio.id));
        if (c) await updateCliente({ ...c, ordenZona: cambio.ordenZona });
      }
      await recargar();
      await subirClientes();
    } catch (e) {
      alert('No se pudo guardar: ' + (e?.message || String(e)));
    } finally {
      setGuardando(false);
      setPuestoEdit({});
    }
  };

  // ---- Imprimir (AC-ZON-2): fechas de PEDIDO + zonas elegidas ----
  const [fechasImprimir, setFechasImprimir] = useState([]);
  const [nuevaFecha, setNuevaFecha] = useState('');
  const [zonasImprimir, setZonasImprimir] = useState([]);
  const [imprimiendo, setImprimiendo] = useState(false);

  // Atajo: el reparto de hoy lleva los pedidos que se cargaron AYER.
  const agregarRepartoHoy = () => {
    const ayer = sumarDias(null, -1);
    setFechasImprimir(prev => prev.includes(ayer) ? prev : [...prev, ayer].sort());
  };

  const agregarFecha = () => {
    if (!nuevaFecha) return;
    setFechasImprimir(prev => prev.includes(nuevaFecha) ? prev : [...prev, nuevaFecha].sort());
    setNuevaFecha('');
  };

  const quitarFecha = (f) => setFechasImprimir(prev => prev.filter(x => x !== f));

  const toggleZonaImprimir = (clave) =>
    setZonasImprimir(prev => (prev.includes(clave) ? prev.filter(x => x !== clave) : [...prev, clave]));

  const imprimirPedidos = async () => {
    if (fechasImprimir.length === 0) return;
    setImprimiendo(true);
    try {
      const files = [];
      for (const fechaPedido of fechasImprimir) {
        await syncPedidosFecha(fechaPedido);
        const todos = await getPedidos();
        const pedidosDelDia = todos.filter(p =>
          isPedidoVisible(p) && normalizePedidoFecha(p.fecha) === fechaPedido
        );

        // Numeracion sin huecos dentro de cada zona, segun quien tiene pedido ese dia.
        const porZona = calcularOrdenPorZona(pedidosDelDia, clientes || [], { zonas: zonasImprimir });
        for (const grupo of porZona) {
          for (const { pedido, orden: n } of grupo.pedidos) {
            const cliente = (clientes || []).find(c => c.id === pedido.clienteId);
            const deudaPendiente = getDeudaPendienteParaPedido(deudas, pedido);
            files.push(await generarFacturaFile(pedido, cliente, { nombre: pedido.vendedorNombre }, deudaPendiente, n));
          }
        }
      }

      if (files.length === 0) {
        alert('No hay pedidos para las fechas y zonas elegidas.');
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
        Elegí una zona (la que tiene cada cliente en su ficha) y ordená a sus clientes: cada uno tiene un puesto en la ruta de esa zona.
        Al imprimir, si algun cliente no tiene pedido, los que le siguen se renumeran
        para no dejar huecos (1, 2, 3...).
      </p>

      {/* Zona y orden de sus clientes (AC-ZON-1) */}
      <div className="card" data-testid="zona-orden">
        <label className="input-label" htmlFor="zona-sel">Zona</label>
        <select
          id="zona-sel"
          className="input"
          value={zonaSel === null ? '__ninguna__' : zonaSel}
          onChange={e => { setZonaSel(e.target.value === '__ninguna__' ? null : e.target.value); setPuestoEdit({}); }}
          style={{ marginBottom: 10 }}
        >
          <option value="__ninguna__">Elegir zona...</option>
          {zonasLista.map(z => (
            <option key={z.clave || '__sin_zona__'} value={z.clave}>{z.etiqueta} ({z.cantidad})</option>
          ))}
        </select>

        {zonaSel !== null && clientesZona.length === 0 && (
          <div style={{ fontSize: 13, color: 'var(--text3)' }}>No hay clientes en esta zona.</div>
        )}

        {clientesZona.map((c, i) => (
          <div
            key={c.id}
            data-testid={`zona-cliente-${c.id}`}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderTop: i === 0 ? 'none' : '1px solid var(--border)' }}
          >
            <input
              className="input"
              type="number"
              inputMode="numeric"
              min={1}
              aria-label={`Puesto de ${c.nombre}`}
              value={puestoEdit[c.id] ?? String(i + 1)}
              disabled={guardando}
              onChange={e => setPuestoEdit(prev => ({ ...prev, [c.id]: e.target.value }))}
              onBlur={() => {
                if (puestoEdit[c.id] === undefined) return;
                const n = Number(puestoEdit[c.id]);
                if (!Number.isFinite(n) || n <= 0) { setPuestoEdit({}); return; }
                moverCliente(c.id, n);
              }}
              onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
              style={{ width: 64, textAlign: 'center', flex: 'none' }}
            />
            <span style={{ flex: 1, fontSize: 14 }}>{c.nombre}</span>
            <button
              className="btn-icon"
              aria-label={`Subir a ${c.nombre}`}
              style={{ width: 30, height: 30, fontSize: 13 }}
              disabled={guardando || i === 0}
              onClick={() => moverCliente(c.id, i)}
            >▲</button>
            <button
              className="btn-icon"
              aria-label={`Bajar a ${c.nombre}`}
              style={{ width: 30, height: 30, fontSize: 13 }}
              disabled={guardando || i === clientesZona.length - 1}
              onClick={() => moverCliente(c.id, i + 2)}
            >▼</button>
          </div>
        ))}
      </div>

      {/* Imprimir */}
      <div className="card">
        <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 14 }}>Imprimir pedidos</div>

        <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6 }}>Fecha(s) en que se cargaron los pedidos</div>
        <button className="btn btn-primary" style={{ marginBottom: 10 }} onClick={agregarRepartoHoy}>
          {'\u{1F5A8}️'} Reparto de hoy (pedidos de ayer)
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
            aria-label="Fecha del pedido"
            value={nuevaFecha}
            onChange={e => setNuevaFecha(e.target.value)}
            style={{ flex: 1 }}
          />
          <button className="btn btn-ghost btn-sm" style={{ width: 'auto' }} onClick={agregarFecha}>
            + Agregar día
          </button>
        </div>

        <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6 }}>Zonas (si no marcás ninguna, salen todas)</div>
        <div data-testid="zonas-imprimir" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
          {zonasLista.map(z => (
            <label key={z.clave || '__sin_zona__'} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={zonasImprimir.includes(z.clave)}
                onChange={() => toggleZonaImprimir(z.clave)}
              />
              {z.etiqueta}
            </label>
          ))}
        </div>

        <button
          className="btn btn-success"
          onClick={imprimirPedidos}
          disabled={fechasImprimir.length === 0 || imprimiendo}
        >
          {imprimiendo ? 'Generando...' : `\u{1F5A8}️ Imprimir pedidos para entregar (${fechasImprimir.length || 0} día${fechasImprimir.length === 1 ? '' : 's'})`}
        </button>
        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 6 }}>
          Los pedidos salen agrupados por zona y numerados según el puesto de cada cliente en su zona.
        </div>
      </div>

      {/* Entregas (REQ-COM, AC-COM-1) */}
      <EntregasDelDia pedidos={pedidos} permiso={Number(vendedorActual?.permiso || 2)} recargar={recargar} cierres={comisionesCierres || []} />
    </div>
  );
};

export default OrdenEntrega;
