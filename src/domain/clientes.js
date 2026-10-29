// src/domain/clientes.js — REQ-CLI: alta de clientes.
import { texto, formatearCuit, esFechaISO, hoyISO, claveUnica, soloDigitos } from './validacion';

// Lista usada por la tienda online (checkout). Los clientes ya no tienen provincia.
export const PROVINCIAS = [
  'Buenos Aires', 'CABA', 'Catamarca', 'Chaco', 'Chubut', 'Córdoba', 'Corrientes',
  'Entre Ríos', 'Formosa', 'Jujuy', 'La Pampa', 'La Rioja', 'Mendoza', 'Misiones',
  'Neuquén', 'Río Negro', 'Salta', 'San Juan', 'San Luis', 'Santa Cruz', 'Santa Fe',
  'Santiago del Estero', 'Tierra del Fuego', 'Tucumán',
];

export const TIPOS_IVA = [
  'Responsable Inscripto', 'Monotributo', 'Exento', 'Consumidor Final', 'No Responsable',
];

// Orden y etiquetas EXACTOS que pidió el cliente (AC-CLI-1). REQ-COMR
// (AC-COMR-1): "Comisión" ya no es un campo del cliente (quedan 16). El dato
// viejo `comision` se conserva en IndexedDB y en Supabase, pero no se muestra,
// no se valida, no se mapea y no se usa. REQ-CLI2 (AC-CLI2-2): lo mismo con
// "Provincia" (quedan 15): el dato viejo se conserva pero no se toca.
export const CAMPOS_CLIENTE = [
  { key: 'codigo', label: 'Código cliente', requerido: true },
  { key: 'nombre', label: 'Razón social', requerido: true },
  { key: 'direccion', label: 'Domicilio de entrega', requerido: true },
  { key: 'ciudad', label: 'Ciudad' },
  { key: 'codigoPostal', label: 'Código postal' },
  { key: 'zona', label: 'Zona' },
  { key: 'pais', label: 'País' },
  { key: 'tipoIva', label: 'Tipo de IVA', tipo: 'select', opciones: TIPOS_IVA },
  { key: 'cuit', label: 'CUIT' },
  { key: 'contacto', label: 'Nombre de contacto' },
  { key: 'telefono', label: 'Celular', tipo: 'tel' },
  { key: 'vendedor', label: 'Vendedor', tipo: 'vendedor' },
  { key: 'cobrador', label: 'Cobrador' },
  { key: 'fechaAlta', label: 'Fecha de alta', tipo: 'date' },
  { key: 'tipoCliente', label: 'Tipo de cliente' },
  { key: 'rubro', label: 'Rubro' },
];

export const clienteVacio = (now = new Date()) => ({
  codigo: '', nombre: '', direccion: '', ciudad: '', codigoPostal: '',
  zona: '', pais: 'Argentina', tipoIva: '', cuit: '', contacto: '', telefono: '', vendedor: '',
  cobrador: '', fechaAlta: hoyISO(now), tipoCliente: '', rubro: '',
});

// Sugiere el próximo código numérico libre (ej. "0042").
export const sugerirCodigoCliente = (existentes = []) => {
  const nums = existentes.map(c => Number(soloDigitos(c?.codigo))).filter(n => Number.isFinite(n) && n > 0);
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return String(next).padStart(4, '0');
};

/**
 * Valida y normaliza un cliente.
 * @returns {{ ok: boolean, errores: Record<string,string>, cliente: object }}
 */
export const validarCliente = (form = {}, existentes = [], { editId = null, now = new Date() } = {}) => {
  const errores = {};
  const c = {
    codigo: texto(form.codigo, 30),
    nombre: texto(form.nombre, 120),
    direccion: texto(form.direccion, 160),
    ciudad: texto(form.ciudad, 80),
    codigoPostal: texto(form.codigoPostal, 10).toUpperCase().replace(/\s/g, ''),
    zona: texto(form.zona, 60),
    pais: texto(form.pais, 60) || 'Argentina',
    tipoIva: texto(form.tipoIva, 40),
    cuit: '',
    contacto: texto(form.contacto, 80),
    telefono: soloDigitos(form.telefono).slice(0, 15),
    vendedor: texto(form.vendedor, 80),
    cobrador: texto(form.cobrador, 80),
    fechaAlta: texto(form.fechaAlta, 10) || hoyISO(now),
    tipoCliente: texto(form.tipoCliente, 60),
    rubro: texto(form.rubro, 60),
  };

  if (!c.codigo) errores.codigo = 'El código es obligatorio';
  if (!c.nombre) errores.nombre = 'La razón social es obligatoria';
  if (!c.direccion) errores.direccion = 'El domicilio de entrega es obligatorio';

  if (c.codigo) {
    const k = claveUnica(c.codigo);
    const dup = existentes.find(x => x && x.id !== editId && claveUnica(x.codigo) === k);
    if (dup) errores.codigo = `El código ya está usado por "${dup.nombre}"`;
  }

  if (c.codigoPostal && !/^[A-Z0-9]{4,8}$/.test(c.codigoPostal)) {
    errores.codigoPostal = 'Código postal inválido (4 a 8 letras/números)';
  }
  if (c.tipoIva && !TIPOS_IVA.includes(c.tipoIva)) errores.tipoIva = 'Tipo de IVA inválido';

  // REQ-CLI2 (AC-CLI2-1): el CUIT es opcional y no se valida. Si tiene 11
  // dígitos se guarda con guiones; si no, tal cual se escribió.
  const cuitRaw = soloDigitos(form.cuit);
  c.cuit = cuitRaw.length === 11 ? formatearCuit(cuitRaw) : texto(form.cuit, 20);

  if (c.telefono && (c.telefono.length < 8 || c.telefono.length > 15)) {
    errores.telefono = 'El celular debe tener entre 8 y 15 dígitos';
  }

  if (!esFechaISO(c.fechaAlta)) errores.fechaAlta = 'Fecha de alta inválida';

  return { ok: Object.keys(errores).length === 0, errores, cliente: c };
};

// Columnas nuevas en Supabase (snake_case). Las legacy las arma syncClientes.
// AC-COMR-1: `comision` NO viaja en ninguna fila. PostgREST arma el upsert por
// lote con la unión de claves: si una sola fila la mandara, al resto se le
// pondría null. Sin la clave, el ON CONFLICT no toca la columna existente.
// AC-CLI2-2: `provincia` tampoco viaja, por la misma razón.
export const clienteExtraToRemote = (c = {}) => ({
  codigo: c.codigo || null,
  ciudad: c.ciudad || null,
  codigo_postal: c.codigoPostal || null,
  zona: c.zona || null,
  pais: c.pais || null,
  tipo_iva: c.tipoIva || null,
  cuit: c.cuit || null,
  contacto: (c.contacto && String(c.contacto).trim()) || null,
  vendedor: c.vendedor || null,
  cobrador: c.cobrador || null,
  fecha_alta: c.fechaAlta || null,
  tipo_cliente: c.tipoCliente || null,
  rubro: c.rubro || null,
});

// Lectura tolerante: si la columna no existe en Supabase (undefined) se
// conserva el valor local (AC-CLI-5 / AC-CLI-6).
export const clienteExtraFromRemote = (r = {}, local = {}) => {
  const pick = (col, key) => (r[col] !== undefined ? (r[col] ?? '') : (local?.[key] ?? ''));
  return {
    codigo: pick('codigo', 'codigo'),
    ciudad: pick('ciudad', 'ciudad'),
    codigoPostal: pick('codigo_postal', 'codigoPostal'),
    zona: pick('zona', 'zona'),
    pais: pick('pais', 'pais'),
    tipoIva: pick('tipo_iva', 'tipoIva'),
    cuit: pick('cuit', 'cuit'),
    contacto: pick('contacto', 'contacto'),
    vendedor: pick('vendedor', 'vendedor'),
    cobrador: pick('cobrador', 'cobrador'),
    fechaAlta: pick('fecha_alta', 'fechaAlta'),
    tipoCliente: pick('tipo_cliente', 'tipoCliente'),
    rubro: pick('rubro', 'rubro'),
  };
};

// AC-CON-1: línea de la lista: codigo · direccion · contacto · celular (sin vacíos).
export const resumenCliente = (c = {}) =>
  [c.codigo, c.direccion, c.contacto, c.telefono].filter(x => x && String(x).trim()).join(' · ');

// Escalón de sync (R1): quita la columna `contacto` si Supabase todavía no la tiene.
export const sinContacto = (row = {}) => {
  const { contacto, ...resto } = row; // eslint-disable-line no-unused-vars
  return resto;
};

export const nombraColumnaContacto = (error) => {
  const msg = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`.toLowerCase();
  return /\bcontacto\b/.test(msg);
};
