// Shop header hover (fix/shop-header-hover) — menu bar hover
// effects like the admin panel, plus extra polish.
//
// donal said (2026-11-27, in Romanized Bengali): the goince.com
// shop menu bar does not change colour on hover — make it like the
// admin panel, but beautiful, with extra effects so it looks good.
//
// What was built (SHOP ONLY — the admin panel is untouched):
//   1. NAV HOVER: Home / Categories (+ Wishlist, My Account,
//      Logout) turn gold (var(--accent)) on hover, lift
//      translateY(-2px), and grow a gold underline sliding in from
//      the left (::after scaleX 0 -> 1). The header is navy in BOTH
//      themes, so gold reads in both. The single "Login / Sign Up"
//      solid button is excluded from the underline (bordered/solid
//      button) but still lifts + deepens its shadow on hover; the
//      Search button darkens + lifts. (fix/header-account-menu:
//      Login + Sign Up are ONE button now; the separate outline
//      Login button is gone.) The active page keeps a subtle underline
//      (opacity .55) — marked by a small IIFE in mega-menu.js that
//      matches window.location.pathname (Home only on exact '/',
//      Categories button when ?category= is present).
//   2. MEGA MENU ENTRANCE: the panel was display:none/block, which
//      cannot animate — now visibility-based (like the admin
//      dropdowns): fade + slide down + slight scale (.97 -> 1),
//      spring cubic-bezier(.22, 1.25, .36, 1), open .25s, close
//      quick .15s; columns + footer stagger in (30ms/item, last
//      210ms) on BOTH the click latch (.open) and the hover open.
//      The entrance uses the standalone translate/scale properties
//      so the >=769px centering rule (transform: translateX(-50%))
//      is untouched. Hover/click/Esc/outside-click/focus-out and
//      the right-edge guard are unchanged.
//   3. PILL DROPDOWNS: same fade/slide/scale entrance (25ms/item
//      stagger, last 150ms) on hover and :focus-within. Mobile
//      (<=768px) still never opens them (tap navigates instead).
//   4. CART BADGE — REMOVED (fix/header-cart-side-tab): the header
//      Cart link (desktop) and cart icon (mobile) are gone, so the
//      header badge-pop rules are gone too. The count badge now
//      lives on the floating side-cart tab (footer) and on the
//      drawer Cart link; this suite asserts the old header rules
//      are really gone (see section 7).
//   5. THEME TOGGLE (shop header only, scoped .site-header so the
//      admin toggle is untouched): hover gives a gold glow + gentle
//      12deg rotate. The icon is an emoji text node (theme.js sets
//      textContent), so the whole button rotates — the glow + rotate
//      is the visible effect, colour cannot recolour an emoji.
//   6. LOGO: very subtle hover — brightness 1.08 + 1px lift, the
//      mark scales 1.08. Nothing flashy.
//   7. MOBILE + TOUCH: hamburger / search icon buttons get
//      hover wash + :active scale(.94); drawer links change colour
//      + grow a gold left bar on hover, :active feedback on tap.
//      Drawer accordion behaviour unchanged.
//   8. SAFETY: prefers-reduced-motion disables all of it (instant
//      colour change only, no lift/slide/scale/stagger); focus-
//      visible shows the same colour + underline as hover; motion
//      uses transform + opacity only (translate/scale properties
//      for the panels, transform for the items).
//
// No live MySQL needed: CSS/EJS source checks + a direct EJS render
// of the shop header + the REAL active-link IIFE from mega-menu.js
// run in a stubbed DOM (vm sandbox — no jsdom in node_modules).
//
// Run:  node scripts/test-shop-header-hover.js
// Exit code 0 = all checks passed.
'use strict';

const fs = require('fs');
const path = require('path');
const util = require('util');
const ejs = require('ejs');
const vm = require('vm');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'style.css'), 'utf8');
const headerEjs = fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', 'header.ejs'), 'utf8');
const megaMenuJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'mega-menu.js'), 'utf8');
const renderFile = util.promisify(ejs.renderFile);
const headerPath = path.join(__dirname, '..', 'views', 'partials', 'header.ejs');

const failures = [];
const passes = [];
function check(name, ok, detail) {
  if (ok) { passes.push(name); console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

// Same helpers as test-shop-menu-bar.js: top-level CSS (comments +
// all @media ranges stripped), and per-query @media blocks.
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
const mobileBlocks = extractRanges(cssNoComments, allMediaRanges(cssNoComments, 'max-width: 768px'));
const desktop769Blocks = extractRanges(cssNoComments, allMediaRanges(cssNoComments, 'min-width: 769px'));
const reducedMotionBlocks = extractRanges(cssNoComments, allMediaRanges(cssNoComments, 'prefers-reduced-motion'));

function ruleBody(source, selectorRe) {
  const m = source.match(selectorRe);
  return m ? m[0] : null;
}

(async function main() {
  console.log('Shop header hover (fix/shop-header-hover) checks:');

  // ---------- 1. Nav link hover: colour + lift ----------
  check('nav hover: Home links turn gold on hover',
    /\.main-nav\s*>\s*a:hover[^{]*\{[^}]*color:\s*var\(--accent\)/.test(hoverBlocks),
    'no gold hover colour on .main-nav > a');
  check('nav hover: links lift translateY(-2px) on hover',
    /\.main-nav\s*>\s*a:hover[^{]*\{[^}]*transform:\s*translateY\(-2px\)/.test(hoverBlocks),
    'no lift on .main-nav > a:hover');
  check('nav hover: Categories button turns gold + lifts on hover',
    /\.mega-menu-btn:hover[^{]*\{[^}]*color:\s*var\(--accent\)/.test(hoverBlocks)
    && /\.mega-menu-btn:hover[^{]*\{[^}]*transform:\s*translateY\(-2px\)/.test(hoverBlocks),
    'mega-menu-btn hover missing colour/lift');
  check('nav hover: hover rules are gated behind @media (hover: hover) (no stuck hover on touch)',
    hoverBlocks.includes('.main-nav > a:hover'));
  check('nav hover: links have a colour/transform transition',
    !!ruleBody(cssTopLevel, /\.main-nav\s*>\s*a\s*\{[^}]*\}/)
    && /transition:[^}]*color[^}]*transform/.test(ruleBody(cssTopLevel, /\.main-nav\s*>\s*a\s*\{[^}]*\}/)),
    'no transition on .main-nav > a');
  check('nav hover: panel links are NOT caught by the nav hover rule (direct children only)',
    /\.main-nav\s*>\s*a:hover/.test(hoverBlocks)
    && !/\.main-nav\s+a:hover\s*\{/.test(cssNoComments),
    'a bare .main-nav a:hover rule would recolour panel links');

  // ---------- 2. Sliding underline + active page ----------
  const underlineRule = ruleBody(cssTopLevel, /\.main-nav\s*>\s*a:not\(\.btn-nav-outline\):not\(\.btn-nav-solid\)::after[^{]*\{[^}]*\}/);
  check('underline: ::after starts hidden (scaleX 0) with a gold background',
    !!underlineRule && /transform:\s*scaleX\(0\)/.test(underlineRule) && /background:\s*var\(--accent\)/.test(underlineRule),
    'no scaleX(0) gold ::after on nav links');
  check('underline: slides in (scaleX 1) on hover',
    /\.main-nav\s*>\s*a:not\(\.btn-nav-outline\):not\(\.btn-nav-solid\):hover::after[^{]*\{[^}]*transform:\s*scaleX\(1\)/.test(hoverBlocks),
    'no scaleX(1) on hover');
  check('underline: buttons are excluded from the underline (Login/Sign Up)',
    !!underlineRule && underlineRule.includes(':not(.btn-nav-outline)') && underlineRule.includes(':not(.btn-nav-solid)'),
    'buttons not excluded from the underline');
  check('underline: Categories button gets the same sliding underline',
    /\.mega-menu-btn::after[^{]*\{[^}]*transform:\s*scaleX\(0\)/.test(cssTopLevel)
    && /\.mega-menu-btn:hover::after[^{]*\{[^}]*transform:\s*scaleX\(1\)/.test(hoverBlocks),
    'mega-menu-btn underline missing');
  check('underline: active page keeps a subtle underline (scaleX 1, opacity .55)',
    /\.main-nav\s*>\s*a\.active:not\(\.btn-nav-outline\):not\(\.btn-nav-solid\)::after[^{]*\{[^}]*transform:\s*scaleX\(1\)/.test(cssTopLevel)
    && /opacity:\s*\.55/.test(cssTopLevel),
    'no active-page underline');
  check('active link: mega-menu.js marks the current page (pathname match + ?category=)',
    /window\.location\.pathname/.test(megaMenuJs)
    && /category=/.test(megaMenuJs)
    && /classList\.add\('active'\)/.test(megaMenuJs),
    'no active-link marking in mega-menu.js');

  // ---------- 3. Focus-visible matches hover ----------
  check('focus-visible: nav link shows the same gold colour + lift as hover',
    /\.main-nav\s*>\s*a:focus-visible[^{]*\{[^}]*color:\s*var\(--accent\)/.test(cssTopLevel)
    && /\.main-nav\s*>\s*a:focus-visible[^{]*\{[^}]*transform:\s*translateY\(-2px\)/.test(cssTopLevel),
    'focus-visible does not match hover');
  check('focus-visible: nav link shows the underline on keyboard focus',
    /\.main-nav\s*>\s*a:not\(\.btn-nav-outline\):not\(\.btn-nav-solid\):focus-visible::after[^{]*\{[^}]*transform:\s*scaleX\(1\)/.test(cssTopLevel),
    'no underline on :focus-visible');

  // ---------- 4. Header buttons: lift + shadow ----------
  // UPDATED (fix/mini-cart-drawer-hover): the Login / Sign Up hover
  // is no longer a plain accent-hover darken — it is the two-colour
  // treatment (navy slides in from the left, dark gold from the
  // right, white text, base gold kept). The old accent-hover rule
  // is still in the file but the more specific .main-nav
  // .btn-nav-solid:hover rule (0,3,0, later) wins, so the button
  // never shows accent-hover. Assert the NEW end state here; the
  // new suite (test-mini-cart-drawer.js) covers the pseudos.
  check('buttons: single "Login / Sign Up" solid button gets the two-colour hover (navy left + dark gold right, white text) instead of the old accent-hover darken (fix/mini-cart-drawer-hover: no separate outline Login button)',
    /\.main-nav \.btn-nav-solid:hover \{[^}]*background:\s*var\(--accent\);[^}]*color:\s*#fff !important/.test(hoverBlocks)
    && /\.main-nav \.btn-nav-solid:hover \{[^}]*box-shadow:/.test(hoverBlocks)
    && !/\.main-nav \.btn-nav-solid:hover \{[^}]*background:\s*var\(--accent-hover\)/.test(hoverBlocks)
    && !/\.btn-nav-outline\s*\{/.test(cssTopLevel),
    'no two-colour hover on .btn-nav-solid:hover, or dead .btn-nav-outline rule still present');
  check('buttons: Search button darkens + lifts + shadows on hover',
    /\.search-form button:hover[^{]*\{[^}]*background:\s*var\(--accent-hover\)/.test(hoverBlocks)
    && /\.search-form button:hover[^{]*\{[^}]*transform:\s*translateY\(-2px\)/.test(hoverBlocks)
    && /\.search-form button:hover[^{]*\{[^}]*box-shadow:/.test(hoverBlocks),
    'no lift/shadow on .search-form button:hover');
  check('buttons: nav button + search button have a transition',
    /\.btn-nav-solid,\s*\.search-form button\s*\{[^}]*transition:/.test(cssTopLevel),
    'no transition on header buttons');

  // ---------- 5. Mega menu entrance ----------
  const panelRule = ruleBody(cssTopLevel, /\.mega-menu-panel\s*\{[^}]*\}/);
  check('mega entrance: panel hidden by visibility (not display:none)',
    !!panelRule && /visibility:\s*hidden/.test(panelRule) && /opacity:\s*0/.test(panelRule)
    && /pointer-events:\s*none/.test(panelRule) && !/display:\s*none/.test(panelRule),
    'panel still display:none-based');
  check('mega entrance: hidden state slides up + shrinks (translate/scale)',
    !!panelRule && /translate:\s*0 -8px/.test(panelRule) && /scale:\s*\.97/.test(panelRule),
    'no translate/scale on hidden panel');
  check('mega entrance: hidden state closes quickly (.15s + visibility delay)',
    !!panelRule && /visibility 0s linear \.15s/.test(panelRule),
    'no quick close transition on panel');
  const panelOpenRule = ruleBody(cssTopLevel, /\.mega-menu-panel\.open\s*\{[^}]*\}/);
  check('mega entrance: .open shows the panel with a spring ease (.25s)',
    !!panelOpenRule && /visibility:\s*visible/.test(panelOpenRule) && /opacity:\s*1/.test(panelOpenRule)
    && /cubic-bezier\(\.22, 1\.25, \.36, 1\)/.test(panelOpenRule),
    'no spring open on .mega-menu-panel.open');
  check('mega entrance: hover-opened panel gets the same spring motion',
    /mega-menu-wrap:hover\s+\.mega-menu-panel\s*\{[^}]*cubic-bezier\(\.22, 1\.25, \.36, 1\)/.test(cssNoComments),
    'hover-opened panel has no spring motion');
  check('mega entrance: centering rule (translateX(-50%)) untouched at >=769px',
    /translateX\(-50%\)/.test(desktop769Blocks) && /left:\s*50%/.test(desktop769Blocks),
    'centering rule lost');
  check('mega entrance: keyframes shop-menu-item-in animates opacity + transform only',
    /@keyframes shop-menu-item-in\s*\{[^}]*from\s*\{[^}]*opacity:[^}]*transform:/.test(cssNoComments)
    && /@keyframes shop-menu-item-in[\s\S]*?to\s*\{[^}]*opacity:[^}]*transform:/.test(cssNoComments),
    'shop keyframes missing or animating a layout property');
  check('mega entrance: columns + footer stagger in on latch (.open)',
    /\.mega-menu-panel\.open\s+\.mega-col[^{]*\{[^}]*animation:\s*shop-menu-item-in/.test(cssTopLevel)
    && /\.mega-menu-panel\.open\s+\.mega-menu-footer[^{]*\{[^}]*animation:\s*shop-menu-item-in/.test(cssTopLevel),
    'no stagger on .open');
  check('mega entrance: columns + footer stagger in on hover-open too',
    /mega-menu-wrap:hover\s+\.mega-menu-panel\s+\.mega-col[^{]*\{[^}]*animation:\s*shop-menu-item-in/.test(cssNoComments),
    'no stagger on hover-open');
  check('mega entrance: stagger delays increase 0 -> 210ms (30ms/item, total < 250ms)',
    /\.mega-menu-panel\s+\.mega-col:nth-of-type\(2\)\s*\{[^}]*animation-delay:\s*30ms/.test(cssTopLevel)
    && /\.mega-menu-panel\s+\.mega-col:nth-of-type\(n\+8\)\s*\{[^}]*animation-delay:\s*210ms/.test(cssTopLevel)
    && /\.mega-menu-panel\s+\.mega-menu-footer\s*\{[^}]*animation-delay:\s*150ms/.test(cssTopLevel),
    'stagger delays wrong');
  check('mega entrance: shop uses its own keyframes, not the admin ones',
    !/\.mega-menu-panel[^{]*\{[^}]*admin-menu-item-in/.test(css)
    && !/\.cat-pill-menu[^{]*\{[^}]*admin-menu-item-in/.test(css),
    'admin keyframes leaked into the shop');
  check('mega entrance: hover open rule + keyboard JS still present (Esc, focusout, outside click)',
    /mega-menu-wrap:hover\s+\.mega-menu-panel/.test(cssNoComments)
    && /Escape/.test(megaMenuJs) && /focusout/.test(megaMenuJs),
    'open/close behaviour lost');

  // ---------- 6. Pill dropdown entrance ----------
  const pillRule = ruleBody(cssTopLevel, /\.cat-pill-menu\s*\{[^}]*\}/);
  check('pill entrance: menu hidden by visibility (not display:none)',
    !!pillRule && /visibility:\s*hidden/.test(pillRule) && /opacity:\s*0/.test(pillRule)
    && /pointer-events:\s*none/.test(pillRule) && !/display:\s*none/.test(pillRule),
    'pill menu still display:none-based');
  check('pill entrance: hover + focus-within show it with fade/slide/scale',
    /\.cat-pill-wrap:hover\s+\.cat-pill-menu\s*\{[^}]*visibility:\s*visible/.test(cssNoComments)
    && /\.cat-pill-wrap:focus-within\s+\.cat-pill-menu\s*\{[^}]*visibility:\s*visible/.test(cssNoComments),
    'pill show rules missing');
  check('pill entrance: items stagger in (25ms/item, last 150ms)',
    /\.cat-pill-menu\s*>\s*ul\s*>\s*li:nth-of-type\(2\)\s*\{[^}]*animation-delay:\s*25ms/.test(cssTopLevel)
    && /\.cat-pill-menu\s*>\s*ul\s*>\s*li:nth-of-type\(n\+7\)\s*\{[^}]*animation-delay:\s*150ms/.test(cssTopLevel)
    && /cat-pill-wrap:hover\s+\.cat-pill-menu\s*>\s*ul\s*>\s*li\s*\{[^}]*animation:\s*shop-menu-item-in/.test(cssNoComments),
    'pill stagger missing');
  check('pill entrance: mobile still never opens the menu (tap navigates)',
    /cat-pill-wrap:hover\s+\.cat-pill-menu,\s*\.cat-pill-wrap:focus-within\s+\.cat-pill-menu\s*\{[^}]*display:\s*none/.test(mobileBlocks),
    'mobile pill menu no longer blocked');

  // ---------- 7. Cart badge pop — REMOVED with the header Cart link ----------
  // (fix/header-cart-side-tab): the header Cart link + mobile cart
  // icon are gone, so the header badge-pop rules must be gone too.
  // The count badge now lives on the floating side-cart tab (footer)
  // and on the drawer Cart link — asserted in
  // test-header-cart-side-tab.js and test-floating-cart-wishlist.js.
  check('cart badge: no header cart badge rules remain (Cart link removed)',
    !/shop-cart-btn/.test(cssNoComments) && !/\.main-nav\s+\.badge/.test(cssTopLevel),
    'dead header cart badge rule still present');

  // ---------- 8. Theme toggle glow + rotate (shop header only) ----------
  const toggleHover = ruleBody(hoverBlocks, /\.site-header\s+\.theme-toggle-btn:hover\s*\{[^}]*\}/);
  check('theme toggle: hover glows gold + gently rotates (shop header only)',
    !!toggleHover && /box-shadow:[^}]*rgba\(240,\s*165,\s*0/.test(toggleHover)
    && /transform:\s*rotate\(12deg\)/.test(toggleHover),
    'no glow/rotate on .site-header .theme-toggle-btn:hover');
  check('theme toggle: no unscoped rotate rule that would also spin the admin toggle',
    !/^\.theme-toggle-btn:hover\s*\{[^}]*rotate/m.test(cssNoComments)
    && !/\.admin-topbar[^{]*theme-toggle-btn:hover[^{]*rotate/.test(cssNoComments),
    'rotate leaked into the admin toggle');
  check('theme toggle: admin topbar toggle hover rules still present',
    /\.admin-topbar\s+\.theme-toggle-btn:hover/.test(cssNoComments),
    'admin toggle hover lost');

  // ---------- 9. Logo hover ----------
  check('logo: hover is subtle (brightness + 1px lift, mark scales)',
    /\.logo:hover\s*\{[^}]*filter:\s*brightness\(1\.08\)/.test(hoverBlocks)
    && /\.logo:hover\s*\{[^}]*transform:\s*translateY\(-1px\)/.test(hoverBlocks)
    && /\.logo:hover\s+\.logo-mark\s*\{[^}]*transform:\s*scale\(1\.08\)/.test(hoverBlocks),
    'no subtle logo hover');

  // ---------- 10. Mobile top row + drawer ----------
  check('mobile: icon buttons get hover wash + tap scale(.94)',
    /\.shop-menu-btn:hover,\s*\.shop-search-btn:hover\s*\{[^}]*background:\s*rgba\(255,\s*255,\s*255,\s*0\.12\)/.test(mobileBlocks)
    && /\.shop-menu-btn:active,\s*\.shop-search-btn:active\s*\{[^}]*transform:\s*scale\(\.94\)/.test(mobileBlocks),
    'no mobile icon button feedback');
  check('mobile: drawer links change colour + grow a gold left bar on hover',
    /\.shop-drawer-link:hover,\s*\.shop-drawer-cat-btn:hover\s*\{[^}]*color:\s*var\(--accent-text\)/.test(mobileBlocks)
    && /\.shop-drawer-link:hover,\s*\.shop-drawer-cat-btn:hover\s*\{[^}]*box-shadow:\s*inset 3px 0 0 var\(--accent\)/.test(mobileBlocks),
    'no drawer link hover colour/bar');
  check('mobile: drawer links have tap (:active) feedback',
    /\.shop-drawer-link:active,\s*\.shop-drawer-cat-btn:active\s*\{[^}]*background:\s*var\(--bg-hover\)/.test(mobileBlocks),
    'no drawer :active feedback');
  check('mobile: drawer accordion + close button rules still present',
    /\.shop-drawer-cat-list\.open\s*\{\s*display:\s*block/.test(mobileBlocks)
    && /shop-drawer-close\s*\{[^}]*width:\s*44px; height:\s*44px/.test(mobileBlocks),
    'drawer behaviour lost');

  // ---------- 11. Reduced motion ----------
  check('reduced motion: shop header transitions disabled',
    /\.main-nav\s*>\s*a[\s\S]*?transition:\s*none/.test(reducedMotionBlocks)
    && /\.mega-menu-panel[\s\S]*?transition:\s*none/.test(reducedMotionBlocks)
    && /\.cat-pill-menu[\s\S]*?transition:\s*none/.test(reducedMotionBlocks),
    'no transition:none for shop header in reduced motion');
  check('reduced motion: stagger animations disabled',
    /mega-menu-panel\s+\.mega-col[\s\S]*?animation:\s*none/.test(reducedMotionBlocks)
    && /cat-pill-menu\s*>\s*ul\s*>\s*li\s*\{[^}]*animation:\s*none/.test(reducedMotionBlocks),
    'stagger not disabled in reduced motion');
  check('reduced motion: hover lift/rotate removed',
    /\.site-header\s+\.theme-toggle-btn:hover\s*\{[^}]*transform:\s*none/.test(reducedMotionBlocks)
    && /\.logo:hover\s*\{[^}]*transform:\s*none/.test(reducedMotionBlocks),
    'hover transforms not removed in reduced motion');

  // ---------- 12. Shop header render (EJS, 2 top categories) ----------
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
      cartCount: 2,
      userName: '',
      search: '',
      menuCategories: twoCats,
      assetUrl: (p) => p,
    });
  } catch (e) {
    check('shop header renders (EJS)', false, String(e && e.message));
  }
  if (html) {
    const order = ['Search products...', 'href="/">Home</a>', 'id="mega-menu-btn"', 'class="theme-toggle-btn"', 'href="/login" class="btn-nav-solid">Login / Sign Up</a>'];
    let lastIdx = -1;
    let inOrder = true;
    for (const piece of order) {
      const i = html.indexOf(piece);
      if (i < 0 || i < lastIdx) { inOrder = false; break; }
      lastIdx = i;
    }
    check('header render: logo, search, Home, Categories, theme toggle, single "Login / Sign Up" in order (NO Cart link)', inOrder && html.includes('class="logo"'));
    check('header render: no desktop Cart link in the nav (fix/header-cart-side-tab)', !html.includes('href="/cart">Cart'));
    check('header render: theme toggle present', html.includes('toggleGoinceTheme()'));
    check('header render: drawer Cart badge shows the count (2)', html.includes('<span class="badge">2</span>'));
    check('header render: mega panel has exactly 2 columns for 2 top categories', (html.match(/class="mega-col"/g) || []).length === 2);
  }

  // ---------- 13. Active-link IIFE behaviour (real code, stubbed DOM) ----------
  const marker = '// Active nav link (fix/shop-header-hover)';
  const actStart = megaMenuJs.indexOf(marker);
  const actEnd = actStart > 0 ? megaMenuJs.indexOf('})();', actStart) + 5 : -1;
  const actCode = actStart > 0 ? megaMenuJs.slice(actStart, actEnd) : '';
  check('active link: IIFE extractable from mega-menu.js', actStart > 0 && actCode.includes("classList.add('active')"));

  function makeLink(href) {
    return {
      tagName: 'A',
      _href: href,
      _classes: new Set(),
      getAttribute(k) { return k === 'href' ? this._href : null; },
      classList: {
        add(c) { this._set.add(c); },
        contains(c) { return this._set.has(c); },
        _set: new Set(),
      },
    };
  }
  function runActiveScenario(pathname, search) {
    const home = makeLink('/');
    const login = makeLink('/login');
    const wrap = { tagName: 'DIV', getAttribute() { return null; }, classList: { add() {}, contains() { return false; } } };
    const megaBtn = {
      _classes: new Set(),
      classList: {
        add(c) { megaBtn._classes.add(c); },
        contains(c) { return megaBtn._classes.has(c); },
      },
    };
    // (fix/header-cart-side-tab + fix/header-account-menu): the nav
    // has NO Cart link any more, and Login + Sign Up are ONE button —
    // the stubbed nav mirrors the real one: Home, Categories wrap,
    // single Login / Sign Up link.
    const nav = { children: [home, wrap, login] };
    const sandbox = {
      document: {
        querySelector(sel) { return sel === '.main-nav' ? nav : null; },
        getElementById(id) { return id === 'mega-menu-btn' ? megaBtn : null; },
      },
      window: { location: { pathname, search: search || '' } },
    };
    sandbox.window.location = sandbox.window.location;
    vm.runInNewContext(actCode, sandbox);
    return { home, login, megaBtn };
  }

  // Homepage: Home active, Categories not.
  let sc = runActiveScenario('/', '');
  check('active link behaviour: homepage marks Home active', sc.home.classList.contains('active') && !sc.megaBtn.classList.contains('active'));
  // Category page: Categories active, Home NOT.
  sc = runActiveScenario('/', '?category=8');
  check('active link behaviour: ?category= marks Categories active, Home not', sc.megaBtn.classList.contains('active') && !sc.home.classList.contains('active'));
  // Cart page: NO link active any more (the Cart link was removed in
  // fix/header-cart-side-tab — the IIFE just finds no /cart link).
  sc = runActiveScenario('/cart', '');
  check('active link behaviour: /cart marks nothing active (Cart link removed)', !sc.home.classList.contains('active') && !sc.megaBtn.classList.contains('active'));
  // Product page: nothing active.
  sc = runActiveScenario('/product/binbond-watch', '');
  check('active link behaviour: /product/... marks nothing active',
    !sc.home.classList.contains('active') && !sc.megaBtn.classList.contains('active'));

  console.log(`\n${passes.length} passed, ${failures.length} failed.`);
  if (failures.length) { console.log('Failures: ' + failures.join(', ')); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
