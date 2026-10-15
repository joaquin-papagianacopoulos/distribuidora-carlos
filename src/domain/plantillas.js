// src/domain/plantillas.js — REQ-PLA (AC-PLA-1..7): plantillas Excel e
// importacion de productos y clientes.
//
// Una sola fuente de verdad: las columnas salen de CAMPOS_PRODUCTO /
// CAMPOS_CLIENTE (los mismos que dibujan ProductoForm y ClienteForm) y cada
// fila se valida con validarProducto / validarCliente (las mismas reglas del
// formulario). Aca no hay React, IndexedDB ni xlsx: solo datos.
import { CAMPOS_PRODUCTO, validarProducto } from './productos';
import { CAMPOS_CLIENTE, PROVINCIAS, TIPOS_IVA, validarCliente, clienteVacio } from './clientes';
import { texto, csvSafe, claveUnica, esFechaISO } from './validacion';
import { filtrarActivos } from './vendedores';
import { listarRubros, resolverRubro } from './rubros';
import { listarMarcas, resolverMarca } from './marcas';
import { normalizarVentaPor, parsearBooleano } from './unidadVenta';
import { fechaDesdeCelda, errorLimitesArchivo, problemasDeFila, largoEncabezado } from './importacion';

export const ENTIDADES = ['productos', 'clientes'];

// Encabezado comparable: sin tildes, sin mayusculas, sin espacios ni simbolos.
// "% Ganancia" => "ganancia", "Código cliente" => "codigocliente".
export const normalizarEncabezado = (h) => claveUnica(h).replace(/[^a-z0-9]/g, '');

const lista = (arr) => arr.join(', ');

// ---------------------------------------------------------------------------
// Instrucciones por columna (hoja 2). Las columnas en si NO se definen aca:
// se toman de CAMPOS_* para que plantilla, importacion y formulario no se
// separen nunca (AC-PLA-7).
// ---------------------------------------------------------------------------
const INFO_PRODUCTO = {
  codigo: { obligatorio: 'Sí (en productos nuevos)', formato: 'Texto, hasta 40 caracteres. Único (no distingue mayúsculas). Si ya existe, se actualiza ese producto', ejemplo: 'CC500' },
  nombre: { obligatorio: 'Sí', formato: 'Texto, hasta 160 caracteres', ejemplo: 'Coca Cola 500ml' },
  categoria: { obligatorio: 'No', formato: 'Texto, hasta 60 caracteres. Si ya existe el mismo rubro (sin importar mayúsculas, tildes ni espacios) se usa el existente', ejemplo: 'Bebidas' },
  marca: { obligatorio: 'No', formato: 'Texto, hasta 60 caracteres. Si ya existe la misma marca (sin importar mayúsculas, tildes ni espacios) se usa la existente. Vacío = se conserva (o se detecta por el nombre)', ejemplo: 'Dos Corazones' },
  proveedorId: { obligatorio: 'No', formato: 'Nombre del proveedor como figura en Configuración → Proveedores (o su código). Si no existe, la fila se rechaza', ejemplo: 'Arcor' },
  costoFinal: { obligatorio: 'No', formato: 'Número ≥ 0 (acepta coma decimal: 1234,50)', ejemplo: '1000' },
  // AC-PLA-3b: descuentos, ganancia, precio 2 y minimo venta no son obligatorios.
  descuento1: { obligatorio: 'No (vacío = 0)', formato: '% entre 0 y 100 (acepta "10%"). Vacío o "-" = 0; en productos existentes se conserva', ejemplo: '10' },
  descuento2: { obligatorio: 'No (vacío = 0)', formato: '% entre 0 y 100 (acepta "10%"). Vacío o "-" = 0; en productos existentes se conserva', ejemplo: '5' },
  ganancia: { obligatorio: 'No (vacío = 0)', formato: '% entre 0 y 1000 (acepta "35%"). Vacío o "-" = 0; en productos existentes se conserva', ejemplo: '35' },
  precio: { obligatorio: 'No', formato: 'Número ≥ 0. Si queda vacío se calcula: costo × (1 − desc1/100) × (1 − desc2/100) × (1 + ganancia/100)', ejemplo: '' },
  precioBulto: { obligatorio: 'No (vacío = 0)', formato: 'Número ≥ 0. Precio por unidad cuando se lleva al menos un bulto completo. Vacío, "-" o 0 = no hay precio por bulto; en productos existentes se conserva', ejemplo: '800' },
  precioVenta2: { obligatorio: 'No (vacío = 0)', formato: 'Número ≥ 0. Vacío o "-" = 0; en productos existentes se conserva', ejemplo: '1300' },
  bultoX: { obligatorio: 'No', formato: 'Entero ≥ 1 (vacío = 1)', ejemplo: '12' },
  ventaPor: { obligatorio: 'No', formato: 'Unidad, Bulto o Ambos. "Bulto" exige "Bulto x" mayor que 1. Vacío = Ambos si Bulto x es mayor que 1, si no Unidad', ejemplo: 'Bulto' },
  bultoNombre: { obligatorio: 'No (vacío = Bulto)', formato: 'Bulto, Display, Caja o Pack', ejemplo: 'Display' },
  visibleTienda: { obligatorio: 'No (vacío = Sí)', formato: 'Sí o No. Si se muestra en la tienda online', ejemplo: 'Sí' },
  minimoVenta: { obligatorio: 'No (vacío = 1)', formato: 'Entero ≥ 1. Vacío, "-" o 0 = 1 (sin mínimo); en productos existentes se conserva', ejemplo: '1' },
  stock: { obligatorio: 'No', formato: 'Entero ≥ 0. Solo para productos NUEVOS (stock inicial). En productos que ya existen se ignora: usá Stock → Ingreso de mercadería', ejemplo: '24' },
};

const INFO_CLIENTE = {
  codigo: { obligatorio: 'Sí', formato: 'Texto, hasta 30 caracteres. Único (no distingue mayúsculas). Si ya existe, se actualiza ese cliente. Escribilo como texto para no perder ceros a la izquierda', ejemplo: '0042' },
  nombre: { obligatorio: 'Sí', formato: 'Texto, hasta 120 caracteres', ejemplo: 'Kiosco Pepe' },
  direccion: { obligatorio: 'Sí', formato: 'Texto, hasta 160 caracteres', ejemplo: 'Mitre 123' },
  ciudad: { obligatorio: 'No', formato: 'Texto', ejemplo: 'Rosario' },
  codigoPostal: { obligatorio: 'No', formato: '4 a 8 letras/números (CPA)', ejemplo: 'S2000' },
  provincia: { obligatorio: 'No', formato: 'Una de la lista', ejemplo: 'Santa Fe' },
  zona: { obligatorio: 'No', formato: 'Texto', ejemplo: 'Centro' },
  pais: { obligatorio: 'No', formato: 'Texto (vacío = Argentina)', ejemplo: 'Argentina' },
  tipoIva: { obligatorio: 'No', formato: 'Uno de la lista', ejemplo: 'Responsable Inscripto' },
  cuit: { obligatorio: 'Sí, salvo Consumidor Final o sin tipo de IVA', formato: '11 dígitos, con o sin guiones. Se valida el dígito verificador', ejemplo: '20-12345678-6' },
  telefono: { obligatorio: 'No', formato: 'Entre 8 y 15 dígitos', ejemplo: '3415551234' },
  vendedor: { obligatorio: 'No', formato: 'Nombre de un vendedor activo. Si no existe, la fila se rechaza', ejemplo: '' },
  cobrador: { obligatorio: 'No', formato: 'Texto', ejemplo: '' },
  fechaAlta: { obligatorio: 'No', formato: 'Fecha de Excel, AAAA-MM-DD o DD/MM/AAAA (vacío = hoy)', ejemplo: '2026-10-12' },
  tipoCliente: { obligatorio: 'No', formato: 'Texto', ejemplo: 'Mayorista' },
  rubro: { obligatorio: 'No', formato: 'Texto', ejemplo: 'Almacén' },
};

const armarColumnas = (campos, info) => campos.map(c => ({
  key: c.key,
  label: c.label,
  requerido: !!c.requerido,
  ...(info[c.key] || { obligatorio: c.requerido ? 'Sí' : 'No', formato: 'Texto', ejemplo: '' }),
}));

// AC-PLA-2 / AC-PLA-4 / AC-COMR-2: el cliente ya no tiene comisión (REQ-COMR:
// se carga por vendedor y rubro). No va en la plantilla y, si un archivo viejo
// trae la columna, se ignora (no crea ni pisa el dato viejo) y se avisa en el
// resumen como informativo. `comision` queda acá como alias legacy.
export const CAMPOS_EXCLUIDOS_PLANTILLA = Object.freeze({
  productos: Object.freeze([]),
  clientes: Object.freeze(['comision']),
});

const camposPlantilla = (campos, entidad) => campos.filter(c => !CAMPOS_EXCLUIDOS_PLANTILLA[entidad].includes(c.key));

// AC-PLA-1 / AC-PLA-2: mismas etiquetas y mismo orden que el formulario
// (menos los campos excluidos).
export const COLUMNAS_PLANTILLA = Object.freeze({
  productos: armarColumnas(camposPlantilla(CAMPOS_PRODUCTO, 'productos'), INFO_PRODUCTO),
  clientes: armarColumnas(camposPlantilla(CAMPOS_CLIENTE, 'clientes'), INFO_CLIENTE),
});

// Encabezados normalizados de los campos excluidos ("Comisión", "Comision %").
// AC-COMR-2: CAMPOS_CLIENTE ya no tiene "Comisión", así que los encabezados
// legacy se listan acá explícitos.
export const ENCABEZADOS_LEGACY_COMISION = Object.freeze(['Comisión', 'Comision', 'Comisión %', '% Comisión']);
const ENCABEZADOS_EXCLUIDOS = {
  productos: new Set(),
  clientes: new Set(ENCABEZADOS_LEGACY_COMISION.map(normalizarEncabezado)),
};

export const NOMBRE_ARCHIVO_PLANTILLA = Object.freeze({
  productos: 'plantilla_productos.xlsx',
  clientes: 'plantilla_clientes.xlsx',
});

const NOMBRE_HOJA = { productos: 'Productos', clientes: 'Clientes' };

const columnasDe = (entidad) => {
  const cols = COLUMNAS_PLANTILLA[entidad];
  if (!cols) throw new Error(`Entidad desconocida: ${entidad}`);
  return cols;
};

// ---------------------------------------------------------------------------
// Mapeo encabezado -> campo
// ---------------------------------------------------------------------------
// Alias exactos (normalizados). Incluyen los encabezados de los archivos
// viejos de productos (nombre/precio/codigo/unidad/categoria) — AC-PROD-5.
const ALIAS = {
  productos: {
    nombre: 'nombre', producto: 'nombre',
    precio: 'precio', precioventa: 'precio', precioventa1: 'precio', preciounidad: 'precio', preciodeventa: 'precio', price: 'precio', pcio: 'precio',
    clave: 'codigo', sku: 'codigo', cod: 'codigo',
    categoria: 'categoria', familia: 'categoria', linea: 'categoria',
    unidad: 'unidad', unit: 'unidad',
    bulto: 'bultoX', bultos: 'bultoX',
    sevendepor: 'ventaPor', ventapor: 'ventaPor',
    etiquetadelbulto: 'bultoNombre', tipobulto: 'bultoNombre',
    mostrarentienda: 'visibleTienda', tienda: 'visibleTienda', visible: 'visibleTienda',
    minimo: 'minimoVenta', minimodeventa: 'minimoVenta',
    stockinicial: 'stock',
  },
  clientes: {
    codigo: 'codigo', cod: 'codigo',
    nombre: 'nombre', cliente: 'nombre',
    domicilio: 'direccion', direccion: 'direccion',
    cp: 'codigoPostal',
    iva: 'tipoIva', condicioniva: 'tipoIva',
    cuil: 'cuit', cuitcuil: 'cuit',
    telefono: 'telefono', tel: 'telefono',
    fechaalta: 'fechaAlta',
  },
};

// Coincidencias parciales de la importacion vieja de productos (mismo orden y
// criterio que tenia importarRows), solo para encabezados que no matchearon
// exacto. Se evalua sobre el encabezado en minusculas sin normalizar.
const PARCIALES_PRODUCTO = [
  ['nombre', (h) => h.includes('nombre')],
  ['precio', (h) => (h.includes('venta') && h.includes('precio')) || h === 'precio' || h.includes('price') || h.includes('pcio')],
  ['codigo', (h) => h === 'clave' || h === 'codigo' || h.includes('sku') || h.includes('cod') || h.includes('ref')],
  ['unidad', (h) => h.includes('unidad') || h.includes('unit')],
  ['categoria', (h) => h.includes('categ') || h.includes('rubro') || h.includes('familia') || h.includes('linea')],
];

// Columnas que solo trae la plantilla nueva (no los archivos viejos).
const SOLO_PLANTILLA_PRODUCTO = ['marca', 'ventaPor', 'bultoNombre', 'visibleTienda', 'proveedorId', 'costoFinal', 'descuento1', 'descuento2', 'ganancia', 'precioBulto', 'precioVenta2', 'bultoX', 'minimoVenta', 'stock'];

/**
 * Mapea los encabezados de un archivo a campos.
 * `excluidas`: encabezados de campos que la importacion ignora a proposito
 * (AC-PLA-4: "Comisión" en clientes). No se mapean ni cuentan como ignoradas.
 * @returns {{ indices: Record<string, number>, ignoradas: string[], excluidas: string[], modo: 'plantilla'|'legacy' }}
 */
export const mapearEncabezados = (headers = [], entidad = 'productos') => {
  const cols = columnasDe(entidad);
  const exactos = new Map();
  for (const c of cols) exactos.set(normalizarEncabezado(c.label), c.key);
  for (const [alias, key] of Object.entries(ALIAS[entidad] || {})) if (!exactos.has(alias)) exactos.set(alias, key);
  const excluidos = ENCABEZADOS_EXCLUIDOS[entidad];

  const indices = {};
  const libres = [];
  const excluidas = [];
  (headers || []).forEach((h, i) => {
    const n = normalizarEncabezado(h);
    if (n && excluidos.has(n)) { excluidas.push(String(h ?? '').trim()); return; }
    const key = n ? exactos.get(n) : undefined;
    if (key && indices[key] === undefined) indices[key] = i;
    else if (n) libres.push(i);
  });

  if (entidad === 'productos') {
    for (const [key, test] of PARCIALES_PRODUCTO) {
      if (indices[key] !== undefined) continue;
      const pos = libres.findIndex(i => test(String(headers[i] ?? '').toLowerCase().trim()));
      if (pos >= 0) { indices[key] = libres[pos]; libres.splice(pos, 1); }
    }
  }

  let modo = 'plantilla';
  if (entidad === 'productos') {
    const nombreHeader = indices.nombre !== undefined ? normalizarEncabezado(headers[indices.nombre]) : '';
    const esPlantilla = nombreHeader === 'descripcion' || SOLO_PLANTILLA_PRODUCTO.some(k => indices[k] !== undefined);
    modo = esPlantilla ? 'plantilla' : 'legacy';
  }
  return { indices, ignoradas: libres.map(i => String(headers[i] ?? '').trim()), excluidas, modo };
};

// ---------------------------------------------------------------------------
// Helpers de celdas
// ---------------------------------------------------------------------------
const celda = (v) => (v === null || v === undefined ? '' : String(v).trim());
const vacia = (v) => celda(v) === '';
// AC-SEC-3 / AC-PLA-6: texto limpio y sin formulas.
const textoSeguro = (v, max) => csvSafe(texto(v, max));
const sinPorcentaje = (v) => celda(v).replace(/%$/, '').trim();
const strOr = (v, def = '') => (v === undefined || v === null ? def : String(v));

// AC-PLA-3b: en los campos opcionales de productos, "-" o "–" (o "—") es "sin dato".
export const CAMPOS_OPCIONALES_PRODUCTO = Object.freeze(['descuento1', 'descuento2', 'ganancia', 'precioBulto', 'precioVenta2', 'minimoVenta']);
const SIN_DATO = new Set(['', '-', '–', '—']);
export const celdaSinDato = (v) => SIN_DATO.has(celda(v).replace(/\s+/g, ''));

const filaVacia = (r) => !Array.isArray(r) || !r.some(c => celda(c) !== '');

// "12/10/2026" => "2026-10-12". ISO se respeta. BUG-PLA-01: tambien una
// celda de fecha de Excel (Date, numero de serie o "10/1/26" como la devuelve
// xlsx con raw:false; ver fechaDesdeCelda y la opcion `corta`). Otra cosa se
// devuelve tal cual (validarCliente la rechaza).
export const normalizarFecha = (v, { corta = 'mdy' } = {}) => {
  const iso = fechaDesdeCelda(v, { corta });
  return iso && esFechaISO(iso) ? iso : celda(v);
};

// Busca un valor de una lista cerrada sin importar tildes/mayusculas.
const canonico = (v, opciones) => {
  const k = claveUnica(v);
  return opciones.find(o => claveUnica(o) === k) || celda(v);
};

/**
 * Proveedor por nombre (descripcion), por codigo o por "COD — Descripcion"
 * como lo muestra el formulario. Case-insensitive y con trim.
 */
export const resolverProveedor = (valor, proveedores = []) => {
  const k = claveUnica(valor);
  if (!k) return { ok: true, id: null };
  const lista = Array.isArray(proveedores) ? proveedores.filter(Boolean) : [];
  const porDesc = lista.filter(p => claveUnica(p.descripcion) === k);
  if (porDesc.length === 1) return { ok: true, id: porDesc[0].id };
  if (porDesc.length > 1) return { ok: false, error: `Hay ${porDesc.length} proveedores llamados "${texto(valor, 60)}": usá el código` };
  const porCod = lista.filter(p => claveUnica(p.codigo) === k);
  if (porCod.length === 1) return { ok: true, id: porCod[0].id };
  const porEtiqueta = lista.filter(p => claveUnica(`${p.codigo} — ${p.descripcion}`) === k || claveUnica(`${p.codigo} - ${p.descripcion}`) === k);
  if (porEtiqueta.length === 1) return { ok: true, id: porEtiqueta[0].id };
  return { ok: false, error: `Proveedor "${texto(valor, 60)}" no existe` };
};

/**
 * Vendedor por nombre, solo activos (REQ-VEN). Devuelve el nombre tal como esta cargado.
 * S-PLA-03: si el nombre coincide con mas de un vendedor ACTIVO, la fila se
 * rechaza (no se elige uno al azar). Un dado de baja homonimo no cuenta.
 */
export const resolverVendedor = (valor, vendedores = []) => {
  const k = claveUnica(valor);
  if (!k) return { ok: true, nombre: '' };
  const coinciden = filtrarActivos(vendedores).filter(x => x && claveUnica(x.nombre) === k);
  if (coinciden.length === 0) return { ok: false, error: `Vendedor "${texto(valor, 60)}" no existe o está dado de baja` };
  if (coinciden.length > 1) return { ok: false, error: `Hay ${coinciden.length} vendedores activos llamados "${texto(valor, 60)}": corregí los nombres en Configuración → Vendedores` };
  return { ok: true, nombre: String(coinciden[0].nombre).trim() };
};

const mensajes = (errores) => Object.values(errores || {}).filter(Boolean);

// ---------------------------------------------------------------------------
// Validacion por fila
// ---------------------------------------------------------------------------
const CAMPOS_COSTO = ['costoFinal', 'descuento1', 'descuento2', 'ganancia'];
const PCT_PRODUCTO = ['descuento1', 'descuento2', 'ganancia'];

/**
 * Valida/normaliza una fila de productos con las reglas de ProductoForm.
 * @param {Record<string,string>} valores celdas por campo (solo columnas presentes)
 * @param {{ existente?: object, existentes?: object[], proveedores?: object[], modo?: string }} ctx
 * @returns {{ ok: boolean, errores: string[], valor: { producto: object, stock: number|null }, stockIgnorado: boolean }}
 */
// AC-COMR-4: `rubros` (los existentes + los ya vistos en el archivo) canoniza
// el Rubro con la misma regla que el formulario ("GOLOSINAS " => "Golosinas").
export const validarFilaProducto = (valores = {}, { existente = null, existentes = [], proveedores = [], modo = 'plantilla', rubros = null, marcas = null } = {}) => {
  const errores = [];
  // AC-PLA-3b: en los opcionales, "-"/"–" cuenta como vacío (en altas queda el
  // default; en existentes se conserva el valor). validarProducto no se afloja.
  const tiene = (k) => Object.prototype.hasOwnProperty.call(valores, k) && !vacia(valores[k])
    && !(CAMPOS_OPCIONALES_PRODUCTO.includes(k) && celdaSinDato(valores[k]));

  const form = {
    codigo: strOr(existente?.codigo),
    nombre: strOr(existente?.nombre),
    categoria: strOr(existente?.categoria),
    marca: strOr(existente?.marca),
    proveedorId: strOr(existente?.proveedorId),
    costoFinal: strOr(existente?.costoFinal),
    descuento1: strOr(existente?.descuento1),
    descuento2: strOr(existente?.descuento2),
    ganancia: strOr(existente?.ganancia),
    precio: strOr(existente?.precio),
    precioBulto: strOr(existente?.precioBulto),
    precioVenta2: strOr(existente?.precioVenta2),
    bultoX: strOr(existente?.bultoX, '1'),
    minimoVenta: strOr(existente?.minimoVenta, '1'),
    // AC-VTA-1: columna ausente o vacía => se conserva lo del existente o el default.
    ventaPor: strOr(existente?.ventaPor),
    bultoNombre: strOr(existente?.bultoNombre),
    visibleTienda: existente?.visibleTienda === false ? false : '',
    stock: '',
  };
  if (tiene('codigo')) form.codigo = textoSeguro(valores.codigo, 40);
  if (tiene('nombre')) form.nombre = textoSeguro(valores.nombre, 160);
  if (tiene('categoria')) form.categoria = textoSeguro(valores.categoria, 60);
  if (tiene('marca')) form.marca = textoSeguro(valores.marca, 60);
  if (tiene('ventaPor')) form.ventaPor = normalizarVentaPor(celda(valores.ventaPor)) || celda(valores.ventaPor);
  if (tiene('bultoNombre')) form.bultoNombre = celda(valores.bultoNombre);
  if (tiene('visibleTienda')) {
    const vt = parsearBooleano(celda(valores.visibleTienda));
    if (vt === null) errores.push('Mostrar en tienda: poné Sí o No');
    else form.visibleTienda = vt;
  }
  for (const k of ['costoFinal', 'precioBulto', 'precioVenta2', 'bultoX', 'minimoVenta']) if (tiene(k)) form[k] = celda(valores[k]);
  for (const k of PCT_PRODUCTO) if (tiene(k)) form[k] = sinPorcentaje(valores[k]);
  // AC-PLA-3b: minimo venta 0 = sin minimo (1).
  if (tiene('minimoVenta') && /^0+([.,]0*)?$/.test(celda(valores.minimoVenta))) form.minimoVenta = '1';

  let proveedoresValidos = proveedores;
  if (tiene('proveedorId')) {
    const p = resolverProveedor(valores.proveedorId, proveedores);
    if (!p.ok) errores.push(p.error);
    else form.proveedorId = p.id;
  } else if (form.proveedorId) {
    // Se conserva el proveedor que ya tenia el producto.
    proveedoresValidos = [...(proveedores || []), { id: form.proveedorId }];
  }

  // Precio por unidad (antes Precio venta 1): vacio => se calcula con AC-PROD-1 (validarProducto), salvo
  // un producto existente al que no se le cambio ningun costo: ahi se conserva.
  if (tiene('precio')) form.precio = celda(valores.precio);
  else if (modo === 'legacy') errores.push('Precio vacío o inválido');
  else if (!existente || CAMPOS_COSTO.some(tiene)) form.precio = '';

  // Stock: solo productos nuevos (regla dura 4 / AC-PROD-3).
  const stockIgnorado = !!existente && tiene('stock');
  if (!existente && tiene('stock')) form.stock = celda(valores.stock);

  const r = validarProducto(form, { existentes, proveedores: proveedoresValidos, editId: existente?.id ?? null, rubros: Array.isArray(rubros) ? rubros : null, marcas: Array.isArray(marcas) ? marcas : null });
  const err = { ...r.errores };
  // Codigo obligatorio solo en altas de la plantilla nueva: los archivos viejos
  // y los upserts por nombre lo aceptan vacio (AC-PROD-5 / AC-PLA-3).
  if (!r.producto.codigo && (modo === 'legacy' || existente)) delete err.codigo;
  errores.push(...mensajes(err));

  // '-' = sin dato (se compara antes de csvSafe, que lo convertiria en "'-").
  const unidadCelda = tiene('unidad') ? texto(valores.unidad, 30) : '';
  const unidad = unidadCelda && unidadCelda !== '-' ? csvSafe(unidadCelda) : (existente?.unidad || 'unidad');

  return {
    ok: errores.length === 0,
    errores,
    valor: { producto: { ...r.producto, unidad }, stock: existente ? null : r.stock },
    stockIgnorado,
  };
};

const TEXTO_CLIENTE = { codigo: 30, nombre: 120, direccion: 160, ciudad: 80, zona: 60, pais: 60, cobrador: 80, tipoCliente: 60, rubro: 60, codigoPostal: 10 };

/**
 * Valida/normaliza una fila de clientes con las reglas de ClienteForm.
 * @returns {{ ok: boolean, errores: string[], valor: object }}
 */
export const validarFilaCliente = (valores = {}, { existente = null, existentes = [], vendedores = [], now = new Date(), fechaCorta = 'mdy' } = {}) => {
  const errores = [];
  const tiene = (k) => Object.prototype.hasOwnProperty.call(valores, k) && !vacia(valores[k]);

  const excluidos = CAMPOS_EXCLUIDOS_PLANTILLA.clientes;
  const form = clienteVacio(now);
  if (existente) {
    for (const c of CAMPOS_CLIENTE) {
      if (excluidos.includes(c.key)) continue;
      if (existente[c.key] !== undefined && existente[c.key] !== null) form[c.key] = String(existente[c.key]);
    }
  }
  for (const [k, max] of Object.entries(TEXTO_CLIENTE)) if (tiene(k)) form[k] = textoSeguro(valores[k], max);
  if (tiene('provincia')) form.provincia = canonico(valores.provincia, PROVINCIAS);
  if (tiene('tipoIva')) form.tipoIva = canonico(valores.tipoIva, TIPOS_IVA);
  if (tiene('cuit')) form.cuit = celda(valores.cuit);
  if (tiene('telefono')) form.telefono = celda(valores.telefono);
  if (tiene('fechaAlta')) form.fechaAlta = normalizarFecha(valores.fechaAlta, { corta: fechaCorta });
  if (tiene('vendedor')) {
    const v = resolverVendedor(valores.vendedor, vendedores);
    if (!v.ok) errores.push(v.error);
    else form.vendedor = v.nombre;
  }

  // AC-PLA-4 / AC-COMR-2: la comision nunca sale del archivo. validarCliente
  // ya no devuelve la clave (ni en altas ni en actualizaciones), así que
  // { ...existente, ...valor } conserva el dato viejo de la ficha tal cual.
  const r = validarCliente(form, existentes, { editId: existente?.id ?? null, now });
  errores.push(...mensajes(r.errores));
  const valor = { ...r.cliente };
  if (existente) for (const k of excluidos) delete valor[k];
  return { ok: errores.length === 0, errores, valor };
};

// ---------------------------------------------------------------------------
// Planificacion de una importacion completa (pura): decide por fila si crea,
// actualiza o rechaza. La pagina solo ejecuta el plan contra IndexedDB.
// ---------------------------------------------------------------------------
const extraerValores = (fila, indices) => {
  const v = {};
  for (const [key, i] of Object.entries(indices)) v[key] = fila[i] ?? '';
  return v;
};

const claveNombre = (v) => texto(v, 160).toLowerCase();

/**
 * @param {Array<Array<any>>} rows filas crudas (la primera no vacia = encabezados)
 * @param {'productos'|'clientes'} entidad
 * @param {{ existentes?: object[], proveedores?: object[], vendedores?: object[], now?: Date,
 *   celdasDeMas?: boolean, fechaCorta?: 'mdy'|'dmy' }} ctx
 *   celdasDeMas: rechazar filas con celdas no vacias mas alla del encabezado
 *   (CSV, BUG-PLA-02). fechaCorta: como leer fechas con año de 2 digitos
 *   ('mdy' = celda de fecha de xlsx con raw:false; 'dmy' = CSV tipeado).
 * @returns {{ ok: boolean, error?: string, modo?: string, ignoradas?: string[],
 *   entradas: Array<{ fila: number, accion: 'crear'|'actualizar'|'rechazar'|'fusionada', valor?: any, existente?: any, errores: string[], stockIgnorado?: boolean }>,
 *   resumen: { creados: number, actualizados: number, rechazados: number, rechazos: Array<{fila:number, motivo:string}>, stockIgnorado: number } }}
 */
export const planificarImportacion = (rows, entidad = 'productos', { existentes = [], proveedores = [], vendedores = [], now = new Date(), celdasDeMas = false, fechaCorta = 'mdy' } = {}) => {
  columnasDe(entidad);
  const filas = (Array.isArray(rows) ? rows : []).map((r, i) => ({ r, n: i + 1 })).filter(x => !filaVacia(x.r));
  const vacio = { creados: 0, actualizados: 0, rechazados: 0, rechazos: [], stockIgnorado: 0, stockFallido: [], columnasExcluidas: [] };
  if (filas.length < 2) return { ok: false, error: 'El archivo no tiene datos suficientes.', entradas: [], resumen: vacio };

  // S-PLA-01: topes de filas y columnas antes de validar nada.
  const limite = errorLimitesArchivo({ headers: filas[0].r, datos: filas.length - 1 });
  if (limite) return { ok: false, error: limite, entradas: [], resumen: vacio };
  const headers = filas[0].r.map(h => celda(h));
  const largoEnc = largoEncabezado(headers);
  const { indices, ignoradas, excluidas, modo } = mapearEncabezados(headers, entidad);
  const detectados = headers.map(h => h.toLowerCase()).join(' | ');
  if (entidad === 'productos') {
    if (indices.nombre === undefined) return { ok: false, error: `No se encontró columna de nombre (Descripción). Encabezados detectados: ${detectados}`, entradas: [], resumen: vacio };
    if (indices.precio === undefined && indices.costoFinal === undefined) return { ok: false, error: `No se encontró columna de precio. Encabezados detectados: ${detectados}`, entradas: [], resumen: vacio };
  } else {
    const faltan = ['codigo', 'nombre', 'direccion'].filter(k => indices[k] === undefined)
      .map(k => COLUMNAS_PLANTILLA.clientes.find(c => c.key === k).label);
    if (faltan.length) return { ok: false, error: `Faltan columnas obligatorias: ${faltan.join(', ')}. Encabezados detectados: ${detectados}`, entradas: [], resumen: vacio };
  }

  const base = (Array.isArray(existentes) ? existentes : []).filter(Boolean);
  const porCodigo = new Map();
  const porNombre = new Map();
  for (const x of base) {
    if (x.codigo) porCodigo.set(claveUnica(x.codigo), x);
    if (entidad === 'productos' && x.nombre) porNombre.set(claveNombre(x.nombre), x);
  }
  // Lo ya tocado en este archivo: clave -> indice de la entrada.
  const vistosCodigo = new Map();
  const vistosNombre = new Map();
  const entradas = [];
  // AC-COMR-4: rubros existentes + los que va agregando este mismo archivo.
  const rubros = entidad === 'productos' ? listarRubros(base) : null;
  // AC-VTA-1: idem para la marca.
  const marcas = entidad === 'productos' ? listarMarcas(base) : null;
  const sumarRubro = (valor) => {
    const r = rubros ? resolverRubro(valor?.producto?.categoria, rubros) : null;
    if (r?.esNuevo) rubros.push(r.rubro);
    const m = marcas ? resolverMarca(valor?.producto?.marca, marcas) : null;
    if (m?.esNuevo) marcas.push(m.marca);
  };

  for (const { r, n } of filas.slice(1)) {
    // S-PLA-01 (celda demasiado larga) y BUG-PLA-02 (columnas corridas en un CSV).
    const problemas = problemasDeFila(r, largoEnc, { celdasDeMas });
    if (problemas.length) { entradas.push({ fila: n, accion: 'rechazar', errores: problemas }); continue; }
    const valores = extraerValores(r, indices);
    const codigoK = claveUnica(entidad === 'productos' ? textoSeguro(valores.codigo, 40) : textoSeguro(valores.codigo, 30));
    const nombreK = entidad === 'productos' ? claveNombre(textoSeguro(valores.nombre, 160)) : '';

    // ¿Esta fila apunta a algo que otra fila de este mismo archivo ya toco?
    let previo;
    if (codigoK) previo = vistosCodigo.get(codigoK);
    else if (nombreK) previo = vistosNombre.get(nombreK);
    if (previo !== undefined) {
      const prev = entradas[previo];
      if (entidad === 'clientes' || modo === 'plantilla') {
        entradas.push({ fila: n, accion: 'rechazar', errores: [`Código repetido en el archivo (ya está en la fila ${prev.fila})`] });
        continue;
      }
      // Archivo viejo: como antes, la ultima fila gana (se fusiona en la previa).
      const r2 = validarFilaProducto(valores, { existente: prev.accion === 'actualizar' ? prev.existente : null, existentes: base, proveedores, modo, rubros, marcas });
      if (!r2.ok) { entradas.push({ fila: n, accion: 'rechazar', errores: r2.errores }); continue; }
      sumarRubro(r2.valor);
      entradas[previo] = { ...prev, valor: { ...r2.valor, stock: prev.valor.stock } };
      entradas.push({ fila: n, accion: 'fusionada', errores: [], destino: prev.fila });
      continue;
    }

    const existente = (codigoK && porCodigo.get(codigoK)) || (nombreK ? porNombre.get(nombreK) : null) || null;
    const res = entidad === 'productos'
      ? validarFilaProducto(valores, { existente, existentes: base, proveedores, modo, rubros, marcas })
      : validarFilaCliente(valores, { existente, existentes: base, vendedores, now, fechaCorta });

    if (!res.ok) { entradas.push({ fila: n, accion: 'rechazar', errores: res.errores }); continue; }
    sumarRubro(res.valor);
    const idx = entradas.length;
    entradas.push({
      fila: n,
      accion: existente ? 'actualizar' : 'crear',
      existente,
      valor: res.valor,
      errores: [],
      stockIgnorado: !!res.stockIgnorado,
    });
    const codFinal = claveUnica(entidad === 'productos' ? res.valor.producto.codigo : res.valor.codigo);
    if (codFinal) vistosCodigo.set(codFinal, idx);
    if (codigoK && codigoK !== codFinal) vistosCodigo.set(codigoK, idx);
    if (nombreK) vistosNombre.set(nombreK, idx);
    const nombreFinal = entidad === 'productos' ? claveNombre(res.valor.producto.nombre) : '';
    if (nombreFinal) vistosNombre.set(nombreFinal, idx);
  }

  return { ok: true, modo, ignoradas, excluidas, entradas, resumen: resumirEntradas(entradas, { excluidas }) };
};

/**
 * Cuenta creados/actualizados/rechazados (una fila fusionada cuenta como actualizada).
 * C9 (AC-PLA-3 / AC-PROD-3): una entrada `crear` con `stockFallido: true` es un
 * producto que SI se creo pero cuyo movimiento de stock inicial fallo: cuenta
 * como creado y se lista en `stockFallido` ({ fila, motivo }).
 * AC-PLA-4: `excluidas` (p. ej. ["Comisión"]) se copia a `columnasExcluidas`.
 */
export const resumirEntradas = (entradas = [], { excluidas = [] } = {}) => {
  const resumen = {
    creados: 0, actualizados: 0, rechazados: 0, rechazos: [], stockIgnorado: 0,
    stockFallido: [], columnasExcluidas: Array.isArray(excluidas) ? excluidas.filter(Boolean).map(String) : [],
  };
  for (const e of (Array.isArray(entradas) ? entradas : [])) {
    if (e.accion === 'crear') {
      resumen.creados++;
      if (e.stockFallido) resumen.stockFallido.push({ fila: e.fila, motivo: (e.errores || []).join('; ') || 'No se pudo cargar el stock inicial' });
    } else if (e.accion === 'actualizar' || e.accion === 'fusionada') resumen.actualizados++;
    else {
      resumen.rechazados++;
      resumen.rechazos.push({ fila: e.fila, motivo: (e.errores || []).join('; ') || 'Fila inválida' });
    }
    if (e.stockIgnorado) resumen.stockIgnorado++;
  }
  return resumen;
};

const plural = (n, s, p) => `${n} ${n === 1 ? s : p}`;

/** Aviso de AC-PLA-4 cuando el archivo trae columnas que se ignoran a proposito. */
export const avisoColumnasExcluidas = (excluidas = []) => {
  const cols = (Array.isArray(excluidas) ? excluidas : []).filter(Boolean);
  if (!cols.length) return '';
  return `La columna ${cols.map(c => `"${c}"`).join(', ')} se ignoró: ahora la comisión se carga por vendedor y rubro (Configuración → Vendedores).`;
};

/**
 * Texto del resumen (AC-PLA-5). Conserva el formato viejo "N creados, M actualizados, K lineas ignoradas".
 * Agrega, si corresponde, el aviso de stock inicial fallido (C9) y el de columnas excluidas (AC-PLA-4).
 */
export const textoResumen = ({ creados = 0, actualizados = 0, rechazados = 0, stockFallido = [], columnasExcluidas = [] } = {}) => {
  const base = `✓ ${plural(creados, 'creado', 'creados')}, ${plural(actualizados, 'actualizado', 'actualizados')}` +
    `${rechazados > 0 ? `, ${plural(rechazados, 'línea ignorada', 'líneas ignoradas')}` : ''}.`;
  const extras = [];
  const fallidos = Array.isArray(stockFallido) ? stockFallido.length : 0;
  if (fallidos > 0) extras.push(`${fallidos} producto(s) creados SIN stock inicial: cargalo desde Stock (Ajuste).`);
  const aviso = avisoColumnasExcluidas(columnasExcluidas);
  if (aviso) extras.push(aviso);
  return [base, ...extras].join(' ');
};

// ---------------------------------------------------------------------------
// Armado de la plantilla (AC-PLA-1/2/6): hoja 1 solo encabezados, hoja 2
// "Instrucciones". Todas las celdas pasan por csvSafe.
// ---------------------------------------------------------------------------
export const ENCABEZADO_INSTRUCCIONES = ['Columna', 'Obligatorio', 'Formato', 'Valores válidos', 'Ejemplo'];

const valoresValidos = (entidad, key, { proveedores = [], vendedores = [] } = {}) => {
  if (entidad === 'clientes' && key === 'provincia') return lista(PROVINCIAS);
  if (entidad === 'clientes' && key === 'tipoIva') return lista(TIPOS_IVA);
  if (entidad === 'clientes' && key === 'vendedor') {
    const n = filtrarActivos(vendedores).map(v => texto(v.nombre, 80)).filter(Boolean);
    return n.length ? lista(n) : 'Vendedores activos de Configuración → Vendedores';
  }
  if (entidad === 'productos' && key === 'proveedorId') {
    const n = (proveedores || []).filter(Boolean).map(p => texto(p.descripcion, 80)).filter(Boolean);
    return n.length ? lista(n) : 'Proveedores de Configuración → Proveedores';
  }
  return '';
};

export const filasInstrucciones = (entidad, ctx = {}) => {
  const cols = columnasDe(entidad);
  const filas = [ENCABEZADO_INSTRUCCIONES];
  for (const c of cols) {
    filas.push([c.label, c.obligatorio, c.formato, valoresValidos(entidad, c.key, ctx), c.ejemplo]);
  }
  filas.push([]);
  filas.push(['Cómo usarla', 'Completá la primera hoja desde la fila 2, un registro por fila. No cambies los encabezados.']);
  filas.push(['Actualizar', entidad === 'productos'
    ? 'Si el código ya existe se actualiza ese producto (sin código, se busca por descripción). Las celdas vacías no borran datos.'
    : 'Si el código de cliente ya existe se actualiza ese cliente. Las celdas vacías no borran datos.']);
  filas.push(['Errores', 'Una fila con error se informa (número de fila y motivo) y no frena al resto.']);
  filas.push(['Seguridad', 'Las celdas que empiezan con = + - @ se guardan como texto (no como fórmula).']);
  return filas.map(f => f.map(csvSafe));
};

/**
 * @returns {{ nombreArchivo: string, hojas: Array<{ nombre: string, filas: any[][] }> }}
 */
export const armarPlantilla = (entidad, ctx = {}) => {
  const cols = columnasDe(entidad);
  return {
    nombreArchivo: NOMBRE_ARCHIVO_PLANTILLA[entidad],
    hojas: [
      { nombre: NOMBRE_HOJA[entidad], filas: [cols.map(c => csvSafe(c.label))] },
      { nombre: 'Instrucciones', filas: filasInstrucciones(entidad, ctx) },
    ],
  };
};
