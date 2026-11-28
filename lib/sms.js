// Real SMS provider interface (feat/payments-messaging, batch 9 — I2).
//
// Before this batch lib/sms.js always returned "not configured".
// Now donal picks a provider and pastes its keys in
// Admin > Settings > SMS Notifications (English labels), and the
// sends below actually happen — but ONLY when those keys are
// saved. With no provider / no API key, isConfigured() is false
// and sendSms() returns the same clear "not configured" message
// as before, so nothing is ever sent (and no money spent) by
// accident. No provider keys are in this file and none were
// provided — SMS stays "not configured" until donal adds them.
//
// Providers:
//   none    — SMS off entirely.
//   generic — any JSON-over-HTTP SMS API: POST the saved endpoint
//             with { to, message, sender_id } as JSON and the API
//             key as a Bearer token. Covers most Bangladeshi
//             providers that take a plain HTTP call (SSL Wireless,
//             GreenWeb, BulkSMSBD and similar all have an HTTP
//             endpoint of this shape — donal pastes his provider's
//             endpoint URL + key + sender ID in Settings).
//
// Send paths wired in:
//   * Admin > order page "Send SMS update" button (routes/admin.js
//     POST /orders/:id/sms) — passes the live DB so settings are
//     read from the settings table.
//   * Order-status change (routes/admin.js POST /orders/:id/status)
//     — sends "your order #N is <status>" when the
//     "Send SMS on order status change" toggle is on; best-effort,
//     a failed SMS never blocks the status change.
//
// Tests pass settings / a stub fetch directly, so no live MySQL
// or provider is needed to verify the behaviour.
'use strict';

const SMS_NOT_CONFIGURED = 'SMS provider is not connected yet — add an SMS provider and API key in Settings first.';

const SMS_SETTING_KEYS = [
  'sms_provider', 'sms_enabled', 'sms_api_key',
  'sms_sender_id', 'sms_endpoint', 'sms_order_status_enabled',
];

const SMS_PROVIDERS = {
  none: 'No SMS provider',
  generic: 'Generic HTTP SMS API (JSON)',
};

function smsConfigFromSettings(get) {
  const provider = get('sms_provider', 'none');
  const enabled = get('sms_enabled', '0') === '1' && provider !== 'none';
  const apiKey = String(get('sms_api_key', '') || '').trim();
  return {
    provider: Object.prototype.hasOwnProperty.call(SMS_PROVIDERS, provider) ? provider : 'none',
    enabled,
    apiKey,
    apiKeySet: apiKey.length > 0,
    senderId: String(get('sms_sender_id', '') || '').trim(),
    endpoint: String(get('sms_endpoint', '') || '').trim(),
    orderStatusEnabled: get('sms_order_status_enabled', '0') === '1',
    // Only the generic provider has a real send path, and only
    // when it is enabled AND has both an API key and an endpoint.
    configured: provider === 'generic' && enabled && apiKey.length > 0 && String(get('sms_endpoint', '') || '').trim().length > 0,
  };
}

async function getSmsSettings(db) {
  const [rows] = await db.query(
    'SELECT setting_key, setting_value FROM settings WHERE setting_key IN (' +
      SMS_SETTING_KEYS.map(() => '?').join(',') + ')',
    SMS_SETTING_KEYS
  );
  const map = {};
  for (const r of rows || []) map[r.setting_key] = r.setting_value;
  return smsConfigFromSettings((k, fb) => (map[k] !== undefined ? map[k] : fb));
}

function isConfigured(config) {
  // Backwards-compatible: with no config given, nothing is
  // configured (the old stub behaviour — never claim a send).
  if (!config) return false;
  return !!config.configured;
}

// Validate a Bangladeshi mobile number the same way checkout
// does (01XXXXXXXXX, 11 digits). SMS money must never be spent
// on a number that cannot receive it.
function isValidSmsPhone(phone) {
  return /^01[3-9]\d{8}$/.test(String(phone || '').replace(/[\s-]/g, ''));
}

function normalizeSmsPhone(phone) {
  return String(phone || '').replace(/[\s-]/g, '');
}

// Send one SMS. `configOrDb` may be:
//   * a config object from smsConfigFromSettings / getSmsSettings
//   * a db pool (reads the settings itself)
//   * omitted (not configured — the old stub result)
// `fetchImpl` is injectable for tests. Returns
// { ok: true, providerResponse } or { ok: false, error }.
async function sendSms(phone, message, configOrDb, fetchImpl) {
  if (!phone || !message) return { ok: false, error: 'Phone number and message are required.' };
  const to = normalizeSmsPhone(phone);
  if (!isValidSmsPhone(to)) return { ok: false, error: 'Enter a valid Bangladeshi mobile number (01XXXXXXXXX).' };

  let config = null;
  if (configOrDb && typeof configOrDb.query === 'function') {
    try { config = await getSmsSettings(configOrDb); } catch (e) {
      return { ok: false, error: 'Could not read the SMS settings.' };
    }
  } else if (configOrDb && typeof configOrDb === 'object') {
    config = configOrDb;
  }
  if (!config || !config.configured) return { ok: false, error: SMS_NOT_CONFIGURED };

  const fetchFn = fetchImpl || fetch;
  let res;
  try {
    res = await fetchFn(config.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + config.apiKey,
      },
      body: JSON.stringify({ to, message, sender_id: config.senderId || undefined }),
    });
  } catch (e) {
    return { ok: false, error: 'Could not reach the SMS provider: ' + e.message };
  }
  let data = null;
  try { data = await res.json(); } catch (e) { /* some providers return an empty body */ }
  if (res.ok || res.status === 200 || res.status === 201) {
    // A provider that answers 2xx with an explicit error field is
    // still a failure — never report a send that did not happen.
    if (data && (data.error || data.status === 'error' || data.status === 'failed')) {
      return { ok: false, error: 'SMS provider refused the message: ' + (data.error || data.message || data.status) };
    }
    return { ok: true, providerResponse: data };
  }
  return { ok: false, error: 'SMS provider returned HTTP ' + res.status + (data && data.message ? ': ' + data.message : '.') };
}

// Order-status SMS (I2 send path): "Goince: your order #N is
// <status>." Sent only when the provider is configured AND the
// admin toggle is on. Returns { ok, skipped, error } — `skipped`
// (not an error) when SMS is off, so the caller can tell "SMS is
// not set up" apart from "the send failed".
async function sendOrderStatusSms(order, status, configOrDb, fetchImpl) {
  let config = null;
  if (configOrDb && typeof configOrDb.query === 'function') {
    try { config = await getSmsSettings(configOrDb); } catch (e) {
      return { ok: false, skipped: false, error: 'Could not read the SMS settings.' };
    }
  } else if (configOrDb && typeof configOrDb === 'object') {
    config = configOrDb;
  }
  if (!config || !config.configured) return { ok: false, skipped: true, error: SMS_NOT_CONFIGURED };
  if (!config.orderStatusEnabled) return { ok: false, skipped: true, error: 'Order-status SMS is turned off in Settings.' };
  if (!order || !order.phone) return { ok: false, skipped: false, error: 'This order has no phone number.' };
  const result = await sendSms(order.phone, `Goince: your order #${order.id} is ${status}.`, config, fetchImpl);
  return { ok: result.ok, skipped: false, error: result.error || null };
}

module.exports = {
  isConfigured,
  sendSms,
  sendOrderStatusSms,
  getSmsSettings,
  smsConfigFromSettings,
  isValidSmsPhone,
  normalizeSmsPhone,
  SMS_NOT_CONFIGURED,
  SMS_SETTING_KEYS,
  SMS_PROVIDERS,
};
