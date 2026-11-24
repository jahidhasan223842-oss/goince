// Full-width desktop + hero copy + shop cleanup (fix/full-width-hero-cleanup)
// — stubbed-DB smoke test.
//
// No live MySQL needed: config/db is stubbed in the require cache, the real
// server.js + routers + EJS render over real HTTP on a throwaway port.
// Checks:
//   1. Startup content fixes (lib/startup-content-fixes.js) against a fake
//      in-memory DB: 'Hi' / Banglish subtitle -> new Bangla copy, custom
//      titles untouched, second run is a no-op; product-name typo fixed
//      only for the exact old name.
//   2. Empty-category filtering (lib/categories.js buildMenuTree) with
//      live-like rows: Seasonal Products + all its 0-product children gone,
//      Home Decor (0) gone, top-level Winter Collection (1) stays, a parent
//      whose child has products (Home Appliances, total 3) stays, hidden
//      categories still pruned.
//   3. HTTP: homepage + product page render 200; homepage shows the new
//      Bangla hero title/subtitle (defaults, stub returns no stored
//      settings) and no <h1>Hi</h1>; menu/pills show only non-empty
//      categories; hero caption + price-filter placeholders/aria-labels
//      present; served CSS has the desktop full-width container, the hero
//      caption wrap fix, and the WhatsApp scroll-hide at <=1024px; mobile
//      (<=768px) container padding unchanged; CSS braces balanced.
//   4. Direct EJS render of index.ejs (homepage + header + footer) with a
//      hero product: caption, pills and price filter render.
//
// Run:  node scripts/test-full-width-hero-cleanup.js
// Exit code 0 = all checks passed.
'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');
const util = require('util');
const ejs = require('ejs');
const bcrypt = require('bcryptjs');

const PORT = process.env.TEST_PORT || '3458';
process.env.PORT = PORT;
process.env.SESSION_SECRET = 'test-secret-for-full-width-hero-cleanup';

// ---------- checks ----------
const failures = [];
const passes = [];
function check(name, ok, detail) {
  if (ok) { passes.push(name); console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}
function has(html, needle) { return html.includes(needle); }

// ---------- 1. Startup content fixes (fake in-memory DB) ----------
const fixes = require('../lib/startup-content-fixes');

function makeFakeDb(settings, products) {
  return {
    calls: [],
    async query(sql, params) {
      this.calls.push([String(sql), params || []]);
      const s = String(sql);
      if (s.startsWith('UPDATE settings SET setting_value')) {
        const [newVal, key, oldVal] = params;
        let affected = 0;
        if (settings.get(key) === oldVal) { settings.set(key, newVal); affected = 1; }
        return [{ affectedRows: affected }];
      }
      if (s.startsWith('UPDATE products SET name')) {
        const [newName, oldName] = params;
        let affected = 0;
        products.forEach((p) => { if (p.name === oldName) { p.name = newName; affected++; } });
        return [{ affectedRows: affected }];
      }
      return [[]];
    },
  };
}

async function testContentFixes() {
  console.log('Startup content fixes (fake DB)');
  const settings = new Map([
    ['hero_title', 'Hi'],
    ['hero_subtitle', 'Dhaka-r vitore 1–2 din, Dhaka-r baire 3–5 dine delivery. Order korar age phone-e confirm kora hoy.'],
  ]);
  const products = [
    { id: 7, name: 'A.T.Z New collection Hit wastren dress tow piece Tops For Women' },
    { id: 3, name: 'BINBOND 2521 Men’s Luxury Quartz Watch' },
  ];
  const db = makeFakeDb(settings, products);
  await fixes.fixHeroCopy(db);
  await fixes.fixProductName(db);
  check('hero title Hi -> new Bangla title', settings.get('hero_title') === fixes.HERO_TITLE_NEW, settings.get('hero_title'));
  check('hero subtitle Banglish -> new Bangla subtitle', settings.get('hero_subtitle') === fixes.HERO_SUBTITLE_NEW, settings.get('hero_subtitle'));
  check('product typo name fixed', products[0].name === fixes.PRODUCT_NEW_NAME, products[0].name);
  check('other product name untouched', products[1].name === 'BINBOND 2521 Men’s Luxury Quartz Watch');
  check('fixes use parameterised queries (no text in SQL)', db.calls.every(([sql]) => sql.includes('?')) && db.calls.length === 3, db.calls.length + ' calls');

  // Second run: already-fixed values must not match again (no-op).
  const callsBefore = db.calls.length;
  await fixes.fixHeroCopy(db);
  await fixes.fixProductName(db);
  check('second run is a no-op (values already new)', settings.get('hero_title') === fixes.HERO_TITLE_NEW && products[0].name === fixes.PRODUCT_NEW_NAME && db.calls.length === callsBefore + 3);

  // Custom title/subtitle set by the admin must never be touched.
  const customSettings = new Map([
    ['hero_title', 'Eid Offer — sob kichu 50% off'],
    ['hero_subtitle', 'Amar nijer lekha subtitle'],
  ]);
  const customDb = makeFakeDb(customSettings, [{ id: 9, name: 'Onno Product' }]);
  await fixes.fixHeroCopy(customDb);
  await fixes.fixProductName(customDb);
  check('custom hero title left untouched', customSettings.get('hero_title') === 'Eid Offer — sob kichu 50% off');
  check('custom hero subtitle left untouched', customSettings.get('hero_subtitle') === 'Amar nijer lekha subtitle');
  check('unrelated product name left untouched', customDb.calls.length === 3);
  check('new hero title fits settings VARCHAR(255)', Buffer.byteLength(fixes.HERO_TITLE_NEW, 'utf8') <= 255 && Buffer.byteLength(fixes.HERO_SUBTITLE_NEW, 'utf8') <= 255);
}

// ---------- 2. Empty-category filtering (lib) ----------
function testMenuTree() {
  console.log('Empty-category filtering (buildMenuTree)');
  const { buildMenuTree } = require('../lib/categories');
  const rows = [
    { id: 8, name: 'Home Appliances', parent_id: null, is_visible: 1, is_featured: 0, sort_order: 1, product_count: 0 },
    { id: 9, name: 'Home Decor', parent_id: 8, is_visible: 1, is_featured: 0, sort_order: 1, product_count: 0 },
    { id: 10, name: 'Kitchen', parent_id: 8, is_visible: 1, is_featured: 0, sort_order: 2, product_count: 1 },
    { id: 11, name: 'Home Utility', parent_id: 8, is_visible: 1, is_featured: 0, sort_order: 3, product_count: 2 },
    { id: 12, name: 'Winter Collection', parent_id: null, is_visible: 1, is_featured: 0, sort_order: 2, product_count: 1 },
    { id: 13, name: 'Seasonal Products', parent_id: null, is_visible: 1, is_featured: 0, sort_order: 3, product_count: 0 },
    { id: 14, name: 'Summer Collection', parent_id: 13, is_visible: 1, is_featured: 0, sort_order: 1, product_count: 0 },
    { id: 15, name: 'Winter Collection', parent_id: 13, is_visible: 1, is_featured: 0, sort_order: 2, product_count: 0 },
    { id: 16, name: 'Rainy Season Collection', parent_id: 13, is_visible: 1, is_featured: 0, sort_order: 3, product_count: 0 },
    { id: 17, name: 'Hidden Sale', parent_id: null, is_visible: 0, is_featured: 0, sort_order: 4, product_count: 5 },
  ];
  const menu = buildMenuTree(rows);
  const names = menu.map((c) => c.name);
  const collect = (list) => list.flatMap((c) => [c, ...collect(c.children || [])]);
  const all = collect(menu);
  check('menu keeps Home Appliances (child has products)', names.includes('Home Appliances'));
  check('menu keeps top-level Winter Collection (1 product)', names.includes('Winter Collection') && menu.find((c) => c.name === 'Winter Collection').totalProductCount === 1);
  check('menu drops Seasonal Products (0 incl. descendants)', !names.includes('Seasonal Products'));
  check('menu drops Home Decor (0 products)', !all.some((c) => c.name === 'Home Decor'));
  check('no duplicate Winter Collection under seasonal', all.filter((c) => c.name === 'Winter Collection').length === 1);
  check('menu drops all empty seasonal children', !all.some((c) => ['Summer Collection', 'Rainy Season Collection'].includes(c.name)));
  check('hidden category still pruned even with products', !all.some((c) => c.name === 'Hidden Sale'));
  check('Home Appliances total counts descendants (3)', menu.find((c) => c.name === 'Home Appliances').totalProductCount === 3);
  check('Home Appliances keeps only non-empty children', menu.find((c) => c.name === 'Home Appliances').children.map((c) => c.name).join(',') === 'Kitchen,Home Utility');
  check('descendantIds exclude pruned nodes', !menu.find((c) => c.name === 'Home Appliances').descendantIds.includes(9));
}

// ---------- 3+4. Stubbed-DB HTTP server + direct EJS render ----------
const ADMIN_EMAIL = 'admin@goince.com';
const ADMIN_PASSWORD = 'admin123';
const adminHash = bcrypt.hashSync(ADMIN_PASSWORD, 8);

const productRow = {
  id: 1,
  name: 'Test Watch',
  slug: 'test-watch',
  price: 990,
  compare_at_price: 1200,
  cost_price: 500,
  image: 'no-image.png',
  stock: 10,
  category_id: null,
  status: 'published',
  scheduled_at: null,
  description: 'A test product.',
  short_description: 'Test product.',
  specifications: 'Color: Black\nSize: Medium',
  brand: 'TestBrand',
  tags: 'watch',
  target_audience: 'all',
  allow_backorder: 0,
  free_shipping: 0,
  cod_allowed: 1,
  delivery_time: '',
  meta_title: '',
  meta_description: '',
  review_count: 2,
  avg_rating: 4.5,
  sold: 3,
  created_at: new Date(),
};

// Live-like category rows (same shape as the lib test above).
const catRows = [
  { id: 8, name: 'Home Appliances', parent_id: null, is_visible: 1, is_featured: 0, sort_order: 1, slug: 'home-appliances', image_url: '', description: '', banner_url: '', meta_title: '', meta_description: '', product_count: 0 },
  { id: 9, name: 'Home Decor', parent_id: 8, is_visible: 1, is_featured: 0, sort_order: 1, slug: 'home-decor', image_url: '', description: '', banner_url: '', meta_title: '', meta_description: '', product_count: 0 },
  { id: 10, name: 'Kitchen', parent_id: 8, is_visible: 1, is_featured: 0, sort_order: 2, slug: 'kitchen', image_url: '', description: '', banner_url: '', meta_title: '', meta_description: '', product_count: 1 },
  { id: 11, name: 'Home Utility', parent_id: 8, is_visible: 1, is_featured: 0, sort_order: 3, slug: 'home-utility', image_url: '', description: '', banner_url: '', meta_title: '', meta_description: '', product_count: 2 },
  { id: 12, name: 'Winter Collection', parent_id: null, is_visible: 1, is_featured: 0, sort_order: 2, slug: 'winter-collection', image_url: '', description: '', banner_url: '', meta_title: '', meta_description: '', product_count: 1 },
  { id: 13, name: 'Seasonal Products', parent_id: null, is_visible: 1, is_featured: 0, sort_order: 3, slug: 'seasonal-products', image_url: '', description: '', banner_url: '', meta_title: '', meta_description: '', product_count: 0 },
  { id: 14, name: 'Summer Collection', parent_id: 13, is_visible: 1, is_featured: 0, sort_order: 1, slug: 'summer-collection', image_url: '', description: '', banner_url: '', meta_title: '', meta_description: '', product_count: 0 },
  { id: 15, name: 'Winter Collection', parent_id: 13, is_visible: 1, is_featured: 0, sort_order: 2, slug: 'winter-collection-2', image_url: '', description: '', banner_url: '', meta_title: '', meta_description: '', product_count: 0 },
  { id: 16, name: 'Rainy Season Collection', parent_id: 13, is_visible: 1, is_featured: 0, sort_order: 3, slug: 'rainy-season-collection', image_url: '', description: '', banner_url: '', meta_title: '', meta_description: '', product_count: 0 },
];

function rowsFor(sql) {
  const s = String(sql).replace(/\s+/g, ' ');
  // --- global middleware (server.js) ---
  if (s.includes("setting_key = 'shop_phone'")) return [{ setting_value: '' }];
  if (s.includes('FROM settings WHERE setting_key IN')) return [];
  // Menu (middleware) + homepage categories: per-category product counts.
  if (s.includes('COUNT(products.id) AS product_count')) return catRows;
  // --- homepage ---
  if (s.includes('FROM products LEFT JOIN order_items')) return [productRow]; // best sellers (+ hero product)
  if (s.includes('LEFT JOIN reviews') && s.includes('FROM products')) return [productRow];
  if (s.includes('SELECT DISTINCT product_id FROM product_variants')) return [];
  if (s.includes('SELECT DISTINCT product_id FROM product_options')) return [];
  if (s.includes("setting_key = 'hero_product_id'")) return [];
  if (s.includes('FROM banners WHERE is_active = 1')) return [];
  // --- product page ---
  if (s.includes('FROM products WHERE id = ? OR slug = ?')) return [productRow];
  if (s.includes('FROM reviews') && s.includes('JOIN users')) return [];
  if (s.includes('AVG(rating) AS avgRating')) return [{ avgRating: null, reviewCount: 0 }];
  if (s.includes('FROM product_images WHERE product_id')) return [];
  if (s.includes('FROM product_options WHERE product_id')) return [];
  if (s.includes('FROM product_variants WHERE product_id')) return [];
  if (s.includes('FROM related_products rp JOIN products')) return [];
  // --- admin login (not used here, kept for server boot) ---
  if (s.includes('FROM admins WHERE email = ?')) {
    return [{ id: 1, email: ADMIN_EMAIL, password: adminHash, role: 'owner' }];
  }
  // --- startup content fixes: stubbed DB has no matching rows ---
  if (s.startsWith('UPDATE settings SET setting_value') || s.startsWith('UPDATE products SET name')) return [{ affectedRows: 0 }];
  // --- anything else: empty result (safe default) ---
  return [];
}

const stubDb = {
  query: async (sql) => [rowsFor(sql)],
  execute: async (sql) => [rowsFor(sql)],
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (typeof request === 'string' && /(^|\/)config\/db$/.test(request.replace(/\\/g, '/'))) {
    return stubDb;
  }
  return originalLoad.apply(this, arguments);
};

// The real server (listens on PORT as a side effect of being required).
require('../server.js');

const jar = {};
function storeCookies(res) {
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of setCookie) {
    const [pair] = c.split(';');
    const idx = pair.indexOf('=');
    if (idx > 0) jar[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  }
}
function cookieHeader() {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
}
async function get(path) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    headers: cookieHeader() ? { Cookie: cookieHeader() } : {},
    redirect: 'manual',
  });
  storeCookies(res);
  return { status: res.status, headers: res.headers, text: await res.text() };
}

async function waitForServer(tries = 50) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/`, { redirect: 'manual' });
      await res.text();
      return true;
    } catch (e) { await new Promise((r) => setTimeout(r, 200)); }
  }
  return false;
}

(async () => {
  await testContentFixes();
  testMenuTree();

  console.log('HTTP (stubbed DB, real server)');
  if (!(await waitForServer())) {
    console.log('FAIL  server did not start');
    process.exit(1);
  }

  const home = await get('/');
  check('homepage renders 200', home.status === 200, 'got ' + home.status);
  check('homepage shows new Bangla hero title', has(home.text, 'সেরা পণ্য, ক্যাশ অন ডেলিভারি'));
  check('homepage shows new Bangla hero subtitle', has(home.text, 'ঢাকার ভিতরে ১–২ দিনে, ঢাকার বাইরে ৩–৫ দিনে ডেলিভারি'));
  check('homepage has no <h1>Hi</h1> any more', !has(home.text, '<h1>Hi</h1>'));
  check('homepage shows test product', has(home.text, 'Test Watch'));
  check('hero caption shows product name + price', has(home.text, 'Test Watch — ৳990'));
  check('menu/pills keep Home Appliances', has(home.text, 'Home Appliances'));
  check('menu/pills keep Winter Collection', has(home.text, 'Winter Collection'));
  check('menu/pills drop Seasonal Products', !has(home.text, 'Seasonal Products'));
  check('menu/pills drop Home Decor', !has(home.text, 'Home Decor'));
  check('menu/pills drop Summer Products (empty seasonal child)', !has(home.text, 'Summer Products'));
  check('menu/pills drop Rainy Season Products (empty seasonal child)', !has(home.text, 'Rainy Season Products'));
  check('no duplicate Winter Products pill', !has(home.text, 'Winter Products'));
  check('price filter has Min placeholder', has(home.text, 'placeholder="Min ৳"'));
  check('price filter has Max placeholder', has(home.text, 'placeholder="Max ৳"'));
  check('price filter has Min aria-label', has(home.text, 'aria-label="Minimum price"'));
  check('price filter has Max aria-label', has(home.text, 'aria-label="Maximum price"'));

  const product = await get('/product/1');
  check('product page renders 200', product.status === 200, 'got ' + product.status);
  check('product page shows product name', has(product.text, 'Test Watch'));

  // Served CSS
  const cssRes = await get('/css/style.css');
  const css = cssRes.text;
  check('style.css serves 200', cssRes.status === 200, 'got ' + cssRes.status);
  check('desktop full-width container rule present', has(css, '@media (min-width: 769px)') && has(css, '.container { max-width: none; padding: 0 24px; }'));
  check('policy pages keep a readable width on desktop', has(css, '.container.policy-page { max-width: 900px; }'));
  check('base container still capped (mobile-first default)', has(css, '.container { max-width: 1100px; margin: 0 auto; padding: 0 20px; }'));
  check('mobile container padding unchanged (14px)', has(css, '.container { padding: 0 14px; }'));
  check('hero image can shrink (flex 0 1 260px + min-width 0)', has(css, '.hero-image { flex: 0 1 260px; min-width: 0;'));
  check('hero text can shrink (min-width 0)', has(css, '.hero-text { flex: 1; min-width: 0; }'));
  check('hero caption wraps (overflow-wrap)', has(css, '.hero-image-caption') && has(css, 'overflow-wrap: break-word;'));
  check('WhatsApp scroll-hide rules live in <=1024px block',
    css.indexOf('@media (max-width: 1024px)') !== -1 &&
    css.indexOf('.whatsapp-float--scroll {') > css.indexOf('@media (max-width: 1024px)'));
  // Find the <=768px block that holds the mobile WhatsApp size/position
  // rules (there are several 768px blocks in the file).
  let block768 = '';
  {
    const marker = '@media (max-width: 768px)';
    let from = 0;
    for (;;) {
      const start = css.indexOf(marker, from);
      if (start === -1) break;
      // Next @media at line start — a comment inside the block can also
      // mention '@media', so a plain indexOf would cut the block short.
      let end = css.indexOf('\n@media', start + marker.length);
      if (end === -1) end = css.length;
      const block = css.slice(start, end);
      if (block.includes('bottom: 88px;')) { block768 = block; break; }
      from = start + marker.length;
    }
  }
  check('WhatsApp scroll-hide rules removed from <=768px block', block768 !== '' && !block768.includes('whatsapp-float--scroll {'));
  check('mobile WhatsApp size/position rules kept', block768.includes('.whatsapp-float {') && block768.includes('bottom: 88px;'));
  const opens = (css.match(/{/g) || []).length;
  const closes = (css.match(/}/g) || []).length;
  check('CSS braces balanced', opens === closes && opens > 0, `${opens} { vs ${closes} }`);

  // footer.ejs: WhatsApp scroll-aware JS now covers <=1024px
  const footerEjs = fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', 'footer.ejs'), 'utf8');
  check('footer JS matchMedia is now <=1024px', footerEjs.includes("matchMedia('(max-width: 1024px)')"));
  check('footer JS no longer uses the 768px WhatsApp query', !footerEjs.includes("matchMedia('(max-width: 768px)')"));

  // Direct EJS render of the homepage (header + hero + footer) with a hero product
  console.log('Direct EJS render (index.ejs)');
  const { buildMenuTree: bmt, buildMenuById } = require('../lib/categories');
  const menu = bmt(catRows);
  const renderFile = util.promisify(ejs.renderFile);
  const html = await renderFile(path.join(__dirname, '..', 'views', 'index.ejs'), {
    cartCount: 0,
    userName: null,
    siteSettings: {
      hero_title: fixes.HERO_TITLE_NEW,
      hero_subtitle: fixes.HERO_SUBTITLE_NEW,
      announcement_text: '',
      logo_url: '/icons/icon-192.png',
      facebook_url: '',
    },
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
    products: [productRow],
    bestSellers: [productRow],
    variantProductIds: [],
    optionProductIds: [],
    heroProduct: { id: 3, name: 'BINBOND 2521 Men’s Luxury Quartz Watch', price: 990, image: 'watch.jpg' },
    banners: [],
  });
  check('EJS homepage renders hero caption', has(html, 'BINBOND 2521 Men’s Luxury Quartz Watch — ৳990'));
  check('EJS homepage renders new hero title', has(html, 'সেরা পণ্য, ক্যাশ অন ডেলিভারি'));
  check('EJS homepage renders price filter labels', has(html, 'placeholder="Min ৳"') && has(html, 'aria-label="Maximum price"'));
  check('EJS homepage pills show only non-empty categories', has(html, 'Home Appliances') && has(html, 'Winter Collection') && !has(html, 'Seasonal Products'));

  console.log(`\n${passes.length} passed, ${failures.length} failed.`);
  if (failures.length) { console.log('Failures: ' + failures.join(', ')); process.exit(1); }
  process.exit(0);
})().catch((err) => {
  console.error('Test crashed:', err);
  process.exit(1);
});
