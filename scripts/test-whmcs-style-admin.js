// WHMCS-style admin (fix/whmcs-style-admin) — stubbed-DB smoke test.
//
// Top bar (global search + notifications bell + admin menu), collapsible
// sidebar with badges, breadcrumb, dashboard "attention first" order,
// customer profile tabs, ticket-style contact messages.
//
// No live MySQL needed: config/db is stubbed in the require cache, the real
// server.js + routers + EJS render over real HTTP on a throwaway port.
// Checks:
//   1. Shell: every admin page has the top bar (search, bell + badge, admin
//      menu), the grouped sidebar (collapsible buttons + badges) and the
//      breadcrumb; staff sees only their own sidebar items.
//   2. Global search: orders (by number/phone), customers, products; a
//      staff admin never sees customer results (no customers.manage).
//   3. Dashboard: Needs attention + quick actions come BEFORE the KPI grid;
//      phone queue row present; all existing cards still present.
//   4. Customer detail: tabs Overview/Orders/Messages/Notes; note saves.
//   5. Messages: status filter pills, detail page, reply marks Answered,
//      status change works, read marks Answered.
//   6. Source checks: convention comment, CSS rules, permission registry
//      (26 permissions — feat/retention added campaigns.manage,
//      feat/admin-ops added analytics.view, audit.view, flash-offers.manage).
//
// Run:  node scripts/test-whmcs-style-admin.js
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
process.env.SESSION_SECRET = 'test-secret-for-whmcs-style-admin';

// ---------- checks ----------
const failures = [];
const passes = [];
function check(name, ok, detail) {
  if (ok) { passes.push(name); console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}
function has(html, needle) { return html.includes(needle); }

// ---------- fixture (stateful where the test mutates it) ----------
const ADMIN_EMAIL = 'admin@goince.com';
const STAFF_EMAIL = 'staff@goince.com';
const ADMIN_PASSWORD = 'admin123';
const adminHash = bcrypt.hashSync(ADMIN_PASSWORD, 8);

const customerRow = { id: 1, name: 'Rohim', email: 'rohim@example.com', phone: '01810000001', address: 'Dhaka', is_blocked: 0, created_at: new Date('2026-11-01'), notes: null };
const customerOrders = [
  { id: 35, user_id: 1, customer_name: 'Rohim', phone: '01810000001', total_amount: 370, status: 'Pending', payment_status: 'Unpaid', created_at: new Date('2026-11-20') },
  { id: 36, user_id: 1, customer_name: 'Rohim', phone: '01810000001', total_amount: 990, status: 'Delivered', payment_status: 'Paid', created_at: new Date('2026-11-10') },
];
const messageRows = [
  { id: 1, name: 'Rohim', email: 'rohim@example.com', phone: '01810000001', subject: 'Delivery?', message: 'When will my order arrive?', status: 'open', is_read: 0, reply: null, replied_at: null, created_at: new Date('2026-11-21') },
  { id: 2, name: 'Karim', email: 'karim@example.com', phone: '01810000002', subject: 'Price', message: 'Is the watch waterproof?', status: 'answered', is_read: 1, reply: 'Yes, splash-proof.', replied_at: new Date('2026-11-22'), created_at: new Date('2026-11-20') },
];
const chatRows = [
  { id: 7, customer_name: 'Rohim', user_id: 1, last_message_at: new Date('2026-11-21'), created_at: new Date('2026-11-21') },
];
const productRows = [
  { id: 3, name: 'BINBOND 2521 Watch', price: 990, stock: 15 },
  { id: 4, name: 'Food Chopper', price: 999, stock: 8 },
];

function rowsFor(sql, params) {
  const s = String(sql).replace(/\s+/g, ' ');
  const p = params || [];
  // --- global middleware (server.js) ---
  if (s.includes("setting_key = 'shop_phone'")) return [{ setting_value: '' }];
  if (s.includes('FROM settings WHERE setting_key IN')) return [];
  if (s.includes('COUNT(products.id) AS product_count')) return [];
  // --- admin login ---
  if (s.includes('FROM admins WHERE email = ?')) {
    return [{ id: 1, email: p[0], password: adminHash, role: p[0] === STAFF_EMAIL ? 'staff' : 'owner', role_id: null }];
  }
  if (s.includes('FROM roles WHERE id = ?')) return [];
  if (s.includes('FROM roles WHERE name = ?')) return [];
  // --- WHMCS shell: notification counts (run on every admin GET) ---
  if (s.includes("status = 'Pending'") && s.includes('COUNT(*)')) return [{ c: 1 }];
  if (s.includes('phone_confirmed') && s.includes('COUNT(*)')) return [{ c: 2 }];
  if (s.includes('is_read = 0')) return [{ c: 3, unread: 3 }];
  if (s.includes('FROM reviews WHERE status')) return [{ c: 2, pending: 2 }];
  if (s.includes("status NOT IN ('Delivered', 'Cancelled')")) return [{ c: 5 }];
  // --- global search ---
  if (s.includes('FROM orders WHERE id = ?')) return customerOrders.filter(o => o.id === Number(p[0]));
  if (s.includes('FROM orders WHERE phone LIKE ?')) return customerOrders.filter(o => String(o.phone).includes(String(p[0]).replace(/%/g, '')));
  if (s.includes('FROM users WHERE name LIKE ?')) {
    const needle = String(p[0]).replace(/%/g, '').toLowerCase();
    return [customerRow].filter(u => u.name.toLowerCase().includes(needle) || String(u.phone).includes(needle) || u.email.toLowerCase().includes(needle));
  }
  if (s.includes('FROM products WHERE name LIKE ?')) {
    const needle = String(p[0]).replace(/%/g, '').toLowerCase();
    return productRows.filter(pr => pr.name.toLowerCase().includes(needle));
  }
  // --- customer detail ---
  if (s.includes('FROM users WHERE id = ?')) return [Object.assign({}, customerRow)];
  if (s.includes('UPDATE users SET notes = ?')) { customerRow.notes = p[0]; return [{ affectedRows: 1 }]; }
  if (s.includes('FROM orders WHERE user_id = ?')) return customerOrders;
  if (s.includes('FROM wishlist WHERE user_id = ?')) return [{ wishlistCount: 1 }];
  if (s.includes('FROM contact_messages WHERE email = ? OR phone = ?')) return messageRows.filter(m => m.email === p[0] || m.phone === p[1]);
  if (s.includes('FROM chat_conversations WHERE user_id = ?')) return chatRows;
  // --- messages (ticket-style) ---
  if (s.includes('FROM contact_messages WHERE status = ?')) return messageRows.filter(m => m.status === p[0]);
  if (s.includes('FROM contact_messages ORDER BY')) return messageRows.slice();
  if (s.includes('SELECT status, COUNT(*) AS c FROM contact_messages GROUP BY status')) {
    return ['open', 'answered', 'closed'].map(st => ({ status: st, c: messageRows.filter(m => m.status === st).length }));
  }
  if (s.includes('FROM contact_messages WHERE id = ?')) return messageRows.filter(m => m.id === Number(p[0]));
  if (s.includes("SET reply = ?, replied_at = NOW(), status = 'answered'")) {
    const m = messageRows.find(r => r.id === Number(p[1]));
    if (m) { m.reply = p[0]; m.replied_at = new Date(); m.status = 'answered'; m.is_read = 1; }
    return [{ affectedRows: 1 }];
  }
  if (s.includes('SET status = ?, is_read = ? WHERE id = ?')) {
    const m = messageRows.find(r => r.id === Number(p[2]));
    if (m) { m.status = p[0]; m.is_read = p[1]; }
    return [{ affectedRows: 1 }];
  }
  if (s.includes("status = CASE WHEN status = 'open' THEN 'answered'")) {
    const m = messageRows.find(r => r.id === Number(p[0]));
    if (m) { m.is_read = 1; if (m.status === 'open') m.status = 'answered'; }
    return [{ affectedRows: 1 }];
  }
  if (s.includes('DELETE FROM contact_messages WHERE id = ?')) {
    const i = messageRows.findIndex(r => r.id === Number(p[0]));
    if (i >= 0) messageRows.splice(i, 1);
    return [{ affectedRows: 1 }];
  }
  // --- dashboard (minimal fixture — empty data still renders every card) ---
  if (s.includes('AS totalProducts')) return [{ totalProducts: 5 }];
  if (s.includes('AS totalRevenue')) return [{ totalRevenue: 2670 }];
  if (s.includes('AS totalCustomers')) return [{ totalCustomers: 1 }];
  if (s.includes("status = 'Pending' ORDER BY created_at DESC LIMIT 5")) return customerOrders.slice(0, 1);
  if (s.includes('CURDATE()')) return [{ c: 1 }];
  if (s.includes('cod_collected') && s.includes('FROM orders')) return [{ id: 35, total_amount: 370, payment_status: 'Unpaid', cod_collected: 0 }];
  if (s.includes('FROM order_payments GROUP BY order_id')) return [];
  if (s.includes('DATE(created_at) = ?')) return [{ ordersCount: 1, revenue: 370 }];
  if (s.includes('totalProfit')) return [{ totalCost: 0, totalProfit: 0, totalUnits: 0, costedUnits: 0 }];
  if (s.includes('SELECT id, name, parent_id FROM categories')) return [];
  if (s.includes('GROUP BY products.category_id')) return [];
  if (s.includes('GROUP BY phone')) return [];
  if (s.startsWith('SET SESSION group_concat_max_len')) return [];
  if (s.includes("status = 'Shipped'")) return s.includes('COUNT(*)') ? [{ c: 0 }] : [];
  if (s.includes('ORDER BY stock ASC LIMIT 5')) return [];
  if (s.includes('AND stock > 0')) return [{ lowStockCount: 0 }];
  if (s.includes('stock = 0')) return [{ outOfStockCount: 0 }];
  if (s.includes('AS collectedRevenue')) return [{ ordersCount: 1, revenue: 370, avgOrderValue: 370, collectedRevenue: 0 }];
  if (s.includes('AS revenue FROM orders')) return [{ ordersCount: 0, revenue: 0 }];
  if (s.includes('newCustomers')) return [{ newCustomers: 0 }];
  if (s.includes('AS day')) return [];
  if (s.includes('unitsSold')) return [];
  // --- startup content fixes / misc ---
  if (s.startsWith('UPDATE settings SET setting_value') || s.startsWith('UPDATE products SET name')) return [{ affectedRows: 0 }];
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
  const r = await postForm('/admin/login', { email, password: ADMIN_PASSWORD, _csrf: csrf || '' });
  return { login: r, csrf: csrf || '' };
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
  console.log('HTTP (stubbed DB, real server)');
  if (!(await waitForServer())) {
    console.log('FAIL  server did not start');
    process.exit(1);
  }

  // ---------- (1) Shell — owner dashboard ----------
  const anon = await get('/admin/dashboard');
  check('unauthenticated /admin/dashboard redirects to login',
    anon.status === 302 && String(anon.headers.get('location') || '').includes('/admin/login'),
    'got ' + anon.status);

  const owner = await loginAs(ADMIN_EMAIL);
  check('owner login POST redirects to dashboard',
    owner.login.status === 302 && String(owner.login.headers.get('location') || '').includes('/admin/dashboard'),
    'got ' + owner.login.status + ' -> ' + owner.login.headers.get('location'));
  const csrf = owner.csrf;

  const dash = await get('/admin/dashboard');
  check('dashboard renders 200', dash.status === 200, 'got ' + dash.status);
  check('top bar present (admin-topbar + search form + bell + user menu)',
    has(dash.text, 'admin-topbar') && has(dash.text, 'action="/admin/search"') &&
    has(dash.text, 'admin-bell-btn') && has(dash.text, 'admin-user-btn'),
    'top bar pieces missing');
  // feat/admin-ops: the bell total now also counts unread live-chat
  // messages (0 in this fixture) + pending return/cancel requests
  // (1 here — the stub returns 1 for the order_returns count, the
  // same fixture pattern as the 1 pending order).
  check('bell badge shows total 9 (1 pending + 2 queue + 3 unread + 2 reviews + 0 unread chats + 1 pending return)',
    has(dash.text, 'admin-bell-badge">9'), 'badge not found');
  check('bell menu lists pending orders, phone queue and unread messages',
    has(dash.text, '/admin/orders?status=Pending') && has(dash.text, '/admin/activity') &&
    has(dash.text, '/admin/messages') && has(dash.text, 'waiting for a phone call'));
  check('sidebar groups are collapsible buttons (Shop/Sales/Communication/System)',
    has(dash.text, 'admin-nav-group-btn') && has(dash.text, 'data-nav-group="shop"') &&
    has(dash.text, 'data-nav-group="sales"') && has(dash.text, 'data-nav-group="communication"') &&
    has(dash.text, 'data-nav-group="system"'));
  check('sidebar badges present (Orders 5, Activity 2, Messages 3, Reviews 2)',
    has(dash.text, 'admin-nav-badge">5') && has(dash.text, 'admin-nav-badge">2') && has(dash.text, 'admin-nav-badge">3'));
  check('breadcrumb present on dashboard', has(dash.text, 'admin-breadcrumb'));

  // ---------- (2) Global search ----------
  const sNum = await get('/admin/search?q=35');
  check('search by order number finds order #35', sNum.status === 200 && has(sNum.text, '#35'), 'got ' + sNum.status);
  const sPhone = await get('/admin/search?q=01810000001');
  check('search by phone finds the order and the customer',
    has(sPhone.text, '#35') && has(sPhone.text, 'Rohim') && has(sPhone.text, '/admin/customers/1'));
  const sProd = await get('/admin/search?q=Watch');
  check('search by product name finds the product', has(sProd.text, 'BINBOND 2521 Watch') && has(sProd.text, '/admin/products/edit/3'));
  const sEmpty = await get('/admin/search');
  check('search without a query shows the hint', has(sEmpty.text, 'Type an order number'));

  // ---------- (3) Dashboard order: attention first, then KPIs ----------
  check('Needs attention comes BEFORE the KPI grid',
    dash.text.indexOf('Needs attention') > 0 && dash.text.indexOf('Needs attention') < dash.text.indexOf('analytics-kpi-grid'));
  check('quick actions come before the KPI grid too',
    dash.text.indexOf('admin-quick-links') > 0 && dash.text.indexOf('admin-quick-links') < dash.text.indexOf('analytics-kpi-grid'));
  check('phone queue row in attention panel',
    has(dash.text, '2 order(s) waiting for a phone call') && has(dash.text, '/admin/activity'));
  check('all existing dashboard cards still present',
    has(dash.text, 'Pending COD / due') && has(dash.text, "Today's revenue") &&
    has(dash.text, 'Profit in period') && has(dash.text, 'Sales revenue') &&
    has(dash.text, 'Sales trend') && has(dash.text, 'Top-selling products') &&
    has(dash.text, 'Recent pending orders') && has(dash.text, 'Sales by category') &&
    has(dash.text, 'Top customers') && has(dash.text, 'Shipped — not delivered yet'));

  // ---------- (4) Customer detail tabs ----------
  const cust = await get('/admin/customers/1');
  check('customer detail renders 200 with tabs', cust.status === 200 && has(cust.text, 'admin-tabs') &&
    has(cust.text, 'tab=overview') && has(cust.text, 'tab=orders') && has(cust.text, 'tab=messages') && has(cust.text, 'tab=notes'),
    'got ' + cust.status);
  check('overview tab shows profile + stats', has(cust.text, 'rohim@example.com') && has(cust.text, 'Total Spent'));
  const custOrders = await get('/admin/customers/1?tab=orders');
  check('orders tab shows the customer order history', has(custOrders.text, '#35') && has(custOrders.text, '/admin/orders/35'));
  const custMsgs = await get('/admin/customers/1?tab=messages');
  check('messages tab shows contact message + live chat',
    has(custMsgs.text, 'When will my order arrive?') && has(custMsgs.text, '/admin/chats/7'));
  const notePost = await postForm('/admin/customers/1/notes', { notes: 'Prefers evening delivery.', _csrf: csrf });
  check('saving a note redirects back to the notes tab',
    notePost.status === 302 && String(notePost.headers.get('location') || '').includes('tab=notes'),
    'got ' + notePost.status + ' -> ' + notePost.headers.get('location'));
  const custNotes = await get('/admin/customers/1?tab=notes');
  check('saved note is shown on the notes tab', has(custNotes.text, 'Prefers evening delivery.'));

  // ---------- (5) Messages as tickets ----------
  const msgs = await get('/admin/messages');
  check('messages list renders 200 with status filter pills',
    msgs.status === 200 && has(msgs.text, 'status=open') && has(msgs.text, 'status=answered') &&
    has(msgs.text, 'status=closed') && has(msgs.text, 'Open (1)') && has(msgs.text, 'Answered (1)'),
    'got ' + msgs.status);
  check('messages list shows status badges and View links',
    has(msgs.text, 'status-pending') && has(msgs.text, '/admin/messages/1') && has(msgs.text, '/admin/messages/2'));
  const msgsOpen = await get('/admin/messages?status=open');
  check('open filter shows only the open message', has(msgsOpen.text, 'When will my order arrive?') && !has(msgsOpen.text, 'Is the watch waterproof?'));
  const msgDetail = await get('/admin/messages/1');
  check('message detail renders with reply + status forms',
    msgDetail.status === 200 && has(msgDetail.text, 'Save Reply') && has(msgDetail.text, 'Change Status') && has(msgDetail.text, 'When will my order arrive?'),
    'got ' + msgDetail.status);
  const replyPost = await postForm('/admin/messages/1/reply', { reply: 'Called, confirmed tomorrow.', _csrf: csrf });
  check('reply POST redirects to the detail page',
    replyPost.status === 302 && String(replyPost.headers.get('location') || '').includes('/admin/messages/1'),
    'got ' + replyPost.status);
  const msgDetail2 = await get('/admin/messages/1');
  check('saved reply is shown and status is Answered',
    has(msgDetail2.text, 'Called, confirmed tomorrow.') && has(msgDetail2.text, '>answered<'));
  const statusPost = await postForm('/admin/messages/1/status', { status: 'closed', _csrf: csrf });
  check('status change POST redirects to the detail page', statusPost.status === 302, 'got ' + statusPost.status);
  const msgsClosed = await get('/admin/messages?status=closed');
  check('closed filter now shows message #1', has(msgsClosed.text, 'When will my order arrive?'));
  const readPost = await postForm('/admin/messages/2/read', { _csrf: csrf });
  check('mark-read POST redirects to the list', readPost.status === 302, 'got ' + readPost.status);

  // ---------- (6) Staff permissions ----------
  const staff = await loginAs(STAFF_EMAIL);
  check('staff login POST redirects (to first allowed page)',
    staff.login.status === 302 && String(staff.login.headers.get('location') || '').includes('/admin/'),
    'got ' + staff.login.status);
  const staffDash = await get('/admin/dashboard');
  check('staff cannot open the dashboard (403)', staffDash.status === 403, 'got ' + staffDash.status);
  const staffProducts = await get('/admin/products');
  check('staff products page renders 200', staffProducts.status === 200, 'got ' + staffProducts.status);
  check('staff sidebar hides Settings, Staff, Messages, Customers',
    !has(staffProducts.text, '/admin/settings') && !has(staffProducts.text, '/admin/staff') &&
    !has(staffProducts.text, '/admin/messages') && !has(staffProducts.text, '/admin/customers'));
  check('staff sidebar still shows Products, Orders, Activity',
    has(staffProducts.text, '/admin/products') && has(staffProducts.text, '/admin/invoices') && has(staffProducts.text, '/admin/activity'));
  check('staff breadcrumb/brand never link to the dashboard they cannot open',
    !has(staffProducts.text, 'href="/admin/dashboard"') && has(staffProducts.text, 'href="/admin/orders"'));
  check('staff bell has no unread-messages row', !has(staffProducts.text, 'unread message'));
  const staffSearch = await get('/admin/search?q=Rohim');
  check('staff search never shows customer results', !has(staffSearch.text, 'Customers (') && !has(staffSearch.text, '/admin/customers/1'));
  const staffSearchPhone = await get('/admin/search?q=01810000001');
  check('staff search still shows order results (by phone)', has(staffSearchPhone.text, '#35') && !has(staffSearchPhone.text, '/admin/customers/1'));
  const staffCust = await get('/admin/customers/1');
  check('staff cannot open customer detail (403)', staffCust.status === 403, 'got ' + staffCust.status);
  const staffMsgs = await get('/admin/messages');
  check('staff cannot open messages (403)', staffMsgs.status === 403, 'got ' + staffMsgs.status);
  const staffRoles = await get('/admin/roles');
  check('staff cannot open roles (403)', staffRoles.status === 403, 'got ' + staffRoles.status);

  // ---------- (7) Source + CSS + direct renders ----------
  const headerSrc = fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', 'admin-header.ejs'), 'utf8');
  check('header partial carries the shell convention comment',
    headerSrc.includes('WHMCS-style admin shell') && headerSrc.includes('CONVENTION'));
  check('header partial has top bar, bell, breadcrumb and collapsible groups',
    headerSrc.includes('admin-topbar') && headerSrc.includes('admin-bell-btn') &&
    headerSrc.includes('admin-breadcrumb') && headerSrc.includes('admin-nav-group-btn'));
  const { ALL_PERMISSIONS } = require('../lib/permissions');
  check('permission registry has 26 permissions (23 + analytics.view + audit.view + flash-offers.manage, feat/admin-ops)',
    ALL_PERMISSIONS.length === 26, 'got ' + ALL_PERMISSIONS.length);
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'style.css'), 'utf8');
  check('CSS has the shell rules (topbar, bell badge, nav badge, breadcrumb, tabs)',
    css.includes('.admin-topbar') && css.includes('.admin-bell-badge') && css.includes('.admin-nav-badge') &&
    css.includes('.admin-breadcrumb') && css.includes('.admin-tab') && css.includes('.admin-topbar-search.open'));
  check('CSS braces balanced', (css.match(/{/g) || []).length === (css.match(/}/g) || []).length);

  // Direct EJS renders with OLD locals (no new locals) must still work.
  const renderFile = util.promisify(ejs.renderFile);
  const viewPath = (name) => path.join(__dirname, '..', 'views', 'admin', name + '.ejs');
  const oldBase = {
    siteName: 'Goince',
    siteSettings: { logo_url: '/icons/icon-192.png', favicon_url: '/icons/icon-192.png' },
    adminRole: 'owner', csrfToken: 'test-csrf', assetUrl: (p) => p,
  };
  const dashOld = await renderFile(viewPath('dashboard'), Object.assign({}, oldBase, {
    totalProducts: 5, totalOrders: 5, totalRevenue: 100, totalCustomers: 1,
    pendingOrders: [], todaysPendingCount: 0, lowStockProducts: [], lowStockCount: 0, outOfStockCount: 0,
    pendingDue: 0, pendingDueOrders: 0, pendingReviews: 0, unreadMessages: 0,
    todaysSummary: { ordersCount: 0, revenue: 0 },
    periodProfit: { totalProfit: 0, totalCost: 0, totalUnits: 0, costedUnits: 0 },
    dashboardCategorySales: [], topCustomers: [], shippedOrders: [], shippedTotal: 0,
    dashboard: {
      range: '30', from: '2026-10-26', to: '2026-11-24', prevFrom: '', prevTo: '',
      currentSummary: { ordersCount: 0, revenue: 0, avgOrderValue: 0, collectedRevenue: 0 },
      previousSummary: { ordersCount: 0, revenue: 0 }, newCustomers: 0,
      salesTrend: [], topProducts: [], revenueChange: null, maxTrendRevenue: 1,
    },
  }));
  check('direct render: dashboard with old locals (no phoneQueueCount) still works',
    dashOld.includes('Needs attention') && dashOld.includes('admin-topbar'));
  const msgsOld = await renderFile(viewPath('messages'), Object.assign({}, oldBase, {
    messages: [{ id: 1, name: 'Rohim', email: 'r@example.com', phone: '01810000001', subject: 'Hi', message: 'Hello', is_read: 0, created_at: new Date() }],
    unread: 1,
  }));
  check('direct render: messages with old locals (no statusFilter) still works',
    msgsOld.includes('admin-table') && msgsOld.includes('All (1)'));
  const custOld = await renderFile(viewPath('customer-detail'), Object.assign({}, oldBase, {
    customer: { id: 1, name: 'Rohim', email: 'r@example.com', phone: '01810000001', is_blocked: 0, created_at: new Date() },
    orders: [], totalOrders: 0, totalSpent: 0, avgOrderValue: 0, lastOrderDate: null, wishlistCount: 0,
  }));
  check('direct render: customer detail with old locals (no tab) still works',
    custOld.includes('admin-tabs') && custOld.includes('Overview'));

  console.log(`\n${passes.length} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
