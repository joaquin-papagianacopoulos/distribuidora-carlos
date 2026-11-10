// src/domain/permisos.js — roles y PIN (AC-SEC-4, S-COM-01, S-COM-11).
// Lógica pura: sin React, sin IndexedDB, sin Supabase.

export const ROLES = Object.freeze({ ADMIN: 1, VENDEDOR: 2, ARMADOR: 3 });
const VALIDOS = new Set(Object.values(ROLES));

// S-COM-11: permiso entero validado. Solo el NÚMERO 1, 2 o 3; cualquier otra
// cosa ("1" en texto, 1.5, true, [1], 99, NaN) da null y no habilita nada.
// La sesión (useAppContext) ya normaliza con Number() contra la base local,
// así que los permisos legítimos siempre llegan como número.
export const permisoValido = (permiso) =>
  (typeof permiso === 'number' && Number.isInteger(permiso) && VALIDOS.has(permiso) ? permiso : null);

export const esAdmin = (permiso) => permisoValido(permiso) === ROLES.ADMIN;
export const esArmador = (permiso) => permisoValido(permiso) === ROLES.ARMADOR;

// S-COM-01: PIN que tipea el admin para confirmar/anular un cierre. Se valida
// la forma acá; la verificación real la hace el servidor (verificar_pin). El
// PIN no se guarda en ningún lado: viaja solo en la llamada a la RPC.
export const MAX_PIN = 32;
export const validarPinIngresado = (pin) => {
  if (typeof pin !== 'string' && typeof pin !== 'number') return { ok: false, pin: null, error: 'Ingresá tu PIN de admin' };
  const p = String(pin).trim();
  if (!p) return { ok: false, pin: null, error: 'Ingresá tu PIN de admin' };
  // eslint-disable-next-line no-control-regex
  if (p.length > MAX_PIN || /[\u0000-\u001F\u007F]/.test(p)) return { ok: false, pin: null, error: 'PIN inválido' };
  return { ok: true, pin: p, error: null };
};

// ---------------------------------------------------------------------------
// REQ-EDP / REQ-ASV (Tanda 1): quién edita un pedido y quién asigna vendedor.
// ---------------------------------------------------------------------------
const nombreClave = (v) => (typeof v === 'string' ? v.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase() : '');
const esFacturado = (p) => String((p && p.estado) || '').toLowerCase() === 'facturado';
const esBorrado = (p) => !!p && (p.borrado === true || ['cancelado', 'eliminado', 'borrado'].includes(String(p.estado || '').toLowerCase()));
const esWebNoAceptado = (p) => !!p && p.origen === 'web' && p.webEstado !== 'aceptado';

// AC-EDP-1/3: { ok, pantalla, motivo }. El admin edita todo (facturado por Facturación,
// como hoy); el vendedor solo sus pedidos (dueño o quien los cargó) no facturados;
// el armador y los permisos inválidos, nunca.
// T1-A-05: el vendedor no edita pedidos ya entregados ni con comisiones cerradas (`cerradoEn` = id del cierre vigente).
export function puedeEditarPedido(usuario, pedido, { cerradoEn = null } = {}) {
  const no = (motivo) => ({ ok: false, pantalla: null, motivo });
  const permiso = permisoValido(usuario && usuario.permiso);
  if (permiso === null || !pedido || typeof pedido !== 'object') return no('Sin permiso para editar pedidos');
  if (esBorrado(pedido)) return no('El pedido está eliminado');
  if (esWebNoAceptado(pedido)) return no('El pedido web todavía no fue aceptado');
  if (permiso === ROLES.ADMIN) return { ok: true, pantalla: esFacturado(pedido) ? 'facturacion' : 'pedido', motivo: null };
  if (permiso !== ROLES.VENDEDOR) return no('Sin permiso para editar pedidos');
  if (esFacturado(pedido)) return no('El pedido ya está facturado');
  if (pedido.entregado === true) return no('El pedido ya fue entregado');
  if (cerradoEn !== null && cerradoEn !== undefined && cerradoEn !== '') return no('El pedido está en un cierre de comisiones');
  const yo = nombreClave(usuario && usuario.nombre);
  if (!yo) return no('Sin permiso para editar pedidos');
  const suyo = [pedido.vendedor, pedido.vendedorNombre, pedido.cargadoPor].some(n => nombreClave(n) === yo);
  return suyo ? { ok: true, pantalla: 'pedido', motivo: null } : no('Solo podés editar tus pedidos');
}

// AC-ASV-1/2: el admin asigna siempre (los web no aceptados solo desde la bandeja);
// el vendedor solo al crear el pedido (`alCrear`).
export function puedeAsignarVendedor(usuario, pedido, { alCrear = false } = {}) {
  const permiso = permisoValido(usuario && usuario.permiso);
  if (permiso === null) return false;
  if (alCrear) return permiso === ROLES.ADMIN || permiso === ROLES.VENDEDOR;
  if (permiso !== ROLES.ADMIN || !pedido || typeof pedido !== 'object') return false;
  if (esBorrado(pedido) || esWebNoAceptado(pedido)) return false;
  return true;
}
