// src/pages/NuevoPedido.js
import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useApp } from '../hooks/useAppContext';
import { fuzzySearch, getTodayStr, formatFecha, searchProductos } from '../utils/fuzzy';
import { addCliente } from '../db';
import { crearPedidoOnlineFirst } from '../services/pedidoRepository';
import { normalizePedidoFecha } from '../utils/pedidos';
import { avisosItemPedido } from '../domain/productos';
import { stockDe } from '../domain/stock';
import { sumarBultoRenglon, restarBulto, puedeUsarBulto, CANTIDAD_MINIMA_RENGLON, MARCA_CANTIDAD_POR_DEFECTO, renglonNuevo, quitarMarcasRenglon, quitarMarcasRenglones } from '../domain/bultos';
import BultoControl from '../components/BultoControl';

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
const ItemRow = ({ item, producto, puedeBulto = false, avisos = [], canEditPrecio, onCambiarCantidad, onSetCantidad, onSetPrecio, onSetDescuentoPct, onEliminar, onBulto }) => {
  const [cantidadText, setCantidadText] = useState(String(item.cantidad));
  const [precioText, setPrecioText] = useState(String(item.precio));

  // Sincronizar texto cuando cambia desde los botones +/-
  useEffect(() => { setCantidadText(String(item.cantidad)); }, [item.cantidad]);

  const handleCantidadChange = (e) => {
    const val = e.target.value;
    setCantidadText(val);
    const n = parseInt(val);
    if (!isNaN(n) && n > 0) onSetCantidad(item.productoId, n);
    // Si el campo está vacío, NO eliminamos — esperamos que el usuario termine de escribir
  };

  const handleCantidadBlur = () => {
    const n = parseInt(cantidadText);
    if (!n || n <= 0) {
      // Al salir del campo vacío, restablecer a 1 en lugar de eliminar
      setCantidadText('1');
      onSetCantidad(item.productoId, 1);
    } else {
      setCantidadText(String(n));
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
      alert('Porcentaje invÃ¡lido (0-100).');
      return;
    }
    onSetDescuentoPct(item.productoId, n);
  };

  const precioModificado = item.precioOriginal !== undefined && item.precio !== item.precioOriginal;
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
            const nueva = Math.max(1, item.cantidad - 1);
            onCambiarCantidad(item.productoId, -1, 1);
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
            onCambiarCantidad(item.productoId, 1, null);
            setCantidadText(String(item.cantidad + 1));
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
        cantidad={item.cantidad}
        puedeRestar={Number(item.cantidad) > CANTIDAD_MINIMA_RENGLON}
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
  }, [draftKey, fecha, clienteQ, clienteId, clienteNombre, productoQ, items, observaciones]);

  const clienteSugg = clienteQ.length >= 1 ? fuzzySearch(clienteQ, clientes, 'nombre', 5) : [];
  const productoLimit = productoQ.trim().length < 2 ? 40 : 120;
  const productoSugg = productoQ.length >= 1 ? searchProductos(productoQ, productos, productoLimit) : [];

  const seleccionarCliente = (c) => {
    setClienteId(c.id);
    setClienteNombre(c.nombre);
    setClienteQ(c.nombre);
    setShowClienteSugg(false);
  };

  const agregarProducto = useCallback((p) => {
    setItems(prev => {
      const existe = prev.find(i => i.productoId === p.id);
      if (existe) {
        // AC-BUL-9: volver a tocar el producto cambia la cantidad => ya no es la unidad por defecto.
        const next = prev.map(i => i.productoId === p.id ? quitarMarcasRenglon({ ...i, cantidad: i.cantidad + 1 }) : i);
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

  const cambiarCantidad = (productoId, delta, minVal) => {
    setItems(prev => prev.map(i =>
      i.productoId === productoId
        ? quitarMarcasRenglon({ ...i, cantidad: Math.max(minVal !== null ? minVal : 1, i.cantidad + delta) })
        : i
    ));
  };

  const setCantidad = (productoId, n) => {
    setItems(prev => prev.map(i =>
      // AC-BUL-9: cantidad escrita a mano (aunque sea 1) => se quita la marca.
      i.productoId === productoId ? quitarMarcasRenglon({ ...i, cantidad: n }) : i
    ));
  };

  // AC-BUL-2/3/9: suma o resta un bulto con el bultoX ACTUAL del producto.
  // Si el renglón tiene la unidad por defecto, el primer "+ Bulto" la reemplaza.
  // Updater funcional para que toques rápidos no usen un estado viejo.
  const aplicarBulto = (productoId, op) => {
    const bx = productosById.get(String(productoId))?.bultoX;
    setItems(prev => prev.map(i => {
      if (i.productoId !== productoId) return i;
      const cantidad = op === 'sumar'
        ? sumarBultoRenglon(i.cantidad, bx, { cantidadPorDefecto: i[MARCA_CANTIDAD_POR_DEFECTO] === true })
        : restarBulto(i.cantidad, bx, { minimo: CANTIDAD_MINIMA_RENGLON });
      return cantidad === i.cantidad ? i : quitarMarcasRenglon({ ...i, cantidad });
    }));
  };

  const setPrecio = (productoId, precio) => {
    setItems(prev => prev.map(i =>
      i.productoId === productoId ? { ...i, precio, descuentoPct: null } : i
    ));
  };

  const setDescuentoPct = (productoId, pct) => {
    setItems(prev => prev.map(i => {
      if (i.productoId !== productoId) return i;
      const base = Number(i.precioOriginal ?? i.precio ?? 0);
      const p = Math.max(0, Math.min(100, Number(pct) || 0));
      const nuevoPrecio = Math.round((base * (1 - p / 100)) * 100) / 100;
      return { ...i, descuentoPct: p, precio: nuevoPrecio };
    }));
  };

  const eliminarItem = (productoId) => {
    setItems(prev => prev.filter(i => i.productoId !== productoId));
  };

  const total = items.reduce((acc, i) => acc + i.cantidad * i.precio, 0);

  const guardar = async () => {
    if (!clienteNombre.trim()) { setToast({ msg: 'Ingresá el nombre del cliente', type: 'error' }); return; }
    if (items.length === 0) { setToast({ msg: 'Agregá al menos un producto', type: 'error' }); return; }

    // Si el cliente no existe en el maestro, guardarlo para que aparezca en sugerencias otro dia.
    const nombreFinal = clienteNombre.trim();
    let finalClienteId = clienteId || null;
    if (!finalClienteId) {
      const norm = (s) => String(s || '').trim().toLowerCase();
      const existing = (clientes || []).find(c => norm(c?.nombre) === norm(nombreFinal));
      if (existing) {
        finalClienteId = existing.id;
      } else {
        try {
          finalClienteId = await addCliente({
            nombre: nombreFinal,
            direccion: '',
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
      items: quitarMarcasRenglones(items),
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
                avisos={avisosItemPedido(productosById.get(String(item.productoId)), item.cantidad, stockMap?.has(String(item.productoId)) ? stockDe(stockMap, item.productoId) : undefined)}
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

      <button className="btn btn-primary" onClick={guardar} style={{ marginTop: 4, marginBottom: 80 }}>
        ✓ Guardar Pedido
      </button>

      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
};

export default NuevoPedido;
