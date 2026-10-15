// src/domain/tiendaPortada.js — REQ-POR: portada y personalización de la tienda.
// Lógica pura (sin React, sin IndexedDB, sin Supabase). La usan la tienda pública
// (src/tienda) y Configuración → Tienda (vista previa y validación antes de guardar).
// El servidor (009_tienda_portada.sql, admin_tienda_guardar) repite los mismos topes.
import { texto, soloDigitos, esFechaISO } from './validacion';
import { precioVigente, aCentavos, hrefTienda, filtrosAQuery } from './tienda';

export const COLOR_DEFAULT = '#0f766e';
export const CONTRASTE_MIN = 4.5; // WCAG AA para texto normal
export const MAX_BANNERS = 10;
export const MAX_OFERTAS = 200;
export const MAX_DESTACADOS = 10;
export const MAX_POR_FILA = 12;
export const MAX_IMAGEN_BYTES = 2 * 1024 * 1024;
export const TIPOS_IMAGEN = Object.freeze({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' });
export const DESTINOS = Object.freeze(['rubro', 'marca', 'producto', 'ofertas']);

export const CONFIG_TIENDA_DEFAULT = Object.freeze({
  nombre: 'Tienda',
  logo: null,
  color: COLOR_DEFAULT,
  bienvenida: '',
  contacto: '',
  whatsapp: '',
  permitirSinStock: false,
  limitePorHora: 5,
  destacados: [],
});

// ---- Colores y contraste ----

// "#ABC" / "abc123" -> "#aabbcc"; si no es un hex válido, null.
export function normalizarHex(v) {
  const s = String(v ?? '').trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{3}$/.test(s)) return `#${s.split('').map(c => c + c).join('')}`;
  if (/^[0-9a-f]{6}$/.test(s)) return `#${s}`;
  return null;
}

const luminancia = (hex) => {
  const h = normalizarHex(hex);
  if (!h) return null;
  const canal = (i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(1) + 0.7152 * canal(3) + 0.0722 * canal(5);
};

// Relación de contraste WCAG entre dos colores (1 a 21); null si alguno es inválido.
export function contraste(a, b) {
  const la = luminancia(a);
  const lb = luminancia(b);
  if (la === null || lb === null) return null;
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

// El color principal es el fondo del encabezado con texto blanco.
export function colorLegible(hex) {
  const c = contraste(hex, '#ffffff');
  return c !== null && c >= CONTRASTE_MIN;
}

// Variante más oscura (para textos sobre fondo claro y hover).
export function oscurecer(hex, factor = 0.8) {
  const h = normalizarHex(hex);
  if (!h) return null;
  const f = Math.min(Math.max(Number(factor) || 0, 0), 1);
  const out = [1, 3, 5].map(i => Math.round(parseInt(h.slice(i, i + 2), 16) * f).toString(16).padStart(2, '0'));
  return `#${out.join('')}`;
}

// ---- URLs ----

// Solo https: nada de http, javascript:, data: ni rutas relativas raras.
export function urlSegura(v) {
  const s = String(v ?? '').trim();
  if (!/^https:\/\/[^\s"'<>]+$/i.test(s) || s.length > 500) return null;
  return s;
}

export function linkWhatsapp(numero) {
  const d = soloDigitos(numero);
  return d.length >= 8 && d.length <= 15 ? `https://wa.me/${d}` : null;
}

// ---- Fechas ----

// Hoy en hora de Argentina (YYYY-MM-DD), igual que el servidor.
export function hoyArgentina(now = new Date()) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const v = (t) => partes.find(p => p.type === t).value;
  return `${v('year')}-${v('month')}-${v('day')}`;
}

// Vigencia inclusive en ambos extremos; sin desde/hasta = abierta de ese lado.
export function estaVigente(item, hoy) {
  if (!item) return false;
  const h = String(hoy || '');
  if (item.desde && h < String(item.desde)) return false;
  if (item.hasta && h > String(item.hasta)) return false;
  return true;
}

// ---- Config pública ----

// Config segura para pintar la tienda: defaults, color ilegible -> default, logo solo https.
export function normalizarConfigTienda(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const color = normalizarHex(r.color);
  const lim = Number(r.limitePorHora);
  const destacados = Array.isArray(r.destacados)
    ? [...new Set(r.destacados.map(x => texto(x, 60)).filter(Boolean))].slice(0, MAX_DESTACADOS) : [];
  return {
    nombre: texto(r.nombre, 60) || CONFIG_TIENDA_DEFAULT.nombre,
    logo: urlSegura(r.logo),
    color: color && colorLegible(color) ? color : COLOR_DEFAULT,
    bienvenida: texto(r.bienvenida, 300),
    contacto: texto(r.contacto, 200),
    whatsapp: soloDigitos(r.whatsapp).slice(0, 15),
    permitirSinStock: r.permitirSinStock === true,
    limitePorHora: Number.isInteger(lim) && lim >= 1 && lim <= 1000 ? lim : CONFIG_TIENDA_DEFAULT.limitePorHora,
    destacados,
  };
}

// ---- Banners ----

export function bannersVigentes(banners, hoy) {
  return (Array.isArray(banners) ? banners : [])
    .filter(b => b && b.activo !== false && urlSegura(b.imagen) && estaVigente(b, hoy))
    .map((b, i) => ({ ...b, _i: i }))
    .sort((a, b) => ((Number(a.orden) || 0) - (Number(b.orden) || 0)) || (a._i - b._i))
    .map(({ _i, ...b }) => b);
}

// Destino de un banner -> href de la tienda (conserva el token del vendedor).
export function destinoHref(destino, token = '') {
  const d = destino || {};
  const valor = String(d.valor ?? '').trim();
  const v = token || '';
  if (d.tipo === 'producto' && valor) return hrefTienda('producto', { id: valor, search: v ? `?v=${encodeURIComponent(v)}` : '' });
  if (d.tipo === 'rubro' && valor) return `/tienda${filtrosAQuery({ v, rubros: [valor] })}`;
  if (d.tipo === 'marca' && valor) return `/tienda${filtrosAQuery({ v, marcas: [valor] })}`;
  if (d.tipo === 'ofertas') return `/tienda${filtrosAQuery({ v, ofertas: true })}`;
  return `/tienda${filtrosAQuery({ v })}`;
}

// ---- Ofertas ----

export function ofertasVigentes(ofertas, hoy) {
  return (Array.isArray(ofertas) ? ofertas : []).filter(o => o && o.productoId !== undefined && o.productoId !== null && estaVigente(o, hoy));
}

// Aplica las ofertas vigentes a productos con precio de lista (vista previa en Configuración).
// El servidor hace lo mismo en tienda_catalogo; el cobro real lo decide tienda_crear_pedido.
export function aplicarOfertas(productos, ofertas, hoy) {
  // El precio puede venir tipeado ("850,5") desde el borrador de Configuración.
  const vig = ofertasVigentes(ofertas, hoy).map(o => ({ ...o, precio: precioOpcional(o.precio).valor ?? null, desde: o.desde || '', hasta: o.hasta || '' }));
  const conOferta = new Set(vig.map(o => String(o.productoId)));
  return (Array.isArray(productos) ? productos : []).map(p => {
    if (!p) return p;
    const { precio } = precioVigente(p, vig, hoy);
    const baja = precio !== null && aCentavos(precio) < aCentavos(p.precio);
    return {
      ...p,
      precio: baja ? precio : p.precio,
      precioAnterior: baja ? p.precio : null,
      enOferta: baja || conOferta.has(String(p.id)),
    };
  });
}

// ---- Portada ----

export function armarPortada(productos, portada = {}, hoy = '') {
  const lista = (Array.isArray(productos) ? productos : []).filter(Boolean);
  const cfg = normalizarConfigTienda(portada.config);
  const porId = new Map(lista.map(p => [String(p.id), p]));
  const idsOferta = new Set(ofertasVigentes(portada.ofertas, hoy).map(o => String(o.productoId)));
  const primeroDisponibles = (a, b) => (Number(!!b.disponible) - Number(!!a.disponible));
  const ofertas = lista
    .filter(p => p.enOferta || idsOferta.has(String(p.id)))
    .sort(primeroDisponibles)
    .slice(0, MAX_POR_FILA);
  const destacados = cfg.destacados
    .map(rubro => ({ rubro, productos: lista.filter(p => p.rubro === rubro).sort(primeroDisponibles).slice(0, MAX_POR_FILA) }))
    .filter(f => f.productos.length > 0);
  const cuenta = {};
  for (const p of lista) if (p.rubro) cuenta[p.rubro] = (cuenta[p.rubro] || 0) + 1;
  const rubros = Object.keys(cuenta).sort((a, b) => a.localeCompare(b, 'es')).map(r => ({ rubro: r, cantidad: cuenta[r] }));
  const banners = bannersVigentes(portada.banners, hoy)
    .filter(b => !(b.destino && b.destino.tipo === 'producto') || porId.has(String(b.destino.valor)));
  return { config: cfg, banners, ofertas, destacados, rubros };
}

// ---- Imágenes ----

export function validarImagen(file) {
  if (!file || typeof file !== 'object') return { ok: false, error: 'Elegí una imagen' };
  const ext = TIPOS_IMAGEN[String(file.type || '').toLowerCase()];
  if (!ext) return { ok: false, error: 'Solo se aceptan imágenes JPG, PNG o WEBP' };
  const size = Number(file.size);
  if (!Number.isFinite(size) || size <= 0) return { ok: false, error: 'La imagen está vacía' };
  if (size > MAX_IMAGEN_BYTES) return { ok: false, error: 'La imagen supera los 2 MB' };
  return { ok: true, ext };
}

// ---- Validación de Configuración → Tienda (antes de publicar) ----

const precioOpcional = (v) => {
  if (v === null || v === undefined || v === '') return { ok: true, valor: null };
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  const c = aCentavos(n);
  return c !== null && c > 0 ? { ok: true, valor: c / 100 } : { ok: false };
};

const vigenciaOk = (desde, hasta, requerida) => {
  if (requerida && (!desde || !hasta)) return 'Completá desde y hasta';
  if (desde && !esFechaISO(desde)) return 'Fecha "desde" inválida';
  if (hasta && !esFechaISO(hasta)) return 'Fecha "hasta" inválida';
  if (desde && hasta && desde > hasta) return '"Hasta" no puede ser anterior a "desde"';
  return null;
};

export function validarConfigTienda(borrador = {}) {
  const b = borrador || {};
  const errores = {};
  const c = b.config || {};
  const color = normalizarHex(c.color);
  const config = {
    nombre: texto(c.nombre, 60),
    logo: c.logo ? urlSegura(c.logo) : null,
    color: color || '',
    bienvenida: texto(c.bienvenida, 1000),
    contacto: texto(c.contacto, 1000),
    whatsapp: soloDigitos(c.whatsapp),
    permitirSinStock: c.permitirSinStock === true,
    limitePorHora: Number(c.limitePorHora),
    destacados: [...new Set((Array.isArray(c.destacados) ? c.destacados : []).map(x => texto(x, 60)).filter(Boolean))],
  };
  if (!config.nombre) errores.nombre = 'Ingresá el nombre de la tienda';
  if (c.logo && !config.logo) errores.logo = 'El logo tiene que ser una URL https';
  if (!color) errores.color = 'Color inválido (formato #RRGGBB)';
  else if (!colorLegible(color)) errores.color = `Poco contraste con el texto blanco (${contraste(color, '#ffffff')}:1, mínimo ${CONTRASTE_MIN}:1). Elegí un color más oscuro`;
  if (config.bienvenida.length > 300) errores.bienvenida = 'Máximo 300 caracteres';
  if (config.contacto.length > 200) errores.contacto = 'Máximo 200 caracteres';
  if (config.whatsapp && (config.whatsapp.length < 8 || config.whatsapp.length > 15)) errores.whatsapp = 'El WhatsApp debe tener entre 8 y 15 dígitos';
  if (!Number.isInteger(config.limitePorHora) || config.limitePorHora < 1 || config.limitePorHora > 1000) errores.limitePorHora = 'Ingresá un número entre 1 y 1000';
  if (config.destacados.length > MAX_DESTACADOS) errores.destacados = `Máximo ${MAX_DESTACADOS} filas de destacados`;

  const bannersIn = Array.isArray(b.banners) ? b.banners : [];
  const banners = [];
  const erroresBanners = [];
  if (bannersIn.length > MAX_BANNERS) errores.banners = `Máximo ${MAX_BANNERS} banners`;
  bannersIn.forEach((x, i) => {
    const e = {};
    const tipo = DESTINOS.includes(x?.destino?.tipo) ? x.destino.tipo : null;
    const valor = texto(x?.destino?.valor, 120);
    const ban = {
      id: x?.id || null,
      orden: i,
      imagen: urlSegura(x?.imagen),
      titulo: texto(x?.titulo, 60),
      subtitulo: texto(x?.subtitulo, 120),
      destino: { tipo: tipo || 'ofertas', valor: tipo === 'ofertas' ? '' : valor },
      desde: x?.desde || null,
      hasta: x?.hasta || null,
      activo: x?.activo !== false,
    };
    if (!ban.imagen) e.imagen = 'Subí una imagen o pegá una URL https';
    if (!tipo) e.destino = 'Elegí a dónde lleva el banner';
    else if (tipo !== 'ofertas' && !valor) e.destino = 'Completá el destino';
    const ev = vigenciaOk(ban.desde, ban.hasta, false);
    if (ev) e.vigencia = ev;
    if (Object.keys(e).length) erroresBanners[i] = e;
    banners.push(ban);
  });
  if (erroresBanners.length) errores.bannersDetalle = erroresBanners;

  const ofertasIn = Array.isArray(b.ofertas) ? b.ofertas : [];
  const ofertas = [];
  const erroresOfertas = [];
  if (ofertasIn.length > MAX_OFERTAS) errores.ofertas = `Máximo ${MAX_OFERTAS} ofertas`;
  ofertasIn.forEach((x, i) => {
    const e = {};
    const pr = precioOpcional(x?.precio);
    const of = {
      id: x?.id || null,
      productoId: x?.productoId === undefined || x?.productoId === null ? '' : String(x.productoId).trim(),
      precio: pr.ok ? pr.valor : null,
      desde: x?.desde || '',
      hasta: x?.hasta || '',
    };
    if (!of.productoId) e.productoId = 'Elegí un producto';
    if (!pr.ok) e.precio = 'Precio de oferta inválido (dejalo vacío o mayor a 0)';
    const ev = vigenciaOk(of.desde, of.hasta, true);
    if (ev) e.vigencia = ev;
    if (Object.keys(e).length) erroresOfertas[i] = e;
    ofertas.push(of);
  });
  if (erroresOfertas.length) errores.ofertasDetalle = erroresOfertas;

  return { ok: Object.keys(errores).length === 0, errores, datos: { config, banners, ofertas } };
}

// Producto de IndexedDB -> forma del catálogo público (vista previa; mismas reglas que tienda_catalogo).
export function catalogoDesdeLocales(productos, stockDe = () => 0, permitirSinStock = false) {
  return (Array.isArray(productos) ? productos : [])
    .filter(p => p && p.visibleTienda !== false && aCentavos(Number(p.precio)) > 0)
    .map(p => ({
      id: p.id,
      codigo: p.codigo || '',
      nombre: p.nombre || '',
      marca: p.marca || '',
      rubro: p.categoria || '',
      imagen: p.imagen_url || null,
      precio: Number(p.precio),
      ventaPor: p.ventaPor,
      bultoX: p.bultoX,
      bultoNombre: p.bultoNombre,
      minimoVenta: p.minimoVenta,
      precioBulto: Number(p.precioBulto) > 0 ? Number(p.precioBulto) : null,
      disponible: !!permitirSinStock || Number(stockDe(p.id)) > 0,
    }));
}
