// src/domain/rubros.js — REQ-COMR (AC-COMR-3, 4, 5, 6, 7, 8, 15).
// Lógica pura de rubros y de la tabla de % por vendedor y rubro: sin React,
// sin IndexedDB, sin Supabase. La UI, el servicio y el sync solo la invocan.
//
// Rubro = producto.categoria (campo legacy, regla dura 3). Se compara por una
// CLAVE (sin mayúsculas, sin tildes, espacios colapsados) y se muestra con la
// escritura original del rubro que ya existía.
import { texto, nuevoId } from './validacion';
import { claveNombreVendedor } from './vendedores';

const MAX_RUBRO = 60;
const MAX_NOMBRE = 80;
const MAX_ID = 64;

// Tabla EXPLÍCITA de acentos (no NFD): la migración 005 replica la clave con
// translate() usando EXACTAMENTE estas dos cadenas (lo verifica un test), sin
// depender de la extensión unaccent de Postgres.
export const ACENTOS_DESDE = 'áàâäãåéèêëíìîïóòôöõúùûüñçÁÀÂÄÃÅÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÑÇ';
export const ACENTOS_HASTA = 'aaaaaaeeeeiiiiooooouuuuncAAAAAAEEEEIIIIOOOOOUUUUNC';

const MAPA_ACENTOS = new Map([...ACENTOS_DESDE].map((c, i) => [c, ACENTOS_HASTA[i]]));

const esEscalar = (v) => typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v));

// Escritura visible: recorta, colapsa espacios y quita caracteres de control.
// S-COMR-04 / QA-1: se normaliza Unicode a NFC (la tilde combinante de Excel o
// Mac, "a" + U+0301, es el mismo rubro que "á"). La 005 hace lo mismo con
// normalize(..., NFC) en rubro_normalizado().
export const normalizarRubro = (v) => (esEscalar(v) ? texto(String(v).normalize('NFC'), MAX_RUBRO) : '');

// Clave de comparación: "golosinas", "Golosinas " y "GOLOSINAS" dan lo mismo.
export const claveRubro = (v) => [...normalizarRubro(v)].map(c => MAPA_ACENTOS.get(c) || c).join('').toLowerCase();

const ordenAntiguedad = (a, b) => {
  const ca = Number(a?.createdAt);
  const cb = Number(b?.createdAt);
  const va = Number.isFinite(ca) ? ca : Number.MAX_SAFE_INTEGER;
  const vb = Number.isFinite(cb) ? cb : Number.MAX_SAFE_INTEGER;
  if (va !== vb) return va - vb;
  return String(a?.id ?? '').localeCompare(String(b?.id ?? ''));
};

const porClave = (a, b) => a.localeCompare(b, 'es');

// Rubros distintos (por clave) de los productos + extras. La escritura es la
// del producto más viejo (createdAt, después id). Orden alfabético.
export const listarRubros = (productos, extras = [], { campo = 'categoria' } = {}) => {
  const m = new Map();
  const lista = (Array.isArray(productos) ? productos : []).filter(p => p && typeof p === 'object');
  for (const p of [...lista].sort(ordenAntiguedad)) {
    const r = normalizarRubro(p[campo]);
    const k = claveRubro(r);
    if (k && !m.has(k)) m.set(k, r);
  }
  for (const e of Array.isArray(extras) ? extras : []) {
    const r = normalizarRubro(e);
    const k = claveRubro(r);
    if (k && !m.has(k)) m.set(k, r);
  }
  return [...m.keys()].sort(porClave).map(k => m.get(k));
};

// AC-COMR-4: si la clave ya existe se reutiliza la escritura existente.
export const resolverRubro = (valor, existentes = []) => {
  const r = normalizarRubro(valor);
  const k = claveRubro(r);
  if (!k) return { rubro: '', clave: '', esNuevo: false };
  const previo = (Array.isArray(existentes) ? existentes : []).find(e => claveRubro(e) === k);
  if (previo !== undefined) return { rubro: normalizarRubro(previo), clave: k, esNuevo: false };
  return { rubro: r, clave: k, esNuevo: true };
};

export const rubroDeProducto = (p) => normalizarRubro(p?.categoria);

const getProducto = (productosById, id) => {
  if (!productosById || typeof productosById.get !== 'function') return undefined;
  return productosById.get(String(id));
};

// AC-COMR-5: rubro efectivo de un renglón. El guardado en el renglón manda; si
// no hay (pedido viejo), el rubro ACTUAL del producto; si el producto ya no
// existe, sin rubro.
export const rubroDeRenglon = (item, productosById) => {
  const propio = normalizarRubro(item?.rubro);
  if (propio) return { rubro: propio, clave: claveRubro(propio), origen: 'renglon' };
  const pid = item?.productoId;
  if (pid === null || pid === undefined || pid === '') return { rubro: '', clave: '', origen: 'sin_rubro' };
  const p = getProducto(productosById, pid);
  if (!p) return { rubro: '', clave: '', origen: 'producto_borrado' };
  const r = rubroDeProducto(p);
  return r ? { rubro: r, clave: claveRubro(r), origen: 'producto' } : { rubro: '', clave: '', origen: 'sin_rubro' };
};

// ---------------------------------------------------------------------------
// % por vendedor y rubro (AC-COMR-6)
// ---------------------------------------------------------------------------
export const MSG_PCT_INVALIDO = 'Ingresá un % entre 0 y 100, con hasta 2 decimales';

// '' / null / solo espacios = sin % (null). Acepta coma decimal. "1.000" es
// ambiguo (¿mil o uno?) y se rechaza.
export const validarPctRubro = (v) => {
  if (v === null || v === undefined) return { ok: true, pct: null, error: null };
  let n;
  if (typeof v === 'string') {
    const s = v.trim();
    if (s === '') return { ok: true, pct: null, error: null };
    if (!/^\d{1,3}([.,]\d{1,2})?$/.test(s)) return { ok: false, pct: null, error: MSG_PCT_INVALIDO };
    n = Number(s.replace(',', '.'));
  } else if (typeof v === 'number') {
    if (!Number.isFinite(v) || Math.abs(v * 100 - Math.round(v * 100)) > 1e-7) return { ok: false, pct: null, error: MSG_PCT_INVALIDO };
    n = v;
  } else {
    return { ok: false, pct: null, error: MSG_PCT_INVALIDO };
  }
  if (n < 0 || n > 100) return { ok: false, pct: null, error: MSG_PCT_INVALIDO };
  return { ok: true, pct: Math.round(n * 100) / 100, error: null };
};

const idTexto = (v) => (esEscalar(v) ? texto(v, MAX_ID) : '');
const claveDeFila = (f) => (f?.rubroClave ? claveRubro(f.rubroClave) : claveRubro(f?.rubro));

// Map<vendedorId, Map<clave, fila>>. Ignora las obsoletas y (salvo que se pida)
// las que el servidor rechazó; si hay dos filas con la misma clave gana la de
// editadoAt mayor.
export const indexarTablaRubros = (filas, { incluirRechazadas = false } = {}) => {
  const out = new Map();
  for (const f of Array.isArray(filas) ? filas : []) {
    if (!f || typeof f !== 'object' || f.obsoleto) continue;
    if (f.syncRechazo && !incluirRechazadas) continue;
    const vid = idTexto(f.vendedorId);
    const k = claveDeFila(f);
    if (!vid || !k) continue;
    if (!out.has(vid)) out.set(vid, new Map());
    const m = out.get(vid);
    const previa = m.get(k);
    if (!previa || (Number(f.editadoAt) || 0) > (Number(previa.editadoAt) || 0)) m.set(k, f);
  }
  return out;
};

// % del vendedor para el rubro, o null (sin fila, vaciado o inválido).
export const pctDe = (indice, vendedorId, clave) => {
  if (!indice || typeof indice.get !== 'function') return null;
  const fila = indice.get(String(vendedorId))?.get(clave);
  if (!fila) return null;
  const v = validarPctRubro(fila.pct);
  return v.ok ? v.pct : null;
};

// Alta/edición local de un %: reutiliza el id de la fila con la misma clave.
export const upsertPctLocal = (filas, entrada = {}, { now = Date.now(), genId = nuevoId } = {}) => {
  const { vendedorId, vendedorNombre, rubro, pct, editadoPor } = entrada || {};
  const vid = idTexto(vendedorId);
  if (!vid) return { ok: false, fila: null, nueva: false, error: 'El vendedor todavía no está sincronizado' };
  const r = normalizarRubro(rubro);
  if (!r) return { ok: false, fila: null, nueva: false, error: 'Falta el rubro' };
  const v = validarPctRubro(pct);
  if (!v.ok) return { ok: false, fila: null, nueva: false, error: v.error };
  const k = claveRubro(r);
  const existente = (Array.isArray(filas) ? filas : [])
    .find(f => f && !f.obsoleto && idTexto(f.vendedorId) === vid && claveDeFila(f) === k);
  const fila = {
    ...(existente || {}),
    id: existente?.id ?? genId(),
    vendedorId: vid,
    vendedorNombre: texto(vendedorNombre, MAX_NOMBRE),
    rubro: existente ? (normalizarRubro(existente.rubro) || r) : r,
    rubroClave: k,
    clave: `${vid}|${k}`,
    pct: v.pct,
    editadoAt: now,
    editadoPor: texto(editadoPor, MAX_NOMBRE),
    pendingSync: true,
    syncRechazo: null,
    updatedAt: now,
  };
  return { ok: true, fila, nueva: !existente, error: null };
};

// Filas de la grilla Rubro -> % de un vendedor: todos los rubros existentes más
// los que ya estaban en su tabla (aunque hoy ningún producto los use).
export const filasGrillaVendedor = ({ vendedorId, rubros = [], filas = [] } = {}) => {
  const vid = idTexto(vendedorId);
  const propias = (Array.isArray(filas) ? filas : []).filter(f => f && !f.obsoleto && vid && idTexto(f.vendedorId) === vid);
  const indice = indexarTablaRubros(propias, { incluirRechazadas: true }).get(vid) || new Map();
  const m = new Map();
  for (const r of Array.isArray(rubros) ? rubros : []) {
    const k = claveRubro(r);
    if (k && !m.has(k)) m.set(k, normalizarRubro(r));
  }
  for (const [k, f] of indice) if (!m.has(k)) m.set(k, normalizarRubro(f.rubro) || k);
  return [...m.keys()].sort(porClave).map(k => {
    const f = indice.get(k);
    const v = f ? validarPctRubro(f.pct) : { ok: true, pct: null };
    return {
      rubro: m.get(k),
      clave: k,
      pct: v.ok ? v.pct : null,
      filaId: f?.id ?? null,
      pendiente: !!f?.pendingSync,
      rechazo: f?.syncRechazo || null,
    };
  });
};

const aIso = (ms) => {
  const n = Number(ms);
  if (!Number.isFinite(n)) return null;
  const d = new Date(n);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

export const filaRubroToRemote = (f) => ({
  id: idTexto(f?.id),
  vendedor_id: idTexto(f?.vendedorId),
  rubro: normalizarRubro(f?.rubro),
  rubro_clave: claveDeFila(f),
  pct: validarPctRubro(f?.pct).ok ? validarPctRubro(f?.pct).pct : null,
  editado_at: aIso(f?.editadoAt) || aIso(Date.now()),
});

const parseFecha = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Date.parse(v);
  return Number.isFinite(n) ? n : null;
};

export const filaRubroFromRemote = (r, local = null) => {
  const vid = idTexto(r?.vendedor_id);
  const rubro = normalizarRubro(r?.rubro);
  const k = r?.rubro_clave ? claveRubro(r.rubro_clave) : claveRubro(rubro);
  const v = validarPctRubro(r?.pct);
  return {
    ...(local || {}),
    id: idTexto(r?.id),
    vendedorId: vid,
    vendedorNombre: local?.vendedorNombre || '',
    rubro,
    rubroClave: k,
    clave: `${vid}|${k}`,
    pct: v.ok ? v.pct : null,
    editadoAt: parseFecha(r?.editado_at) ?? local?.editadoAt ?? null,
    editadoPor: r?.editado_por ?? local?.editadoPor ?? '',
    pendingSync: false,
    obsoleto: false,
    syncRechazo: null,
  };
};

// Mezcla lo que bajó del servidor con lo local, sin borrar nada:
// - una local con pendingSync no se pisa;
// - una local (no pendiente) con la misma clave que una remota de OTRO id queda
//   obsoleta (duplicado de otro dispositivo; R1 del plan).
export const mezclarTablaRubros = (locales, remotos) => {
  const ls = (Array.isArray(locales) ? locales : []).filter(f => f && typeof f === 'object');
  const porId = new Map(ls.map(f => [String(f.id), f]));
  const aGuardar = [];
  const clavesRemotas = new Map();
  for (const r of Array.isArray(remotos) ? remotos : []) {
    if (!r || typeof r !== 'object') continue;
    const id = idTexto(r.id);
    if (!id) continue;
    const local = porId.get(id);
    const f = filaRubroFromRemote(r, local);
    if (!f.vendedorId || !f.rubroClave) continue;
    clavesRemotas.set(f.clave, id);
    if (local?.pendingSync) continue;
    aGuardar.push(f);
  }
  const obsoletos = [];
  for (const l of ls) {
    if (l.pendingSync || l.obsoleto) continue;
    const k = `${idTexto(l.vendedorId)}|${claveDeFila(l)}`;
    const idRemoto = clavesRemotas.get(k);
    if (idRemoto && idRemoto !== String(l.id)) obsoletos.push({ ...l, obsoleto: true });
  }
  return { aGuardar, obsoletos };
};

// ---------------------------------------------------------------------------
// Respuesta de la RPC admin_guardar_comisiones_rubro / admin_leer_comisiones_rubro
// ---------------------------------------------------------------------------
export const MSG_FALTA_MIGRACION_005 = 'Falta la migración 005 en Supabase: los % quedan en este dispositivo.';
export const MENSAJES_RUBRO = Object.freeze({
  no_autorizado: 'PIN incorrecto o tu usuario no está autorizado como admin en el servidor.',
  pin_bloqueado: 'Demasiados intentos de PIN. Probá de nuevo en 15 minutos.',
  falta_migracion: MSG_FALTA_MIGRACION_005,
  red: 'Sin respuesta del servidor: los % quedaron pendientes en este dispositivo.',
  vendedor_inactivo: 'El vendedor está dado de baja: no se le pueden cambiar los %.',
  vendedor_inexistente: 'El vendedor no existe en el servidor.',
  id_en_uso: 'Ese registro ya existe en el servidor con otro vendedor o rubro.',
  fila_invalida: 'El servidor rechazó el % (dato inválido).',
});

export const esFaltaMigracionRpc = (error) => {
  const code = String(error?.code || '');
  return ['PGRST202', '42883', '42P01', 'PGRST205'].includes(code) ||
    /could not find the function|could not find the table|relation .* does not exist/i.test(String(error?.message || ''));
};

const esRed = (error) => !error?.code || /failed to fetch|network|timeout|load failed/i.test(String(error?.message || ''));

const motivoConocido = (m) => (typeof m === 'string' && Object.prototype.hasOwnProperty.call(MENSAJES_RUBRO, m) ? m : null);

export const interpretarGuardarRubros = ({ data, error } = {}) => {
  const fallo = (motivo) => ({ ok: false, aceptados: [], rechazados: [], motivo, mensaje: MENSAJES_RUBRO[motivo] });
  if (error) {
    if (esFaltaMigracionRpc(error)) return fallo('falta_migracion');
    if (/demasiados intentos/i.test(String(error?.message || ''))) return fallo('pin_bloqueado');
    if (esRed(error)) return fallo('red');
    return { ...fallo('no_autorizado'), motivo: 'error', mensaje: `El servidor rechazó los %: ${texto(error.message || error.code, 200)}` };
  }
  if (!data || typeof data !== 'object' || data.ok !== true) return fallo(motivoConocido(data?.motivo) || 'no_autorizado');
  const aceptados = (Array.isArray(data.filas) ? data.filas : [])
    .filter(r => r && typeof r === 'object' && idTexto(r.id))
    .map(r => ({ idEnviado: idTexto(r.id_enviado ?? r.id), fila: filaRubroFromRemote(r) }));
  const rechazados = (Array.isArray(data.rechazadas) ? data.rechazadas : [])
    .filter(r => r && typeof r === 'object' && idTexto(r.id))
    .map(r => {
      const m = motivoConocido(r.motivo) || 'fila_invalida';
      return { id: idTexto(r.id), motivo: m, mensaje: MENSAJES_RUBRO[m] };
    });
  return { ok: true, aceptados, rechazados, motivo: null, mensaje: null };
};

// ---------------------------------------------------------------------------
// Identidad estable del vendedor (AC-COMR-8): String(remoteId).
// Busca en la lista COMPLETA (activos y dados de baja).
// ---------------------------------------------------------------------------
export const vendedorIdPorNombre = (nombre, vendedores) => {
  const k = claveNombreVendedor(nombre);
  if (!k) return null;
  const v = (Array.isArray(vendedores) ? vendedores : []).find(x => x && claveNombreVendedor(x.nombre) === k);
  const rid = v?.remoteId;
  return rid === null || rid === undefined || rid === '' ? null : String(rid);
};
