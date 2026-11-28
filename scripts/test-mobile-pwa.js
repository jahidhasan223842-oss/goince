// Mobile PWA (feat/mobile-pwa) — shop manifest + service worker +
// offline support + "Add to Home Screen", mobile bottom navigation,
// swipeable product gallery on mobile, offline cart view.
//
// What was built (SHOP ONLY — admin untouched):
//   H1  Shop PWA: NEW public/manifest-shop.json (start_url /, scope /)
//       linked from the SHOP header only. /manifest.json stays the
//       ADMIN manifest (start_url /admin/dashboard, scope /admin/)
//       linked from the admin header only. public/sw.js keeps the
//       admin push handlers verbatim and GAINS shop caching:
//       static assets stale-while-revalidate (?v= ignored), product
//       photos stale-while-revalidate (cap 60), navigations
//       network-first with /offline.html fallback, and NETWORK-ONLY
//       for /admin/*, /cart, /checkout, /login, /signup, /account*,
//       /track-order, /api/*, /push-*, /newsletter/* — so prices,
//       stock and checkout can never go stale. SW absent/failing =
//       site works as before (registration is try/catch).
//   H2  Mobile bottom nav (footer.ejs, mobile only ≤768px): Home,
//       Categories (button — opens the existing hamburger drawer,
//       no new URL), Cart (same cartCount badge), Account
//       (/account/profile logged in, /login logged out). Fixed
//       bottom 60px, z-index 500 — under the side-cart tab (600),
//       shop drawer (900), WhatsApp float (999) and mini-cart
//       drawer (1001), above the sticky buy bar (450) — and the
//       sticky bar is moved UP above the nav on mobile, the
//       WhatsApp float is moved up above the bar, and the footer
//       gets bottom padding, so nothing is covered or hidden.
//   H3  Swipeable gallery (product-gallery.js): touch-swipe
//       left/right on the stage steps photos on mobile; arrows,
//       thumbnails, zoom and keyboard still work; desktop unchanged.
//       Swipe needs ≥40px horizontal, is ignored while zoomed,
//       while a video slide shows, and for vertical drags (scroll).
//   H4  Offline cart: shop-pwa.js saves the mini-cart drawer's
//       REAL HTML to localStorage on every cart change (never
//       invented items; empty cart clears the snapshot). Offline,
//       /offline.html renders that last-known cart with a clear
//       "You're offline" notice and disabled forms; the cart page
//       itself shows an offline notice when the connection drops,
//       and the drawer gets an offline banner.
//
// HONEST UPDATES to older suites (behaviour legitimately moved by
// this batch — see PR body):
//   - test-cart-buying.js: mobile sticky-buy-bar bottom is now
//     calc(60px + safe-area) (was bottom: 0) — it must sit ABOVE
//     the new bottom nav, or the nav would cover its Add to Cart.
//   - test-full-width-hero-cleanup.js: mobile WhatsApp float bottom
//     is now 140px (was 88px) — it must clear nav (60px) + the
//     raised sticky bar (~64px), or it would cover the bar.
//
// No live MySQL needed: CSS/EJS source checks + direct EJS renders
// + the REAL sw.js / shop-pwa.js / product-gallery.js run in
// stubbed DOMs (vm sandbox — no jsdom in node_modules).
//
// Run:  node scripts/test-mobile-pwa.js
// Exit code 0 = all checks passed.
'use strict';

const fs = require('fs');
const path = require('path');
const util = require('util');
const ejs = require('ejs');
const vm = require('vm');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'style.css'), 'utf8');
const shopManifestRaw = fs.readFileSync(path.join(__dirname, '..', 'public', 'manifest-shop.json'), 'utf8');
const adminManifestRaw = fs.readFileSync(path.join(__dirname, '..', 'public', 'manifest.json'), 'utf8');
const swJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8');
const shopPwaJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'shop-pwa.js'), 'utf8');
const galleryJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'product-gallery.js'), 'utf8');
const offlineHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'offline.html'), 'utf8');
const headerEjs = fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', 'header.ejs'), 'utf8');
const footerEjs = fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', 'footer.ejs'), 'utf8');
const cartEjs = fs.readFileSync(path.join(__dirname, '..', 'views', 'cart.ejs'), 'utf8');
const productEjs = fs.readFileSync(path.join(__dirname, '..', 'views', 'product.ejs'), 'utf8');
const adminHeaderEjs = fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', 'admin-header.ejs'), 'utf8');
const adminFooterEjs = fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', 'admin-footer.ejs'), 'utf8');
const assetsJs = fs.readFileSync(path.join(__dirname, '..', 'lib', 'assets.js'), 'utf8');
const serverJs = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const renderFile = util.promisify(ejs.renderFile);
const footerPath = path.join(__dirname, '..', 'views', 'partials', 'footer.ejs');
const headerPath = path.join(__dirname, '..', 'views', 'partials', 'header.ejs');
const cartPath = path.join(__dirname, '..', 'views', 'cart.ejs');
const productPath = path.join(__dirname, '..', 'views', 'product.ejs');

const failures = [];
const passes = [];
function check(name, ok, detail) {
  if (ok) { passes.push(name); console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

// Same CSS helpers as test-product-hover-gallery.js.
const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
function allMediaRanges(text, query) {
  const ranges = [];
  let from = 0;
  for (;;) {
    const i = text.indexOf('@media', from);
    if (i < 0) break;
    if (query && !text.slice(i, i + 60).includes(query)) { from = i + 6; continue; }
    const open = text.indexOf('{', i);
    if (open < 0) break;
    let d = 0;
    let j = open;
    for (; j < text.length; j++) {
      if (text[j] === '{') d++;
      if (text[j] === '}') { d--; if (d === 0) break; }
    }
    ranges.push([i, j + 1]);
    from = j + 1;
  }
  return ranges;
}
function stripRanges(text, ranges) {
  let out = '';
  let last = 0;
  for (const [a, b] of ranges) { out += text.slice(last, a); last = b; }
  return out + text.slice(last);
}
function extractRanges(text, ranges) {
  return ranges.map(([a, b]) => text.slice(a, b)).join('\n');
}
const cssTopLevel = stripRanges(cssNoComments, allMediaRanges(cssNoComments));
const mobileBlocks = extractRanges(cssNoComments, allMediaRanges(cssNoComments, 'max-width: 768px'));
function ruleBody(source, selectorRe) {
  const m = source.match(selectorRe);
  return m ? m[0] : null;
}

const { buildMenuTree: bmt, buildMenuById } = require('../lib/categories');
const catRows = [
  { id: 8, name: 'Home Appliances', parent_id: null, is_visible: 1, is_featured: 0, sort_order: 1, slug: 'home-appliances', image_url: '', description: '', banner_url: '', meta_title: '', meta_description: '', product_count: 3 },
  { id: 12, name: 'Winter Collection', parent_id: null, is_visible: 1, is_featured: 0, sort_order: 2, slug: 'winter-collection', image_url: '', description: '', banner_url: '', meta_title: '', meta_description: '', product_count: 1 },
];
const menu = bmt(catRows);
const baseLocals = {
  cartCount: 0,
  userName: null,
  siteSettings: { hero_title: 'সেরা পণ্য, ক্যাশ অন ডেলিভারি', hero_subtitle: 'ঢাকার ভিতরে ১–২ দিনে, ঢাকার বাইরে ৩–৫ দিনে ডেলিভারি।', announcement_text: '', logo_url: '/icons/icon-192.png', facebook_url: '' },
  theme: 'dark',
  shopPhone: '01814697896',
  csrfToken: 'test-csrf',
  assetUrl: (p) => p,
  siteName: 'Goince',
  search: '',
  menuCategories: menu,
  menuById: buildMenuById(menu),
  displayCategories: [{ id: 8, name: 'Home Appliances', image_url: '' }, { id: 12, name: 'Winter Collection', image_url: '' }],
  subCategories: [],
  breadcrumb: [],
  selectedCategory: '',
  selectedCategoryObj: null,
  isSeasonalCategory: false,
  selectedAudience: '',
  sort: 'newest',
  minPrice: '',
  maxPrice: '',
};

(async function main() {
  console.log('Mobile PWA (feat/mobile-pwa) checks:');

  // ---------- H1a. Shop manifest ----------
  let shopManifest = null;
  try { shopManifest = JSON.parse(shopManifestRaw); } catch (e) { /* checked below */ }
  check('manifest: shop manifest parses as JSON', !!shopManifest);
  if (shopManifest) {
    check('manifest: shop name is Goince', shopManifest.name === 'Goince');
    check('manifest: shop short_name is Goince', shopManifest.short_name === 'Goince');
    check('manifest: shop start_url is / (the shop, not /admin/dashboard)', shopManifest.start_url === '/');
    check('manifest: shop scope is /', shopManifest.scope === '/');
    check('manifest: shop display is standalone (installable)', shopManifest.display === 'standalone');
    check('manifest: shop theme_color set (navy #1a1a2e)', typeof shopManifest.theme_color === 'string' && shopManifest.theme_color.length > 0);
    const sizes = (shopManifest.icons || []).map((i) => i.sizes);
    check('manifest: shop icons include 192 + 512', sizes.includes('192x192') && sizes.includes('512x512'));
    check('manifest: shop icons include both any + maskable purposes', (shopManifest.icons || []).some((i) => i.purpose === 'any') && (shopManifest.icons || []).some((i) => i.purpose === 'maskable'));
    check('manifest: shop icons use the existing /icons files (no new photo/icon invented)', (shopManifest.icons || []).every((i) => i.src === '/icons/icon-192.png' || i.src === '/icons/icon-512.png'));
  }
  let adminManifest = null;
  try { adminManifest = JSON.parse(adminManifestRaw); } catch (e) { /* checked below */ }
  check('manifest: admin manifest still parses + is UNCHANGED (Goince Admin, /admin/dashboard, /admin/ scope)', !!adminManifest && adminManifest.name === 'Goince Admin' && adminManifest.start_url === '/admin/dashboard' && adminManifest.scope === '/admin/');
  check('manifest: shop header links the SHOP manifest + theme-color, never the admin one', headerEjs.includes('href="/manifest-shop.json"') && headerEjs.includes('name="theme-color"') && !headerEjs.includes('href="/manifest.json"'));
  check('manifest: admin header still links the ADMIN manifest only', adminHeaderEjs.includes('href="/manifest.json"') && !adminHeaderEjs.includes('manifest-shop.json'));
  check('manifest: no new server route needed (manifests are static files under public/)', !/\/manifest-shop/.test(serverJs) && !/manifest-shop\.json/.test(serverJs));

  // ---------- H1b. Service worker — source rules ----------
  check('sw: file keeps the admin push handler (title/body/icon/vibrate)', swJs.includes("self.addEventListener('push'") && swJs.includes("title: 'Goince Admin'") && swJs.includes('vibrate: [200, 100, 200]'));
  check('sw: file keeps the notificationclick handler (focus/openWindow)', swJs.includes("self.addEventListener('notificationclick'") && swJs.includes('clients.openWindow'));
  check('sw: install precaches the offline page + app shell (css/js/icons)', swJs.includes("self.addEventListener('install'") && swJs.includes("'/offline.html'") && swJs.includes("'/css/style.css'") && swJs.includes("'/js/shop-pwa.js'") && swJs.includes("'/icons/icon-192.png'"));
  check('sw: activate deletes old goince-* caches + claims clients', swJs.includes("self.addEventListener('activate'") && swJs.includes('goince-') && swJs.includes('clients.claim()'));
  check('sw: fetch handler exists and only handles GET same-origin requests', swJs.includes("self.addEventListener('fetch'") && swJs.includes("request.method !== 'GET'") && swJs.includes('url.origin !== self.location.origin'));
  for (const p of ['/admin', '/cart', '/checkout', '/login', '/account', '/api/', '/push-', '/newsletter']) {
    check(`sw: network-only list includes ${p} (never cached, never stale)`, swJs.includes(`'${p}'`) || swJs.includes(`'${p}/'`) || swJs.includes(`"${p}"`));
  }
  check('sw: static assets (/css /js /icons) are stale-while-revalidate (?v= ignored)', swJs.includes('isStaticAsset') && swJs.includes('/css/') && swJs.includes('ignoreSearch: true'));
  check('sw: product photos (/uploads /images) are stale-while-revalidate with a cap', swJs.includes('isImageAsset') && swJs.includes('/uploads/') && swJs.includes('60'));
  check('sw: navigations are network-first with the offline page as fallback', swJs.includes("request.mode === 'navigate'") && swJs.includes('caches.match(GOINCE_OFFLINE_URL'));
  check('sw: admin navigations do NOT get the shop offline page', swJs.includes("pathname.indexOf('/admin') === 0"));
  check('sw: only 200 + basic responses are ever cached', swJs.includes('response.status === 200') && swJs.includes("response.type === 'basic'"));
  check('sw: no HTML page besides /offline.html is ever served from cache', !/caches\.match\((?!GOINCE_OFFLINE_URL)/.test(swJs) || swJs.indexOf('caches.match(') === swJs.lastIndexOf('caches.match('));

  // ---------- H1c. Service worker — REAL routing behaviour (stubbed SW) ----------
  function runServiceWorker(fetchImpl) {
    const listeners = {};
    const store = new Map(); // cacheName -> Map(urlNoQuery -> response)
    function stripQuery(u) { return String(u).split('?')[0]; }
    function cacheObj(name) {
      if (!store.has(name)) store.set(name, new Map());
      const m = store.get(name);
      return {
        match(req, opts) {
          const key = (opts && opts.ignoreSearch) ? stripQuery(req.url || req) : (req.url || req);
          return Promise.resolve(m.get(key) || undefined);
        },
        put(req, res) { m.set(stripQuery(req.url || req), res); return Promise.resolve(); },
        keys() { return Promise.resolve(Array.from(m.keys())); },
        delete(k) { m.delete(typeof k === 'string' ? k : stripQuery(k.url || k)); return Promise.resolve(true); },
        addAll(list) {
          list.forEach((u) => m.set(u, { status: 200, type: 'basic', url: u, clone() { return this; } }));
          return Promise.resolve();
        },
      };
    }
    const cachesStub = {
      open(name) { return Promise.resolve(cacheObj(name)); },
      match(url) {
        for (const m of store.values()) { const hit = m.get(stripQuery(url)); if (hit) return Promise.resolve(hit); }
        return Promise.resolve(undefined);
      },
      keys() { return Promise.resolve(Array.from(store.keys())); },
      delete(name) { store.delete(name); return Promise.resolve(true); },
    };
    const selfStub = {
      location: { origin: 'https://goince.com' },
      skipWaiting() {},
      clients: { claim() { return Promise.resolve(); }, matchAll() { return Promise.resolve([]); }, openWindow() { return Promise.resolve(null); } },
      registration: { showNotification() { return Promise.resolve(); } },
      addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    };
    const sandbox = { self: selfStub, caches: cachesStub, fetch: fetchImpl, URL, Promise, console };
    vm.createContext(sandbox);
    vm.runInContext(swJs, sandbox);
    return { listeners, store, cachesStub, selfStub };
  }
  function swEvent(request) {
    const ev = { request, _p: null, respondWith(p) { ev._p = p; }, waitUntil(p) { ev._p = p; if (p && p.catch) p.catch(() => {}); } };
    return ev;
  }
  function netResponse(url) { return { status: 200, type: 'basic', url, clone() { return this; } }; }
  // Online fetch stub: navigations + assets succeed.
  const onlineFetch = (req) => Promise.resolve(netResponse(req.url || req));
  const sw = runServiceWorker(onlineFetch);
  // Install precaches the offline page.
  {
    const ev = swEvent(null);
    sw.listeners.install[0](ev);
    await ev._p;
    const cached = await sw.cachesStub.match('/offline.html');
    check('sw behaviour: install precaches /offline.html', !!cached && cached.status === 200);
    const cssCached = await sw.cachesStub.match('/css/style.css?v=12345');
    check('sw behaviour: precached CSS matches even with a ?v= cache-buster (ignoreSearch)', !!cssCached);
  }
  // Activate drops old caches.
  {
    await sw.cachesStub.open('goince-shop-v0-static');
    const ev = swEvent(null);
    sw.listeners.activate[0](ev);
    await ev._p;
    const keys = await sw.cachesStub.keys();
    check('sw behaviour: activate deletes old goince-* caches', !keys.includes('goince-shop-v0-static'));
  }
  async function swFetchResult(request) {
    const ev = swEvent(request);
    sw.listeners.fetch[0](ev);
    if (!ev._p) return { handled: false, value: null };
    try { const v = await ev._p; return { handled: true, value: v }; }
    catch (e) { return { handled: true, value: null, error: e }; }
  }
  function getReq(url, mode) { return { method: 'GET', mode: mode || 'cors', url }; }
  let r = await swFetchResult(getReq('https://goince.com/cart', 'navigate'));
  check('sw behaviour: /cart navigation is NOT intercepted (network-only, fresh cart)', r.handled === false);
  r = await swFetchResult(getReq('https://goince.com/admin/products', 'navigate'));
  check('sw behaviour: /admin navigation is NOT intercepted (admin untouched)', r.handled === false);
  r = await swFetchResult(getReq('https://goince.com/checkout', 'navigate'));
  check('sw behaviour: /checkout navigation is NOT intercepted', r.handled === false);
  r = await swFetchResult(getReq('https://goince.com/api/search-suggestions?q=watch'));
  check('sw behaviour: /api/* is NOT intercepted (search stays fresh)', r.handled === false);
  r = await swFetchResult({ method: 'POST', mode: 'cors', url: 'https://goince.com/cart/add/3' });
  check('sw behaviour: POST is NOT intercepted', r.handled === false);
  r = await swFetchResult(getReq('https://other.com/css/style.css'));
  check('sw behaviour: cross-origin request is NOT intercepted', r.handled === false);
  r = await swFetchResult(getReq('https://goince.com/product/3', 'navigate'));
  check('sw behaviour: product page navigation goes to the network (never stale prices/stock)', r.handled === true && !!r.value && r.value.url === 'https://goince.com/product/3');
  r = await swFetchResult(getReq('https://goince.com/css/style.css?v=999'));
  check('sw behaviour: versioned CSS is served (stale-while-revalidate)', r.handled === true && !!r.value);
  r = await swFetchResult(getReq('https://goince.com/uploads/watch.jpg'));
  check('sw behaviour: product photo is served via the image cache path', r.handled === true && !!r.value);
  // Offline navigation falls back to the cached offline page.
  const swOffline = runServiceWorker(() => Promise.reject(new Error('offline')));
  {
    const ev = swEvent(null);
    swOffline.listeners.install[0](ev);
    await ev._p;
    const ev2 = swEvent({ method: 'GET', mode: 'navigate', url: 'https://goince.com/cart' });
    swOffline.listeners.fetch[0](ev2);
    // /cart is network-only: no respondWith even offline (browser error, not a stale cart).
    check('sw behaviour: offline /cart is NOT faked from cache (network-only holds offline too)', ev2._p === null);
    const ev3 = swEvent({ method: 'GET', mode: 'navigate', url: 'https://goince.com/product/3' });
    swOffline.listeners.fetch[0](ev3);
    const fallback = ev3._p ? await ev3._p : null;
    check('sw behaviour: offline product-page navigation falls back to /offline.html', !!fallback && fallback.url === '/offline.html');
  }

  // ---------- H2. Bottom nav — render + CSS ----------
  let footerHtml = '';
  try { footerHtml = await renderFile(footerPath, Object.assign({}, baseLocals, { cartCount: 2, userName: null, miniCart: [], miniCartSubtotal: 0 })); } catch (e) { check('render: footer renders (EJS)', false, String(e && e.message)); }
  if (footerHtml) {
    check('render: bottom nav exists (mobile-bottom-nav, labelled)', footerHtml.includes('class="mobile-bottom-nav"') && footerHtml.includes('aria-label="Quick navigation"'));
    check('render: bottom nav has Home / (existing route)', footerHtml.includes('href="/" class="mobile-nav-item"'));
    check('render: bottom nav Categories is a BUTTON (opens the drawer — no new URL)', footerHtml.includes('<button type="button" class="mobile-nav-item" id="mobile-nav-cats"'));
    check('render: bottom nav has Cart /cart with the live badge (count 2)', footerHtml.includes('href="/cart" class="mobile-nav-item"') && footerHtml.includes('mobile-nav-badge">2<'));
    check('render: bottom nav Account goes to /login when logged out', footerHtml.includes('href="/login" class="mobile-nav-item"'));
    check('render: bottom nav script shop-pwa.js is included (cache-busted in source, plain in render)', footerHtml.includes('/js/shop-pwa.js') && footerEjs.includes("assetUrl('/js/shop-pwa.js')"));
    check('render: bottom nav does NOT add any new route URL (only /, /cart, /login, /account/profile)', !/href="\/(categories|shop|menu|account\/dashboard|home)"/.test(footerHtml));
    check('render: setCartCount also updates the bottom-nav badge (same cartCount)', footerEjs.includes("document.querySelector('.mobile-nav-badge')") && footerEjs.includes("document.querySelector('.mobile-bottom-nav a[href=\"/cart\"]')"));
    check('render: WhatsApp float + side-cart tab still present (not moved/removed)', footerHtml.includes('id="whatsapp-btn"') && footerHtml.includes('class="side-cart"'));
  }
  let footerLoggedIn = '';
  try { footerLoggedIn = await renderFile(footerPath, Object.assign({}, baseLocals, { cartCount: 0, userName: 'Rohim', miniCart: [], miniCartSubtotal: 0 })); } catch (e) { check('render: footer renders logged in (EJS)', false, String(e && e.message)); }
  if (footerLoggedIn) {
    check('render: bottom nav Account goes to /account/profile when logged in', footerLoggedIn.includes('href="/account/profile" class="mobile-nav-item"'));
    // The inline footer script mentions .mobile-nav-badge (setCartCount),
    // so scope the check to the rendered <nav> block itself.
    const navStart = footerLoggedIn.indexOf('class="mobile-bottom-nav"');
    const navEnd = footerLoggedIn.indexOf('</nav>', navStart);
    const navHtml = navStart >= 0 && navEnd > navStart ? footerLoggedIn.slice(navStart, navEnd) : '';
    check('render: bottom nav Cart badge is absent when the cart is empty (count 0)', !!navHtml && !navHtml.includes('mobile-nav-badge'));
  }
  const navBase = ruleBody(cssTopLevel, /\.mobile-bottom-nav\s*\{[^}]*\}/);
  check('css: bottom nav is display:none at top level (desktop untouched)', !!navBase && /display:\s*none/.test(navBase));
  const navMobile = mobileBlocks.match(/\.mobile-bottom-nav\s*\{[^}]*\}/);
  check('css: bottom nav is flex + fixed + bottom:0 on mobile only', !!navMobile && /display:\s*flex/.test(navMobile) && /position:\s*fixed/.test(navMobile) && /bottom:\s*0/.test(navMobile));
  check('css: bottom nav is 60px tall + safe-area aware', !!navMobile && /height:\s*60px/.test(navMobile) && /safe-area-inset-bottom/.test(navMobile));
  check('css: bottom nav z-index is 500 (under side-cart 600, drawer 900, WhatsApp 999, mini-cart 1001)', !!navMobile && /z-index:\s*500/.test(navMobile));
  check('css: bottom nav items are 44px tap targets', mobileBlocks.includes('.mobile-nav-item') && /min-height:\s*44px/.test(mobileBlocks));
  check('css: footer gets bottom padding on mobile so it is not hidden behind the nav', /@media \(max-width: 768px\)[\s\S]*?\.site-footer\s*\{[^}]*padding-bottom:\s*calc\(76px/.test(cssNoComments));
  const stickyMobile = mobileBlocks.match(/\.sticky-buy-bar\s*\{[^}]*\}/);
  check('css: mobile sticky buy bar sits ABOVE the nav (bottom calc(60px + safe-area), not 0)', !!stickyMobile && /bottom:\s*calc\(60px \+ env\(safe-area-inset-bottom/.test(stickyMobile));
  const waMobile = mobileBlocks.match(/\.whatsapp-float\s*\{[^}]*\}/);
  check('css: mobile WhatsApp float sits above nav + raised bar (bottom 140px)', !!waMobile && /bottom:\s*140px/.test(waMobile));
  check('css: geometry — WhatsApp bottom (140px) clears nav (60px) + raised sticky bar (~64px)', !!waMobile && !!stickyMobile && (() => { const m = String(waMobile[0]).match(/bottom:\s*(\d+)px/); return !!m && Number(m[1]) > 60 + 64; })());

  // ---------- H3. Swipeable gallery — real code, stubbed DOM ----------
  function makeStubEl(tag, id) {
    const el = {
      tagName: (tag || 'DIV').toUpperCase(), id: id || '', _classes: new Set(), _attrs: {}, _listeners: {}, style: {}, disabled: false, src: '', hidden: false,
      classList: {
        add(c) { el._classes.add(c); }, remove(c) { el._classes.delete(c); },
        toggle(c, f) { if (f === undefined) { if (el._classes.has(c)) { el._classes.delete(c); return false; } el._classes.add(c); return true; } if (f) el._classes.add(c); else el._classes.delete(c); return !!f; },
        contains(c) { return el._classes.has(c); },
      },
      setAttribute(k, v) { el._attrs[k] = String(v); if (k === 'src') el.src = String(v); },
      getAttribute(k) { return el._attrs[k] === undefined ? null : el._attrs[k]; },
      addEventListener(type, fn) { (el._listeners[type] = el._listeners[type] || []).push(fn); },
      getBoundingClientRect() { return { left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300 }; },
    };
    return el;
  }
  function fire(el, type, event) { (el._listeners[type] || []).forEach((fn) => fn(Object.assign({ target: el, preventDefault() {} }, event || {}))); }
  function buildGalleryDom(videoHidden) {
    const stage = makeStubEl('div', 'gallery-stage');
    const img = makeStubEl('img', 'main-product-image');
    img.setAttribute('src', '/uploads/watch.jpg');
    const prev = makeStubEl('button', 'gallery-prev');
    const next = makeStubEl('button', 'gallery-next');
    const zoomIn = makeStubEl('button', 'gallery-zoom-in');
    const zoomOut = makeStubEl('button', 'gallery-zoom-out');
    const zoomReset = makeStubEl('button', 'gallery-zoom-reset');
    const video = makeStubEl('video', 'product-video');
    video.hidden = videoHidden !== false; // default: no video showing
    const thumbs = ['/uploads/watch.jpg', '/uploads/watch-2.jpg', '/uploads/watch-3.jpg'].map((src, i) => {
      const t = makeStubEl('img');
      t.setAttribute('data-full', src); t.setAttribute('src', src);
      if (i === 0) t.classList.add('active');
      return t;
    });
    const byId = { 'gallery-stage': stage, 'main-product-image': img, 'gallery-prev': prev, 'gallery-next': next, 'gallery-zoom-in': zoomIn, 'gallery-zoom-out': zoomOut, 'gallery-zoom-reset': zoomReset, 'product-video': video };
    const sandbox = {
      document: { getElementById(id) { return byId[id] || null; }, querySelectorAll(sel) { return sel === '.thumbnail' ? thumbs : []; } },
      window: { matchMedia: () => ({ matches: false, addEventListener() {} }), MutationObserver: function () { this.observe = function () {}; } },
      Date, console,
    };
    sandbox.window.window = sandbox.window;
    vm.createContext(sandbox);
    vm.runInContext(galleryJs, sandbox);
    return { stage, img, prev, next, zoomIn, zoomOut, zoomReset, video, thumbs, gallery: sandbox.window.GoinceGallery };
  }
  function swipe(g, x0, y0, x1, y1) {
    fire(g.stage, 'touchstart', { changedTouches: [{ clientX: x0, clientY: y0 }] });
    fire(g.stage, 'touchend', { changedTouches: [{ clientX: x1, clientY: y1 }] });
  }
  const g = buildGalleryDom(true);
  check('gallery: module exposes handleSwipeDelta + 40px threshold', !!g.gallery && typeof g.gallery.handleSwipeDelta === 'function' && g.gallery.getSwipeMinPx() === 40);
  check('gallery swipe: swipe LEFT steps to the next photo', g.gallery.handleSwipeDelta(-80, 0) === true && g.gallery.getIndex() === 1 && g.img.src === '/uploads/watch-2.jpg');
  check('gallery swipe: swipe RIGHT steps to the previous photo', g.gallery.handleSwipeDelta(80, 0) === true && g.gallery.getIndex() === 0);
  check('gallery swipe: short drag (20px) does NOT change the photo', g.gallery.handleSwipeDelta(-20, 0) === false && g.gallery.getIndex() === 0);
  check('gallery swipe: mostly-vertical drag does NOT change the photo (page scroll wins)', g.gallery.handleSwipeDelta(-30, 90) === false && g.gallery.getIndex() === 0);
  g.gallery.setZoom(2);
  check('gallery swipe: no swipe while zoomed (2x) — swipe pans the zoomed photo instead', g.gallery.handleSwipeDelta(-80, 0) === false && g.gallery.getIndex() === 0);
  g.gallery.setZoom(1);
  const gVideo = buildGalleryDom(false); // video slide showing
  check('gallery swipe: no swipe while the video slide is showing', gVideo.gallery.handleSwipeDelta(-80, 0) === false && gVideo.gallery.getIndex() === 0);
  const gTouch = buildGalleryDom(true);
  swipe(gTouch, 300, 150, 200, 150);
  check('gallery swipe: real touchstart/touchend LEFT swipe steps to photo 2', gTouch.gallery.getIndex() === 1 && gTouch.img.src === '/uploads/watch-2.jpg');
  swipe(gTouch, 200, 150, 300, 150);
  check('gallery swipe: real touchstart/touchend RIGHT swipe steps back to photo 1', gTouch.gallery.getIndex() === 0);
  swipe(gTouch, 300, 150, 220, 150);
  fire(gTouch.stage, 'click', { target: gTouch.img });
  check('gallery swipe: the click right after a swipe does NOT toggle the zoom (no accidental zoom)', gTouch.gallery.getZoom() === 1 && gTouch.gallery.getIndex() === 1);
  // Swipe-suppress window is 300ms — a tap AFTER it must zoom again.
  await new Promise((resolve) => setTimeout(resolve, 350));
  fire(gTouch.stage, 'click', { target: gTouch.img });
  check('gallery swipe: a later tap still toggles the zoom 1x -> 2x', gTouch.gallery.getZoom() === 2);
  fire(gTouch.next, 'click');
  check('gallery swipe: arrows still work after swipe support was added', gTouch.gallery.getIndex() === 2);
  check('gallery css: stage has touch-action: pan-y (horizontal swipe reaches JS, vertical scroll still works)', /\.gallery-stage\s*\{[^}]*touch-action:\s*pan-y/.test(cssTopLevel));
  check('gallery: arrows + zoom buttons + keyboard handlers still in the source (unchanged)', galleryJs.includes("getElementById('gallery-prev')") && galleryJs.includes("getElementById('gallery-zoom-in')") && galleryJs.includes("e.key === 'ArrowLeft'"));

  // ---------- H4. Offline cart — shop-pwa.js real code, stubbed DOM ----------
  function makeStore() {
    const m = new Map();
    return {
      getItem(k) { return m.has(k) ? m.get(k) : null; },
      setItem(k, v) { m.set(k, String(v)); },
      removeItem(k) { m.delete(k); },
      _map: m,
    };
  }
  function buildPwaDom(opts) {
    const o = opts || {};
    const store = makeStore();
    const drawer = makeStubEl('aside', 'mini-cart-drawer');
    drawer.innerHTML = o.drawerHtml || '';
    drawer.querySelectorAll = (sel) => (sel === '.mini-cart-item' && o.itemCount > 0 ? Array.from({ length: o.itemCount }, () => ({})) : []);
    drawer.querySelector = (sel) => (sel === '.offline-banner' ? (o.bannerPresent ? { parentNode: drawer } : null) : null);
    drawer.insertBefore = function (node, ref) { drawer._banner = node; };
    drawer.appendChild = function (node) { drawer._banner = node; };
    const notice = makeStubEl('div', 'offline-notice');
    notice.hidden = true;
    const menuBtn = makeStubEl('button', 'shop-menu-btn');
    let menuClicked = 0;
    menuBtn.click = function () { menuClicked++; };
    const catsBtn = makeStubEl('button', 'mobile-nav-cats');
    const byId = { 'mini-cart-drawer': drawer, 'offline-notice': notice, 'shop-menu-btn': menuBtn, 'mobile-nav-cats': catsBtn };
    const created = [];
    const winListeners = {};
    const windowStub = {
      localStorage: store,
      addEventListener(type, fn) { (winListeners[type] = winListeners[type] || []).push(fn); },
    };
    const docStub = {
      getElementById(id) { return byId[id] || null; },
      createElement(tag) { const el = makeStubEl(tag); created.push(el); return el; },
    };
    const navigatorStub = { onLine: o.online !== false };
    if (o.swSupported === false) delete navigatorStub.serviceWorker;
    else navigatorStub.serviceWorker = { register() { return Promise.resolve({}); } };
    const sandbox = {
      document: docStub, window: windowStub, navigator: navigatorStub,
      Date, Promise, console,
    };
    sandbox.window.window = sandbox.window;
    vm.createContext(sandbox);
    vm.runInContext(shopPwaJs, sandbox);
    return { store, drawer, notice, menuBtn, catsBtn, created, winListeners, windowStub, offlineCart: sandbox.window.GoinceOfflineCart, pwa: sandbox.window.GoincePWA, get menuClicked() { return menuClicked; } };
  }
  const pwa = buildPwaDom({ itemCount: 2, drawerHtml: '<ul><li class="mini-cart-item">BINBOND Watch</li><li class="mini-cart-item">Sewing Machine</li></ul><p>Subtotal ৳2,240</p>', online: true });
  check('offline cart: shop-pwa.js exposes GoinceOfflineCart (save/read/update/isOffline/KEY)', !!pwa.offlineCart && typeof pwa.offlineCart.saveSnapshot === 'function' && typeof pwa.offlineCart.readSnapshot === 'function');
  check('offline cart: first load saves a snapshot of the REAL drawer HTML (2 items)', pwa.offlineCart.saveSnapshot() === true && (() => { const s = pwa.offlineCart.readSnapshot(); return !!s && s.count === 2 && s.html.includes('BINBOND Watch') && s.html.includes('৳2,240') && !!s.savedAt; })());
  check('offline cart: snapshot key is versioned (goince-cart-snapshot-v1)', pwa.offlineCart.KEY === 'goince-cart-snapshot-v1' && pwa.store.getItem('goince-cart-snapshot-v1') !== null);
  const pwaEmpty = buildPwaDom({ itemCount: 0, drawerHtml: '<div class="mini-cart-empty">Your cart is empty.</div>', online: true });
  check('offline cart: empty cart does NOT invent items — snapshot is removed, read returns null', pwaEmpty.offlineCart.saveSnapshot() === false && pwaEmpty.offlineCart.readSnapshot() === null && pwaEmpty.store.getItem('goince-cart-snapshot-v1') === null);
  // Offline UI: build with onLine=false.
  const pwaOff = buildPwaDom({ itemCount: 2, drawerHtml: '<ul><li class="mini-cart-item">BINBOND Watch</li></ul>', online: false });
  check('offline cart: offline load SHOWS the cart-page notice (#offline-notice)', pwaOff.notice.hidden === false);
  check('offline cart: offline load inserts an offline banner into the drawer', !!pwaOff.drawer._banner && pwaOff.drawer._banner.className === 'offline-banner' && /last saved cart/.test(pwaOff.drawer._banner.textContent));
  check('offline cart: online load HIDES the cart-page notice', pwa.notice.hidden === true);
  // Categories button wires to the hamburger drawer.
  fire(pwa.catsBtn, 'click');
  check('offline cart: bottom-nav Categories click opens the existing shop drawer (#shop-menu-btn)', pwa.menuClicked === 1);
  // beforeinstallprompt.
  (pwa.winListeners.beforeinstallprompt || []).forEach((fn) => fn({ preventDefault() {} }));
  check('pwa: beforeinstallprompt is captured (canInstall true — browser Add to Home Screen prompt)', pwa.pwa.canInstall() === true);
  // No service worker support: script must still run + snapshot must still work.
  const pwaNoSw = buildPwaDom({ itemCount: 1, drawerHtml: '<ul><li class="mini-cart-item">BINBOND Watch</li></ul>', online: true, swSupported: false });
  check('pwa: no serviceWorker support — script still runs and the snapshot still saves (graceful degradation)', !!pwaNoSw.offlineCart && pwaNoSw.offlineCart.saveSnapshot() === true);
  check('pwa: shop-pwa.js is in the asset version list (cache-busting works)', assetsJs.includes("'js/shop-pwa.js'"));
  check('pwa: registration targets /sw.js with scope / (the same SW the push code uses — no second SW)', shopPwaJs.includes("navigator.serviceWorker.register('/sw.js'") && shopPwaJs.includes("scope: '/'"));
  check('pwa: SW registration failure is swallowed (site never breaks on SW errors)', shopPwaJs.includes('.catch(function ()') || shopPwaJs.includes('catch(function ()'));

  // ---------- H4b. Offline page + cart page ----------
  check('offline page: /offline.html exists with a clear offline heading', offlineHtml.includes('You') && offlineHtml.includes('offline'));
  check('offline page: reads the SAME snapshot key shop-pwa.js writes', offlineHtml.includes('goince-cart-snapshot-v1'));
  check('offline page: says the cart is the LAST SAVED state (nothing invented)', /LAST SAVED|last saved/i.test(offlineHtml) && /Notun kichu jog hoy ni|nothing new was added/i.test(offlineHtml));
  check('offline page: disables forms/buttons in the rendered snapshot (no offline checkout)', offlineHtml.includes('disabled = true') && offlineHtml.includes("addEventListener('submit'"));
  check('offline page: has Try again + homepage link', offlineHtml.includes('Try again') && offlineHtml.includes('href="/"'));
  check('offline page: no new server route needed (static file under public/)', !/offline\.html/.test(serverJs));
  let cartHtml = '';
  try { cartHtml = await renderFile(cartPath, Object.assign({}, baseLocals, { cart: [], estimatedDelivery: 'Tomorrow', relatedProducts: [], coupon: null, subtotal: 0, discount: 0, total: 0 })); } catch (e) { check('render: cart page renders (EJS)', false, String(e && e.message)); }
  if (cartHtml) {
    check('render: cart page has a hidden offline notice div (#offline-notice)', cartHtml.includes('id="offline-notice"') && cartHtml.includes('hidden') && cartHtml.includes('offline'));
    check('render: cart page still shows the empty state when the cart is empty (no regression)', cartHtml.includes('Your cart is empty'));
  }
  let cartFull = '';
  try {
    cartFull = await renderFile(cartPath, Object.assign({}, baseLocals, {
      cart: [{ cartKey: '3', id: 3, name: 'BINBOND Watch', image: 'watch.jpg', price: 990, quantity: 2, availableStock: 15, variantLabel: '' }],
      estimatedDelivery: 'Tomorrow', relatedProducts: [], coupon: null, subtotal: 1980, discount: 0, total: 1980,
    }));
  } catch (e) { check('render: cart page renders with items (EJS)', false, String(e && e.message)); }
  if (cartFull) {
    check('render: cart page with items still lists the real item + qty + total (no regression)', cartFull.includes('BINBOND Watch') && cartFull.includes('৳1,980'));
  }
  check('offline cart: footer saves the snapshot after AJAX add + drawer updates + bundle refresh', footerEjs.includes('saveOfflineSnapshot()') && (footerEjs.match(/saveOfflineSnapshot\(\)/g) || []).length >= 3);

  // ---------- Product page render (swipe target unchanged) ----------
  let phtml = '';
  try {
    phtml = await renderFile(productPath, Object.assign({}, baseLocals, {
      product: { id: 3, name: 'BINBOND 2521 Men\'s Luxury Quartz Watch', image: 'watch.jpg', price: 990, compare_at_price: 1250, stock: 15, target_audience: 'men', short_description: 'Luxury quartz watch', description: 'A fine watch.', delivery_time: '', allow_backorder: false },
      galleryImages: [{ image: 'watch-2.jpg' }, { image: 'watch-3.jpg' }],
      avgRating: 4.5, reviewCount: 2, discountPercent: 21, options: [], optionLabel: '', variants: [], variantAttributes: [], userName: null,
      deliveryCharge: 60, deliveryChargeOutside: 120, reviews: [], specs: [], descriptionHtml: '<p>A fine watch.</p>', related: [],
    }));
  } catch (e) { check('render: product page renders (EJS)', false, String(e && e.message)); }
  if (phtml) {
    check('render: product page still has the gallery stage + arrows + thumbnails (swipe target)', phtml.includes('id="gallery-stage"') && phtml.includes('id="gallery-prev"') && phtml.includes('class="thumbnail active"'));
    check('render: product page still has the sticky buy bar (moved up on mobile, not removed)', phtml.includes('id="sticky-buy-bar"'));
    check('render: product page still has Add to Cart (sticky bar did not lose its button)', phtml.includes('id="sticky-buy-btn"'));
  }

  // ---------- Admin untouched ----------
  check('admin: admin header/footer never load shop-pwa.js or the bottom nav', !adminHeaderEjs.includes('shop-pwa') && !adminFooterEjs.includes('shop-pwa') && !adminHeaderEjs.includes('mobile-bottom-nav') && !adminFooterEjs.includes('mobile-bottom-nav'));
  check('admin: admin pages do not link the shop manifest', !adminHeaderEjs.includes('manifest-shop.json'));
  check('admin: shop SW never caches admin (source rule re-checked above) + no admin file changed by this batch', !/mobile-pwa/.test(adminHeaderEjs) && !/mobile-pwa/.test(adminFooterEjs));

  // ---------- Summary ----------
  console.log(`\n${passes.length} passed, ${failures.length} failed.`);
  if (failures.length) {
    console.log('Failures:');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
})().catch((e) => {
  console.error('FATAL', e && e.stack || e);
  process.exit(1);
});
