// src/components/ConfigTienda.js — REQ-POR: Configuración → Tienda (solo admin).
// AC-POR-2 nombre, logo, color (con contraste), bienvenida, contacto, sin stock,
// límite por hora, banners y destacados. AC-POR-3 ofertas. AC-POR-4 subida de
// imágenes. AC-POR-5 vista previa del borrador antes de publicar.
// El PIN del admin solo vive en este estado.
import React, { useMemo, useState } from 'react';
import {
  CONFIG_TIENDA_DEFAULT, DESTINOS, MAX_BANNERS, contraste, colorLegible, normalizarHex,
  validarConfigTienda, validarImagen, armarPortada, aplicarOfertas, catalogoDesdeLocales, hoyArgentina,
  normalizarConfigTienda, oscurecer,
} from '../domain/tiendaPortada';
import { listarRubros } from '../domain/rubros';
import { leerConfigTienda, guardarConfigTienda, subirImagenTienda } from '../services/tiendaConfigService';
import Portada from '../tienda/Portada';
import '../tienda/tienda.css';

const ETIQUETA_DESTINO = { rubro: 'Rubro', marca: 'Marca', producto: 'Producto', ofertas: 'Ofertas' };

const ErrorCampo = ({ msg, id }) => (msg ? <div className="input-error" style={{ color: 'var(--danger, #b42318)', fontSize: 12 }} data-testid={id}>{msg}</div> : null);

const ConfigTienda = ({ productos = [], stockDe = () => 0, online = true }) => {
  const [pin, setPin] = useState('');
  const [borrador, setBorrador] = useState(null);
  const [errores, setErrores] = useState({});
  const [msg, setMsg] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [preview, setPreview] = useState(false);

  const rubros = useMemo(() => listarRubros(productos), [productos]);
  const marcas = useMemo(() => [...new Set(productos.map(p => p.marca).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es')), [productos]);
  const productosOrdenados = useMemo(() => [...productos].sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es')), [productos]);

  const cargar = async () => {
    setOcupado(true); setMsg('');
    const r = await leerConfigTienda(pin);
    setOcupado(false);
    if (!r.ok) { setMsg(r.mensaje); return; }
    setBorrador({ config: { ...CONFIG_TIENDA_DEFAULT, ...r.config, logo: r.config.logo || '' }, banners: r.banners, ofertas: r.ofertas.map(o => ({ ...o, precio: o.precio ?? '' })) });
    setErrores({});
  };

  const setCfg = (k, v) => setBorrador(b => ({ ...b, config: { ...b.config, [k]: v } }));
  const setLista = (lista, i, cambios) => setBorrador(b => ({ ...b, [lista]: b[lista].map((x, k) => (k === i ? { ...x, ...cambios } : x)) }));
  const quitar = (lista, i) => setBorrador(b => ({ ...b, [lista]: b[lista].filter((_, k) => k !== i) }));
  const mover = (i, d) => setBorrador(b => {
    const arr = [...b.banners];
    const j = i + d;
    if (j < 0 || j >= arr.length) return b;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    return { ...b, banners: arr };
  });

  const subir = async (file, onUrl) => {
    const v = validarImagen(file);
    if (!v.ok) { setMsg(v.error); return; }
    setOcupado(true); setMsg('Subiendo imagen...');
    const r = await subirImagenTienda(pin, file);
    setOcupado(false);
    if (!r.ok) { setMsg(r.mensaje); return; }
    onUrl(r.url);
    setMsg('Imagen subida. Acordate de publicar los cambios.');
  };

  const publicar = async () => {
    const v = validarConfigTienda(borrador);
    setErrores(v.errores);
    if (!v.ok) { setMsg('Revisá los campos marcados.'); return; }
    setOcupado(true); setMsg('');
    const r = await guardarConfigTienda(pin, v.datos);
    setOcupado(false);
    setMsg(r.ok ? 'Cambios publicados en la tienda.' : r.mensaje);
  };

  const hoy = hoyArgentina();
  const vista = useMemo(() => {
    if (!borrador || !preview) return null;
    const cat = catalogoDesdeLocales(productos, stockDe, borrador.config.permitirSinStock);
    return armarPortada(aplicarOfertas(cat, borrador.ofertas, hoy), borrador, hoy);
  }, [borrador, preview, productos, stockDe, hoy]);

  const color = normalizarHex(borrador?.config.color);
  const ratio = color ? contraste(color, '#ffffff') : null;

  return (
    <div className="card" style={{ marginTop: 16 }} data-testid="config-tienda">
      <div style={{ fontWeight: 700, marginBottom: 8 }}>Tienda online</div>
      <div className="input-group">
        <label className="input-label">Tu PIN de admin</label>
        <input className="input" type="password" inputMode="numeric" autoComplete="off" data-testid="pin-tienda"
          value={pin} onChange={e => setPin(e.target.value)} placeholder="Se verifica en el servidor" />
      </div>
      <button type="button" className="btn btn-ghost btn-sm" style={{ width: 'auto', marginBottom: 10 }}
        disabled={!online || ocupado} onClick={cargar} data-testid="cargar-config-tienda">Cargar configuración</button>

      {borrador ? (
        <>
          <div className="input-group">
            <label className="input-label">Nombre de la tienda</label>
            <input className="input" data-testid="tienda-nombre" value={borrador.config.nombre} onChange={e => setCfg('nombre', e.target.value)} />
            <ErrorCampo msg={errores.nombre} id="err-nombre" />
          </div>
          <div className="input-group">
            <label className="input-label">Logo (URL https o subir imagen)</label>
            <input className="input" value={borrador.config.logo || ''} onChange={e => setCfg('logo', e.target.value)} />
            <input type="file" accept="image/jpeg,image/png,image/webp" disabled={!online || ocupado}
              onChange={e => e.target.files[0] && subir(e.target.files[0], url => setCfg('logo', url))} />
            <ErrorCampo msg={errores.logo} id="err-logo" />
          </div>
          <div className="input-group">
            <label className="input-label">Color principal</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="color" value={color || '#0f766e'} onChange={e => setCfg('color', e.target.value)} aria-label="Elegir color" />
              <input className="input" data-testid="tienda-color" value={borrador.config.color} onChange={e => setCfg('color', e.target.value)} />
              <span style={{ background: color || '#ccc', color: '#fff', padding: '4px 8px', borderRadius: 6, fontSize: 12, whiteSpace: 'nowrap' }}>
                {ratio ? `${ratio}:1 ${colorLegible(color) ? 'legible' : 'poco contraste'}` : 'inválido'}
              </span>
            </div>
            <ErrorCampo msg={errores.color} id="err-color" />
          </div>
          <div className="input-group">
            <label className="input-label">Texto de bienvenida</label>
            <textarea className="input" maxLength={300} value={borrador.config.bienvenida} onChange={e => setCfg('bienvenida', e.target.value)} />
            <ErrorCampo msg={errores.bienvenida} id="err-bienvenida" />
          </div>
          <div className="input-group">
            <label className="input-label">Contacto (pie de la tienda)</label>
            <input className="input" maxLength={200} value={borrador.config.contacto} onChange={e => setCfg('contacto', e.target.value)} />
            <ErrorCampo msg={errores.contacto} id="err-contacto" />
          </div>
          <div className="input-group">
            <label className="input-label">WhatsApp (solo números, con característica)</label>
            <input className="input" inputMode="numeric" value={borrador.config.whatsapp} onChange={e => setCfg('whatsapp', e.target.value)} />
            <ErrorCampo msg={errores.whatsapp} id="err-whatsapp" />
          </div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
            <input type="checkbox" checked={!!borrador.config.permitirSinStock} onChange={e => setCfg('permitirSinStock', e.target.checked)} />
            Permitir pedir productos sin stock
          </label>
          <div className="input-group">
            <label className="input-label">Límite de pedidos por hora (por cliente)</label>
            <input className="input" type="number" min="1" max="1000" value={borrador.config.limitePorHora}
              onChange={e => setCfg('limitePorHora', e.target.value === '' ? '' : Number(e.target.value))} />
            <ErrorCampo msg={errores.limitePorHora} id="err-limite" />
          </div>

          <div style={{ fontWeight: 600, margin: '12px 0 6px' }}>Filas de destacados (por rubro)</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {rubros.map(r => (
              <label key={r} style={{ fontSize: 13 }}>
                <input type="checkbox" checked={borrador.config.destacados.includes(r)}
                  onChange={() => setCfg('destacados', borrador.config.destacados.includes(r) ? borrador.config.destacados.filter(x => x !== r) : [...borrador.config.destacados, r])} /> {r}
              </label>
            ))}
          </div>
          <ErrorCampo msg={errores.destacados} id="err-destacados" />

          <div style={{ fontWeight: 600, margin: '12px 0 6px' }}>Banners</div>
          {borrador.banners.map((b, i) => {
            const e = (errores.bannersDetalle || [])[i] || {};
            const tipo = b.destino?.tipo || 'ofertas';
            const opciones = tipo === 'rubro' ? rubros : tipo === 'marca' ? marcas : null;
            return (
              <div key={b.id || `n${i}`} style={{ borderTop: '1px solid var(--border)', padding: '8px 0' }} data-testid="banner-form">
                <input className="input" placeholder="Imagen (URL https)" value={b.imagen || ''} onChange={ev => setLista('banners', i, { imagen: ev.target.value })} />
                <input type="file" accept="image/jpeg,image/png,image/webp" disabled={!online || ocupado}
                  onChange={ev => ev.target.files[0] && subir(ev.target.files[0], url => setLista('banners', i, { imagen: url }))} />
                <ErrorCampo msg={e.imagen} />
                <input className="input" placeholder="Título" maxLength={60} value={b.titulo || ''} onChange={ev => setLista('banners', i, { titulo: ev.target.value })} />
                <input className="input" placeholder="Subtítulo" maxLength={120} value={b.subtitulo || ''} onChange={ev => setLista('banners', i, { subtitulo: ev.target.value })} />
                <div style={{ display: 'flex', gap: 6 }}>
                  <select className="input" value={tipo} aria-label="Destino"
                    onChange={ev => setLista('banners', i, { destino: { tipo: ev.target.value, valor: '' } })}>
                    {DESTINOS.map(d => <option key={d} value={d}>{ETIQUETA_DESTINO[d]}</option>)}
                  </select>
                  {tipo === 'producto' ? (
                    <select className="input" value={b.destino?.valor || ''} aria-label="Producto del banner"
                      onChange={ev => setLista('banners', i, { destino: { tipo, valor: ev.target.value } })}>
                      <option value="">Elegí un producto</option>
                      {productosOrdenados.map(p => <option key={p.id} value={String(p.id)}>{p.nombre}</option>)}
                    </select>
                  ) : opciones ? (
                    <select className="input" value={b.destino?.valor || ''} aria-label="Valor del destino"
                      onChange={ev => setLista('banners', i, { destino: { tipo, valor: ev.target.value } })}>
                      <option value="">Elegí</option>
                      {opciones.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : null}
                </div>
                <ErrorCampo msg={e.destino} />
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
                  Desde <input className="input" type="date" value={b.desde || ''} onChange={ev => setLista('banners', i, { desde: ev.target.value })} />
                  Hasta <input className="input" type="date" value={b.hasta || ''} onChange={ev => setLista('banners', i, { hasta: ev.target.value })} />
                </div>
                <ErrorCampo msg={e.vigencia} />
                <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                  <label style={{ fontSize: 13 }}><input type="checkbox" checked={b.activo !== false} onChange={ev => setLista('banners', i, { activo: ev.target.checked })} /> Activo</label>
                  <button type="button" className="btn btn-ghost btn-sm" style={{ width: 'auto' }} onClick={() => mover(i, -1)} disabled={i === 0}>Subir</button>
                  <button type="button" className="btn btn-ghost btn-sm" style={{ width: 'auto' }} onClick={() => mover(i, 1)} disabled={i === borrador.banners.length - 1}>Bajar</button>
                  <button type="button" className="btn btn-ghost btn-sm" style={{ width: 'auto' }} onClick={() => quitar('banners', i)}>Quitar</button>
                </div>
              </div>
            );
          })}
          <button type="button" className="btn btn-ghost btn-sm" style={{ width: 'auto' }} disabled={borrador.banners.length >= MAX_BANNERS}
            onClick={() => setBorrador(b => ({ ...b, banners: [...b.banners, { imagen: '', titulo: '', subtitulo: '', destino: { tipo: 'ofertas', valor: '' }, desde: '', hasta: '', activo: true }] }))}
            data-testid="agregar-banner">Agregar banner</button>
          <ErrorCampo msg={errores.banners} />

          <div style={{ fontWeight: 600, margin: '12px 0 6px' }}>Ofertas</div>
          {borrador.ofertas.map((o, i) => {
            const e = (errores.ofertasDetalle || [])[i] || {};
            return (
              <div key={o.id || `o${i}`} style={{ borderTop: '1px solid var(--border)', padding: '8px 0' }} data-testid="oferta-form">
                <select className="input" value={o.productoId || ''} aria-label="Producto en oferta" onChange={ev => setLista('ofertas', i, { productoId: ev.target.value })}>
                  <option value="">Elegí un producto</option>
                  {productosOrdenados.map(p => <option key={p.id} value={String(p.id)}>{p.nombre} (${p.precio})</option>)}
                </select>
                <ErrorCampo msg={e.productoId} />
                <input className="input" inputMode="decimal" placeholder="Precio de oferta por unidad (opcional)" value={o.precio ?? ''}
                  onChange={ev => setLista('ofertas', i, { precio: ev.target.value })} aria-label="Precio de oferta" />
                <ErrorCampo msg={e.precio} />
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
                  Desde <input className="input" type="date" value={o.desde || ''} onChange={ev => setLista('ofertas', i, { desde: ev.target.value })} />
                  Hasta <input className="input" type="date" value={o.hasta || ''} onChange={ev => setLista('ofertas', i, { hasta: ev.target.value })} />
                </div>
                <ErrorCampo msg={e.vigencia} />
                <button type="button" className="btn btn-ghost btn-sm" style={{ width: 'auto' }} onClick={() => quitar('ofertas', i)}>Quitar</button>
              </div>
            );
          })}
          <button type="button" className="btn btn-ghost btn-sm" style={{ width: 'auto' }}
            onClick={() => setBorrador(b => ({ ...b, ofertas: [...b.ofertas, { productoId: '', precio: '', desde: hoy, hasta: hoy }] }))}
            data-testid="agregar-oferta">Agregar oferta</button>
          <ErrorCampo msg={errores.ofertas} />

          <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-ghost btn-sm" style={{ width: 'auto' }} onClick={() => setPreview(p => !p)} data-testid="vista-previa">
              {preview ? 'Ocultar vista previa' : 'Vista previa'}
            </button>
            <button type="button" className="btn btn-primary btn-sm" style={{ width: 'auto' }} disabled={!online || ocupado} onClick={publicar} data-testid="publicar-tienda">
              Publicar cambios
            </button>
          </div>

          {vista ? (
            <div style={{ marginTop: 12, border: '1px dashed var(--border)', borderRadius: 8, overflow: 'hidden' }} data-testid="preview-tienda">
              {(() => {
                const cfg = normalizarConfigTienda(borrador.config);
                return (
                  <div className="tienda-root" style={{ minHeight: 0, '--t-color': cfg.color, '--t-color-osc': oscurecer(cfg.color) }}>
                    <header className="t-header"><span className="t-logo">{cfg.logo ? <img className="t-logo-img" src={cfg.logo} alt="" /> : null}{cfg.nombre}</span></header>
                    <Portada portada={vista} permitirSinStock={cfg.permitirSinStock} onAgregar={() => {}} navegar={() => {}} />
                  </div>
                );
              })()}
            </div>
          ) : null}
        </>
      ) : null}
      {msg ? <div role="status" style={{ fontSize: 13, marginTop: 8 }} data-testid="tienda-msg">{msg}</div> : null}
    </div>
  );
};

export default ConfigTienda;
