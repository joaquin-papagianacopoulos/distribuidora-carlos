// src/domain/proveedores.js — REQ-PROV: alta de proveedores.
import { texto, claveUnica } from './validacion';

export const CAMPOS_PROVEEDOR = [
  { key: 'codigo', label: 'Código', requerido: true },
  { key: 'descripcion', label: 'Descripción', requerido: true },
];

export const validarProveedor = (form = {}, existentes = [], { editId = null } = {}) => {
  const errores = {};
  const p = { codigo: texto(form.codigo, 30), descripcion: texto(form.descripcion, 120) };
  if (!p.codigo) errores.codigo = 'El código es obligatorio';
  if (!p.descripcion) errores.descripcion = 'La descripción es obligatoria';
  if (p.codigo) {
    const k = claveUnica(p.codigo);
    const dup = existentes.find(x => x && x.id !== editId && claveUnica(x.codigo) === k);
    if (dup) errores.codigo = `El código ya está usado por "${dup.descripcion}"`;
  }
  return { ok: Object.keys(errores).length === 0, errores, proveedor: p };
};

// AC-PROV-3: no se borra un proveedor con productos asociados.
export const puedeBorrarProveedor = (proveedorId, productos = [], ingresos = []) => {
  const asociados = productos.filter(p => p && p.proveedorId === proveedorId);
  // Un proveedor con mercaderia ingresada no se puede borrar: en Supabase el ingreso lo referencia
  // (on delete restrict) y se perderia el historial de compras.
  const conIngresos = (ingresos || []).filter(i => i && String(i.proveedorId) === String(proveedorId)).length;
  const r = { ok: asociados.length === 0 && conIngresos === 0, asociados: asociados.length };
  return conIngresos ? { ...r, ingresos: conIngresos } : r;
};

// Baja logica (migracion 021): un proveedor con historial de compras no se borra, se da de baja.
// "activo" solo viaja cuando es false: sin la migracion aplicada, el resto de los proveedores
// sigue sincronizando igual que antes.
export const proveedorEstaActivo = (p) => !!p && p.activo !== false;
export const soloProveedoresActivos = (lista = []) => (lista || []).filter(proveedorEstaActivo);

export const proveedorToRemote = (p) => ({
  id: p.id, codigo: p.codigo, descripcion: p.descripcion,
  ...(p.activo === false ? { activo: false } : {}),
});
export const proveedorFromRemote = (r) => ({
  id: r.id, codigo: r.codigo ?? '', descripcion: r.descripcion ?? '', pendingSync: false,
  ...(r.activo === false ? { activo: false } : {}),
});
