// src/domain/compras.js — REQ-INA: costo y Factura A/B de cada ingreso de mercadería.
// Funciones puras (sin React ni IndexedDB). Los costos NO van dentro del ingreso (que se sincroniza
// con la anon key): se guardan aparte, en `ingresosCostos`, y suben con PIN de admin (migración 012).
// Todo importe se calcula en centavos enteros.
import { texto, toNum, redondear2 } from './validacion';
import { calcularPrecioVenta } from './productos';

// Mismo tope que el chequeo del servidor (admin_compras_guardar).
export const COSTO_UNITARIO_MAX = 999_999_999;

const k = (id) => String(id);

export const normalizarTipoAB = (v) => {
  const s = String(v ?? '').trim().toUpperCase().replace(/^FACTURA\s+/, '');
  return s === 'A' || s === 'B' ? s : null;
};

export const aCentavos = (v) => {
  const n = toNum(v);
  return n === null ? null : Math.round((n + Number.EPSILON) * 100);
};

const dePorId = (porId, id) => {
  if (!porId) return null;
  if (typeof porId.get === 'function') return porId.get(k(id)) ?? porId.get(id) ?? null;
  return porId[k(id)] ?? null;
};

/**
 * AC-INA-1: valida costos y tipo A/B de un ingreso ya validado por validarIngreso.
 * form: { tipoCabecera, facturaA, facturaB, items: [{ productoId, costoUnitario, tipoFactura }] }
 * Sin ningún dato cargado devuelve costos = null (ingreso "sin dato", AC-INA-5).
 * @returns {{ ok: boolean, errores: object, costos: object|null }}
 */
export const validarCostosIngreso = (form, { ingreso, now = new Date() } = {}) => {
  const errores = {};
  const f = form && typeof form === 'object' ? form : {};
  const itemsIngreso = Array.isArray(ingreso?.items) ? ingreso.items : [];
  const entradas = new Map((Array.isArray(f.items) ? f.items : []).map(it => [k(it?.productoId), it || {}]));

  const vacio = (v) => v === undefined || v === null || String(v).trim() === '';
  const facturaA = texto(f.facturaA, 40);
  const facturaB = texto(f.facturaB, 40);
  const cabeceraCargada = !vacio(f.tipoCabecera);
  const tipoCabecera = normalizarTipoAB(f.tipoCabecera);
  if (cabeceraCargada && !tipoCabecera) errores.tipoCabecera = 'Elegí Factura A o Factura B';

  let hayDato = cabeceraCargada || !!facturaA || !!facturaB;
  const renglones = [];
  for (const it of itemsIngreso) {
    const pid = k(it.productoId);
    const e = entradas.get(pid) || {};
    let costo = null;
    if (!vacio(e.costoUnitario)) {
      const n = toNum(e.costoUnitario);
      if (n === null || n < 0 || n > COSTO_UNITARIO_MAX) {
        errores[`item:${pid}`] = `Costo inválido para "${it.descripcion || pid}" (número entre 0 y ${COSTO_UNITARIO_MAX})`;
      } else {
        costo = redondear2(n);
        hayDato = true;
      }
    }
    let tipo = tipoCabecera;
    if (!vacio(e.tipoFactura)) {
      tipo = normalizarTipoAB(e.tipoFactura);
      if (!tipo && !errores[`item:${pid}`]) errores[`item:${pid}`] = `Tipo de factura inválido para "${it.descripcion || pid}"`;
      hayDato = true;
    }
    renglones.push({ productoId: pid, costoUnitario: costo, tipoFactura: tipo, unidades: Number(it.ingreso) || 0 });
  }

  if (hayDato && !tipoCabecera && !errores.tipoCabecera) errores.tipoCabecera = 'Elegí Factura A o Factura B';
  if (Object.keys(errores).length) return { ok: false, errores, costos: null };
  if (!hayDato || !ingreso?.id) return { ok: true, errores: {}, costos: null };

  const ts = now.getTime();
  return {
    ok: true,
    errores: {},
    costos: {
      id: ingreso.id,
      proveedorId: ingreso.proveedorId,
      fecha: ingreso.fecha,
      tipoCabecera,
      facturaA,
      facturaB,
      renglones,
      usuario: ingreso.usuario || '',
      updatedAt: ts,
      pendingSync: true,
    },
  };
};

const cero = () => ({ unidades: 0, costoCentavos: 0 });

/**
 * AC-INA-2 / AC-INA-5: subtotales de un ingreso por Factura A, B y "sin dato" (ingresos viejos).
 * @returns {{ A: {unidades, costoCentavos}, B: {...}, sinDato: {unidades}, total: {unidades, costoCentavos}, renglonesSinCosto: number }}
 */
export const subtotalesIngreso = (ingreso, costos = null) => {
  const out = { A: cero(), B: cero(), sinDato: { unidades: 0 }, total: cero(), renglonesSinCosto: 0 };
  const porProducto = new Map((Array.isArray(costos?.renglones) ? costos.renglones : []).map(r => [k(r.productoId), r]));
  for (const it of Array.isArray(ingreso?.items) ? ingreso.items : []) {
    const unidades = Number(it?.ingreso) || 0;
    const r = porProducto.get(k(it?.productoId));
    const tipo = r ? normalizarTipoAB(r.tipoFactura) || normalizarTipoAB(costos?.tipoCabecera) : null;
    out.total.unidades += unidades;
    if (!tipo) { out.sinDato.unidades += unidades; continue; }
    out[tipo].unidades += unidades;
    const c = r.costoUnitario === null || r.costoUnitario === undefined ? null : aCentavos(r.costoUnitario);
    if (c === null) { out.renglonesSinCosto += 1; continue; }
    out[tipo].costoCentavos += c * unidades;
    out.total.costoCentavos += c * unidades;
  }
  return out;
};

const soloTipo = (sub, tipo) => {
  const otro = tipo === 'A' ? 'B' : 'A';
  return {
    ...sub,
    [otro]: cero(),
    sinDato: { unidades: 0 },
    total: { unidades: sub[tipo].unidades, costoCentavos: sub[tipo].costoCentavos },
  };
};

// Fecha local (YYYY-MM-DD) de un ISO.
const diaLocal = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/**
 * AC-INA-3: historial filtrable por proveedor, fechas (YYYY-MM-DD, inclusivas) y tipo A/B.
 * tipo: 'todas' | 'A' | 'B' | 'sinDato'. Con 'A' o 'B' los subtotales de la fila muestran solo ese tipo.
 */
export const filtrarHistorial = (ingresos = [], costosById = null, { proveedorId = '', desde = '', hasta = '', tipo = 'todas' } = {}) => {
  const filas = [];
  for (const ing of Array.isArray(ingresos) ? ingresos : []) {
    if (!ing) continue;
    if (proveedorId && k(ing.proveedorId) !== k(proveedorId)) continue;
    const dia = diaLocal(ing.fecha);
    if (desde && (!dia || dia < desde)) continue;
    if (hasta && (!dia || dia > hasta)) continue;
    const costos = dePorId(costosById, ing.id);
    let sub = subtotalesIngreso(ing, costos);
    if (tipo === 'A' || tipo === 'B') {
      if (sub[tipo].unidades <= 0) continue;
      sub = soloTipo(sub, tipo);
    } else if (tipo === 'sinDato') {
      if (sub.sinDato.unidades <= 0) continue;
    }
    filas.push({
      id: ing.id, fecha: ing.fecha, dia, proveedorId: ing.proveedorId, proveedorNombre: ing.proveedorNombre || '',
      factura: ing.facturaProveedor || '', facturaA: costos?.facturaA || '', facturaB: costos?.facturaB || '',
      conDatos: !!costos, subtotales: sub,
    });
  }
  return filas.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
};

// AC-INA-3: totales A vs B del historial filtrado.
export const totalesHistorial = (filas = []) => {
  const t = { A: cero(), B: cero(), sinDato: { unidades: 0 }, total: cero(), renglonesSinCosto: 0 };
  for (const f of Array.isArray(filas) ? filas : []) {
    const s = f?.subtotales;
    if (!s) continue;
    for (const x of ['A', 'B']) { t[x].unidades += s[x].unidades; t[x].costoCentavos += s[x].costoCentavos; }
    t.sinDato.unidades += s.sinDato.unidades;
    t.total.unidades += s.total.unidades;
    t.total.costoCentavos += s.total.costoCentavos;
    t.renglonesSinCosto += s.renglonesSinCosto || 0;
  }
  return t;
};

/** AC-INA-3: qué entró de un producto y en qué factura (A / B / null = sin dato). */
export const ingresosPorProducto = (ingresos = [], costosById = null, productoId) => {
  const out = [];
  for (const ing of Array.isArray(ingresos) ? ingresos : []) {
    const it = (Array.isArray(ing?.items) ? ing.items : []).find(x => k(x?.productoId) === k(productoId));
    if (!it) continue;
    const costos = dePorId(costosById, ing.id);
    const r = (Array.isArray(costos?.renglones) ? costos.renglones : []).find(x => k(x.productoId) === k(productoId));
    out.push({
      ingresoId: ing.id, fecha: ing.fecha, proveedorNombre: ing.proveedorNombre || '', factura: ing.facturaProveedor || '',
      tipo: r ? (normalizarTipoAB(r.tipoFactura) || normalizarTipoAB(costos?.tipoCabecera)) : null,
      unidades: Number(it.ingreso) || 0,
      costoUnitario: r && r.costoUnitario !== null && r.costoUnitario !== undefined ? Number(r.costoUnitario) : null,
    });
  }
  return out.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
};

/**
 * AC-INA-4: nuevo costo/precio del producto a partir del costo del ingreso.
 * null si el costo está vacío, es inválido o igual al actual. El precio solo se recalcula si había ganancia
 * cargada y el precio actual era el automático (no uno puesto a mano).
 * @returns {{ costoFinal: number, precio: number, precioCambia: boolean }|null}
 */
export const costoProductoDesdeIngreso = (producto, costoUnitario) => {
  if (costoUnitario === null || costoUnitario === undefined || String(costoUnitario).trim() === '') return null;
  const n = toNum(costoUnitario);
  // QA obs 1: costo 0 (valido en el renglon) NO pisa el costo final del producto.
  if (n === null || n <= 0 || n > COSTO_UNITARIO_MAX) return null;
  const costoFinal = redondear2(n);
  const p = producto && typeof producto === 'object' ? producto : {};
  if (redondear2(Number(p.costoFinal) || 0) === costoFinal) return null;
  const precioActual = Number(p.precio) || 0;
  const auto = calcularPrecioVenta(p).precioVenta1;
  const recalcula = (Number(p.ganancia) || 0) > 0 && redondear2(precioActual) === auto;
  const precio = recalcula ? calcularPrecioVenta({ ...p, costoFinal }).precioVenta1 : precioActual;
  return { costoFinal, precio, precioCambia: precio !== precioActual };
};

/** AC-CPR-1: compras de la cuenta derivadas de los ingresos con costo (centavos). */
export const comprasDeIngresos = (costosLista = []) => {
  const out = [];
  for (const c of Array.isArray(costosLista) ? costosLista : []) {
    let monto = 0;
    let sinCosto = 0;
    for (const r of Array.isArray(c?.renglones) ? c.renglones : []) {
      if (r.costoUnitario === null || r.costoUnitario === undefined) { sinCosto += 1; continue; }
      monto += aCentavos(r.costoUnitario) * (Number(r.unidades) || 0);
    }
    if (monto <= 0) continue;
    out.push({ id: c.id, proveedorId: c.proveedorId, fecha: c.fecha, tipo: 'compra', montoCentavos: monto, renglonesSinCosto: sinCosto });
  }
  return out;
};

// ---- Mapeos remotos (tabla ingresos_costos, migración 012) ----
export const costosToRemote = (c = {}) => ({
  ingreso_id: c.id,
  proveedor_id: c.proveedorId,
  fecha: c.fecha,
  tipo_cabecera: c.tipoCabecera,
  factura_a: c.facturaA || null,
  factura_b: c.facturaB || null,
  renglones: (Array.isArray(c.renglones) ? c.renglones : []).map(r => ({
    producto_id: k(r.productoId),
    costo_unitario: r.costoUnitario === null || r.costoUnitario === undefined ? null : Number(r.costoUnitario),
    tipo_factura: r.tipoFactura,
    unidades: Number(r.unidades) || 0,
  })),
  updated_at: new Date(Number(c.updatedAt) || Date.now()).toISOString(),
});

export const costosFromRemote = (r = {}) => ({
  id: r.ingreso_id,
  proveedorId: r.proveedor_id,
  fecha: r.fecha,
  tipoCabecera: r.tipo_cabecera,
  facturaA: r.factura_a || '',
  facturaB: r.factura_b || '',
  renglones: (Array.isArray(r.renglones) ? r.renglones : []).map(x => ({
    productoId: k(x.producto_id),
    costoUnitario: x.costo_unitario === null || x.costo_unitario === undefined ? null : Number(x.costo_unitario),
    tipoFactura: normalizarTipoAB(x.tipo_factura),
    unidades: Number(x.unidades) || 0,
  })),
  usuario: '',
  updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : 0,
  pendingSync: false,
});
