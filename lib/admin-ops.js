// Admin Ops batch (feat/admin-ops, batch 8) — shared helpers for
//   I1  persistent MySQL sessions (store itself: lib/mysql-session-store.js)
//   I3  customer return / cancel requests (order_returns, type column)
//   I4  product compare (max 4, localStorage/session ids)
//   I5  coupon limits (max total uses, max per customer, min order)
//   I6  orders / invoices CSV export (correct CSV escaping)
//   I7  admin audit log (who did what, when — never secrets)
//   I8  weight-based delivery bands
//   I9  live-chat admin notification (unread_admin counter)
//   I10 in-admin analytics (REAL data only — funnel from real tables)
//   I11 flash sales / timed offers with countdown
//   I14 CSP security headers (policy string lives here)
//   I15 customer login lockout (configurable attempts + minutes)
//
// Pure helpers (no DB) are exported for scripts/test-admin-ops.js;
// the DB helpers take a `db` with a mysql2-style query() and never
// throw — a failed audit/search log must never break the shop.
'use strict';

// ---------- I14: Content-Security-Policy ----------
// The shop + admin use inline <script>/<style> blocks all over their
// EJS views, plus Google/Facebook pixels, so 'unsafe-inline' is
// required — the policy still blocks the dangerous parts (object
// embeds, framing the site, form posts off-site). Documented in the
// PR body; tightening to nonces is a later job, not this batch.
//
// PR #92: script-src-attr MUST be listed here. Helmet 8 merges the
// directives you pass with its own defaults (parseDirectives starts
// from getDefaultDirectives()), and the Helmet default is
// script-src-attr 'none' — so before this fix the served header
// silently contained `script-src-attr 'none'` even though script-src
// allowed 'unsafe-inline'. That blocked EVERY inline event-handler
// attribute site-wide (onchange="toggleTxnField()" on checkout,
// onclick="copyPaymentNumber()", the zone onchange, all admin
// onsubmit="return confirm(...)" guards, onerror image fallbacks,
// theme toggles, …) while inline <script> blocks kept running —
// which is why the checkout Transaction ID field stopped appearing
// after PR #90 added Helmet, while the district→area picker
// (addEventListener) kept working. The other Helmet defaults that
// survive the merge are harmless here: frame-ancestors 'self'
// (blocks framing, wanted) and upgrade-insecure-requests.
const CSP_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https:",
  "script-src-attr 'self' 'unsafe-inline' https:",
  "style-src 'self' 'unsafe-inline' https:",
  "img-src 'self' data: https:",
  "font-src 'self' data: https:",
  "connect-src 'self' https:",
  "frame-src https:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');
function cspPolicy() { return CSP_POLICY; }

// ---------- I4: product compare ----------
const MAX_COMPARE = 4;
function normalizeCompareIds(input) {
  const raw = Array.isArray(input) ? input : String(input || '').split(',');
  const out = [];
  for (const v of raw) {
    const n = parseInt(v, 10);
    if (Number.isFinite(n) && n > 0 && !out.includes(n)) out.push(n);
    if (out.length >= MAX_COMPARE) break;
  }
  return out;
}
function toggleCompareId(list, id) {
  const ids = normalizeCompareIds(list);
  const n = parseInt(id, 10);
  if (!Number.isFinite(n) || n <= 0) return { ids, added: false };
  if (ids.includes(n)) return { ids: ids.filter((x) => x !== n), added: false };
  if (ids.length >= MAX_COMPARE) return { ids, added: false, full: true };
  return { ids: [...ids, n], added: true };
}

// ---------- I6: CSV ----------
function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  // Quote when the value contains a comma, quote, newline — or starts
  // with = + - @ (spreadsheet formula injection guard).
  if (/[",\r\n]/.test(s) || /^[=+\-@]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function toCsv(columns, rows) {
  // columns: [{ key, label }]; rows: plain objects.
  const lines = [columns.map((c) => csvEscape(c.label)).join(',')];
  for (const r of rows || []) {
    lines.push(columns.map((c) => csvEscape(r ? r[c.key] : '')).join(','));
  }
  return '\uFEFF' + lines.join('\r\n');
}

// ---------- I5: coupon limits ----------
function parseCouponLimits(body) {
  const intOrNull = (v) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const moneyOrNull = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  return {
    max_total_uses: intOrNull(body.max_total_uses),
    max_uses_per_customer: intOrNull(body.max_uses_per_customer),
    min_order_amount: moneyOrNull(body.min_order_amount),
  };
}
// coupon: DB row (active, expiry_date, max_total_uses,
// max_uses_per_customer, min_order_amount). counts: { totalUses,
// userUses } from coupon_uses. Returns { ok, reason } — reason is a
// customer-facing message, or null when usable.
function validateCouponUse(coupon, opts) {
  const o = opts || {};
  if (!coupon) return { ok: false, reason: 'Invalid coupon code.' };
  if (!coupon.active) return { ok: false, reason: 'This coupon is no longer active.' };
  if (coupon.expiry_date) {
    const exp = new Date(coupon.expiry_date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (exp < today) return { ok: false, reason: 'This coupon has expired.' };
  }
  const minOrder = Number(coupon.min_order_amount || 0);
  if (minOrder > 0 && Number(o.subtotal || 0) < minOrder) {
    return { ok: false, reason: `This coupon needs a minimum order of ৳${minOrder}.` };
  }
  const maxTotal = Number(coupon.max_total_uses || 0);
  if (maxTotal > 0 && Number(o.totalUses || 0) >= maxTotal) {
    return { ok: false, reason: 'This coupon has reached its maximum number of uses.' };
  }
  const maxPer = Number(coupon.max_uses_per_customer || 0);
  if (maxPer > 0 && o.userId && Number(o.userUses || 0) >= maxPer) {
    return { ok: false, reason: 'You have already used this coupon the maximum number of times.' };
  }
  return { ok: true, reason: null };
}
async function getCouponUseCounts(db, couponId, userId) {
  const out = { totalUses: 0, userUses: 0 };
  try {
    const [[t]] = await db.query('SELECT COUNT(*) AS c FROM coupon_uses WHERE coupon_id = ?', [couponId]);
    out.totalUses = Number((t && t.c) || 0);
  } catch (e) { /* table not migrated yet — limits degrade to 0 uses */ }
  try {
    if (userId) {
      const [[u]] = await db.query('SELECT COUNT(*) AS c FROM coupon_uses WHERE coupon_id = ? AND user_id = ?', [couponId, userId]);
      out.userUses = Number((u && u.c) || 0);
    }
  } catch (e) { /* same */ }
  return out;
}
async function recordCouponUse(db, coupon, userId, orderId) {
  try {
    await db.query(
      'INSERT INTO coupon_uses (coupon_id, coupon_code, user_id, order_id) VALUES (?, ?, ?, ?)',
      [coupon.id, coupon.code, userId || null, orderId || null]
    );
  } catch (e) { /* coupon use is bookkeeping — never break the order */ }
}

// ---------- I8: weight-based delivery ----------
// bands: [{ max_weight_kg, charge, zone_slug }] sorted by max weight
// ascending; a band applies when the cart weight fits it AND
// (zone_slug is null/'' or matches the order zone). The FIRST matching
// band wins; when no band matches, the normal zone charge stands
// (৳60 inside Dhaka / ৳120 outside — unchanged default).
function weightDeliveryCharge(totalWeightKg, bands, baseCharge, zoneSlug) {
  const w = Number(totalWeightKg || 0);
  const sorted = [...(bands || [])]
    .filter((b) => b && Number(b.max_weight_kg) > 0)
    .sort((a, b) => Number(a.max_weight_kg) - Number(b.max_weight_kg));
  for (const b of sorted) {
    const bandZone = b.zone_slug ? String(b.zone_slug) : '';
    if (bandZone && zoneSlug && bandZone !== String(zoneSlug)) continue;
    if (w <= Number(b.max_weight_kg)) return Number(b.charge);
  }
  return Number(baseCharge);
}
function parseWeightBand(body) {
  const maxWeight = parseFloat(body.max_weight_kg);
  const charge = parseFloat(body.charge);
  if (!Number.isFinite(maxWeight) || maxWeight <= 0) return { ok: false, error: 'Enter a weight over 0 kg.' };
  if (!Number.isFinite(charge) || charge < 0) return { ok: false, error: 'Enter a delivery charge of ৳0 or more.' };
  return {
    ok: true,
    band: {
      zone_slug: (body.zone_slug || '').trim() || null,
      max_weight_kg: maxWeight,
      charge,
    },
  };
}
async function getWeightBands(db) {
  try {
    const [rows] = await db.query('SELECT * FROM weight_delivery_bands WHERE is_active = 1 ORDER BY max_weight_kg ASC, id ASC');
    return rows || [];
  } catch (e) { return []; }
}
async function getCartTotalWeight(db, cart) {
  const ids = [...new Set((cart || []).map((i) => i.id))];
  if (!ids.length) return 0;
  try {
    const [rows] = await db.query(
      `SELECT id, weight_kg FROM products WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
    const byId = new Map(rows.map((r) => [Number(r.id), Number(r.weight_kg || 0)]));
    return (cart || []).reduce((s, it) => s + (byId.get(Number(it.id)) || 0) * Number(it.quantity || 0), 0);
  } catch (e) { return 0; }
}

// ---------- I11: flash sales / timed offers ----------
function isOfferActive(offer, now) {
  if (!offer || !offer.is_active) return false;
  const t = now instanceof Date ? now : new Date(now || Date.now());
  if (offer.starts_at && new Date(offer.starts_at) > t) return false;
  if (offer.ends_at && new Date(offer.ends_at) <= t) return false;
  return true;
}
function offerPrice(offer, basePrice) {
  const base = Number(basePrice || 0);
  if (!offer) return base;
  if (offer.sale_price !== null && offer.sale_price !== undefined && Number(offer.sale_price) >= 0) {
    return Number(offer.sale_price);
  }
  if (Number(offer.discount_percent) > 0) {
    return Math.max(0, Math.round(base * (1 - Number(offer.discount_percent) / 100) * 100) / 100);
  }
  return base;
}
function offerCountdownMs(offer, now) {
  if (!offer || !offer.ends_at) return null;
  const t = now instanceof Date ? now.getTime() : new Date(now || Date.now()).getTime();
  return Math.max(0, new Date(offer.ends_at).getTime() - t);
}
async function getActiveFlashOffers(db, now) {
  try {
    const [rows] = await db.query(
      `SELECT * FROM flash_offers WHERE is_active = 1 AND (starts_at IS NULL OR starts_at <= NOW()) AND (ends_at IS NULL OR ends_at > NOW()) ORDER BY ends_at ASC`);
    return (rows || []).filter((o) => isOfferActive(o, now || new Date()));
  } catch (e) { return []; }
}
async function getFlashOfferForProduct(db, productId, now) {
  const offers = await getActiveFlashOffers(db, now);
  return offers.find((o) => Number(o.product_id) === Number(productId)) || null;
}

// ---------- I15: customer login lockout ----------
const ADMIN_OPS_SETTING_KEYS = ['login_lockout_max_attempts', 'login_lockout_minutes'];
const ADMIN_OPS_DEFAULTS = { login_lockout_max_attempts: '5', login_lockout_minutes: '15' };
function lockoutSettings(settings) {
  const s = settings || {};
  const attempts = parseInt(s.login_lockout_max_attempts, 10);
  const minutes = parseInt(s.login_lockout_minutes, 10);
  return {
    maxAttempts: Number.isFinite(attempts) && attempts > 0 ? attempts : 5,
    lockMinutes: Number.isFinite(minutes) && minutes > 0 ? minutes : 15,
  };
}
function isAccountLocked(user, now) {
  if (!user || !user.locked_until) return { locked: false, minutesLeft: 0 };
  const t = now instanceof Date ? now.getTime() : new Date(now || Date.now()).getTime();
  const until = new Date(user.locked_until).getTime();
  if (until <= t) return { locked: false, minutesLeft: 0 };
  return { locked: true, minutesLeft: Math.ceil((until - t) / 60000) };
}
// After a failed login: how many attempts now, and whether this
// failure locks the account (returns the locked_until Date or null).
function nextFailedLoginState(user, settings, now) {
  const cfg = lockoutSettings(settings);
  const attempts = Number((user && user.failed_login_attempts) || 0) + 1;
  const t = now instanceof Date ? now : new Date(now || Date.now());
  if (attempts >= cfg.maxAttempts) {
    return { attempts, lockedUntil: new Date(t.getTime() + cfg.lockMinutes * 60000) };
  }
  return { attempts, lockedUntil: null };
}

// ---------- I7: admin audit log ----------
// details must NEVER contain a password / token / secret — keys
// matching those words are stripped before insert, and the helper
// never throws (a failed audit write must never break the admin
// action it records).
const SECRET_KEY_RE = /(password|passwd|token|secret|api[_-]?key|otp|credential)/i;
function sanitizeAuditDetails(details) {
  if (!details || typeof details !== 'object') return details ? String(details) : null;
  const out = {};
  for (const [k, v] of Object.entries(details)) {
    if (SECRET_KEY_RE.test(k)) continue;
    out[k] = typeof v === 'string' ? v.slice(0, 500) : v;
  }
  return JSON.stringify(out);
}
async function logAdminAction(db, entry) {
  try {
    const e = entry || {};
    await db.query(
      'INSERT INTO admin_audit_log (admin_id, admin_email, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?, ?)',
      [e.adminId || null, e.adminEmail || null, String(e.action || 'unknown').slice(0, 100),
       e.entityType ? String(e.entityType).slice(0, 50) : null,
       e.entityId !== undefined && e.entityId !== null ? String(e.entityId).slice(0, 100) : null,
       sanitizeAuditDetails(e.details)]
    );
  } catch (err) { /* audit never breaks the action */ }
}

// ---------- I10: analytics funnel (real numbers only) ----------
// visitors: distinct site_visits sessions in the period (counting
// starts when this batch deploys — there is no earlier visit log, so
// a pre-deploy period honestly shows 0, never a made-up number).
// viewers: distinct product_view_history sessions; checkouts: rows
// in abandoned_carts (recorded on checkout reach) + orders placed;
// orders: non-cancelled orders. Rates are null when the denominator
// is 0, so the view can say "not enough data yet" instead of 0%.
function computeFunnel(input) {
  const i = input || {};
  const visitors = Math.max(0, Number(i.visitors || 0));
  const viewers = Math.max(0, Number(i.viewers || 0));
  const checkouts = Math.max(0, Number(i.checkouts || 0));
  const orders = Math.max(0, Number(i.orders || 0));
  const rate = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);
  return {
    visitors, viewers, checkouts, orders,
    viewRate: rate(viewers, visitors),
    checkoutRate: rate(checkouts, viewers),
    orderRate: rate(orders, checkouts),
    overallRate: rate(orders, visitors),
  };
}

// ---------- I10: search logging ----------
async function logSearchTerm(db, term, sessionKey, userId, resultsCount) {
  const t = String(term || '').trim().slice(0, 100);
  if (!t) return;
  try {
    await db.query(
      'INSERT INTO search_logs (term, session_key, user_id, results_count) VALUES (?, ?, ?, ?)',
      [t, sessionKey || null, userId || null, Number(resultsCount || 0)]
    );
  } catch (e) { /* search logging never breaks search */ }
}
async function getTopSearchTerms(db, limit, days) {
  try {
    const [rows] = await db.query(
      `SELECT term, COUNT(*) AS searches, MAX(results_count) AS last_results
       FROM search_logs WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       GROUP BY term ORDER BY searches DESC, term ASC LIMIT ?`,
      [Number(days || 30), Number(limit || 10)]);
    return rows || [];
  } catch (e) { return []; }
}

module.exports = {
  CSP_POLICY, cspPolicy,
  MAX_COMPARE, normalizeCompareIds, toggleCompareId,
  csvEscape, toCsv,
  parseCouponLimits, validateCouponUse, getCouponUseCounts, recordCouponUse,
  weightDeliveryCharge, parseWeightBand, getWeightBands, getCartTotalWeight,
  isOfferActive, offerPrice, offerCountdownMs, getActiveFlashOffers, getFlashOfferForProduct,
  ADMIN_OPS_SETTING_KEYS, ADMIN_OPS_DEFAULTS, lockoutSettings, isAccountLocked, nextFailedLoginState,
  sanitizeAuditDetails, logAdminAction,
  computeFunnel, logSearchTerm, getTopSearchTerms,
};
