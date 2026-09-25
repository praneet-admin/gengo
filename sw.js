/* Gengo service worker: makes the app installable and keeps the shell available offline.
   Network-first for everything, falling back to the cache — so updates are never stuck. */
const CACHE = 'gengo-shell-v1';
const SHELL = ['./', './index.html', './styles.css', './app.js', './manifest.webmanifest',
  './assets/bunny-192.png', './assets/bunny-512.png', './assets/favicon-32.png', './assets/favicon-64.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL).catch(function () {}); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) { return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return; // APIs and CDNs go straight to the network
  e.respondWith(
    fetch(e.request).then(function (res) {
      const copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
      return res;
    }).catch(function () {
      return caches.match(e.request, { ignoreSearch: true }).then(function (hit) { return hit || caches.match('./index.html'); });
    })
  );
});
