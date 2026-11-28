// Retention batch (feat/retention, PR #88) — F1–F9.
//
//   F4  Loyalty points (earn on delivered orders, redeem at checkout)
//   F5  Referral program (code/link, referrer rewarded on the friend's
//       first delivered order)
//   F9  Win-back offers (coupon via the EXISTING coupons table)
//   F1  Abandoned-cart recovery (record + one recovery email per cart)
//   F2  Real Notify Me / back-in-stock alerts (email, once per restock)
//   F3  Order-status notification emails
//   F6  Wishlist price-drop alerts (email, once per price-drop event)
//   F7  Email campaigns / newsletter
//   F8  Customer web push (subscribe flow + VAPID keys in Settings)
//
// Every notification goes through the EXISTING email system
// (config/email.js sendMail) and/or the web-push provider interface,
// behind admin toggles in Settings (English labels). NOTHING here
// crashes or spams when email is unconfigured: sendMail itself
// returns { ok: false } and every helper logs + skips gracefully.
// Points / referrals / carts are REAL data only — never fabricated.
//
// Pure helpers (no DB) are exported for scripts/test-retention.js;
// the DB helpers take a `db` with a mysql2-style query() and a
// `sendMail` function (defaults to config/email.js sendMail).
'use strict';

const crypto = require('crypto');

// ---------- Settings ----------
// Keys live in the settings table (Admin > Settings, "Retention"
// section). Defaults here are the fallback when a key was never saved.
const RETENTION_SETTING_KEYS = [
  'loyalty_enabled', 'loyalty_earn_per', 'loyalty_redeem_points',
  'loyalty_redeem_taka', 'loyalty_max_redeem_taka',
  'referral_enabled', 'referral_reward_points',
  'winback_enabled', 'winback_days', 'winback_discount_percent',
  'order_status_email_enabled', 'back_in_stock_enabled',
  'price_drop_enabled', 'abandoned_cart_email_enabled',
  'abandoned_cart_cooldown_hours', 'campaigns_enabled',
  'campaign_max_recipients', 'push_enabled',
  'vapid_public_key', 'vapid_private_key',
];
const RETENTION_DEFAULTS = {
  loyalty_enabled: '1',
  loyalty_earn_per: '100',          // 1 point per ৳100 spent
  loyalty_redeem_points: '100',     // 100 points = ...
  loyalty_redeem_taka: '10',        // ... ৳10 off
  loyalty_max_redeem_taka: '500',   // max points discount per order
  referral_enabled: '1',
  referral_reward_points: '200',    // referrer earns 200 points
  winback_enabled: '1',
  winback_days: '60',               // no order in 60 days = win-back
  winback_discount_percent: '10',   // win-back coupon = 10% off
  order_status_email_enabled: '1',
  back_in_stock_enabled: '1',
  price_drop_enabled: '1',
  abandoned_cart_email_enabled: '1',
  abandoned_cart_cooldown_hours: '24',
  campaigns_enabled: '0',           // OFF until donal enables it (bulk send)
  campaign_max_recipients: '200',
  push_enabled: '0',                // OFF until VAPID keys are set
  vapid_public_key: '',
  vapid_private_key: '',
};
const CAMPAIGN_HARD_CAP = 500; // no single campaign send ever exceeds this
const WINBACK_COUPON_PREFIX = 'WINBACK-';

function toInt(v, fallback) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

async function getRetentionSettings(db) {
  const out = Object.assign({}, RETENTION_DEFAULTS);
  try {
    const [rows] = await db.query(
      `SELECT setting_key, setting_value FROM settings WHERE setting_key IN (${RETENTION_SETTING_KEYS.map(() => '?').join(',')})`,
      RETENTION_SETTING_KEYS);
    for (const r of rows || []) out[r.setting_key] = r.setting_value;
  } catch (e) { /* defaults stand — settings never break the shop */ }
  return out;
}

function isOn(settings, key) {
  return String((settings || {})[key] ?? RETENTION_DEFAULTS[key]) === '1';
}

// ---------- F4: loyalty points (pure) ----------
// Points earned on a real order total: 1 point per `perSpend` taka.
function pointsForSpend(amount, perSpend) {
  const per = toInt(perSpend, 100);
  if (per <= 0) return 0;
  return Math.max(0, Math.floor(Number(amount || 0) / per));
}
// Taka value of a points balance: redeemPoints points = redeemTaka taka.
function redeemValueForPoints(points, redeemPoints, redeemTaka) {
  const rp = toInt(redeemPoints, 100);
  const rt = toInt(redeemTaka, 10);
  if (rp <= 0 || rt <= 0) return 0;
  return Math.floor(Math.max(0, Number(points || 0)) / rp) * rt;
}
// How many points (and how much taka) a checkout redemption uses.
// Clamped by: balance value, the admin max-redeem cap, and the amount
// left to pay after the coupon discount. Never negative, never more
// than the customer asked for.
function pointsDiscountFor(opts) {
  const o = opts || {};
  const redeemPoints = toInt(o.redeemPoints, 100);
  const redeemTaka = toInt(o.redeemTaka, 10);
  const maxRedeemTaka = toInt(o.maxRedeemTaka, 500);
  const balance = Math.max(0, Math.floor(Number(o.pointsBalance || 0)));
  const requested = Math.max(0, Math.floor(Number(o.redeemRequested || 0)));
  const payable = Math.max(0, Number(o.subtotal || 0) - Number(o.couponDiscount || 0));
  if (redeemPoints <= 0 || redeemTaka <= 0) return { points: 0, value: 0 };
  const usablePoints = Math.min(balance, requested);
  let value = redeemValueForPoints(usablePoints, redeemPoints, redeemTaka);
  value = Math.min(value, maxRedeemTaka, payable);
  // Round the value down to whole redeem steps so points/value stay exact.
  const steps = Math.floor(value / redeemTaka);
  return { points: steps * redeemPoints, value: steps * redeemTaka };
}

// ---------- F4: loyalty points (DB) ----------
// loyalty_points ledger: one row per earn/redeem. Balance = SUM(points).
async function getPointsBalance(db, userId) {
  if (!userId) return 0;
  try {
    const [[row]] = await db.query(
      'SELECT COALESCE(SUM(points), 0) AS balance FROM loyalty_points WHERE user_id = ?', [userId]);
    return Number((row && row.balance) || 0);
  } catch (e) { return 0; }
}

// Award points for a DELIVERED order (the completed/paid point: COD is
// collected on delivery). Idempotent per order — a second call for the
// same order awards 0. Returns the points awarded.
async function awardPointsForOrder(db, orderId, settings) {
  if (!isOn(settings, 'loyalty_enabled')) return 0;
  try {
    const [[order]] = await db.query('SELECT * FROM orders WHERE id = ?', [orderId]);
    if (!order || !order.user_id) return 0;
    if (order.status !== 'Delivered') return 0;
    const [[existing]] = await db.query(
      "SELECT id FROM loyalty_points WHERE order_id = ? AND type = 'earn' LIMIT 1", [orderId]);
    if (existing) return 0;
    const points = pointsForSpend(order.total_amount, settings.loyalty_earn_per);
    if (points <= 0) return 0;
    await db.query(
      "INSERT INTO loyalty_points (user_id, order_id, points, type, note) VALUES (?, ?, ?, 'earn', ?)",
      [order.user_id, orderId, points, `Earned on delivered order #${orderId}`]);
    try {
      await db.query('UPDATE orders SET points_earned = ? WHERE id = ?', [points, orderId]);
    } catch (e) { /* column missing on very old DB — ledger is the record */ }
    return points;
  } catch (e) {
    console.error('Loyalty earn failed for order', orderId, e.message);
    return 0;
  }
}

// Spend points on an order: one negative ledger row. Returns true on success.
async function redeemPointsForOrder(db, userId, orderId, points, value) {
  if (!userId || !points || points <= 0) return false;
  try {
    await db.query(
      "INSERT INTO loyalty_points (user_id, order_id, points, type, note) VALUES (?, ?, ?, 'redeem', ?)",
      [userId, orderId, -points, `Redeemed ৳${value} off on order #${orderId}`]);
    try {
      await db.query('UPDATE orders SET points_redeemed = ?, points_discount = ? WHERE id = ?',
        [points, value, orderId]);
    } catch (e) { /* ledger row is the record */ }
    return true;
  } catch (e) {
    console.error('Loyalty redeem failed for order', orderId, e.message);
    return false;
  }
}

// ---------- F5: referrals (pure) ----------
// Code is derived from the user id, so it is stable and unique per
// customer: GO + base36(id) + 2-char checksum. No random codes to collide.
function makeReferralCode(userId) {
  const id = Math.floor(Number(userId || 0));
  if (!id || id <= 0) return null;
  const body = id.toString(36).toUpperCase();
  const check = crypto.createHash('md5').update('goince-ref-' + id).digest('hex').slice(0, 2).toUpperCase();
  return 'GO' + body + check;
}
function parseReferralCode(code) {
  if (typeof code !== 'string') return null;
  const m = /^GO([0-9A-Z]+)([0-9A-F]{2})$/.exec(code.trim().toUpperCase());
  if (!m) return null;
  const id = parseInt(m[1], 36);
  if (!id || id <= 0) return null;
  return makeReferralCode(id) === code.trim().toUpperCase() ? id : null;
}
function referralLink(siteUrl, userId) {
  const code = makeReferralCode(userId);
  if (!code) return null;
  return `${String(siteUrl || '').replace(/\/$/, '')}/signup?ref=${code}`;
}

// ---------- F5: referrals (DB) ----------
async function getOrCreateReferralCode(db, userId) {
  if (!userId) return null;
  try {
    const [[user]] = await db.query('SELECT referral_code FROM users WHERE id = ?', [userId]);
    if (user && user.referral_code) return user.referral_code;
    const code = makeReferralCode(userId);
    if (!code) return null;
    try {
      await db.query('UPDATE users SET referral_code = ? WHERE id = ?', [code, userId]);
    } catch (e) { /* column missing — derived code still works */ }
    return code;
  } catch (e) { return makeReferralCode(userId); }
}

// A new signup that arrived with a referrer's code: one pending row.
// Self-referral and duplicates are refused.
async function recordReferralSignup(db, referrerId, newUserId) {
  if (!referrerId || !newUserId || referrerId === newUserId) return false;
  try {
    const [[referrer]] = await db.query('SELECT id FROM users WHERE id = ?', [referrerId]);
    if (!referrer) return false;
    const [[existing]] = await db.query(
      'SELECT id FROM referrals WHERE referred_user_id = ? LIMIT 1', [newUserId]);
    if (existing) return false;
    await db.query(
      "INSERT INTO referrals (referrer_user_id, referred_user_id, status) VALUES (?, ?, 'pending')",
      [referrerId, newUserId]);
    return true;
  } catch (e) {
    console.error('Referral record failed:', e.message);
    return false;
  }
}

// When a referred friend's FIRST order is delivered, reward the
// referrer with loyalty points (F5 reward). Idempotent: the referral
// row flips pending -> rewarded exactly once. Returns points awarded.
async function completeReferralReward(db, orderUserId, settings) {
  if (!isOn(settings, 'referral_enabled')) return 0;
  try {
    const [[ref]] = await db.query(
      "SELECT * FROM referrals WHERE referred_user_id = ? AND status = 'pending' LIMIT 1", [orderUserId]);
    if (!ref) return 0;
    const [[delivered]] = await db.query(
      "SELECT COUNT(*) AS c FROM orders WHERE user_id = ? AND status = 'Delivered'", [orderUserId]);
    if (!delivered || Number(delivered.c) === 0) return 0;
    const points = toInt(settings.referral_reward_points, 200);
    await db.query("UPDATE referrals SET status = 'rewarded', reward_points = ? WHERE id = ?", [points, ref.id]);
    if (points > 0) {
      await db.query(
        "INSERT INTO loyalty_points (user_id, order_id, points, type, note) VALUES (?, ?, ?, 'earn', ?)",
        [ref.referrer_user_id, null, points, `Referral reward — friend's first delivered order`]);
    }
    return points;
  } catch (e) {
    console.error('Referral reward failed:', e.message);
    return 0;
  }
}

// ---------- F9: win-back (pure) ----------
// Eligible when the last (non-cancelled) order is older than `days`.
function isWinbackEligible(lastOrderAt, days, now) {
  if (!lastOrderAt) return false;
  const d = toInt(days, 60);
  const last = new Date(lastOrderAt).getTime();
  if (!Number.isFinite(last)) return false;
  const at = (now instanceof Date ? now : new Date(now || Date.now())).getTime();
  return (at - last) > d * 24 * 60 * 60 * 1000;
}

// ---------- F9: win-back (DB) ----------
// Customers whose last order is older than `days` and who have no
// win-back offer issued in the last `days` days. Real orders only.
async function findWinbackCustomers(db, days) {
  const d = toInt(days, 60);
  try {
    const [rows] = await db.query(
      `SELECT u.id, u.name, u.email, MAX(o.created_at) AS last_order_at
       FROM users u
       JOIN orders o ON o.user_id = u.id AND o.status != 'Cancelled'
       WHERE u.email IS NOT NULL AND u.email != ''
       GROUP BY u.id, u.name, u.email
       HAVING MAX(o.created_at) < DATE_SUB(NOW(), INTERVAL ? DAY)
          AND NOT EXISTS (
            SELECT 1 FROM winback_offers w
            WHERE w.user_id = u.id AND w.issued_at > DATE_SUB(NOW(), INTERVAL ? DAY))`,
      [d, d]);
    return rows || [];
  } catch (e) {
    console.error('Win-back lookup failed:', e.message);
    return [];
  }
}

// Issue one win-back coupon per eligible customer, using the EXISTING
// coupons table (code WINBACK-<userId>-<yyyymm>, % off from Settings,
// 30-day expiry), record it in winback_offers, and email it when
// email is configured. Returns { issued, emailed }.
async function issueWinbackOffers(db, settings, sendMail, siteUrl) {
  const out = { issued: 0, emailed: 0 };
  if (!isOn(settings, 'winback_enabled')) return out;
  const customers = await findWinbackCustomers(db, settings.winback_days);
  const pct = Math.min(100, Math.max(1, toInt(settings.winback_discount_percent, 10)));
  const ym = new Date().toISOString().slice(0, 7).replace('-', '');
  for (const c of customers) {
    const code = `${WINBACK_COUPON_PREFIX}${c.id}-${ym}`;
    try {
      const [[existing]] = await db.query('SELECT id FROM coupons WHERE code = ?', [code]);
      if (!existing) {
        await db.query(
          'INSERT INTO coupons (code, discount_percent, active, expiry_date) VALUES (?, ?, 1, DATE_ADD(CURDATE(), INTERVAL 30 DAY))',
          [code, pct]);
      }
      await db.query(
        'INSERT INTO winback_offers (user_id, coupon_code) VALUES (?, ?) ON DUPLICATE KEY UPDATE coupon_code = VALUES(coupon_code), issued_at = NOW()',
        [c.id, code]);
      out.issued += 1;
      if (c.email && sendMail) {
        const r = await sendMail(c.email,
          `We miss you — ${pct}% off your next Goince order`,
          `Hi ${c.name || 'there'},\n\nIt's been a while since your last Goince order. Here's ${pct}% off your next one — use code ${code} at checkout. It works for 30 days.\n\nShop: ${siteUrl || 'https://goince.com'}\n\n- Team Goince`,
          `<p>Hi <strong>${c.name || 'there'}</strong>,</p><p>It's been a while since your last Goince order. Here's <strong>${pct}% off</strong> your next one — use code <strong>${code}</strong> at checkout. It works for 30 days.</p><p><a href="${siteUrl || 'https://goince.com'}">Shop now</a></p><p>- Team Goince</p>`);
        if (r && r.ok) out.emailed += 1;
      }
    } catch (e) {
      console.error('Win-back issue failed for user', c.id, e.message);
    }
  }
  return out;
}

// A customer's currently usable win-back coupon (latest, active, unexpired).
async function getActiveWinbackCoupon(db, userId) {
  if (!userId) return null;
  try {
    const [[row]] = await db.query(
      `SELECT w.coupon_code AS code, c.discount_percent, c.expiry_date
       FROM winback_offers w JOIN coupons c ON c.code = w.coupon_code
       WHERE w.user_id = ? AND c.active = 1 AND (c.expiry_date IS NULL OR c.expiry_date >= CURDATE())
       ORDER BY w.issued_at DESC LIMIT 1`, [userId]);
    return row || null;
  } catch (e) { return null; }
}

// ---------- F1: abandoned carts (pure) ----------
// Sendable when: never emailed, never recovered, and abandoned at
// least `cooldownHours` ago. One email per cart, ever.
function abandonedCartEligible(cart, cooldownHours, now) {
  if (!cart || cart.emailed_at || cart.recovered_at) return false;
  const hours = Number(cooldownHours);
  const created = new Date(cart.created_at).getTime();
  if (!Number.isFinite(created)) return false;
  const at = (now instanceof Date ? now : new Date(now || Date.now())).getTime();
  return (at - created) >= (Number.isFinite(hours) ? hours : 24) * 60 * 60 * 1000;
}

// ---------- F1: abandoned carts (DB) ----------
// A cart that reached /checkout but was never ordered. Upsert by
// session: one live (unrecovered) row per session, refreshed while
// the customer keeps shopping. Guest carts keep the checkout email
// when the customer typed one; logged-in carts keep the user id.
async function recordAbandonedCart(db, opts) {
  const o = opts || {};
  if (!o.sessionKey || !Array.isArray(o.cart) || o.cart.length === 0) return null;
  const token = crypto.randomBytes(16).toString('hex');
  const cartJson = JSON.stringify(o.cart.map(i => ({
    id: i.id, name: i.name, price: Number(i.price) || 0,
    quantity: Number(i.quantity) || 1, variantId: i.variantId || null,
    variantLabel: i.variantLabel || null, image: i.image || null,
  })));
  try {
    const [[existing]] = await db.query(
      'SELECT id FROM abandoned_carts WHERE session_key = ? AND recovered_at IS NULL ORDER BY updated_at DESC LIMIT 1',
      [o.sessionKey]);
    if (existing) {
      await db.query(
        'UPDATE abandoned_carts SET user_id = ?, email = ?, cart_json = ?, updated_at = NOW() WHERE id = ?',
        [o.userId || null, o.email || null, cartJson, existing.id]);
      return existing.id;
    }
    const [r] = await db.query(
      'INSERT INTO abandoned_carts (session_key, user_id, email, cart_json, restore_token) VALUES (?, ?, ?, ?, ?)',
      [o.sessionKey, o.userId || null, o.email || null, cartJson, token]);
    return r.insertId;
  } catch (e) {
    console.error('Abandoned cart record failed:', e.message);
    return null;
  }
}

async function getAbandonedCartByToken(db, token) {
  if (!token) return null;
  try {
    const [[row]] = await db.query(
      'SELECT * FROM abandoned_carts WHERE restore_token = ? AND recovered_at IS NULL LIMIT 1', [token]);
    return row || null;
  } catch (e) { return null; }
}

// Restore a cart into the session; marks it recovered so the link
// works once and the cart stops counting as abandoned.
async function restoreAbandonedCart(db, token) {
  const row = await getAbandonedCartByToken(db, token);
  if (!row) return null;
  let cart = [];
  try { cart = JSON.parse(row.cart_json || '[]'); } catch (e) { cart = []; }
  if (!Array.isArray(cart) || cart.length === 0) return null;
  try {
    await db.query('UPDATE abandoned_carts SET recovered_at = NOW() WHERE id = ?', [row.id]);
  } catch (e) { /* restore still proceeds */ }
  return cart;
}

// Send the ONE recovery email for a cart. Enforces the one-email rule
// in the DB (only rows with emailed_at IS NULL are sent, and the flag
// is set in the same call), so a double-click or a second admin run
// can never send twice. Returns { sent: true } or { sent: false, reason }.
async function sendAbandonedCartEmail(db, cartId, sendMail, siteUrl, settings) {
  if (!isOn(settings, 'abandoned_cart_email_enabled')) return { sent: false, reason: 'disabled' };
  try {
    const [[cart]] = await db.query('SELECT * FROM abandoned_carts WHERE id = ?', [cartId]);
    if (!cart) return { sent: false, reason: 'not-found' };
    if (cart.emailed_at) return { sent: false, reason: 'already-emailed' };
    if (cart.recovered_at) return { sent: false, reason: 'already-recovered' };
    if (!cart.email) return { sent: false, reason: 'no-email' };
    let items = [];
    try { items = JSON.parse(cart.cart_json || '[]'); } catch (e) { items = []; }
    if (!items.length) return { sent: false, reason: 'empty-cart' };
    const names = items.map(i => `${i.name} × ${i.quantity}`).join(', ');
    const link = `${String(siteUrl || '').replace(/\/$/, '')}/cart/restore/${cart.restore_token}`;
    const r = await sendMail(cart.email,
      'You left something in your Goince cart',
      `Hi,\n\nYou left ${names} in your Goince cart. Your cart is still saved — come back and finish your order:\n${link}\n\n- Team Goince`,
      `<p>Hi,</p><p>You left <strong>${names}</strong> in your Goince cart. Your cart is still saved — come back and finish your order:</p><p><a href="${link}">Restore my cart</a></p><p>- Team Goince</p>`);
    if (!r || !r.ok) return { sent: false, reason: 'email-failed' };
    await db.query('UPDATE abandoned_carts SET emailed_at = NOW() WHERE id = ? AND emailed_at IS NULL', [cartId]);
    return { sent: true };
  } catch (e) {
    console.error('Abandoned cart email failed:', e.message);
    return { sent: false, reason: 'error' };
  }
}

// ---------- F2: back-in-stock (pure) ----------
function shouldNotifyBackInStock(oldStock, newStock) {
  return Number(oldStock || 0) <= 0 && Number(newStock || 0) > 0;
}

// ---------- F2: back-in-stock (DB) ----------
// Email every subscriber for this product exactly once per restock
// event, then mark them notified. Phone-only subscribers (no email)
// are marked done too — there is no SMS channel (batch 9), and the
// old code marked them done without notifying either.
async function notifyBackInStock(db, productId, settings, sendMail, siteUrl) {
  const out = { emailed: 0, marked: 0 };
  if (!isOn(settings, 'back_in_stock_enabled')) return out;
  try {
    const [[product]] = await db.query('SELECT id, name FROM products WHERE id = ?', [productId]);
    if (!product) return out;
    const [subs] = await db.query(
      'SELECT * FROM stock_alerts WHERE product_id = ? AND notified = 0', [productId]);
    for (const s of subs || []) {
      if (s.email && sendMail) {
        const link = `${String(siteUrl || '').replace(/\/$/, '')}/product/${productId}`;
        const r = await sendMail(s.email,
          `${product.name} is back in stock at Goince`,
          `Hi,\n\nGood news — ${product.name} is back in stock at Goince. Order soon, before it sells out again:\n${link}\n\n- Team Goince`,
          `<p>Hi,</p><p>Good news — <strong>${product.name}</strong> is back in stock at Goince.</p><p><a href="${link}">Order now</a></p><p>- Team Goince</p>`);
        if (r && r.ok) {
          out.emailed += 1;
          await db.query('UPDATE stock_alerts SET notified = 1 WHERE id = ?', [s.id]);
          out.marked += 1;
        }
        // Email na gele row notified hoy na — porer restock-e abar
        // try hobe (email configure hole tokhon jabe).
      } else {
        // Phone-only subscriber: kono email channel nei (SMS batch 9),
        // tai done hisabe mark kora hoy — ager code-o etai korto.
        await db.query('UPDATE stock_alerts SET notified = 1 WHERE id = ?', [s.id]);
        out.marked += 1;
      }
    }
    return out;
  } catch (e) {
    console.error('Back-in-stock notify failed:', e.message);
    return out;
  }
}

// ---------- F3: order-status emails (DB) ----------
// Email the customer when an admin changes an order's status.
// Skips silently when the toggle is off, the order has no email, or
// email is unconfigured (sendMail returns { ok: false }).
async function notifyOrderStatus(db, order, newStatus, settings, sendMail, siteUrl) {
  if (!isOn(settings, 'order_status_email_enabled')) return { sent: false, reason: 'disabled' };
  if (!order || !order.email) return { sent: false, reason: 'no-email' };
  try {
    const link = `${String(siteUrl || '').replace(/\/$/, '')}/track-order`;
    const r = await sendMail(order.email,
      `Your Goince order #${order.id} is now ${newStatus}`,
      `Hi ${order.customer_name || ''},\n\nYour Goince order #${order.id} status changed to: ${newStatus}.\nTrack it here: ${link}\n\n- Team Goince`,
      `<p>Hi <strong>${order.customer_name || ''}</strong>,</p><p>Your Goince order <strong>#${order.id}</strong> status changed to: <strong>${newStatus}</strong>.</p><p><a href="${link}">Track your order</a></p><p>- Team Goince</p>`);
    return { sent: !!(r && r.ok), reason: (r && r.ok) ? undefined : 'email-failed' };
  } catch (e) {
    console.error('Order status email failed:', e.message);
    return { sent: false, reason: 'error' };
  }
}

// ---------- F6: price-drop alerts (pure) ----------
function priceDropEvent(oldPrice, newPrice) {
  const from = Number(oldPrice);
  const to = Number(newPrice);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  if (to >= from) return null;
  return { from, to };
}

// ---------- F6: price-drop alerts (DB) ----------
// Email logged-in customers who have the product on their wishlist,
// once per price-drop event. The (user, product, from, to) row is
// INSERTed first — INSERT IGNORE + affectedRows decides who gets
// mailed, so a repeated edit to the same price can never re-notify.
async function notifyPriceDrop(db, productId, oldPrice, newPrice, settings, sendMail, siteUrl) {
  const out = { emailed: 0 };
  if (!isOn(settings, 'price_drop_enabled')) return out;
  const ev = priceDropEvent(oldPrice, newPrice);
  if (!ev) return out;
  try {
    const [[product]] = await db.query('SELECT id, name FROM products WHERE id = ?', [productId]);
    if (!product) return out;
    const [wishers] = await db.query(
      `SELECT DISTINCT w.user_id, u.email, u.name FROM wishlist w
       JOIN users u ON u.id = w.user_id
       WHERE w.product_id = ? AND u.email IS NOT NULL AND u.email != ''`, [productId]);
    const link = `${String(siteUrl || '').replace(/\/$/, '')}/product/${productId}`;
    for (const w of wishers || []) {
      const [r] = await db.query(
        'INSERT IGNORE INTO price_drop_alerts (user_id, product_id, price_from, price_to) VALUES (?, ?, ?, ?)',
        [w.user_id, productId, ev.from, ev.to]);
      if (!r || r.affectedRows !== 1) continue; // already notified for this drop
      const sent = await sendMail(w.email,
        `Price drop: ${product.name} is now ৳${ev.to}`,
        `Hi ${w.name || ''},\n\n${product.name} on your Goince wishlist dropped from ৳${ev.from} to ৳${ev.to}. Grab it before the price goes back up:\n${link}\n\n- Team Goince`,
        `<p>Hi <strong>${w.name || ''}</strong>,</p><p><strong>${product.name}</strong> on your Goince wishlist dropped from <s>৳${ev.from}</s> to <strong>৳${ev.to}</strong>.</p><p><a href="${link}">View product</a></p><p>- Team Goince</p>`);
      if (sent && sent.ok) out.emailed += 1;
    }
    return out;
  } catch (e) {
    console.error('Price-drop notify failed:', e.message);
    return out;
  }
}

// ---------- F7: newsletter + campaigns ----------
async function subscribeNewsletter(db, email, userId, source) {
  const clean = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) return { ok: false, error: 'invalid-email' };
  try {
    await db.query(
      'INSERT INTO newsletter_subscribers (email, user_id, source, subscribed) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE subscribed = 1, user_id = COALESCE(user_id, VALUES(user_id))',
      [clean, userId || null, source || 'footer']);
    return { ok: true, email: clean };
  } catch (e) {
    console.error('Newsletter subscribe failed:', e.message);
    return { ok: false, error: 'db-error' };
  }
}

async function isNewsletterSubscribed(db, email) {
  if (!email) return false;
  try {
    const [[row]] = await db.query(
      'SELECT subscribed FROM newsletter_subscribers WHERE email = ? LIMIT 1', [String(email).trim().toLowerCase()]);
    return !!(row && row.subscribed);
  } catch (e) { return false; }
}

// Per-send cap: the admin setting, never above the hard cap.
function campaignRecipientCap(settingMax) {
  const n = toInt(settingMax, 200);
  return Math.max(0, Math.min(n, CAMPAIGN_HARD_CAP));
}

// Send a campaign to subscribers (or all customers with an email).
// Refuses when the campaigns toggle is off. Records the campaign
// row first (status 'sending'), then mails up to the cap, then marks
// it 'sent' with the real recipient count. Returns { sent, capped, id }.
async function sendCampaign(db, opts, settings, sendMail) {
  const o = opts || {};
  if (!isOn(settings, 'campaigns_enabled')) return { sent: 0, capped: 0, id: null, error: 'disabled' };
  const subject = String(o.subject || '').trim();
  const body = String(o.body || '').trim();
  if (!subject || !body) return { sent: 0, capped: 0, id: null, error: 'empty' };
  const cap = campaignRecipientCap(settings.campaign_max_recipients);
  const audience = o.audience === 'customers' ? 'customers' : 'subscribers';
  try {
    const [recipients] = audience === 'customers'
      ? await db.query("SELECT DISTINCT email, name FROM users WHERE email IS NOT NULL AND email != '' ORDER BY id LIMIT ?", [cap])
      : await db.query('SELECT email FROM newsletter_subscribers WHERE subscribed = 1 ORDER BY id LIMIT ?', [cap]);
    const [ins] = await db.query(
      "INSERT INTO email_campaigns (subject, body_text, audience, recipient_count, status, created_by) VALUES (?, ?, ?, ?, 'sending', ?)",
      [subject, body, audience, (recipients || []).length, o.createdBy || null]);
    const campaignId = ins.insertId;
    let sent = 0;
    for (const r of recipients || []) {
      const res = await sendMail(r.email, subject,
        `${body}\n\n- Team Goince\n\n(You are receiving this because you subscribed to Goince emails. Reply to unsubscribe.)`,
        `<p>${body.replace(/\n/g, '<br>')}</p><p>- Team Goince</p><p style="font-size:12px;color:#888;">You are receiving this because you subscribed to Goince emails.</p>`);
      if (res && res.ok) sent += 1;
    }
    await db.query("UPDATE email_campaigns SET status = 'sent', recipient_count = ?, sent_at = NOW() WHERE id = ?",
      [sent, campaignId]);
    return { sent, capped: (recipients || []).length, id: campaignId };
  } catch (e) {
    console.error('Campaign send failed:', e.message);
    return { sent: 0, capped: 0, id: null, error: 'db-error' };
  }
}

// ---------- F8: customer web push ----------
async function getVapidConfig(db, settings) {
  const s = settings || (await getRetentionSettings(db));
  return {
    enabled: isOn(s, 'push_enabled'),
    publicKey: String(s.vapid_public_key || '').trim(),
    privateKey: String(s.vapid_private_key || '').trim(),
  };
}

// Send a push to every subscribed CUSTOMER device (admin devices use
// config/push.js notifyAdmins — separate table, separate flow).
// Inactive — returns { sent: 0, reason: 'not-configured' } — when the
// toggle is off or either VAPID key is missing. Never throws.
// Expired (410/404) subscriptions are pruned.
async function sendCustomerPush(db, payload, settings) {
  const cfg = await getVapidConfig(db, settings);
  if (!cfg.enabled || !cfg.publicKey || !cfg.privateKey) {
    return { sent: 0, reason: 'not-configured' };
  }
  let webpush;
  try {
    webpush = require('web-push');
    webpush.setVapidDetails('mailto:admin@goince.com', cfg.publicKey, cfg.privateKey);
  } catch (e) {
    console.error('Customer push setup failed:', e.message);
    return { sent: 0, reason: 'setup-failed' };
  }
  let subs = [];
  try {
    [subs] = await db.query('SELECT * FROM customer_push_subscriptions');
  } catch (e) {
    console.error('Customer push load failed:', e.message);
    return { sent: 0, reason: 'db-error' };
  }
  const data = JSON.stringify(payload);
  let sent = 0;
  for (const sub of subs || []) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, data);
      sent += 1;
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        await db.query('DELETE FROM customer_push_subscriptions WHERE id = ?', [sub.id]).catch(() => {});
      } else {
        console.error('Customer push send error:', err.message);
      }
    }
  }
  return { sent };
}

// Push to one customer's devices only (e.g. their own order update).
async function notifyCustomerPush(db, userId, payload, settings) {
  const cfg = await getVapidConfig(db, settings);
  if (!cfg.enabled || !cfg.publicKey || !cfg.privateKey || !userId) {
    return { sent: 0, reason: 'not-configured' };
  }
  let webpush;
  try {
    webpush = require('web-push');
    webpush.setVapidDetails('mailto:admin@goince.com', cfg.publicKey, cfg.privateKey);
  } catch (e) {
    return { sent: 0, reason: 'setup-failed' };
  }
  let subs = [];
  try {
    [subs] = await db.query('SELECT * FROM customer_push_subscriptions WHERE user_id = ?', [userId]);
  } catch (e) { return { sent: 0, reason: 'db-error' }; }
  const data = JSON.stringify(payload);
  let sent = 0;
  for (const sub of subs || []) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, data);
      sent += 1;
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        await db.query('DELETE FROM customer_push_subscriptions WHERE id = ?', [sub.id]).catch(() => {});
      }
    }
  }
  return { sent };
}

module.exports = {
  RETENTION_SETTING_KEYS,
  RETENTION_DEFAULTS,
  CAMPAIGN_HARD_CAP,
  WINBACK_COUPON_PREFIX,
  getRetentionSettings,
  isOn,
  pointsForSpend,
  redeemValueForPoints,
  pointsDiscountFor,
  getPointsBalance,
  awardPointsForOrder,
  redeemPointsForOrder,
  makeReferralCode,
  parseReferralCode,
  referralLink,
  getOrCreateReferralCode,
  recordReferralSignup,
  completeReferralReward,
  isWinbackEligible,
  findWinbackCustomers,
  issueWinbackOffers,
  getActiveWinbackCoupon,
  abandonedCartEligible,
  recordAbandonedCart,
  getAbandonedCartByToken,
  restoreAbandonedCart,
  sendAbandonedCartEmail,
  shouldNotifyBackInStock,
  notifyBackInStock,
  notifyOrderStatus,
  priceDropEvent,
  notifyPriceDrop,
  subscribeNewsletter,
  isNewsletterSubscribed,
  campaignRecipientCap,
  sendCampaign,
  getVapidConfig,
  sendCustomerPush,
  notifyCustomerPush,
};
