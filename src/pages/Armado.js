// src/pages/Armado.js
// Pantalla del rol "Armador": prepara pedidos en deposito.
// Usa un campo independiente "armado" (no toca "estado": pendiente/facturado).
import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../hooks/useAppContext';
import { getTodayStr, formatFecha, searchProductos } from '../utils/fuzzy';
import { generarFacturaFile, generarListaClientesFile } from '../utils/pdfGen';
import { shareFiles, canShareFiles } from '../utils/share';
import { mergePdfFilesToSingleFile } from '../utils/pdfMerge';
import { guardarPedidoOnlineFirst } from '../services/pedidoRepository';
import { registrarFaltantes, getPedidos } from '../db';
import { borrarFaltantesDeProducto } from '../services/faltanteRepository';
import { actualizarMontoDeudaDePedido } from '../services/deudaRepository';
import {
  isPedidoVisible, isPedidoArmado, makePedidoArmado,
  isPedidoAReparto, makePedidoAReparto, normalizePedidoFecha,
  getDeudaPendienteParaPedido,
} from '../utils/pedidos';
import { sumarBultoRenglon, restarBulto, puedeUsarBulto, CANTIDAD_MINIMA_RENGLON, MARCA_CANTIDAD_POR_DEFECTO, renglonNuevo, quitarMarcasRenglon, quitarMarcasRenglones, cantidadTipeada, sumarCantidades, mensajeCantidadesInvalidas, productoParaBulto } from '../domain/bultos';
import { cambiosDeCantidad, fusionarCambiosArmado } from '../domain/armado';
import BultoControl from '../components/BultoControl';
import { avisoSinStock, stockParaAviso } from '../domain/stock';
import { precioAplicadoRenglon } from '../domain/precios';
import { minimoEfectivo, validarMinimosItems, mensajeMinimo } from '../domain/minimos';
import { pasoCantidad, avisoMultiplo, validarMultiplosItems, congelarBultosItems, congelarBultosRenglon, textoRenglonBultos, precioBulto, ventaPorEfectivo, normalizarBultoNombre } from '../domain/unidadVenta';

// AC-PBU-3: re-precia el renglón con su cantidad actual (precio por bulto), salvo precio manual.
const reprecio = (it) => precioAplicadoRenglon(it, it?.cantidad);

let _keySeq = 0;
const nextKey = () => `k${Date.now()}_${_keySeq++}`;

const FILTROS = [
  { id: 'todos', label: 'Todos los pedidos' },
  { id: 'sin_armar', label: 'Sin armar' },
  { id: 'armados', label: 'Armados' },
  { id: 'reparto', label: 'A reparto' },
];

const alpha = (a, b) =>
  String(a || '').localeCompare(String(b || ''), 'es', { sensitivity: 'base' });

// La boleta se imprime en orden alfabetico (A→Z). Para armar en el deposito
// conviene recorrer la estanteria al reves (Z→A), asi lo pidio el armador.
const sortItemsArmado = (items) => [...(items || [])].sort((a, b) => alpha(b?.nombre, a?.nombre));

// Tarjeta de un producto dentro de "Armar pedido". Separada del componente
// principal para poder repetirla en el grupo de tachados y el de activos.
const ItemArmadoCard = ({ item, producto, puedeBulto = false, avisoStock = null, errorMinimo = null, onTick, onCantidad, onCantidadTexto, onEliminar, onBulto }) => {
  // REQ-VTA (AC-VTA-2/3): paso por bulto, aviso de no múltiplo y "3 Display (48 u.)".
  const paso = pasoCantidad(producto);
  const avisoVenta = item.eliminado ? null : avisoMultiplo(item.cantidad, producto);
  const textoBultos = textoRenglonBultos(congelarBultosRenglon(item, producto));
  const precioDelBulto = ventaPorEfectivo(producto) !== 'unidad' ? precioBulto(item.precio, producto?.bultoX) : null;
  return (
  <div
    className="card"
    style={{
      padding: '12px 14px',
      marginBottom: 10,
      background: item.eliminado ? 'rgba(220,53,69,0.06)' : item.picked ? 'rgba(46,204,113,0.08)' : undefined,
      borderColor: item.eliminado ? 'var(--danger)' : item.picked ? 'var(--success)' : undefined,
      opacity: item.eliminado ? 0.75 : 1,
    }}
  >
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: item.eliminado ? 0 : 10 }}>
      <button
        className="btn-icon"
        onClick={() => onTick(item._key)}
        title={item.eliminado ? 'Se encontro: restaurar al pedido' : (item.picked ? 'Marcado como puesto en el pedido' : 'Marcar como puesto en el pedido')}
        style={{
          width: 42, height: 42, fontSize: 20, flex: 'none',
          background: item.picked && !item.eliminado ? 'var(--success)' : 'var(--bg4)',
          borderColor: item.eliminado ? 'var(--success)' : (item.picked ? 'var(--success)' : 'var(--border)'),
          color: item.picked && !item.eliminado ? '#fff' : (item.eliminado ? 'var(--success)' : 'var(--text3)'),
        }}
      >
        {'✓'}
      </button>
      <div style={{ flex: 1 }}>
        <div style={{
          fontSize: 15, fontWeight: 700,
          textDecoration: (item.picked || item.eliminado) ? 'line-through' : 'none',
          color: item.eliminado ? 'var(--danger)' : (item.picked ? 'var(--text3)' : 'var(--text)'),
        }}>
          {item.nombre}
        </div>
        {!item.eliminado && avisoStock && (
          <div data-testid="aviso-stock" style={{ fontSize: 12, color: 'var(--warning)' }}>
            {'\u26A0\uFE0F'} {avisoStock}
          </div>
        )}
        {!item.eliminado && errorMinimo && (
          <div data-testid="aviso-minimo" role="alert" style={{ fontSize: 12, color: 'var(--danger)' }}>
            {'\u26D4'} {errorMinimo} (si falta mercadería, sacalo con el tachito)
          </div>
        )}
        {avisoVenta && (
          <div data-testid="aviso-multiplo" role="alert" style={{ fontSize: 12, color: 'var(--warning)' }}>
            {'⚠️'} {avisoVenta}
          </div>
        )}
        {!item.eliminado && textoBultos && (
          <div data-testid="texto-bultos" style={{ fontSize: 12, color: 'var(--text3)' }}>{textoBultos}</div>
        )}
        {item.eliminado && (
          <div style={{ fontSize: 12, color: 'var(--text3)' }}>
            Sacado ×{item.cantidad} · tocá el tick si aparecio
          </div>
        )}
      </div>
    </div>
    {!item.eliminado && (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div className="qty-control">
          <button
            className="qty-btn"
            style={{ width: 42, height: 42, fontSize: 22 }}
            onClick={() => onCantidad(item._key, -paso)}
          >
            −
          </button>
          <input
            className="qty-input"
            style={{ width: 56, height: 42, fontSize: 18 }}
            type="text"
            inputMode="numeric"
            value={item.cantidad}
            onChange={e => onCantidadTexto(item._key, e.target.value)}
          />
          <button
            className="qty-btn"
            style={{ width: 42, height: 42, fontSize: 22 }}
            onClick={() => onCantidad(item._key, paso)}
          >
            +
          </button>
        </div>
        <button
          className="btn-icon"
          style={{ color: 'var(--danger)', borderColor: 'var(--danger)', width: 42, height: 42, fontSize: 18, marginLeft: 'auto' }}
          onClick={() => onEliminar(item._key)}
          title="Sacar del pedido (se anota en Faltantes)"
        >
          {'\u{1F5D1}'}
        </button>
      </div>
    )}
    {/* REQ-BUL: botón Bulto (no en ítems tachados) con el bultoX actual del producto */}
    {!item.eliminado && (
      <div style={{ marginTop: 8 }}>
        <BultoControl
          visible={puedeBulto}
          bultoX={producto?.bultoX}
          nombre={normalizarBultoNombre(producto?.bultoNombre)}
          precioBulto={precioDelBulto}
          cantidad={item.cantidad}
          puedeRestar={Number(item.cantidad) > Math.max(CANTIDAD_MINIMA_RENGLON, paso)}
          onSumar={() => onBulto && onBulto(item._key, 'sumar')}
          onRestar={() => onBulto && onBulto(item._key, 'restar')}
        />
      </div>
    )}
  </div>
  );
};

const Armado = () => {
  const { pedidos, clientes, productos, faltantes, deudas, vendedorActual, recargar, syncPedidosFecha, stockMap } = useApp();
  const productosById = useMemo(() => new Map((productos || []).map(p => [String(p.id), p])), [productos]);
  const permisoNorm = Number(vendedorActual?.permiso || 2);
  const puedeBulto = puedeUsarBulto(permisoNorm, 'armado'); // AC-BUL-8

  const [filtroFecha, setFiltroFecha] = useState(getTodayStr());
  const [filtroArmado, setFiltroArmado] = useState('todos');
  const [procesandoId, setProcesandoId] = useState(null);
  const [modoSeleccion, setModoSeleccion] = useState(false);
  const [seleccion, setSeleccion] = useState(new Set());
  const [imprimiendoSeleccion, setImprimiendoSeleccion] = useState(false);

  // --- Lista de clientes para imprimir (uno o varios dias juntos) ---
  const [mostrarListaClientes, setMostrarListaClientes] = useState(false);
  const [diasListaClientes, setDiasListaClientes] = useState([]);
  const [nuevoDiaLista, setNuevoDiaLista] = useState('');
  const [generandoListaClientes, setGenerandoListaClientes] = useState(false);

  // --- Interfaz de armado (producto por producto) ---
  const [armando, setArmando] = useState(null); // pedido original (snapshot) que se esta armando
  const [itemsArmado, setItemsArmado] = useState([]);
  const [productoQ, setProductoQ] = useState('');
  const [showSugg, setShowSugg] = useState(false);
  const [guardandoArmado, setGuardandoArmado] = useState(false);

  useEffect(() => {
    // Traer del remoto solo los pedidos de esa fecha (todas las zonas/vendedores).
    syncPedidosFecha(filtroFecha);
  }, [filtroFecha, syncPedidosFecha]);

  const filtrados = useMemo(() => {
    // Igual que en Pedidos/Facturacion: deduplicar por remoteId/id ante posibles duplicados visuales.
    const dedup = new Map();
    for (const p of (pedidos || [])) {
      if (!isPedidoVisible(p)) continue;
      if (normalizePedidoFecha(p.fecha) !== filtroFecha) continue;
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
      if (filtroArmado === 'sin_armar') return !isPedidoArmado(p);
      if (filtroArmado === 'armados') return isPedidoArmado(p);
      if (filtroArmado === 'reparto') return isPedidoAReparto(p);
      return true;
    }).sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
  }, [pedidos, filtroFecha, filtroArmado]);

  const totalSinArmar = (pedidos || [])
    .filter(isPedidoVisible)
    .filter(p => normalizePedidoFecha(p.fecha) === filtroFecha)
    .filter(p => !isPedidoArmado(p)).length;

  const totalAReparto = (pedidos || [])
    .filter(isPedidoVisible)
    .filter(p => normalizePedidoFecha(p.fecha) === filtroFecha)
    .filter(isPedidoAReparto).length;

  const imprimir = async (p) => {
    const cliente = (clientes || []).find(c => c.id === p.clienteId);
    const deudaPendiente = getDeudaPendienteParaPedido(deudas, p);
    const file = await generarFacturaFile(p, cliente, { nombre: p.vendedorNombre }, deudaPendiente);

    // En celulares con soporte de "compartir archivos" mandamos directo a la hoja
    // de compartir (desde ahi se puede elegir "Imprimir"). Si no, abrimos el PDF
    // en una pestaña nueva para que el usuario lo imprima desde el visor.
    if (canShareFiles()) {
      try {
        await shareFiles({ title: `Pedido ${p.clienteNombre}`, files: [file] });
        return;
      } catch (e) {
        // Si el usuario cancela el share o el navegador lo rechaza, caemos al visor.
      }
    }

    const w = window.open('', '_blank');
    try {
      const url = URL.createObjectURL(file);
      if (w) w.location.href = url;
      else window.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      if (w) w.close();
      alert('No se pudo generar el PDF: ' + (e?.message || String(e)));
    }
  };

  const toggleSel = (id) => {
    setSeleccion(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const imprimirSeleccion = async () => {
    const pedidosSel = filtrados.filter(p => seleccion.has(p.id));
    if (pedidosSel.length === 0) return;

    setImprimiendoSeleccion(true);
    try {
      const files = [];
      for (const p of pedidosSel) {
        const cliente = (clientes || []).find(c => c.id === p.clienteId);
        const deudaPendiente = getDeudaPendienteParaPedido(deudas, p);
        files.push(await generarFacturaFile(p, cliente, { nombre: p.vendedorNombre }, deudaPendiente));
      }

      // Un solo PDF con todos los pedidos: asi se comparte/imprime de una vez
      // en lugar de mandar un archivo por pedido.
      const merged = await mergePdfFilesToSingleFile(files, `pedidos_armado_${filtroFecha}.pdf`);

      if (canShareFiles()) {
        try {
          await shareFiles({ title: `Pedidos ${filtroFecha}`, files: [merged] });
          setSeleccion(new Set());
          setModoSeleccion(false);
          return;
        } catch (e) {
          // Si cancela o el navegador lo rechaza, caemos al visor.
        }
      }

      const w = window.open('', '_blank');
      const url = URL.createObjectURL(merged);
      if (w) w.location.href = url;
      else window.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setSeleccion(new Set());
      setModoSeleccion(false);
    } catch (e) {
      alert('No se pudo imprimir la seleccion: ' + (e?.message || String(e)));
    } finally {
      setImprimiendoSeleccion(false);
    }
  };

  const abrirListaClientes = () => {
    setDiasListaClientes([filtroFecha]);
    setNuevoDiaLista('');
    setMostrarListaClientes(true);
  };

  const agregarDiaLista = () => {
    if (!nuevoDiaLista) return;
    setDiasListaClientes(prev => prev.includes(nuevoDiaLista) ? prev : [...prev, nuevoDiaLista].sort());
    setNuevoDiaLista('');
  };

  const quitarDiaLista = (fecha) => {
    setDiasListaClientes(prev => prev.filter(f => f !== fecha));
  };

  const imprimirListaClientes = async () => {
    if (diasListaClientes.length === 0) return;
    setGenerandoListaClientes(true);
    try {
      // Traer del remoto lo que falte de cada dia elegido antes de armar la lista.
      for (const fecha of diasListaClientes) {
        await syncPedidosFecha(fecha);
      }

      const todos = await getPedidos();
      const diasSet = new Set(diasListaClientes);
      const dedup = new Map();
      for (const p of todos) {
        if (!isPedidoVisible(p)) continue;
        if (!diasSet.has(normalizePedidoFecha(p.fecha))) continue;
        const k = p.remoteId ? `r:${p.remoteId}` : `l:${p.id}`;
        const prev = dedup.get(k);
        if (!prev) dedup.set(k, p);
        else {
          const a = Number(prev.updatedAt || prev.createdAt || 0);
          const b = Number(p.updatedAt || p.createdAt || 0);
          if (b >= a) dedup.set(k, p);
        }
      }
      const pedidosLista = [...dedup.values()];

      if (pedidosLista.length === 0) {
        alert('No hay pedidos para los dias elegidos.');
        return;
      }

      const file = await generarListaClientesFile(pedidosLista, diasListaClientes);

      if (canShareFiles()) {
        try {
          await shareFiles({ title: 'Lista de clientes', files: [file] });
          setMostrarListaClientes(false);
          return;
        } catch (e) {
          // Si cancela o el navegador lo rechaza, caemos al visor.
        }
      }

      const w = window.open('', '_blank');
      const url = URL.createObjectURL(file);
      if (w) w.location.href = url;
      else window.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setMostrarListaClientes(false);
    } catch (e) {
      alert('No se pudo generar el PDF: ' + (e?.message || String(e)));
    } finally {
      setGenerandoListaClientes(false);
    }
  };

  const marcarArmado = async (p, armado) => {
    setProcesandoId(p.id);
    try {
      await guardarPedidoOnlineFirst(makePedidoArmado(p, armado, vendedorActual?.nombre || ''));
      await recargar();
    } catch (e) {
      console.error('Error marcando armado:', e);
      alert('No se pudo actualizar: ' + (e?.message || String(e)));
    } finally {
      setProcesandoId(null);
    }
  };

  // "A reparto": la ultima verificacion antes de que el pedido salga a entregar.
  const marcarReparto = async (p, aReparto) => {
    setProcesandoId(p.id);
    try {
      await guardarPedidoOnlineFirst(makePedidoAReparto(p, aReparto, vendedorActual?.nombre || ''));
      await recargar();
    } catch (e) {
      console.error('Error marcando a reparto:', e);
      alert('No se pudo actualizar: ' + (e?.message || String(e)));
    } finally {
      setProcesandoId(null);
    }
  };

  // --- Interfaz de armado ---

  const abrirArmado = (p) => {
    setArmando(p);
    // "picked" es un check visual para ir tildando lo que ya se puso en el pedido;
    // arranca sin marcar cada vez que se abre el armado de este pedido.
    const activos = (p.items || []).map(i => ({ ...i, eliminado: false, picked: false, _key: nextKey() }));
    // Lo que se saco en una sesion de armado anterior sigue apareciendo, pero
    // tachado: si el armador lo encuentra despues, toca el tick y se restaura.
    const tachados = (p.armadoLog?.removidos || []).map(r => ({
      productoId: r.productoId, nombre: r.nombre, precio: r.precio, cantidad: r.cantidad,
      eliminado: true, picked: false, _key: nextKey(),
    }));
    setItemsArmado(sortItemsArmado([...activos, ...tachados]));
    setProductoQ('');
    setShowSugg(false);
  };

  const cerrarArmado = () => {
    setArmando(null);
    setItemsArmado([]);
    setProductoQ('');
    setShowSugg(false);
  };

  const productoSugg = productoQ.trim().length >= 1 ? searchProductos(productoQ, productos, 30) : [];

  const agregarProductoArmado = (prod) => {
    setItemsArmado(prev => {
      const existe = prev.find(i => i.productoId === prod.id && !i.eliminado);
      if (existe) {
        // AC-BUL-9: volver a tocar el producto cambia la cantidad => ya no es la unidad por defecto.
        return sortItemsArmado(prev.map(i => i._key === existe._key ? reprecio(quitarMarcasRenglon({ ...i, cantidad: i.cantidad + pasoCantidad(prod) })) : i));
      }
      // AC-BUL-9: el renglón arranca en 1 con la marca "cantidad por defecto".
      return sortItemsArmado([...prev, renglonNuevo(prod, { eliminado: false, picked: false, _key: nextKey() })]);
    });
    // La busqueda queda como esta para poder tocar varios productos seguidos;
    // se borra con la cruz del buscador.
  };

  // Tick verde: en un item activo, confirma que ya esta puesto en el pedido.
  // En un item tachado (lo habian sacado), lo restaura: vuelve a estar en el
  // pedido y, si hay una fusion posible con otra fila activa del mismo
  // producto, las junta para no dejar dos filas del mismo producto.
  const tocarTick = (key) => {
    setItemsArmado(prev => {
      const target = prev.find(i => i._key === key);
      if (!target) return prev;

      if (!target.eliminado) {
        return prev.map(i => i._key === key ? { ...i, picked: !i.picked } : i);
      }

      const otraActiva = prev.find(i => i.productoId === target.productoId && !i.eliminado && i._key !== key);
      // C3 / S-BUL-06: si la suma superaría MAX_CANTIDAD no se fusiona (queda
      // restaurado aparte; al guardar se avisa).
      if (otraActiva && sumarCantidades(otraActiva.cantidad, target.cantidad) !== null) {
        const sinTarget = prev.filter(i => i._key !== key);
        return sortItemsArmado(sinTarget.map(i =>
          i._key === otraActiva._key ? reprecio(quitarMarcasRenglon({ ...i, cantidad: sumarCantidades(i.cantidad, target.cantidad), picked: true })) : i
        ));
      }
      return sortItemsArmado(prev.map(i => i._key === key ? { ...i, eliminado: false, picked: true } : i));
    });
  };

  const cambiarCantidadArmado = (key, delta) => {
    setItemsArmado(prev => prev.map(i => {
      if (i._key !== key) return i;
      const prod = productoParaBulto(i, productosById);
      // AC-MIN-2: el armador no baja del mínimo (un renglón viejo que ya estaba más abajo no se sube solo).
      const piso = Math.min(i.cantidad, Math.max(pasoCantidad(prod), prod ? minimoEfectivo(prod) : 1));
      return reprecio(quitarMarcasRenglon({ ...i, cantidad: Math.max(piso, i.cantidad + delta) }));
    }));
  };

  // AC-BUL-2/3/9: suma o resta un bulto (bultoX actual), sin bajar de 1 como el "−".
  // Si el renglón tiene la unidad por defecto, el primer "+ Bulto" la reemplaza.
  const aplicarBultoArmado = (key, op) => {
    setItemsArmado(prev => prev.map(i => {
      if (i._key !== key || i.eliminado) return i;
      // C4 / S-BUL-08: misma resolución por id que Facturación (una sola fuente).
      const prodBulto = productoParaBulto(i, productosById);
      const bx = prodBulto?.bultoX;
      const minimo = Math.max(CANTIDAD_MINIMA_RENGLON, pasoCantidad(prodBulto), prodBulto ? minimoEfectivo(prodBulto) : 1);
      const cantidad = op === 'sumar'
        ? sumarBultoRenglon(i.cantidad, bx, { cantidadPorDefecto: i[MARCA_CANTIDAD_POR_DEFECTO] === true })
        : restarBulto(i.cantidad, bx, { minimo });
      return cantidad === i.cantidad ? i : reprecio(quitarMarcasRenglon({ ...i, cantidad }));
    }));
  };

  const setCantidadArmadoTexto = (key, texto) => {
    // C3 / S-BUL-06: entero en [1, MAX_CANTIDAD]; si no, queda la cantidad anterior.
    const n = cantidadTipeada(String(texto ?? '').replace(/[^\d]/g, ''));
    // AC-BUL-9: escribir la cantidad a mano (aunque sea 1) quita la marca.
    setItemsArmado(prev => prev.map(i =>
      i._key === key ? reprecio(quitarMarcasRenglon({ ...i, cantidad: n !== null ? n : i.cantidad })) : i
    ));
  };

  // No se borra de la lista: queda tachado por si despues aparece, y se anota
  // en Faltantes al guardar. Si se encuentra, se restaura con el tick verde.
  const eliminarItemArmado = (key) => {
    setItemsArmado(prev => prev.map(i =>
      i._key === key ? { ...i, eliminado: true, picked: false } : i
    ));
  };

  // AC-SST-1: aviso por renglón, nunca bloquea. Si el pedido ya está facturado, lo que
  // tenía ya se descontó del stock.
  const avisoStockDe = (item) => {
    const yaDescontado = String(armando?.estado) === 'facturado'
      ? (armando.items || []).filter(x => String(x?.productoId) === String(item.productoId)).reduce((a, x) => a + (Number(x.cantidad) || 0), 0)
      : 0;
    return avisoSinStock(item.cantidad, stockParaAviso(stockMap, item.productoId, yaDescontado));
  };
  // AC-MIN-2: error de mínimo en el renglón (el armador no puede guardar por debajo).
  const errorMinimoDe = (item) => {
    const r = validarMinimosItems([item], productosById, { permiso: permisoNorm, pantalla: 'armado', previos: armando?.items });
    return r.errores.length ? mensajeMinimo(r.errores[0].minimo) : null;
  };

  const totalArmado = itemsArmado.filter(i => !i.eliminado).reduce((acc, i) => acc + Number(i.cantidad) * Number(i.precio), 0);

  const guardarArmado = async (marcarTerminadoAlGuardar = false) => {
    if (!armando) return;
    setGuardandoArmado(true);
    try {
      // Los activos (no tachados) son los que quedan en el pedido. Si dos filas
      // terminan siendo del mismo producto (por ejemplo se restauro uno tachado
      // sin fusionar), se suman en una sola linea.
      // C3 / S-BUL-06: la suma usa sumarCantidades; si supera MAX_CANTIDAD (o
      // alguna parte es inválida) no se guarda y se avisa.
      const activosPorId = new Map();
      const sinFusionar = [];
      for (const i of itemsArmado) {
        if (i.eliminado) continue;
        const prev = activosPorId.get(i.productoId);
        if (prev) {
          const suma = sumarCantidades(prev.cantidad, Number(i.cantidad));
          if (suma === null) sinFusionar.push({ productoId: i.productoId, nombre: i.nombre, cantidad: prev.cantidad + Number(i.cantidad) });
          else prev.cantidad = suma;
        } else activosPorId.set(i.productoId, { ...i, cantidad: Number(i.cantidad) });
      }
      if (sinFusionar.length) {
        alert(mensajeCantidadesInvalidas(sinFusionar));
        return;
      }
      // AC-BUL-9: igual que _key/picked/eliminado, la marca transitoria no se guarda.
      const itemsFinal = quitarMarcasRenglones([...activosPorId.values()].map(({ picked, eliminado, _key, ...i }) => ({ ...i })));

      // AC-VTA-3: producto "solo bulto" con cantidad no múltiplo => no se guarda
      // desde Armado (tachar el renglón sigue disponible). Lo sin cambios no se valida.
      const vm = validarMultiplosItems(itemsFinal, productosById, { permiso: permisoNorm, pantalla: 'armado', previos: armando.items });
      if (vm.bloquea) {
        alert(`Hay cantidades que no son múltiplo del bulto: ${vm.avisos.map(a => `${a.nombre} (${a.cantidad} u., bulto x ${a.bultoX})`).join(', ')}`);
        return;
      }
      // AC-MIN-2: el armador no guarda por debajo del mínimo; si falta mercadería, tacha el renglón.
      const vmin = validarMinimosItems(itemsFinal, productosById, { permiso: permisoNorm, pantalla: 'armado', previos: armando.items });
      if (vmin.errores.length) {
        alert(`Hay productos por debajo del mínimo: ${vmin.errores.map(e => `${e.nombre} (mínimo ${e.minimo})`).join(', ')}. Si falta mercadería, sacalos con el tachito: quedan anotados como faltantes.`);
        return;
      }
      // AC-VTA-2: la cantidad queda en unidades; se congelan bultos/bultoX/bultoNombre.
      const itemsGuardar = congelarBultosItems(itemsFinal, productosById, { previos: armando.items });

      // Lo que el armador saco o redujo respecto del pedido original queda
      // registrado en Faltantes (misma logica que usa Facturacion al editar).
      // Esto solo mira "armando.items" (lo que ya estaba activo al abrir esta
      // sesion), asi que no vuelve a contar lo que ya estaba tachado de antes.
      await registrarFaltantes(armando, itemsFinal);

      // Si algo que estaba tachado (faltante de una sesion anterior) se
      // restauro ahora, ya no esta faltando: se borra el registro de Faltantes.
      const idsTachadosAntes = new Set((armando.armadoLog?.removidos || []).map(r => r.productoId));
      const idsTachadosAhora = new Set(itemsArmado.filter(i => i.eliminado).map(i => i.productoId));
      for (const productoId of idsTachadosAntes) {
        if (!idsTachadosAhora.has(productoId)) {
          await borrarFaltantesDeProducto(faltantes, armando, productoId);
        }
      }

      // Ademas guardamos un resumen en el propio pedido para que Facturacion
      // vea de un vistazo que confirmo el armador (tick verde) y que saco/redujo
      // (tachito), sin tener que cruzar con la pantalla de Faltantes. Los
      // tachados que sigan tachados despues de guardar quedan disponibles para
      // que la proxima vez que se abra "Armar pedido" se sigan mostrando.
      const confirmados = [...new Set(
        itemsArmado.filter(i => !i.eliminado && i.picked).map(i => i.productoId)
      )];
      const removidosPorId = new Map();
      for (const i of itemsArmado) {
        if (!i.eliminado) continue;
        const prev = removidosPorId.get(i.productoId);
        if (prev) prev.cantidad += Number(i.cantidad);
        else removidosPorId.set(i.productoId, { productoId: i.productoId, nombre: i.nombre, cantidad: Number(i.cantidad), precio: Number(i.precio) });
      }
      const removidos = [...removidosPorId.values()];
      // AC-BUL-7: el registro del armador refleja los cambios de cantidad
      // (acumulados con sesiones anteriores: antes original -> despues final).
      // S-BUL-03: se podan los productos que ya no quedan en el pedido.
      // S-BUL-05: el dominio acota cantidad de entradas y largo de nombre.
      const cambios = fusionarCambiosArmado(
        armando.armadoLog?.cambios,
        cambiosDeCantidad(armando.items, itemsFinal),
        { productosVigentes: itemsFinal.map(i => i.productoId) },
      );
      const armadoLog = { confirmados, removidos, cambios, at: Date.now(), por: vendedorActual?.nombre || '' };

      const total = itemsFinal.reduce((acc, i) => acc + Number(i.cantidad) * Number(i.precio), 0);
      let pedidoFinal = { ...armando, items: itemsGuardar, total, armadoLog };
      if (marcarTerminadoAlGuardar) {
        pedidoFinal = makePedidoArmado(pedidoFinal, true, vendedorActual?.nombre || '');
      }

      await guardarPedidoOnlineFirst(pedidoFinal);
      // Si el pedido ya estaba facturado, su deuda acompana el nuevo total.
      if (pedidoFinal.deudaGenerada) await actualizarMontoDeudaDePedido(pedidoFinal, pedidoFinal.total);
      await recargar();
      cerrarArmado();
    } catch (e) {
      console.error('Error guardando armado:', e);
      alert('No se pudo guardar: ' + (e?.message || String(e)));
    } finally {
      setGuardandoArmado(false);
    }
  };

  // --- Vista: armando un pedido especifico ---
  if (armando) {
    const armadoYa = isPedidoArmado(armando);
    const itemsTachados = itemsArmado.filter(i => i.eliminado);
    const itemsActivos = itemsArmado.filter(i => !i.eliminado);
    return (
      <div className="page">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <button className="btn-icon" onClick={cerrarArmado}>{'‹'}</button>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700 }}>Armar pedido</h2>
            <div style={{ fontSize: 13, color: 'var(--text3)' }}>
              {armando.clienteNombre} {'·'} {formatFecha(normalizePedidoFecha(armando.fecha))}
            </div>
          </div>
        </div>

        <div className="card" style={{ position: 'relative' }}>
          <label className="input-label">Agregar producto</label>
          <div style={{ position: 'relative' }}>
            <input
              className="input"
              value={productoQ}
              onChange={e => { setProductoQ(e.target.value); setShowSugg(true); }}
              onFocus={() => setShowSugg(true)}
              placeholder="Buscar producto..."
              autoComplete="off"
              style={{ fontSize: 16, paddingRight: 44 }}
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
          </div>
          {showSugg && productoSugg.length > 0 && (
            <div className="suggestions">
              {productoSugg.map(prod => (
                <div key={prod.id} className="suggestion-item" onClick={() => agregarProductoArmado(prod)}>
                  <div>
                    <div>{prod.nombre}</div>
                    <div className="suggestion-sub">{prod.codigo || ''}</div>
                  </div>
                  <span style={{ color: 'var(--success)', fontWeight: 600, textAlign: 'right' }}>
                    {(() => {
                      const ya = itemsArmado.find(i => i.productoId === prod.id && !i.eliminado);
                      return ya ? <span style={{ marginRight: 8 }}>{'\u2713'} x{ya.cantidad}</span> : null;
                    })()}
                    ${prod.precio?.toLocaleString('es-AR')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ fontSize: 12, color: 'var(--text3)', margin: '4px 2px 10px' }}>
          Orden inverso al de la boleta (para recorrer el deposito al reves) {'·'} {itemsArmado.length} producto{itemsArmado.length !== 1 ? 's' : ''}
        </div>

        {itemsArmado.length === 0 && (
          <div className="empty-state">
            <div className="empty-icon">{'\u{1F4E6}'}</div>
            <div className="empty-text">Sin productos en este pedido</div>
          </div>
        )}

        {/* Los tachados (faltantes pendientes) van siempre arriba de todo, para
            que el armador los vea primero y los pueda restaurar si aparecieron. */}
        {itemsTachados.length > 0 && (
          <>
            <div style={{
              fontSize: 12, fontWeight: 700, color: 'var(--danger)',
              textTransform: 'uppercase', letterSpacing: '0.5px',
              margin: '4px 2px 8px',
            }}>
              {'⚠️'} Marcados como faltantes ({itemsTachados.length})
            </div>
            {itemsTachados.map(item => (
              <ItemArmadoCard key={item._key} item={item} producto={productoParaBulto(item, productosById)} puedeBulto={puedeBulto} avisoStock={avisoStockDe(item)} errorMinimo={errorMinimoDe(item)} onBulto={aplicarBultoArmado} onTick={tocarTick} onCantidad={cambiarCantidadArmado} onCantidadTexto={setCantidadArmadoTexto} onEliminar={eliminarItemArmado} />
            ))}
            <div style={{ height: 6 }} />
          </>
        )}

        {itemsActivos.map(item => (
          <ItemArmadoCard key={item._key} item={item} producto={productoParaBulto(item, productosById)} puedeBulto={puedeBulto} avisoStock={avisoStockDe(item)} errorMinimo={errorMinimoDe(item)} onBulto={aplicarBultoArmado} onTick={tocarTick} onCantidad={cambiarCantidadArmado} onCantidadTexto={setCantidadArmadoTexto} onEliminar={eliminarItemArmado} />
        ))}

        <div className="total-row">
          <span className="total-label">Total</span>
          <span className="total-value">${totalArmado.toLocaleString('es-AR')}</span>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 16, marginBottom: 10 }}>
          <button className="btn btn-ghost" onClick={cerrarArmado} disabled={guardandoArmado}>Cancelar</button>
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => guardarArmado(false)} disabled={guardandoArmado}>
            {guardandoArmado ? 'Guardando...' : '✓ Guardar cambios'}
          </button>
        </div>
        <button
          className="btn btn-success"
          style={{ marginBottom: 80 }}
          onClick={() => guardarArmado(true)}
          disabled={guardandoArmado || armadoYa}
        >
          {armadoYa ? 'Ya esta marcado como terminado' : (guardandoArmado ? 'Guardando...' : '✓ Guardar y marcar pedido terminado')}
        </button>
      </div>
    );
  }

  // --- Vista: lista de pedidos del dia ---
  return (
    <div className="page">
      <h1 className="page-title">Armado</h1>

      <div className="card" style={{ padding: '12px 14px' }}>
        <label className="input-label">Fecha</label>
        <input
          type="date"
          className="input"
          value={filtroFecha}
          onChange={e => setFiltroFecha(e.target.value)}
          style={{ marginBottom: 10 }}
        />

        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
          {FILTROS.map(f => (
            <button
              key={f.id}
              className={`btn btn-sm ${filtroArmado === f.id ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setFiltroArmado(f.id)}
              style={{ whiteSpace: 'nowrap', flex: 'none' }}
            >
              {f.label}
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
          {modoSeleccion && (
            <button
              className="btn btn-primary btn-sm"
              style={{ width: 'auto' }}
              onClick={imprimirSeleccion}
              disabled={seleccion.size === 0 || imprimiendoSeleccion}
            >
              {imprimiendoSeleccion ? 'Generando...' : `\u{1F5A8}️ Imprimir (${seleccion.size})`}
            </button>
          )}
          <button
            className="btn btn-ghost btn-sm"
            style={{ width: 'auto' }}
            onClick={abrirListaClientes}
          >
            {'\u{1F4CB}'} Imprimir lista de clientes
          </button>
        </div>

        {mostrarListaClientes && (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--bg3)' }}>
            <label className="input-label">Dias a incluir</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
              {diasListaClientes.length === 0 && (
                <span style={{ fontSize: 12, color: 'var(--text3)' }}>Agrega al menos un dia</span>
              )}
              {diasListaClientes.map(f => (
                <span
                  key={f}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    background: 'var(--bg4)', border: '1px solid var(--border)',
                    borderRadius: 8, padding: '4px 8px', fontSize: 13,
                  }}
                >
                  {formatFecha(f)}
                  <button
                    className="btn-icon"
                    style={{ width: 18, height: 18, fontSize: 12, background: 'none', border: 'none' }}
                    onClick={() => quitarDiaLista(f)}
                  >×</button>
                </span>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <input
                type="date"
                className="input"
                value={nuevoDiaLista}
                onChange={e => setNuevoDiaLista(e.target.value)}
                style={{ flex: 1 }}
              />
              <button className="btn btn-ghost btn-sm" style={{ width: 'auto' }} onClick={agregarDiaLista}>
                + Agregar dia
              </button>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-ghost" onClick={() => setMostrarListaClientes(false)} disabled={generandoListaClientes}>
                Cancelar
              </button>
              <button
                className="btn btn-primary"
                style={{ flex: 1 }}
                onClick={imprimirListaClientes}
                disabled={diasListaClientes.length === 0 || generandoListaClientes}
              >
                {generandoListaClientes ? 'Generando...' : `\u{1F5A8}️ Imprimir lista`}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="stats-grid" style={{ marginBottom: 12 }}>
        <div className="stat-card">
          <div className="stat-value">{filtrados.length}</div>
          <div className="stat-label">En este filtro</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ fontSize: 18 }}>{totalSinArmar}</div>
          <div className="stat-label">Sin armar (dia)</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ fontSize: 18, color: 'var(--accent)' }}>{totalAReparto}</div>
          <div className="stat-label">A reparto (dia)</div>
        </div>
      </div>

      {filtrados.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">{'\u{1F4E6}'}</div>
          <div className="empty-text">Sin pedidos para el filtro</div>
        </div>
      ) : (
        filtrados.map(p => {
          const armadoFlag = isPedidoArmado(p);
          const repartoFlag = isPedidoAReparto(p);
          return (
            <div
              key={p.id}
              className="card"
              style={{ marginBottom: 10, cursor: modoSeleccion ? 'pointer' : undefined }}
              onClick={modoSeleccion ? () => toggleSel(p.id) : undefined}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  {modoSeleccion && (
                    <input
                      type="checkbox"
                      checked={seleccion.has(p.id)}
                      readOnly
                      style={{ marginTop: 4 }}
                    />
                  )}
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 16 }}>{p.clienteNombre}</div>
                    <div style={{ fontSize: 12, color: 'var(--text3)' }}>
                      {p.vendedorNombre} {'·'} {formatFecha(normalizePedidoFecha(p.fecha))}
                    </div>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 700, color: 'var(--success)', fontSize: 16 }}>
                    ${(p.total || 0).toLocaleString('es-AR')}
                  </div>
                  <span
                    className={`badge ${repartoFlag ? 'badge-reparto' : armadoFlag ? 'badge-facturado' : 'badge-pending'}`}
                    title={repartoFlag && p.aRepartoPor ? `A reparto por ${p.aRepartoPor}` : (armadoFlag && p.armadoPor ? `Armado por ${p.armadoPor}` : undefined)}
                  >
                    {repartoFlag ? '🚚 A reparto' : armadoFlag ? 'Armado' : 'Sin armar'}
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ flex: 1 }}
                  onClick={(e) => { e.stopPropagation(); abrirArmado(p); }}
                >
                  {'\u{1F4E6}'} Armar pedido
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ flex: 1 }}
                  onClick={(e) => { e.stopPropagation(); imprimir(p); }}
                >
                  {'\u{1F5A8}️'} Imprimir
                </button>
                {!armadoFlag ? (
                  <button
                    className="btn btn-primary btn-sm"
                    style={{ flex: 1 }}
                    disabled={procesandoId === p.id}
                    onClick={(e) => { e.stopPropagation(); marcarArmado(p, true); }}
                  >
                    {procesandoId === p.id ? 'Guardando...' : '✓ Pedido terminado'}
                  </button>
                ) : (
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ flex: 1, color: 'var(--warning)', borderColor: 'var(--warning)' }}
                    disabled={procesandoId === p.id}
                    onClick={(e) => { e.stopPropagation(); marcarArmado(p, false); }}
                  >
                    {procesandoId === p.id ? 'Guardando...' : 'Deshacer'}
                  </button>
                )}
              </div>

              {/* Ultima verificacion antes de que salga a entregar: solo tiene sentido una vez armado. */}
              {armadoFlag && (
                <div style={{ marginTop: 8 }}>
                  {!repartoFlag ? (
                    <button
                      className="btn"
                      style={{ background: 'var(--accent)', color: '#fff' }}
                      disabled={procesandoId === p.id}
                      onClick={(e) => { e.stopPropagation(); marcarReparto(p, true); }}
                    >
                      {procesandoId === p.id ? 'Guardando...' : `\u{1F69A} Marcar a reparto`}
                    </button>
                  ) : (
                    <button
                      className="btn btn-ghost"
                      style={{ color: 'var(--accent)', borderColor: 'var(--accent)' }}
                      disabled={procesandoId === p.id}
                      onClick={(e) => { e.stopPropagation(); marcarReparto(p, false); }}
                    >
                      {procesandoId === p.id ? 'Guardando...' : '🚚 En reparto — Sacar'}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
};

export default Armado;
