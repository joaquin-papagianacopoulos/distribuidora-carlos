// src/domain/importacionPdf.js — REQ-PDF: actualizar precios desde la lista de precios
// (PDF con texto) de un proveedor. Lógica pura: arma renglones a partir de los
// fragmentos de texto del PDF (services/lectorPdf.js), detecta código, descripción
// y precios, y planifica la actualización. SOLO actualiza productos existentes:
// nunca crea productos ni toca stock.
import { claveUnica, redondear2 } from './validacion';
import { calcularPrecioVenta, MAX_IMPORTE } from './productos';
import { normalizarBusqueda } from './tienda';

export const MAX_PDF_BYTES = 10 * 1024 * 1024;
export const MAX_PAGINAS = 200;
export const MAX_RENGLONES = 20000;
export const VARIACION_GRANDE = 50; // % de cambio a partir del cual se pide revisar

export const MODOS = Object.freeze(['costo', 'venta']);

export function validarArchivoPdf(file) {
  if (!file || typeof file !== 'object') return { ok: false, error: 'Elegí un archivo PDF' };
  const nombre = String(file.name || '').toLowerCase();
  if (file.type !== 'application/pdf' && !nombre.endsWith('.pdf')) return { ok: false, error: 'El archivo tiene que ser un PDF' };
  const size = Number(file.size);
  if (!Number.isFinite(size) || size <= 0) return { ok: false, error: 'El PDF está vacío' };
  if (size > MAX_PDF_BYTES) return { ok: false, error: 'El PDF supera los 10 MB' };
  return { ok: true };
}

// ---- Renglones ----

// items: [{ str, x, y, w?, pagina }] (y crece hacia arriba, como en PDF).
// Agrupa por página y altura; ordena por x. Devuelve [{ pagina, texto }].
export function agruparRenglones(items, { tolerancia = 3 } = {}) {
  const porPagina = new Map();
  for (const it of Array.isArray(items) ? items : []) {
    if (!it || typeof it.str !== 'string' || !it.str.trim()) continue;
    const x = Number(it.x); const y = Number(it.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const pag = Number(it.pagina) || 1;
    if (!porPagina.has(pag)) porPagina.set(pag, []);
    porPagina.get(pag).push({ str: it.str, x, y, w: Number(it.w) || 0 });
  }
  const out = [];
  for (const pag of [...porPagina.keys()].sort((a, b) => a - b)) {
    const lista = porPagina.get(pag).sort((a, b) => (b.y - a.y) || (a.x - b.x));
    const grupos = [];
    for (const it of lista) {
      const g = grupos[grupos.length - 1];
      if (g && Math.abs(g.y - it.y) <= tolerancia) g.items.push(it);
      else grupos.push({ y: it.y, items: [it] });
    }
    for (const g of grupos) {
      g.items.sort((a, b) => a.x - b.x);
      let texto = '';
      let finPrev = null;
      for (const it of g.items) {
        // Fragmentos pegados (sin hueco) son la misma palabra: "1.2" + "50" -> "1.250".
        const pegado = finPrev !== null && it.x - finPrev < 0.5 && !/\s$/.test(texto) && !/^\s/.test(it.str);
        texto += (texto && !pegado ? ' ' : '') + it.str;
        finPrev = it.w ? it.x + it.w : null;
      }
      texto = texto.replace(/\s+/g, ' ').trim();
      if (texto) out.push({ pagina: pag, texto });
      if (out.length >= MAX_RENGLONES) return out;
    }
  }
  return out;
}

// ---- Precios ----

// "$ 1.234,56" / "1234.56" / "1,234.56" / "12.500" -> número; si no, null.
export function parsearPrecio(v) {
  let s = String(v ?? '').trim().replace(/^\$\s*/, '').replace(/\s/g, '');
  if (!/^\d[\d.,]*$/.test(s)) return null;
  const ultPunto = s.lastIndexOf('.');
  const ultComa = s.lastIndexOf(',');
  if (ultPunto >= 0 && ultComa >= 0) {
    const dec = ultPunto > ultComa ? '.' : ',';
    const mil = dec === '.' ? ',' : '.';
    s = s.split(mil).join('');
    if (s.split(dec).length !== 2) return null;
    s = s.replace(dec, '.');
  } else if (ultComa >= 0) {
    const partes = s.split(',');
    if (partes.length === 2 && partes[1].length <= 2) s = partes.join('.');
    else if (partes.slice(1).every(p => p.length === 3)) s = partes.join('');
    else return null;
  } else if (ultPunto >= 0) {
    const partes = s.split('.');
    // En las listas argentinas "12.500" es doce mil quinientos.
    if (partes.length > 2 || (partes[1].length === 3 && partes[0].length <= 3)) {
      if (!partes.slice(1).every(p => p.length === 3)) return null;
      s = partes.join('');
    } else if (partes[1].length > 2) return null;
  }
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > MAX_IMPORTE) return null;
  return redondear2(n);
}

// Un token "parece plata" si tiene $, separador de miles o 2 decimales.
const pareceDinero = (t) => /^\$/.test(t)
  || /^\d{1,3}([.,]\d{3})+([.,]\d{1,2})?$/.test(t)
  || /^\d+[.,]\d{2}$/.test(t);

// Código candidato: con algún dígito ("A-77", "1234") o sigla corta en mayúsculas ("DC").
// Si después no coincide con ningún producto, el plan prueba con la descripción completa.
const pareceCodigo = (t) => /^[A-Za-z0-9][A-Za-z0-9\-./_]{0,24}$/.test(t) && (/\d/.test(t) || /^[A-Z]{1,6}$/.test(t));

// Renglón -> { codigo, descripcion, precios } o null si no tiene precio.
// Los precios son la tira de montos al final del renglón (columnas de la lista).
export function parsearRenglon(texto) {
  const tokens = String(texto ?? '').replace(/\$\s+/g, '$').split(' ').filter(Boolean);
  if (tokens.length < 2) return null;
  const precios = [];
  let i = tokens.length - 1;
  while (i > 0 && pareceDinero(tokens[i])) {
    const n = parsearPrecio(tokens[i]);
    if (n === null) break;
    precios.unshift(n);
    i--;
  }
  // Sin montos "con forma de plata": se acepta un entero suelto al final (ej. "120").
  if (precios.length === 0 && tokens.length >= 3 && /^\d+$/.test(tokens[i])) {
    precios.push(parsearPrecio(tokens[i]));
    i--;
  }
  if (precios.length === 0) return null;
  const resto = tokens.slice(0, i + 1);
  const codigo = resto.length >= 2 && pareceCodigo(resto[0]) ? resto.shift() : '';
  const descripcion = resto.join(' ');
  if (!descripcion && !codigo) return null;
  return { codigo, descripcion, precios };
}

export function filasDesdeRenglones(renglones) {
  const filas = [];
  for (const r of Array.isArray(renglones) ? renglones : []) {
    const f = parsearRenglon(r && r.texto);
    if (f) filas.push({ ...f, pagina: r.pagina, texto: r.texto });
  }
  return filas;
}

// Cuántas columnas de precio tienen las filas (para el selector de columna).
export function columnasDePrecio(filas) {
  return (Array.isArray(filas) ? filas : []).reduce((m, f) => Math.max(m, f.precios.length), 0);
}

// columna: 'ultima' | índice 0-based (si la fila no tiene esa columna, se usa la última).
export function precioDeFila(fila, columna = 'ultima') {
  const p = (fila && fila.precios) || [];
  if (p.length === 0) return null;
  if (columna === 'ultima' || !Number.isInteger(columna) || columna < 0) return p[p.length - 1];
  return columna < p.length ? p[columna] : p[p.length - 1];
}

// ---- Plan ----

const variacion = (antes, despues) => {
  const a = Number(antes);
  if (!Number.isFinite(a) || a <= 0) return null;
  return Math.round(((despues - a) / a) * 1000) / 10;
};

// modo 'costo': el precio del PDF es el Costo final y se recalcula Precio venta 1
// con los descuentos y la ganancia de cada producto (AC-PROD-1).
// modo 'venta': el precio del PDF es directamente el Precio venta 1.
export function planificarPreciosPdf(filas, productos, { modo = 'costo', columna = 'ultima' } = {}) {
  const m = MODOS.includes(modo) ? modo : 'costo';
  const lista = (Array.isArray(productos) ? productos : []).filter(p => p && p.id !== undefined && p.id !== null);
  const porCodigo = new Map();
  for (const p of lista) if (p.codigo) porCodigo.set(claveUnica(p.codigo), p);
  const porNombre = new Map();
  for (const p of lista) {
    const k = normalizarBusqueda(p.nombre);
    if (!k) continue;
    porNombre.set(k, porNombre.has(k) ? null : p); // nombre repetido = ambiguo
  }
  const usados = new Set();
  const entradas = [];
  for (const f of Array.isArray(filas) ? filas : []) {
    const precioPdf = precioDeFila(f, columna);
    let producto = f.codigo ? porCodigo.get(claveUnica(f.codigo)) || null : null;
    let por = producto ? 'codigo' : null;
    if (!producto) {
      for (const d of [f.descripcion, `${f.codigo || ''} ${f.descripcion || ''}`]) {
        const k = normalizarBusqueda(d);
        const cand = k ? porNombre.get(k) : null;
        if (cand) { producto = cand; por = 'nombre'; break; }
      }
    }
    const e = { fila: f, producto, por, precioPdf, estado: 'sin_producto', seleccionado: false, aviso: '' };
    if (!producto) { e.aviso = 'No hay un producto con ese código'; entradas.push(e); continue; }
    if (usados.has(String(producto.id))) { e.estado = 'duplicado'; e.aviso = 'El producto ya aparece más arriba en el PDF'; entradas.push(e); continue; }
    usados.add(String(producto.id));
    if (precioPdf === null || precioPdf <= 0) { e.estado = 'invalido'; e.aviso = 'Precio inválido'; entradas.push(e); continue; }
    const precioActual = Number(producto.precio) || 0;
    const cambios = m === 'costo'
      ? { costoFinal: precioPdf, precio: calcularPrecioVenta({ ...producto, costoFinal: precioPdf }).precioVenta1 }
      : { precio: precioPdf };
    e.cambios = cambios;
    e.precioActual = precioActual;
    e.precioNuevo = cambios.precio;
    e.variacion = variacion(precioActual, cambios.precio);
    const igual = m === 'costo'
      ? redondear2(Number(producto.costoFinal) || 0) === precioPdf && redondear2(precioActual) === cambios.precio
      : redondear2(precioActual) === cambios.precio;
    if (igual) { e.estado = 'sin_cambios'; e.aviso = 'Sin cambios'; entradas.push(e); continue; }
    e.estado = 'actualizar';
    if (m === 'costo' && cambios.precio <= 0) {
      e.aviso = 'El producto no tiene % de ganancia: el precio de venta quedaría en $0';
      e.estado = 'invalido';
    } else if (por === 'nombre') {
      e.aviso = 'Encontrado por nombre (no por código): revisalo';
    } else if (e.variacion !== null && Math.abs(e.variacion) >= VARIACION_GRANDE) {
      e.aviso = `Cambio grande (${e.variacion > 0 ? '+' : ''}${e.variacion}%): revisalo`;
    }
    // Se tilda solo lo seguro: por código y sin cambio grande. El resto lo decide el admin.
    e.seleccionado = e.estado === 'actualizar' && por === 'codigo' && !e.aviso;
    entradas.push(e);
  }
  const contar = (est) => entradas.filter(e => e.estado === est).length;
  return {
    modo: m,
    entradas,
    resumen: {
      filas: entradas.length,
      actualizar: contar('actualizar'),
      sinCambios: contar('sin_cambios'),
      sinProducto: contar('sin_producto'),
      duplicados: contar('duplicado'),
      invalidos: contar('invalido'),
    },
  };
}

// Entradas tildadas -> [{ id, cambios }] para guardar. Solo estado 'actualizar'.
export function cambiosAplicables(plan, seleccion) {
  const sel = seleccion instanceof Set ? seleccion : null;
  return ((plan && plan.entradas) || [])
    .map((e, i) => ({ e, i }))
    .filter(({ e, i }) => e.estado === 'actualizar' && (sel ? sel.has(i) : e.seleccionado))
    .map(({ e }) => ({ id: e.producto.id, cambios: e.cambios }));
}
