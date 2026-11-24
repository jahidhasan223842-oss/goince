// Mobile-friendly batch (fix/mobile-friendly) — stubbed-DB smoke test.
//
// No live MySQL needed: config/db is stubbed in the require cache, the real
// server.js + routers + EJS render over real HTTP on a throwaway port.
// Checks: homepage, product page, cart, admin login, admin dashboard,
// orders list, add-product and settings pages all render 200; the viewport
// meta tag is present; the mobile CSS rules and the admin sidebar toggle
// are present in the served CSS/markup; CSS braces are balanced; the
// desktop hover rules (PR #34/#35) are still there.
//
// Run:  node scripts/test-mobile-friendly.js
// Exit code 0 = all checks passed.
'use strict';

const Module = require('module');
const bcrypt = require('bcryptjs');

const PORT = process.env.TEST_PORT || '3457';
process.env.PORT = PORT;
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'mobile-friendly-test-secret';

const ADMIN_EMAIL = 'admin@goince.com';
const ADMIN_PASSWORD = 'TestPass123';
const adminHash = bcrypt.hashSync(ADMIN_PASSWORD, 8);

// ---------- Stubbed database (mysql2 promise pool shape: query -> [rows]) ----------
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

function rowsFor(sql) {
  const s = String(sql).replace(/\s+/g, ' ');
  // --- global middleware (server.js) ---
  if (s.includes("setting_key = 'shop_phone'")) return [{ setting_value: '' }];
  if (s.includes('FROM settings WHERE setting_key IN')) return [];
  if (s.includes('COUNT(products.id) AS product_count')) return [];
  // --- homepage ---
  if (s.includes('FROM products LEFT JOIN order_items')) return [productRow]; // best sellers
  if (s.includes('LEFT JOIN reviews') && s.includes('FROM products')) return [productRow];
  if (s.includes('SELECT * FROM categories ORDER BY is_featured')) return [];
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
  // --- admin login ---
  if (s.includes('FROM admins WHERE email = ?')) {
    return [{ id: 1, email: ADMIN_EMAIL, password: adminHash, role: 'owner' }];
  }
  // --- dashboard ---
  if (s.includes('COUNT(*) AS totalProducts')) return [{ totalProducts: 1 }];
  if (s.includes('COUNT(*) AS totalOrders')) return [{ totalOrders: 0 }];
  if (s.includes('AS totalRevenue')) return [{ totalRevenue: 0 }];
  if (s.includes('COUNT(*) AS totalCustomers')) return [{ totalCustomers: 0 }];
  if (s.includes("COUNT(*) AS c FROM orders WHERE status = 'Pending'")) return [{ c: 0 }];
  if (s.includes("FROM orders WHERE status = 'Pending'")) return [];
  if (s.includes('COUNT(*) AS lowStockCount')) return [{ lowStockCount: 0 }];
  if (s.includes('COUNT(*) AS outOfStockCount')) return [{ outOfStockCount: 0 }];
  if (s.includes('FROM products WHERE stock <=')) return [];
  if (s.includes('collectedRevenue')) return [{ ordersCount: 0, revenue: 0, avgOrderValue: 0, collectedRevenue: 0 }];
  if (s.includes('COUNT(*) AS ordersCount, COALESCE(SUM(total_amount), 0) AS revenue')) return [{ ordersCount: 0, revenue: 0 }];
  if (s.includes('COUNT(*) AS newCustomers')) return [{ newCustomers: 0 }];
  if (s.includes("DATE_FORMAT(created_at, '%Y-%m-%d') AS day")) return [];
  if (s.includes('FROM order_items oi JOIN orders')) return [];
  if (s.includes('SELECT status, COUNT(*) AS count FROM orders')) return [];
  // --- orders list (invoices) ---
  if (s.includes('COUNT(*) AS cnt FROM orders')) return [{ cnt: 0 }];
  if (s.includes('SELECT * FROM orders') && s.includes('ORDER BY created_at DESC LIMIT')) return [];
  if (s.includes('FROM order_payments GROUP BY order_id')) return [];
  // --- add-product / settings ---
  if (s.includes('FROM categories ORDER BY (parent_id IS NULL)')) return [];
  if (s.includes('SELECT id, name FROM products ORDER BY created_at DESC')) return [];
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

// ---------- tiny HTTP client with a cookie jar ----------
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
async function postForm(path, fields) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(cookieHeader() ? { Cookie: cookieHeader() } : {}),
    },
    body: new URLSearchParams(fields).toString(),
    redirect: 'manual',
  });
  storeCookies(res);
  return { status: res.status, headers: res.headers, text: await res.text() };
}

// ---------- checks ----------
const failures = [];
const passes = [];
function check(name, ok, detail) {
  if (ok) { passes.push(name); console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}
function has(html, needle) { return html.includes(needle); }

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
  console.log('Mobile-friendly stubbed-DB test (port ' + PORT + ')');
  if (!(await waitForServer())) {
    console.log('FAIL  server did not start');
    process.exit(1);
  }

  // Shop pages
  const home = await get('/');
  check('homepage renders 200', home.status === 200, 'got ' + home.status);
  check('homepage has viewport meta', has(home.text, 'name="viewport" content="width=device-width, initial-scale=1.0"'));
  check('homepage shows test product', has(home.text, 'Test Watch'));

  const product = await get('/product/1');
  check('product page renders 200', product.status === 200, 'got ' + product.status);
  check('product page has viewport meta', has(product.text, 'name="viewport"'));

  const cart = await get('/cart');
  check('cart renders 200', cart.status === 200, 'got ' + cart.status);

  // Admin login (standalone page — viewport was missing before this batch)
  const login = await get('/admin/login');
  check('admin login renders 200', login.status === 200, 'got ' + login.status);
  check('admin login has viewport meta', has(login.text, 'name="viewport" content="width=device-width, initial-scale=1.0"'));
  const csrf = (login.text.match(/name="_csrf" value="([^"]+)"/) || [])[1];
  check('admin login carries a CSRF token', Boolean(csrf));

  // Log in, then the admin pages
  const doLogin = await postForm('/admin/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, _csrf: csrf || '' });
  check('admin login POST redirects to dashboard', doLogin.status === 302 && String(doLogin.headers.get('location') || '').includes('/admin/dashboard'), 'got ' + doLogin.status + ' -> ' + doLogin.headers.get('location'));

  const dash = await get('/admin/dashboard');
  check('admin dashboard renders 200', dash.status === 200, 'got ' + dash.status);
  check('dashboard has hamburger toggle button', has(dash.text, 'id="admin-menu-btn"'));
  check('dashboard has sidebar overlay', has(dash.text, 'id="admin-sidebar-overlay"'));
  check('dashboard has mobile topbar', has(dash.text, 'admin-mobile-topbar'));
  check('dashboard sidebar has id for toggle', has(dash.text, 'id="admin-sidebar"'));

  const orders = await get('/admin/invoices');
  check('orders list renders 200', orders.status === 200, 'got ' + orders.status);

  const addProduct = await get('/admin/products/add');
  check('add-product renders 200', addProduct.status === 200, 'got ' + addProduct.status);

  const settings = await get('/admin/settings');
  check('settings renders 200', settings.status === 200, 'got ' + settings.status);
  check('settings logo table is wrapped for scrolling', has(settings.text, 'table-responsive'));

  const forgot = await get('/admin/forgot-password');
  check('forgot-password renders 200 with viewport', forgot.status === 200 && has(forgot.text, 'name="viewport"'), 'got ' + forgot.status);

  // Served CSS: mobile rules + toggle + balanced braces + hover intact
  const cssRes = await get('/css/style.css');
  const css = cssRes.text;
  check('style.css serves 200', cssRes.status === 200, 'got ' + cssRes.status);
  check('mobile media query present', has(css, '@media (max-width: 768px)'));
  check('mobile off-canvas sidebar rule present', has(css, 'translateX(-105%)') && has(css, '.admin-sidebar.open'));
  check('mobile topbar + hamburger rules present', has(css, '.admin-mobile-topbar') && has(css, '.admin-menu-btn'));
  check('checkout min-width overflow fix present', has(css, '.checkout-form { min-width: 0'));
  check('mobile 2-column product grid present', has(css, 'grid-template-columns: repeat(2, 1fr)'));
  check('iOS zoom guard (16px inputs) present', has(css, 'input, select, textarea { font-size: 16px; }'));
  check('admin-table-wrap scroll rule present', has(css, '.admin-table-wrap'));
  check('admin login box fits small phones', has(css, 'width: min(320px, calc(100vw - 32px))'));
  const opens = (css.match(/{/g) || []).length;
  const closes = (css.match(/}/g) || []).length;
  check('CSS braces balanced', opens === closes && opens > 0, `${opens} { vs ${closes} }`);
  check('desktop hover rules kept (sidebar)', has(css, '.admin-sidebar nav a:hover'));
  check('desktop hover rules kept (cards)', has(css, '.stat-card:hover') && has(css, '.product-card:hover'));

  console.log(`\n${passes.length} passed, ${failures.length} failed.`);
  if (failures.length) { console.log('Failures: ' + failures.join(', ')); process.exit(1); }
  process.exit(0);
})().catch((err) => {
  console.error('Test crashed:', err);
  process.exit(1);
});
