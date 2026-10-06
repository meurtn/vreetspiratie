// Service worker: app werkt offline. Verhoog VERSIE na elke wijziging aan de app.
const VERSIE = 'vreet-v9';
const SCHIL = ['./', './index.html', './app.js', './firebase-config.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSIE).then(c => c.addAll(SCHIL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(k => Promise.all(k.filter(n => n !== VERSIE).map(n => caches.delete(n))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const eigen = url.origin === location.origin;
  const statisch = /(^|\.)gstatic\.com$/.test(url.hostname) || url.hostname === 'fonts.googleapis.com';
  if (!eigen && !statisch) return; // Firestore en Auth zelf niet onderscheppen

  e.respondWith(caches.open(VERSIE).then(async cache => {
    const opgeslagen = await cache.match(req);
    const vers = fetch(req).then(res => {
      if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
      return res;
    }).catch(() => opgeslagen);
    // Eigen bestanden: eerst cache, op de achtergrond verversen. Externe bibliotheken: cache als die er is.
    return opgeslagen || vers;
  }));
});
