// Pills band + ripple + card hover refinement (fix/pills-band-ripple-card).
//
// donal said (2026-11-27, with a screenshot of the pills row
// red-boxed, in Bangla script): below the menu give another
// different colour, other than golden colour; the child categories
// should have an even more beautiful effect and rise up even more;
// do another job — everywhere I click with the mouse, in the admin
// panel and on the website, give a beautiful click effect so it
// looks advanced (the click effect must be beautiful); and when the
// cursor comes over a product, on hover the border and Add to Cart
// — here ONLY the border will have colour, apart from the product's
// photo and text give another beautiful background below it, and
// Add to Cart keeps its normal colour — when the cursor goes onto
// Add to Cart itself, then Add to Cart becomes golden.
//
// What was built (shop homepage + shared CSS + both footers):
//   1. PILLS BAND: the category pills row (2nd menu bar) now sits
//      on a full-width powder-blue band (light #e7f0f8, dark a deep
//      navy-blue tint #1e2c47) — NOT gold. Full-bleed via the
//      calc(50% - 50vw) trick; the pills themselves, their order
//      and dropdown behaviour are unchanged. Mobile keeps the band
//      (the old edge-fade mask was removed — it would have faded
//      the band's own edges; the strip still scrolls with snap).
//   2. PILL-DROPDOWN CHILDREN: the generic child rule (PR #69:
//      dark gold + -3px) is now richer — lift translateY(-6px) +
//      slight scale(1.02) + deeper soft shadow + a dark-gold
//      GRADIENT background (#966e00 -> #ab8a00, still clearly dark
//      golden, NOT the bright accent #f0a500). The rule stays
//      GENERIC — one shared class rule for every child AND
//      grandchild, however many; no nth-child/per-item rules. The
//      mobile drawer sub/sub-sub links get the same gradient (no
//      lift there — full-width rows).
//   3. CLICK RIPPLE: new public/js/click-ripple.js (cache-busted
//      via lib/assets.js, same pattern as mega-menu.js /
//      product-gallery.js), included in BOTH the shop footer and
//      the admin footer. On left-click a small gold ring appears
//      exactly at the click point, expands gently and fades in
//      ~600ms (CSS animation), pointer-events: none so it never
//      blocks the real click. Skips text inputs/textareas/selects/
//      contenteditable, right-clicks, and everything when
//      prefers-reduced-motion is on; at most 3 ripples alive (the
//      oldest is dropped when spammed); on touch/pen it only
//      ripples on interactive elements so scrolling never ripples.
//   4. CARD HOVER REFINEMENT: (a) the Add to Cart / Choose Option
//      button turns dark gold ONLY on its OWN :hover — the PR #69
//      rule that golded it on CARD hover is REMOVED (the button
//      keeps its normal dark-navy colour while only the card is
//      hovered); (b) on card hover ONLY the border is coloured —
//      the 2px dark-gold ring stays, the whole card is not
//      coloured; (c) the bottom zone of the card (price + button,
//      new .product-card-foot wrapper in views/index.ejs,
//      views/product.ejs, views/cart.ejs and the Recently Viewed
//      renderer) gets a soft background on card hover (PR #72:
//      soft mint green #e3f2e6 light, deep green tint #1c2b22 dark
//      — neither gold nor blue; PR #71 had champagne #fdf3d8 /
//      deep warm #2a2118) — the
//      photo and the title text are unchanged; (d) the -10px lift,
//      deep shadow and 1.08x photo zoom from PR #69 are kept.
//      :focus-within keeps lift + ring + mint foot.
//      The wishlist card is the one deliberate exception: its
//      bottom zone is an absolutely-positioned .wishlist-actions
//      row (position: relative + padding-bottom: 45px), so it has
//      no .product-card-foot — it still gets the ring + lift +
//      zoom on hover, just no mint zone.
//
// No live MySQL needed: CSS/EJS source checks + a direct EJS
// render of the homepage + the REAL click-ripple IIFE run in a
// stubbed DOM (vm sandbox — no jsdom in node_modules).
//
// Run:  node scripts/test-pills-band-ripple-card.js
// Exit code 0 = all checks passed.
'use strict';

const fs = require('fs');
const path = require('path');
const util = require('util');
const ejs = require('ejs');
const vm = require('vm');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'style.css'), 'utf8');
const indexEjs = fs.readFileSync(path.join(__dirname, '..', 'views', 'index.ejs'), 'utf8');
const productEjs = fs.readFileSync(path.join(__dirname, '..', 'views', 'product.ejs'), 'utf8');
const cartEjs = fs.readFileSync(path.join(__dirname, '..', 'views', 'cart.ejs'), 'utf8');
const footerEjs = fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', 'footer.ejs'), 'utf8');
const adminFooterEjs = fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', 'admin-footer.ejs'), 'utf8');
const assetsJs = fs.readFileSync(path.join(__dirname, '..', 'lib', 'assets.js'), 'utf8');
const rippleJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'click-ripple.js'), 'utf8');
const renderFile = util.promisify(ejs.renderFile);
const indexPath = path.join(__dirname, '..', 'views', 'index.ejs');

const failures = [];
const passes = [];
function check(name, ok, detail) {
  if (ok) { passes.push(name); console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

// Same helpers as test-homepage-beauty.js: top-level CSS (comments +
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
const reducedMotionBlocks = extractRanges(cssNoComments, allMediaRanges(cssNoComments, 'prefers-reduced-motion'));
const mobileBlocks = extractRanges(cssNoComments, allMediaRanges(cssNoComments, 'max-width: 768px'));

function ruleBody(source, selectorRe) {
  const m = source.match(selectorRe);
  return m ? m[0] : null;
}

(async function main() {
  console.log('Pills band + ripple + card hover refinement (fix/pills-band-ripple-card) checks:');

  // ---------- 1. Pills strip background band (NOT gold) ----------
  const band = ruleBody(cssTopLevel, /\.container > \.category-bar\s*\{[^}]*\}/);
  check('band: pills strip has a full-width background band (.container > .category-bar)', !!band);
  check('band: band background is the powder-blue var (not a gold literal)', !!band && /background:\s*var\(--pills-band\)/.test(band) && !/#f0a500|#966e00/.test(band));
  check('band: full-bleed margins (calc(50% - 50vw)) + padding (calc(50vw - 50%))', !!band && /margin:\s*20px calc\(50% - 50vw\)/.test(band) && /padding:\s*12px calc\(50vw - 50%\)/.test(band));
  check('band: thin bottom border separates it from the page', !!band && /border-bottom:\s*1px solid var\(--border\)/.test(band));
  const pillsBandVar = ruleBody(cssTopLevel, /:root\s*\{[^}]*--pills-band:[^}]*\}/);
  check('band: light-mode band is soft powder blue #e7f0f8', !!pillsBandVar && /--pills-band:\s*#e7f0f8/.test(pillsBandVar));
  const darkVars = ruleBody(cssTopLevel, /\[data-theme="dark"\]\s*\{[^}]*\}/);
  check('band: dark-mode band is a deep navy-blue tint #1e2c47', !!darkVars && /--pills-band:\s*#1e2c47/.test(darkVars));
  check('band: no gold var is used for the band anywhere', !/--pills-band:\s*#f0a500|--pills-band:\s*#966e00/.test(cssNoComments));
  check('band: scoped to main.container — the admin category-bar is NOT banded', !!band && !/\.admin-content > \.category-bar/.test(cssNoComments) && !/\.admin-content \.category-bar\s*\{[^}]*background: var\(--pills-band\)/.test(cssNoComments));
  // Pills themselves unchanged.
  const pillHover = hoverBlocks.match(/\.category-bar > a:not\(\.active\):hover,[\s\S]*?\{[^}]*\}/);
  check('band: inactive pill hover still dark gold + -4px (unchanged)', !!pillHover && /background:\s*var\(--mega-hover-gold\)/.test(pillHover) && /transform:\s*translateY\(-4px\)/.test(pillHover));
  const pillActiveHover = hoverBlocks.match(/\.category-bar > a\.active:hover,[\s\S]*?\{[^}]*\}/);
  check('band: active "All" pill still keeps orange on hover (lift only)', !!pillActiveHover && !/background:/.test(pillActiveHover) && /transform:\s*translateY\(-2px\)/.test(pillActiveHover));
  check('band: pill dropdown open behaviour unchanged (hover/focus-within open)', /\.cat-pill-wrap:hover \.cat-pill-menu/.test(cssNoComments) && /\.cat-pill-wrap:focus-within \.cat-pill-menu/.test(cssNoComments));
  // Mobile band.
  const mobileBand = mobileBlocks.match(/\.container > \.category-bar\s*\{[^}]*\}/);
  check('band: mobile keeps the band (full-bleed margins/padding in the <=768px block)', !!mobileBand && /margin:\s*16px calc\(50% - 50vw\)/.test(mobileBand) && /padding:\s*10px calc\(50vw - 50%\)/.test(mobileBand));
  check('band: the old edge-fade mask is gone on mobile (it would fade the band itself)', !/mask-image:\s*linear-gradient/.test(mobileBlocks));
  check('band: mobile strip still scrolls horizontally with snap', /\.category-bar\s*\{[^}]*overflow-x:\s*auto/.test(mobileBlocks) && /scroll-snap-type:\s*x proximity/.test(mobileBlocks));

  // ---------- 2. Pill-dropdown children — more lift + gradient ----------
  const goldGradientVar = ruleBody(cssTopLevel, /:root\s*\{[^}]*--gold-gradient:[^}]*\}/);
  check('children: --gold-gradient is a dark-gold gradient (#966e00 -> #ab8a00)', !!goldGradientVar && /--gold-gradient:\s*linear-gradient\(135deg, #966e00, #ab8a00\)/.test(goldGradientVar));
  check('children: gradient never uses the bright accent #f0a500', !/--gold-gradient:[^;]*#f0a500/.test(cssNoComments));
  const childHover = hoverBlocks.match(/\.category-bar \.cat-pill-menu a:hover\s*\{[^}]*\}/);
  check('children: generic child hover rule exists (dark-gold gradient + white text)', !!childHover && /background:\s*var\(--gold-gradient\)/.test(childHover) && /color:\s*#fff/.test(childHover));
  check('children: lift is now -6px (was -3px) with a slight scale 1.02', !!childHover && /transform:\s*translateY\(-6px\) scale\(1\.02\)/.test(childHover));
  check('children: shadow is deeper (0 8px 18px, was 0 6px 14px)', !!childHover && /box-shadow:\s*0 8px 18px rgba\(0, 0, 0, 0\.32\)/.test(childHover));
  check('children: count turns near-white on hover', !!ruleBody(hoverBlocks, /\.category-bar \.cat-pill-menu a:hover \.cat-count\s*\{[^}]*\}/) && /color:\s*rgba\(255, 255, 255, 0\.85\)/.test(ruleBody(hoverBlocks, /\.category-bar \.cat-pill-menu a:hover \.cat-count\s*\{[^}]*\}/)));
  const childFocus = ruleBody(cssTopLevel, /\.category-bar \.cat-pill-menu a:focus-visible\s*\{[^}]*\}/);
  check('children: :focus-visible matches hover (gradient + -6px + scale + outline)', !!childFocus && /background:\s*var\(--gold-gradient\)/.test(childFocus) && /transform:\s*translateY\(-6px\) scale\(1\.02\)/.test(childFocus) && /outline:/.test(childFocus));
  check('children: still ONE generic rule — no nth-child / per-item rules for pill children', !/\.cat-pill-menu[^{]*nth-child/.test(cssNoComments) && !/\.cat-pill-menu li:nth/.test(cssNoComments));
  check('children: old solid-gold -3px child rule is gone', !/\.category-bar \.cat-pill-menu a:hover\s*\{\s*background:\s*var\(--mega-hover-gold\);[^}]*translateY\(-3px\)/.test(cssNoComments));
  // Drawer sub links get the same gradient (no lift — full-width rows).
  const drawerHover = mobileBlocks.match(/\.shop-drawer-sub a:hover, \.shop-drawer-sub-sub a:hover\s*\{[^}]*\}/);
  check('children: mobile drawer sub/sub-sub links use the gold gradient (no lift)', !!drawerHover && /background:\s*var\(--gold-gradient\)/.test(drawerHover) && /color:\s*#fff/.test(drawerHover) && !/transform:/.test(drawerHover));
  const drawerFocus = mobileBlocks.match(/\.shop-drawer-sub a:focus-visible, \.shop-drawer-sub-sub a:focus-visible\s*\{[^}]*\}/);
  check('children: drawer :focus-visible matches (gradient + white)', !!drawerFocus && /background:\s*var\(--gold-gradient\)/.test(drawerFocus));

  // ---------- 3. Click ripple — file, includes, CSS, behaviour ----------
  check('ripple: public/js/click-ripple.js exists and has the IIFE', rippleJs.includes('(function () {') && rippleJs.includes("addEventListener('pointerdown'"));
  check('ripple: registered in lib/assets.js (cache-busted like the other JS)', assetsJs.includes("'js/click-ripple.js'"));
  check('ripple: included in the SHOP footer via assetUrl (after product-gallery.js)', footerEjs.includes("assetUrl('/js/click-ripple.js')") && footerEjs.indexOf('click-ripple.js') > footerEjs.indexOf('product-gallery.js'));
  check('ripple: included in the ADMIN footer via assetUrl (after admin-dropdowns.js)', adminFooterEjs.includes("assetUrl('/js/click-ripple.js')") && adminFooterEjs.indexOf('click-ripple.js') > adminFooterEjs.indexOf('admin-dropdowns.js'));
  check('ripple: old script includes still present (theme/mega-menu/gallery in shop; theme/push/dropdowns in admin)', footerEjs.includes("assetUrl('/js/mega-menu.js')") && footerEjs.includes("assetUrl('/js/product-gallery.js')") && adminFooterEjs.includes("assetUrl('/js/admin-dropdowns.js')") && adminFooterEjs.includes("assetUrl('/js/admin-push.js')"));
  const rippleCss = ruleBody(cssTopLevel, /\.click-ripple\s*\{[^}]*\}/);
  check('ripple: CSS rule exists (fixed, gold ring, pointer-events none)', !!rippleCss && /position:\s*fixed/.test(rippleCss) && /pointer-events:\s*none/.test(rippleCss) && /border:\s*2px solid rgba\(150, 110, 0/.test(rippleCss));
  check('ripple: animation is the ~600ms expand + fade (click-ripple .6s ease-out forwards)', !!rippleCss && /animation:\s*click-ripple \.6s ease-out forwards/.test(rippleCss));
  check('ripple: ring sits above everything (z-index 9999) and is centred on the click point (margin -28px)', !!rippleCss && /z-index:\s*9999/.test(rippleCss) && /margin:\s*-28px 0 0 -28px/.test(rippleCss));
  const rippleKeyframes = cssNoComments.match(/@keyframes click-ripple\s*\{[\s\S]*?from\s*\{[^}]*transform:\s*scale\(\.25\)[^}]*\}[\s\S]*?to\s*\{[^}]*transform:\s*scale\(1\)[^}]*opacity:\s*0[^}]*\}/);
  check('ripple: keyframes expand .25 -> 1 and fade 1 -> 0', !!rippleKeyframes);
  check('ripple: reduced-motion disables it entirely (no animation, display none)', /\.click-ripple\s*\{\s*animation:\s*none; display:\s*none;/.test(reducedMotionBlocks));
  check('ripple: JS skips text inputs / textareas / selects / contenteditable', rippleJs.includes('input, textarea, select, [contenteditable="') && rippleJs.includes('t.closest(FORM_FIELD)'));
  check('ripple: JS only fires on the primary button (button 0)', rippleJs.includes('e.button !== 0'));
  check('ripple: JS caps live ripples at 3 (drops the oldest when spammed)', rippleJs.includes('MAX_RIPPLES = 3') && /while \(old\.length >= MAX_RIPPLES\)/.test(rippleJs));
  check('ripple: JS respects prefers-reduced-motion (early return, no listener)', rippleJs.includes("window.matchMedia('(prefers-reduced-motion: reduce)')") && rippleJs.includes('.matches) return;'));
  check('ripple: JS never intercepts the click (only appends a span; no preventDefault)', !/preventDefault|stopPropagation|return false/.test(rippleJs));

  // Real ripple behaviour in a stubbed DOM (same pattern as the
  // gallery / WhatsApp IIFE tests: vm sandbox, hand-built elements).
  function runRipple(reducedMotion) {
    const listeners = {};
    function makeStubEl(tagName) {
      const el = {
        tagName: (tagName || 'div').toUpperCase(),
        _classes: new Set(),
        _attrs: {},
        _listeners: {},
        style: {},
        children: [],
        parentNode: null,
        classList: {
          add(c) { el._classes.add(c); },
          remove(c) { el._classes.delete(c); },
          contains(c) { return el._classes.has(c); },
        },
        set className(v) { el._classes = new Set(String(v).split(/\s+/).filter(Boolean)); },
        get className() { return Array.from(el._classes).join(' '); },
        setAttribute(k, v) { el._attrs[k] = String(v); },
        getAttribute(k) { return el._attrs[k] === undefined ? null : el._attrs[k]; },
        appendChild(child) { child.parentNode = el; el.children.push(child); return child; },
        removeChild(child) { const i = el.children.indexOf(child); if (i >= 0) el.children.splice(i, 1); child.parentNode = null; return child; },
        addEventListener(type, fn) { (el._listeners[type] = el._listeners[type] || []).push(fn); },
        closest(sel) {
          // Self-match only is enough here: targets are top-level.
          // Attribute-only parts (e.g. [role="button"]) must match
          // the attribute — they must NOT match every element.
          const parts = sel.split(',').map((s) => s.trim());
          for (const part of parts) {
            const m = part.match(/^([a-z]+)?(?:\[([^\]=]+)="([^"]*)"\])?$/i);
            if (!m) continue;
            const tag = m[1];
            const attr = m[2];
            const val = m[3];
            if (tag && tag.toLowerCase() !== el.tagName.toLowerCase()) continue;
            if (attr && el.getAttribute(attr) !== val) continue;
            return el;
          }
          return null;
        },
      };
      return el;
    }
    const body = makeStubEl('body');
    const doc = {
      body,
      createElement(tag) { return makeStubEl(tag); },
      querySelectorAll(sel) {
        if (sel === '.click-ripple') return body.children.filter((c) => c.classList.contains('click-ripple'));
        return [];
      },
      addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    };
    const sandbox = {
      document: doc,
      window: { matchMedia: () => ({ matches: reducedMotion }) },
      setTimeout: () => 0,
      console,
    };
    vm.createContext(sandbox);
    vm.runInContext(rippleJs, sandbox);
    return { doc, body, listeners, makeStubEl };
  }

  const run = runRipple(false);
  check('ripple behaviour: a pointerdown listener is registered (motion allowed)', (run.listeners.pointerdown || []).length === 1);
  const fire = (ev) => (run.listeners.pointerdown || []).forEach((fn) => fn(ev));
  const link = run.makeStubEl('a');
  fire({ button: 0, target: link, clientX: 123, clientY: 456, pointerType: 'mouse' });
  const ripplesAfterClick = run.doc.querySelectorAll('.click-ripple');
  check('ripple behaviour: left-click on a link creates a ripple at the click point', ripplesAfterClick.length === 1 && ripplesAfterClick[0].style.left === '123px' && ripplesAfterClick[0].style.top === '456px');
  const plainDiv = run.makeStubEl('div');
  fire({ button: 0, target: plainDiv, clientX: 10, clientY: 20, pointerType: 'mouse' });
  check('ripple behaviour: mouse click on a plain div also ripples (everywhere on the page)', run.doc.querySelectorAll('.click-ripple').length === 2);
  const input = run.makeStubEl('input');
  input.setAttribute('type', 'text');
  fire({ button: 0, target: input, clientX: 50, clientY: 60, pointerType: 'mouse' });
  const textarea = run.makeStubEl('textarea');
  fire({ button: 0, target: textarea, clientX: 50, clientY: 60, pointerType: 'mouse' });
  check('ripple behaviour: clicks inside a text input / textarea create NO ripple (typing never ripples)', run.doc.querySelectorAll('.click-ripple').length === 2);
  fire({ button: 1, target: link, clientX: 70, clientY: 80, pointerType: 'mouse' });
  fire({ button: 2, target: link, clientX: 70, clientY: 80, pointerType: 'mouse' });
  check('ripple behaviour: middle / right click creates NO ripple (primary button only)', run.doc.querySelectorAll('.click-ripple').length === 2);
  fire({ button: 0, target: plainDiv, clientX: 90, clientY: 100, pointerType: 'touch' });
  check('ripple behaviour: touch scroll on a plain div creates NO ripple', run.doc.querySelectorAll('.click-ripple').length === 2);
  const button = run.makeStubEl('button');
  fire({ button: 0, target: button, clientX: 90, clientY: 100, pointerType: 'touch' });
  check('ripple behaviour: touch tap on a button DOES ripple', run.doc.querySelectorAll('.click-ripple').length === 3);
  // Spam: the 4th ripple drops the oldest, so only 3 stay alive.
  fire({ button: 0, target: link, clientX: 1, clientY: 1, pointerType: 'mouse' });
  check('ripple behaviour: at most 3 ripples alive (4th click drops the oldest)', run.doc.querySelectorAll('.click-ripple').length === 3);
  const first = run.doc.querySelectorAll('.click-ripple')[0];
  check('ripple behaviour: oldest ripple is the dropped one (newest 3 remain)', first.style.left !== '123px');
  (first._listeners.animationend || []).forEach((fn) => fn());
  check('ripple behaviour: animationend removes the ripple', run.doc.querySelectorAll('.click-ripple').length === 2);
  const reduced = runRipple(true);
  check('ripple behaviour: reduced-motion registers NO pointerdown listener at all', (reduced.listeners.pointerdown || []).length === 0);

  // ---------- 4. Product-card hover refinement ----------
  const cardHover = hoverBlocks.match(/\.product-card:hover\s*\{[^}]*\}/);
  check('card: hover keeps the -10px lift (PR #69)', !!cardHover && /transform:\s*translateY\(-10px\)/.test(cardHover));
  check('card: hover keeps the 2px dark-gold ring + deep shadow (border only)', !!cardHover && /box-shadow:\s*0 0 0 2px var\(--mega-hover-gold\), 0 18px 36px/.test(cardHover));
  check('card: hover does NOT colour the whole card (no background on .product-card:hover)', !!cardHover && !/background:/.test(cardHover));
  const imgZoom = hoverBlocks.match(/\.product-card:hover img\s*\{[^}]*\}/);
  check('card: photo still zooms 1.08x on hover', !!imgZoom && /transform:\s*scale\(1\.08\)/.test(imgZoom));
  check('card: no .product-card:hover h3 rule — the title is unchanged on hover', !/\.product-card:hover h3/.test(cssNoComments));
  check('card: the PR #69 rule that golded the button on CARD hover is GONE', !/\.product-card:hover \.btn-card/.test(cssNoComments));
  check('card: the :focus-within button-gold rule is GONE too', !/\.product-card:focus-within \.btn-card/.test(cssNoComments));
  const btnHover = ruleBody(cssTopLevel, /\.btn-card:hover\s*\{[^}]*\}/);
  // UPDATED (fix/mini-cart-drawer-hover): button hover is now
  // success green + -2px lift, not dark gold — still ONLY on its
  // own :hover (never on card hover).
  check('card: button turns success green ONLY on its own :hover (still navy -> green, + -2px lift)', !!btnHover && /background:\s*var\(--success\)/.test(btnHover) && /color:\s*#fff/.test(btnHover) && /transform:\s*translateY\(-2px\)/.test(btnHover));
  check('card: button :focus-visible / :active still match the button\'s own states (green / darker green #176327, not card hover)', /background:\s*var\(--success\)/.test(ruleBody(cssTopLevel, /\.product-card \.btn-card:focus-visible\s*\{[^}]*\}/) || '') && /background:\s*#176327/.test(ruleBody(cssTopLevel, /\.product-card \.btn-card:active\s*\{[^}]*\}/) || ''));
  const btnBase = cssTopLevel.match(/^\.btn-card \{[^}]*\}/m);
  check('card: base button is still dark navy (normal colour on card hover)', !!btnBase && /background:\s*var\(--navy\)/.test(btnBase[0]));
  // Bottom zone.
  const footHover = hoverBlocks.match(/\.product-card:hover \.product-card-foot\s*\{[^}]*\}/);
  check('card: bottom zone gets the mint background on card hover', !!footHover && /background:\s*var\(--card-foot-hover\)/.test(footHover));
  const footFocus = ruleBody(cssTopLevel, /\.product-card:focus-within \.product-card-foot\s*\{[^}]*\}/);
  check('card: :focus-within gives the bottom zone the mint background too (keyboard)', !!footFocus && /background:\s*var\(--card-foot-hover\)/.test(footFocus));
  const footVar = ruleBody(cssTopLevel, /:root\s*\{[^}]*--card-foot-hover:[^}]*\}/);
  check('card: light-mode foot is soft mint green #e3f2e6 (PR #72 — neither gold nor blue)', !!footVar && /--card-foot-hover:\s*#e3f2e6/.test(footVar));
  check('card: dark-mode foot is a deep green tint #1c2b22 (PR #72 — neither gold nor blue)', !!darkVars && /--card-foot-hover:\s*#1c2b22/.test(darkVars));
  const footPush = ruleBody(cssTopLevel, /\.product-card > \.product-card-foot\s*\{[^}]*\}/);
  check('card: foot pushes the button to the bottom (margin-top: auto)', !!footPush && /margin-top:\s*auto/.test(footPush));
  const footBase = cssTopLevel.match(/^\.product-card-foot \{[^}]*\}/m);
  check('card: foot has bottom padding 14px so the mint bg reaches the card edge', !!footBase && /padding:\s*0 0 14px/.test(footBase[0]));
  check('card: foot button has no bottom margin (no double space, no margin collapse)', /\.product-card-foot \.btn-card\s*\{\s*margin-bottom:\s*0;/.test(cssTopLevel));
  const formRule = ruleBody(cssTopLevel, /\.product-card form\s*\{[^}]*\}/);
  check('card: form rule is plain margin: 0 now (the foot does the pushing)', !!formRule && /margin:\s*0/.test(formRule) && !/margin-top:\s*auto/.test(formRule));
  check('card: old "button/form pushed to the bottom" selector is gone', !css.includes('.product-card > a.btn-card, .product-card > form { margin-top: auto; }'));
  check('card: :focus-within keeps the lift + ring (keyboard)', !!ruleBody(cssTopLevel, /\.product-card:focus-within\s*\{[^}]*\}/) && /translateY\(-10px\)/.test(ruleBody(cssTopLevel, /\.product-card:focus-within\s*\{[^}]*\}/)) && /0 0 0 2px var\(--mega-hover-gold\)/.test(ruleBody(cssTopLevel, /\.product-card:focus-within\s*\{[^}]*\}/)));
  // Reduced motion.
  check('reduced-motion: foot transition is disabled', reducedMotionBlocks.includes('.product-card-foot,'));
  check('reduced-motion: card lift + zoom disabled BUT the gold ring stays (colour only)', /\.product-card:hover, \.product-card:focus-within \{ transform: none; box-shadow: 0 0 0 2px var\(--mega-hover-gold\), 0 2px 8px var\(--shadow-sm\);/.test(reducedMotionBlocks) && /\.product-card:hover img \{ transform: none;/.test(reducedMotionBlocks));
  // Markup: foot wrapper exists in every card template.
  check('markup: index.ejs All Products card has a .product-card-foot (price + stock note + button inside)', indexEjs.includes('<div class="product-card-foot">') && indexEjs.includes('class="price-row"') && indexEjs.indexOf('<div class="product-card-foot">') < indexEjs.indexOf('class="price-row"'));
  check('markup: product.ejs Related Products card has a .product-card-foot', productEjs.includes('<div class="product-card-foot">'));
  check('markup: cart.ejs "You might also like" card has a .product-card-foot', cartEjs.includes('<div class="product-card-foot">'));
  check('markup: Recently Viewed renderer builds a .product-card-foot', indexEjs.includes("'<div class=\"product-card-foot\">'") || indexEjs.includes('product-card-foot"><p class="price">'));
  check('markup: the price is inside the foot, NOT inside the product link (All Products)', indexEjs.indexOf('</a>', indexEjs.indexOf('<div class="product-card">')) < indexEjs.indexOf('<div class="product-card-foot">'));
  // No regressions on the mega menu (its hover stays solid gold + -6px).
  check('no-regression: mega-menu item hover still solid dark gold + -6px lift', /\.mega-menu-panel a\.mega-col-title:hover/.test(cssNoComments) && /background:\s*var\(--mega-hover-gold\)/.test(cssNoComments));

  // ---------- 5. Direct EJS render of the homepage (5 live-like products, 3+ pill children) ----------
  const { buildMenuTree: bmt, buildMenuById } = require('../lib/categories');
  const catRows = [
    { id: 8, name: 'Home Appliances', parent_id: null, is_visible: 1, is_featured: 0, sort_order: 1, slug: 'home-appliances', image_url: '', description: '', banner_url: '', meta_title: '', meta_description: '', product_count: 3 },
    { id: 10, name: 'Kitchen', parent_id: 8, is_visible: 1, is_featured: 0, sort_order: 2, slug: 'kitchen', image_url: '', description: '', banner_url: '', meta_title: '', meta_description: '', product_count: 1 },
    { id: 11, name: 'Home Utility', parent_id: 8, is_visible: 1, is_featured: 0, sort_order: 3, slug: 'home-utility', image_url: '', description: '', banner_url: '', meta_title: '', meta_description: '', product_count: 2 },
    { id: 13, name: 'Kitchen Tools', parent_id: 10, is_visible: 1, is_featured: 0, sort_order: 1, slug: 'kitchen-tools', image_url: '', description: '', banner_url: '', meta_title: '', meta_description: '', product_count: 1 },
    { id: 12, name: 'Winter Collection', parent_id: null, is_visible: 1, is_featured: 0, sort_order: 2, slug: 'winter-collection', image_url: '', description: '', banner_url: '', meta_title: '', meta_description: '', product_count: 1 },
  ];
  const menu = bmt(catRows);
  const products = [
    { id: 3, name: 'BINBOND 2521 Men\'s Luxury Quartz Watch', image: 'watch.jpg', price: 990, compare_at_price: 1250, stock: 15 },
    { id: 4, name: '4-in-1 Rechargeable Handheld Electric Food Chopper', image: 'chopper.jpg', price: 999, compare_at_price: null, stock: 12 },
    { id: 5, name: 'MLSM-202 Portable Electric Sewing Machine', image: 'sewing.jpg', price: 1250, compare_at_price: null, stock: 16 },
    { id: 6, name: 'Mini Bag Sealer & Cutter 2-in-1', image: 'sealer.jpg', price: 399, compare_at_price: null, stock: 20 },
    { id: 7, name: 'A.T.Z New Collection Hit Western Dress Two Piece Tops For Women', image: 'dress.jpg', price: 310, compare_at_price: 599, stock: 8 },
  ];
  let html = '';
  try {
    html = await renderFile(indexPath, {
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
      products,
      bestSellers: products.slice(0, 4),
      variantProductIds: [7],
      optionProductIds: [],
      heroProduct: { id: 3, name: 'BINBOND 2521 Men\'s Luxury Quartz Watch', price: 990, image: 'watch.jpg' },
      banners: [],
    });
  } catch (e) {
    check('render: homepage renders (EJS)', false, String(e && e.message));
  }
  if (html) {
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/'/g, '&#39;');
    check('render: all 5 products present', products.every((p) => html.includes(esc(p.name))));
    // Every server-rendered card (5 All Products + 4 Best Sellers)
    // has a foot, and the foot holds the price + the button. Strip
    // the <script> blocks first — the Recently Viewed renderer
    // string (which also contains a foot) lives in the inline
    // script and would be counted a 10th time.
    const htmlNoScripts = html.replace(/<script[\s\S]*?<\/script>/g, '');
    const footCount = (htmlNoScripts.match(/<div class="product-card-foot">/g) || []).length;
    check('render: every server-rendered card has a .product-card-foot (5 All + 4 Best Sellers = 9)', footCount === 9, `found ${footCount}`);
    const allStart = html.indexOf('All Products');
    const allEnd = html.indexOf('🔥 Best Sellers', allStart);
    const allSection = html.slice(allStart, allEnd);
    check('render: All Products card — price + Add to Cart sit inside the foot', allSection.includes('<div class="product-card-foot">') && allSection.includes('action="/cart/add/3"') && allSection.indexOf('<div class="product-card-foot">') < allSection.indexOf('action="/cart/add/3"'));
    check('render: All Products card — the anchor closes BEFORE the foot (price is not inside the link)', allSection.includes('</a>\n      <div class="product-card-foot">'));
    check('render: variant product keeps "Choose Option →" inside the foot (NOT changed to Add to Cart)', allSection.includes('Choose Option →') && allSection.indexOf('<div class="product-card-foot">', allSection.indexOf('/product/7')) < allSection.indexOf('Choose Option →'));
    check('render: Best Sellers cards have feet with Add to Cart', html.includes('🔥 Best Sellers') && (html.split('🔥 Best Sellers')[1] || '').includes('<div class="product-card-foot">'));
    // Pills dropdown: 3 links (2 children + 1 grandchild) — the
    // generic rule covers all of them; no per-item markup.
    const pillMenuStart = html.indexOf('<div class="cat-pill-menu">');
    const pillMenuEnd = html.indexOf('</div>', pillMenuStart);
    const pillMenu = html.slice(pillMenuStart, pillMenuEnd);
    check('render: pill dropdown shows 3 links (Kitchen, Home Utility + grandchild Kitchen Tools)', pillMenu.includes('Kitchen') && pillMenu.includes('Home Utility') && pillMenu.includes('Kitchen Tools'));
    check('render: pill dropdown links are plain <a> links (no per-item class/hook)', !/class="[^"]*pill-child/.test(pillMenu) && (pillMenu.match(/<a href=/g) || []).length === 3);
    check('render: pills row is the plain category-bar (band is CSS, not extra markup)', html.includes('<div class="category-bar" id="products">') && !html.includes('pills-band'));
    // Ripple script tag in the rendered footer.
    check('render: shop footer includes the click-ripple script', html.includes('/js/click-ripple.js'));
  }

  console.log(`\n${passes.length} passed, ${failures.length} failed.`);
  if (failures.length) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
