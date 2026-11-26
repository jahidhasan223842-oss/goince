// Dropdown animations (fix/dropdown-animations) — smooth open/close,
// staggered items and a click effect for the admin top-bar dropdowns.
//
// donal asked (2026-11-26 12:14, with a screenshot of the Shop dropdown
// open on the dashboard in dark mode): the dropdowns he has seen
// elsewhere open with many kinds of transitions and styles, and a click
// gives a nice effect — is there such a system? Yes, and this is it.
// ADMIN ONLY — the shop mega menu / category pills are out of scope.
//
// What was built (all in the one-line WHMCS-blue top bar, PR #62):
//   1. OPEN: every top-bar panel (top-nav menus, bell/profile dropdowns,
//      search panel) fades + slides down — opacity 0 / translateY(-6px)
//      -> opacity 1 / translateY(0) in .2s ease-out.
//   2. STAGGER: items inside an opening menu cascade in one after
//      another — @keyframes admin-menu-item-in (opacity + 4px rise),
//      25ms per item (nth-of-type), capped at 175ms, so even the
//      7-link Shop menu finishes fast.
//   3. CLICK: :active dips the item (lift -3px -> -1px) + scale(.98) +
//      a brightness dip — pure CSS, instant, never delays navigation.
//   4. CLOSE: the reverse — fade + slide up in .15s. The menus are
//      hidden with VISIBILITY, never display:none: the hidden state
//      carries `visibility 0s linear .15s`, so removing .open (Esc,
//      outside-click, focusout, hovering another group) plays the
//      fade/slide-up and visibility flips to hidden only AFTER the
//      transition — no JS timeout or transitionend listener is needed,
//      and a menu can never stay invisible-but-clickable. Re-opening
//      mid-fade just reverses the transition.
//   5. SAFETY: prefers-reduced-motion disables all of it (instant
//      open/close, no stagger, no press). transform + opacity ONLY —
//      no layout animation. Keyboard behaviour unchanged.
//   6. The entrance animation uses fill mode `backwards` (NOT both /
//      forwards) — during the delay the item shows the from-keyframe,
//      and once the entrance ends NO fill applies, so the hover lift
//      (translateY(-3px), PR #61/#62) works exactly as before; the
//      entrance never fights it.
//
// No live MySQL needed: CSS/EJS source checks + a direct EJS render of
// the header (same menus/links, no link removed or reordered).
//
// Run:  node scripts/test-dropdown-animations.js
// Exit code 0 = all checks passed.
'use strict';

const fs = require('fs');
const path = require('path');
const util = require('util');
const ejs = require('ejs');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'style.css'), 'utf8');
const headerEjs = fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', 'admin-header.ejs'), 'utf8');
const footerEjs = fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', 'admin-footer.ejs'), 'utf8');
const shopHeaderEjs = fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', 'header.ejs'), 'utf8');
const renderFile = util.promisify(ejs.renderFile);
const headerPath = path.join(__dirname, '..', 'views', 'partials', 'admin-header.ejs');

const failures = [];
const passes = [];
function check(name, ok, detail) {
  if (ok) { passes.push(name); console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

// Same helpers as test-whmcs-top-nav.js: top-level CSS (comments + all
// @media ranges stripped), the (hover: hover) blocks, and the
// prefers-reduced-motion blocks.
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
const hoverBlocks = extractRanges(cssNoComments, allMediaRanges(cssNoComments, '(hover: hover)'));
const reducedMotionBlocks = extractRanges(cssNoComments, allMediaRanges(cssNoComments, 'prefers-reduced-motion'));

// The rule body for a top-level selector (no nested braces in these rules).
function ruleBody(source, selectorRe) {
  const m = source.match(selectorRe);
  return m ? m[0] : null;
}
// Every top-level rule whose selector list contains `selector` (used to
// prove no display:none survives anywhere, including the mobile block).
function rulesWith(source, selector) {
  const out = [];
  const re = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{[^}]*\\}', 'g');
  let m;
  while ((m = re.exec(source)) !== null) out.push(m[0]);
  return out;
}

(async () => {
  // ---- 1. OPEN animation: visibility-based show/hide, fade + slide ----
  // Top-nav menu: hidden = visibility:hidden + opacity:0 + -6px slide,
  // with the close transition; .open / :hover / :focus-within = visible.
  check('top-nav menu hides with visibility + opacity + -6px slide (not display:none)',
    /\.admin-topnav-menu\s*\{[^}]*visibility:\s*hidden;[^}]*opacity:\s*0;[^}]*transform:\s*translateY\(-6px\);/.test(cssTopLevel)
    && !rulesWith(cssNoComments, '.admin-topnav-menu').some((r) => /display:\s*none;/.test(r)),
    'top-nav menu base rule wrong');
  check('top-nav menu .open shows with visibility + opacity + no slide',
    /\.admin-topnav-menu\.open\s*\{[^}]*visibility:\s*visible;[^}]*opacity:\s*1;[^}]*transform:\s*translateY\(0\);/.test(cssTopLevel)
    && !rulesWith(cssNoComments, '.admin-topnav-menu.open').some((r) => /display:/.test(r)),
    '.open rule wrong');
  check('top-nav menu hover/focus opens with the same fade + slide (not display:block)',
    /\.admin-topnav-dropdown:hover \.admin-topnav-menu,[\s\S]*?\.admin-topnav-dropdown:focus-within \.admin-topnav-menu\s*\{[^}]*visibility:\s*visible;[^}]*opacity:\s*1;[^}]*transform:\s*translateY\(0\);/.test(hoverBlocks),
    'hover/focus open rule wrong');

  // Bell / profile dropdowns: same hidden/open pair.
  check('bell/profile dropdown hides with visibility + opacity + -6px slide (not display:none)',
    /\.admin-dropdown-menu\s*\{[^}]*visibility:\s*hidden;[^}]*opacity:\s*0;[^}]*transform:\s*translateY\(-6px\);/.test(cssTopLevel)
    && !rulesWith(cssNoComments, '.admin-dropdown-menu').some((r) => /display:\s*none;/.test(r)),
    'dropdown menu base rule wrong');
  check('bell/profile dropdown .open shows with visibility + opacity + no slide',
    /\.admin-dropdown-menu\.open\s*\{[^}]*visibility:\s*visible;[^}]*opacity:\s*1;[^}]*transform:\s*translateY\(0\);/.test(cssTopLevel)
    && !rulesWith(cssNoComments, '.admin-dropdown-menu.open').some((r) => /display:/.test(r)),
    'dropdown .open rule wrong');

  // Search panel: same hidden/open pair (desktop panel + mobile row).
  check('search panel hides with visibility + opacity + -6px slide (not display:none)',
    /\.admin-topbar-search\s*\{[^}]*visibility:\s*hidden;[^}]*opacity:\s*0;[^}]*transform:\s*translateY\(-6px\);/.test(cssTopLevel)
    && !rulesWith(cssNoComments, '.admin-topbar-search').some((r) => /display:\s*none;/.test(r)),
    'search panel base rule wrong');
  check('search panel .open shows with visibility + opacity + no slide',
    /\.admin-topbar-search\.open\s*\{[^}]*visibility:\s*visible;[^}]*opacity:\s*1;[^}]*transform:\s*translateY\(0\);/.test(cssTopLevel),
    'search .open rule wrong');

  // Open timing: .2s ease-out on the open state.
  check('open transition is .2s ease-out (opacity + transform) on all three panels',
    /\.admin-topnav-menu\.open\s*\{[^}]*transition:\s*opacity \.2s ease, transform \.2s ease, visibility 0s;/.test(cssTopLevel)
    && /\.admin-dropdown-menu\.open\s*\{[^}]*transition:\s*opacity \.2s ease, transform \.2s ease, visibility 0s;/.test(cssTopLevel)
    && /\.admin-topbar-search\.open\s*\{[^}]*transition:\s*opacity \.2s ease, transform \.2s ease, visibility 0s;/.test(cssTopLevel),
    'open transition wrong');

  // ---- 2. CLOSE animation: hide-after-transition, no JS timeout ----
  check('close transition is .15s with the visibility flip delayed until after it',
    /\.admin-topnav-menu\s*\{[^}]*transition:\s*opacity \.15s ease, transform \.15s ease, visibility 0s linear \.15s;/.test(cssTopLevel)
    && /\.admin-dropdown-menu\s*\{[^}]*transition:\s*opacity \.15s ease, transform \.15s ease, visibility 0s linear \.15s;/.test(cssTopLevel)
    && /\.admin-topbar-search\s*\{[^}]*transition:\s*opacity \.15s ease, transform \.15s ease, visibility 0s linear \.15s;/.test(cssTopLevel),
    'close transition wrong');
  check('JS close paths still just remove .open (the CSS plays the close) — no timeout/transitionend needed',
    /function closeAdminDropdowns[\s\S]*?menu\.classList\.remove\('open'\)/.test(footerEjs)
    && /function closeAdminSearch[\s\S]*?form\.classList\.remove\('open'\)/.test(footerEjs)
    && !/setTimeout\(\s*function[\s\S]{0,200}classList\.remove\('open'\)/.test(footerEjs)
    && /CLOSE ANIMATION \(fix\/dropdown-animations\)/.test(footerEjs),
    'close paths changed or undocumented');

  // ---- 3. STAGGER: keyframes + per-item delays, capped under 200ms ----
  check('item entrance keyframes fade + rise 4px to full opacity',
    /@keyframes admin-menu-item-in\s*\{\s*from\s*\{\s*opacity:\s*0;\s*transform:\s*translateY\(4px\);\s*\}\s*to\s*\{\s*opacity:\s*1;\s*transform:\s*translateY\(0\);\s*\}\s*\}/.test(css),
    'keyframes missing or wrong');
  check('stagger animation applies to top-nav links (open/hover/focus) and dropdown links',
    /\.admin-topnav-menu\.open \.admin-topnav-menu-link,[\s\S]*?\.admin-topnav-dropdown:hover \.admin-topnav-menu-link,[\s\S]*?\.admin-topnav-dropdown:focus-within \.admin-topnav-menu-link,[\s\S]*?\.admin-dropdown-menu\.open a\s*\{\s*animation:\s*admin-menu-item-in \.18s ease-out backwards;/.test(css),
    'stagger animation rule missing');
  const delays = [...css.matchAll(/animation-delay:\s*(\d+)ms;/g)].map((m) => Number(m[1]));
  check('stagger delays increase in 25ms steps and the last is under 200ms',
    delays.length === 7
    && delays.every((d, i) => d === (i + 1) * 25)
    && Math.max(...delays) === 175,
    `delays=${JSON.stringify(delays)}`);
  check('stagger covers up to the 8th item (the longest menu has 7 links)',
    /\.admin-topnav-menu-link:nth-of-type\(8\)/.test(css)
    && /\.admin-dropdown-menu\.open a:nth-of-type\(8\)/.test(css),
    'nth-of-type(8) rule missing');

  // ---- 4. CLICK effect: :active press, instant, after the hover rules ----
  check('click/press rule dips + scales + dims menu items',
    /\.admin-topnav-menu-link:active,[\s\S]*?\.admin-dropdown-menu a:hover:active\s*\{[^}]*transform:\s*translateY\(-1px\) scale\(\.98\);[^}]*filter:\s*brightness\(\.96\);/.test(css),
    'press rule missing or wrong');
  check('press rule sits AFTER the hover rules (so it wins at equal specificity)',
    css.indexOf('.admin-dropdown-menu a:hover') < css.indexOf('.admin-dropdown-menu a:active')
    && css.indexOf('.admin-topnav-menu-link:hover') < css.indexOf('.admin-topnav-menu-link:active'),
    'press rule order wrong');

  // ---- 5. REDUCED MOTION disables everything ----
  check('prefers-reduced-motion: menus open/close instantly (transition none)',
    /\.admin-topnav-menu,[\s\S]*?\.admin-topbar-search\s*\{\s*transition:\s*none;\s*\}/.test(reducedMotionBlocks),
    'reduced-motion transition rule missing');
  check('prefers-reduced-motion: no stagger (animation none) and no press effect',
    /\.admin-topnav-menu-link,[\s\S]*?\.admin-dropdown-menu a\s*\{\s*animation:\s*none;\s*\}/.test(reducedMotionBlocks)
    && /\.admin-topnav-menu-link:active,[\s\S]*?\.admin-dropdown-menu a:active\s*\{\s*transform:\s*none;\s*filter:\s*none;\s*\}/.test(reducedMotionBlocks),
    'reduced-motion animation/press rules missing');

  // ---- 6. HOVER LIFT still works and is not overridden by the entrance ----
  check('hover lift on menu items is unchanged (lavender + -3px + shadow)',
    /\.admin-dropdown-menu a:hover\s*\{[^}]*background:\s*var\(--dropdown-hover\);[^}]*transform:\s*translateY\(-3px\);[^}]*box-shadow:/.test(hoverBlocks)
    && /\.admin-topnav-menu-link:hover\s*\{[^}]*background:\s*var\(--dropdown-hover\);[^}]*transform:\s*translateY\(-3px\);[^}]*box-shadow:/.test(hoverBlocks),
    'hover lift changed');
  check('entrance uses fill mode backwards (not both/forwards) so it never overrides the hover lift',
    // cssNoComments: the convention comment itself says "NOT both /
    // forwards", so the words must not be searched in the raw CSS.
    /animation:\s*admin-menu-item-in \.18s ease-out backwards;/.test(cssNoComments)
    && !/admin-menu-item-in[^;]*\b(both|forwards)\b/.test(cssNoComments),
    'entrance fill mode wrong');
  check('entrance animates opacity + transform only (no layout property)',
    /@keyframes admin-menu-item-in\s*\{[^}]*transform:[^}]*\}/.test(css)
    && !/@keyframes admin-menu-item-in[\s\S]*?\b(width|height|margin|padding|top|left)\b/.test(css.split('@media (max-width: 1024px)')[0]),
    'keyframes animate a layout property');

  // ---- 7. SHOP UNTOUCHED: no animation leaked into the shop header/mega menu ----
  check('shop header and mega menu have no dropdown-animation rules',
    !shopHeaderEjs.includes('admin-menu-item-in')
    && !/\.mega-menu-panel[^{]*\{[^}]*animation:/.test(cssTopLevel)
    && !/\.mega-menu-panel[^{]*\{[^}]*admin-menu-item-in/.test(css),
    'animation leaked into the shop');

  // ---- 8. HEADER RENDER: same menus/links, nothing removed or reordered ----
  const rendered = await renderFile(headerPath, { siteName: 'Goince' });
  const topnavHrefs = [...rendered.matchAll(/<a href="([^"]+)" class="admin-topnav-menu-link/g)].map((m) => m[1]);
  const expectedHrefs = [
    '/admin/products', '/admin/products/import', '/admin/attributes', '/admin/stock-alerts',
    '/admin/categories', '/admin/banners', '/admin/inventory',
    '/admin/invoices', '/admin/activity', '/admin/reports', '/admin/customers',
    '/admin/coupons', '/admin/payment-methods', '/admin/delivery-zones',
    '/admin/chats', '/admin/messages', '/admin/reviews',
    '/admin/settings', '/admin/test-email', '/admin/staff', '/admin/roles',
  ];
  check('rendered top-nav menus still contain the same 21 links in the same order',
    JSON.stringify(topnavHrefs) === JSON.stringify(expectedHrefs),
    `got ${JSON.stringify(topnavHrefs)}`);
  check('rendered header still has the bell menu, profile menu, search panel and Dashboard link',
    rendered.includes('id="admin-bell-menu"')
    && rendered.includes('id="admin-user-menu"')
    && rendered.includes('id="admin-topbar-search"')
    && rendered.includes('id="admin-topbar-search-btn"')
    // No closing quote: on the default path the Dashboard link also
    // carries `is-active`.
    && rendered.includes('href="/admin/dashboard" class="admin-topnav-link'),
    'a top-bar panel is missing from the render');
  check('rendered header still has the four dropdown groups (Shop/Sales/Communication/System)',
    ['Shop', 'Sales', 'Communication', 'System'].every((g) => rendered.includes(`>${g} <span class="admin-topnav-chevron"`)),
    'a nav group is missing from the render');

  console.log(`\n${passes.length} passed, ${failures.length} failed`);
  if (failures.length) { console.log('FAILED: ' + failures.join(' | ')); process.exitCode = 1; }
})().catch((e) => { console.error('SUITE ERROR:', e); process.exitCode = 1; });
