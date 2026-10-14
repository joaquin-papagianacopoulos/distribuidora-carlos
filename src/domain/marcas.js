// src/domain/marcas.js — REQ-VTA (AC-VTA-1): marca del producto.
// Misma normalización y dedupe que el rubro (AC-COMR-4): mayúsculas, espacios,
// tildes y Unicode combinante no generan marcas duplicadas.
import { normalizarRubro, claveRubro, listarRubros, resolverRubro } from './rubros';

export const normalizarMarca = normalizarRubro;
export const claveMarca = claveRubro;

// Marcas distintas de los productos (campo `marca`) + extras, orden alfabético.
export const listarMarcas = (productos, extras = []) => listarRubros(productos, extras, { campo: 'marca' });

// Si la clave ya existe se reutiliza la escritura existente.
export const resolverMarca = (valor, existentes = []) => {
  const r = resolverRubro(valor, existentes);
  return { marca: r.rubro, clave: r.clave, esNuevo: r.esNuevo };
};

// Prioridad: la que se tipeó/eligió en el form > la que ya tenía el producto >
// la detectada por el nombre. Siempre pasa por resolverMarca (dedupe).
export const marcaParaGuardar = ({ marcaForm, marcaExistente, nombre, marcas = [], detectar } = {}) => {
  const lista = Array.isArray(marcas) ? marcas : [];
  for (const c of [marcaForm, marcaExistente]) {
    const r = resolverMarca(c, lista);
    if (r.marca) return r.marca;
  }
  if (typeof detectar === 'function') {
    let d = '';
    try { d = detectar(nombre); } catch (e) { d = ''; }
    return resolverMarca(d, lista).marca;
  }
  return '';
};
