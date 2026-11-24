// Order status moved to the Orders page (fix/order-status-to-orders) —
// stubbed-DB smoke test.
//
// The dashboard "Order status" panel (period-scoped counts + all-time
// total) moved to the Orders page (/admin/invoices) as a clickable
// all-time summary: "All (N)" + one pill per status; clicking a pill
// filters the list by that status, "All" clears it. The dashboard no
// longer shows the panel; its Sales trend chart spans the full grid width.
// The /admin/orders redirect now preserves the query string, so
// /admin/orders?status=Pending lands on /admin/invoices?status=Pending
// (before, the status was silently dropped).
//
// No live MySQL needed: config/db is stubbed in the require cache, the real
// server.js + routers + EJS render over real HTTP on a throwaway port.
// Checks (scenario with hand-computed fixture values — 7 orders):
//   1. Unauthenticated GET /admin/invoices redirects to /admin/login.
//   2. Orders page renders 200 with the status summary: All (7), Pending 2,
//      Shipped 2, Confirmed 1, Delivered 1, Cancelled 1; all 7 rows shown.
//   3. ?status=Shipped shows only the 2 Shipped rows, the "Showing only
//      Shipped" note, the active (btn-primary) Shipped pill, and a clear
//      link; other statuses are absent.
//   4. ?status=Bogus is ignored — all 7 rows, no filter note.
//   5. ?tab=unpaid&status=Shipped composes both filters (1 row).
//   6. /admin/orders?status=Pending redirects to
//      /admin/invoices?status=Pending (query preserved); plain
//      /admin/orders redirects to /admin/invoices.
//   7. Tab links preserve an active status filter.
//   8. Dashboard renders 200 WITHOUT the Order status panel (no
//      <h2>Order status</h2>) but WITH the Sales trend chart and the other
//      panels; the dashboard "View pending orders" link still points at
//      /admin/orders?status=Pending.
//   9. Direct EJS render: invoices.ejs (full, empty, and no-new-locals
//      states; pagination links keep the status filter); dashboard.ejs
//      renders WITHOUT statusRows / totalOrders locals.
//  10. Route source: invoices handler has the all-time counts query +
//      status filter; dashboard.ejs has no Order status panel; CSS has the
//      pill + full-width chart rules, braces balanced.
//
// Run:  node scripts/test-order-status-to-orders.js
// Exit code 0 = all checks passed.
'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');
const util = require('util');
const ejs = require('ejs');
const bcrypt = require('bcryptjs');

const PORT = process.env.TEST_PORT || '3464';
process.env.PORT = PORT;
process.env.SESSION_SECRET = 'test-secret-for-order-status-to-orders';

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
// 7 orders: Pending 2, Confirmed 1, Shipped 2, Delivered 1, Cancelled 1.
const fixtureOrders = [
  { id: 1, customer_name: 'Asha', phone: '01810000001', status: 'Pending', payment_status: 'Unpaid', cod_collected: 0, total_amount: 1000, created_at: new Date('2026-11-20T10:00:00') },
  { id: 2, customer_name: 'Babul', phone: '01810000002', status: 'Pending', payment_status: 'Unpaid', cod_collected: 0, total_amount: 500, created_at: new Date('2026-11-21T10:00:00') },
  { id: 3, customer_name: 'Chadni', phone: '01810000003', status: 'Confirmed', payment_status: 'Unpaid', cod_collected: 0, total_amount: 370, created_at: new Date('2026-11-22T10:00:00') },
  { id: 4, customer_name: 'Delwar', phone: '01810000004', status: 'Shipped', payment_status: 'Paid', cod_collected: 0, total_amount: 990, created_at: new Date('2026-11-23T10:00:00') },
  { id: 5, customer_name: 'Ema', phone: '01810000005', status: 'Shipped', payment_status: 'Unpaid', cod_collected: 0, total_amount: 1250, created_at: new Date('2026-11-24T09:00:00') },
  { id: 6, customer_name: 'Farid', phone: '01810000006', status: 'Delivered', payment_status: 'Paid', cod_collected: 0, total_amount: 310, created_at: new Date('2026-11-24T10:00:00') },
  { id: 7, customer_name: 'Gita', phone: '01810000007', status: 'Cancelled', payment_status: 'Unpaid', cod_collected: 0, total_amount: 399, created_at: new Date('2026-11-24T11:00:00') },
];
const fixtureStatusCounts = [
  { status: 'Pending', count: 2 },
  { status: 'Shipped', count: 2 },
  { status: 'Confirmed', count: 1 },
  { status: 'Delivered', count: 1 },
  { status: 'Cancelled', count: 1 },
];
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
const ADMIN_PASSWORD = 'admin123';
const adminHash = bcrypt.hashSync(ADMIN_PASSWORD, 8);

// Apply the invoices list filters (tab literals + status param) to the fixture.
function invoiceFiltered(sql, params) {
  const s = String(sql);
  let rows = fixtureOrders.slice();
  if (s.includes("payment_status = 'Paid'")) rows = rows.filter(o => o.payment_status === 'Paid');
  if (s.includes("payment_status != 'Paid' AND status != 'Cancelled'")) rows = rows.filter(o => o.payment_status !== 'Paid' && o.status !== 'Cancelled');
  if (s.includes("status = 'Cancelled'")) rows = rows.filter(o => o.status === 'Cancelled');
  if (s.includes('status = ?')) rows = rows.filter(o => o.status === params[0]);
  rows.sort((a, b) => b.created_at - a.created_at);
  return rows;
}

function rowsFor(sql, params) {
  const s = String(sql).replace(/\s+/g, ' ');
  const p = params || [];
  // --- global middleware (server.js) ---
  if (s.includes("setting_key = 'shop_phone'")) return [{ setting_value: '' }];
  if (s.includes('FROM settings WHERE setting_key IN')) return [];
  if (s.includes('COUNT(products.id) AS product_count')) return [];
  // --- admin login ---
  if (s.includes('FROM admins WHERE email = ?')) {
    return [{ id: 1, email: p[0], password: adminHash, role: 'owner' }];
  }
  // --- invoices: all-time status counts (PR #49) ---
  if (s.includes('GROUP BY status')) return fixtureStatusCounts;
  // --- invoices: list count + rows (tab + status filters) ---
  if (s.includes('SELECT COUNT(*) AS cnt FROM orders')) return [{ cnt: invoiceFiltered(s, p).length }];
  if (s.includes('SELECT * FROM orders') && s.includes('ORDER BY created_at DESC LIMIT ? OFFSET ?')) {
    const limit = p[p.length - 2];
    const offset = p[p.length - 1];
    return invoiceFiltered(s, p).slice(offset, offset + limit);
  }
  // --- invoices: advances per order ---
  if (s.includes('FROM order_payments GROUP BY order_id')) return [];
  // --- dashboard: shipped / category / top customers ---
  if (s.includes("status = 'Shipped'")) return s.includes('COUNT(*)') ? [{ c: 1 }] : shippedRows;
  if (s.includes('SELECT id, name, parent_id FROM categories')) return categoryRows;
  if (s.includes('GROUP BY products.category_id')) return categorySalesRows;
  if (s.includes('GROUP BY phone')) return topCustomerRows;
  if (s.startsWith('SET SESSION group_concat_max_len')) return [];
  // --- dashboard: PR #45 missing-cards queries ---
  if (s.includes('cod_collected') && s.includes('FROM orders')) {
    return [{ id: 1, total_amount: 1000, payment_status: 'Unpaid', cod_collected: 0 }];
  }
  if (s.includes('DATE(created_at) = ?')) return [{ ordersCount: 1, revenue: 1000 }];
  if (s.includes('totalProfit')) return [{ totalCost: 500, totalProfit: 490, totalUnits: 3, costedUnits: 1 }];
  if (s.includes('FROM reviews WHERE status')) return [{ pending: 0 }];
  if (s.includes('is_read = 0')) return [{ unread: 0 }];
  // --- dashboard: existing queries ---
  if (s.includes('AS totalProducts')) return [{ totalProducts: 5 }];
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

function invoiceRowsForRender(rows) {
  return rows.map(o => ({
    ...o,
    invoiceNo: 'GOINCE-' + String(o.id).padStart(5, '0'),
    paid: o.payment_status === 'Paid' ? o.total_amount : 0,
    due: o.status === 'Cancelled' ? 0 : (o.payment_status === 'Paid' ? 0 : o.total_amount),
  }));
}
function invoicesLocals(overrides) {
  return Object.assign({
    rows: invoiceRowsForRender(fixtureOrders.slice().sort((a, b) => b.created_at - a.created_at)),
    tab: 'all', page: 1, totalPages: 1, totalCount: 7, perPage: 20,
    listMsg: null, listErr: null,
    statusRows: fixtureStatusCounts, statusFilter: '', totalOrdersAll: 7,
    siteName: 'Goince',
    siteSettings: { logo_url: '/icons/icon-192.png' },
    adminRole: 'owner', csrfToken: 'test-csrf', assetUrl: (p) => p,
  }, overrides || {});
}
function dashboardLocals(overrides) {
  // NOTE: no statusRows / totalOrders locals — the view must not need them
  // after PR #49.
  return Object.assign({
    totalProducts: 5, totalRevenue: 2670, totalCustomers: 1,
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

  // (1) Unauthenticated access redirects to login.
  const anon = await get('/admin/invoices');
  check('unauthenticated /admin/invoices redirects to login',
    anon.status === 302 && String(anon.headers.get('location') || '').includes('/admin/login'),
    'got ' + anon.status + ' -> ' + anon.headers.get('location'));

  const doLogin = await loginAs(ADMIN_EMAIL);
  check('admin login POST redirects to dashboard', doLogin.status === 302 && String(doLogin.headers.get('location') || '').includes('/admin/dashboard'), 'got ' + doLogin.status + ' -> ' + doLogin.headers.get('location'));

  // (2) Orders page: status summary with all-time counts, all rows shown.
  const all = await get('/admin/invoices');
  check('orders page renders 200', all.status === 200, 'got ' + all.status);
  check('orders page has the Order status summary heading', has(all.text, '>Order status</h2>'));
  check('summary labels the counts as all-time', has(all.text, 'All-time orders by status'));
  check('summary shows All (7)', />All <strong>7<\/strong>/.test(all.text), 'All pill not found with 7');
  check('summary shows Pending 2', has(all.text, 'Pending <strong>2</strong>'));
  check('summary shows Shipped 2', has(all.text, 'Shipped <strong>2</strong>'));
  check('summary shows Confirmed 1', has(all.text, 'Confirmed <strong>1</strong>'));
  check('summary shows Delivered 1', has(all.text, 'Delivered <strong>1</strong>'));
  check('summary shows Cancelled 1', has(all.text, 'Cancelled <strong>1</strong>'));
  check('orders page shows all 7 invoice rows', has(all.text, 'GOINCE-00001') && has(all.text, 'GOINCE-00007'));
  check('orders page still has the payment tabs', has(all.text, 'tab=paid') && has(all.text, 'tab=unpaid') && has(all.text, 'tab=cancelled'));
  check('summary pills link to the status filter', has(all.text, 'status=Shipped') && has(all.text, 'status=Pending'));
  check('count line shows 7 invoice(s)', has(all.text, '<strong>7</strong> invoice(s)'));

  // (3) Clicking a status filters the list.
  const shipped = await get('/admin/invoices?status=Shipped');
  check('?status=Shipped renders 200', shipped.status === 200, 'got ' + shipped.status);
  check('?status=Shipped shows only the 2 Shipped rows',
    has(shipped.text, 'GOINCE-00004') && has(shipped.text, 'GOINCE-00005') &&
    !has(shipped.text, 'GOINCE-00001') && !has(shipped.text, 'GOINCE-00006') && !has(shipped.text, 'GOINCE-00007'));
  check('?status=Shipped count line says 2 invoice(s) with status Shipped',
    has(shipped.text, '<strong>2</strong> invoice(s) with status Shipped'));
  check('?status=Shipped shows the filter note + clear link',
    has(shipped.text, 'Showing only') && has(shipped.text, 'show all orders'));
  check('?status=Shipped pill is the active (btn-primary) one',
    has(shipped.text, 'status=Shipped" class="order-status-pill btn-primary'));
  check('?status=Shipped leaves other pills inactive (btn-secondary)',
    has(shipped.text, 'status=Pending" class="order-status-pill btn-secondary'));

  // (4) A bogus status is ignored, not an empty list.
  const bogus = await get('/admin/invoices?status=Bogus');
  check('?status=Bogus renders 200', bogus.status === 200, 'got ' + bogus.status);
  check('?status=Bogus shows all 7 rows (filter ignored)',
    has(bogus.text, 'GOINCE-00001') && has(bogus.text, 'GOINCE-00007'));
  check('?status=Bogus shows no filter note', !has(bogus.text, 'Showing only'));

  // (5) Tab + status compose.
  const unpaidShipped = await get('/admin/invoices?tab=unpaid&status=Shipped');
  check('?tab=unpaid&status=Shipped shows only the unpaid Shipped row',
    has(unpaidShipped.text, 'GOINCE-00005') && !has(unpaidShipped.text, 'GOINCE-00004'));
  check('?tab=unpaid&status=Shipped count line says 1 invoice(s)',
    has(unpaidShipped.text, '<strong>1</strong> invoice(s) with status Shipped'));

  // (6) /admin/orders redirect preserves the query string.
  const redirStatus = await get('/admin/orders?status=Pending');
  check('/admin/orders?status=Pending redirects to /admin/invoices?status=Pending',
    redirStatus.status === 302 && String(redirStatus.headers.get('location') || '') === '/admin/invoices?status=Pending',
    'got ' + redirStatus.status + ' -> ' + redirStatus.headers.get('location'));
  const redirPlain = await get('/admin/orders');
  check('/admin/orders redirects to /admin/invoices',
    redirPlain.status === 302 && String(redirPlain.headers.get('location') || '') === '/admin/invoices',
    'got ' + redirPlain.status + ' -> ' + redirPlain.headers.get('location'));

  // (7) Tab links preserve an active status filter.
  const pending = await get('/admin/invoices?status=Pending');
  check('tab links preserve the active status filter',
    has(pending.text, 'tab=paid&amp;status=Pending') || has(pending.text, 'tab=paid&status=Pending'));

  // (8) Dashboard: no Order status panel, other panels intact.
  const dash = await get('/admin/dashboard');
  check('dashboard renders 200', dash.status === 200, 'got ' + dash.status);
  check('dashboard has NO Order status panel', !has(dash.text, '<h2>Order status</h2>'));
  check('dashboard still has the Sales trend chart', has(dash.text, 'Sales trend'));
  check('dashboard still has Top-selling products', has(dash.text, 'Top-selling products'));
  check('dashboard still has Recent pending orders', has(dash.text, 'Recent pending orders'));
  check('dashboard "View pending orders" link still points at /admin/orders?status=Pending',
    has(dash.text, '/admin/orders?status=Pending'));

  // (9) Direct EJS renders.
  console.log('Direct EJS renders');
  const render = util.promisify(ejs.renderFile);
  const invoicesPath = path.join(__dirname, '..', 'views', 'admin', 'invoices.ejs');
  const dashboardPath = path.join(__dirname, '..', 'views', 'admin', 'dashboard.ejs');

  const invFull = await render(invoicesPath, invoicesLocals());
  check('invoices.ejs renders (full state)', invFull.includes('Order status') && invFull.includes('GOINCE-00001'));
  check('invoices.ejs active status pill renders btn-primary',
    (await render(invoicesPath, invoicesLocals({ statusFilter: 'Pending', rows: invoiceRowsForRender(fixtureOrders.filter(o => o.status === 'Pending')), totalCount: 2 })))
      .includes('status=Pending" class="order-status-pill btn-primary'));
  const invEmpty = await render(invoicesPath, invoicesLocals({ rows: [], totalCount: 0, statusRows: [], totalOrdersAll: 0 }));
  check('invoices.ejs renders empty state (no rows, no statuses)',
    invEmpty.includes('No invoices in this view.') && invEmpty.includes('All <strong>0</strong>'));
  const invNoLocals = await render(invoicesPath, invoicesLocals({ statusRows: undefined, statusFilter: undefined, totalOrdersAll: undefined }));
  check('invoices.ejs renders without the new locals (typeof guards)',
    invNoLocals.includes('Order status') && invNoLocals.includes('GOINCE-00001'));
  const invPaged = await render(invoicesPath, invoicesLocals({ page: 2, totalPages: 3, totalCount: 45, statusFilter: 'Shipped' }));
  check('invoices.ejs pagination links keep the status filter',
    (invPaged.includes('page=1&amp;status=Shipped') || invPaged.includes('page=1&status=Shipped')) &&
    (invPaged.includes('page=3&amp;status=Shipped') || invPaged.includes('page=3&status=Shipped')));

  const dashHtml = await render(dashboardPath, dashboardLocals());
  check('dashboard.ejs renders without statusRows/totalOrders locals', dashHtml.includes('Sales trend'));
  check('dashboard.ejs has no Order status panel', !dashHtml.includes('<h2>Order status</h2>'));

  // (10) Route + view + CSS source checks.
  console.log('Source checks');
  const adminJs = fs.readFileSync(path.join(__dirname, '..', 'routes', 'admin.js'), 'utf8');
  check('invoices handler has the all-time status counts query',
    adminJs.includes('SELECT status, COUNT(*) AS count FROM orders GROUP BY status ORDER BY count DESC'));
  check('invoices handler validates the status filter against known statuses',
    adminJs.includes('statusFilter') && adminJs.includes('allowedStatuses'));
  check('invoices handler passes statusRows/statusFilter/totalOrdersAll to the view',
    adminJs.includes('statusRows, statusFilter, totalOrdersAll'));
  check('/admin/orders redirect preserves the query string',
    adminJs.includes("res.redirect('/admin/invoices' + qs)"));
  check('dashboard handler no longer queries statusRows',
    !adminJs.includes("GROUP BY status ORDER BY count DESC', [from, to]"));
  const dashEjs = fs.readFileSync(dashboardPath, 'utf8');
  check('dashboard.ejs has no Order status panel', !dashEjs.includes('<h2>Order status</h2>'));
  const invEjs = fs.readFileSync(invoicesPath, 'utf8');
  check('invoices.ejs has the status summary section', invEjs.includes('order-status-pill') && invEjs.includes('All-time orders by status'));
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'style.css'), 'utf8');
  check('CSS has the order-status-pill rule', css.includes('.order-status-pill'));
  check('CSS lets a lone chart span the full grid width', css.includes('.analytics-main-grid > .analytics-chart-panel:only-child'));
  check('CSS braces are balanced', (css.match(/{/g) || []).length === (css.match(/}/g) || []).length);

  console.log(`\n${passes.length} passed, ${failures.length} failed`);
  if (failures.length) { console.log('Failures:', failures.join(', ')); process.exit(1); }
  process.exit(0);
})().catch((err) => {
  console.error('Test crashed:', err);
  process.exit(1);
});
