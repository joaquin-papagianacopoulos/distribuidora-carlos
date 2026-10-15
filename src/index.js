// src/index.js — punto de entrada. Elige entre la tienda pública y la app interna.
// REQ-TIE (AC-TIE-1): la tienda es un chunk aparte (React.lazy) que NO importa
// IndexedDB, sync, sesión ni pantallas internas. Este archivo solo importa
// `domain/tienda` (puro) para decidir; ./App y ./tienda/TiendaApp se cargan
// con import() dinámico, nunca de forma estática.
import React, { Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { esEntradaTienda } from './domain/tienda';

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations()
    .then(registrations => registrations.forEach(reg => reg.unregister()))
    .catch(() => {});
}

if ('caches' in window) {
  caches.keys()
    .then(keys => keys.forEach(key => caches.delete(key)))
    .catch(() => {});
}

const esTienda = esEntradaTienda(window.location, process.env.REACT_APP_TIENDA_HOSTS);

// Chunks separados: en un host de tienda nunca se descarga ni ejecuta la app interna.
const Entrada = esTienda
  ? React.lazy(() => import('./tienda/TiendaApp'))
  : React.lazy(() => import('./App'));

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <Suspense fallback={null}>
      <Entrada />
    </Suspense>
  </React.StrictMode>
);
