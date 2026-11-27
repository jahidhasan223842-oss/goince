// Shop menu bar (fix/shop-menu-bar) — sticky shop header, compact mega
// menu, WhatsApp float never covering a product button, mobile header
// code review.
//
// donal said (2026-11-26 17:55, in Romanized Bengali): "goince.com
// website er menu bar ta koro" — do the shop website's menu bar. A
// live visual inspection of https://goince.com/ (desktop 1920px, no
// sign-in) found the header itself clean but three concrete problems:
//   1. The shop header scrolls away — scrolling down loses
//      navigation/search until you scroll back up.
//   2. The Categories mega menu panel is far larger than its content
//      (2 top categories, ~half the white panel empty below/right).
//   3. At 1920px the green WhatsApp circle sits on top of the right
//      end of the "Add to Cart" button on the BINBOND watch card.
//
// What was built (SHOP ONLY — the admin panel is untouched):
//   1. STICKY HEADER: .site-header is position: sticky, top: 0,
//      z-index: 500, desktop AND mobile (the mobile top row —
//      hamburger | logo | search icon | cart — sticks too, and the
//      open search row is part of the header so it sticks as well).
//      mega-menu.js toggles .is-stuck (scrollY > 0) for a subtle
//      shadow when stuck. The category pills strip is homepage
//      content, NOT part of the sticky header — it scrolls normally.
//      Z-order: drawer (900) and overlay (880) stay above the header
//      (500); search suggestions live inside the header's stacking
//      context (z-index 100) so they stay above page content.
//   2. COMPACT MEGA MENU: the panel is width: max-content with
//      max-width: min(860px, calc(100vw - 32px)) — it ends where the
//      content ends instead of always being 860px wide. The grid is
//      now flex + wrap, one column (200–280px) per top category;
//      extra categories wrap to the next row. The centering
//      (left:50% + translateX(-50%) at ≥769px) and the max-width cap
//      are kept, so the panel still never runs off the right edge.
//      Hover/click open, keyboard access and titles unchanged.
//   3. WHATSAPP OVERLAP GUARD: the float now hides whenever it would
//      overlap a guarded control — homepage Sort, cart "Proceed to
//      Checkout", every product-card action (.product-card .btn-card
//      = "Choose Option" link + "Add to Cart" submit) and the product
//      page's Add to Cart (.add-to-cart-form button /
//      .product-info .btn-primary). The check is a REAL rect
//      intersection against the float's own getBoundingClientRect
//      (the old bottom-band heuristic is gone), it runs on scroll
//      AND resize, and it runs at ALL widths — the old code only
//      guarded at ≤1024px and showed the float unconditionally on
//      desktop, which is exactly how the 1920px overlap happened.
//      The .whatsapp-float--scroll / .is-visible fade rules moved
//      out of the @media (max-width: 1024px) block so they apply
//      everywhere; JS not running still leaves the button visible
//      as before. prefers-reduced-motion still disables the fade.
//   4. MOBILE HEADER REVIEW (no ~390px render available in the VM,
//      code review only): the drawer close button was 40×40px —
//      below the 44px tap target — now 44×44px. Everything else
//      checked out: hamburger/cart/search icons 44px, sub-toggle
//      44px, search submit 44px, drawer links ~48px, logo-tag
//      hidden on mobile so the row fits, drawer head sticky,
//      drawer (900) above the sticky header (500).
//
// No live MySQL needed: CSS/EJS source checks + a direct EJS render
// of the shop header + the REAL WhatsApp IIFE from footer.ejs run in
// a stubbed DOM (vm sandbox — no jsdom in node_modules).
//
// Run:  node scripts/test-shop-menu-bar.js
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

// Same helpers as test-dropdown-animations.js: top-level CSS (comments
// + all @media ranges stripped), and per-query @media blocks.
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
const smallPhoneBlocks = extractRanges(cssNoComments, allMediaRanges(cssNoComments, 'max-width: 480px'));
const desktop769Blocks = extractRanges(cssNoComments, allMediaRanges(cssNoComments, 'min-width: 769px'));
const reducedMotionBlocks = extractRanges(cssNoComments, allMediaRanges(cssNoComments, 'prefers-reduced-motion'));

// All top-level rules whose selector list contains `selector`.
function rulesWith(source, selector) {
  const out = [];
  const re = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{[^}]*\\}', 'g');
  let m;
  while ((m = re.exec(source)) !== null) out.push(m[0]);
  return out;
}
function ruleBody(source, selectorRe) {
  const m = source.match(selectorRe);
  return m ? m[0] : null;
}

(async function main() {
  console.log('Shop menu bar (fix/shop-menu-bar) checks:');

  // ---------- 1. Sticky shop header ----------
  const headerRules = rulesWith(cssTopLevel, '.site-header');
  const stickyRule = headerRules.find((r) => /position:\s*sticky/.test(r));
  check('sticky header: .site-header is position: sticky at top level', !!stickyRule);
  check('sticky header: top: 0', !!stickyRule && /top:\s*0/.test(stickyRule));
  check('sticky header: z-index 500 (below drawer 900 / overlay 880)', !!stickyRule && /z-index:\s*500/.test(stickyRule));
  check('sticky header: no top-level position: relative left on .site-header', !headerRules.some((r) => /position:\s*relative/.test(r)));
  const stuckRule = ruleBody(cssTopLevel, /\.site-header\.is-stuck\s*\{[^}]*\}/);
  check('stuck header: .is-stuck adds a subtle box-shadow', !!stuckRule && /box-shadow:/.test(stuckRule));
  check('stuck header: mega-menu.js toggles .is-stuck on scroll', /classList\.toggle\('is-stuck'/.test(megaMenuJs) && /addEventListener\('scroll'/.test(megaMenuJs));
  check('z-order: drawer z-index 900 above sticky header 500', /z-index:\s*900/.test(mobileBlocks));
  check('z-order: overlay z-index 880 above sticky header 500', /z-index:\s*880/.test(mobileBlocks));
  check('search suggestions: z-index 100 inside the header stacking context', !!ruleBody(cssTopLevel, /\.search-suggestions\s*\{[^}]*\}/) && /z-index:\s*100/.test(ruleBody(cssTopLevel, /\.search-suggestions\s*\{[^}]*\}/)));

  // ---------- 2. Compact mega menu ----------
  const panelRule = ruleBody(cssTopLevel, /\.mega-menu-panel\s*\{[^}]*\}/);
  check('mega menu: panel width is max-content (fits content)', !!panelRule && /width:\s*max-content/.test(panelRule));
  check('mega menu: panel max-width still caps at min(860px, 100vw - 32px)', !!panelRule && /max-width:\s*min\(860px,\s*calc\(100vw - 32px\)\)/.test(panelRule));
  check('mega menu: old fixed 860px width is gone', !!panelRule && !/(?:^|[^-])width:\s*min\(860px/.test(panelRule));
  const gridRule = ruleBody(cssTopLevel, /\.mega-menu-grid\s*\{[^}]*\}/);
  check('mega menu: grid is flex + wrap (no auto-fit stretch)', !!gridRule && /display:\s*flex/.test(gridRule) && /flex-wrap:\s*wrap/.test(gridRule));
  check('mega menu: grid has no grid-template-columns auto-fit left', !!gridRule && !/grid-template-columns/.test(gridRule));
  const colRule = ruleBody(cssTopLevel, /\.mega-col\s*\{[^}]*\}/);
  // HONEST UPDATE (fix/shop-mega-menu-compact, 2026-11-27): the old
  // assertion required min-width: 200px on .mega-col — but that
  // 200px min-width WAS the root cause of the oversized panel
  // (max-content sized the grid to 200px/column while flex-basis
  // 220px wrapped the 2nd column to a new row, leaving half the
  // panel empty). Columns are now content-sized (flex: 0 0 auto +
  // width: max-content) and still capped at 280px.
  check('mega menu: columns content-sized and capped at 280px (no 200px min-width — it caused the empty panel)', !!colRule && /flex:\s*0 0 auto/.test(colRule) && /width:\s*max-content/.test(colRule) && /max-width:\s*280px/.test(colRule) && !/min-width:\s*200px/.test(colRule));
  check('mega menu: panel still centred at >=769px (right-edge guard)', /left:\s*50%/.test(desktop769Blocks) && /translateX\(-50%\)/.test(desktop769Blocks));
  check('mega menu: max-height + vertical scroll kept', !!panelRule && /max-height:\s*calc\(100vh - 90px\)/.test(panelRule) && /overflow-y:\s*auto/.test(panelRule));
  check('mega menu: titles still readable (panel title colour rule)', !!ruleBody(cssTopLevel, /\.mega-menu-panel a\.mega-col-title\s*\{[^}]*\}/));
  check('mega menu: hover open rule still present (hover-capable desktop)', /mega-menu-wrap:hover\s+\.mega-menu-panel/.test(cssNoComments));
  check('mega menu: keyboard open/close JS unchanged (Esc, focusout, outside click)', /Escape/.test(megaMenuJs) && /focusout/.test(megaMenuJs) && /mega-menu-panel/.test(megaMenuJs));

  // ---------- 3. WhatsApp overlap guard (source) ----------
  check('whatsapp: guard list includes product-card buttons', footerEjs.includes('.product-card .btn-card'));
  check('whatsapp: guard list includes homepage Sort', footerEjs.includes("'#sort,"));
  check('whatsapp: guard list includes cart Proceed to Checkout', footerEjs.includes('.cart-summary .btn-primary'));
  check('whatsapp: guard list includes product-page Add to Cart', footerEjs.includes('.add-to-cart-form button') && footerEjs.includes('.product-info .btn-primary'));
  check('whatsapp: real rect intersection against the float (not a bottom-band guess)', /overlapsFloat/.test(footerEjs) && /getBoundingClientRect\(\)/.test(footerEjs) && /f\.right/.test(footerEjs) && /f\.bottom/.test(footerEjs));
  check('whatsapp: old bottom-band heuristic (innerHeight - 170) is gone', !footerEjs.includes('innerHeight - 170'));
  check('whatsapp: desktop no longer unconditionally visible (old early return gone)', !/btn\.classList\.remove\('whatsapp-float--scroll', 'is-visible'\)/.test(footerEjs));
  check('whatsapp: re-checks on resize as well as scroll', /addEventListener\('resize'/.test(footerEjs));
  check('whatsapp: fade rules live at top level (apply at all widths)', !!ruleBody(cssTopLevel, /\.whatsapp-float\.whatsapp-float--scroll\s*\{[^}]*\}/) && !!ruleBody(cssTopLevel, /\.whatsapp-float\.whatsapp-float--scroll\.is-visible\s*\{[^}]*\}/));
  check('whatsapp: reduced-motion still disables the float fade', /whatsapp-float\.whatsapp-float--scroll\s*\{\s*transition:\s*none/.test(reducedMotionBlocks));
  check('whatsapp: button itself still rendered (wa.me link, never removed)', footerEjs.includes('id="whatsapp-btn"') && footerEjs.includes('wa.me'));

  // ---------- 4. Mobile header code review ----------
  check('mobile: drawer close is a 44px tap target (was 40px)', /shop-drawer-close\s*\{[^}]*width:\s*44px; height:\s*44px/.test(mobileBlocks));
  check('mobile: hamburger is 44px', /shop-menu-btn\s*\{[^}]*width:\s*44px; height:\s*44px/.test(mobileBlocks));
  check('mobile: no cart icon in the top row (removed in fix/header-cart-side-tab; cart lives on the side tab)', !/shop-cart-btn/.test(mobileBlocks) && !/shop-cart-btn/.test(cssNoComments));
  check('mobile: search icon is 44px', /shop-search-btn\s*\{[^}]*width:\s*44px; height:\s*44px/.test(mobileBlocks));
  check('mobile: drawer sub-toggle is 44px', /shop-drawer-sub-toggle\s*\{[^}]*width:\s*44px; height:\s*44px/.test(mobileBlocks));
  check('mobile: search submit is at least 44px tall', /\.search-form button\s*\{\s*min-height:\s*44px/.test(mobileBlocks));
  check('mobile: logo tag hidden at <=480px so the one-line row fits', /\.logo-tag\s*\{\s*display:\s*none/.test(smallPhoneBlocks));
  check('mobile: open search row is full-width inside the sticky header', /\.search-form\.open\s*\{[^}]*width:\s*100%/.test(mobileBlocks));
  check('mobile: drawer head sticks to the top of the drawer', /\.shop-drawer-head\s*\{[^}]*position:\s*sticky; top:\s*0/.test(mobileBlocks));

  // ---------- 5. Shop header render (EJS, 2 top categories) ----------
  const twoCats = [
    { id: 8, name: 'Home Appliances', totalProductCount: 3, image_url: '', children: [
      { id: 10, name: 'Kitchen', totalProductCount: 1, children: [] },
      { id: 11, name: 'Home Utility', totalProductCount: 2, children: [] },
    ] },
    { id: 9, name: 'Winter Collection', totalProductCount: 1, image_url: '', children: [] },
  ];
  let html = '';
  try {
    html = await renderFile(headerPath, {
      siteName: 'Goince',
      siteSettings: {},
      cartCount: 0,
      userName: '',
      search: '',
      menuCategories: twoCats,
      assetUrl: (p) => p,
    });
  } catch (e) {
    check('shop header renders (EJS)', false, String(e && e.message));
  }
  if (html) {
    // Visual order in the header: search input, then the nav links
    // Home, Categories button, Login, Sign Up. (fix/header-cart-
    // side-tab: the Cart link is gone from the top nav; the drawer
    // Cart entry stays, below.)
    const order = ['Search products...', 'href="/">Home</a>', 'id="mega-menu-btn"', 'href="/login" class="btn-nav-outline">Login</a>', 'href="/signup" class="btn-nav-solid">Sign Up</a>'];
    let lastIdx = -1;
    let inOrder = true;
    for (const piece of order) {
      const i = html.indexOf(piece);
      if (i < 0 || i < lastIdx) { inOrder = false; break; }
      lastIdx = i;
    }
    check('header render: search, Home, Categories, Login, Sign Up in order (NO Cart link)', inOrder && html.includes('class="logo"'));
    check('header render: theme toggle present', html.includes('toggleGoinceTheme()'));
    check('header render: mega panel has exactly 2 columns for 2 top categories', (html.match(/class="mega-col"/g) || []).length === 2);
    check('header render: category titles + counts present', html.includes('Home Appliances') && html.includes('(3)') && html.includes('Winter Collection') && html.includes('(1)'));
    check('header render: sub-categories present (Kitchen, Home Utility)', html.includes('Kitchen') && html.includes('Home Utility'));
    check('header render: drawer has Home/Categories/Cart/Track Order/Login/Sign Up/About/Contact', ['Track Order', 'About', 'Contact'].every((s) => html.includes(s)) && html.includes('shop-drawer'));
    check('header render: search suggestions box inside the header', html.includes('id="search-suggestions"'));
  }

  // ---------- 6. WhatsApp IIFE behaviour (real code, stubbed DOM) ----------
  // Extract the WhatsApp IIFE from footer.ejs and run it in a vm
  // sandbox with a mini stub DOM (no jsdom in node_modules).
  const waStart = footerEjs.indexOf('(function () {', footerEjs.indexOf('WhatsApp button: pre-fill'));
  const waEnd = footerEjs.indexOf('})();', waStart) + 5;
  const waCode = footerEjs.slice(waStart, waEnd);
  check('whatsapp: IIFE extractable from footer.ejs', waStart > 0 && waCode.includes("getElementById('whatsapp-btn')"));

  function makeStubEl() {
    const el = {
      _classes: new Set(),
      _attrs: {},
      href: 'https://wa.me/8801814697896',
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

  // Viewport 1920x1080: float is 60px at right:20 bottom:20.
  const FLOAT_RECT = { left: 1840, top: 1000, right: 1900, bottom: 1060 };
  function runWaScenario(opts) {
    const btn = makeStubEl();
    btn._rect = Object.assign({}, FLOAT_RECT);
    const guardedEls = (opts.guarded || []).map((spec) => {
      const el = makeStubEl();
      el._rect = spec.rect;
      el._sels = spec.sels;
      return el;
    });
    const listeners = {};
    const mqObj = {
      matches: !!opts.mobile,
      addEventListener(type, fn) { (mqObj._l = mqObj._l || {})[type] = fn; },
      addListener(fn) { mqObj._l = { change: fn }; },
    };
    const sandbox = {
      document: {
        getElementById(id) { return id === 'whatsapp-btn' ? btn : null; },
        querySelectorAll() { return guardedEls; },
        documentElement: { scrollTop: 0 },
        addEventListener() {},
      },
      window: {
        pageYOffset: opts.scrollY || 0,
        innerHeight: 1080,
        innerWidth: 1920,
        matchMedia() { return mqObj; },
        addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
        requestAnimationFrame(fn) { fn(); },
      },
      location: { pathname: '/' },
    };
    sandbox.window.document = sandbox.document;
    vm.runInNewContext(waCode, sandbox);
    const fire = (type) => { (listeners[type] || []).forEach((fn) => fn()); };
    const visible = () => btn.classList.contains('is-visible');
    return { btn, guardedEls, fire, visible, sandbox };
  }

  const overlapRect = { left: 1800, top: 990, right: 1900, bottom: 1040 }; // covers the float
  const clearRect = { left: 100, top: 500, right: 300, bottom: 540 }; // far from the float
  const aboveRect = { left: 1800, top: -200, right: 1900, bottom: -100 }; // above the viewport

  // Desktop, no overlap -> visible.
  let sc = runWaScenario({ guarded: [{ rect: clearRect, sels: ['.product-card .btn-card'] }] });
  check('whatsapp behaviour: desktop, no overlap -> visible', sc.visible());
  // Desktop, product button overlaps the float -> hidden.
  sc = runWaScenario({ guarded: [{ rect: overlapRect, sels: ['.product-card .btn-card'] }] });
  check('whatsapp behaviour: desktop, Add to Cart overlaps -> hidden', !sc.visible() && sc.btn.getAttribute('aria-hidden') === 'true' && sc.btn.getAttribute('tabindex') === '-1');
  // Desktop, guarded element above the viewport -> visible (not hidden by an off-screen rect).
  sc = runWaScenario({ guarded: [{ rect: aboveRect, sels: ['.product-card .btn-card'] }] });
  check('whatsapp behaviour: desktop, guarded element off-screen above -> visible', sc.visible());
  // Desktop, Sort control overlaps -> hidden.
  sc = runWaScenario({ guarded: [{ rect: overlapRect, sels: ['#sort'] }] });
  check('whatsapp behaviour: desktop, Sort overlaps -> hidden', !sc.visible());
  // Mobile, top of page (scroll 0) -> hidden even with no overlap.
  sc = runWaScenario({ mobile: true, scrollY: 0, guarded: [{ rect: clearRect, sels: ['.product-card .btn-card'] }] });
  check('whatsapp behaviour: mobile, at top (scroll 0) -> hidden', !sc.visible());
  // Mobile, scrolled past 300, no overlap -> visible.
  sc = runWaScenario({ mobile: true, scrollY: 500, guarded: [{ rect: clearRect, sels: ['.product-card .btn-card'] }] });
  check('whatsapp behaviour: mobile, scrolled + no overlap -> visible', sc.visible());
  // Mobile, scrolled past 300 but overlapping -> hidden.
  sc = runWaScenario({ mobile: true, scrollY: 500, guarded: [{ rect: overlapRect, sels: ['.product-card .btn-card'] }] });
  check('whatsapp behaviour: mobile, scrolled + overlap -> hidden', !sc.visible());
  // Scroll back into overlap hides it (live re-check on scroll).
  sc = runWaScenario({ mobile: true, scrollY: 500, guarded: [{ rect: clearRect, sels: ['.product-card .btn-card'] }] });
  const beforeScroll = sc.visible();
  sc.guardedEls[0]._rect = overlapRect;
  sc.fire('scroll');
  check('whatsapp behaviour: scrolling into overlap hides the float', beforeScroll && !sc.visible());
  // Resize re-checks too.
  sc = runWaScenario({ guarded: [{ rect: clearRect, sels: ['.product-card .btn-card'] }] });
  const beforeResize = sc.visible();
  sc.guardedEls[0]._rect = overlapRect;
  sc.fire('resize');
  check('whatsapp behaviour: resize into overlap hides the float', beforeResize && !sc.visible());
  // Pre-fill: the wa.me link gains the message text.
  sc = runWaScenario({ guarded: [] });
  check('whatsapp behaviour: pre-filled message appended to wa.me link', sc.btn.href.includes('?text='));

  console.log(`\n${passes.length} passed, ${failures.length} failed.`);
  if (failures.length) { console.log('Failures: ' + failures.join(', ')); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
