var CACHE = 'zap-v2';
self.addEventListener('install', function (e) { self.skipWaiting(); });
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  var isDoc = e.request.mode === 'navigate' || url.pathname === '/' || /\.html$/.test(url.pathname);
  e.respondWith(caches.open(CACHE).then(function (cache) {
    if (isDoc) {
      return fetch(e.request).then(function (resp) {
        if (resp && resp.ok) cache.put(e.request, resp.clone()).catch(function () {});
        return resp;
      }).catch(function () {
        return cache.match(e.request).then(function (hit) { if (hit) return hit; throw new Error('offline'); });
      });
    }
    return cache.match(e.request).then(function (hit) {
      if (hit) return hit;
      return fetch(e.request).then(function (resp) {
        if (resp && resp.ok) cache.put(e.request, resp.clone()).catch(function () {});
        return resp;
      });
    });
  }));
});
