// Retention batch — F1–F9 (feat/retention, PR #88).
//
//   F4  Loyalty points: earn on delivered orders, redeem at checkout
//   F5  Referral program: code/link, reward on first delivered order
//   F9  Win-back offers: coupon via the EXISTING coupons table
//   F1  Abandoned-cart recovery: record + one email per cart
//   F2  Real Notify Me / back-in-stock alerts: email once per restock
//   F3  Order-status notification emails
//   F6  Wishlist price-drop alerts: email once per price-drop event
//   F7  Email campaigns / newsletter (toggle + per-send cap)
//   F8  Customer web push: subscribe flow, inactive without VAPID keys
//
// No live MySQL needed: pure-function checks + the REAL lib/retention.js
// helpers on stubbed DBs (fake query() recording every call) + direct
// EJS renders of the touched views + source checks that every route,
// setting, toggle and nav link is wired. Email sending is stubbed with
// a recording sendMail — the real config/email.js sendMail is checked
// separately to return { ok: false } (never throw) when unconfigured.
//
// Run:  node scripts/test-retention.js
// Exit code 0 = all checks passed.
'use strict';

const fs = require('fs');
const path = require('path');
const util = require('util');
const ejs = require('ejs');

const read = (p) => fs.readFileSync(p, 'utf8');
const renderFile = util.promisify(ejs.renderFile);
const ret = require('../lib/retention');
const emailMod = require('../config/email');

const failures = [];
const passes = [];
function check(name, ok, detail) {
  if (ok) { passes.push(name); console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

// ---------- Fake DB ----------
// handlers: [[/regex-or-string/, fn(sql, params) -> rows-or-[rows]]]
// query() returns [rows] like mysql2. Every call is recorded.
function fakeDb(handlers) {
  const calls = [];
  const db = {
    calls,
    async query(sql, params) {
      calls.push({ sql, params: params || [] });
      for (const [match, fn] of handlers) {
        const hit = typeof match === 'string' ? sql.includes(match) : match.test(sql);
        if (hit) {
          const out = await fn(sql, params || []);
          return Array.isArray(out) && out.length === 2 && Array.isArray(out[0]) && !out[0].length && out[1] === undefined
            ? out : [out];
        }
      }
      throw new Error('fakeDb: no handler for: ' + sql.slice(0, 120));
    },
  };
  return db;
}
// mysql2 rows helpers: SELECTs return row arrays; INSERTs return an
// OkPacket-shaped object; UPDATEs return { affectedRows }.
const rows = (arr) => arr;
const okPacket = (extra) => Object.assign({ insertId: 1, affectedRows: 1 }, extra || {});

const sentMails = [];
function stubSendMail(ok) {
  sentMails.length = 0;
  return async (to, subject, text, html) => {
    sentMails.push({ to, subject, text, html });
    return { ok: ok !== false };
  };
}
const SETTINGS_ON = Object.assign({}, ret.RETENTION_DEFAULTS, { campaigns_enabled: '1', push_enabled: '1' });
const SETTINGS_OFF = Object.assign({}, ret.RETENTION_DEFAULTS, {
  loyalty_enabled: '0', referral_enabled: '0', winback_enabled: '0',
  order_status_email_enabled: '0', back_in_stock_enabled: '0',
  price_drop_enabled: '0', abandoned_cart_email_enabled: '0',
  campaigns_enabled: '0', push_enabled: '0',
});

const serverJs = read(path.join(__dirname, '..', 'server.js'));
const shopJs = read(path.join(__dirname, '..', 'routes', 'shop.js'));
const adminJs = read(path.join(__dirname, '..', 'routes', 'admin.js'));
const authJs = read(path.join(__dirname, '..', 'routes', 'auth.js'));
const emailJs = read(path.join(__dirname, '..', 'config', 'email.js'));
const retentionJs = read(path.join(__dirname, '..', 'lib', 'retention.js'));
const retentionSql = read(path.join(__dirname, '..', 'sql', 'retention.sql'));
const settingsEjs = read(path.join(__dirname, '..', 'views', 'admin', 'settings.ejs'));
const headerEjs = read(path.join(__dirname, '..', 'views', 'partials', 'admin-header.ejs'));
const footerEjs = read(path.join(__dirname, '..', 'views', 'partials', 'footer.ejs'));
const checkoutEjs = read(path.join(__dirname, '..', 'views', 'checkout.ejs'));
const profileEjs = read(path.join(__dirname, '..', 'views', 'auth', 'profile.ejs'));
const productEjs = read(path.join(__dirname, '..', 'views', 'product.ejs'));
const customerPushJs = read(path.join(__dirname, '..', 'public', 'js', 'customer-push.js'));
const permissionsJs = read(path.join(__dirname, '..', 'lib', 'permissions.js'));

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
  adminNotifications: { pendingOrders: 1, phoneQueue: 2, unreadMessages: 0, pendingReviews: 0, openOrders: 2, total: 3 },
  adminCurrentPath: '/admin/dashboard', searchQuery: '',
};

(async () => {
  // ================= F4 — loyalty points (pure math) =================
  check('F4: 1 point per ৳100 spent — ৳1050 earns 10, ৳99 earns 0, ৳2500 earns 25',
    ret.pointsForSpend(1050, 100) === 10 && ret.pointsForSpend(99, 100) === 0 && ret.pointsForSpend(2500, 100) === 25,
    `got ${ret.pointsForSpend(1050, 100)} / ${ret.pointsForSpend(99, 100)} / ${ret.pointsForSpend(2500, 100)}`);
  check('F4: redeem value — 250 points = ৳20 (100 pts = ৳10, remainder kept)',
    ret.redeemValueForPoints(250, 100, 10) === 20);
  check('F4: redeem value — 99 points = ৳0 (below one step)',
    ret.redeemValueForPoints(99, 100, 10) === 0);
  const d1 = ret.pointsDiscountFor({ pointsBalance: 1000, redeemRequested: 500, subtotal: 2000, couponDiscount: 0, maxRedeemTaka: 500, redeemPoints: 100, redeemTaka: 10 });
  check('F4: checkout redeem — 500 of 1000 pts on ৳2000 = 500 pts / ৳50',
    d1.points === 500 && d1.value === 50, JSON.stringify(d1));
  const d2 = ret.pointsDiscountFor({ pointsBalance: 100, redeemRequested: 500, subtotal: 2000, couponDiscount: 0, maxRedeemTaka: 500, redeemPoints: 100, redeemTaka: 10 });
  check('F4: checkout redeem clamps to the balance (100 pts asked 500) = 100 pts / ৳10',
    d2.points === 100 && d2.value === 10, JSON.stringify(d2));
  const d3 = ret.pointsDiscountFor({ pointsBalance: 10000, redeemRequested: 10000, subtotal: 5000, couponDiscount: 0, maxRedeemTaka: 500, redeemPoints: 100, redeemTaka: 10 });
  check('F4: checkout redeem clamps to the admin max-redeem cap (৳500)',
    d3.points === 5000 && d3.value === 500, JSON.stringify(d3));
  const d4 = ret.pointsDiscountFor({ pointsBalance: 10000, redeemRequested: 10000, subtotal: 300, couponDiscount: 100, maxRedeemTaka: 500, redeemPoints: 100, redeemTaka: 10 });
  check('F4: checkout redeem never exceeds the amount left to pay (৳300 - ৳100 coupon = ৳200)',
    d4.points === 2000 && d4.value === 200, JSON.stringify(d4));
  const d5 = ret.pointsDiscountFor({ pointsBalance: 0, redeemRequested: 100, subtotal: 1000, couponDiscount: 0, maxRedeemTaka: 500, redeemPoints: 100, redeemTaka: 10 });
  check('F4: checkout redeem with zero balance = 0 pts / ৳0',
    d5.points === 0 && d5.value === 0, JSON.stringify(d5));

  // F4 — DB: balance + earn (delivered only, once per order)
  const earnDb = fakeDb([
    [/COALESCE\(SUM\(points\)/, async () => rows([{ balance: '250' }])],
    [/FROM orders WHERE id/, async () => rows([{ id: 7, user_id: 3, status: 'Delivered', total_amount: 1050 }])],
    [/FROM loyalty_points WHERE order_id/, async () => rows([])],
    [/INSERT INTO loyalty_points/, async () => okPacket({ insertId: 9 })],
    [/UPDATE orders SET points_earned/, async () => okPacket()],
  ]);
  check('F4: balance is SUM(points) from the ledger (250)',
    (await ret.getPointsBalance(earnDb, 3)) === 250);
  check('F4: Delivered order #7 (৳1050) awards 10 points, once',
    (await ret.awardPointsForOrder(earnDb, 7, SETTINGS_ON)) === 10);
  check('F4: earn wrote an INSERT into loyalty_points',
    earnDb.calls.some((c) => c.sql.includes('INSERT INTO loyalty_points')));
  const pendingDb = fakeDb([
    [/FROM orders WHERE id/, async () => rows([{ id: 8, user_id: 3, status: 'Pending', total_amount: 5000 }])],
  ]);
  check('F4: a Pending order earns 0 points (only delivered/paid orders earn)',
    (await ret.awardPointsForOrder(pendingDb, 8, SETTINGS_ON)) === 0);
  const alreadyDb = fakeDb([
    [/FROM orders WHERE id/, async () => rows([{ id: 7, user_id: 3, status: 'Delivered', total_amount: 1050 }])],
    [/FROM loyalty_points WHERE order_id/, async () => rows([{ id: 9 }])],
  ]);
  check('F4: second award call for the same order awards 0 (idempotent)',
    (await ret.awardPointsForOrder(alreadyDb, 7, SETTINGS_ON)) === 0);
  check('F4: loyalty OFF awards 0 even for a Delivered order',
    (await ret.awardPointsForOrder(earnDb, 7, SETTINGS_OFF)) === 0);
  const redeemDb = fakeDb([
    [/INSERT INTO loyalty_points/, async () => okPacket({ insertId: 10 })],
    [/UPDATE orders SET points_redeemed/, async () => okPacket()],
  ]);
  check('F4: redeem writes a negative ledger row and records it on the order',
    (await ret.redeemPointsForOrder(redeemDb, 3, 7, 500, 50)) === true &&
    redeemDb.calls.some((c) => c.sql.includes('INSERT INTO loyalty_points')));

  // ================= F5 — referrals =================
  const code = ret.makeReferralCode(3);
  check('F5: referral code is stable + parses back to the same user',
    typeof code === 'string' && code.startsWith('GO') && ret.parseReferralCode(code) === 3, `code=${code}`);
  check('F5: a tampered referral code is rejected',
    ret.parseReferralCode(code.slice(0, -1) + 'ZZ') === null && ret.parseReferralCode('GOXYZ') === null);
  check('F5: referral link points at /signup?ref=CODE',
    ret.referralLink('https://goince.com', 3) === `https://goince.com/signup?ref=${code}`);
  const refDb = fakeDb([
    [/SELECT id FROM users WHERE id/, async () => rows([{ id: 3 }])],
    [/FROM referrals WHERE referred_user_id/, async () => rows([])],
    [/INSERT INTO referrals/, async () => okPacket({ insertId: 1 })],
  ]);
  check('F5: signup with a valid code records a pending referral',
    (await ret.recordReferralSignup(refDb, 3, 9)) === true);
  check('F5: self-referral is refused',
    (await ret.recordReferralSignup(refDb, 3, 3)) === false);
  const refDupDb = fakeDb([
    [/SELECT id FROM users WHERE id/, async () => rows([{ id: 3 }])],
    [/FROM referrals WHERE referred_user_id/, async () => rows([{ id: 1 }])],
  ]);
  check('F5: a second referral row for the same friend is refused',
    (await ret.recordReferralSignup(refDupDb, 3, 9)) === false);
  const rewardDb = fakeDb([
    [/FROM referrals WHERE referred_user_id/, async () => rows([{ id: 1, referrer_user_id: 3, referred_user_id: 9, status: 'pending' }])],
    [/FROM orders WHERE user_id/, async () => rows([{ c: 1 }])],
    [/UPDATE referrals SET status/, async () => okPacket()],
    [/INSERT INTO loyalty_points/, async () => okPacket({ insertId: 11 })],
  ]);
  check('F5: friend\'s first Delivered order rewards the referrer 200 points',
    (await ret.completeReferralReward(rewardDb, 9, SETTINGS_ON)) === 200);
  const noRewardDb = fakeDb([
    [/FROM referrals WHERE referred_user_id/, async () => rows([{ id: 1, referrer_user_id: 3, referred_user_id: 9, status: 'pending' }])],
    [/FROM orders WHERE user_id/, async () => rows([{ c: 0 }])],
  ]);
  check('F5: no reward while the friend has no Delivered order yet',
    (await ret.completeReferralReward(noRewardDb, 9, SETTINGS_ON)) === 0);
  check('F5: referrals OFF rewards 0',
    (await ret.completeReferralReward(rewardDb, 9, SETTINGS_OFF)) === 0);

  // ================= F9 — win-back =================
  const old = new Date(Date.now() - 70 * 24 * 60 * 60 * 1000);
  const recent = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
  check('F9: last order 70 days ago is win-back eligible at 60 days',
    ret.isWinbackEligible(old, 60, new Date()) === true);
  check('F9: last order 5 days ago is NOT win-back eligible',
    ret.isWinbackEligible(recent, 60, new Date()) === false);
  check('F9: no orders at all is NOT win-back eligible (never ordered)',
    ret.isWinbackEligible(null, 60, new Date()) === false);
  const sendMail = stubSendMail(true);
  const winDb = fakeDb([
    [/FROM users u/, async () => rows([{ id: 5, name: 'Rohim', email: 'rohim@example.com', last_order_at: old }])],
    [/SELECT id FROM coupons WHERE code/, async () => rows([])],
    [/INSERT INTO coupons/, async () => okPacket({ insertId: 3 })],
    [/INSERT INTO winback_offers/, async () => okPacket({ insertId: 1 })],
  ]);
  const winOut = await ret.issueWinbackOffers(winDb, SETTINGS_ON, sendMail, 'https://goince.com');
  check('F9: win-back issues 1 coupon + 1 email for the lapsed customer',
    winOut.issued === 1 && winOut.emailed === 1, JSON.stringify(winOut));
  check('F9: win-back coupon code is WINBACK-<user>-<yyyymm> in the EXISTING coupons table',
    winDb.calls.some((c) => c.sql.includes('INSERT INTO coupons') && String(c.params[0]).startsWith('WINBACK-5-')));
  check('F9: win-back email contains the coupon code',
    sentMails.length === 1 && sentMails[0].text.includes('WINBACK-5-'));
  const winOffDb = fakeDb([[/FROM users u/, async () => rows([{ id: 5, name: 'Rohim', email: 'r@e.com', last_order_at: old }])]]);
  check('F9: win-back OFF issues nothing',
    (await ret.issueWinbackOffers(winOffDb, SETTINGS_OFF, sendMail, 'https://goince.com')).issued === 0);

  // ================= F1 — abandoned carts =================
  const cart = [{ id: 2, name: 'BINBOND Watch', price: 990, quantity: 1, variantId: null, variantLabel: null, image: 'w.jpg' }];
  const abDb = fakeDb([
    [/FROM abandoned_carts WHERE session_key/, async () => rows([])],
    [/INSERT INTO abandoned_carts/, async () => okPacket({ insertId: 4 })],
  ]);
  check('F1: a cart that reached checkout is recorded',
    (await ret.recordAbandonedCart(abDb, { sessionKey: 'sess1', userId: 3, email: 'r@e.com', cart })) === 4);
  check('F1: an empty cart is NOT recorded',
    (await ret.recordAbandonedCart(abDb, { sessionKey: 'sess1', userId: 3, email: 'r@e.com', cart: [] })) === null);
  const abMailDb = (() => {
    let emailed = false;
    const db = fakeDb([
      [/SELECT \* FROM abandoned_carts WHERE id/, async () => rows([{ id: 4, session_key: 'sess1', user_id: 3, email: 'r@e.com', cart_json: JSON.stringify(cart), restore_token: 'tok-abc', emailed_at: emailed ? new Date() : null, recovered_at: null }])],
      [/UPDATE abandoned_carts SET emailed_at/, async () => { emailed = true; return okPacket(); }],
    ]);
    return { db, isEmailed: () => emailed };
  })();
  const mail1 = stubSendMail(true);
  const ab1 = await ret.sendAbandonedCartEmail(abMailDb.db, 4, mail1, 'https://goince.com', SETTINGS_ON);
  check('F1: recovery email sends once (one email per cart)',
    ab1.sent === true && sentMails.length === 1 && sentMails[0].text.includes('/cart/restore/tok-abc'));
  const ab2 = await ret.sendAbandonedCartEmail(abMailDb.db, 4, mail1, 'https://goince.com', SETTINGS_ON);
  check('F1: second send for the same cart is refused (already-emailed, no spam)',
    ab2.sent === false && ab2.reason === 'already-emailed' && sentMails.length === 1);
  check('F1: eligibility — emailed carts are never eligible again',
    ret.abandonedCartEligible({ emailed_at: new Date(), recovered_at: null, created_at: old }, 24) === false);
  check('F1: eligibility — a 2-day-old unmailed cart passes a 24h cooldown',
    ret.abandonedCartEligible({ emailed_at: null, recovered_at: null, created_at: old }, 24) === true);
  check('F1: eligibility — a 1-hour-old cart does NOT pass a 24h cooldown',
    ret.abandonedCartEligible({ emailed_at: null, recovered_at: null, created_at: new Date(Date.now() - 60 * 60 * 1000) }, 24) === false);
  const restoreDb = (() => {
    let recovered = false;
    const db = fakeDb([
      [/FROM abandoned_carts WHERE restore_token/, async () => recovered ? rows([]) : rows([{ id: 4, cart_json: JSON.stringify(cart), restore_token: 'tok-abc', recovered_at: null }])],
      [/UPDATE abandoned_carts SET recovered_at/, async () => { recovered = true; return okPacket(); }],
    ]);
    return db;
  })();
  const restored = await ret.restoreAbandonedCart(restoreDb, 'tok-abc');
  check('F1: restore link returns the saved cart items',
    Array.isArray(restored) && restored.length === 1 && restored[0].name === 'BINBOND Watch');
  check('F1: restore link works once — second use returns null',
    (await ret.restoreAbandonedCart(restoreDb, 'tok-abc')) === null);
  check('F1: an unknown restore token returns null',
    (await ret.restoreAbandonedCart(restoreDb, 'nope')) === null);

  // ================= F2 — back-in-stock =================
  check('F2: 0 -> 5 stock is a restock event; 5 -> 8 and 0 -> 0 are not',
    ret.shouldNotifyBackInStock(0, 5) === true && ret.shouldNotifyBackInStock(5, 8) === false && ret.shouldNotifyBackInStock(0, 0) === false);
  const stockDb = (() => {
    const marked = [];
    const db = fakeDb([
      [/SELECT id, name FROM products/, async () => rows([{ id: 2, name: 'BINBOND Watch' }])],
      [/FROM stock_alerts WHERE product_id/, async () => rows([
        { id: 1, product_id: 2, phone: '01811111111', email: 'a@example.com', notified: 0 },
        { id: 2, product_id: 2, phone: '01822222222', email: null, notified: 0 },
      ])],
      [/UPDATE stock_alerts SET notified = 1 WHERE id/, async (sql, p) => { marked.push(p[0]); return okPacket(); }],
    ]);
    return { db, marked };
  })();
  const stockMail = stubSendMail(true);
  const stockOut = await ret.notifyBackInStock(stockDb.db, 2, SETTINGS_ON, stockMail, 'https://goince.com');
  check('F2: restock emails the email subscriber (once) and marks both rows done',
    stockOut.emailed === 1 && stockOut.marked === 2 && stockDb.marked.length === 2, JSON.stringify(stockOut));
  check('F2: restock email links the product page',
    sentMails.length === 1 && sentMails[0].text.includes('/product/2'));
  const stockFailDb = (() => {
    const marked = [];
    const db = fakeDb([
      [/SELECT id, name FROM products/, async () => rows([{ id: 2, name: 'BINBOND Watch' }])],
      [/FROM stock_alerts WHERE product_id/, async () => rows([{ id: 1, product_id: 2, phone: '01811111111', email: 'a@example.com', notified: 0 }])],
      [/UPDATE stock_alerts SET notified = 1 WHERE id/, async (sql, p) => { marked.push(p[0]); return okPacket(); }],
    ]);
    return { db, marked };
  })();
  const failMail = stubSendMail(false);
  const stockFailOut = await ret.notifyBackInStock(stockFailDb.db, 2, SETTINGS_ON, failMail, 'https://goince.com');
  check('F2: failed email does NOT mark the subscriber notified (retries next restock)',
    stockFailOut.emailed === 0 && stockFailDb.marked.length === 0);
  check('F2: back-in-stock OFF notifies nobody',
    (await ret.notifyBackInStock(stockDb.db, 2, SETTINGS_OFF, stockMail, 'https://goince.com')).emailed === 0);

  // ================= F3 — order-status emails =================
  const statusMail = stubSendMail(true);
  const order = { id: 12, customer_name: 'Rohim', email: 'rohim@example.com' };
  const st1 = await ret.notifyOrderStatus(fakeDb([]), order, 'Shipped', SETTINGS_ON, statusMail, 'https://goince.com');
  check('F3: status change emails the customer with the new status + order link',
    st1.sent === true && sentMails.length === 1 && sentMails[0].subject.includes('#12') && sentMails[0].subject.includes('Shipped'));
  check('F3: status email OFF sends nothing',
    (await ret.notifyOrderStatus(fakeDb([]), order, 'Shipped', SETTINGS_OFF, statusMail, 'https://goince.com')).sent === false);
  check('F3: an order with no email is skipped (no crash)',
    (await ret.notifyOrderStatus(fakeDb([]), { id: 13, customer_name: 'Guest', email: null }, 'Shipped', SETTINGS_ON, statusMail, 'https://goince.com')).sent === false);

  // ================= F6 — price-drop alerts =================
  check('F6: ৳1250 -> ৳990 is a drop; ৳990 -> ৳1250 and equal prices are not',
    !!ret.priceDropEvent(1250, 990) && ret.priceDropEvent(990, 1250) === null && ret.priceDropEvent(990, 990) === null);
  const priceDb = (() => {
    const seen = new Set();
    const db = fakeDb([
      [/SELECT id, name FROM products/, async () => rows([{ id: 5, name: 'Sewing Machine' }])],
      [/FROM wishlist w/, async () => rows([{ user_id: 3, email: 'rohim@example.com', name: 'Rohim' }])],
      [/INSERT IGNORE INTO price_drop_alerts/, async (sql, p) => {
        const key = p.join('|');
        if (seen.has(key)) return okPacket({ affectedRows: 0 });
        seen.add(key); return okPacket({ affectedRows: 1 });
      }],
    ]);
    return db;
  })();
  const priceMail = stubSendMail(true);
  const pd1 = await ret.notifyPriceDrop(priceDb, 5, 1250, 990, SETTINGS_ON, priceMail, 'https://goince.com');
  check('F6: price drop emails the wishlist customer once',
    pd1.emailed === 1 && sentMails.length === 1 && sentMails[0].text.includes('৳990'));
  const pd2 = await ret.notifyPriceDrop(priceDb, 5, 1250, 990, SETTINGS_ON, priceMail, 'https://goince.com');
  check('F6: the same price drop never emails twice (once per event)',
    pd2.emailed === 0 && sentMails.length === 1);
  check('F6: price-drop OFF emails nobody',
    (await ret.notifyPriceDrop(priceDb, 5, 1250, 900, SETTINGS_OFF, priceMail, 'https://goince.com')).emailed === 0);

  // ================= F7 — newsletter + campaigns =================
  const nlDb = fakeDb([
    [/INSERT INTO newsletter_subscribers/, async () => okPacket({ insertId: 1 })],
    [/SELECT subscribed FROM newsletter_subscribers/, async () => rows([{ subscribed: 1 }])],
  ]);
  check('F7: footer signup subscribes a valid email',
    (await ret.subscribeNewsletter(nlDb, 'new@example.com', null, 'footer')).ok === true);
  check('F7: footer signup refuses an invalid email',
    (await ret.subscribeNewsletter(nlDb, 'not-an-email', null, 'footer')).ok === false);
  check('F7: subscribed check reads the real list',
    (await ret.isNewsletterSubscribed(nlDb, 'new@example.com')) === true);
  check('F7: campaign cap — setting 900 is hard-capped at 500; setting 200 stays 200; 0 stays 0',
    ret.campaignRecipientCap(900) === 500 && ret.campaignRecipientCap(200) === 200 && ret.campaignRecipientCap(0) === 0);
  const campDb = fakeDb([
    [/FROM newsletter_subscribers WHERE subscribed/, async () => rows([{ email: 'a@example.com' }, { email: 'b@example.com' }])],
    [/INSERT INTO email_campaigns/, async () => okPacket({ insertId: 7 })],
    [/UPDATE email_campaigns SET status/, async () => okPacket()],
  ]);
  const campMail = stubSendMail(true);
  const camp = await ret.sendCampaign(campDb, { subject: 'Eid offer', body: '10% off', audience: 'subscribers', createdBy: 'admin@goince.com' }, SETTINGS_ON, campMail);
  check('F7: campaign sends to subscribers and records the campaign row',
    camp.sent === 2 && camp.id === 7 && sentMails.length === 2, JSON.stringify(camp));
  check('F7: campaign OFF refuses to send (no bulk send without the toggle)',
    (await ret.sendCampaign(campDb, { subject: 'x', body: 'y' }, SETTINGS_OFF, campMail)).error === 'disabled');
  check('F7: campaign with empty subject/body is refused',
    (await ret.sendCampaign(campDb, { subject: '', body: '' }, SETTINGS_ON, campMail)).error === 'empty');

  // ================= F8 — customer web push =================
  const vapidOff = await ret.getVapidConfig(fakeDb([]), SETTINGS_OFF);
  check('F8: push config reads the toggle + keys from Settings (off by default)',
    vapidOff.enabled === false && vapidOff.publicKey === '' && vapidOff.privateKey === '');
  const pushOff = await ret.sendCustomerPush(fakeDb([]), { title: 'Hi' }, SETTINGS_OFF);
  check('F8: push is INACTIVE without keys/enabled toggle — returns not-configured, never errors',
    pushOff.sent === 0 && pushOff.reason === 'not-configured');
  const pushNoKeys = await ret.sendCustomerPush(fakeDb([]), { title: 'Hi' },
    Object.assign({}, SETTINGS_ON, { push_enabled: '1', vapid_public_key: '', vapid_private_key: '' }));
  check('F8: push enabled but keys missing is still inactive (never errors)',
    pushNoKeys.sent === 0 && pushNoKeys.reason === 'not-configured');

  // ================= Email safety net =================
  const realMail = await emailMod.sendMail('x@example.com', 'Test', 'hi');
  check('F1–F7 safety: real sendMail returns { ok: false } (never throws) when email is unconfigured',
    realMail && realMail.ok === false && typeof realMail.error === 'string');
  check('email: isEmailConfigured() is false without EMAIL_USER/EMAIL_PASS in this env',
    emailMod.isEmailConfigured() === false);

  // ================= Settings loader =================
  const emptySettingsDb = fakeDb([[/FROM settings WHERE setting_key IN/, async () => rows([])]]);
  const defaults = await ret.getRetentionSettings(emptySettingsDb);
  check('settings: defaults apply when nothing is saved (earn 100, redeem 100=৳10, cap ৳500, win-back 60d/10%)',
    defaults.loyalty_earn_per === '100' && defaults.loyalty_redeem_points === '100' &&
    defaults.loyalty_redeem_taka === '10' && defaults.loyalty_max_redeem_taka === '500' &&
    defaults.winback_days === '60' && defaults.winback_discount_percent === '10' &&
    defaults.campaigns_enabled === '0' && defaults.push_enabled === '0');
  const throwingDb = { async query() { throw new Error('db down'); } };
  const fallback = await ret.getRetentionSettings(throwingDb);
  check('settings: a DB failure still returns defaults (settings never break the shop)',
    fallback.loyalty_earn_per === '100');

  // ================= Wiring: server boot + SQL =================
  for (const t of ['loyalty_points', 'referrals', 'abandoned_carts', 'newsletter_subscribers', 'email_campaigns', 'price_drop_alerts', 'winback_offers', 'customer_push_subscriptions']) {
    check(`boot: server.js auto-creates the ${t} table on start`,
      serverJs.includes(`CREATE TABLE IF NOT EXISTS ${t} (`));
    check(`sql: sql/retention.sql documents the ${t} table`,
      retentionSql.includes(`CREATE TABLE IF NOT EXISTS ${t} (`));
  }
  check('boot: server.js adds users.referral_code + stock_alerts.email columns',
    serverJs.includes("ADD COLUMN referral_code") && serverJs.includes("ADD COLUMN email VARCHAR(255)"));
  check('boot: server.js adds orders.points_earned / points_redeemed / points_discount columns',
    serverJs.includes('points_earned') && serverJs.includes('points_redeemed') && serverJs.includes('points_discount'));
  check('boot: retention setting keys are in SITE_SETTING_KEYS (live in res.locals.siteSettings)',
    serverJs.includes("'loyalty_enabled'") && serverJs.includes("'vapid_public_key'") && serverJs.includes("'campaigns_enabled'"));
  check('boot: newsletter flash is exposed to views once (res.locals.newsletterMsg) and cleared',
    serverJs.includes('res.locals.newsletterMsg') && serverJs.includes('delete req.session.newsletterMsg'));

  // ================= Wiring: routes =================
  check('shop: POST /checkout redeems points (pointsDiscountFor + redeemPointsForOrder)',
    shopJs.includes('pointsDiscountFor') && shopJs.includes('redeemPointsForOrder') && shopJs.includes('points_discount'));
  check('shop: GET /checkout records the abandoned cart + loads the points balance',
    shopJs.includes('recordAbandonedCart') && shopJs.includes('getPointsBalance'));
  check('shop: GET /cart/restore/:token restores an abandoned cart',
    shopJs.includes("router.get('/cart/restore/:token'"));
  check('shop: POST /newsletter/subscribe exists (footer form target)',
    shopJs.includes("router.post('/newsletter/subscribe'"));
  check('shop: customer push routes exist (subscribe / unsubscribe / vapid key)',
    shopJs.includes("router.post('/push-subscribe'") && shopJs.includes("router.post('/push-unsubscribe'") && shopJs.includes("router.get('/push-vapid-key'"));
  check('shop: Notify Me accepts an optional email (F2)',
    shopJs.includes("req.body.email") && shopJs.includes('stock_alerts (product_id, phone, email)'));
  check('shop: a placed order marks the session cart recovered (no recovery email after ordering)',
    shopJs.includes('UPDATE abandoned_carts SET recovered_at = NOW()'));
  check('admin: order status change triggers F3 email + F4 points + F5 referral + F8 push',
    adminJs.includes('notifyOrderStatus') && adminJs.includes('awardPointsForOrder') && adminJs.includes('completeReferralReward') && adminJs.includes('notifyCustomerPush'));
  check('admin: bulk status change runs the same retention hooks',
    adminJs.includes('Retention bulk-status hook'));
  check('admin: product edit triggers back-in-stock + price-drop notifications',
    adminJs.includes('notifyBackInStock') && adminJs.includes('notifyPriceDrop') && adminJs.includes('shouldNotifyBackInStock'));
  check('admin: abandoned-carts list + send routes exist (Sales area, customers.manage)',
    adminJs.includes("router.get('/abandoned-carts'") && adminJs.includes("router.post('/abandoned-carts/:id/email'"));
  check('admin: campaigns list + send routes exist (Communication area, campaigns.manage)',
    adminJs.includes("router.get('/campaigns'") && adminJs.includes("router.post('/campaigns/send'"));
  check('admin: win-back run route exists and issues via the coupon system',
    adminJs.includes("router.post('/winback/run'") && adminJs.includes('issueWinbackOffers'));
  check('admin: Settings GET + POST save all retention keys (incl. blank-keeps VAPID private key)',
    adminJs.includes("'loyalty_earn_per'") && adminJs.includes("'vapid_private_key'") && adminJs.includes("'campaign_max_recipients'"));
  check('auth: profile loads points balance + referral code/link + win-back coupon + newsletter status',
    authJs.includes('getPointsBalance') && authJs.includes('getOrCreateReferralCode') && authJs.includes('referralLink') && authJs.includes('getActiveWinbackCoupon') && authJs.includes('isNewsletterSubscribed'));
  check('auth: signup with ?ref=CODE records the referral (session refCode)',
    authJs.includes('refCode') && authJs.includes('recordReferralSignup') && authJs.includes('parseReferralCode'));
  check('permissions: campaigns.manage is registered (Communication group — role editor shows it, Owner gets it)',
    permissionsJs.includes("'campaigns.manage'"));
  check('email: config/email.js exports a generic sendMail used by retention',
    emailJs.includes('async function sendMail(') && emailJs.includes('sendMail }'));

  // ================= Wiring: views + nav =================
  check('nav: admin header has Campaigns (Communication) + Abandoned Carts (Sales) links, no new top-nav group',
    headerEjs.includes("'/admin/campaigns'") && headerEjs.includes("'/admin/abandoned-carts'") && !headerEjs.includes('Retention'));
  check('settings view: Retention section with loyalty / referral / win-back / notifications / campaigns / VAPID fields',
    settingsEjs.includes('Retention — Loyalty Points') && settingsEjs.includes('name="loyalty_earn_per"') &&
    settingsEjs.includes('name="referral_reward_points"') && settingsEjs.includes('name="winback_days"') &&
    settingsEjs.includes('name="campaigns_enabled"') && settingsEjs.includes('name="vapid_public_key"') &&
    settingsEjs.includes('name="vapid_private_key"') && settingsEjs.includes('Gmail App Password'));
  check('checkout view: loyalty redeem box with points balance + redeem_points input',
    checkoutEjs.includes('checkout-section-points') && checkoutEjs.includes('name="redeem_points"') && checkoutEjs.includes('pointsBalance'));
  check('checkout view: JS total subtracts the live points value (zone change keeps it)',
    checkoutEjs.includes('livePointsValue()') && checkoutEjs.includes('subtotal - discount - pointsValue + charge'));
  check('profile view: loyalty points card + referral link + win-back coupon + newsletter status',
    profileEjs.includes('Loyalty Points') && profileEjs.includes('referralLink') && profileEjs.includes('winbackCoupon') && profileEjs.includes('newsletterSubscribed'));
  check('footer: newsletter signup form posts to /newsletter/subscribe (no second signup added elsewhere)',
    footerEjs.includes('/newsletter/subscribe') && footerEjs.includes('name="email"'));
  check('footer: customer-push script is loaded on shop pages',
    footerEjs.includes('customer-push.js'));
  check('product view: Notify Me form has an optional email field',
    productEjs.includes('name="email"') && productEjs.includes('/notify-me'));
  check('push client: only fetches /push-vapid-key and stays silent without a key (never errors when off)',
    customerPushJs.includes("fetch('/push-vapid-key')") && customerPushJs.includes('if (!data || !data.publicKey) return;'));

  // ================= EJS renders =================
  try {
    const campHtml = await renderFile(
      path.join(__dirname, '..', 'views', 'admin', 'campaigns.ejs'),
      Object.assign({}, adminBaseLocals, {
        subscribers: [{ email: 'a@example.com', source: 'footer', created_at: new Date() }],
        campaigns: [{ subject: 'Eid offer', audience: 'subscribers', recipient_count: 2, status: 'sent', sent_at: new Date() }],
        customerCount: 1, campaignsEnabled: true, campaignCap: 200, emailConfigured: false,
        msg: null,
      }));
    check('render: admin Campaigns page renders (form, subscriber, sent campaign, email-not-configured warning)',
      campHtml.includes('/admin/campaigns/send') && campHtml.includes('a@example.com') &&
      campHtml.includes('Eid offer') && campHtml.includes('not configured'));
  } catch (e) {
    check('render: admin Campaigns page renders', false, e.message);
  }
  try {
    const abHtml = await renderFile(
      path.join(__dirname, '..', 'views', 'admin', 'abandoned-carts.ejs'),
      Object.assign({}, adminBaseLocals, {
        carts: [{ id: 4, customer_name: 'Rohim', email: 'r@e.com', items: [{ name: 'BINBOND Watch', quantity: 1, price: 990 }], subtotal: 990, updated_at: new Date(), emailed_at: null, recovered_at: null }],
        msg: null,
      }));
    check('render: admin Abandoned Carts page renders (items, subtotal, send button)',
      abHtml.includes('BINBOND Watch') && abHtml.includes('৳990') && abHtml.includes('/admin/abandoned-carts/4/email'));
  } catch (e) {
    check('render: admin Abandoned Carts page renders', false, e.message);
  }
  try {
    const coHtml = await renderFile(
      path.join(__dirname, '..', 'views', 'checkout.ejs'),
      Object.assign({}, shopBaseLocals, {
        cart: [{ name: 'BINBOND Watch', price: 990, quantity: 1, variantLabel: null }],
        subtotal: 990, coupon: null, discount: 0, deliveryCharges: { inside_dhaka: 60, outside_dhaka: 120 },
        deliveryZones: [{ slug: 'inside_dhaka', name: 'Inside Dhaka', charge: 60 }],
        deliveryCharge: 60, total: 1050, paymentMethods: [], gateway: {},
        allFreeShipping: false, codAllowed: true, error: null, prefill: null,
        form: { customer_name: '', email: '', phone: '', district: '', area: '', address_line: '' },
        bdDistricts: { districts: ['Dhaka'], areas: { Dhaka: ['Dhanmondi'] } },
        isLoggedIn: true, pointsBalance: 250, pointsValue: 20, pointsDiscount: 0,
        loyaltyEnabled: true, pointsRedeemPoints: 100, pointsRedeemTaka: 10, pointsMaxRedeem: 500,
      }));
    check('render: checkout page renders the points box (250 points, worth ৳20) + redeem input',
      coHtml.includes('250 points') && coHtml.includes('name="redeem_points"') && coHtml.includes('Place Order'));
  } catch (e) {
    check('render: checkout page renders the points box', false, e.message);
  }
  try {
    const profHtml = await renderFile(
      path.join(__dirname, '..', 'views', 'auth', 'profile.ejs'),
      Object.assign({}, shopBaseLocals, {
        user: { name: 'Rohim', email: 'rohim@example.com', phone: '01811111111', address: 'Dhaka', photo_url: null, created_at: new Date() },
        displayName: 'Rohim', rawName: 'Rohim', photoUrl: null, memberSince: 'Nov 2026',
        ordersCount: 2, totalSpent: 2240, pointsBalance: 250, pointsValue: 20,
        loyaltyEnabled: true, loyaltyEarnPer: '100', loyaltyRedeemPoints: '100', loyaltyRedeemTaka: '10',
        referralEnabled: true, referralRewardPoints: '200',
        referralCode: 'GO3AA', referralLink: 'https://goince.com/signup?ref=GO3AA',
        winbackCoupon: { code: 'WINBACK-3-202611', discount_percent: 10, expiry_date: new Date(Date.now() + 30 * 864e5) },
        newsletterSubscribed: true, emailConfigured: false,
        profileOk: false, profileMessage: null, pwOk: false, pwMessage: null,
      }));
    check('render: customer profile renders loyalty (250 pts), referral link, win-back coupon, newsletter status',
      profHtml.includes('250 points') && profHtml.includes('signup?ref=GO3AA') &&
      profHtml.includes('WINBACK-3-202611') && profHtml.includes('subscribed to Goince offers'));
  } catch (e) {
    check('render: customer profile renders retention sections', false, e.message);
  }
  try {
    const setHtml = await renderFile(
      path.join(__dirname, '..', 'views', 'admin', 'settings.ejs'),
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
        retention: Object.assign({}, ret.RETENTION_DEFAULTS, { vapidPrivateKeySet: false }),
        products: [], message: null, pwMessage: null,
      }));
    check('render: admin Settings renders the Retention section (loyalty, win-back, campaigns, VAPID)',
      setHtml.includes('Retention — Loyalty Points') && setHtml.includes('name="loyalty_earn_per"') &&
      setHtml.includes('name="vapid_public_key"') && setHtml.includes('Save Settings'));
  } catch (e) {
    check('render: admin Settings renders the Retention section', false, e.message);
  }

  console.log(`\nRetention checks: ${passes.length} passed, ${failures.length} failed.`);
  if (failures.length) { console.log('Failures: ' + failures.join(', ')); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
