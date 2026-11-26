// Professional polish 2 (fix/professional-polish-2) — EJS + CSS + route tests.
//
// Donal said the design/look looks unprofessional in many places. A live
// visual audit of all admin pages + shop found the issues fixed here. This
// suite asserts the concrete fixes:
//
//   1. Add Product: labels above inputs, "(Optional)" spaced, no Bangla
//      sentence in the English admin, Expand/Collapse All consistent.
//   2. Order #35 Due bug: the details page showed Due ৳370 while the
//      Orders list showed Due ৳0.00 for the same order. The list was
//      right (due = total - advances - COD-collected, lib/invoice.js).
//      The view fell back to the full total when due was 0 (falsy).
//   3. No truncated sentences in the changed views; footer/delivery-time
//      startup fixes exist for the truncated stored strings.
//   4. One date format ("25 Nov 2026") and one currency format (৳ before,
//      no decimals except invoice/PDF totals) in the changed admin views.
//   5. Pipe-separated text actions gone from the changed admin tables.
//   6. Empty states are cards on Reviews / Messages / Customers / Reports.
//   7. /admin/contact-messages redirects to /admin/messages.
//   8. WhatsApp float cannot cover the cart checkout button.
//   9. Product cards equal height with buttons aligned to the bottom.
//  10. "Winter Collection" investigation: two separate category rows share
//      the name (top-level + sub-category under Seasonal Products) — the
//      tree builder renders each node exactly once, so it is data, not a
//      rendering bug. No category is deleted or renamed.
//
// Run:  node scripts/test-professional-polish-2.js
// Exit code 0 = all checks passed.
'use strict';

const fs = require('fs');
const path = require('path');
const util = require('util');
const ejs = require('ejs');

const renderFile = util.promisify(ejs.renderFile);
const viewPath = (name) => path.join(__dirname, '..', 'views', name + '.ejs');
const adminView = (name) => path.join(__dirname, '..', 'views', 'admin', name + '.ejs');
const read = (p) => fs.readFileSync(p, 'utf8');

const failures = [];
const passes = [];
function check(name, ok, detail) {
  if (ok) { passes.push(name); console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

const css = read(path.join(__dirname, '..', 'public', 'css', 'style.css'));
const adminJs = read(path.join(__dirname, '..', 'routes', 'admin.js'));
const shopJs = read(path.join(__dirname, '..', 'routes', 'shop.js'));
const serverJs = read(path.join(__dirname, '..', 'server.js'));
const startupFixes = read(path.join(__dirname, '..', 'lib', 'startup-content-fixes.js'));
const footerEjs = read(viewPath('partials/footer'));
const { dueAmount, paidAmount } = require('../lib/invoice');
const { buildCategoryTree, flattenTree } = require('../lib/categories');

const base = {
  siteName: 'Goince',
  siteSettings: { logo_url: '/icons/icon-192.png' },
  adminRole: 'owner',
  csrfToken: 'test-csrf',
  assetUrl: (p) => p,
  cartCount: 0,
  userName: '',
  theme: 'light',
  shopPhone: '01814697896',
};

// Views whose copy/actions were changed in this PR.
const changedAdminViews = ['products', 'customers', 'coupons', 'payment-methods',
  'delivery-zones', 'categories', 'category-row', 'staff', 'messages', 'reviews',
  'invoices', 'activity', 'reports', 'settings', 'add-product', 'order-details',
  'dashboard', 'customer-detail', 'chats', 'search'];

// Bangla *letters* only — the ৳ sign (U+09F3) sits in the Bengali block
// too, so the full block would false-positive on every price.
const banglaLetters = /[\u0985-\u09E5]/;

(async () => {
  console.log('CSS — small-button family, status pill, wide forms, empty states');
  check('.btn-sm base rule exists', /\.btn-sm\s*\{/.test(css), 'no .btn-sm rule');
  check('.btn-sm--primary is the admin blue', css.includes('.btn-sm--primary { background: var(--admin-blue); border-color: var(--admin-blue); color: #fff; }'));
  check('.btn-sm--danger is a real red button', css.includes('.btn-sm--danger { background: var(--danger-solid); border-color: var(--danger-solid); color: #fff; }'));
  check('.admin-actions wraps row buttons', css.includes('.admin-actions {'));
  check('.status-inactive is a neutral grey pill (not red)', css.includes('.status-inactive { background: #6c757d; }'));
  check('.admin-form--wide exists for the narrow add-forms', css.includes('.admin-form--wide {'));
  check('.empty-state card exists', css.includes('.empty-state {') && css.includes('.empty-state-icon {'));
  check('stylesheet braces balanced',
    (() => { let d = 0; for (const ch of css) { if (ch === '{') d++; if (ch === '}') d--; if (d < 0) return false; } return d === 0; })(),
    'unbalanced braces');

  console.log('CSS — active tab readable (link rule must not beat .admin-tab.is-active)');
  check('light link rule excludes .admin-tab', css.includes('.admin-content a:not(.btn-primary):not(.btn-secondary):not(.btn-sm):not(.btn-call):not(.report-tab):not(.analytics-report-link):not(.admin-tab)'));
  check('dark link rule excludes .admin-tab', css.includes('[data-theme="dark"] .admin-content a:not(.btn-primary):not(.btn-secondary):not(.btn-sm):not(.btn-call):not(.report-tab):not(.analytics-report-link):not(.admin-tab)'));

  console.log('CSS — product cards, trust bar, report grid equal heights');
  check('.product-card is a flex column', /\.product-card\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column/.test(css));
  check('product-card button sits at the bottom (margin-top:auto)', css.includes('.product-card > a.btn-card, .product-card > form { margin-top: auto; }'));
  check('.product-grid centres the last row', /\.product-grid\s*\{[^}]*justify-content:\s*center/.test(css));
  check('.trust-bar rows are equal height', /\.trust-bar\s*\{[^}]*grid-auto-rows:\s*1fr/.test(css));
  check('.report-summary-grid is 3 columns (no lone card on a row)', /\.report-summary-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3,/.test(css));
  check('.report-card is a flex column with the value pushed down', /\.report-card\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column/.test(css) && css.includes('.report-card-value { margin-top: auto'));

  console.log('CSS — shop polish (one coherent sale treatment, one active pill, usable filters)');
  check('.discount-badge is amber on navy (not red)', /\.discount-badge\s*\{[^}]*background:\s*var\(--accent\);[^}]*color:\s*var\(--navy\)/.test(css));
  check('.category-bar a.active is amber (was navy/black)', /\.category-bar a\.active\s*\{[^}]*background:\s*var\(--accent\)/.test(css));
  check('.price-input gives the Min/Max fields a usable width', css.includes('.price-input {') && css.includes('width: 115px'));
  check('.avg-rating-empty is a muted empty-stars style', css.includes('.avg-rating-empty {'));
  check('checkout steps are one pill treatment (current amber / done green / todo grey)', css.includes('.checkout-steps span.active { background: var(--accent)') && css.includes('.checkout-steps span.done { background: #e3f2e8') && css.includes('.checkout-steps span { padding: 6px 14px; border-radius: 999px; background: var(--bg)'));
  check('cart summary keeps clear of the WhatsApp float (<=1024px)', css.includes('.cart-summary { margin-bottom: 130px; }'));
  check('admin table headers stay on one line', css.includes('.admin-table th { white-space: nowrap; }'));
  check('product names ellipsize instead of wrapping 4-5 lines', css.includes('.product-name-cell {'));
  check('analytics report link is the standard blue (was amber)', /\.analytics-report-link[^{]*\{[^}]*color:\s*var\(--admin-blue\)/.test(css));
  check('header nav buttons are one family (same padding + radius)', css.includes('.btn-nav-outline, .btn-nav-solid {') && css.includes('padding: 8px 16px'));
  check('theme toggle is a 6px-radius button, not a circle', css.includes('.theme-toggle-btn {') && !/\.theme-toggle-btn\s*\{[^}]*border-radius:\s*50%/.test(css));
  check('checkout summary stays sticky (no orphaned short card)', /\.checkout-summary\s*\{[^}]*position:\s*sticky/.test(css));

  console.log('Due bug — lib/invoice.js rule (the list was right)');
  check('dueAmount: total 370, COD collected, no advances -> due 0',
    dueAmount({ total_amount: 370, status: 'Pending', cod_collected: 1 }, 0) === 0);
  check('paidAmount: total 370, COD collected -> paid 370',
    paidAmount({ total_amount: 370, status: 'Pending', cod_collected: 1 }, 0) === 370);
  check('dueAmount: total 370, advance 200, no COD -> due 170',
    dueAmount({ total_amount: 370, status: 'Pending', cod_collected: 0 }, 200) === 170);
  check('dueAmount: cancelled order owes 0 even when unpaid',
    dueAmount({ total_amount: 370, status: 'Cancelled', cod_collected: 0 }, 0) === 0);

  console.log('Timeline — collapse identical consecutive changes, attribute to the admin');
  check('collapseHistory exists in routes/admin.js', adminJs.includes('function collapseHistory('));
  check('order-details handler collapses the history before rendering', adminJs.includes('collapseHistory(history)'));
  check('collapse drops a run of identical consecutive from→to changes (keeps the latest, newest-first)',
    adminJs.includes('prev.old_status === h.old_status && prev.new_status === h.new_status'));
  const detailsSrc = read(adminView('order-details'));
  check('details view no longer falls back to the full total when due is 0 (falsy)',
    !detailsSrc.includes("typeof due!== 'undefined' && due") && detailsSrc.includes("due !== null"));
  check('timeline attributes to "Admin" when changed_by is the customer email',
    detailsSrc.includes("changed_by === order.customer_email") || detailsSrc.includes("'Admin'"));
  check('details header has one print/PDF invoice + one packing slip (no duplicate Print Invoice)',
    (detailsSrc.match(/Print Invoice/g) || []).length <= 1 && detailsSrc.includes('Invoice (Print / PDF)') && detailsSrc.includes('Packing Slip'));
  check('details labels have a space after the punctuation',
    detailsSrc.includes('Invoice No.:') && detailsSrc.includes('Date:'));

  console.log('Add Product — labels above inputs, "(Optional)" spaced, no Bangla in the admin');
  const addSrc = read(adminView('add-product'));
  check('no Bangla letters in add-product.ejs (the ৳ sign is not Bangla text)', !banglaLetters.test(addSrc));
  check('"(Optional)" uses the .section-optional class (guaranteed gap)', addSrc.includes('class="section-optional"') && !addSrc.includes('Profit(Optional)'));
  check('page style puts labels above inputs', /\.section-body label\s*\{\s*display:\s*block/.test(addSrc));
  check('Expand All is btn-secondary (same pair as Collapse All)',
    /id="expand-all-sections"[^>]*class="btn-secondary"|class="btn-secondary"[^>]*id="expand-all-sections"/.test(addSrc));
  const addHtml = await renderFile(adminView('add-product'), Object.assign({}, base, {
    product: null, categories: [], categoryGroups: [], categoryFlat: [], videos: [],
    options: [], attributes: [], relatedProducts: [], selectedRelated: [], variants: [],
    stockHistory: [], allProducts: [], relatedIds: [], galleryImages: [],
  }));
  check('add-product.ejs renders', addHtml.includes('Add New Product'));
  check('rendered add-product has no Bangla letters', !banglaLetters.test(addHtml));
  check('rendered "(Optional)" titles are spaced', addHtml.includes('Pricing &amp; Profit') && addHtml.includes('section-optional'));

  console.log('Order #35 details render — Due 0.00 when paid in full');
  const orderLocals = {
    order: { id: 35, customer_name: 'Jahid', phone: '01810000001', status: 'Pending', payment_status: 'Unpaid', total_amount: 370, created_at: new Date(), address: 'Dhaka', district: 'Dhaka', payment_method: 'Cash on Delivery', delivery_charge: 60, discount_amount: 0, coupon_code: null, courier_name: null, tracking_id: null, notes: '' },
    items: [{ product_name: 'Watch', price: 990, quantity: 1, variant_label: '', cost_price: 600 }],
    shopPhone: '01814697896', paid: 370, due: 0,
  };
  const detailsHtml = await renderFile(adminView('order-details'), Object.assign({}, base, orderLocals, {
    _ph: { total: 0, cancelled: 0, delivered: 0 }, _staleDays: 0, _adv: [], _sends: [],
    history: [], notes: [], returns: [], courier: {}, courierMsg: '', orderMsg: '',
    orderErr: '', subtotal: 990, totalCost: 600, totalProfit: 390,
    _waDigits: '8801810000001', _waMsg: 'hi',
  }));
  check('details page renders', detailsHtml.includes('Order #35'));
  check('Due card shows ৳0.00 (agrees with the Orders list)', detailsHtml.includes('<h3>৳0.00</h3><p>Due</p>'));
  check('Paid card shows ৳370.00', detailsHtml.includes('<h3>৳370.00</h3><p>Paid</p>'));
  check('totals box Due is ৳0.00, not the full total', detailsHtml.includes('<span>Due</span><span>৳0.00</span>'));

  console.log('No truncated sentences in the changed views');
  // Markers are the TRUNCATED forms (with the ellipsis) — the finished
  // sentences share the same prefix, so a prefix-only marker would
  // false-positive on the fixed text.
  const truncated = [
    'If the advance covers the…',
    'Email needs EMAIL_USER…',
    'SMS provider is not connected yet — the button shows that message instead…',
    'without dele…',
    '3–5 dine deliver',
  ];
  for (const view of changedAdminViews) {
    const src = read(adminView(view));
    for (const t of truncated) {
      check(`${view}.ejs has no truncated string "${t.slice(0, 28)}…"`, !src.includes(t));
    }
  }
  check('startup fix repairs the truncated footer value (exact match only)', startupFixes.includes('fixFooterAbout') && startupFixes.includes('3–5 dine deliver'));
  check('startup fix normalises 1-2 din / 3-5 din delivery times (exact match only)', startupFixes.includes('fixDeliveryTimeText'));
  check('server.js runs both startup fixes', serverJs.includes('fixFooterAbout') && serverJs.includes('fixDeliveryTimeText'));

  console.log('One date format — "25 Nov 2026" — in the changed admin views');
  for (const view of changedAdminViews) {
    const src = read(adminView(view));
    // A bare date call is new Date(...).toLocaleDateString() / .toLocaleString()
    // with no locale argument. Number(...).toLocaleString() is count formatting,
    // not a date, and is fine.
    check(`${view}.ejs has no bare toLocaleDateString()/toLocaleString() date call`,
      !/new Date\([^)]*\)\.toLocale(?:Date)?String\(\)/.test(src));
  }
  check('reports custom period label is formatted (not ISO)', adminJs.includes("fmtDay(customFrom) + ' to ' + fmtDay(customTo)"));
  check('reports "Today" label is formatted', adminJs.includes('fmtToday()'));

  console.log('One currency format — ৳ before, no decimals except invoice/PDF');
  // The _tk helper itself uses .toFixed(2) for non-whole values (e.g. a
  // percentage discount) — that is the helper definition, not a displayed
  // amount. Strip the helper lines, then no .toFixed(2) may remain.
  const noHelper = (src) => src.split('\n').filter((l) => !l.includes('const _tk') && !l.includes("return '৳' + (Number.isInteger")).join('\n');
  check('cart.ejs has no .toFixed(2) outside the _tk helper', !noHelper(read(viewPath('cart'))).includes('.toFixed(2)'));
  check('checkout.ejs has no .toFixed(2) outside the _tk helper', !noHelper(read(viewPath('checkout'))).includes('.toFixed(2)'));
  check('reports.ejs has no .toFixed(2) outside the _tk helper', !noHelper(read(adminView('reports'))).includes('.toFixed(2)'));
  check('invoices.ejs KEEPS .toFixed(2) (invoice exception)', read(adminView('invoices')).includes('.toFixed(2)'));
  check('order-details.ejs KEEPS .toFixed(2) (invoice exception)', detailsSrc.includes('.toFixed(2)'));
  check('delivery zones show ৳ before the charge input (was "60 ৳")', read(adminView('delivery-zones')).includes('৳ <input'));
  check('no "60 ৳" / "৳ after number" pattern in the changed views',
    !changedAdminViews.some((v) => /\d\s*৳/.test(read(adminView(v)))));

  console.log('Pipe-separated text actions gone from the changed admin tables');
  for (const view of ['products', 'customers', 'coupons', 'payment-methods', 'delivery-zones', 'categories', 'category-row', 'staff', 'messages', 'reviews']) {
    const src = read(adminView(view));
    check(`${view}.ejs has no " | " action separators`, !src.includes(' | '));
    check(`${view}.ejs has no link-btn-danger text action`, !src.includes('link-btn-danger'));
  }

  console.log('Empty states are cards');
  const reviewsHtml = await renderFile(adminView('reviews'), Object.assign({}, base, { reviews: [], pending: 0, status: '' }));
  check('reviews empty state is a card', reviewsHtml.includes('class="empty-state"') && reviewsHtml.includes('No reviews found'));
  const messagesHtml = await renderFile(adminView('messages'), Object.assign({}, base, { messages: [], unread: 0, status: 'all', statusCounts: { open: 0, answered: 0, closed: 0 }, total: 0 }));
  check('messages empty state is a card', messagesHtml.includes('class="empty-state"') && messagesHtml.includes('No messages yet'));
  const customersHtml = await renderFile(adminView('customers'), Object.assign({}, base, { customers: [], q: '' }));
  check('customers empty state is a card', customersHtml.includes('class="empty-state"') && customersHtml.includes('No customers found'));
  const reportsHtml = await renderFile(adminView('reports'), Object.assign({}, base, {
    period: 'monthly', periodLabel: 'This Month', summary: { totalOrders: 0, totalRevenue: 0, avgOrderValue: 0 },
    itemsSummary: { totalItemsSold: 0 }, cancelledSummary: { cancelledOrders: 0 },
    categorySales: [], topProducts: [], orders: [], customFrom: '', customTo: '', totalProfit: 0, totalCost: 0,
  }));
  check('reports empty state is a card', reportsHtml.includes('class="empty-state"') && reportsHtml.includes('No products sold in this period'));
  const activityHtml = await renderFile(adminView('activity'), Object.assign({}, base, {
    tab: 'phone', page: 1, totalPages: 1, totalCount: 0, perPage: 20, phoneTotal: 0, activityTotal: 0, phoneRows: [], activityRows: [],
  }));
  check('activity empty state is a card', activityHtml.includes('class="empty-state"') && activityHtml.includes('All open orders are phone-confirmed'));

  console.log('Contact Messages redirect + tab consistency');
  check('/admin/contact-messages redirects to /admin/messages', /router\.get\('\/contact-messages'/.test(adminJs) && adminJs.includes("res.redirect('/admin/messages')"));
  check('activity tabs use the .admin-tab style (same as Messages)', activityHtml.includes('class="admin-tab is-active"') && activityHtml.includes('Phone Confirmation Queue'));
  check('activity count line pluralises correctly', activityHtml.includes('items — showing 0–0 of 0'));
  const activityWithRows = await renderFile(adminView('activity'), Object.assign({}, base, {
    tab: 'phone', page: 1, totalPages: 1, totalCount: 1, perPage: 20, phoneTotal: 1, activityTotal: 0,
    phoneRows: [{ id: 1, customer_name: 'Caller', phone: '01810000001', total_amount: 370, created_at: new Date() }], activityRows: [],
  }));
  check('activity phone table has a named Actions column (no empty <th>)', activityWithRows.includes('<th>Actions</th>') && !activityWithRows.includes('<th></th>'));

  console.log('WhatsApp float cannot cover the cart checkout button');
  // (fix/shop-menu-bar: the old bottom-band heuristic (innerHeight -
  // 170) is gone — the float now hides on a REAL rect intersection
  // with the guarded controls, and the guard list holds the Sort
  // control as a selector instead of a getElementById call.)
  check('footer hides the float over the cart checkout area', footerEjs.includes('.cart-summary .btn-primary') && footerEjs.includes('overlapsFloat'));
  check('footer hides the float over the homepage sort control', footerEjs.includes("'#sort,"));

  console.log('Invoices — one clear filter set, no wrapping');
  const invoicesHtml = await renderFile(adminView('invoices'), Object.assign({}, base, {
    tab: 'all', page: 1, totalPages: 1, totalCount: 1,
    rows: [{ id: 35, invoiceNo: 'GOINCE-00035', customer_name: 'Jahid', phone: '01810000001', total_amount: 370, status: 'Pending', payment_status: 'Unpaid', created_at: new Date() }],
    _statusRows: [{ status: 'Pending', count: 1 }], _statusFilter: null, _statusQs: '', _totalOrdersAll: 1,
  }));
  check('invoices renders', invoicesHtml.includes('GOINCE-00035'));
  check('payment filter is a labelled distinct group (not a second "All" pill row)', invoicesHtml.includes('Payment:') && invoicesHtml.includes('btn-sm btn-sm--primary'));
  check('invoice number cell does not wrap', invoicesHtml.includes('white-space:nowrap'));

  console.log('Settings — professional English, prominent Save, own Change Password section');
  const settingsSrc = read(adminView('settings'));
  check('settings.ejs has no Bangla letters', !banglaLetters.test(settingsSrc));
  check('no developer-note Banglish heading remains ("kothay konta")', !settingsSrc.includes('kothay konta'));
  check('Save Settings is a full-width prominent button', /width:\s*100%;[^>]*>💾 Save Settings/.test(settingsSrc));
  check('Change Password is its own headed section', settingsSrc.includes('Change Admin Password</h3>'));
  check('logo label shows the current value or "(not set)"', settingsSrc.includes('(not set — using the default icon)'));

  console.log('Winter Collection — two separate categories, tree renders each node once');
  const winterRows = [
    { id: 7, name: 'Seasonal Products', parent_id: null, sort_order: 10, is_visible: 1 },
    { id: 8, name: 'Winter Collection', parent_id: null, sort_order: 20, is_visible: 1 },
    { id: 9, name: 'Winter Collection', parent_id: 7, sort_order: 10, is_visible: 1 },
  ];
  const { roots } = buildCategoryTree(winterRows);
  const flat = flattenTree(roots);
  check('tree has 3 nodes (two same-named, distinct ids)', flat.length === 3);
  check('each category id appears exactly once (no double render)', new Set(flat.map((n) => n.id)).size === 3);
  check('both "Winter Collection" rows exist as separate nodes', flat.filter((n) => n.name === 'Winter Collection').length === 2);
  check('the sub-category Winter Collection is a child of Seasonal Products',
    flat.find((n) => n.id === 9).parent_id === 7);

  console.log('Dashboard — compact empty state, plurals, blue reports link');
  const dashHtml = await renderFile(adminView('dashboard'), Object.assign({}, base, {
    totalProducts: 5, totalOrders: 5, totalRevenue: 2670, totalCustomers: 1,
    pendingOrders: [{ id: 1, customer_name: 'Buyer', total_amount: 370, created_at: new Date(), status: 'Pending', phone: '01810000001' }],
    todaysPendingCount: 1, lowStockProducts: [], lowStockCount: 0, outOfStockCount: 0,
    pendingDue: 1500, pendingDueOrders: 2, pendingReviews: 2, unreadMessages: 3,
    todaysSummary: { ordersCount: 1, revenue: 1000 },
    periodProfit: { totalProfit: 490, totalCost: 500, totalUnits: 3, costedUnits: 1 },
    _catSales: [{ name: 'Home Appliances', revenue: 1000 }], _shipped: [], _shippedTotal: 0,
    _topCustomers: [{ name: 'Buyer', phone: '01810000001', orders: 1, total: 370, customerId: null }],
    dashboard: {
      range: '30', from: '2026-10-26', to: '2026-11-24', prevFrom: '2026-09-26', prevTo: '2026-10-25',
      currentSummary: { ordersCount: 1, revenue: 370, avgOrderValue: 370, collectedRevenue: 370 },
      previousSummary: { ordersCount: 0, revenue: 0 }, newCustomers: 0,
      salesTrend: [{ date: '2026-11-24', revenue: 370 }],
      topProducts: [], statusRows: [{ status: 'Pending', count: 1 }], revenueChange: null, maxTrendRevenue: 370,
    },
  }));
  check('dashboard renders', dashHtml.includes('Dashboard'));
  check('near-empty Sales Trend shows a compact empty state (not a giant empty chart)',
    dashHtml.includes('Only one day of sales in this period'));
  check('no "order(s)" literal remains on the dashboard', !dashHtml.includes('order(s)'));
  check('period note shows formatted dates (not ISO)', dashHtml.includes('26 Oct 2026') && dashHtml.includes('24 Nov 2026'));

  console.log('Shop — cart empty state, checkout reassurance, product page reviews');
  const cartHtml = await renderFile(viewPath('cart'), Object.assign({}, base, {
    cart: [], cartItems: [], subtotal: 0, deliveryCharge: 0, total: 0, estimatedDelivery: '',
    user: null, coupons: [], appliedCoupon: null, discount: 0, cartCount: 0, relatedProducts: [],
  }));
  check('cart empty state is a card with a real button', cartHtml.includes('class="empty-state"') && cartHtml.includes('Continue shopping'));
  const checkoutHtml = await renderFile(viewPath('checkout'), Object.assign({}, base, {
    cart: [], cartItems: [], subtotal: 0, deliveryCharge: 60, total: 60, user: null,
    deliveryZones: [{ id: 1, name: 'Inside Dhaka', charge: 60, delivery_time: '1–2 days' }],
    paymentMethods: [], gateway: { enabled: false }, cartCount: 0, discount: 0,
  }));
  check('checkout has the reassurance block under the summary', checkoutHtml.includes('checkout-reassure'));
  check('checkout delivery fallback times are English ("1–2 days")', !checkoutHtml.includes('1–2 din'));
  check('footer delivery sentence is one consistent language (English) everywhere',
    footerEjs.includes('delivery in 1–2 days inside Dhaka, 3–5 days outside Dhaka') &&
    serverJs.includes('delivery in 1–2 days inside Dhaka, 3–5 days outside Dhaka') &&
    startupFixes.includes('delivery in 1–2 days inside Dhaka, 3–5 days outside Dhaka'));
  check('no "Dhaka-r vitore 1–2 din" remains in the footer/default/meta copy',
    !footerEjs.includes('Dhaka-r vitore') && !serverJs.includes('Dhaka-r vitore') &&
    !read(viewPath('partials/header')).includes('Dhaka-r vitore 1-2 din'));
  check('shop.js delivery estimate is English', shopJs.includes('1–2 days inside Dhaka, 3–5 days outside Dhaka') && !shopJs.includes('Dhaka 1-2 din'));

  console.log(`\n${passes.length} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('Failed checks:');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
})().catch((err) => {
  console.error('Test crashed:', err);
  process.exit(1);
});
