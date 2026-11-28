// Goince Service Worker — shop PWA + Admin push (feat/mobile-pwa).
//
// DUITA kaj:
//   (1) SHOP PWA: app shell / static asset cache + offline fallback.
//       Shudhu shop-er STATIC jinis-i cache hoy (CSS/JS/icon, product
//       chobi) — daam/stock kokhono stale dekhano jabe na, tai HTML
//       page, cart/checkout/payment, API, ar admin-er kichui cache
//       hoy NA. Service Worker na thakle / fail korle site ager
//       motoi cholbe (kono page SW-er upor nirvor kore na).
//   (2) ADMIN PUSH (ager motoi): notun order-er notification.
//
// Cache niyom (fetch handler):
//   - GET + same-origin chara kichu dhora hoy na.
//   - /admin/*, /cart, /checkout*, /login, /signup, /account*,
//     /track-order, /api/*, /push-*, /newsletter/* — NETWORK ONLY.
//   - Navigation (page load): network-first; offline hole
//     /offline.html (sekhane last-known cart snapshot dekhay).
//     Admin navigation offline hole offline page dekhano hoy NA —
//     admin-er kaj offline-e hoy na, browser-er nijer error-i thik.
//   - /css/, /js/, /icons/ (assetUrl ?v= cache-bust thakleo
//     ignoreSearch-e match hoy): stale-while-revalidate.
//   - /uploads/, /images/: stale-while-revalidate, runtime cache
//     ~60-ta chobi porjonto (cap best-effort).
//   - Baki shob (product page, homepage, search...): network only,
//     kono cache noy — daam/stock sob somoy TAZA.
//   - Shudhu 200 + basic response-i cache hoy.

var GOINCE_CACHE_VERSION = 'goince-shop-v1';
var GOINCE_STATIC_CACHE = GOINCE_CACHE_VERSION + '-static';
var GOINCE_IMAGE_CACHE = GOINCE_CACHE_VERSION + '-images';
var GOINCE_OFFLINE_URL = '/offline.html';
var GOINCE_PRECACHE = [
  GOINCE_OFFLINE_URL,
  '/css/style.css',
  '/js/theme.js',
  '/js/shop-pwa.js',
  '/js/mega-menu.js',
  '/js/product-gallery.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

// Network-only path prefix (fresh thaktei hobe, kokhono cache noy).
var NETWORK_ONLY_PREFIXES = [
  '/admin/',
  '/admin',
  '/cart',
  '/checkout',
  '/login',
  '/signup',
  '/account',
  '/track-order',
  '/api/',
  '/push-',
  '/newsletter'
];

function isNetworkOnlyPath(pathname) {
  for (var i = 0; i < NETWORK_ONLY_PREFIXES.length; i++) {
    var p = NETWORK_ONLY_PREFIXES[i];
    var last = p.slice(-1);
    // '/admin/' / '/api/' — prefix match; '/push-' — prefix match;
    // '/cart' / '/checkout' / '/login' — exact ba '/.../' niche.
    if (last === '/' || last === '-') {
      if (pathname.indexOf(p) === 0) return true;
    } else if (pathname === p || pathname.indexOf(p + '/') === 0) {
      return true;
    }
  }
  return false;
}

function isStaticAsset(pathname) {
  return pathname.indexOf('/css/') === 0 || pathname.indexOf('/js/') === 0 || pathname.indexOf('/icons/') === 0;
}

function isImageAsset(pathname) {
  return pathname.indexOf('/uploads/') === 0 || pathname.indexOf('/images/') === 0;
}

function cacheableResponse(response) {
  return !!response && response.status === 200 && response.type === 'basic';
}

// Runtime image cache cap: beshi hole purono entry sorano hoy
// (best-effort — cap fail korleo cache-i cholbe, site vangbe na).
function trimCache(cacheName, maxEntries) {
  return caches.open(cacheName).then(function (cache) {
    return cache.keys().then(function (keys) {
      if (keys.length <= maxEntries) return;
      var extra = keys.slice(0, keys.length - maxEntries);
      return Promise.all(extra.map(function (key) { return cache.delete(key); }));
    });
  }).catch(function () { /* cap best-effort */ });
}

function staleWhileRevalidate(cacheName, request, maxEntries) {
  return caches.open(cacheName).then(function (cache) {
    return cache.match(request, { ignoreSearch: true }).then(function (cached) {
      var network = fetch(request).then(function (response) {
        if (cacheableResponse(response)) {
          cache.put(request, response.clone());
          if (maxEntries) trimCache(cacheName, maxEntries);
        }
        return response;
      }).catch(function () {
        // Network fail + cache thakle cached-ta-i deo (niche).
        return cached || Promise.reject(new Error('offline'));
      });
      // Cache thakle sathe sathe cached, na thakle network-er
      // opekkha (prothombar).
      return cached || network;
    });
  });
}

self.addEventListener('install', function (event) {
  self.skipWaiting();
  event.waitUntil(
    caches.open(GOINCE_STATIC_CACHE).then(function (cache) {
      return cache.addAll(GOINCE_PRECACHE);
    }).catch(function () {
      // Precach-er ekta file-o na pele install fail hobe na —
      // SW tobuo register hobe, runtime cache diyei cholbe.
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        if (key.indexOf('goince-') === 0 && key !== GOINCE_STATIC_CACHE && key !== GOINCE_IMAGE_CACHE) {
          return caches.delete(key);
        }
        return Promise.resolve();
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (!request || request.method !== 'GET') return;
  var url;
  try {
    url = new URL(request.url);
  } catch (e) { return; }
  if (url.origin !== self.location.origin) return;
  var pathname = url.pathname;

  // Fresh thaktei hobe — network only, kono cache / fallback noy.
  if (isNetworkOnlyPath(pathname)) return;

  // Navigation (page load): network-first; offline hole
  // /offline.html — shudhu shop navigation-e (admin-e noy).
  if (request.mode === 'navigate') {
    if (pathname.indexOf('/admin') === 0) return;
    event.respondWith(
      fetch(request).catch(function () {
        return caches.match(GOINCE_OFFLINE_URL, { ignoreSearch: true });
      })
    );
    return;
  }

  // Static asset: stale-while-revalidate (?v= ignore kore).
  if (isStaticAsset(pathname)) {
    event.respondWith(staleWhileRevalidate(GOINCE_STATIC_CACHE, request));
    return;
  }

  // Product chobi: stale-while-revalidate, cap 60.
  if (isImageAsset(pathname)) {
    event.respondWith(staleWhileRevalidate(GOINCE_IMAGE_CACHE, request, 60));
    return;
  }

  // Baki shob: network only (HTML page, search, product page...).
});

// Notun order asle server theke ei push event ashbe — sathe sathe
// phone/browser-e notification dekhabe.
self.addEventListener('push', function (event) {
  let data = { title: 'Goince Admin', body: 'Notun update ache.', url: '/admin/dashboard' };
  try {
    if (event.data) data = Object.assign(data, event.data.json());
  } catch (e) {
    if (event.data) data.body = event.data.text();
  }

  const options = {
    body: data.body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    vibrate: [200, 100, 200],
    data: { url: data.url || '/admin/dashboard' }
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

// Notification-e click korle, order/dashboard page-e niye jabe
// (already open tab thakle sheta focus korbe, na thakle notun tab kholbe)
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/admin/dashboard';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
      for (const client of clientList) {
        if (client.url.includes(targetUrl) && 'focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
