// Customer profile photo cropper (fix/customer-profile-section): vanilla
// JS, no library — the same proven pattern as the admin profile cropper
// (views/admin/profile.ejs), with customer-photo-* element ids.
// After a file is chosen, the photo is shown in a square stage with a
// draggable square crop box (drag to move, drag the corner to resize)
// and a zoom slider. Pointer Events cover mouse + touch. The crop is
// sent as fractions of the photo's own size (crop_x, crop_y, crop_size);
// the server clamps them and crops to a 256x256 WebP square. Without
// JavaScript the form still works — the server takes a centred square.
// The live circle preview is 64px — the constant below (p) must match
// the CSS .customer-photo-crop-preview size, or the preview shows the
// wrong area.
(function () {
  var fileInput = document.getElementById('customer-photo-file');
  var wrap = document.getElementById('customer-photo-crop-wrap');
  var stage = document.getElementById('customer-photo-crop-stage');
  var img = document.getElementById('customer-photo-crop-img');
  var box = document.getElementById('customer-photo-crop-box');
  var handle = document.getElementById('customer-photo-crop-handle');
  var zoom = document.getElementById('customer-photo-crop-zoom');
  var preview = document.getElementById('customer-photo-crop-preview');
  var fx = document.getElementById('customer-photo-crop-x');
  var fy = document.getElementById('customer-photo-crop-y');
  var fs = document.getElementById('customer-photo-crop-size');
  var saveBtn = document.getElementById('customer-photo-save-btn');
  var errEl = document.getElementById('customer-photo-error');
  if (!fileInput || !wrap) return;
  var state = null;
  function clamp(v, min, max) { return Math.max(min, Math.min(v, max)); }
  function layout() {
    if (!state) return;
    var S = stage.clientWidth;
    if (!S) return;
    var base = Math.min(S / state.nw, S / state.nh);
    state.iw = state.nw * base * state.z;
    state.ih = state.nh * base * state.z;
    state.ix = (S - state.iw) / 2;
    state.iy = (S - state.ih) / 2;
    var maxBs = Math.min(state.iw, state.ih);
    if (state.bs > maxBs) state.bs = maxBs;
    state.bx = clamp(state.bx, state.ix, state.ix + state.iw - state.bs);
    state.by = clamp(state.by, state.iy, state.iy + state.ih - state.bs);
    img.style.width = state.iw + 'px';
    img.style.height = state.ih + 'px';
    img.style.left = state.ix + 'px';
    img.style.top = state.iy + 'px';
    box.style.left = state.bx + 'px';
    box.style.top = state.by + 'px';
    box.style.width = state.bs + 'px';
    box.style.height = state.bs + 'px';
    var p = 64;
    var scale = p / state.bs;
    preview.style.backgroundImage = 'url(' + state.url + ')';
    preview.style.backgroundSize = (state.iw * scale) + 'px ' + (state.ih * scale) + 'px';
    preview.style.backgroundPosition = (-(state.bx - state.ix) * scale) + 'px ' + (-(state.by - state.iy) * scale) + 'px';
    fx.value = ((state.bx - state.ix) / state.iw).toFixed(4);
    fy.value = ((state.by - state.iy) / state.ih).toFixed(4);
    fs.value = (state.bs / Math.min(state.iw, state.ih)).toFixed(4);
  }
  function showError(msg) {
    errEl.textContent = msg;
    errEl.hidden = false;
  }
  fileInput.addEventListener('change', function () {
    var file = fileInput.files && fileInput.files[0];
    if (!file) return;
    errEl.hidden = true;
    if (!file.type || file.type.indexOf('image/') !== 0) { showError('Choose a photo file (jpg, png or webp).'); fileInput.value = ''; return; }
    if (file.size > 5 * 1024 * 1024) { showError('The photo must be up to 5 MB.'); fileInput.value = ''; return; }
    var reader = new FileReader();
    reader.onload = function (e) {
      var probe = new Image();
      probe.onload = function () {
        state = { url: e.target.result, nw: probe.naturalWidth, nh: probe.naturalHeight, z: 1, iw: 0, ih: 0, ix: 0, iy: 0, bx: 0, by: 0, bs: 0 };
        img.src = state.url;
        wrap.hidden = false;
        zoom.value = '1';
        saveBtn.disabled = false;
        requestAnimationFrame(function () {
          var S = stage.clientWidth;
          var base = Math.min(S / state.nw, S / state.nh);
          state.iw = state.nw * base;
          state.ih = state.nh * base;
          state.bs = Math.min(state.iw, state.ih);
          state.bx = (S - state.iw) / 2 + (state.iw - state.bs) / 2;
          state.by = (S - state.ih) / 2 + (state.ih - state.bs) / 2;
          layout();
        });
      };
      probe.onerror = function () { showError('That file could not be read as a photo — try another one.'); };
      probe.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
  zoom.addEventListener('input', function () {
    if (!state) return;
    state.z = parseFloat(zoom.value) || 1;
    layout();
  });
  function dragSetup(el, onMove, stopBubble) {
    el.addEventListener('pointerdown', function (e) {
      if (!state) return;
      // The resize handle sits inside the drag box — its pointerdown
      // must not bubble up and move the box at the same time.
      if (stopBubble) e.stopPropagation();
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      var startX = e.clientX;
      var startY = e.clientY;
      var start = { bx: state.bx, by: state.by, bs: state.bs };
      function move(ev) {
        onMove(ev.clientX - startX, ev.clientY - startY, start);
        layout();
      }
      function up() {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
      }
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });
  }
  // Drag the box to move it (stays inside the photo).
  dragSetup(box, function (dx, dy, start) {
    state.bx = clamp(start.bx + dx, state.ix, state.ix + state.iw - state.bs);
    state.by = clamp(start.by + dy, state.iy, state.iy + state.ih - state.bs);
  });
  // Drag the corner handle to resize the square (stays inside the photo).
  dragSetup(handle, function (dx, dy, start) {
    var next = clamp(start.bs + Math.max(dx, dy), 48, Math.min(state.iw, state.ih));
    state.bs = next;
    state.bx = clamp(start.bx, state.ix, state.ix + state.iw - state.bs);
    state.by = clamp(start.by, state.iy, state.iy + state.ih - state.bs);
  }, true);
  // Keyboard: arrow keys move the crop square (Shift = bigger steps).
  box.addEventListener('keydown', function (e) {
    if (!state) return;
    var step = e.shiftKey ? 16 : 4;
    var moved = true;
    if (e.key === 'ArrowLeft') state.bx = clamp(state.bx - step, state.ix, state.ix + state.iw - state.bs);
    else if (e.key === 'ArrowRight') state.bx = clamp(state.bx + step, state.ix, state.ix + state.iw - state.bs);
    else if (e.key === 'ArrowUp') state.by = clamp(state.by - step, state.iy, state.iy + state.ih - state.bs);
    else if (e.key === 'ArrowDown') state.by = clamp(state.by + step, state.iy, state.iy + state.ih - state.bs);
    else moved = false;
    if (moved) { e.preventDefault(); layout(); }
  });
  window.addEventListener('resize', layout);
})();
