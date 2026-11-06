/* Сервис-воркер: приложение работает без интернета. Данные записей здесь не хранятся,
   кэшируются только файлы самого приложения. */
const VERSION = 'v0.5.0';
const CACHE = 'dnevnik6-' + VERSION;
const FILES = ['./', './index.html', './style.css', './app.js', './quotes.js', './manifest.webmanifest',
  './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(cached => {
    const net = fetch(e.request, { cache: 'no-cache' }).then(res => {
      if (res && res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()));
      return res;
    }).catch(() => cached);
    return cached || net;
  }));
});
