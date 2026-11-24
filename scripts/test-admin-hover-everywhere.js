// Admin hover everywhere (fix/admin-hover-everywhere) — one unified hover
// system for the whole admin panel.
//
// donal reported: on the Orders (invoices) page a row changes colour on
// hover, but in the other admin options it does not — and he wants the
// same hover EVERYWHERE, future-proof (a new option created later must
// get it automatically), with the row/card LIFTING UP on hover as well
// as changing colour.
//
// Audit (code-verified, see PR body for the full list):
//   - .admin-table rows (Products, Orders, Customers, Reviews, Coupons,
//     Banners, Staff, Zones, Inventory, Stock Alerts/History, Messages,
//     Chats list, Payment Methods, Variants, Reports tables, Settings,
//     Activity, Dashboard tables, customer-detail orders) had the gold
//     tint since PR #43 but NO lift.
//   - .invoice-items-table rows (order-details line items; also the
//     invoice / packing-slip print pages) had NO hover at all.
//   - .cat-row (Categories tree) had a GREY --bg-hover tint, no gold,
//     no lift, no shadow.
//   - .analytics-status-row / .analytics-attention-row (dashboard
//     lists) had NO hover at all.
//   - Cards (.stat-card, .report-card, .analytics-kpi, .analytics-panel)
//     lifted + shadowed but had NO colour change.
//   - .report-summary-card / .invoice-box cards had NO hover at all.
//   - .admin-content .category-bar a (Inventory filter pills) had NO hover.
//   - Sidebar links, .btn-primary/.btn-secondary/.btn-call, .report-tab,
//     quick links and filter buttons already lifted — unchanged.
//   - Chat bubbles (a conversation, not a list), print-only pages and
//     form inputs are intentionally untouched.
//
// Fix (public/css/style.css only — no view changed, every page already
// uses the standard classes): one "ADMIN HOVER SYSTEM" section — gold
// tint var(--table-hover) + translateY(-2px) lift + soft shadow, .22s.
// Table rows lift via their CELLS: a <tr> cannot be transformed (the
// CSS Transforms spec lists table-cell, not table-row, as transformable),
// so the cells move together as one band. Reduced-motion disables both
// the transition and the lift.
//
// Checks:
//   1. CSS: the unified section exists with its future-proof convention
//      comment; every surface above has gold tint + lift (+ shadow where
//      a shadow can paint); the old grey cat-row hover is gone; the
//      Orders row hover is unchanged; sidebar/buttons still lift;
//      reduced-motion covers the new selectors with transition:none AND
//      transform:none; no hardcoded grey hover in the new section;
//      braces balanced; the section touches admin classes only.
//   2. EJS: a representative set of admin pages renders rows/cards with
//      the standard hover classes (direct renderFile with stub locals).
//
// Run:  node scripts/test-admin-hover-everywhere.js
// Exit code 0 = all checks passed.
'use strict';

const fs = require('fs');
const path = require('path');
const util = require('util');
const ejs = require('ejs');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'style.css'), 'utf8');
const renderFile = util.promisify(ejs.renderFile);
const viewPath = (name) => path.join(__dirname, '..', 'views', 'admin', name + '.ejs');

// ---------- checks ----------
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
// The unified hover section: from its banner comment to the Analytics section.
const hoverSection = sectionOf(css, 'ADMIN HOVER SYSTEM', '/* Analytics */');
// The admin reduced-motion block (the first one; the second is shop-only).
const reducedMotion = sectionOf(css, '/* Respect reduced-motion: no hover lift or transitions in the admin */', '\n}\n');

console.log('CSS — unified hover system');
check('unified ADMIN HOVER SYSTEM section exists', hoverSection.length > 500,
  'section length ' + hoverSection.length);
check('convention comment tells new pages which classes to use',
  hoverSection.includes('CONVENTION for new admin pages') &&
  hoverSection.includes('.admin-table') && hoverSection.includes('.cat-row') &&
  hoverSection.includes('.analytics-panel') && hoverSection.includes('.invoice-box') &&
  hoverSection.includes('Do NOT invent a new row/card class'),
  'convention comment incomplete');
check('convention comment explains the row-lift technique (cells, not tr)',
  hoverSection.replace(/\s+/g, ' ').includes('table-cell, not table-row') &&
  hoverSection.replace(/\s+/g, ' ').includes('cannot be painted reliably while border-collapse'),
  'lift explanation missing');
check('unified section touches admin classes only (no shop selectors)',
  !hoverSection.includes('.shop-') && !hoverSection.includes('mega-menu') &&
  !hoverSection.includes('.site-header'),
  'shop selector leaked into the admin hover section');

// --- Table rows: gold tint + lift via cells ---
check('admin-table row cells lift on hover (translateY(-2px))',
  /\.admin-table tbody tr:hover td[\s\S]*?transform:\s*translateY\(-2px\)/.test(hoverSection),
  'no td lift rule');
check('admin-table row cells turn gold on hover (var(--table-hover))',
  /\.admin-table tbody tr:hover td[\s\S]*?background:\s*var\(--table-hover\)/.test(hoverSection),
  'no td gold rule');
check('admin-table row cells transition background + transform',
  /\.admin-table tbody tr td[\s\S]*?transition:[^;]*background-color[^;]*transform/.test(hoverSection),
  'td transition missing transform');
check('invoice-items-table rows turn gold on hover (had no hover before)',
  /\.invoice-items-table tbody tr:hover\s*\{\s*background:\s*var\(--table-hover\)/.test(hoverSection),
  'no invoice-items-table row tint');
check('invoice-items-table row cells lift on hover',
  /\.invoice-items-table tbody tr:hover td[\s\S]*?transform:\s*translateY\(-2px\)/.test(hoverSection),
  'no invoice-items-table td lift');
check('Orders row hover itself is unchanged (same gold tint on the row)',
  /\.admin-table tbody tr:hover\s*\{\s*background:\s*var\(--table-hover\)/.test(css),
  'original row hover rule changed or missing');

// --- Category tree rows: gold (was grey) + lift + shadow ---
check('cat-row hover is gold now (var(--table-hover))',
  /\.cat-row:hover\s*\{\s*background:\s*var\(--table-hover\)/.test(hoverSection),
  'cat-row hover is not gold');
check('cat-row hover lifts + shadows',
  /\.cat-row:hover[\s\S]*?transform:\s*translateY\(-2px\)/.test(hoverSection) &&
  /\.cat-row:hover[\s\S]*?box-shadow:\s*0 8px 18px/.test(hoverSection),
  'cat-row lift/shadow missing');
check('old grey cat-row hover is gone (no var(--bg-hover) on .cat-row:hover)',
  !/\.cat-row:hover\s*\{\s*background:\s*var\(--bg-hover\)/.test(css),
  'old grey cat-row hover still present');

// --- Dashboard list rows: no hover before, now gold + lift + shadow ---
check('analytics-status-row hover: gold + lift + shadow',
  /\.analytics-status-row:hover[\s\S]*?background:\s*var\(--table-hover\)/.test(hoverSection) &&
  /\.analytics-status-row:hover[\s\S]*?transform:\s*translateY\(-2px\)/.test(hoverSection) &&
  /\.analytics-status-row:hover[\s\S]*?box-shadow:\s*0 8px 18px/.test(hoverSection),
  'status-row hover incomplete');
check('analytics-attention-row hover: gold + lift + shadow',
  /\.analytics-attention-row:hover[\s\S]*?background:\s*var\(--table-hover\)/.test(hoverSection) &&
  /\.analytics-attention-row:hover[\s\S]*?transform:\s*translateY\(-2px\)/.test(hoverSection) &&
  /\.analytics-attention-row:hover[\s\S]*?box-shadow:\s*0 8px 18px/.test(hoverSection),
  'attention-row hover incomplete');

// --- Cards: gold tint added to the lift + shadow they already had ---
check('cards turn gold on hover (stat/report/kpi/panel/summary/invoice-box)',
  /\.stat-card:hover,[\s\S]*?\.invoice-box:hover\s*\{\s*background:\s*var\(--table-hover\)/.test(hoverSection),
  'card tint rule missing');
check('report-summary-card + invoice-box lift + shadow on hover (had none)',
  /\.report-summary-card:hover,[\s\S]*?transform:\s*translateY\(-2px\)/.test(hoverSection) &&
  /\.report-summary-card:hover,[\s\S]*?box-shadow:\s*0 12px 28px/.test(hoverSection),
  'summary/invoice-box lift missing');
check('cards keep their existing lift rules (stat-card, analytics-panel)',
  /\.stat-card:hover,[\s\S]*?transform:\s*translateY\(-2px\)/.test(css) &&
  /\.analytics-panel:hover\s*\{\s*transform:\s*translateY\(-2px\)/.test(css),
  'existing card lift changed');

// --- Admin filter pills (Inventory): no hover before ---
check('admin filter pills turn gold + lift on hover',
  /\.admin-content \.category-bar a:not\(\.active\):hover\s*\{\s*background:\s*var\(--table-hover\)/.test(hoverSection) &&
  /\.admin-content \.category-bar a:not\(\.active\):hover[\s\S]*?transform:\s*translateY\(-1px\)/.test(hoverSection),
  'filter-pill hover missing');
check('filter-pill hover is scoped to admin (shop category bars untouched)',
  hoverSection.includes('.admin-content .category-bar a:not(.active):hover'),
  'pill rule not admin-scoped');

// --- Already-good hover, unchanged ---
check('sidebar links still lift + shadow on hover',
  /\.admin-sidebar nav a:hover\s*\{[^}]*transform:\s*translateX\(3px\)[^}]*box-shadow/.test(css),
  'sidebar hover changed');
check('buttons still lift on hover (btn-secondary, btn-call)',
  /\.btn-secondary:hover\s*\{[^}]*transform:\s*translateY\(-1px\)/.test(css) &&
  /\.btn-call:hover,[\s\S]*?transform:\s*translateY\(-1px\)/.test(css),
  'button hover changed');

// --- Reduced motion: transition AND lift both disabled ---
check('reduced-motion block exists and lists the new selectors (transition: none)',
  reducedMotion.includes('.admin-table tbody tr td') &&
  reducedMotion.includes('.invoice-items-table tbody tr td') &&
  reducedMotion.includes('.analytics-status-row') &&
  reducedMotion.includes('.analytics-attention-row') &&
  reducedMotion.includes('.report-summary-card') &&
  reducedMotion.includes('.invoice-box') &&
  reducedMotion.includes('.admin-content .category-bar a') &&
  reducedMotion.includes('transition: none'),
  'new selectors missing from reduced-motion transition list');
check('reduced-motion disables the lift itself (transform: none on hover)',
  reducedMotion.includes('.admin-table tbody tr:hover td') &&
  reducedMotion.includes('.invoice-items-table tbody tr:hover td') &&
  reducedMotion.includes('.cat-row:hover') &&
  reducedMotion.includes('.analytics-status-row:hover') &&
  reducedMotion.includes('.analytics-attention-row:hover') &&
  reducedMotion.includes('.report-summary-card:hover') &&
  reducedMotion.includes('.invoice-box:hover') &&
  reducedMotion.includes('transform: none'),
  'lift not disabled under reduced motion');
check('reduced-motion transform:none covers the full admin button selectors',
  reducedMotion.includes('.admin-content .btn-primary:hover') &&
  reducedMotion.includes('.admin-content button:hover:not(:disabled)'),
  'admin button lift escapes reduced motion');

// --- Hygiene: theme variables only, no hardcoded grey, braces balanced ---
check('gold hover vars defined in both themes',
  /--table-hover:\s*#fce9b8/.test(css) && /--table-hover:\s*#54431c/.test(css),
  'table-hover vars missing');
check('no hardcoded grey hover colour in the new section',
  !/#888|#999|#666/.test(hoverSection) && !hoverSection.includes('var(--bg-hover)'),
  'hardcoded grey / bg-hover in the new section');
check('CSS braces balanced',
  (() => { let d = 0; for (const ch of css) { if (ch === '{') d++; if (ch === '}') d--; if (d < 0) return false; } return d === 0; })(),
  'unbalanced braces');

// ---------- EJS renders: every admin page uses a standard hover class ----------
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
  { view: 'products', need: 'class="admin-table"', locals: { products: [oneProduct], categories: [], categoryGroups: [], q: '', category: '', page: 1, totalPages: 1, totalCount: 1 } },
  { view: 'customers', need: 'class="admin-table"', locals: { customers: [{ id: 1, name: 'Rohim', email: 'r@example.com', phone: '01810000001', created_at: new Date(), is_blocked: 0, order_count: 1, total_spent: 370 }], q: '' } },
  { view: 'reviews', need: 'class="admin-table"', locals: { reviews: [{ id: 1, product_id: 1, product_name: 'Watch', rating: 5, comment: 'Good', user_name: 'Rohim', status: 'pending', created_at: new Date() }], pending: 1, status: '' } },
  { view: 'coupons', need: 'class="admin-table"', locals: { coupons: [{ id: 1, code: 'TEST10', discount_percent: 10, expiry_date: '2026-12-31', active: 1 }] } },
  { view: 'banners', need: 'class="admin-table"', locals: { banners: [{ id: 1, title: 'Sale', subtitle: '', image: '/x.png', link_url: '/', sort_order: 1, is_active: 1 }], editing: null } },
  { view: 'categories', need: 'class="cat-row', locals: { q: '', visibility: 'all', categories: [], allCategories: [], treeRoots: [catNode({ children: [catNode({ id: 10, name: 'Kitchen', parent_id: 1, depth: 1, descendantIds: [], totalProductCount: 2, directProductCount: 2, product_count: 2, parent_name: 'Home Appliances' })], descendantIds: [10] })], orphanSubs: [] } },
  { view: 'messages', need: 'class="admin-table"', locals: { messages: [{ id: 1, name: 'Rohim', email: 'r@example.com', phone: '01810000001', subject: 'Hi', message: 'Hello', is_read: 0, created_at: new Date() }], unread: 1 } },
  { view: 'activity', need: 'class="admin-table"', locals: { tab: 'phone', page: 1, totalPages: 1, totalCount: 1, perPage: 20, phoneTotal: 1, activityTotal: 0, phoneRows: [{ id: 1, customer_name: 'Caller', phone: '01810000001', total_amount: 370, created_at: new Date() }], activityRows: [] } },
  { view: 'invoices', need: 'class="admin-table"', locals: { tab: 'all', page: 1, totalPages: 1, totalCount: 1, rows: [{ id: 35, customer_name: 'Jahid', phone: '01810000001', total_amount: 370, status: 'Pending', payment_status: 'Unpaid', created_at: new Date() }], _statusRows: [{ status: 'Pending', count: 1 }], _statusFilter: null, _statusQs: '', _totalOrdersAll: 1 } },
  { view: 'invoices', need: 'order-status-pill', locals: { tab: 'all', page: 1, totalPages: 1, totalCount: 1, rows: [{ id: 35, customer_name: 'Jahid', phone: '01810000001', total_amount: 370, status: 'Pending', payment_status: 'Unpaid', created_at: new Date() }], _statusRows: [{ status: 'Pending', count: 1 }], _statusFilter: null, _statusQs: '', _totalOrdersAll: 1 } },
  // NOTE: no dashboard render case for .analytics-status-row — the Order
  // status panel (its only use) left the dashboard in PR #49, so the
  // class renders nowhere today. The CSS rule stays in the system so any
  // future status list inherits the hover automatically (covered by the
  // CSS checks above).
  { view: 'dashboard', need: 'analytics-attention-row', locals: dashLocals },
  { view: 'dashboard', need: 'analytics-kpi', locals: dashLocals },
  { view: 'order-details', need: 'class="invoice-items-table"', locals: { order: { id: 35, customer_name: 'Jahid', phone: '01810000001', status: 'Pending', payment_status: 'Unpaid', total_amount: 370, created_at: new Date(), address: 'Dhaka', district: 'Dhaka', payment_method: 'Cash on Delivery', delivery_charge: 60, discount_amount: 0, coupon_code: null, courier_name: null, tracking_id: null, notes: '' }, items: [{ product_name: 'Watch', price: 990, quantity: 1, variant_label: '', cost_price: 600 }], _paid: 0, _due: 370, _ph: { total: 0, cancelled: 0, delivered: 0 }, _staleDays: 0, _adv: [], _sends: [], history: [], notes: [], returns: [], courier: {}, courierMsg: '', orderMsg: '', orderErr: '', shopPhone: '01814697896', subtotal: 990, totalCost: 600, totalProfit: 390, _waDigits: '8801810000001', _waMsg: 'hi' } },
  { view: 'order-details', need: 'class="stat-card"', locals: { order: { id: 35, customer_name: 'Jahid', phone: '01810000001', status: 'Pending', payment_status: 'Unpaid', total_amount: 370, created_at: new Date(), address: 'Dhaka', district: 'Dhaka', payment_method: 'Cash on Delivery', delivery_charge: 60, discount_amount: 0, coupon_code: null, courier_name: null, tracking_id: null, notes: '' }, items: [{ product_name: 'Watch', price: 990, quantity: 1, variant_label: '', cost_price: 600 }], _paid: 0, _due: 370, _ph: { total: 0, cancelled: 0, delivered: 0 }, _staleDays: 0, _adv: [], _sends: [], history: [], notes: [], returns: [], courier: {}, courierMsg: '', orderMsg: '', orderErr: '', shopPhone: '01814697896', subtotal: 990, totalCost: 600, totalProfit: 390, _waDigits: '8801810000001', _waMsg: 'hi' } },
  { view: 'attributes', need: 'class="invoice-box"', locals: { attributes: [{ id: 1, name: 'Size', values: [{ id: 1, value: 'M' }] }] } },
  { view: 'inventory', need: 'class="admin-table"', locals: { filter: 'all', products: [{ id: 1, name: 'Watch', image: 'watch.jpg', category_name: 'Winter', stock: 3 }] } },
  { view: 'inventory', need: 'class="category-bar"', locals: { filter: 'all', products: [{ id: 1, name: 'Watch', image: 'watch.jpg', category_name: 'Winter', stock: 3 }] } },
  { view: 'delivery-zones', need: 'class="admin-table"', locals: { zones: [{ id: 1, name: 'Dhaka', charge: 60, delivery_time: '1-2 days', is_active: 1 }] } },
  { view: 'payment-methods', need: 'class="admin-table"', locals: { methods: [{ id: 1, method_name: 'bKash', payment_type: 'Send Money', number: '01814697896', instructions: '', is_active: 1 }] } },
  { view: 'staff', need: 'class="admin-table"', locals: { admins: [{ id: 1, email: 'admin@goince.com', role: 'owner', created_at: new Date() }], error: '', message: '' } },
  { view: 'reports', need: 'class="report-card"', locals: { period: 'monthly', periodLabel: 'This month', summary: { totalOrders: 3, totalRevenue: 1870, avgOrderValue: 623.33 }, itemsSummary: { totalItemsSold: 3 }, cancelledSummary: { cancelledOrders: 0 }, categorySales: [{ id: 8, name: 'Home Appliances', orders: 1, items: 2, revenue: 1980, cost: 1200, profit: 780 }], topProducts: [{ product_name: 'Watch', unitsSold: 2, revenue: 1980 }], orders: [{ id: 35, customer_name: 'Jahid', total_amount: 370, status: 'Pending', created_at: new Date() }], customFrom: '', customTo: '', totalProfit: 490, totalCost: 500 } },
  { view: 'reports', need: 'class="admin-table"', locals: { period: 'monthly', periodLabel: 'This month', summary: { totalOrders: 3, totalRevenue: 1870, avgOrderValue: 623.33 }, itemsSummary: { totalItemsSold: 3 }, cancelledSummary: { cancelledOrders: 0 }, categorySales: [{ id: 8, name: 'Home Appliances', orders: 1, items: 2, revenue: 1980, cost: 1200, profit: 780 }], topProducts: [{ product_name: 'Watch', unitsSold: 2, revenue: 1980 }], orders: [{ id: 35, customer_name: 'Jahid', total_amount: 370, status: 'Pending', created_at: new Date() }], customFrom: '', customTo: '', totalProfit: 490, totalCost: 500 } },
  { view: 'customer-detail', need: 'class="invoice-box"', locals: { customer: { id: 1, name: 'Rohim', email: 'r@example.com', phone: '01810000001', is_blocked: 0, created_at: new Date() }, orders: [], totalOrders: 0, totalSpent: 0, avgOrderValue: 0, lastOrderDate: null, wishlistCount: 0 } },
  { view: 'chats', need: 'class="admin-table"', locals: { conversations: [{ id: 1, customer_name: 'Rohim', last_message: 'Hi', last_message_at: new Date() }] } },
  { view: 'stock-alerts', need: 'class="admin-table"', locals: { alerts: [{ id: 1, product_name: 'Watch', phone: '01810000001', stock: 2, notified: 0, created_at: new Date() }] } },
  { view: 'stock-history', need: 'class="admin-table"', locals: { product: { id: 1, name: 'Watch' }, rows: [{ change_qty: -1, stock_after: 14, reason: 'Order #35', created_at: new Date() }] } },
  { view: 'product-variants', need: 'class="admin-table"', locals: { product: { id: 1, name: 'Watch' }, attributes: [{ id: 1, name: 'Size', values: [{ id: 1, value: 'M' }] }], variants: [{ id: 1, label: 'M / Red', image: null, stock: 5, price: 990, compare_at_price: null, barcode: '' }], selectedValueIds: new Set([1]) } },
  { view: 'settings', need: 'class="admin-table"', locals: { heroTitle: '', heroSubtitle: '', announcementText: '', shopAddress: '', shopEmail: '', shopPhone: '', facebookUrl: '', instagramUrl: '', youtubeUrl: '', footerAbout: '', footerHours: '', logoUrl: '', faviconUrl: '', ogImageUrl: '', deliveryChargeInside: 60, deliveryChargeOutside: 120, paymentMode: 'manual', gatewayProvider: 'sslcommerz', gatewayMode: 'manual', gatewayEnabled: false, gatewayStoreId: '', gatewayPasswordSet: false, courierProvider: 'steadfast', courierMode: 'manual', courierEnabled: false, courierSteadfastKeySet: false, courierPathaoSecretSet: false, courierPathaoPasswordSet: false, pathaoClientId: '', pathaoStoreId: '', pathaoUsername: '', whatsappPhoneNumberId: '', whatsappTemplateName: '', whatsappTokenSet: false, pwMessage: '', message: '', products: [] } },
];

(async () => {
  console.log('EJS renders — standard hover classes present');
  for (const c of cases) {
    try {
      const html = await renderFile(viewPath(c.view), Object.assign({}, base, c.locals));
      check(`${c.view}.ejs renders with ${c.need}`, has(html, c.need),
        'rendered but class missing');
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
