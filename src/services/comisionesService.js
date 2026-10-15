// src/services/comisionesService.js — REQ-COM (AC-COM-9, 10, 11, 12, 16).
// Orquesta dominio (src/domain/comisiones.js), IndexedDB y Supabase.
//
// Offline-first: el borrador vive en IndexedDB y el cierre se guarda local con
// su UUID ANTES de llamar a la red. Pero la decisión de cerrar/anular la valida
// el servidor con una RPC atómica (índice único parcial): así dos admins en dos
// dispositivos no pueden dejar un pedido en dos cierres vigentes (AC-COM-16).
// Supuesto 1 del plan: confirmar y anular requieren conexión.
//
// S-COM-01 (iteración 2): las RPC piden el id remoto del admin + su PIN, que
// verifica el servidor. El PIN llega como parámetro, viaja SOLO en la llamada
// a la RPC y no se guarda (ni en IndexedDB, ni en localStorage, ni en la
// sesión) ni se loguea. Por eso los reintentos en segundo plano (runSync) no
// reenvían: quedan pendientes hasta que el admin los reintenta desde
// Comisiones con su PIN.
import { supabase } from '../lib/supabase';
import {
  getPedidos, getClientes, getVendedores, getProductos,
  getComisionesCierres, putComisionCierreLocal, putComisionesCierresRemotos,
  getComisionBorrador, putComisionBorrador, getComisionesRubro,
} from '../db';
import { pullPedidosByRango, syncPedidosPendientes, syncProductos, downloadMaestros } from '../sync/syncService';
import {
  armarDashboard, construirCierre, cierreToRemote, firmaDashboard, validarAnulacion, cierresConAjustesDependientes,
  mezclarCierres, claveBorrador, borradorVacio, validarPeriodo, esPendienteDeServidor, contarPendientesServidor,
  MODELO_VIGENTE,
} from '../domain/comisiones';
import { syncComisionesRubro, sondearMigracion005, MSG_FALTA_MIGRACION_005 } from './comisionesRubroService';
import { getUsuarioSesion } from './sesion';
import { cargarRendicionesLocales } from './rendicionService';
import { esAdmin, validarPinIngresado } from '../domain/permisos';

export const MSG_FALTA_MIGRACION = 'Falta correr supabase/migrations/003_comisiones.sql en Supabase: no se pueden cerrar comisiones todavía.';

// RPC o tabla inexistente (la migración 003 no se corrió).
export const esFaltaMigracion = (error) => {
  const code = String(error?.code || '');
  return ['PGRST202', '42883', '42P01', 'PGRST205'].includes(code) ||
    /could not find the function|could not find the table|relation .* does not exist/i.test(String(error?.message || ''));
};

// Sin respuesta del servidor (red caída, timeout): se reintenta con el mismo UUID.
export const esErrorDeRed = (error) =>
  !error?.code || /failed to fetch|network|timeout|load failed/i.test(String(error?.message || ''));

const esAdminSesion = () => esAdmin(getUsuarioSesion()?.permiso);

// ---------------------------------------------------------------------------
// Pull de cierres (tabla chica: se baja completa, paginada)
// ---------------------------------------------------------------------------
export const pullCierres = async () => {
  const PAGE = 500;
  let remotos = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('comisiones_cierres')
      .select('*')
      .order('updated_at', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      if (esFaltaMigracion(error)) {
        console.warn('Comisiones: la tabla comisiones_cierres no existe todavía (migración 003 sin correr).');
        return { ok: true, skipped: true, faltaMigracion: true };
      }
      throw error;
    }
    remotos = remotos.concat(data || []);
    if (!data || data.length < PAGE) break;
    from += PAGE;
  }
  const locales = await getComisionesCierres();
  await putComisionesCierresRemotos(mezclarCierres(locales, remotos));
  return { ok: true, count: remotos.length };
};

// ---------------------------------------------------------------------------
// Datos para el dashboard (AC-COM-3, AC-COM-9)
// ---------------------------------------------------------------------------
export const cargarDatosComisiones = async (periodo, { online = navigator.onLine } = {}) => {
  let incompleto = !online;
  let faltaMigracion = false;
  const avisos = [];
  if (online && validarPeriodo(periodo).ok) {
    try {
      const r = await pullPedidosByRango(periodo.desde, periodo.hasta);
      if (r?.incompleto) { incompleto = true; avisos.push('El período tiene demasiados pedidos: se bajó una parte.'); }
    } catch (e) {
      incompleto = true;
      avisos.push(`No se pudieron bajar los pedidos del período: ${e?.message || String(e)}`);
    }
    try {
      const r = await pullCierres();
      faltaMigracion = !!r?.faltaMigracion;
    } catch (e) {
      incompleto = true;
      avisos.push(`No se pudieron bajar los cierres: ${e?.message || String(e)}`);
    }
  }
  // REQ-COMR (AC-COMR-7): ¿está la 005? Sin ella no se puede cerrar.
  let faltaMigracion005 = false;
  if (online) faltaMigracion005 = !!(await sondearMigracion005())?.faltaMigracion;
  const [pedidos, clientes, vendedores, cierres, borrador, productos, tablaRubros] = await Promise.all([
    getPedidos(), getClientes(), getVendedores(), getComisionesCierres(), getComisionBorrador(claveBorrador(periodo)),
    getProductos(), getComisionesRubro(),
  ]);
  const tabla = tablaRubros || [];
  // REQ-REN (AC-REN-5): solo rendiciones CONFIRMADAS por el servidor (el servidor solo descuenta
  // esas: con una pendiente local, cerrar_comisiones daria montos_inconsistentes).
  const rendiciones = ((await cargarRendicionesLocales())?.rendiciones || []).filter(r => r?.syncEstado === 'confirmada');
  return {
    rendiciones,
    pedidos: pedidos || [],
    clientes: clientes || [],
    vendedores: vendedores || [],
    cierres: cierres || [],
    borrador: borrador || borradorVacio(periodo),
    // REQ-COMR: el dashboard se arma SIEMPRE con el modelo vigente (por rubro).
    modelo: MODELO_VIGENTE,
    productos: productos || [],
    tablaRubros: tabla,
    pendientesRubro: tabla.filter(f => f?.pendingSync && !f?.obsoleto).length,
    faltaMigracion005,
    incompleto,
    faltaMigracion,
    avisos,
  };
};

export const guardarBorrador = (borrador) => putComisionBorrador(borrador);

// ---------------------------------------------------------------------------
// Credenciales del admin (S-COM-01). Se arman por llamada y no se guardan.
// ---------------------------------------------------------------------------
// Id del admin en Supabase: la sesión tiene el id LOCAL (IndexedDB); el remoto
// está en vendedores.remoteId.
const idRemotoAdmin = async () => {
  const sesion = getUsuarioSesion();
  if (!sesion) return null;
  const lista = await getVendedores();
  const v = (lista || []).find(x => x?.id === sesion.id);
  const rid = v?.remoteId;
  return rid === null || rid === undefined || rid === '' ? null : String(rid);
};

const MSG_SIN_ID_REMOTO = 'Tu usuario de admin todavía no está sincronizado con el servidor: sincronizá y volvé a intentar.';

// Devuelve { ok, cred } o { ok:false, motivo, mensaje }. cred = args de la RPC.
const credencialesAdmin = async (pin) => {
  const v = validarPinIngresado(pin);
  if (!v.ok) return { ok: false, motivo: 'pin_requerido', mensaje: v.error };
  const id = await idRemotoAdmin();
  if (!id) return { ok: false, motivo: 'sin_id_remoto', mensaje: MSG_SIN_ID_REMOTO };
  return { ok: true, cred: { p_admin_id: id, p_admin_pin: v.pin } };
};

// Rechazos por autenticación: no dicen nada del cierre en sí.
// S-COM-16: la 003 nueva responde 'no_autorizado' (no distingue "no es admin"
// de "PIN incorrecto"); se siguen aceptando los motivos viejos.
const MOTIVOS_AUTH = ['no_autorizado', 'pin_incorrecto', 'no_admin', 'pin_bloqueado'];
const esBloqueoPin = (error) => /demasiados intentos/i.test(String(error?.message || ''));

export const mensajeRechazo = (motivo, conflictos = []) => {
  switch (motivo) {
    case 'ya_cerrado': return `Otro admin ya cerró ${conflictos.length} de estos pedidos. Actualizá y revisá antes de volver a cerrar.`;
    case 'no_autorizado': return 'PIN incorrecto o tu usuario no está autorizado como admin en el servidor.';
    case 'no_admin': return 'El servidor no reconoce al usuario como admin.';
    case 'tiene_ajustes_vigentes': return `Hay ${conflictos.length} cierre(s) posteriores con ajustes de estos pedidos: anulalos primero y después este.`;
    case 'pin_incorrecto': return 'PIN incorrecto (o tu usuario no tiene PIN cargado en el servidor).';
    case 'pin_bloqueado': return 'Demasiados intentos de PIN. Probá de nuevo en 15 minutos.';
    case 'id_en_uso': return 'Ese cierre ya existe en el servidor a nombre de otro admin.';
    case 'pedido_invalido': return `El servidor no considera cerrables ${conflictos.length} pedido(s) (no facturados, no entregados o fuera del período). Actualizá y revisá.`;
    case 'montos_inconsistentes': return `El total o la comisión de ${conflictos.length} pedido(s) no coincide con el servidor. Actualizá y revisá.`;
    case 'ajuste_invalido': return `${conflictos.length} ajuste(s) no coinciden con lo que tiene el servidor. Actualizá y revisá.`;
    case 'totales_inconsistentes': return 'Los totales del cierre no coinciden con los pedidos. Actualizá y revisá.';
    case 'monto_desbordado': return `${conflictos.length} pedido(s) tienen montos demasiado grandes (${conflictos.join(', ')}). Corregí esos pedidos y volvé a intentar.`;
    case 'desglose_inconsistente': return `El desglose por rubro de ${conflictos.length} pedido(s) no coincide con el servidor (${conflictos.join(', ')}). Actualizá y revisá.`;
    case 'modelo_obsoleto': return 'Actualizá la app: el cierre se calcula por vendedor y rubro.';
    case 'cierre_invalido': return 'El cierre tiene un formato inválido. Actualizá la app y volvé a intentar.';
    default: return `El servidor rechazó el cierre (${motivo || 'sin motivo'}).`;
  }
};

// ---------------------------------------------------------------------------
// Confirmar cierre (AC-COM-10, 11, 16)
// ---------------------------------------------------------------------------
const guardarLocal = (cierre, patch) => putComisionesCierresRemotos([{ ...cierre, ...patch, updatedAt: Date.now() }]);

// Manda el cierre (ya guardado local como 'pendiente') a la RPC y refleja el resultado.
// primerIntento: el UUID nunca llegó antes al servidor, así que un rechazo por
// PIN deja el cierre 'rechazado' (libera los pedidos). En un REINTENTO no se
// sabe si el servidor ya lo tiene: un rechazo por PIN lo deja 'pendiente'.
export const enviarCierre = async (cierre, cred, { primerIntento = false } = {}) => {
  const { data, error } = await supabase.rpc('cerrar_comisiones', { ...cierreToRemote(cierre), ...(cred || {}) });
  if (error) {
    if (esFaltaMigracion(error)) {
      await guardarLocal(cierre, { estado: 'rechazado', pendingSync: false, motivoRechazo: 'falta_migracion' });
      return { ok: false, motivo: 'falta_migracion', mensaje: MSG_FALTA_MIGRACION };
    }
    if (esErrorDeRed(error)) {
      return { ok: false, pendiente: true, motivo: 'red', mensaje: 'Sin respuesta del servidor: el cierre quedó pendiente. Reintentalo desde Comisiones con tu PIN.' };
    }
    if (esBloqueoPin(error)) {
      if (primerIntento) await guardarLocal(cierre, { estado: 'rechazado', pendingSync: false, motivoRechazo: 'pin_bloqueado' });
      return { ok: false, pendiente: !primerIntento, motivo: 'pin_bloqueado', mensaje: mensajeRechazo('pin_bloqueado') };
    }
    await guardarLocal(cierre, { estado: 'rechazado', pendingSync: false, motivoRechazo: String(error.message || error.code).slice(0, 200) });
    return { ok: false, motivo: 'error', mensaje: `El servidor rechazó el cierre: ${error.message || error.code}` };
  }
  if (data?.ok) {
    const vig = { estado: 'vigente', pendingSync: false, motivoRechazo: null, conflictos: null };
    await guardarLocal(cierre, vig);
    return { ok: true, yaExistia: !!data.ya_existia, cierre: { ...cierre, ...vig } };
  }
  const motivo = data?.motivo || 'rechazado';
  const conflictos = Array.isArray(data?.conflictos) ? data.conflictos.map(String) : [];
  if (MOTIVOS_AUTH.includes(motivo) && !primerIntento) {
    return { ok: false, pendiente: true, motivo, conflictos, mensaje: mensajeRechazo(motivo, conflictos) };
  }
  await guardarLocal(cierre, { estado: 'rechazado', pendingSync: false, motivoRechazo: motivo, conflictos });
  return { ok: false, motivo, conflictos, mensaje: mensajeRechazo(motivo, conflictos) };
};

// firmaVista: firmaDashboard() de lo que el admin vio en la confirmación. Si
// con los datos frescos del servidor algo cambió, NO se cierra y se devuelve el
// dashboard nuevo para que lo vuelva a confirmar.
// pin: PIN del admin tipeado en la confirmación (S-COM-01). No se guarda.
export const confirmarCierre = async ({ periodo, borrador = null, firmaVista = null, pin } = {}) => {
  if (!esAdminSesion()) return { ok: false, motivo: 'permiso', mensaje: 'Solo el admin puede cerrar comisiones.' };
  if (!navigator.onLine) return { ok: false, motivo: 'offline', mensaje: 'Para cerrar comisiones necesitás conexión (se valida contra el servidor).' };
  const cr = await credencialesAdmin(pin);
  if (!cr.ok) return { ok: false, motivo: cr.motivo, mensaje: cr.mensaje };

  try {
    await syncPedidosPendientes();
  } catch (e) {
    return { ok: false, motivo: 'sync', mensaje: `Primero hay que subir los pedidos pendientes: ${e?.message || String(e)}` };
  }

  // REQ-COMR (R4): productos y fichas frescos, y los % subidos y bajados con
  // la MISMA credencial del cierre, antes de recalcular y comparar la firma.
  try {
    await syncProductos({ cred: cr.cred });
    await downloadMaestros();
  } catch (e) {
    return { ok: false, motivo: 'sync', mensaje: `No se pudieron actualizar productos y clientes: ${e?.message || String(e)}` };
  }
  const sr = await syncComisionesRubro({ cred: cr.cred });
  if (sr?.faltaMigracion) return { ok: false, motivo: 'falta_migracion_005', mensaje: MSG_FALTA_MIGRACION_005 };
  if (sr && sr.ok === false) return { ok: false, motivo: sr.motivo || 'sync', mensaje: sr.mensaje || 'No se pudieron sincronizar los % de comisión.' };

  const datos = await cargarDatosComisiones(periodo, { online: true });
  if (datos.faltaMigracion) return { ok: false, motivo: 'falta_migracion', mensaje: MSG_FALTA_MIGRACION };
  if (datos.faltaMigracion005) return { ok: false, motivo: 'falta_migracion_005', mensaje: MSG_FALTA_MIGRACION_005 };
  if (datos.incompleto) return { ok: false, motivo: 'datos_incompletos', mensaje: datos.avisos.join(' ') || 'No se pudieron actualizar los datos del período.' };

  const dashboard = armarDashboard({ ...datos, borrador: borrador || datos.borrador, periodo });
  if (firmaVista && firmaDashboard(dashboard) !== firmaVista) {
    return { ok: false, motivo: 'cambio', dashboard, mensaje: 'Los datos cambiaron desde que abriste la pantalla. Revisá los totales y confirmá de nuevo.' };
  }

  let cierre;
  try {
    cierre = construirCierre(dashboard, { admin: getUsuarioSesion().nombre });
  } catch (e) {
    return { ok: false, motivo: 'no_se_puede', mensaje: e?.message || String(e) };
  }

  // Primero local (si el teléfono se apaga, se reintenta con el mismo UUID).
  await putComisionCierreLocal(cierre);
  const r = await enviarCierre(cierre, cr.cred, { primerIntento: true });
  return { ...r, cierreId: cierre.id };
};

// ---------------------------------------------------------------------------
// Anular (AC-COM-12)
// ---------------------------------------------------------------------------
const llamarAnular = (id, cred, motivo) =>
  supabase.rpc('anular_cierre_comisiones', { p_id: id, ...cred, p_motivo: motivo });

export const anularCierre = async (cierre, motivo, pin) => {
  if (!esAdminSesion()) return { ok: false, motivo: 'permiso', mensaje: 'Solo el admin puede anular un cierre.' };
  const usuario = getUsuarioSesion();
  const v = validarAnulacion(cierre, motivo, usuario.nombre);
  if (!v.ok) return { ok: false, motivo: 'validacion', errores: v.errores, mensaje: Object.values(v.errores).join(' · ') };
  // S-COM-15: chequeo local previo (el servidor es el que decide).
  const dependientes = cierresConAjustesDependientes(cierre, await getComisionesCierres());
  if (dependientes.length) return { ok: false, motivo: 'tiene_ajustes_vigentes', conflictos: dependientes, mensaje: mensajeRechazo('tiene_ajustes_vigentes', dependientes) };
  if (!navigator.onLine) return { ok: false, motivo: 'offline', mensaje: 'Para anular un cierre necesitás conexión.' };
  const cr = await credencialesAdmin(pin);
  if (!cr.ok) return { ok: false, motivo: cr.motivo, mensaje: cr.mensaje };

  const { data, error } = await llamarAnular(cierre.id, cr.cred, v.patch.motivoAnulacion);
  if (error) {
    if (esFaltaMigracion(error)) return { ok: false, motivo: 'falta_migracion', mensaje: MSG_FALTA_MIGRACION };
    if (esErrorDeRed(error)) {
      // Conservador: mientras el servidor no confirme, el cierre SIGUE vigente
      // localmente (no se liberan pedidos que el servidor todavía considera cerrados).
      // Se guarda quién/motivo/cuándo, NUNCA el PIN.
      await guardarLocal(cierre, { anulacionPendiente: { por: v.patch.anuladoPor, motivo: v.patch.motivoAnulacion, at: v.patch.anuladoAt }, pendingSync: true });
      return { ok: false, pendiente: true, motivo: 'red', mensaje: 'Sin respuesta del servidor: la anulación quedó pendiente. Reintentala desde Comisiones con tu PIN.' };
    }
    if (esBloqueoPin(error)) return { ok: false, motivo: 'pin_bloqueado', mensaje: mensajeRechazo('pin_bloqueado') };
    return { ok: false, motivo: 'error', mensaje: `No se pudo anular: ${error.message || error.code}` };
  }
  if (!data?.ok) {
    const m = data?.motivo || 'rechazado';
    const conflictos = Array.isArray(data?.conflictos) ? data.conflictos.map(String) : [];
    const conMensaje = MOTIVOS_AUTH.includes(m) || m === 'tiene_ajustes_vigentes';
    return { ok: false, motivo: m, conflictos, mensaje: conMensaje ? mensajeRechazo(m, conflictos) : `El servidor rechazó la anulación (${m}).` };
  }
  const anulado = { ...v.patch, anulacionPendiente: null, pendingSync: false };
  await guardarLocal(cierre, anulado);
  return { ok: true, cierre: { ...cierre, ...anulado } };
};

// ---------------------------------------------------------------------------
// Sync (llamado desde runSync, solo admin)
// ---------------------------------------------------------------------------

// Sin pin (runSync en segundo plano): solo baja cierres y cuenta pendientes;
// no reenvía nada porque el PIN no se guarda (S-COM-01).
// Con pin (botón "Reintentar" en Comisiones): reenvía con el MISMO UUID.
export const syncComisiones = async ({ pin } = {}) => {
  if (!esAdminSesion()) return { ok: true, skipped: true };
  const locales = await getComisionesCierres();
  const pendientes = locales.filter(esPendienteDeServidor);
  let reintentos = 0;
  if (pin !== undefined && pendientes.length > 0) {
    const cr = await credencialesAdmin(pin);
    if (!cr.ok) return { ok: false, motivo: cr.motivo, mensaje: cr.mensaje, reintentos, pendientes: pendientes.length };
    for (const c of pendientes) {
      reintentos += 1;
      if (c.estado === 'pendiente') {
        const r = await enviarCierre(c, cr.cred);
        if (r.motivo === 'falta_migracion') return { ok: true, skipped: true, faltaMigracion: true };
        // PIN mal / bloqueado: no tiene sentido seguir probando con el mismo PIN.
        if (MOTIVOS_AUTH.includes(r.motivo)) return { ok: false, motivo: r.motivo, mensaje: r.mensaje, reintentos };
        continue;
      }
      const a = c.anulacionPendiente;
      const { data, error } = await llamarAnular(c.id, cr.cred, a.motivo);
      if (error) {
        if (esFaltaMigracion(error)) return { ok: true, skipped: true, faltaMigracion: true };
        if (esBloqueoPin(error)) return { ok: false, motivo: 'pin_bloqueado', mensaje: mensajeRechazo('pin_bloqueado'), reintentos };
        continue; // red: se reintenta después
      }
      if (data?.ok) {
        await guardarLocal(c, { estado: 'anulado', anuladoAt: a.at ?? Date.now(), anuladoPor: a.por, motivoAnulacion: a.motivo, anulacionPendiente: null, pendingSync: false });
      } else if (MOTIVOS_AUTH.includes(data?.motivo)) {
        return { ok: false, motivo: data.motivo, mensaje: mensajeRechazo(data.motivo), reintentos };
      } else {
        // El servidor no la aceptó: se descarta la anulación pendiente (el cierre sigue vigente).
        await guardarLocal(c, { anulacionPendiente: null, pendingSync: false, motivoRechazo: data?.motivo || 'anulacion_rechazada' });
      }
    }
  }
  const pull = await pullCierres();
  const quedan = contarPendientesServidor(await getComisionesCierres());
  return { ok: true, reintentos, pendientes: quedan, ...(pull?.faltaMigracion ? { skipped: true, faltaMigracion: true } : {}) };
};
