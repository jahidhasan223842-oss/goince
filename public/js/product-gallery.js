// Product gallery (fix/product-hover-gallery) — fixed photo sizes,
// hover zoom following the cursor, zoom in/out + reset, prev/next
// arrows, thumbnail active ring, keyboard support.
//
// donal said (2026-11-27, in Romanized Bengali): inside any product
// there are many photos — fix the size on mobile and PC/desktop;
// the product does not zoom — the big photo should zoom when the
// cursor goes over it, and zoom in/out must be possible; add any
// other feature that belongs. A code check found the thumbnail
// sizes were wrong too: `.thumbnail` (0,1,0) lost the width fight
// to `.product-image img` (0,1,1), so thumbnails tried to take the
// row's full width instead of 60px.
//
// How it works: the stage is a fixed 4/3 frame (same on mobile and
// desktop), the photo is object-fit: contain so the whole image is
// always visible. Zoom levels are 1x / 2x / 3x. On a hover-capable
// device, entering the stage magnifies to 2x and the zoom follows
// the cursor (transform-origin tracks the pointer); leaving resets
// it. Click/tap toggles 1x <-> 2x. The + / − buttons step through
// the levels, ⟲ resets to 1x. Prev/next arrows (and ←/→ keys when
// the gallery is focused) step through the photos; + / - / 0 keys
// zoom. Changing photo resets the zoom. Variant/option code swaps
// the main image src directly — a MutationObserver on the src
// attribute resets the zoom then too, so no change was needed in
// that code. Reduced motion: the zoom still works (it is a user
// control, not ambient motion) — only the transition is instant.
//
// No live MySQL needed to test: the IIFE is exercised in a stubbed
// DOM (vm sandbox — no jsdom in node_modules).
//
// Run:  node scripts/test-product-hover-gallery.js
'use strict';

(function () {
  if (typeof document === 'undefined') return;

  var ZOOM_MAX = 3;

  var stage = document.getElementById('gallery-stage');
  if (!stage) return;
  var img = document.getElementById('main-product-image');
  if (!img) return;

  var thumbs = Array.prototype.slice.call(document.querySelectorAll('.thumbnail'));
  var images = thumbs.map(function (t) {
    return t.getAttribute('data-full') || t.getAttribute('src');
  }).filter(Boolean);
  if (!images.length) images = [img.getAttribute('src') || img.src];

  var prevBtn = document.getElementById('gallery-prev');
  var nextBtn = document.getElementById('gallery-next');
  var zoomInBtn = document.getElementById('gallery-zoom-in');
  var zoomOutBtn = document.getElementById('gallery-zoom-out');
  var zoomResetBtn = document.getElementById('gallery-zoom-reset');

  var index = 0;
  var zoom = 1;
  var zoomFromHover = false;
  var canHover = typeof window !== 'undefined' && window.matchMedia &&
    window.matchMedia('(hover: hover)').matches;

  function syncZoomButtons() {
    if (zoomInBtn) zoomInBtn.disabled = zoom >= ZOOM_MAX;
    if (zoomOutBtn) zoomOutBtn.disabled = zoom <= 1;
  }

  function applyZoom() {
    if (zoom > 1) {
      img.style.transform = 'scale(' + zoom + ')';
      if (stage.classList) stage.classList.add('is-zoomed');
    } else {
      img.style.transform = '';
      if (stage.classList) stage.classList.remove('is-zoomed');
    }
    syncZoomButtons();
  }

  function setZoom(level) {
    zoom = Math.max(1, Math.min(ZOOM_MAX, level));
    zoomFromHover = false;
    applyZoom();
  }

  function showImage(i) {
    if (!images.length) return;
    index = ((i % images.length) + images.length) % images.length;
    img.setAttribute('src', images[index]);
    thumbs.forEach(function (t, ti) {
      if (t.classList) t.classList.toggle('active', ti === index);
    });
    setZoom(1);
  }

  function showBySrc(src, el) {
    var i = images.indexOf(src);
    if (i >= 0) {
      showImage(i);
      return;
    }
    // Chobi list-er baire (jemon option-er chobi) — direct bodol.
    img.setAttribute('src', src);
    thumbs.forEach(function (t) {
      if (t.classList) t.classList.toggle('active', t === el);
    });
    setZoom(1);
  }

  function step(d) { showImage(index + d); }

  // Desktop hover zoom: stage-e dhukle 2x, cursor jekhane zoom
  // shekhane (transform-origin cursor-er % -e), berole 1x.
  if (canHover) {
    stage.addEventListener('mouseenter', function () {
      if (zoom === 1) {
        zoom = 2;
        zoomFromHover = true;
        applyZoom();
      }
    });
    stage.addEventListener('mousemove', function (e) {
      if (zoom <= 1) return;
      var rect = stage.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      var x = ((e.clientX - rect.left) / rect.width) * 100;
      var y = ((e.clientY - rect.top) / rect.height) * 100;
      img.style.transformOrigin = x.toFixed(1) + '% ' + y.toFixed(1) + '%';
    });
    stage.addEventListener('mouseleave', function () {
      if (zoomFromHover) setZoom(1);
    });
  }

  // Touch swipe (feat/mobile-pwa, H3): mobile-e stage-er upor angul
  // dan/bam-e tanle ager/porer chobi ase. Niyom: shudhu jokhon zoom
  // 1x (zoom kora thakle swipe chobi bodlay na — zoom kora chobi
  // pan kora jay), shudhu horizontal swipe (|dx| >= 40px ar
  // |dx| > |dy| — vertical scroll-e hat deoa hoy na), ar video
  // slide cholle swipe hoy na. Swipe-er pore asa click-ta zoom
  // toggle kore na (300ms suppress). Arrows / thumbnail / keyboard
  // / zoom ager motoi chole; desktop-e kichu bodlay na.
  var SWIPE_MIN_PX = 40;
  var SWIPE_SUPPRESS_MS = 300;
  var touchStartX = null;
  var touchStartY = null;
  var lastSwipeAt = 0;

  function isVideoShowing() {
    var v = document.getElementById('product-video');
    return !!(v && !v.hidden);
  }

  function handleSwipeDelta(dx, dy) {
    if (zoom !== 1) return false;
    if (isVideoShowing()) return false;
    if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) <= Math.abs(dy)) return false;
    step(dx < 0 ? 1 : -1);
    return true;
  }

  stage.addEventListener('touchstart', function (e) {
    var t = e.changedTouches && e.changedTouches[0];
    if (!t) return;
    touchStartX = t.clientX;
    touchStartY = t.clientY;
  }, { passive: true });
  stage.addEventListener('touchend', function (e) {
    var t = e.changedTouches && e.changedTouches[0];
    if (!t || touchStartX === null || touchStartY === null) return;
    var dx = t.clientX - touchStartX;
    var dy = t.clientY - touchStartY;
    touchStartX = null;
    touchStartY = null;
    if (handleSwipeDelta(dx, dy)) lastSwipeAt = Date.now();
  }, { passive: true });

  // Click/tap (chobi ba stage-er upor, button-e na): 1x <-> 2x toggle.
  stage.addEventListener('click', function (e) {
    if (Date.now() - lastSwipeAt < SWIPE_SUPPRESS_MS) return;
    if (e.target !== img && e.target !== stage) return;
    setZoom(zoom === 1 ? 2 : 1);
  });

  if (prevBtn) prevBtn.addEventListener('click', function () { step(-1); });
  if (nextBtn) nextBtn.addEventListener('click', function () { step(1); });
  if (zoomInBtn) zoomInBtn.addEventListener('click', function () { setZoom(zoom + 1); });
  if (zoomOutBtn) zoomOutBtn.addEventListener('click', function () { setZoom(zoom - 1); });
  if (zoomResetBtn) zoomResetBtn.addEventListener('click', function () { setZoom(1); });

  // Keyboard: gallery focus thakle ←/→ chobi bodlay, + / - zoom,
  // 0 reset. (Button focus thakle button-er nijer key kaj kore.)
  stage.addEventListener('keydown', function (e) {
    if (e.target !== stage && e.target !== img) return;
    if (e.key === 'ArrowLeft') { step(-1); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { step(1); e.preventDefault(); }
    else if (e.key === '+' || e.key === '=') { setZoom(zoom + 1); e.preventDefault(); }
    else if (e.key === '-' || e.key === '_') { setZoom(zoom - 1); e.preventDefault(); }
    else if (e.key === '0') { setZoom(1); e.preventDefault(); }
  });

  // Variant/option code main chobi-r src direct bodlay — tokhon
  // zoom reset kore deya, jate purono zoom notun chobite lege na thake.
  if (typeof window !== 'undefined' && window.MutationObserver) {
    var observer = new window.MutationObserver(function (mutations) {
      for (var k = 0; k < mutations.length; k++) {
        if (mutations[k].attributeName === 'src' && zoom !== 1) setZoom(1);
      }
    });
    observer.observe(img, { attributes: true, attributeFilter: ['src'] });
  }

  syncZoomButtons();

  // product.ejs-er swapImage() (thumbnail onclick) ei API diye chobi bodlay.
  window.GoinceGallery = {
    showImage: showImage,
    showBySrc: showBySrc,
    setZoom: setZoom,
    getZoom: function () { return zoom; },
    getIndex: function () { return index; },
    getImages: function () { return images.slice(); },
    handleSwipeDelta: handleSwipeDelta,
    getSwipeMinPx: function () { return SWIPE_MIN_PX; }
  };
})();
