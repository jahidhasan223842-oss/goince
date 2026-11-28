// Animations & delight (feat/animations-delight, batch A).
//
// donal: "sob add kore daw" — worldwide research list-er group A.
// A1 fly-to-cart (side-cart tab-e, header-e cart icon NEI), A2
// skeleton (shudhu async jayga), A3 button loading + success
// (Add to Cart + Place Order), A4 badge bump on add, A5 hover
// preview (2nd gallery chobi), A6 View Transitions (grid ->
// product page), A7 scroll-reveal (frugal), A8 animated checkout
// stepper, A9 order-success celebration. A10 toast SKIP — PR #80-te
// hoye geche.
//
// Conventions follow test-ajax-add-to-cart.js: static checks on the
// real files + the REAL footer IIFE in a stubbed DOM (vm) + EJS
// renders. PR #80-er double-submit assertion ekhane duplicate kora
// hoy ni — ekhane shudhu VISUAL state gulo assert kora hoyeche.

const fs = require('fs');
const path = require('path');
const util = require('util');
const ejs = require('ejs');
const vm = require('vm');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'style.css'), 'utf8');
const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
const footerEjs = fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', 'footer.ejs'), 'utf8');
const indexEjs = fs.readFileSync(path.join(__dirname, '..', 'views', 'index.ejs'), 'utf8');
const productEjs = fs.readFileSync(path.join(__dirname, '..', 'views', 'product.ejs'), 'utf8');
const checkoutEjs = fs.readFileSync(path.join(__dirname, '..', 'views', 'checkout.ejs'), 'utf8');
const orderSuccessEjs = fs.readFileSync(path.join(__dirname, '..', 'views', 'order-success.ejs'), 'utf8');
const stepsEjs = fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', 'checkout-steps.ejs'), 'utf8');
const shopRoutes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'shop.js'), 'utf8');
const revealJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'scroll-reveal.js'), 'utf8');
const renderFile = util.promisify(ejs.renderFile);

const failures = [];
const passes = [];
function check(name, ok, detail) {
  if (ok) { passes.push(name); console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

(async () => {
  // ---------- 0. Global: no new colours, reduced-motion covered ----------
  const animCssStart = css.indexOf('Animations & delight (feat/animations-delight');
  const animCss = animCssStart >= 0 ? css.slice(animCssStart) : '';
  check('global: the batch CSS section exists (A1–A9, appended at the end of style.css)',
    animCssStart >= 0 && animCss.includes('A1 fly to cart') && animCss.includes('A9 order-success'));
  check('global: NO new colour in the batch CSS — no hex literal anywhere in the appended section except #fff (white, already the site text-on-dark colour)',
    animCssStart >= 0 && !/#(?!fff\b|ffffff\b)[0-9a-fA-F]{3,8}\b/.test(animCss));
  check('global: prefers-reduced-motion block disables every new animation (fly, shimmer, spinner, bump, alt swap, reveal, stepper fill, tick, confetti)',
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.fly-to-cart-img[\s\S]*?\.skeleton-img[\s\S]*?\.btn-spinner[\s\S]*?\.side-cart-badge--bump[\s\S]*?\.product-card-img-alt[\s\S]*?\.reveal[\s\S]*?\.checkout-steps-fill[\s\S]*?\.order-success-tick[\s\S]*?\.order-confetti/.test(animCss));

  // ---------- 1. A1 fly-to-cart: static ----------
  check('A1: footer has flyToCart (clone img -> side-cart tab), NOT the header (no header cart icon since PR #75)',
    /function flyToCart\(form\)/.test(footerEjs) && /className = 'fly-to-cart-img'/.test(footerEjs)
    && /tab\.getBoundingClientRect\(\)/.test(footerEjs) && !/header-cart|header \.cart/.test(footerEjs.slice(footerEjs.indexOf('function flyToCart'), footerEjs.indexOf('function flyToCart') + 3000)));
  check('A1: fly starts from the card image (closest .product-card img, product-page fallback #main-product-image) and skips silently with no image / no-image.png / reduced-motion',
    /form\.closest\('\.product-card'\)/.test(footerEjs) && /#main-product-image/.test(footerEjs)
    && /no-image\.png/.test(footerEjs) && /reducedMotion\(\)/.test(footerEjs));
  check('A1: fly runs in parallel with the fetch (called before fetch, never awaits it) and removes the clone after ~650ms',
    // UPDATED (feat/cart-buying, B5): body-ta ekhon buildFormBody()
    // helper-e toiri hoy (drawer stepper-er submitter override-er
    // jonno) — flyToCart() ekhono body build-er age, fetch-er agei
    // chole; parallel behaviour bodlano hoy ni.
    /flyToCart\(form\);\s*\n\s*var body = (''|buildFormBody\(form, null\));/.test(footerEjs)
    && /setTimeout\(function \(\) \{\s*if \(clone\.parentNode && clone\.parentNode\.removeChild\) clone\.parentNode\.removeChild\(clone\);\s*\}, 650\)/.test(footerEjs));
  check('A1: fly CSS — fixed clone, z-index 1200 (above drawer 1001 + toast 1100), .6s arc transition',
    /\.fly-to-cart-img \{[^}]*position:\s*fixed[^}]*z-index:\s*1200[^}]*transition:[^}]*\.6s/.test(cssNoComments));

  // ---------- 2. A2 skeleton: static ----------
  const rvGridStart = indexEjs.indexOf('id="recently-viewed-grid"');
  const rvGridEnd = indexEjs.indexOf('<section class="why-shop">', rvGridStart);
  const rvGridHtml = indexEjs.slice(rvGridStart, rvGridEnd);
  check('A2: Recently Viewed grid (JS-rendered from localStorage) carries 4 skeleton cards that the JS render replaces',
    /for \(let s = 0; s < 4; s\+\+\)/.test(rvGridHtml) && /class="skeleton-card"/.test(rvGridHtml)
    && /class="skeleton-img"/.test(rvGridHtml) && /class="skeleton-line/.test(rvGridHtml) && /class="skeleton-btn"/.test(rvGridHtml));
  const mainGridStart = indexEjs.indexOf('<div class="product-grid">');
  const mainGridEnd = indexEjs.indexOf('Best Sellers', mainGridStart);
  check('A2: the server-rendered main product grid has NO skeleton (no fake loading there)',
    mainGridStart >= 0 && !/skeleton/.test(indexEjs.slice(mainGridStart, mainGridEnd)));
  check('A2: search suggestions show a skeleton while the async fetch runs (footer search IIFE)',
    /class="search-skeleton"/.test(footerEjs) && /box\.innerHTML = '<div class="search-skeleton"/.test(footerEjs));
  check('A2: skeleton CSS — grey shimmer (bg -> bg-hover gradient, skeleton-shimmer keyframes)',
    /@keyframes skeleton-shimmer/.test(cssNoComments) && /\.skeleton-img, \.skeleton-line, \.skeleton-btn \{[^}]*linear-gradient\(90deg, var\(--bg\)/.test(cssNoComments)
    && /\.search-skeleton span \{[^}]*animation: skeleton-shimmer/.test(cssNoComments));

  // ---------- 3. A3 button states: static ----------
  check('A3: Add to Cart gets a visual loading state on top of the PR #80 in-flight disable (is-loading + spinner + "Adding…", original label saved)',
    /btn\.classList\) btn\.classList\.add\('is-loading'\)/.test(footerEjs)
    && /btn\.innerHTML = '<span class="btn-spinner" aria-hidden="true"><\/span> Adding…';/.test(footerEjs)
    && /btnOrigHtml = btn\.innerHTML;/.test(footerEjs));
  check('A3: Add to Cart success shows the tick ("✓ Added", is-success) then restores the original label after ~1.2s; error restores immediately',
    /btn\.innerHTML = '✓ Added';/.test(footerEjs) && /}, 1200\)/.test(footerEjs)
    && /done\(true\)/.test(footerEjs) && /done\(false\)/.test(footerEjs));
  check('A3: Place Order locks on submit (form._placing + disabled + is-loading + "Placing order…") and resets on pageshow + a 15s safety timer',
    /form\._placing = true;/.test(checkoutEjs) && /btn\.disabled = true;/.test(checkoutEjs)
    && /btn\.classList\.add\('is-loading'\)/.test(checkoutEjs) && /Placing order…/.test(checkoutEjs)
    && /window\.addEventListener\('pageshow'/.test(checkoutEjs) && /setTimeout\(resetBtn, 15000\)/.test(checkoutEjs));
  check('A3: spinner CSS exists (border spin) for both buttons; place-order spinner uses navy on gold',
    /@keyframes btn-spin/.test(cssNoComments) && /\.btn-spinner \{[^}]*animation: btn-spin/.test(cssNoComments)
    && /\.btn-place-order \.btn-spinner \{[^}]*border-top-color: var\(--navy\)/.test(cssNoComments));

  // ---------- 4. A4 badge bump: static ----------
  check('A4: setCartCount adds the bump class on every add success (remove + reflow + add, so repeats re-fire)',
    /badge\.classList\.remove\('side-cart-badge--bump'\);\s*void badge\.offsetWidth;\s*badge\.classList\.add\('side-cart-badge--bump'\)/.test(footerEjs));
  check('A4: badge-bump keyframes pop scale 0.9 -> 1.05 -> 1 over .45s',
    /@keyframes badge-bump \{ 0% \{ transform: scale\(\.9\); \} 40% \{ transform: scale\(1\.05\); \} 100% \{ transform: scale\(1\); \} \}/.test(cssNoComments));

  // ---------- 5. A5 hover preview: static + render ----------
  check('A5: route builds a first-gallery-image map (firstGalleryImages) and passes secondImages to BOTH the homepage and the product page renders',
    /async function firstGalleryImages\(productIds\)/.test(shopRoutes)
    && /SELECT product_id, image FROM product_images/.test(shopRoutes)
    && /const secondImages = await firstGalleryImages\(\);/.test(shopRoutes)
    && /const secondImages = await firstGalleryImages\(related\.map/.test(shopRoutes)
    && (shopRoutes.match(/secondImages,/g) || []).length >= 2);
  // UPDATED by feat/discovery-search (PR #85): product.ejs now has
  // TWO alt-image spots — Related Products AND the new "Customers
  // also viewed" section, which reuses the same card markup
  // (secondImages[p.id] guard included). The behaviour the check
  // protects — alt image ONLY when a 2nd image exists — is
  // unchanged; only the count moved 1 -> 2.
  check('A5: card markup renders the alt image ONLY when a 2nd image exists (main grid + Best Sellers + Related + Customers also viewed)',
    (indexEjs.match(/class="product-card-img-alt"/g) || []).length === 2
    && (productEjs.match(/class="product-card-img-alt"/g) || []).length === 2
    && /secondImages\[p\.id\]/.test(indexEjs) && /secondImages\[p\.id\]/.test(productEjs));
  check('A5: alt-image CSS — absolute overlay on the main photo, opacity 0, fades in on card hover/focus-within (existing lift/ring/mint untouched)',
    /\.product-card-img-alt \{[^}]*position:\s*absolute[^}]*opacity:\s*0[^}]*transition: opacity \.25s ease/.test(cssNoComments)
    && /\.product-card:hover \.product-card-img-alt, \.product-card:focus-within \.product-card-img-alt \{ opacity: 1; \}/.test(cssNoComments));
  const indexHtml = await renderFile(path.join(__dirname, '..', 'views', 'index.ejs'), {
    siteName: 'Goince', siteSettings: { hero_title: 'Shop', hero_subtitle: 'Sub' },
    shopPhone: '01814697896', cartCount: 0, miniCart: [], miniCartSubtotal: 0,
    userName: null, userPhotoUrl: null, userEmail: '',
    products: [
      { id: 1, name: 'Watch', image: 'watch.jpg', price: 990, stock: 5, compare_at_price: null, avg_rating: null, review_count: 0 },
      { id: 2, name: 'Machine', image: 'm.jpg', price: 1250, stock: 3, compare_at_price: null, avg_rating: null, review_count: 0 },
    ],
    secondImages: { 1: 'watch-2.jpg' },
    variantProductIds: [], optionProductIds: [],
    bestSellers: [], displayCategories: [], subCategories: [],
    selectedCategory: null, search: '', sort: 'newest',
    isSeasonalCategory: false, selectedAudience: '',
    minPrice: '', maxPrice: '', recentlyViewedMap: {}, csrfToken: 'tok',
    banners: [], heroProduct: null, pageTitle: 'Goince',
  });
  check('A5: rendered homepage — the product WITH a 2nd image gets the alt img, the single-image product does not',
    indexHtml.includes('/uploads/watch-2.jpg') && (indexHtml.match(/product-card-img-alt/g) || []).length === 1);
  check('A5: rendered homepage — Recently Viewed skeleton cards are present in the grid (4)',
    (indexHtml.match(/class="skeleton-card"/g) || []).length === 4);

  // ---------- 6. A6 View Transitions: static ----------
  check('A6: footer feature-detects document.startViewTransition and does nothing when unsupported (plain navigation fallback)',
    /typeof document\.startViewTransition !== 'function'/.test(footerEjs)
    && /document\.startViewTransition\(function \(\) \{ window\.location\.href = url; \}\)/.test(footerEjs));
  check('A6: only plain left-clicks on product-card /product/ links transition (modifier/middle-click excluded; no form interception)',
    /e\.button !== 0 \|\| e\.metaKey \|\| e\.ctrlKey \|\| e\.shiftKey \|\| e\.altKey/.test(footerEjs)
    && /closest\('\.product-card a\[href\^="\/product\/"\]'\)/.test(footerEjs));

  // ---------- 7. A7 scroll-reveal: static ----------
  check('A7: scroll-reveal uses IntersectionObserver (threshold 0.15, unobserve after reveal) and adds .reveal via JS only',
    /new IntersectionObserver\(function \(entries\)/.test(revealJs) && /threshold: 0\.15/.test(revealJs)
    && /io\.unobserve\(entry\.target\)/.test(revealJs) && /classList\.add\('reveal'\)/.test(revealJs));
  check('A7: scroll-reveal respects prefers-reduced-motion (returns early — nothing hidden) and falls back when IntersectionObserver is missing',
    /prefers-reduced-motion: reduce/.test(revealJs) && /if \(reduced\) return;/.test(revealJs)
    && /typeof IntersectionObserver === 'function'/.test(revealJs));
  const revealRule = (cssNoComments.match(/\.reveal \{[^}]*\}/) || [''])[0];
  check('A7: .reveal animates opacity/transform ONLY (no layout shift — no width/height/margin/padding/position in the rule)',
    /opacity:\s*0/.test(revealRule) && /transform: translateY\(14px\)/.test(revealRule)
    && !/width|height|margin|padding|position/.test(revealRule));
  check('A7: data-reveal is used SPARINGLY — homepage section headings + Why Shop cards only (never on product cards or the grid)',
    (indexEjs.match(/data-reveal/g) || []).length === 7
    && !/product-card[^>]*data-reveal|data-reveal[^>]*product-card/.test(indexEjs)
    && !/product-grid[^>]*data-reveal/.test(indexEjs));

  // ---------- 8. A8 checkout stepper: render + static ----------
  for (const [step, pct] of [[1, '0%'], [2, '50%'], [3, '100%']]) {
    const stepsHtml = await renderFile(path.join(__dirname, '..', 'views', 'partials', 'checkout-steps.ejs'), { step });
    check(`A8: step ${step} renders the progress bar at ${pct}`,
      stepsHtml.includes(`--step-progress: ${pct}`) && stepsHtml.includes('checkout-steps-progress'));
  }
  check('A8: stepper fill animates 0 -> var(--step-progress) in .6s (base width IS the final width, so reduced-motion still lands right)',
    /@keyframes checkout-fill \{ from \{ width: 0; \} \}/.test(cssNoComments)
    && /\.checkout-steps-fill \{[^}]*width: var\(--step-progress, 0%\);[^}]*animation: checkout-fill \.6s ease/.test(cssNoComments));
  check('A8: the step pills themselves are unchanged (active gold, done green, todo grey)',
    css.includes('.checkout-steps span.active { background: var(--accent)') && css.includes('.checkout-steps span.done { background: #e3f2e8'));

  // ---------- 9. A9 order-success: render + static ----------
  const successHtml = await renderFile(path.join(__dirname, '..', 'views', 'order-success.ejs'), {
    siteName: 'Goince', shopPhone: '01814697896', cartCount: 0, miniCart: [], miniCartSubtotal: 0,
    userName: null, userPhotoUrl: null, userEmail: '',
    orderId: 42, total: 1990, cart: [{ id: 1, name: 'Watch', price: 990, quantity: 1 }],
    siteSettings: {},
  });
  check('A9: rendered order-success has the animated tick (SVG circle + check) and the confetti container with 14 pieces',
    successHtml.includes('order-success-tick') && successHtml.includes('<svg viewBox="0 0 52 52"')
    && successHtml.includes('order-confetti') && (successHtml.match(/<i><\/i>/g) || []).length === 14);
  check('A9: the ✅ emoji is gone from the heading (the tick IS the celebration — no emoji-heavy decoration)',
    successHtml.includes('<h1>Order Placed Successfully!</h1>'));
  check('A9: tick CSS draws the circle then the check (dashoffset animation, success green); confetti is a fixed, pointer-events-none overlay that falls once and fades',
    /@keyframes tick-circle/.test(cssNoComments) && /@keyframes tick-check/.test(cssNoComments)
    && /\.order-success-tick circle \{[^}]*stroke: var\(--success\)/.test(cssNoComments)
    && /\.order-confetti \{[^}]*position:\s*fixed[^}]*pointer-events:\s*none/.test(cssNoComments)
    && /@keyframes confetti-fall/.test(cssNoComments));

  // ---------- 10. The REAL footer IIFE in a stubbed DOM (A1 + A3 + A4) ----------
  const gStart = footerEjs.indexOf('(function () {', footerEjs.indexOf('Side-cart tab overlap guard'));
  const gEnd = gStart > 0 ? footerEjs.indexOf('})();', gStart) + 5 : -1;
  const gCode = gStart > 0 ? footerEjs.slice(gStart, gEnd) : '';
  check('iife: extractable from footer.ejs (same IIFE as the PR #75 guard + PR #77 drawer + PR #80 AJAX)',
    gStart > 0 && gCode.includes("querySelector('.side-cart')") && gCode.includes("addEventListener('submit'"));

  function makeStubEl() {
    const el = {
      _classes: new Set(),
      _attrs: {},
      _rect: { left: 0, top: 0, right: 0, bottom: 0 },
      _listeners: {},
      _children: [],
      hidden: false,
      focused: false,
      disabled: false,
      textContent: '',
      innerHTML: '',
      parentNode: null,
      classList: {
        add(c) { el._classes.add(c); },
        remove(c) { el._classes.delete(c); },
        toggle(c, f) { if (f === undefined) { if (el._classes.has(c)) { el._classes.delete(c); return false; } el._classes.add(c); return true; } if (f) el._classes.add(c); else el._classes.delete(c); return !!f; },
        contains(c) { return el._classes.has(c); },
      },
      setAttribute(k, v) { el._attrs[k] = String(v); },
      getAttribute(k) { return el._attrs[k] === undefined ? null : el._attrs[k]; },
      removeAttribute(k) { delete el._attrs[k]; },
      addEventListener(type, fn) { (el._listeners[type] = el._listeners[type] || []).push(fn); },
      fire(type, ev) { (el._listeners[type] || []).forEach((fn) => fn(ev || {})); },
      focus() { el.focused = true; },
      getBoundingClientRect() { return el._rect; },
      appendChild(child) { child.parentNode = el; el._children.push(child); return child; },
      removeChild(child) { el._children = el._children.filter((c) => c !== child); child.parentNode = null; return child; },
      querySelector() { return null; },
    };
    return el;
  }
  function makeClock() {
    let now = 0;
    let nextId = 1;
    const timers = new Map();
    return {
      setTimeout(fn, ms) { const id = nextId++; timers.set(id, { due: now + (ms || 0), fn }); return id; },
      clearTimeout(id) { timers.delete(id); },
      advance(ms) {
        const end = now + ms;
        for (;;) {
          let best = null;
          for (const [id, t] of timers) { if (t.due <= end && (!best || t.due < best.due)) best = { id, ...t }; }
          if (!best) break;
          timers.delete(best.id);
          now = best.due;
          best.fn();
        }
        now = end;
      },
    };
  }
  const flush = () => new Promise((r) => setImmediate(r));
  const flushAll = async () => { for (let i = 0; i < 6; i++) await flush(); };

  const TAB_RECT = { left: 1852, top: 512, right: 1908, bottom: 568, width: 56, height: 56 };
  const IMG_RECT = { left: 100, top: 200, right: 280, bottom: 380, width: 180, height: 180 };
  function runScenario(opts) {
    opts = opts || {};
    const clock = makeClock();
    const tab = makeStubEl(); tab._rect = Object.assign({}, TAB_RECT);
    const drawer = makeStubEl(); drawer.hidden = true;
    let _drawerHtml = '';
    Object.defineProperty(drawer, 'innerHTML', {
      get() { return _drawerHtml; },
      set(v) { _drawerHtml = v; drawer._refreshed = true; },
      configurable: true,
    });
    const overlay = makeStubEl(); overlay.hidden = true;
    const toast = makeStubEl(); toast.hidden = true;
    const body = makeStubEl();
    const guardedEl = makeStubEl(); guardedEl._rect = { left: 100, top: 500, right: 300, bottom: 540 };
    const closeBtn = makeStubEl();
    const continueBtn = makeStubEl();
    const drawerLink = makeStubEl();
    const drawerBadgeHolder = { el: null };
    const imgStub = makeStubEl();
    imgStub._rect = Object.assign({}, IMG_RECT);
    imgStub.getAttribute = (k) => (k === 'src' ? '/uploads/watch.jpg' : null);
    imgStub.src = '/uploads/watch.jpg';
    const cardStub = makeStubEl();
    cardStub.querySelector = (sel) => (sel === 'img' ? imgStub : null);
    const fetchCalls = [];
    let fetchDeferred = null;
    function defer() {
      let resolve; let reject;
      const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
      return { promise, resolve, reject };
    }
    const winListeners = {};
    const docListeners = {};
    function FormDataStub(form) { this._pairs = form._fields || []; }
    FormDataStub.prototype.forEach = function (cb) { this._pairs.forEach((pair) => cb(pair[1], pair[0])); };
    const sandbox = {
      document: {
        querySelector(sel) {
          if (sel === '.side-cart') return tab;
          if (sel === '#mini-cart-drawer') return drawer;
          if (sel === '#mini-cart-overlay') return overlay;
          if (sel === '.mini-cart-close') return closeBtn;
          if (sel === '.mini-cart-continue') return continueBtn;
          if (sel === '#cart-toast') return toast;
          if (sel === '.side-cart-badge') return tab._badge || null;
          if (sel === '.shop-drawer-link[href="/cart"]') return drawerLink;
          if (sel === '.shop-drawer-link[href="/cart"] .badge') return drawerBadgeHolder.el;
          return null;
        },
        querySelectorAll() { return [guardedEl]; },
        documentElement: { scrollTop: 0 },
        activeElement: tab,
        body,
        addEventListener(type, fn) { (docListeners[type] = docListeners[type] || []).push(fn); },
        createElement(tag) { const el = makeStubEl(); el._tag = tag; return el; },
      },
      window: {
        pageYOffset: 0,
        innerHeight: 1080,
        innerWidth: 1920,
        addEventListener(type, fn) { (winListeners[type] = winListeners[type] || []).push(fn); },
        requestAnimationFrame(fn) { fn(); },
        matchMedia() { return { matches: !!opts.reducedMotion }; },
      },
      setTimeout(fn, ms) { return clock.setTimeout(fn, ms); },
      clearTimeout(id) { clock.clearTimeout(id); },
      FormData: FormDataStub,
      URLSearchParams,
      fetch(url, opts2) {
        fetchCalls.push({ url, opts: opts2 });
        fetchDeferred = defer();
        return fetchDeferred.promise;
      },
    };
    sandbox.window.document = sandbox.document;
    const origAppend = tab.appendChild.bind(tab);
    tab.appendChild = function (child) {
      origAppend(child);
      if (child._tag === 'span') tab._badge = child;
      return child;
    };
    const origLinkAppend = drawerLink.appendChild.bind(drawerLink);
    drawerLink.appendChild = function (child) {
      origLinkAppend(child);
      if (child._tag === 'span') drawerBadgeHolder.el = child;
      return child;
    };
    vm.runInNewContext(gCode, sandbox);
    return {
      clock, tab, drawer, overlay, toast, body, fetchCalls,
      resolveFetch(res) { fetchDeferred.resolve(res); },
      fireDoc(type, ev) { (docListeners[type] || []).forEach((fn) => fn(ev || {})); },
      flyClone() { return body._children.find((c) => c.className === 'fly-to-cart-img') || null; },
      drawerOpen: () => drawer.classList.contains('is-open') && drawer.hidden === false,
    };
  }
  function submitEvent(form) {
    const ev = { target: form, prevented: false, preventDefault() { ev.prevented = true; } };
    return ev;
  }
  function makeAddForm(withImage) {
    const btn = makeStubEl();
    btn.innerHTML = '🛒 Add to Cart';
    const form = makeStubEl();
    form._fields = [['_csrf', 'tok123'], ['quantity', '1']];
    form.getAttribute = (k) => (k === 'action' ? '/cart/add/3' : k === 'method' ? 'POST' : null);
    form.querySelector = (sel) => (sel === 'button[type="submit"]' ? btn : null);
    form.closest = (sel) => null;
    if (withImage) {
      const imgStub = makeStubEl();
      imgStub._rect = Object.assign({}, IMG_RECT);
      imgStub.getAttribute = (k) => (k === 'src' ? '/uploads/watch.jpg' : null);
      imgStub.src = '/uploads/watch.jpg';
      const cardStub = makeStubEl();
      cardStub.querySelector = (sel) => (sel === 'img' ? imgStub : null);
      form.closest = (sel) => (sel === '.product-card' ? cardStub : null);
    }
    form._btn = btn;
    return form;
  }
  function okResponse(data) {
    return { status: 200, ok: true, json: () => Promise.resolve(data) };
  }

  // A1 + A3 + A4 in the real IIFE, with a card image.
  const sc = runScenario();
  const form = makeAddForm(true);
  sc.fireDoc('submit', submitEvent(form));
  check('A1 vm: submitting Add to Cart fires the fetch AND starts the fly clone at once (add is not delayed)',
    sc.fetchCalls.length === 1 && !!sc.flyClone());
  const clone = sc.flyClone();
  check('A1 vm: the clone flies to the side-cart tab centre (tab 1852–1908 x 512–568 -> 1866px / 526px, shrunk to 28px, faded)',
    clone && clone.style.left === '1866px' && clone.style.top === '526px'
    && clone.style.width === '28px' && clone.style.height === '28px' && clone.style.opacity === '0.25');
  check('A3 vm: while the request is in flight the button is disabled AND shows the loading state (is-loading + spinner + "Adding…")',
    form._btn.disabled === true && form._btn.classList.contains('is-loading')
    && form._btn.innerHTML.includes('btn-spinner') && form._btn.innerHTML.includes('Adding'));
  sc.clock.advance(650);
  check('A1 vm: the fly clone removes itself after ~650ms',
    sc.flyClone() === null);
  sc.resolveFetch(okResponse({
    ok: true, cartCount: 1, itemName: 'BINBOND 2521 Watch', subtotal: 990,
    drawerHtml: '<div class="mini-cart-head"><h2>Your Cart (1)</h2></div><p>BINBOND 2521 Watch</p>',
  }));
  await flushAll();
  check('A4 vm: on add success the side-cart badge gets the bump class (and the drawer still opens — PR #80 behaviour intact)',
    sc.tab._badge && sc.tab._badge.textContent === '1'
    && sc.tab._badge.classList.contains('side-cart-badge--bump') && sc.drawerOpen());
  check('A3 vm: on success the button shows the tick ("✓ Added", is-success) and is re-enabled',
    form._btn.disabled === false && form._btn.classList.contains('is-success')
    && form._btn.innerHTML === '✓ Added');
  sc.clock.advance(1200);
  check('A3 vm: after ~1.2s the button restores its original label and the tick class is gone',
    form._btn.innerHTML === '🛒 Add to Cart' && !form._btn.classList.contains('is-success'));
  // Error: button resets immediately, no tick.
  const form2 = makeAddForm(true);
  sc.fireDoc('submit', submitEvent(form2));
  check('A3 vm: error path — the button shows loading while in flight, then resets to the original label with NO tick',
    form2._btn.classList.contains('is-loading'));
  sc.resolveFetch({ status: 400, ok: false, json: () => Promise.resolve({ ok: false, error: 'Selected variant not found.' }) });
  await flushAll();
  check('A3 vm: error path — button re-enabled, original label back, no is-success',
    form2._btn.disabled === false && form2._btn.innerHTML === '🛒 Add to Cart'
    && !form2._btn.classList.contains('is-success') && !form2._btn.classList.contains('is-loading'));
  // A1: no product image -> no clone, add still works.
  const scNoImg = runScenario();
  const formNoImg = makeAddForm(false);
  scNoImg.fireDoc('submit', submitEvent(formNoImg));
  check('A1 vm: with NO product image the fly is skipped silently — but the fetch still fires (add is never broken by the animation)',
    scNoImg.flyClone() === null && scNoImg.fetchCalls.length === 1);
  // A1: reduced motion -> no clone.
  const scReduced = runScenario({ reducedMotion: true });
  const formReduced = makeAddForm(true);
  scReduced.fireDoc('submit', submitEvent(formReduced));
  check('A1 vm: with prefers-reduced-motion the fly is skipped silently (fetch still fires)',
    scReduced.flyClone() === null && scReduced.fetchCalls.length === 1);

  // ---------- 11. A6 View Transitions in a stubbed DOM ----------
  const a6Comment = footerEjs.indexOf('Grid -> product page transition');
  const a6Start = footerEjs.indexOf('(function () {', a6Comment);
  const a6End = footerEjs.indexOf('})();', a6Start) + 5;
  const a6Code = a6Start > 0 ? footerEjs.slice(a6Start, a6End) : '';
  check('A6: the transition IIFE is extractable from footer.ejs',
    a6Start > 0 && a6Code.includes('startViewTransition'));
  function runA6(supported) {
    const docListeners = {};
    let vtCalls = 0;
    let navigatedTo = null;
    const link = { getAttribute: (k) => (k === 'href' ? '/product/3' : null) };
    const sandbox = {
      document: {
        addEventListener(type, fn) { (docListeners[type] = docListeners[type] || []).push(fn); },
      },
      window: { location: {} },
    };
    if (supported) {
      sandbox.document.startViewTransition = function (cb) { vtCalls++; cb(); };
    }
    Object.defineProperty(sandbox.window.location, 'href', {
      set(v) { navigatedTo = v; },
      get() { return navigatedTo; },
      configurable: true,
    });
    vm.runInNewContext(a6Code, sandbox);
    return {
      vtCalls: () => vtCalls,
      navigatedTo: () => navigatedTo,
      click(evTarget, extra) {
        const ev = Object.assign({ button: 0, target: evTarget, prevented: false, preventDefault() { ev.prevented = true; } }, extra || {});
        (docListeners.click || []).forEach((fn) => fn(ev));
        return ev;
      },
      link,
    };
  }
  const cardTarget = { closest: (sel) => (sel === '.product-card a[href^="/product/"]' ? { getAttribute: (k) => (k === 'href' ? '/product/3' : null) } : null) };
  const sc6 = runA6(true);
  const ev6 = sc6.click(cardTarget);
  check('A6 vm: with support, a plain click on a product-card link is intercepted into startViewTransition and navigates inside it',
    ev6.prevented === true && sc6.vtCalls() === 1 && sc6.navigatedTo() === '/product/3');
  const sc6mod = runA6(true);
  const ev6mod = sc6mod.click(cardTarget, { ctrlKey: true });
  check('A6 vm: a ctrl+click is NOT intercepted (normal browser behaviour — new tab)',
    ev6mod.prevented === false && sc6mod.vtCalls() === 0 && sc6mod.navigatedTo() === null);
  const sc6no = runA6(false);
  const ev6no = sc6no.click(cardTarget);
  check('A6 vm: WITHOUT support the click is left alone (normal navigation fallback, no preventDefault, no crash)',
    ev6no.prevented === false && sc6no.navigatedTo() === null);
  const sc6other = runA6(true);
  const ev6other = sc6other.click({ closest: () => null });
  check('A6 vm: a click that is NOT on a product-card link is left alone',
    ev6other.prevented === false && sc6other.vtCalls() === 0);

  // ---------- 12. A7 scroll-reveal in a stubbed DOM ----------
  function runReveal(opts) {
    opts = opts || {};
    const els = [makeStubEl(), makeStubEl()];
    let observed = [];
    let ioCallback = null;
    const sandbox = {
      document: { querySelectorAll: (sel) => (sel === '[data-reveal]' ? els : []) },
      window: { matchMedia: () => ({ matches: !!opts.reducedMotion }) },
    };
    if (opts.withIO !== false) {
      sandbox.IntersectionObserver = function (cb) {
        ioCallback = cb;
        this.observe = (el) => { observed.push(el); };
        this.unobserve = (el) => { observed = observed.filter((e) => e !== el); };
      };
    }
    vm.runInNewContext(revealJs, sandbox);
    return {
      els, observed: () => observed,
      fireIntersecting: () => { if (ioCallback) ioCallback(els.map((el) => ({ isIntersecting: true, target: el }))); },
    };
  }
  const sc7 = runReveal({});
  check('A7 vm: reveal elements get .reveal from JS but are NOT visible before they intersect',
    sc7.els.every((el) => el.classList.contains('reveal') && !el.classList.contains('is-visible'))
    && sc7.observed().length === 2);
  sc7.fireIntersecting();
  check('A7 vm: on intersection the elements gain .is-visible (and are unobserved)',
    sc7.els.every((el) => el.classList.contains('is-visible')) && sc7.observed().length === 0);
  const sc7red = runReveal({ reducedMotion: true });
  check('A7 vm: with prefers-reduced-motion nothing is hidden at all (no .reveal class)',
    sc7red.els.every((el) => !el.classList.contains('reveal')));
  const sc7noIo = runReveal({ withIO: false });
  check('A7 vm: without IntersectionObserver everything is shown immediately (no hidden content)',
    sc7noIo.els.every((el) => el.classList.contains('reveal') && el.classList.contains('is-visible')));

  console.log(`\n${passes.length} passed, ${failures.length} failed.`);
  if (failures.length) { console.log('Failures: ' + failures.join(', ')); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
