// src/pages/NuevoPedido.js
import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useApp } from '../hooks/useAppContext';
import { fuzzySearch, getTodayStr, formatFecha, searchProductos } from '../utils/fuzzy';
import { addCliente, updateCliente } from '../db';
import { direccionExacta, mensajeDireccion } from '../domain/direccion';
import { crearPedidoOnlineFirst } from '../services/pedidoRepository';
import { normalizePedidoFecha } from '../utils/pedidos';
import { avisoSinStock, stockParaAviso } from '../domain/stock';
import { precioAplicadoRenglon, esPrecioManual, precioBaseRenglon } from '../domain/precios';
import { validarMinimosItems, mensajeMinimo } from '../domain/minimos';
import { sumarBultoRenglon, restarBulto, puedeUsarBulto, CANTIDAD_MINIMA_RENGLON, MARCA_CANTIDAD_POR_DEFECTO, renglonNuevo, quitarMarcasRenglon, quitarMarcasRenglones, cantidadTipeada, validarCantidadesItems, mensajeCantidadesInvalidas } from '../domain/bultos';
import BultoControl from '../components/BultoControl';
import { pasoCantidad, avisoMultiplo, validarMultiplosItems, congelarBultosItems, congelarBultosRenglon, textoRenglonBultos, precioBulto, ventaPorEfectivo, normalizarBultoNombre } from '../domain/unidadVenta';

const Toast = ({ msg, type, onClose }) => {
  useEffect(() => { const t = setTimeout(onClose, 2500); return () => clearTimeout(t); }, [onClose]);
  return <div className={`toast toast-${type}`}>{msg}</div>;
};

const DRAFT_VERSION = 1;

const getDraftKey = (vendedor) =>
  `nuevoPedidoDraft:${vendedor?.remoteId || vendedor?.id || vendedor?.nombre || 'default'}`;

const readDraft = (key) => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.version !== DRAFT_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
};

const hasDraftContent = (draft) =>
  !!String(draft?.clienteQ || draft?.clienteNombre || draft?.productoQ || draft?.observaciones || '').trim() ||
  (draft?.items || []).length > 0;

// Componente separado con estado local para los inputs — evita borrar el item al vaciar el campo
const ItemRow = ({ item, producto, puedeBulto = false, avisos = [], errorMinimo = null, canEditPrecio, onCambiarCantidad, onSetCantidad, onSetPrecio, onSetDescuentoPct, onEliminar, onBulto }) => {
  const [cantidadText, setCantidadText] = useState(String(item.cantidad));
  const [precioText, setPrecioText] = useState(String(item.precio));

  // Sincronizar texto cuando cambia desde los botones +/-
  useEffect(() => { setCantidadText(String(item.cantidad)); }, [item.cantidad]);
  // AC-PBU-3: al subir/bajar del bulto el precio cambia solo; el campo lo refleja
  // (sin pisar lo que se está tipeando).
  useEffect(() => {
    setPrecioText(prev => (parseFloat(String(prev).replace(',', '.')) === item.precio ? prev : String(item.precio)));
  }, [item.precio]);

  const handleCantidadChange = (e) => {
    const val = e.target.value;
    setCantidadText(val);
    // C3 / S-BUL-06: solo se toma un entero en [1, MAX_CANTIDAD]. Con otro
    // texto (vacío, 0, decimal, > tope) la cantidad queda la anterior.
    const n = cantidadTipeada(val);
    if (n !== null) onSetCantidad(item.productoId, n);
    // Si el campo está vacío, NO eliminamos — esperamos que el usuario termine de escribir
  };

  const handleCantidadBlur = () => {
    const n = cantidadTipeada(cantidadText);
    if (n !== null) {
      setCantidadText(String(n));
    } else if (parseInt(cantidadText, 10) > 0) {
      // C3: texto no vacío pero inválido (p. ej. > MAX_CANTIDAD): se vuelve a
      // la última cantidad válida.
      setCantidadText(String(item.cantidad));
    } else {
      // Al salir del campo vacío, restablecer a 1 en lugar de eliminar
      setCantidadText('1');
      onSetCantidad(item.productoId, 1);
    }
  };

  const handlePrecioChange = (e) => {
    const val = e.target.value;
    setPrecioText(val);
    const n = parseFloat(val.replace(',', '.'));
    if (!isNaN(n) && n >= 0) onSetPrecio(item.productoId, n);
  };

  const handlePrecioBlur = () => {
    const n = parseFloat(precioText.replace(',', '.'));
    if (isNaN(n) || n < 0) {
      setPrecioText(String(item.precio));
    } else {
      setPrecioText(String(n));
      onSetPrecio(item.productoId, n);
    }
  };

  const aplicarDescuentoPct = () => {
    if (!canEditPrecio) return;
    const val = window.prompt('Descuento % para este producto (0-100)', String(item.descuentoPct ?? ''));
    if (val == null) return;
    const n = parseFloat(String(val).replace(',', '.'));
    if (isNaN(n) || n < 0 || n > 100) {
      alert('Porcentaje inválido (0-100).');
      return;
    }
    onSetDescuentoPct(item.productoId, n);
  };

  // REQ-VTA (AC-VTA-2/3): paso de +/− por bulto, aviso de no múltiplo y texto "3 Display (48 u.)".
  const paso = pasoCantidad(producto);
  const avisoVenta = avisoMultiplo(item.cantidad, producto);
  const textoBultos = textoRenglonBultos(congelarBultosRenglon(item, producto));
  const precioDelBulto = ventaPorEfectivo(producto) !== 'unidad' ? precioBulto(item.precio, producto?.bultoX) : null;
  const precioModificado = item.precioOriginal !== undefined && esPrecioManual(item);
  const subtotal = item.cantidad * item.precio;

  return (
    <div className="item-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8, paddingTop: 12, paddingBottom: 12 }}>
      {/* Nombre + botón eliminar */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div className="item-nombre" style={{ fontWeight: 600 }}>{item.nombre}</div>
          {avisos.length > 0 && (
            <div data-testid="aviso-stock" style={{ fontSize: 10, color: 'var(--warning)', marginTop: 2 }}>
              {'\u26A0\uFE0F'} {avisos.join(' · ')}
            </div>
          )}
          {errorMinimo && (
            <div data-testid="error-minimo" role="alert" style={{ fontSize: 11, color: 'var(--danger)', marginTop: 2 }}>
              {'⛔'} {errorMinimo}
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
                ? `✂ Descuento ${item.descuentoPct}% · precio original $${item.precioOriginal?.toLocaleString('es-AR')}`
                : `✂ Precio modificado · original $${item.precioOriginal?.toLocaleString('es-AR')}`}
            </div>
          )}
        </div>
        <button
          className="btn-icon"
          style={{ color: 'var(--danger)', borderColor: 'transparent', flexShrink: 0 }}
          onMouseDown={() => onEliminar(item.productoId)}
        >×</button>
      </div>

      {/* Precio × Cantidad = Subtotal */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {/* Precio editable */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <span style={{ fontSize: 12, color: 'var(--text3)' }}>$</span>
          <input
            className="qty-input"
            type="number"
            value={precioText}
            onChange={handlePrecioChange}
            onBlur={handlePrecioBlur}
            disabled={!canEditPrecio}
            style={{
              width: 70, fontSize: 13,
              color: precioModificado ? 'var(--warning)' : 'var(--text)',
              borderColor: precioModificado ? 'var(--warning)' : undefined,
            }}
            min="0"
            step="1"
            title="Tocá para cambiar el precio (descuento en este pedido)"
          />
          <button
            className="btn-icon"
            style={{ width: 28, height: 28, fontSize: 13, opacity: canEditPrecio ? 1 : 0.4 }}
            onMouseDown={(e) => { e.preventDefault(); aplicarDescuentoPct(); }}
            title="Aplicar descuento %"
            disabled={!canEditPrecio}
          >
            %
          </button>
        </div>

        <span style={{ fontSize: 13, color: 'var(--text3)' }}>×</span>

        {/* Cantidad */}
        <div className="qty-control">
          <button className="qty-btn" onMouseDown={() => {
            const nueva = Math.max(paso, item.cantidad - paso);
            onCambiarCantidad(item.productoId, -paso, paso);
            setCantidadText(String(nueva));
          }}>−</button>
          <input
            className="qty-input"
            type="number"
            value={cantidadText}
            onChange={handleCantidadChange}
            onBlur={handleCantidadBlur}
            min="1"
            inputMode="numeric"
          />
          <button className="qty-btn" onMouseDown={() => {
            onCambiarCantidad(item.productoId, paso, null);
            setCantidadText(String(item.cantidad + paso));
          }}>+</button>
        </div>

        <span style={{ fontSize: 13, color: 'var(--text3)' }}>=</span>
        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--success)' }}>
          ${subtotal.toLocaleString('es-AR')}
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
    </div>
  );
};

const NuevoPedido = () => {
  const { productos, clientes, vendedores, vendedorActual, zonaActiva, setZona, recargar, stockMap } = useApp();
  const productosById = useMemo(() => new Map((productos || []).map(p => [String(p.id), p])), [productos]);
  const permisoNorm = Number(vendedorActual?.permiso || 2);
  const isAdmin = permisoNorm === 1;
  const puedeBulto = puedeUsarBulto(permisoNorm, 'pedido'); // AC-BUL-8
  const zonaLocked = isAdmin ? null : (vendedorActual?.zona || '');
  const zonaPedido = isAdmin ? (zonaActiva || '') : (zonaLocked || '');
  const draftKey = getDraftKey(vendedorActual);
  const draftInicial = useMemo(() => readDraft(draftKey), [draftKey]);
  const [fecha, setFecha] = useState(() => draftInicial?.fecha || getTodayStr());
  const [clienteQ, setClienteQ] = useState(() => draftInicial?.clienteQ || '');
  const [clienteId, setClienteId] = useState(() => draftInicial?.clienteId || null);
  const [clienteNombre, setClienteNombre] = useState(() => draftInicial?.clienteNombre || '');
  const [direccion, setDireccion] = useState(() => draftInicial?.direccion || '');
  const dirOk = direccionExacta(direccion);
  const errorDir = !dirOk.ok && direccion.trim() !== '' ? mensajeDireccion(dirOk.motivo) : '';
  const [productoQ, setProductoQ] = useState(() => draftInicial?.productoQ || '');
  const [items, setItems] = useState(() => Array.isArray(draftInicial?.items) ? draftInicial.items : []);
  const [observaciones, setObservaciones] = useState(() => draftInicial?.observaciones || '');
  const [toast, setToast] = useState(null);
  const [showClienteSugg, setShowClienteSugg] = useState(false);
  const [showProductoSugg, setShowProductoSugg] = useState(false);
  const productoRef = useRef(null);

  useEffect(() => {
    const draft = {
      version: DRAFT_VERSION,
      fecha: normalizePedidoFecha(fecha),
      clienteQ,
      clienteId,
      clienteNombre,
      direccion,
      productoQ,
      items,
      observaciones,
      updatedAt: Date.now(),
    };

    if (hasDraftContent(draft)) {
      localStorage.setItem(draftKey, JSON.stringify(draft));
    } else {
      localStorage.removeItem(draftKey);
    }
  }, [draftKey, fecha, clienteQ, clienteId, clienteNombre, direccion, productoQ, items, observaciones]);

  const clienteSugg = clienteQ.length >= 1 ? fuzzySearch(clienteQ, clientes, 'nombre', 5) : [];
  const productoLimit = productoQ.trim().length < 2 ? 40 : 120;
  const productoSugg = productoQ.length >= 1 ? searchProductos(productoQ, productos, productoLimit) : [];

  const seleccionarCliente = (c) => {
    setClienteId(c.id);
    setClienteNombre(c.nombre);
    setClienteQ(c.nombre);
    setDireccion(c.direccion || '');
    setShowClienteSugg(false);
  };

  const agregarProducto = useCallback((p) => {
    setItems(prev => {
      const existe = prev.find(i => i.productoId === p.id);
      if (existe) {
        // AC-BUL-9: volver a tocar el producto cambia la cantidad => ya no es la unidad por defecto.
        const next = prev.map(i => i.productoId === p.id ? quitarMarcasRenglon({ ...i, cantidad: i.cantidad + pasoCantidad(p) }) : i);
        const idx = next.findIndex(i => i.productoId === p.id);
        if (idx <= 0) return next;
        const it = next[idx];
        return [it, ...next.slice(0, idx), ...next.slice(idx + 1)];
      }
      // AC-BUL-9: el renglón arranca en 1 con la marca "cantidad por defecto".
      return [renglonNuevo(p), ...prev];
    });
    // La busqueda queda como esta para poder tocar varios productos seguidos;
    // se borra con la cruz del buscador.
  }, []);

  // AC-PBU-3: toda cantidad nueva re-precia el renglón (precio por bulto) salvo precio manual.
  const conCantidad = (i, cantidad) => precioAplicadoRenglon(quitarMarcasRenglon({ ...i, cantidad }), cantidad);

  const cambiarCantidad = (productoId, delta, minVal) => {
    setItems(prev => prev.map(i =>
      i.productoId === productoId
        ? conCantidad(i, Math.max(minVal !== null ? minVal : 1, i.cantidad + delta))
        : i
    ));
  };

  const setCantidad = (productoId, n) => {
    setItems(prev => prev.map(i =>
      // AC-BUL-9: cantidad escrita a mano (aunque sea 1) => se quita la marca.
      i.productoId === productoId ? conCantidad(i, n) : i
    ));
  };

  // AC-BUL-2/3/9: suma o resta un bulto con el bultoX ACTUAL del producto.
  // Si el renglón tiene la unidad por defecto, el primer "+ Bulto" la reemplaza.
  // Updater funcional para que toques rápidos no usen un estado viejo.
  const aplicarBulto = (productoId, op) => {
    const prod = productosById.get(String(productoId));
    const bx = prod?.bultoX;
    const minimo = Math.max(CANTIDAD_MINIMA_RENGLON, pasoCantidad(prod));
    setItems(prev => prev.map(i => {
      if (i.productoId !== productoId) return i;
      const cantidad = op === 'sumar'
        ? sumarBultoRenglon(i.cantidad, bx, { cantidadPorDefecto: i[MARCA_CANTIDAD_POR_DEFECTO] === true })
        : restarBulto(i.cantidad, bx, { minimo });
      return cantidad === i.cantidad ? i : conCantidad(i, cantidad);
    }));
  };

  const setPrecio = (productoId, precio) => {
    setItems(prev => prev.map(i =>
      i.productoId === productoId ? { ...i, precio, descuentoPct: null, precioManual: true } : i
    ));
  };

  const setDescuentoPct = (productoId, pct) => {
    setItems(prev => prev.map(i => {
      if (i.productoId !== productoId) return i;
      const base = precioBaseRenglon(i);
      const p = Math.max(0, Math.min(100, Number(pct) || 0));
      const nuevoPrecio = Math.round((base * (1 - p / 100)) * 100) / 100;
      return { ...i, descuentoPct: p, precio: nuevoPrecio, precioManual: p > 0 };
    }));
  };

  const eliminarItem = (productoId) => {
    setItems(prev => prev.filter(i => i.productoId !== productoId));
  };

  const total = items.reduce((acc, i) => acc + i.cantidad * i.precio, 0);

  // AC-MIN-1: renglones por debajo del mínimo (error en el renglón; no se guarda).
  const erroresMinimo = useMemo(() => {
    const r = validarMinimosItems(items, productosById, { permiso: permisoNorm, pantalla: 'nuevoPedido' });
    return new Map(r.errores.map(e => [String(e.productoId), e.minimo]));
  }, [items, productosById, permisoNorm]);

  const guardar = async () => {
    if (!clienteNombre.trim()) { setToast({ msg: 'Ingresá el nombre del cliente', type: 'error' }); return; }
    if (items.length === 0) { setToast({ msg: 'Agregá al menos un producto', type: 'error' }); return; }
    // C3 / S-BUL-06 (AC-SEC-2): defensa en profundidad antes de guardar
    // (y antes de cualquier efecto, como dar de alta el cliente).
    if (erroresMinimo.size > 0) {
      setToast({ msg: `Hay productos por debajo del mínimo: ${[...erroresMinimo.keys()].map(k => items.find(i => String(i.productoId) === k)?.nombre).filter(Boolean).join(', ')}`, type: 'error' });
      return;
    }
    const vc = validarCantidadesItems(items);
    if (!vc.ok) { alert(mensajeCantidadesInvalidas(vc.errores)); return; }
    // AC-VTA-3: producto "solo bulto" con cantidad que no es múltiplo => no se guarda desde acá.
    const vm = validarMultiplosItems(items, productosById, { permiso: permisoNorm, pantalla: 'pedido' });
    if (vm.bloquea) {
      alert(`Hay cantidades que no son múltiplo del bulto: ${vm.avisos.map(a => `${a.nombre} (${a.cantidad} u., bulto x ${a.bultoX})`).join(', ')}`);
      return;
    }

    // Si el cliente no existe en el maestro, guardarlo para que aparezca en sugerencias otro dia.
    const nombreFinal = clienteNombre.trim();
    // REQ-DIR (S1): la dirección de entrega vive en el cliente; defensa en profundidad.
    const dirFinal = direccionExacta(direccion);
    if (!dirFinal.ok) { setToast({ msg: mensajeDireccion(dirFinal.motivo), type: 'error' }); return; }
    let finalClienteId = clienteId || null;
    const norm = (s) => String(s || '').trim().toLowerCase();
    const existente = finalClienteId
      ? (clientes || []).find(c => c.id === finalClienteId)
      : (clientes || []).find(c => norm(c?.nombre) === norm(nombreFinal));
    if (existente && String(existente.direccion || '').trim() !== dirFinal.valor) {
      try { await updateCliente({ ...existente, direccion: dirFinal.valor }); } catch (e) { console.warn('No se pudo actualizar la dirección del cliente:', e?.message || String(e)); }
    }
    if (!finalClienteId) {
      if (existente) {
        finalClienteId = existente.id;
      } else {
        try {
          finalClienteId = await addCliente({
            nombre: nombreFinal,
            direccion: dirFinal.valor,
            telefono: '',
            alias: '',
          });
        } catch (e) {
          console.warn('No se pudo guardar cliente en maestro:', e?.message || String(e));
          finalClienteId = null; // igual permitimos guardar el pedido solo con clienteNombre
        }
      }
    }

    await crearPedidoOnlineFirst({
      fecha,
      clienteId: finalClienteId,
      clienteNombre: nombreFinal,
      vendedorId: vendedorActual.id,
      vendedorNombre: vendedorActual.nombre,
      zona: zonaPedido || '',
      // AC-BUL-9: la marca transitoria no se guarda ni se sincroniza.
      // AC-VTA-2: la cantidad sigue en unidades; se congelan bultos/bultoX/bultoNombre.
      items: congelarBultosItems(quitarMarcasRenglones(items), productosById, { previos: [] }),
      total,
      observaciones,
      estado: 'pendiente',
    });

    await recargar();
    localStorage.removeItem(draftKey);
    setItems([]);
    setClienteQ('');
    setClienteId(null);
    setClienteNombre('');
    setDireccion('');
    setProductoQ('');
    setObservaciones('');
    setFecha(getTodayStr());
    setToast({ msg: '✓ Pedido guardado correctamente', type: 'success' });
  };

  return (
    <div className="page">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 className="page-title" style={{ margin: 0 }}>Nuevo Pedido</h1>
        <span style={{ fontSize: 13, color: 'var(--text3)' }}>{formatFecha(fecha)}</span>
      </div>

      {isAdmin && (
        <div className="card">
          <label className="input-label">Zona</label>
          <select className="input" value={zonaPedido} onChange={e => setZona(e.target.value)}>
            <option value="">(Sin zona)</option>
            {[...new Set((vendedores || []).map(v => v.zona).filter(Boolean))].sort().map(z => (
              <option key={z} value={z}>{z}</option>
            ))}
          </select>
        </div>
      )}

      {/* PRODUCTO */}
      <div className="card">
        <label className="input-label">🔍 Buscar producto</label>
        <div className="autocomplete-wrap">
          <input
            ref={productoRef}
            className="input"
            value={productoQ}
            onChange={e => { setProductoQ(e.target.value); setShowProductoSugg(true); }}
            onFocus={() => setShowProductoSugg(true)}
            onBlur={() => setTimeout(() => setShowProductoSugg(false), 150)}
            placeholder="Ej: 9 de oro, coca, agua..."
            autoComplete="off"
            style={{ paddingRight: 44 }}
          />
          {productoQ && (
            <button
              type="button"
              aria-label="Borrar busqueda"
              onMouseDown={(e) => { e.preventDefault(); setProductoQ(''); setShowProductoSugg(false); productoRef.current?.focus(); }}
              style={{
                position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
                width: 32, height: 32, borderRadius: '50%', border: 'none',
                background: 'var(--bg4)', color: 'var(--text2)', fontSize: 16, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >{'\u2715'}</button>
          )}
          {showProductoSugg && productoSugg.length > 0 && (
            <div className="suggestions">
              {productoSugg.map(p => (
                <div key={p.id} className="suggestion-item" onMouseDown={(e) => { e.preventDefault(); agregarProducto(p); }}>
                  <div>
                    <div>{p.nombre}</div>
                    <div className="suggestion-sub">{p.codigo || ''}</div>
                  </div>
                  <span style={{ color: 'var(--success)', fontWeight: 600, textAlign: 'right' }}>
                    {(() => {
                      const ya = items.find(i => i.productoId === p.id);
                      return ya ? <span style={{ marginRight: 8 }}>{'\u2713'} x{ya.cantidad}</span> : null;
                    })()}
                    ${p.precio?.toLocaleString('es-AR')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Items del pedido */}
        {items.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 4, fontStyle: 'italic' }}>
              Tocá el precio ($) para aplicar un descuento en este pedido
            </div>
            {items.map(item => (
              <ItemRow
                key={item.productoId}
                item={item}
                producto={productosById.get(String(item.productoId))}
                puedeBulto={puedeBulto}
                onBulto={aplicarBulto}
                avisos={[avisoSinStock(item.cantidad, stockParaAviso(stockMap, item.productoId))].filter(Boolean)}
                errorMinimo={erroresMinimo.has(String(item.productoId)) ? mensajeMinimo(erroresMinimo.get(String(item.productoId))) : null}
                canEditPrecio={isAdmin}
                onCambiarCantidad={cambiarCantidad}
                onSetCantidad={setCantidad}
                onSetPrecio={setPrecio}
                onSetDescuentoPct={setDescuentoPct}
                onEliminar={eliminarItem}
              />
            ))}
            <div className="total-row">
              <span className="total-label">Total del pedido</span>
              <span className="total-value">${total.toLocaleString('es-AR')}</span>
            </div>
          </div>
        )}
      </div>

      {/* CLIENTE */}
      <div className="card">
        <label className="input-label">👤 Cliente</label>
        <div className="autocomplete-wrap">
          <input
            className="input"
            value={clienteQ}
            onChange={e => {
              setClienteQ(e.target.value);
              setClienteNombre(e.target.value);
              setClienteId(null);
              setDireccion('');
              setShowClienteSugg(true);
            }}
            onFocus={() => setShowClienteSugg(true)}
            onBlur={() => setTimeout(() => setShowClienteSugg(false), 150)}
            placeholder="Nombre del cliente..."
            autoComplete="off"
          />
          {showClienteSugg && clienteSugg.length > 0 && (
            <div className="suggestions">
              {clienteSugg.map(c => (
                <div key={c.id} className="suggestion-item" onMouseDown={() => seleccionarCliente(c)}>
                  <div>
                    <div>{c.nombre}</div>
                    <div className="suggestion-sub">{c.direccion || ''}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* REQ-DIR (AC-DIR-1): dirección de entrega obligatoria y exacta (calle y número). */}
        <div style={{ marginTop: 12 }}>
          <label className="input-label" htmlFor="np-direccion">📍 Dirección de entrega *</label>
          <input
            id="np-direccion"
            className="input"
            value={direccion}
            onChange={e => setDireccion(e.target.value)}
            placeholder="Ej: Av. Siempreviva 742"
            autoComplete="off"
            aria-invalid={errorDir ? true : undefined}
            aria-describedby={errorDir ? 'np-direccion-error' : undefined}
          />
          {errorDir && <div id="np-direccion-error" role="alert" data-testid="error-direccion" style={{ color: 'var(--red, #c0392b)', fontSize: 13, marginTop: 4 }}>{errorDir}</div>}
        </div>

        <div style={{ marginTop: 12 }}>
          <label className="input-label">📅 Fecha del pedido</label>
          <input type="date" className="input" value={fecha} onChange={e => setFecha(e.target.value)} />
        </div>
      </div>

      {/* OBSERVACIONES */}
      <div className="card">
        <label className="input-label">📝 Observaciones (opcional)</label>
        <textarea
          className="input" rows={2} value={observaciones}
          onChange={e => setObservaciones(e.target.value)}
          placeholder="Ej: entregar a la tarde, puerta trasera..."
          style={{ resize: 'none' }}
        />
      </div>

      <button className="btn btn-primary" onClick={guardar} disabled={!dirOk.ok} style={{ marginTop: 4, marginBottom: 80 }}>
        ✓ Guardar Pedido
      </button>

      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
};

export default NuevoPedido;
