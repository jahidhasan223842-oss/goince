// Mini-cart drawer + hover polish (fix/mini-cart-drawer-hover).
//
// donal said (2026-11-27, in Romanized Bengali): when the cursor
// comes over Login and Sign Up, from both sides it will hover in 2
// colours; and on Add to Cart too another colour hover will happen,
// with transition, and it will float up a bit; and on the website if
// you don't click, then in the floating state it will stay 6 seconds,
// and when you click, then the cart option will be visible; and when
// you click the cart option it should not go to another page, it
// should open from the same page; and after that, if there are any
// advance features, add them. Then he added: the WhatsApp button
// should also transition and hover up a bit.
//
// What was built (interpretations stated so donal can correct them):
//   1. MY ACCOUNT — TWO COLOURS FROM BOTH SIDES: the single
//      solid gold header button gets a hover where a deep purple
//      fill (#7c3aed) slides in from the LEFT and a magenta fill
//      (#db2777) slides in from the RIGHT, each covering half the
//      button and meeting in the middle, white text staying on top.
//      ::before (left half, purple) + ::after (right half,
//      magenta), .5s spring (SLOW — donal: the colours must
//      come in slowly so the two-sided sweep is clearly visible),
//      sliding back out on mouse-out. Base button stays gold. :focus-visible matches hover. Only the
//      header button — not the login page's own buttons.
//      (fix/my-account-button, 2026-11-28: donal chose the "My
//      Account" label and said the page's colours must NOT appear
//      here at hover time — a different colour — and the new colours
//      must NOT match/blend with any other colour on the page. The
//      PR #77 pair (navy left + dark gold right) WAS the page's
//      colours, so it was replaced. The first replacement pair was
//      purple + TEAL, but teal is too close to the page's greens
//      (Add to Cart hover #1f7a30, WhatsApp green, mint foot), so
//      donal's "must not match" instruction replaced teal with
//      MAGENTA, which is distinct from every colour on the page:
//      navy, gold/amber/orange, green/mint, red badge, blue pills
//      band. Both pass WCAG AA vs white text, computed in the
//      tests below — purple ~5.70:1, magenta ~4.60:1.)
//   2. ADD TO CART — ANOTHER COLOUR + TRANSITION + LIFT: hover
//      colour is now GREEN — var(--success) #1f7a30, #176327 on
//      press — the exact green pair already used by .btn-call
//      (green = the "add" action colour, distinct from the gold of
//      the login button and the card's gold ring). The button itself
//      lifts translateY(-2px) on :hover, with transform already in
//      the .25s base-rule transition (PR #72 lesson). "Choose
//      Option →" shares .btn-card, so it gets the same treatment.
//      Card hover itself (ring + lift + mint foot) is UNCHANGED.
//      :focus-visible matches hover (green); :active is the darker
//      green #176327.
//   3. SIDE-CART TAB — 6-SECOND FLOATING STATE + SAME-PAGE DRAWER:
//      on load the tab is fully visible and a 6s timer starts; if
//      the user neither hovers nor clicks it within 6s it slides
//      mostly off-screen, leaving only a ~14px gold sliver at the
//      right edge. Hovering/clicking the sliver slides the full pill
//      back and RESTARTS the 6s timer. Clicking the full tab opens
//      the mini-cart drawer on the SAME page (preventDefault — the
//      tab stays <a href="/cart">, so without JS it still navigates
//      to /cart) and cancels the timer; while the drawer is open the
//      tab stays fully visible; when the drawer closes the tab is
//      visible again and the 6s timer restarts. The PR #75 overlap
//      guard still applies and takes precedence. Timer + sliver live
//      in the SAME footer IIFE as the guard — no third floating
//      system. prefers-reduced-motion: state changes are instant
//      but the 6s hide still happens. Mobile: same behaviour.
//      DRAWER (server-rendered from the session cart — no new query,
//      no new route, no JSON API): header with "Your Cart" + count
//      + close (×); items with photo/name/variant/quantity stepper/
//      line total/remove; subtotal; delivery note (৳60 inside Dhaka
//      / ৳120 outside Dhaka — the site's real charges — "calculated
//      at checkout"); View Cart (→ /cart) + Checkout (→ /checkout);
//      empty state with Start Shopping. Closes via ×, Esc, overlay
//      click, or "Continue shopping". Focus moves into the drawer on
//      open and returns to the tab on close; body scroll is locked
//      while open; overlay (z 1000) + drawer (z 1001) sit above the
//      header (500), side-cart (600) and WhatsApp float (999).
//      Advanced features included: steppers + per-item remove,
//      subtotal, delivery note, View Cart + Checkout, Esc/overlay
//      close, focus return, scroll lock. HONEST LIMIT (same as the
//      cart page today): the steppers + remove reuse the EXISTING
//      cart POST routes (/cart/update/:cartKey, /cart/remove/:cartKey),
//      which redirect to /cart — so a quantity change does a full
//      page reload to /cart and the drawer re-opens only via the tab
//      after reload. No recommendations row in the drawer — a footer
//      query on every page load would be wasteful.
//   4. WHATSAPP — TRANSITION + HOVER LIFT: transform/box-shadow
//      transition (.25s ease, on the base rule) and on hover it
//      lifts translateY(-4px) with a slightly deeper shadow, gated
//      behind @media (hover: hover); prefers-reduced-motion disables
//      it. Its scroll-aware hiding (PR #42) and overlap guard
//      (PR #65/#68) are untouched — only the hover lift was added.
//
// No live MySQL needed: CSS/EJS source checks + direct EJS renders
// of the footer (with items + empty + no cart locals at all) + the
// REAL drawer + timer IIFE from footer.ejs run in a stubbed DOM
// (vm sandbox — no jsdom in node_modules) with fake timers.
//
// Run:  node scripts/test-mini-cart-drawer.js
// Exit code 0 = all checks passed.
'use strict';

const fs = require('fs');
const path = require('path');
const util = require('util');
const ejs = require('ejs');
const vm = require('vm');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'style.css'), 'utf8');
const footerEjs = fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', 'footer.ejs'), 'utf8');
const serverJs = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const shopRoutes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'shop.js'), 'utf8');
const renderFile = util.promisify(ejs.renderFile);
const footerPath = path.join(__dirname, '..', 'views', 'partials', 'footer.ejs');

const failures = [];
const passes = [];
function check(name, ok, detail) {
  if (ok) { passes.push(name); console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

// Same helpers as test-header-cart-side-tab.js: top-level CSS
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
const hoverBlocks = extractRanges(cssNoComments, allMediaRanges(cssNoComments, 'hover: hover'));
const reducedMotionCss = extractRanges(cssNoComments, allMediaRanges(cssNoComments, 'prefers-reduced-motion'));
function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function ruleBody(topCss, selector) {
  // Accepts either a plain selector string (matched as a whole rule)
  // or a RegExp (used as-is, like test-card-hover-transition.js).
  // A plain string must match "selector {" — so ".mini-cart-drawer"
  // skips the earlier ".mini-cart-drawer[hidden], ..." rule.
  const re = selector instanceof RegExp ? selector : new RegExp(escapeRegExp(selector) + '\\s*\\{[^}]*\\}');
  const m = topCss.match(re);
  return m ? m[0] : null;
}

const SPRING = 'cubic-bezier\\(\\.22, 1\\.25, \\.36, 1\\)';

// WCAG contrast ratio between two #rrggbb colours (sRGB, relative
// luminance). Used to prove the hover colours keep white text
// readable (AA needs >= 4.5:1 for normal text).
function contrastRatio(hexA, hexB) {
  const lum = (hex) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const l1 = lum(hexA); const l2 = lum(hexB);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

(async () => {
  console.log('Mini-cart drawer + hover polish (fix/mini-cart-drawer-hover) checks:');

  // ---------- 1. My Account — two colours from both sides ----------
  const loginBase = ruleBody(cssTopLevel, '.main-nav .btn-nav-solid');
  check('login: header button is positioned + clipped + isolated (pseudos sit above the gold, below the text)', !!loginBase && /position:\s*relative/.test(loginBase) && /overflow:\s*hidden/.test(loginBase) && /isolation:\s*isolate/.test(loginBase));
  check('login: ::before is the LEFT half, deep purple #7c3aed, slid out to the left (fix/my-account-button — NOT navy any more)', /\.main-nav \.btn-nav-solid::before \{[^}]*left:\s*0[^}]*background:\s*#7c3aed[^}]*transform:\s*translateX\(-102%\)/.test(cssTopLevel));
  check('login: ::after is the RIGHT half, magenta #db2777, slid out to the right (fix/my-account-button — teal was too close to the page greens, so magenta)', /\.main-nav \.btn-nav-solid::after \{[^}]*right:\s*0[^}]*background:\s*#db2777[^}]*transform:\s*translateX\(102%\)/.test(cssTopLevel));
  check('login: the hover pair uses NEITHER of the page colours — no navy, no gold #966e00 / mega-hover-gold, no green #1f7a30 / success, no teal #0f766e (dropped: too close to the page greens)', (() => {
    const before = (cssTopLevel.match(/\.main-nav \.btn-nav-solid::before \{[^}]*\}/) || [''])[0];
    const after = (cssTopLevel.match(/\.main-nav \.btn-nav-solid::after \{[^}]*\}/) || [''])[0];
    const pair = before + after;
    return !/var\(--navy\)/.test(pair) && !/var\(--mega-hover-gold\)/.test(pair) && !/#966e00/.test(pair)
      && !/var\(--success\)/.test(pair) && !/#1f7a30/.test(pair) && !/var\(--accent\)/.test(pair) && !/#0f766e/.test(pair);
  })());
  check('login: BOTH hover colours pass WCAG AA vs white text (contrast >= 4.5:1, computed)', contrastRatio('#7c3aed', '#ffffff') >= 4.5 && contrastRatio('#db2777', '#ffffff') >= 4.5, `purple ${contrastRatio('#7c3aed', '#ffffff').toFixed(2)}:1, magenta ${contrastRatio('#db2777', '#ffffff').toFixed(2)}:1`);
  check('login: each pseudo covers exactly half the button (width: 50%)', (cssTopLevel.match(/\.main-nav \.btn-nav-solid::(?:before|after) \{[^}]*width:\s*50%/) || []).length >= 1 && /\.main-nav \.btn-nav-solid::before,[\s\S]*?width:\s*50%/.test(cssTopLevel));
  check('login: pseudos slide with a SLOW .5s spring transition (fix/my-account-button: donal wants the colours to come in slowly so the sweep is clearly visible; declared on the pseudos, not only on :hover, so in AND out are both .5s)', new RegExp(`\\.main-nav \\.btn-nav-solid::before,[\\s\\S]*?transition:\\s*transform \\.5s ${SPRING}`).test(cssTopLevel));
  check('login: pseudos sit behind the text (z-index: -1)', /\.main-nav \.btn-nav-solid::before,[\s\S]*?z-index:\s*-1/.test(cssTopLevel));
  check('login: hover slides BOTH halves in (translateX(0)) inside @media (hover: hover)', /\.main-nav \.btn-nav-solid:hover::before,[\s\S]*?\.main-nav \.btn-nav-solid:hover::after \{[^}]*transform:\s*translateX\(0\)/.test(hoverBlocks));
  check('login: hover keeps the gold base (NOT accent-hover) and turns the text white', /\.main-nav \.btn-nav-solid:hover \{[^}]*background:\s*var\(--accent\);[^}]*color:\s*#fff !important/.test(hoverBlocks));
  check('login: :focus-visible shows the same two-colour treatment as hover (keyboard)', /\.main-nav \.btn-nav-solid:focus-visible::before,[\s\S]*?\.main-nav \.btn-nav-solid:focus-visible::after \{[^}]*transform:\s*translateX\(0\)/.test(cssTopLevel) && /\.main-nav \.btn-nav-solid:focus-visible \{[^}]*color:\s*#fff !important/.test(cssTopLevel));
  const navSolidBase = ruleBody(cssTopLevel, '.btn-nav-solid');
  check('login: base button is still solid gold (var(--accent)) with navy text', !!navSolidBase && /background:\s*var\(--accent\)/.test(navSolidBase) && /color:\s*var\(--navy\)/.test(navSolidBase));
  check('login: two-colour hover is header-only (no rule touches the login page buttons)', !/\.login.*btn-nav-solid|btn-nav-solid.*\.login/.test(cssNoComments) && !cssTopLevel.includes('.auth-form .btn-nav-solid'));
  check('login: reduced-motion disables the pseudo transition', /\.main-nav \.btn-nav-solid::before, \.main-nav \.btn-nav-solid::after \{[^}]*transition:\s*none/.test(reducedMotionCss));

  // ---------- 2. Add to Cart — green hover + lift ----------
  const btnCard = ruleBody(cssTopLevel, /(^|\n)\.btn-card \{[^}]*\}/);
  check('add-to-cart: base .btn-card rule exists with transform in the .25s transition (base rule, never :hover only)', !!btnCard && /transition:[^;]*transform \.25s ease/.test(btnCard));
  const btnHover = ruleBody(cssTopLevel, /\.btn-card:hover \{[^}]*\}/);
  check('add-to-cart: hover is the success green var(--success) #1f7a30 + white text (NOT gold any more)', !!btnHover && /background:\s*var\(--success\)/.test(btnHover) && /color:\s*#fff/.test(btnHover) && !/mega-hover-gold/.test(btnHover));
  check('add-to-cart: hover lifts the button itself translateY(-2px)', !!btnHover && /transform:\s*translateY\(-2px\)/.test(btnHover));
  check('add-to-cart: hover declares NO transition of its own (PR #72 lesson — it lives on the base rule)', !!btnHover && !/transition:/.test(btnHover));
  const btnFocus = ruleBody(cssTopLevel, /\.product-card \.btn-card:focus-visible \{[^}]*\}/);
  check('add-to-cart: :focus-visible matches hover (green + white)', !!btnFocus && /background:\s*var\(--success\)/.test(btnFocus) && /color:\s*#fff/.test(btnFocus));
  const btnActive = ruleBody(cssTopLevel, /\.product-card \.btn-card:active \{[^}]*\}/);
  check('add-to-cart: :active darkens to #176327 (the .btn-call pair: #1f7a30 -> #176327)', !!btnActive && /background:\s*#176327/.test(btnActive));
  check('add-to-cart: the green pair is the exact .btn-call pair (success #1f7a30, hover #176327)', /--success:\s*#1f7a30/.test(cssTopLevel) && /\.btn-call:hover,[\s\S]*?background:\s*#176327/.test(hoverBlocks));
  const cardHover = hoverBlocks.match(/\.product-card:hover \{[^}]*\}/);
  check('add-to-cart: card hover itself is UNCHANGED (ring + -10px lift + mint foot)', !!cardHover && /transform:\s*translateY\(-10px\)/.test(cardHover[0]) && /box-shadow:\s*0 0 0 2px var\(--mega-hover-gold\), 0 18px 36px/.test(cardHover[0]) && /\.product-card:hover \.product-card-foot \{[^}]*background:\s*var\(--card-foot-hover\)/.test(hoverBlocks));
  check('add-to-cart: reduced-motion switches the button lift off (transform: none on :hover)', /\.btn-card:hover \{[^}]*transform:\s*none/.test(reducedMotionCss));

  // ---------- 3. WhatsApp — transition + hover lift ----------
  const waBase = ruleBody(cssTopLevel, '.whatsapp-float');
  check('whatsapp: base rule transitions transform + box-shadow .25s ease (on the base rule)', !!waBase && /transition:[^;]*transform \.25s ease/.test(waBase) && /transition:[^;]*box-shadow \.25s ease/.test(waBase));
  check('whatsapp: hover lifts translateY(-4px) with a deeper shadow, inside @media (hover: hover)', /\.whatsapp-float:hover \{[^}]*transform:\s*translateY\(-4px\)[^}]*box-shadow:\s*0 10px 24px/.test(hoverBlocks));
  check('whatsapp: hover lift also applies when the scroll-aware rule has set transform: none (is-visible variant)', /\.whatsapp-float\.whatsapp-float--scroll\.is-visible:hover \{[^}]*transform:\s*translateY\(-4px\)/.test(hoverBlocks));
  check('whatsapp: old scale(1.08) hover is gone', !/\.whatsapp-float:hover\s*\{[^}]*scale\(1\.08\)/.test(cssNoComments));
  check('whatsapp: reduced-motion disables the transition + lift', /\.whatsapp-float \{[^}]*transition:\s*none/.test(reducedMotionCss) && /\.whatsapp-float:hover,[\s\S]*?transform:\s*none/.test(reducedMotionCss));
  check('whatsapp: scroll-aware hiding + overlap guard logic untouched (footer IIFE still there)', footerEjs.includes('Scroll-aware + overlap guard') && footerEjs.includes('whatsapp-float--scroll') && footerEjs.includes("btn.classList.toggle('is-visible', show)"));

  // ---------- 4. Side-cart 6s sliver CSS ----------
  const sliver = ruleBody(cssTopLevel, '.side-cart--minimised');
  check('sliver: .side-cart--minimised slides the pill 54px right (56px pill + 12px inset = ~14px sliver left)', !!sliver && /transform:\s*translateX\(54px\)/.test(sliver));
  check('sliver: hovering the sliver does NOT slide it out on its own (JS restores it)', /\.side-cart--minimised:hover \{[^}]*transform:\s*translateX\(54px\)/.test(cssTopLevel));
  check('sliver: transition comes from the base .side-cart rule (.25s spring), so the slide fades', /transition:[^;]*transform \.25s cubic-bezier\(\.22, 1\.25, \.36, 1\)/.test(ruleBody(cssTopLevel, '.side-cart') || ''));
  check('sliver: reduced-motion disables the slide (transition: none on .side-cart)', /\.side-cart \{[^}]*transition:\s*none/.test(reducedMotionCss));

  // ---------- 5. Drawer CSS ----------
  const drawerCss = ruleBody(cssTopLevel, '.mini-cart-drawer');
  check('drawer css: rule exists — fixed, right edge, z-index 1001, ~400px wide / 92vw on mobile', !!drawerCss && /position:\s*fixed/.test(drawerCss) && /right:\s*0/.test(drawerCss) && /z-index:\s*1001/.test(drawerCss) && /width:\s*min\(400px, 92vw\)/.test(drawerCss));
  check('drawer css: hidden off-screen (translateX(102%)) with a .25s spring slide-in', !!drawerCss && /transform:\s*translateX\(102%\)/.test(drawerCss) && new RegExp(`transition:\\s*transform \\.25s ${SPRING}`).test(drawerCss));
  check('drawer css: .is-open slides it in (translateX(0))', /\.mini-cart-drawer\.is-open \{[^}]*transform:\s*translateX\(0\)/.test(cssTopLevel));
  const overlayCss = ruleBody(cssTopLevel, '.mini-cart-overlay');
  check('drawer css: overlay covers the page (fixed, inset 0, rgba(0,0,0,.5), z-index 1000)', !!overlayCss && /position:\s*fixed/.test(overlayCss) && /inset:\s*0/.test(overlayCss) && /z-index:\s*1000/.test(overlayCss));
  check('drawer css: overlay .is-open fades in (opacity 1, visible)', /\.mini-cart-overlay\.is-open \{[^}]*opacity:\s*1[^}]*visibility:\s*visible/.test(cssTopLevel));
  check('drawer css: z-index order is drawer 1001 > overlay 1000 > WhatsApp 999 > side-cart 600 > header 500', !!drawerCss && /z-index:\s*1001/.test(drawerCss) && !!overlayCss && /z-index:\s*1000/.test(overlayCss) && /z-index:\s*999/.test(waBase || '') && /z-index:\s*600/.test(ruleBody(cssTopLevel, '.side-cart') || '') && /\.site-header \{[^}]*z-index:\s*500/.test(cssTopLevel));
  check('drawer css: [hidden] really hides the drawer + overlay (author display:flex would otherwise beat the UA rule)', /\.mini-cart-drawer\[hidden\], \.mini-cart-overlay\[hidden\] \{[^}]*display:\s*none/.test(cssTopLevel));
  check('drawer css: body scroll locks while open (body.mini-cart-open { overflow: hidden })', /body\.mini-cart-open \{[^}]*overflow:\s*hidden/.test(cssTopLevel));
  check('drawer css: reduced-motion disables the drawer + overlay transitions', /\.mini-cart-overlay, \.mini-cart-drawer \{[^}]*transition:\s*none/.test(reducedMotionCss));

  // ---------- 6. Drawer markup (footer source) ----------
  check('drawer markup: aside is role=dialog aria-modal with a labelled title, hidden by default', /<aside class="mini-cart-drawer" id="mini-cart-drawer" role="dialog" aria-modal="true" aria-labelledby="mini-cart-title" hidden>/.test(footerEjs));
  check('drawer markup: overlay exists, hidden by default', /<div class="mini-cart-overlay" id="mini-cart-overlay" hidden><\/div>/.test(footerEjs));
  check('drawer markup: header has "Your Cart" + count + close (×) button', /<h2 id="mini-cart-title">Your Cart/.test(footerEjs) && /class="mini-cart-close" aria-label="Close cart">×<\/button>/.test(footerEjs));
  check('drawer markup: items carry photo + name link + variant + stepper + line total + remove', footerEjs.includes('class="mini-cart-thumb"') && footerEjs.includes('class="mini-cart-name"') && footerEjs.includes('class="mini-cart-variant"') && footerEjs.includes('class="qty-stepper mini-cart-qty"') && footerEjs.includes('class="mini-cart-line-total"') && footerEjs.includes('class="mini-cart-remove"'));
  check('drawer markup: stepper + remove reuse the EXISTING cart POST routes (no invented URLs)', footerEjs.includes('action="/cart/update/<%= item.cartKey || item.id %>"') && footerEjs.includes('action="/cart/remove/<%= item.cartKey || item.id %>"') && shopRoutes.includes("router.post('/cart/update/:cartKey'") && shopRoutes.includes("router.post('/cart/remove/:cartKey'"));
  check('drawer markup: stepper + remove forms carry the CSRF field', (footerEjs.match(/include\('csrf-field'\)/g) || []).length >= 2);
  check('drawer markup: subtotal + delivery note (৳60 inside Dhaka / ৳120 outside Dhaka, calculated at checkout)', footerEjs.includes('class="mini-cart-subtotal"') && footerEjs.includes('৳60 inside Dhaka / ৳120 outside Dhaka') && footerEjs.includes('calculated at checkout'));
  check('drawer markup: View Cart (→ /cart) + Checkout (→ /checkout) + Continue shopping', footerEjs.includes('<a href="/cart" class="mini-cart-view">View Cart</a>') && footerEjs.includes('<a href="/checkout" class="btn-primary mini-cart-checkout">Checkout</a>') && footerEjs.includes('class="mini-cart-continue">Continue shopping</button>'));
  check('drawer markup: empty state has a message + Start Shopping (→ /)', footerEjs.includes('Your cart is empty.') && footerEjs.includes('<a href="/" class="btn-primary">Start Shopping</a>'));
  check('drawer markup: NO recommendations query in the drawer (no relatedProducts / "You may also like")', !/mini-cart[\s\S]{0,4000}relatedProducts/.test(footerEjs) && !footerEjs.slice(footerEjs.indexOf('mini-cart-drawer')).includes('You may also like'));
  check('drawer markup: tab is STILL a plain <a href="/cart"> (no-JS fallback — JS intercepts the click)', /<a href="\/cart" class="side-cart"/.test(footerEjs));

  // ---------- 7. Server.js — mini-cart locals from the session cart ----------
  check('server: miniCart + miniCartSubtotal come from the session cart (no DB query, no new route)', serverJs.includes('res.locals.miniCart = req.session.cart || []') && serverJs.includes('res.locals.miniCartSubtotal = res.locals.miniCart.reduce'));
  check('server: mini-cart locals are set for shop pages only (admin skipped)', /if \(!req\.path\.startsWith\('\/admin'\)\) \{\s*\n\s*res\.locals\.miniCart/.test(serverJs));
  check('server: no new mini-cart route or JSON API was added', !/app\.(get|post)\('\/mini-cart/.test(serverJs) && !/router\.(get|post)\('\/mini-cart/.test(shopRoutes) && !/\/api\/mini-cart/.test(serverJs) && !/\/api\/mini-cart/.test(shopRoutes));

  // ---------- 8. Footer renders (EJS: with items, empty, no cart locals) ----------
  const baseLocals = { siteName: 'Goince', siteSettings: {}, shopPhone: '+8801814697896', paymentMethods: [], assetUrl: (p) => p };
  const twoItems = [
    { cartKey: '5', id: 5, name: 'BINBOND Watch', price: 990, image: 'watch.jpg', quantity: 2, variantLabel: 'Color: Black' },
    { cartKey: '7', id: 7, name: 'MLSM-202', price: 1250, image: 'sew.jpg', quantity: 1, variantLabel: null },
  ];
  let withItems = '';
  let emptyHtml = '';
  let noLocalsHtml = '';
  try {
    withItems = await renderFile(footerPath, Object.assign({}, baseLocals, { cartCount: 3, miniCart: twoItems, miniCartSubtotal: 3230, csrfToken: 'tok123' }));
  } catch (e) { check('render: footer with 2 cart items renders (EJS)', false, String(e && e.message)); }
  try {
    emptyHtml = await renderFile(footerPath, Object.assign({}, baseLocals, { cartCount: 0, miniCart: [], miniCartSubtotal: 0, csrfToken: '' }));
  } catch (e) { check('render: footer with an empty cart renders (EJS)', false, String(e && e.message)); }
  try {
    noLocalsHtml = await renderFile(footerPath, Object.assign({}, baseLocals, { cartCount: 0, csrfToken: '' }));
  } catch (e) { check('render: footer with NO miniCart locals at all renders (fallback to empty)', false, String(e && e.message)); }
  if (withItems) {
    check('render: drawer shows both item names + variant label', withItems.includes('BINBOND Watch') && withItems.includes('MLSM-202') && withItems.includes('Color: Black'));
    check('render: drawer shows the line totals (2 × ৳990 = ৳1,980; 1 × ৳1,250) + subtotal ৳3,230', withItems.includes('৳1,980') && withItems.includes('৳1,250') && withItems.includes('৳3,230'));
    check('render: drawer shows the delivery note + View Cart + Checkout links', withItems.includes('৳60 inside Dhaka / ৳120 outside Dhaka') && withItems.includes('href="/cart" class="mini-cart-view"') && withItems.includes('href="/checkout" class="btn-primary mini-cart-checkout"'));
    check('render: stepper forms post to the real update route with the CSRF token', withItems.includes('action="/cart/update/5"') && withItems.includes('name="_csrf" value="tok123"') && withItems.includes('value="3"') && withItems.includes('value="1"'));
    check('render: remove forms post to the real remove route', withItems.includes('action="/cart/remove/5"') && withItems.includes('action="/cart/remove/7"'));
    check('render: drawer title shows the item count (Your Cart (3))', withItems.includes('Your Cart (3)'));
    check('render: item photos use /uploads/ + the cart image', withItems.includes('src="/uploads/watch.jpg"') && withItems.includes('src="/uploads/sew.jpg"'));
  }
  if (emptyHtml) {
    check('render: empty cart shows the empty state + Start Shopping, no item list', emptyHtml.includes('Your cart is empty.') && emptyHtml.includes('Start Shopping') && !emptyHtml.includes('<ul class="mini-cart-items">'));
  }
  if (noLocalsHtml) {
    check('render: no miniCart locals → falls back to the empty state (never crashes)', noLocalsHtml.includes('Your cart is empty.') && noLocalsHtml.includes('Start Shopping'));
  }

  // ---------- 9. The REAL drawer + timer IIFE in a stubbed DOM ----------
  const gStart = footerEjs.indexOf('(function () {', footerEjs.indexOf('Side-cart tab overlap guard'));
  const gEnd = gStart > 0 ? footerEjs.indexOf('})();', gStart) + 5 : -1;
  const gCode = gStart > 0 ? footerEjs.slice(gStart, gEnd) : '';
  check('iife: extractable from footer.ejs (same IIFE as the PR #75 guard)', gStart > 0 && gCode.includes("querySelector('.side-cart')"));
  check('iife: 6s idle constant (IDLE_MS = 6000) + sliver class + drawer open/close', gCode.includes('IDLE_MS = 6000') && gCode.includes('side-cart--minimised') && gCode.includes('openDrawer') && gCode.includes('closeDrawer'));
  check('iife: tab click is intercepted (preventDefault) in BOTH branches — sliver restore AND drawer open', gCode.includes('preventDefault') && gCode.indexOf('preventDefault') < gCode.indexOf('if (minimised)'));
  check('iife: closes on Esc + overlay click + × + Continue shopping', gCode.includes("key === 'Escape'") && gCode.includes("overlay.addEventListener('click'") && gCode.includes("closeBtn.addEventListener('click'") && gCode.includes("continueBtn.addEventListener('click'"));
  check('iife: focus moves into the drawer on open and returns to the tab on close', gCode.includes('closeBtn.focus()') && gCode.includes('lastFocused.focus()'));
  check('iife: body scroll locks while open (mini-cart-open class)', gCode.includes("classList.add('mini-cart-open')") && gCode.includes("classList.remove('mini-cart-open')"));
  check('iife: closing the drawer restarts the 6s timer', gCode.includes('startTimer()') && /closeDrawer[\s\S]*?startTimer\(\)/.test(gCode));
  check('iife: guard still takes precedence (applyTabState checks guardHidden first)', /function applyTabState[\s\S]*?if \(guardHidden\)/.test(gCode));

  function makeStubEl() {
    const el = {
      _classes: new Set(),
      _attrs: {},
      _rect: { left: 0, top: 0, right: 0, bottom: 0 },
      _listeners: {},
      hidden: false,
      focused: false,
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
  function clickEvent() {
    const ev = { prevented: false, preventDefault() { ev.prevented = true; } };
    return ev;
  }

  const TAB_RECT = { left: 1852, top: 512, right: 1908, bottom: 568 };
  const CLEAR_RECT = { left: 100, top: 500, right: 300, bottom: 540 };
  const OVERLAP_RECT = { left: 1800, top: 500, right: 1900, bottom: 560 };
  function runScenario() {
    const clock = makeClock();
    const tab = makeStubEl(); tab._rect = Object.assign({}, TAB_RECT);
    const drawer = makeStubEl(); drawer.hidden = true;
    const overlay = makeStubEl(); overlay.hidden = true;
    const closeBtn = makeStubEl();
    const continueBtn = makeStubEl();
    const body = makeStubEl();
    const guardedEl = makeStubEl(); guardedEl._rect = Object.assign({}, CLEAR_RECT);
    const winListeners = {};
    const docListeners = {};
    const sandbox = {
      document: {
        querySelector(sel) {
          if (sel === '.side-cart') return tab;
          if (sel === '#mini-cart-drawer') return drawer;
          if (sel === '#mini-cart-overlay') return overlay;
          if (sel === '.mini-cart-close') return closeBtn;
          if (sel === '.mini-cart-continue') return continueBtn;
          return null;
        },
        querySelectorAll() { return [guardedEl]; },
        documentElement: { scrollTop: 0 },
        activeElement: tab,
        body,
        addEventListener(type, fn) { (docListeners[type] = docListeners[type] || []).push(fn); },
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
    };
    sandbox.window.document = sandbox.document;
    vm.runInNewContext(gCode, sandbox);
    return {
      clock, tab, drawer, overlay, closeBtn, continueBtn, body, guardedEl,
      fireWin(type) { (winListeners[type] || []).forEach((fn) => fn()); },
      fireDoc(type, ev) { (docListeners[type] || []).forEach((fn) => fn(ev || {})); },
      isMinimised: () => tab.classList.contains('side-cart--minimised'),
      isHidden: () => tab.classList.contains('side-cart--hidden'),
      drawerOpen: () => drawer.classList.contains('is-open') && drawer.hidden === false,
    };
  }

  const sc = runScenario();
  check('behaviour: tab is FULLY visible on load (no sliver, no guard-hide), drawer + overlay hidden', !sc.isMinimised() && !sc.isHidden() && sc.drawer.hidden === true && sc.overlay.hidden === true && !sc.body.classList.contains('mini-cart-open'));
  sc.clock.advance(5999);
  check('behaviour: still fully visible at 5.999s (timer has not fired yet)', !sc.isMinimised());
  sc.clock.advance(1);
  check('behaviour: after 6s idle the tab minimises to the sliver (still focusable: aria-hidden false, no tabindex -1)', sc.isMinimised() && !sc.isHidden() && sc.tab.getAttribute('aria-hidden') === 'false' && sc.tab.getAttribute('tabindex') === null);
  sc.tab.fire('mouseenter');
  check('behaviour: hovering the sliver restores the full pill', !sc.isMinimised());
  sc.clock.advance(6000);
  check('behaviour: hovering RESTARTED the timer (minimises again only after another 6s)', sc.isMinimised());
  const sliverEv = clickEvent();
  sc.tab.fire('click', sliverEv);
  check('behaviour: clicking the sliver restores the pill WITHOUT opening the drawer — and does NOT navigate (preventDefault called)', !sc.isMinimised() && !sc.drawerOpen() && sliverEv.prevented === true);
  sc.clock.advance(6000);
  check('behaviour: sliver click RESTARTED the timer (minimises again after 6s)', sc.isMinimised());
  sc.tab.fire('mouseenter');
  const tabEv = clickEvent();
  sc.tab.fire('click', tabEv);
  check('behaviour: clicking the full tab OPENS the drawer on the same page (preventDefault called — NO navigation)', tabEv.prevented === true && sc.drawerOpen() && sc.overlay.classList.contains('is-open') && sc.overlay.hidden === false);
  check('behaviour: opening the drawer locks body scroll + moves focus to the close (×) button', sc.body.classList.contains('mini-cart-open') && sc.closeBtn.focused === true);
  check('behaviour: while the drawer is open the tab stays fully visible', !sc.isMinimised() && !sc.isHidden());
  // Guard precedence while the drawer is open.
  sc.guardedEl._rect = Object.assign({}, OVERLAP_RECT);
  sc.fireWin('scroll');
  check('behaviour: guard still wins while the drawer is open (tab hides when it would cover a button)', sc.isHidden() && sc.drawerOpen());
  sc.guardedEl._rect = Object.assign({}, CLEAR_RECT);
  sc.fireWin('scroll');
  check('behaviour: overlap gone while drawer open → tab visible again, still full (not sliver)', !sc.isHidden() && !sc.isMinimised() && sc.drawerOpen());
  sc.clock.advance(10000);
  check('behaviour: the 6s timer is cancelled while the drawer is open (still full after 10s)', !sc.isMinimised() && sc.drawerOpen());
  sc.tab.focused = false;
  sc.fireDoc('keydown', { key: 'Escape', preventDefault() {} });
  check('behaviour: Esc closes the drawer + returns focus to the tab', !sc.drawerOpen() && !sc.overlay.classList.contains('is-open') && sc.tab.focused === true);
  check('behaviour: body scroll unlocks on close', !sc.body.classList.contains('mini-cart-open'));
  sc.clock.advance(260);
  check('behaviour: drawer + overlay get hidden after the close slide (260ms)', sc.drawer.hidden === true && sc.overlay.hidden === true);
  sc.clock.advance(5740);
  check('behaviour: closing the drawer RESTARTED the timer (minimises 6s after close)', sc.isMinimised());
  // Reopen + close via overlay, ×, and Continue shopping.
  sc.tab.fire('mouseenter');
  sc.tab.fire('click', clickEvent());
  check('behaviour: reopen via the tab works after a close', sc.drawerOpen());
  sc.overlay.fire('click');
  check('behaviour: clicking the overlay closes the drawer', !sc.drawerOpen());
  sc.tab.fire('mouseenter');
  sc.tab.fire('click', clickEvent());
  sc.closeBtn.fire('click');
  check('behaviour: clicking × closes the drawer', !sc.drawerOpen());
  sc.tab.fire('mouseenter');
  sc.tab.fire('click', clickEvent());
  sc.continueBtn.fire('click');
  check('behaviour: "Continue shopping" closes the drawer', !sc.drawerOpen());
  // Guard precedence against the TIMER state (not just the open state).
  sc.clock.advance(6000);
  check('behaviour: timer minimised the tab again after the last close', sc.isMinimised());
  sc.guardedEl._rect = Object.assign({}, OVERLAP_RECT);
  sc.fireWin('scroll');
  check('behaviour: guard beats the sliver too (overlap → fully hidden, not sliver)', sc.isHidden() && !sc.isMinimised());
  sc.guardedEl._rect = Object.assign({}, CLEAR_RECT);
  sc.fireWin('scroll');
  check('behaviour: overlap gone → tab returns to its TIMER state (sliver), not to full', !sc.isHidden() && sc.isMinimised());

  console.log(`\n${passes.length} passed, ${failures.length} failed.`);
  if (failures.length) { console.log('Failures: ' + failures.join(', ')); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
