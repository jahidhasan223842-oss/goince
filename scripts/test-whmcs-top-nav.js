// WHMCS top navigation (fix/whmcs-top-nav) — WHMCS has NO left sidebar:
// the admin nav is a horizontal bar with dropdown buttons under the top
// bar, and the same links live in the off-canvas drawer on phones.
//
// (1) TOP NAV — Dashboard direct link + Shop / Sales / Communication /
//     System dropdown buttons, same links + badges as the old sidebar,
//     same permission filtering, active page highlighted, dropdowns open
//     on hover (hover-capable devices), click latches, focus opens,
//     Esc / outside-click / focus-out closes, no dead gap (1px overlap).
// (2) NO SIDEBAR ON DESKTOP — .admin-sidebar is display:none at top
//     level; it survives only as the mobile drawer (display:flex in the
//     768px block, off-canvas, hamburger opens it). Content is full-width.
// (3) STALE DARK PAGE — before this PR only ONE route set no-store and
//     it was a JSON endpoint, so a browser could keep a pre-deploy admin
//     page (old header script, stored 'dark') and show the old dark look
//     after a deploy. Now every /admin response carries no-store —
//     proven live below with the real server + stubbed DB.
// (4) LIGHT THEME + SHOP UNTOUCHED — white top bar, slate top nav,
//     blue accents stay; the shop header/theme.js are unchanged.
//
// No live MySQL needed: direct EJS renders + CSS source checks + the
// real server booted with a stubbed DB (same pattern as
// test-whmcs-style-admin.js) for the Cache-Control check only.
//
// Run:  node scripts/test-whmcs-top-nav.js
// Exit code 0 = all checks passed.
'use strict';

const fs = require('fs');
const path = require('path');
const util = require('util');
const ejs = require('ejs');
const Module = require('module');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'style.css'), 'utf8');
const headerEjs = fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', 'admin-header.ejs'), 'utf8');
const footerEjs = fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', 'admin-footer.ejs'), 'utf8');
const adminRoutesSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'admin.js'), 'utf8');
const shopHeaderEjs = fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', 'header.ejs'), 'utf8');
const renderFile = util.promisify(ejs.renderFile);
const viewPath = (name) => path.join(__dirname, '..', 'views', 'admin', name + '.ejs');
const { ALL_PERMISSIONS } = require('../lib/permissions');

const failures = [];
const passes = [];
function check(name, ok, detail) {
  if (ok) { passes.push(name); console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}
function has(html, needle) { return html.includes(needle); }
const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
function allMediaRanges(text) {
  const ranges = [];
  let from = 0;
  for (;;) {
    const i = text.indexOf('@media', from);
    if (i < 0) break;
    const open = text.indexOf('{', i);
    if (open < 0) break;
    let d = 0;
    let j = open;
    for (; j < text.length; j++) {
      if (text[j] === '{') d++;
      if (text[j] === '}') { d--; if (d === 0) break; }
    }
    ranges.push([i, j + 1]);
    from = j + 1;
  }
  return ranges;
}
function stripRanges(text, ranges) {
  let out = '';
  let last = 0;
  for (const [a, b] of ranges) { out += text.slice(last, a); last = b; }
  return out + text.slice(last);
}
const cssTopLevel = stripRanges(cssNoComments, allMediaRanges(cssNoComments));
const mobileAdmin = (() => {
  const anchor = css.indexOf('MOBILE ADMIN CONVENTION');
  const start = css.lastIndexOf('@media (max-width: 768px)', anchor);
  const end = css.indexOf('@media (max-width: 480px)', anchor);
  return css.slice(start, end < 0 ? css.length : end);
})();
const printBlock = (() => {
  const start = css.indexOf('@media print {');
  if (start < 0) return '';
  let d = 0;
  let j = css.indexOf('{', start);
  for (; j < css.length; j++) {
    if (css[j] === '{') d++;
    if (css[j] === '}') { d--; if (d === 0) break; }
  }
  return css.slice(start, j + 1);
})();
const hoverBlocks = (() => {
  let out = '';
  let from = 0;
  for (;;) {
    const i = css.indexOf('@media (hover: hover)', from);
    if (i < 0) break;
    const open = css.indexOf('{', i);
    let d = 0;
    let j = open;
    for (; j < css.length; j++) {
      if (css[j] === '{') d++;
      if (css[j] === '}') { d--; if (d === 0) break; }
    }
    out += css.slice(i, j + 1);
    from = j + 1;
  }
  return out;
})();

console.log('CSS — no sidebar on desktop, top nav bar instead');
check('top-level .admin-sidebar rule hides it on desktop (display:none)',
  /\.admin-sidebar\s*\{[^}]*display:\s*none;/.test(cssTopLevel),
  'sidebar still visible on desktop');
check('top nav bar exists at top level (flex, slate, sticky under the 56px top bar)',
  /\.admin-topnav\s*\{[^}]*display:\s*flex;/.test(cssTopLevel) &&
  /\.admin-topnav\s*\{[^}]*background:\s*var\(--admin-slate\);/.test(cssTopLevel) &&
  /\.admin-topnav\s*\{[^}]*position:\s*sticky;/.test(cssTopLevel) &&
  /\.admin-topnav\s*\{[^}]*top:\s*56px;/.test(cssTopLevel),
  'topnav rule missing or wrong');
check('dropdown menu is hidden by default and sits 1px over the button (no dead gap)',
  /\.admin-topnav-menu\s*\{[^}]*display:\s*none;/.test(cssTopLevel) &&
  /\.admin-topnav-menu\s*\{[^}]*top:\s*calc\(100% - 1px\);/.test(cssTopLevel),
  'dropdown menu rule missing');
check('click-latched menu shows (.open)',
  /\.admin-topnav-menu\.open\s*\{\s*display:\s*block;/.test(cssTopLevel),
  '.open rule missing');
check('hover/focus opens the menu, gated by (hover: hover) like the mega menu',
  /\.admin-topnav-dropdown:hover \.admin-topnav-menu/.test(hoverBlocks) &&
  /\.admin-topnav-dropdown:focus-within \.admin-topnav-menu/.test(hoverBlocks),
  'hover/focus open missing or ungated');
check('active top nav button/link is blue',
  /\.admin-topnav-link\.is-active,\s*\.admin-topnav-btn\.is-active\s*\{[^}]*background:\s*var\(--admin-blue\);/.test(cssTopLevel),
  'active topnav state missing');
check('top nav menu links are white cards with a light-blue hover',
  /\.admin-topnav-menu\s*\{[^}]*background:\s*var\(--surface\);/.test(cssTopLevel) &&
  /\.admin-topnav-menu-link:hover\s*\{[^}]*background:\s*var\(--table-hover\);/.test(hoverBlocks),
  'menu link styling missing');
check('dark theme keeps a navy top nav with a dark-blue active state',
  /\[data-theme="dark"\] \.admin-topnav\s*\{[^}]*background:\s*#0a1221;/.test(css) &&
  /\[data-theme="dark"\] \.admin-topnav-btn\.is-active\s*\{[^}]*background:\s*#1a3762;/.test(css),
  'dark topnav override missing');
check('mobile (<=768px) block hides the top nav row',
  /\.admin-topnav\s*\{\s*display:\s*none;/.test(mobileAdmin),
  'topnav still shown on mobile');
check('mobile (<=768px) block re-enables the sidebar as the drawer',
  /\.admin-sidebar\s*\{[^}]*display:\s*flex;/.test(mobileAdmin) &&
  /\.admin-sidebar\s*\{[^}]*transform:\s*translateX\(-105%\);/.test(mobileAdmin) &&
  /\.admin-sidebar\.open\s*\{\s*transform:\s*none;/.test(mobileAdmin),
  'drawer rules missing');
check('print still hides the shell (top nav included)',
  printBlock.includes('.admin-topnav'), 'topnav not hidden in print');
check('CSS braces balanced',
  (() => { let d = 0; for (const ch of css) { if (ch === '{') d++; if (ch === '}') d--; if (d < 0) return false; } return d === 0; })(),
  'unbalanced braces');

console.log('EJS source — one shared link list, top nav + drawer');
check('header renders a top nav row with the four dropdown groups',
  headerEjs.includes('class="admin-topnav"') &&
  headerEjs.includes('data-topnav-btn') &&
  headerEjs.includes("label: 'Shop'") && headerEjs.includes("label: 'Sales'") &&
  headerEjs.includes("label: 'Communication'") && headerEjs.includes("label: 'System'"),
  'topnav groups missing');
check('dropdown buttons carry aria-haspopup + aria-expanded',
  headerEjs.includes('data-topnav-btn aria-haspopup="true" aria-expanded="false"'),
  'aria attributes missing');
check('Dashboard is a direct top nav link (not a dropdown)',
  headerEjs.includes('class="admin-topnav-link') && headerEjs.includes('>🏠 Dashboard</a>'),
  'dashboard topnav link missing');
check('top nav and drawer share one _navGroups array (no drift)',
  headerEjs.includes('const _navGroups = [') &&
  headerEjs.includes("key: 'shop'") && headerEjs.includes("key: 'sales'") &&
  headerEjs.includes("key: 'communication'") && headerEjs.includes("key: 'system'"),
  '_navGroups missing');
check('drawer keeps the collapsible group buttons + badges (old sidebar markup)',
  headerEjs.includes('admin-nav-group-btn') &&
  headerEjs.includes('data-nav-group="<%= _g.key %>"') &&
  headerEjs.includes("badge: 'openOrders'") && headerEjs.includes("badge: 'phoneQueue'") &&
  headerEjs.includes("badge: 'unreadMessages'") && headerEjs.includes("badge: 'pendingReviews'"),
  'drawer groups/badges missing');
check('drawer keeps the hamburger target ids (admin-sidebar + overlay)',
  headerEjs.includes('id="admin-sidebar"') && headerEjs.includes('id="admin-sidebar-overlay"') &&
  headerEjs.includes('id="admin-menu-btn"'),
  'drawer ids missing');
check('View Site appears twice in the header source (top nav + drawer)',
  (headerEjs.match(/🌐 View Site/g) || []).length === 2,
  'View Site not in both places');
check('footer wires the top nav dropdowns (click latch, focus-out close, shared Esc/outside-click)',
  footerEjs.includes('[data-topnav-btn]') && footerEjs.includes('focusout') &&
  footerEjs.includes("querySelector('.admin-topnav-menu')"),
  'topnav JS missing');
check('footer still wires the drawer (hamburger) and the group collapse',
  footerEjs.includes("getElementById('admin-menu-btn')") &&
  footerEjs.includes('admin-nav-group-btn') &&
  footerEjs.includes('goince-admin-nav'),
  'drawer JS missing');

console.log('Cache-Control — every /admin response is no-store (stale dark page fix)');
check('router-level middleware sets no-store + Pragma on all /admin responses',
  /router\.use\(\(req, res, next\) => \{\s*res\.set\('Cache-Control', 'no-store, no-cache, must-revalidate'\);\s*res\.set\('Pragma', 'no-cache'\);/.test(adminRoutesSrc),
  'no-store middleware missing');
check('the no-store middleware runs before the login route (covers login/forgot/reset too)',
  adminRoutesSrc.indexOf("res.set('Cache-Control', 'no-store") > 0 &&
  adminRoutesSrc.indexOf("res.set('Cache-Control', 'no-store") < adminRoutesSrc.indexOf("router.get('/login'"),
  'middleware placed after the routes');
check('the old single no-store (vapid key JSON endpoint) is untouched',
  adminRoutesSrc.includes("router.get('/vapid-public-key'"),
  'vapid route changed unexpectedly');

console.log('WHMCS light theme + shop untouched');
check('top bar is still white with dark text in the light theme',
  /\.admin-topbar\s*\{[^}]*background:\s*#ffffff;/.test(cssTopLevel),
  'topbar not white');
check('top nav badges are still blue',
  /\.admin-nav-badge\s*\{[^}]*background:\s*var\(--admin-blue\);/.test(cssTopLevel),
  'nav badge not blue');
check('shop header has no admin top nav',
  !shopHeaderEjs.includes('admin-topnav'),
  'shop header touched');

// ---------- EJS renders ----------
const base = {
  siteName: 'Goince',
  siteSettings: { logo_url: '/icons/icon-192.png' },
  adminRole: 'owner',
  csrfToken: 'test-csrf',
  assetUrl: (p) => p,
  adminNotifications: { pendingOrders: 1, phoneQueue: 2, unreadMessages: 3, pendingReviews: 1, openOrders: 5, total: 7 },
};
const dashLocals = {
  totalProducts: 5, totalOrders: 5, totalRevenue: 2670, totalCustomers: 1,
  pendingOrders: [{ id: 1, customer_name: 'Buyer', total_amount: 370, created_at: new Date(), status: 'Pending', phone: '01810000001' }],
  todaysPendingCount: 1, lowStockProducts: [], lowStockCount: 0, outOfStockCount: 0,
  pendingDue: 1500, pendingDueOrders: 2, pendingReviews: 2, unreadMessages: 3,
  todaysSummary: { ordersCount: 1, revenue: 1000 },
  periodProfit: { totalProfit: 490, totalCost: 500, totalUnits: 3, costedUnits: 1 },
  _catSales: [{ name: 'Home Appliances', revenue: 1000 }],
  _shipped: [], _shippedTotal: 0,
  _topCustomers: [{ name: 'Buyer', phone: '01810000001', orders: 1, total: 370, customerId: null }],
  dashboard: {
    range: '30', from: '2026-10-26', to: '2026-11-24', prevFrom: '2026-09-26', prevTo: '2026-10-25',
    currentSummary: { ordersCount: 3, revenue: 1870, avgOrderValue: 623.33, collectedRevenue: 870 },
    previousSummary: { ordersCount: 0, revenue: 0 },
    newCustomers: 0, salesTrend: [], topProducts: [],
    statusRows: [{ status: 'Pending', count: 2 }, { status: 'Shipped', count: 1 }],
    revenueChange: null, maxTrendRevenue: 1,
  },
};
const productsLocals = {
  products: [{ id: 1, name: 'Test Watch', price: 990, stock: 15, image: 'watch.jpg', status: 'published', category_name: 'Winter Collection', cost_price: 600, is_featured: 0, is_new: 0, scheduled_at: null, source_link: '', target_audience: '', video_filename: null }],
  categories: [], categoryGroups: [], q: '', category: '', page: 1, totalPages: 1, totalCount: 1,
};
const invoicesLocals = {
  tab: 'all', page: 1, totalPages: 1, totalCount: 1,
  rows: [{ id: 35, customer_name: 'Jahid', phone: '01810000001', total_amount: 370, status: 'Pending', payment_status: 'Unpaid', created_at: new Date() }],
  _statusRows: [{ status: 'Pending', count: 1 }], _statusFilter: null, _statusQs: '', _totalOrdersAll: 1,
};
const activityLocals = {
  tab: 'phone', page: 1, totalPages: 1, totalCount: 1, perPage: 20, phoneTotal: 1, activityTotal: 0,
  phoneRows: [{ id: 1, customer_name: 'Caller', phone: '01810000001', total_amount: 370, created_at: new Date() }], activityRows: [],
};
const settingsLocals = {
  heroTitle: '', heroSubtitle: '', announcementText: '', shopAddress: '', shopEmail: '', shopPhone: '',
  facebookUrl: '', instagramUrl: '', youtubeUrl: '', footerAbout: '', footerHours: '', logoUrl: '',
  faviconUrl: '', ogImageUrl: '', deliveryChargeInside: 60, deliveryChargeOutside: 120,
  paymentMode: 'manual', gatewayProvider: 'sslcommerz', gatewayMode: 'manual', gatewayEnabled: false,
  gatewayStoreId: '', gatewayPasswordSet: false, courierProvider: 'steadfast', courierMode: 'manual',
  courierEnabled: false, courierSteadfastKeySet: false, courierPathaoSecretSet: false,
  courierPathaoPasswordSet: false, pathaoClientId: '', pathaoStoreId: '', pathaoUsername: '',
  whatsappPhoneNumberId: '', whatsappTemplateName: '', whatsappTokenSet: false, pwMessage: '',
  message: '', products: [],
};
// Slice of one rendered nav (topnav or drawer) — the first </nav> after it.
function navSlice(html, marker) {
  const i = html.indexOf(marker);
  if (i < 0) return '';
  const j = html.indexOf('</nav>', i);
  return j < 0 ? '' : html.slice(i, j);
}

(async () => {
  console.log('EJS renders — top nav + drawer on every admin page');
  const renderCases = [
    { view: 'dashboard', locals: dashLocals },
    { view: 'products', locals: productsLocals },
    { view: 'invoices', locals: invoicesLocals },
    { view: 'activity', locals: activityLocals },
    { view: 'settings', locals: settingsLocals },
  ];
  const rendered = {};
  for (const c of renderCases) {
    try {
      rendered[c.view] = await renderFile(viewPath(c.view), Object.assign({}, base, c.locals));
      check(`${c.view}.ejs renders with the top nav + drawer + top bar`,
        has(rendered[c.view], 'class="admin-topnav"') &&
        has(rendered[c.view], 'class="admin-sidebar"') &&
        has(rendered[c.view], 'class="admin-topbar"') &&
        has(rendered[c.view], 'admin-breadcrumb'),
        'shell pieces missing');
    } catch (err) {
      check(`${c.view}.ejs renders with the top nav + drawer + top bar`, false, String(err.message).split('\n')[0]);
    }
  }

  const dash = rendered.dashboard || '';
  const topnav = navSlice(dash, 'class="admin-topnav"');
  const drawer = navSlice(dash, 'class="admin-sidebar"');
  check('top nav has all four dropdown buttons (Shop/Sales/Communication/System)',
    ['Shop', 'Sales', 'Communication', 'System'].every((g) => topnav.includes('>' + g + ' <')) &&
    (topnav.match(/data-topnav-btn/g) || []).length === 4,
    'a dropdown group is missing from the top nav');
  // (fix/admin-profile-section): the standalone Logout links in the top
  // nav and the drawer are gone — Logout lives only in the profile
  // dropdown menu in the top bar. View Site stays in both places.
  check('View Site is in both the top nav and the drawer; Logout is only in the profile menu',
    topnav.includes('🌐 View Site') && !topnav.includes('/admin/logout') &&
    drawer.includes('🌐 View Site') && !drawer.includes('/admin/logout') &&
    dash.includes('admin-profile-menu-link admin-profile-menu-logout'),
    'View Site missing from a nav, or a standalone Logout remains');
  check('top nav and drawer both list every link (Products…Roles, 22 links)',
    ['/admin/products', '/admin/products/import', '/admin/attributes', '/admin/stock-alerts',
      '/admin/categories', '/admin/banners', '/admin/inventory', '/admin/invoices', '/admin/activity',
      '/admin/reports', '/admin/customers', '/admin/coupons', '/admin/payment-methods',
      '/admin/delivery-zones', '/admin/chats', '/admin/messages', '/admin/reviews',
      '/admin/settings', '/admin/test-email', '/admin/staff', '/admin/roles']
      .every((href) => topnav.includes('href="' + href + '"') && drawer.includes('href="' + href + '"')),
    'a link is missing from one of the navs');
  check('count badges show in both navs (Orders 5, Activity 2, Messages 3, Reviews 1)',
    topnav.includes('admin-nav-badge">5') && topnav.includes('admin-nav-badge">2') &&
    topnav.includes('admin-nav-badge">3') && topnav.includes('admin-nav-badge">1') &&
    drawer.includes('admin-nav-badge">5') && drawer.includes('admin-nav-badge">2'),
    'badges missing from a nav');
  check('dashboard page marks Dashboard active in the top nav',
    topnav.includes('href="/admin/dashboard" class="admin-topnav-link is-active" aria-current="page"'),
    'dashboard active state missing');

  // Active page: products page highlights Shop + Products.
  try {
    const prod = await renderFile(viewPath('products'),
      Object.assign({}, base, productsLocals, { adminCurrentPath: '/admin/products' }));
    const prodTopnav = navSlice(prod, 'class="admin-topnav"');
    check('products page highlights the Shop dropdown + Products link',
      prodTopnav.includes('class="admin-topnav-btn is-active"') &&
      prodTopnav.includes('href="/admin/products" class="admin-topnav-menu-link is-active" aria-current="page"'),
      'products active state missing');
  } catch (err) {
    check('products page highlights the Shop dropdown + Products link', false, String(err.message).split('\n')[0]);
  }

  // Permission filtering: an admin without messages/reviews/orders perms
  // must not see those links in EITHER nav (same _can guards as before).
  try {
    const restrictedPerms = ALL_PERMISSIONS.filter((p) => !['messages.manage', 'reviews.manage', 'orders.view'].includes(p));
    const restricted = await renderFile(viewPath('dashboard'),
      Object.assign({}, base, dashLocals, { adminPermissions: restrictedPerms }));
    const rTopnav = navSlice(restricted, 'class="admin-topnav"');
    const rDrawer = navSlice(restricted, 'class="admin-sidebar"');
    check('restricted admin sees no Messages/Reviews/Orders links in either nav',
      !rTopnav.includes('/admin/messages') && !rTopnav.includes('/admin/reviews') &&
      !rTopnav.includes('/admin/invoices') && !rDrawer.includes('/admin/messages') &&
      !rDrawer.includes('/admin/reviews') && !rDrawer.includes('/admin/invoices'),
      'a forbidden link leaked into a nav');
    check('restricted admin still sees the links they ARE allowed (Products, Settings)',
      rTopnav.includes('/admin/products') && rTopnav.includes('/admin/settings') &&
      rDrawer.includes('/admin/products'),
      'allowed links missing');
  } catch (err) {
    check('restricted admin sees no Messages/Reviews/Orders links in either nav', false, String(err.message).split('\n')[0]);
  }

  // ---------- Live HTTP: Cache-Control on real /admin responses ----------
  console.log('HTTP (stubbed DB, real server) — Cache-Control: no-store');
  const PORT = process.env.TEST_PORT || '3465';
  process.env.PORT = PORT;
  process.env.SESSION_SECRET = 'test-secret-for-whmcs-top-nav';
  const stubDb = {
    query: async () => [[]],
    execute: async () => [[]],
  };
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (typeof request === 'string' && /(^|\/)config\/db$/.test(request.replace(/\\/g, '/'))) return stubDb;
    return originalLoad.apply(this, arguments);
  };
  try {
    require('../server.js');
  } catch (err) {
    check('real server boots with stubbed DB', false, String(err.message).split('\n')[0]);
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
  async function get(pathname) {
    const res = await fetch(`http://127.0.0.1:${PORT}${pathname}`, { redirect: 'manual' });
    const text = await res.text();
    return { status: res.status, cache: res.headers.get('cache-control') || '', text };
  }
  if (await waitForServer()) {
    const login = await get('/admin/login');
    check('GET /admin/login returns 200 with Cache-Control: no-store',
      login.status === 200 && /no-store/.test(login.cache),
      `got ${login.status} cache-control=${login.cache}`);
    const forgot = await get('/admin/forgot-password');
    check('GET /admin/forgot-password returns 200 with Cache-Control: no-store',
      forgot.status === 200 && /no-store/.test(forgot.cache),
      `got ${forgot.status} cache-control=${forgot.cache}`);
    const dashAnon = await get('/admin/dashboard');
    check('GET /admin/dashboard (signed out) redirects with Cache-Control: no-store',
      dashAnon.status === 302 && /no-store/.test(dashAnon.cache),
      `got ${dashAnon.status} cache-control=${dashAnon.cache}`);
  } else {
    check('real server boots with stubbed DB', false, 'server did not start');
  }

  console.log(`\n${passes.length} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('Failed checks:');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  process.exit(0);
})();
