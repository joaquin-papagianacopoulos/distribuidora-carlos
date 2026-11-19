// src/pages/OrdenEntrega.js
// Visible para cualquier usuario. REQ-RUT (Lote 2026-11-16): tablero interactivo de entrega.
// Ya NO se entrega "por dia" ni "por zona fija": el cliente elige, en el momento, QUE pedidos
// pendientes salen a reparto y en QUE orden. A la izquierda estan los pedidos pendientes de
// entrega (de cualquier fecha); al tocar uno pasa a "Mi ruta", donde el orden se cambia
// arrastrando, con las flechas o escribiendo el puesto. Los remitos y la hoja de ruta salen
// con exactamente esos pedidos y en ese orden. La ruta se guarda en el dispositivo.
import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../hooks/useAppContext';
import {
  pedidosPendientesEntrega, claveSeleccionPedido, estadoReparto, DIAS_REPARTO_POR_DEFECTO,
} from '../domain/reparto';
import {
  rutaVigente, pedidosDeRuta, agregarARuta, agregarVariosARuta, quitarDeRuta, moverEnRuta, moverAPuesto,
  subirEnRuta, bajarEnRuta, invertirRuta, ordenarRutaPorZona, grupoDeRuta, enlaceMapa,
  claveAlmacenRuta, leerRutaGuardada, serializarRuta,
} from '../domain/ruta';
import { notaDePedido } from '../domain/observaciones';
import { vendedorDelPedido } from '../domain/vendedorPedido';
import { totalACobrar } from '../domain/redondeo';
import { generarFacturaFile, generarHojaRutaFile } from '../utils/pdfGen';
import { filasHojaRuta } from '../domain/cobranza';
import { listarZonas, claveZona } from '../domain/zonas';
import { shareFiles, canShareFiles } from '../utils/share';
import { mergePdfFilesToSingleFile } from '../utils/pdfMerge';
import { normalize } from '../utils/fuzzy';
import { isPedidoVisible, normalizePedidoFecha } from '../utils/pedidos';
import { sumarDias } from '../utils/diasSemana';
import { marcarEntregadoOnlineFirst } from '../services/pedidoRepository';
import { puedeMarcarEntregado, puedeDesmarcarEntregado, pedidosEnCierresVigentes, pedidoIdComision } from '../domain/comisiones';
import './OrdenEntrega.css';

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

const pesos = (n) => `$${Number(n || 0).toLocaleString('es-AR')}`;
const fechaCorta = (f) => { const x = normalizePedidoFecha(f); return x ? x.split('-').reverse().join('/') : 'Sin fecha'; };

const OrdenEntrega = () => {
  const { clientes, deudas, recargar, traerPedidosSinEntregar, pedidos, vendedorActual, comisionesCierres } = useApp();
  const permiso = Number(vendedorActual?.permiso || 2);
  const claveAlmacen = claveAlmacenRuta(vendedorActual);

  // Mi ruta: claves de pedido en el orden de entrega. Se guarda en este dispositivo.
  const [ruta, setRuta] = useState(() => {
    try { return leerRutaGuardada(window.localStorage.getItem(claveAlmacen)); } catch (e) { return []; }
  });
  const [vista, setVista] = useState('pendientes'); // celular: que panel se ve
  const [desde, setDesde] = useState(() => sumarDias(null, -DIAS_REPARTO_POR_DEFECTO));
  const [buscar, setBuscar] = useState('');
  const [zonaFiltro, setZonaFiltro] = useState('__todas__');
  const [imprimiendo, setImprimiendo] = useState(false);
  const [marcandoId, setMarcandoId] = useState(null);
  const [arrastrando, setArrastrando] = useState(null);
  const [sobre, setSobre] = useState(null);
  const [puestoEdit, setPuestoEdit] = useState({});
  const [aviso, setAviso] = useState('');

  useEffect(() => {
    try { window.localStorage.setItem(claveAlmacen, serializarRuta(ruta)); } catch (e) { /* sin almacenamiento: la ruta vive solo en pantalla */ }
  }, [ruta, claveAlmacen]);

  useEffect(() => {
    if (!aviso) return undefined;
    const t = setTimeout(() => setAviso(''), 2600);
    return () => clearTimeout(t);
  }, [aviso]);

  // Baja del servidor los pedidos sin entregar de cualquier fecha (>= desde).
  useEffect(() => {
    if (typeof traerPedidosSinEntregar === 'function') traerPedidosSinEntregar(desde || null);
  }, [desde, traerPedidosSinEntregar]);

  const clientePorId = useMemo(() => new Map((clientes || []).map(c => [String(c.id), c])), [clientes]);
  const zonas = useMemo(() => listarZonas(clientes || []), [clientes]);
  const direccionDe = (p) => String(clientePorId.get(String(p.clienteId))?.direccion || p.direccion || p.clienteDireccion || '').trim();
  const localidadDe = (p) => String(clientePorId.get(String(p.clienteId))?.localidad || clientePorId.get(String(p.clienteId))?.ciudad || '').trim();
  const zonaDe = (p) => claveZona(clientePorId.get(String(p.clienteId))?.zona);

  // Todos los pendientes (sin filtros) y la ruta vigente: un pedido entregado o borrado sale solo de la ruta.
  const todos = useMemo(() => pedidosPendientesEntrega(pedidos || []), [pedidos]);
  const porClave = useMemo(() => new Map(todos.map(p => [claveSeleccionPedido(p), p])), [todos]);
  const rutaClaves = useMemo(() => rutaVigente(ruta, porClave), [ruta, porClave]);
  const enRuta = useMemo(() => new Set(rutaClaves), [rutaClaves]);
  const pedidosRuta = useMemo(() => pedidosDeRuta(rutaClaves, porClave), [rutaClaves, porClave]);
  const totalRuta = useMemo(() => pedidosRuta.reduce((s, p) => s + totalACobrar(p), 0), [pedidosRuta]);

  // Lista de la izquierda: pendientes que todavia no estan en la ruta, con filtros.
  const disponibles = useMemo(() => {
    const q = normalize(buscar.trim());
    return pedidosPendientesEntrega(pedidos || [], { desde: desde || null }).filter(p => {
      if (enRuta.has(claveSeleccionPedido(p))) return false;
      if (zonaFiltro !== '__todas__' && zonaDe(p) !== zonaFiltro) return false;
      if (!q) return true;
      return normalize(`${p.clienteNombre || ''} ${direccionDe(p)}`).includes(q);
    });
  }, [pedidos, desde, enRuta, zonaFiltro, buscar, clientePorId]);

  // Todo cambio de la ruta parte de la ruta vigente (asi se limpian sola los entregados).
  const cambiar = (fn) => setRuta(prev => fn(rutaVigente(prev, porClave)));

  const agregar = (p) => {
    const k = claveSeleccionPedido(p);
    cambiar(r => agregarARuta(r, k));
    setAviso(`${p.clienteNombre} agregado a la ruta (puesto ${rutaClaves.length + 1})`);
  };
  const agregarTodos = () => {
    cambiar(r => agregarVariosARuta(r, disponibles.map(claveSeleccionPedido)));
    setAviso(`${disponibles.length} pedido${disponibles.length === 1 ? '' : 's'} agregado${disponibles.length === 1 ? '' : 's'} a la ruta`);
  };
  const quitar = (p) => cambiar(r => quitarDeRuta(r, claveSeleccionPedido(p)));
  const subir = (p) => cambiar(r => subirEnRuta(r, claveSeleccionPedido(p)));
  const bajar = (p) => cambiar(r => bajarEnRuta(r, claveSeleccionPedido(p)));
  const ponerPuesto = (p, valor) => {
    const n = Number(valor);
    setPuestoEdit({});
    if (!Number.isFinite(n) || n <= 0) return;
    cambiar(r => moverAPuesto(r, claveSeleccionPedido(p), n));
  };
  const vaciar = () => {
    if (rutaClaves.length === 0) return;
    if (!window.confirm(`¿Sacar los ${rutaClaves.length} pedidos de la ruta? Los pedidos no se borran: vuelven a la lista de pendientes.`)) return;
    setRuta([]);
  };
  const porZona = () => {
    cambiar(r => ordenarRutaPorZona(r, porClave, clientes || []));
    setAviso('Ruta ordenada por zona. Podés retocarla a mano.');
  };

  // Arrastrar y soltar (compu). En el celular se usan las flechas o el puesto.
  const alArrastrar = (e, k) => {
    setArrastrando(k);
    try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', k); } catch (err) { /* sin dataTransfer */ }
  };
  const alPasarPor = (e, k) => {
    if (!arrastrando) return;
    e.preventDefault();
    if (sobre !== k) setSobre(k);
  };
  const alSoltar = (e, k) => {
    e.preventDefault();
    const origen = arrastrando;
    setArrastrando(null);
    setSobre(null);
    if (!origen || origen === k) return;
    cambiar(r => moverEnRuta(r, r.indexOf(origen), r.indexOf(k)));
  };

  // Los remitos y la hoja de ruta salen con la ruta, en su orden (1, 2, 3...).
  const armarReparto = () => {
    const grupos = grupoDeRuta(pedidosRuta);
    // REQ-RTO/HRU: el saldo anterior de cada cliente se cuenta una sola vez y sin las deudas de los pedidos impresos.
    const hoja = filasHojaRuta(grupos, { deudas, direccionDe });
    return { grupos, hoja };
  };

  const entregarArchivo = async (file, title) => {
    if (canShareFiles()) {
      try {
        await shareFiles({ title, files: [file] });
        return;
      } catch (e) {
        // cancelado o no soportado: cae al visor
      }
    }
    const w = window.open('', '_blank');
    const url = URL.createObjectURL(file);
    if (w) w.location.href = url;
    else window.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const hoy = sumarDias(null, 0);

  const imprimirRemitos = async () => {
    if (pedidosRuta.length === 0) return;
    setImprimiendo(true);
    try {
      const { grupos, hoja } = armarReparto();
      const files = [];
      let i = 0;
      for (const { pedido, orden } of grupos[0].pedidos) {
        const cliente = clientePorId.get(String(pedido.clienteId));
        const saldoAnterior = hoja.filas[i]?.saldoAnterior ?? 0;
        i += 1;
        files.push(await generarFacturaFile(pedido, cliente, { nombre: pedido.vendedorNombre }, saldoAnterior, orden));
      }
      const merged = await mergePdfFilesToSingleFile(files, `reparto_${hoy}.pdf`);
      await entregarArchivo(merged, 'Pedidos para entregar');
    } catch (e) {
      alert('No se pudo generar el PDF: ' + (e?.message || String(e)));
    } finally {
      setImprimiendo(false);
    }
  };

  const imprimirHojaRuta = async () => {
    if (pedidosRuta.length === 0) return;
    setImprimiendo(true);
    try {
      const { hoja } = armarReparto();
      const file = await generarHojaRutaFile(hoja, { fechas: [hoy], zonas: [], ruta: true });
      await entregarArchivo(file, 'Hoja de ruta');
    } catch (e) {
      alert('No se pudo generar la hoja de ruta: ' + (e?.message || String(e)));
    } finally {
      setImprimiendo(false);
    }
  };

  const marcarEntregadoRuta = async (p) => {
    const chk = puedeMarcarEntregado(p, permiso);
    if (!chk.ok) { alert(chk.motivo); return; }
    setMarcandoId(p.id);
    try {
      await marcarEntregadoOnlineFirst(p, true, { cerradoEn: null });
      await recargar();
      setAviso(`${p.clienteNombre}: entregado`);
    } catch (e) {
      alert('No se pudo guardar la entrega: ' + (e?.message || String(e)));
    } finally {
      setMarcandoId(null);
    }
  };

  const datosCliente = (p) => {
    const dir = direccionDe(p);
    const mapa = enlaceMapa(dir, localidadDe(p));
    return { dir, mapa };
  };

  return (
    <div className="page oe" data-testid="tablero-entrega">
      <h1 className="page-title">Orden de entrega</h1>

      <div className="oe-pasos" aria-label="Cómo se usa">
        <span className="oe-paso"><i>1</i> Elegí los pedidos que salen</span>
        <span className="oe-paso"><i>2</i> Ordenalos como quieras</span>
        <span className="oe-paso"><i>3</i> Imprimí remitos y hoja de ruta</span>
      </div>

      <div className="oe-resumen">
        <div className="oe-stat" data-testid="oe-stat-pendientes"><b>{todos.length}</b><span>Pendientes de entrega</span></div>
        <div className="oe-stat oe-stat-ruta" data-testid="oe-stat-ruta"><b>{pedidosRuta.length}</b><span>En mi ruta</span></div>
        <div className="oe-stat" data-testid="oe-stat-total"><b>{pesos(totalRuta)}</b><span>Total de la ruta</span></div>
      </div>

      {/* Celular: un panel a la vez. Compu: los dos lado a lado. */}
      <div className="oe-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={vista === 'pendientes'} className={`oe-tab ${vista === 'pendientes' ? 'activa' : ''}`} onClick={() => setVista('pendientes')}>
          Pendientes ({disponibles.length})
        </button>
        <button type="button" role="tab" aria-selected={vista === 'ruta'} className={`oe-tab ${vista === 'ruta' ? 'activa' : ''}`} onClick={() => setVista('ruta')}>
          Mi ruta ({pedidosRuta.length})
        </button>
      </div>

      <div className="oe-tablero">
        {/* ---------- Pendientes ---------- */}
        <section className={`oe-panel ${vista !== 'pendientes' ? 'oe-oculto-movil' : ''}`} data-testid="oe-pendientes" aria-label="Pedidos pendientes de entrega">
          <div className="oe-panel-cab">
            <div className="oe-titulo">Pendientes de entrega</div>
            <div className="oe-filtros">
              <input className="input" aria-label="Buscar cliente o dirección" value={buscar} onChange={e => setBuscar(e.target.value)} placeholder="Buscar cliente o dirección..." autoComplete="off" />
              <select className="input" aria-label="Filtrar por zona" value={zonaFiltro} onChange={e => setZonaFiltro(e.target.value)}>
                <option value="__todas__">Todas las zonas</option>
                {zonas.map(z => <option key={z.clave || '__sin_zona__'} value={z.clave}>{z.etiqueta}</option>)}
              </select>
              <label className="oe-desde">Pedidos desde
                <input type="date" className="input" aria-label="Pedidos desde" value={desde} onChange={e => setDesde(e.target.value)} />
              </label>
            </div>
            <button type="button" className="btn btn-ghost btn-sm oe-agregar-todos" onClick={agregarTodos} disabled={disponibles.length === 0}>
              + Agregar todos los que se ven ({disponibles.length})
            </button>
          </div>

          <div className="oe-lista" data-testid="oe-lista-pendientes">
            {disponibles.length === 0 ? (
              <div className="oe-vacio">
                {todos.length === 0 ? 'No hay pedidos pendientes de entrega.' : 'No hay más pedidos para mostrar con estos filtros (o ya están todos en tu ruta).'}
              </div>
            ) : disponibles.map(p => {
              const { dir } = datosCliente(p);
              const nota = notaDePedido(p);
              return (
                <div key={claveSeleccionPedido(p)} className="oe-card oe-pend" data-testid={`oe-pend-${p.id}`}>
                  <div className="oe-cuerpo" role="button" tabIndex={0} onClick={() => agregar(p)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); agregar(p); } }}>
                    <div className="oe-nombre">{p.clienteNombre}</div>
                    <div className="oe-dir">{'\u{1F4CD}'} {dir || 'Sin dirección cargada'}</div>
                    <div className="oe-vendedor" data-testid={`oe-vendedor-${p.id}`}>Vendedor: <b>{vendedorDelPedido(p) || 'Sin vendedor'}</b></div>
                    <div className="oe-meta">{fechaCorta(p.fecha)} {'·'} {estadoReparto(p)}</div>
                    {nota && <div className="oe-nota">{'\u{1F4DD}'} {nota}</div>}
                  </div>
                  <div className="oe-lado">
                    <div className="oe-monto">{pesos(totalACobrar(p))}</div>
                    <button type="button" className="btn btn-primary btn-sm oe-btn-agregar" aria-label={`Agregar a la ruta el pedido de ${p.clienteNombre}`} onClick={() => agregar(p)}>+ Ruta</button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ---------- Mi ruta ---------- */}
        <section className={`oe-panel oe-panel-ruta ${vista !== 'ruta' ? 'oe-oculto-movil' : ''}`} data-testid="oe-ruta" aria-label="Mi ruta de entrega">
          <div className="oe-panel-cab">
            <div className="oe-titulo">Mi ruta de hoy</div>
            <div className="oe-ayuda">El número es el orden de entrega. Arrastrá, usá ▲ ▼ o escribí el puesto para cambiarlo.</div>
          </div>

          <div className="oe-lista" data-testid="oe-lista-ruta">
            {pedidosRuta.length === 0 ? (
              <div className="oe-vacio" data-testid="oe-ruta-vacia">
                <div className="oe-vacio-icono">{'\u{1F69A}'}</div>
                Tu ruta está vacía.<br />
                Tocá un pedido de <b>Pendientes</b> para agregarlo: el orden en que los vas agregando es el orden de entrega.
              </div>
            ) : pedidosRuta.map((p, i) => {
              const k = claveSeleccionPedido(p);
              const { dir, mapa } = datosCliente(p);
              const nota = notaDePedido(p);
              return (
                <div
                  key={k}
                  className={`oe-card oe-parada ${arrastrando === k ? 'oe-arrastrando' : ''} ${sobre === k && arrastrando !== k ? 'oe-sobre' : ''}`}
                  data-testid={`oe-parada-${p.id}`}
                  draggable
                  onDragStart={e => alArrastrar(e, k)}
                  onDragOver={e => alPasarPor(e, k)}
                  onDrop={e => alSoltar(e, k)}
                  onDragEnd={() => { setArrastrando(null); setSobre(null); }}
                >
                  <div className="oe-parada-fila">
                    <div className="oe-num" aria-label={`Puesto ${i + 1}`}>{i + 1}</div>
                    <div className="oe-cuerpo oe-cuerpo-ruta">
                      <div className="oe-nombre">{p.clienteNombre}</div>
                      <div className="oe-dir">{'\u{1F4CD}'} {dir || 'Sin dirección cargada'}</div>
                      <div className="oe-vendedor" data-testid={`oe-vendedor-${p.id}`}>Vendedor: <b>{vendedorDelPedido(p) || 'Sin vendedor'}</b></div>
                    <div className="oe-meta">{fechaCorta(p.fecha)} {'·'} {estadoReparto(p)}</div>
                      {nota && <div className="oe-nota">{'\u{1F4DD}'} {nota}</div>}
                    </div>
                    <div className="oe-monto">{pesos(totalACobrar(p))}</div>
                  </div>
                  <div className="oe-controles">
                    <span className="oe-asa" aria-hidden="true" title="Arrastrá para mover">{'⠇⠇'}</span>
                    <button type="button" className="oe-flecha" aria-label={`Subir a ${p.clienteNombre}`} disabled={i === 0} onClick={() => subir(p)}>{'▲'}</button>
                    <button type="button" className="oe-flecha" aria-label={`Bajar a ${p.clienteNombre}`} disabled={i === pedidosRuta.length - 1} onClick={() => bajar(p)}>{'▼'}</button>
                    <input
                      className="input oe-puesto"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={pedidosRuta.length}
                      aria-label={`Puesto de ${p.clienteNombre}`}
                      value={puestoEdit[k] ?? String(i + 1)}
                      onChange={e => setPuestoEdit(prev => ({ ...prev, [k]: e.target.value }))}
                      onBlur={() => { if (puestoEdit[k] !== undefined) ponerPuesto(p, puestoEdit[k]); }}
                      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                    />
                    {mapa && <a className="oe-link" href={mapa} target="_blank" rel="noopener noreferrer">Mapa</a>}
                    {puedeMarcarEntregado(p, permiso).ok && (
                      <button type="button" className="btn btn-ghost btn-sm oe-entregado" disabled={marcandoId === p.id} onClick={() => marcarEntregadoRuta(p)}>
                        {marcandoId === p.id ? '...' : 'Entregado'}
                      </button>
                    )}
                    <button type="button" className="oe-quitar" aria-label={`Sacar de la ruta a ${p.clienteNombre}`} onClick={() => quitar(p)}>{'✕'}</button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="oe-acciones">
            <button type="button" className="btn btn-success" onClick={imprimirRemitos} disabled={pedidosRuta.length === 0 || imprimiendo}>
              {imprimiendo ? 'Generando...' : `\u{1F5A8}️ Imprimir remitos (${pedidosRuta.length})`}
            </button>
            <button type="button" className="btn btn-ghost" onClick={imprimirHojaRuta} disabled={pedidosRuta.length === 0 || imprimiendo}>
              Hoja de ruta (cobranza)
            </button>
            <div className="oe-acciones-sec">
              <button type="button" className="btn btn-ghost btn-sm" onClick={porZona} disabled={pedidosRuta.length < 2}>Ordenar por zona</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => cambiar(r => invertirRuta(r))} disabled={pedidosRuta.length < 2}>Invertir orden</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={vaciar} disabled={pedidosRuta.length === 0}>Vaciar ruta</button>
            </div>
          </div>
        </section>
      </div>

      {aviso && <div className="oe-aviso" role="status">{aviso}</div>}

      {/* Entregas (REQ-COM, AC-COM-1) */}
      <EntregasDelDia pedidos={pedidos} permiso={permiso} recargar={recargar} cierres={comisionesCierres || []} />
    </div>
  );
};

export default OrdenEntrega;
