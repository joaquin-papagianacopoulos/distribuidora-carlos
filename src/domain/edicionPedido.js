// src/domain/edicionPedido.js — REQ-EDP: editar un pedido ya enviado.
// Funciones puras: sin React, sin IndexedDB, sin Supabase.
import { texto } from './validacion';
import { cambiosDeCantidad } from './armado';
import { permisoValido, ROLES } from './permisos';
import { precioConEscala, precioMinimoRenglon, normalizarEscalasBulto, precioDeEscala, camposEscala, escalaDeRenglon } from './precios';
import { normalizarBultoX } from './bultos';

export const MAX_IDS_MODIFICADO = 500;
export const MAX_ID_MODIFICADO = 64;

const lista = (v) => (Array.isArray(v) ? v : []);
const idDe = (it) => (it && it.productoId !== undefined && it.productoId !== null && it.productoId !== '' ? String(it.productoId) : null);

// AC-EDP-2: ¿el armado ya empezó o terminó? (armado true, o algo tildado/sacado/cambiado).
export function armadoEmpezado(pedido) {
  if (!pedido || typeof pedido !== 'object') return false;
  if (pedido.armado === true) return true;
  const log = pedido.armadoLog;
  if (!log || typeof log !== 'object') return false;
  return lista(log.confirmados).length > 0 || lista(log.removidos).length > 0 || lista(log.cambios).length > 0;
}

// AC-EDP-2: qué renglones cambiaron entre dos listas ({ agregados, quitados, cambiados } de productoId).
export function renglonesCambiados(antes, despues) {
  const ids = (l) => new Set(lista(l).filter(i => i && !i.eliminado).map(idDe).filter(Boolean));
  const a = ids(antes);
  const d = ids(despues);
  const agregados = [...d].filter(k => !a.has(k));
  const quitados = [...a].filter(k => !d.has(k));
  const cambiados = cambiosDeCantidad(antes, despues).map(c => c.productoId).filter(k => a.has(k) && d.has(k));
  return { agregados, quitados, cambiados };
}

const totalDe = (items) => Math.round(lista(items).reduce((acc, i) => acc + (Number(i && i.cantidad) || 0) * (Number(i && i.precio) || 0), 0) * 100) / 100;

// T1-A-02: solo el admin toca precios. Para el resto, el precio de cada renglon sale de los precios
// CONGELADOS (renglon existente) o del catalogo (renglon nuevo, si se pasa productosById): se ignoran
// precioManual/descuentoPct y cualquier "precio" tipeado. Unica excepcion: un renglon combinable por grupo
// (grupoBulto) puede tener un precio entre el de bulto y el de lista (lo re-precia la regla de grupo).
// REQ-ESC: escalas normalizadas; sin bulto usable no hay escalas.
const escalasDe = (raw, bultoX) => (normalizarBultoX(bultoX) === null ? [] : normalizarEscalasBulto(raw));

const refPrecio = (it, o, prod) => {
  if (o) {
    const ref = { precioOriginal: Number(o.precioOriginal ?? o.precio) || 0, precioBultoOriginal: Number(o.precioBultoOriginal) || 0, precioBultoX: o.precioBultoX, escalasBulto: escalasDe(o.escalasBulto, o.precioBultoX) };
    if (o.precioManual === true || Number(o.descuentoPct) > 0) return { fijo: o.precio, ref };
    return { ref };
  }
  if (prod) return { ref: { precioOriginal: Number(prod.precio) || 0, precioBultoOriginal: Number(prod.precioBulto) || 0, precioBultoX: prod.bultoX, escalasBulto: escalasDe(prod.escalasBulto, prod.bultoX) } };
  return { ref: { precioOriginal: Number(it.precioOriginal ?? it.precio) || 0, precioBultoOriginal: Number(it.precioBultoOriginal) || 0, precioBultoX: it.precioBultoX, escalasBulto: escalasDe(it.escalasBulto, it.precioBultoX) } };
};

const congelarPrecios = (itemsNuevos, itemsOriginales, productosById) => {
  const antes = new Map(lista(itemsOriginales).map(i => [idDe(i), i]));
  return lista(itemsNuevos).map((it) => {
    const k = idDe(it);
    const o = antes.get(k);
    const prod = productosById instanceof Map && k !== null ? productosById.get(k) : null;
    const { fijo, ref } = refPrecio(it, o, prod);
    // REQ-ESC: escalaDesde/escalaPct del cliente nunca se usan: se recalculan abajo.
    const { precioManual: _pm, descuentoPct: _dp, escalaDesde: _ed, escalaPct: _ep, escalaPrecio: _epr, escalasBulto: _eb, ...base } = it;
    const limpio = { ...base, precioOriginal: ref.precioOriginal };
    if (Number(ref.precioBultoOriginal) > 0) { limpio.precioBultoOriginal = ref.precioBultoOriginal; limpio.precioBultoX = ref.precioBultoX; }
    if (ref.escalasBulto.length > 0) { limpio.escalasBulto = ref.escalasBulto; limpio.precioBultoX = ref.precioBultoX; }
    if (fijo !== undefined) {
      return {
        ...limpio, precio: fijo, precioManual: o.precioManual, descuentoPct: o.descuentoPct, precioPorBulto: o.precioPorBulto,
        ...camposEscala(escalaDeRenglon(o)),
      };
    }
    const cant = Number(it.cantidad) || 0;
    const refCalc = { precio: ref.precioOriginal, precioBulto: ref.precioBultoOriginal, bultoX: ref.precioBultoX, escalasBulto: ref.escalasBulto };
    const aplicado = precioConEscala(refCalc, cant);
    let precio = aplicado.precio;
    let escala = aplicado.escala || null;
    const conBulto = Number(ref.precioBultoOriginal) > 0;
    if (it.grupoBulto && (conBulto || ref.escalasBulto.length > 0)) {
      const piso = precioMinimoRenglon(ref);
      const pedido = Number(it.precio);
      if (Number.isFinite(pedido) && pedido >= piso - 0.005 && pedido <= precio + 0.005) {
        precio = pedido;
        // La escala se deduce del precio aceptado (el total del grupo no se conoce acá).
        escala = null;
        const bx = normalizarBultoX(ref.precioBultoX);
        const baseBulto = conBulto && bx !== null ? Math.min(ref.precioOriginal, ref.precioBultoOriginal) : ref.precioOriginal;
        for (const e of ref.escalasBulto) {
          if (precioDeEscala(baseBulto, e) === Math.round(pedido * 100) / 100) escala = e;
        }
      }
    }
    const out = { ...limpio, precio };
    if (conBulto) out.precioPorBulto = aplicado.porBulto;
    if (escala) Object.assign(out, camposEscala(escala));
    return out;
  });
};

const unirIds = (a, b) => [...new Set([...lista(a), ...lista(b)].map(String))].slice(0, MAX_IDS_MODIFICADO);

// AC-EDP-1/2/3: el pedido editado. Mismo id / remoteId / clientUuid (no se duplica). Whitelist: solo
// items, total y observaciones; vendedor, estado, fecha, armado, etc. quedan como estaban.
// `baseRemoteUpdatedAt` = versión del servidor sobre la que se editó (AC-EDP-3).
export function aplicarEdicion(original, { items, total, observaciones } = {}, { usuario, now = Date.now(), productosById = null } = {}) {
  if (!original || typeof original !== 'object') return original;
  const esAdmin = permisoValido(usuario && usuario.permiso) === ROLES.ADMIN;
  const nuevos = lista(items);
  const finales = esAdmin ? nuevos : congelarPrecios(nuevos, original.items, productosById);
  const out = {
    ...original,
    items: finales,
    total: totalDe(finales),
    observaciones: observaciones !== undefined ? String(observaciones ?? '') : (original.observaciones ?? ''),
    baseRemoteUpdatedAt: original.remoteUpdatedAt ?? null,
    updatedAt: now,
  };
  if (total !== undefined && Number.isFinite(Number(total)) && esAdmin && Math.abs(Number(total) - out.total) < 0.005) out.total = Number(total);
  if (armadoEmpezado(original)) {
    const c = renglonesCambiados(original.items, finales);
    const ids = [...c.agregados, ...c.quitados, ...c.cambiados];
    if (ids.length > 0) {
      const previa = original.modificadoTrasArmado;
      out.modificadoTrasArmado = {
        at: now,
        por: texto(usuario && usuario.nombre, 80),
        productoIds: unirIds(previa && previa.productoIds, ids),
      };
    }
  }
  return out;
}

// AC-EDP-2: el armador confirma los cambios y la marca se va.
export function confirmarModificacion(pedido, usuario, now = Date.now()) {
  if (!pedido || typeof pedido !== 'object') return pedido;
  return { ...pedido, modificadoTrasArmado: null, updatedAt: now };
}

// AC-EDP-3: ¿el servidor tiene una versión distinta de la que se abrió? base null = pedido viejo/offline => no hay conflicto.
export function hayConflictoVersion(base, actual) {
  if (base === null || base === undefined || base === '') return false;
  if (actual === null || actual === undefined || actual === '') return false;
  const b = typeof base === 'number' ? base : Date.parse(base);
  const a = typeof actual === 'number' ? actual : Date.parse(actual);
  if (!Number.isFinite(b) || !Number.isFinite(a)) return String(base) !== String(actual);
  return a !== b;
}

// ---- Sync (migración 024) ----
export function modificadoToRemote(p) {
  if (!p || p.modificadoTrasArmado === undefined) return {};
  const m = p.modificadoTrasArmado;
  if (m === null) return { modificado_tras_armado: null };
  const s = sanear(m);
  return { modificado_tras_armado: s };
}

function sanear(m) {
  if (!m || typeof m !== 'object') return null;
  const at = Number(m.at);
  const ids = lista(m.productoIds).map(x => String(x).slice(0, MAX_ID_MODIFICADO)).filter(Boolean).slice(0, MAX_IDS_MODIFICADO);
  return { at: Number.isFinite(at) ? at : 0, por: texto(m.por, 80), productoIds: ids };
}

// Lo que vuelve de Supabase es dato no confiable: se sanea. `undefined` (columna inexistente)
// conserva lo local; null lo limpia.
export function modificadoFromRemote(r, local) {
  if (!r || r.modificado_tras_armado === undefined) return local ? local.modificadoTrasArmado : undefined;
  if (r.modificado_tras_armado === null) return null;
  return sanear(r.modificado_tras_armado);
}
