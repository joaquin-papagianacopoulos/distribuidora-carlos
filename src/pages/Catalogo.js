// src/pages/Catalogo.js — REQ-CAT. SOLO ADMIN.
// Alta rápida de fotos (una por una o varias a la vez, el archivo se llama como el código),
// marcas por producto "Oculto" y "Sin stock" y generación del PDF del catálogo.
// El PIN vive solo en este estado: se usa para subir la foto y no se guarda ni se loguea.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../hooks/useAppContext';
import { esAdmin } from '../domain/permisos';
import { stockDe } from '../domain/stock';
import { getCatalogoMarcas, putCatalogoMarca, updateProducto } from '../db';
import {
  indexarMarcas, marcaDe, aplicarCambioMarca, resumenCatalogo, formatoPrecio, emparejarFotosPorCodigo,
  ordenarProductosCatalogo, moverEnLista, filasOfertasEditor, aplicarOfertasProducto, textosOfertasProducto,
} from '../domain/catalogoPdf';
import { subirFotoProducto, generarCatalogoPdf } from '../services/catalogoService';
import { subirProductosConPin } from '../services/productosAdminService';
import { descargarArchivo } from '../utils/descargarArchivo';

const FILTROS = [
  ['todos', 'Todos'], ['sinfoto', 'Sin foto'], ['ocultos', 'Ocultos'], ['sinstock', 'Sin stock'],
];

const Catalogo = () => {
  const { productos = [], stockMap, vendedorActual, recargar } = useApp();
  const admin = esAdmin(vendedorActual?.permiso);
  const [marcas, setMarcas] = useState([]);
  const [buscar, setBuscar] = useState('');
  const [filtro, setFiltro] = useState('todos');
  const [pin, setPin] = useState('');
  const [msg, setMsg] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [lote, setLote] = useState(null); // { asignaciones, sinProducto, repetidos }
  const [opc, setOpc] = useState({ titulo: 'Catalogo', subtitulo: 'DISTRIBUCION MAYORISTA', autoSinStock: false, soloConFoto: false });
  const [progreso, setProgreso] = useState('');
  const loteRef = useRef(null);

  useEffect(() => { getCatalogoMarcas().then(setMarcas).catch(() => setMarcas([])); }, []);
  const mapa = useMemo(() => indexarMarcas(marcas), [marcas]);
  const resumen = useMemo(() => resumenCatalogo(productos, marcas), [productos, marcas]);

  // AC-CAT-5: la lista sale en el mismo orden que el PDF (puesto manual, después rubro y nombre).
  const ordenCompleto = useMemo(() => ordenarProductosCatalogo(productos, mapa), [productos, mapa]);
  const puedeOrdenar = filtro === 'todos' && !buscar.trim();
  const lista = useMemo(() => {
    const q = buscar.trim().toLowerCase();
    return ordenCompleto.filter((p) => {
      const m = marcaDe(mapa, p.id);
      if (filtro === 'sinfoto' && p.imagen_url) return false;
      if (filtro === 'ocultos' && !m.oculto) return false;
      if (filtro === 'sinstock' && !m.sinStock) return false;
      return !q || `${p.nombre} ${p.codigo}`.toLowerCase().includes(q);
    });
  }, [ordenCompleto, mapa, buscar, filtro]);

  const cambiarMarca = async (p, cambios) => {
    const nueva = aplicarCambioMarca(mapa.get(String(p.id)), p.id, cambios);
    await putCatalogoMarca(nueva);
    setMarcas(await getCatalogoMarcas());
  };

  // AC-CAT-5: mover un producto (arrastrando o con ▲▼) fija el puesto de TODOS (1..n) para que el PDF respete el orden visto.
  const [arrastrando, setArrastrando] = useState(null);
  const moverProducto = async (desde, hasta) => {
    if (!puedeOrdenar || desde === hasta) return;
    const ids = moverEnLista(ordenCompleto.map((p) => p.id), desde, hasta);
    await Promise.all(ids.map((id, i) => putCatalogoMarca(aplicarCambioMarca(mapa.get(String(id)), id, { orden: i + 1 }))));
    setMarcas(await getCatalogoMarcas());
  };
  const restablecerOrden = async () => {
    await Promise.all(ordenCompleto.map((p) => {
      const { orden: _o, ...resto } = mapa.get(String(p.id)) || { productoId: p.id };
      return putCatalogoMarca({ ...resto, productoId: p.id });
    }));
    setMarcas(await getCatalogoMarcas());
    setMsg('Orden restablecido: rubro y nombre.');
  };

  // AC-CAT-7: ofertas por bulto de cada producto (se editan acá y se guardan en el producto).
  const [ofertaAbierta, setOfertaAbierta] = useState(null); // id del producto
  const [ofertaForm, setOfertaForm] = useState({ bultoX: '', filas: [] });
  const [ofertaMsg, setOfertaMsg] = useState('');
  const abrirOfertas = (p) => {
    if (ofertaAbierta === p.id) { setOfertaAbierta(null); return; }
    setOfertaAbierta(p.id);
    setOfertaForm({ bultoX: Number(p.bultoX) > 1 ? String(p.bultoX) : '', filas: filasOfertasEditor(p) });
    setOfertaMsg('');
  };
  const guardarOfertas = async (p) => {
    const r = aplicarOfertasProducto(p, ofertaForm);
    if (!r.ok) { setOfertaMsg(r.errores.join(' · ')); return; }
    setOcupado(true);
    try {
      await updateProducto(r.producto);
      let extra = '';
      if (pin) {
        const s = await subirProductosConPin(pin);
        extra = s?.ok === false ? ` Guardado acá; no se pudo subir: ${s.mensaje}` : ' Subido al servidor.';
      } else {
        extra = ' Guardado en este equipo; ingresá tu PIN y volvé a guardar para subirlo.';
      }
      setOfertaMsg(`${r.producto.escalasBulto.length ? 'Ofertas guardadas.' : 'Ofertas borradas.'}${extra}${r.avisos.length ? ` Aviso: ${r.avisos.join(' · ')}` : ''}`);
      await recargar?.();
    } catch (e) {
      setOfertaMsg(`No se pudo guardar: ${e.message}`);
    } finally { setOcupado(false); }
  };

  const subirUna = async (p, file) => {
    if (!pin) { setMsg('Ingresá tu PIN de admin para subir fotos.'); return; }
    setOcupado(true); setMsg(`Subiendo foto de ${p.nombre}...`);
    const r = await subirFotoProducto(pin, p, file);
    setOcupado(false);
    setMsg(r.ok ? (r.subido ? `Foto de ${p.nombre} subida.` : `Foto guardada en este equipo; no se pudo subir el producto: ${r.mensaje}`) : r.mensaje);
    if (r.ok) await recargar?.();
  };

  const elegirLote = (files) => {
    const r = emparejarFotosPorCodigo(files, productos);
    setLote(r);
    setMsg(`${r.asignaciones.length} foto(s) con producto, ${r.sinProducto.length} sin coincidencia.`);
  };

  const subirLote = async () => {
    if (!pin) { setMsg('Ingresá tu PIN de admin para subir fotos.'); return; }
    setOcupado(true);
    let ok = 0; const fallos = [];
    for (let i = 0; i < lote.asignaciones.length; i++) {
      const { file, producto } = lote.asignaciones[i];
      setProgreso(`Subiendo ${i + 1}/${lote.asignaciones.length}: ${producto.nombre}`);
      const r = await subirFotoProducto(pin, producto, file);
      if (r.ok) ok++; else { fallos.push(`${producto.codigo}: ${r.mensaje}`); if (/PIN/i.test(r.mensaje || '')) break; }
    }
    setOcupado(false); setProgreso(''); setLote(null);
    if (loteRef.current) loteRef.current.value = '';
    setMsg(`${ok} foto(s) subidas.${fallos.length ? ` Con error: ${fallos.slice(0, 5).join(' | ')}` : ''}`);
    await recargar?.();
  };

  const generar = async () => {
    setOcupado(true); setMsg('');
    try {
      const r = await generarCatalogoPdf(productos, marcas, {
        ...opc, stockDe: (id) => stockDe(stockMap, id), onProgreso: (h, t) => setProgreso(`Descargando fotos ${h}/${t}...`),
      });
      descargarArchivo(r.file);
      setMsg(`PDF listo: ${r.productos} productos en ${r.paginas} pagina(s).${r.sinFotoDescargable ? ` ${r.sinFotoDescargable} foto(s) no se pudieron bajar y salen "SIN FOTO".` : ''}`);
    } catch (e) {
      setMsg(`No se pudo generar el PDF: ${e.message}`);
    } finally { setOcupado(false); setProgreso(''); }
  };

  if (!admin) {
    return (
      <div className="page">
        <h1 className="page-title">Catálogo</h1>
        <div className="empty-state"><div className="empty-text">Esta pantalla es solo para administradores.</div></div>
      </div>
    );
  }

  return (
    <div className="page" data-testid="pagina-catalogo">
      <h1 className="page-title">Catálogo PDF y fotos</h1>

      <div className="card" style={{ marginBottom: 12 }}>
        <div data-testid="catalogo-resumen" style={{ fontSize: 13, marginBottom: 8 }}>
          {resumen.visibles} en el catálogo · {resumen.ocultos} ocultos · {resumen.sinStock} sin stock · {resumen.sinFoto} sin foto
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input className="input" type="password" inputMode="numeric" placeholder="Tu PIN de admin" value={pin} onChange={(e) => setPin(e.target.value)} style={{ maxWidth: 160 }} data-testid="catalogo-pin" autoComplete="off" />
          <label className="btn btn-ghost btn-sm" style={{ cursor: 'pointer' }}>
            📷 Subir varias fotos (nombre = código)
            <input ref={loteRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden data-testid="catalogo-lote" onChange={(e) => e.target.files.length && elegirLote(e.target.files)} />
          </label>
        </div>

        {lote && (
          <div style={{ marginTop: 10, fontSize: 13 }} data-testid="catalogo-lote-resumen">
            <div>✔ {lote.asignaciones.length} foto(s) se asignan a su producto por código.</div>
            {lote.sinProducto.length > 0 && <div style={{ color: 'var(--danger)' }}>Sin producto: {lote.sinProducto.slice(0, 8).join(', ')}{lote.sinProducto.length > 8 ? '…' : ''}</div>}
            {lote.repetidos.length > 0 && <div style={{ color: 'var(--text3)' }}>Repetidas (se usa la última): {lote.repetidos.join(', ')}</div>}
            <button className="btn btn-primary btn-sm" style={{ marginTop: 6 }} disabled={ocupado || !lote.asignaciones.length} onClick={subirLote} data-testid="catalogo-lote-subir">Subir {lote.asignaciones.length} foto(s)</button>
            <button className="btn btn-ghost btn-sm" style={{ marginTop: 6, marginLeft: 6 }} onClick={() => setLote(null)}>Cancelar</button>
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Generar PDF</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input className="input" value={opc.titulo} onChange={(e) => setOpc({ ...opc, titulo: e.target.value })} placeholder="Nombre del catálogo" style={{ maxWidth: 200 }} />
          <input className="input" value={opc.subtitulo} onChange={(e) => setOpc({ ...opc, subtitulo: e.target.value })} placeholder="Encabezado" style={{ maxWidth: 240 }} />
        </div>
        <label style={{ display: 'block', fontSize: 13, marginTop: 8 }}>
          <input type="checkbox" checked={opc.autoSinStock} onChange={(e) => setOpc({ ...opc, autoSinStock: e.target.checked })} /> Marcar "SIN STOCK" también los que tienen stock 0 en la app
        </label>
        <label style={{ display: 'block', fontSize: 13 }}>
          <input type="checkbox" checked={opc.soloConFoto} onChange={(e) => setOpc({ ...opc, soloConFoto: e.target.checked })} /> Dejar afuera los productos sin foto
        </label>
        <button className="btn btn-primary" style={{ marginTop: 10 }} disabled={ocupado} onClick={generar} data-testid="catalogo-generar">Generar y descargar PDF</button>
      </div>

      {(msg || progreso) && <div className="card" style={{ marginBottom: 12, fontSize: 13 }} role="status" data-testid="catalogo-msg">{progreso || msg}</div>}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        {FILTROS.map(([k, t]) => <button key={k} className={`btn btn-sm ${filtro === k ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setFiltro(k)}>{t}</button>)}
        <input className="input" placeholder="Buscar por nombre o código" value={buscar} onChange={(e) => setBuscar(e.target.value)} style={{ flex: 1, minWidth: 180 }} />
      </div>

      <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }} data-testid="catalogo-orden-ayuda">
        {puedeOrdenar
          ? <span>Arrastrá los productos (☰) o usá ▲▼ para cambiar el orden en que salen en el PDF.</span>
          : <span>Para ordenar, elegí el filtro "Todos" y vaciá el buscador.</span>}
        {puedeOrdenar && <button className="btn btn-ghost btn-sm" onClick={restablecerOrden} data-testid="catalogo-orden-reset">Orden por rubro y nombre</button>}
      </div>

      {lista.map((p, idx) => {
        const m = marcaDe(mapa, p.id);
        const abierta = ofertaAbierta === p.id;
        const ofertasTxt = textosOfertasProducto(p);
        return (
          <div key={p.id} className="card"
            style={{ marginBottom: 6, opacity: m.oculto ? 0.55 : 1, outline: arrastrando !== null && arrastrando !== idx && puedeOrdenar ? '1px dashed var(--border, #bbb)' : 'none' }}
            data-testid="catalogo-fila"
            draggable={puedeOrdenar}
            onDragStart={(e) => { setArrastrando(idx); try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(idx)); } catch { /* sin dataTransfer */ } }}
            onDragOver={(e) => { if (puedeOrdenar && arrastrando !== null) e.preventDefault(); }}
            onDrop={(e) => { e.preventDefault(); const d = arrastrando; setArrastrando(null); if (d !== null) moverProducto(d, idx); }}
            onDragEnd={() => setArrastrando(null)}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            {puedeOrdenar && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                <button className="btn btn-ghost btn-sm" aria-label={`Subir ${p.nombre}`} disabled={idx === 0} onClick={() => moverProducto(idx, idx - 1)} style={{ padding: '0 6px' }}>▲</button>
                <span title="Arrastrar" style={{ cursor: 'grab', fontSize: 14, color: 'var(--text3)' }} aria-hidden="true">☰ {idx + 1}</span>
                <button className="btn btn-ghost btn-sm" aria-label={`Bajar ${p.nombre}`} disabled={idx === lista.length - 1} onClick={() => moverProducto(idx, idx + 1)} style={{ padding: '0 6px' }}>▼</button>
              </div>
            )}
            {p.imagen_url
              ? <img src={p.imagen_url} alt="" width={56} height={56} style={{ objectFit: 'contain', borderRadius: 6 }} loading="lazy" />
              : <div style={{ width: 56, height: 56, display: 'grid', placeItems: 'center', fontSize: 10, color: 'var(--text3)', background: 'var(--surface2, #eee)', borderRadius: 6 }}>SIN FOTO</div>}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{p.nombre}</div>
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>Cód. {p.codigo} · {formatoPrecio(p.precio)} · stock {stockDe(stockMap, p.id)}</div>
              {ofertasTxt.length > 0 && <div style={{ fontSize: 12, color: 'var(--danger)' }} data-testid="catalogo-ofertas-txt">{ofertasTxt.join(' · ')}</div>}
            </div>
            <button className={`btn btn-sm ${abierta || ofertasTxt.length ? 'btn-primary' : 'btn-ghost'}`} onClick={() => abrirOfertas(p)} aria-expanded={abierta} data-testid="catalogo-ofertas-btn">🏷 Ofertas</button>
            <label className="btn btn-ghost btn-sm" style={{ cursor: 'pointer' }}>📷
              <input type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={ocupado} onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; if (f) subirUna(p, f); }} />
            </label>
            <button className={`btn btn-sm ${m.sinStock ? 'btn-primary' : 'btn-ghost'}`} onClick={() => cambiarMarca(p, { sinStock: !m.sinStock })} aria-pressed={m.sinStock}>Sin stock</button>
            <button className={`btn btn-sm ${m.oculto ? 'btn-primary' : 'btn-ghost'}`} onClick={() => cambiarMarca(p, { oculto: !m.oculto })} aria-pressed={m.oculto}>{m.oculto ? 'Oculto' : 'Ocultar'}</button>
            </div>
            {abierta && (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border, #ddd)', fontSize: 13 }} data-testid="catalogo-ofertas-editor">
                <div style={{ fontWeight: 600, marginBottom: 6 }}>Ofertas por bulto (precio por unidad)</div>
                <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
                  Unidades por bulto
                  <input className="input" type="number" inputMode="numeric" min="2" value={ofertaForm.bultoX} style={{ width: 80 }} data-testid="oferta-bultox"
                    onChange={(e) => setOfertaForm({ ...ofertaForm, bultoX: e.target.value })} />
                </label>
                {ofertaForm.filas.map((f, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
                    <span>Desde</span>
                    <input className="input" type="number" inputMode="numeric" min="2" placeholder="bultos" value={f.desde} style={{ width: 90 }} data-testid={`oferta-desde-${i}`}
                      onChange={(e) => setOfertaForm({ ...ofertaForm, filas: ofertaForm.filas.map((x, k) => (k === i ? { ...x, desde: e.target.value } : x)) })} />
                    <span>bultos: $</span>
                    <input className="input" inputMode="decimal" placeholder="precio c/u" value={f.valor} style={{ width: 110 }} data-testid={`oferta-precio-${i}`}
                      onChange={(e) => setOfertaForm({ ...ofertaForm, filas: ofertaForm.filas.map((x, k) => (k === i ? { ...x, valor: e.target.value } : x)) })} />
                    <span>c/u</span>
                  </div>
                ))}
                <div style={{ color: 'var(--text3)', marginBottom: 6 }}>Dejá las filas vacías para sacar las ofertas. {pin ? 'Se suben al servidor con tu PIN.' : 'Ingresá tu PIN arriba para subirlas al servidor.'}</div>
                <button className="btn btn-primary btn-sm" disabled={ocupado} onClick={() => guardarOfertas(p)} data-testid="oferta-guardar">Guardar ofertas</button>
                {ofertaMsg && <div style={{ marginTop: 6 }} role="status" data-testid="oferta-msg">{ofertaMsg}</div>}
              </div>
            )}
          </div>
        );
      })}
      {lista.length === 0 && <div className="empty-state"><div className="empty-text">No hay productos con ese filtro.</div></div>}
    </div>
  );
};

export default Catalogo;
