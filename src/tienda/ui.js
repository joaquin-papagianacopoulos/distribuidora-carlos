// src/tienda/ui.js — piezas visuales chicas de la tienda: íconos y contexto de UI.
import React, { createContext } from 'react';

// Datos de presentación compartidos por todas las vistas (rubros del menú, token).
export const TiendaUiContext = createContext({ rubrosMenu: [], token: '' });

export const IconoLupa = () => (
  <svg className="t-icono" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
    <circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
    <path d="M15.5 15.5 21 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

export const IconoCarrito = () => (
  <svg className="t-icono" viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" focusable="false">
    <path d="M2.5 3.5h2.6l2.4 11.2a1.6 1.6 0 0 0 1.6 1.3h8.6a1.6 1.6 0 0 0 1.5-1.1L21.5 8H6.2"
      fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="9.6" cy="20" r="1.5" fill="currentColor" />
    <circle cx="17.4" cy="20" r="1.5" fill="currentColor" />
  </svg>
);

export const IconoFlecha = ({ izquierda = false }) => (
  <svg className="t-icono" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"
    style={izquierda ? { transform: 'scaleX(-1)' } : undefined}>
    <path d="m9 5 7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const IconoCheck = () => (
  <svg className="t-icono" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
    <path d="m5 12.5 4.2 4.2L19 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
