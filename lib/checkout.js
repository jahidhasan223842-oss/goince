// Checkout helpers shared by routes/shop.js (server) and the
// test suite (feat/checkout, E2–E5). The browser copy of the
// validation rules lives in public/js/checkout.js and MUST match
// validateCheckoutFields below: same phone rule (lib/bd-phone.js),
// same email rule, same required fields. If a rule changes, change
// both places and update scripts/test-checkout.js.
'use strict';

const { DISTRICTS, AREAS, areasFor } = require('./bd-districts');
const { isValidBdPhone } = require('./bd-phone');

function isValidEmail(raw) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(raw || '').trim());
}

// E5 — the three new address fields compose ONE stored address
// line ("House 12, Road 5, Dhanmondi, Dhaka"), exactly what used
// to go into orders.address / users.address. Legacy free-text
// `address` still works (old forms, no-JS, API callers): when no
// district is given, the legacy value is used as-is.
function composeAddress(body) {
  const b = body || {};
  const district = String(b.district || '').trim();
  const area = String(b.area || '').trim();
  const line = String(b.address_line || '').trim();
  if (district) {
    return [line, area, district].filter(Boolean).join(', ');
  }
  return String(b.address || '').trim();
}

// E3 — a stored free-text address ("House 12, Road 5, Dhanmondi,
// Dhaka") is split back into the three picker fields, so a logged-in
// customer's saved address pre-fills the district + area dropdowns
// instead of landing in a dead text box. Best effort: the district
// is the known district name appearing in the text; the area is a
// known area of that district appearing in the text; the rest is
// the house/road line.
function parseStoredAddress(address) {
  const out = { district: '', area: '', addressLine: '' };
  const raw = String(address || '').trim();
  if (!raw) return out;
  const lower = raw.toLowerCase();
  const district = DISTRICTS.find((d) => lower.includes(d.toLowerCase()));
  if (!district) {
    out.addressLine = raw;
    return out;
  }
  out.district = district;
  const areas = areasFor(district);
  const area = areas.find((a) => lower.includes(a.toLowerCase()));
  if (area) out.area = area;
  const rest = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && s.toLowerCase() !== district.toLowerCase()
      && (!area || s.toLowerCase() !== area.toLowerCase()));
  out.addressLine = rest.join(', ');
  return out;
}

// E4 — server-side mirror of the inline validation. Returns
// { ok, errors } where errors maps field name -> message. The
// route keeps its own user-facing error strings for the re-render;
// this helper decides WHICH fields are wrong.
function validateCheckoutFields(body) {
  const b = body || {};
  const errors = {};
  const name = String(b.customer_name || '').trim();
  if (!name) errors.customer_name = 'Enter your full name.';
  if (b.email && String(b.email).trim() && !isValidEmail(b.email)) {
    errors.email = 'Enter a valid email address.';
  }
  if (!isValidBdPhone(b.phone)) {
    errors.phone = 'Enter a valid Bangladeshi mobile number (01XXXXXXXXX).';
  }
  const address = composeAddress(b);
  if (!address) {
    errors.address = 'Enter your delivery address.';
  } else if (String(b.district || '').trim() && !String(b.address_line || '').trim()) {
    errors.address_line = 'Enter your house / road / landmark.';
  }
  const district = String(b.district || '').trim();
  if (district && !AREAS[district]) errors.district = 'Choose a district from the list.';
  return { ok: Object.keys(errors).length === 0, errors };
}

module.exports = { composeAddress, parseStoredAddress, validateCheckoutFields, isValidEmail };
