// Courier API plumbing: Steadfast + Pathao (Bangladesh).
// Docs: Steadfast — https://portal.packzy.com/api/v1 (Api-Key / Secret-Key headers,
// POST /create_order, GET /status_by_cid/{id}). Steadfast has NO sandbox — a live
// key books real parcels. Pathao — OAuth2 password grant, sandbox
// https://courier-api-sandbox.pathao.com, live https://api-hermes.pathao.com
// (POST /aladdin/api/v1/issue-token, POST /aladdin/api/v1/orders,
// GET /aladdin/api/v1/orders/{consignment_id}/info).
// Keys live in the `settings` table (Admin > Settings > Courier API) — never
// hardcoded here. All functions accept an injectable fetch (tests pass a fake).

const STEADFAST_BASE = 'https://portal.packzy.com/api/v1';
const PATHAO_BASES = {
  sandbox: 'https://courier-api-sandbox.pathao.com',
  live: 'https://api-hermes.pathao.com',
};
const COURIER_SETTING_KEYS = [
  'courier_provider', 'courier_enabled', 'courier_mode',
  'steadfast_api_key', 'steadfast_secret_key',
  'pathao_client_id', 'pathao_client_secret', 'pathao_username', 'pathao_password', 'pathao_store_id',
];

async function getCourierConfig(db) {
  const [rows] = await db.query(
    "SELECT setting_key, setting_value FROM settings WHERE setting_key IN (" + COURIER_SETTING_KEYS.map(() => '?').join(',') + ")",
    COURIER_SETTING_KEYS
  );
  const get = (k, fb) => { const r = rows.find(x => x.setting_key === k); return r ? r.setting_value : fb; };
  const provider = get('courier_provider', 'none');
  const enabled = get('courier_enabled', '0') === '1' && provider !== 'none';
  const cfg = {
    provider,
    enabled,
    mode: get('courier_mode', 'sandbox'),
    steadfastApiKey: get('steadfast_api_key', ''),
    steadfastSecretKey: get('steadfast_secret_key', ''),
    pathaoClientId: get('pathao_client_id', ''),
    pathaoClientSecret: get('pathao_client_secret', ''),
    pathaoUsername: get('pathao_username', ''),
    pathaoPassword: get('pathao_password', ''),
    pathaoStoreId: get('pathao_store_id', ''),
  };
  cfg.configured = enabled && (
    (provider === 'steadfast' && !!cfg.steadfastApiKey && !!cfg.steadfastSecretKey) ||
    (provider === 'pathao' && !!cfg.pathaoClientId && !!cfg.pathaoClientSecret && !!cfg.pathaoUsername && !!cfg.pathaoPassword && !!cfg.pathaoStoreId)
  );
  return cfg;
}

async function callApi(url, options, fetchImpl, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs || 15000);
  try {
    const res = await fetchImpl(url, { ...options, signal: ctrl.signal });
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

function codAmount(order) {
  // Paid orders: collect nothing. Otherwise collect the order total at delivery.
  return order.payment_status === 'Paid' ? 0 : Number(order.total_amount || 0);
}

function itemSummary(items) {
  const names = (items || []).map(i => i.product_name || ('Item #' + i.product_id)).filter(Boolean);
  const qty = (items || []).reduce((n, i) => n + Number(i.quantity || 1), 0);
  return { names: names.join(', ').slice(0, 200) || 'Goince order', qty: qty || 1 };
}

async function createSteadfastConsignment(order, items, cfg, fetchImpl) {
  const { names } = itemSummary(items);
  const phone = String(order.phone || '').replace(/[^0-9]/g, '');
  const body = {
    invoice: 'GOINCE-' + order.id,
    recipient_name: String(order.customer_name || 'Customer').slice(0, 100),
    recipient_phone: phone,
    recipient_address: String(order.address || '').slice(0, 250),
    cod_amount: codAmount(order),
    note: names,
  };
  const res = await callApi(STEADFAST_BASE + '/create_order', {
    method: 'POST',
    headers: {
      'Api-Key': cfg.steadfastApiKey,
      'Secret-Key': cfg.steadfastSecretKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  }, fetchImpl);
  const c = (res.data && res.data.consignment) || res.data || {};
  if (res.ok && c.consignment_id) {
    return {
      ok: true, provider: 'steadfast', courierName: 'Steadfast',
      trackingNumber: c.tracking_code || String(c.consignment_id),
      consignmentId: String(c.consignment_id),
      status: c.status || 'in_review',
    };
  }
  const msg = (res.data && (res.data.message || (res.data.errors && res.data.errors.join(', ')))) || ('Steadfast API error (HTTP ' + res.status + ')');
  return { ok: false, error: msg };
}

async function pathaoIssueToken(cfg, fetchImpl) {
  const base = PATHAO_BASES[cfg.mode === 'live' ? 'live' : 'sandbox'];
  const res = await callApi(base + '/aladdin/api/v1/issue-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: cfg.pathaoClientId,
      client_secret: cfg.pathaoClientSecret,
      grant_type: 'password',
      username: cfg.pathaoUsername,
      password: cfg.pathaoPassword,
    }),
  }, fetchImpl);
  if (res.ok && res.data && res.data.access_token) return { ok: true, token: res.data.access_token, base };
  const msg = (res.data && res.data.message) || ('Pathao token error (HTTP ' + res.status + ')');
  return { ok: false, error: msg };
}

async function createPathaoConsignment(order, items, cfg, fetchImpl) {
  const tokenRes = await pathaoIssueToken(cfg, fetchImpl);
  if (!tokenRes.ok) return tokenRes;
  const { names, qty } = itemSummary(items);
  const phone = String(order.phone || '').replace(/[^0-9]/g, '');
  const payload = {
    store_id: parseInt(cfg.pathaoStoreId, 10),
    merchant_order_id: 'GOINCE-' + order.id,
    recipient_name: String(order.customer_name || 'Customer').slice(0, 100),
    recipient_phone: phone,
    recipient_address: String(order.address || '').slice(0, 220),
    delivery_type: 48,
    item_type: 2,
    item_quantity: qty,
    item_weight: 0.5,
    amount_to_collect: codAmount(order),
    item_description: names,
  };
  const send = async (token) => callApi(tokenRes.base + '/aladdin/api/v1/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify(payload),
  }, fetchImpl);
  let res = await send(tokenRes.token);
  if (res.status === 401) {
    // Token expired mid-flight: issue once more and retry
    const retry = await pathaoIssueToken(cfg, fetchImpl);
    if (retry.ok) res = await send(retry.token);
  }
  const d = (res.data && res.data.data) || {};
  if (res.ok && d.consignment_id) {
    return {
      ok: true, provider: 'pathao', courierName: 'Pathao',
      trackingNumber: String(d.consignment_id),
      consignmentId: String(d.consignment_id),
      status: d.order_status || 'Pending',
    };
  }
  const msg = (res.data && res.data.message) || ('Pathao API error (HTTP ' + res.status + ')');
  return { ok: false, error: msg };
}

// Book a parcel for an order with the configured provider.
// Returns { ok, courierName, trackingNumber, consignmentId, status } or { ok:false, error }.
async function createConsignment(order, items, cfg, fetchImpl) {
  const doFetch = fetchImpl || fetch;
  if (!cfg || !cfg.configured) {
    return { ok: false, error: 'Courier API is not configured. Add the API keys in Settings > Courier API first.' };
  }
  try {
    if (cfg.provider === 'steadfast') return await createSteadfastConsignment(order, items, cfg, doFetch);
    if (cfg.provider === 'pathao') return await createPathaoConsignment(order, items, cfg, doFetch);
    return { ok: false, error: 'Unknown courier provider: ' + cfg.provider };
  } catch (e) {
    return { ok: false, error: 'Courier API request failed: ' + (e.message || e) };
  }
}

// Last-known delivery status for a booked consignment.
// Returns { ok, status } or { ok:false, error }.
async function getTrackingStatus(order, cfg, fetchImpl) {
  const doFetch = fetchImpl || fetch;
  if (!cfg || !cfg.configured) return { ok: false, error: 'Courier API is not configured.' };
  const cid = order.courier_consignment_id || order.tracking_number;
  if (!cid) return { ok: false, error: 'This order has no consignment yet.' };
  try {
    if (cfg.provider === 'steadfast') {
      const res = await callApi(STEADFAST_BASE + '/status_by_cid/' + encodeURIComponent(cid), {
        method: 'GET',
        headers: { 'Api-Key': cfg.steadfastApiKey, 'Secret-Key': cfg.steadfastSecretKey, 'Content-Type': 'application/json' },
      }, doFetch);
      const d = res.data || {};
      const status = (d.delivery_status && d.delivery_status.status) || d.status || null;
      if (res.ok && status) return { ok: true, status: String(status) };
      return { ok: false, error: (d.message) || ('Steadfast status error (HTTP ' + res.status + ')') };
    }
    if (cfg.provider === 'pathao') {
      const tokenRes = await pathaoIssueToken(cfg, fetchImpl);
      if (!tokenRes.ok) return tokenRes;
      const res = await callApi(tokenRes.base + '/aladdin/api/v1/orders/' + encodeURIComponent(cid) + '/info', {
        method: 'GET',
        headers: { Authorization: 'Bearer ' + tokenRes.token },
      }, doFetch);
      const d = (res.data && res.data.data) || {};
      if (res.ok && d.order_status) return { ok: true, status: String(d.order_status) };
      return { ok: false, error: (res.data && res.data.message) || ('Pathao status error (HTTP ' + res.status + ')') };
    }
    return { ok: false, error: 'Unknown courier provider: ' + cfg.provider };
  } catch (e) {
    return { ok: false, error: 'Courier status request failed: ' + (e.message || e) };
  }
}

module.exports = { getCourierConfig, createConsignment, getTrackingStatus, COURIER_SETTING_KEYS, STEADFAST_BASE, PATHAO_BASES };
