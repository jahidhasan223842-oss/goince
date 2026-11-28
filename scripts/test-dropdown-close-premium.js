// Dropdown close behaviour + premium motion (fix/dropdown-close-premium)
// — the sticky-menu fix for PR #63's animations.
//
// PR #63 added the dropdown animations, and a live inspection (donal
// signed in himself, light mode, 2026-11-26) confirmed the open
// animation IS live — but found the menus STUCK open: mouse-away did
// not close Shop, Esc did not close it, opening Communication left
// Shop open too (both overlapping), clicking the Shop button while
// hovering did not close it, and hovering Dashboard closed
// Communication but left Shop open. donal said the style "doesn't
// look good, doesn't feel advanced".
//
// ROOT CAUSE (in code): TWO open mechanisms were alive at once. CSS
// :hover / :focus-within opened the top-nav menus, while the JS close
// functions only removed the .open class — a CSS-hovered menu
// therefore ignored every JS close while the pointer stayed over it,
// and there was no mouseleave handler at all. Fixed here by making
// the JS .open class the SINGLE source of truth (public/js/
// admin-dropdowns.js): CSS never opens a menu any more.
//
// What was built:
//   1. CLOSE LOGIC (all in admin-dropdowns.js): mouseenter opens a
//      top-nav group and closes the others; mouseleave closes it
//      after a 150ms grace unless it was latched by a click;
//      click toggles the latch, and clicking the same button while
//      hovering closes it without hover instantly re-opening it (no
//      new mouseenter fires while the pointer stays put); Esc closes
//      every open menu + the search panel and returns focus to the
//      button that opened it (guarded so its own focusin does not
//      reopen the menu); hovering the Dashboard link closes any open
//      menu; keyboard focusin opens the top-nav menu (replaces the
//      old CSS :focus-within) — keyboard focus only, via
//      :focus-visible, so a mouse click's focusin cannot break the
//      click toggle; focusout closes when focus leaves the group.
//      Hover-opening is gated on hover capability, exactly like the
//      old CSS @media (hover: hover) — on touch a tap only toggles
//      the latch.
//   2. PREMIUM MOTION: the open is now a soft spring — @keyframes
//      admin-menu-open (fade + slide + scale .96 -> 1, .25s,
//      cubic-bezier(.22, 1.25, .36, 1): one gentle overshoot that
//      settles, no oscillation), transform-origin at the top edge,
//      and the panel shadow deepens as it settles. The close stays
//      quick (.15s, fade + slide up, NO scale). The stagger is more
//      visible: 30ms steps, .2s per item, capped at 210ms, and it
//      runs on EVERY menu (top-nav, bell, profile) because it is
//      tied to .open, not to :hover.
//   3. The close animation itself is unchanged (visibility flip
//      after the .15s transition, no JS timeout for the close); the
//      150ms mouseleave grace is a HOVER-INTENT delay, not a close
//      timeout.
//
// No live MySQL needed: CSS/JS source checks + the REAL menu JS run
// against a stub DOM (MiniDOM below — no jsdom in node_modules) +
// a direct EJS render of the header.
//
// Run:  node scripts/test-dropdown-close-premium.js
// Exit code 0 = all checks passed.
'use strict';

const fs = require('fs');
const path = require('path');
const util = require('util');
const ejs = require('ejs');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'style.css'), 'utf8');
const headerEjs = fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', 'admin-header.ejs'), 'utf8');
const footerEjs = fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', 'admin-footer.ejs'), 'utf8');
const dropdownJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'admin-dropdowns.js'), 'utf8');
const assetsJs = fs.readFileSync(path.join(__dirname, '..', 'lib', 'assets.js'), 'utf8');
const renderFile = util.promisify(ejs.renderFile);
const headerPath = path.join(__dirname, '..', 'views', 'partials', 'admin-header.ejs');

const failures = [];
const passes = [];
function check(name, ok, detail) {
  if (ok) { passes.push(name); console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Same helpers as test-dropdown-animations.js: top-level CSS (comments
// + all @media ranges stripped), the (hover: hover) blocks, and the
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

// ------------------------------------------------------------------
// MiniDOM: just enough of a DOM for admin-dropdowns.js to run its
// REAL handlers — elements with classList, attributes, parents,
// listeners, bubbling dispatch, closest/contains, focus().
// ------------------------------------------------------------------
function matchesSelector(el, sel) {
  if (!sel || !el) return false;
  if (sel === ':focus-visible') return !!el._focusVisible;
  let rest = sel;
  let m = rest.match(/^([a-zA-Z][a-zA-Z0-9]*)?/);
  const tag = m && m[1] ? m[1].toUpperCase() : null;
  if (tag) rest = rest.slice(tag.length);
  if (tag && el.tagName !== tag) return false;
  while (rest.length) {
    if (rest[0] === '#') {
      const id = rest.slice(1).split(/[.\[]/)[0];
      if (el.id !== id) return false;
      rest = rest.slice(1 + id.length);
    } else if (rest[0] === '.') {
      const cls = rest.slice(1).split(/[.\[]/)[0];
      if (!el.classList.contains(cls)) return false;
      rest = rest.slice(1 + cls.length);
    } else if (rest[0] === '[') {
      const close = rest.indexOf(']');
      const inner = rest.slice(1, close);
      const eq = inner.indexOf('=');
      if (eq === -1) {
        if (el.getAttribute(inner) === null) return false;
      } else {
        const name = inner.slice(0, eq);
        const value = inner.slice(eq + 1).replace(/^["']|["']$/g, '');
        if (el.getAttribute(name) !== value) return false;
      }
      rest = rest.slice(close + 1);
    } else {
      return false;
    }
  }
  return true;
}

function buildDoc() {
  const doc = {
    activeElement: null,
    defaultView: undefined,
    _listeners: {},
    _roots: [],
    addEventListener(type, fn) { (doc._listeners[type] = doc._listeners[type] || []).push(fn); },
    querySelectorAll(sel) {
      const out = [];
      const walk = (el) => {
        for (const child of el.children) {
          if (matchesSelector(child, sel)) out.push(child);
          walk(child);
        }
      };
      for (const root of doc._roots) { if (matchesSelector(root, sel)) out.push(root); walk(root); }
      return out;
    },
    querySelector(sel) { return doc.querySelectorAll(sel)[0] || null; },
    getElementById(id) { return doc.querySelector('#' + id); },
  };

  function makeEl(tag, opts) {
    opts = opts || {};
    const el = {
      tagName: tag.toUpperCase(),
      id: opts.id || '',
      _classes: new Set((opts.cls || '').split(/\s+/).filter(Boolean)),
      _attrs: Object.assign({}, opts.attrs || {}),
      parentElement: null,
      children: [],
      _listeners: {},
      _focusVisible: opts.focusVisible !== undefined ? opts.focusVisible : true,
      classList: null, // set below (needs `el`)
      setAttribute(k, v) { el._attrs[k] = String(v); },
      getAttribute(k) { return el._attrs[k] === undefined ? null : el._attrs[k]; },
      addEventListener(type, fn) { (el._listeners[type] = el._listeners[type] || []).push(fn); },
      matches(sel) { return matchesSelector(el, sel); },
      closest(sel) {
        let n = el;
        while (n) { if (matchesSelector(n, sel)) return n; n = n.parentElement; }
        return null;
      },
      contains(node) {
        let n = node;
        while (n) { if (n === el) return true; n = n.parentElement; }
        return false;
      },
      focus() { focusEl(el); },
      querySelector(sel) { return el.querySelectorAll(sel)[0] || null; },
      querySelectorAll(sel) {
        const out = [];
        const walk = (node) => {
          for (const child of node.children) {
            if (matchesSelector(child, sel)) out.push(child);
            walk(child);
          }
        };
        walk(el);
        return out;
      },
    };
    el.classList = {
      add(c) { el._classes.add(c); },
      remove(c) { el._classes.delete(c); },
      toggle(c, force) {
        if (force === undefined) {
          if (el._classes.has(c)) { el._classes.delete(c); return false; }
          el._classes.add(c); return true;
        }
        if (force) el._classes.add(c); else el._classes.delete(c);
        return !!force;
      },
      contains(c) { return el._classes.has(c); },
    };
    return el;
  }

  function append(parent, child) {
    child.parentElement = parent;
    parent.children.push(child);
    return child;
  }

  // Dispatch an event on `target`, bubbling up to the document unless
  // bubbles:false (mouseenter/mouseleave do not bubble).
  function fire(target, type, props, bubbles) {
    const ev = Object.assign({
      type, target, currentTarget: null, _stopped: false,
      stopPropagation() { this._stopped = true; },
      preventDefault() {},
    }, props || {});
    if (bubbles === false) {
      ev.currentTarget = target;
      for (const fn of ((target._listeners && target._listeners[type]) || []).slice()) fn(ev);
      return ev;
    }
    const chain = [];
    let node = target;
    while (node) { chain.push(node); node = node.parentElement || null; }
    if (chain[chain.length - 1] !== doc) chain.push(doc);
    for (const n of chain) {
      if (ev._stopped) break;
      ev.currentTarget = n;
      for (const fn of ((n._listeners && n._listeners[type]) || []).slice()) fn(ev);
      if (ev._stopped) break;
    }
    return ev;
  }

  function focusEl(el) {
    const prev = doc.activeElement;
    doc.activeElement = el;
    if (prev && prev !== el) fire(prev, 'focusout', { relatedTarget: el });
    fire(el, 'focusin', { relatedTarget: prev || null });
  }

  // Top bar skeleton: Dashboard link, two top-nav groups, bell,
  // profile, search — the same structure as admin-header.ejs.
  const topbar = makeEl('div', { cls: 'admin-topbar' });
  doc._roots.push(topbar);
  const dashboardLink = append(topbar, makeEl('a', { cls: 'admin-topnav-link' }));
  const shopWrap = append(topbar, makeEl('div', { cls: 'admin-topnav-dropdown' }));
  const shopBtn = append(shopWrap, makeEl('button', { attrs: { 'data-topnav-btn': '' } }));
  const shopMenu = append(shopWrap, makeEl('div', { cls: 'admin-topnav-menu' }));
  append(shopMenu, makeEl('a', { cls: 'admin-topnav-menu-link' }));
  append(shopMenu, makeEl('a', { cls: 'admin-topnav-menu-link' }));
  append(shopMenu, makeEl('a', { cls: 'admin-topnav-menu-link' }));
  const salesWrap = append(topbar, makeEl('div', { cls: 'admin-topnav-dropdown' }));
  const salesBtn = append(salesWrap, makeEl('button', { attrs: { 'data-topnav-btn': '' } }));
  const salesMenu = append(salesWrap, makeEl('div', { cls: 'admin-topnav-menu' }));
  append(salesMenu, makeEl('a', { cls: 'admin-topnav-menu-link' }));
  append(salesMenu, makeEl('a', { cls: 'admin-topnav-menu-link' }));
  const bellWrap = append(topbar, makeEl('div', { cls: 'admin-topbar-dropdown' }));
  const bellBtn = append(bellWrap, makeEl('button', { attrs: { 'data-dropdown-btn': '' } }));
  const bellMenu = append(bellWrap, makeEl('div', { cls: 'admin-dropdown-menu' }));
  append(bellMenu, makeEl('a', {}));
  append(bellMenu, makeEl('a', {}));
  const profileWrap = append(topbar, makeEl('div', { cls: 'admin-topbar-dropdown' }));
  const profileBtn = append(profileWrap, makeEl('button', { attrs: { 'data-dropdown-btn': '' } }));
  const profileMenu = append(profileWrap, makeEl('div', { cls: 'admin-dropdown-menu' }));
  append(profileMenu, makeEl('a', {}));
  append(profileMenu, makeEl('a', {}));
  const searchWrap = append(topbar, makeEl('div', { cls: 'admin-topbar-dropdown' }));
  const searchBtn = append(searchWrap, makeEl('button', { id: 'admin-topbar-search-btn' }));
  const searchForm = append(searchWrap, makeEl('form', { id: 'admin-topbar-search', cls: 'admin-topbar-search' }));
  const searchInput = append(searchForm, makeEl('input', { attrs: { name: 'q' } }));
  const bodyEl = makeEl('div', { cls: 'admin-content' });
  doc._roots.push(bodyEl);
  const outsideEl = makeEl('a', {});
  append(bodyEl, outsideEl);

  // Helpers the behaviour tests use to simulate real user input.
  function mouseClick(el) {
    // A real mouse click focuses the button first (not :focus-visible).
    el._focusVisible = false;
    focusEl(el);
    fire(el, 'click', {});
  }
  function keyClick(el) {
    // Keyboard activation (Enter/Space): the button is already
    // focused from Tab, so no new focusin fires.
    fire(el, 'click', {});
  }
  function keyFocus(el) {
    el._focusVisible = true;
    focusEl(el);
  }

  return {
    doc, fire, focusEl, mouseClick, keyClick, keyFocus,
    els: {
      dashboardLink, shopWrap, shopBtn, shopMenu, salesWrap, salesBtn,
      salesMenu, bellWrap, bellBtn, bellMenu, profileWrap, profileBtn,
      profileMenu, searchWrap, searchBtn, searchForm, searchInput,
      bodyEl, outsideEl, topbar,
    },
  };
}

(async () => {
  // ---- 1. PREMIUM OPEN MOTION: spring keyframes + .25s + scale ----
  check('panel open keyframes fade + slide + scale (.96 -> 1)',
    /@keyframes admin-menu-open\s*\{\s*from\s*\{\s*opacity:\s*0;\s*transform:\s*translateY\(-6px\) scale\(\.96\);\s*\}\s*to\s*\{\s*opacity:\s*1;\s*transform:\s*translateY\(0\) scale\(1\);\s*\}\s*\}/.test(css),
    'admin-menu-open keyframes missing or wrong');
  const spring = 'cubic-bezier\\(\\.22, 1\\.25, \\.36, 1\\)';
  check('open state runs the spring keyframe (.25s, soft-spring bezier) on all three panels',
    /\.admin-topnav-menu\.open\s*\{[^}]*animation:\s*admin-menu-open \.25s cubic-bezier\(\.22, 1\.25, \.36, 1\) backwards;/.test(cssTopLevel)
    && /\.admin-dropdown-menu\.open\s*\{[^}]*animation:\s*admin-menu-open \.25s cubic-bezier\(\.22, 1\.25, \.36, 1\) backwards;/.test(cssTopLevel)
    && /\.admin-topbar-search\.open\s*\{[^}]*animation:\s*admin-menu-open \.25s cubic-bezier\(\.22, 1\.25, \.36, 1\) backwards;/.test(cssTopLevel),
    'spring open animation missing');
  check('open transition is .25s with the spring bezier (opacity + transform + shadow) on all three panels',
    new RegExp('\\.admin-topnav-menu\\.open\\s*\\{[^}]*transition:\\s*opacity \\.25s ' + spring + ', transform \\.25s ' + spring + ', box-shadow \\.25s ' + spring + ', visibility 0s;').test(cssTopLevel)
    && new RegExp('\\.admin-dropdown-menu\\.open\\s*\\{[^}]*transition:\\s*opacity \\.25s ' + spring + ', transform \\.25s ' + spring + ', box-shadow \\.25s ' + spring + ', visibility 0s;').test(cssTopLevel)
    && new RegExp('\\.admin-topbar-search\\.open\\s*\\{[^}]*transition:\\s*opacity \\.25s ' + spring + ', transform \\.25s ' + spring + ', box-shadow \\.25s ' + spring + ', visibility 0s;').test(cssTopLevel),
    'open transition wrong');
  check('transform-origin is at the top edge (top left for top-nav, top right for the right-aligned panels)',
    /\.admin-topnav-menu\s*\{[^}]*transform-origin:\s*top left;/.test(cssTopLevel)
    && /\.admin-dropdown-menu\s*\{[^}]*transform-origin:\s*top right;/.test(cssTopLevel)
    && /\.admin-topbar-search\s*\{[^}]*transform-origin:\s*top right;/.test(cssTopLevel),
    'transform-origin wrong');
  check('panel shadow deepens as it settles (open shadow larger than the resting shadow)',
    /\.admin-topnav-menu\.open\s*\{[^}]*box-shadow:\s*0 20px 48px var\(--shadow-md\);/.test(cssTopLevel)
    && /\.admin-dropdown-menu\.open\s*\{[^}]*box-shadow:\s*0 20px 48px rgba\(0, 0, 0, \.32\);/.test(cssTopLevel)
    && /\.admin-topbar-search\.open\s*\{[^}]*box-shadow:\s*0 20px 48px rgba\(0, 0, 0, \.32\);/.test(cssTopLevel)
    && /\.admin-topnav-menu\s*\{[^}]*box-shadow:\s*0 12px 32px var\(--shadow-md\);/.test(cssTopLevel)
    && /\.admin-dropdown-menu\s*\{[^}]*box-shadow:\s*0 12px 32px rgba\(0, 0, 0, \.25\);/.test(cssTopLevel),
    'open/resting shadow wrong');

  // ---- 2. CLOSE: still quick (.15s), fade + slide only, NO scale ----
  check('close transition is still .15s with the visibility flip delayed until after it',
    /\.admin-topnav-menu\s*\{[^}]*transition:\s*opacity \.15s ease, transform \.15s ease, box-shadow \.15s ease, visibility 0s linear \.15s;/.test(cssTopLevel)
    && /\.admin-dropdown-menu\s*\{[^}]*transition:\s*opacity \.15s ease, transform \.15s ease, box-shadow \.15s ease, visibility 0s linear \.15s;/.test(cssTopLevel)
    && /\.admin-topbar-search\s*\{[^}]*transition:\s*opacity \.15s ease, transform \.15s ease, box-shadow \.15s ease, visibility 0s linear \.15s;/.test(cssTopLevel),
    'close transition wrong');
  check('hidden state has NO scale (close is fade + slide up only)',
    /\.admin-topnav-menu\s*\{[^}]*transform:\s*translateY\(-6px\);/.test(cssTopLevel)
    && /\.admin-dropdown-menu\s*\{[^}]*transform:\s*translateY\(-6px\);/.test(cssTopLevel)
    && /\.admin-topbar-search\s*\{[^}]*transform:\s*translateY\(-6px\);/.test(cssTopLevel)
    && !/\.admin-topnav-menu\s*\{[^}]*scale\(/.test(cssTopLevel)
    && !/\.admin-dropdown-menu\s*\{[^}]*scale\(/.test(cssTopLevel)
    && !/\.admin-topbar-search\s*\{[^}]*scale\(/.test(cssTopLevel),
    'hidden state has a scale');

  // ---- 3. CSS NEVER OPENS A MENU ANY MORE (the sticky-menu root cause) ----
  check('no CSS :hover / :focus-within rule opens the top-nav menu (JS owns the state now)',
    !/\.admin-topnav-dropdown:hover \.admin-topnav-menu/.test(cssNoComments)
    && !/\.admin-topnav-dropdown:focus-within \.admin-topnav-menu/.test(cssNoComments),
    'a CSS hover/focus open rule still exists');
  check('no :hover / :focus-within stagger selectors remain (stagger is tied to .open only)',
    !/\.admin-topnav-dropdown:hover \.admin-topnav-menu-link/.test(cssNoComments)
    && !/\.admin-topnav-dropdown:focus-within \.admin-topnav-menu-link/.test(cssNoComments),
    'a hover/focus stagger selector still exists');

  // ---- 4. STAGGER: .2s, 30ms steps, capped at 210ms, on every menu ----
  check('stagger animation applies to top-nav links and dropdown links via .open only',
    /\.admin-topnav-menu\.open \.admin-topnav-menu-link,\s*\.admin-dropdown-menu\.open a\s*\{\s*animation:\s*admin-menu-item-in \.2s ease-out backwards;/.test(css),
    'stagger animation rule missing');
  // Admin stagger delays ONLY (fix/shop-header-hover, PR #66: the
  // shop mega menu + pill dropdowns now have their own delays —
  // 30ms steps on .mega-col, 25ms steps on pill items — so the
  // collection must be scoped to the admin selectors, not the whole
  // file; the check itself is unchanged: 7 admin delays, 30..210ms.
  const delays = [...css.matchAll(/(?:admin-topnav-menu-link|admin-dropdown-menu)[^{]*\{[^}]*animation-delay:\s*(\d+)ms;/g)].map((m) => Number(m[1]));
  check('stagger delays increase in 30ms steps and the last is under 250ms',
    delays.length === 7
    && delays.every((d, i) => d === (i + 1) * 30)
    && Math.max(...delays) === 210,
    `delays=${JSON.stringify(delays)}`);
  check('stagger covers up to the 8th item on both menu types',
    /\.admin-topnav-menu\.open \.admin-topnav-menu-link:nth-of-type\(8\)/.test(css)
    && /\.admin-dropdown-menu\.open a:nth-of-type\(8\)/.test(css),
    'nth-of-type(8) rule missing');

  // ---- 5. REDUCED MOTION disables the spring too ----
  check('prefers-reduced-motion: panel spring disabled (animation none on .open)',
    /\.admin-topnav-menu\.open,[\s\S]*?\.admin-topbar-search\.open\s*\{\s*animation:\s*none;\s*\}/.test(reducedMotionBlocks),
    'reduced-motion panel animation rule missing');
  check('prefers-reduced-motion: menus still open/close instantly (transition none) and no stagger',
    /\.admin-topnav-menu,[\s\S]*?\.admin-topbar-search\s*\{\s*transition:\s*none;\s*\}/.test(reducedMotionBlocks)
    && /\.admin-topnav-menu-link,[\s\S]*?\.admin-dropdown-menu a\s*\{\s*animation:\s*none;\s*\}/.test(reducedMotionBlocks),
    'reduced-motion transition/stagger rules missing');

  // ---- 6. HOVER LIFT + PRESS still work, entrance still fill backwards ----
  check('hover lift on menu items is unchanged (lavender + -3px + shadow)',
    /\.admin-dropdown-menu a:hover\s*\{[^}]*background:\s*var\(--dropdown-hover\);[^}]*transform:\s*translateY\(-3px\);[^}]*box-shadow:/.test(hoverBlocks)
    && /\.admin-topnav-menu-link:hover\s*\{[^}]*background:\s*var\(--dropdown-hover\);[^}]*transform:\s*translateY\(-3px\);[^}]*box-shadow:/.test(hoverBlocks),
    'hover lift changed');
  check('click/press rule still dips + scales + dims menu items',
    /\.admin-topnav-menu-link:active,[\s\S]*?\.admin-dropdown-menu a:hover:active\s*\{[^}]*transform:\s*translateY\(-1px\) scale\(\.98\);[^}]*filter:\s*brightness\(\.96\);/.test(css),
    'press rule missing or wrong');
  check('item entrance still uses fill mode backwards (never overrides the hover lift)',
    /animation:\s*admin-menu-item-in \.2s ease-out backwards;/.test(cssNoComments)
    && !/admin-menu-item-in[^;]*\b(both|forwards)\b/.test(cssNoComments),
    'entrance fill mode wrong');

  // ---- 7. WIRING: one module owns the dropdowns, footer loads it ----
  check('admin-dropdowns.js exists, exports its init, and the footer loads it (cache-busted)',
    dropdownJs.includes('function initAdminDropdowns(doc)')
    && dropdownJs.includes('module.exports = initAdminDropdowns')
    && /assetUrl\('\/js\/admin-dropdowns\.js'\)/.test(footerEjs)
    && assetsJs.includes("'js/admin-dropdowns.js'"),
    'dropdown module wiring missing');
  check('the footer no longer contains dropdown handler code (single source of truth)',
    !/closeAdminDropdowns|closeAdminSearch|data-topnav-btn/.test(footerEjs),
    'old inline dropdown code still in the footer');
  check('dropdown JS has the mouseleave grace, Esc focus return, focus-visible gate and Dashboard close',
    /HOVER_CLOSE_DELAY_MS = 150/.test(dropdownJs)
    && /ESC_FOCUS_SUPPRESS_MS = 500/.test(dropdownJs)
    && /wrap\.addEventListener\('mouseleave'/.test(dropdownJs)
    && /lastOpenerBtn\.focus\(\)/.test(dropdownJs)
    && /matches\(':focus-visible'\)/.test(dropdownJs)
    && /querySelectorAll\('\.admin-topnav-link'\)/.test(dropdownJs)
    && /closeAdminDropdowns\(null\)/.test(dropdownJs),
    'a required handler is missing from the module');

  // ---- 8. REAL BEHAVIOUR: the module's handlers against a stub DOM ----
  const initAdminDropdowns = require(path.join(__dirname, '..', 'public', 'js', 'admin-dropdowns.js'));
  const built = buildDoc();
  const { doc, fire, focusEl, mouseClick, keyClick, keyFocus, els } = built;
  const api = initAdminDropdowns(doc);
  check('init returns the close API + the 150ms hover grace constant',
    api && typeof api.closeAdminDropdowns === 'function'
    && typeof api.closeAdminSearch === 'function'
    && api.HOVER_CLOSE_DELAY_MS === 150,
    'init API wrong');
  const isOpen = (menu) => menu.classList.contains('open');
  const isExpanded = (btn) => btn.getAttribute('aria-expanded') === 'true';

  // 8a. Hover opens Shop; hovering Sales closes Shop (one at a time).
  fire(els.shopWrap, 'mouseenter', {}, false);
  check('mouseenter on Shop opens its menu (and sets aria-expanded)',
    isOpen(els.shopMenu) && isExpanded(els.shopBtn) && !isOpen(els.salesMenu),
    'hover did not open Shop');
  fire(els.salesWrap, 'mouseenter', {}, false);
  check('mouseenter on Sales closes Shop and opens Sales (one menu at a time)',
    isOpen(els.salesMenu) && isExpanded(els.salesBtn)
    && !isOpen(els.shopMenu) && !isExpanded(els.shopBtn),
    'opening Sales did not close Shop');

  // 8b. Mouseleave closes a hover-opened menu after the grace.
  fire(els.salesWrap, 'mouseleave', {}, false);
  check('menu is still open inside the 150ms mouseleave grace',
    isOpen(els.salesMenu),
    'menu closed instantly on mouseleave');
  await sleep(api.HOVER_CLOSE_DELAY_MS + 70);
  check('mouseleave closes a hover-opened menu after the grace',
    !isOpen(els.salesMenu) && !isExpanded(els.salesBtn),
    'mouseleave did not close the menu');

  // 8c. Re-entering inside the grace cancels the pending close.
  fire(els.shopWrap, 'mouseenter', {}, false);
  fire(els.shopWrap, 'mouseleave', {}, false);
  await sleep(50);
  fire(els.shopWrap, 'mouseenter', {}, false);
  await sleep(api.HOVER_CLOSE_DELAY_MS + 70);
  check('re-entering inside the grace cancels the pending close',
    isOpen(els.shopMenu),
    'menu closed despite re-entering');
  fire(els.bodyEl, 'click', {});

  // 8d. Click latches: mouseleave must NOT close a latched menu.
  mouseClick(els.shopBtn);
  check('click on a closed menu opens + latches it',
    isOpen(els.shopMenu) && els.shopWrap._adminLatched === true,
    'click did not latch the menu open');
  fire(els.shopWrap, 'mouseleave', {}, false);
  await sleep(api.HOVER_CLOSE_DELAY_MS + 70);
  check('mouseleave does NOT close a click-latched menu',
    isOpen(els.shopMenu),
    'latched menu closed on mouseleave');
  mouseClick(els.shopBtn);
  check('clicking the latched button again closes it',
    !isOpen(els.shopMenu) && els.shopWrap._adminLatched === false,
    'second click did not close the latched menu');

  // 8e. Click-toggle while hovering (live bug #4): the click closes
  // the hover-opened menu and hover does NOT instantly re-open it.
  fire(els.shopWrap, 'mouseenter', {}, false);
  mouseClick(els.shopBtn);
  check('clicking the Shop button while hovering closes the menu',
    !isOpen(els.shopMenu),
    'click-toggle while hovering did not close the menu');
  await sleep(120);
  check('hover does NOT instantly re-open the menu after a click-close',
    !isOpen(els.shopMenu),
    'menu re-opened on its own after the click-close');
  fire(els.shopWrap, 'mouseenter', {}, false);
  check('hovering again after a click-close still opens the menu (normal behaviour)',
    isOpen(els.shopMenu),
    'menu did not reopen on a fresh hover');

  // 8f. Esc closes every open menu and returns focus to the opener
  // (live bug #2) — and the focus return must not reopen it. Focus
  // starts OUTSIDE the wrap (a mouse-opened menu never had focus
  // inside it), and :focus-visible matches, so without the suppress
  // window the focus return WOULD reopen the menu.
  fire(els.bodyEl, 'click', {});
  focusEl(els.outsideEl);
  fire(els.shopWrap, 'mouseenter', {}, false);
  els.shopBtn._focusVisible = true;
  fire(doc, 'keydown', { key: 'Escape' });
  check('Esc closes all open menus and returns focus to the button that opened it',
    !isOpen(els.shopMenu) && !isOpen(els.salesMenu)
    && doc.activeElement === els.shopBtn,
    'Esc did not close menus / return focus');
  await sleep(60);
  check('the Esc focus return does NOT reopen the menu (suppress window)',
    !isOpen(els.shopMenu),
    'menu reopened from the Esc focus return');

  // 8g. Hovering the Dashboard link closes any open menu (live bug #5).
  fire(els.shopWrap, 'mouseenter', {}, false);
  fire(els.dashboardLink, 'mouseenter', {}, false);
  check('hovering the Dashboard link closes an open menu',
    !isOpen(els.shopMenu),
    'Dashboard hover did not close the menu');

  // 8h. Keyboard: Tab-focus opens, Enter latches, Tab-away closes.
  // (Focus starts outside the wrap so the focusin actually fires.
  // The 500ms Esc suppress window from 8f must have expired first —
  // by design it blocks focus-open right after an Esc-close.)
  focusEl(els.outsideEl);
  await sleep(api.ESC_FOCUS_SUPPRESS_MS + 60);
  keyFocus(els.shopBtn);
  check('keyboard focus (Tab) opens the top-nav menu',
    isOpen(els.shopMenu),
    'focusin did not open the menu');
  keyClick(els.shopBtn);
  check('Enter on a focus-opened menu LATCHES it instead of toggling it shut',
    isOpen(els.shopMenu) && els.shopWrap._adminLatched === true,
    'Enter toggled the focus-opened menu shut');
  focusEl(els.outsideEl);
  check('Tabbing away (focusout) closes the menu',
    !isOpen(els.shopMenu),
    'focusout did not close the menu');

  // 8i. A mouse click's focusin must NOT open the menu (focus-visible gate).
  els.shopBtn._focusVisible = false;
  focusEl(els.shopBtn);
  check('a mouse click’s focusin does NOT open the menu (focus-visible gate)',
    !isOpen(els.shopMenu),
    'mouse focus opened the menu');

  // 8j. Outside click closes an open menu.
  fire(els.shopWrap, 'mouseenter', {}, false);
  fire(els.bodyEl, 'click', {});
  check('a click on the page body closes an open menu',
    !isOpen(els.shopMenu),
    'outside click did not close the menu');

  // 8k. Bell / profile are click-only toggles, independent of each other.
  mouseClick(els.bellBtn);
  check('click opens the bell menu',
    isOpen(els.bellMenu) && !isOpen(els.profileMenu),
    'bell click did not open its menu');
  mouseClick(els.profileBtn);
  check('clicking the profile button closes the bell menu and opens the profile menu',
    isOpen(els.profileMenu) && !isOpen(els.bellMenu),
    'profile click did not close the bell menu');
  mouseClick(els.profileBtn);
  check('clicking the profile button again closes it',
    !isOpen(els.profileMenu),
    'profile toggle did not close');

  // 8l. Search panel: opens, closes open menus, Esc closes it + returns focus.
  fire(els.shopWrap, 'mouseenter', {}, false);
  mouseClick(els.searchBtn);
  check('search icon opens the panel and closes any open menu',
    els.searchForm.classList.contains('open') && !isOpen(els.shopMenu),
    'search toggle did not open the panel / close the menu');
  check('opening the search focuses its input',
    doc.activeElement === els.searchInput,
    'search input was not focused');
  fire(doc, 'keydown', { key: 'Escape' });
  check('Esc closes the search panel and returns focus to the search icon',
    !els.searchForm.classList.contains('open')
    && doc.activeElement === els.searchBtn,
    'Esc did not close the search panel / return focus');

  // ---- 9. HEADER RENDER: same menus/links, nothing removed or reordered ----
  const rendered = await renderFile(headerPath, { siteName: 'Goince' });
  const topnavHrefs = [...rendered.matchAll(/<a href="([^"]+)" class="admin-topnav-menu-link/g)].map((m) => m[1]);
  const expectedHrefs = [
    '/admin/products', '/admin/products/import', '/admin/attributes', '/admin/stock-alerts',
    '/admin/categories', '/admin/banners', '/admin/flash-offers', '/admin/inventory',
    '/admin/invoices', '/admin/activity', '/admin/reports', '/admin/analytics', '/admin/customers',
    '/admin/coupons', '/admin/abandoned-carts', '/admin/payment-methods', '/admin/delivery-zones',
    '/admin/chats', '/admin/messages', '/admin/reviews', '/admin/campaigns',
    '/admin/audit-log', '/admin/backups', '/admin/settings', '/admin/test-email', '/admin/staff', '/admin/roles',
  ];
  check('rendered top-nav menus still contain the same 27 links in the same order (26 + Backups, feat/payments-messaging)',
    JSON.stringify(topnavHrefs) === JSON.stringify(expectedHrefs),
    `got ${JSON.stringify(topnavHrefs)}`);
  check('rendered header still has the bell menu, profile menu, search panel and Dashboard link',
    rendered.includes('id="admin-bell-menu"')
    && rendered.includes('id="admin-user-menu"')
    && rendered.includes('id="admin-topbar-search"')
    && rendered.includes('id="admin-topbar-search-btn"')
    && rendered.includes('href="/admin/dashboard" class="admin-topnav-link'),
    'a top-bar panel is missing from the render');
  check('rendered header still has the four dropdown groups (Shop/Sales/Communication/System)',
    ['Shop', 'Sales', 'Communication', 'System'].every((g) => rendered.includes(`>${g} <span class="admin-topnav-chevron"`)),
    'a nav group is missing from the render');

  console.log(`\n${passes.length} passed, ${failures.length} failed`);
  if (failures.length) { console.log('FAILED: ' + failures.join(' | ')); process.exitCode = 1; }
})().catch((e) => { console.error('SUITE ERROR:', e); process.exitCode = 1; });
