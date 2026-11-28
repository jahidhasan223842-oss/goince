// Cart & buying — batch 2 (feat/cart-buying, PR #82).
//
//   B2  Sticky add-to-cart bar on the product page (desktop: top
//       under the sticky header; mobile: bottom). Variant na
//       bechle bar-er button kichu add kore na — buy box-e scroll
//       kore niye jay; variant bechha thakle asol form-tai submit
//       kore, tai PR #80-er AJAX flow (drawer + toast) chole.
//   B3  Buy Now: ekoi form-er ditiyo button — item-ta cart-e jog
//       kore (ager item thake — cart khali kora hoy na) sorasori
//       /checkout-e jay. Variant na bechle form lukano thake, tai
//       vul variant-e Buy Now chapa jay na. No-JS: plain POST lands
//       on /checkout.
//   B5  AJAX quantity steppers + remove inside the mini-cart
//       drawer (PR #80-er JSON-branch pattern on the EXISTING
//       /cart/update + /cart/remove routes). Cart page keeps its
//       full-page POST + redirect. BONUS FIX found while building
//       this: a plain submit of a stepper form sends BOTH the
//       number input and the clicked button (both name="quantity"),
//       and parseInt took the FIRST — the input's current quantity
//       — so the cart-page +/− buttons were no-ops (probe:
//       quantity=2&quantity=3 left the quantity at 2). The route
//       now picks the value that differs from the current quantity.
//   B6  Sticky order summary on the cart page (CSS position:
//       sticky — checkout-er motoi, PR #57).
//   B4  PER-PRODUCT free delivery (donal's own requirement — NO
//       global threshold was built): Admin Add/Edit Product-er
//       "Delivery" select (Free Delivery / Delivery Charge,
//       default Delivery Charge) writes the EXISTING
//       products.free_shipping column (boot schema + sql file —
//       kono notun column / manual ALTER lage na); product page +
//       shob card-e "Free Delivery" badge (site-er --success sobuj)
//       na hole zone charge; checkout-e delivery ৳0 sudhu jokhon
//       cart-er SOB item free; drawer-er delivery line cart-er
//       obostha onujayi bodlay.
//
// No live MySQL needed: source checks + direct EJS renders +
// the REAL shop routes on a stubbed DB (express, like
// test-ajax-add-to-cart.js) + the REAL footer IIFE + the REAL
// sticky-bar script in stubbed DOMs (vm sandbox).
//
// Run:  node scripts/test-cart-buying.js
// Exit code 0 = all checks passed.
'use strict';

const fs = require('fs');
const path = require('path');
const util = require('util');
const ejs = require('ejs');
const vm = require('vm');
const http = require('http');
const express = require('express');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'style.css'), 'utf8');
const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
const shopRoutes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'shop.js'), 'utf8');
const serverJs = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const adminJs = fs.readFileSync(path.join(__dirname, '..', 'routes', 'admin.js'), 'utf8');
const footerEjs = fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', 'footer.ejs'), 'utf8');
const drawerEjs = fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', 'mini-cart-content.ejs'), 'utf8');
const badgeEjs = fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', 'delivery-badge.ejs'), 'utf8');
const productEjs = fs.readFileSync(path.join(__dirname, '..', 'views', 'product.ejs'), 'utf8');
const cartEjs = fs.readFileSync(path.join(__dirname, '..', 'views', 'cart.ejs'), 'utf8');
const indexEjs = fs.readFileSync(path.join(__dirname, '..', 'views', 'index.ejs'), 'utf8');
const wishlistEjs = fs.readFileSync(path.join(__dirname, '..', 'views', 'wishlist.ejs'), 'utf8');
const checkoutEjs = fs.readFileSync(path.join(__dirname, '..', 'views', 'checkout.ejs'), 'utf8');
const adminFormEjs = fs.readFileSync(path.join(__dirname, '..', 'views', 'admin', 'add-product.ejs'), 'utf8');
const renderFile = util.promisify(ejs.renderFile);
// ejs.render is sync for template strings (promisify would never resolve — the callback is the 3rd arg, not standard).
const badgePath = path.join(__dirname, '..', 'views', 'partials', 'delivery-badge.ejs');
const drawerPath = path.join(__dirname, '..', 'views', 'partials', 'mini-cart-content.ejs');
const productPath = path.join(__dirname, '..', 'views', 'product.ejs');
const cartPath = path.join(__dirname, '..', 'views', 'cart.ejs');
const wishlistPath = path.join(__dirname, '..', 'views', 'wishlist.ejs');
const adminFormPath = path.join(__dirname, '..', 'views', 'admin', 'add-product.ejs');

const failures = [];
const passes = [];
function check(name, ok, detail) {
  if (ok) { passes.push(name); console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

const baseLocals = {
  siteName: 'Goince', siteSettings: {}, shopPhone: '+8801814697896', paymentMethods: [],
  assetUrl: (p) => p, userName: null, userPhotoUrl: null, cartCount: 0,
  menuCategories: [], menuById: {}, search: '',
  miniCart: [], miniCartSubtotal: 0, csrfToken: 'tok123',
  siteLogoAbs: '', siteFaviconAbs: '', siteOgImageAbs: '', siteUrl: 'http://127.0.0.1',
};

(async () => {
  // ---------- 1. B4 — Admin Add/Edit Product: Delivery select ----------
  check('admin form: a "Delivery" select named free_shipping exists (checkbox replaced)',
    /<select name="free_shipping">/.test(adminFormEjs) && !/name="free_shipping" value="1"[^>]*type="checkbox"|type="checkbox" name="free_shipping"/.test(adminFormEjs));
  const _selBlock = (adminFormEjs.match(/<select name="free_shipping">[\s\S]*?<\/select>/) || [''])[0];
  check('admin form: the select has EXACTLY two options — "Delivery Charge" (value 0) and "Free Delivery" (value 1)',
    _selBlock.includes('>Delivery Charge</option>') && _selBlock.includes('>Free Delivery</option>')
    && ( _selBlock.match(/<option /g) || []).length === 2);
  check('admin form: default is Delivery Charge (selected when no product, or product.free_shipping is falsy)',
    /<option value="0" <%= !product \|\| !product\.free_shipping \? 'selected' : '' %>>Delivery Charge<\/option>/.test(adminFormEjs));
  check('admin form: Free Delivery is selected only when product.free_shipping is set',
    /<option value="1" <%= product && product\.free_shipping \? 'selected' : '' %>>Free Delivery<\/option>/.test(adminFormEjs));
  check('admin form: the select lives in the Inventory & Shipping section (not a new admin page)',
    adminFormEjs.indexOf('data-section="inventory"') < adminFormEjs.indexOf('<select name="free_shipping">'));
  check('admin form: the form is multipart with ?_csrf= in the action (CSRF rule) — untouched by this PR',
    /enctype="multipart\/form-data"/.test(adminFormEjs) && /\?_csrf=/.test(adminFormEjs));
  const adminLocals = {
    siteName: 'Goince', csrfToken: 'tok123', categories: [], categoryGroups: [], categoryFlat: [],
    galleryImages: [], options: [], relatedIds: [], allProducts: [], videos: [],
    adminDisplayName: 'Admin', adminPhotoUrl: null, siteSettings: {},
  };
  let addHtml = '';
  let editFreeHtml = '';
  let editChargedHtml = '';
  try {
    addHtml = await renderFile(adminFormPath, Object.assign({}, adminLocals, { product: null }));
  } catch (e) { check('admin form: Add Product renders (EJS)', false, String(e && e.message)); }
  try {
    editFreeHtml = await renderFile(adminFormPath, Object.assign({}, adminLocals, { product: { id: 3, name: 'Watch', free_shipping: 1 } }));
  } catch (e) { check('admin form: Edit Product (free) renders (EJS)', false, String(e && e.message)); }
  try {
    editChargedHtml = await renderFile(adminFormPath, Object.assign({}, adminLocals, { product: { id: 5, name: 'Machine', free_shipping: 0 } }));
  } catch (e) { check('admin form: Edit Product (charged) renders (EJS)', false, String(e && e.message)); }
  if (addHtml) {
    check('admin form render: ADD (new product) defaults to Delivery Charge selected',
      /<option value="0" selected>Delivery Charge<\/option>/.test(addHtml)
      && !/<option value="1" selected>Free Delivery<\/option>/.test(addHtml));
  }
  if (editFreeHtml) {
    check('admin form render: EDIT of a Free Delivery product selects Free Delivery',
      /<option value="1" selected>Free Delivery<\/option>/.test(editFreeHtml)
      && !/<option value="0" selected>Delivery Charge<\/option>/.test(editFreeHtml));
  }
  if (editChargedHtml) {
    check('admin form render: EDIT of a Delivery Charge product selects Delivery Charge',
      /<option value="0" selected>Delivery Charge<\/option>/.test(editChargedHtml)
      && !/<option value="1" selected>Free Delivery<\/option>/.test(editChargedHtml));
  }

  // ---------- 2. B4 — DB flag: existing column, default 0 (delivery charge) ----------
  check('db: server.js boot schema already creates free_shipping TINYINT(1) NOT NULL DEFAULT 0 (no new column needed)',
    /\['free_shipping', 'TINYINT\(1\) NOT NULL DEFAULT 0'\]/.test(serverJs));
  check('db: sql/add_product_advanced.sql already has the free_shipping column',
    fs.readFileSync(path.join(__dirname, '..', 'sql', 'add_product_advanced.sql'), 'utf8').includes('ADD COLUMN IF NOT EXISTS free_shipping TINYINT(1) NOT NULL DEFAULT 0'));
  check('db: sql/add_free_delivery.sql documents the column + the manual ALTER (deploy needs no manual step)',
    fs.existsSync(path.join(__dirname, '..', 'sql', 'add_free_delivery.sql'))
    && fs.readFileSync(path.join(__dirname, '..', 'sql', 'add_free_delivery.sql'), 'utf8').includes('ADD COLUMN IF NOT EXISTS free_shipping TINYINT(1) NOT NULL DEFAULT 0'));
  check('db: admin parse maps the select 1/0 to the flag (no new parsing)',
    /free_shipping: body\.free_shipping === '1' \? 1 : 0/.test(adminJs));
  check('db: NO global free-delivery threshold was built (per-product only)',
    !/free_delivery_threshold|freeDeliveryThreshold|delivery_threshold|free_shipping_threshold/.test(shopRoutes)
    && !/free_delivery_threshold/.test(serverJs));

  // ---------- 3. B4 — Delivery badge partial ----------
  const badgeFree = ejs.render(badgeEjs, { p: { free_shipping: 1 }, deliveryInside: 60, deliveryOutside: 120 });
  const badgeCharged = ejs.render(badgeEjs, { p: { free_shipping: 0 }, deliveryInside: 60, deliveryOutside: 120 });
  const badgeDefault = ejs.render(badgeEjs, { p: { free_shipping: 0 } });
  check('badge: Free Delivery product renders the green badge (delivery-badge--free)',
    badgeFree.includes('delivery-badge--free') && badgeFree.includes('🚚 Free Delivery'));
  check('badge: charged product renders the zone charge info (৳60–৳120) with the full breakdown in the title',
    badgeCharged.includes('Delivery ৳60–৳120') && badgeCharged.includes('title="Delivery: ৳60 inside Dhaka / ৳120 outside Dhaka"')
    && !badgeCharged.includes('Free Delivery'));
  check('badge: no charge locals → defaults to ৳60/৳120 (never blank)',
    badgeDefault.includes('Delivery ৳60–৳120'));
  check('badge: custom zone charges flow through (not hardcoded 60/120)',
    (ejs.render(badgeEjs, { p: { free_shipping: 0 }, deliveryInside: 80, deliveryOutside: 150 })).includes('Delivery ৳80–৳150'));
  check('badge css: the free badge uses the site green var(--success), white text — no new colour',
    /\.delivery-badge--free \{[^}]*background:\s*var\(--success\)[^}]*color:\s*#fff/.test(cssNoComments));
  const lightSuccess = (css.match(/:root \{[\s\S]*?--success:\s*(#[0-9a-f]+)/) || [])[1];
  const darkSuccess = (css.match(/\[data-theme="dark"\] \{[\s\S]*?--success:\s*(#[0-9a-f]+)/) || [])[1];
  check('badge css: --success is the same green in BOTH themes (#1f7a30 light + dark), so the badge reads in both',
    lightSuccess === '#1f7a30' && darkSuccess === '#1f7a30');
  check('badge css: the batch CSS block introduces no new hex colour (palette only)',
    !/#[0-9a-f]{3,8}/.test(cssNoComments.slice(cssNoComments.indexOf('.delivery-badge {')).replace(/#fff\b/g, '')));

  // ---------- 4. B4 — Card sites all use the shared badge partial ----------
  check('cards: homepage main grid includes the delivery badge partial (with real zone charges)',
    (indexEjs.match(/include\('partials\/delivery-badge'/g) || []).length >= 2);
  check('cards: product page Related includes the badge partial',
    /include\('partials\/delivery-badge', \{ p: p, deliveryInside: deliveryCharge, deliveryOutside: deliveryChargeOutside \}\)/.test(productEjs));
  check('cards: cart "You might also like" includes the badge partial',
    /include\('partials\/delivery-badge'/.test(cartEjs));
  check('cards: wishlist (suggestions + saved items) includes the badge partial',
    (wishlistEjs.match(/include\('partials\/delivery-badge'/g) || []).length === 2);
  check('cards: Recently Viewed grid carries the zone charges as data attributes for the JS badge',
    /data-delivery-inside=/.test(indexEjs) && /data-delivery-outside=/.test(indexEjs));
  check('cards: Recently Viewed JS renders the same badge (freeDelivery from the saved item or the server map)',
    /function deliveryBadgeHTML\(free\)/.test(indexEjs) && /freeDelivery/.test(indexEjs) && /serverMap\[it\.id\]\.freeDelivery/.test(indexEjs));
  check('cards: homepage route passes deliveryCharges to the view',
    /const deliveryCharges = await getDeliveryCharges\(\);/.test(shopRoutes) && /deliveryCharges,/.test(shopRoutes));
  check('cards: cart + wishlist routes pass deliveryCharges to the view',
    (shopRoutes.match(/const deliveryCharges = await getDeliveryCharges\(\);/g) || []).length >= 3);
  check('cards: Recently Viewed server map carries freeDelivery per product',
    /freeDelivery: !!r\.free_shipping/.test(shopRoutes) && /SELECT id, stock, free_shipping FROM products/.test(shopRoutes));

  // ---------- 5. B4 — Product page: Free Delivery line vs charge line ----------
  const productLocals = {
    notify: null, pageTitle: 'Watch - Goince', metaDescription: 'Watch',
    galleryImages: [], options: [], optionLabel: null, variants: [], variantAttributes: [],
    specs: [], discountPercent: null, related: [], secondImages: {}, reviews: [],
    avgRating: null, reviewCount: 0, reviewPending: false,
    deliveryCharge: 60, deliveryChargeOutside: 120, descriptionHtml: '',
  };
  const freeProduct = { id: 3, name: 'BINBOND 2521 Watch', price: 990, image: 'watch.jpg', stock: 15, free_shipping: 1, target_audience: 'all', short_description: '', allow_backorder: false };
  const chargedProduct = { id: 5, name: 'MLSM-202 Sewing Machine', price: 1250, image: 'sew.jpg', stock: 16, free_shipping: 0, target_audience: 'all', short_description: '', allow_backorder: false };
  let freePage = '';
  let chargedPage = '';
  try {
    freePage = await renderFile(productPath, Object.assign({}, baseLocals, productLocals, { product: freeProduct }));
  } catch (e) { check('product page: free-delivery product renders (EJS)', false, String(e && e.message)); }
  try {
    chargedPage = await renderFile(productPath, Object.assign({}, baseLocals, productLocals, { product: chargedProduct }));
  } catch (e) { check('product page: charged product renders (EJS)', false, String(e && e.message)); }
  if (freePage) {
    check('product page: Free Delivery product shows the green Free Delivery line (no charge line)',
      freePage.includes('delivery-free-line') && freePage.includes('<strong>Free Delivery</strong>')
      && !freePage.includes('Delivery Charge:'));
  }
  if (chargedPage) {
    check('product page: charged product shows the zone charges (৳60 inside / ৳120 outside), no free line',
      chargedPage.includes('Delivery Charge:') && chargedPage.includes('৳60') && chargedPage.includes('৳120')
      && !chargedPage.includes('delivery-free-line'));
  }
  if (freePage && chargedPage) {
    check('product page: Recently Viewed save carries freeDelivery for both products',
      freePage.includes('freeDelivery: true') && chargedPage.includes('freeDelivery: false'));
  }

  // ---------- 6. B2 — Sticky buy bar: markup + behaviour (source) ----------
  check('sticky bar: markup exists on the product page (hidden by default, photo + name + price + Add to Cart)',
    /<div class="sticky-buy-bar" id="sticky-buy-bar" hidden>/.test(productEjs)
    && /<span class="sticky-buy-name"><%= product\.name %><\/span>/.test(productEjs)
    && /<span class="sticky-buy-price" id="sticky-buy-price">৳<%= product\.price %><\/span>/.test(productEjs)
    && /<button type="button" class="btn-primary" id="sticky-buy-btn"/.test(productEjs));
  check('sticky bar: sentinel anchor sits right after the buy form (works even when the form is hidden for variants)',
    /<\/form>\s*<% \/[*#]?\s*B2 sticky bar-er anchor[\s\S]*?<div id="buy-box-sentinel" aria-hidden="true"><\/div>/.test(productEjs)
    || (productEjs.indexOf('</form>') < productEjs.indexOf('<div id="buy-box-sentinel"') && productEjs.indexOf('<div id="buy-box-sentinel"') < productEjs.indexOf('notify-me-box')));
  check('sticky bar: script shows the bar only when the buy box has scrolled out (sentinel bottom < 0)',
    /bar\.hidden = !\(r\.bottom < 0\)/.test(productEjs));
  check('sticky bar: desktop top is measured from the real sticky header (JS), 64px is only the CSS fallback',
    /bar\.style\.top = header\.offsetHeight/.test(productEjs) && /\.sticky-buy-bar \{[^}]*top:\s*64px/.test(cssNoComments));
  check('sticky bar: with an unchosen variant the button scrolls to the selectors instead of adding (no wrong variant)',
    /if \(hasVariants && variantInput && !variantInput\.value\)/.test(productEjs)
    && /scrollIntoView\(\{ behavior: reduced \? 'auto' : 'smooth', block: 'center' \}\)/.test(productEjs));
  check('sticky bar: with a chosen (or no) variant the button submits the REAL form (requestSubmit → PR #80 AJAX flow)',
    /if \(form\.requestSubmit\) form\.requestSubmit\(\);/.test(productEjs));
  check('sticky bar: variant selection syncs the bar price + Buy Now/disabled state with the main buy box',
    /if \(stickyPriceEl\) stickyPriceEl\.textContent/.test(productEjs)
    && /if \(buyNowBtn\) buyNowBtn\.disabled/.test(productEjs)
    && /if \(stickyBuyBtn\) stickyBuyBtn\.disabled/.test(productEjs));
  check('sticky bar: reduced-motion is respected (instant scroll, no transition)',
    /behavior: reduced \? 'auto' : 'smooth'/.test(productEjs) && /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.sticky-buy-bar \{[^}]*transition:\s*none/.test(css));
  check('sticky bar: the bar button is in BOTH overlap guards (WhatsApp float + side-cart tab hide when it covers them)',
    /#sort, \.cart-summary \.btn-primary, \.product-card \.btn-card, \.add-to-cart-form button, \.product-info \.btn-primary, \.sticky-buy-bar \.btn-primary, \.side-cart/.test(footerEjs)
    && /#sort, \.cart-summary \.btn-primary, \.product-card \.btn-card, \.add-to-cart-form button, \.product-info \.btn-primary, \.sticky-buy-bar \.btn-primary'/.test(footerEjs));
  // HONEST UPDATE (feat/mobile-pwa, 2026-11-28): the mobile sticky
  // bar no longer sits at bottom: 0 — the new mobile bottom nav
  // (60px + safe-area) would cover its Add to Cart button. The bar
  // now sits ABOVE the nav: bottom: calc(60px + safe-area).
  check('sticky bar css: fixed bar, desktop top under the header / mobile bottom, z-index 450 (below header 500, above content)',
    /\.sticky-buy-bar \{[^}]*position:\s*fixed[^}]*z-index:\s*450/.test(cssNoComments)
    && /@media \(min-width: 769px\)[\s\S]*?\.sticky-buy-bar \{[^}]*top:\s*64px/.test(cssNoComments)
    && /@media \(max-width: 768px\)[\s\S]*?\.sticky-buy-bar \{[^}]*bottom:\s*calc\(60px \+ env\(safe-area-inset-bottom/.test(cssNoComments));

  // ---------- 7. B3 — Buy Now: markup + route contract (source) ----------
  check('buy now: button is a second submit in the SAME add-to-cart form (name=buy_now, CSRF field shared)',
    /<form action="\/cart\/add\/<%= product\.id %>" method="POST" class="add-to-cart-form"[\s\S]*?<%- include\('partials\/csrf-field'\) %>[\s\S]*?<button type="submit" name="buy_now" value="1" class="btn-buy-now" id="buy-now-btn"/.test(productEjs));
  // E6 (feat/payments-messaging, batch 9): the express-gateway
  // button joins Buy Now in skipping the AJAX interceptor — both
  // must do a plain POST so the server can redirect to checkout.
  check('buy now: footer JS never AJAX-intercepts a Buy Now submit (it must navigate to /checkout)',
    /if \(isAdd && submitter && \(submitter\.name === 'buy_now' \|\| submitter\.name === 'express_gateway'\)\) return;/.test(footerEjs));
  check('buy now: route adds the item, keeps the rest of the cart, and redirects to /checkout (not /cart)',
    /if \(req\.body\.buy_now === '1'\) return res\.redirect\('\/checkout'\);/.test(shopRoutes));
  check('buy now: the click tracker records which submit button was clicked (Buy Now vs Add to Cart)',
    /b\.form\._clickedSubmitter = b;/.test(footerEjs));
  check('buy now css: secondary style — transparent with a gold border, gold on hover (no new colour)',
    /\.btn-buy-now \{[^}]*background:\s*transparent[^}]*border:\s*2px solid var\(--accent\)/.test(cssNoComments)
    && /\.btn-buy-now:hover \{[^}]*background:\s*var\(--accent\)[^}]*color:\s*var\(--navy\)/.test(cssNoComments));

  // ---------- 8. B6 — Sticky cart summary (CSS) ----------
  check('cart summary: position sticky with top 84px (below the sticky header), own background + border so items never show through',
    /\.cart-summary \{[^}]*position:\s*sticky[^}]*top:\s*84px[^}]*background:\s*var\(--surface\)[^}]*border:\s*1px solid var\(--border\)/.test(cssNoComments));
  check('cart summary: checkout summary is still sticky (no regression from PR #57)',
    /\.checkout-summary \{[^}]*position:\s*sticky/.test(cssNoComments));
  check('cart summary: the cart page still renders the summary with subtotal/total + Proceed to Checkout',
    cartEjs.includes('class="cart-summary"') && cartEjs.includes('Proceed to Checkout'));

  // ---------- 9. Route E2E: checkout totals, Buy Now, drawer update/remove ----------
  const dbPath = require.resolve('../config/db');
  const CSRF_TOKEN = 'test-csrf-token-buying';
  const testSession = { cart: [], csrfToken: CSRF_TOKEN };
  const products = {
    3: { id: 3, name: 'BINBOND 2521 Watch', price: 990, image: 'watch.jpg', stock: 15, free_shipping: 1 },
    5: { id: 5, name: 'MLSM-202 Sewing Machine', price: 1250, image: 'sew.jpg', stock: 16, free_shipping: 0 },
    7: { id: 7, name: 'A.T.Z Dress', price: 310, image: 'dress.jpg', stock: 10, free_shipping: 1 },
  };
  const orderInserts = [];
  const dbStub = {
    query: async (sql, params) => {
      if (/allow_backorder/.test(sql)) return [[{ allow_backorder: 0 }]];
      if (/SELECT stock FROM products WHERE id = \?/.test(sql)) {
        const p = products[params[0]];
        return [[{ stock: p ? p.stock : 0 }]];
      }
      if (/FROM products WHERE id = \?/.test(sql)) {
        const p = products[params[0]];
        return [p ? [p] : []];
      }
      if (/FROM product_variants WHERE id = \? AND product_id = \?/.test(sql)) {
        if (params[0] === 11 && String(params[1]) === '7') return [[{ id: 11, product_id: 7, price: 1100, stock: 5 }]];
        return [[]];
      }
      if (/product_variant_attributes/.test(sql)) return [[{ attribute_name: 'Size', value: 'M' }]];
      if (/FROM product_options WHERE id = \? AND product_id = \?/.test(sql)) return [[]];
      if (/free_shipping, cod_allowed/.test(sql)) {
        const rows = (params || []).map((id) => products[id]).filter(Boolean)
          .map((p) => ({ id: p.id, free_shipping: p.free_shipping, cod_allowed: 1 }));
        return [rows];
      }
      return [[]];
    },
    getConnection: async () => ({
      beginTransaction: async () => {},
      commit: async () => {},
      rollback: async () => {},
      release: () => {},
      query: async (sql, params) => {
        if (/INSERT INTO orders/.test(sql)) { orderInserts.push(params); return [{ insertId: 42 }]; }
        if (/INSERT INTO order_items/.test(sql)) return [{}];
        if (/UPDATE products SET stock/.test(sql)) return [{}];
        if (/UPDATE product_variants SET stock/.test(sql)) return [{}];
        if (/SELECT stock FROM products WHERE id/.test(sql)) return [[{ stock: 10 }]];
        if (/SELECT stock FROM product_variants WHERE id/.test(sql)) return [[{ stock: 5 }]];
        if (/INSERT INTO stock_history/.test(sql)) return [{}];
        return [[]];
      },
    }),
  };
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: dbStub };
  const { csrfProtection } = require('../lib/csrf');
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = testSession;
    res.locals.userName = null; res.locals.userPhotoUrl = null; res.locals.cartCount = (testSession.cart || []).reduce((s, it) => s + it.quantity, 0);
    res.locals.siteSettings = {}; res.locals.shopPhone = '+8801814697896'; res.locals.paymentMethods = [];
    res.locals.assetUrl = (p) => p; res.locals.menuCategories = []; res.locals.menuById = {};
    res.locals.miniCart = testSession.cart || [];
    res.locals.miniCartSubtotal = res.locals.miniCart.reduce((s, it) => s + (Number(it.price) || 0) * it.quantity, 0);
    res.locals.miniCartDeliveryInside = 60; res.locals.miniCartDeliveryOutside = 120;
    res.locals.csrfToken = CSRF_TOKEN; res.locals.siteUrl = 'http://127.0.0.1';
    res.locals.siteLogoAbs = ''; res.locals.siteFaviconAbs = ''; res.locals.siteOgImageAbs = '';
    next();
  });
  app.use(csrfProtection);
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.use('/', require('../routes/shop'));
  function reqRaw(port, method, pathUrl, body, ajax) {
    return new Promise((resolve, reject) => {
      const headers = {};
      if (body !== null) { headers['Content-Type'] = 'application/x-www-form-urlencoded'; headers['Content-Length'] = Buffer.byteLength(body); }
      if (ajax) { headers['X-Requested-With'] = 'XMLHttpRequest'; headers.Accept = 'application/json'; }
      const req = http.request({ method, host: '127.0.0.1', port, path: pathUrl, headers }, (res) => {
        const parts = [];
        res.on('data', (c) => parts.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(parts).toString('utf8') }));
      });
      req.on('error', reject);
      if (body !== null) req.write(body);
      req.end();
    });
  }
  const enc = (o) => Object.entries(o).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  const freeItem = { cartKey: '3', id: 3, name: 'BINBOND 2521 Watch', price: 990, image: 'watch.jpg', quantity: 1, variantId: null, variantLabel: null, freeDelivery: true };
  const chargedItem = { cartKey: '5', id: 5, name: 'MLSM-202 Sewing Machine', price: 1250, image: 'sew.jpg', quantity: 1, variantId: null, variantLabel: null, freeDelivery: false };
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.on('listening', r));
  const port = server.address().port;
  try {
    // --- 9a. Checkout GET: all-free cart → FREE delivery, total = subtotal.
    testSession.cart = [Object.assign({}, freeItem)];
    const coFree = await reqRaw(port, 'GET', '/checkout', null, false);
    check('e2e checkout GET: all-free cart shows FREE 🚚 and total = subtotal (৳990, no delivery)',
      coFree.status === 200 && coFree.body.includes('FREE 🚚') && coFree.body.includes('id="total-display">৳990<'));
    // --- 9b. Checkout GET: mixed cart → zone charge (inside Dhaka ৳60 by default), total = subtotal + 60.
    testSession.cart = [Object.assign({}, freeItem), Object.assign({}, chargedItem)];
    const coMixed = await reqRaw(port, 'GET', '/checkout', null, false);
    check('e2e checkout GET: mixed cart (1 free + 1 charged) charges the inside-Dhaka zone ৳60, total ৳2,300',
      coMixed.status === 200 && !coMixed.body.includes('FREE 🚚')
      && coMixed.body.includes('id="delivery-display">৳60<') && coMixed.body.includes('id="total-display">৳2,300<'));
    // --- 9c. Checkout POST: all-free + outside Dhaka → order delivery_charge 0.
    orderInserts.length = 0;
    testSession.cart = [Object.assign({}, freeItem, { quantity: 2 })];
    const poFree = await reqRaw(port, 'POST', '/checkout', enc({ _csrf: CSRF_TOKEN, customer_name: 'Rohim', phone: '01814697896', address: 'Dhaka', payment_method: 'Cash on Delivery', delivery_area: 'outside_dhaka' }), false);
    check('e2e checkout POST: all-free cart, Outside Dhaka → order delivery_charge ৳0, total ৳1,980',
      poFree.status === 200 && orderInserts.length === 1 && orderInserts[0][8] === 0 && orderInserts[0][11] === 1980);
    // --- 9d. Checkout POST: mixed + outside Dhaka → zone charge ৳120.
    orderInserts.length = 0;
    testSession.cart = [Object.assign({}, freeItem), Object.assign({}, chargedItem)];
    const poMixedOut = await reqRaw(port, 'POST', '/checkout', enc({ _csrf: CSRF_TOKEN, customer_name: 'Rohim', phone: '01814697896', address: 'Chittagong', payment_method: 'Cash on Delivery', delivery_area: 'outside_dhaka' }), false);
    check('e2e checkout POST: mixed cart, Outside Dhaka → order delivery_charge ৳120, total ৳2,360',
      poMixedOut.status === 200 && orderInserts.length === 1 && orderInserts[0][8] === 120 && orderInserts[0][11] === 2360);
    // --- 9e. Checkout POST: mixed + inside Dhaka → zone charge ৳60.
    orderInserts.length = 0;
    testSession.cart = [Object.assign({}, freeItem), Object.assign({}, chargedItem)];
    const poMixedIn = await reqRaw(port, 'POST', '/checkout', enc({ _csrf: CSRF_TOKEN, customer_name: 'Rohim', phone: '01814697896', address: 'Dhaka', payment_method: 'Cash on Delivery', delivery_area: 'inside_dhaka' }), false);
    check('e2e checkout POST: mixed cart, Inside Dhaka → order delivery_charge ৳60, total ৳2,300',
      poMixedIn.status === 200 && orderInserts.length === 1 && orderInserts[0][8] === 60 && orderInserts[0][11] === 2300);
    // --- 9f. Checkout POST error path: all-free + bad phone → re-render still shows FREE (not the zone charge).
    testSession.cart = [Object.assign({}, freeItem)];
    const poErrFree = await reqRaw(port, 'POST', '/checkout', enc({ _csrf: CSRF_TOKEN, customer_name: 'Rohim', phone: 'bad', address: 'Dhaka', payment_method: 'Cash on Delivery', delivery_area: 'outside_dhaka' }), false);
    check('e2e checkout POST error: all-free cart + invalid phone re-renders with FREE 🚚 (error path agrees with the real total)',
      poErrFree.status === 200 && poErrFree.body.includes('FREE 🚚') && poErrFree.body.includes('Sothik naam'));
    testSession.cart = [Object.assign({}, freeItem), Object.assign({}, chargedItem)];
    const poErrMixed = await reqRaw(port, 'POST', '/checkout', enc({ _csrf: CSRF_TOKEN, customer_name: 'Rohim', phone: 'bad', address: 'Dhaka', payment_method: 'Cash on Delivery', delivery_area: 'outside_dhaka' }), false);
    check('e2e checkout POST error: mixed cart + invalid phone re-renders with the ৳120 zone charge',
      poErrMixed.status === 200 && !poErrMixed.body.includes('FREE 🚚') && poErrMixed.body.includes('id="delivery-display">৳120<'));

    // --- 9g. Buy Now: non-AJAX → 302 /checkout, item added, earlier items kept.
    testSession.cart = [Object.assign({}, chargedItem)];
    const bn1 = await reqRaw(port, 'POST', '/cart/add/3', enc({ _csrf: CSRF_TOKEN, quantity: '1', buy_now: '1' }), false);
    check('e2e buy now: POST /cart/add/3 with buy_now=1 → 302 to /checkout (not /cart), item added, earlier item kept',
      bn1.status === 302 && bn1.headers.location === '/checkout'
      && testSession.cart.length === 2 && testSession.cart.some((i) => i.id === 3));
    // --- 9h. Buy Now with a valid variant → 302 /checkout, drawer would show the variant label.
    testSession.cart = [];
    const bn2 = await reqRaw(port, 'POST', '/cart/add/7', enc({ _csrf: CSRF_TOKEN, quantity: '1', variant_id: '11', buy_now: '1' }), false);
    check('e2e buy now: valid variant + buy_now=1 → 302 /checkout with the variant in the cart',
      bn2.status === 302 && bn2.headers.location === '/checkout'
      && testSession.cart.length === 1 && testSession.cart[0].variantLabel === 'Size: M');
    // --- 9i. Buy Now with an INVALID variant → 400, nothing added (no checkout with a bad item).
    testSession.cart = [];
    const bnBad = await reqRaw(port, 'POST', '/cart/add/7', enc({ _csrf: CSRF_TOKEN, quantity: '1', variant_id: '99', buy_now: '1' }), true);
    let jBnBad = null;
    try { jBnBad = JSON.parse(bnBad.body); } catch (e) { /* not JSON */ }
    check('e2e buy now: invalid variant + buy_now=1 → 400 JSON { ok: false } and nothing is added',
      bnBad.status === 400 && jBnBad && jBnBad.ok === false && testSession.cart.length === 0);
    // --- 9j. Plain add (no buy_now) still goes to /cart.
    testSession.cart = [];
    const plain = await reqRaw(port, 'POST', '/cart/add/3', enc({ _csrf: CSRF_TOKEN, quantity: '1' }), false);
    check('e2e buy now: plain add without buy_now still redirects to /cart (Add to Cart unchanged)',
      plain.status === 302 && plain.headers.location === '/cart');

    // --- 9k. Drawer AJAX add: free item → drawer delivery line says "Free delivery ✓".
    testSession.cart = [];
    const daFree = await reqRaw(port, 'POST', '/cart/add/3', enc({ _csrf: CSRF_TOKEN, quantity: '1' }), true);
    const jDaFree = JSON.parse(daFree.body);
    check('e2e drawer: AJAX add of a Free Delivery item → drawer line "Free delivery ✓"',
      daFree.status === 200 && jDaFree.ok === true && jDaFree.drawerHtml.includes('Free delivery ✓')
      && jDaFree.drawerHtml.includes('mini-cart-delivery--free'));
    // --- 9l. Drawer AJAX add: charged item joins → line flips to the zone charge.
    const daCharged = await reqRaw(port, 'POST', '/cart/add/5', enc({ _csrf: CSRF_TOKEN, quantity: '1' }), true);
    const jDaCharged = JSON.parse(daCharged.body);
    check('e2e drawer: AJAX add of a charged item → drawer line flips to "৳60 inside Dhaka / ৳120 outside Dhaka"',
      daCharged.status === 200 && jDaCharged.ok === true
      && jDaCharged.drawerHtml.includes('৳60 inside Dhaka / ৳120 outside Dhaka')
      && !jDaCharged.drawerHtml.includes('Free delivery ✓'));
    // --- 9m. Drawer AJAX stepper: +1 → JSON, no redirect, drawer shows the new quantity.
    const up1 = await reqRaw(port, 'POST', '/cart/update/3', enc({ _csrf: CSRF_TOKEN, quantity: '2' }), true);
    const jUp1 = JSON.parse(up1.body);
    check('e2e drawer stepper: AJAX +1 → 200 JSON { ok, cartCount 3, subtotal ৳3,230 }, no redirect, drawer shows qty 2',
      up1.status === 200 && jUp1.ok === true && jUp1.cartCount === 3 && jUp1.subtotal === 3230
      && !up1.headers.location && /value="2"[^>]*class="qty-input"|class="qty-input"[^>]*value="2"/.test(jUp1.drawerHtml));
    // --- 9n. Duplicate-quantity body (plain browser submit: input + clicked button) → the BUTTON value wins.
    const upDup = await reqRaw(port, 'POST', '/cart/update/3', enc({ _csrf: CSRF_TOKEN }) + '&quantity=2&quantity=3', true);
    const jUpDup = JSON.parse(upDup.body);
    check('e2e drawer stepper: duplicate quantity=2&quantity=3 → quantity becomes 3 (latent no-op bug fixed)',
      upDup.status === 200 && jUpDup.ok === true && testSession.cart.find((i) => i.cartKey === '3').quantity === 3);
    // --- 9o. Stepper clamps to stock (stock 15, ask 99 → 15).
    const upClamp = await reqRaw(port, 'POST', '/cart/update/3', enc({ _csrf: CSRF_TOKEN, quantity: '99' }), true);
    const jUpClamp = JSON.parse(upClamp.body);
    check('e2e drawer stepper: quantity above stock clamps to stock (15)',
      upClamp.status === 200 && jUpClamp.ok === true && testSession.cart.find((i) => i.cartKey === '3').quantity === 15);
    // --- 9p. Drawer AJAX remove: charged item out → line flips back to "Free delivery ✓".
    const rm1 = await reqRaw(port, 'POST', '/cart/remove/5', enc({ _csrf: CSRF_TOKEN }), true);
    const jRm1 = JSON.parse(rm1.body);
    check('e2e drawer remove: AJAX remove of the charged item → 200 JSON, cartCount 15, line back to "Free delivery ✓"',
      rm1.status === 200 && jRm1.ok === true && jRm1.cartCount === 15
      && jRm1.drawerHtml.includes('Free delivery ✓') && !jRm1.drawerHtml.includes('MLSM-202 Sewing Machine'));
    // --- 9q. Drawer AJAX remove of the last item → empty state.
    const rm2 = await reqRaw(port, 'POST', '/cart/remove/3', enc({ _csrf: CSRF_TOKEN }), true);
    const jRm2 = JSON.parse(rm2.body);
    check('e2e drawer remove: AJAX remove of the last item → empty state, cartCount 0',
      rm2.status === 200 && jRm2.ok === true && jRm2.cartCount === 0 && jRm2.drawerHtml.includes('Your cart is empty.'));
    // --- 9r. Update/remove of a missing item → 404 JSON; without CSRF → 403.
    testSession.cart = [Object.assign({}, freeItem)];
    const up404 = await reqRaw(port, 'POST', '/cart/update/999', enc({ _csrf: CSRF_TOKEN, quantity: '2' }), true);
    let jUp404 = null;
    try { jUp404 = JSON.parse(up404.body); } catch (e) { /* not JSON */ }
    check('e2e drawer stepper: update of a missing item → 404 JSON { ok: false }',
      up404.status === 404 && jUp404 && jUp404.ok === false);
    const upNoCsrf = await reqRaw(port, 'POST', '/cart/update/3', enc({ quantity: '2' }), true);
    check('e2e drawer stepper: update WITHOUT a CSRF token is still 403',
      upNoCsrf.status === 403 && upNoCsrf.body.includes('Security check failed'));
    // --- 9s. Non-AJAX update/remove still redirect to /cart (cart page behaviour preserved).
    const upPlain = await reqRaw(port, 'POST', '/cart/update/3', enc({ _csrf: CSRF_TOKEN, quantity: '2' }), false);
    check('e2e drawer stepper: non-AJAX update still redirects to /cart',
      upPlain.status === 302 && upPlain.headers.location === '/cart');
    const rmPlain = await reqRaw(port, 'POST', '/cart/remove/3', enc({ _csrf: CSRF_TOKEN }), false);
    check('e2e drawer remove: non-AJAX remove still redirects to /cart',
      rmPlain.status === 302 && rmPlain.headers.location === '/cart');
  } finally {
    server.close();
    delete require.cache[dbPath];
    delete require.cache[require.resolve('../routes/shop')];
  }

  // ---------- 10. The REAL drawer stepper/remove + Buy Now logic in a stubbed DOM ----------
  const gStart = footerEjs.indexOf('(function () {', footerEjs.indexOf('Side-cart tab overlap guard'));
  const gEnd = gStart > 0 ? footerEjs.indexOf('})();', gStart) + 5 : -1;
  const gCode = gStart > 0 ? footerEjs.slice(gStart, gEnd) : '';
  check('iife: extractable from footer.ejs (same IIFE as the PR #75 guard + PR #77 drawer + PR #80 AJAX)',
    gStart > 0 && gCode.includes("querySelector('.side-cart')") && gCode.includes('addEventListener(\'submit\'')
    && gCode.includes('drawerCartSubmit') && gCode.includes('buildFormBody'));

  function makeStubEl() {
    const el = {
      _classes: new Set(), _attrs: {}, _rect: { left: 0, top: 0, right: 0, bottom: 0 },
      _listeners: {}, _children: [], hidden: false, focused: false, disabled: false,
      textContent: '', innerHTML: '', parentNode: null, style: {}, value: '', name: '',
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
      appendChild(child) { child.parentNode = el; el._children.push(child); return child; },
      removeChild(child) { el._children = el._children.filter((c) => c !== child); child.parentNode = null; return child; },
      querySelector() { return null; },
      closest() { return el._closest ? el._closest() : null; },
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
  const flush = () => new Promise((r) => setImmediate(r));
  const flushAll = async () => { for (let i = 0; i < 6; i++) await flush(); };
  const TAB_RECT = { left: 1852, top: 512, right: 1908, bottom: 568 };
  const CLEAR_RECT = { left: 100, top: 500, right: 300, bottom: 540 };
  function runScenario() {
    const clock = makeClock();
    const tab = makeStubEl(); tab._rect = Object.assign({}, TAB_RECT);
    const drawer = makeStubEl(); drawer.hidden = true;
    let _drawerHtml = '';
    Object.defineProperty(drawer, 'innerHTML', {
      get() { return _drawerHtml; },
      set(v) { _drawerHtml = v; drawer._refreshed = true; },
      configurable: true,
    });
    const overlay = makeStubEl(); overlay.hidden = true;
    const toast = makeStubEl(); toast.hidden = true;
    const body = makeStubEl();
    const guardedEl = makeStubEl(); guardedEl._rect = Object.assign({}, CLEAR_RECT);
    const closeBtn = makeStubEl();
    const continueBtn = makeStubEl();
    const closeBtn2 = makeStubEl();
    const continueBtn2 = makeStubEl();
    const drawerLink = makeStubEl();
    const drawerBadgeHolder = { el: null };
    const fetchCalls = [];
    let fetchDeferred = null;
    function defer() {
      let resolve; let reject;
      const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
      return { promise, resolve, reject };
    }
    const winListeners = {};
    const docListeners = {};
    function FormDataStub(form) { this._pairs = form._fields || []; }
    FormDataStub.prototype.forEach = function (cb) { this._pairs.forEach((pair) => cb(pair[1], pair[0])); };
    const sandbox = {
      document: {
        querySelector(sel) {
          if (sel === '.side-cart') return tab;
          if (sel === '#mini-cart-drawer') return drawer;
          if (sel === '#mini-cart-overlay') return overlay;
          if (sel === '.mini-cart-close') return drawer._refreshed ? closeBtn2 : closeBtn;
          if (sel === '.mini-cart-continue') return drawer._refreshed ? continueBtn2 : continueBtn;
          if (sel === '#cart-toast') return toast;
          if (sel === '.side-cart-badge') return tab._badge || null;
          if (sel === '.shop-drawer-link[href="/cart"]') return drawerLink;
          if (sel === '.shop-drawer-link[href="/cart"] .badge') return drawerBadgeHolder.el;
          return null;
        },
        querySelectorAll() { return [guardedEl]; },
        documentElement: { scrollTop: 0 },
        activeElement: tab,
        body,
        addEventListener(type, fn) { (docListeners[type] = docListeners[type] || []).push(fn); },
        createElement(tag) { const el = makeStubEl(); el._tag = tag; return el; },
      },
      window: {
        pageYOffset: 0, innerHeight: 1080, innerWidth: 1920,
        addEventListener(type, fn) { (winListeners[type] = winListeners[type] || []).push(fn); },
        requestAnimationFrame(fn) { fn(); },
      },
      setTimeout(fn, ms) { return clock.setTimeout(fn, ms); },
      clearTimeout(id) { clock.clearTimeout(id); },
      FormData: FormDataStub,
      URLSearchParams,
      fetch(url, opts) { fetchCalls.push({ url, opts }); fetchDeferred = defer(); return fetchDeferred.promise; },
    };
    sandbox.window.document = sandbox.document;
    const origAppend = tab.appendChild.bind(tab);
    tab.appendChild = function (child) { origAppend(child); if (child._tag === 'span') tab._badge = child; return child; };
    const origLinkAppend = drawerLink.appendChild.bind(drawerLink);
    drawerLink.appendChild = function (child) { origLinkAppend(child); if (child._tag === 'span') drawerBadgeHolder.el = child; return child; };
    vm.runInNewContext(gCode, sandbox);
    return {
      clock, tab, drawer, overlay, toast, body, guardedEl,
      closeBtn, continueBtn, closeBtn2, continueBtn2, drawerLink, drawerBadgeHolder, fetchCalls,
      resolveFetch(res) { fetchDeferred.resolve(res); },
      rejectFetch(err) { fetchDeferred.reject(err); },
      fireWin(type) { (winListeners[type] || []).forEach((fn) => fn()); },
      fireDoc(type, ev) { (docListeners[type] || []).forEach((fn) => fn(ev || {})); },
      drawerOpen: () => drawer.classList.contains('is-open') && drawer.hidden === false,
      toastVisible: () => toast.hidden === false && toast.classList.contains('is-visible'),
    };
  }
  function submitEvent(form) {
    const ev = { target: form, prevented: false, preventDefault() { ev.prevented = true; } };
    return ev;
  }
  function okResponse(data) { return { status: 200, ok: true, json: () => Promise.resolve(data) }; }
  function makeDrawerForm(action, fields, submitter) {
    const form = makeStubEl();
    form._fields = fields;
    form._closest = () => drawerEl;
    form.getAttribute = (k) => (k === 'action' ? action : k === 'method' ? 'POST' : null);
    form.querySelector = (sel) => (sel === 'button[type="submit"]' ? submitter : null);
    form._clickedSubmitter = submitter;
    return form;
  }
  let drawerEl = null;

  const sc = runScenario();
  drawerEl = sc.drawer;
  // Open the drawer first (tab click), like a real shopper would.
  const tabClick = { prevented: false, preventDefault() { tabClick.prevented = true; } };
  sc.tab.fire('click', tabClick);
  check('dom drawer: tab click opens the drawer (setup)', sc.drawerOpen());
  // --- Stepper + (qty 2 → 3): intercepted, ONE quantity value, drawer refreshes, stays open, no toast.
  const plusBtn = makeStubEl(); plusBtn.name = 'quantity'; plusBtn.value = '3';
  const stepForm = makeDrawerForm('/cart/update/5', [['_csrf', 'tok123'], ['quantity', '2']], plusBtn);
  const evStep = submitEvent(stepForm);
  sc.fireDoc('submit', evStep);
  check('dom drawer stepper: submit is intercepted (no navigation) and fetch POSTs exactly one quantity=3 (submitter wins over the input value 2)',
    evStep.prevented === true && sc.fetchCalls.length === 1
    && sc.fetchCalls[0].url === '/cart/update/5' && sc.fetchCalls[0].opts.method === 'POST'
    && sc.fetchCalls[0].opts.headers['X-Requested-With'] === 'XMLHttpRequest'
    && sc.fetchCalls[0].opts.body === '_csrf=tok123&quantity=3');
  check('dom drawer stepper: the clicked + button is disabled while the request is in flight',
    plusBtn.disabled === true && stepForm._updating === true);
  const evStepDup = submitEvent(stepForm);
  sc.fireDoc('submit', evStepDup);
  check('dom drawer stepper: double submit while in flight fires only ONE fetch',
    sc.fetchCalls.length === 1 && evStepDup.prevented === true);
  sc.resolveFetch(okResponse({
    ok: true, cartCount: 3, subtotal: 3230,
    drawerHtml: '<div class="mini-cart-head"><h2>Your Cart (3)</h2></div><p>BINBOND Watch</p><p>Free delivery ✓</p>',
  }));
  await flushAll();
  check('dom drawer stepper: success replaces the drawer HTML (fresh, incl. delivery line), updates badges, drawer STAYS open, NO toast',
    sc.drawer.innerHTML.includes('Your Cart (3)') && sc.drawer.innerHTML.includes('Free delivery ✓')
    && sc.tab._badge && sc.tab._badge.textContent === '3' && sc.drawerOpen() && !sc.toastVisible());
  check('dom drawer stepper: the button is re-enabled after the request finishes',
    plusBtn.disabled === false && stepForm._updating === false);
  check('dom drawer stepper: after the drawer refresh, the FRESH × button has exactly one click listener (rebound)',
    (sc.closeBtn2._listeners.click || []).length === 1);
  // --- Remove: intercepted, drawer refreshes, stays open.
  const rmBtn = makeStubEl();
  const rmForm = makeDrawerForm('/cart/remove/5', [['_csrf', 'tok123']], rmBtn);
  const evRm = submitEvent(rmForm);
  sc.fireDoc('submit', evRm);
  check('dom drawer remove: submit is intercepted (no navigation) and fetch POSTs to /cart/remove/5 with the CSRF token',
    evRm.prevented === true && sc.fetchCalls.length === 2
    && sc.fetchCalls[1].url === '/cart/remove/5' && sc.fetchCalls[1].opts.body === '_csrf=tok123');
  sc.resolveFetch(okResponse({
    ok: true, cartCount: 0, subtotal: 0,
    drawerHtml: '<div class="mini-cart-empty"><p>Your cart is empty.</p></div>',
  }));
  await flushAll();
  check('dom drawer remove: success replaces the drawer with the empty state, drawer STAYS open, badges cleared',
    sc.drawer.innerHTML.includes('Your cart is empty.') && sc.tab._children.indexOf(sc.tab._badge) === -1 && sc.drawerOpen());
  // --- Error JSON: toast error, drawer stays open, no navigation, button re-enabled.
  const errBtn = makeStubEl(); errBtn.name = 'quantity'; errBtn.value = '1';
  const errForm = makeDrawerForm('/cart/update/5', [['_csrf', 'tok123'], ['quantity', '2']], errBtn);
  const evErr = submitEvent(errForm);
  sc.fireDoc('submit', evErr);
  sc.resolveFetch({ status: 404, ok: false, json: () => Promise.resolve({ ok: false, error: 'Item not found in cart.' }) });
  await flushAll();
  check('dom drawer stepper: error JSON shows the server error in the toast, drawer STAYS open, no navigation',
    evErr.prevented === true && sc.toastVisible() && sc.toast.textContent.includes('Item not found in cart.')
    && sc.toast.classList.contains('cart-toast--error') && sc.drawerOpen() && errBtn.disabled === false);
  sc.clock.advance(3000);
  check('dom drawer stepper: the error toast hides itself after ~3s',
    sc.toast.hidden === true && !sc.toast.classList.contains('is-visible'));
  // --- Network failure: same.
  const netBtn = makeStubEl(); netBtn.name = 'quantity'; netBtn.value = '3';
  const netForm = makeDrawerForm('/cart/update/5', [['_csrf', 'tok123'], ['quantity', '2']], netBtn);
  const evNet = submitEvent(netForm);
  sc.fireDoc('submit', evNet);
  sc.rejectFetch(new Error('network down'));
  await flushAll();
  check('dom drawer stepper: network failure shows the generic error toast, drawer STAYS open, button re-enabled',
    sc.toastVisible() && sc.toast.textContent.includes('Could not update cart') && sc.drawerOpen() && netBtn.disabled === false);
  // --- Cart-page stepper (outside the drawer): NOT intercepted.
  const pageForm = makeStubEl();
  pageForm._fields = [['_csrf', 'tok123'], ['quantity', '2']];
  pageForm._closest = () => null;
  pageForm.getAttribute = (k) => (k === 'action' ? '/cart/update/5' : k === 'method' ? 'POST' : null);
  const callsBeforePage = sc.fetchCalls.length;
  const evPage = submitEvent(pageForm);
  sc.fireDoc('submit', evPage);
  check('dom drawer stepper: a CART-PAGE stepper (outside the drawer) is NOT intercepted — no preventDefault, no fetch',
    evPage.prevented === false && sc.fetchCalls.length === callsBeforePage);
  // --- Buy Now: NOT intercepted (must navigate to /checkout).
  const buyBtn = makeStubEl(); buyBtn.name = 'buy_now'; buyBtn.value = '1';
  const buyForm = makeStubEl();
  buyForm._fields = [['_csrf', 'tok123'], ['quantity', '1']];
  buyForm._closest = () => null;
  buyForm.getAttribute = (k) => (k === 'action' ? '/cart/add/3' : k === 'method' ? 'POST' : null);
  buyForm.querySelector = () => buyBtn;
  buyForm._clickedSubmitter = buyBtn;
  const callsBeforeBuy = sc.fetchCalls.length;
  const evBuy = submitEvent(buyForm);
  sc.fireDoc('submit', evBuy);
  check('dom buy now: a Buy Now submit is NOT intercepted — no preventDefault, no fetch (plain POST → /checkout)',
    evBuy.prevented === false && sc.fetchCalls.length === callsBeforeBuy);
  // --- Plain Add to Cart still intercepted (no regression from PR #80).
  const addBtn = makeStubEl();
  const addForm = makeStubEl();
  addForm._fields = [['_csrf', 'tok123'], ['quantity', '1']];
  addForm._closest = () => null;
  addForm.getAttribute = (k) => (k === 'action' ? '/cart/add/3' : k === 'method' ? 'POST' : null);
  addForm.querySelector = () => addBtn;
  addForm._clickedSubmitter = addBtn;
  const evAdd = submitEvent(addForm);
  sc.fireDoc('submit', evAdd);
  check('dom buy now: a plain Add to Cart submit IS still intercepted (PR #80 behaviour kept)',
    evAdd.prevented === true && sc.fetchCalls.length === callsBeforeBuy + 1
    && sc.fetchCalls[sc.fetchCalls.length - 1].url === '/cart/add/3');
  sc.resolveFetch(okResponse({
    ok: true, cartCount: 1, itemName: 'BINBOND 2521 Watch', subtotal: 990,
    drawerHtml: '<div class="mini-cart-head"><h2>Your Cart (1)</h2></div><p>BINBOND 2521 Watch</p>',
  }));
  await flushAll();

  // ---------- 11. The REAL sticky-bar script in a stubbed DOM ----------
  const sbStart = productEjs.indexOf('// B2 sticky buy bar');
  const sbOpen = productEjs.lastIndexOf('<script>', sbStart);
  const sbClose = productEjs.indexOf('</script>', sbStart);
  const sbCode = sbStart > 0 ? productEjs.slice(sbOpen + '<script>'.length, sbClose) : '';
  check('sticky bar script: extractable from product.ejs (pure JS, no EJS tags inside)',
    sbStart > 0 && sbCode.includes('sticky-buy-bar') && sbCode.includes('requestSubmit') && !/<%/.test(sbCode));
  function runStickyScenario(opts) {
    const bar = makeStubEl(); bar.hidden = true;
    const btn = makeStubEl();
    const form = makeStubEl();
    let requestSubmits = 0;
    let mainBtnClicks = 0;
    form.requestSubmit = () => { requestSubmits++; };
    const mainBtn = makeStubEl();
    mainBtn.click = () => { mainBtnClicks++; };
    const sentinel = makeStubEl(); sentinel._rect = { left: 0, top: -100, right: 100, bottom: opts.sentinelBottom };
    const header = makeStubEl(); header.offsetHeight = 74;
    const variantInput = makeStubEl(); variantInput.value = opts.variantValue;
    const firstSelect = makeStubEl();
    let focused = false;
    firstSelect.focus = () => { focused = true; };
    const variantSelectors = makeStubEl();
    let scrolled = null;
    variantSelectors.scrollIntoView = (arg) => { scrolled = arg; };
    const winListeners = {};
    const sandbox = {
      document: {
        getElementById(id) {
          if (id === 'sticky-buy-bar') return bar;
          if (id === 'sticky-buy-btn') return btn;
          if (id === 'add-to-cart-form') return form;
          if (id === 'buy-box-sentinel') return sentinel;
          if (id === 'variant_id_input') return variantInput;
          if (id === 'add-to-cart-btn') return mainBtn;
          return null;
        },
        querySelector(sel) {
          if (sel === '.site-header') return header;
          if (sel === '.variant-attr-select') return opts.hasVariants ? firstSelect : null;
          if (sel === '.variant-selectors') return opts.hasVariants ? variantSelectors : null;
          return null;
        },
        addEventListener() {},
      },
      window: {
        matchMedia(q) {
          if (q === '(min-width: 769px)') return { matches: opts.desktop };
          if (q === '(prefers-reduced-motion: reduce)') return { matches: false };
          return { matches: false };
        },
        requestAnimationFrame(fn) { fn(); },
        addEventListener(type, fn) { (winListeners[type] = winListeners[type] || []).push(fn); },
      },
    };
    sandbox.window.document = sandbox.document;
    vm.runInNewContext(sbCode, sandbox);
    return {
      bar, btn, form, sentinel,
      requestSubmits: () => requestSubmits,
      mainBtnClicks: () => mainBtnClicks,
      scrolled: () => scrolled,
      focused: () => focused,
      fireWin(type) { (winListeners[type] || []).forEach((fn) => fn()); },
    };
  }
  const sb1 = runStickyScenario({ desktop: true, sentinelBottom: -5, hasVariants: false, variantValue: '' });
  check('dom sticky bar: buy box scrolled out (sentinel bottom < 0) → bar visible, top = real header height (74px)',
    sb1.bar.hidden === false && sb1.bar.style.top === '74px');
  sb1.sentinel._rect = { left: 0, top: 100, right: 100, bottom: 500 };
  sb1.fireWin('scroll');
  check('dom sticky bar: buy box back in view → bar hides again',
    sb1.bar.hidden === true);
  sb1.sentinel._rect = { left: 0, top: -100, right: 100, bottom: -5 };
  sb1.fireWin('scroll');
  sb1.btn.fire('click', {});
  check('dom sticky bar: no variants → bar button submits the real form (requestSubmit)',
    sb1.bar.hidden === false && sb1.requestSubmits() === 1 && sb1.mainBtnClicks() === 0);
  const sb2 = runStickyScenario({ desktop: true, sentinelBottom: -5, hasVariants: true, variantValue: '' });
  sb2.btn.fire('click', {});
  check('dom sticky bar: variant unchosen → button scrolls to the selectors (smooth, centred) and does NOT submit',
    sb2.scrolled() && sb2.scrolled().behavior === 'smooth' && sb2.scrolled().block === 'center'
    && sb2.focused() === true && sb2.requestSubmits() === 0);
  const sb3 = runStickyScenario({ desktop: true, sentinelBottom: -5, hasVariants: true, variantValue: '11' });
  sb3.btn.fire('click', {});
  check('dom sticky bar: variant chosen → button submits the real form',
    sb3.requestSubmits() === 1 && sb3.scrolled() === null);
  const sb4 = runStickyScenario({ desktop: false, sentinelBottom: -5, hasVariants: false, variantValue: '' });
  check('dom sticky bar: mobile (narrow) → no top offset set (CSS bottom rule applies), bar still shows when scrolled past',
    sb4.bar.style.top === '' && sb4.bar.hidden === false);

  console.log(`\n${passes.length} passed, ${failures.length} failed.`);
  if (failures.length) { console.log('Failures: ' + failures.join(', ')); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
