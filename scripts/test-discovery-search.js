// Discovery & search — batch 4 (feat/discovery-search, PR #85).
//
//   C1  Faceted filters: brand, rating, in-stock only, discount,
//       category — composing with each other AND with search, sort
//       and pagination. Brand / discount come from columns that
//       already exist (brand, compare_at_price); rating from the
//       already-joined approved reviews.
//   C2  Typo-tolerant search + "did you mean": "sweing" still finds
//       the sewing machine (Damerau-Levenshtein in lib/discovery.js,
//       no external search service). Exact search runs first and is
//       unchanged when it matches.
//   C3  "Customers also viewed" on the product page, from the real
//       persistent view history (product_view_history) — never the
//       current product, hidden entirely when there is nothing.
//   C4  Server-side pagination (page size 12) with a "Load more"
//       button that appends without a full reload, and a ?page=
//       parameter so a page is linkable. Pagination composes with
//       filters + search + sort + category.
//
// No live MySQL needed: lib unit checks + source checks + direct
// EJS renders + the REAL shop routes on a stubbed DB (express, like
// test-cart-buying.js) + the REAL load-more script in a stubbed DOM
// (vm sandbox).
//
// Run:  node scripts/test-discovery-search.js
// Exit code 0 = all checks passed.
'use strict';

const fs = require('fs');
const path = require('path');
const util = require('util');
const ejs = require('ejs');
const vm = require('vm');
const http = require('http');
const express = require('express');

const disc = require('../lib/discovery');
const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'style.css'), 'utf8');
const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
const shopRoutes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'shop.js'), 'utf8');
const serverJs = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const indexEjs = fs.readFileSync(path.join(__dirname, '..', 'views', 'index.ejs'), 'utf8');
const productEjs = fs.readFileSync(path.join(__dirname, '..', 'views', 'product.ejs'), 'utf8');
const footerEjs = fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', 'footer.ejs'), 'utf8');
const loadMoreJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'load-more.js'), 'utf8');
const sqlDiscovery = fs.readFileSync(path.join(__dirname, '..', 'sql', 'discovery_search.sql'), 'utf8');
const renderFile = util.promisify(ejs.renderFile);

const failures = [];
const passes = [];
function check(name, ok, detail) {
  if (ok) { passes.push(name); console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

// Catalogue used by the lib checks and the stubbed-DB route checks:
// 15 products, 13 of them BINBOND (so brand + pagination compose
// has a page 2), one sewing machine, one dress, one out-of-stock
// pair, a spread of ratings and two discounted lines.
const catalogue = [
  { id: 5, name: 'MLSM-202 Sewing Machine', tags: 'sewing, machine, tailor', brand: 'MLSM' },
  { id: 3, name: 'BINBOND 2521 Watch', tags: 'watch, men, luxury', brand: 'BINBOND' },
  { id: 7, name: 'A.T.Z Two-Piece Tops', tags: 'dress, women', brand: 'A.T.Z' },
  { id: 6, name: 'Mini Bag Sealer', tags: 'sealer, kitchen', brand: '' },
];

(async () => {
  // ---------- 1. lib/discovery.js — pure helpers ----------
  console.log('1. lib/discovery.js');
  check('C2 lib: Damerau-Levenshtein — a transposition costs 1 ("sweing" vs "sewing"), an insertion costs 1 ("wach" vs "watch")',
    disc.damerauLevenshtein('sweing', 'sewing') === 1 && disc.damerauLevenshtein('wach', 'watch') === 1
    && disc.damerauLevenshtein('sewing', 'sewing') === 0 && disc.damerauLevenshtein('', 'abc') === 3);
  check('C2 lib: "sweing" fuzzy-finds the sewing machine (id 5) and nothing else',
    JSON.stringify(disc.fuzzySearchProducts('sweing', catalogue).map((m) => m.id)) === JSON.stringify([5]));
  check('C2 lib: "wach" fuzzy-finds the watch (id 3) and nothing else',
    JSON.stringify(disc.fuzzySearchProducts('wach', catalogue).map((m) => m.id)) === JSON.stringify([3]));
  check('C2 lib: "sweing machine" matches the machine with both words (AND semantics — no watch)',
    JSON.stringify(disc.fuzzySearchProducts('sweing machine', catalogue).map((m) => m.id)) === JSON.stringify([5]));
  check('C2 lib: exact terms still match exactly ("sewing machine", "watch", "bag sealer")',
    JSON.stringify(disc.fuzzySearchProducts('sewing machine', catalogue).map((m) => m.id)) === JSON.stringify([5])
    && JSON.stringify(disc.fuzzySearchProducts('watch', catalogue).map((m) => m.id)) === JSON.stringify([3])
    && JSON.stringify(disc.fuzzySearchProducts('bag sealer', catalogue).map((m) => m.id)) === JSON.stringify([6]));
  check('C2 lib: no false positives — "press" does not match the dress, "zzz" matches nothing (first-letter + prefix guards)',
    disc.fuzzySearchProducts('press', catalogue).length === 0 && disc.fuzzySearchProducts('zzz', catalogue).length === 0);
  check('C2 lib: did-you-mean corrects "sweing" -> "sewing" and "wach" -> "watch", leaves exact terms alone, stays silent on nonsense',
    disc.didYouMean('sweing', catalogue) === 'sewing' && disc.didYouMean('wach', catalogue) === 'watch'
    && disc.didYouMean('sweing machine', catalogue) === 'sewing machine'
    && disc.didYouMean('sewing machine', catalogue) === null && disc.didYouMean('zzz', catalogue) === null
    && disc.didYouMean('press', catalogue) === null);
  check('C4 lib: page size is 12; parse/clamp/totalPages behave (abc -> 1, 99 of 2 -> 2, 15 items -> 2 pages, 5 items -> 1 page)',
    disc.PAGE_SIZE === 12 && disc.parsePage('abc') === 1 && disc.parsePage('2') === 2 && disc.parsePage(0) === 1
    && disc.clampPage(99, 2) === 2 && disc.clampPage(1, 1) === 1
    && disc.totalPagesFor(15, 12) === 2 && disc.totalPagesFor(5, 12) === 1 && disc.totalPagesFor(0, 12) === 1);
  check('C1+C4 lib: shopPageUrl keeps filter+search+sort, adds ?page= past page 1, and Clear-filters drops only the facet keys',
    disc.shopPageUrl({ category: '8', sort: 'price_low', brand: 'BINBOND' }, 2) === '/?page=2&category=8&sort=price_low&brand=BINBOND'
    && disc.shopPageUrl({ category: '8', sort: 'newest' }, 1) === '/?category=8&sort=newest'
    && disc.shopPageUrl({ category: '8', sort: 'newest', brand: 'BINBOND', rating: '4', in_stock: '1' }, 1, disc.FACET_KEYS) === '/?category=8&sort=newest'
    && disc.shopPageUrl({}, 1) === '/');

  // ---------- 2. Source checks: the route wires it all ----------
  console.log('2. Source checks (routes/shop.js, server.js, templates, sql)');
  check('C1 source: homepage route filters brand (= ?), in-stock (stock > 0) and discount (compare_at_price > price)',
    /products\.brand = \?/.test(shopRoutes) && /products\.stock > 0/.test(shopRoutes)
    && /products\.compare_at_price IS NOT NULL AND products\.compare_at_price > products\.price/.test(shopRoutes));
  check('C1 source: rating filters in HAVING on the joined reviews (COALESCE AVG >= ?), never in WHERE; invalid ratings (0, 9, NaN) are ignored',
    /HAVING COALESCE\(AVG\(reviews\.rating\), 0\) >= \?/.test(shopRoutes)
    && /minRating >= 1 && minRating <= 5/.test(shopRoutes));
  check('C1 source: brand options come from the live catalogue (SELECT DISTINCT brand … visible products), never a hardcoded list',
    /SELECT DISTINCT brand FROM products WHERE brand IS NOT NULL/.test(shopRoutes));
  check('C2 source: exact LIKE runs first, fuzzy only when exact returns fewer than EXACT_RESULTS_TO_TRUST, via lib/discovery',
    /SELECT id FROM products WHERE/.test(shopRoutes) && /products\.name LIKE \? OR products\.tags LIKE \? OR products\.brand LIKE \?/.test(shopRoutes)
    && /exactIds\.length < disc\.EXACT_RESULTS_TO_TRUST/.test(shopRoutes)
    && /disc\.fuzzySearchProducts\(search, catalogue\)/.test(shopRoutes)
    && /disc\.didYouMean\(search, catalogue\)/.test(shopRoutes));
  check('C2 source: fuzzy matches are appended AFTER exact ids (never ahead of them) and empty search results force an empty list, not a full catalogue',
    /searchIds = exactIds\.concat\(fuzzyIds\)/.test(shopRoutes) && /AND 1=0/.test(shopRoutes));
  check('C4 source: total is counted in a GROUP BY + HAVING subquery, the listing uses LIMIT ? OFFSET ? with PAGE_SIZE',
    /SELECT COUNT\(\*\) AS total FROM \(SELECT products\.id/.test(shopRoutes)
    && /LIMIT \? OFFSET \?/.test(shopRoutes) && /disc\.PAGE_SIZE/.test(shopRoutes)
    && /disc\.clampPage\(requestedPage, totalPages\)/.test(shopRoutes));
  check('C4 source: XHR on the homepage answers JSON { ok, html, hasMore, page, totalPages, total, nextPageUrl } from the grid markers',
    /if \(req\.xhr\)/.test(shopRoutes) && /grid-items-start/.test(shopRoutes) && /grid-items-end/.test(shopRoutes)
    && /res\.json\(\{ ok: true, html, hasMore, page, totalPages, total: totalProducts, nextPageUrl \}\)/.test(shopRoutes));
  check('C3 source: product view is ALSO written to a persistent product_view_history table (product_views rows are deleted after 10 min)',
    /INSERT INTO product_view_history \(product_id, session_key, viewed_at\)/.test(shopRoutes));
  check('C3 source: co-viewed query joins the history on session_key, excludes the current product, only visible products, ordered by co-view count, LIMIT 4',
    /FROM product_view_history pv2/.test(shopRoutes) && /pv1\.session_key = pv2\.session_key/.test(shopRoutes)
    && /pv2\.product_id != \?/.test(shopRoutes) && /ORDER BY coview_count DESC/.test(shopRoutes)
    && /LIMIT 4/.test(shopRoutes));
  check('C3 source: server.js auto-creates product_view_history (UNIQUE product+session, session indexes) next to product_views; sql file is its source',
    /CREATE TABLE IF NOT EXISTS product_view_history/.test(serverJs)
    && /UNIQUE KEY uq_pvh_product_session \(product_id, session_key\)/.test(serverJs)
    && /CREATE TABLE IF NOT EXISTS product_view_history/.test(sqlDiscovery)
    && /product_views.*only keeps the last/.test(sqlDiscovery));
  check('C1 source: filter UI lives in the existing sort form (brand + rating selects, in-stock + discount checkboxes, Clear filters link)',
    /<select name="brand" id="brand"/.test(indexEjs) && /<select name="rating" id="rating"/.test(indexEjs)
    && /name="in_stock" value="1"/.test(indexEjs) && /name="discount" value="1"/.test(indexEjs)
    && /class="filter-clear">Clear filters/.test(indexEjs));
  check('C2 source: template shows the "Did you mean" link (re-runs the corrected search) and the no-exact-match note, both guarded for old renders',
    /Did you mean: <a href="\/\?search=<%= encodeURIComponent\(didYouMean\) %>">/.test(indexEjs)
    && /No exact matches for/.test(indexEjs));
  check('C4 source: template has the grid markers + wrapper, and a "Load more" link (plain ?page= href, no-JS fallback) shown only when hasMore',
    /<!-- grid-items-start -->/.test(indexEjs) && /<!-- grid-items-end -->/.test(indexEjs)
    && /id="product-grid-wrap"/.test(indexEjs)
    && /id="load-more-btn" data-next-url="<%= pagination\.nextPageUrl %>"/.test(indexEjs)
    && /pagination\.hasMore/.test(indexEjs));
  check('C4 source: load-more.js fetches the button URL with X-Requested-With, appends the returned html to the grid, re-points or removes the button, follows the URL in the address bar',
    /fetch\(url, \{ headers: \{ 'X-Requested-With': 'XMLHttpRequest'/.test(loadMoreJs)
    && /insertAdjacentHTML\('beforeend', data\.html\)/.test(loadMoreJs)
    && /setAttribute\('data-next-url', data\.nextPageUrl\)/.test(loadMoreJs)
    && /history\.replaceState\(null, '', data\.nextPageUrl\)/.test(loadMoreJs)
    && /removeChild\(btn\)/.test(loadMoreJs));
  check('C4 source: footer loads load-more.js on every shop page (after scroll-reveal.js)',
    footerEjs.indexOf('/js/load-more.js') > footerEjs.indexOf('/js/scroll-reveal.js'));
  check('C3 source: product page renders a "Customers also viewed" section (same card style as Related), hidden when empty, guarded for old renders',
    /Customers also viewed/.test(productEjs) && /typeof alsoViewed !== 'undefined' && alsoViewed && alsoViewed\.length > 0/.test(productEjs));
  check('CSS: filter/did-you-mean/load-more styles reuse existing vars only (no new colour)',
    /\.sort-form \.filter-check/.test(cssNoComments) && /\.did-you-mean/.test(cssNoComments)
    && /\.load-more-wrap/.test(cssNoComments) && !/\.filter-check[^}]*#[0-9a-fA-F]{3,6}/.test(cssNoComments)
    && !/\.did-you-mean[^}]*#[0-9a-fA-F]{3,6}/.test(cssNoComments));

  // ---------- 3. Direct EJS renders ----------
  console.log('3. Direct EJS renders');
  const indexBase = {
    siteName: 'Goince', siteSettings: { hero_title: 'Shop', hero_subtitle: 'Sub' },
    shopPhone: '01814697896', cartCount: 0, miniCart: [], miniCartSubtotal: 0,
    userName: null, userPhotoUrl: null, userEmail: '',
    products: [
      { id: 3, name: 'BINBOND 2521 Watch', image: 'watch.jpg', price: 990, stock: 15, compare_at_price: 1990, avg_rating: 4.7, review_count: 3, free_shipping: 0 },
      { id: 5, name: 'MLSM-202 Sewing Machine', image: 'sew.jpg', price: 1250, stock: 16, compare_at_price: 2200, avg_rating: 4.7, review_count: 3, free_shipping: 0 },
    ],
    secondImages: {}, variantProductIds: [], optionProductIds: [],
    bestSellers: [], displayCategories: [], subCategories: [],
    selectedCategory: '', search: '', sort: 'newest',
    isSeasonalCategory: false, selectedAudience: '',
    minPrice: '', maxPrice: '', recentlyViewedMap: {}, csrfToken: 'tok',
    banners: [], heroProduct: null, pageTitle: 'Goince',
    brands: ['A.T.Z', 'BINBOND', 'MLSM'], selectedBrand: 'BINBOND', minRating: 4,
    inStockOnly: true, onDiscount: false, didYouMean: null, fuzzyApplied: false,
    hasActiveFilters: true, clearFiltersUrl: '/?sort=newest',
    pagination: { page: 1, totalPages: 2, total: 15, hasMore: true, nextPageUrl: '/?page=2' },
  };
  const indexHtml = await renderFile(path.join(__dirname, '..', 'views', 'index.ejs'), indexBase);
  check('render index: brand select lists the live brands with BINBOND selected; rating 4★ selected; in-stock checked; Clear filters links to the facet-free URL',
    indexHtml.includes('<option value="BINBOND" selected>BINBOND</option>')
    && indexHtml.includes('<option value="4" selected>4★ &amp; up</option>')
    && /name="in_stock" value="1"[^>]*checked/.test(indexHtml)
    && indexHtml.includes('<a href="/?sort=newest" class="filter-clear">Clear filters ✕</a>'));
  check('render index: Load more button points at the next page (?page=2) and both grid markers are present for the AJAX slice',
    indexHtml.includes('id="load-more-btn" data-next-url="/?page=2"')
    && indexHtml.includes('<!-- grid-items-start -->') && indexHtml.includes('<!-- grid-items-end -->'));
  check('render index: did-you-mean line renders as a link that re-runs the corrected search',
    (await renderFile(path.join(__dirname, '..', 'views', 'index.ejs'),
      { ...indexBase, search: 'sweing', didYouMean: 'sewing', fuzzyApplied: true, products: [indexBase.products[1]] }))
      .includes('Did you mean: <a href="/?search=sewing">sewing</a>?')
    && (await renderFile(path.join(__dirname, '..', 'views', 'index.ejs'),
      { ...indexBase, search: 'sweing', didYouMean: 'sewing', fuzzyApplied: true, products: [indexBase.products[1]] }))
      .includes('No exact matches for “sweing”'));
  check('render index: no Load more button (and no Clear filters) on the last page with no active filters',
    !((await renderFile(path.join(__dirname, '..', 'views', 'index.ejs'),
      { ...indexBase, selectedBrand: '', minRating: null, inStockOnly: false, hasActiveFilters: false,
        pagination: { page: 2, totalPages: 2, total: 15, hasMore: false, nextPageUrl: '/?page=3' } }))
      .includes('id="load-more-btn"'))
    && !((await renderFile(path.join(__dirname, '..', 'views', 'index.ejs'),
      { ...indexBase, selectedBrand: '', minRating: null, inStockOnly: false, hasActiveFilters: false,
        pagination: { page: 2, totalPages: 2, total: 15, hasMore: false, nextPageUrl: '/?page=3' } }))
      .includes('Clear filters')));
  check('render index: OLD locals (no brands/pagination/didYouMean — as in earlier suites) still render without crashing',
    (await renderFile(path.join(__dirname, '..', 'views', 'index.ejs'), {
      siteName: 'Goince', siteSettings: { hero_title: 'Shop', hero_subtitle: 'Sub' },
      shopPhone: '01814697896', cartCount: 0, miniCart: [], miniCartSubtotal: 0,
      userName: null, userPhotoUrl: null, userEmail: '',
      products: [{ id: 1, name: 'Watch', image: 'watch.jpg', price: 990, stock: 5, compare_at_price: null, avg_rating: null, review_count: 0 }],
      secondImages: {}, variantProductIds: [], optionProductIds: [],
      bestSellers: [], displayCategories: [], subCategories: [],
      selectedCategory: null, search: '', sort: 'newest',
      isSeasonalCategory: false, selectedAudience: '',
      minPrice: '', maxPrice: '', recentlyViewedMap: {}, csrfToken: 'tok',
      banners: [], heroProduct: null, pageTitle: 'Goince',
    })).includes('Watch'));

  const productBase = {
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
    stockBar: null, soldLine: null, showSizeGuide: false,
  };
  const watch = { id: 3, name: 'BINBOND 2521 Watch', price: 990, image: 'watch.jpg', stock: 15, low_stock_threshold: 5, free_shipping: 0, target_audience: 'all', short_description: '', allow_backorder: false };
  const sewing = { id: 5, name: 'MLSM-202 Sewing Machine', price: 1250, image: 'sew.jpg', stock: 16, low_stock_threshold: 5, free_shipping: 0, target_audience: 'all', short_description: '', allow_backorder: false };
  const productHtml = await renderFile(path.join(__dirname, '..', 'views', 'product.ejs'),
    { ...productBase, siteName: 'Goince', siteSettings: {}, shopPhone: '01814697896', paymentMethods: [], assetUrl: (p) => p, userName: null, userPhotoUrl: null, cartCount: 0, menuCategories: [], menuById: {}, search: '', miniCart: [], miniCartSubtotal: 0, csrfToken: 'tok123', siteLogoAbs: '', siteFaviconAbs: '', siteOgImageAbs: '', siteUrl: 'http://127.0.0.1', product: watch, alsoViewed: [sewing] });
  const avSection = productHtml.slice(productHtml.indexOf('Customers also viewed'));
  check('render product: "Customers also viewed" shows the co-viewed sewing machine with its price, and the section never links the current watch',
    productHtml.includes('Customers also viewed') && avSection.includes('MLSM-202 Sewing Machine')
    && avSection.includes('৳1250') && !avSection.includes('/product/3'));
  check('render product: empty alsoViewed hides the whole section (no heading at all)',
    !(await renderFile(path.join(__dirname, '..', 'views', 'product.ejs'),
      { ...productBase, siteName: 'Goince', siteSettings: {}, shopPhone: '01814697896', paymentMethods: [], assetUrl: (p) => p, userName: null, userPhotoUrl: null, cartCount: 0, menuCategories: [], menuById: {}, search: '', miniCart: [], miniCartSubtotal: 0, csrfToken: 'tok123', siteLogoAbs: '', siteFaviconAbs: '', siteOgImageAbs: '', siteUrl: 'http://127.0.0.1', product: watch, alsoViewed: [] }))
      .includes('Customers also viewed'));
  check('render product: OLD locals (no alsoViewed — as in earlier suites) still render without crashing',
    (await renderFile(path.join(__dirname, '..', 'views', 'product.ejs'),
      { ...productBase, siteName: 'Goince', siteSettings: {}, shopPhone: '01814697896', paymentMethods: [], assetUrl: (p) => p, userName: null, userPhotoUrl: null, cartCount: 0, menuCategories: [], menuById: {}, search: '', miniCart: [], miniCartSubtotal: 0, csrfToken: 'tok123', siteLogoAbs: '', siteFaviconAbs: '', siteOgImageAbs: '', siteUrl: 'http://127.0.0.1', product: watch }))
      .includes('BINBOND 2521 Watch'));

  // ---------- 4. Route E2E: the REAL homepage route on a stubbed DB ----------
  console.log('4. Route E2E (stubbed DB, real routes/shop.js)');
  const dbPath = require.resolve('../config/db');
  const CSRF_TOKEN = 'test-csrf-token';
  const testSession = { cart: [], csrfToken: CSRF_TOKEN };
  const day = (n) => new Date(2026, 10, 1 + n); // id N is "newer" than id N-1
  const stubProducts = [
    { id: 1, name: 'BINBOND 2521 Watch', brand: 'BINBOND', category_id: 8, price: 990, compare_at_price: 1990, stock: 15, image: 'watch.jpg', tags: 'watch, men, luxury', free_shipping: 0, created_at: day(1), status: null, scheduled_at: null },
    { id: 2, name: 'BINBOND 2522 Watch', brand: 'BINBOND', category_id: 8, price: 890, compare_at_price: null, stock: 10, image: 'watch2.jpg', tags: 'watch, men', free_shipping: 0, created_at: day(2), status: null, scheduled_at: null },
    { id: 3, name: 'BINBOND 2523 Watch', brand: 'BINBOND', category_id: 8, price: 790, compare_at_price: null, stock: 0, image: 'watch3.jpg', tags: 'watch, men', free_shipping: 0, created_at: day(3), status: null, scheduled_at: null },
    { id: 4, name: 'BINBOND Belt', brand: 'BINBOND', category_id: 12, price: 450, compare_at_price: 600, stock: 8, image: 'belt.jpg', tags: 'belt, men', free_shipping: 0, created_at: day(4), status: null, scheduled_at: null },
    { id: 5, name: 'BINBOND Wallet', brand: 'BINBOND', category_id: 12, price: 550, compare_at_price: null, stock: 20, image: 'wallet.jpg', tags: 'wallet, men', free_shipping: 0, created_at: day(5), status: null, scheduled_at: null },
    { id: 6, name: 'BINBOND Cap', brand: 'BINBOND', category_id: 12, price: 350, compare_at_price: null, stock: 0, image: 'cap.jpg', tags: 'cap, men', free_shipping: 0, created_at: day(6), status: null, scheduled_at: null },
    { id: 7, name: 'BINBOND Sunglasses', brand: 'BINBOND', category_id: 8, price: 650, compare_at_price: 900, stock: 5, image: 'sun.jpg', tags: 'sunglasses, men', free_shipping: 0, created_at: day(7), status: null, scheduled_at: null },
    { id: 8, name: 'BINBOND Tie', brand: 'BINBOND', category_id: 12, price: 250, compare_at_price: null, stock: 12, image: 'tie.jpg', tags: 'tie, men', free_shipping: 0, created_at: day(8), status: null, scheduled_at: null },
    { id: 9, name: 'BINBOND Socks', brand: 'BINBOND', category_id: 12, price: 150, compare_at_price: null, stock: 30, image: 'socks.jpg', tags: 'socks, men', free_shipping: 0, created_at: day(9), status: null, scheduled_at: null },
    { id: 10, name: 'BINBOND Keychain', brand: 'BINBOND', category_id: 8, price: 120, compare_at_price: null, stock: 40, image: 'key.jpg', tags: 'keychain', free_shipping: 0, created_at: day(10), status: null, scheduled_at: null },
    { id: 11, name: 'BINBOND Mug', brand: 'BINBOND', category_id: 8, price: 300, compare_at_price: 400, stock: 7, image: 'mug.jpg', tags: 'mug, home', free_shipping: 0, created_at: day(11), status: null, scheduled_at: null },
    { id: 12, name: 'BINBOND Notebook', brand: 'BINBOND', category_id: 12, price: 200, compare_at_price: null, stock: 9, image: 'note.jpg', tags: 'notebook', free_shipping: 0, created_at: day(12), status: null, scheduled_at: null },
    { id: 13, name: 'BINBOND Pen', brand: 'BINBOND', category_id: 8, price: 100, compare_at_price: null, stock: 25, image: 'pen.jpg', tags: 'pen', free_shipping: 0, created_at: day(13), status: null, scheduled_at: null },
    { id: 14, name: 'MLSM-202 Sewing Machine', brand: 'MLSM', category_id: 8, price: 1250, compare_at_price: 2200, stock: 16, image: 'sew.jpg', tags: 'sewing, machine, tailor', free_shipping: 0, created_at: day(14), status: null, scheduled_at: null },
    { id: 15, name: 'A.T.Z Two-Piece Tops', brand: 'A.T.Z', category_id: 12, price: 310, compare_at_price: null, stock: 10, image: 'dress.jpg', tags: 'dress, women', free_shipping: 0, created_at: day(15), status: null, scheduled_at: null },
  ];
  const stubRatings = {
    1: [5, 5, 4], 2: [5, 4], 3: [3], 4: [4, 4], 5: [5], 7: [4, 5, 5],
    8: [2], 9: [4], 11: [5, 5], 12: [3, 4], 13: [4], 14: [5, 5, 4], 15: [4],
  };
  const avgRating = (p) => { const r = stubRatings[p.id] || []; return r.length ? r.reduce((a, b) => a + b, 0) / r.length : 0; };
  const reviewCount = (p) => (stubRatings[p.id] || []).length;
  const catRows = [
    { id: 8, name: 'Home Appliances', parent_id: null, is_visible: 1, is_featured: 1, sort_order: 1, product_count: 8, image_url: '' },
    { id: 12, name: 'Winter Collection', parent_id: null, is_visible: 1, is_featured: 0, sort_order: 2, product_count: 7, image_url: '' },
  ];
  // The stub re-implements the listing's WHERE/HAVING/ORDER BY from
  // the SQL the route actually sends, consuming params in the SAME
  // order the route builds them (category, audience, price, brand,
  // search ids, rating) — so a filter the route forgot to apply, or
  // applied with the wrong param, shows up here as the wrong list.
  function applyListingFilters(sql, params) {
    if (/AND 1=0/.test(sql)) return [];
    let i = 0;
    let rows = [...stubProducts];
    const clauseCount = (re) => { const m = sql.match(re); return m ? (m[0].match(/\?/g) || []).length : 0; };
    const catN = clauseCount(/products\.category_id IN \([^)]*\)/);
    if (catN > 0) { const ids = params.slice(i, i + catN).map(Number); i += catN; rows = rows.filter((p) => ids.includes(p.category_id)); }
    const audN = clauseCount(/products\.target_audience IN \([^)]*\)/);
    if (audN > 0) i += audN; // stub products are all audience 'all'
    if (/products\.price >= \?/.test(sql)) { const v = params[i++]; rows = rows.filter((p) => p.price >= v); }
    if (/products\.price <= \?/.test(sql)) { const v = params[i++]; rows = rows.filter((p) => p.price <= v); }
    if (/products\.brand = \?/.test(sql)) { const v = params[i++]; rows = rows.filter((p) => p.brand === v); }
    const idN = clauseCount(/products\.id IN \([^)]*\)/);
    if (idN > 0) { const ids = params.slice(i, i + idN).map(Number); i += idN; rows = rows.filter((p) => ids.includes(p.id)); }
    if (/products\.stock > 0/.test(sql)) rows = rows.filter((p) => p.stock > 0);
    if (/products\.compare_at_price IS NOT NULL AND products\.compare_at_price > products\.price/.test(sql)) {
      rows = rows.filter((p) => p.compare_at_price !== null && p.compare_at_price !== undefined && p.compare_at_price > p.price);
    }
    if (/HAVING COALESCE\(AVG\(reviews\.rating\), 0\) >= \?/.test(sql)) { const v = params[i++]; rows = rows.filter((p) => avgRating(p) >= v); }
    if (/ORDER BY products\.price ASC/.test(sql)) rows.sort((a, b) => a.price - b.price);
    else if (/ORDER BY products\.price DESC/.test(sql)) rows.sort((a, b) => b.price - a.price);
    else if (/ORDER BY review_count DESC/.test(sql)) rows.sort((a, b) => (reviewCount(b) - reviewCount(a)) || (b.created_at - a.created_at));
    else rows.sort((a, b) => b.created_at - a.created_at);
    return rows;
  }
  let coViewRows = [];
  const historyInserts = [];
  const dbStub = {
    query: async (sql, params = []) => {
      if (/FROM categories/.test(sql)) return [catRows];
      if (/SELECT DISTINCT brand FROM products/.test(sql)) {
        return [[...new Set(stubProducts.map((p) => p.brand).filter(Boolean))].sort().map((b) => ({ brand: b }))];
      }
      if (/SELECT id FROM products WHERE/.test(sql)) {
        const term = String(params[0] || '').replace(/%/g, '').toLowerCase();
        return [stubProducts.filter((p) => (`${p.name} ${p.tags} ${p.brand}`).toLowerCase().includes(term)).map((p) => ({ id: p.id }))];
      }
      if (/SELECT id, name, tags, brand FROM products/.test(sql)) {
        return [stubProducts.map((p) => ({ id: p.id, name: p.name, tags: p.tags, brand: p.brand }))];
      }
      if (/SELECT COUNT\(\*\) AS total FROM \(SELECT products\.id/.test(sql)) {
        return [[{ total: applyListingFilters(sql, params).length }]];
      }
      if (/COUNT\(reviews\.id\) AS review_count/.test(sql)) {
        const rows = applyListingFilters(sql, params);
        const limit = params[params.length - 2];
        const offset = params[params.length - 1];
        return [rows.slice(offset, offset + limit).map((p) => ({
          ...p, review_count: reviewCount(p), avg_rating: reviewCount(p) ? avgRating(p) : null,
        }))];
      }
      if (/SELECT DISTINCT product_id FROM product_variants/.test(sql)) return [[]];
      if (/SELECT DISTINCT product_id FROM product_options/.test(sql)) return [[]];
      if (/SELECT id, stock, free_shipping FROM products/.test(sql)) {
        return [stubProducts.map((p) => ({ id: p.id, stock: p.stock, free_shipping: p.free_shipping }))];
      }
      if (/COALESCE\(SUM\(order_items\.quantity\), 0\) AS sold/.test(sql)) return [[]]; // best sellers: none in the stub
      if (/setting_key = 'hero_product_id'/.test(sql)) return [[]];
      if (/setting_key IN \('delivery_charge_inside'/.test(sql)) return [[]];
      if (/FROM banners/.test(sql)) return [[]];
      if (/FROM product_images/.test(sql)) return [[]];
      // ---- product page ----
      if (/FROM products WHERE id = \? OR slug = \?/.test(sql)) {
        const p = stubProducts.find((x) => x.id === Number(params[0]));
        return [p ? [p] : []];
      }
      if (/AVG\(rating\) AS avgRating/.test(sql)) return [[{ avgRating: null, reviewCount: 0 }]];
      if (/FROM product_options WHERE product_id/.test(sql)) return [[]];
      if (/FROM product_variants WHERE product_id/.test(sql)) return [[]];
      if (/FROM related_products rp/.test(sql)) return [[]];
      if (/FROM products WHERE category_id = \? AND id != \?/.test(sql)) return [[]];
      if (/FROM product_videos/.test(sql)) return [[]];
      if (/FROM order_items WHERE product_id/.test(sql)) return [[{ sold: 0 }]];
      if (/FROM product_questions/.test(sql)) return [[]];
      if (/INSERT INTO product_view_history/.test(sql)) { historyInserts.push(params); return [{}]; }
      if (/INSERT INTO product_views/.test(sql)) return [{}];
      if (/DELETE FROM product_views/.test(sql)) return [{}];
      if (/COUNT\(DISTINCT session_key\) AS c/.test(sql)) return [[{ c: 0 }]];
      if (/FROM orders o JOIN order_items/.test(sql)) return [[]];
      if (/FROM product_view_history pv2/.test(sql)) return [coViewRows];
      return [[]];
    },
  };
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: dbStub };
  const { csrfProtection } = require('../lib/csrf');
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = testSession;
    res.locals.userName = null; res.locals.userPhotoUrl = null; res.locals.cartCount = 0;
    res.locals.siteSettings = { hero_title: 'Shop', hero_subtitle: 'Sub', announcement_text: '', logo_url: '', facebook_url: '' };
    res.locals.shopPhone = '+8801814697896'; res.locals.paymentMethods = [];
    res.locals.assetUrl = (p) => p; res.locals.menuCategories = []; res.locals.menuById = {};
    res.locals.miniCart = testSession.cart || []; res.locals.miniCartSubtotal = 0;
    res.locals.miniCartDeliveryInside = 60; res.locals.miniCartDeliveryOutside = 120;
    res.locals.csrfToken = CSRF_TOKEN; res.locals.siteUrl = 'http://127.0.0.1';
    res.locals.siteLogoAbs = ''; res.locals.siteFaviconAbs = ''; res.locals.siteOgImageAbs = '';
    res.locals.theme = 'light';
    next();
  });
  app.use(csrfProtection);
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.use('/', require('../routes/shop'));
  function reqRaw(port, method, pathUrl, ajax) {
    return new Promise((resolve, reject) => {
      const headers = {};
      if (ajax) { headers['X-Requested-With'] = 'XMLHttpRequest'; headers.Accept = 'application/json'; }
      const req = http.request({ method, host: '127.0.0.1', port, path: pathUrl, headers }, (res) => {
        const parts = [];
        res.on('data', (c) => parts.push(c));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(parts).toString('utf8') }));
      });
      req.on('error', reject);
      req.end();
    });
  }
  // Card names come from the grid slice only — the footer also has
  // <h3> headings (site name, Quick Links, Policies), which must
  // not be counted as products. XHR html IS the grid slice already.
  const namesOf = (html) => {
    const start = html.indexOf('<!-- grid-items-start -->');
    const end = html.indexOf('<!-- grid-items-end -->');
    const slice = (start >= 0 && end > start) ? html.slice(start, end) : html;
    return [...slice.matchAll(/<h3>([^<]+)<\/h3>/g)].map((m) => m[1]);
  };
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.on('listening', r));
  const port = server.address().port;
  try {
    // --- 4a/4b/4c. Pagination: page 1 = newest 12, page 2 = the rest, no duplicates, bad/huge pages clamp.
    const p1 = await reqRaw(port, 'GET', '/', false);
    const p1Names = namesOf(p1.body);
    check('e2e pagination: page 1 shows the 12 newest of 15 and offers Load more to ?page=2',
      p1.status === 200 && p1Names.length === 12 && p1Names[0] === 'A.T.Z Two-Piece Tops'
      && p1Names[11] === 'BINBOND Belt' && !p1Names.includes('BINBOND 2521 Watch')
      && p1.body.includes('id="load-more-btn" data-next-url="/?page=2"'));
    const p2 = await reqRaw(port, 'GET', '/?page=2', false);
    const p2Names = namesOf(p2.body);
    check('e2e pagination: page 2 shows only the remaining 3, no duplicates with page 1, no Load more button',
      p2.status === 200 && JSON.stringify(p2Names) === JSON.stringify(['BINBOND 2523 Watch', 'BINBOND 2522 Watch', 'BINBOND 2521 Watch'])
      && p1Names.every((n) => !p2Names.includes(n)) && !p2.body.includes('id="load-more-btn"'));
    const pBad = await reqRaw(port, 'GET', '/?page=abc', false);
    const pHuge = await reqRaw(port, 'GET', '/?page=99', false);
    check('e2e pagination: ?page=abc falls back to page 1, ?page=99 clamps to the last page (2)',
      JSON.stringify(namesOf(pBad.body)) === JSON.stringify(p1Names)
      && JSON.stringify(namesOf(pHuge.body)) === JSON.stringify(p2Names));
    // --- 4d. XHR Load More: JSON with the next page's cards only.
    const x1 = await reqRaw(port, 'GET', '/', true);
    const x1Json = JSON.parse(x1.body);
    const x2 = await reqRaw(port, 'GET', '/?page=2', true);
    const x2Json = JSON.parse(x2.body);
    check('e2e load-more XHR: page 1 JSON { ok, hasMore true, nextPageUrl ?page=2, html holds page-1 cards }; page 2 JSON { hasMore false, total 15 }',
      x1Json.ok === true && x1Json.hasMore === true && x1Json.nextPageUrl === '/?page=2'
      && x1Json.total === 15 && x1Json.totalPages === 2 && namesOf(x1Json.html).length === 12
      && x2Json.ok === true && x2Json.hasMore === false && x2Json.page === 2
      && JSON.stringify(namesOf(x2Json.html)) === JSON.stringify(p2Names));
    // --- 4e–4i. Each facet filters the rendered list.
    const brand = await reqRaw(port, 'GET', '/?brand=BINBOND', false);
    check('e2e filter brand=BINBOND: 12 BINBOND cards on page 1, every one BINBOND, Load more offered (13 total, & escaped as &amp; by EJS)',
      namesOf(brand.body).length === 12 && namesOf(brand.body).every((n) => n.startsWith('BINBOND'))
      && brand.body.includes('data-next-url="/?page=2&amp;brand=BINBOND"'));
    const rating = await reqRaw(port, 'GET', '/?rating=4', false);
    const ratingNames = namesOf(rating.body);
    check('e2e filter rating=4: only 4★-and-up products (10) — no 3★ watch, no unrated cap, no 2★ tie',
      ratingNames.length === 10 && !ratingNames.includes('BINBOND 2523 Watch')
      && !ratingNames.includes('BINBOND Cap') && !ratingNames.includes('BINBOND Tie')
      && ratingNames.includes('MLSM-202 Sewing Machine'));
    const stock = await reqRaw(port, 'GET', '/?in_stock=1', false);
    check('e2e filter in_stock=1: the two out-of-stock products are gone (13 left)',
      namesOf(stock.body).length === 12 && !namesOf(stock.body).includes('BINBOND 2523 Watch')
      && !namesOf(stock.body).includes('BINBOND Cap'));
    const discRes = await reqRaw(port, 'GET', '/?discount=1', false);
    check('e2e filter discount=1: exactly the 5 discounted products, newest first',
      JSON.stringify(namesOf(discRes.body)) === JSON.stringify(['MLSM-202 Sewing Machine', 'BINBOND Mug', 'BINBOND Sunglasses', 'BINBOND Belt', 'BINBOND 2521 Watch']));
    const cat8 = await reqRaw(port, 'GET', '/?category=8', false);
    check('e2e filter category=8: exactly the 8 Home Appliances products',
      JSON.stringify(namesOf(cat8.body)) === JSON.stringify(['MLSM-202 Sewing Machine', 'BINBOND Pen', 'BINBOND Mug', 'BINBOND Keychain', 'BINBOND Sunglasses', 'BINBOND 2523 Watch', 'BINBOND 2522 Watch', 'BINBOND 2521 Watch']));
    const cat12 = await reqRaw(port, 'GET', '/?category=12', false);
    check('e2e filter category=12: exactly the 7 Winter Collection products',
      namesOf(cat12.body).length === 7 && namesOf(cat12.body).includes('A.T.Z Two-Piece Tops')
      && !namesOf(cat12.body).includes('MLSM-202 Sewing Machine'));
    // --- 4j–4o. Facets compose with each other, search, sort, category, pagination.
    const brandRating = await reqRaw(port, 'GET', '/?brand=BINBOND&rating=4', false);
    check('e2e compose brand+rating: 8 BINBOND products at 4★+ (rating filter does not resurrect other brands)',
      namesOf(brandRating.body).length === 8 && namesOf(brandRating.body).every((n) => n.startsWith('BINBOND')));
    const searchStock = await reqRaw(port, 'GET', '/?search=sewing&in_stock=1', false);
    check('e2e compose search+in-stock: "sewing" + in stock finds only the sewing machine',
      JSON.stringify(namesOf(searchStock.body)) === JSON.stringify(['MLSM-202 Sewing Machine']));
    const searchBrand = await reqRaw(port, 'GET', '/?search=sewing&brand=BINBOND', false);
    check('e2e compose search+brand: "sewing" inside BINBOND finds nothing (the machine is MLSM)',
      namesOf(searchBrand.body).length === 0 && searchBrand.body.includes('No products found.'));
    const priceLow = await reqRaw(port, 'GET', '/?sort=price_low', false);
    const priceHigh = await reqRaw(port, 'GET', '/?sort=price_high', false);
    check('e2e compose sort: price_low starts with the ৳100 pen, price_high with the ৳1250 sewing machine',
      namesOf(priceLow.body)[0] === 'BINBOND Pen' && namesOf(priceHigh.body)[0] === 'MLSM-202 Sewing Machine');
    const brandPage2 = await reqRaw(port, 'GET', '/?brand=BINBOND&page=2', false);
    check('e2e compose filters+pagination: brand=BINBOND page 2 holds only the 13th BINBOND (the 2521 watch)',
      JSON.stringify(namesOf(brandPage2.body)) === JSON.stringify(['BINBOND 2521 Watch']));
    const stockPage2 = await reqRaw(port, 'GET', '/?in_stock=1&page=2', false);
    check('e2e compose filters+pagination: in_stock=1 page 2 holds only the last in-stock product, still no out-of-stock card',
      JSON.stringify(namesOf(stockPage2.body)) === JSON.stringify(['BINBOND 2521 Watch']));
    const ratingPage2 = await reqRaw(port, 'GET', '/?rating=4&page=2', false);
    check('e2e compose filters+pagination: rating=4 has only 10 products, so ?page=2 clamps back to page 1 (same 10 names)',
      JSON.stringify(namesOf(ratingPage2.body)) === JSON.stringify(ratingNames));
    // --- C2 E2E: typo search, exact search, no-match search.
    const typo = await reqRaw(port, 'GET', '/?search=sweing', false);
    check('e2e typo search: "sweing" finds the MLSM-202 Sewing Machine, shows "Did you mean: sewing?" (link re-runs it) + the no-exact-match note',
      typo.status === 200 && JSON.stringify(namesOf(typo.body)) === JSON.stringify(['MLSM-202 Sewing Machine'])
      && typo.body.includes('Did you mean: <a href="/?search=sewing">sewing</a>?')
      && typo.body.includes('No exact matches for “sweing”'));
    const typo2 = await reqRaw(port, 'GET', '/?search=wach', false);
    check('e2e typo search: "wach" finds the three watches and suggests "watch"',
      namesOf(typo2.body).length === 3 && namesOf(typo2.body).every((n) => n.includes('Watch'))
      && typo2.body.includes('Did you mean: <a href="/?search=watch">watch</a>?'));
    const exact = await reqRaw(port, 'GET', '/?search=sewing', false);
    check('e2e exact search unchanged: "sewing" finds the machine with NO did-you-mean line and NO no-exact-match note',
      JSON.stringify(namesOf(exact.body)) === JSON.stringify(['MLSM-202 Sewing Machine'])
      && !exact.body.includes('Did you mean:') && !exact.body.includes('No exact matches'));
    const nomatch = await reqRaw(port, 'GET', '/?search=zzzqqq', false);
    check('e2e no-match search: "zzzqqq" finds nothing, shows "No products found.", and suggests nothing (no invented correction)',
      namesOf(nomatch.body).length === 0 && nomatch.body.includes('No products found.')
      && !nomatch.body.includes('Did you mean:'));

    // ---------- 5. Route E2E: "Customers also viewed" on the product page ----------
    console.log('5. Route E2E (product page, also viewed)');
    coViewRows = [
      { ...stubProducts.find((p) => p.id === 14), coview_count: 4 },
      { ...stubProducts.find((p) => p.id === 1), coview_count: 2 },
    ];
    historyInserts.length = 0;
    const prod = await reqRaw(port, 'GET', '/product/3', false);
    const avStart = prod.body.indexOf('Customers also viewed');
    const avSection = avStart >= 0 ? prod.body.slice(avStart, prod.body.indexOf('<script>', avStart)) : '';
    check('e2e also viewed: /product/3 shows the section with the real co-viewed products (sewing machine + 2521 watch), never the current 2523 watch',
      prod.status === 200 && avStart >= 0 && avSection.includes('MLSM-202 Sewing Machine')
      && avSection.includes('BINBOND 2521 Watch') && !avSection.includes('/product/3'));
    check('e2e also viewed: viewing the product records a persistent history row (product_id 3) for future co-viewed results',
      historyInserts.length === 1 && Number(historyInserts[0][0]) === 3);
    coViewRows = [];
    const prodEmpty = await reqRaw(port, 'GET', '/product/3', false);
    check('e2e also viewed: with no co-viewed products the section is hidden entirely',
      prodEmpty.status === 200 && !prodEmpty.body.includes('Customers also viewed'));
  } finally {
    server.close();
    delete require.cache[dbPath];
    delete require.cache[require.resolve('../routes/shop')];
  }

  // ---------- 6. The REAL load-more script in a stubbed DOM ----------
  console.log('6. load-more.js in a stubbed DOM (vm sandbox)');
  const makeButton = () => {
    const attrs = { 'data-next-url': '/?page=2', href: '/?page=2' };
    const cls = new Set();
    return {
      textContent: 'Load more',
      classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c) },
      getAttribute: (k) => (k in attrs ? attrs[k] : null),
      setAttribute: (k, v) => { attrs[k] = v; },
      addEventListener: function (type, fn) { this._handler = fn; },
      parentNode: { removed: null, removeChild(el) { this.removed = el; } },
      click() { if (this._handler) this._handler({ preventDefault() {} }); },
      _attrs: attrs, _cls: cls,
    };
  };
  const grid = { appended: [], insertAdjacentHTML(pos, html) { this.appended.push([pos, html]); } };
  const wrap = { querySelector: () => grid };
  const button = makeButton();
  const fetchCalls = [];
  const replacedUrls = [];
  let fetchResponse = { ok: true, html: '<div class="product-card">CARD-13</div>', hasMore: true, nextPageUrl: '/?page=3' };
  let fetchShouldFail = false;
  const sandbox = {
    console,
    document: {
      readyState: 'complete',
      getElementById: (id) => (id === 'load-more-btn' ? button : id === 'product-grid-wrap' ? wrap : null),
      addEventListener: () => {},
    },
    window: { history: { replaceState: (a, b, url) => { replacedUrls.push(url); } } },
    fetch: async (url, opts) => {
      fetchCalls.push([url, opts]);
      if (fetchShouldFail) throw new Error('network down');
      return { json: async () => fetchResponse };
    },
  };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(loadMoreJs, sandbox);
  check('load-more DOM: script binds a click handler to #load-more-btn on load and exposes window.goinceLoadMore',
    typeof button._handler === 'function' && typeof sandbox.window.goinceLoadMore.loadNextPage === 'function');
  const okNext = await sandbox.window.goinceLoadMore.loadNextPage(button);
  check('load-more DOM: next page fetched with X-Requested-With, cards appended to the grid, button re-pointed to ?page=3, address bar follows',
    okNext === true && fetchCalls.length === 1 && fetchCalls[0][0] === '/?page=2'
    && fetchCalls[0][1].headers['X-Requested-With'] === 'XMLHttpRequest'
    && grid.appended.length === 1 && grid.appended[0][0] === 'beforeend' && grid.appended[0][1].includes('CARD-13')
    && button._attrs['data-next-url'] === '/?page=3' && button._attrs.href === '/?page=3'
    && button.textContent === 'Load more' && replacedUrls[0] === '/?page=3');
  fetchResponse = { ok: true, html: '<div class="product-card">CARD-15</div>', hasMore: false, nextPageUrl: '/?page=4' };
  const okLast = await sandbox.window.goinceLoadMore.loadNextPage(button);
  check('load-more DOM: last page appends its cards and then removes the button (no dead "Load more")',
    okLast === true && grid.appended.length === 2 && grid.appended[1][1].includes('CARD-15')
    && button.parentNode.removed === button);
  const button2 = makeButton();
  sandbox.document.getElementById = (id) => (id === 'load-more-btn' ? button2 : id === 'product-grid-wrap' ? wrap : null);
  sandbox.window.goinceLoadMore.bind();
  fetchShouldFail = true;
  fetchResponse = { ok: true, html: '', hasMore: true, nextPageUrl: '/?page=3' };
  button2.click();
  await new Promise((r) => setTimeout(r, 20));
  check('load-more DOM: click goes through the bound handler; a failed fetch leaves the button as a plain ?page= link (no blank page, no crash)',
    fetchCalls.length === 3 && button2.textContent === 'Load more' && !button2._cls.has('is-loading')
    && button2.parentNode.removed === null && button2._attrs.href === '/?page=2');

  // ---------- Summary ----------
  console.log(`\n${passes.length} passed, ${failures.length} failed.`);
  if (failures.length) {
    console.log('Failed checks:');
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exit(1);
  } else {
    console.log('All discovery & search checks passed.');
  }
})().catch((err) => {
  console.error('Test crashed:', err);
  process.exit(1);
});
