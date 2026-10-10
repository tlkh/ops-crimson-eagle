const VERSION = 'crimson-eagle-v12';
const VOICE_CUES = [
  'go_lake', 'lake_descend', 'lake_climb', 'lake_slow', 'lake_align',
  'fetch_water', 'bucket_filling', 'bucket_full', 'load_limit', 'go_fire',
  'fire_altitude', 'fire_slow', 'fire_align', 'release_water', 'water_released',
  'fire_cooling', 'another_load', 'fire_secured', 'landing_descend',
  'landing_slow', 'landing_settle', 'sg_attach_deck', 'sg_bucket_rigged',
  'sg_return_ship', 'sg_secure_bucket', 'jp_go_shore', 'jp_attach_shore',
  'jp_sling_attached', 'jp_return_shore', 'jp_remove_sling', 'jp_return_ship',
  'return_fuel_low', 'fuel_critical', 'fuel_exhausted', 'aircraft_lost',
  'aircraft_damaged', 'sortie_complete', 'callsign_singa', 'callsign_japan',
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll([
    './', './index.html', './manifest.webmanifest', './apple-touch-icon.png',
    './icon-192.png', './icon-512.png', './assets/crimson-eagle-mark.png',
    './assets/seruyan-satellite-fire.webp', './assets/ketapang-satellite-fire.webp',
    './music/menu.mp3', './fonts/Rajdhani-Medium.ttf', './fonts/Rajdhani-SemiBold.ttf',
    ...VOICE_CUES.map(id => `./voice/${id}.mp3`),
  ])));
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== VERSION).map(key => caches.delete(key)))));
  self.clients.claim();
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.includes('/music/') && url.pathname.endsWith('.mp3')) {
    event.respondWith((async () => {
      const cache = await caches.open(VERSION);
      let response = await cache.match(request.url);
      if (!response) {
        response = await fetch(request.url);
        if (response.ok && response.status === 200) await cache.put(request.url, response.clone());
      }
      const range = request.headers.get('range');
      if (!range || !response.ok) return response;
      const bytes = await response.arrayBuffer();
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      const size = bytes.byteLength;
      const suffix = match && !match[1] ? Number(match[2]) : 0;
      const start = match ? (match[1] ? Number(match[1]) : Math.max(0, size - suffix)) : size;
      const end = match ? Math.min(size - 1, match[2] && match[1] ? Number(match[2]) : size - 1) : -1;
      if (!match || start > end || !Number.isFinite(start) || !Number.isFinite(end)) {
        return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
      }
      return new Response(bytes.slice(start, end + 1), {
        status: 206,
        headers: {
          'Accept-Ranges': 'bytes',
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Content-Length': String(end - start + 1),
          'Content-Type': response.headers.get('Content-Type') || 'audio/mpeg',
        },
      });
    })());
    return;
  }
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
