// Dashboard professional panels (fix/dashboard-professional-panels) —
// stubbed-DB smoke test.
//
// No live MySQL needed: config/db is stubbed in the require cache, the real
// server.js + routers + EJS render over real HTTP on a throwaway port.
// Checks (scenario with hand-computed fixture values):
//   1. Recent activity merges latest orders + status changes, newest first.
//   2. Phone confirmation queue shows only unconfirmed open orders, oldest
//      first, with tel: Call links (SQL filter verified in route source).
//   3. Sales by category matches the Reports computation on the same
//      fixture (child sales roll up to the top-level parent; zero-revenue
//      roots left out), using the dashboard period as query params.
//   4. Top customers ranks by total spent in the period (registered +
//      guest, grouped by phone); only registered rows link to detail.
//   5. Shipped-not-delivered shows Shipped orders oldest first with days
//      waiting (from the Shipped status change, falling back to order
//      date) and courier/tracking info.
//   6. Direct EJS render: empty states for all 5 panels; a full variant
//      renders one row of each panel.
//   7. Served CSS: new panel rules present, braces balanced, theme
//      variables only (no hardcoded grey in the new block).
//
// Run:  node scripts/test-dashboard-professional-panels.js
// Exit code 0 = all checks passed.
'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');
const util = require('util');
const ejs = require('ejs');
const bcrypt = require('bcryptjs');

const PORT = process.env.TEST_PORT || '3461';
process.env.PORT = PORT;
process.env.SESSION_SECRET = 'test-secret-for-dashboard-professional-panels';

// ---------- checks ----------
const failures = [];
const passes = [];
function check(name, ok, detail) {
  if (ok) { passes.push(name); console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}
function has(html, needle) { return html.includes(needle); }
function section(html, start, end) {
  const i = html.indexOf(start);
  if (i < 0) return '';
  const j = end ? html.indexOf(end, i + start.length) : html.length;
  return html.slice(i, j < 0 ? html.length : j);
}

// ---------- fixture ----------
const ADMIN_EMAIL = 'admin@goince.com';
const ADMIN_PASSWORD = 'admin123';
const adminHash = bcrypt.hashSync(ADMIN_PASSWORD, 8);

// Relative dates so the test works on any run day.
function at(daysAgo, hour) {
  const t = new Date();
  t.setDate(t.getDate() - daysAgo);
  t.setHours(hour, 0, 0, 0);
  return t;
}
const daysBetween = (d) => Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 86400000));

// --- activity: orders #10 (today 10:00) and #9 (yesterday 09:00); history
// rows at today 11:00 (#10 Shipped), 09:00 (#9 Delivered), 08:00 (#8 phone
// confirmed, old == new so the note is shown).
const latestOrders = [
  { id: 10, customer_name: 'Asha', total_amount: 370, created_at: at(0, 10) },
  { id: 9, customer_name: 'Babu', total_amount: 500, created_at: at(1, 9) },
];
const historyRows = [
  { order_id: 10, old_status: 'Confirmed', new_status: 'Shipped', note: null, changed_by: ADMIN_EMAIL, created_at: at(0, 11) },
  { order_id: 9, old_status: 'Shipped', new_status: 'Delivered', note: null, changed_by: ADMIN_EMAIL, created_at: at(0, 9) },
  { order_id: 8, old_status: 'Pending', new_status: 'Pending', note: 'Phone confirmed by admin', changed_by: ADMIN_EMAIL, created_at: at(0, 8) },
];
// --- phone queue: #11 oldest unconfirmed, #12 unconfirmed; confirmed and
// cancelled orders are excluded by the SQL (verified in route source).
const phoneQueueRows = [
  { id: 11, customer_name: 'Old One', phone: '01811111111', total_amount: 310, created_at: at(4, 10) },
  { id: 12, customer_name: 'Second', phone: '01822222222', total_amount: 500, created_at: at(3, 10) },
];
// --- categories: Root A (id 1) + child A1 (id 2); Root B (id 3); Root C
// (id 4, no sales). Sales: child A1 ৳1,000 (order 1), Root A ৳500 (order 2),
// Root B ৳300 (order 3) => Root A rolls up to ৳1,500 / 2 orders.
const categoryRows = [
  { id: 1, name: 'Root A', parent_id: null },
  { id: 2, name: 'Child A1', parent_id: 1 },
  { id: 3, name: 'Root B', parent_id: null },
  { id: 4, name: 'Root C', parent_id: null },
];
const categorySalesRows = [
  { category_id: 2, orderIds: '1', items: 2, revenue: 1000, cost: 600, profit: 400 },
  { category_id: 1, orderIds: '2', items: 1, revenue: 500, cost: 300, profit: 200 },
  { category_id: 3, orderIds: '3', items: 1, revenue: 300, cost: 200, profit: 100 },
];
// --- top customers: Rahim (registered, 2 orders, ৳1,500) then a guest.
const topCustomerRows = [
  { phone: '01811111111', customer_name: 'Rahim', user_id: 7, orderCount: 2, totalSpent: 1500 },
  { phone: '01822222222', customer_name: 'Guest Buyer', user_id: null, orderCount: 1, totalSpent: 800 },
];
// --- shipped: #20 shipped 4 days ago with courier, #21 shipped (no history
// row -> falls back to its order date 2 days ago), no courier.
const shippedRows = [
  { id: 20, customer_name: 'Ship One', phone: '01811111111', total_amount: 370, courier_name: 'Steadfast', tracking_number: 'TRK1', created_at: at(5, 10), shipped_at: at(4, 10) },
  { id: 21, customer_name: 'Ship Two', phone: '01822222222', total_amount: 500, courier_name: null, tracking_number: null, created_at: at(2, 10), shipped_at: null },
];
const pendingOrders = [
  { id: 1, customer_name: 'Test Customer', phone: '01800000000', total_amount: 1000, created_at: new Date() },
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
  // --- dashboard: new professional-panel queries (checked first: several
  //     share fragments with the older summary queries) ---
  if (s.includes('phone_confirmed')) return s.includes('COUNT(*)') ? [{ c: 2 }] : phoneQueueRows;
  if (s.includes("status = 'Shipped'")) return s.includes('COUNT(*)') ? [{ c: 2 }] : shippedRows;
  if (s.includes('FROM order_status_history ORDER BY created_at DESC')) return historyRows;
  if (s.includes('ORDER BY created_at DESC, id DESC LIMIT 10')) return latestOrders;
  if (s.includes('SELECT id, name, parent_id FROM categories')) return categoryRows;
  if (s.includes('GROUP BY products.category_id')) return categorySalesRows;
  if (s.includes('GROUP BY phone')) return topCustomerRows;
  if (s.startsWith('SET SESSION group_concat_max_len')) return [];
  // --- dashboard: PR #45 missing-cards queries ---
  if (s.includes('cod_collected') && s.includes('FROM orders')) {
    return [{ id: 1, total_amount: 1000, payment_status: 'Unpaid', cod_collected: 0 }];
  }
  if (s.includes('FROM order_payments GROUP BY order_id')) return [];
  if (s.includes('DATE(created_at) = ?')) return [{ ordersCount: 1, revenue: 1000 }];
  if (s.includes('totalProfit')) return [{ totalCost: 500, totalProfit: 490, totalUnits: 3, costedUnits: 1 }];
  if (s.includes('FROM reviews WHERE status')) return [{ pending: 0 }];
  if (s.includes('is_read = 0')) return [{ unread: 0 }];
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
  if (s.includes('GROUP BY status')) return [{ status: 'Pending', count: 2 }];
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
    pendingDue: 0,
    pendingDueOrders: 0,
    pendingReviews: 0,
    unreadMessages: 0,
    todaysSummary: { ordersCount: 0, revenue: 0 },
    periodProfit: { totalProfit: 0, totalCost: 0, totalUnits: 0, costedUnits: 0 },
    recentActivity: [],
    phoneQueue: [],
    phoneQueueTotal: 0,
    dashboardCategorySales: [],
    topCustomers: [],
    shippedOrders: [],
    shippedTotal: 0,
    dashboard: {
      range: '30', from: '2026-10-26', to: '2026-11-24', prevFrom: '2026-09-26', prevTo: '2026-10-25',
      currentSummary: { ordersCount: 3, revenue: 1870, avgOrderValue: 623.33, collectedRevenue: 870 },
      previousSummary: { ordersCount: 0, revenue: 0 },
      newCustomers: 0, salesTrend: [], topProducts: [],
      statusRows: [{ status: 'Pending', count: 2 }],
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

  // (1) Recent activity: merged, newest first.
  const act = section(dash.text, 'Recent activity', 'Phone confirmation queue');
  const iShip10 = act.indexOf('Order #10 — Confirmed → Shipped');
  const iPlaced10 = act.indexOf('Order #10 placed');
  const iDeliv9 = act.indexOf('Order #9 — Shipped → Delivered');
  const iPhone8 = act.indexOf('Order #8 — Phone confirmed by admin');
  const iPlaced9 = act.indexOf('Order #9 placed');
  check('activity panel shows the Shipped change for #10', iShip10 >= 0);
  check('activity merges orders + status changes newest first',
    iShip10 >= 0 && iPlaced10 > iShip10 && iDeliv9 > iPlaced10 && iPhone8 > iDeliv9 && iPlaced9 > iPhone8,
    `indexes ${iShip10},${iPlaced10},${iDeliv9},${iPhone8},${iPlaced9}`);
  check('activity rows link to the order', has(act, '/admin/orders/10'));
  check('activity shows the placed amount', has(act, 'Order #10 placed — ৳370'));

  // (2) Phone confirmation queue: oldest first, tel: links.
  const pq = section(dash.text, 'Phone confirmation queue', 'Sales by category');
  check('phone queue shows oldest order #11 first', has(pq, '#11') && pq.indexOf('#11') < pq.indexOf('#12'));
  check('phone queue has tel: Call links', has(pq, 'tel:01811111111') && has(pq, '📞 Call'));
  check('phone queue counts 2 waiting orders', has(pq, '2 order(s) waiting for a call'));
  check('phone queue links to the orders list', has(pq, '/admin/orders'));
  const adminJs = fs.readFileSync(path.join(__dirname, '..', 'routes', 'admin.js'), 'utf8');
  check('phone queue SQL only takes unconfirmed orders', adminJs.includes('phone_confirmed = 0') && adminJs.includes("status != 'Cancelled'"));
  check('phone queue SQL orders oldest first', adminJs.includes('ORDER BY created_at ASC, id ASC LIMIT 10'));

  // (3) Sales by category: same computation as Reports (child rolls up).
  const cat = section(dash.text, 'Sales by category', 'Top customers');
  check('category panel shows Root A rolled up to ৳1,500', has(cat, 'Root A') && has(cat, '৳1,500'));
  check('category panel shows Root B at ৳300', has(cat, 'Root B') && has(cat, '৳300'));
  check('category panel leaves out zero-revenue Root C', !has(cat, 'Root C'));
  check('category panel ranks by revenue (A before B)', cat.indexOf('Root A') < cat.indexOf('Root B'));
  check('category panel links to Reports', has(cat, '/admin/reports'));
  const catCall = queryCalls.find(([sql]) => String(sql).includes('GROUP BY products.category_id'));
  const periodNote = dash.text.match(/Showing <strong>(\d{4}-\d{2}-\d{2})<\/strong> to <strong>(\d{4}-\d{2}-\d{2})<\/strong>/);
  check('category query uses the dashboard period as params',
    Boolean(catCall) && Boolean(periodNote) && catCall[1][0] === periodNote[1] && catCall[1][1] === periodNote[2],
    catCall ? String(catCall[1]) : 'no category query call');
  check('category query matches the Reports computation shape',
    Boolean(catCall) && String(catCall[0]).includes('DATE(orders.created_at) BETWEEN ? AND ?') && String(catCall[0]).includes("orders.status != 'Cancelled'") && String(catCall[0]).includes('GROUP_CONCAT(DISTINCT orders.id)'));
  check('category rollup reuses buildCategoryTree like Reports', adminJs.includes('buildCategoryTree(catRows)') && adminJs.includes('roots.filter(r => !r.isOrphan)'));

  // (4) Top customers: ranked by spend, registered links to detail.
  const tc = section(dash.text, 'Top customers', 'Shipped — not delivered yet');
  check('top customers ranks Rahim (৳1,500) before the guest', has(tc, 'Rahim') && tc.indexOf('Rahim') < tc.indexOf('Guest Buyer'));
  check('top customers shows ৳1,500 spent', has(tc, '৳1,500'));
  check('top customers links the registered customer to detail', has(tc, '/admin/customers/7'));
  check('top customers does not link the guest row to a detail page', (tc.match(/\/admin\/customers\//g) || []).length === 1);
  check('top customers SQL groups by phone and orders by spend', adminJs.includes('GROUP BY phone') && adminJs.includes('ORDER BY totalSpent DESC LIMIT 5'));

  // (5) Shipped — not delivered yet.
  const sh = section(dash.text, 'Shipped — not delivered yet', '</section>');
  check('shipped panel shows #20 before #21 (oldest first)', has(sh, '#20') && sh.indexOf('#20') < sh.indexOf('#21'));
  check('shipped panel shows courier + tracking', has(sh, 'Steadfast') && has(sh, 'TRK1'));
  check('shipped panel counts 2 awaiting delivery', has(sh, '2 order(s) shipped and awaiting delivery'));
  const days20 = daysBetween(at(4, 10));
  const days21 = daysBetween(at(2, 10));
  check(`shipped panel shows ${days20} day(s) waiting for #20 (from Shipped change)`, has(sh, `${days20} day(s)`));
  check(`shipped panel falls back to order date for #21 (${days21} day(s))`, has(sh, `${days21} day(s)`));
  check('shipped SQL only takes Shipped orders, oldest first',
    adminJs.includes("status = 'Shipped'") && adminJs.includes('ORDER BY created_at ASC, id ASC LIMIT 10') && adminJs.includes("new_status = 'Shipped'"));

  // Old panels still render (no regression).
  check('old panel still renders: Recent pending orders', has(dash.text, 'Recent pending orders'));
  check('old panel still renders: Needs attention', has(dash.text, 'Needs attention'));
  check('old card still renders: Pending COD / due', has(dash.text, 'Pending COD / due'));
  check('old panel still renders: Sales trend', has(dash.text, 'Sales trend'));

  // Direct EJS render: (a) all five panels empty.
  console.log('Direct EJS render (dashboard.ejs)');
  const renderFile = util.promisify(ejs.renderFile);
  const emptyHtml = await renderFile(path.join(__dirname, '..', 'views', 'admin', 'dashboard.ejs'), dashboardLocals());
  check('empty: recent activity empty state', has(emptyHtml, 'No recent activity yet.'));
  check('empty: phone queue empty state', has(emptyHtml, 'All open orders are phone-confirmed.'));
  check('empty: category empty state', has(emptyHtml, 'No category sales in this period.'));
  check('empty: top customers empty state', has(emptyHtml, 'No customer orders in this period.'));
  check('empty: shipped empty state', has(emptyHtml, 'No orders are waiting for delivery.'));
  // (b) full variant: one row of each panel renders.
  const fullHtml = await renderFile(path.join(__dirname, '..', 'views', 'admin', 'dashboard.ejs'), dashboardLocals({
    recentActivity: [{ kind: 'order', orderId: 10, text: 'Order #10 placed — ৳370', when: new Date() }],
    phoneQueue: [{ id: 11, customer_name: 'Old One', phone: '01811111111', total_amount: 310, created_at: new Date() }],
    phoneQueueTotal: 1,
    dashboardCategorySales: [{ id: 1, name: 'Root A', orders: 2, items: 3, revenue: 1500, cost: 900, profit: 600 }],
    topCustomers: [{ phone: '01811111111', customer_name: 'Rahim', user_id: 7, orderCount: 2, totalSpent: 1500 }],
    shippedOrders: [{ id: 20, customer_name: 'Ship One', phone: '01811111111', total_amount: 370, courier_name: 'Steadfast', tracking_number: 'TRK1', created_at: new Date(), daysSinceShipped: 4 }],
    shippedTotal: 1,
  }));
  check('full variant: activity row renders', has(fullHtml, 'Order #10 placed — ৳370'));
  check('full variant: phone row renders with Call link', has(fullHtml, 'tel:01811111111'));
  check('full variant: category bar renders with ৳1,500', has(fullHtml, 'Root A') && has(fullHtml, '৳1,500'));
  check('full variant: top customer renders with detail link', has(fullHtml, '/admin/customers/7'));
  check('full variant: shipped row renders with tracking', has(fullHtml, 'TRK1') && has(fullHtml, '4 day(s)'));

  // Served CSS: new panel rules + balance.
  const cssRes = await get('/css/style.css');
  const css = cssRes.text;
  check('style.css serves 200', cssRes.status === 200, 'got ' + cssRes.status);
  check('activity row CSS present', has(css, '.analytics-activity-row') && has(css, '.analytics-activity-icon'));
  check('category bar CSS present', has(css, '.analytics-catbar-list') && has(css, '.analytics-catbar'));
  check('sub-text CSS present', has(css, '.analytics-sub'));
  const newBlock = section(css, '/* Dashboard professional panels', '@media (max-width:1100px)');
  check('new CSS block uses theme variables only (no hardcoded grey)', newBlock.length > 0 && !/#888|#999|#666/.test(newBlock), newBlock.length === 0 ? 'block not found' : 'hardcoded grey found');
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
