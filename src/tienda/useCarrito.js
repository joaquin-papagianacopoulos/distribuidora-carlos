// src/tienda/useCarrito.js — carrito de la tienda (REQ-TIE, AC-TIE-10).
// Persiste en localStorage con try/catch: si falla, sigue funcionando en memoria.
import { useCallback, useEffect, useRef, useState } from 'react';
import { serializarCarrito, restaurarCarrito, unidadesIniciales, minimoDe, precioUnitarioTienda } from '../domain/tienda';

export const CLAVE_CARRITO = 'tienda_carrito_v1';
export const CLAVE_CONTACTO = 'tienda_contacto_v1';

export const leerStorage = (clave) => {
  try { return window.localStorage.getItem(clave); } catch { return null; }
};
export const escribirStorage = (clave, valor) => {
  try { window.localStorage.setItem(clave, valor); return true; } catch { return false; }
};

export function useCarrito() {
  const [lineas, setLineas] = useState(() => {
    const c = restaurarCarrito(leerStorage(CLAVE_CARRITO), Date.now());
    return c ? c.lineas : [];
  });
  const primera = useRef(true);

  useEffect(() => {
    if (primera.current) { primera.current = false; return; }
    escribirStorage(CLAVE_CARRITO, serializarCarrito({ lineas }, Date.now()));
  }, [lineas]);

  // Agrega `unidades` (o la cantidad inicial del producto) y fija precioVisto al precio que ve el cliente.
  const agregar = useCallback((prod, unidades, modo = 'unidad') => {
    const u = unidades || unidadesIniciales(prod);
    setLineas(prev => {
      const i = prev.findIndex(l => String(l.productoId) === String(prod.id));
      if (i < 0) return [...prev, { productoId: String(prod.id), unidades: u, modo, precioVisto: precioUnitarioTienda(prod, u) }];
      const copia = [...prev];
      copia[i] = { ...copia[i], unidades: copia[i].unidades + u, modo, precioVisto: precioUnitarioTienda(prod, copia[i].unidades + u) };
      return copia;
    });
  }, []);

  const cambiar = useCallback((productoId, unidades, prod) => {
    setLineas(prev => prev.map(l => {
      if (String(l.productoId) !== String(productoId)) return l;
      const min = prod ? minimoDe(prod) : 1;
      const nuevas = Math.max(min, Math.floor(Number(unidades) || min));
      // AC-PBU-4: al cruzar un bulto cambia el precio que ve el cliente (y el precioVisto).
      return { ...l, unidades: nuevas, ...(prod ? { precioVisto: precioUnitarioTienda(prod, nuevas) } : {}) };
    }));
  }, []);

  const quitar = useCallback((productoId) => {
    setLineas(prev => prev.filter(l => String(l.productoId) !== String(productoId)));
  }, []);

  const vaciar = useCallback(() => {
    setLineas([]);
    escribirStorage(CLAVE_CARRITO, serializarCarrito({ lineas: [] }, Date.now()));
  }, []);

  const reemplazar = useCallback((nuevas) => setLineas(nuevas), []);

  const cantidadTotal = lineas.length;
  return { lineas, agregar, cambiar, quitar, vaciar, reemplazar, cantidadTotal };
}
