// "Load more" (feat/discovery-search, PR #85) — C4 pagination without
// a full reload. The button is a plain link to ?page=N (no-JS
// fallback: the server renders that page); when JS runs, the click
// is intercepted, the same URL is fetched with X-Requested-With
// (the route answers JSON { ok, html, hasMore, nextPageUrl }), the
// returned cards are appended to the main grid, and the button is
// re-pointed at the following page (or removed when there is no
// next page). The address bar follows via replaceState so the
// appended state stays linkable (?page=). New cards need no extra
// wiring: Add to Cart works through the footer's document-level
// delegation, like the Recently Viewed cards.
(function () {
  function gridEl() {
    var wrap = document.getElementById('product-grid-wrap');
    return wrap ? wrap.querySelector('.product-grid') : null;
  }
  function loadNextPage(btn) {
    var url = btn.getAttribute('data-next-url') || btn.getAttribute('href');
    if (!url) return Promise.resolve(false);
    btn.classList.add('is-loading');
    btn.textContent = 'Loading…';
    return fetch(url, { headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' } })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (!data || !data.ok) throw new Error('bad response');
        var grid = gridEl();
        if (grid && data.html) grid.insertAdjacentHTML('beforeend', data.html);
        if (data.hasMore && data.nextPageUrl) {
          btn.setAttribute('data-next-url', data.nextPageUrl);
          btn.setAttribute('href', data.nextPageUrl);
          btn.classList.remove('is-loading');
          btn.textContent = 'Load more';
          if (window.history && window.history.replaceState) {
            try { window.history.replaceState(null, '', data.nextPageUrl); } catch (e) {}
          }
        } else if (btn.parentNode) {
          btn.parentNode.removeChild(btn);
        }
        return true;
      })
      .catch(function () {
        // Fetch/JSON fail korle button-ta abar sadharon link hoye
        // jay — chaple ?page= khule, kokhono khali page noy.
        btn.classList.remove('is-loading');
        btn.textContent = 'Load more';
        return false;
      });
  }
  function bind() {
    var btn = document.getElementById('load-more-btn');
    if (!btn || btn.__goinceLoadMoreBound) return;
    btn.__goinceLoadMoreBound = true;
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      loadNextPage(btn);
    });
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
    else bind();
  }
  // Test hook: the suite drives loadNextPage in a stubbed DOM.
  if (typeof window !== 'undefined') window.goinceLoadMore = { loadNextPage: loadNextPage, bind: bind };
})();
