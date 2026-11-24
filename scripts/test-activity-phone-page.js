// Calls & Activity page (fix/activity-phone-page) — stubbed-DB smoke test.
//
// Phone confirmation queue + Recent activity moved off the dashboard into
// their own paginated admin page /admin/activity (20 per page, tabs
// ?tab=phone (default) and ?tab=activity).
//
// No live MySQL needed: config/db is stubbed in the require cache, the real
// server.js + routers + EJS render over real HTTP on a throwaway port.
// Checks (scenario with hand-computed fixture values):
//   1. Phone tab page 1 shows the first 20 oldest-first rows with tel:
//      Call links; page 2 shows the next 20; page 3 shows the last 5;
//      total count and "Showing X–Y of Z" are correct.
//   2. Activity tab page 1 shows the newest 20 merged entries (orders +
//      status changes interleaved newest first); page 2 continues the
//      merge; page 3 shows the tail.
//   3. Invalid page values clamp safely: abc / 0 / -5 -> page 1,
//      999 -> last page; bogus tab -> phone tab.
//   4. Unauthenticated GET /admin/activity redirects to /admin/login;
//      a staff admin (ordersView) can open the page, but not the dashboard.
//   5. Dashboard renders 200 WITHOUT the two panels but WITH the
//      "Calls & Activity" quick link; the other PR #46 panels stay.
//   6. Direct EJS render: activity.ejs phone + activity tabs (full and
//      empty states); dashboard.ejs without the two panels.
//   7. Route source: /admin/activity guarded by requireRole('ordersView');
//      sidebar links to it; dashboard.ejs no longer mentions the panels.
//
// Run:  node scripts/test-activity-phone-page.js
// Exit code 0 = all checks passed.
'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');
const util = require('util');
const ejs = require('ejs');
const bcrypt = require('bcryptjs');

const PORT = process.env.TEST_PORT || '3463';
process.env.PORT = PORT;
process.env.SESSION_SECRET = 'test-secret-for-activity-phone-page';

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
// Phone queue: 45 unconfirmed open orders, id 1 (oldest) .. id 45 (newest).
const phoneRows = [];
for (let i = 1; i <= 45; i++) {
  phoneRows.push({
    id: i,
    customer_name: 'Caller ' + i,
    phone: '018100000' + String(i).padStart(2, '0'),
    total_amount: 100 + i,
    created_at: new Date(Date.now() - (46 - i) * 3600000),
  });
}
// Activity: 30 orders (id 71..100) created one minute apart, newest id 100;
// 20 history rows interleaved half a minute after every other order.
// Merged newest-first page 1: H1, O100, H2, O99, H3, O98, ... H10, O91.
const base = new Date();
base.setHours(0, 0, 0, 0);
const latestOrders = [];
for (let id = 71; id <= 100; id++) {
  latestOrders.push({
    id, customer_name: 'Buyer ' + id, total_amount: 200 + id,
    created_at: new Date(base.getTime() + (id - 70) * 60000),
  });
}
const historyRows = [];
for (let j = 1; j <= 20; j++) {
  historyRows.push({
    order_id: 200 + j, old_status: 'Pending', new_status: 'Confirmed', note: null,
    changed_by: 'admin@goince.com',
    created_at: new Date(base.getTime() + (31.5 - j) * 60000),
  });
}
// Dashboard fixture (regression): minimal rows the dashboard handler needs.
const pendingOrders = [
  { id: 1, customer_name: 'Test Customer', phone: '01800000000', total_amount: 1000, created_at: new Date() },
];
const categoryRows = [
  { id: 1, name: 'Root A', parent_id: null },
  { id: 2, name: 'Child A1', parent_id: 1 },
];
const categorySalesRows = [
  { category_id: 2, orderIds: '1', items: 2, revenue: 1000, cost: 600, profit: 400 },
  { category_id: 1, orderIds: '2', items: 1, revenue: 500, cost: 300, profit: 200 },
];
const topCustomerRows = [
  { phone: '01811111111', customer_name: 'Rahim', user_id: 7, orderCount: 2, totalSpent: 1500 },
];
const shippedRows = [
  { id: 20, customer_name: 'Ship One', phone: '01811111111', total_amount: 370, courier_name: 'Steadfast', tracking_number: 'TRK1', created_at: new Date(Date.now() - 5 * 86400000), shipped_at: new Date(Date.now() - 4 * 86400000) },
];

const ADMIN_EMAIL = 'admin@goince.com';
const STAFF_EMAIL = 'staff@goince.com';
const ADMIN_PASSWORD = 'admin123';
const adminHash = bcrypt.hashSync(ADMIN_PASSWORD, 8);

function rowsFor(sql, params) {
  const s = String(sql).replace(/\s+/g, ' ');
  const p = params || [];
  // --- global middleware (server.js) ---
  if (s.includes("setting_key = 'shop_phone'")) return [{ setting_value: '' }];
  if (s.includes('FROM settings WHERE setting_key IN')) return [];
  if (s.includes('COUNT(products.id) AS product_count')) return [];
  // --- admin login (role comes from the email, so staff can be tested) ---
  if (s.includes('FROM admins WHERE email = ?')) {
    return [{ id: 1, email: p[0], password: adminHash, role: p[0] === STAFF_EMAIL ? 'staff' : 'owner' }];
  }
  // --- /admin/activity: phone queue (COUNT first, then the page rows) ---
  if (s.includes('phone_confirmed') && s.includes('COUNT(*)')) return [{ c: 45 }];
  if (s.includes('phone_confirmed') && s.includes('LIMIT ? OFFSET ?')) {
    return phoneRows.slice(p[1], p[1] + p[0]);
  }
  // --- /admin/activity: activity totals ---
  if (s.includes('order_status_history') && s.includes('COUNT(*)')) return [{ c: 20 }];
  if (s === 'SELECT COUNT(*) AS c FROM orders') return [{ c: 30 }];
  // --- /admin/activity: activity sources (take = page * 20) ---
  if (s.includes('FROM order_status_history ORDER BY created_at DESC')) {
    return historyRows.slice(0, p[0]);
  }
  if (s.includes('FROM orders') && s.includes('ORDER BY created_at DESC, id DESC LIMIT ?')) {
    return latestOrders.slice().sort((a, b) => b.created_at - a.created_at).slice(0, p[0]);
  }
  // --- dashboard: shipped / category / top customers (checked before the
  //     generic dashboard branches below) ---
  if (s.includes("status = 'Shipped'")) return s.includes('COUNT(*)') ? [{ c: 1 }] : shippedRows;
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
  query: async (sql, params) => [rowsFor(sql, params)],
  execute: async (sql, params) => [rowsFor(sql, params)],
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
async function loginAs(email) {
  const login = await get('/admin/login');
  const csrf = (login.text.match(/name="_csrf" value="([^"]+)"/) || [])[1];
  return postForm('/admin/login', { email, password: ADMIN_PASSWORD, _csrf: csrf || '' });
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

function activityLocals(overrides) {
  return Object.assign({
    tab: 'phone', page: 1, totalPages: 3, totalCount: 45, perPage: 20,
    phoneTotal: 45, activityTotal: 50,
    phoneRows: phoneRows.slice(0, 2), activityRows: [],
    siteName: 'Goince',
    siteSettings: { logo_url: '/icons/icon-192.png' },
    adminRole: 'owner', csrfToken: 'test-csrf', assetUrl: (p) => p,
  }, overrides || {});
}
function dashboardLocals(overrides) {
  return Object.assign({
    totalProducts: 5, totalOrders: 5, totalRevenue: 2670, totalCustomers: 1,
    pendingOrders, todaysPendingCount: 1,
    lowStockProducts: [], lowStockCount: 0, outOfStockCount: 0,
    pendingDue: 0, pendingDueOrders: 0, pendingReviews: 0, unreadMessages: 0,
    todaysSummary: { ordersCount: 0, revenue: 0 },
    periodProfit: { totalProfit: 0, totalCost: 0, totalUnits: 0, costedUnits: 0 },
    dashboardCategorySales: [], topCustomers: [], shippedOrders: [], shippedTotal: 0,
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
    adminRole: 'owner', csrfToken: 'test-csrf', assetUrl: (p) => p,
  }, overrides || {});
}

(async () => {
  console.log('HTTP (stubbed DB, real server)');
  if (!(await waitForServer())) {
    console.log('FAIL  server did not start');
    process.exit(1);
  }

  // (4a) Unauthenticated access redirects to login.
  const anon = await get('/admin/activity');
  check('unauthenticated /admin/activity redirects to login',
    anon.status === 302 && String(anon.headers.get('location') || '').includes('/admin/login'),
    'got ' + anon.status + ' -> ' + anon.headers.get('location'));

  const doLogin = await loginAs(ADMIN_EMAIL);
  check('admin login POST redirects to dashboard', doLogin.status === 302 && String(doLogin.headers.get('location') || '').includes('/admin/dashboard'), 'got ' + doLogin.status + ' -> ' + doLogin.headers.get('location'));

  // (1) Phone tab: 20 per page, oldest first.
  const p1 = await get('/admin/activity');
  check('phone tab renders 200', p1.status === 200, 'got ' + p1.status);
  check('phone tab defaults to the phone tab', has(p1.text, 'Phone Confirmation Queue (45)'));
  check('phone page 1 shows the first 20 (ids 1–20)', has(p1.text, '#1') && has(p1.text, '#20') && !has(p1.text, '#21'));
  check('phone page 1 shows "Showing 1–20 of 45"', has(p1.text, 'showing 1–20 of 45'));
  check('phone page 1 has tel: Call links', has(p1.text, 'tel:01810000001') && has(p1.text, '📞 Call'));
  check('phone page 1 links rows to the order', has(p1.text, '/admin/orders/1'));
  check('phone page 1 has a Next link to page 2 (tab preserved)', has(p1.text, '/admin/activity?tab=phone&amp;page=2') || has(p1.text, '/admin/activity?tab=phone&page=2'));
  check('phone page 1 has no Prev link', !has(p1.text, 'page=0'));

  const p2 = await get('/admin/activity?tab=phone&page=2');
  check('phone page 2 renders 200', p2.status === 200, 'got ' + p2.status);
  check('phone page 2 shows ids 21–40', has(p2.text, '#21') && has(p2.text, '#40') && !has(p2.text, '#41'));
  check('phone page 2 shows "Showing 21–40 of 45"', has(p2.text, 'showing 21–40 of 45'));
  check('phone page 2 has a Prev link to page 1', has(p2.text, 'page=1'));

  const p3 = await get('/admin/activity?tab=phone&page=3');
  check('phone page 3 shows the last 5 (ids 41–45)', has(p3.text, '#41') && has(p3.text, '#45'));
  check('phone page 3 shows "Showing 41–45 of 45"', has(p3.text, 'showing 41–45 of 45'));
  check('phone page 3 has no Next link', !has(p3.text, 'page=4'));

  // (2) Activity tab: merged newest-first, 20 per page.
  const a1 = await get('/admin/activity?tab=activity');
  check('activity tab renders 200', a1.status === 200, 'got ' + a1.status);
  check('activity page 1 shows "Showing 1–20 of 50"', has(a1.text, 'showing 1–20 of 50'));
  check('activity merges newest first: history #201 before order #100',
    has(a1.text, 'Order #201 — Pending → Confirmed') && has(a1.text, 'Order #100 placed') &&
    a1.text.indexOf('Order #201 — Pending → Confirmed') < a1.text.indexOf('Order #100 placed'));
  check('activity page 1 orders #100 before #99', a1.text.indexOf('Order #100 placed') < a1.text.indexOf('Order #99 placed'));
  check('activity page 1 does not contain order #90 (page 2)', !has(a1.text, 'Order #90 placed'));
  check('activity rows link to the order', has(a1.text, '/admin/orders/100'));

  const a2 = await get('/admin/activity?tab=activity&page=2');
  check('activity page 2 shows order #90', has(a2.text, 'Order #90 placed'));
  check('activity page 2 does not contain order #100', !has(a2.text, 'Order #100 placed'));
  check('activity page 2 ends with history #220', has(a2.text, 'Order #220 — Pending → Confirmed'));
  check('activity page 2 shows "Showing 21–40 of 50"', has(a2.text, 'showing 21–40 of 50'));

  const a3 = await get('/admin/activity?tab=activity&page=3');
  check('activity page 3 shows the tail (order #71)', has(a3.text, 'Order #71 placed'));
  check('activity page 3 shows "Showing 41–50 of 50"', has(a3.text, 'showing 41–50 of 50'));

  // (3) Invalid page/tab values clamp safely.
  const badPage = await get('/admin/activity?tab=phone&page=abc');
  check('page=abc clamps to page 1', badPage.status === 200 && has(badPage.text, 'page 1 of 3'), 'got ' + badPage.status);
  const zeroPage = await get('/admin/activity?tab=phone&page=0');
  check('page=0 clamps to page 1', zeroPage.status === 200 && has(zeroPage.text, 'page 1 of 3'));
  const negPage = await get('/admin/activity?tab=phone&page=-5');
  check('page=-5 clamps to page 1', negPage.status === 200 && has(negPage.text, 'page 1 of 3'));
  const hugePage = await get('/admin/activity?tab=phone&page=999');
  check('page=999 clamps to the last page', hugePage.status === 200 && has(hugePage.text, 'page 3 of 3') && has(hugePage.text, '#45'), 'got ' + hugePage.status);
  const badTab = await get('/admin/activity?tab=bogus');
  check('bogus tab falls back to the phone tab', badTab.status === 200 && has(badTab.text, 'Phone Confirmation Queue (45)'));

  // (5) Dashboard: panels gone, link present, other panels stay.
  const dash = await get('/admin/dashboard');
  check('admin dashboard renders 200', dash.status === 200, 'got ' + dash.status);
  check('dashboard no longer shows the Recent activity panel', !has(dash.text, '<h2>Recent activity</h2>'));
  check('dashboard no longer shows the Phone confirmation queue panel', !has(dash.text, '<h2>Phone confirmation queue</h2>'));
  check('dashboard has the Calls & Activity quick link', has(dash.text, '/admin/activity') && has(dash.text, 'Calls &amp; Activity'));
  check('dashboard still shows Sales by category', has(dash.text, 'Sales by category'));
  check('dashboard still shows Top customers', has(dash.text, 'Top customers'));
  check('dashboard still shows Shipped — not delivered yet', has(dash.text, 'Shipped — not delivered yet'));
  check('dashboard still shows Pending COD / due', has(dash.text, 'Pending COD / due'));

  // (4b) Staff (ordersView) can open the page but not the dashboard.
  const staffLogin = await loginAs(STAFF_EMAIL);
  check('staff login POST redirects', staffLogin.status === 302, 'got ' + staffLogin.status);
  const staffPage = await get('/admin/activity');
  check('staff can open /admin/activity (ordersView)', staffPage.status === 200, 'got ' + staffPage.status);
  check('staff sidebar shows the Calls & Activity link', has(staffPage.text, '/admin/activity'));
  const staffDash = await get('/admin/dashboard');
  check('staff cannot open the dashboard (403)', staffDash.status === 403, 'got ' + staffDash.status);

  // Route + source checks.
  const adminJs = fs.readFileSync(path.join(__dirname, '..', 'routes', 'admin.js'), 'utf8');
  check("route /admin/activity uses requireRole('ordersView')",
    adminJs.includes("router.get('/activity', requireAdmin, requireRole('ordersView')"));
  check('route paginates at 20 per page', adminJs.includes('const PER_PAGE = 20'));
  check('route clamps the page number', adminJs.includes('Math.min(page, totalPages)'));
  check('dashboard handler no longer queries the phone queue', !adminJs.includes('phoneQueue'));
  check('dashboard handler no longer queries recent activity', !adminJs.includes('recentActivity'));
  const dashEjs = fs.readFileSync(path.join(__dirname, '..', 'views', 'admin', 'dashboard.ejs'), 'utf8');
  check('dashboard.ejs no longer mentions the two panels',
    !dashEjs.includes('Recent activity') && !dashEjs.includes('Phone confirmation queue'));
  const headerEjs = fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', 'admin-header.ejs'), 'utf8');
  check('sidebar links to /admin/activity under Sales', headerEjs.includes('/admin/activity'));

  // (6) Direct EJS render.
  console.log('Direct EJS render (activity.ejs + dashboard.ejs)');
  const renderFile = util.promisify(ejs.renderFile);
  const phoneHtml = await renderFile(path.join(__dirname, '..', 'views', 'admin', 'activity.ejs'), activityLocals());
  check('direct render: phone tab shows tel: links', has(phoneHtml, 'tel:01810000001'));
  check('direct render: phone tab shows "Showing 1–20 of 45"', has(phoneHtml, 'showing 1–20 of 45'));
  check('direct render: phone tab links to page 2 (tab preserved)', has(phoneHtml, 'tab=phone') && has(phoneHtml, 'page=2'));
  check('direct render: phone tab has no Prev on page 1', !has(phoneHtml, 'page=0'));
  const actHtml = await renderFile(path.join(__dirname, '..', 'views', 'admin', 'activity.ejs'), activityLocals({
    tab: 'activity', totalCount: 50,
    phoneRows: [], activityRows: [
      { kind: 'order', orderId: 100, text: 'Order #100 placed — ৳300', when: new Date() },
      { kind: 'status', orderId: 99, text: 'Order #99 — Pending → Confirmed', when: new Date() },
    ],
  }));
  check('direct render: activity tab shows merged rows', has(actHtml, 'Order #100 placed — ৳300') && has(actHtml, 'Order #99 — Pending → Confirmed'));
  check('direct render: activity tab links rows to orders', has(actHtml, '/admin/orders/100'));
  const emptyPhone = await renderFile(path.join(__dirname, '..', 'views', 'admin', 'activity.ejs'), activityLocals({
    totalCount: 0, totalPages: 1, phoneTotal: 0, activityTotal: 0, phoneRows: [],
  }));
  check('direct render: phone empty state', has(emptyPhone, 'All open orders are phone-confirmed.'));
  const emptyAct = await renderFile(path.join(__dirname, '..', 'views', 'admin', 'activity.ejs'), activityLocals({
    tab: 'activity', totalCount: 0, totalPages: 1, phoneTotal: 0, activityTotal: 0, activityRows: [],
  }));
  check('direct render: activity empty state', has(emptyAct, 'No recent activity yet.'));
  const dashHtml = await renderFile(path.join(__dirname, '..', 'views', 'admin', 'dashboard.ejs'), dashboardLocals());
  check('direct render: dashboard has no Recent activity panel', !has(dashHtml, '<h2>Recent activity</h2>'));
  check('direct render: dashboard has no Phone queue panel', !has(dashHtml, '<h2>Phone confirmation queue</h2>'));
  check('direct render: dashboard has the Calls & Activity link', has(dashHtml, '/admin/activity'));
  check('direct render: dashboard still has the other panels',
    has(dashHtml, 'Sales by category') && has(dashHtml, 'Top customers') && has(dashHtml, 'Shipped — not delivered yet'));

  console.log(`\n${passes.length} passed, ${failures.length} failed.`);
  if (failures.length) { console.log('Failures: ' + failures.join(', ')); process.exit(1); }
  process.exit(0);
})().catch((err) => {
  console.error('Test crashed:', err);
  process.exit(1);
});
