const VERSION = 'crimson-eagle-v6';
self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll([
    './', './index.html', './manifest.webmanifest', './apple-touch-icon.png',
    './icon-192.png', './icon-512.png', './assets/crimson-eagle-mark.png',
    './assets/seruyan-satellite-fire.webp', './assets/ketapang-satellite-fire.webp',
  ])));
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== VERSION).map(key => caches.delete(key)))));
  self.clients.claim();
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      if (response.ok) {
        const copy = response.clone();
        void caches.open(VERSION).then(cache => cache.put('./index.html', copy));
      }
      return response;
    }).catch(async () => (await caches.match('./index.html')) || Response.error()));
    return;
  }
  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
    if (response.ok) {
      const copy = response.clone();
      void caches.open(VERSION).then(cache => cache.put(request, copy));
    }
    return response;
  })));
});
