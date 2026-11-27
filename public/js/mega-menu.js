// Header mega menu (Categories): DESKTOP-e (769px+) click-e toggle, hover-e
// CSS-e khole. Mobile-e (≤768px) main-nav lukano thake, bodle hamburger
// drawer khole (niche shop drawer IIFE) — mega panel mobile-e ar khole na.
// Keyboard: button-e focus korle khole, Esc chaple bondho hoy, baire click
// korle bondho hoy, Tab kore panel-er baire gele bondho hoy.
(function () {
  var wrap = document.querySelector('.mega-menu-wrap');
  if (!wrap) return;
  var panel = document.getElementById('mega-menu-panel');
  var buttons = [
    document.getElementById('mega-menu-btn')
  ].filter(Boolean);
  if (!panel || !buttons.length) return;

  function setOpen(open) {
    panel.classList.toggle('open', open);
    buttons.forEach(function (b) { b.setAttribute('aria-expanded', open ? 'true' : 'false'); });
  }
  function isOpen() { return panel.classList.contains('open'); }
  // Click-e khola hole panel "latched" thake (mouse soraleo khula thake).
  // Hover-e khola thakle click korle bondho hobe na — latch kore khula rakhbe;
  // latch kora obosthay abar click korlei shudhu bondho hobe.
  var latched = false;

  buttons.forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (isOpen() && latched) {
        setOpen(false);
        latched = false;
      } else {
        setOpen(true);
        latched = true;
      }
    });
    // Keyboard-e button-e focus ashle-i panel khulbe, jate Tab kore
    // vitore dhoka jay.
    btn.addEventListener('focus', function () { setOpen(true); });
  });

  // Baire click korle bondho.
  document.addEventListener('click', function (e) {
    if (isOpen() && !wrap.contains(e.target)) { setOpen(false); latched = false; }
  });
  // Esc chaple bondho, focus button-e firbe.
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && isOpen()) {
      setOpen(false);
      latched = false;
      if (buttons[0]) buttons[0].focus();
    }
    // Category-bar pill dropdown :focus-within diye khole, tai Esc-e focus
    // soriye dilei dropdown bondho hoye jay.
    if (e.key === 'Escape') {
      var ae = document.activeElement;
      if (ae && ae.closest && ae.closest('.cat-pill-wrap')) ae.blur();
    }
  });
  // Focus puro menu-r baire chole gele bondho (Tab kore beriye gele).
  wrap.addEventListener('focusout', function (e) {
    if (!wrap.contains(e.relatedTarget)) { setOpen(false); latched = false; }
  });
})();

// Mobile shop drawer (≤768px): hamburger chaple bam dik theke slide kore
// ashe. Overlay chaple, ✕ chaple ba Esc chaple bondho hoy; khola thakle
// body scroll bondho thake. Drawer-er Categories accordion + protita main
// category-r sub-toggle ekhanei handle kora hoy (mega panel-er purono
// mobile accordion ekhon ar dorkar nei — panel mobile-e kholei na).
(function () {
  var btn = document.getElementById('shop-menu-btn');
  var drawer = document.getElementById('shop-drawer');
  var overlay = document.getElementById('shop-drawer-overlay');
  if (!btn || !drawer || !overlay) return;
  var closeBtn = document.getElementById('shop-drawer-close');

  function setOpen(open) {
    drawer.classList.toggle('open', open);
    overlay.classList.toggle('open', open);
    document.body.classList.toggle('shop-drawer-open', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    drawer.setAttribute('aria-hidden', open ? 'false' : 'true');
  }

  btn.addEventListener('click', function () {
    setOpen(true);
    if (closeBtn) closeBtn.focus();
  });
  if (closeBtn) {
    closeBtn.addEventListener('click', function () { setOpen(false); btn.focus(); });
  }
  overlay.addEventListener('click', function () { setOpen(false); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && drawer.classList.contains('open')) {
      setOpen(false);
      btn.focus();
    }
  });

  // Categories accordion: chaple puro tree khulbe/bondho hobe.
  var catBtn = document.getElementById('shop-drawer-cat-btn');
  var catList = document.getElementById('shop-drawer-cat-list');
  if (catBtn && catList) {
    catBtn.addEventListener('click', function () {
      var open = catList.classList.toggle('open');
      catBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  // Protita main category-r sub-toggle: chaple tar sub-category list
  // khulbe/bondho hobe.
  drawer.querySelectorAll('.shop-drawer-sub-toggle').forEach(function (toggle) {
    toggle.addEventListener('click', function (e) {
      e.stopPropagation();
      var item = toggle.closest('.shop-drawer-cat');
      if (!item) return;
      var open = item.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  });
})();

// Sticky shop header shadow (fix/shop-menu-bar): scroll korlei
// header-er niche halka chhaya pore — bar-ta content-er upore vasche
// bojha jay. Uporer dike (scroll 0) chhaya nei.
(function () {
  var header = document.querySelector('.site-header');
  if (!header) return;
  var ticking = false;
  function update() {
    ticking = false;
    header.classList.toggle('is-stuck', (window.pageYOffset || document.documentElement.scrollTop || 0) > 0);
  }
  function onScroll() {
    if (!ticking) {
      ticking = true;
      (window.requestAnimationFrame || function (fn) { fn(); })(update);
    }
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  update();
})();

// Active nav link (fix/shop-header-hover): bortoman page-er link-e
// halka gold underline thake (CSS-e .main-nav > a.active::after) —
// kothay achi bojha jay. Server header-e kono active class pathay
// na, tai JS-e pathname miliye bosano hoy. Home (/) shudhu exact
// /-tei active; ?category= thakle Home na, Categories button
// active hoy. /product/... er moto page-e kono link-e active pore na.
(function () {
  var nav = document.querySelector('.main-nav');
  if (!nav) return;
  var path = window.location.pathname;
  var isCategoryPage = /[?&]category=/.test(window.location.search);
  Array.prototype.forEach.call(nav.children, function (child) {
    if (child.tagName !== 'A') return;
    var href = child.getAttribute('href');
    if (!href) return;
    if (href === path && !(href === '/' && isCategoryPage)) child.classList.add('active');
  });
  if (isCategoryPage) {
    var megaBtn = document.getElementById('mega-menu-btn');
    if (megaBtn) megaBtn.classList.add('active');
  }
})();
// Desktop-e (769px+) search bar sob somoy dekha jay, tai ei toggle
// tokhon lukano thake (CSS) — JS kichhu kore na. Khulle input-e focus
// jay, Esc chaple bondho hoy. Suggestions/Enter/submit-er logic footer-er
// inline script-e ager motoi ache — form DOM-e thake, shudhu lukano
// thake, tai kichhu vange na.
(function () {
  var btn = document.getElementById('shop-search-btn');
  var form = document.getElementById('shop-search-row');
  var input = document.getElementById('search-input');
  if (!btn || !form) return;

  function setOpen(open) {
    form.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.setAttribute('aria-label', open ? 'Close search' : 'Search');
    btn.textContent = open ? '✕' : '🔍';
    if (open && input) input.focus();
  }

  btn.addEventListener('click', function () {
    setOpen(!form.classList.contains('open'));
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && form.classList.contains('open')) {
      setOpen(false);
      btn.focus();
    }
  });
})();
