// Product-page batch (feat/product-page, PR #83) — pure helpers for the
// product page. No DB, no Express here, so the test suite can call these
// directly. Every number these helpers return comes from real inputs
// (real stock / real order counts / real session counts passed in by the
// route) — nothing here invents a figure.
//
//   D7  Delivery-date estimate: 1–2 days inside Dhaka, 3–5 days
//       outside Dhaka, with a daily 5pm order cut-off. Order before
//       the cut-off and it dispatches today; after, tomorrow.
//   D8  Honest low-stock progress bar: sold / (sold + remaining),
//       from real order + stock counts. Never above 100%.
//   G1  Live viewers: shown only when at least 2 sessions are on
//       the page (so a lone shopper never sees a fake "1 viewing").
//   G2  Recent-purchase line: first name + district only, real
//       time-ago from the order's created_at.
//   G5  Sold counter: hidden at 0, never faked.
'use strict';

const ORDER_CUTOFF_HOUR = 17; // 5pm — orders after this dispatch next day
const VIEWER_WINDOW_MINUTES = 5;
const VIEWER_MIN_TO_SHOW = 2; // show only when somebody ELSE is also viewing

const DELIVERY_WINDOWS = {
  inside_dhaka: { min: 1, max: 2, label: 'Inside Dhaka (1–2 days)' },
  outside_dhaka: { min: 3, max: 5, label: 'Outside Dhaka (3–5 days)' }
};

function zoneWindow(zoneSlug) {
  return DELIVERY_WINDOWS[zoneSlug] || DELIVERY_WINDOWS.inside_dhaka;
}

// D7 — "Order in the next X hours, get it by <date>".
// now: Date (server local time — the live server runs on Dhaka time).
// Returns { zoneSlug, zoneLabel, hoursLeft, dispatchToday, getBy (Date),
// getByLabel, windowLabel }. getBy is dispatch day + the window's MAX
// days, so the date is never earlier than the courier window allows.
function deliveryEstimate(zoneSlug, now) {
  const at = now instanceof Date ? now : new Date(now);
  const win = zoneWindow(zoneSlug);
  const cutoff = new Date(at);
  cutoff.setHours(ORDER_CUTOFF_HOUR, 0, 0, 0);
  const dispatchToday = at.getTime() < cutoff.getTime();
  const dispatch = new Date(at);
  if (!dispatchToday) dispatch.setDate(dispatch.getDate() + 1);
  dispatch.setHours(0, 0, 0, 0);
  const getBy = new Date(dispatch);
  getBy.setDate(getBy.getDate() + win.max);
  const end = dispatchToday ? cutoff : new Date(cutoff.getTime() + 24 * 60 * 60 * 1000);
  const hoursLeft = Math.max(1, Math.ceil((end.getTime() - at.getTime()) / (60 * 60 * 1000)));
  return {
    zoneSlug: DELIVERY_WINDOWS[zoneSlug] ? zoneSlug : 'inside_dhaka',
    zoneLabel: win.label,
    windowLabel: `${win.min}–${win.max} days`,
    hoursLeft,
    dispatchToday,
    getBy,
    getByLabel: getBy.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  };
}

// D8 — low-stock progress bar. sold + remaining are REAL counts from
// the DB (SUM(order_items.quantity) + products.stock). Returns null
// when the bar must not show: stock is plentiful (above the product's
// low_stock_threshold, default 5), out of stock, or nothing sold yet
// and nothing to compare against. percent is clamped to 0–100.
function lowStockBar(sold, remaining, lowThreshold) {
  const s = Math.max(0, Number(sold) || 0);
  const r = Math.max(0, Number(remaining) || 0);
  const threshold = (lowThreshold === undefined || lowThreshold === null) ? 5 : Number(lowThreshold);
  if (r <= 0) return null; // out of stock — the "Out of stock" line speaks instead
  if (r > threshold) return null; // plentiful — no urgency bar
  const total = s + r;
  if (total <= 0) return null;
  const percent = Math.min(100, Math.max(0, Math.round((s / total) * 100)));
  return { sold: s, remaining: r, total, percent };
}

// G5 — "X sold" from real order counts. 0 sold shows nothing.
function soldDisplay(sold) {
  const n = Math.max(0, Math.floor(Number(sold) || 0));
  if (n <= 0) return null;
  return `${n} sold`;
}

// G1 — live viewers. count is the REAL number of distinct sessions
// seen on this product in the last few minutes (route counts the
// product_views table). Show only when at least one OTHER person is
// viewing too; 0 or 1 (just you) shows nothing.
function viewerDisplay(count) {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  if (n < VIEWER_MIN_TO_SHOW) return null;
  return `${n} people are viewing this now`;
}

// G2 — "Rahim from Dhaka bought the sewing machine 2 hours ago".
// Only the customer's FIRST name and the delivery zone are shown
// (never a full name, phone or address). timeAgo is real, from the
// order's created_at. Returns null when there is no recent order.
function timeAgo(date, now) {
  const then = date instanceof Date ? date : new Date(date);
  const at = now instanceof Date ? now : new Date(now || Date.now());
  const secs = Math.max(0, Math.floor((at.getTime() - then.getTime()) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return then.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function buyerFirstName(customerName) {
  const first = String(customerName || '').trim().split(/\s+/)[0] || 'A customer';
  return first;
}

function zoneShortName(deliveryZone) {
  const z = String(deliveryZone || '').trim();
  if (/inside/i.test(z)) return 'Dhaka';
  return z || 'Bangladesh';
}

// order: { customer_name, delivery_zone, created_at, product_name }
function recentPurchaseLine(order, now) {
  if (!order || !order.created_at) return null;
  return `${buyerFirstName(order.customer_name)} from ${zoneShortName(order.delivery_zone)} bought ${order.product_name || 'this product'} ${timeAgo(order.created_at, now)}`;
}

// D5 — size guide shows only for apparel products that actually
// have a Size attribute (variant attribute named "Size"). The chart
// itself is a standard approximate guide, labelled as such.
//
// FIX (PR #84): sizes do NOT only come from variant attributes.
// A.T.Z (/product/7) has NO product_variants rows at all — its
// S/M/L/XL sizes live in product_options (option_label "Size",
// value_name S/M/L/XL), so variantAttributes is [] and the old
// attribute-only check hid the guide even though the size selector
// (rendered from `options`) worked fine. hasSizeChoice therefore
// also accepts a Size OPTION: optionLabel === "Size", any option
// row whose option_label is "Size", or option values that are
// standard apparel size tokens (S/M/L/XL …) as a fallback for a
// mislabelled Size option.
function hasSizeAttribute(variantAttributes) {
  return (variantAttributes || []).some((a) => String(a.name || '').trim().toLowerCase() === 'size');
}

const SIZE_TOKENS = new Set(['xs', 's', 'm', 'l', 'xl', 'xxl', '2xl', '3xl', '4xl']);

function hasSizeOption(options, optionLabel) {
  if (String(optionLabel || '').trim().toLowerCase() === 'size') return true;
  return (options || []).some((o) => {
    if (String(o.option_label || '').trim().toLowerCase() === 'size') return true;
    return SIZE_TOKENS.has(String(o.value_name || '').trim().toLowerCase());
  });
}

function hasSizeChoice(variantAttributes, options, optionLabel) {
  return hasSizeAttribute(variantAttributes) || hasSizeOption(options, optionLabel);
}

module.exports = {
  ORDER_CUTOFF_HOUR,
  VIEWER_WINDOW_MINUTES,
  VIEWER_MIN_TO_SHOW,
  DELIVERY_WINDOWS,
  deliveryEstimate,
  lowStockBar,
  soldDisplay,
  viewerDisplay,
  timeAgo,
  buyerFirstName,
  zoneShortName,
  recentPurchaseLine,
  hasSizeAttribute,
  hasSizeOption,
  hasSizeChoice
};
