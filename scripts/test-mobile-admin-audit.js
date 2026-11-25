// Mobile admin audit (fix/mobile-admin-audit) — audit the admin panel at
// mobile width (~390px) against the 6 principles donal approved, fix the
// gaps the audit proves.
//
// Principles: (a) hamburger + slide-in drawer on every admin page;
// (b) dashboard KPI cards/panels stack, no horizontal overflow;
// (c) wide tables scroll inside their own wrapper, never the page;
// (d) every thumb-tappable action is >=44px with space between neighbours;
// (e) forms stack one field per row with >=16px inputs (no iOS zoom trap);
// (f) phone queue + pending orders reachable in <=2 taps from dashboard.
//
// AUDIT (code-verified; per-page table — PASS means already good, GAP means
// fixed by this PR):
//   dashboard ......... PASS (KPI 1-col <=480px, grids collapse <=1100px,
//                       quick links incl. Calls & Activity = 1 tap,
//                       "View pending orders" = 1 tap) — except the KPI
//                       foot link + panel "View all" links were ~19px tall
//                       (GAP d, fixed by the shared mobile link rule).
//   invoices (Orders) . PASS after fix — status pills + tabs + pagination
//                       use .btn-secondary which had NO 44px min-height
//                       on mobile (.btn-primary already had it); the
//                       View/Print/PDF links were plain ~19px text
//                       (GAP d, fixed). Table was already wrapped.
//   activity .......... PASS after fix — .btn-call was ~30px tall
//                       (GAP d, fixed to 44px); "View order" links and
//                       tabs/pagination as on invoices (fixed).
//   products .......... PASS after fix — .btn-sm was 36px on mobile and
//                       the Edit/History/Duplicate/Delete links were
//                       plain text (GAP d, fixed).
//   add-product ....... PASS — sections stack, inputs 16px, section
//                       toggles ~46px, Expand/Collapse already 44px.
//   categories ........ PASS after fix — rows wrap, but the chevron,
//                       drag handle, Hide/Edit/Delete links and the
//                       bulk checkbox were all tiny (GAP d, fixed to
//                       44px targets / 22px checkbox).
//   customers/reviews/coupons/banners/staff/messages/stock-alerts/
//   delivery-zones/payment-methods/variants/history/chats
//                     . PASS after fix — tables already wrapped; their
//                       Approve/Hide/Delete/Save links were plain text
//                       (GAP d, fixed by the shared table-link rule).
//   inventory ......... GAP (c) — the filter pills use .category-bar,
//                       and the SHOP mobile rule restyled them into a
//                       76px round-card strip (no pill background/border).
//                       Fixed with an admin-scoped override.
//   order-details ..... GAP (c) — the 6-column line-items table
//                       (.invoice-items-table) had NO scroll wrapper, so
//                       at 360px the Cost/Profit/Subtotal columns were
//                       cut off (body overflow-x: clip hides them).
//                       Fixed by wrapping it in .table-responsive.
//   order-invoice / packing-slip (print docs)
//                     . GAP (c, marginal) — 4-column tables unwrapped;
//                       wrapped too, with a print rule that unwraps
//                       .table-responsive so nothing clips on paper.
//   reports ........... PASS after fix — .report-tab was ~36px and the
//                       filter/apply buttons ~36px (GAP d, fixed 44px).
//   login/forgot/reset  PASS — viewport meta + login box
//                       min(320px, 100vw - 32px).
//   every admin page .. GAP — hover STUCK after a tap on touch: no
//                       :hover rule was gated by @media (hover: hover),
//                       and the MOBILE FRIENDLY comment even claimed
//                       "touch device-e hover emnitei apply hoy na"
//                       (wrong — tap applies :hover and it sticks).
//                       All admin background/lift :hover rules are now
//                       gated; the wrong comment is corrected.
//   every admin page .. GAP — the floating theme toggle (bottom-right,
//                       38px) sat on top of bottom pagination/action
//                       buttons. It now lives in the mobile topbar;
//                       the footer toggle function syncs both buttons.
//   drawer/topbar ..... PASS — shared admin-header partial on every
//                       admin page; sidebar links were 42px (GAP d,
//                       fixed to 44px on mobile).
//   dark mode mobile .. PASS — theme vars throughout; the topbar +
//                       menu button are hardcoded dark by design.
//
// No headless browser is available in this VM (no chromium/firefox/
// playwright/puppeteer), so the true ~390px rendered check still needs
// donal's real phone after deploy — this suite proves the rules and
// markup instead of claiming a render.
//
// Run:  node scripts/test-mobile-admin-audit.js
// Exit code 0 = all checks passed.
'use strict';

const fs = require('fs');
const path = require('path');
const util = require('util');
const ejs = require('ejs');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'style.css'), 'utf8');
const renderFile = util.promisify(ejs.renderFile);
const viewPath = (name) => path.join(__dirname, '..', 'views', 'admin', name + '.ejs');

const failures = [];
const passes = [];
function check(name, ok, detail) {
  if (ok) { passes.push(name); console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}
function has(html, needle) { return html.includes(needle); }
function sectionOf(text, start, end) {
  const i = text.indexOf(start);
  if (i < 0) return '';
  const j = end ? text.indexOf(end, i + start.length) : text.length;
  return text.slice(i, j < 0 ? text.length : j);
}
// Balanced-brace ranges of every `@media (hover: hover) { ... }` block
// (the mega-menu `@media (hover: hover) and (min-width: 769px)` is a
// different query and is deliberately NOT matched here).
function mediaRanges(text, needle) {
  const ranges = [];
  let from = 0;
  for (;;) {
    const i = text.indexOf(needle, from);
    if (i < 0) break;
    let d = 0;
    let j = i + needle.length - 1; // at the opening brace
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
const hoverRanges = mediaRanges(css, '@media (hover: hover) {');
const hoverBlocks = hoverRanges.map(([a, b]) => css.slice(a, b)).join('\n');
function inHoverBlock(needle) { return hoverBlocks.includes(needle); }
// Outside the gate, hover selectors may ONLY appear in the reduced-motion
// block (which neutralises them with transform:none) — strip both kinds of
// blocks in ONE pass (ranges are indices into the original text, so they
// must be merged before stripping).
const cssNoHover = stripRanges(css,
  mediaRanges(css, '@media (hover: hover) {')
    .concat(mediaRanges(css, '@media (prefers-reduced-motion: reduce) {'))
    .sort((a, b) => a[0] - b[0]));

// The mobile block: the @media (max-width: 768px) block that holds the
// admin section (there are earlier 768px blocks for the shop; the admin
// one is the block containing the MOBILE ADMIN CONVENTION comment).
const mobileAdmin = (() => {
  const anchor = css.indexOf('MOBILE ADMIN CONVENTION');
  const start = css.lastIndexOf('@media (max-width: 768px)', anchor);
  const end = css.indexOf('@media (max-width: 480px)', anchor);
  return css.slice(start, end < 0 ? css.length : end);
})();
const printBlock = sectionOf(css, '@media print {', '@media (max-width: 600px)');

console.log('CSS — no page-level horizontal scroll, 16px inputs');
check('html, body clip horizontal overflow (page never scrolls sideways)',
  /html,\s*body\s*\{\s*overflow-x:\s*clip;/.test(css), 'overflow-x: clip missing');
check('inputs/selects/textarea are 16px at <=768px (no iOS zoom trap)',
  mobileAdmin.includes('input, select, textarea { font-size: 16px; }'),
  '16px input rule missing from mobile block');
check('CSS braces balanced',
  (() => { let d = 0; for (const ch of css) { if (ch === '{') d++; if (ch === '}') d--; if (d < 0) return false; } return d === 0; })(),
  'unbalanced braces');

console.log('CSS — mobile admin convention comment');
check('convention comment lists the mobile rules for new pages',
  mobileAdmin.includes('MOBILE ADMIN CONVENTION') &&
  mobileAdmin.includes('.table-responsive') &&
  mobileAdmin.includes('44px') &&
  mobileAdmin.includes('.admin-form') &&
  mobileAdmin.includes('@media (hover: hover)'),
  'convention comment incomplete');
check('wrong "touch device-e hover emnitei apply hoy na" comment is gone',
  !css.includes('touch device-e hover emnitei apply hoy na'),
  'wrong comment still present');

console.log('CSS — 44px tap targets at <=768px');
check('.btn-secondary gets 44px min-height on mobile (btn-primary had it)',
  /\.btn-secondary\s*\{\s*min-height:\s*44px;/.test(mobileAdmin), 'btn-secondary 44px missing');
check('.btn-call is 44px on mobile (was ~30px)',
  /\.btn-call\s*\{\s*min-height:\s*44px;/.test(mobileAdmin), 'btn-call 44px missing');
check('table .btn-sm is 44px on mobile (was 36px)',
  /\.admin-table \.btn-sm\s*\{\s*min-height:\s*44px;/.test(mobileAdmin), 'btn-sm 44px missing');
check('table .link-btn-danger is 44px on mobile (was ~38px)',
  /\.admin-table \.link-btn-danger\s*\{\s*min-height:\s*44px;/.test(mobileAdmin), 'link-btn-danger 44px missing');
check('plain table links become 44px inline-flex targets on mobile',
  /\.admin-table td a\s*\{[^}]*display:\s*inline-flex;[^}]*min-height:\s*44px;/.test(mobileAdmin),
  'table-link 44px rule missing');
check('.report-tab is 44px on mobile (was ~36px)',
  /\.report-tab\s*\{\s*min-height:\s*44px;/.test(mobileAdmin), 'report-tab 44px missing');
check('analytics filter/apply buttons are 44px on mobile (were ~36px)',
  /\.analytics-filter-btn,\s*\.analytics-apply-btn\s*\{\s*min-height:\s*44px;/.test(mobileAdmin),
  'filter buttons 44px missing');
check('dashboard/panel view links are 44px on mobile (were ~19px text)',
  /\.analytics-view-link,\s*\.analytics-kpi-foot a,\s*\.analytics-panel-heading > a\s*\{[^}]*min-height:\s*44px;/.test(mobileAdmin),
  'view-link 44px rule missing');
check('sidebar nav links are 44px on mobile (were 42px)',
  /\.admin-sidebar nav a\s*\{\s*min-height:\s*44px;/.test(mobileAdmin), 'sidebar 44px missing');
check('category row actions are 44px on mobile',
  /\.cat-actions a,\s*\.cat-actions button\s*\{[^}]*min-height:\s*44px;/.test(mobileAdmin),
  'cat-actions 44px missing');
check('category chevron is a 44px target on mobile',
  /\.cat-chevron\s*\{[^}]*min-height:\s*44px;/.test(mobileAdmin), 'cat-chevron 44px missing');
check('category bulk checkbox is 22px on mobile (was 16px)',
  /\.cat-check\s*\{\s*width:\s*22px;/.test(mobileAdmin), 'cat-check 22px missing');

console.log('CSS — inventory filter pills stay pills on mobile');
check('admin .category-bar override restores pill look (not the shop round-card strip)',
  /\.admin-content \.category-bar\s*\{[^}]*flex-wrap:\s*wrap;/.test(mobileAdmin) &&
  /\.admin-content \.category-bar\s*\{[^}]*overflow-x:\s*visible;/.test(mobileAdmin) &&
  /\.admin-content \.category-bar > a\s*\{[^}]*min-height:\s*44px;/.test(mobileAdmin) &&
  /\.admin-content \.category-bar > a\s*\{[^}]*border-radius:\s*20px;/.test(mobileAdmin) &&
  /\.admin-content \.category-bar a\.active\s*\{[^}]*background:\s*var\(--navy\);/.test(mobileAdmin),
  'admin category-bar override missing');

console.log('CSS — theme toggle moves into the topbar on mobile');
check('floating theme toggle is hidden on mobile',
  /\.theme-toggle-fixed\s*\{\s*display:\s*none;/.test(mobileAdmin), 'floating toggle not hidden on mobile');
check('topbar theme toggle is pushed to the right end of the topbar',
  /\.admin-topbar \.theme-toggle-btn\s*\{\s*margin-left:\s*auto;/.test(mobileAdmin),
  'topbar toggle rule missing');

console.log('CSS — print unwraps .table-responsive');
check('print block makes .table-responsive overflow visible (no clipped print)',
  printBlock.includes('.table-responsive { overflow: visible !important; }') &&
  printBlock.includes('.table-responsive table { min-width: 0 !important; }'),
  'print unwrap missing');

console.log('CSS — hover gated by (hover: hover), never stuck after a tap');
const gated = [
  '.admin-table tbody tr:hover td',
  '.invoice-items-table tbody tr:hover',
  '.cat-row:hover',
  '.analytics-status-row:hover',
  '.analytics-attention-row:hover',
  '.stat-card:hover',
  '.analytics-panel:hover',
  '.report-summary-card:hover',
  '.invoice-box:hover',
  '.btn-call:hover',
  '.btn-primary:hover',
  '.btn-secondary:hover',
  '.admin-content button:hover:not(:disabled)',
  '.report-tab:not(.active):hover',
  '.admin-quick-links a:hover',
  '.cat-chevron:hover',
  '.cat-drag:hover',
];
for (const sel of gated) {
  check(`hover rule gated: ${sel}`, inHoverBlock(sel), 'not inside @media (hover: hover)');
}
check('no admin background/lift :hover rule lives outside (hover: hover)',
  !gated.some((sel) => cssNoHover.includes(sel)),
  'an admin hover rule escaped the gate');
check('sidebar nav hover intentionally ungated (tap navigates away anyway)',
  /\.admin-sidebar nav a:hover\s*\{[^}]*transform:\s*translateX\(3px\)/.test(cssNoHover),
  'sidebar hover changed unexpectedly');
check('old row-hover gold tint still exists (inside the gate now)',
  /\.admin-table tbody tr:hover\s*\{\s*background:\s*var\(--table-hover\);/.test(hoverBlocks),
  'old row hover missing from the gate');

// ---------- EJS renders ----------
const base = {
  siteName: 'Goince',
  siteSettings: { logo_url: '/icons/icon-192.png' },
  adminRole: 'owner',
  csrfToken: 'test-csrf',
  assetUrl: (p) => p,
};
const oneProduct = {
  id: 1, name: 'Test Watch', price: 990, stock: 15, image: 'watch.jpg',
  status: 'published', category_name: 'Winter Collection', cost_price: 600,
  is_featured: 0, is_new: 0, scheduled_at: null, source_link: '',
  target_audience: '', video_filename: null,
};
const catNode = (overrides) => Object.assign({
  id: 1, name: 'Home Appliances', parent_id: null, depth: 0, children: [],
  descendantIds: [], totalProductCount: 3, directProductCount: 1,
  product_count: 3, is_visible: 1, image_url: null, parent_name: '',
}, overrides || {});
const orderLocals = {
  order: { id: 35, customer_name: 'Jahid', phone: '01810000001', status: 'Pending', payment_status: 'Unpaid', total_amount: 370, created_at: new Date(), address: 'Dhaka', district: 'Dhaka', payment_method: 'Cash on Delivery', delivery_charge: 60, discount_amount: 0, coupon_code: null, courier_name: null, tracking_id: null, notes: '' },
  items: [{ product_name: 'Watch', price: 990, quantity: 1, variant_label: '', cost_price: 600 }],
  shopPhone: '01814697896', paid: 0, due: 370,
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

const cases = [
  { view: 'dashboard', need: 'admin-topbar', locals: dashLocals },
  { view: 'dashboard', need: 'admin-topbar-theme-btn', locals: dashLocals },
  { view: 'dashboard', need: 'admin-menu-btn', locals: dashLocals },
  { view: 'dashboard', need: 'Calls &amp; Activity', locals: dashLocals },
  { view: 'dashboard', need: '/admin/orders?status=Pending', locals: dashLocals },
  { view: 'invoices', need: 'order-status-pill', locals: { tab: 'all', page: 1, totalPages: 1, totalCount: 1, rows: [{ id: 35, customer_name: 'Jahid', phone: '01810000001', total_amount: 370, status: 'Pending', payment_status: 'Unpaid', created_at: new Date() }], _statusRows: [{ status: 'Pending', count: 1 }], _statusFilter: null, _statusQs: '', _totalOrdersAll: 1 } },
  { view: 'invoices', need: 'class="table-responsive"', locals: { tab: 'all', page: 1, totalPages: 1, totalCount: 1, rows: [{ id: 35, customer_name: 'Jahid', phone: '01810000001', total_amount: 370, status: 'Pending', payment_status: 'Unpaid', created_at: new Date() }], _statusRows: [{ status: 'Pending', count: 1 }], _statusFilter: null, _statusQs: '', _totalOrdersAll: 1 } },
  { view: 'activity', need: 'btn-call', locals: { tab: 'phone', page: 1, totalPages: 1, totalCount: 1, perPage: 20, phoneTotal: 1, activityTotal: 0, phoneRows: [{ id: 1, customer_name: 'Caller', phone: '01810000001', total_amount: 370, created_at: new Date() }], activityRows: [] } },
  { view: 'products', need: 'class="table-responsive"', locals: { products: [oneProduct], categories: [], categoryGroups: [], q: '', category: '', page: 1, totalPages: 1, totalCount: 1 } },
  { view: 'add-product', need: 'class="admin-form"', locals: { product: null, categories: [], categoryGroups: [], categoryFlat: [], videos: [], options: [], attributes: [], relatedProducts: [], selectedRelated: [], variants: [], stockHistory: [], allProducts: [], relatedIds: [], galleryImages: [] } },
  { view: 'add-product', need: 'id="expand-all-sections"', locals: { product: null, categories: [], categoryGroups: [], categoryFlat: [], videos: [], options: [], attributes: [], relatedProducts: [], selectedRelated: [], variants: [], stockHistory: [], allProducts: [], relatedIds: [], galleryImages: [] } },
  { view: 'categories', need: 'class="cat-row', locals: { q: '', visibility: 'all', categories: [], allCategories: [], treeRoots: [catNode({ children: [catNode({ id: 10, name: 'Kitchen', parent_id: 1, depth: 1, descendantIds: [], totalProductCount: 2, directProductCount: 2, product_count: 2, parent_name: 'Home Appliances' })], descendantIds: [10] })], orphanSubs: [] } },
  { view: 'categories', need: 'class="cat-chevron"', locals: { q: '', visibility: 'all', categories: [], allCategories: [], treeRoots: [catNode({ children: [catNode({ id: 10, name: 'Kitchen', parent_id: 1, depth: 1, descendantIds: [], totalProductCount: 2, directProductCount: 2, product_count: 2, parent_name: 'Home Appliances' })], descendantIds: [10] })], orphanSubs: [] } },
  { view: 'customers', need: 'class="table-responsive"', locals: { customers: [{ id: 1, name: 'Rohim', email: 'r@example.com', phone: '01810000001', created_at: new Date(), is_blocked: 0, order_count: 1, total_spent: 370 }], q: '' } },
  { view: 'reviews', need: 'class="table-responsive"', locals: { reviews: [{ id: 1, product_id: 1, product_name: 'Watch', rating: 5, comment: 'Good', user_name: 'Rohim', status: 'pending', created_at: new Date() }], pending: 1, status: '' } },
  { view: 'inventory', need: 'class="category-bar"', locals: { filter: 'all', products: [{ id: 1, name: 'Watch', image: 'watch.jpg', category_name: 'Winter', stock: 3 }] } },
  { view: 'inventory', need: 'Low Stock', locals: { filter: 'all', products: [{ id: 1, name: 'Watch', image: 'watch.jpg', category_name: 'Winter', stock: 3 }] } },
  { view: 'reports', need: 'class="report-tab', locals: { period: 'monthly', periodLabel: 'This month', summary: { totalOrders: 3, totalRevenue: 1870, avgOrderValue: 623.33 }, itemsSummary: { totalItemsSold: 3 }, cancelledSummary: { cancelledOrders: 0 }, categorySales: [{ id: 8, name: 'Home Appliances', orders: 1, items: 2, revenue: 1980, cost: 1200, profit: 780 }], topProducts: [{ product_name: 'Watch', unitsSold: 2, revenue: 1980 }], orders: [{ id: 35, customer_name: 'Jahid', total_amount: 370, status: 'Pending', created_at: new Date() }], customFrom: '', customTo: '', totalProfit: 490, totalCost: 500 } },
  { view: 'settings', need: 'class="admin-form"', locals: { heroTitle: '', heroSubtitle: '', announcementText: '', shopAddress: '', shopEmail: '', shopPhone: '', facebookUrl: '', instagramUrl: '', youtubeUrl: '', footerAbout: '', footerHours: '', logoUrl: '', faviconUrl: '', ogImageUrl: '', deliveryChargeInside: 60, deliveryChargeOutside: 120, paymentMode: 'manual', gatewayProvider: 'sslcommerz', gatewayMode: 'manual', gatewayEnabled: false, gatewayStoreId: '', gatewayPasswordSet: false, courierProvider: 'steadfast', courierMode: 'manual', courierEnabled: false, courierSteadfastKeySet: false, courierPathaoSecretSet: false, courierPathaoPasswordSet: false, pathaoClientId: '', pathaoStoreId: '', pathaoUsername: '', whatsappPhoneNumberId: '', whatsappTemplateName: '', whatsappTokenSet: false, pwMessage: '', message: '', products: [] } },
  { view: 'login', need: 'admin-login-box', locals: { error: '' } },
  { view: 'login', need: 'width=device-width, initial-scale=1.0', locals: { error: '' } },
  { view: 'order-details', need: '<div class="table-responsive">\n  <table class="invoice-items-table">', locals: Object.assign({}, orderLocals, { _paid: 0, _due: 370, _ph: { total: 0, cancelled: 0, delivered: 0 }, _staleDays: 0, _adv: [], _sends: [], history: [], notes: [], returns: [], courier: {}, courierMsg: '', orderMsg: '', orderErr: '', subtotal: 990, totalCost: 600, totalProfit: 390, _waDigits: '8801810000001', _waMsg: 'hi' }) },
  { view: 'order-invoice', need: '<div class="table-responsive">\n      <table class="invoice-items-table">', locals: orderLocals },
  { view: 'order-invoice', need: 'width=device-width, initial-scale=1.0', locals: orderLocals },
  { view: 'order-packing-slip', need: '<div class="table-responsive">\n      <table class="invoice-items-table">', locals: orderLocals },
];

(async () => {
  console.log('EJS renders — mobile admin markup present');
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
