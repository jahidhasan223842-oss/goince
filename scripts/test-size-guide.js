// Size guide — variant-options fix (fix/size-guide-variants, PR #84).
//
//   BUG (live-verified 2026-11-28): the D5 size guide (PR #83) never
//   showed on the A.T.Z dress page (/product/7) even though its
//   S/M/L/XL size selector works. Two full-page searches + reload
//   found no "Size Guide" link/button/chart anywhere on /product/7.
//
//   ROOT CAUSE: the guide's render condition only looked at
//   variant ATTRIBUTES — `variantAttributes.some(a => a.name ===
//   'size')` in views/product.ejs (lines 291 + 326) and
//   lib/product-page.js `hasSizeAttribute()`. But variantAttributes
//   is built ONLY from product_variants rows (routes/shop.js:362-396),
//   while A.T.Z has NO variants at all: its S/M/L/XL sizes live in
//   product_options (option_label "Size", value_name S/M/L/XL —
//   routes/shop.js:358-359), which is what the working size selector
//   renders from. So variantAttributes was [] and the guide hid.
//
//   FIX: lib/product-page.js `hasSizeChoice(variantAttributes,
//   options, optionLabel)` — true for a Size variant attribute OR a
//   Size option (optionLabel / any option row's option_label is
//   "Size", or option values are standard apparel size tokens
//   S/M/L/XL … as a fallback for a mislabelled Size option).
//   routes/shop.js computes `showSizeGuide` and passes it to the
//   view; views/product.ejs gates BOTH the guide section and the
//   size FAQ on `showSizeGuide`. The chart itself is UNCHANGED
//   (static S 36"/34" → XL 42"/37", ±0.5" note).
//
// No live MySQL needed: lib unit checks + source checks + direct
// EJS renders + the REAL shop route on a stubbed DB (express, like
// test-product-page-batch.js).
//
// Run:  node scripts/test-size-guide.js
// Exit code 0 = all checks passed.
'use strict';

const fs = require('fs');
const path = require('path');
const util = require('util');
const ejs = require('ejs');
const http = require('http');
const express = require('express');

const pp = require('../lib/product-page');
const shopRoutes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'shop.js'), 'utf8');
const productEjs = fs.readFileSync(path.join(__dirname, '..', 'views', 'product.ejs'), 'utf8');
const renderFile = util.promisify(ejs.renderFile);
const productPath = path.join(__dirname, '..', 'views', 'product.ejs');

const failures = [];
const passes = [];
function check(name, ok, detail) {
  if (ok) { passes.push(name); console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

// A.T.Z as it really is in the DB: NO variants, sizes as OPTIONS.
const atzOptions = [
  { id: 21, product_id: 7, option_label: 'Size', value_name: 'S', color_hex: null, image: null, sort_order: 1 },
  { id: 22, product_id: 7, option_label: 'Size', value_name: 'M', color_hex: null, image: null, sort_order: 2 },
  { id: 23, product_id: 7, option_label: 'Size', value_name: 'L', color_hex: null, image: null, sort_order: 3 },
  { id: 24, product_id: 7, option_label: 'Size', value_name: 'XL', color_hex: null, image: null, sort_order: 4 },
];

const baseLocals = {
  siteName: 'Goince', siteSettings: {}, shopPhone: '+8801814697896', paymentMethods: [],
  assetUrl: (p) => p, userName: null, userPhotoUrl: null, cartCount: 0,
  menuCategories: [], menuById: {}, search: '',
  miniCart: [], miniCartSubtotal: 0, csrfToken: 'tok123',
  siteLogoAbs: '', siteFaviconAbs: '', siteOgImageAbs: '', siteUrl: 'http://127.0.0.1',
};
const productLocals = {
  notify: null, pageTitle: 'Product - Goince', metaDescription: 'Product',
  galleryImages: [], options: [], optionLabel: null, variants: [], variantAttributes: [],
  specs: [], discountPercent: null, related: [], secondImages: {}, reviews: [],
  avgRating: null, reviewCount: 0, reviewPending: false,
  deliveryCharge: 60, deliveryChargeOutside: 120, descriptionHtml: '',
  productVideo: null, bundleProducts: [], reviewPhotos: {}, helpfulCounts: {},
  votedReviewIds: [], verifiedBuyerIds: [], answeredQuestions: [],
  questionPending: false, recentPurchase: null, viewerLine: null,
  deliveryZone: 'inside_dhaka',
  deliveryEstimate: { hoursLeft: 3, getByLabel: 'Sat, 29 Nov', zoneLabel: 'Inside Dhaka (1–2 days)' },
  stockBar: null, soldLine: null, showSizeGuide: false,
};
const watch = { id: 3, name: 'BINBOND 2521 Watch', price: 990, image: 'watch.jpg', stock: 3, low_stock_threshold: 5, free_shipping: 0, target_audience: 'all', short_description: '', allow_backorder: false };
const dress = { id: 7, name: 'A.T.Z Two-Piece Tops', price: 310, image: 'dress.jpg', stock: 10, low_stock_threshold: 5, free_shipping: 0, target_audience: 'women', short_description: '', allow_backorder: false };

function chartIntact(html) {
  return html.includes('<td>S</td><td>36"</td><td>34"</td>')
    && html.includes('<td>M</td><td>38"</td><td>35"</td>')
    && html.includes('<td>L</td><td>40"</td><td>36"</td>')
    && html.includes('<td>XL</td><td>42"</td><td>37"</td>')
    && html.includes('Actual product may vary slightly (±0.5")');
}

(async () => {
  // ---------- 1. lib/product-page.js — hasSizeChoice ----------
  check('lib: Size variant attribute still counts (attribute-based sizes keep working)',
    pp.hasSizeChoice([{ name: 'Size' }], [], null) === true);
  check('lib: Color-only variant attribute does NOT count',
    pp.hasSizeChoice([{ name: 'Color' }], [], null) === false);
  check('lib: A.T.Z shape — no variants, Size OPTIONS (option_label Size, S/M/L/XL) → true',
    pp.hasSizeChoice([], atzOptions, 'Size') === true);
  check('lib: Size option counts even when optionLabel was not passed (row option_label checked)',
    pp.hasSizeChoice([], atzOptions, null) === true);
  check('lib: option values S/M/L/XL count even with a mislabelled option label (size-token fallback)',
    pp.hasSizeChoice([], [{ option_label: 'Choose', value_name: 'M' }], 'Choose') === true);
  check('lib: Color options (Red/Blue) do NOT count — no false guide on non-apparel options',
    pp.hasSizeChoice([], [{ option_label: 'Color', value_name: 'Red' }, { option_label: 'Color', value_name: 'Blue' }], 'Color') === false);
  check('lib: nothing at all (no variants, no options) → false',
    pp.hasSizeChoice([], [], null) === false && pp.hasSizeChoice(undefined, undefined, undefined) === false);
  check('lib: hasSizeAttribute itself is unchanged (Size → true, Color → false, [] → false)',
    pp.hasSizeAttribute([{ name: 'Size' }]) === true && pp.hasSizeAttribute([{ name: 'Color' }]) === false
    && pp.hasSizeAttribute([]) === false);
  check('lib: hasSizeOption is exported and matches the label check (Size → true, Color → false)',
    pp.hasSizeOption(atzOptions, 'Size') === true
    && pp.hasSizeOption([{ option_label: 'Color', value_name: 'Red' }], 'Color') === false);

  // ---------- 2. Source checks ----------
  check('route: product page computes showSizeGuide from variant attributes + options + optionLabel',
    /const showSizeGuide = pp\.hasSizeChoice\(variantAttributes, options, optionLabel\)/.test(shopRoutes));
  check('route: showSizeGuide is passed to the product view',
    /showSizeGuide,/.test(shopRoutes));
  check('view: size guide section AND size FAQ are both gated on showSizeGuide (no attribute-only check left)',
    (productEjs.match(/typeof showSizeGuide !== 'undefined' && showSizeGuide/g) || []).length === 2
    && !/variantAttributes\.some\(a => String\(a\.name/.test(productEjs));
  check('view: chart values are UNCHANGED in source (S 36"/34" → XL 42"/37", ±0.5" note)',
    chartIntact(productEjs));
  check('view: 24h return text untouched (defective/wrong only, change-of-mind not accepted)',
    productEjs.includes('You can request a return within 24 hours of delivery if the product is defective or damaged, or you received the wrong product.')
    && productEjs.includes('Change-of-mind returns are not accepted once delivered.'));
  check('route: no price / coupon / route-URL change in this fix (source)',
    !/UPDATE products SET price/.test(shopRoutes) && !/WELCOME10/.test(productEjs));

  // ---------- 3. EJS renders ----------
  async function renderProduct(extra, product) {
    return renderFile(productPath, Object.assign({}, baseLocals, productLocals, extra, { product: product || watch }));
  }
  let atzOptionPage = '';
  try {
    // THE BUG SHAPE: A.T.Z with sizes as options only — no variants,
    // no variant attributes (exactly what the route builds for /product/7).
    atzOptionPage = await renderProduct({
      options: atzOptions, optionLabel: 'Size', variants: [], variantAttributes: [],
      showSizeGuide: pp.hasSizeChoice([], atzOptions, 'Size'),
    }, dress);
  } catch (e) { check('render: A.T.Z option-based page renders', false, String(e && e.message)); }
  if (atzOptionPage) {
    check('render: A.T.Z (sizes from OPTIONS) shows the Size Guide + size FAQ',
      atzOptionPage.includes('Size Guide') && atzOptionPage.includes('How do I choose the right size?'));
    check('render: A.T.Z chart values unchanged (S 36"/34" → XL 42"/37", ±0.5" note)',
      chartIntact(atzOptionPage));
    check('render: A.T.Z size selector still renders from options (S/M/L/XL pills)',
      atzOptionPage.includes('option-pill') && atzOptionPage.includes('data-option-name="S"')
      && atzOptionPage.includes('data-option-name="XL"'));
  }
  let atzAttrPage = '';
  try {
    atzAttrPage = await renderProduct({
      variantAttributes: [{ id: 1, name: 'Size', values: [{ id: 1, value: 'S' }, { id: 2, value: 'M' }, { id: 3, value: 'L' }, { id: 4, value: 'XL' }] }],
      variants: [{ id: 11, attrs: [], price: 310, compare_at_price: null, image: null, stock: 10, label: 'Size: S' }],
      showSizeGuide: pp.hasSizeChoice([{ name: 'Size' }], [], null),
    }, dress);
  } catch (e) { check('render: attribute-based dress page renders', false, String(e && e.message)); }
  if (atzAttrPage) {
    check('render: attribute-based dress STILL shows the Size Guide + size FAQ (no regression)',
      atzAttrPage.includes('Size Guide') && atzAttrPage.includes('How do I choose the right size?')
      && chartIntact(atzAttrPage));
  }
  let watchPage = '';
  try { watchPage = await renderProduct({}, watch); } catch (e) { check('render: watch page renders', false, String(e && e.message)); }
  if (watchPage) {
    check('render: watch (no Size attribute, no Size option) shows NO size guide and NO size FAQ',
      !watchPage.includes('Size Guide') && !watchPage.includes('How do I choose the right size?'));
  }
  let colorPage = '';
  try {
    colorPage = await renderProduct({
      options: [{ id: 31, option_label: 'Color', value_name: 'Red' }, { id: 32, option_label: 'Color', value_name: 'Blue' }],
      optionLabel: 'Color',
      showSizeGuide: pp.hasSizeChoice([], [{ option_label: 'Color', value_name: 'Red' }], 'Color'),
    }, watch);
  } catch (e) { check('render: color-option page renders', false, String(e && e.message)); }
  if (colorPage) {
    check('render: Color-option product shows NO size guide (no false positive)',
      !colorPage.includes('Size Guide') && !colorPage.includes('How do I choose the right size?'));
  }

  // ---------- 4. Route E2E: REAL shop route on a stubbed DB ----------
  const dbPath = require.resolve('../config/db');
  const uploadPath = require.resolve('../config/upload');
  const CSRF_TOKEN = 'test-csrf-token-sizeguide';
  const testSession = { cart: [], csrfToken: CSRF_TOKEN, userId: null };
  const products = { 3: watch, 7: dress };
  const dbStub = {
    query: async (sql, params) => {
      const p = params || [];
      if (/SELECT \* FROM products WHERE id = \? OR slug = \?/.test(sql)) {
        const prod = products[p[0]];
        return [prod ? [prod] : []];
      }
      if (/SELECT setting_key, setting_value FROM settings/.test(sql)) {
        return [[
          { setting_key: 'delivery_charge_inside', setting_value: '60' },
          { setting_key: 'delivery_charge_outside', setting_value: '120' },
        ]];
      }
      if (/FROM reviews/.test(sql) && /JOIN users/.test(sql)) return [[]];
      if (/AVG\(rating\)/.test(sql)) return [[{ avgRating: null, reviewCount: 0 }]];
      if (/SELECT \* FROM product_images/.test(sql)) return [[]];
      if (/FROM product_options WHERE product_id = \?/.test(sql)) {
        return [Number(p[0]) === 7 ? atzOptions : []];
      }
      if (/SELECT DISTINCT product_id FROM product_options/.test(sql)) return [[]];
      if (/FROM product_variants WHERE product_id = \?/.test(sql)) return [[]];
      if (/SELECT DISTINCT product_id FROM product_variants/.test(sql)) return [[]];
      if (/FROM related_products rp/.test(sql)) return [[]];
      if (/FROM products WHERE category_id/.test(sql)) return [[]];
      if (/SELECT product_id, image FROM product_images/.test(sql)) return [[]];
      if (/SELECT filename FROM product_videos/.test(sql)) return [[]];
      if (/SELECT COALESCE\(SUM\(quantity\), 0\) AS sold/.test(sql)) return [[{ sold: 0 }]];
      if (/FROM review_photos/.test(sql)) return [[]];
      if (/FROM review_helpful_votes/.test(sql)) return [[]];
      if (/SELECT DISTINCT o\.user_id FROM orders/.test(sql)) return [[]];
      if (/FROM product_questions/.test(sql)) return [[]];
      if (/INSERT INTO product_views/.test(sql)) return [{}];
      if (/DELETE FROM product_views/.test(sql)) return [{}];
      if (/COUNT\(DISTINCT session_key\)/.test(sql)) return [[{ c: 0 }]];
      if (/FROM orders o JOIN order_items oi/.test(sql)) return [[]];
      return [[]];
    },
    getConnection: async () => ({ beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {}, query: async () => [[]] }),
  };
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: dbStub };
  const fakeUpload = { single: () => (req, res, next) => next(), fields: () => (req, res, next) => next(), convertToWebP: (req, res, next) => next() };
  require.cache[uploadPath] = { id: uploadPath, filename: uploadPath, loaded: true, exports: fakeUpload };
  const { csrfProtection } = require('../lib/csrf');
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = testSession;
    res.locals.userName = null; res.locals.userPhotoUrl = null;
    res.locals.cartCount = 0;
    res.locals.siteSettings = {}; res.locals.shopPhone = '+8801814697896'; res.locals.paymentMethods = [];
    res.locals.assetUrl = (p) => p; res.locals.menuCategories = []; res.locals.menuById = {};
    res.locals.miniCart = []; res.locals.miniCartSubtotal = 0;
    res.locals.miniCartDeliveryInside = 60; res.locals.miniCartDeliveryOutside = 120;
    res.locals.csrfToken = CSRF_TOKEN; res.locals.siteUrl = 'http://127.0.0.1';
    res.locals.siteLogoAbs = ''; res.locals.siteFaviconAbs = ''; res.locals.siteOgImageAbs = '';
    next();
  });
  app.use(csrfProtection);
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.use('/', require('../routes/shop'));
  function reqRaw(port, method, pathUrl) {
    return new Promise((resolve, reject) => {
      const req = http.request({ method, host: '127.0.0.1', port, path: pathUrl }, (res) => {
        const parts = [];
        res.on('data', (c) => parts.push(c));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(parts).toString('utf8') }));
      });
      req.on('error', reject);
      req.end();
    });
  }
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.on('listening', r));
  const port = server.address().port;
  try {
    const page7 = await reqRaw(port, 'GET', '/product/7');
    check('e2e: GET /product/7 (A.T.Z, sizes from OPTIONS only) → 200 and the Size Guide renders',
      page7.status === 200 && page7.body.includes('Size Guide'));
    check('e2e: /product/7 chart values unchanged (S 36"/34" → XL 42"/37", ±0.5" note)',
      page7.status === 200 && chartIntact(page7.body));
    check('e2e: /product/7 size FAQ renders ("How do I choose the right size?")',
      page7.body.includes('How do I choose the right size?'));
    check('e2e: /product/7 size selector still renders (option pills, S/M/L/XL)',
      page7.body.includes('option-pill') && page7.body.includes('data-option-name="S"')
      && page7.body.includes('data-option-name="XL"'));
    check('e2e: /product/7 still shows its real price ৳310 and the 24h return text (nothing else moved)',
      page7.body.includes('৳310')
      && page7.body.includes('within 24 hours of delivery if the product is defective or damaged'));
    const page3 = await reqRaw(port, 'GET', '/product/3');
    check('e2e: GET /product/3 (watch, no sizes) → 200 and NO size guide / NO size FAQ',
      page3.status === 200 && !page3.body.includes('Size Guide')
      && !page3.body.includes('How do I choose the right size?'));
  } finally {
    server.close();
    delete require.cache[dbPath];
    delete require.cache[uploadPath];
    delete require.cache[require.resolve('../routes/shop')];
  }

  console.log(`\n${passes.length} passed, ${failures.length} failed.`);
  if (failures.length) { console.log('FAILED: ' + failures.join(' | ')); process.exit(1); }
})();
