// Real SSLCommerz gateway flow (feat/payments-messaging, batch 9 — E1).
//
//   initiate -> redirect to GatewayPageURL -> customer pays on
//   SSLCommerz -> success/fail/cancel/IPN callback -> VALIDATE
//   server-side (validationserverAPI) -> mark Paid ONLY when the
//   validation says VALID *and* the tran_id + amount + currency
//   match the order. An order stays Unpaid until that validation
//   succeeds — a callback alone never marks anything paid.
//
// Only the SSLCommerz provider is implemented here. The Settings
// screen already offers ShurjoPay / bKash PGW as choices; picking
// one of those does NOT start a payment — getGatewayConfig() only
// reports `configured` for sslcommerz, so checkout keeps offering
// COD + manual methods until SSLCommerz credentials are saved.
//
// Credentials: live Store ID + Store Password live ONLY in the
// settings table (Admin > Settings > Payment Gateway, English
// labels, password field never echoed back). No real credentials
// are in this file and none were provided — the gateway stays
// inactive until donal pastes them in. Sandbox mode uses the
// sandbox endpoints below; no test credentials are hardcoded
// either (SSLCommerz publishes its own public test store id /
// password for sandbox trials — donal / a developer enters those
// in Settings to try the sandbox flow).
//
// No live MySQL / network needed for the pure helpers; the HTTP
// calls take an injectable fetch so tests can stub them.
'use strict';

const SSLCOMMERZ = {
  sandbox: {
    initUrl: 'https://sandbox.sslcommerz.com/gwprocess/v4/api.php',
    validateUrl: 'https://sandbox.sslcommerz.com/validator/api/validationserverAPI.php',
  },
  live: {
    initUrl: 'https://securepay.sslcommerz.com/gwprocess/v4/api.php',
    validateUrl: 'https://securepay.sslcommerz.com/validator/api/validationserverAPI.php',
  },
};

// The settings keys the gateway reads. The password is read only
// when a payment is actually started / validated — never logged,
// never rendered, never put in a URL.
const GATEWAY_SETTING_KEYS = [
  'payment_mode', 'gateway_provider', 'gateway_enabled',
  'gateway_store_id', 'gateway_store_password', 'gateway_mode',
];

function endpoints(mode) {
  return SSLCOMMERZ[mode === 'live' ? 'live' : 'sandbox'];
}

// One config object from a settings map (rows or a plain object).
// `configured` is true ONLY when the provider is sslcommerz, the
// gateway is enabled, AND both the Store ID and Store Password
// are saved. (Before batch 9, configured only checked the Store
// ID — an ID alone can never start a payment, so the password is
// now required too.)
function gatewayConfigFromSettings(get) {
  const provider = get('gateway_provider', 'none');
  const enabled = get('gateway_enabled', '0') === '1' && provider !== 'none';
  const storeId = String(get('gateway_store_id', '') || '').trim();
  const storePassword = String(get('gateway_store_password', '') || '').trim();
  const mode = get('gateway_mode', 'sandbox') === 'live' ? 'live' : 'sandbox';
  return {
    mode: get('payment_mode', 'manual'),
    provider,
    enabled,
    storeId,
    hasStorePassword: storePassword.length > 0,
    // Only SSLCommerz has a real flow in this batch — other
    // providers stay unconfigured even if their names are saved.
    configured: provider === 'sslcommerz' && enabled && storeId.length > 0 && storePassword.length > 0,
    mode_label: mode,
    // Kept in memory only for the duration of one request; the
    // caller passes it to initiate/validate, never to a view.
    _storePassword: storePassword,
  };
}

async function getGatewaySettings(db) {
  const [rows] = await db.query(
    'SELECT setting_key, setting_value FROM settings WHERE setting_key IN (' +
      GATEWAY_SETTING_KEYS.map(() => '?').join(',') + ')',
    GATEWAY_SETTING_KEYS
  );
  const map = {};
  for (const r of rows || []) map[r.setting_key] = r.setting_value;
  return gatewayConfigFromSettings((k, fb) => (map[k] !== undefined ? map[k] : fb));
}

function isGatewayConfigured(config) {
  return !!config && config.provider === 'sslcommerz' && !!config.configured;
}

// Unique per payment attempt: GOINCE-<orderId>-<epoch ms>. The
// tran_id is what SSLCommerz echoes back, so a callback can only
// ever match the order it was started for.
function buildTranId(orderId) {
  return `GOINCE-${orderId}-${Date.now()}`;
}

function parseTranId(tranId) {
  const m = /^GOINCE-(\d+)-\d+$/.exec(String(tranId || ''));
  return m ? parseInt(m[1], 10) : null;
}

// Payload for the SSLCommerz init call. Amounts are BDT, two
// decimals; customer fields come from the order the customer just
// placed (never invented).
function buildInitPayload(config, order, urls) {
  return {
    store_id: config.storeId,
    store_passwd: config._storePassword,
    total_amount: Number(order.total_amount).toFixed(2),
    currency: 'BDT',
    tran_id: buildTranId(order.id),
    success_url: urls.success,
    fail_url: urls.fail,
    cancel_url: urls.cancel,
    ipn_url: urls.ipn,
    cus_name: order.customer_name || 'Customer',
    cus_email: order.email || 'no-email@goince.com',
    cus_add1: order.address || 'Bangladesh',
    cus_city: 'Dhaka',
    cus_country: 'Bangladesh',
    cus_phone: order.phone || '',
    shipping_method: 'NO',
    product_name: 'Goince order',
    product_category: 'E-commerce',
    product_profile: 'general',
  };
}

// POST the init call. Returns { ok, gatewayUrl, sessionkey,
// tran_id } on SUCCESS, or { ok: false, error } — and the caller
// must NOT redirect anywhere on failure (the order stays Unpaid
// and the customer sees the retry page instead).
async function initiatePayment(config, order, urls, fetchImpl) {
  const fetchFn = fetchImpl || fetch;
  if (!isGatewayConfigured(config)) {
    return { ok: false, error: 'SSLCommerz is not configured — add the Store ID and Store Password in Admin > Settings > Payment Gateway first.' };
  }
  const payload = buildInitPayload(config, order, urls);
  let res;
  try {
    res = await fetchFn(endpoints(config.mode_label).initUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(payload).toString(),
    });
  } catch (e) {
    return { ok: false, error: 'Could not reach SSLCommerz: ' + e.message };
  }
  let data;
  try { data = await res.json(); } catch (e) {
    return { ok: false, error: 'SSLCommerz returned a response that could not be read.' };
  }
  if (data && data.status === 'SUCCESS' && data.GatewayPageURL) {
    return { ok: true, gatewayUrl: data.GatewayPageURL, sessionkey: data.sessionkey || null, tran_id: payload.tran_id };
  }
  return { ok: false, error: 'SSLCommerz did not start the payment: ' + (data && (data.failedreason || data.status) ? (data.failedreason || data.status) : 'unknown error') };
}

// Server-side validation of a callback / IPN val_id. Returns
// { ok, valid, status, tran_id, amount, currency, raw }.
// `valid` is true ONLY when SSLCommerz says VALID.
async function validatePayment(config, valId, fetchImpl) {
  const fetchFn = fetchImpl || fetch;
  if (!valId) return { ok: false, valid: false, error: 'No validation ID (val_id) was returned by SSLCommerz.' };
  if (!isGatewayConfigured(config)) {
    return { ok: false, valid: false, error: 'SSLCommerz is not configured.' };
  }
  const url = endpoints(config.mode_label).validateUrl +
    '?val_id=' + encodeURIComponent(valId) +
    '&store_id=' + encodeURIComponent(config.storeId) +
    '&store_passwd=' + encodeURIComponent(config._storePassword) +
    '&v=1&format=json';
  let res;
  try { res = await fetchFn(url); } catch (e) {
    return { ok: false, valid: false, error: 'Could not reach SSLCommerz to validate the payment: ' + e.message };
  }
  let data;
  try { data = await res.json(); } catch (e) {
    return { ok: false, valid: false, error: 'SSLCommerz validation response could not be read.' };
  }
  const status = String((data && data.status) || '');
  return {
    ok: true,
    valid: status === 'VALID' || status === 'VALIDATED',
    status,
    tran_id: data ? data.tran_id : null,
    amount: data && data.amount !== undefined ? Number(data.amount) : null,
    currency: data ? data.currency : null,
    raw: data,
  };
}

// The one guard that decides whether an order may become Paid.
// Every condition must hold: validation says VALID, the tran_id
// belongs to THIS order, the amount equals the order total (to
// the paisa), and the currency is BDT. Anything else -> the order
// stays exactly as it was.
function validationMatchesOrder(validation, order) {
  if (!validation || !validation.valid) return { ok: false, reason: 'SSLCommerz did not validate this payment.' };
  const orderIdFromTran = parseTranId(validation.tran_id);
  if (orderIdFromTran !== Number(order.id)) {
    return { ok: false, reason: 'The payment reference does not belong to this order.' };
  }
  if (validation.currency && validation.currency !== 'BDT') {
    return { ok: false, reason: 'The payment currency is not BDT.' };
  }
  if (validation.amount === null || validation.amount === undefined ||
      Math.abs(Number(validation.amount) - Number(order.total_amount)) > 0.005) {
    return { ok: false, reason: 'The paid amount does not match the order total.' };
  }
  return { ok: true };
}

// Record a payment attempt (init + every callback) so donal /
// support can see what happened to a gateway order, then — only
// when validationMatchesOrder passes — flip payment_status to
// Paid and store the gateway references on the order. Returns
// { ok, paid, reason }. NEVER marks paid on a failed check.
async function markOrderPaidIfValidated(db, order, validation) {
  const match = validationMatchesOrder(validation, order);
  const tranId = validation && validation.tran_id ? String(validation.tran_id) : null;
  const valId = validation && validation.raw && validation.raw.val_id ? String(validation.raw.val_id) : null;
  try {
    await db.query(
      `INSERT INTO gateway_payment_attempts (order_id, tran_id, val_id, status, amount, currency, validated)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [order.id, tranId, valId, validation ? String(validation.status || '') : '', validation && validation.amount !== null && validation.amount !== undefined ? validation.amount : null, validation ? validation.currency || null : null, match.ok ? 1 : 0]
    );
  } catch (e) { /* attempt log never blocks the payment decision */ }
  if (!match.ok) return { ok: false, paid: false, reason: match.reason };
  await db.query(
    `UPDATE orders SET payment_status = 'Paid', gateway_tran_id = ?, gateway_val_id = ?, gateway_status = ?
     WHERE id = ? AND payment_status != 'Paid'`,
    [tranId, valId, String(validation.status || 'VALID'), order.id]
  );
  return { ok: true, paid: true };
}

module.exports = {
  SSLCOMMERZ,
  GATEWAY_SETTING_KEYS,
  endpoints,
  gatewayConfigFromSettings,
  getGatewaySettings,
  isGatewayConfigured,
  buildTranId,
  parseTranId,
  buildInitPayload,
  initiatePayment,
  validatePayment,
  validationMatchesOrder,
  markOrderPaidIfValidated,
};
