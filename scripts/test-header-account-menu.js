// Header account menu (fix/header-account-menu): Login + Sign Up become
// ONE button, logged-in customers get a profile pill + dropdown at the
// far right corner, and the day/night toggle sits immediately LEFT of
// the account control.
//
// donal said (2026-11-27, in Romanized Bengali): can Login and Sign Up
// be brought into one button; then after login the profile icon will
// appear at the corner, the profile option will be there, and the
// day/night toggle that is there... now the question is where to put
// the day/night — think carefully and thoughtfully before doing the
// work.
//
// THE DECIDED DESIGN (stated in the PR body with its reasoning):
//   1. ONE "Login / Sign Up" solid button (logged out) linking to
//      /login — the login page already offers "New here? Create an
//      account", so one button honestly covers both.
//   2. Profile pill + dropdown (logged in) at the FAR RIGHT corner:
//      avatar + name + chevron (avatar-only at <=1024px), opening a
//      dropdown with an account header (avatar, name, email) and,
//      in order: My Profile (/account/profile), My Orders (/account
//      — the real orders-list URL, NOT /account/orders, which is a
//      single-order detail route), Wishlist (/wishlist), Track Order
//      (/track-order), divider, Logout. The separate Wishlist and
//      Logout text links leave the desktop nav.
//   3. DAY/NIGHT PLACEMENT: immediately to the LEFT of the account
//      control — before the "Login / Sign Up" button when logged out,
//      before the profile pill when logged in — so the account control
//      is ALWAYS the last element at the far right corner. Reasons:
//      (a) it mirrors the admin panel, which donal himself designed
//      this way in PR #62 (theme toggle immediately before the
//      profile, profile pill last at the far right) — admin + shop
//      feel like one system with one rule; (b) the toggle stays
//      always visible and one tap away in both states, instead of
//      being hidden inside a dropdown where logged-out visitors
//      could never find it; (c) anywhere else (next to the search
//      box, or on the left by the logo) would break the pattern and
//      crowd the search; (d) the account control as the corner
//      anchor is the standard professional pattern.
//   4. MOBILE: the drawer keeps its account block + theme toggle at
//      the bottom (unchanged); no login button is added to the mobile
//      top row (that would duplicate the drawer).
//
// Dropdown behaviour (admin standard, PR #64): click to open/latch,
// Esc closes + returns focus, outside-click closes, focus leaving
// the menu closes it, opening Categories closes the profile menu
// and vice versa. Click-ONLY opening (no hover-open): the dual
// hover+click mechanism is exactly what caused the admin's close
// bugs (PR #64), so this menu has one unambiguous mechanism.
//
// No live MySQL needed: CSS/EJS source checks + direct EJS renders
// of the shop header (logged-out + logged-in, with/without photo and
// with/without userEmail) + the REAL profile IIFE from mega-menu.js
// run in a stubbed DOM (vm sandbox — no jsdom in node_modules).
//
// Run:  node scripts/test-header-account-menu.js
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
const serverJs = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const authJs = fs.readFileSync(path.join(__dirname, '..', 'routes', 'auth.js'), 'utf8');
const renderFile = util.promisify(ejs.renderFile);
const headerPath = path.join(__dirname, '..', 'views', 'partials', 'header.ejs');

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
const narrow1024Css = extractRanges(cssNoComments, allMediaRanges(cssNoComments, 'max-width: 1024px'));
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
function inOrder(html, pieces) {
  let lastIdx = -1;
  for (const piece of pieces) {
    const i = html.indexOf(piece);
    if (i < 0 || i < lastIdx) return false;
    lastIdx = i;
  }
  return true;
}

(async () => {
  console.log('Header account menu (fix/header-account-menu) checks:');

  // ---------- 1. Header source ----------
  check('header source: no separate Login (outline) button any more', !headerEjs.includes('btn-nav-outline'));
  check('header source: no separate Sign Up link in the nav', !headerEjs.includes('href="/signup" class="btn-nav-solid"'));
  check('header source: ONE "Login / Sign Up" button linking to /login', headerEjs.includes('href="/login" class="btn-nav-solid">Login / Sign Up</a>'));
  check('header source: no Wishlist text link in the desktop nav', !/<a href="\/wishlist">Wishlist<\/a>/.test(headerEjs));
  check('header source: no Logout text link in the desktop nav', !/<a href="\/logout">Logout<\/a>/.test(headerEjs));
  check('header source: profile pill button exists (aria-haspopup + controls)', headerEjs.includes('id="shop-profile-btn"') && headerEjs.includes('aria-haspopup="true"') && headerEjs.includes('aria-controls="shop-profile-menu"'));
  check('header source: profile dropdown menu exists with account header', headerEjs.includes('id="shop-profile-menu"') && headerEjs.includes('shop-profile-head'));
  check('header source: dropdown items in order My Profile / My Orders / Wishlist / Track Order / Logout',
    inOrder(headerEjs, ['href="/account/profile" class="shop-profile-link"', 'href="/account" class="shop-profile-link"', 'href="/wishlist" class="shop-profile-link"', 'href="/track-order" class="shop-profile-link"', 'shop-profile-divider', 'href="/logout" class="shop-profile-link"']));
  check('header source: My Orders links to /account (the real orders-list URL, not /account/orders)', headerEjs.includes('href="/account" class="shop-profile-link"'));
  check('header source: theme toggle comes BEFORE the account control in the markup', headerEjs.indexOf('class="theme-toggle-btn"') < headerEjs.indexOf('shop-profile-wrap') && headerEjs.indexOf('class="theme-toggle-btn"') < headerEjs.indexOf('btn-nav-solid">Login / Sign Up'));
  check('header source: drawer keeps Login / Sign Up links (mobile unchanged)', headerEjs.includes('href="/login" class="shop-drawer-link"') && headerEjs.includes('href="/signup" class="shop-drawer-link"'));
  check('header source: drawer keeps the account block + theme toggle (mobile unchanged)', headerEjs.includes('shop-drawer-account') && headerEjs.includes('shop-drawer-theme'));

  // ---------- 2. Profile dropdown CSS ----------
  const wrap = ruleBody(cssTopLevel, '.shop-profile-wrap');
  check('css: .shop-profile-wrap exists (relative, margin-left 20px like other nav items)', !!wrap && /position:\s*relative/.test(wrap) && /margin-left:\s*20px/.test(wrap));
  const btn = ruleBody(cssTopLevel, '.shop-profile-btn');
  check('css: .shop-profile-btn exists (inline-flex, gap, white text, transition)', !!btn && /display:\s*inline-flex/.test(btn) && /gap:\s*8px/.test(btn) && /color:\s*#fff/.test(btn) && /transition:/.test(btn));
  check('css: profile pill hovers gold + lifts like other nav items (gated behind @media (hover: hover), like the mega button)',
    /\.shop-profile-btn:hover[^{]*\{[^}]*color:\s*var\(--accent\)/.test(hoverBlocks)
    && /\.shop-profile-btn:hover[^{]*\{[^}]*transform:\s*translateY\(-2px\)/.test(hoverBlocks));
  check('css: caret rotates 180deg when the menu is open', /\.shop-profile-btn\[aria-expanded="true"\]\s*\.shop-profile-caret[^{]*\{[^}]*transform:\s*rotate\(180deg\)/.test(cssTopLevel));
  const menu = ruleBody(cssTopLevel, '.shop-profile-menu');
  check('css: .shop-profile-menu exists (absolute, top 100%+10px, right 0, 260px, hidden by default)', !!menu && /position:\s*absolute/.test(menu) && /top:\s*calc\(100% \+ 10px\)/.test(menu) && /right:\s*0/.test(menu) && /width:\s*260px/.test(menu) && /visibility:\s*hidden/.test(menu) && /opacity:\s*0/.test(menu) && /pointer-events:\s*none/.test(menu));
  check('css: .shop-profile-menu.open shows with the spring entrance (like the mega menu)', /\.shop-profile-menu\.open[^{]*\{[^}]*visibility:\s*visible/.test(cssTopLevel) && /\.shop-profile-menu\.open[^{]*\{[^}]*cubic-bezier\(\.22,\s*1\.25,\s*\.36,\s*1\)/.test(cssTopLevel));
  check('css: profile menu has the 10px hover bridge (::after, like the mega menu)', /\.shop-profile-wrap::after[^{]*\{[^}]*height:\s*10px/.test(cssTopLevel));
  const head = ruleBody(cssTopLevel, '.shop-profile-head');
  check('css: .shop-profile-head exists (flex, avatar 40px, bottom border)', !!head && /display:\s*flex/.test(head) && /border-bottom:/.test(head) && /\.shop-profile-head\s*\.shop-user-avatar[^{]*\{[^}]*width:\s*40px/.test(cssTopLevel));
  const link = ruleBody(cssTopLevel, '.shop-profile-menu a.shop-profile-link');
  check('css: menu links reset the .main-nav a defaults (no margin-left, surface text colour)', !!link && /margin-left:\s*0/.test(link) && /color:\s*var\(--text\)/.test(link) && /display:\s*flex/.test(link));
  check('css: menu links hover with a soft background + lift (gated behind @media (hover: hover))',
    /\.shop-profile-menu a\.shop-profile-link:hover[^{]*\{[^}]*background:\s*var\(--bg-hover\)/.test(hoverBlocks)
    && /\.shop-profile-menu a\.shop-profile-link:hover[^{]*\{[^}]*transform:\s*translateY\(-1px\)/.test(hoverBlocks));
  check('css: .shop-profile-divider exists (1px, border colour)', !!ruleBody(cssTopLevel, '.shop-profile-divider') && /height:\s*1px/.test(ruleBody(cssTopLevel, '.shop-profile-divider')));
  check('css: avatar-only on narrower desktops (name hidden at <=1024px)', /\.shop-profile-name\s*\{\s*display:\s*none/.test(narrow1024Css));
  check('css: reduced-motion disables the profile pill + menu transitions', /\.shop-profile-btn/.test(reducedMotionCss) && /\.shop-profile-menu/.test(reducedMotionCss));
  check('css: no standalone .btn-nav-outline rule remains (dead CSS removed)', !/\.btn-nav-outline\s*\{/.test(cssTopLevel));

  // ---------- 3. userEmail local (dropdown account header needs it) ----------
  check('server.js: global locals expose userEmail from the session', serverJs.includes('res.locals.userEmail = req.session.userEmail'));
  check('routes/auth.js: login + signup store the email in the session', authJs.includes('req.session.userEmail = user.email') && authJs.includes('req.session.userEmail = email'));
  check('routes/auth.js: email change updates the session email too', authJs.includes('req.session.userEmail = result.email'));

  // ---------- 4. Header renders (EJS) ----------
  const twoCats = [
    { id: 8, name: 'Home Appliances', totalProductCount: 3, image_url: '', children: [
      { id: 10, name: 'Kitchen', totalProductCount: 1, children: [] },
    ] },
    { id: 9, name: 'Winter Collection', totalProductCount: 1, image_url: '', children: [] },
  ];
  async function renderHeader(locals) {
    return renderFile(headerPath, Object.assign({
      siteName: 'Goince', siteSettings: {}, cartCount: 0, search: '',
      menuCategories: twoCats, assetUrl: (p) => p,
    }, locals));
  }
  let outHtml = '';
  let inHtml = '';
  let inPhotoHtml = '';
  let inNoEmailHtml = '';
  try {
    outHtml = await renderHeader({ userName: '' });
  } catch (e) { check('header renders logged-out (EJS)', false, String(e && e.message)); }
  try {
    inHtml = await renderHeader({ userName: 'Rohim', userEmail: 'rohim@example.com', userPhotoUrl: null });
  } catch (e) { check('header renders logged-in (EJS)', false, String(e && e.message)); }
  try {
    inPhotoHtml = await renderHeader({ userName: 'Rohim', userEmail: 'rohim@example.com', userPhotoUrl: '/uploads/customer-photo-7-1.webp' });
  } catch (e) { check('header renders logged-in with a photo (EJS)', false, String(e && e.message)); }
  try {
    inNoEmailHtml = await renderHeader({ userName: 'Rohim', userPhotoUrl: null });
  } catch (e) { check('header renders logged-in without userEmail local (EJS)', false, String(e && e.message)); }

  if (outHtml) {
    const nav = navBlock(outHtml);
    check('render logged-out: exactly ONE account button in the nav ("Login / Sign Up")',
      (nav.match(/btn-nav-solid/g) || []).length === 1 && nav.includes('>Login / Sign Up</a>'));
    check('render logged-out: no separate Login or Sign Up buttons anywhere in the nav', !nav.includes('>Login</a>') && !nav.includes('>Sign Up</a>'));
    check('render logged-out: no avatar in the nav', !nav.includes('shop-user-avatar'));
    check('render logged-out: theme toggle sits immediately before the login button (toggle, then button, nothing between)',
      inOrder(nav, ['class="theme-toggle-btn"', 'href="/login" class="btn-nav-solid">Login / Sign Up</a>'])
      && nav.indexOf('btn-nav-solid">Login / Sign Up') > nav.indexOf('theme-toggle-btn'));
    check('render logged-out: the login button is the LAST element in the header nav', nav.trimEnd().endsWith('Login / Sign Up</a>'));
    check('render logged-out: no login button in the mobile top row (drawer only)', !mobileTopRow(outHtml).includes('href="/login"'));
    check('render logged-out: drawer still has Login / Sign Up links', outHtml.includes('href="/login" class="shop-drawer-link"') && outHtml.includes('href="/signup" class="shop-drawer-link"'));
  }
  if (inHtml) {
    const nav = navBlock(inHtml);
    check('render logged-in: profile pill present (avatar + name + chevron, aria-haspopup/expanded/controls)',
      nav.includes('id="shop-profile-btn"') && nav.includes('aria-haspopup="true"') && nav.includes('aria-expanded="false"')
      && nav.includes('aria-controls="shop-profile-menu"') && nav.includes('shop-profile-caret') && nav.includes('Rohim'));
    check('render logged-in: NO separate Wishlist or Logout text links in the nav', !/<a href="\/wishlist">Wishlist<\/a>/.test(nav) && !/<a href="\/logout">Logout<\/a>/.test(nav));
    check('render logged-in: dropdown menu present with account header (name + email)',
      nav.includes('id="shop-profile-menu"') && nav.includes('shop-profile-head-name">Rohim<') && nav.includes('shop-profile-head-email">rohim@example.com<'));
    check('render logged-in: dropdown items in order My Profile / My Orders / Wishlist / Track Order / divider / Logout',
      inOrder(nav, ['href="/account/profile" class="shop-profile-link">', 'href="/account" class="shop-profile-link">', 'href="/wishlist" class="shop-profile-link">', 'href="/track-order" class="shop-profile-link">', 'shop-profile-divider', 'href="/logout" class="shop-profile-link">']));
    check('render logged-in: theme toggle sits immediately before the profile pill (toggle, then pill, account last)',
      inOrder(nav, ['class="theme-toggle-btn"', 'id="shop-profile-btn"'])
      && nav.trimEnd().endsWith('</div>') && nav.lastIndexOf('shop-profile-wrap') > nav.indexOf('theme-toggle-btn'));
    check('render logged-in: initial-letter circle (R) when no photo, in pill AND menu head',
      (nav.match(/>R</g) || []).length >= 2 && !nav.includes('customer-photo-'));
    check('render logged-in: drawer still has the account block + theme toggle', inHtml.includes('shop-drawer-account') && inHtml.includes('shop-drawer-theme'));
  }
  if (inPhotoHtml) {
    const nav = navBlock(inPhotoHtml);
    check('render logged-in with photo: avatar img in the pill AND in the menu head',
      (nav.match(/<img src="\/uploads\/customer-photo-7-1\.webp"/g) || []).length === 2);
  }
  if (inNoEmailHtml) {
    check('render logged-in without userEmail: no email line in the menu head (no crash, no empty line)', !inNoEmailHtml.includes('shop-profile-head-email'));
  }

  // ---------- 5. Profile dropdown IIFE behaviour (real code, stubbed DOM) ----------
  const marker = '// Shop profile dropdown (fix/header-account-menu)';
  const pStart = megaMenuJs.indexOf(marker);
  const pEnd = pStart > 0 ? megaMenuJs.indexOf('})();', pStart) + 5 : -1;
  const pCode = pStart > 0 ? megaMenuJs.slice(pStart, pEnd) : '';
  check('profile IIFE: extractable from mega-menu.js', pStart > 0 && pCode.includes("querySelector('.shop-profile-wrap')"));
  check('profile IIFE: click is the ONLY way to open it (exactly one setOpen(true), inside the button click handler)',
    (pCode.match(/setOpen\(true\)/g) || []).length === 1);
  check('profile IIFE: closes the mega menu when it opens', pCode.includes("getElementById('mega-menu-panel')") && pCode.includes("classList.remove('open')"));
  check('profile IIFE: Categories click + hover close the profile menu', pCode.includes("megaBtn.addEventListener('click'") && pCode.includes("megaWrap.addEventListener('mouseenter'"));

  function makeStubEl(name) {
    const el = {
      _name: name,
      _classes: new Set(),
      _attrs: {},
      _handlers: {},
      _focused: false,
      classList: {
        add(c) { el._classes.add(c); },
        remove(c) { el._classes.delete(c); },
        toggle(c, f) {
          if (f === undefined) { if (el._classes.has(c)) { el._classes.delete(c); return false; } el._classes.add(c); return true; }
          if (f) el._classes.add(c); else el._classes.delete(c);
          return !!f;
        },
        contains(c) { return el._classes.has(c); },
      },
      setAttribute(k, v) { el._attrs[k] = String(v); },
      getAttribute(k) { return el._attrs[k] === undefined ? null : el._attrs[k]; },
      addEventListener(type, fn) { (el._handlers[type] = el._handlers[type] || []).push(fn); },
      fire(type, ev) { (el._handlers[type] || []).forEach((fn) => fn(ev || {})); },
      focus() { el._focused = true; },
      contains(target) { return target === el || (el._inside || []).includes(target); },
    };
    return el;
  }

  function runProfileScenario() {
    const wrap = makeStubEl('wrap');
    const btn = makeStubEl('btn');
    // The real markup renders aria-expanded="false" on the pill button —
    // mirror that initial state in the stub (the IIFE only writes the
    // attribute when setOpen runs).
    btn.setAttribute('aria-expanded', 'false');
    const menu = makeStubEl('menu');
    const megaBtn = makeStubEl('megaBtn');
    const megaWrap = makeStubEl('megaWrap');
    const megaPanel = makeStubEl('megaPanel');
    const outside = makeStubEl('outside');
    const innerLink = makeStubEl('innerLink');
    wrap._inside = [btn, menu, innerLink];
    const docHandlers = {};
    const sandbox = {
      document: {
        querySelector(sel) {
          if (sel === '.shop-profile-wrap') return wrap;
          if (sel === '.mega-menu-wrap') return megaWrap;
          return null;
        },
        getElementById(id) {
          if (id === 'shop-profile-btn') return btn;
          if (id === 'shop-profile-menu') return menu;
          if (id === 'mega-menu-btn') return megaBtn;
          if (id === 'mega-menu-panel') return megaPanel;
          return null;
        },
        addEventListener(type, fn) { (docHandlers[type] = docHandlers[type] || []).push(fn); },
      },
    };
    vm.runInNewContext(pCode, sandbox);
    const ev = { stopPropagation() {}, relatedTarget: null };
    const fireDoc = (type, e) => { (docHandlers[type] || []).forEach((fn) => fn(e || {})); };
    return {
      wrap, btn, menu, megaBtn, megaWrap, megaPanel, outside, innerLink, ev, fireDoc,
      isOpen: () => menu.classList.contains('open'),
      expanded: () => btn.getAttribute('aria-expanded'),
      clickBtn() { btn.fire('click', ev); },
      clickMegaBtn() { megaBtn.fire('click', ev); },
      hoverMegaWrap() { megaWrap.fire('mouseenter', ev); },
      clickOutside() { fireDoc('click', { target: outside }); },
      clickInside() { fireDoc('click', { target: innerLink }); },
      pressEsc() { fireDoc('keydown', { key: 'Escape' }); },
      focusOut(target) { wrap.fire('focusout', { relatedTarget: target }); },
    };
  }

  let sc = runProfileScenario();
  check('behaviour: starts closed (aria-expanded false)', !sc.isOpen() && sc.expanded() === 'false');
  sc.clickBtn();
  check('behaviour: click opens + aria-expanded true', sc.isOpen() && sc.expanded() === 'true');
  sc.clickBtn();
  check('behaviour: click again closes (toggle) + aria-expanded false', !sc.isOpen() && sc.expanded() === 'false');
  sc.clickBtn();
  sc.clickOutside();
  check('behaviour: outside click closes', !sc.isOpen() && sc.expanded() === 'false');
  sc.clickBtn();
  sc.clickInside();
  check('behaviour: click inside the menu does NOT close it', sc.isOpen());
  sc.pressEsc();
  check('behaviour: Esc closes + focus returns to the pill button', !sc.isOpen() && sc.btn._focused);
  sc.clickBtn();
  sc.focusOut(sc.outside);
  check('behaviour: Tab out (focusout to outside) closes', !sc.isOpen());
  sc.clickBtn();
  sc.focusOut(sc.innerLink);
  check('behaviour: focus moving inside the menu does NOT close it', sc.isOpen());
  sc = runProfileScenario();
  sc.megaPanel.classList.add('open');
  sc.megaBtn.setAttribute('aria-expanded', 'true');
  sc.clickBtn();
  check('behaviour: opening the profile menu closes the mega menu panel', !sc.megaPanel.classList.contains('open') && sc.megaBtn.getAttribute('aria-expanded') === 'false' && sc.isOpen());
  sc = runProfileScenario();
  sc.clickBtn();
  sc.clickMegaBtn();
  check('behaviour: clicking Categories closes the profile menu', !sc.isOpen() && sc.expanded() === 'false');
  sc = runProfileScenario();
  sc.clickBtn();
  sc.hoverMegaWrap();
  check('behaviour: hovering Categories closes the profile menu', !sc.isOpen() && sc.expanded() === 'false');

  console.log(`\n${passes.length} passed, ${failures.length} failed.`);
  if (failures.length) { console.log('Failures: ' + failures.join(', ')); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
