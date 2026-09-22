// Admin Panel-e Push Notification enable korar jonno.
// Kaj: Service Worker register kora, VAPID public key niye subscribe kora,
// server-e (/admin/push-subscribe) subscription pathano, ar UI-te ekta
// choto banner dekhano jate admin nijer icche moto Enable/chere dite pare.

(function () {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return; // Purono browser — silently skip, kono error dekhabe na
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; i++) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  function showBanner() {
    if (document.getElementById('push-enable-banner')) return;
    const banner = document.createElement('div');
    banner.id = 'push-enable-banner';
    banner.className = 'push-enable-banner';
    banner.innerHTML =
      '<span>🔔 Notun Order asle notification pete চাও?</span>' +
      '<button type="button" id="push-enable-btn">চালু করো</button>' +
      '<button type="button" id="push-dismiss-btn" aria-label="Close">✕</button>';
    document.body.appendChild(banner);

    document.getElementById('push-enable-btn').addEventListener('click', function () {
      subscribe();
      banner.remove();
    });
    document.getElementById('push-dismiss-btn').addEventListener('click', function () {
      localStorage.setItem('goince-push-dismissed', '1');
      banner.remove();
    });
  }

  async function subscribe() {
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return;

      const reg = await navigator.serviceWorker.ready;
      const keyRes = await fetch('/admin/vapid-public-key');
      const keyData = await keyRes.json();
      if (!keyData.configured || !keyData.key) return; // .env e VAPID key set kora nei

      let subscription = await reg.pushManager.getSubscription();
      if (!subscription) {
        subscription = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(keyData.key)
        });
      }

      await fetch('/admin/push-subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription)
      });
    } catch (err) {
      console.error('Push subscribe failed:', err);
    }
  }

  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js').then(function () {
      if (
        Notification.permission === 'default' &&
        !localStorage.getItem('goince-push-dismissed')
      ) {
        showBanner();
      } else if (Notification.permission === 'granted') {
        subscribe(); // age theke permission thakle chup chap re-subscribe (subscription expire hote pare)
      }
    }).catch(function (err) {
      console.error('Service worker registration failed:', err);
    });
  });
})();
