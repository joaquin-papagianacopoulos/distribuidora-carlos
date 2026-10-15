// src/pages/Facturacion.js
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useApp } from '../hooks/useAppContext';
import { getTodayStr, formatFecha, fuzzySearch, searchProductos } from '../utils/fuzzy';
import { registrarFaltantes } from '../db';
import { generarFacturaFile } from '../utils/pdfGen';
import { shareFiles } from '../utils/share';
import { mergePdfFilesToSingleFile } from '../utils/pdfMerge';
import { borrarPedidoOnlineFirst, guardarPedidoOnlineFirst, marcarEntregadoOnlineFirst } from '../services/pedidoRepository';
import { getOrdenEntrega, withOrdenEntrega } from '../utils/ordenEntrega';
import { registrarDeudaFacturado, quitarDeudaDePedido, actualizarMontoDeudaDePedido } from '../services/deudaRepository';
import { borrarFaltantesDeProducto } from '../services/faltanteRepository';
import { previsualizarStockPedido } from '../services/stockService';
import { isPedidoVisible, normalizePedidoFecha, getArmadoLog, getDeudaPendienteParaPedido } from '../utils/pedidos';
import { sumarBultoRenglon, restarBulto, puedeUsarBulto, CANTIDAD_MINIMA_RENGLON, MARCA_CANTIDAD_POR_DEFECTO, renglonNuevo, quitarMarcasRenglon, quitarMarcasRenglones, cantidadTipeada, validarCantidadesItems, mensajeCantidadesInvalidas, productoParaBulto } from '../domain/bultos';
import { acotarCambiosArmado } from '../domain/armado';
import BultoControl from '../components/BultoControl';
import { pasoCantidad, avisoMultiplo, validarMultiplosItems, congelarBultosItems, congelarBultosRenglon, textoRenglonBultos, precioBulto, ventaPorEfectivo, normalizarBultoNombre } from '../domain/unidadVenta';
import { avisoSinStock, stockParaAviso, resumenSinStock } from '../domain/stock';
import { precioAplicadoRenglon, esPrecioManual, precioBaseRenglon } from '../domain/precios';
import { validarMinimosItems, mensajeMinimo } from '../domain/minimos';
import { pedidosEnCierresVigentes, pedidoIdComision, puedeMarcarEntregado, puedeDesmarcarEntregado } from '../domain/comisiones';
import TipoFacturaSelector from '../components/TipoFacturaSelector';
import AgruparRenglones from '../components/AgruparRenglones';
import { normalizarGrupos } from '../domain/gruposFactura';
import { filasTiposFacturaRpc, ETIQUETA_TIPO_FACTURA } from '../domain/facturacionAB';
import { guardarTiposFacturaLocal, subirTiposFactura } from '../services/facturacionService';
import { credencialesAdminProductos } from '../services/productosAdminService';
import { cargarRendicionesLocales } from '../services/rendicionService';
import { pedidoTieneRendicionVigente, MSG_PEDIDO_CON_RENDICION, saldoAFavorCliente, cuentaParaBoleta } from '../domain/rendicion';

// REQ-COM (AC-COM-13): texto extra para confirmar cambios sobre un pedido que
// ya esta en un cierre de comisiones vigente.
const AVISO_CERRADO = '\n\nOjo: este pedido ya está en un cierre de comisiones. El cambio va a quedar como AJUSTE PENDIENTE para el próximo cierre.';

const alpha = (a, b) =>
  String(a || '').localeCompare(String(b || ''), 'es', { sensitivity: 'base' });

// Resumen de lo que hizo el armador: que confirmo (tick verde) y que saco/redujo
// (tachito). Sirve para que quien factura sepa de un vistazo que revisar antes
// de cerrar la boleta, sin tener que ir a mirar Faltantes.
const ArmadoResumen = ({ pedido, compact = false, ocultarRemovidos = false }) => {
  const log = getArmadoLog(pedido);
  if (!log) return null;
  const confirmadosIds = new Set(log.confirmados || []);
  const confirmadosNombres = (pedido.items || [])
    .filter(i => confirmadosIds.has(i.productoId))
    .map(i => i.nombre);
  const removidos = ocultarRemovidos ? [] : (log.removidos || []);
  // AC-BUL-7: cambios de cantidad del armador (clave opcional; tolera ausencia o dato corrupto).
  // S-BUL-05: lectura acotada (máx. entradas y largo de nombre) por si viene inflado de la nube.
  const cambios = acotarCambiosArmado(log.cambios);
  if (confirmadosNombres.length === 0 && removidos.length === 0 && cambios.length === 0) return null;

  return (
    <div style={{
      marginTop: 8, marginBottom: 8,
      background: 'var(--bg3)', borderRadius: 8,
      padding: compact ? '8px 10px' : '10px 12px',
      fontSize: compact ? 12 : 13,
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{ fontSize: 11, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 700 }}>
        {'\u{1F4E6}'} Armado {log.por ? `por ${log.por}` : ''}
      </div>
      {confirmadosNombres.length > 0 && (
        <div style={{ color: 'var(--success)' }}>
          {'✓'} Confirmados: {confirmadosNombres.join(', ')}
        </div>
      )}
      {removidos.length > 0 && (
        <div style={{ color: 'var(--danger)' }}>
          {'\u{1F5D1}'} Sacados/reducidos: {removidos.map(r => `${r.nombre} ×${r.cantidad}`).join(', ')}
        </div>
      )}
      {cambios.length > 0 && (
        <div data-testid="armado-cambios" style={{ color: 'var(--warning)' }}>
          {'\u270E'} Cantidades cambiadas: {cambios.map(c => `${String(c.nombre || '')} ${Number(c.antes)}\u2192${Number(c.despues)}`).join(', ')}
        </div>
      )}
    </div>
  );
};

const sortItems = (items) =>
  [...(items || [])].sort((a, b) => alpha(a?.nombre, b?.nombre));

// AC-PBU-3: re-precia un renglón con su cantidad actual (precio por bulto), salvo precio manual.
const reprecio = (it) => precioAplicadoRenglon(it, it?.cantidad);

// Item row con inputs locales — no borra el item al vaciar el campo
const FacturacionItemRow = ({
  item,
  cantidadText,
  precioText,
  onCambiarCantidad,
  onDraftCantidad,
  onDraftPrecio,
  onEliminar,
  onAplicarDescuentoPct,
  precioListaActual,
  puedeAplicarPrecioLista,
  onAplicarPrecioLista,
  producto,
  puedeBulto = false,
  onBulto,
  avisoStock = null,
  errorMinimo = null,
}) => {
  // Backward-compat: durante la transicion a drafts, mantener handlers locales
  // para que el JSX no dependa de eventos blur "perdidos" en mobile.
  // Estas funciones escriben SIEMPRE al padre (itemsEdit) via onDraft*.
  const setCantidadText = (val) => onDraftCantidad(item.productoId, val);
  const setPrecioText = (val) => onDraftPrecio(item.productoId, val);

  const handleCantidadChange = (e) => setCantidadText(e.target.value);
  const handleCantidadBlur = (e) => {
    const valor = String(e.currentTarget.value ?? '').trim();
    // C3 / S-BUL-06: entero en [1, MAX_CANTIDAD]; un texto no vacío inválido
    // (p. ej. mayor al tope) vuelve a la última cantidad válida del renglón.
    const n = cantidadTipeada(valor);
    if (n !== null) setCantidadText(String(n));
    else if (parseInt(valor, 10) > 0) setCantidadText(String(item.cantidad));
    else setCantidadText('1');
  };

  const handlePrecioChange = (e) => setPrecioText(e.target.value);
  const handlePrecioBlur = (e) => {
    const n = parseFloat(String(e.currentTarget.value ?? '').trim().replace(',', '.'));
    if (isNaN(n) || n < 0) setPrecioText(String(item.precio ?? 0));
    else setPrecioText(String(n));
  };

  const aplicarDescuentoPct = () => onAplicarDescuentoPct(item);

  // REQ-VTA (AC-VTA-2/3): paso por bulto, aviso de no múltiplo (sobre lo tipeado) y "3 Display (48 u.)".
  const paso = pasoCantidad(producto);
  const cantidadMostrada = cantidadTipeada(String(cantidadText ?? '')) ?? item.cantidad;
  const avisoVenta = avisoMultiplo(cantidadMostrada, producto);
  const textoBultos = textoRenglonBultos(congelarBultosRenglon({ ...item, cantidad: cantidadMostrada }, producto));
  const precioDelBulto = ventaPorEfectivo(producto) !== 'unidad' ? precioBulto(item.precio, producto?.bultoX) : null;

  // AC-PBU-3: el precio por bulto no cuenta como "precio modificado".
  const precioModificado =
    item.precioOriginal !== undefined &&
    item.precioOriginal !== null &&
    esPrecioManual(item);

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 14px', marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 15, fontWeight: 700, flex: 1 }}>
          {item.nombre}
          {avisoStock && (
            <div data-testid="aviso-stock" style={{ fontSize: 11, color: 'var(--warning)', marginTop: 2 }}>
              {'\u26A0\uFE0F'} {avisoStock}
            </div>
          )}
          {errorMinimo && (
            <div data-testid="aviso-minimo" role="alert" style={{ fontSize: 11, color: 'var(--danger)', marginTop: 2 }}>
              {'\u26D4'} {errorMinimo}
            </div>
          )}
          {item.precioPorBulto === true && !precioModificado && (
            <div data-testid="precio-por-bulto" style={{ fontSize: 10, color: 'var(--success)', marginTop: 2 }}>
              Precio llevando bulto
            </div>
          )}
          {avisoVenta && (
            <div data-testid="aviso-multiplo" role="alert" style={{ fontSize: 11, color: 'var(--warning)', marginTop: 2 }}>
              {'⚠️'} {avisoVenta}
            </div>
          )}
          {textoBultos && (
            <div data-testid="texto-bultos" style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{textoBultos}</div>
          )}
          {precioModificado && (
            <div style={{ fontSize: 10, color: 'var(--warning)', marginTop: 2 }}>
              {item.descuentoPct
                ? `Descuento ${item.descuentoPct}% · precio original $${Number(item.precioOriginal).toLocaleString('es-AR')}`
                : `Precio modificado · original $${Number(item.precioOriginal).toLocaleString('es-AR')}`}
            </div>
          )}
        </div>
        <button className="btn-icon" style={{ color: 'var(--danger)', borderColor: 'transparent' }}
          onClick={() => onEliminar(item.productoId)}>×</button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {puedeAplicarPrecioLista && (
          <button
            className="btn-icon"
            style={{
              width: 28,
              height: 28,
              fontSize: 13,
              color: 'var(--warning)',
              borderColor: 'var(--warning)',
              fontWeight: 800,
            }}
            onClick={(e) => {
              e.preventDefault();
              onAplicarPrecioLista(item, precioListaActual);
            }}
            title={`Actualizar a precio de lista: $${Number(precioListaActual).toLocaleString('es-AR')}`}
          >
            !
          </button>
        )}
        <span style={{ fontSize: 12, color: 'var(--text3)' }}>$</span>
        <input className="qty-input" type="text" value={precioText}
          onChange={handlePrecioChange} onBlur={handlePrecioBlur}
          style={{ width: 70, fontSize: 13 }} inputMode="decimal" />
        <button
          className="btn-icon"
          style={{ width: 28, height: 28, fontSize: 13 }}
          onClick={(e) => { e.preventDefault(); onAplicarDescuentoPct(item); }}
          title="Aplicar descuento %"
        >
          %
        </button>
        <span style={{ fontSize: 12, color: 'var(--text3)' }}>×</span>
        <div className="qty-control">
          <button className="qty-btn" onClick={() => { onCambiarCantidad(item.productoId, -paso); setCantidadText(String(Math.max(paso, item.cantidad - paso))); }}>−</button>
          <input className="qty-input" type="text" value={cantidadText}
            onChange={handleCantidadChange} onBlur={handleCantidadBlur} inputMode="numeric" />
          <button className="qty-btn" onClick={() => { onCambiarCantidad(item.productoId, paso); setCantidadText(String(item.cantidad + paso)); }}>+</button>
        </div>
        <span style={{ fontSize: 12, color: 'var(--text3)' }}>=</span>
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--success)' }}>
          ${(item.cantidad * item.precio).toLocaleString('es-AR')}
        </span>
      </div>
      {/* REQ-BUL: botón Bulto con el bultoX actual del producto */}
      <BultoControl
        visible={puedeBulto}
        bultoX={producto?.bultoX}
        nombre={normalizarBultoNombre(producto?.bultoNombre)}
        precioBulto={precioDelBulto}
        cantidad={item.cantidad}
        puedeRestar={Number(item.cantidad) > Math.max(CANTIDAD_MINIMA_RENGLON, paso)}
        onSumar={() => onBulto && onBulto(item.productoId, 'sumar')}
        onRestar={() => onBulto && onBulto(item.productoId, 'restar')}
      />
      {puedeAplicarPrecioLista && (
        <div style={{ fontSize: 11, color: 'var(--warning)', fontWeight: 700 }}>
          Nueva lista: ${Number(precioListaActual).toLocaleString('es-AR')}. Tocá ! para actualizar este ítem.
        </div>
      )}
    </div>
  );
};

const Facturacion = () => {
  const { pedidos, clientes, productos, vendedores, deudas, faltantes, vendedorActual, zonaActiva, setZona, recargar, syncNow, syncPedidosFecha, syncPedidosCliente, online, comisionesCierres, stockMap } = useApp();
  const permisoNorm = Number(vendedorActual?.permiso || 2);
  const isAdmin = permisoNorm === 1;
  const puedeBulto = puedeUsarBulto(permisoNorm, 'facturacion'); // AC-BUL-8 (defensa en profundidad)
  const zona = zonaActiva || '';
  const [filtroFecha, setFiltroFecha] = useState(getTodayStr());
  const [filtroEstado, setFiltroEstado] = useState('todos');
  const [clienteQ, setClienteQ] = useState('');
  const [pedidoEditando, setPedidoEditando] = useState(null);
  const [itemsEdit, setItemsEdit] = useState([]);
  // Productos que el armador tacho como faltantes; se pueden destachar desde aca.
  const [removidosEdit, setRemovidosEdit] = useState([]);
  const [fechaEdit, setFechaEdit] = useState(getTodayStr());
  const [clienteNombreEdit, setClienteNombreEdit] = useState('');
  const [productoQ, setProductoQ] = useState('');
  const [showSugg, setShowSugg] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [modoSeleccion, setModoSeleccion] = useState(false);
  const [seleccion, setSeleccion] = useState(new Set());
  const [draftByPid, setDraftByPid] = useState({});
  // REQ-AGR: grupos del pedido que se esta editando (undefined = el pedido no tiene) y como se imprimen.
  const [gruposEdit, setGruposEdit] = useState(undefined);
  const [modoGrupos, setModoGrupos] = useState('detalle');
  // REQ-FAB: PIN de admin para subir los tipos de factura (vive solo en este estado; no se guarda).
  const [pinTipos, setPinTipos] = useState('');
  const [tiposMsg, setTiposMsg] = useState('');
  const draftRef = useRef({});
  // REQ-REN: rendiciones y saldo a favor locales (guardas y boleta). Sin store => listas vacias.
  const [rendLocal, setRendLocal] = useState({ rendiciones: [], cuenta: [] });
  useEffect(() => {
    let vivo = true;
    cargarRendicionesLocales().then(r => { if (vivo && r) setRendLocal(r); }).catch(() => {});
    return () => { vivo = false; };
  }, [pedidos]);
  // S-BUL-07: espejo de itemsEdit para calcular "± Bulto" fuera del updater.
  const itemsEditRef = useRef([]);
  useEffect(() => { itemsEditRef.current = itemsEdit; }, [itemsEdit]);
  // REQ-COM (AC-COM-11): pedidos que ya estan en un cierre de comisiones vigente.
  const cerradosComision = useMemo(() => pedidosEnCierresVigentes(comisionesCierres || []), [comisionesCierres]);
  const cierreDe = (p) => cerradosComision.get(pedidoIdComision(p)) || null;

  const productosIndex = useMemo(() => {
    const byId = new Map();
    const byNombre = new Map();
    for (const p of productos || []) {
      if (p?.id !== undefined && p?.id !== null) byId.set(String(p.id), p);
      const nombre = String(p?.nombre || '').toLowerCase().trim();
      if (nombre) byNombre.set(nombre, p);
    }
    return { byId, byNombre };
  }, [productos]);

  const getProductoActual = (item) => {
    const byId = productosIndex.byId.get(String(item?.productoId));
    if (byId) return byId;
    return productosIndex.byNombre.get(String(item?.nombre || '').toLowerCase().trim()) || null;
  };

  const sameMoney = (a, b) => {
    const aa = Math.round(Number(a || 0) * 100);
    const bb = Math.round(Number(b || 0) * 100);
    return aa === bb;
  };

  const pedidosDia = pedidos
    .filter(isPedidoVisible)
    .filter(p => normalizePedidoFecha(p.fecha) === filtroFecha)
    .filter(p => !zona || String(p.zona || '') === zona)
    .filter(p => filtroEstado === 'todos' || p.estado === filtroEstado)
    .filter(p => !clienteQ.trim() || String(p.clienteNombre || '').toLowerCase().includes(clienteQ.trim().toLowerCase()))
    .sort((a, b) => b.createdAt - a.createdAt);

  if (!isAdmin) {
    return (
      <div className="page">
        <h1 className="page-title">Facturación</h1>
        <div className="empty-state">
          <div className="empty-icon">{'\u26D4'}</div>
          <div className="empty-text">No tenés permisos para facturar</div>
        </div>
      </div>
    );
  }

  // REQ-REN (AC-REN-2/4): un pedido con rendicion vigente no se revierte, borra ni edita
  // (devolveria el stock dos veces). Primero se anula la rendicion.
  const bloqueadoPorRendicion = (p) => {
    if (!pedidoTieneRendicionVigente(p, rendLocal.rendiciones)) return false;
    alert(MSG_PEDIDO_CON_RENDICION);
    return true;
  };
  // REQ-REN (AC-REN-3): deuda pendiente neta del saldo a favor del cliente (si tiene).
  const cuentaBoleta = (p) => {
    const deuda = getDeudaPendienteParaPedido(deudas, p);
    const favor = saldoAFavorCliente(rendLocal.cuenta, p.clienteId);
    if (!favor) return { deuda, extra: {} };
    const c = cuentaParaBoleta(deuda, favor);
    return { deuda: c.deudaPendiente, extra: c.saldoAFavor > 0 ? { saldoAFavor: c.saldoAFavor } : {} };
  };

  const cancelarDesdeFacturar = async (p) => {
    if (bloqueadoPorRendicion(p)) return;
    const msg = (p.estado === 'facturado'
      ? `Este pedido ya está FACTURADO. ¿Borrar igualmente el pedido de "${p.clienteNombre}"?`
      : '¿Borrar este pedido?') + (cierreDe(p) ? AVISO_CERRADO : '');
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

  useEffect(() => {
    if (!pedidoEditando) syncPedidosFecha(filtroFecha);
  }, [filtroFecha, syncPedidosFecha, pedidoEditando]);

  useEffect(() => {
    const q = clienteQ.trim();
    if (!q || pedidoEditando) return;
    const t = setTimeout(() => syncPedidosCliente(q), 450);
    return () => clearTimeout(t);
  }, [clienteQ, syncPedidosCliente, pedidoEditando]);

  const toggleSel = (id) => {
    setSeleccion(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const compartirSeleccion = async () => {
    const pedidosSel = (pedidosDia || [])
      .filter(p => seleccion.has(p.id))
      .filter(isPedidoVisible)
      .sort((a, b) => {
        const oa = getOrdenEntrega(a) ?? Number.MAX_SAFE_INTEGER;
        const ob = getOrdenEntrega(b) ?? Number.MAX_SAFE_INTEGER;
        return oa - ob;
      });
    if (pedidosSel.length === 0) return;

    const files = [];
    for (const p of pedidosSel) {
      const cliente = (clientes || []).find(c => c.id === p.clienteId);
      const cb = cuentaBoleta(p);
      files.push(await generarFacturaFile(p, cliente, { nombre: p.vendedorNombre }, cb.deuda, null, { modoGrupos, ...cb.extra }));
    }

    try {
      // Siempre unir en un solo PDF para que WhatsApp envíe todas juntas.
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

  // REQ-FAB / REQ-AGR: contadores para la pantalla (solo admin los muestra).
  const tiposPendientes = filasTiposFacturaRpc(pedidos || []).length;
  const hayGrupos = (pedidosDia || []).some(p => Array.isArray(p.grupos) && p.grupos.length > 0);

  const abrirEdicion = (p) => {
    if (bloqueadoPorRendicion(p)) return;
    setPedidoEditando(p);
    setGruposEdit(Array.isArray(p.grupos) ? p.grupos.map(g => ({ ...g, itemIds: [...(g.itemIds || [])] })) : undefined);
    const sorted = sortItems(p.items.map(i => ({ ...i })));
    setItemsEdit(sorted);
    setFechaEdit(normalizePedidoFecha(p.fecha) || getTodayStr());
    setClienteNombreEdit(p.clienteNombre || '');
    const drafts = {};
    for (const it of sorted) {
      drafts[it.productoId] = {
        cantidadText: String(it.cantidad ?? 1),
        precioText: String(it.precio ?? 0),
      };
    }
    draftRef.current = drafts;
    setDraftByPid(drafts);
    setRemovidosEdit((getArmadoLog(p)?.removidos || []).map(r => ({ ...r })));
    setProducotoQ && setProducotoQ('');
  };

  const setProducotoQ = setProductoQ;

  const productoLimit = productoQ.trim().length < 2 ? 30 : 80;
  const productoSugg = productoQ.length >= 1 ? searchProductos(productoQ, productos, productoLimit) : [];

  // Destachar un faltante: el producto vuelve al pedido con la cantidad que se
  // habia sacado. Al guardar se borra tambien de la pantalla de Faltantes.
  const destacharRemovido = (productoId) => {
    const r = removidosEdit.find(x => x.productoId === productoId);
    if (!r) return;
    const cantRestaurada = Number(r.cantidad) || 1;
    const existente = itemsEdit.find(i => i.productoId === productoId);
    const cantidadNueva = (existente?.cantidad ?? 0) + cantRestaurada;
    setItemsEdit(prev => {
      if (prev.some(i => i.productoId === productoId)) {
        return sortItems(prev.map(i => i.productoId === productoId ? reprecio({ ...i, cantidad: i.cantidad + cantRestaurada }) : i));
      }
      return sortItems([...prev, {
        productoId, nombre: r.nombre, precio: Number(r.precio) || 0, precioOriginal: Number(r.precio) || 0, cantidad: cantRestaurada,
      }]);
    });
    setDraftByPid(prev => {
      const next = {
        ...prev,
        [productoId]: {
          cantidadText: String(cantidadNueva),
          precioText: String(prev?.[productoId]?.precioText ?? existente?.precio ?? r.precio ?? 0),
        },
      };
      draftRef.current = next;
      return next;
    });
    setRemovidosEdit(prev => prev.filter(x => x.productoId !== productoId));
  };

  const agregarProducto = (p) => {
    // Si el producto figura como faltante tachado, tocarlo lo destacha.
    if (removidosEdit.some(r => r.productoId === p.id)) {
      destacharRemovido(p.id);
      return;
    }
    const cantidadNueva = (itemsEdit.find(i => i.productoId === p.id)?.cantidad ?? 0) + pasoCantidad(p);
    setItemsEdit(prev => {
      const existe = prev.find(i => i.productoId === p.id);
      if (existe) {
        // AC-BUL-9: volver a tocar el producto cambia la cantidad => ya no es la unidad por defecto.
        const next = prev.map(i => i.productoId === p.id ? reprecio(quitarMarcasRenglon({ ...i, cantidad: i.cantidad + pasoCantidad(p) })) : i);
        return sortItems(next);
      }
      // AC-BUL-9: el renglón arranca en 1 con la marca "cantidad por defecto".
      const next = [...prev, renglonNuevo(p)];
      return sortItems(next);
    });
    setDraftByPid(prev => {
      const next = {
        ...prev,
        // cantidadText sigue a la cantidad real: si se toca el mismo producto varias
        // veces, el borrador no puede quedar en "1" y pisar lo agregado al guardar.
        [p.id]: { cantidadText: String(cantidadNueva), precioText: String(prev?.[p.id]?.precioText ?? p.precio ?? 0) },
      };
      draftRef.current = next;
      return next;
    });
    // La busqueda queda como esta para poder tocar varios productos seguidos;
    // se borra con la cruz del buscador.
  };

  const cambiarCantidad = (productoId, delta) => {
    const piso = pasoCantidad(productosIndex.byId.get(String(productoId)));
    setItemsEdit(prev => {
      const next = sortItems(prev.map(i => i.productoId === productoId ? reprecio(quitarMarcasRenglon({ ...i, cantidad: Math.max(piso, i.cantidad + delta) })) : i));
      const it = next.find(x => x.productoId === productoId);
      if (it) {
        setDraftByPid(d => {
          const nd = { ...d, [productoId]: { ...(d[productoId] || {}), cantidadText: String(it.cantidad) } };
          draftRef.current = nd;
          return nd;
        });
      }
      return next;
    });
  };

  // AC-BUL-2/3/9: suma o resta un bulto (si el renglón tiene la unidad por
  // defecto, el primer "+ Bulto" la reemplaza). IMPORTANTE: guardarEdicion prioriza
  // draftByPid[pid].cantidadText sobre item.cantidad, así que el borrador
  // (estado y draftRef) se actualiza con la cantidad resultante, igual que en
  // cambiarCantidad. Si no, al guardar se pisaría con el texto viejo.
  const aplicarBulto = (productoId, op) => {
    // S-BUL-07: el cálculo se hace afuera del updater, con la última lista
    // conocida (itemsEditRef); los updaters quedan puros (sin efectos).
    const actual = itemsEditRef.current.find(i => i.productoId === productoId);
    if (!actual) return;
    // C4 / S-BUL-08: el bulto sale SOLO del producto con el mismo id.
    const prodBulto = productoParaBulto(actual, productosIndex.byId);
    const bx = prodBulto?.bultoX;
    const minimo = Math.max(CANTIDAD_MINIMA_RENGLON, pasoCantidad(prodBulto));
    const cantidad = op === 'sumar'
      ? sumarBultoRenglon(actual.cantidad, bx, { cantidadPorDefecto: actual[MARCA_CANTIDAD_POR_DEFECTO] === true })
      : restarBulto(actual.cantidad, bx, { minimo });
    if (cantidad === actual.cantidad) return;
    const cambiar = (lista) => sortItems(lista.map(i => i.productoId === productoId ? reprecio(quitarMarcasRenglon({ ...i, cantidad })) : i));
    itemsEditRef.current = cambiar(itemsEditRef.current);
    draftRef.current = {
      ...draftRef.current,
      [productoId]: { ...(draftRef.current[productoId] || {}), cantidadText: String(cantidad) },
    };
    setItemsEdit(cambiar);
    setDraftByPid(d => ({ ...d, [productoId]: { ...(d[productoId] || {}), cantidadText: String(cantidad) } }));
  };

  const setCantidad = (productoId, n) => {
    if (!isNaN(n) && n > 0) {
      setItemsEdit(prev => sortItems(prev.map(i => i.productoId === productoId ? reprecio({ ...i, cantidad: n }) : i)));
    }
  };

  const setPrecio = (productoId, precio, descuentoPct = null) => {
    if (!isNaN(precio) && precio >= 0) {
      setItemsEdit(prev => sortItems(prev.map(i =>
        i.productoId === productoId ? { ...i, precio, descuentoPct, precioManual: descuentoPct === null || descuentoPct > 0 } : i
      )));
    }
  };

  // Drafts: lo que el usuario escribe (aunque sea incompleto) queda reflejado.
  // Si el valor parsea bien, actualizamos itemsEdit al instante para que el total sea correcto.
  const draftCantidad = (productoId, text) => {
    const raw = String(text ?? '').replace(/[^\d]/g, '');
    // AC-BUL-9: si el texto cambia (el usuario escribió, aunque termine en 1), la
    // cantidad deja de ser la unidad por defecto. Un blur sin cambios no la quita.
    const textoAnterior = draftRef.current[productoId]?.cantidadText;
    if (raw !== textoAnterior) {
      const sinMarca = (lista) => lista.map(i => i.productoId === productoId ? quitarMarcasRenglon(i) : i);
      itemsEditRef.current = sinMarca(itemsEditRef.current);
      setItemsEdit(sinMarca);
    }
    draftRef.current = { ...draftRef.current, [productoId]: { ...(draftRef.current[productoId] || {}), cantidadText: raw } };
    setDraftByPid(prev => ({ ...prev, [productoId]: { ...(prev[productoId] || {}), cantidadText: raw } }));
    // C3 / S-BUL-06: una cantidad mayor que MAX_CANTIDAD no se toma.
    const n = cantidadTipeada(raw);
    if (n !== null) setCantidad(productoId, n);
  };

  const draftPrecio = (productoId, text) => {
    const raw = String(text ?? '');
    draftRef.current = { ...draftRef.current, [productoId]: { ...(draftRef.current[productoId] || {}), precioText: raw } };
    setDraftByPid(prev => ({ ...prev, [productoId]: { ...(prev[productoId] || {}), precioText: raw } }));
    const n = parseFloat(raw.replace(',', '.'));
    if (!isNaN(n) && n >= 0) setPrecio(productoId, n);
  };

  const aplicarDescuentoPct = (item) => {
    const val = window.prompt('Descuento % para este producto (0-100)', String(item?.descuentoPct ?? ''));
    if (val == null) return;
    const n = parseFloat(String(val).replace(',', '.'));
    if (isNaN(n) || n < 0 || n > 100) {
      alert('Porcentaje inválido (0-100).');
      return;
    }
    const base = precioBaseRenglon(item);
    const nuevo = Math.round((base * (1 - n / 100)) * 100) / 100;
    setPrecio(item.productoId, nuevo, n);
    setDraftByPid(prev => {
      const next = { ...prev, [item.productoId]: { ...(prev[item.productoId] || {}), precioText: String(nuevo) } };
      draftRef.current = next;
      return next;
    });
  };

  const aplicarDescuentoTotalPct = () => {
    if (itemsEdit.length === 0) return;
    const val = window.prompt('Descuento % para toda la factura (0-100)', '');
    if (val == null) return;
    const n = parseFloat(String(val).replace(',', '.'));
    if (isNaN(n) || n < 0 || n > 100) {
      alert('Porcentaje inválido (0-100).');
      return;
    }

    const nextItems = sortItems(itemsEdit.map(item => {
      const base = precioBaseRenglon(item);
      const nuevo = Math.round((base * (1 - n / 100)) * 100) / 100;
      return {
        ...item,
        precio: nuevo,
        precioOriginal: item.precioOriginal ?? item.precio,
        descuentoPct: n > 0 ? n : null,
        descuentoTotalPct: n > 0 ? n : null,
        precioManual: n > 0,
      };
    }));

    const nextDrafts = { ...draftRef.current };
    for (const item of nextItems) {
      nextDrafts[item.productoId] = {
        ...(nextDrafts[item.productoId] || {}),
        cantidadText: String(item.cantidad ?? 1),
        precioText: String(item.precio ?? 0),
      };
    }

    draftRef.current = nextDrafts;
    setItemsEdit(nextItems);
    setDraftByPid(nextDrafts);
  };

  const aplicarPrecioLista = (item, precioListaActual) => {
    const nuevo = Math.round(Number(precioListaActual || 0) * 100) / 100;
    if (!isFinite(nuevo) || nuevo < 0) return;

    setItemsEdit(prev => sortItems(prev.map(i =>
      i.productoId === item.productoId
        ? { ...i, precio: nuevo, precioOriginal: nuevo, descuentoPct: null, precioManual: true, precioPorBulto: false }
        : i
    )));
    setDraftByPid(prev => {
      const next = {
        ...prev,
        [item.productoId]: {
          ...(prev[item.productoId] || {}),
          precioText: String(nuevo),
        },
      };
      draftRef.current = next;
      return next;
    });
  };

  const eliminarItem = (productoId) => {
    setItemsEdit(prev => sortItems(prev.filter(i => i.productoId !== productoId)));
    setDraftByPid(prev => {
      const next = { ...prev };
      delete next[productoId];
      draftRef.current = next;
      return next;
    });
  };

  const totalEdit = itemsEdit.reduce((acc, i) => acc + i.cantidad * i.precio, 0);

  // AC-SST-1: si el pedido ya está facturado, su cantidad original ya se descontó del stock.
  const cantidadYaDescontada = (productoId) => {
    if (String(pedidoEditando?.estado) !== 'facturado') return 0;
    return (pedidoEditando.items || [])
      .filter(i => String(i?.productoId) === String(productoId))
      .reduce((acc, i) => acc + (Number(i.cantidad) || 0), 0);
  };

  // AC-MIN-2: renglones bajo el mínimo (aviso en el renglón; el admin puede guardar con confirmación).
  const erroresMinimoEdit = useMemo(() => {
    const r = validarMinimosItems(itemsEdit, productosIndex.byId, { permiso: permisoNorm, pantalla: 'facturacion', previos: pedidoEditando?.items });
    return new Map(r.errores.map(e => [String(e.productoId), e.minimo]));
  }, [itemsEdit, productosIndex, permisoNorm, pedidoEditando]);

  // AC-PBU-3: cuando el precio cambia solo (precio por bulto) el campo de precio lo refleja.
  useEffect(() => {
    let cambio = false;
    const nd = { ...draftRef.current };
    for (const it of itemsEdit) {
      if (esPrecioManual(it)) continue;
      const d = nd[it.productoId];
      if (!d) continue;
      if (parseFloat(String(d.precioText ?? '').replace(',', '.')) !== Number(it.precio)) {
        nd[it.productoId] = { ...d, precioText: String(it.precio) };
        cambio = true;
      }
    }
    if (cambio) { draftRef.current = nd; setDraftByPid(nd); }
  }, [itemsEdit]);

  const guardarEdicion = async () => {
    setGuardando(true);
    try {
      const draftsSnap = draftRef.current || {};
      // AC-BUL-9: la marca transitoria del renglón no se guarda ni se sincroniza.
      const itemsFinal = sortItems(quitarMarcasRenglones(itemsEdit || []).map(it => {
        const d = draftsSnap[it.productoId];
        if (!d) return it;
        const next = { ...it };
        // C3 / S-BUL-06: solo una cantidad tipeada válida pisa la del renglón.
        const cn = cantidadTipeada(String(d.cantidadText ?? ''));
        if (cn !== null) next.cantidad = cn;
        const pn = parseFloat(String(d.precioText ?? '').trim().replace(',', '.'));
        // AC-PBU-3: el precio tipeado manda solo si el renglón es manual; si no, el precio
        // sale de la cantidad final (precio por bulto).
        if (!isNaN(pn) && pn >= 0 && esPrecioManual(next)) next.precio = pn;
        return reprecio(next);
      }));

      // C3 / S-BUL-06 (AC-BUL-7, AC-STK-8): ninguna cantidad cambiada puede
      // superar MAX_CANTIDAD ni ser no entera; si no, el movimiento de stock
      // quedaría trabado en el servidor. Lo legacy sin cambios pasa (R10).
      const vc = validarCantidadesItems(itemsFinal, { previos: pedidoEditando.items });
      if (!vc.ok) {
        alert(mensajeCantidadesInvalidas(vc.errores));
        return;
      }

      // AC-VTA-3: producto "solo bulto" con cantidad no múltiplo. El admin la puede
      // guardar igual (con confirmación); el resto, no. Lo sin cambios no se valida.
      const vm = validarMultiplosItems(itemsFinal, productosIndex.byId, { permiso: permisoNorm, pantalla: 'facturacion', previos: pedidoEditando.items });
      if (!vm.ok) {
        const detalle = vm.avisos.map(a => `${a.nombre} (${a.cantidad} u., bulto x ${a.bultoX})`).join(', ');
        if (vm.bloquea) { alert(`Hay cantidades que no son múltiplo del bulto: ${detalle}`); return; }
        if (!window.confirm(`Estas cantidades no son múltiplo del bulto: ${detalle}.

¿Guardar igual?`)) return;
      }
      // AC-MIN-2: bajo el mínimo el admin guarda con confirmación (el armador no llega acá).
      const vmin = validarMinimosItems(itemsFinal, productosIndex.byId, { permiso: permisoNorm, pantalla: 'facturacion', previos: pedidoEditando.items });
      if (vmin.errores.length) {
        const detalleMin = vmin.errores.map(e => `${e.nombre} (mínimo ${e.minimo})`).join(', ');
        if (!vmin.requiereConfirmacion) { alert(`Hay productos por debajo del mínimo: ${detalleMin}`); return; }
        if (!window.confirm(`Estos productos quedan por debajo del mínimo: ${detalleMin}.\n\n¿Guardar igual?`)) return;
      }
      // AC-VTA-2: la cantidad queda en unidades; se congelan bultos/bultoX/bultoNombre.
      const itemsGuardar = congelarBultosItems(itemsFinal, productosIndex.byId, { previos: pedidoEditando.items });

      // Lo que se destacho sale de la lista de faltantes del pedido.
      const logOriginal = getArmadoLog(pedidoEditando);
      const idsRestaurados = (logOriginal?.removidos || [])
        .map(r => r.productoId)
        .filter(id => !removidosEdit.some(r => r.productoId === id));

      const pedidoFinal = {
        ...pedidoEditando,
        ...(logOriginal ? {
          armadoLog: {
            ...logOriginal,
            removidos: removidosEdit,
            // S-BUL-03/05: no se re-sube un cambios inflado ni de productos que ya no están.
            ...(Object.prototype.hasOwnProperty.call(logOriginal, 'cambios')
              ? { cambios: acotarCambiosArmado(logOriginal.cambios, { productosVigentes: itemsFinal.map(i => i.productoId) }) }
              : {}),
          },
        } : {}),
        clienteNombre: (clienteNombreEdit || '').trim() || pedidoEditando.clienteNombre,
        fecha: normalizePedidoFecha(fechaEdit),
        items: itemsGuardar,
        total: itemsFinal.reduce((acc, i) => acc + Number(i.cantidad) * Number(i.precio), 0),
        // REQ-AGR (AC-AGR-2): los grupos son solo presentacion; los renglones quedan separados.
        ...(isAdmin && gruposEdit !== undefined ? { grupos: normalizarGrupos(gruposEdit, itemsGuardar) } : {}),
      };

      await guardarPedidoOnlineFirst(pedidoFinal);
      await registrarFaltantes(pedidoEditando, itemsFinal);
      // Ya no faltan: se borran de Faltantes (local y nube).
      for (const id of idsRestaurados) await borrarFaltantesDeProducto(faltantes, pedidoEditando, id);
      if (pedidoEditando.deudaGenerada) await actualizarMontoDeudaDePedido(pedidoEditando, pedidoFinal.total);
      await recargar();
      setPedidoEditando(null);
    } catch (e) {
      console.error('Error guardando edicion:', e);
      alert('No se pudo guardar la edicion: ' + (e?.message || String(e)));
    } finally {
      setGuardando(false);
    }
  };

  // REQ-FAB (AC-FAB-1): marca local del tipo de factura (uno o varios pedidos). No toca stock ni estado.
  const cambiarTipoFactura = async (ids, tipo) => {
    if (!isAdmin) return;
    await guardarTiposFacturaLocal(ids, tipo);
    setTiposMsg('');
    await recargar();
  };

  // REQ-FAB: sube los tipos pendientes con el PIN del admin (el PIN se limpia antes de llamar).
  const subirTipos = async () => {
    if (!isAdmin) return;
    setTiposMsg('');
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { setTiposMsg('Necesitás conexión para subir los tipos de factura.'); return; }
    const cr = await credencialesAdminProductos(pinTipos);
    if (!cr.ok) { setTiposMsg(cr.mensaje); return; }
    setPinTipos('');
    const r = await subirTiposFactura(cr.cred);
    if (!r.ok) { setTiposMsg(r.mensaje || 'No se pudieron subir los tipos de factura.'); return; }
    await recargar();
    setTiposMsg(r.rechazados?.length ? `Se subieron ${r.subidos}; ${r.rechazados.length} quedaron pendientes.` : `Se subieron ${r.subidos} tipos de factura.`);
  };

  const imprimirFactura = async (p) => {
    const cliente = clientes.find(c => c.id === p.clienteId);
    // iOS Safari suele bloquear descargas directas (doc.save).
    // Abrimos una pestaña en el gesto del usuario y luego le asignamos el PDF blob.
    const w = window.open('', '_blank');
    try {
      const cb = cuentaBoleta(p);
      const file = await generarFacturaFile(p, cliente, { nombre: p.vendedorNombre }, cb.deuda, null, { modoGrupos, ...cb.extra });
      const url = URL.createObjectURL(file);
      if (w) w.location.href = url;
      else window.location.href = url;
      // Revoke con delay para no cortar la carga del viewer.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      if (w) w.close();
      throw e;
    }
  };

  const marcarFacturado = async (p) => {
    // REQ-STK (AC-STK-6): antes de facturar se verifica que alcance el stock.
    // El descuento en si lo hace guardarPedidoOnlineFirst (idempotente).
    try {
      const { faltantes: sinStock, decision, avisoInvalidos } = await previsualizarStockPedido({ ...p, estado: 'facturado' }, productos || []);
      // S-BUL-09: renglones con cantidad invalida no mueven stock; se avisa.
      if (avisoInvalidos) alert(avisoInvalidos);
      if (decision !== 'ok') {
        const detalle = sinStock.map(f => `• ${f.nombre}: hay ${f.disponible}, se necesitan ${f.requerido}`).join('\n');
        if (decision === 'bloquear') {
          alert(`No hay stock suficiente para facturar:\n${detalle}`);
          return;
        }
        // AC-SST-1: nunca se bloquea; se resume cuántos productos quedan en negativo.
        if (!window.confirm(`${resumenSinStock(sinStock)}\n\n${detalle}\n\n¿Facturar igual? El stock va a quedar negativo.`)) return;
      }
    } catch (e) {
      console.warn('No se pudo verificar stock antes de facturar:', e?.message || String(e));
    }
    try {
      // Facturar ya NO manda a Deudas solo: a veces el cliente descuenta items
      // al recibir el pedido, asi que la deuda se anota a mano (boton "Pasar
      // a deudas") una vez que el pedido ya quedo con el monto definitivo.
      // Tampoco asigna mas un numero de entrega aca: ese numero ahora sale de
      // "Orden de entrega", calculado al imprimir (ver src/pages/OrdenEntrega.js).
      await guardarPedidoOnlineFirst({ ...p, estado: 'facturado' }, { iniciarStock: true });
      await recargar();
    } catch (e) {
      console.error('Error marcando facturado:', e);
      alert('No se pudo marcar facturado: ' + (e?.message || String(e)));
    }
  };

  // Manual: manda este pedido a Deudas con el monto que tiene EN ESTE MOMENTO
  // (por si se le descontaron items al entregarlo), con la fecha del pedido.
  const pasarADeudas = async (p) => {
    try {
      const cliente = (clientes || []).find(c => c.id === p.clienteId);
      const resultado = await guardarPedidoOnlineFirst({ ...p, deudaGenerada: true });
      const creada = await registrarDeudaFacturado(
        { ...p, remoteId: resultado?.remoteId ?? p.remoteId },
        cliente
      );
      if (!creada) alert('Este pedido ya estaba en Deudas.');
      await recargar();
    } catch (e) {
      console.error('Error pasando a deudas:', e);
      alert('No se pudo pasar a deudas: ' + (e?.message || String(e)));
    }
  };

  const marcarPendiente = async (p) => {
    if (bloqueadoPorRendicion(p)) return;
    if (!window.confirm(`¿Revertir el pedido de "${p.clienteNombre}" a pendiente?${cierreDe(p) ? AVISO_CERRADO : ''}`)) return;
    try {
      // Si el pedido ya tenia deuda: se quita (salvo que ya se haya cobrado algo).
      const { conservada } = await quitarDeudaDePedido(p);
      const pedidoRevertido = {
        ...p,
        estado: 'pendiente',
        ordenEntrega: null,
        items: (p.items || []).map(({ __ordenEntrega, ...rest }) => rest),
        ...(conservada ? {} : { deudaGenerada: false }),
      };
      await guardarPedidoOnlineFirst(pedidoRevertido);
      if (conservada) {
        alert('Este pedido ya tenia cobros registrados, asi que su deuda se conserva en "Deudas".');
      }
      await recargar();
    } catch (e) {
      console.error('Error revirtiendo a pendiente:', e);
      alert('No se pudo revertir: ' + (e?.message || String(e)));
    }
  };

  // REQ-COM (AC-COM-1): marcar / desmarcar "Entregado". No cambia el estado ni el stock.
  const toggleEntregado = async (p) => {
    if (!p.entregado) {
      const chk = puedeMarcarEntregado(p, permisoNorm);
      if (!chk.ok) { alert(chk.motivo); return; }
    } else {
      const chk = puedeDesmarcarEntregado(p, permisoNorm, cierreDe(p));
      if (!chk.ok) { alert(chk.motivo); return; }
      if (chk.requiereConfirmacion && !window.confirm(`¿Desmarcar como entregado el pedido de "${p.clienteNombre}"?${AVISO_CERRADO}`)) return;
    }
    try {
      // S-COM-17: el repositorio tambien valida "solo el admin desmarca un pedido cerrado".
      await marcarEntregadoOnlineFirst(p, !p.entregado, { cerradoEn: cierreDe(p) });
      await recargar();
    } catch (e) {
      console.error('Error marcando entregado:', e);
      alert('No se pudo guardar la entrega: ' + (e?.message || String(e)));
    }
  };

  if (pedidoEditando) {
    return (
      <div className="page">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <button className="btn-icon" onClick={() => setPedidoEditando(null)}>‹</button>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700 }}>Editando pedido</h2>
            <div style={{ fontSize: 13, color: 'var(--text3)' }}>{pedidoEditando.clienteNombre}</div>
          </div>
        </div>

        <ArmadoResumen pedido={pedidoEditando} ocultarRemovidos />

        <div className="card">
          <label className="input-label">Nombre del cliente</label>
          <input
            className="input"
            value={clienteNombreEdit}
            onChange={e => setClienteNombreEdit(e.target.value)}
            placeholder="Nombre del cliente..."
            style={{ marginBottom: 10 }}
          />
          <label className="input-label">Fecha del pedido</label>
          <input
            type="date"
            className="input"
            value={fechaEdit}
            onChange={e => setFechaEdit(e.target.value)}
            style={{ marginBottom: 10 }}
          />
          <label className="input-label">Agregar producto</label>
          <div style={{ position: 'relative' }}>
            <input
              className="input"
              value={productoQ}
              onChange={e => { setProductoQ(e.target.value); setShowSugg(true); }}
              onFocus={() => setShowSugg(true)}
              placeholder="Buscar producto..."
              autoComplete="off"
              style={{ paddingRight: 44 }}
            />
            {productoQ && (
              <button
                type="button"
                aria-label="Borrar busqueda"
                onMouseDown={(e) => { e.preventDefault(); setProductoQ(''); setShowSugg(false); }}
                style={{
                  position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
                  width: 32, height: 32, borderRadius: '50%', border: 'none',
                  background: 'var(--bg4)', color: 'var(--text2)', fontSize: 16, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >{'\u2715'}</button>
            )}
            {showSugg && productoSugg.length > 0 && (
              <div className="suggestions">
                {productoSugg.map(p => (
                  <div key={p.id} className="suggestion-item" onClick={() => agregarProducto(p)}>
                    <div>
                      <div>{p.nombre}</div>
                      <div className="suggestion-sub">{p.codigo || ''}</div>
                    </div>
                    <span style={{ color: 'var(--success)', fontWeight: 600, textAlign: 'right' }}>
                      {(() => {
                        const rem = removidosEdit.find(r => r.productoId === p.id);
                        if (rem) return <span style={{ marginRight: 8, color: 'var(--danger)' }}>Faltante x{rem.cantidad} - tocar para destachar</span>;
                        const ya = itemsEdit.find(i => i.productoId === p.id);
                        return ya ? <span style={{ marginRight: 8 }}>{'\u2713'} x{ya.cantidad}</span> : null;
                      })()}
                      ${p.precio?.toLocaleString('es-AR')}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 14 }}>
            Ítems del pedido
          </div>

          {/* Lo que el armador saco/redujo va arriba de todo. Tocando "Destachar" vuelve al pedido. */}
          {removidosEdit.length > 0 && (
            <>
              <div style={{
                fontSize: 12, fontWeight: 700, color: 'var(--danger)',
                textTransform: 'uppercase', letterSpacing: '0.5px',
                margin: '4px 2px 8px',
              }}>
                {'\u26A0\uFE0F'} Marcados como faltantes ({removidosEdit.length})
              </div>
              {removidosEdit.map((r, i) => (
                <div
                  key={r.productoId ?? i}
                  className="card"
                  style={{
                    padding: '12px 14px', marginBottom: 10,
                    background: 'rgba(220,53,69,0.06)', borderColor: 'var(--danger)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 700, textDecoration: 'line-through', color: 'var(--danger)' }}>
                        {r.nombre}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text3)' }}>
                        {'Sacado \u00D7'}{r.cantidad}
                      </div>
                    </div>
                    <button
                      className="btn btn-sm"
                      style={{ width: 'auto', background: 'var(--success)', color: '#fff', flex: 'none' }}
                      onClick={() => destacharRemovido(r.productoId)}
                    >
                      {'\u2713'} Destachar
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}

          {itemsEdit.length === 0 && (
            <div style={{ color: 'var(--text3)', fontSize: 14, textAlign: 'center', padding: '20px 0' }}>
              Sin productos
            </div>
          )}
          {itemsEdit.map(item => {
            const productoActual = getProductoActual(item);
            const precioListaActual = productoActual?.precio;
            const precioBasePedido = item.precioOriginal ?? item.precio;
            const puedeAplicarPrecioLista =
              precioListaActual !== undefined &&
              precioListaActual !== null &&
              !sameMoney(precioListaActual, precioBasePedido);

            return (
              <FacturacionItemRow
                key={item.productoId}
                item={item}
                cantidadText={draftByPid[item.productoId]?.cantidadText ?? String(item.cantidad ?? 1)}
                precioText={draftByPid[item.productoId]?.precioText ?? String(item.precio ?? 0)}
                onCambiarCantidad={cambiarCantidad}
                onDraftCantidad={draftCantidad}
                onDraftPrecio={draftPrecio}
                onEliminar={eliminarItem}
                onAplicarDescuentoPct={aplicarDescuentoPct}
                precioListaActual={precioListaActual}
                puedeAplicarPrecioLista={puedeAplicarPrecioLista}
                onAplicarPrecioLista={aplicarPrecioLista}
                producto={productoParaBulto(item, productosIndex.byId)}
                puedeBulto={puedeBulto}
                onBulto={aplicarBulto}
                avisoStock={avisoSinStock(item.cantidad, stockParaAviso(stockMap, item.productoId, cantidadYaDescontada(item.productoId)))}
                errorMinimo={erroresMinimoEdit.has(String(item.productoId)) ? mensajeMinimo(erroresMinimoEdit.get(String(item.productoId))) : null}
              />
            );
          })}
          {itemsEdit.length > 0 && (
            <>
              <div className="total-row">
                <span className="total-label">Total</span>
                <span className="total-value">${totalEdit.toLocaleString('es-AR')}</span>
              </div>
              <button
                className="btn btn-ghost btn-sm"
                onClick={aplicarDescuentoTotalPct}
                style={{
                  width: '100%',
                  marginTop: 10,
                  borderStyle: 'dashed',
                  fontWeight: 800,
                }}
              >
                % Descuento total de la factura
              </button>
            </>
          )}
        </div>

        {isAdmin && (
          <AgruparRenglones
            items={itemsEdit}
            grupos={gruposEdit || []}
            productosById={productosIndex.byId}
            onChange={setGruposEdit}
          />
        )}

        <div style={{ display: 'flex', gap: 10, marginBottom: 80 }}>
          <button className="btn btn-ghost" onClick={() => setPedidoEditando(null)}>Cancelar</button>
          <button className="btn btn-primary" onClick={guardarEdicion} disabled={guardando} style={{ flex: 1 }}>
            {guardando ? 'Guardando...' : '✓ Guardar cambios'}
          </button>
        </div>
        {online && (
          <div style={{ marginTop: -70, marginBottom: 70, fontSize: 12, color: 'var(--text3)' }}>
            Cambios guardados. La sincronizacion se actualiza automaticamente.
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="page">
      <h1 className="page-title">Facturación</h1>

      <div className="card" style={{ padding: '12px 14px', marginBottom: 14 }}>
        <label className="input-label">Zona</label>
        <select className="input" value={zona} onChange={e => setZona(e.target.value)} style={{ marginBottom: 10 }}>
          <option value="">Todas</option>
          {[...new Set((vendedores || []).map(v => v.zona).filter(Boolean))].sort().map(z => (
            <option key={z} value={z}>{z}</option>
          ))}
        </select>
        <label className="input-label">Fecha</label>
        <input
          type="date"
          className="input"
          value={filtroFecha}
          onChange={e => setFiltroFecha(e.target.value)}
        />

        <input
          className="input"
          value={clienteQ}
          onChange={e => setClienteQ(e.target.value)}
          placeholder="Buscar por cliente..."
          style={{ marginTop: 10 }}
        />

        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2, marginTop: 10 }}>
          {[
            ['todos', 'Todos'],
            ['pendiente', 'Pendientes'],
            ['facturado', 'Facturados'],
          ].map(([value, label]) => (
            <button
              key={value}
              className={`btn btn-sm ${filtroEstado === value ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setFiltroEstado(value)}
              style={{ whiteSpace: 'nowrap', flex: 'none' }}
            >
              {label}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button
            className={`btn btn-sm ${modoSeleccion ? 'btn-primary' : 'btn-ghost'}`}
            style={{ width: 'auto' }}
            onClick={() => { setModoSeleccion(v => !v); setSeleccion(new Set()); }}
          >
            Seleccionar
          </button>
          {modoSeleccion && isAdmin && ['A', 'B', 'ninguna'].map(t => (
            <button
              key={t}
              className="btn btn-ghost btn-sm"
              style={{ width: 'auto' }}
              data-testid={`marcar-${t}`}
              disabled={seleccion.size === 0}
              onClick={async () => { await cambiarTipoFactura([...seleccion], t); }}
            >
              {ETIQUETA_TIPO_FACTURA[t]}
            </button>
          ))}
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
      </div>

      {isAdmin && (tiposPendientes > 0 || tiposMsg) && (
        <div className="card" data-testid="subir-tipos-factura" style={{ padding: '10px 14px', marginBottom: 14 }}>
          {tiposPendientes > 0 && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                type="password"
                inputMode="numeric"
                autoComplete="off"
                className="input"
                aria-label="PIN de administrador"
                placeholder="Tu PIN"
                value={pinTipos}
                onChange={e => setPinTipos(e.target.value)}
                style={{ width: 120 }}
              />
              <button className="btn btn-primary btn-sm" style={{ width: 'auto' }} onClick={subirTipos}>
                Subir tipos de factura ({tiposPendientes})
              </button>
            </div>
          )}
          {tiposMsg && <div role="status" style={{ fontSize: 13, marginTop: 6 }}>{tiposMsg}</div>}
        </div>
      )}

      {isAdmin && hayGrupos && (
        <div className="card" style={{ padding: '10px 14px', marginBottom: 14 }}>
          <label className="input-label" htmlFor="modo-grupos">Al imprimir, los grupos salen</label>
          <select id="modo-grupos" className="input" value={modoGrupos} onChange={e => setModoGrupos(e.target.value)}>
            <option value="detalle">Con detalle (el grupo y debajo sus renglones)</option>
            <option value="solo_grupos">Solo grupos</option>
          </select>
        </div>
      )}

      {pedidosDia.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">🧾</div>
          <div className="empty-text">No hay pedidos para facturar en esta fecha</div>
        </div>
      ) : (
        pedidosDia.map(p => (
          <div
            key={p.id}
            className="card"
            onClick={modoSeleccion ? () => toggleSel(p.id) : undefined}
            style={modoSeleccion ? { cursor: 'pointer' } : undefined}
          >
            {(p.items || []).some(i =>
              i?.precioOriginal !== undefined &&
              i?.precioOriginal !== null &&
              esPrecioManual(i)
            ) && (
              <div style={{
                fontSize: 11,
                color: 'var(--warning)',
                fontWeight: 700,
                marginBottom: 8,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}>
                {'\u26A0\uFE0F'} Tiene precios modificados
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  {getOrdenEntrega(p) && (
                    <span style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      minWidth: 26,
                      height: 26,
                      padding: '0 7px',
                      border: '2px solid var(--text1)',
                      borderRadius: 6,
                      fontSize: 14,
                      fontWeight: 900,
                      color: 'var(--text1)',
                      background: '#fff',
                    }}>
                      {getOrdenEntrega(p)}
                    </span>
                  )}
                  <div style={{ fontWeight: 700, fontSize: 16 }}>{p.clienteNombre}</div>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text3)' }}>{p.vendedorNombre} · {formatFecha(normalizePedidoFecha(p.fecha))}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 700, color: 'var(--success)', fontSize: 16 }}>
                  ${(p.total || 0).toLocaleString('es-AR')}
                </div>
                <span className={`badge badge-${p.estado === 'pendiente' ? 'pending' : p.estado === 'facturado' ? 'facturado' : 'done'}`}>
                  {p.estado}
                </span>
                {p.estado === 'facturado' && p.entregado && (
                  <span className="badge badge-done" data-testid="badge-entregado" style={{ marginLeft: 4 }}>Entregado</span>
                )}
                {cierreDe(p) && (
                  <span className="badge badge-pending" data-testid="badge-cerrado" title="Incluido en un cierre de comisiones vigente" style={{ marginLeft: 4 }}>Cerrado</span>
                )}
              </div>
            </div>

            {/* Sin descripcion en listado: el detalle se ve entrando al pedido (Editar). */}
            <ArmadoResumen pedido={p} compact />

            {isAdmin && (
              <TipoFacturaSelector
                pedido={p}
                cliente={(clientes || []).find(c => c.id === p.clienteId)}
                onChange={(t) => cambiarTipoFactura([p.id], t)}
              />
            )}


            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); abrirEdicion(p); }} style={{ flex: 1 }}>
                ✏️ Editar
              </button>
              <button className="btn btn-danger btn-sm" onClick={(e) => { e.stopPropagation(); cancelarDesdeFacturar(p); }} style={{ width: 'auto' }}>
                Cancelar
              </button>
              <button
                className="btn btn-success btn-sm"
                onClick={(e) => { e.stopPropagation(); imprimirFactura(p); }}
                style={{ flex: 1 }}
              >
                🖨️ Imprimir factura
              </button>
              {p.estado !== 'facturado' ? (
                <button
                  className="btn btn-primary btn-sm"
                  onClick={(e) => { e.stopPropagation(); marcarFacturado(p); }}
                  style={{ width: 'auto' }}
                >
                  Cambiar a facturado
                </button>
              ) : (
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={(e) => { e.stopPropagation(); marcarPendiente(p); }}
                  style={{ width: 'auto', color: 'var(--warning)', borderColor: 'var(--warning)' }}
                >
                  Revertir a pendiente
                </button>
              )}
              {p.estado === 'facturado' && (
                <button
                  className="btn btn-ghost btn-sm"
                  data-testid="btn-entregado"
                  onClick={(e) => { e.stopPropagation(); toggleEntregado(p); }}
                  style={{ width: 'auto' }}
                >
                  {p.entregado ? 'Desmarcar entregado' : '✅ Marcar entregado'}
                </button>
              )}
              {p.estado === 'facturado' && (
                p.deudaGenerada ? (
                  <span className="badge badge-done" style={{ flex: 'none' }}>En deudas</span>
                ) : (
                  <button
                    className="btn btn-sm"
                    onClick={(e) => { e.stopPropagation(); pasarADeudas(p); }}
                    style={{ width: 'auto', background: 'var(--danger)', color: '#fff' }}
                    title="Anota la deuda con el monto de este pedido y la fecha del pedido"
                  >
                    {'\u{1F4B0}'} Pasar a deudas
                  </button>
                )
              )}
            </div>

            {modoSeleccion && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
                <input type="checkbox" checked={seleccion.has(p.id)} readOnly />
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
};

export default Facturacion;
