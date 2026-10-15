// src/domain/pedidosWeb.js — REQ-WEB: bandeja "Pedidos web" (funciones puras).
// Un pedido web es un pedido con origen === 'web'. Mientras no esté 'aceptado'
// NO entra a Armado/Facturación/Comisiones y NO mueve stock (AC-WEB-1).
// Pedidos viejos (sin `origen`) son internos.
import { clienteVacio } from './clientes';
import { texto, soloDigitos, redondear2 } from './validacion';
import { congelarBultosItems, validarMultiplosItems } from './unidadVenta';

export const WEB_ESTADOS = Object.freeze(['por_revisar', 'aceptado', 'rechazado']);
export const MOTIVO_MIN = 3;
export const MOTIVO_MAX = 300;

export const esPedidoWeb = (p) => !!p && p.origen === 'web';

// Pedido web que todavía no fue aceptado (por revisar o rechazado): no entra al flujo.
export const esPedidoWebNoAceptado = (p) => esPedidoWeb(p) && p.webEstado !== 'aceptado';

export const esPedidoWebPendiente = (p) => esPedidoWeb(p) && !p.borrado && (p.webEstado || 'por_revisar') === 'por_revisar';

export const contarPorRevisar = (pedidos) => (Array.isArray(pedidos) ? pedidos : []).filter(esPedidoWebPendiente).length;

// Estado a mostrar en la bandeja. Si hay una acción sin subir, queda "pendiente de subir".
export function estadoBandeja(p, acciones = []) {
  if (!esPedidoWeb(p)) return null;
  const rid = p.remoteId;
  const pend = (Array.isArray(acciones) ? acciones : []).some(a =>
    a && a.pendingSync && rid != null && String(a.pedidoRemoteId) === String(rid));
  if (pend) return 'pendiente_subir';
  return WEB_ESTADOS.includes(p.webEstado) ? p.webEstado : 'por_revisar';
}

const normNombre = (s) => String(s ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9ñ]+/g, ' ').trim();

// Sugiere clientes: CUIT exacto > teléfono (últimos 8 dígitos) > nombre normalizado.
export function sugerirClientes(contacto, clientes, max = 5) {
  const c = contacto || {};
  const cuit = soloDigitos(c.cuit);
  const tel = soloDigitos(c.telefono);
  const tokens = normNombre(c.nombre).split(' ').filter(Boolean);
  const out = [];
  for (const cl of Array.isArray(clientes) ? clientes : []) {
    if (!cl || cl.borrado) continue;
    let score = 0;
    const motivos = [];
    if (cuit.length === 11 && soloDigitos(cl.cuit) === cuit) { score += 100; motivos.push('CUIT'); }
    if (tel.length >= 8) {
      const t2 = soloDigitos(cl.telefono);
      if (t2.length >= 8 && t2.slice(-8) === tel.slice(-8)) { score += 60; motivos.push('Teléfono'); }
    }
    if (tokens.length > 0) {
      const nom = normNombre(cl.nombre);
      const palabras = nom.split(' ');
      if (nom === tokens.join(' ')) { score += 40; motivos.push('Nombre'); }
      else {
        const hit = tokens.filter(t => palabras.includes(t) || (t.length >= 4 && nom.includes(t))).length;
        const ratio = hit / tokens.length;
        if (hit > 0 && ratio >= 0.5) { score += Math.round(30 * ratio); motivos.push('Nombre parecido'); }
      }
    }
    if (score > 0) out.push({ cliente: cl, score, motivos });
  }
  out.sort((a, b) => (b.score - a.score) || String(a.cliente.nombre || '').localeCompare(String(b.cliente.nombre || ''), 'es'));
  return out.slice(0, max);
}

// Vendedor al aceptar: el del link; si no, el de la ficha del cliente; si no, lo elige el admin.
export function vendedorAlAceptar(pedido, cliente, elegido) {
  const link = texto(pedido && (pedido.vendedor || pedido.vendedorNombre), 80);
  if (link) return { vendedor: link, requiereElegir: false };
  const ficha = texto(cliente && cliente.vendedor, 80);
  if (ficha) return { vendedor: ficha, requiereElegir: false };
  const e = texto(elegido, 80);
  if (e) return { vendedor: e, requiereElegir: false };
  return { vendedor: null, requiereElegir: true };
}

export function validarAccionWeb(tipo, datos = {}) {
  const errores = {};
  if (tipo === 'rechazar') {
    const m = texto(datos.motivo, 1000);
    if (m.length < MOTIVO_MIN) errores.motivo = 'El motivo es obligatorio (mínimo 3 letras)';
    else if (m.length > MOTIVO_MAX) errores.motivo = `El motivo admite hasta ${MOTIVO_MAX} caracteres`;
  } else if (tipo === 'aceptar') {
    if (datos.clienteId === undefined || datos.clienteId === null || datos.clienteId === '') errores.clienteId = 'Vinculá o creá un cliente';
    if (!texto(datos.vendedor, 80)) errores.vendedor = 'Elegí el vendedor';
  } else {
    errores.tipo = 'Acción inválida';
  }
  return { ok: Object.keys(errores).length === 0, errores };
}

// Formulario REQ-CLI precargado con los datos del pedido (sin código: lo carga el admin).
export function clienteDesdeContacto(contacto, { vendedor = '', now = new Date() } = {}) {
  const c = contacto || {};
  return {
    ...clienteVacio(now),
    nombre: texto(c.nombre, 120),
    direccion: texto(c.direccion, 160),
    ciudad: texto(c.ciudad, 80),
    codigoPostal: texto(c.cp, 10),
    provincia: texto(c.provincia, 40),
    cuit: texto(c.cuit, 20),
    telefono: soloDigitos(c.telefono).slice(0, 15),
    vendedor: texto(vendedor, 80),
  };
}

const parseContacto = (v) => {
  if (v && typeof v === 'object') return v;
  if (typeof v === 'string') { try { const o = JSON.parse(v); return o && typeof o === 'object' ? o : null; } catch { return null; } }
  return null;
};
const ms = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? t : null; };

// Lectura tolerante de columnas web_* (si no existen en Supabase, se conserva lo local).
export function pedidoWebFromRemote(r = {}, local = null) {
  const l = local || {};
  const pick = (col, key, conv = (x) => x) => (r[col] !== undefined ? conv(r[col] ?? null) : (l[key] ?? null));
  const origen = r.origen !== undefined ? (r.origen || 'interna') : (l.origen || 'interna');
  const out = { origen };
  if (origen === 'web' || r.web_estado !== undefined || l.webEstado !== undefined) {
    out.webEstado = pick('web_estado', 'webEstado');
    out.webContacto = pick('web_contacto', 'webContacto', parseContacto);
    out.webRevisadoPor = pick('web_revisado_por', 'webRevisadoPor');
    out.webRevisadoAt = pick('web_revisado_at', 'webRevisadoAt', (x) => (x ? ms(x) : null));
    out.webMotivoRechazo = pick('web_motivo_rechazo', 'webMotivoRechazo');
  }
  if (r.idempotencia !== undefined) out.idempotencia = r.idempotencia;
  return out;
}

// Parámetros de la RPC admin_resolver_pedido_web. El PIN no se guarda en la acción.
export function accionWebToRpc(a, cred) {
  const x = a || {};
  const datos = x.tipo === 'aceptar'
    ? { cliente_id: x.clienteId ?? null, cliente_nombre: x.clienteNombre ?? '', zona: x.zona ?? '', vendedor: x.vendedor ?? '', items: x.items ?? [], total: x.total ?? 0 }
    : { motivo: x.motivo ?? '' };
  return {
    p_admin_id: cred && cred.adminId,
    p_admin_pin: cred && cred.pin,
    p_pedido_id: x.pedidoRemoteId === undefined || x.pedidoRemoteId === null ? null : String(x.pedidoRemoteId),
    p_accion_id: x.id,
    p_tipo: x.tipo,
    p_datos: { ...datos, por: x.por ?? '' },
  };
}

// AC-WEB-5: historial filtrable. estado: 'por_revisar' | 'aceptado' | 'rechazado' | 'todos'.
export function filtrarHistorialWeb(pedidos, estado = 'todos') {
  const lista = (Array.isArray(pedidos) ? pedidos : []).filter(p => esPedidoWeb(p) && !p.borrado);
  const filtrada = estado === 'todos' ? lista : lista.filter(p => (WEB_ESTADOS.includes(p.webEstado) ? p.webEstado : 'por_revisar') === estado);
  return filtrada.sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')) || ((b.createdAt || 0) - (a.createdAt || 0)));
}

// AC-WEB-2: renglones editados al aceptar. Quita los de cantidad 0, recalcula
// subtotales y total (en centavos), congela bultos y avisa múltiplos (AC-VTA-3:
// el admin puede guardar igual en Facturación).
export function armarItemsAceptar(items, productosById = new Map(), { previos } = {}) {
  const limpios = [];
  for (const it of Array.isArray(items) ? items : []) {
    if (!it || typeof it !== 'object') continue;
    const cantidad = Number(it.cantidad);
    const precio = Number(it.precio);
    if (!Number.isInteger(cantidad) || cantidad < 1 || !Number.isFinite(precio) || precio < 0) continue;
    limpios.push({ ...it, cantidad, precio, subtotal: redondear2(Math.round(precio * 100) * cantidad / 100) });
  }
  const conBultos = congelarBultosItems(limpios, productosById, { previos });
  const total = redondear2(conBultos.reduce((a, it) => a + Math.round(it.precio * 100) * it.cantidad, 0) / 100);
  const multiplos = validarMultiplosItems(conBultos, productosById, { permiso: 1, pantalla: 'facturacion', previos });
  return { items: conBultos, total, avisos: multiplos.avisos, bloquea: multiplos.bloquea };
}
