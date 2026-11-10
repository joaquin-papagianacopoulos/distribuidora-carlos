// src/domain/precioCosto.js — REQ-PVC: el precio de venta nunca queda igual al costo por omisión.
// Funciones puras (sin React ni IndexedDB).
import { calcularPrecioVenta } from './productos';
import { toNum } from './validacion';

const sinDato = (v) => v === undefined || v === null || v === '';

// AC-PVC-3: ganancia "desconocida" (dispositivo sin los costos bajados con PIN) no es 0.
export const gananciaConocida = (p) => !!p && !sinDato(p.ganancia);

const costoConocido = (p) => !!p && !sinDato(p.costoFinal);

// El precio guardado es exactamente el que da la fórmula con los costos del producto.
export const precioEsCalculado = (p) => {
  if (!costoConocido(p) || !gananciaConocida(p)) return false;
  const precio = toNum(p.precio);
  if (precio === null) return false;
  return Math.abs(precio - calcularPrecioVenta(p).precioVenta1) < 0.005;
};

/**
 * AC-PVC-1: ¿se recalcula el precio de un producto existente al importar?
 * Solo si la ganancia efectiva es > 0 y el precio anterior era el calculado o estaba vacío/0.
 * `form` trae la ganancia ya resuelta (la de la fila o la del existente).
 */
export const debeRecalcularPrecio = (existente, form) => {
  if (!existente) return true;
  const g = sinDato(form?.ganancia) ? null : toNum(form.ganancia);
  if (g === null || !(g > 0)) return false;
  const anterior = toNum(existente.precio);
  if (anterior === null || anterior <= 0) return true;
  return precioEsCalculado(existente);
};

/**
 * AC-PVC-3: precio que el formulario autocompleta al tipear costos/ganancia.
 * Devuelve null = no tocar el campo.
 */
export const autocompletarPrecio = (next, { precioManual = false, gananciaDesconocida = false } = {}) => {
  if (precioManual || gananciaDesconocida) return null;
  const g = sinDato(next?.ganancia) ? 0 : toNum(next.ganancia);
  if (!(g > 0)) return null;
  const { precioVenta1 } = calcularPrecioVenta(next);
  return String(precioVenta1);
};

/**
 * AC-PVC-4: productos con precio igual o menor al costo neto (costo conocido > 0).
 * Los productos sin costos bajados (undefined) se saltean.
 */
export const productosConPrecioSospechoso = (productos) => {
  const out = [];
  for (const p of Array.isArray(productos) ? productos : []) {
    if (!p || !costoConocido(p)) continue;
    const { costoNeto } = calcularPrecioVenta(p);
    if (!(costoNeto > 0)) continue;
    const precio = toNum(p.precio) ?? 0;
    if (precio <= costoNeto) out.push({ id: p.id, codigo: p.codigo, nombre: p.nombre, precio, costoNeto });
  }
  return out;
};
