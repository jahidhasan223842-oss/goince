// Floating side-cart tab + professional wishlist + search "null" fix
// (fix/floating-cart-wishlist).
//
// donal said (2026-11-27, two screenshots of goince.com/wishlist,
// logged in as Rohim, dark mode): how should this be done
// professionally; can the card/cart option be placed here (the red
// box he drew around the RIGHT EDGE of the page in the second
// screenshot); I keep seeing it on many sites; can this be done?
// Interpretation (stated in the PR body so he can correct it):
// a FLOATING CART BUTTON on the right edge of the shop, like many
// e-commerce sites have — a small fixed tab with a cart icon +
// item count; clicking it goes to the cart.
//
// What was built:
//   1. FLOATING SIDE-CART: a fixed tab on the right edge, vertically
//      centred (top: 50%), NOT bottom-right (the WhatsApp float
//      lives there). Gold pill + navy cart icon, badge reusing the
//      exact same res.locals cartCount as the header badge (same
//      session cart, same number), shown only when the cart is not
//      empty (header convention). Plain link to /cart — NOT a
//      slide-in mini-cart drawer (later step if he asks).
//   2. PROFESSIONAL WISHLIST: proper empty state (heart icon,
//      heading, one line, prominent "Start Shopping" button to /)
//      + "You may also like" (homepage Best Sellers, same card
//      markup + buttons) under it, so the page is never a dead
//      end. Wishlist WITH items is unchanged (Move to Cart /
//      Remove keep working exactly as before).
//   3. SEARCH "null" BUG: his second screenshot showed the literal
//      text "null" in the header search box on /wishlist.
//      Investigation (verified by a direct EJS render): the server
//      CANNOT produce it — EJS prints null/undefined as '' and no
//      route passes search: null (the guard has been
//      `typeof search !== 'undefined' ? search : ''` since the
//      initial commit) — and no JS anywhere assigns the input's
//      value. It most likely arrived as a stale form value
//      restored by the browser (bfcache / back-forward
//      navigation). Fix is defence in depth, both layers: the
//      header EJS guard is now a truthy check, and a tiny guard in
//      the footer search script clears a literal "null" /
//      "undefined" value on load, so the box can never show it.
//   4. OVERFLOW: his second screenshot looks shifted/cut on the
//      left. No overflow cause was found in code for the wishlist
//      page: html,body already carry `overflow-x: clip`, and every
//      fixed element (drawer, WhatsApp float, ripple, the new
//      side-cart) is position: fixed and cannot widen the page.
//      No fix invented — stated honestly in the PR body.
//
// No live MySQL needed: CSS/EJS source checks + direct EJS renders
// of the wishlist page (empty + with items, several cart counts
// and search values).
//
// Run:  node scripts/test-floating-cart-wishlist.js
// Exit code 0 = all checks passed.
'use strict';

const fs = require('fs');
const path = require('path');
const util = require('util');
const ejs = require('ejs');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'style.css'), 'utf8');
const headerEjs = fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', 'header.ejs'), 'utf8');
const footerEjs = fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', 'footer.ejs'), 'utf8');
const wishlistEjs = fs.readFileSync(path.join(__dirname, '..', 'views', 'wishlist.ejs'), 'utf8');
const shopJs = fs.readFileSync(path.join(__dirname, '..', 'routes', 'shop.js'), 'utf8');
const renderFile = util.promisify(ejs.renderFile);
const wishlistPath = path.join(__dirname, '..', 'views', 'wishlist.ejs');

const failures = [];
const passes = [];
function check(name, ok, detail) {
  if (ok) { passes.push(name); console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

// Same helpers as test-pills-band-ripple-card.js: top-level CSS
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

const products = [
  { id: 3, name: 'BINBOND 2521 Watch', price: 990, image: 'watch.jpg', stock: 15 },
  { id: 4, name: 'Food Chopper', price: 999, image: 'chopper.jpg', stock: 8 },
  { id: 5, name: 'MLSM-202 Sewing Machine', price: 1250, image: 'sewing.jpg', stock: 16 },
  { id: 6, name: 'Mini Bag Sealer', price: 399, image: 'sealer.jpg', stock: 20 },
  { id: 7, name: 'A.T.Z Two Piece Tops', price: 310, image: 'dress.jpg', stock: 5 },
];

function baseLocals(overrides) {
  return Object.assign({
    cartCount: 0,
    userName: 'Rohim',
    userPhotoUrl: null,
    siteSettings: { logo_url: '/icons/icon-192.png', facebook_url: '' },
    shopPhone: '01814697896',
    csrfToken: 'test-csrf',
    assetUrl: (p) => p,
    siteName: 'Goince',
    menuCategories: [],
    menuById: {},
    items: [],
    suggestions: products, // all 5, incl. variant product id 7
    variantProductIds: [7],
    optionProductIds: [],
    pageTitle: 'My Wishlist',
  }, overrides || {});
}

function searchInputValue(html) {
  const m = html.match(/id="search-input"[^>]*value="([^"]*)"/);
  return m ? m[1] : null;
}

(async () => {
  // ---------- 1. Side-cart CSS ----------
  const sideCart = ruleBody(cssTopLevel, '.side-cart');
  check('css: .side-cart rule exists', !!sideCart);
  if (sideCart) {
    check('css: side-cart is fixed at the right edge, vertically centred (top: 50%, right: 12px — fully rounded pill, not a half-tab)', /position:\s*fixed/.test(sideCart) && /top:\s*50%/.test(sideCart) && /right:\s*12px/.test(sideCart), sideCart.slice(0, 120));
    check('css: side-cart is NOT bottom-right (no bottom: rule)', !/bottom:/.test(sideCart));
    check('css: side-cart is a 56px tab (proper tap target) with a FULLY rounded pill (border-radius: 28px on all corners)', /width:\s*56px/.test(sideCart) && /height:\s*56px/.test(sideCart) && /border-radius:\s*28px;/.test(sideCart) && !/28px 0 0 28px/.test(sideCart));
    check('css: side-cart is gold (var(--accent)) with navy icon — reads on both themes', /background:\s*var\(--accent\)/.test(sideCart) && /color:\s*var\(--navy\)/.test(sideCart));
    check('css: side-cart sits fully inside the viewport (right: 12px, no negative offset on the tab itself)', !/right:\s*-/.test(sideCart) && !/left:\s*-/.test(sideCart) && /right:\s*12px/.test(sideCart));
    check('css: side-cart hover slides it out from the edge + deeper shadow (.25s spring)', /\.side-cart:hover\s*\{[^}]*translateX\(-4px\)/.test(cssTopLevel) && /cubic-bezier\(\.22,\s*1\.25,\s*\.36,\s*1\)/.test(sideCart));
    check('css: side-cart has a :focus-visible outline', /\.side-cart:focus-visible/.test(cssTopLevel));
  }
  const badge = ruleBody(cssTopLevel, '.side-cart-badge');
  check('css: .side-cart-badge rule exists (red, like the header badge)', !!badge && /background:\s*var\(--danger-solid\)/.test(badge) && /position:\s*absolute/.test(badge));
  check('css: reduced-motion disables the side-cart transition', /\.side-cart\s*\{\s*transition:\s*none/.test(reducedMotionCss));
  check('css: html,body still clip horizontal overflow (no sideways scroll)', /html,\s*body\s*\{\s*overflow-x:\s*clip/.test(cssTopLevel));
  const wa = ruleBody(cssTopLevel, '.whatsapp-float');
  check('css: WhatsApp float is bottom-right, side-cart is mid-right — their vertical axes differ', !!wa && /bottom:\s*20px/.test(wa) && !!sideCart && /top:\s*50%/.test(sideCart));

  // ---------- 2. Side-cart markup (footer partial) ----------
  check('footer: side-cart link to /cart exists in the shop footer', /<a href="\/cart" class="side-cart"/.test(footerEjs));
  check('footer: side-cart badge uses the same cartCount as the header (no second count source)', /side-cart-badge"><%= cartCount/.test(footerEjs) && !/sideCartCount|cart_count|cartTotal/.test(footerEjs));
  check('footer: side-cart badge follows the header convention (shown only when cartCount > 0)', /typeof cartCount !== 'undefined' && cartCount > 0/.test(footerEjs));
  check('footer: WhatsApp overlap guard also watches the side-cart (very short viewports)', /\.side-cart'/.test(footerEjs) && /GUARDED = '[^']*\.side-cart/.test(footerEjs));
  check('footer: side-cart is NOT in the admin footer (shop only)', !fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', 'admin-footer.ejs'), 'utf8').includes('side-cart'));

  // ---------- 3. Search "null" fix ----------
  check('header: search value guard is now a truthy check (null can never print "null")', /\(typeof search !== 'undefined' && search\) \? search : ''/.test(headerEjs));
  check('footer: client-side guard clears a literal "null"/"undefined" search value on load', /input\.value === 'null' \|\| input\.value === 'undefined'/.test(footerEjs));

  // ---------- 4. Wishlist route passes suggestions ----------
  check('route: /wishlist fetches Best Sellers suggestions (same top-4-by-sold query as the homepage)', /router\.get\('\/wishlist'/.test(shopJs) && /ORDER BY sold DESC, products\.created_at DESC LIMIT 4/.test(shopJs));
  check('route: /wishlist passes suggestions + variant/option ids to the view', /res\.render\('wishlist', \{[^}]*suggestions[^}]*variantProductIds[^}]*optionProductIds/.test(shopJs));

  // ---------- 5. Wishlist empty-state CSS ----------
  check('css: .wishlist-empty block exists (centred, padded)', !!ruleBody(cssTopLevel, '.wishlist-empty'));
  check('css: .wishlist-empty-icon is a 72px circle', !!ruleBody(cssTopLevel, '.wishlist-empty-icon') && /width:\s*72px/.test(ruleBody(cssTopLevel, '.wishlist-empty-icon')) && /border-radius:\s*50%/.test(ruleBody(cssTopLevel, '.wishlist-empty-icon')));

  // ---------- 6. Renders ----------
  let emptyHtml = '';
  try {
    emptyHtml = await renderFile(wishlistPath, baseLocals({ cartCount: 3 }));
  } catch (e) {
    check('render: wishlist (empty) renders', false, String(e && e.message));
  }
  if (emptyHtml) {
    // Side-cart badge matches the header badge (same count, same source).
    check('render: side-cart badge shows 3 (cartCount 3)', emptyHtml.includes('<span class="side-cart-badge">3</span>'));
    check('render: header cart badge also shows 3 (same count, same source)', emptyHtml.includes('<span class="badge">3</span>'));
    check('render: side-cart links to /cart', /<a href="\/cart" class="side-cart"/.test(emptyHtml));
    // Search input: no search given -> empty, placeholder only.
    check('render: search input is empty when no query is given (placeholder only)', searchInputValue(emptyHtml) === '');
    // Empty state.
    check('render: empty state has the heart icon + heading + text', emptyHtml.includes('wishlist-empty-icon') && emptyHtml.includes('Your wishlist is empty') && emptyHtml.includes('Start Shopping'));
    check('render: empty state Start Shopping button links to /', /<a href="\/" class="btn-primary">Start Shopping/.test(emptyHtml));
    check('render: empty state does NOT show the old bare one-liner', !emptyHtml.includes('Your wishlist is empty. <a href="/">Start shopping</a>'));
    // Suggestions.
    check('render: "You may also like" shows the suggestion cards', emptyHtml.includes('You may also like') && products.slice(0, 4).every((p) => emptyHtml.includes(p.name)));
    check('render: suggestion card (simple product) has an Add to Cart form', emptyHtml.includes('action="/cart/add/3"') && emptyHtml.includes('Add to Cart'));
    check('render: suggestion card (variant product id 7) keeps "Choose Option →"', emptyHtml.includes('/product/7') && emptyHtml.includes('Choose Option →'));
    // The null-guard script ships on the page.
    check('render: footer null-guard script is on the page', emptyHtml.includes("input.value === 'null'"));
  }

  // Empty cart: no badges anywhere.
  let zeroHtml = '';
  try {
    zeroHtml = await renderFile(wishlistPath, baseLocals({ cartCount: 0 }));
  } catch (e) {
    check('render: wishlist (empty cart) renders', false, String(e && e.message));
  }
  if (zeroHtml) {
    // UPDATED (fix/ajax-add-to-cart): footer-er inline JS-e ekhon
    // '.side-cart-badge' class-er naam-ti ache (AJAX add-er pore
    // badge update kore), tai shudhu string khonja jabe na — asol
    // badge ELEMENT-ta render hoyeche kina setai check korte hobe.
    check('render: empty cart shows NO side-cart badge (header convention)', !/<span class="side-cart-badge"/.test(zeroHtml));
    check('render: empty cart shows NO header badge either', !zeroHtml.includes('<span class="badge">'));
    check('render: side-cart tab itself is still there (link to /cart)', /<a href="\/cart" class="side-cart"/.test(zeroHtml));
  }

  // Search prefill still works, and null/undefined never print "null".
  for (const [label, val] of [['undefined', undefined], ['null', null], ['empty string', ''], ['real query "watch"', 'watch']]) {
    let html = '';
    try {
      const locals = baseLocals({ cartCount: 0 });
      if (val !== undefined) locals.search = val;
      html = await renderFile(wishlistPath, locals);
    } catch (e) {
      check(`render: search=${label} renders`, false, String(e && e.message));
      continue;
    }
    const got = searchInputValue(html);
    if (val === 'watch') check('render: search="watch" still prefills the box', got === 'watch', `got ${JSON.stringify(got)}`);
    else check(`render: search=${label} renders an empty box (never the literal "null")`, got === '', `got ${JSON.stringify(got)}`);
  }

  // Wishlist WITH items: item cards unchanged, no empty state, no suggestions.
  let itemsHtml = '';
  try {
    itemsHtml = await renderFile(wishlistPath, baseLocals({ cartCount: 1, items: [products[0], products[3]] }));
  } catch (e) {
    check('render: wishlist (with items) renders', false, String(e && e.message));
  }
  if (itemsHtml) {
    check('render: with items — item cards render with Move to Cart + Remove', itemsHtml.includes('Move to Cart') && itemsHtml.includes('Remove') && itemsHtml.includes('action="/wishlist/remove/3"'));
    check('render: with items — NO empty state and NO suggestions (behaviour unchanged)', !itemsHtml.includes('wishlist-empty') && !itemsHtml.includes('You may also like'));
    check('render: with items — side-cart badge shows 1', itemsHtml.includes('<span class="side-cart-badge">1</span>'));
  }

  console.log(`\n${passes.length} passed, ${failures.length} failed.`);
  if (failures.length) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
