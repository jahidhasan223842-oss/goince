// AJAX Add to Cart (fix/ajax-add-to-cart).
//
// donal said (2026-11-28, in Romanized Bengali): when you click Add
// to Cart it goes to the cart page; it must not go like that.
//
// What was built:
//   1. AJAX ADD, STAY ON THE PAGE: the footer IIFE intercepts every
//      /cart/add/ form submit (document-level delegation — so the
//      Recently Viewed JS-rendered forms are covered too) and POSTs
//      it with fetch (X-Requested-With: XMLHttpRequest). The EXISTING
//      POST /cart/add/:id route gained a JSON branch (no new route):
//      on AJAX it answers { ok, cartCount, itemName, subtotal,
//      drawerHtml } instead of redirecting to /cart. The JS then
//      updates both cart badges, replaces the drawer contents with
//      the FRESH server-rendered drawer HTML, restores the side-cart
//      tab from its 6s sliver state if minimised, opens the drawer,
//      and shows a toast ("✓ <product> added to cart", auto-dismiss
//      ~3s). The page never reloads and never navigates.
//   2. DRAWER GETS FRESH CONTENTS: the drawer body used to live
//      inline in footer.ejs; it now lives in
//      views/partials/mini-cart-content.ejs, included by the footer
//      AND rendered by the route (ejs.renderFile) for the JSON reply
//      — one partial, one markup, no stale drawer after an add.
//   3. NO-JS FALLBACK: without JS the form still POSTs and redirects
//      to /cart exactly as before (action + method untouched).
//   4. "Choose Option →" is a LINK, not a form — it is not
//      intercepted and still goes to the product page.
//   5. ERRORS: out-of-stock / invalid variant / server error show a
//      toast error, do NOT navigate, do NOT open the drawer. While a
//      request is in flight the clicked button is disabled (no
//      double-adds).
//   6. OUT OF SCOPE (honest limit, same as PR #77) — RESOLVED by
//      feat/cart-buying (B5): the drawer qty steppers / remove are
//      now AJAX (same JSON-branch pattern as this PR's add); the
//      cart page itself still does full-page POST + redirect.
//      See scripts/test-cart-buying.js for the drawer-stepper
//      coverage; the "NOT intercepted" check below was updated to
//      the CART-PAGE stepper (outside the drawer), which is still
//      not intercepted.
//   7. BODY IS URLENCODED, NOT MULTIPART: the CSRF middleware runs
//      before any body parser that could read a multipart body, so a
//      FormData (multipart) POST would fail CSRF; the JS converts the
//      FormData to URLSearchParams, which express.urlencoded parses,
//      so the form's _csrf field works (server.js:516 urlencoded
//      runs before the CSRF middleware at :667).
//   8. cart.ejs "You might also like" has NO add-to-cart form at all
//      (only product links + prices) — the brief mentioned it, but
//      the code shows there is nothing to intercept there.

const fs = require('fs');
const path = require('path');
const util = require('util');
const ejs = require('ejs');
const vm = require('vm');
const http = require('http');
const express = require('express');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'style.css'), 'utf8');
const footerEjs = fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', 'footer.ejs'), 'utf8');
const drawerEjs = fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', 'mini-cart-content.ejs'), 'utf8');
const shopRoutes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'shop.js'), 'utf8');
const indexEjs = fs.readFileSync(path.join(__dirname, '..', 'views', 'index.ejs'), 'utf8');
const productEjs = fs.readFileSync(path.join(__dirname, '..', 'views', 'product.ejs'), 'utf8');
const wishlistEjs = fs.readFileSync(path.join(__dirname, '..', 'views', 'wishlist.ejs'), 'utf8');
const cartEjs = fs.readFileSync(path.join(__dirname, '..', 'views', 'cart.ejs'), 'utf8');
const renderFile = util.promisify(ejs.renderFile);
const footerPath = path.join(__dirname, '..', 'views', 'partials', 'footer.ejs');
const drawerPath = path.join(__dirname, '..', 'views', 'partials', 'mini-cart-content.ejs');

const failures = [];
const passes = [];
function check(name, ok, detail) {
  if (ok) { passes.push(name); console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

(async () => {
  // ---------- 1. Route: JSON branch exists, redirect preserved ----------
  check('route: AJAX detection (req.xhr / X-Requested-With) exists in POST /cart/add/:id',
    /router\.post\('\/cart\/add\/:id'/.test(shopRoutes) && /X-Requested-With/.test(shopRoutes) && /req\.xhr/.test(shopRoutes));
  check('route: AJAX success answers JSON with cartCount + itemName + subtotal + drawerHtml (no redirect)',
    /res\.json\(\{ ok: true, cartCount, itemName: product\.name, subtotal, drawerHtml \}\)/.test(shopRoutes));
  check('route: drawer HTML is rendered from the shared partial (ejs.renderFile mini-cart-content), not a second markup',
    /ejs\.renderFile\(\s*path\.join\(__dirname, '\.\.', 'views', 'partials', 'mini-cart-content\.ejs'\)/.test(shopRoutes));
  check('route: AJAX errors answer JSON { ok: false, error } with the right status (404/400/500)',
    (shopRoutes.match(/ajaxError\(404, 'Product not found'\)/g) || []).length === 1
    && (shopRoutes.match(/ajaxError\(400, 'Selected variant not found\.'\)/g) || []).length === 1
    && (shopRoutes.match(/ajaxError\(400, 'Selected option not found\.'\)/g) || []).length === 1
    && /ajaxError\(500, 'Could not add product to cart\.'\)/.test(shopRoutes));
  check('route: non-AJAX still redirects to /cart (no-JS fallback) and keeps the plain-text errors',
    /res\.redirect\('\/cart'\);/.test(shopRoutes) && /res\.status\(404\)\.send\('Product not found'\)/.test(shopRoutes));
  check('route: NO new route was invented for this (no /cart/add-ajax, no /api/cart)',
    !/cart\/add-ajax|api\/cart/.test(shopRoutes));
  check('route: requires ejs + path for the partial render', /const ejs = require\('ejs'\);/.test(shopRoutes) && /const path = require\('path'\);/.test(shopRoutes));

  // ---------- 2. Forms keep action + method; Choose Option is a link ----------
  check('forms: All Products / Best Sellers forms still POST to /cart/add/<id> with the CSRF field',
    (indexEjs.match(/<form action="\/cart\/add\/<%= p\.id %>" method="POST"><%- include\('partials\/csrf-field'\) %>/g) || []).length >= 2);
  check('forms: product page form still POSTs to /cart/add/<id> (class add-to-cart-form, qty + variant/option inputs)',
    /<form action="\/cart\/add\/<%= product\.id %>" method="POST" class="add-to-cart-form"/.test(productEjs)
    && /name="variant_id"/.test(productEjs) && /name="option_id"/.test(productEjs) && /name="quantity"/.test(productEjs));
  check('forms: wishlist Add to Cart form still POSTs to /cart/add/<id>',
    /<form action="\/cart\/add\/<%= p\.id %>" method="POST"><%- include\('partials\/csrf-field'\) %>/.test(wishlistEjs));
  check('forms: Recently Viewed renderer still builds a POST form to /cart/add/<id> with the _csrf field',
    /<form action="\/cart\/add\/' \+ it\.id \+ '" method="POST"><input type="hidden" name="_csrf"/.test(indexEjs));
  check('forms: "Choose Option →" is a LINK (not a form) in index + wishlist, so it is not intercepted',
    (indexEjs.match(/<a href="\/product\/<%= p\.id %>" class="btn-card">Choose Option →<\/a>/g) || []).length >= 2
    && /<a href="\/product\/<%= p\.id %>" class="btn-card">Choose Option →<\/a>/.test(wishlistEjs));
  check('forms: cart "You might also like" has NO add-to-cart form at all (only product links) — nothing to intercept there',
    !/cart\/add/.test(cartEjs));

  // ---------- 3. Footer: toast element + IIFE handler ----------
  check('footer: toast element exists (role=status, aria-live, hidden by default)',
    /<div class="cart-toast" id="cart-toast" role="status" aria-live="polite" hidden><\/div>/.test(footerEjs));
  check('footer: side-cart tab is still <a href="/cart"> (no-JS fallback)',
    /<a href="\/cart" class="side-cart"/.test(footerEjs));
  check('footer: IIFE intercepts /cart/add/ submits via document delegation (covers JS-rendered forms too)',
    /document\.addEventListener\('submit'/.test(footerEjs) && /action\.indexOf\('\/cart\/add\/'\) !== 0/.test(footerEjs));
  check('footer: submit sends urlencoded (URLSearchParams from FormData) with the AJAX headers — NOT multipart',
    /new FormData\(form\)/.test(footerEjs) && /new URLSearchParams\(\)/.test(footerEjs)
    && /'X-Requested-With': 'XMLHttpRequest'/.test(footerEjs) && /'Content-Type': 'application\/x-www-form-urlencoded'/.test(footerEjs));
  check('footer: success updates BOTH badges, replaces drawer HTML, rebinds drawer buttons, restores tab, opens drawer, toasts',
    /setCartCount\(r\.data\.cartCount\)/.test(footerEjs) && /drawer\.innerHTML = r\.data\.drawerHtml/.test(footerEjs)
    && /rebindDrawerButtons\(\)/.test(footerEjs) && /restoreTab\(\)/.test(footerEjs)
    && /openDrawer\(\)/.test(footerEjs) && /showToast\('✓ ' \+ \(r\.data\.itemName/.test(footerEjs));
  check('footer: error path toasts an error and does NOT open the drawer (openDrawer is called only from the tab click and the success branch)',
    /showToast\(\(r\.data && r\.data\.error\) \|\| 'Could not add to cart\. Please try again\.', true\)/.test(footerEjs)
    && (footerEjs.match(/openDrawer\(\);/g) || []).length === 2);
  check('footer: in-flight guard disables the button and blocks double submits (form._adding)',
    /form\._adding/.test(footerEjs) && /btn\.disabled = true/.test(footerEjs) && /btn\.disabled = false/.test(footerEjs));
  check('footer: toast auto-dismisses after ~3s (3000ms timer hides it)',
    /setTimeout\(function \(\) \{\s*toastTimer = null;\s*toast\.classList\.remove\('is-visible'\);\s*toast\.hidden = true;\s*\}, 3000\)/.test(footerEjs));
  check('footer: drawer buttons are rebound after a drawer refresh (fresh × / Continue get listeners)',
    /function rebindDrawerButtons\(\)/.test(footerEjs) && /drawer\.innerHTML = r\.data\.drawerHtml;\s*rebindDrawerButtons\(\);/.test(footerEjs));
  check('footer: badge sync covers the side-cart badge AND the mobile drawer Cart badge (created when missing)',
    /document\.querySelector\('\.side-cart-badge'\)/.test(footerEjs)
    && /document\.querySelector\('\.shop-drawer-link\[href="\/cart"\] \.badge'\)/.test(footerEjs)
    && /document\.createElement\('span'\)/.test(footerEjs));

  // ---------- 4. Partial: shared by footer + route ----------
  check('partial: footer aside includes mini-cart-content (no inline drawer body left in footer.ejs)',
    /include\('mini-cart-content'\)/.test(footerEjs) && !/class="mini-cart-items"/.test(footerEjs));
  check('partial: mini-cart-content.ejs exists with head + items + subtotal + foot',
    drawerEjs.includes('mini-cart-title') && drawerEjs.includes('class="mini-cart-items"')
    && drawerEjs.includes('class="mini-cart-subtotal"') && drawerEjs.includes('class="mini-cart-empty"'));
  const partialHtml = await renderFile(drawerPath, {
    miniCart: [
      { id: 3, name: 'BINBOND 2521 Watch', price: 990, image: 'w.jpg', quantity: 2, cartKey: '3', variantLabel: null },
      { id: 5, name: 'MLSM-202 Sewing Machine', price: 1250, image: 's.jpg', quantity: 1, cartKey: '5', variantLabel: 'Size: M' },
    ],
    miniCartSubtotal: 3230, cartCount: 3, csrfToken: 'tok123',
  });
  check('partial: standalone render shows both items, variant label, count (3) and subtotal ৳3,230',
    partialHtml.includes('BINBOND 2521 Watch') && partialHtml.includes('MLSM-202 Sewing Machine')
    && partialHtml.includes('Size: M') && partialHtml.includes('Your Cart (3)') && partialHtml.includes('৳3,230'));
  check('partial: standalone render carries the CSRF token into the qty forms',
    partialHtml.includes('name="_csrf" value="tok123"'));

  // ---------- 5. Toast CSS ----------
  const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  check('css: .cart-toast exists — fixed, bottom centre, z-index 1100 (above drawer 1001), dark navy bg, white text',
    /\.cart-toast \{[^}]*position:\s*fixed[^}]*left:\s*50%[^}]*bottom:\s*24px[^}]*z-index:\s*1100[^}]*background:\s*var\(--navy\)[^}]*color:\s*#fff/.test(cssNoComments));
  check('css: .cart-toast.is-visible fades/slides in (opacity 1, translate(-50%, 0))',
    /\.cart-toast\.is-visible \{[^}]*opacity:\s*1[^}]*transform:\s*translate\(-50%, 0\)/.test(cssNoComments));
  check('css: .cart-toast--error is the danger red (var(--danger-solid))',
    /\.cart-toast--error \{[^}]*background:\s*var\(--danger-solid\)/.test(cssNoComments));
  check('css: reduced-motion disables the toast transition',
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.cart-toast \{[^}]*transition:\s*none/.test(css));

  // ---------- 6. Route E2E: real express app, stubbed DB ----------
  const dbPath = require.resolve('../config/db');
  const CSRF_TOKEN = 'test-csrf-token-ajax';
  const testSession = { cart: [], csrfToken: CSRF_TOKEN };
  const products = {
    3: { id: 3, name: 'BINBOND 2521 Watch', price: 990, image: 'watch.jpg', stock: 15 },
    5: { id: 5, name: 'MLSM-202 Sewing Machine', price: 1250, image: 'sewing.jpg', stock: 16 },
    7: { id: 7, name: 'A.T.Z Dress', price: 310, image: 'dress.jpg', stock: 10 },
  };
  const dbStub = {
    query: async (sql, params) => {
      if (/FROM products WHERE id = \?/.test(sql)) {
        const p = products[params[0]];
        return [p ? [p] : []];
      }
      if (/FROM product_variants WHERE id = \? AND product_id = \?/.test(sql)) {
        // NOTE: req.params.id is a STRING ('7'), so compare as a string.
        if (params[0] === 11 && String(params[1]) === '7') return [[{ id: 11, product_id: 7, price: 1100, stock: 5 }]];
        return [[]];
      }
      if (/product_variant_attributes/.test(sql)) return [[{ attribute_name: 'Size', value: 'M' }]];
      if (/FROM product_options WHERE id = \? AND product_id = \?/.test(sql)) {
        if (params[0] === 21 && String(params[1]) === '3') return [[{ id: 21, option_label: 'Color', value_name: 'Red', image: null }]];
        return [[]];
      }
      return [[]];
    },
  };
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: dbStub };
  const { csrfProtection } = require('../lib/csrf');
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use((req, res, next) => { req.session = testSession; next(); });
  app.use(csrfProtection);
  app.use('/', require('../routes/shop'));
  function post(port, pathUrl, body, ajax) {
    return new Promise((resolve, reject) => {
      const headers = { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) };
      if (ajax) { headers['X-Requested-With'] = 'XMLHttpRequest'; headers.Accept = 'application/json'; }
      const req = http.request({ method: 'POST', host: '127.0.0.1', port, path: pathUrl, headers }, (res) => {
        const parts = [];
        res.on('data', (c) => parts.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(parts).toString('utf8') }));
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }
  const enc = (o) => Object.entries(o).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.on('listening', r));
  const port = server.address().port;
  try {
    // A. Normal POST (no AJAX header) -> 302 to /cart, item in cart (no-JS fallback).
    testSession.cart = [];
    const normal = await post(port, '/cart/add/3', enc({ _csrf: CSRF_TOKEN, quantity: '1' }), false);
    check('e2e: normal POST (no AJAX header) still redirects to /cart and adds the item',
      normal.status === 302 && normal.headers.location === '/cart'
      && testSession.cart.length === 1 && testSession.cart[0].quantity === 1 && testSession.cart[0].name === 'BINBOND 2521 Watch');

    // B. AJAX add, first item -> 200 JSON with count, name, subtotal, fresh drawer HTML.
    testSession.cart = [];
    const ajax1 = await post(port, '/cart/add/3', enc({ _csrf: CSRF_TOKEN, quantity: '1' }), true);
    let j1 = null;
    try { j1 = JSON.parse(ajax1.body); } catch (e) { /* not JSON */ }
    check('e2e: AJAX add returns 200 JSON { ok, cartCount 1, itemName, subtotal 990 } (no redirect)',
      ajax1.status === 200 && j1 && j1.ok === true && j1.cartCount === 1
      && j1.itemName === 'BINBOND 2521 Watch' && j1.subtotal === 990 && !ajax1.headers.location);
    check('e2e: AJAX drawer HTML is FRESH — contains the new item, "Your Cart (1)" and subtotal ৳990',
      j1 && typeof j1.drawerHtml === 'string' && j1.drawerHtml.includes('BINBOND 2521 Watch')
      && j1.drawerHtml.includes('Your Cart (1)') && j1.drawerHtml.includes('৳990'));
    check('e2e: AJAX drawer HTML carries the CSRF token into its qty forms (steppers keep working)',
      j1 && j1.drawerHtml.includes(`name="_csrf" value="${CSRF_TOKEN}"`));

    // C. AJAX add again (same product) -> quantity 2, count 2, subtotal 1980, drawer shows it.
    const ajax2 = await post(port, '/cart/add/3', enc({ _csrf: CSRF_TOKEN, quantity: '1' }), true);
    const j2 = JSON.parse(ajax2.body);
    check('e2e: AJAX add twice adds 2 (cartCount 2, subtotal ৳1,980, drawer shows quantity 2)',
      ajax2.status === 200 && j2.ok === true && j2.cartCount === 2 && j2.subtotal === 1980
      && j2.drawerHtml.includes('৳1,980') && /value="2"[^>]*class="qty-input"|class="qty-input"[^>]*value="2"/.test(j2.drawerHtml));

    // D. AJAX add with quantity=2 of another product -> counts add up.
    const ajax3 = await post(port, '/cart/add/5', enc({ _csrf: CSRF_TOKEN, quantity: '2' }), true);
    const j3 = JSON.parse(ajax3.body);
    check('e2e: AJAX add quantity=2 of a second product -> cartCount 4, subtotal ৳4,480, both items in the drawer',
      ajax3.status === 200 && j3.ok === true && j3.cartCount === 4 && j3.subtotal === 4480
      && j3.drawerHtml.includes('BINBOND 2521 Watch') && j3.drawerHtml.includes('MLSM-202 Sewing Machine'));

    // E. AJAX add of a missing product -> 404 JSON { ok: false }, cart unchanged.
    const beforeE = testSession.cart.length;
    const ajax404 = await post(port, '/cart/add/999', enc({ _csrf: CSRF_TOKEN, quantity: '1' }), true);
    let j404 = null;
    try { j404 = JSON.parse(ajax404.body); } catch (e) { /* not JSON */ }
    check('e2e: AJAX add of a missing product -> 404 JSON { ok: false, error } and the cart is unchanged',
      ajax404.status === 404 && j404 && j404.ok === false && j404.error === 'Product not found'
      && testSession.cart.length === beforeE);

    // F. AJAX add WITHOUT any CSRF token -> 403, nothing added.
    const beforeF = testSession.cart.length;
    const noToken = await post(port, '/cart/add/3', enc({ quantity: '1' }), true);
    check('e2e: AJAX add WITHOUT a token is still 403 (CSRF enforced) and nothing is added',
      noToken.status === 403 && noToken.body.includes('Security check failed') && testSession.cart.length === beforeF);

    // G. AJAX add with a bad variant -> 400 JSON { ok: false }.
    testSession.cart = [];
    const badVariant = await post(port, '/cart/add/7', enc({ _csrf: CSRF_TOKEN, quantity: '1', variant_id: '99' }), true);
    let jBadV = null;
    try { jBadV = JSON.parse(badVariant.body); } catch (e) { /* not JSON */ }
    check('e2e: AJAX add with a bad variant -> 400 JSON { ok: false, error } and nothing is added',
      badVariant.status === 400 && jBadV && jBadV.ok === false && jBadV.error === 'Selected variant not found.'
      && testSession.cart.length === 0);

    // H. AJAX add with a good variant -> 200, drawer shows the variant label.
    const goodVariant = await post(port, '/cart/add/7', enc({ _csrf: CSRF_TOKEN, quantity: '1', variant_id: '11' }), true);
    const jGoodV = JSON.parse(goodVariant.body);
    check('e2e: AJAX add with a valid variant -> 200, drawer shows the variant label "Size: M"',
      goodVariant.status === 200 && jGoodV.ok === true && jGoodV.cartCount === 1
      && jGoodV.drawerHtml.includes('Size: M'));

    // I. AJAX add with a bad option -> 400 JSON { ok: false }.
    const badOption = await post(port, '/cart/add/3', enc({ _csrf: CSRF_TOKEN, quantity: '1', option_id: '99' }), true);
    let jBadO = null;
    try { jBadO = JSON.parse(badOption.body); } catch (e) { /* not JSON */ }
    check('e2e: AJAX add with a bad option -> 400 JSON { ok: false, error }',
      badOption.status === 400 && jBadO && jBadO.ok === false && jBadO.error === 'Selected option not found.');

    // J. AJAX add with a good option -> 200, drawer shows the option label.
    const goodOption = await post(port, '/cart/add/3', enc({ _csrf: CSRF_TOKEN, quantity: '1', option_id: '21' }), true);
    const jGoodO = JSON.parse(goodOption.body);
    check('e2e: AJAX add with a valid option -> 200, drawer shows the option label "Color: Red"',
      goodOption.status === 200 && jGoodO.ok === true && jGoodO.drawerHtml.includes('Color: Red'));
  } finally {
    server.close();
    delete require.cache[dbPath];
    delete require.cache[require.resolve('../routes/shop')];
  }

  // ---------- 7. The REAL add-to-cart IIFE in a stubbed DOM ----------
  const gStart = footerEjs.indexOf('(function () {', footerEjs.indexOf('Side-cart tab overlap guard'));
  const gEnd = gStart > 0 ? footerEjs.indexOf('})();', gStart) + 5 : -1;
  const gCode = gStart > 0 ? footerEjs.slice(gStart, gEnd) : '';
  check('iife: extractable from footer.ejs (same IIFE as the PR #75 guard + PR #77 drawer)',
    gStart > 0 && gCode.includes("querySelector('.side-cart')") && gCode.includes('addEventListener(\'submit\''));

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

  const TAB_RECT = { left: 1852, top: 512, right: 1908, bottom: 568 };
  const CLEAR_RECT = { left: 100, top: 500, right: 300, bottom: 540 };
  function runScenario() {
    const clock = makeClock();
    const tab = makeStubEl(); tab._rect = Object.assign({}, TAB_RECT);
    const drawer = makeStubEl(); drawer.hidden = true;
    // innerHTML needs a real setter: the IIFE replaces the drawer
    // contents after an add, and the sandbox must notice that
    // (drawer._refreshed) so the next querySelector returns the
    // FRESH close/continue buttons, like the real DOM does.
    let _drawerHtml = '';
    Object.defineProperty(drawer, 'innerHTML', {
      get() { return _drawerHtml; },
      set(v) { _drawerHtml = v; drawer._refreshed = true; },
      configurable: true,
    });
    const overlay = makeStubEl(); overlay.hidden = true;
    const toast = makeStubEl(); toast.hidden = true;
    const body = makeStubEl();
    const guardedEl = makeStubEl(); guardedEl._rect = Object.assign({}, CLEAR_RECT);
    // Close/Continue buttons: the IIFE binds the ones it finds at
    // load; after a drawer refresh it re-queries and must find FRESH
    // nodes — the sandbox returns the v2 nodes once the drawer HTML
    // has been replaced (drawer._refreshed).
    let closeBtn = makeStubEl();
    let continueBtn = makeStubEl();
    const closeBtn2 = makeStubEl();
    const continueBtn2 = makeStubEl();
    const badge = makeStubEl();
    const drawerLink = makeStubEl();
    const drawerBadgeHolder = { el: null };
    const fetchCalls = [];
    let fetchDeferred = null;
    function defer() {
      let resolve; let reject;
      const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
      return { promise, resolve, reject };
    }
    const winListeners = {};
    const docListeners = {};
    function FormDataStub(form) {
      this._pairs = form._fields || [];
    }
    FormDataStub.prototype.forEach = function (cb) {
      this._pairs.forEach((pair) => cb(pair[1], pair[0]));
    };
    const sandbox = {
      document: {
        querySelector(sel) {
          if (sel === '.side-cart') return tab;
          if (sel === '#mini-cart-drawer') return drawer;
          if (sel === '#mini-cart-overlay') return overlay;
          if (sel === '.mini-cart-close') return drawer._refreshed ? closeBtn2 : closeBtn;
          if (sel === '.mini-cart-continue') return drawer._refreshed ? continueBtn2 : continueBtn;
          if (sel === '#cart-toast') return toast;
          if (sel === '.side-cart-badge') return drawer._badge || null;
          if (sel === '.shop-drawer-link[href="/cart"]') return drawerLink;
          if (sel === '.shop-drawer-link[href="/cart"] .badge') return drawerBadgeHolder.el;
          return null;
        },
        querySelectorAll() { return [guardedEl]; },
        documentElement: { scrollTop: 0 },
        activeElement: tab,
        body,
        addEventListener(type, fn) { (docListeners[type] = docListeners[type] || []).push(fn); },
        createElement(tag) {
          const el = makeStubEl();
          el._tag = tag;
          return el;
        },
      },
      window: {
        pageYOffset: 0,
        innerHeight: 1080,
        innerWidth: 1920,
        addEventListener(type, fn) { (winListeners[type] = winListeners[type] || []).push(fn); },
        requestAnimationFrame(fn) { fn(); },
      },
      setTimeout(fn, ms) { return clock.setTimeout(fn, ms); },
      clearTimeout(id) { clock.clearTimeout(id); },
      FormData: FormDataStub,
      URLSearchParams,
      fetch(url, opts) {
        fetchCalls.push({ url, opts });
        fetchDeferred = defer();
        return fetchDeferred.promise;
      },
    };
    sandbox.window.document = sandbox.document;
    // The stub tab must carry the badge once created: the IIFE
    // appends it via tab.appendChild — track it on the tab object.
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
      clock, tab, drawer, overlay, toast, body, guardedEl,
      closeBtn, continueBtn, closeBtn2, continueBtn2, badge, drawerLink, drawerBadgeHolder,
      fetchCalls,
      resolveFetch(res) { fetchDeferred.resolve(res); },
      rejectFetch(err) { fetchDeferred.reject(err); },
      fireWin(type) { (winListeners[type] || []).forEach((fn) => fn()); },
      fireDoc(type, ev) { (docListeners[type] || []).forEach((fn) => fn(ev || {})); },
      isMinimised: () => tab.classList.contains('side-cart--minimised'),
      isHidden: () => tab.classList.contains('side-cart--hidden'),
      drawerOpen: () => drawer.classList.contains('is-open') && drawer.hidden === false,
      toastVisible: () => toast.hidden === false && toast.classList.contains('is-visible'),
    };
  }
  function submitEvent(form) {
    const ev = { target: form, prevented: false, preventDefault() { ev.prevented = true; } };
    return ev;
  }
  function makeAddForm(fields) {
    const btn = makeStubEl();
    const form = makeStubEl();
    form._fields = fields || [['_csrf', 'tok123'], ['quantity', '1']];
    form.getAttribute = (k) => (k === 'action' ? '/cart/add/3' : k === 'method' ? 'POST' : null);
    form.querySelector = (sel) => (sel === 'button[type="submit"]' ? btn : null);
    form._btn = btn;
    return form;
  }
  function okResponse(data) {
    return { status: 200, ok: true, json: () => Promise.resolve(data) };
  }

  const sc = runScenario();
  check('behaviour: tab is fully visible on load, drawer + overlay + toast hidden',
    !sc.isMinimised() && !sc.isHidden() && sc.drawer.hidden === true && sc.overlay.hidden === true && sc.toast.hidden === true);
  // Minimise the tab first (6s idle), so the add must restore it.
  sc.clock.advance(6000);
  check('behaviour: tab minimised to the sliver after 6s idle (setup for the add test)', sc.isMinimised());
  const form = makeAddForm();
  const ev1 = submitEvent(form);
  sc.fireDoc('submit', ev1);
  check('behaviour: submitting an Add to Cart form is intercepted — NO navigation (preventDefault) and fetch POSTs urlencoded with the AJAX headers',
    ev1.prevented === true && sc.fetchCalls.length === 1
    && sc.fetchCalls[0].url === '/cart/add/3' && sc.fetchCalls[0].opts.method === 'POST'
    && sc.fetchCalls[0].opts.headers['X-Requested-With'] === 'XMLHttpRequest'
    && sc.fetchCalls[0].opts.headers['Content-Type'] === 'application/x-www-form-urlencoded'
    && sc.fetchCalls[0].opts.body.includes('_csrf=tok123') && sc.fetchCalls[0].opts.body.includes('quantity=1'));
  check('behaviour: the clicked button is disabled while the request is in flight',
    form._btn.disabled === true && form._adding === true);
  // A second submit while in flight must NOT fire a second fetch.
  const evDup = submitEvent(form);
  sc.fireDoc('submit', evDup);
  check('behaviour: double submit while in flight fires only ONE fetch (no double-add)',
    sc.fetchCalls.length === 1 && evDup.prevented === true);
  sc.resolveFetch(okResponse({
    ok: true, cartCount: 1, itemName: 'BINBOND 2521 Watch', subtotal: 990,
    drawerHtml: '<div class="mini-cart-head"><h2>Your Cart (1)</h2></div><p>BINBOND 2521 Watch</p>',
  }));
  await flushAll();
  check('behaviour: success updates the side-cart badge (created, text "1") AND the drawer Cart badge',
    sc.tab._badge && sc.tab._badge.textContent === '1' && sc.drawerBadgeHolder.el && sc.drawerBadgeHolder.el.textContent === '1');
  check('behaviour: success replaces the drawer HTML with the FRESH server HTML (not stale)',
    sc.drawer.innerHTML.includes('BINBOND 2521 Watch') && sc.drawer.innerHTML.includes('Your Cart (1)'));
  check('behaviour: success opens the drawer on the same page (no navigation, no reload)',
    sc.drawerOpen() && sc.overlay.classList.contains('is-open'));
  check('behaviour: success shows the toast with the product name',
    sc.toastVisible() && sc.toast.textContent.includes('BINBOND 2521 Watch') && sc.toast.textContent.includes('added to cart'));
  check('behaviour: success restores the tab from the sliver (fully visible again)',
    !sc.isMinimised() && !sc.isHidden());
  check('behaviour: the button is re-enabled after the request finishes',
    form._btn.disabled === false && form._adding === false);
  // The drawer was refreshed: the FRESH close button (v2) must work.
  check('behaviour: after the drawer refresh, the FRESH × button has exactly one click listener (rebound)',
    (sc.closeBtn2._listeners.click || []).length === 1);
  sc.closeBtn2.fire('click');
  check('behaviour: clicking the FRESH × button closes the drawer (rebind works)',
    !sc.drawerOpen());
  // Toast auto-dismisses after 3s.
  sc.clock.advance(3000);
  check('behaviour: the toast hides itself after ~3s',
    sc.toast.hidden === true && !sc.toast.classList.contains('is-visible'));
  // Error JSON: toast error, no drawer, no navigation, button re-enabled.
  const form2 = makeAddForm();
  const ev2 = submitEvent(form2);
  sc.fireDoc('submit', ev2);
  sc.resolveFetch({ status: 400, ok: false, json: () => Promise.resolve({ ok: false, error: 'Selected variant not found.' }) });
  await flushAll();
  check('behaviour: error JSON shows the server error in the toast, does NOT open the drawer, does NOT navigate',
    ev2.prevented === true && sc.toastVisible() && sc.toast.textContent.includes('Selected variant not found.')
    && sc.toast.classList.contains('cart-toast--error') && !sc.drawerOpen() && form2._btn.disabled === false);
  // Non-JSON error body (e.g. a 403 text page): generic toast, no drawer.
  const form3 = makeAddForm();
  const ev3 = submitEvent(form3);
  sc.fireDoc('submit', ev3);
  sc.resolveFetch({ status: 403, ok: false, json: () => Promise.reject(new Error('not json')) });
  await flushAll();
  check('behaviour: non-JSON error body still shows a generic error toast (no crash, no drawer, no navigation)',
    sc.toastVisible() && sc.toast.textContent.includes('Could not add to cart') && !sc.drawerOpen() && form3._btn.disabled === false);
  // Network failure: same.
  const form4 = makeAddForm();
  const ev4 = submitEvent(form4);
  sc.fireDoc('submit', ev4);
  sc.rejectFetch(new Error('network down'));
  await flushAll();
  check('behaviour: network failure shows the error toast, no drawer, button re-enabled',
    sc.toastVisible() && sc.toast.textContent.includes('Could not add to cart') && !sc.drawerOpen() && form4._btn.disabled === false);
  // A second successful add works after the failures (form is usable again).
  const beforeCount = sc.fetchCalls.length;
  const form5 = makeAddForm();
  const ev5 = submitEvent(form5);
  sc.fireDoc('submit', ev5);
  check('behaviour: the form works again after an error (new fetch fired)',
    sc.fetchCalls.length === beforeCount + 1 && ev5.prevented === true);
  sc.resolveFetch(okResponse({
    ok: true, cartCount: 2, itemName: 'MLSM-202 Sewing Machine', subtotal: 2240,
    drawerHtml: '<div class="mini-cart-head"><h2>Your Cart (2)</h2></div><p>MLSM-202 Sewing Machine</p>',
  }));
  await flushAll();
  check('behaviour: second add updates the badges to 2 and opens the drawer with the new item',
    sc.tab._badge.textContent === '2' && sc.drawer.innerHTML.includes('MLSM-202 Sewing Machine') && sc.drawerOpen());
  // UPDATED (feat/cart-buying, B5): drawer-er qty stepper ekhon
  // AJAX-e intercept hoy (drawer-er vitore thakle) — tai ei check-ta
  // CART PAGE-er stepper-er jonno (drawer-er baire): sheta ekhono
  // intercept hoy na, sadharon POST-e /cart-e redirect hoy. Drawer
  // stepper-er AJAX coverage scripts/test-cart-buying.js-e ache.
  // Stub form-er closest nei (drawer-er baire) — tai pass-through.
  const otherForm = makeStubEl();
  otherForm.getAttribute = (k) => (k === 'action' ? '/cart/update/3' : k === 'method' ? 'POST' : null);
  const evOther = submitEvent(otherForm);
  const callsBefore = sc.fetchCalls.length;
  sc.fireDoc('submit', evOther);
  check('behaviour: a CART-PAGE qty stepper (outside the drawer) is NOT intercepted — no preventDefault, no fetch',
    evOther.prevented === false && sc.fetchCalls.length === callsBefore);
  // A form whose action is not /cart/add/ at all (e.g. notify-me) passes through too.
  const notifyForm = makeStubEl();
  notifyForm.getAttribute = (k) => (k === 'action' ? '/product/3/notify-me' : k === 'method' ? 'POST' : null);
  const evNotify = submitEvent(notifyForm);
  sc.fireDoc('submit', evNotify);
  check('behaviour: other POST forms (notify-me) are NOT intercepted either',
    evNotify.prevented === false && sc.fetchCalls.length === callsBefore);

  console.log(`\n${passes.length} passed, ${failures.length} failed.`);
  if (failures.length) { console.log('Failures: ' + failures.join(', ')); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
