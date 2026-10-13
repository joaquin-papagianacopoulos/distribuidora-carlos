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
export const puedeBorrarProveedor = (proveedorId, productos = []) => {
  const asociados = productos.filter(p => p && p.proveedorId === proveedorId);
  return { ok: asociados.length === 0, asociados: asociados.length };
};

export const proveedorToRemote = (p) => ({ id: p.id, codigo: p.codigo, descripcion: p.descripcion });
export const proveedorFromRemote = (r) => ({
  id: r.id, codigo: r.codigo ?? '', descripcion: r.descripcion ?? '', pendingSync: false,
});
