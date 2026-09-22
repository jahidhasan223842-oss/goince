// Goince Admin PWA Service Worker
// Kaj 2ta: (1) admin panel-ke "Install-jogyo App" banano, (2) Push Notification dekhano.

self.addEventListener('install', function (event) {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
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
