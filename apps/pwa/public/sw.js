// Service worker de la PWA de campo (#15, R1).
// Cache-first del shell: permite abrir la app sin conexión.
const CACHE = 'campo-shell-v1';
const SHELL = ['/', '/index.html', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Solo navegaciones y assets locales: las llamadas a la API NUNCA pasan
  // por esta caché (las gestiona el motor de sync, R4-R8).
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cacheada) => {
      if (cacheada) return cacheada;
      return fetch(event.request).then((respuesta) => {
        if (respuesta.ok && url.pathname.startsWith('/assets/')) {
          const copia = respuesta.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copia));
        }
        return respuesta;
      });
    }),
  );
});
