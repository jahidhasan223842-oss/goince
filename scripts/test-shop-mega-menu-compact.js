// Shop mega menu compact + dark-gold hover lift + column dropdown
// toggle (fix/shop-mega-menu-compact).
//
// donal sent a screenshot (2026-11-27, dark mode) of the open
// Categories mega menu and said, in Romanized Bengali: the box is
// far too big, there is no point keeping such a big box; and the
// small marked box ("Home Appliances (3)" — the category title)
// on hover should lift up MUCH more and have a beautiful dark
// golden colour ("garo sonali color"). He then added: add a
// dropdown option there so that dropdowning shows the child
// categories.
//
// What the screenshot showed: a dark navy panel ~half the screen
// wide, with ONE left column — "Home Appliances (3)", "Kitchen
// (1)" and "Home Utility (2)" indented beneath it, then "Winter
// Collection (1)" below, then a divider and "View all products →".
// The right side of the panel was EMPTY.
//
// ROOT CAUSE of the oversized panel (found in code, not guessed):
// the panel is width: max-content, so its width is the max-content
// of the grid. A column's max-content contribution is its content
// width clamped by min-width: 200px — "Home Appliances (3)" is
// ~170px of text, so each column contributes 200px and the grid
// sizes to 200+24+200 = 424px. But at layout time each column's
// flex-basis is 220px, so two columns need 220+24+220 = 464px >
// 424px — the second column WRAPS to a new row. Result: a ~464px
// panel with a single narrow column of content and a huge empty
// area to the right. (PR #65 set width: max-content + flex + wrap,
// but left flex: 1 1 220px + min-width: 200px in place, so the
// mismatch survived.)
//
// What was built (SHOP mega menu only — admin untouched):
//   1. COMPACT PANEL: columns are now flex: 0 0 auto + width:
//      max-content (no min-width, no 220px flex-basis) — each
//      column is exactly as wide as its content (title + toggle),
//      and the panel width is the columns + gaps + padding. Two
//      top categories sit side by side; nothing empty. Centering
//      (left:50% + translateX(-50%) at >=769px) + max-width
//      min(860px, 100vw - 32px) kept, so the panel still never
//      runs off the right edge. Entrance motion, open/close
//      behaviour, keyboard access unchanged.
//   2. DARK-GOLD HOVER LIFT: menu items — column titles first,
//      then child links, grandchild links and the "View all
//      products →" footer link — lift translateY(-6px) with a
//      stronger shadow and take a dark golden background
//      (var(--mega-hover-gold) #966e00, dark goldenrod family)
//      with white text. White on #966e00 is 4.64:1 (WCAG AA) on
//      both the dark navy panel and the light white panel. It is
//      NOT the bright header accent #f0a500 and NOT the admin's
//      old mustard #8a6d1f. The count span turns near-white on
//      hover too. Hover is gated behind @media (hover: hover);
//      :focus-visible shows the same gold background + lift.
//   3. COLUMN DROPDOWN TOGGLE: each top-category title gets a
//      small ▾ button next to it. Clicking it expands/collapses
//      that category's children with a short slide/fade
//      (mega-col-list-in keyframes, same motion language as the
//      PR #66 entrance). Children start COLLAPSED (display: none)
//      so the panel opens compact; the title itself stays a link
//      to the category page — the toggle is a separate <button>,
//      so clicking the title still navigates. aria-expanded on
//      the button, caret rotates 180° when open, native button
//      so Enter/Space work, focus-visible is clear. Categories
//      with no children get no toggle. Closing the panel (click
//      outside, Esc, focus-out, mouseleave) collapses all columns
//      again, so the next open is compact.
//   4. KEPT: PR #66 header nav hover (gold text + sliding
//      underline on Home/Categories/Cart) unchanged; entrance
//      stagger unchanged; prefers-reduced-motion disables the
//      lift/motion (colour change only); mobile drawer/pills
//      unchanged (the mega menu is desktop-only).
//
// No live MySQL needed: CSS/EJS source checks + a direct EJS
// render of the shop header + the REAL first mega-menu IIFE from
// mega-menu.js run in a stubbed DOM (vm sandbox — no jsdom in
// node_modules).
//
// Run:  node scripts/test-shop-mega-menu-compact.js
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

// Same helpers as test-shop-menu-bar.js: top-level CSS (comments
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
const hoverBlocks = extractRanges(cssNoComments, allMediaRanges(cssNoComments, 'hover: hover'));
const desktop769Blocks = extractRanges(cssNoComments, allMediaRanges(cssNoComments, 'min-width: 769px'));
const reducedMotionBlocks = extractRanges(cssNoComments, allMediaRanges(cssNoComments, 'prefers-reduced-motion'));

// First rule whose selector list contains `selector` (selector may
// be part of a grouped selector list).
function ruleWithSelector(source, selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('[^{}]*' + esc + '[^{}]*\\{([^}]*)\\}', 'g');
  const m = re.exec(source);
  return m ? m[1] : null;
}
function ruleBody(source, selectorRe) {
  const m = source.match(selectorRe);
  return m ? m[0] : null;
}
function liftPx(body) {
  const m = body && body.match(/translateY\(-(\d+)px\)/);
  return m ? Number(m[1]) : 0;
}
// Relative luminance + contrast vs white (WCAG formula).
function luminance(hex) {
  const c = hex.replace('#', '');
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(parseInt(c.slice(0, 2), 16)) + 0.7152 * f(parseInt(c.slice(2, 4), 16)) + 0.0722 * f(parseInt(c.slice(4, 6), 16));
}

(async function main() {
  console.log('Shop mega menu compact + dark-gold hover + column toggle (fix/shop-mega-menu-compact) checks:');

  // ---------- 1. Compact panel: the root-cause fix ----------
  const colRule = ruleBody(cssTopLevel, /\.mega-col\s*\{[^}]*\}/);
  check('compact: columns are flex: 0 0 auto (no grow/shrink from a 220px basis)', !!colRule && /flex:\s*0 0 auto/.test(colRule));
  check('compact: columns size to content (width: max-content)', !!colRule && /width:\s*max-content/.test(colRule));
  check('compact: the 200px min-width that broke max-content sizing is gone', !!colRule && !/min-width:\s*200px/.test(colRule));
  check('compact: the 220px flex-basis that wrapped the 2nd column is gone', !!colRule && !/flex:\s*1 1 220px/.test(colRule));
  check('compact: columns still capped at 280px (a very long name cannot blow the panel out)', !!colRule && /max-width:\s*280px/.test(colRule));
  const gridRule = ruleBody(cssTopLevel, /\.mega-menu-grid\s*\{[^}]*\}/);
  check('compact: grid is still flex + wrap (extra categories wrap to a new row)', !!gridRule && /display:\s*flex/.test(gridRule) && /flex-wrap:\s*wrap/.test(gridRule));
  const panelRule = ruleBody(cssTopLevel, /\.mega-menu-panel\s*\{[^}]*\}/);
  check('compact: panel is still width: max-content with max-width min(860px, 100vw - 32px)', !!panelRule && /width:\s*max-content/.test(panelRule) && /max-width:\s*min\(860px,\s*calc\(100vw - 32px\)\)/.test(panelRule));
  check('compact: panel still centred at >=769px (right-edge guard)', /left:\s*50%/.test(desktop769Blocks) && /translateX\(-50%\)/.test(desktop769Blocks));
  check('compact: panel max-height + vertical scroll kept', !!panelRule && /max-height:\s*calc\(100vh - 90px\)/.test(panelRule) && /overflow-y:\s*auto/.test(panelRule));

  // ---------- 2. Dark-gold hover lift ----------
  const goldMatch = cssNoComments.match(/--mega-hover-gold:\s*(#[0-9a-fA-F]{6})/);
  const gold = goldMatch ? goldMatch[1].toLowerCase() : null;
  check('dark gold: --mega-hover-gold variable is defined', !!gold, gold);
  check('dark gold: it is NOT the bright header accent #f0a500', !!gold && gold !== '#f0a500');
  check('dark gold: it is NOT the admin mustard #8a6d1f', !!gold && gold !== '#8a6d1f');
  const goldContrast = gold ? 1.05 / (luminance(gold) + 0.05) : 0;
  check('dark gold: white text on it is >= 4.5:1 (WCAG AA, both themes)', goldContrast >= 4.5, gold ? `${gold} = ${goldContrast.toFixed(2)}:1` : 'no gold found');
  check('dark gold: it is in the dark-goldenrod family (#966e00)', gold === '#966e00', gold);

  // The hover lift lives in one grouped rule inside @media
  // (hover: hover); every item selector must be in that group
  // with the gold background, white text, a -6px (or bigger)
  // lift and a stronger shadow.
  const hoverItems = [
    ['title', '.mega-menu-panel a.mega-col-title:hover'],
    ['child link', '.mega-menu-panel .mega-col-list a:hover'],
    ['grandchild link', '.mega-menu-panel .mega-sub-list a:hover'],
    ['footer link', '.mega-menu-footer a:hover'],
    ['column toggle', '.mega-col-toggle:hover'],
  ];
  for (const [label, sel] of hoverItems) {
    const body = ruleWithSelector(hoverBlocks, sel);
    check(`hover lift (${label}): dark-gold background on hover`, !!body && /background:\s*var\(--mega-hover-gold\)/.test(body), body || 'no rule');
    check(`hover lift (${label}): white text on hover`, !!body && /color:\s*#fff/.test(body));
    check(`hover lift (${label}): lifts -6px or more (was -2px/-3px)`, !!body && liftPx(body) >= 6, body ? `lift ${liftPx(body)}px` : 'no rule');
    check(`hover lift (${label}): stronger shadow on hover`, !!body && /box-shadow:\s*0 8px 18px/.test(body));
  }
  const countHover = ruleWithSelector(hoverBlocks, '.mega-menu-panel a.mega-col-title:hover .mega-count');
  check('hover lift (title): count span turns near-white on the gold', !!countHover && /color:\s*rgba\(255,\s*255,\s*255,\s*0\.85\)/.test(countHover));
  // The title/child/footer links form a visible gold box, not
  // just coloured text: padding + rounded corners.
  const titleRule = ruleBody(cssTopLevel, /\.mega-col-title\s*\{[^}]*\}/);
  check('hover box (title): padding + border-radius so the gold forms a box', !!titleRule && /padding:\s*6px 10px/.test(titleRule) && /border-radius:\s*8px/.test(titleRule));
  const childRule = ruleBody(cssTopLevel, /\.mega-col-list a\s*\{[^}]*\}/);
  check('hover box (child): padding + border-radius so the gold forms a box', !!childRule && /padding:\s*4px 10px 4px 40px/.test(childRule) && /border-radius:\s*8px/.test(childRule));
  const footerRule = ruleBody(cssTopLevel, /\.mega-menu-footer a\s*\{[^}]*\}/);
  check('hover box (footer): inline-block + padding + border-radius', !!footerRule && /display:\s*inline-block/.test(footerRule) && /padding:\s*6px 14px/.test(footerRule) && /border-radius:\s*8px/.test(footerRule));
  // Old colour-only hovers are gone (they would fight the gold).
  check('hover lift: old title colour-only hover is gone', !/\.mega-col-title:hover\s*\{\s*color:\s*var\(--accent-text\)/.test(cssTopLevel));
  check('hover lift: old child colour-only hover is gone', !/\.mega-col-list a:hover,\s*\.mega-sub-list a:hover\s*\{\s*color:\s*var\(--accent-text\)/.test(cssTopLevel));
  // Focus-visible matches hover.
  for (const [label, sel] of [
    ['title', '.mega-menu-panel a.mega-col-title:focus-visible'],
    ['child link', '.mega-menu-panel .mega-col-list a:focus-visible'],
    ['footer link', '.mega-menu-footer a:focus-visible'],
    ['column toggle', '.mega-col-toggle:focus-visible'],
  ]) {
    const body = ruleWithSelector(cssNoComments, sel);
    check(`focus-visible (${label}): same dark-gold background + lift as hover`, !!body && /background:\s*var\(--mega-hover-gold\)/.test(body) && liftPx(body) >= 6);
  }
  // Reduced motion disables the lift/motion (colour only).
  check('reduced motion: mega item transitions disabled', /\.mega-col-title/.test(reducedMotionBlocks) && /transition:\s*none/.test(reducedMotionBlocks));
  check('reduced motion: hover/focus lift + shadow removed', /\.mega-menu-panel a\.mega-col-title:hover/.test(reducedMotionBlocks) && /transform:\s*none/.test(reducedMotionBlocks));
  check('reduced motion: column-list expand animation disabled', /\.mega-col\.open \.mega-col-list/.test(reducedMotionBlocks) && /animation:\s*none/.test(reducedMotionBlocks));
  // Entrance motion + open/close behaviour preserved.
  check('entrance: panel open still uses the spring ease (.25s)', /cubic-bezier\(\.22, 1\.25, \.36, 1\)/.test(cssNoComments));
  check('entrance: column stagger delays still 0/30ms', /\.mega-menu-panel\s+\.mega-col:nth-of-type\(2\)\s*\{[^}]*animation-delay:\s*30ms/.test(cssTopLevel));
  check('entrance: hover-open rule still present', /mega-menu-wrap:hover\s+\.mega-menu-panel/.test(cssNoComments));
  check('behaviour: Esc / focusout / outside-click close still in mega-menu.js', /Escape/.test(megaMenuJs) && /focusout/.test(megaMenuJs) && /mega-menu-panel/.test(megaMenuJs));
  check('behaviour: PR #66 header nav hover (gold text + underline) untouched', /\.main-nav > a:not\(\.btn-nav-outline\):not\(\.btn-nav-solid\)::after/.test(cssNoComments) && /background:\s*var\(--accent\)/.test(cssNoComments));

  // ---------- 3. Column toggle: CSS (collapsed by default) ----------
  const listRule = ruleBody(cssTopLevel, /\.mega-col-list\s*\{[^}]*\}/);
  check('toggle: child list is hidden by default (display: none)', !!listRule && /display:\s*none/.test(listRule));
  const openListRule = ruleBody(cssTopLevel, /\.mega-col\.open \.mega-col-list\s*\{[^}]*\}/);
  check('toggle: expanded column shows its list (display: block)', !!openListRule && /display:\s*block/.test(openListRule));
  check('toggle: expanding plays a short slide/fade (mega-col-list-in)', !!openListRule && /animation:\s*mega-col-list-in/.test(openListRule) && /@keyframes mega-col-list-in/.test(cssNoComments));
  check('toggle: expand keyframes fade + slide in', /@keyframes mega-col-list-in\s*\{[^}]*opacity:\s*0[^}]*transform:\s*translateY\(-4px\)/.test(cssNoComments));
  const toggleRule = ruleBody(cssTopLevel, /\.mega-col-toggle\s*\{[^}]*\}/);
  check('toggle: toggle button is styled (border, radius, pointer cursor)', !!toggleRule && /border:\s*1px solid var\(--border\)/.test(toggleRule) && /border-radius:\s*6px/.test(toggleRule) && /cursor:\s*pointer/.test(toggleRule));
  const caretRule = ruleBody(cssTopLevel, /\.mega-col\.open \.mega-col-toggle \.mega-col-caret\s*\{[^}]*\}/);
  check('toggle: caret rotates 180deg when its column is open', !!caretRule && /transform:\s*rotate\(180deg\)/.test(caretRule));

  // ---------- 4. Shop header render (EJS, 2 top categories) ----------
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
    check('header renders (EJS)', false, String(e && e.message));
  }
  if (html) {
    check('render: mega panel has exactly 2 columns for 2 top categories', (html.match(/class="mega-col"/g) || []).length === 2);
    check('render: titles + counts present', html.includes('Home Appliances') && html.includes('(3)') && html.includes('Winter Collection') && html.includes('(1)'));
    check('render: children still in the HTML (Kitchen, Home Utility) — hidden by CSS only', html.includes('Kitchen') && html.includes('Home Utility'));
    check('render: "View all products →" footer link present', html.includes('View all products'));
    // Exactly ONE toggle: Home Appliances has children, Winter
    // Collection has none.
    check('render: exactly one toggle button (only the category with children gets one)', (html.match(/class="mega-col-toggle"/g) || []).length === 1);
    check('render: toggle is a <button type="button">, not a link (it must not navigate)', html.includes('<button type="button" class="mega-col-toggle"'));
    check('render: toggle starts collapsed (aria-expanded="false")', html.includes('aria-expanded="false"') && html.includes('aria-controls="mega-col-list-8"'));
    check('render: toggle labels its category (Show sub-categories of Home Appliances)', html.includes('aria-label="Show sub-categories of Home Appliances"'));
    check('render: child list has the id the toggle controls', html.includes('id="mega-col-list-8"'));
    check('render: childless Winter Collection has no toggle and no list id', !html.includes('mega-col-list-9') && !html.includes('Winter Collection</span><span class="mega-count">(1)</span></a>\n                      <button'));
    check('render: title links still navigate to the category pages', html.includes('href="/?category=8"') && html.includes('href="/?category=9"'));
    check('render: toggle carries a caret (▾) that rotates on open', html.includes('class="mega-col-caret"') && html.includes('▾'));
  }

  // ---------- 5. Column toggle behaviour (real IIFE, stubbed DOM) ----------
  // Extract the FIRST mega-menu IIFE (panel open/close + column
  // toggles) and run it in a vm sandbox with a mini stub DOM.
  const iifeStart = megaMenuJs.indexOf('(function () {');
  const iifeEnd = megaMenuJs.indexOf('})();', iifeStart) + 5;
  const iifeCode = megaMenuJs.slice(iifeStart, iifeEnd);
  check('toggle JS: first mega-menu IIFE extractable from mega-menu.js', iifeStart >= 0 && iifeCode.includes('mega-col-toggle') && iifeCode.includes('collapseAllCols'));

  function makeStubEl(tag, classes) {
    const el = {
      tagName: (tag || 'DIV').toUpperCase(),
      _classes: new Set(classes || []),
      _attrs: {},
      _children: [],
      _parent: null,
      _handlers: {},
      classList: {
        add(c) { el._classes.add(c); },
        remove(c) { el._classes.delete(c); },
        toggle(c, f) {
          if (f === undefined) { if (el._classes.has(c)) { el._classes.delete(c); return false; } el._classes.add(c); return true; }
          if (f) el._classes.add(c); else el._classes.delete(c); return !!f;
        },
        contains(c) { return el._classes.has(c); },
      },
      setAttribute(k, v) { el._attrs[k] = String(v); },
      getAttribute(k) { return el._attrs[k] === undefined ? null : el._attrs[k]; },
      addEventListener(type, fn) { (el._handlers[type] = el._handlers[type] || []).push(fn); },
      appendChild(child) { child._parent = el; el._children.push(child); return child; },
      querySelectorAll(sel) {
        const out = [];
        const walk = (node) => {
          for (const child of node._children) {
            if (sel === '.mega-col-toggle' && child._classes.has('mega-col-toggle')) out.push(child);
            if (sel === '.mega-col.open' && child._classes.has('mega-col') && child._classes.has('open')) out.push(child);
            if (sel === '.mega-col-toggle' || sel === '.mega-col.open') walk(child);
          }
        };
        walk(el);
        return out;
      },
      closest(sel) {
        let node = el;
        const cls = sel.replace(/^\./, '');
        while (node) { if (node._classes && node._classes.has(cls)) return node; node = node._parent; }
        return null;
      },
      contains(other) {
        let node = other;
        while (node) { if (node === el) return true; node = node._parent; }
        return false;
      },
      focus() { el._focused = true; },
    };
    return el;
  }
  function fire(el, type, event) {
    const ev = Object.assign({ stopPropagation() {}, target: el, key: '', relatedTarget: null }, event || {});
    (el._handlers[type] || []).forEach((fn) => fn(ev));
  }

  // wrap > btn + panel > col1 (toggle + list) + col2 (no toggle).
  const wrap = makeStubEl('div', ['mega-menu-wrap']);
  const btn = makeStubEl('button', ['mega-menu-btn']);
  btn.setAttribute('aria-expanded', 'false');
  const panel = makeStubEl('div', ['mega-menu-panel']);
  const col1 = makeStubEl('div', ['mega-col']);
  const head1 = makeStubEl('div', ['mega-col-head']);
  const title1 = makeStubEl('a', ['mega-col-title']);
  title1.setAttribute('href', '/?category=8');
  const toggle1 = makeStubEl('button', ['mega-col-toggle']);
  toggle1.setAttribute('aria-expanded', 'false');
  toggle1.setAttribute('aria-controls', 'mega-col-list-8');
  toggle1.setAttribute('aria-label', 'Show sub-categories of Home Appliances');
  const list1 = makeStubEl('ul', ['mega-col-list']);
  list1.setAttribute('id', 'mega-col-list-8');
  const col2 = makeStubEl('div', ['mega-col']);
  const head2 = makeStubEl('div', ['mega-col-head']);
  const title2 = makeStubEl('a', ['mega-col-title']);
  title2.setAttribute('href', '/?category=9');
  wrap.appendChild(btn);
  wrap.appendChild(panel);
  panel.appendChild(col1);
  panel.appendChild(col2);
  col1.appendChild(head1);
  head1.appendChild(title1);
  head1.appendChild(toggle1);
  col1.appendChild(list1);
  col2.appendChild(head2);
  head2.appendChild(title2);

  const docHandlers = {};
  const outsideEl = makeStubEl('div', ['page-content']);
  const sandboxDoc = {
    querySelector(sel) { return sel === '.mega-menu-wrap' ? wrap : null; },
    getElementById(id) {
      if (id === 'mega-menu-panel') return panel;
      if (id === 'mega-menu-btn') return btn;
      return null;
    },
    addEventListener(type, fn) { (docHandlers[type] = docHandlers[type] || []).push(fn); },
    activeElement: null,
  };
  vm.runInNewContext(iifeCode, { document: sandboxDoc });
  const fireDoc = (type, event) => {
    const ev = Object.assign({ stopPropagation() {}, target: outsideEl, key: '', relatedTarget: null }, event || {});
    (docHandlers[type] || []).forEach((fn) => fn(ev));
  };

  check('toggle behaviour: starts collapsed (no .open, aria-expanded=false)', !col1.classList.contains('open') && toggle1.getAttribute('aria-expanded') === 'false');
  fire(toggle1, 'click');
  check('toggle behaviour: click expands the column (.open + aria-expanded=true)', col1.classList.contains('open') && toggle1.getAttribute('aria-expanded') === 'true');
  check('toggle behaviour: label flips to Hide on expand', toggle1.getAttribute('aria-label') === 'Hide sub-categories of Home Appliances');
  fire(toggle1, 'click');
  check('toggle behaviour: second click collapses it again', !col1.classList.contains('open') && toggle1.getAttribute('aria-expanded') === 'false');
  check('toggle behaviour: label flips back to Show on collapse', toggle1.getAttribute('aria-label') === 'Show sub-categories of Home Appliances');
  // Open the panel (latched click), expand, then close via outside
  // click — the column must collapse with the panel.
  fire(btn, 'click');
  check('toggle behaviour: panel opens on Categories click (latched)', panel.classList.contains('open'));
  fire(toggle1, 'click');
  check('toggle behaviour: column expands while panel is open', col1.classList.contains('open'));
  fireDoc('click', { target: outsideEl });
  check('toggle behaviour: outside click closes the panel AND collapses the column', !panel.classList.contains('open') && !col1.classList.contains('open') && toggle1.getAttribute('aria-expanded') === 'false');
  // Mouseleave (hover-close path) also collapses.
  fire(btn, 'click');
  fire(toggle1, 'click');
  fire(wrap, 'mouseleave');
  check('toggle behaviour: mouseleave collapses the column (hover-close path)', !col1.classList.contains('open') && toggle1.getAttribute('aria-expanded') === 'false');
  // Esc closes the panel and collapses the column, focus returns.
  // (The panel is still open + latched from the mouseleave
  // scenario, so close it first with an outside click — a plain
  // btn click here would CLOSE it, not open it.)
  fireDoc('click', { target: outsideEl });
  check('toggle behaviour: panel closed before Esc scenario', !panel.classList.contains('open'));
  fire(btn, 'click');
  fire(toggle1, 'click');
  fireDoc('keydown', { key: 'Escape' });
  check('toggle behaviour: Esc closes the panel AND collapses the column', !panel.classList.contains('open') && !col1.classList.contains('open') && toggle1.getAttribute('aria-expanded') === 'false');
  check('toggle behaviour: childless column has no toggle to wire (nothing to expand)', col2.querySelectorAll('.mega-col-toggle').length === 0);

  console.log(`\n${passes.length} passed, ${failures.length} failed.`);
  if (failures.length) { console.log('Failures: ' + failures.join(', ')); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
