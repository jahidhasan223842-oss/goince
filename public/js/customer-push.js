// Customer web push opt-in (feat/retention, F8).
// Kaj: Service Worker register kora, /push-vapid-key theke public key
// niye subscribe kora, server-e (/push-subscribe) subscription pathano,
// ar UI-te ekta choto banner dekhano jate customer nijer icche moto
// Enable/chere dite pare.
//
// INACTIVE until donal saves VAPID keys + enables push in
// Admin > Settings > Retention: /push-vapid-key tokhon publicKey null
// dey, ar ei script chup chap kichu na kore beriye jay — kono error
// noy, kono prompt-o noy. Purono browser-eo silently skip.
(function () {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return;
  }

  function urlBase64ToUint8Array(base64String) {
    var padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    var rawData = window.atob(base64);
    var outputArray = new Uint8Array(rawData.length);
    for (var i = 0; i < rawData.length; i++) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  function csrfHeaders() {
    var headers = { 'Content-Type': 'application/json' };
    if (window.GOINCE_CSRF_TOKEN) headers['x-csrf-token'] = window.GOINCE_CSRF_TOKEN;
    return headers;
  }

  function showBanner(publicKey) {
    if (document.getElementById('customer-push-banner')) return;
    if (localStorage.getItem('goince-customer-push-dismissed') === '1') return;
    var banner = document.createElement('div');
    banner.id = 'customer-push-banner';
    banner.className = 'push-enable-banner';
    banner.innerHTML =
      '<span>🔔 New offers &amp; order updates by notification?</span>' +
      '<button type="button" id="customer-push-enable-btn">Enable</button>' +
      '<button type="button" id="customer-push-dismiss-btn" aria-label="Close">✕</button>';
    document.body.appendChild(banner);

    document.getElementById('customer-push-enable-btn').addEventListener('click', function () {
      subscribe(publicKey);
      banner.remove();
    });
    document.getElementById('customer-push-dismiss-btn').addEventListener('click', function () {
      localStorage.setItem('goince-customer-push-dismissed', '1');
      banner.remove();
    });
  }

  async function subscribe(publicKey) {
    try {
      var permission = await Notification.requestPermission();
      if (permission !== 'granted') return;
      var reg = await navigator.serviceWorker.ready;
      var subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      await fetch('/push-subscribe', {
        method: 'POST',
        headers: csrfHeaders(),
        body: JSON.stringify({ subscription: subscription }),
      });
    } catch (e) {
      // Subscribe fail korle chup chap chere dao — shop cholbe ager motoi.
    }
  }

  // Shudhu tokhon-i banner dekhano hoy jokhon server bole push
  // chalu + public key ache; na hole kichui hoy na.
  fetch('/push-vapid-key')
    .then(function (res) { return res.json(); })
    .then(function (data) {
      if (!data || !data.publicKey) return;
      return navigator.serviceWorker.register('/sw.js').then(function () {
        return navigator.serviceWorker.ready;
      }).then(function (reg) {
        return reg.pushManager.getSubscription();
      }).then(function (existing) {
        if (!existing) showBanner(data.publicKey);
      });
    })
    .catch(function () { /* push off / network vul — silently skip */ });
})();
