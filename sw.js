// Service Worker — offline cache for World Cup 2026 Predictor
const CACHE = 'wc26-v6';
const ASSETS = [
  '/',
  '/index.html',
  '/data/teams.js',
  '/data/matches.js',
  '/model/stats.js',
  '/model/elo.js',
  '/model/dixon-coles.js',
  '/model/gbdt.js',
  '/model/monte-carlo.js',
  '/mc-worker.js'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // Network-first for API calls, cache-first for static assets
  if (e.request.url.includes('/api/') || e.request.url.includes('polymarket') || e.request.url.includes('football-data')) {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
  } else {
    e.respondWith(
      caches.match(e.request).then(r => r || fetch(e.request).then(resp => {
        const clone = resp.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return resp;
      }))
    );
  }
});
