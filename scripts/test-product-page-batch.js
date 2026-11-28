// Product page — batch 3 (feat/product-page, PR #83).
//
//   D1  Product video player in the gallery (product_videos field,
//       PR #7): renders only when a video is set; gallery unchanged
//       when none is set. No video files are invented.
//   D2  "Frequently bought together" bundle box (admin-chosen
//       related_products only, max 3) + "Add all to cart" via the
//       PR #80 AJAX flow (stays on the page, drawer opens).
//       No related products → no box at all.
//   D3  Review photos (multipart form, ?_csrf= in the action) +
//       helpful votes (one per customer/session, toggleable) +
//       verified-buyer badge (real orders only).
//   D4  Product Q&A: asks stored pending, only admin-answered
//       ones render; admin answers in Admin > Reviews.
//   D5  Size guide on the A.T.Z dress (Size attribute present).
//   D7  Delivery-date estimate from the real zone windows
//       (Dhaka 1–2 days / outside 3–5 days) + 5pm cut-off.
//   D8  Honest low-stock bar from real stock numbers, never > 100%,
//       never shown when stock is plentiful.
//   D9  FAQ accordion, with the 24h return policy stated correctly
//       (defective/wrong only).
//   G3  Trust badges in the buy box with the real phone number.
//   G5  "X sold" from real order counts; hidden at 0.
//   G1  "X people are viewing this now" — REAL distinct sessions
//       only; hidden at 0/1 (just you).
//   G2  Recent-purchase popup fed ONLY by real orders (first name
//       + district, real time-ago); hidden when there are none.
//
// No live MySQL needed: lib unit checks + source checks + direct
// EJS renders + the REAL shop routes on a stubbed DB (express, like
// test-cart-buying.js) + the REAL bundle/popup scripts in stubbed
// DOMs (vm sandbox).
//
// Run:  node scripts/test-product-page-batch.js
// Exit code 0 = all checks passed.
'use strict';

const fs = require('fs');
const path = require('path');
const util = require('util');
const ejs = require('ejs');
const vm = require('vm');
const http = require('http');
const express = require('express');

const pp = require('../lib/product-page');
const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'style.css'), 'utf8');
const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
const shopRoutes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'shop.js'), 'utf8');
const adminJs = fs.readFileSync(path.join(__dirname, '..', 'routes', 'admin.js'), 'utf8');
const serverJs = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const productEjs = fs.readFileSync(path.join(__dirname, '..', 'views', 'product.ejs'), 'utf8');
const footerEjs = fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', 'footer.ejs'), 'utf8');
const adminReviewsEjs = fs.readFileSync(path.join(__dirname, '..', 'views', 'admin', 'reviews.ejs'), 'utf8');
const sqlBatch = fs.readFileSync(path.join(__dirname, '..', 'sql', 'product_page_batch.sql'), 'utf8');
const renderFile = util.promisify(ejs.renderFile);
const productPath = path.join(__dirname, '..', 'views', 'product.ejs');
const adminReviewsPath = path.join(__dirname, '..', 'views', 'admin', 'reviews.ejs');

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
const productLocals = {
  notify: null, pageTitle: 'Watch - Goince', metaDescription: 'Watch',
  galleryImages: [], options: [], optionLabel: null, variants: [], variantAttributes: [],
  specs: [], discountPercent: null, related: [], secondImages: {}, reviews: [],
  avgRating: null, reviewCount: 0, reviewPending: false,
  deliveryCharge: 60, deliveryChargeOutside: 120, descriptionHtml: '',
  productVideo: null, bundleProducts: [], reviewPhotos: {}, helpfulCounts: {},
  votedReviewIds: [], verifiedBuyerIds: [], answeredQuestions: [],
  questionPending: false, recentPurchase: null, viewerLine: null,
  deliveryZone: 'inside_dhaka',
  deliveryEstimate: { hoursLeft: 3, getByLabel: 'Sat, 29 Nov', zoneLabel: 'Inside Dhaka (1–2 days)' },
  stockBar: null, soldLine: null,
};
const watch = { id: 3, name: 'BINBOND 2521 Watch', price: 990, image: 'watch.jpg', stock: 3, low_stock_threshold: 5, free_shipping: 0, target_audience: 'all', short_description: '', allow_backorder: false };
const sewing = { id: 5, name: 'MLSM-202 Sewing Machine', price: 1250, image: 'sew.jpg', stock: 16, low_stock_threshold: 5, free_shipping: 0, target_audience: 'all', short_description: '', allow_backorder: false };
const sealer = { id: 6, name: 'Mini Bag Sealer', price: 399, image: 'sealer.jpg', stock: 20, low_stock_threshold: 5, free_shipping: 0, target_audience: 'all', short_description: '', allow_backorder: false };
const dress = { id: 7, name: 'A.T.Z Two-Piece Tops', price: 310, image: 'dress.jpg', stock: 10, low_stock_threshold: 5, free_shipping: 0, target_audience: 'women', short_description: '', allow_backorder: false };

(async () => {
  // ---------- 1. lib/product-page.js — pure helpers ----------
  const beforeCutoff = new Date(2026, 10, 28, 10, 0, 0); // Sat 28 Nov 2026, 10am
  const afterCutoff = new Date(2026, 10, 28, 19, 0, 0); // same day, 7pm
  const estIn = pp.deliveryEstimate('inside_dhaka', beforeCutoff);
  check('D7 lib: inside Dhaka before 5pm cut-off → dispatch today, get it by today+2 days',
    estIn.dispatchToday === true && estIn.getBy.getDate() === 30 && estIn.hoursLeft === 7
    && estIn.getByLabel.includes('30 Nov'));
  const estInLate = pp.deliveryEstimate('inside_dhaka', afterCutoff);
  check('D7 lib: inside Dhaka after 5pm cut-off → dispatch tomorrow, get it by tomorrow+2 days',
    estInLate.dispatchToday === false && estInLate.getBy.getDate() === 1 && estInLate.hoursLeft === 22);
  const estOut = pp.deliveryEstimate('outside_dhaka', beforeCutoff);
  check('D7 lib: outside Dhaka before cut-off → get it by today+5 days (never earlier than the window allows)',
    estOut.dispatchToday === true && estOut.getBy.getDate() === 3 && estOut.windowLabel === '3–5 days');
  check('D7 lib: unknown zone falls back to the Dhaka window (never crashes, never promises faster)',
    pp.deliveryEstimate('nowhere', beforeCutoff).zoneSlug === 'inside_dhaka');
  check('D8 lib: sold 2 + 3 left → 40% bar, threshold 5 respected',
    JSON.stringify(pp.lowStockBar(2, 3, 5)) === JSON.stringify({ sold: 2, remaining: 3, total: 5, percent: 40 }));
  check('D8 lib: stock 16 (plentiful) → no bar at all',
    pp.lowStockBar(2, 16, 5) === null);
  check('D8 lib: out of stock → no bar (the Out of stock line speaks instead)',
    pp.lowStockBar(10, 0, 5) === null);
  check('D8 lib: bar never exceeds 100% (sold 100, 1 left → 99%)',
    pp.lowStockBar(100, 1, 5).percent === 99 && pp.lowStockBar(100, 1, 5).percent <= 100);
  check('D8 lib: default threshold is 5 when the product has none set',
    pp.lowStockBar(1, 4, null) !== null && pp.lowStockBar(1, 6, null) === null);
  check('G5 lib: sold counter shows "5 sold", hides at 0 (never a fake count)',
    pp.soldDisplay(5) === '5 sold' && pp.soldDisplay(0) === null && pp.soldDisplay(-2) === null);
  check('G1 lib: viewers hidden at 0 and at 1 (just you), shown at 2+',
    pp.viewerDisplay(0) === null && pp.viewerDisplay(1) === null && pp.viewerDisplay(2) === '2 people are viewing this now');
  check('G2 lib: time-ago is real (2 hours ago; just now under a minute)',
    pp.timeAgo(new Date(Date.now() - 2 * 3600 * 1000)) === '2 hours ago'
    && pp.timeAgo(new Date(Date.now() - 30 * 1000)) === 'just now');
  check('G2 lib: recent-purchase line shows FIRST name + Dhaka only (no full name, phone or address)',
    pp.recentPurchaseLine({ customer_name: 'Rahim Uddin', delivery_zone: 'Inside Dhaka', created_at: new Date(Date.now() - 2 * 3600 * 1000), product_name: 'MLSM-202 Sewing Machine' }) === 'Rahim from Dhaka bought MLSM-202 Sewing Machine 2 hours ago');
  check('G2 lib: no order → null (popup must not render)',
    pp.recentPurchaseLine(null) === null);
  check('D5 lib: size guide detection — Size attribute present only for the dress',
    pp.hasSizeAttribute([{ name: 'Size' }]) === true && pp.hasSizeAttribute([{ name: 'Color' }]) === false
    && pp.hasSizeAttribute([]) === false);

  // ---------- 2. Schema: new tables (boot + sql file) ----------
  check('db: server.js boot-creates product_questions / review_photos / review_helpful_votes / product_views (no manual step on deploy)',
    /CREATE TABLE IF NOT EXISTS product_questions/.test(serverJs)
    && /CREATE TABLE IF NOT EXISTS review_photos/.test(serverJs)
    && /CREATE TABLE IF NOT EXISTS review_helpful_votes/.test(serverJs)
    && /CREATE TABLE IF NOT EXISTS product_views/.test(serverJs));
  check('db: sql/product_page_batch.sql documents the same four tables',
    /CREATE TABLE IF NOT EXISTS product_questions/.test(sqlBatch)
    && /CREATE TABLE IF NOT EXISTS review_photos/.test(sqlBatch)
    && /CREATE TABLE IF NOT EXISTS review_helpful_votes/.test(sqlBatch)
    && /CREATE TABLE IF NOT EXISTS product_views/.test(sqlBatch));
  check('db: helpful votes are enforced one-per-customer/session by UNIQUE keys (not just app code)',
    /UNIQUE KEY uq_helpful_user \(review_id, user_id\)/.test(sqlBatch)
    && /UNIQUE KEY uq_helpful_session \(review_id, session_key\)/.test(sqlBatch));
  check('db: product_views has one row per session per product (UNIQUE product_id + session_key)',
    /UNIQUE KEY uq_product_view \(product_id, session_key\)/.test(sqlBatch));
  check('db: NO price change, no WELCOME10/coupon change in this batch (source)',
    !/UPDATE products SET price/.test(shopRoutes)
    && !/WELCOME10/.test(productEjs));

  // ---------- 3. Routes (source) ----------
  check('route: product page fetches the latest product_videos row (D1)',
    /SELECT filename FROM product_videos WHERE product_id = \? ORDER BY created_at DESC LIMIT 1/.test(shopRoutes));
  check('route: bundle uses ONLY the admin-chosen related_products (D2), max 3, in stock, no variants/options',
    /adminRelated = chosen\.slice\(\)/.test(shopRoutes)
    && /const inStock = adminRelated\.filter\(\(r\) => r\.stock > 0\)\.slice\(0, 3\)/.test(shopRoutes)
    && /SELECT DISTINCT product_id FROM product_variants WHERE product_id IN/.test(shopRoutes)
    && /SELECT DISTINCT product_id FROM product_options WHERE product_id IN/.test(shopRoutes));
  check('route: sold count is a REAL SUM(order_items.quantity) (G5)',
    /SELECT COALESCE\(SUM\(quantity\), 0\) AS sold FROM order_items WHERE product_id = \?/.test(shopRoutes));
  check('route: verified-buyer check joins REAL orders + order_items (D3, never assumed)',
    /SELECT DISTINCT o\.user_id FROM orders o JOIN order_items oi ON oi\.order_id = o\.id/.test(shopRoutes)
    && /WHERE oi\.product_id = \? AND o\.user_id IN/.test(shopRoutes));
  check('route: live viewers record the session then count DISTINCT sessions in the last 5 minutes (G1)',
    /INSERT INTO product_views \(product_id, session_key, viewed_at\) VALUES \(\?, \?, NOW\(\)\) ON DUPLICATE KEY UPDATE viewed_at = NOW\(\)/.test(shopRoutes)
    && /SELECT COUNT\(DISTINCT session_key\) AS c FROM product_views WHERE product_id = \? AND viewed_at >= NOW\(\) - INTERVAL 5 MINUTE/.test(shopRoutes));
  check('route: recent purchase is the latest REAL order for THIS product in the last 7 days (G2)',
    /FROM orders o JOIN order_items oi ON oi\.order_id = o\.id/.test(shopRoutes)
    && /o\.created_at >= NOW\(\) - INTERVAL 7 DAY/.test(shopRoutes));
  check('route: Q&A ask stores status pending and only answered questions are selected for the page (D4)',
    /INSERT INTO product_questions \(product_id, user_id, asker_name, question, status\) VALUES \(\?, \?, \?, \?, \\'pending\\'\)/.test(shopRoutes)
    && /WHERE product_id = \? AND status = 'answered' AND answer IS NOT NULL/.test(shopRoutes));
  check('route: review POST uses upload.single(review_photo) + convertToWebP and stores the photo row (D3)',
    /router\.post\('\/product\/:id\/review', upload\.single\('review_photo'\), upload\.convertToWebP/.test(shopRoutes)
    && /INSERT INTO review_photos \(review_id, filename\) VALUES \(\?, \?\)/.test(shopRoutes));
  check('route: helpful vote toggles (delete when voted, insert when not) and returns { ok, helpful, count } (D3)',
    /router\.post\('\/product\/review\/:reviewId\/helpful'/.test(shopRoutes)
    && /DELETE FROM review_helpful_votes WHERE id = \?/.test(shopRoutes)
    && /res\.json\(\{ ok: true, helpful: voted, count:/.test(shopRoutes));
  check('route: delivery zone comes from ?zone= or the session, default inside_dhaka (D7)',
    /if \(zoneParam === 'inside_dhaka' \|\| zoneParam === 'outside_dhaka'\) req\.session\.deliveryZone = zoneParam/.test(shopRoutes));
  check('admin: Reviews page also loads product_questions (pending first) for moderation (D4)',
    /SELECT q\.\*, p\.name AS product_name FROM product_questions q/.test(adminJs)
    && /ORDER BY CASE WHEN q\.status = 'pending' THEN 0 ELSE 1 END/.test(adminJs));
  check('admin: answer route sets status answered + answered_at (D4), reuses reviews.manage (no new permission)',
    /router\.post\('\/questions\/:id\/answer', requireAdmin, requirePermission\('reviews\.manage'\)/.test(adminJs)
    && /UPDATE product_questions SET answer = \?, status = 'answered', answered_at = NOW\(\) WHERE id = \?/.test(adminJs));
  check('admin: question delete route exists (D4)',
    /router\.post\('\/questions\/:id\/delete', requireAdmin, requirePermission\('reviews\.manage'\)/.test(adminJs));
  check('admin reviews view: Q&A section with pending badge, answer form and delete (D4)',
    adminReviewsEjs.includes('Product Q&amp;A') && adminReviewsEjs.includes('/admin/questions/')
    && adminReviewsEjs.includes('Answer &amp; Publish')
    && adminReviewsEjs.indexOf('Product Q&amp;A') < adminReviewsEjs.indexOf("include('../partials/admin-footer')"));
  check('footer: GoinceMiniCart bridge exposes refresh/open/toast for the bundle button (D2)',
    /window\.GoinceMiniCart = \{/.test(footerEjs) && /refresh: function \(cartCount, drawerHtml\)/.test(footerEjs));
  check('view: NO "secure payment"/gateway badge claim anywhere in the trust badges (G3 — no gateway yet)',
    !/Secure payment|secure payment|SSLCommerz/.test(productEjs));
  check('view: trust badges name the real facts — COD, manual bKash/Nagad/Rocket, 24h return, phone (G3)',
    productEjs.includes('Cash on Delivery available')
    && productEjs.includes('Pay by bKash / Nagad / Rocket (manual)')
    && productEjs.includes('Easy return — within 24 hours if defective or wrong item'));
  check('view: FAQ states the 24h return policy correctly (defective/wrong only, change-of-mind not accepted) (D9)',
    productEjs.includes('You can request a return within 24 hours of delivery if the product is defective or damaged, or you received the wrong product.')
    && productEjs.includes('Change-of-mind returns are not accepted once delivered.'));
  check('view: size chart is labelled standard/approximate with ±0.5" (D5, no invented certainty)',
    productEjs.includes('Standard size guide for this style — approximate measurements in inches. Actual product may vary slightly (±0.5")'));
  check('view: review form is multipart with ?_csrf= in the action (D3 CSRF rule)',
    /<form action="\/product\/<%= product\.id %>\/review\?_csrf=<%= typeof csrfToken !== 'undefined' \? csrfToken : '' %>" method="POST" class="review-form" enctype="multipart\/form-data">/.test(productEjs));
  check('view: video player is a <video controls> slide with a ▶ Video thumbnail (D1)',
    /<video id="product-video" class="gallery-video" src="\/uploads\/<%= productVideo %>" controls preload="metadata" playsinline hidden><\/video>/.test(productEjs)
    && /thumbnail-video" onclick="showProductVideo\(this\)" aria-label="Play product video">▶ Video<\/button>/.test(productEjs));
  check('view: bundle button posts via fetch to /cart/add/:id with X-Requested-With + the CSRF token (D2, PR #80 flow)',
    productEjs.includes("fetch('/cart/add/' + id, {")
    && productEjs.includes("'X-Requested-With': 'XMLHttpRequest'")
    && productEjs.includes('window.GoinceMiniCart.refresh(last.cartCount, last.drawerHtml)'));
  check('view: helpful vote JS posts x-csrf-token to /product/review/:id/helpful and toggles is-voted (D3)',
    productEjs.includes("fetch('/product/review/' + id + '/helpful'")
    && productEjs.includes("'x-csrf-token': token")
    && productEjs.includes("btn.classList.toggle('is-voted', !!d.helpful)"));
  check('view: recent-purchase popup shows after 4s and hides after 14s (G2)',
    /setTimeout\(show, 4000\)/.test(productEjs) && /setTimeout\(hide, 14000\)/.test(productEjs));
  check('css: batch block styles every new element and introduces no new hex colour (palette only)',
    ['.gallery-video', '.bundle-box', '.trust-badges', '.low-stock-bar', '.faq-item',
     '.size-guide-table', '.review-photo', '.verified-badge', '.helpful-btn',
     '.qa-item', '.recent-purchase-popup', '.viewer-line', '.sold-line'].every((c) => cssNoComments.includes(c))
    && !/#[0-9a-f]{3,8}/.test(cssNoComments.slice(cssNoComments.indexOf('/* --- Product-page batch')).replace(/#fff\b/g, '')));

  // ---------- 4. EJS renders ----------
  async function renderProduct(extra, product) {
    return renderFile(productPath, Object.assign({}, baseLocals, productLocals, extra, { product: product || watch }));
  }
  let noVideoPage = '';
  let videoPage = '';
  try { noVideoPage = await renderProduct({}, watch); } catch (e) { check('render: watch without video renders', false, String(e && e.message)); }
  try { videoPage = await renderProduct({ productVideo: 'watch.mp4' }, watch); } catch (e) { check('render: watch with video renders', false, String(e && e.message)); }
  if (noVideoPage) {
    check('D1 render: no video set → NO <video> element, NO Video thumbnail, gallery unchanged',
      !noVideoPage.includes('<video') && !noVideoPage.includes('▶ Video')
      && noVideoPage.includes('id="main-product-image"'));
  }
  if (videoPage) {
    check('D1 render: video set → <video controls> with /uploads/watch.mp4 + ▶ Video thumbnail',
      videoPage.includes('<video id="product-video"') && videoPage.includes('src="/uploads/watch.mp4"')
      && videoPage.includes('controls') && videoPage.includes('▶ Video'));
  }
  let bundlePage = '';
  try {
    bundlePage = await renderProduct({ bundleProducts: [sewing, sealer] }, watch);
  } catch (e) { check('render: bundle page renders', false, String(e && e.message)); }
  if (bundlePage) {
    check('D2 render: bundle box lists this product + complements with the bundle total ৳990+৳1250+৳399 = ৳2,639',
      bundlePage.includes('Frequently bought together') && bundlePage.includes('MLSM-202 Sewing Machine')
      && bundlePage.includes('Mini Bag Sealer') && bundlePage.includes('Total for all 3 items:')
      && bundlePage.includes('৳2639') && bundlePage.includes('data-bundle-ids="5,6"'));
  }
  if (noVideoPage) {
    check('D2 render: no related products → NO bundle box at all (no empty box)',
      !noVideoPage.includes('bundle-box') && !noVideoPage.includes('Frequently bought together'));
  }
  let dressPage = '';
  try {
    dressPage = await renderProduct({
      variantAttributes: [{ id: 1, name: 'Size', values: [{ id: 1, value: 'S' }, { id: 2, value: 'M' }, { id: 3, value: 'L' }, { id: 4, value: 'XL' }] }],
      variants: [{ id: 11, attrs: [], price: 310, compare_at_price: null, image: null, stock: 10, label: 'Size: S' }],
    }, dress);
  } catch (e) { check('render: dress page renders', false, String(e && e.message)); }
  if (dressPage) {
    check('D5 render: A.T.Z dress page shows the size guide (S/M/L/XL chest + length) and the size FAQ',
      dressPage.includes('Size Guide') && dressPage.includes('<td>S</td><td>36"</td><td>34"</td>')
      && dressPage.includes('<td>XL</td><td>42"</td><td>37"</td>')
      && dressPage.includes('How do I choose the right size?'));
  }
  if (noVideoPage) {
    check('D5 render: watch page (no Size attribute) shows NO size guide and NO size FAQ',
      !noVideoPage.includes('Size Guide') && !noVideoPage.includes('How do I choose the right size?'));
  }
  let reviewPage = '';
  try {
    reviewPage = await renderProduct({
      userName: 'Rohim',
      reviews: [
        { id: 11, user_id: 21, rating: 5, comment: 'Great watch!', created_at: new Date('2026-11-27T10:00:00'), user_name: 'Rohim' },
        { id: 12, user_id: 99, rating: 4, comment: 'Good.', created_at: new Date('2026-11-27T11:00:00'), user_name: 'Karim' },
      ],
      reviewPhotos: { 11: ['review-11.webp'] },
      helpfulCounts: { 11: 3 },
      votedReviewIds: [11],
      verifiedBuyerIds: [21],
      answeredQuestions: [{ asker_name: 'Karim', question: 'Is it waterproof?', answer: 'Yes, splash-proof.' }],
      recentPurchase: 'Rahim from Dhaka bought BINBOND 2521 Watch 2 hours ago',
      viewerLine: '2 people are viewing this now',
      stockBar: { sold: 2, remaining: 3, total: 5, percent: 40 },
      soldLine: '2 sold',
    }, watch);
  } catch (e) { check('render: full review page renders', false, String(e && e.message)); }
  if (reviewPage) {
    check('D3 render: review photo renders from /uploads/ (D3)',
      reviewPage.includes('<img class="review-photo" src="/uploads/review-11.webp"'));
    check('D3 render: verified-buyer badge ONLY on the real buyer review (Rohim), not on Karim',
      (reviewPage.match(/Verified Buyer/g) || []).length === 1
      && reviewPage.indexOf('Verified Buyer') < reviewPage.indexOf('Karim'));
    check('D3 render: helpful button shows the real count (3) and is-voted for the already-voted review',
      reviewPage.includes('Helpful (<span class="helpful-count">3</span>)')
      && reviewPage.includes('class="helpful-btn is-voted" data-review-id="11"')
      && reviewPage.includes('class="helpful-btn" data-review-id="12"'));
    check('D3 render: logged-in review form carries ?_csrf=tok123 + multipart + photo input',
      reviewPage.includes('/product/3/review?_csrf=tok123') && reviewPage.includes('enctype="multipart/form-data"')
      && reviewPage.includes('name="review_photo"'));
    check('D4 render: answered question renders (Q + admin answer), asker named',
      reviewPage.includes('Is it waterproof?') && reviewPage.includes('Yes, splash-proof.')
      && reviewPage.includes('Questions &amp; Answers'));
    check('G2 render: recent-purchase popup renders with the real order line',
      reviewPage.includes('recent-purchase-popup') && reviewPage.includes('Rahim from Dhaka bought BINBOND 2521 Watch 2 hours ago'));
    check('G1 render: viewer line renders when 2 sessions are viewing',
      reviewPage.includes('2 people are viewing this now'));
    check('G5 render: sold line renders ("2 sold")',
      reviewPage.includes('🔥 2 sold'));
    check('D8 render: low-stock bar renders at 40% with "only 3 left"',
      reviewPage.includes('only <strong>3 left</strong> (40% sold)') && reviewPage.includes('style="width:40%"'));
    check('G3 render: trust badges show the real phone 01814697896 (from shopPhone)',
      reviewPage.includes('01814697896') && reviewPage.includes('tel:+8801814697896'));
    check('D9 render: FAQ accordion renders with the 24h return policy + delivery + COD answers',
      reviewPage.includes('Frequently Asked Questions')
      && reviewPage.includes('within 24 hours of delivery if the product is defective or damaged')
      && reviewPage.includes('Can I pay Cash on Delivery?'));
    check('D7 render: delivery estimate line renders with hours + get-by date',
      reviewPage.includes('Order in the next <strong>3 hours</strong> — get it by <strong>Sat, 29 Nov</strong>'));
  }
  if (noVideoPage) {
    check('G2 render: no recent orders → NO popup at all',
      !noVideoPage.includes('recent-purchase-popup'));
    check('G1 render: 0/1 viewers → NO viewer line',
      !noVideoPage.includes('people are viewing this now'));
    check('G5 render: 0 sold → NO sold line',
      !noVideoPage.includes('🔥'));
    check('D8 render: plentiful stock → NO low-stock bar',
      !noVideoPage.includes('low-stock-bar'));
  }
  // Admin reviews render (Q&A).
  let adminReviewsHtml = '';
  try {
    adminReviewsHtml = await renderFile(adminReviewsPath, {
      siteName: 'Goince', csrfToken: 'tok123', reviews: [], pending: 0, status: '',
      questions: [
        { id: 1, product_id: 3, product_name: 'BINBOND 2521 Watch', asker_name: 'Karim', question: 'Is it waterproof?', answer: null, status: 'pending' },
        { id: 2, product_id: 5, product_name: 'MLSM-202 Sewing Machine', asker_name: 'Rahim', question: 'Does it need oil?', answer: 'No.', status: 'answered' },
      ],
      pendingQuestions: 1,
      adminDisplayName: 'Admin', adminPhotoUrl: null, siteSettings: {},
    });
  } catch (e) { check('render: admin reviews page renders', false, String(e && e.message)); }
  if (adminReviewsHtml) {
    check('D4 admin render: pending question shows the answer form, answered one shows the answer, 1 pending badge',
      adminReviewsHtml.includes('Is it waterproof?') && adminReviewsHtml.includes('/admin/questions/1/answer')
      && adminReviewsHtml.includes('Does it need oil?') && adminReviewsHtml.includes('1 pending'));
  }

  // ---------- 5. Route E2E: REAL shop routes on a stubbed DB ----------
  const dbPath = require.resolve('../config/db');
  const uploadPath = require.resolve('../config/upload');
  const CSRF_TOKEN = 'test-csrf-token-batch3';
  const testSession = { cart: [], csrfToken: CSRF_TOKEN, userId: null };
  const products = { 3: watch, 5: sewing, 6: sealer, 7: dress };
  const state = {
    reviews: [
      { id: 11, product_id: 3, user_id: 21, rating: 5, comment: 'Great watch!', created_at: new Date('2026-11-27T10:00:00'), user_name: 'Rohim' },
      { id: 12, product_id: 3, user_id: 99, rating: 4, comment: 'Good.', created_at: new Date('2026-11-27T11:00:00'), user_name: 'Karim' },
    ],
    reviewPhotos: { 11: ['review-11.webp'] },
    helpful: [], // { id, review_id, user_id, session_key }
    nextHelpfulId: 1,
    nextReviewId: 20,
    reviewPhotoRows: [],
    orders: [
      { id: 100, user_id: 21, customer_name: 'Rahim Uddin', delivery_zone: 'Inside Dhaka', status: 'Pending', created_at: new Date(Date.now() - 2 * 3600 * 1000), items: [{ product_id: 3, product_name: 'BINBOND 2521 Watch', quantity: 2 }] },
    ],
    questions: [
      { id: 1, product_id: 3, user_id: 30, asker_name: 'Karim', question: 'Is it waterproof?', answer: 'Yes, splash-proof.', status: 'answered', answered_at: new Date() },
      { id: 2, product_id: 3, user_id: 31, asker_name: 'Mina', question: 'Battery koto din jabe?', answer: null, status: 'pending', created_at: new Date() },
    ],
    nextQuestionId: 3,
    views: [{ product_id: 3, session_key: 'other-session-1', viewed_at: new Date() }],
    videos: { 3: 'watch.mp4' },
    adminRelated: { 3: [5, 6] },
  };
  const dbStub = {
    query: async (sql, params) => {
      const p = params || [];
      if (/SELECT filename FROM product_videos/.test(sql)) {
        const f = state.videos[p[0]];
        return [f ? [{ filename: f }] : []];
      }
      if (/FROM product_videos/.test(sql)) return [[]];
      if (/SELECT \* FROM products WHERE id = \? OR slug = \?/.test(sql)) {
        const prod = products[p[0]] || Object.values(products).find((x) => x.slug === p[1]);
        return [prod ? [prod] : []];
      }
      if (/FROM products WHERE id = \?/.test(sql)) {
        const prod = products[p[0]];
        return [prod ? [prod] : []];
      }
      if (/SELECT setting_key, setting_value FROM settings/.test(sql)) {
        return [[
          { setting_key: 'delivery_charge_inside', setting_value: '60' },
          { setting_key: 'delivery_charge_outside', setting_value: '120' },
        ]];
      }
      if (/FROM reviews/.test(sql) && /JOIN users/.test(sql)) return [state.reviews.filter((r) => String(r.product_id) === String(p[0]))];
      if (/AVG\(rating\)/.test(sql)) return [[{ avgRating: 4.5, reviewCount: 2 }]];
      if (/SELECT id FROM reviews WHERE id = \?/.test(sql)) {
        const r = state.reviews.find((x) => x.id === p[0]);
        return [r ? [{ id: r.id }] : []];
      }
      if (/INSERT INTO reviews/.test(sql)) {
        const id = state.nextReviewId++;
        state.reviews.push({ id, product_id: Number(p[0]), user_id: p[1], rating: Number(p[2]), comment: p[3], created_at: new Date(), user_name: 'Rohim' });
        return [{ insertId: id }];
      }
      if (/INSERT INTO review_photos/.test(sql)) {
        state.reviewPhotoRows.push({ review_id: p[0], filename: p[1] });
        return [{}];
      }
      if (/SELECT review_id, filename FROM review_photos/.test(sql)) {
        const rows = [];
        Object.entries(state.reviewPhotos).forEach(([rid, files]) => {
          if (p.includes(Number(rid))) files.forEach((f) => rows.push({ review_id: Number(rid), filename: f }));
        });
        state.reviewPhotoRows.forEach((r) => { if (p.includes(r.review_id)) rows.push(r); });
        return [rows];
      }
      if (/SELECT review_id, COUNT\(\*\) AS c FROM review_helpful_votes/.test(sql)) {
        const counts = {};
        state.helpful.forEach((h) => { if (p.includes(h.review_id)) counts[h.review_id] = (counts[h.review_id] || 0) + 1; });
        return [Object.entries(counts).map(([rid, c]) => ({ review_id: Number(rid), c }))];
      }
      if (/SELECT review_id FROM review_helpful_votes/.test(sql)) {
        const rows = state.helpful.filter((h) => p.slice(0, -2).includes(h.review_id) && (h.user_id === p[p.length - 2] || h.session_key === p[p.length - 1]));
        return [rows.map((h) => ({ review_id: h.review_id }))];
      }
      if (/SELECT id FROM review_helpful_votes/.test(sql)) {
        const rows = state.helpful.filter((h) => h.review_id === p[0] && (h.user_id === p[1] || h.session_key === p[2]));
        return [rows.map((h) => ({ id: h.id }))];
      }
      if (/INSERT INTO review_helpful_votes/.test(sql)) {
        const dup = state.helpful.find((h) => h.review_id === p[0] && (h.user_id === p[1] || h.session_key === p[2]));
        if (dup) { const e = new Error("Duplicate entry 'x' for key 'uq_helpful_user'"); throw e; }
        state.helpful.push({ id: state.nextHelpfulId++, review_id: p[0], user_id: p[1], session_key: p[2] });
        return [{}];
      }
      if (/DELETE FROM review_helpful_votes/.test(sql)) {
        state.helpful = state.helpful.filter((h) => h.id !== p[0]);
        return [{}];
      }
      if (/SELECT COUNT\(\*\) AS count FROM review_helpful_votes/.test(sql)) {
        return [[{ count: state.helpful.filter((h) => h.review_id === p[0]).length }]];
      }
      if (/SELECT DISTINCT o\.user_id FROM orders/.test(sql)) {
        const buyerIds = new Set();
        state.orders.forEach((o) => {
          if (o.items.some((it) => it.product_id === p[0]) && p.slice(1).includes(o.user_id)) buyerIds.add(o.user_id);
        });
        return [[...buyerIds].map((id) => ({ user_id: id }))];
      }
      if (/SELECT COALESCE\(SUM\(quantity\), 0\) AS sold/.test(sql)) {
        let sold = 0;
        state.orders.forEach((o) => o.items.forEach((it) => { if (it.product_id === p[0]) sold += it.quantity; }));
        return [[{ sold }]];
      }
      if (/FROM product_questions/.test(sql) && /status = 'answered'/.test(sql)) {
        return [state.questions.filter((q) => q.product_id === p[0] && q.status === 'answered')];
      }
      if (/INSERT INTO product_questions/.test(sql)) {
        state.questions.push({ id: state.nextQuestionId++, product_id: p[0], user_id: p[1], asker_name: p[2], question: p[3], status: 'pending', created_at: new Date() });
        return [{}];
      }
      if (/SELECT name FROM users WHERE id = \?/.test(sql)) return [[{ name: 'Rohim' }]];
      if (/SELECT \* FROM product_images/.test(sql)) return [[]];
      if (/FROM product_options WHERE product_id = \?/.test(sql)) return [[]];
      if (/SELECT DISTINCT product_id FROM product_options/.test(sql)) return [[]];
      if (/FROM product_variants WHERE product_id = \?/.test(sql)) return [[]];
      if (/SELECT DISTINCT product_id FROM product_variants/.test(sql)) return [[]];
      if (/FROM related_products rp/.test(sql)) {
        const ids = state.adminRelated[p[0]] || [];
        return [ids.map((id) => products[id]).filter(Boolean)];
      }
      if (/FROM products WHERE category_id/.test(sql)) return [[]];
      if (/SELECT product_id, image FROM product_images/.test(sql)) return [[]];
      if (/INSERT INTO product_views/.test(sql)) {
        const found = state.views.find((v) => v.product_id === p[0] && v.session_key === p[1]);
        if (found) found.viewed_at = new Date();
        else state.views.push({ product_id: p[0], session_key: p[1], viewed_at: new Date() });
        return [{}];
      }
      if (/DELETE FROM product_views/.test(sql)) return [{}];
      if (/COUNT\(DISTINCT session_key\)/.test(sql)) {
        const n = new Set(state.views.filter((v) => v.product_id === p[0]).map((v) => v.session_key)).size;
        return [[{ c: n }]];
      }
      if (/FROM orders o JOIN order_items oi/.test(sql)) {
        const rows = [];
        state.orders.forEach((o) => o.items.forEach((it) => {
          if (it.product_id === p[0]) rows.push({ customer_name: o.customer_name, delivery_zone: o.delivery_zone, created_at: o.created_at, product_name: it.product_name });
        }));
        rows.sort((a, b) => b.created_at - a.created_at);
        return [rows.slice(0, 1)];
      }
      if (/allow_backorder/.test(sql)) return [[{ allow_backorder: 0 }]];
      if (/SELECT stock FROM products WHERE id = \?/.test(sql)) {
        const prod = products[p[0]];
        return [[{ stock: prod ? prod.stock : 0 }]];
      }
      if (/FROM product_variants WHERE id = \? AND product_id = \?/.test(sql)) return [[]];
      if (/product_variant_attributes/.test(sql)) return [[]];
      if (/FROM product_options WHERE id = \? AND product_id = \?/.test(sql)) return [[]];
      if (/free_shipping, cod_allowed/.test(sql)) return [[]];
      if (/FROM delivery_zones/.test(sql)) return [[]];
      if (/FROM payment_methods/.test(sql)) return [[]];
      if (/FROM settings WHERE setting_key IN \('payment_mode'/.test(sql)) return [[]];
      return [[]];
    },
    getConnection: async () => ({ beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {}, query: async () => [[]] }),
  };
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: dbStub };
  // Fake upload middleware: writes NOTHING to disk — the test only
  // proves the route stores the photo row when req.file exists.
  // x-test-photo: 1 → pretend a photo was uploaded.
  let injectPhoto = false;
  const fakeSingle = (req, res, next) => {
    if (req.get && req.get('x-test-photo') === '1') req.file = { filename: 'test-review-photo.webp', fieldname: 'review_photo' };
    next();
  };
  const fakeUpload = { single: () => fakeSingle, fields: () => (req, res, next) => next(), convertToWebP: (req, res, next) => next() };
  require.cache[uploadPath] = { id: uploadPath, filename: uploadPath, loaded: true, exports: fakeUpload };
  const { csrfProtection } = require('../lib/csrf');
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = testSession;
    res.locals.userName = testSession.userId ? 'Rohim' : null; res.locals.userPhotoUrl = null;
    res.locals.cartCount = (testSession.cart || []).reduce((s, it) => s + it.quantity, 0);
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
  function reqRaw(port, method, pathUrl, body, ajax, extraHeaders) {
    return new Promise((resolve, reject) => {
      const headers = Object.assign({}, extraHeaders || {});
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
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.on('listening', r));
  const port = server.address().port;
  try {
    // --- 5a. GET /product/3: everything the route computes, live.
    testSession.userId = 21;
    const page3 = await reqRaw(port, 'GET', '/product/3', null, false);
    check('e2e product page: 200, video player renders (video set for product 3)',
      page3.status === 200 && page3.body.includes('<video id="product-video"') && page3.body.includes('/uploads/watch.mp4'));
    check('e2e product page: bundle box renders with both complements + total ৳2,639',
      page3.body.includes('Frequently bought together') && page3.body.includes('MLSM-202 Sewing Machine')
      && page3.body.includes('Mini Bag Sealer') && page3.body.includes('৳2639'));
    check('e2e product page: sold line "2 sold" matches the real order count (qty 2)',
      page3.body.includes('🔥 2 sold'));
    check('e2e product page: low-stock bar 40% (sold 2, 3 left, threshold 5)',
      page3.body.includes('only <strong>3 left</strong> (40% sold)') && page3.body.includes('style="width:40%"'));
    check('e2e product page: viewer line shows — 2 distinct sessions (seeded other + this visit)',
      page3.body.includes('2 people are viewing this now'));
    check('e2e product page: recent-purchase popup line from the REAL order (first name + Dhaka, 2 hours ago)',
      page3.body.includes('Rahim from Dhaka bought BINBOND 2521 Watch 2 hours ago'));
    check('e2e product page: verified-buyer badge only on Rohim (real buyer), review photo shown, helpful count 0',
      (page3.body.match(/Verified Buyer/g) || []).length === 1
      && page3.body.includes('/uploads/review-11.webp')
      && page3.body.includes('Helpful (<span class="helpful-count">0</span>)'));
    check('e2e product page: answered Q&A renders, PENDING question does NOT render',
      page3.body.includes('Is it waterproof?') && page3.body.includes('Yes, splash-proof.')
      && !page3.body.includes('Battery koto din jabe?'));
    check('e2e product page: delivery estimate renders for the default Dhaka zone',
      page3.body.includes('Order in the next') && page3.body.includes('Inside Dhaka (1–2 days)'));
    check('e2e product page: trust badges + real phone 01814697896 render',
      page3.body.includes('Cash on Delivery available') && page3.body.includes('01814697896'));
    check('e2e product page: FAQ renders with the 24h return policy',
      page3.body.includes('within 24 hours of delivery if the product is defective or damaged'));
    // --- 5b. GET /product/5: nothing to show → nothing shown.
    const page5 = await reqRaw(port, 'GET', '/product/5', null, false);
    check('e2e product page: product 5 (no video, no related, 0 sold, stock 16, no recent order) shows NONE of video/bundle/sold/bar/viewers/popup',
      page5.status === 200 && !page5.body.includes('<video id="product-video"')
      && !page5.body.includes('Frequently bought together') && !page5.body.includes('🔥')
      && !page5.body.includes('low-stock-bar') && !page5.body.includes('people are viewing this now')
      && !page5.body.includes('recent-purchase-popup'));
    // --- 5c. Delivery estimate follows the chosen zone (?zone=outside_dhaka).
    const estOut = pp.deliveryEstimate('outside_dhaka', new Date());
    const page3out = await reqRaw(port, 'GET', '/product/3?zone=outside_dhaka', null, false);
    check('e2e product page: ?zone=outside_dhaka → estimate uses the 3–5 day window + matching get-by date',
      page3out.status === 200 && page3out.body.includes('Outside Dhaka (3–5 days)')
      && page3out.body.includes(estOut.getByLabel));
    // --- 5d. Helpful vote: guest toggles once (1 → 0), count is real.
    testSession.userId = null;
    const vote1 = await reqRaw(port, 'POST', '/product/review/11/helpful', enc({}), true, { 'x-csrf-token': CSRF_TOKEN });
    let jVote1 = null; try { jVote1 = JSON.parse(vote1.body); } catch (e) { /* not JSON */ }
    check('e2e helpful: guest vote → 200 { ok, helpful true, count 1 }',
      vote1.status === 200 && jVote1 && jVote1.ok === true && jVote1.helpful === true && jVote1.count === 1);
    const vote2 = await reqRaw(port, 'POST', '/product/review/11/helpful', enc({}), true, { 'x-csrf-token': CSRF_TOKEN });
    let jVote2 = null; try { jVote2 = JSON.parse(vote2.body); } catch (e) { /* not JSON */ }
    check('e2e helpful: same guest votes again → toggle OFF { helpful false, count 0 } (one vote per session)',
      vote2.status === 200 && jVote2 && jVote2.helpful === false && jVote2.count === 0);
    const voteNoCsrf = await reqRaw(port, 'POST', '/product/review/11/helpful', enc({}), true, {});
    check('e2e helpful: vote WITHOUT a CSRF token is still 403',
      voteNoCsrf.status === 403);
    const voteMissing = await reqRaw(port, 'POST', '/product/review/999/helpful', enc({}), true, { 'x-csrf-token': CSRF_TOKEN });
    check('e2e helpful: vote on a missing review → 404 JSON { ok: false }',
      voteMissing.status === 404 && JSON.parse(voteMissing.body).ok === false);
    // --- 5e. Helpful vote as a LOGGED-IN customer: same toggle, then the page shows is-voted.
    testSession.userId = 21;
    const vote3 = await reqRaw(port, 'POST', '/product/review/11/helpful', enc({}), true, { 'x-csrf-token': CSRF_TOKEN });
    let jVote3 = null; try { jVote3 = JSON.parse(vote3.body); } catch (e) { /* not JSON */ }
    check('e2e helpful: logged-in vote → { helpful true, count 1 }',
      vote3.status === 200 && jVote3 && jVote3.helpful === true && jVote3.count === 1);
    const page3voted = await reqRaw(port, 'GET', '/product/3', null, false);
    check('e2e helpful: after voting, the page shows the button voted (is-voted) with count 1',
      page3voted.body.includes('class="helpful-btn is-voted" data-review-id="11"')
      && page3voted.body.includes('Helpful (<span class="helpful-count">1</span>)'));
    // --- 5f. Review WITH a photo: multipart action carries ?_csrf=; photo row stored.
    const photoBefore = state.reviewPhotoRows.length;
    const revPhoto = await reqRaw(port, 'POST', '/product/3/review?_csrf=' + CSRF_TOKEN, enc({ rating: '5', comment: 'Photo review' }), false, { 'x-test-photo': '1' });
    check('e2e review photo: POST with ?_csrf= in the URL + photo → 302 ?review=pending, photo row stored',
      revPhoto.status === 302 && revPhoto.headers.location === '/product/3?review=pending'
      && state.reviewPhotoRows.length === photoBefore + 1
      && state.reviewPhotoRows[state.reviewPhotoRows.length - 1].filename === 'test-review-photo.webp');
    // --- 5g. Review WITHOUT a photo: still works, no photo row.
    const photoBefore2 = state.reviewPhotoRows.length;
    const revPlain = await reqRaw(port, 'POST', '/product/3/review?_csrf=' + CSRF_TOKEN, enc({ rating: '4', comment: 'No photo' }), false, {});
    check('e2e review photo: POST without a photo → 302 ?review=pending, NO photo row stored',
      revPlain.status === 302 && state.reviewPhotoRows.length === photoBefore2);
    // --- 5h. Q&A ask: stored pending, redirect ?question=pending; page still hides it.
    const qBefore = state.questions.length;
    const qAsk = await reqRaw(port, 'POST', '/product/3/question', enc({ _csrf: CSRF_TOKEN, question: 'Does it come with a box?' }), false);
    check('e2e Q&A: ask → 302 ?question=pending, question stored pending (not answered)',
      qAsk.status === 302 && qAsk.headers.location === '/product/3?question=pending'
      && state.questions.length === qBefore + 1
      && state.questions[state.questions.length - 1].status === 'pending');
    const page3q = await reqRaw(port, 'GET', '/product/3', null, false);
    check('e2e Q&A: the just-asked (pending) question does NOT render on the product page',
      !page3q.body.includes('Does it come with a box?'));
    // --- 5i. Bundle "Add all to cart": the three AJAX adds all land in the cart.
    testSession.cart = [];
    for (const id of [3, 5, 6]) {
      const r = await reqRaw(port, 'POST', '/cart/add/' + id, enc({ _csrf: CSRF_TOKEN, quantity: '1' }), true);
      const j = JSON.parse(r.body);
      check(`e2e bundle add: AJAX /cart/add/${id} → 200 { ok }`, r.status === 200 && j.ok === true);
    }
    check('e2e bundle add: all three items are in the cart (watch + sewing machine + sealer)',
      testSession.cart.length === 3
      && testSession.cart.some((i) => i.id === 3) && testSession.cart.some((i) => i.id === 5)
      && testSession.cart.some((i) => i.id === 6));
    const lastAdd = await reqRaw(port, 'POST', '/cart/add/3', enc({ _csrf: CSRF_TOKEN, quantity: '1' }), true);
    const jLast = JSON.parse(lastAdd.body);
    check('e2e bundle add: last AJAX response carries the fresh drawer HTML (PR #80 flow)',
      lastAdd.status === 200 && jLast.ok === true && typeof jLast.drawerHtml === 'string'
      && jLast.drawerHtml.includes('BINBOND 2521 Watch'));
  } finally {
    server.close();
    delete require.cache[dbPath];
    delete require.cache[uploadPath];
    delete require.cache[require.resolve('../routes/shop')];
  }

  // ---------- 6. The REAL bundle + popup scripts in a stubbed DOM ----------
  function makeStubEl() {
    const el = {
      _classes: new Set(), _attrs: {}, _listeners: {}, _children: [],
      hidden: false, disabled: false, textContent: '', innerHTML: '', value: '',
      classList: {
        add(c) { el._classes.add(c); },
        remove(c) { el._classes.delete(c); },
        toggle(c, f) { if (f === undefined) { if (el._classes.has(c)) { el._classes.delete(c); return false; } el._classes.add(c); return true; } if (f) el._classes.add(c); else el._classes.delete(c); return !!f; },
        contains(c) { return el._classes.has(c); },
      },
      setAttribute(k, v) { el._attrs[k] = String(v); },
      getAttribute(k) { return el._attrs[k] === undefined ? null : el._attrs[k]; },
      addEventListener(type, fn) { (el._listeners[type] = el._listeners[type] || []).push(fn); },
      fire(type, ev) { (el._listeners[type] || []).forEach((fn) => fn(ev || {})); },
      querySelector() { return null; },
      closest() { return null; },
    };
    return el;
  }
  function extractScript(src, marker) {
    const blocks = src.match(/<script>([\s\S]*?)<\/script>/g) || [];
    for (const b of blocks) { if (b.includes(marker)) return b.replace(/^<script>/, '').replace(/<\/script>$/, ''); }
    return '';
  }
  // --- 6a. Bundle add-all: sequential fetches, bridge refresh/open/toast.
  // (Script is taken from a RENDERED page — the raw .ejs still has
  // <%= product.id %> in it, which is not valid JS yet.)
  const bundleRendered = await renderProduct({ bundleProducts: [sewing, sealer] }, watch);
  const bundleCode = extractScript(bundleRendered, 'bundle-add-all');
  check('dom bundle: the bundle script is extractable from product.ejs',
    bundleCode.includes("document.getElementById('bundle-add-all')"));
  {
    const btn = makeStubEl();
    btn._attrs['data-bundle-ids'] = '5,6';
    btn.textContent = 'Add all to cart — ৳2639';
    const csrfInput = makeStubEl(); csrfInput.value = 'tok123';
    const fetchCalls = [];
    const bridgeCalls = [];
    const sandbox = {
      document: {
        querySelector() { return null; }, // the helpful-vote IIFE shares this <script> block; no reviews section here
        getElementById(id) {
          if (id === 'bundle-add-all') return btn;
          if (id === 'bundle-csrf') return csrfInput;
          return null;
        },
      },
      window: {
        GoinceMiniCart: {
          refresh(cartCount, drawerHtml) { bridgeCalls.push(['refresh', cartCount, drawerHtml]); },
          open() { bridgeCalls.push(['open']); },
          toast(msg, isErr) { bridgeCalls.push(['toast', msg, !!isErr]); },
        },
      },
      fetch(url, opts) {
        fetchCalls.push({ url, opts });
        const id = url.split('/').pop();
        const count = { 3: 1, 5: 2, 6: 3 }[id] || 1;
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, cartCount: count, itemName: 'x', drawerHtml: '<div>drawer ' + count + '</div>' }),
        });
      },
    };
    sandbox.window.location = { reload() { bridgeCalls.push(['reload']); } };
    vm.runInNewContext(bundleCode, sandbox);
    btn.fire('click', {});
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    check('dom bundle: click fetches /cart/add/3, /cart/add/5, /cart/add/6 IN ORDER, each XHR + urlencoded _csrf',
      fetchCalls.length === 3
      && fetchCalls.map((c) => c.url).join(',') === '/cart/add/3,/cart/add/5,/cart/add/6'
      && fetchCalls.every((c) => c.opts.headers['X-Requested-With'] === 'XMLHttpRequest'
        && c.opts.body === '_csrf=tok123&quantity=1'));
    check('dom bundle: after the last add, the bridge refreshes the drawer (count 3), opens it, and toasts "Bundle added to cart"',
      bridgeCalls.some((c) => c[0] === 'refresh' && c[1] === 3 && String(c[2]).includes('drawer 3'))
      && bridgeCalls.some((c) => c[0] === 'open')
      && bridgeCalls.some((c) => c[0] === 'toast' && c[1] === '✓ Bundle added to cart' && c[2] === false));
    check('dom bundle: button is re-enabled after the adds finish',
      btn.disabled === false && btn.textContent === 'Add all to cart — ৳2639');
  }
  // --- 6b. Recent-purchase popup: appears after 4s, hides after 14s.
  const popupRendered = await renderProduct({ recentPurchase: 'Rahim from Dhaka bought BINBOND 2521 Watch 2 hours ago' }, watch);
  const popupCode = extractScript(popupRendered, 'recent-purchase-popup');
  check('dom popup: the popup script is extractable from product.ejs',
    popupCode.includes("document.getElementById('recent-purchase-popup')"));
  {
    const pop = makeStubEl(); pop.hidden = true;
    const closeBtn = makeStubEl();
    const timers = [];
    const sandbox = {
      document: {
        getElementById(id) {
          if (id === 'recent-purchase-popup') return pop;
          if (id === 'recent-purchase-close') return closeBtn;
          return null;
        },
      },
      setTimeout(fn, ms) { timers.push({ fn, ms }); return timers.length; },
    };
    vm.runInNewContext(popupCode, sandbox);
    check('dom popup: two timers are set (show 4000ms, hide 14000ms), popup starts hidden',
      timers.length === 2 && timers[0].ms === 4000 && timers[1].ms === 14000 && pop.hidden === true);
    timers[0].fn();
    check('dom popup: after 4s the popup is visible (hidden=false, is-visible)',
      pop.hidden === false && pop.classList.contains('is-visible'));
    closeBtn.fire('click', {});
    check('dom popup: × dismisses the popup',
      pop.hidden === true && !pop.classList.contains('is-visible'));
  }

  // ---------- Summary ----------
  console.log(`\n${passes.length} passed, ${failures.length} failed.`);
  if (failures.length > 0) {
    console.log('Failed checks:');
    failures.forEach((f) => console.log('  - ' + f));
    process.exitCode = 1;
  }
})();
