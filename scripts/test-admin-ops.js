// Admin Ops batch — I1–I15 (feat/admin-ops, batch 8).
//
//   I1  persistent MySQL sessions (store falls back to memory)
//   I3  customer return / cancel requests
//   I4  product compare (max 4)
//   I5  coupon limits (max total / per customer / min order)
//   I6  orders / invoices CSV export (correct escaping)
//   I7  admin audit log (never secrets)
//   I8  weight-based delivery bands
//   I9  live-chat admin notification (unread_admin)
//   I10 in-admin analytics (real data only)
//   I11 flash sales / timed offers with countdown
//   I14 CSP security headers
//   I15 customer login lockout (configurable, customer only)
//
// No live MySQL needed: pure-function checks + the REAL
// lib/admin-ops.js helpers on stubbed DBs (fake query() recording
// every call) + direct EJS renders of the touched views + source
// checks that every route, setting, toggle and nav link is wired.
//
// Run:  node scripts/test-admin-ops.js
// Exit code 0 = all checks passed.
'use strict';

const fs = require('fs');
const path = require('path');
const util = require('util');
const ejs = require('ejs');

const read = (p) => fs.readFileSync(p, 'utf8');
const renderFile = util.promisify(ejs.renderFile);
const ops = require('../lib/admin-ops');
const { PERMISSION_GROUPS, ALL_PERMISSIONS, SYSTEM_ROLE_PERMISSIONS } = require('../lib/permissions');

const failures = [];
const passes = [];
function check(name, ok, detail) {
  if (ok) { passes.push(name); console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

// ---------- Fake DB ----------
function fakeDb(handlers) {
  const calls = [];
  const db = {
    calls,
    async query(sql, params) {
      calls.push({ sql, params: params || [] });
      for (const [match, fn] of handlers) {
        const hit = typeof match === 'string' ? sql.includes(match) : match.test(sql);
        if (hit) {
          // Handlers return ROWS; mysql2 query() returns [rows, fields].
          const out = await fn(sql, params || []);
          return [out];
        }
      }
      throw new Error('fakeDb: no handler for: ' + sql.slice(0, 120));
    },
  };
  return db;
}

const shopBaseLocals = {
  siteName: 'Goince', siteSettings: {}, shopPhone: '+8801814697896', paymentMethods: [],
  assetUrl: (p) => p, userName: null, userPhotoUrl: null, cartCount: 0,
  menuCategories: [], menuById: {}, search: '',
  miniCart: [], miniCartSubtotal: 0, csrfToken: 'tok123',
  siteLogoAbs: '', siteFaviconAbs: '', siteOgImageAbs: '', siteUrl: 'http://127.0.0.1',
  newsletterMsg: null,
};
const adminBaseLocals = {
  siteName: 'Goince', siteSettings: {}, theme: 'light', csrfToken: 'test-csrf',
  adminEmail: 'admin@goince.com', adminRole: 'Owner', adminPermissions: null,
  adminNotifications: { pendingOrders: 1, phoneQueue: 2, unreadMessages: 0, pendingReviews: 0, openOrders: 2, unreadChats: 3, pendingReturns: 1, total: 7 },
  adminCurrentPath: '/admin/dashboard', searchQuery: '',
};

(async () => {
  // ================= I14 — CSP =================
  const csp = ops.cspPolicy();
  check('I14: CSP policy sets default-src self, blocks objects + framing, keeps form-action self',
    csp.includes("default-src 'self'") && csp.includes("object-src 'none'") && csp.includes("base-uri 'self'") && csp.includes("form-action 'self'"), csp);
  check('I14: CSP allows inline scripts/styles (site uses them everywhere) but never unsafe-eval',
    csp.includes("script-src 'self' 'unsafe-inline'") && csp.includes("style-src 'self' 'unsafe-inline'") && !csp.includes('unsafe-eval'), csp);
  check('I14: server.js enables helmet CSP from lib/admin-ops (not contentSecurityPolicy:false)',
    read(path.join(__dirname, '..', 'server.js')).includes('cspPolicy()') && !read(path.join(__dirname, '..', 'server.js')).includes('contentSecurityPolicy: false'));
  // PR #92 — the live checkout's Transaction ID field stopped
  // appearing after PR #90 added Helmet: the served header
  // contained `script-src-attr 'none'` (a Helmet DEFAULT that
  // survives because Helmet merges your directives with its
  // defaults) while script-src allowed 'unsafe-inline'. That
  // blocked every inline on* attribute site-wide. The policy
  // string alone is not enough to catch it — the old suite only
  // checked the string — so assert on the header Helmet ACTUALLY
  // serves, built exactly the way server.js builds it.
  check('PR #92: CSP policy allows inline event-handler attributes (script-src-attr unsafe-inline, never none)',
    csp.includes("script-src-attr 'self' 'unsafe-inline'") && !/script-src-attr 'none'/.test(csp) && !csp.includes('unsafe-eval'), csp);
  check('PR #92: the header Helmet actually serves (server.js wiring) allows inline handlers and keeps the blocks',
    (() => {
      try {
        const helmet = require('helmet');
        const directives = Object.fromEntries(csp.split('; ').map((d) => { const [k, ...v] = d.split(' '); return [k, v]; }));
        const mw = helmet({ contentSecurityPolicy: { directives }, hsts: false });
        const headers = {};
        const res = {
          setHeader(name, value) { headers[name] = value; },
          getHeader(name) { return headers[name]; },
          removeHeader(name) { delete headers[name]; },
        };
        let nextErr = null;
        mw({}, res, (err) => { nextErr = err || null; });
        const header = headers['Content-Security-Policy'];
        if (nextErr || typeof header !== 'string') return false;
        return header.includes("script-src-attr 'self' 'unsafe-inline'")
          && !header.includes("script-src-attr 'none'")
          && header.includes("script-src 'self' 'unsafe-inline'")
          && header.includes("object-src 'none'")
          && header.includes("frame-ancestors 'self'");
      } catch (e) { return false; }
    })());

  // ================= I4 — compare =================
  check('I4: compare caps at 4, dedupes, drops invalid ids',
    JSON.stringify(ops.normalizeCompareIds('1,2,2,3,4,5,abc,0,-1')) === JSON.stringify([1, 2, 3, 4]));
  check('I4: compare toggle adds, removes, and refuses a 5th (full:true)',
    (() => {
      const a = ops.toggleCompareId([1, 2], 3);
      const b = ops.toggleCompareId([1, 2], 2);
      const c = ops.toggleCompareId([1, 2, 3, 4], 5);
      return a.added && JSON.stringify(a.ids) === '[1,2,3]' && !b.added && JSON.stringify(b.ids) === '[1]' && c.full === true && c.ids.length === 4;
    })());
  check('I4: MAX_COMPARE is 4',
    ops.MAX_COMPARE === 4);

  // ================= I6 — CSV =================
  check('I6: CSV escapes commas, quotes and newlines',
    ops.csvEscape('a,b') === '"a,b"' && ops.csvEscape('say "hi"') === '"say ""hi"""' && ops.csvEscape('line1\nline2') === '"line1\nline2"');
  check('I6: CSV guards spreadsheet formula injection (=, +, -, @ at start)',
    ops.csvEscape('=SUM(A1:A2)') === '"=SUM(A1:A2)"' && ops.csvEscape('@x') === '"@x"' && ops.csvEscape('plain') === 'plain' && ops.csvEscape(null) === '');
  check('I6: toCsv writes a BOM + header row + one row per record',
    (() => {
      const csv = ops.toCsv([{ key: 'id', label: 'Order ID' }, { key: 'name', label: 'Customer' }], [{ id: 35, name: 'Jahid, "Boss"' }]);
      return csv.startsWith('\uFEFFOrder ID,Customer') && csv.includes('35,"Jahid, ""Boss"""');
    })());

  // ================= I5 — coupon limits =================
  const baseCoupon = { active: 1, expiry_date: null, max_total_uses: null, max_uses_per_customer: null, min_order_amount: null };
  check('I5: coupon with no limits is usable',
    ops.validateCouponUse(baseCoupon, { subtotal: 100, totalUses: 0, userUses: 0 }).ok);
  check('I5: inactive coupon is refused',
    !ops.validateCouponUse({ ...baseCoupon, active: 0 }, { subtotal: 100 }).ok);
  check('I5: expired coupon is refused',
    !ops.validateCouponUse({ ...baseCoupon, expiry_date: '2020-01-01' }, { subtotal: 100 }).ok);
  check('I5: minimum order amount blocks a small cart, allows a big one',
    !ops.validateCouponUse({ ...baseCoupon, min_order_amount: 1000 }, { subtotal: 999 }).ok &&
    ops.validateCouponUse({ ...baseCoupon, min_order_amount: 1000 }, { subtotal: 1000 }).ok);
  check('I5: max total uses blocks at the cap (100/100) but not below it',
    !ops.validateCouponUse({ ...baseCoupon, max_total_uses: 100 }, { subtotal: 500, totalUses: 100 }).ok &&
    ops.validateCouponUse({ ...baseCoupon, max_total_uses: 100 }, { subtotal: 500, totalUses: 99 }).ok);
  check('I5: max uses per customer blocks a repeat user, not a new one; guests are not blocked by it',
    !ops.validateCouponUse({ ...baseCoupon, max_uses_per_customer: 1 }, { subtotal: 500, userId: 7, userUses: 1 }).ok &&
    ops.validateCouponUse({ ...baseCoupon, max_uses_per_customer: 1 }, { subtotal: 500, userId: 8, userUses: 0 }).ok &&
    ops.validateCouponUse({ ...baseCoupon, max_uses_per_customer: 1 }, { subtotal: 500, userId: null, userUses: 0 }).ok);
  check('I5: parseCouponLimits — blank = no limit, numbers parsed, 0/negative dropped',
    (() => {
      const l = ops.parseCouponLimits({ max_total_uses: '50', max_uses_per_customer: '', min_order_amount: '1000' });
      const z = ops.parseCouponLimits({ max_total_uses: '0', max_uses_per_customer: '-1', min_order_amount: 'abc' });
      return l.max_total_uses === 50 && l.max_uses_per_customer === null && l.min_order_amount === 1000 &&
        z.max_total_uses === null && z.max_uses_per_customer === null && z.min_order_amount === null;
    })());
  {
    const db = fakeDb([
      ['FROM coupon_uses WHERE coupon_id = ? AND user_id', async () => [{ c: 1 }]],
      ['FROM coupon_uses WHERE coupon_id = ?', async () => [{ c: 42 }]],
    ]);
    const counts = await ops.getCouponUseCounts(db, 9, 7);
    check('I5: getCouponUseCounts reads total (42) and per-customer (1) uses from the ledger',
      counts.totalUses === 42 && counts.userUses === 1, JSON.stringify(counts));
    const db2 = fakeDb([['INSERT INTO coupon_uses', async () => [{ insertId: 1 }]]]);
    await ops.recordCouponUse(db2, { id: 9, code: 'SAVE20' }, 7, 101);
    check('I5: recordCouponUse inserts coupon_id + code + user + order',
      db2.calls.length === 1 && db2.calls[0].params[0] === 9 && db2.calls[0].params[1] === 'SAVE20' && db2.calls[0].params[3] === 101);
    const db3 = fakeDb([['INSERT INTO coupon_uses', async () => { throw new Error('db down'); }]]);
    await ops.recordCouponUse(db3, { id: 9, code: 'SAVE20' }, 7, 101);
    check('I5: recordCouponUse never throws when the DB is down (order must not break)', true);
  }

  // ================= I8 — weight delivery =================
  const bands = [
    { max_weight_kg: 1, charge: 80, zone_slug: null },
    { max_weight_kg: 5, charge: 150, zone_slug: null },
    { max_weight_kg: 2, charge: 60, zone_slug: 'inside_dhaka' },
  ];
  check('I8: lightest matching band wins (0.5kg, all zones -> ৳80)',
    ops.weightDeliveryCharge(0.5, bands, 60, 'outside_dhaka') === 80);
  check('I8: zone-specific band wins over the all-zones band (1.5kg inside Dhaka -> ৳60)',
    ops.weightDeliveryCharge(1.5, bands, 60, 'inside_dhaka') === 60);
  check('I8: no matching band -> normal zone charge unchanged (10kg -> ৳120 outside, ৳60 inside)',
    ops.weightDeliveryCharge(10, bands, 120, 'outside_dhaka') === 120 && ops.weightDeliveryCharge(10, bands, 60, 'inside_dhaka') === 60);
  check('I8: no bands at all -> zone charge unchanged',
    ops.weightDeliveryCharge(3, [], 120, 'outside_dhaka') === 120);
  check('I8: parseWeightBand rejects weight <= 0 and negative charge',
    !ops.parseWeightBand({ max_weight_kg: '0', charge: '50' }).ok && !ops.parseWeightBand({ max_weight_kg: '2', charge: '-5' }).ok &&
    ops.parseWeightBand({ max_weight_kg: '2', charge: '80', zone_slug: 'inside_dhaka' }).ok);
  {
    const db = fakeDb([
      ['FROM weight_delivery_bands', async () => [{ max_weight_kg: 2, charge: 80, zone_slug: null }]],
      ['FROM products WHERE id IN', async () => [{ id: 1, weight_kg: 1.5 }, { id: 2, weight_kg: 0.5 }]],
    ]);
    const got = await ops.getWeightBands(db);
    check('I8: getWeightBands reads active bands ordered by weight',
      got.length === 1 && Number(got[0].max_weight_kg) === 2);
    const w = await ops.getCartTotalWeight(db, [{ id: 1, quantity: 2 }, { id: 2, quantity: 1 }]);
    check('I8: cart total weight sums weight x quantity (1.5*2 + 0.5 = 3.5kg)',
      w === 3.5, 'got ' + w);
  }

  // ================= I11 — flash offers =================
  const now = new Date('2026-11-28T12:00:00Z');
  const live = { is_active: 1, starts_at: '2026-11-28T00:00:00Z', ends_at: '2026-11-29T00:00:00Z', discount_percent: 20, sale_price: null };
  check('I11: live offer is active; ended / future / switched-off offers are not',
    ops.isOfferActive(live, now) &&
    !ops.isOfferActive({ ...live, ends_at: '2026-11-28T11:00:00Z' }, now) &&
    !ops.isOfferActive({ ...live, starts_at: '2026-11-29T00:00:00Z' }, now) &&
    !ops.isOfferActive({ ...live, is_active: 0 }, now));
  check('I11: offer price — sale price wins, else % off, else base price',
    ops.offerPrice({ sale_price: 799 }, 1000) === 799 && ops.offerPrice({ discount_percent: 20, sale_price: null }, 1000) === 800 && ops.offerPrice(null, 1000) === 1000);
  check('I11: countdown is the ms until ends_at (12h here) and 0 after it ends',
    ops.offerCountdownMs(live, now) === 12 * 3600000 && ops.offerCountdownMs({ ...live, ends_at: '2026-11-28T11:00:00Z' }, now) === 0);
  {
    const db = fakeDb([
      ['FROM flash_offers', async () => [
        { id: 1, product_id: 5, is_active: 1, starts_at: null, ends_at: '2026-12-01T00:00:00Z', discount_percent: 10, sale_price: null },
        { id: 2, product_id: 6, is_active: 1, starts_at: null, ends_at: '2020-01-01T00:00:00Z', discount_percent: 50, sale_price: null },
      ]],
    ]);
    const offers = await ops.getActiveFlashOffers(db, now);
    check('I11: getActiveFlashOffers drops the expired offer (only product 5 stays)',
      offers.length === 1 && offers[0].product_id === 5, JSON.stringify(offers.map((o) => o.product_id)));
    const one = await ops.getFlashOfferForProduct(db, 5, now);
    check('I11: getFlashOfferForProduct finds the offer for its product, none for others',
      one && one.product_id === 5 && (await ops.getFlashOfferForProduct(db, 99, now)) === null);
  }

  // ================= I15 — login lockout =================
  check('I15: defaults are 5 attempts / 15 minutes',
    ops.lockoutSettings({}).maxAttempts === 5 && ops.lockoutSettings({}).lockMinutes === 15 &&
    ops.lockoutSettings({ login_lockout_max_attempts: '3', login_lockout_minutes: '30' }).maxAttempts === 3);
  check('I15: unlocked account (no locked_until) is not locked',
    !ops.isAccountLocked({ failed_login_attempts: 4, locked_until: null }, now).locked);
  check('I15: locked account reports minutes left; an expired lock is not locked',
    ops.isAccountLocked({ locked_until: new Date(now.getTime() + 9 * 60000) }, now).locked &&
    ops.isAccountLocked({ locked_until: new Date(now.getTime() + 9 * 60000) }, now).minutesLeft === 9 &&
    !ops.isAccountLocked({ locked_until: new Date(now.getTime() - 1000) }, now).locked);
  check('I15: 5th failed attempt locks the account (15 min); 4th does not',
    (() => {
      const fifth = ops.nextFailedLoginState({ failed_login_attempts: 4 }, {}, now);
      const fourth = ops.nextFailedLoginState({ failed_login_attempts: 3 }, {}, now);
      return fifth.attempts === 5 && fifth.lockedUntil && (fifth.lockedUntil.getTime() - now.getTime()) === 15 * 60000 &&
        fourth.attempts === 4 && fourth.lockedUntil === null;
    })());
  check('I15: lockout settings are admin settings keys (not hardcoded-only)',
    ops.ADMIN_OPS_SETTING_KEYS.includes('login_lockout_max_attempts') && ops.ADMIN_OPS_SETTING_KEYS.includes('login_lockout_minutes') &&
    read(path.join(__dirname, '..', 'views', 'admin', 'settings.ejs')).includes('name="login_lockout_max_attempts"'));

  // ================= I7 — audit log =================
  check('I7: audit details strip password / token / secret keys, keep the rest',
    (() => {
      const d = JSON.parse(ops.sanitizeAuditDetails({ to: 'Delivered', password: 'x', api_key: 'y', note: 'ok' }));
      return d.to === 'Delivered' && d.note === 'ok' && !('password' in d) && !('api_key' in d);
    })());
  {
    const db = fakeDb([['INSERT INTO admin_audit_log', async () => [{ insertId: 1 }]]]);
    await ops.logAdminAction(db, { adminId: 1, adminEmail: 'admin@goince.com', action: 'order.status', entityType: 'order', entityId: 35, details: { to: 'Delivered', password: 'secret' } });
    check('I7: logAdminAction inserts admin + action + entity, with secrets stripped from details',
      db.calls.length === 1 && db.calls[0].params[1] === 'admin@goince.com' && db.calls[0].params[2] === 'order.status' &&
      !db.calls[0].params[5].includes('secret'));
    const dbDown = fakeDb([['INSERT INTO admin_audit_log', async () => { throw new Error('db down'); }]]);
    await ops.logAdminAction(dbDown, { action: 'x' });
    check('I7: logAdminAction never throws when the DB is down', true);
  }

  // ================= I10 — analytics funnel =================
  check('I10: funnel rates — 100 visitors, 40 viewers, 10 checkouts, 5 orders',
    (() => {
      const f = ops.computeFunnel({ visitors: 100, viewers: 40, checkouts: 10, orders: 5 });
      return f.viewRate === 40 && f.checkoutRate === 25 && f.orderRate === 50 && f.overallRate === 5;
    })());
  check('I10: funnel with zero visitors reports null rates (never a made-up 0%)',
    (() => {
      const f = ops.computeFunnel({ visitors: 0, viewers: 0, checkouts: 0, orders: 0 });
      return f.viewRate === null && f.overallRate === null;
    })());
  {
    const db = fakeDb([
      ['INSERT INTO search_logs', async () => [{ insertId: 1 }]],
      [/FROM search_logs WHERE/, async () => [{ term: 'sewing machine', searches: 12 }, { term: 'watch', searches: 5 }]],
    ]);
    await ops.logSearchTerm(db, 'sewing machine', 'sess1', null, 3);
    check('I10: logSearchTerm records the term + results count',
      db.calls.length === 1 && db.calls[0].params[0] === 'sewing machine' && db.calls[0].params[3] === 3);
    const top = await ops.getTopSearchTerms(db, 10, 30);
    check('I10: getTopSearchTerms returns real logged terms, most-searched first',
      top.length === 2 && top[0].term === 'sewing machine' && Number(top[0].searches) === 12);
    const dbDown = fakeDb([['INSERT INTO search_logs', async () => { throw new Error('db down'); }]]);
    await ops.logSearchTerm(dbDown, 'x', 's', null, 0);
    check('I10: logSearchTerm never throws when the DB is down', true);
  }

  // ================= I1 — persistent sessions =================
  {
    // The store falls back to memory when MySQL is unreachable (no
    // live DB in this test env), so a set/get round-trip must still
    // work — and the sessions table must exist in the boot code.
    const MySQLSessionStore = require('../lib/mysql-session-store');
    const store = new MySQLSessionStore();
    const setP = new Promise((resolve) => store.set('sess-test-1', { cookie: { maxAge: 60000 }, cart: [{ id: 1 }] }, resolve));
    await setP;
    const got = await new Promise((resolve) => store.get('sess-test-1', (err, sess) => resolve(sess)));
    check('I1: session store round-trips a session even with MySQL down (memory fallback)',
      got && Array.isArray(got.cart) && got.cart[0].id === 1, JSON.stringify(got));
    await new Promise((resolve) => store.destroy('sess-test-1', resolve));
    const gone = await new Promise((resolve) => store.get('sess-test-1', (err, sess) => resolve(sess)));
    check('I1: session destroy removes the session', !gone);
    const serverJs = read(path.join(__dirname, '..', 'server.js'));
    check('I1: server.js wires the MySQL session store + auto-creates the sessions table on boot',
      serverJs.includes("require('./lib/mysql-session-store')") && serverJs.includes('CREATE TABLE IF NOT EXISTS sessions'));
    check('I1: sql/admin_ops.sql documents the sessions table',
      read(path.join(__dirname, '..', 'sql', 'admin_ops.sql')).includes('CREATE TABLE IF NOT EXISTS sessions'));
  }

  // ================= Permissions + routes (source checks) =================
  check('Permissions: analytics.view, audit.view and flash-offers.manage exist in the registry; Owner gets them all',
    ALL_PERMISSIONS.includes('analytics.view') && ALL_PERMISSIONS.includes('audit.view') && ALL_PERMISSIONS.includes('flash-offers.manage') &&
    SYSTEM_ROLE_PERMISSIONS.owner.includes('analytics.view') && SYSTEM_ROLE_PERMISSIONS.owner.includes('audit.view'));
  {
    const adminJs = read(path.join(__dirname, '..', 'routes', 'admin.js'));
    check('Routes: admin has /audit-log, /analytics, /flash-offers, /orders/export, /invoices/export, weight bands, coupon edit',
      adminJs.includes("router.get('/audit-log'") && adminJs.includes("router.get('/analytics'") &&
      adminJs.includes("router.get('/flash-offers'") && adminJs.includes("router.get('/orders/export'") &&
      adminJs.includes("router.get('/invoices/export'") && adminJs.includes("weight-bands/add") &&
      adminJs.includes("router.post('/coupons/edit/:id'"));
    check('Routes: admin audit() helper is called for order status, product, coupon, settings and zone changes',
      adminJs.includes("audit(req, 'order.status'") && adminJs.includes("audit(req, 'product.edit'") &&
      adminJs.includes("audit(req, 'coupon.add'") && adminJs.includes("audit(req, 'settings.save'") &&
      adminJs.includes("audit(req, 'delivery.zone-add'"));
    const shopJs = read(path.join(__dirname, '..', 'routes', 'shop.js'));
    check('Routes: shop has /compare, flash offers on homepage + product page, coupon limits, weight delivery',
      shopJs.includes("router.get('/compare'") && shopJs.includes('getActiveFlashOffers') &&
      shopJs.includes('getFlashOfferForProduct') && shopJs.includes('validateCouponUse') &&
      shopJs.includes('weightDeliveryCharge') && shopJs.includes('logSearchTerm'));
    const authJs = read(path.join(__dirname, '..', 'routes', 'auth.js'));
    check('Routes: auth has customer lockout (isAccountLocked/nextFailedLoginState) + return/cancel request',
      authJs.includes('isAccountLocked') && authJs.includes('nextFailedLoginState') &&
      authJs.includes("router.post('/account/orders/:id/return'"));
    const chatJs = read(path.join(__dirname, '..', 'routes', 'chat.js'));
    check('I9: customer chat send increments unread_admin; admin open clears it',
      chatJs.includes('unread_admin = unread_admin + 1') && adminJs.includes('SET unread_admin = 0'));
    const header = read(path.join(__dirname, '..', 'views', 'partials', 'admin-header.ejs'));
    check('Nav: admin header links Analytics, Audit Log, Flash Offers; Live Chat carries the unread badge; bell lists unread chats + pending returns',
      header.includes('/admin/analytics') && header.includes('/admin/audit-log') && header.includes('/admin/flash-offers') &&
      header.includes("badge: 'unreadChats'") && header.includes('unread live-chat') && header.includes('pendingReturns'));
  }

  // ================= Renders =================
  try {
    const html = await renderFile(path.join(__dirname, '..', 'views', 'admin', 'audit-log.ejs'),
      Object.assign({}, adminBaseLocals, {
        rows: [{ created_at: new Date(), admin_email: 'admin@goince.com', action: 'order.status', entity_type: 'order', entity_id: '35', details: '{"to":"Delivered"}' }],
        page: 1, totalPages: 1, totalCount: 1, perPage: 20, adminFilter: '', actionFilter: '',
      }));
    check('render: Audit Log page shows the entry (admin, action, order #35) + filter form',
      html.includes('admin@goince.com') && html.includes('order.status') && html.includes('name="admin"'));
  } catch (e) { check('render: Audit Log page', false, e.message); }
  try {
    const html = await renderFile(path.join(__dirname, '..', 'views', 'admin', 'analytics.ejs'),
      Object.assign({}, adminBaseLocals, {
        days: 30, from: '2026-10-30', to: '2026-11-28',
        funnel: ops.computeFunnel({ visitors: 100, viewers: 40, checkouts: 10, orders: 5 }),
        topSearches: [{ term: 'sewing machine', searches: 12 }],
        topProducts: [{ product_name: 'BINBOND Watch', units: 3, revenue: 2970 }],
        daily: [{ day: '2026-11-28', orders: 2, revenue: 1980 }],
        countingFrom: '2026-11-28',
      }));
    check('render: Analytics page shows the real funnel (100 visitors, 5 orders, 5%), top search + top product, and the honest counting-from date',
      html.includes('100') && html.includes('sewing machine') && html.includes('BINBOND Watch') && html.includes('counted from') && html.includes('2026-11-28'));
  } catch (e) { check('render: Analytics page', false, e.message); }
  try {
    const html = await renderFile(path.join(__dirname, '..', 'views', 'admin', 'flash-offers.ejs'),
      Object.assign({}, adminBaseLocals, {
        products: [{ id: 5, name: 'BINBOND Watch', price: 990 }],
        offers: [{ id: 1, product_id: 5, product_name: 'BINBOND Watch', product_price: 990, title: 'Flash Sale', discount_percent: 20, sale_price: null, starts_at: null, ends_at: new Date(Date.now() + 3600000), is_active: 1 }],
      }));
    check('render: Flash Offers page shows the offer (BINBOND, 20% off, Live now) + create form',
      html.includes('BINBOND Watch') && html.includes('20% off') && html.includes('Live now') && html.includes('name="product_id"'));
  } catch (e) { check('render: Flash Offers page', false, e.message); }
  try {
    const html = await renderFile(path.join(__dirname, '..', 'views', 'compare.ejs'),
      Object.assign({}, shopBaseLocals, {
        products: [
          { id: 1, name: 'BINBOND Watch', price: 990, compare_at_price: 1200, stock: 5, brand: 'BINBOND', category_name: 'Watches', weight_kg: 0.2, image: 'watch.jpg', short_description: 'A watch' },
          { id: 2, name: 'Sewing Machine', price: 5500, compare_at_price: null, stock: 0, brand: 'MLSM', category_name: 'Home', weight_kg: 4.5, image: 'sew.jpg', short_description: 'A machine' },
        ],
        ids: [1, 2], maxCompare: 4,
      }));
    check('render: Compare page shows both products side by side (price, stock, brand, weight)',
      html.includes('BINBOND Watch') && html.includes('Sewing Machine') && html.includes('4.5 kg') && html.includes('Out of stock'));
  } catch (e) { check('render: Compare page', false, e.message); }
  try {
    const html = await renderFile(path.join(__dirname, '..', 'views', 'admin', 'coupons.ejs'),
      Object.assign({}, adminBaseLocals, {
        coupons: [{ id: 1, code: 'SAVE20', discount_percent: 20, expiry_date: null, active: 1, uses: 42, max_total_uses: 100, max_uses_per_customer: 1, min_order_amount: 1000 }],
      }));
    check('render: Coupons page shows limits (42 / 100 uses, min ৳1000, max 1/customer) + edit-limits form',
      html.includes('SAVE20') && html.includes('42 / 100') && html.includes('Min ৳1000') && html.includes('name="max_total_uses"'));
  } catch (e) { check('render: Coupons page', false, e.message); }
  try {
    const html = await renderFile(path.join(__dirname, '..', 'views', 'admin', 'delivery-zones.ejs'),
      Object.assign({}, adminBaseLocals, {
        zones: [{ id: 1, name: 'Inside Dhaka', slug: 'inside_dhaka', charge: 60, delivery_time: '1-2 days', is_active: 1 }],
        bands: [{ id: 1, zone_slug: null, max_weight_kg: 2, charge: 80, is_active: 1 }],
      }));
    check('render: Delivery Zones page shows the weight band (up to 2 kg, ৳80) + add-band form',
      html.includes('Weight-Based Delivery Bands') && html.includes('2 kg') && html.includes('name="max_weight_kg"'));
  } catch (e) { check('render: Delivery Zones page', false, e.message); }
  try {
    const html = await renderFile(path.join(__dirname, '..', 'views', 'admin', 'settings.ejs'),
      Object.assign({}, adminBaseLocals, {
        shopPhone: '+8801814697896', deliveryChargeInside: 60, deliveryChargeOutside: 120,
        heroTitle: '', heroSubtitle: '', announcementText: '', shopAddress: '', facebookUrl: '',
        heroProductId: '', footerAbout: '', shopEmail: '', footerHours: '', youtubeUrl: '', instagramUrl: '',
        paymentMode: 'manual', gatewayProvider: 'none', gatewayEnabled: '0', gatewayStoreId: '',
        gatewayMode: 'sandbox', gatewayPasswordSet: false,
        courierProvider: 'none', courierEnabled: '0', courierMode: 'sandbox',
        courierSteadfastKeySet: false, courierPathaoSecretSet: false, courierPathaoPasswordSet: false,
        pathaoClientId: '', pathaoUsername: '', pathaoStoreId: '',
        whatsappPhoneNumberId: '', whatsappTokenSet: false, whatsappTemplateName: 'invoice_pdf',
        logoUrl: '/icons/icon-192.png', faviconUrl: '/icons/icon-192.png', ogImageUrl: '/icons/icon-512.png',
        retention: { loyalty_enabled: '1', loyalty_earn_per: '100', loyalty_redeem_points: '100', loyalty_redeem_taka: '10', loyalty_max_redeem_taka: '500', referral_enabled: '1', referral_reward_points: '200', winback_enabled: '1', winback_days: '60', winback_discount_percent: '10', order_status_email_enabled: '1', back_in_stock_enabled: '1', price_drop_enabled: '1', abandoned_cart_email_enabled: '1', abandoned_cart_cooldown_hours: '24', campaigns_enabled: '0', campaign_max_recipients: '200', push_enabled: '0', vapid_public_key: '', vapidPrivateKeySet: false },
        adminOps: { loginLockoutMaxAttempts: '5', loginLockoutMinutes: '15' },
        products: [], message: null, pwMessage: null,
      }));
    check('render: Settings shows the Admin Ops lockout section (5 attempts, 15 minutes)',
      html.includes('Customer Login Lockout') && html.includes('name="login_lockout_minutes"') && html.includes('value="15"'));
  } catch (e) { check('render: Settings lockout section', false, e.message); }
  try {
    const html = await renderFile(path.join(__dirname, '..', 'views', 'admin', 'invoices.ejs'),
      Object.assign({}, adminBaseLocals, {
        rows: [{ id: 35, invoiceNo: 'GOINCE-00035', created_at: new Date(), customer_name: 'Jahid', phone: '01814697896', total_amount: 1050, paid: 0, due: 1050, payment_status: 'Unpaid', status: 'Pending' }],
        tab: 'all', page: 1, totalPages: 1, totalCount: 1, perPage: 20, listMsg: null, listErr: null,
        statusRows: [{ status: 'Pending', count: 1 }], statusFilter: '', totalOrdersAll: 1,
      }));
    check('render: Orders list has Export Orders CSV + Export Invoices CSV buttons (same filtered list)',
      html.includes('/admin/orders/export') && html.includes('/admin/invoices/export'));
  } catch (e) { check('render: Orders export buttons', false, e.message); }
  try {
    const html = await renderFile(path.join(__dirname, '..', 'views', 'auth', 'order-detail.ejs'),
      Object.assign({}, shopBaseLocals, {
        order: { id: 35, status: 'Confirmed', payment_status: 'Unpaid', address: 'Dhaka', payment_method: 'Cash on Delivery', transaction_id: null, courier_name: null, tracking_number: null, created_at: new Date(), discount_amount: 0, coupon_code: null, delivery_charge: 60, total_amount: 1050 },
        items: [{ product_name: 'BINBOND Watch', variant_label: null, price: 990, quantity: 1 }],
        returns: [{ status: 'Pending', request_type: 'return', reason: 'Wrong size', created_at: new Date() }],
        returnMsg: null, returnErr: null,
      }));
    check('render: customer order page shows the return/cancel form + the pending request (24h policy wording kept)',
      html.includes('Request a Return or Cancellation') && html.includes('name="reason"') && html.includes('Wrong size') && html.includes('24 hours'));
  } catch (e) { check('render: customer order return form', false, e.message); }
  try {
    const html = await renderFile(path.join(__dirname, '..', 'views', 'admin', 'dashboard.ejs'),
      Object.assign({}, adminBaseLocals, {
        totalProducts: 5, totalRevenue: 10000, totalCustomers: 3, pendingOrders: [], todaysPendingCount: 0,
        lowStockProducts: [], lowStockCount: 0, outOfStockCount: 0, pendingDue: 0, pendingDueOrders: 0,
        pendingReviews: 0, unreadMessages: 0, phoneQueueCount: 0, todaysSummary: { ordersCount: 0, revenue: 0 },
        periodProfit: { totalProfit: 0, totalCost: 0, totalUnits: 0, costedUnits: 0 },
        dashboardCategorySales: [], topCustomers: [], shippedOrders: [], shippedTotal: 0,
        unreadChats: 3, pendingReturns: 1,
        dashboard: { range: '30', from: '2026-10-30', to: '2026-11-28', prevFrom: '2026-09-30', prevTo: '2026-10-29', currentSummary: { ordersCount: 0, revenue: 0, avgOrderValue: 0, collectedRevenue: 0 }, previousSummary: { ordersCount: 0, revenue: 0 }, newCustomers: 0, salesTrend: [], topProducts: [], revenueChange: 0, maxTrendRevenue: 1 },
      }));
    check('render: dashboard Needs-attention shows unread live-chat (3) + pending return requests (1)',
      html.includes('unread live-chat') && html.includes('return / cancel'));
  } catch (e) { check('render: dashboard chat/return attention', false, e.message); }

  // ================= Boot tables documented =================
  check('Boot: server.js auto-creates audit log, coupon_uses, weight bands, flash offers, search logs, site visits + lockout/return/chat columns',
    (() => {
      const s = read(path.join(__dirname, '..', 'server.js'));
      return ['admin_audit_log', 'coupon_uses', 'weight_delivery_bands', 'flash_offers', 'search_logs', 'site_visits', 'failed_login_attempts', 'locked_until', 'unread_admin', 'request_type'].every((t) => s.includes(t));
    })());
  check('I3: return policy wording untouched (24 hours of delivery)',
    read(path.join(__dirname, '..', 'views', 'return-policy.ejs')).includes('24 hours'));

  console.log(`\nAdmin Ops checks: ${passes.length} passed, ${failures.length} failed.`);
  if (failures.length) { console.log('Failures: ' + failures.join(', ')); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
