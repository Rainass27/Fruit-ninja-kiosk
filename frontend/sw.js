const CACHE_NAME = 'neon-ninja-cache-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/controller.html',
  '/game.html',
  '/lobby.js',
  '/controller.js',
  '/game.js',
  '/qrcode.min.js',
  '/manifest.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    }).catch(err => console.warn('PWA caching skipped on install:', err))
  );
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      return cachedResponse || fetch(e.request);
    }).catch(() => fetch(e.request))
  );
});
