// Product compare (feat/admin-ops, I4): up to 4 products in
// localStorage ('goince-compare'). Buttons carry data-compare-id;
// a small fixed bar appears when 2+ products are chosen, linking
// to /compare?ids=1,2,3. No login needed; nothing is sent to the
// server until the customer opens the compare page.
(function () {
  var KEY = 'goince-compare';
  var MAX = 4;
  function read() {
    try {
      var raw = JSON.parse(localStorage.getItem(KEY) || '[]');
      return Array.isArray(raw) ? raw.filter(function (n) { return Number.isFinite(n) && n > 0; }).slice(0, MAX) : [];
    } catch (e) { return []; }
  }
  function write(ids) {
    try { localStorage.setItem(KEY, JSON.stringify(ids)); } catch (e) {}
  }
  function bar() {
    var el = document.getElementById('compare-bar');
    if (!el) {
      el = document.createElement('div');
      el.id = 'compare-bar';
      el.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:76px;z-index:600;background:#0f2a4a;color:#fff;padding:10px 16px;border-radius:999px;box-shadow:0 6px 24px rgba(0,0,0,.25);display:none;align-items:center;gap:12px;font-size:14px;';
      el.innerHTML = '<span id="compare-bar-text"></span><a id="compare-bar-link" href="/compare" style="background:#f0a500;color:#111;font-weight:700;padding:6px 14px;border-radius:999px;text-decoration:none;">Compare →</a><button id="compare-bar-clear" type="button" style="background:transparent;border:0;color:#fff;cursor:pointer;font-size:16px;" aria-label="Clear compare">✕</button>';
      document.body.appendChild(el);
      el.querySelector('#compare-bar-clear').addEventListener('click', function () {
        write([]);
        sync();
      });
    }
    return el;
  }
  function sync() {
    var ids = read();
    document.querySelectorAll('[data-compare-id]').forEach(function (btn) {
      var id = parseInt(btn.getAttribute('data-compare-id'), 10);
      var on = ids.indexOf(id) !== -1;
      btn.classList.toggle('compare-btn--on', on);
      btn.textContent = on ? '✓ In Compare' : '⇄ Compare';
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    var el = bar();
    if (ids.length >= 2) {
      el.style.display = 'flex';
      el.querySelector('#compare-bar-text').textContent = ids.length + ' product' + (ids.length > 1 ? 's' : '') + ' to compare';
      el.querySelector('#compare-bar-link').href = '/compare?ids=' + ids.join(',');
    } else {
      el.style.display = 'none';
    }
  }
  document.addEventListener('click', function (ev) {
    var btn = ev.target.closest ? ev.target.closest('[data-compare-id]') : null;
    if (!btn) return;
    ev.preventDefault();
    var id = parseInt(btn.getAttribute('data-compare-id'), 10);
    var ids = read();
    var at = ids.indexOf(id);
    if (at !== -1) { ids.splice(at, 1); }
    else {
      if (ids.length >= MAX) { alert('You can compare up to ' + MAX + ' products — remove one first.'); return; }
      ids.push(id);
    }
    write(ids);
    sync();
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sync);
  else sync();
})();
