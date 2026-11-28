// Header Cart removed + floating side-cart tab fixed (fix/header-cart-side-tab).
//
// donal said (2026-11-27, in Romanized Bengali): visit the website,
// remove the cart option at the top, and fix the new cart option set
// on one side of the page — its photo/image is not understandable/
// visible.
//
// Live inspection (desktop 1919x998, logged-out visitor, 2026-11-27
// 15:30) confirmed both points:
//   1. HEADER: "Cart" — plain white text, no icon, no badge — sat
//      between "Categories" and "Login"; a second cart icon (🛒) sat
//      in the mobile top row (☰ | logo | 🔍 | 🛒).
//   2. SIDE-CART TAB: only the left portion showed — a half-pill /
//      D-shape with a rounded left edge and a flat cut-off right
//      edge flush with the viewport, ~65-70px wide, ~55-60px tall;
//      the icon inside was a pale blue/grey 🛒 emoji on gold, hard
//      to read. No count badge was visible (empty cart; badge only
//      shows when cart > 0). It overlapped the right edge of product
//      cards in the Best Sellers row while scrolling.
//
// What was built:
//   1. HEADER CART REMOVED: the desktop nav "Cart" link and the
//      mobile top-row cart icon are gone. The floating side-cart
//      tab is now the single cart entry point at the top. The
//      footer Quick Links Cart link and the mobile drawer Cart
//      entry were NOT removed (they are not "upre").
//   2. SIDE-CART ROOT CAUSE (found in code, public/css/style.css):
//      PR #74's design itself was a half-pill — right: 0 +
//      border-radius: 28px 0 0 28px, so the right side was flat
//      against the viewport edge and read as "cut off". PR #74's
//      claim "fully inside the viewport" was true in geometry
//      (56px wide at right: 0) but false in appearance. Fix: a
//      FULLY rounded pill (border-radius: 28px on all four
//      corners) sitting 12px inside the viewport (right: 12px).
//      Icon: the 🛒 emoji is gone — emoji glyphs ignore `color`,
//      so it rendered pale blue/grey on gold. Now a dark navy
//      inline SVG cart icon (fill: currentColor, from the tab's
//      color: var(--navy)), 26px, clear on gold in both themes.
//      The count badge (top: -6px, left: -6px) now sits fully
//      inside the viewport because the pill is 12px from the edge.
//   3. OVERLAP GUARD: the tab is fixed at top: 50% on the right
//      edge, and the rightmost product card's Add to Cart button
//      reaches to ~viewport - 40px — so the tab CAN cover a
//      button's right end while scrolling (live-confirmed). A new
//      IIFE in footer.ejs (same rect-intersection pattern as the
//      WhatsApp guard) hides the tab (.side-cart--hidden — fade +
//      pointer-events none) while it would cover a guarded button
//      (Sort, cart Proceed to Checkout, product-card buttons,
//      product-page Add to Cart) and shows it again when clear.
//      Checked on scroll/resize/load/fonts.ready/ResizeObserver/
//      pageshow, like the WhatsApp guard.
//   4. DEAD CSS CLEANUP: the header cart badge rules
//      (.main-nav .badge, .shop-cart-btn .badge + hover pop) and
//      every .shop-cart-btn rule are gone with the elements they
//      styled. The active-nav IIFE in mega-menu.js needed NO
//      change — it iterates .main-nav children and matches
//      href === pathname, so with no /cart link it simply marks
//      nothing active on /cart (asserted below).
//
// No live MySQL needed: CSS/EJS source checks + direct EJS renders
// of the shop header (logged-out + logged-in) + the REAL side-cart
// guard IIFE from footer.ejs run in a stubbed DOM (vm sandbox —
// no jsdom in node_modules).
//
// Run:  node scripts/test-header-cart-side-tab.js
// Exit code 0 = all checks passed.
'use strict';

const fs = require('fs');
const path = require('path');
const util = require('util');
const ejs = require('ejs');
const vm = require('vm');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'style.css'), 'utf8');
const headerEjs = fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', 'header.ejs'), 'utf8');
const footerEjs = fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', 'footer.ejs'), 'utf8');
const megaMenuJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'mega-menu.js'), 'utf8');
const renderFile = util.promisify(ejs.renderFile);
const headerPath = path.join(__dirname, '..', 'views', 'partials', 'header.ejs');

const failures = [];
const passes = [];
function check(name, ok, detail) {
  if (ok) { passes.push(name); console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

// Same helpers as test-floating-cart-wishlist.js: top-level CSS
// (comments + all @media ranges stripped), and per-query blocks.
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
const reducedMotionCss = extractRanges(cssNoComments, allMediaRanges(cssNoComments, 'prefers-reduced-motion'));
function ruleBody(topCss, selector) {
  const i = topCss.indexOf(selector);
  if (i < 0) return null;
  const open = topCss.indexOf('{', i);
  if (open < 0) return null;
  let d = 0;
  for (let j = open; j < topCss.length; j++) {
    if (topCss[j] === '{') d++;
    if (topCss[j] === '}') { d--; if (d === 0) return topCss.slice(open + 1, j); }
  }
  return null;
}

function navBlock(html) {
  const a = html.indexOf('<nav class="main-nav">');
  const b = a < 0 ? -1 : html.indexOf('</nav>', a);
  return a < 0 || b < 0 ? '' : html.slice(a, b);
}
function mobileTopRow(html) {
  const a = html.indexOf('<header class="site-header">');
  const b = a < 0 ? -1 : html.indexOf('<form action="/" method="GET" class="search-form"', a);
  return a < 0 || b < 0 ? '' : html.slice(a, b);
}

(async () => {
  console.log('Header Cart removed + side-cart tab fixed (fix/header-cart-side-tab) checks:');

  // ---------- 1. Header Cart removal (source) ----------
  check('header source: no mobile cart icon (.shop-cart-btn) anywhere', !headerEjs.includes('shop-cart-btn'));
  check('header source: no desktop Cart link (href="/cart">Cart)', !headerEjs.includes('href="/cart">Cart'));
  check('header source: drawer Cart entry still exists (not removed)', headerEjs.includes('href="/cart" class="shop-drawer-link"'));
  check('footer source: Quick Links Cart link still exists (not removed)', footerEjs.includes('<p><a href="/cart">Cart</a></p>'));
  check('css: no .shop-cart-btn rule remains (dead CSS removed)', !cssNoComments.includes('shop-cart-btn'));
  check('css: no .main-nav .badge rule remains (dead CSS removed)', !/\.main-nav\s+\.badge/.test(cssTopLevel));

  // ---------- 2. Header renders (EJS, logged-out + logged-in) ----------
  const twoCats = [
    { id: 8, name: 'Home Appliances', totalProductCount: 3, image_url: '', children: [
      { id: 10, name: 'Kitchen', totalProductCount: 1, children: [] },
      { id: 11, name: 'Home Utility', totalProductCount: 2, children: [] },
    ] },
    { id: 9, name: 'Winter Collection', totalProductCount: 1, image_url: '', children: [] },
  ];
  let outHtml = '';
  let inHtml = '';
  try {
    outHtml = await renderFile(headerPath, {
      siteName: 'Goince', siteSettings: {}, cartCount: 2, userName: '',
      search: '', menuCategories: twoCats, assetUrl: (p) => p,
    });
  } catch (e) { check('header renders logged-out (EJS)', false, String(e && e.message)); }
  try {
    inHtml = await renderFile(headerPath, {
      siteName: 'Goince', siteSettings: {}, cartCount: 3, userName: 'Rohim',
      userPhotoUrl: null, search: '', menuCategories: twoCats, assetUrl: (p) => p,
    });
  } catch (e) { check('header renders logged-in (EJS)', false, String(e && e.message)); }

  if (outHtml) {
    check('header render logged-out: desktop nav has NO Cart link', !navBlock(outHtml).includes('/cart'));
    check('header render logged-out: mobile top row has NO cart icon', !mobileTopRow(outHtml).includes('/cart'));
    check('header render logged-out: nav still has Home, Categories, My Account (fix/my-account-button — was "Login / Sign Up")', navBlock(outHtml).includes('href="/">Home</a>') && outHtml.includes('id="mega-menu-btn"') && navBlock(outHtml).includes('>My Account</a>'));
    check('header render logged-out: drawer Cart entry still present', outHtml.includes('href="/cart" class="shop-drawer-link"'));
    check('header render logged-out: no cart badge in the top bar (badge lives on the side tab + drawer)', !navBlock(outHtml).includes('badge') && !mobileTopRow(outHtml).includes('badge'));
  }
  if (inHtml) {
    check('header render logged-in: desktop nav has NO Cart link', !navBlock(inHtml).includes('/cart'));
    // (fix/header-account-menu): Wishlist + Logout no longer sit as
    // separate text links in the nav — they live inside the profile
    // dropdown, reached from the profile pill; the pill shows the
    // avatar + name, and the menu carries the account header.
    check('header render logged-in: profile pill (avatar/name) + Wishlist and Logout inside the dropdown menu',
      navBlock(inHtml).includes('id="shop-profile-btn"') && navBlock(inHtml).includes('Rohim')
      && navBlock(inHtml).includes('id="shop-profile-menu"')
      && navBlock(inHtml).includes('href="/wishlist" class="shop-profile-link"')
      && navBlock(inHtml).includes('href="/logout" class="shop-profile-link"')
      && !/<a href="\/wishlist">Wishlist<\/a>/.test(navBlock(inHtml))
      && !/<a href="\/logout">Logout<\/a>/.test(navBlock(inHtml)));
    check('header render logged-in: drawer Cart entry still present', inHtml.includes('href="/cart" class="shop-drawer-link"'));
  }

  // ---------- 3. Active-nav IIFE needs no change ----------
  const marker = '// Active nav link (fix/shop-header-hover)';
  const actStart = megaMenuJs.indexOf(marker);
  const actEnd = actStart > 0 ? megaMenuJs.indexOf('})();', actStart) + 5 : -1;
  const actCode = actStart > 0 ? megaMenuJs.slice(actStart, actEnd) : '';
  check('active IIFE: extractable from mega-menu.js', actStart > 0 && actCode.includes("classList.add('active')"));
  check('active IIFE: does not reference a Cart element (generic href match only)', actStart > 0 && !/cart/i.test(actCode));

  // ---------- 4. Side-cart CSS: full pill, fully visible ----------
  const sideCart = ruleBody(cssTopLevel, '.side-cart');
  check('css: .side-cart rule exists', !!sideCart);
  if (sideCart) {
    check('css: side-cart is fixed, top: 50%, right: 12px (inset from the edge)', /position:\s*fixed/.test(sideCart) && /top:\s*50%/.test(sideCart) && /right:\s*12px/.test(sideCart), sideCart.slice(0, 140));
    check('css: side-cart is a FULLY rounded pill (border-radius: 28px on all corners)', /border-radius:\s*28px;/.test(sideCart) && !/28px 0 0 28px/.test(sideCart));
    check('css: side-cart is NOT bottom-right (no bottom: rule)', !/bottom:/.test(sideCart));
    check('css: side-cart is 56px (proper tap target)', /width:\s*56px/.test(sideCart) && /height:\s*56px/.test(sideCart));
    check('css: side-cart is gold with a navy icon colour (var(--accent) / var(--navy))', /background:\s*var\(--accent\)/.test(sideCart) && /color:\s*var\(--navy\)/.test(sideCart));
    check('css: side-cart has no negative offset pushing it off-screen', !/right:\s*-/.test(sideCart) && !/transform:\s*translateX\(\d/.test(sideCart));
    check('css: side-cart hover slides it out from the edge (.25s spring)', /\.side-cart:hover\s*\{[^}]*translateX\(-4px\)/.test(cssTopLevel) && /cubic-bezier\(\.22,\s*1\.25,\s*\.36,\s*1\)/.test(sideCart));
    check('css: side-cart has a :focus-visible outline', /\.side-cart:focus-visible/.test(cssTopLevel));
    check('css: side-cart fades its hidden state (opacity + visibility in the transition)', /opacity\s*\.25s/.test(sideCart) && /visibility\s*\.25s/.test(sideCart));
  }
  const sideSvg = ruleBody(cssTopLevel, '.side-cart svg');
  check('css: .side-cart svg rule exists (26px, dark navy via currentColor)', !!sideSvg && /width:\s*26px/.test(sideSvg) && /height:\s*26px/.test(sideSvg) && /fill:\s*currentColor/.test(sideSvg));
  const hidden = ruleBody(cssTopLevel, '.side-cart--hidden');
  check('css: .side-cart--hidden rule exists (opacity 0, visibility hidden, pointer-events none)', !!hidden && /opacity:\s*0/.test(hidden) && /visibility:\s*hidden/.test(hidden) && /pointer-events:\s*none/.test(hidden));
  const badge = ruleBody(cssTopLevel, '.side-cart-badge');
  check('css: .side-cart-badge is positioned inside the pill (top/left -6px, pill is 12px from the edge)', !!badge && /top:\s*-6px/.test(badge) && /left:\s*-6px/.test(badge));
  check('css: no mobile media rule repositions the side-cart (same geometry on phones)', !mobileBlocks.includes('.side-cart'));
  check('css: reduced-motion disables the side-cart transition', /\.side-cart\s*\{\s*transition:\s*none/.test(reducedMotionCss));

  // ---------- 5. Side-cart markup (footer) ----------
  check('footer: side-cart link to /cart exists', /<a href="\/cart" class="side-cart"/.test(footerEjs));
  check('footer: side-cart icon is an inline SVG (not the 🛒 emoji)', /<a href="\/cart" class="side-cart"[^>]*><svg viewBox="0 0 24 24"[^>]*><path d="M7 18c-1\.1/.test(footerEjs) && !/<a href="\/cart" class="side-cart"[^<]*<span aria-hidden="true">🛒/.test(footerEjs));
  check('footer: side-cart SVG is navy via currentColor (fill comes from the tab colour)', footerEjs.includes('<svg viewBox="0 0 24 24"') && /\.side-cart svg\s*\{[^}]*fill:\s*currentColor/.test(cssTopLevel));
  check('footer: side-cart badge still uses the same cartCount, shown only when > 0', /side-cart-badge"><%= cartCount/.test(footerEjs) && /typeof cartCount !== 'undefined' && cartCount > 0/.test(footerEjs));
  check('footer: side-cart is NOT in the admin footer (shop only)', !fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', 'admin-footer.ejs'), 'utf8').includes('side-cart'));

  // ---------- 6. Side-cart overlap guard (real code, stubbed DOM) ----------
  const gStart = footerEjs.indexOf('(function () {', footerEjs.indexOf('Side-cart tab overlap guard'));
  const gEnd = gStart > 0 ? footerEjs.indexOf('})();', gStart) + 5 : -1;
  const gCode = gStart > 0 ? footerEjs.slice(gStart, gEnd) : '';
  check('guard: IIFE extractable from footer.ejs', gStart > 0 && gCode.includes("querySelector('.side-cart')"));
  check('guard: watches product-card buttons, product-page Add to Cart, Sort, cart checkout', gCode.includes('.product-card .btn-card') && gCode.includes('.add-to-cart-form button') && gCode.includes("'#sort,") && gCode.includes('.cart-summary .btn-primary'));
  check('guard: uses real rect intersection (not a bottom-band guess)', /overlapsTab/.test(gCode) && /getBoundingClientRect\(\)/.test(gCode) && /t\.right/.test(gCode) && /t\.bottom/.test(gCode));
  check('guard: hides with .side-cart--hidden + aria-hidden + tabindex -1', gCode.includes("side-cart--hidden") && gCode.includes("aria-hidden") && gCode.includes("tabindex"));
  check('guard: re-checks on scroll/resize/load/pageshow/fonts.ready/ResizeObserver', /addEventListener\('scroll'/.test(gCode) && /addEventListener\('resize'/.test(gCode) && /addEventListener\('load'/.test(gCode) && /addEventListener\('pageshow'/.test(gCode) && /document\.fonts/.test(gCode) && /ResizeObserver/.test(gCode));

  function makeStubEl() {
    const el = {
      _classes: new Set(),
      _attrs: {},
      _rect: { left: 0, top: 0, right: 0, bottom: 0 },
      classList: {
        add(c) { el._classes.add(c); },
        remove(c) { el._classes.delete(c); },
        toggle(c, f) { if (f === undefined) { if (el._classes.has(c)) { el._classes.delete(c); return false; } el._classes.add(c); return true; } if (f) el._classes.add(c); else el._classes.delete(c); return !!f; },
        contains(c) { return el._classes.has(c); },
      },
      setAttribute(k, v) { el._attrs[k] = String(v); },
      getAttribute(k) { return el._attrs[k] === undefined ? null : el._attrs[k]; },
      removeAttribute(k) { delete el._attrs[k]; },
      addEventListener() {},
      getBoundingClientRect() { return el._rect; },
    };
    return el;
  }

  // Viewport 1920x1080: tab is 56px at right: 12px, vertically centred.
  const TAB_RECT = { left: 1852, top: 512, right: 1908, bottom: 568 };
  function runGuardScenario(opts) {
    const tab = makeStubEl();
    tab._rect = Object.assign({}, TAB_RECT);
    const guardedEls = (opts.guarded || []).map((spec) => {
      const el = makeStubEl();
      el._rect = spec.rect;
      return el;
    });
    const listeners = {};
    const sandbox = {
      document: {
        querySelector(sel) { return sel === '.side-cart' ? tab : null; },
        querySelectorAll() { return guardedEls; },
        documentElement: { scrollTop: 0 },
        addEventListener() {},
      },
      window: {
        pageYOffset: 0,
        innerHeight: 1080,
        innerWidth: 1920,
        addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
        requestAnimationFrame(fn) { fn(); },
      },
    };
    sandbox.window.document = sandbox.document;
    vm.runInNewContext(gCode, sandbox);
    const fire = (type) => { (listeners[type] || []).forEach((fn) => fn()); };
    const hiddenNow = () => tab.classList.contains('side-cart--hidden');
    return { tab, guardedEls, fire, hiddenNow };
  }

  const overlapRect = { left: 1800, top: 500, right: 1900, bottom: 560 }; // product button under the tab
  const clearRect = { left: 100, top: 500, right: 300, bottom: 540 }; // far from the tab
  const aboveRect = { left: 1800, top: -200, right: 1900, bottom: -100 }; // above the viewport

  let sc = runGuardScenario({ guarded: [{ rect: clearRect }] });
  check('guard behaviour: no overlap -> tab visible', !sc.hiddenNow() && sc.tab.getAttribute('aria-hidden') === 'false' && sc.tab.getAttribute('tabindex') === null);
  sc = runGuardScenario({ guarded: [{ rect: overlapRect }] });
  check('guard behaviour: Add to Cart overlaps the tab -> tab hidden', sc.hiddenNow() && sc.tab.getAttribute('aria-hidden') === 'true' && sc.tab.getAttribute('tabindex') === '-1');
  sc = runGuardScenario({ guarded: [{ rect: aboveRect }] });
  check('guard behaviour: guarded element off-screen above -> tab visible', !sc.hiddenNow());
  sc = runGuardScenario({ guarded: [{ rect: overlapRect }] });
  check('guard behaviour: Sort overlaps the tab -> tab hidden', sc.hiddenNow());
  // Overlap ends (button scrolls away) -> tab comes back on scroll.
  sc = runGuardScenario({ guarded: [{ rect: overlapRect }] });
  check('guard behaviour: starts hidden while overlapping', sc.hiddenNow());
  sc.guardedEls[0]._rect = clearRect;
  sc.fire('scroll');
  check('guard behaviour: overlap gone after scroll -> tab visible again', !sc.hiddenNow() && sc.tab.getAttribute('aria-hidden') === 'false');

  console.log(`\n${passes.length} passed, ${failures.length} failed.`);
  if (failures.length) { console.log('Failures: ' + failures.join(', ')); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
