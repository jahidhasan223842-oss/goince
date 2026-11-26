// WHMCS light theme (fix/whmcs-light-theme) — the admin panel gets the
// real WHMCS look, and the PR #54 top bar finally shows on desktop.
//
// (1) TOPBAR BUG — root cause: the header carried BOTH classes
// "admin-topbar admin-mobile-topbar" while the CSS had
// ".admin-mobile-topbar { display: none; }" AFTER the
// ".admin-topbar { display: flex; }" rule — same specificity, so the
// later rule won and the whole top bar was invisible on desktop (it
// only re-appeared inside the 768px media query). The header now
// carries only "admin-topbar", the hiding rule is deleted, and the
// mobile block styles .admin-topbar directly. This suite proves the
// bar is visible at desktop width AND at mobile width.
// (2) WHMCS LOOK — light theme only: white top bar, slate top nav bar
// (#2c3e50; the old left sidebar is gone — see fix/whmcs-top-nav, it
// survives only as the mobile drawer), light grey content (#eef1f5),
// WHMCS-blue primary (#1a7bb9), light-blue row hover (#e3f0f8). Gold
// must not dominate the admin anymore. The dark theme keeps its navy
// look and is still available from the theme toggle.
// (3) THEME DEFAULT — the admin header defaults the stored theme to
// 'dark', and donal's browser already has 'dark' stored, so the CSS
// alone is not enough: a one-time migration (versioned localStorage
// key) resets stored 'dark' to 'light' once, then respects the
// toggle. The login/forgot/reset pages carry the same migration.
// (4) SHOP UNTOUCHED — the customer-facing side keeps its navy+gold
// look: shared :root vars, .btn-primary and the shop header script
// are unchanged.
//
// No live MySQL needed: direct EJS renders + CSS source checks only.
//
// Run:  node scripts/test-whmcs-light-theme.js
// Exit code 0 = all checks passed.
'use strict';

const fs = require('fs');
const path = require('path');
const util = require('util');
const ejs = require('ejs');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'style.css'), 'utf8');
const headerEjs = fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', 'admin-header.ejs'), 'utf8');
const shopHeaderEjs = fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', 'header.ejs'), 'utf8');
const themeJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'theme.js'), 'utf8');
const renderFile = util.promisify(ejs.renderFile);
const viewPath = (name) => path.join(__dirname, '..', 'views', 'admin', name + '.ejs');

const failures = [];
const passes = [];
function check(name, ok, detail) {
  if (ok) { passes.push(name); console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}
function has(html, needle) { return html.includes(needle); }
// CSS without /* */ comments — the bug is documented in comments, so the
// "class is gone" checks must not trip over the comment text.
const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
// Balanced-brace ranges of every `@media ... { ... }` block starting at
// `needle`, so top-level (desktop) rules can be separated from media rules.
function mediaRanges(text, needle) {
  const ranges = [];
  let from = 0;
  for (;;) {
    const i = text.indexOf(needle, from);
    if (i < 0) break;
    let d = 0;
    let j = i + needle.length - 1;
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

console.log('Topbar bug — the hiding class is gone, the bar is visible');
check('admin header no longer carries the admin-mobile-topbar class',
  !headerEjs.includes('admin-mobile-topbar'), 'header still has the hiding class');
check('no .admin-mobile-topbar selector remains in the CSS rules',
  !cssNoComments.includes('.admin-mobile-topbar'), 'hiding selector still in CSS');
check('top-level .admin-topbar rule is display:flex (visible on desktop)',
  /\.admin-topbar\s*\{[^}]*display:\s*flex;/.test(cssTopLevel), 'top-level topbar is not display:flex');
check('no top-level rule hides .admin-topbar',
  !/\.admin-topbar\s*\{[^}]*display:\s*none/.test(cssTopLevel), 'a top-level rule still hides the topbar');
check('mobile (<=768px) block keeps the topbar visible at 52px',
  /\.admin-topbar\s*\{[^}]*height:\s*52px;/.test(mobileAdmin) &&
  !/\.admin-topbar\s*\{[^}]*display:\s*none/.test(mobileAdmin),
  'mobile topbar rule missing or hidden');
check('search icon button is visible on desktop now (it IS the search entry point)',
  // fix/whmcs-one-line-topbar: the big search box is gone — the 🔍 icon
  // opens the search panel, so the button is no longer desktop-hidden.
  /\.admin-topbar-search-btn\s*\{\s*display:\s*inline-flex;/.test(cssTopLevel),
  'search icon button rule missing');
check('print still hides the topbar (expected — print docs only)',
  printBlock.includes('.admin-topbar'), 'print block changed unexpectedly');
check('CSS braces balanced',
  (() => { let d = 0; for (const ch of css) { if (ch === '{') d++; if (ch === '}') d--; if (d < 0) return false; } return d === 0; })(),
  'unbalanced braces');

console.log('WHMCS light palette — admin light theme');
check('admin palette vars defined (--admin-blue / --admin-slate / --admin-bg)',
  /--admin-blue:\s*#1a7bb9/.test(css) && /--admin-slate:\s*#2c3e50/.test(css) &&
  /--admin-bg:\s*#eef1f5/.test(css),
  'WHMCS palette vars missing');
check('row hover tint is light blue now, not gold',
  /--table-hover:\s*#e3f0f8/.test(css) && !/--table-hover:\s*#fce9b8/.test(css),
  'hover tint still gold');
check('top bar is WHMCS blue with white text in the light theme (one-line bar)',
  // fix/whmcs-one-line-topbar: the bar is blue now; the soft off-white
  // surface still applies to CARDS (see the soft-surface suite), not
  // to the bar.
  /\.admin-topbar\s*\{[^}]*background:\s*var\(--admin-blue\);/.test(cssTopLevel) &&
  /\.admin-topbar\s*\{[^}]*color:\s*#fff;/.test(cssTopLevel),
  'topbar not WHMCS blue/white');
check('top nav has no separate background in the light theme (it lives on the blue bar)',
  /\.admin-topnav\s*\{[^}]*background:\s*transparent;/.test(cssTopLevel),
  'topnav still has its own background');
check('mobile drawer keeps the slate background',
  /\.admin-sidebar\s*\{[^}]*background:\s*var\(--admin-slate\);/.test(cssTopLevel),
  'drawer not slate');
check('drawer brand is white, not gold',
  /\.admin-sidebar h2\s*\{[^}]*color:\s*#ffffff;/.test(cssTopLevel),
  'drawer brand still gold');
check('topbar brand is white, not gold',
  // fix/whmcs-one-line-topbar: white brand text on the blue bar (gold
  // stays only as the small logo mark in dark mode).
  /\.admin-topbar-brand\s*\{[^}]*color:\s*#fff !important/.test(cssTopLevel),
  'topbar brand still gold');
check('admin primary buttons are blue in the light theme',
  /\.admin-content \.btn-primary,\s*\.admin-login-box \.btn-primary\s*\{[^}]*background:\s*var\(--admin-blue\);/.test(cssTopLevel),
  'admin primary button not blue');
check('admin content links are blue in the light theme',
  // The link rule now also excludes .admin-tab (professional polish 2:
  // without it the active tab's white text was recoloured blue-on-blue
  // and invisible) and every button class (admin-theme-hover-profile:
  // the same specificity bug hid the invoices "All" chip label).
  // The rule still makes admin links blue.
  /\.admin-content a:not\(\.btn-primary\):not\(\.btn-secondary\):not\(\.btn-sm\):not\(\.btn-call\):not\(\.report-tab\):not\(\.analytics-report-link\):not\(\.admin-tab\)\s*\{[^}]*color:\s*var\(--admin-blue\);/.test(cssTopLevel),
  'admin links not blue');
check('admin table header is light grey, not gold-tinted',
  /\.admin-table th\s*\{[^}]*background:\s*#f4f6f9;/.test(cssTopLevel),
  'table header rule missing');
check('sidebar nav badges are blue, not gold',
  /\.admin-nav-badge\s*\{[^}]*background:\s*var\(--admin-blue\);/.test(cssTopLevel),
  'nav badge still gold');
check('admin tabs active state is blue, not navy',
  /\.admin-content \.admin-tab\.is-active\s*\{[^}]*background:\s*var\(--admin-blue\);/.test(cssTopLevel),
  'active tab not blue');
check('login page is light grey with a white bordered card',
  /\.admin-login-body\s*\{[^}]*background:\s*#eef1f5;/.test(cssTopLevel) &&
  /\.admin-login-box\s*\{[^}]*border:\s*1px solid #dde3ea;/.test(cssTopLevel),
  'login page not WHMCS light');

console.log('Dark theme still available via the toggle');
check('dark theme keeps the navy top bar',
  /\[data-theme="dark"\] \.admin-topbar\s*\{[^}]*background:\s*#0a1221;/.test(css),
  'dark topbar override missing');
check('dark theme keeps the navy drawer',
  /\[data-theme="dark"\] \.admin-sidebar\s*\{[^}]*background:\s*#0a1221;/.test(css),
  'dark drawer override missing');
check('dark theme keeps the navy top nav area (the bar is navy; the nav itself is transparent)',
  /\[data-theme="dark"\] \.admin-topnav\s*\{[^}]*background:\s*transparent;/.test(css),
  'dark topnav override missing');
check('dark theme keeps the gold admin primary button',
  /\[data-theme="dark"\] \.admin-content \.btn-primary/.test(css) &&
  /\[data-theme="dark"\] \.admin-content \.btn-primary,\s*\[data-theme="dark"\] \.admin-login-box \.btn-primary\s*\{[^}]*background:\s*var\(--accent\);/.test(css),
  'dark primary-button override missing');
check('dark theme keeps the navy login page',
  /\[data-theme="dark"\] \.admin-login-body\s*\{\s*background:\s*var\(--navy\);/.test(css),
  'dark login override missing');
check('theme toggle function still exists in the admin footer',
  fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', 'admin-footer.ejs'), 'utf8')
    .includes('function toggleGoinceTheme()'),
  'toggle function missing');

console.log('One-time theme reset — WHMCS light is what donal sees on next login');
check('admin header carries the versioned migration key',
  headerEjs.includes('goince-theme-whmcs-v1'), 'migration key missing from header');
check('migration resets a stored dark theme to light once',
  /if \(!localStorage\.getItem\(MIGRATION_KEY\)\)/.test(headerEjs) &&
  /localStorage\.setItem\('goince-theme', 'light'\)/.test(headerEjs) &&
  /localStorage\.setItem\(MIGRATION_KEY, '1'\)/.test(headerEjs),
  'migration reset logic missing');
check('migration falls back to light when nothing is stored',
  /setAttribute\('data-theme', stored \|\| 'light'\)/.test(headerEjs),
  'light fallback missing');
check('login page carries the same migration',
  fs.readFileSync(path.join(__dirname, '..', 'views', 'admin', 'login.ejs'), 'utf8')
    .includes('goince-theme-whmcs-v1'),
  'migration missing from login page');
check('forgot/reset pages carry the same migration',
  fs.readFileSync(path.join(__dirname, '..', 'views', 'admin', 'forgot-password.ejs'), 'utf8')
    .includes('goince-theme-whmcs-v1') &&
  fs.readFileSync(path.join(__dirname, '..', 'views', 'admin', 'reset-password.ejs'), 'utf8')
    .includes('goince-theme-whmcs-v1'),
  'migration missing from forgot/reset pages');

console.log('Shop untouched');
check('shared :root vars unchanged (shop navy + gold)',
  /--accent:\s*#f0a500;/.test(css) && /--bg:\s*#f7f7fa;/.test(css),
  'shared theme vars changed');
check('shared .btn-primary is still gold for the shop',
  /\.btn-primary\s*\{\s*background:\s*var\(--accent\);/.test(cssTopLevel),
  'shared btn-primary changed');
check('shop header has no theme migration (its default stays light)',
  !shopHeaderEjs.includes('goince-theme-whmcs-v1'),
  'shop header touched');
check('shop theme.js untouched (no migration key, same storage key)',
  !themeJs.includes('goince-theme-whmcs-v1') && themeJs.includes("STORAGE_KEY = 'goince-theme'"),
  'shop theme.js touched');

// ---------- EJS renders ----------
const base = {
  siteName: 'Goince',
  siteSettings: { logo_url: '/icons/icon-192.png' },
  adminRole: 'owner',
  csrfToken: 'test-csrf',
  assetUrl: (p) => p,
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
const cases = [
  { view: 'dashboard', need: 'class="admin-topbar"', locals: dashLocals },
  { view: 'dashboard', need: 'admin-topbar-search', locals: dashLocals },
  { view: 'dashboard', need: 'admin-bell-btn', locals: dashLocals },
  { view: 'dashboard', need: 'admin-user-btn', locals: dashLocals },
  { view: 'dashboard', need: 'admin-menu-btn', locals: dashLocals },
  { view: 'dashboard', need: 'goince-theme-whmcs-v1', locals: dashLocals },
  { view: 'dashboard', need: 'admin-breadcrumb', locals: dashLocals },
  { view: 'invoices', need: 'class="admin-topbar"', locals: { tab: 'all', page: 1, totalPages: 1, totalCount: 1, rows: [{ id: 35, customer_name: 'Jahid', phone: '01810000001', total_amount: 370, status: 'Pending', payment_status: 'Unpaid', created_at: new Date() }], _statusRows: [{ status: 'Pending', count: 1 }], _statusFilter: null, _statusQs: '', _totalOrdersAll: 1 } },
  { view: 'activity', need: 'class="admin-topbar"', locals: { tab: 'phone', page: 1, totalPages: 1, totalCount: 1, perPage: 20, phoneTotal: 1, activityTotal: 0, phoneRows: [{ id: 1, customer_name: 'Caller', phone: '01810000001', total_amount: 370, created_at: new Date() }], activityRows: [] } },
  { view: 'products', need: 'class="admin-topbar"', locals: { products: [{ id: 1, name: 'Test Watch', price: 990, stock: 15, image: 'watch.jpg', status: 'published', category_name: 'Winter Collection', cost_price: 600, is_featured: 0, is_new: 0, scheduled_at: null, source_link: '', target_audience: '', video_filename: null }], categories: [], categoryGroups: [], q: '', category: '', page: 1, totalPages: 1, totalCount: 1 } },
  { view: 'settings', need: 'class="admin-topbar"', locals: settingsLocals },
  { view: 'login', need: 'admin-login-box', locals: { error: '' } },
  { view: 'login', need: 'goince-theme-whmcs-v1', locals: { error: '' } },
  { view: 'login', need: 'btn-primary', locals: { error: '' } },
  { view: 'forgot-password', need: 'goince-theme-whmcs-v1', locals: { error: '', message: '' } },
  { view: 'reset-password', need: 'goince-theme-whmcs-v1', locals: { error: '', token: 'test-token' } },
];

(async () => {
  console.log('EJS renders — top bar + migration on every admin page');
  for (const c of cases) {
    try {
      const html = await renderFile(viewPath(c.view), Object.assign({}, base, c.locals));
      check(`${c.view}.ejs renders with ${c.need}`, has(html, c.need),
        'rendered but markup missing');
    } catch (err) {
      check(`${c.view}.ejs renders with ${c.need}`, false, String(err.message).split('\n')[0]);
    }
  }

  console.log(`\n${passes.length} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('Failed checks:');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  process.exit(0);
})();
