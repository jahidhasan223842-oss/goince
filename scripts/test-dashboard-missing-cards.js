// Dashboard missing cards (fix/dashboard-missing-cards) — stubbed-DB smoke test.
//
// No live MySQL needed: config/db is stubbed in the require cache, the real
// server.js + routers + EJS render over real HTTP on a throwaway port.
// Checks:
//   1. lib/invoice.js dueAmount rule the Pending COD card relies on:
//      cancelled -> 0, Paid -> 0, COD collected -> 0, advance subtracts,
//      partial advance leaves the remainder.
//   2. HTTP (admin login, then GET /admin/dashboard): renders 200 and shows
//      the four new cards with the stubbed scenario values — Pending COD
//      ৳1,500 across 2 open orders (cancelled + paid + COD-collected orders
//      excluded, advance subtracted), Today's revenue ৳1,000 / 1 order,
//      Profit ৳490 with a partial-coverage hint (cost set for 1 of 3 units),
//      Needs attention panel with 2 pending reviews + 3 unread messages.
//      Also asserts the today's-revenue query was called with the Asia/Dhaka
//      calendar date as a parameter, and that the old cards still render.
//   3. Direct EJS render of dashboard.ejs:
//      (a) no-cost-data variant: profit shows "—" + the cost-price hint and
//          NEVER presents revenue as profit; empty attention -> "Nothing
//          needs attention right now."
//      (b) full-coverage profit variant: no partial hint, "Revenue − cost".
//   4. Served CSS: attention-panel rules present, braces balanced, no
//      hardcoded grey text in the new rules.
//
// Run:  node scripts/test-dashboard-missing-cards.js
// Exit code 0 = all checks passed.
'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');
const util = require('util');
const ejs = require('ejs');
const bcrypt = require('bcryptjs');

const PORT = process.env.TEST_PORT || '3459';
process.env.PORT = PORT;
process.env.SESSION_SECRET = 'test-secret-for-dashboard-missing-cards';

// ---------- checks ----------
const failures = [];
const passes = [];
function check(name, ok, detail) {
  if (ok) { passes.push(name); console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}
function has(html, needle) { return html.includes(needle); }

// ---------- 1. dueAmount rule (lib/invoice.js) ----------
function testDueRule() {
  console.log('dueAmount rule (lib/invoice.js)');
  const { dueAmount } = require('../lib/invoice');
  check('cancelled order owes nothing', dueAmount({ status: 'Cancelled', total_amount: 2000, payment_status: 'Unpaid' }, 0) === 0);
  check('Paid order owes nothing', dueAmount({ status: 'Delivered', total_amount: 500, payment_status: 'Paid' }, 0) === 0);
  check('COD collected order owes nothing', dueAmount({ status: 'Delivered', total_amount: 370, payment_status: 'Unpaid', cod_collected: 1 }, 0) === 0);
  check('unpaid order owes full total', dueAmount({ status: 'Pending', total_amount: 1000, payment_status: 'Unpaid' }, 0) === 1000);
  check('advance subtracts from due', dueAmount({ status: 'Pending', total_amount: 800, payment_status: 'Unpaid' }, 300) === 500);
  check('advance larger than total never goes negative', dueAmount({ status: 'Pending', total_amount: 800, payment_status: 'Unpaid' }, 900) === 0);
}

// ---------- 2+3. Stubbed-DB HTTP server + direct EJS render ----------
const ADMIN_EMAIL = 'admin@goince.com';
const ADMIN_PASSWORD = 'admin123';
const adminHash = bcrypt.hashSync(ADMIN_PASSWORD, 8);

// Scenario A (HTTP): 5 orders; open ones are #1 (due 1000), #2 (Paid, due 0),
// #3 (advance 300, due 500), #5 (COD collected, due 0). #4 is Cancelled.
const openOrders = [
  { id: 1, total_amount: 1000, payment_status: 'Unpaid', cod_collected: 0 },
  { id: 2, total_amount: 500, payment_status: 'Paid', cod_collected: 1 },
  { id: 3, total_amount: 800, payment_status: 'Unpaid', cod_collected: 0 },
  { id: 5, total_amount: 370, payment_status: 'Unpaid', cod_collected: 1 },
];
const pendingOrders = [
  { id: 1, customer_name: 'Test Customer', phone: '01800000000', total_amount: 1000, created_at: new Date() },
  { id: 3, customer_name: 'Another Customer', phone: '01900000000', total_amount: 800, created_at: new Date() },
];

const queryCalls = [];
function rowsFor(sql) {
  const s = String(sql).replace(/\s+/g, ' ');
  // --- global middleware (server.js) ---
  if (s.includes("setting_key = 'shop_phone'")) return [{ setting_value: '' }];
  if (s.includes('FROM settings WHERE setting_key IN')) return [];
  if (s.includes('COUNT(products.id) AS product_count')) return [];
  // --- admin login ---
  if (s.includes('FROM admins WHERE email = ?')) {
    return [{ id: 1, email: ADMIN_EMAIL, password: adminHash, role: 'owner' }];
  }
  // --- dashboard: new missing-cards queries (checked first: several share
  //     fragments with the older summary queries) ---
  if (s.includes('cod_collected') && s.includes('FROM orders')) return openOrders;
  if (s.includes('FROM order_payments GROUP BY order_id')) return [{ order_id: 3, total: 300 }];
  if (s.includes('DATE(created_at) = ?')) return [{ ordersCount: 1, revenue: 1000 }];
  if (s.includes('totalProfit')) return [{ totalCost: 500, totalProfit: 490, totalUnits: 3, costedUnits: 1 }];
  if (s.includes('FROM reviews WHERE status')) return [{ pending: 2 }];
  if (s.includes('is_read = 0')) return [{ unread: 3 }];
  // --- dashboard: existing queries ---
  if (s.includes('AS totalProducts')) return [{ totalProducts: 5 }];
  if (s.includes('AS totalOrders')) return [{ totalOrders: 5 }];
  if (s.includes('AS totalRevenue')) return [{ totalRevenue: 2670 }];
  if (s.includes('AS totalCustomers')) return [{ totalCustomers: 1 }];
  if (s.includes("status = 'Pending' ORDER BY created_at DESC LIMIT 5")) return pendingOrders;
  if (s.includes('CURDATE()')) return [{ c: 1 }];
  if (s.includes('ORDER BY stock ASC LIMIT 5')) return [];
  if (s.includes('AND stock > 0')) return [{ lowStockCount: 0 }];
  if (s.includes('stock = 0')) return [{ outOfStockCount: 0 }];
  if (s.includes('AS collectedRevenue')) return [{ ordersCount: 3, revenue: 1870, avgOrderValue: 623.33, collectedRevenue: 870 }];
  if (s.includes('AS revenue FROM orders')) return [{ ordersCount: 0, revenue: 0 }];
  if (s.includes('newCustomers')) return [{ newCustomers: 0 }];
  if (s.includes('AS day')) return [];
  if (s.includes('unitsSold')) return [];
  if (s.includes('GROUP BY status')) return [{ status: 'Pending', count: 2 }, { status: 'Shipped', count: 1 }, { status: 'Delivered', count: 1 }];
  // --- startup content fixes: stubbed DB has no matching rows ---
  if (s.startsWith('UPDATE settings SET setting_value') || s.startsWith('UPDATE products SET name')) return [{ affectedRows: 0 }];
  // --- anything else: empty result (safe default) ---
  return [];
}

const stubDb = {
  query: async (sql, params) => { queryCalls.push([String(sql), params || []]); return [rowsFor(sql)]; },
  execute: async (sql, params) => { queryCalls.push([String(sql), params || []]); return [rowsFor(sql)]; },
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
async function get(pathname) {
  const res = await fetch(`http://127.0.0.1:${PORT}${pathname}`, {
    headers: cookieHeader() ? { Cookie: cookieHeader() } : {},
    redirect: 'manual',
  });
  storeCookies(res);
  return { status: res.status, headers: res.headers, text: await res.text() };
}
async function postForm(pathname, fields) {
  const res = await fetch(`http://127.0.0.1:${PORT}${pathname}`, {
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

function dashboardLocals(overrides) {
  return Object.assign({
    totalProducts: 5,
    totalOrders: 5,
    totalRevenue: 2670,
    totalCustomers: 1,
    pendingOrders,
    todaysPendingCount: 1,
    lowStockProducts: [],
    lowStockCount: 0,
    outOfStockCount: 0,
    pendingDue: 1500,
    pendingDueOrders: 2,
    pendingReviews: 2,
    unreadMessages: 3,
    todaysSummary: { ordersCount: 1, revenue: 1000 },
    periodProfit: { totalProfit: 490, totalCost: 500, totalUnits: 3, costedUnits: 1 },
    dashboard: {
      range: '30', from: '2026-10-26', to: '2026-11-24', prevFrom: '2026-09-26', prevTo: '2026-10-25',
      currentSummary: { ordersCount: 3, revenue: 1870, avgOrderValue: 623.33, collectedRevenue: 870 },
      previousSummary: { ordersCount: 0, revenue: 0 },
      newCustomers: 0, salesTrend: [], topProducts: [],
      statusRows: [{ status: 'Pending', count: 2 }, { status: 'Shipped', count: 1 }, { status: 'Delivered', count: 1 }],
      revenueChange: null, maxTrendRevenue: 1,
    },
    siteName: 'Goince',
    siteSettings: { logo_url: '/icons/icon-192.png' },
    adminRole: 'owner',
    csrfToken: 'test-csrf',
    assetUrl: (p) => p,
  }, overrides || {});
}

(async () => {
  testDueRule();

  console.log('HTTP (stubbed DB, real server)');
  if (!(await waitForServer())) {
    console.log('FAIL  server did not start');
    process.exit(1);
  }

  const login = await get('/admin/login');
  check('admin login renders 200', login.status === 200, 'got ' + login.status);
  const csrf = (login.text.match(/name="_csrf" value="([^"]+)"/) || [])[1];
  const doLogin = await postForm('/admin/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, _csrf: csrf || '' });
  check('admin login POST redirects to dashboard', doLogin.status === 302 && String(doLogin.headers.get('location') || '').includes('/admin/dashboard'), 'got ' + doLogin.status + ' -> ' + doLogin.headers.get('location'));

  const dash = await get('/admin/dashboard');
  check('admin dashboard renders 200', dash.status === 200, 'got ' + dash.status);
  // Pending COD card: 1000 (order #1) + 500 (order #3 after 300 advance) = 1500,
  // 2 orders owe; Paid / COD-collected / cancelled orders excluded.
  check('Pending COD card shows ৳1,500', has(dash.text, 'Pending COD / due') && has(dash.text, '৳1,500'));
  check('Pending COD card counts 2 open orders', has(dash.text, '2 open order(s) still owe'));
  check('Pending COD card links to unpaid tab', has(dash.text, '/admin/invoices?tab=unpaid'));
  // Today's revenue card.
  check("Today's revenue card shows ৳1,000", has(dash.text, "Today's revenue") && has(dash.text, '৳1,000'));
  check("Today's revenue card counts 1 order (Asia/Dhaka)", has(dash.text, '1 order(s) today (Asia/Dhaka)'));
  // Profit card: 490 with partial-coverage hint (cost set for 1 of 3 units).
  check('Profit card shows ৳490', has(dash.text, 'Profit in period') && has(dash.text, '৳490'));
  check('Profit card warns coverage is partial', has(dash.text, 'Cost price set for 1 of 3 units — partial profit.'));
  // Needs attention panel.
  check('Needs attention panel shows 2 pending reviews', has(dash.text, 'Needs attention') && has(dash.text, '2 review(s) waiting for approval'));
  check('Needs attention panel shows 3 unread messages', has(dash.text, '3 unread message(s)'));
  check('Needs attention links to reviews + messages', has(dash.text, '/admin/reviews') && has(dash.text, '/admin/messages'));
  // Old cards still there (no regression).
  check("old card still renders: Today's pending orders", has(dash.text, "Today's pending orders"));
  check('old card still renders: Sales revenue', has(dash.text, 'Sales revenue'));
  check('old card still renders: Collected revenue', has(dash.text, 'Collected revenue'));
  check('old panel still renders: Recent pending orders', has(dash.text, 'Recent pending orders'));
  // Today's-revenue query used the Asia/Dhaka calendar date as a parameter.
  const dhakaToday = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' });
  const todayCall = queryCalls.find(([sql]) => String(sql).includes('DATE(created_at) = ?'));
  check("today's-revenue query passes Asia/Dhaka date as param", Boolean(todayCall) && todayCall[1] && todayCall[1][0] === dhakaToday, todayCall ? String(todayCall[1]) : 'no such query call');
  check("today's-revenue date param is a valid YYYY-MM-DD", Boolean(todayCall) && /^\d{4}-\d{2}-\d{2}$/.test(String(todayCall[1][0] || '')));
  // Route source: profit query tracks cost coverage (honesty rule).
  const adminJs = fs.readFileSync(path.join(__dirname, '..', 'routes', 'admin.js'), 'utf8');
  check('profit query counts costed units (coverage tracking)', adminJs.includes('cost_price IS NOT NULL') && adminJs.includes('AS costedUnits'));
  check('pending-due query reuses lib/invoice dueAmount', adminJs.includes('dueAmount(o, advancesByOrder[o.id] || 0)'));

  // Direct EJS render: (a) no-cost-data variant — must NOT show revenue as profit.
  console.log('Direct EJS render (dashboard.ejs)');
  const renderFile = util.promisify(ejs.renderFile);
  const noCostHtml = await renderFile(path.join(__dirname, '..', 'views', 'admin', 'dashboard.ejs'), dashboardLocals({
    pendingDue: 0, pendingDueOrders: 0,
    pendingReviews: 0, unreadMessages: 0,
    todaysSummary: { ordersCount: 0, revenue: 0 },
    periodProfit: { totalProfit: 0, totalCost: 0, totalUnits: 2, costedUnits: 0 },
  }));
  check('no-cost variant: profit shows a dash, not a number', has(noCostHtml, 'Profit in period') && has(noCostHtml, '<strong class="analytics-kpi-value">—</strong>'));
  check('no-cost variant: cost-price hint shown', has(noCostHtml, 'Cost prices not set — add cost price in Add/Edit Product to see real profit.'));
  check('no-cost variant: empty attention state shown', has(noCostHtml, 'Nothing needs attention right now.'));
  check('no-cost variant: pending COD shows ৳0 with 0 orders', has(noCostHtml, 'Pending COD / due') && has(noCostHtml, '0 open order(s) still owe'));
  // (b) full-coverage profit variant.
  const fullCostHtml = await renderFile(path.join(__dirname, '..', 'views', 'admin', 'dashboard.ejs'), dashboardLocals({
    periodProfit: { totalProfit: 1200, totalCost: 800, totalUnits: 4, costedUnits: 4 },
  }));
  check('full-coverage variant: profit shows ৳1,200', has(fullCostHtml, '৳1,200'));
  check('full-coverage variant: no partial hint', !has(fullCostHtml, 'partial profit'));
  check('full-coverage variant: plain Revenue − cost foot', has(fullCostHtml, 'Revenue − cost in this period'));

  // Served CSS: attention-panel rules + balance.
  const cssRes = await get('/css/style.css');
  const css = cssRes.text;
  check('style.css serves 200', cssRes.status === 200, 'got ' + cssRes.status);
  check('attention panel CSS present', has(css, '.analytics-attention-panel') && has(css, '.analytics-attention-row'));
  check('attention rows use theme variables (no hardcoded grey)', has(css, '.analytics-attention-row strong') && css.includes('.analytics-attention-row div span { color:var(--text-muted);'));
  const opens = (css.match(/{/g) || []).length;
  const closes = (css.match(/}/g) || []).length;
  check('CSS braces balanced', opens === closes && opens > 0, `${opens} { vs ${closes} }`);

  console.log(`\n${passes.length} passed, ${failures.length} failed.`);
  if (failures.length) { console.log('Failures: ' + failures.join(', ')); process.exit(1); }
  process.exit(0);
})().catch((err) => {
  console.error('Test crashed:', err);
  process.exit(1);
});
