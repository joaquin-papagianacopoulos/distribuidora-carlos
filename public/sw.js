const CACHE_NAME = 'distribuidora-v2';

// Solo cacheamos assets estáticos que NO cambian (iconos, manifest)
// Los JS/CSS los dejamos pasar siempre a la red
const STATIC_CACHE = [
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // Intentamos cachear pero no fallamos si alguno no existe
      return Promise.allSettled(STATIC_CACHE.map(url => cache.add(url)));
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Requests a Supabase: siempre a la red, nunca al cache
  if (url.hostname.includes('supabase.co')) {
    return;
  }

  // JS y CSS: network-first, sin cachear (evita el problema del F5)
  if (url.pathname.includes('/static/')) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  // HTML (navegación): network-first, fallback a index.html
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Resto: cache-first
  event.respondWith(
    caches.match(event.request).then(cached => {
      return cached || fetch(event.request);
    })
  );
});