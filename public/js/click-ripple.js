// Click ripple (fix/pills-band-ripple-card) — soft gold ring at the
// click point, shop + admin panel, everywhere.
//
// donal said (2026-11-27, in Bangla script): wherever I click with
// the mouse — in the admin panel and on the website — give a
// beautiful click effect so it looks advanced; the click effect must
// be beautiful.
//
// How it works: on left-click (pointerdown, button 0) a small gold
// ring (<span class="click-ripple">) appears exactly at the click
// point, expands gently and fades out in ~600ms (CSS animation in
// public/css/style.css), then removes itself. pointer-events: none,
// so it NEVER blocks or delays the real click; it only decorates.
// At most 3 ripples alive — spamming drops the oldest first.
// Skipped: clicks inside text inputs / textareas / selects /
// contenteditable (typing must never ripple), right-clicks and
// middle-clicks, and everything when prefers-reduced-motion is on.
// Touch/pen: a pointerdown also fires when a scroll starts, so on
// touch/pen the ripple only fires on interactive elements
// (links, buttons, toggles) — scrolling never ripples.
// No existing click behaviour is touched: this only ADDS a span
// to the body on pointerdown; dropdowns, toggles, forms and the
// cart all work exactly as before.
//
// No live MySQL needed to test: the IIFE is exercised in a stubbed
// DOM (vm sandbox — no jsdom in node_modules), see
// scripts/test-pills-band-ripple-card.js.
//
// Run:  node scripts/test-pills-band-ripple-card.js
'use strict';

(function () {
  if (typeof document === 'undefined' || !document.body) return;
  if (typeof window !== 'undefined' && window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var MAX_RIPPLES = 3;
  var DURATION = 600;

  var FORM_FIELD = 'input, textarea, select, [contenteditable="true"], [contenteditable=""]';
  var INTERACTIVE = 'a, button, input[type="button"], input[type="submit"], input[type="checkbox"], input[type="radio"], [role="button"], summary, label';

  function spawn(x, y) {
    var ripple = document.createElement('span');
    ripple.className = 'click-ripple';
    ripple.style.left = x + 'px';
    ripple.style.top = y + 'px';
    // At most MAX_RIPPLES alive — drop the oldest first.
    var old = document.querySelectorAll('.click-ripple');
    while (old.length >= MAX_RIPPLES) {
      if (old[0].parentNode) old[0].parentNode.removeChild(old[0]);
      old = document.querySelectorAll('.click-ripple');
    }
    document.body.appendChild(ripple);
    var done = false;
    function remove() {
      if (done) return;
      done = true;
      if (ripple.parentNode) ripple.parentNode.removeChild(ripple);
    }
    ripple.addEventListener('animationend', remove);
    if (typeof setTimeout === 'function') setTimeout(remove, DURATION + 150);
  }

  document.addEventListener('pointerdown', function (e) {
    if (e.button !== 0) return;
    var t = e.target;
    if (!t || typeof t.closest !== 'function') return;
    if (t.closest(FORM_FIELD)) return;
    // Touch/pen: pointerdown also fires when a scroll starts — only
    // ripple on interactive elements there; mouse ripples anywhere.
    if (e.pointerType && e.pointerType !== 'mouse' && !t.closest(INTERACTIVE)) return;
    spawn(e.clientX, e.clientY);
  });
})();
