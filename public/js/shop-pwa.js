// Shop PWA client (feat/mobile-pwa).
// Kaj 3ta:
//   (1) Service Worker register (SHOP page thekei — admin page-e ei
//       file load hoy na, tai admin-e SW register hoy na ekhan theke;
//       /sw.js nije /admin/*, cart/checkout/API kokhono cache kore
//       na). Register fail korle / SW na thakle site ager motoi
//       cholbe — kichu vangbe na.
//   (2) Offline cart snapshot: mini-cart drawer-er TAZA HTML
//       localStorage-e save kora (shudhu ja sotti cart-e chhilo tai —
//       kichu banano hoy na). Offline hole /offline.html sei snapshot
//       dekhay. Cart khali hole snapshot mochha hoy.
//   (3) Online/offline UI: cart page-er notice + drawer-er vitore
//       offline banner; mobile bottom nav-er Categories button
//       (drawer khole); beforeinstallprompt dhore rakha (browser-er
//       "Add to Home Screen" prompt-er jonno).
//
// No live MySQL needed to test: vm sandbox-e stubbed DOM diye chole.
// Run: node scripts/test-mobile-pwa.js
(function () {
  'use strict';

  var SNAP_KEY = 'goince-cart-snapshot-v1';

  function safe(fn, fallback) {
    try {
      var v = fn();
      return (typeof v === 'undefined') ? fallback : v;
    } catch (e) { return fallback; }
  }

  // ---------- (1) Service Worker ----------
  // Shudhu shop-e: ei file-ta shudhu shop footer theke load hoy.
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    try {
      var regPromise = navigator.serviceWorker.register('/sw.js', { scope: '/' });
      if (regPromise && typeof regPromise.catch === 'function') {
        regPromise.catch(function () { /* SW fail — site ager motoi cholbe */ });
      }
    } catch (e) { /* SW register kora na gele chupchap cholbe */ }
  }

  // ---------- (2) Offline cart snapshot ----------
  function readSnapshot() {
    return safe(function () {
      var raw = window.localStorage.getItem(SNAP_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (!data || typeof data.html !== 'string' || !(data.count > 0)) return null;
      return data;
    }, null);
  }

  function saveSnapshot() {
    return safe(function () {
      if (typeof document === 'undefined' || !document.getElementById) return false;
      var drawer = document.getElementById('mini-cart-drawer');
      if (!drawer || !drawer.querySelectorAll) return false;
      var items = drawer.querySelectorAll('.mini-cart-item');
      if (!items || !items.length) {
        try { window.localStorage.removeItem(SNAP_KEY); } catch (e) {}
        return false;
      }
      var data = {
        html: drawer.innerHTML,
        count: items.length,
        savedAt: Date.now()
      };
      window.localStorage.setItem(SNAP_KEY, JSON.stringify(data));
      return true;
    }, false);
  }

  // ---------- (3) Online / offline UI ----------
  function isOffline() {
    return safe(function () {
      return typeof navigator !== 'undefined' && navigator.onLine === false;
    }, false);
  }

  function updateOfflineUI() {
    if (typeof document === 'undefined' || !document.getElementById) return;
    var offline = isOffline();
    // Cart page-er notice (cart.ejs #offline-notice).
    var notice = document.getElementById('offline-notice');
    if (notice) notice.hidden = !offline;
    // Mini-cart drawer-er vitore banner: offline hole last-saved
    // cart dekhacche janano; online hole sorano.
    var drawer = document.getElementById('mini-cart-drawer');
    if (drawer) {
      var banner = null;
      if (drawer.querySelector) banner = drawer.querySelector('.offline-banner');
      if (offline && !banner && document.createElement) {
        banner = document.createElement('div');
        banner.className = 'offline-banner';
        banner.setAttribute('role', 'status');
        banner.textContent = '📶 You\u2019re offline — showing your last saved cart. Prices and stock may have changed.';
        if (drawer.insertBefore && drawer.firstChild) drawer.insertBefore(banner, drawer.firstChild);
        else if (drawer.appendChild) drawer.appendChild(banner);
      } else if (!offline && banner && banner.parentNode && banner.parentNode.removeChild) {
        banner.parentNode.removeChild(banner);
      }
    }
    // Bottom nav-er Cart badge offline-eo thik thake (server HTML).
  }

  // ---------- Mobile bottom nav: Categories button ----------
  // Drawer kholar button (#shop-menu-btn, header.ejs) age thekei
  // ache — nav-er Categories chaple setai chapano hoy (notun
  // drawer banano hoy na, notun URL-o lage na).
  function wireBottomNav() {
    if (typeof document === 'undefined' || !document.getElementById) return;
    var catsBtn = document.getElementById('mobile-nav-cats');
    var menuBtn = document.getElementById('shop-menu-btn');
    if (catsBtn && menuBtn && catsBtn.addEventListener) {
      catsBtn.addEventListener('click', function () {
        if (menuBtn.click) menuBtn.click();
      });
    }
  }

  // ---------- "Add to Home Screen" ----------
  // Browser-er install prompt nije theke ashle dhore rakha hoy —
  // custom banner banano hoy ni (manifest + SW thaklei browser
  // install offer kore). promptInstall() call korle asol prompt
  // dekhano hoy.
  var deferredPrompt = null;
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('beforeinstallprompt', function (e) {
      if (e && e.preventDefault) e.preventDefault();
      deferredPrompt = e;
    });
    window.addEventListener('online', updateOfflineUI);
    window.addEventListener('offline', updateOfflineUI);
  }

  // Prothom load-e: snapshot save + offline UI + nav wiring.
  // Script footer-er sheshe load hoy (DOM toiri), tai sorasori
  // chollei hoy — DOMContentLoaded-er opekkha lage na.
  saveSnapshot();
  updateOfflineUI();
  wireBottomNav();

  window.GoinceOfflineCart = {
    saveSnapshot: saveSnapshot,
    readSnapshot: readSnapshot,
    updateOfflineUI: updateOfflineUI,
    isOffline: isOffline,
    KEY: SNAP_KEY
  };

  window.GoincePWA = {
    canInstall: function () { return !!deferredPrompt; },
    promptInstall: function () {
      if (!deferredPrompt) return Promise.resolve(false);
      var p = deferredPrompt;
      deferredPrompt = null;
      if (p.prompt) p.prompt();
      if (p.userChoice && typeof p.userChoice.then === 'function') {
        return p.userChoice.then(function (choice) {
          return !!(choice && choice.outcome === 'accepted');
        }).catch(function () { return false; });
      }
      return Promise.resolve(true);
    }
  };
})();
