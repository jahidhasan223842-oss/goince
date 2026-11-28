// Payments & messaging batch — E1 / E6 / I2 / I12 (feat/payments-messaging, batch 9).
//
//   E1  Real SSLCommerz gateway flow: initiate -> redirect ->
//       validate -> callback/IPN -> mark Paid ONLY after the
//       server-side validation matches this order (tran_id +
//       amount + BDT). COD + manual bKash/Nagad/Rocket keep
//       working exactly as before.
//   E6  Express checkout buttons (cart + product page) wired to
//       the gateway; hidden until the gateway is configured.
//   I2  Real SMS provider interface + Settings screen; stays
//       "not configured" until donal pastes provider keys, and
//       an order-status SMS path behind the admin toggle.
//   I12 Automated daily backups: mysqldump on a daily schedule
//       + admin list / run / download page (admin-only).
//
//   I13 (suppliers / purchase orders / cost history) is NOT in
//   this batch — it is a full batch of its own; see the PR body.
//
// No live MySQL, gateway or SMS provider needed: pure-function
// checks + the REAL lib/sslcommerz.js, lib/sms.js and
// lib/backups.js on stubbed fetch / execFile / DB + direct EJS
// renders of the touched views + source checks that every route,
// setting, toggle and nav link is wired.
//
// Run:  node scripts/test-payments-messaging.js
// Exit code 0 = all checks passed.
'use strict';

const fs = require('fs');
const path = require('path');
const util = require('util');
const os = require('os');
const ejs = require('ejs');
const { EventEmitter } = require('events');
const { Readable } = require('stream');
const { DISTRICTS, AREAS } = require('../lib/bd-districts');

const read = (p) => fs.readFileSync(p, 'utf8');
const renderFile = util.promisify(ejs.renderFile);
const ssl = require('../lib/sslcommerz');
const sms = require('../lib/sms');
const backups = require('../lib/backups');
const { PERMISSION_GROUPS, ALL_PERMISSIONS } = require('../lib/permissions');

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

const shopRoutes = read(path.join(__dirname, '..', 'routes', 'shop.js'));
const adminRoutes = read(path.join(__dirname, '..', 'routes', 'admin.js'));
const serverJs = read(path.join(__dirname, '..', 'server.js'));
const settingsEjs = read(path.join(__dirname, '..', 'views', 'admin', 'settings.ejs'));
const checkoutEjs = read(path.join(__dirname, '..', 'views', 'checkout.ejs'));
const cartEjs = read(path.join(__dirname, '..', 'views', 'cart.ejs'));
const productEjs = read(path.join(__dirname, '..', 'views', 'product.ejs'));
const footerEjs = read(path.join(__dirname, '..', 'views', 'partials', 'footer.ejs'));
const adminHeaderEjs = read(path.join(__dirname, '..', 'views', 'partials', 'admin-header.ejs'));

// A fully-configured gateway config (as if donal saved sandbox
// credentials) and an unconfigured one, for the lib checks.
const cfgOnMap = {
  payment_mode: 'both', gateway_provider: 'sslcommerz', gateway_enabled: '1',
  gateway_store_id: 'testbox', gateway_store_password: 'testpass', gateway_mode: 'sandbox',
};
const cfgOn = ssl.gatewayConfigFromSettings((k, fb) => (cfgOnMap[k] !== undefined ? cfgOnMap[k] : fb));
const cfgOff = ssl.gatewayConfigFromSettings((k, fb) => ({ gateway_provider: 'none' }[k] || fb));
const ORDER = { id: 42, total_amount: 1050, customer_name: 'Rohim Uddin', email: 'rohim@example.com', phone: '01814697896', address: 'House 12, Road 5, Dhanmondi, Dhaka' };
const URLS = { success: 'http://x/payment/success', fail: 'http://x/payment/fail', cancel: 'http://x/payment/cancel', ipn: 'http://x/payment/ipn' };

(async () => {
  // ================= E1 — lib/sslcommerz.js =================
  check('E1 lib: sandbox + live endpoints are the real SSLCommerz hosts (sandbox.sslcommerz.com / securepay.sslcommerz.com)',
    ssl.endpoints('sandbox').initUrl === 'https://sandbox.sslcommerz.com/gwprocess/v4/api.php'
    && ssl.endpoints('sandbox').validateUrl === 'https://sandbox.sslcommerz.com/validator/api/validationserverAPI.php'
    && ssl.endpoints('live').initUrl === 'https://securepay.sslcommerz.com/gwprocess/v4/api.php'
    && ssl.endpoints('live').validateUrl === 'https://securepay.sslcommerz.com/validator/api/validationserverAPI.php'
    && ssl.endpoints('weird').initUrl === ssl.endpoints('sandbox').initUrl);
  check('E1 lib: configured ONLY with provider sslcommerz + enabled + Store ID + Store Password (all four)',
    cfgOn.configured === true && ssl.isGatewayConfigured(cfgOn) === true
    && ssl.isGatewayConfigured(ssl.gatewayConfigFromSettings((k, fb) => ({ gateway_provider: 'sslcommerz', gateway_enabled: '1', gateway_store_id: 'testbox', gateway_store_password: '', gateway_mode: 'sandbox' }[k] || fb))) === false
    && ssl.isGatewayConfigured(ssl.gatewayConfigFromSettings((k, fb) => ({ gateway_provider: 'sslcommerz', gateway_enabled: '1', gateway_store_id: '', gateway_store_password: 'testpass', gateway_mode: 'sandbox' }[k] || fb))) === false
    && ssl.isGatewayConfigured(ssl.gatewayConfigFromSettings((k, fb) => ({ gateway_provider: 'sslcommerz', gateway_enabled: '0', gateway_store_id: 'testbox', gateway_store_password: 'testpass', gateway_mode: 'sandbox' }[k] || fb))) === false);
  check('E1 lib: other providers (shurjopay / bkash) stay unconfigured even with credentials saved (no flow built for them)',
    ssl.isGatewayConfigured(ssl.gatewayConfigFromSettings((k, fb) => ({ gateway_provider: 'shurjopay', gateway_enabled: '1', gateway_store_id: 'sp1', gateway_store_password: 'pw', gateway_mode: 'sandbox' }[k] || fb))) === false
    && ssl.isGatewayConfigured(ssl.gatewayConfigFromSettings((k, fb) => ({ gateway_provider: 'bkash', gateway_enabled: '1', gateway_store_id: 'bk1', gateway_store_password: 'pw', gateway_mode: 'sandbox' }[k] || fb))) === false
    && ssl.isGatewayConfigured(cfgOff) === false && ssl.isGatewayConfigured(null) === false);
  check('E1 lib: tran_id round-trips to its order (GOINCE-<id>-<ms>); a foreign tran_id parses to null',
    ssl.parseTranId(ssl.buildTranId(42)) === 42
    && /^GOINCE-42-\d+$/.test(ssl.buildTranId(42))
    && ssl.parseTranId('GOINCE-7-1234567890123') === 7
    && ssl.parseTranId('TRAN-42-123') === null && ssl.parseTranId('') === null && ssl.parseTranId(null) === null);
  check('E1 lib: init payload carries BDT + two-decimal total + tran_id + all four callback URLs + customer fields',
    (() => {
      const p = ssl.buildInitPayload(cfgOn, ORDER, URLS);
      return p.store_id === 'testbox' && p.store_passwd === 'testpass' && p.total_amount === '1050.00'
        && p.currency === 'BDT' && ssl.parseTranId(p.tran_id) === 42 && p.success_url === URLS.success && p.fail_url === URLS.fail
        && p.cancel_url === URLS.cancel && p.ipn_url === URLS.ipn && p.cus_name === 'Rohim Uddin'
        && p.cus_phone === '01814697896' && p.cus_country === 'Bangladesh' && p.shipping_method === 'NO';
    })());

  // initiatePayment with a stubbed fetch.
  const stubInitOk = async () => ({ json: async () => ({ status: 'SUCCESS', GatewayPageURL: 'https://sandbox.sslcommerz.com/gwprocess/pay.php?sessionkey=abc', sessionkey: 'abc' }) });
  const initOk = await ssl.initiatePayment(cfgOn, ORDER, URLS, stubInitOk);
  check('E1 lib: initiate SUCCESS returns the GatewayPageURL + tran_id for this order',
    initOk.ok === true && initOk.gatewayUrl.includes('sandbox.sslcommerz.com') && ssl.parseTranId(initOk.tran_id) === 42);
  const initFail = await ssl.initiatePayment(cfgOn, ORDER, URLS, async () => ({ json: async () => ({ status: 'FAILED', failedreason: 'Invalid store' }) }));
  check('E1 lib: initiate FAILED returns ok:false with the provider reason (caller must NOT redirect)',
    initFail.ok === false && /Invalid store/.test(initFail.error));
  const initOff = await ssl.initiatePayment(cfgOff, ORDER, URLS, stubInitOk);
  check('E1 lib: initiate with no gateway configured refuses without ever calling the provider',
    initOff.ok === false && /not configured/.test(initOff.error));
  const initDown = await ssl.initiatePayment(cfgOn, ORDER, URLS, async () => { throw new Error('boom'); });
  check('E1 lib: initiate when SSLCommerz is unreachable returns ok:false (no crash, no redirect)',
    initDown.ok === false && /Could not reach SSLCommerz/.test(initDown.error));

  // validatePayment with a stubbed fetch.
  const validRes = await ssl.validatePayment(cfgOn, 'VAL123', async (url) => {
    check('E1 lib: validation call goes to the validator endpoint with val_id + store id (password as a query param, never logged)',
      url.startsWith('https://sandbox.sslcommerz.com/validator/api/validationserverAPI.php?val_id=VAL123&store_id=testbox&store_passwd=testpass'));
    return { json: async () => ({ status: 'VALID', val_id: 'VAL123', tran_id: ssl.buildTranId(42), amount: '1050.00', currency: 'BDT' }) };
  });
  check('E1 lib: validation VALID returns valid:true with tran_id + amount + currency',
    validRes.ok === true && validRes.valid === true && validRes.status === 'VALID' && validRes.amount === 1050 && validRes.currency === 'BDT');
  const invalidRes = await ssl.validatePayment(cfgOn, 'VAL999', async () => ({ json: async () => ({ status: 'INVALID', tran_id: 'GOINCE-42-1', amount: '1050.00', currency: 'BDT' }) }));
  check('E1 lib: validation INVALID returns valid:false (never treated as paid)',
    invalidRes.ok === true && invalidRes.valid === false);
  const noValRes = await ssl.validatePayment(cfgOn, '', async () => { throw new Error('should not be called'); });
  check('E1 lib: validation with no val_id refuses without calling the provider',
    noValRes.ok === false && noValRes.valid === false);

  // The guard: validationMatchesOrder.
  const goodValidation = { ok: true, valid: true, status: 'VALID', tran_id: ssl.buildTranId(42), amount: 1050, currency: 'BDT' };
  check('E1 guard: VALID + matching tran_id + exact amount + BDT passes',
    ssl.validationMatchesOrder(goodValidation, ORDER).ok === true);
  check('E1 guard: amount mismatch (even ৳1) fails — a cheaper payment can never pay a dearer order',
    ssl.validationMatchesOrder(Object.assign({}, goodValidation, { amount: 1049 }), ORDER).ok === false
    && ssl.validationMatchesOrder(Object.assign({}, goodValidation, { amount: 1050.01 }), ORDER).ok === false);
  check('E1 guard: tran_id for ANOTHER order fails — a callback can only ever match the order it was started for',
    ssl.validationMatchesOrder(Object.assign({}, goodValidation, { tran_id: ssl.buildTranId(43) }), ORDER).ok === false);
  check('E1 guard: non-BDT currency fails; INVALID status fails; missing validation fails',
    ssl.validationMatchesOrder(Object.assign({}, goodValidation, { currency: 'USD' }), ORDER).ok === false
    && ssl.validationMatchesOrder(Object.assign({}, goodValidation, { valid: false }), ORDER).ok === false
    && ssl.validationMatchesOrder(null, ORDER).ok === false);

  // markOrderPaidIfValidated on a fake DB.
  const paidDb = fakeDb([
    ['INSERT INTO gateway_payment_attempts', async () => ({})],
    ['UPDATE orders SET payment_status', async () => ({})],
  ]);
  const paidResult = await ssl.markOrderPaidIfValidated(paidDb, ORDER, Object.assign({}, goodValidation, { raw: { val_id: 'VAL123' } }));
  check('E1 guard: VALID match records the attempt AND flips payment_status to Paid (with the gateway references)',
    paidResult.ok === true && paidResult.paid === true
    && paidDb.calls.some((c) => c.sql.includes('INSERT INTO gateway_payment_attempts'))
    && paidDb.calls.some((c) => c.sql.includes("UPDATE orders SET payment_status = 'Paid'") && c.params[0] === goodValidation.tran_id && c.params[1] === 'VAL123'));
  const unpaidDb = fakeDb([
    ['INSERT INTO gateway_payment_attempts', async () => ({})],
    ['UPDATE orders SET payment_status', async () => { throw new Error('UPDATE must not run on a failed validation'); }],
  ]);
  const unpaidResult = await ssl.markOrderPaidIfValidated(unpaidDb, ORDER, Object.assign({}, goodValidation, { valid: false, status: 'INVALID' }));
  check('E1 guard: INVALID validation records the attempt but NEVER runs the Paid update — the order stays Unpaid',
    unpaidResult.ok === false && unpaidResult.paid === false
    && unpaidDb.calls.some((c) => c.sql.includes('INSERT INTO gateway_payment_attempts'))
    && !unpaidDb.calls.some((c) => c.sql.includes('UPDATE orders')));
  check('E1 lib: the Paid update is guarded against re-marking (payment_status != \'Paid\' in the SQL)',
    /payment_status != 'Paid'/.test(read(path.join(__dirname, '..', 'lib', 'sslcommerz.js'))));

  // getGatewaySettings reads the settings table.
  const settingsDb = fakeDb([
    ['FROM settings', async () => [
      { setting_key: 'gateway_provider', setting_value: 'sslcommerz' },
      { setting_key: 'gateway_enabled', setting_value: '1' },
      { setting_key: 'gateway_store_id', setting_value: 'testbox' },
      { setting_key: 'gateway_store_password', setting_value: 'testpass' },
      { setting_key: 'gateway_mode', setting_value: 'sandbox' },
      { setting_key: 'payment_mode', setting_value: 'both' },
    ]],
  ]);
  const liveCfg = await ssl.getGatewaySettings(settingsDb);
  check('E1 lib: getGatewaySettings reads the settings table and reports configured (incl. the password)',
    liveCfg.configured === true && liveCfg.storeId === 'testbox' && liveCfg.hasStorePassword === true && liveCfg.mode_label === 'sandbox');

  // ================= E1 — routes (source) =================
  check('E1 route: POST /checkout saves the gateway order then initiates (no order-success render on that path)',
    /if \(selectedMethod === gatewayMethodName\) \{/.test(shopRoutes)
    && /ssl\.initiatePayment\(gwConfig/.test(shopRoutes)
    && /return res\.redirect\(init\.gatewayUrl\);/.test(shopRoutes));
  check('E1 route: init failure redirects to the pending page (never a false success page)',
    /return res\.redirect\('\/payment\/pending\/' \+ orderId \+ '\?err=init'\);/.test(shopRoutes));
  check('E1 route: success / fail / cancel / IPN + pending + retry routes all exist',
    /router\.get\('\/payment\/success', handleGatewaySuccess\);/.test(shopRoutes)
    && /router\.post\('\/payment\/success', handleGatewaySuccess\);/.test(shopRoutes)
    && /router\.get\('\/payment\/fail'/.test(shopRoutes) && /router\.post\('\/payment\/fail'/.test(shopRoutes)
    && /router\.get\('\/payment\/cancel'/.test(shopRoutes) && /router\.post\('\/payment\/cancel'/.test(shopRoutes)
    && /router\.post\('\/payment\/ipn'/.test(shopRoutes)
    && /router\.get\('\/payment\/pending\/:id'/.test(shopRoutes)
    && /router\.post\('\/payment\/gateway\/retry\/:id'/.test(shopRoutes));
  check('E1 route: success handler validates BEFORE anything is marked paid; IPN always answers 200',
    /const validation = await ssl\.validatePayment\(config, valId\);/.test(shopRoutes)
    && /const result = await ssl\.markOrderPaidIfValidated\(db, order, validation\);/.test(shopRoutes)
    && /return res\.status\(200\)\.send\('OK'\);/.test(shopRoutes));
  check('E1 route: retry is owner-only (logged-in owner or this session\'s last order) and only for unpaid gateway orders',
    /const ownsOrder = \(req\.session\.userId && order\.user_id === req\.session\.userId\) \|\| req\.session\.lastOrderId === Number\(order\.id\);/.test(shopRoutes)
    && /order\.payment_status === 'Paid' \|\| order\.payment_method !== 'Online Payment \(Gateway\)'/.test(shopRoutes));
  check('E1 route: getGatewayConfig now requires the Store Password too (ID alone never shows the gateway option)',
    /gateway_store_password/.test(shopRoutes)
    && /provider === 'sslcommerz' && enabled && storeId\.length > 0 && String\(storePassword/.test(shopRoutes));
  check('E1 route: CSRF is exempt ONLY for the four gateway callback paths (SSLCommerz posts from its own servers)',
    /GATEWAY_CALLBACK_PATHS/.test(serverJs)
    && ['/payment/success', '/payment/fail', '/payment/cancel', '/payment/ipn'].every((p) => serverJs.includes("'" + p + "'"))
    && /if \(GATEWAY_CALLBACK_PATHS\.has\(req\.path\)\) return next\(\);/.test(serverJs));
  check('E1 guard: COD + manual methods untouched — Transaction ID still required for manual, never for COD or gateway',
    /const needsTransactionId = selectedMethod !== 'Cash on Delivery' && selectedMethod !== gatewayMethodName;/.test(shopRoutes));
  check('E1 guard: no price change, no WELCOME10, 24h return copy untouched in this batch',
    !/UPDATE products SET price/.test(shopRoutes)
    && !/WELCOME10/.test(read(path.join(__dirname, '..', 'views', 'index.ejs')))
    && (checkoutEjs.match(/24h return/g) || []).length >= 2);
  check('E1 db: boot creates gateway_payment_attempts + backups tables and the orders gateway_* columns',
    serverJs.includes('gateway_payment_attempts') && serverJs.includes('CREATE TABLE IF NOT EXISTS backups')
    && serverJs.includes('gateway_tran_id') && serverJs.includes('gateway_val_id') && serverJs.includes('gateway_status'));
  check('E1 db: sql/payments_messaging.sql documents the new tables + columns + settings keys',
    (() => {
      const s = read(path.join(__dirname, '..', 'sql', 'payments_messaging.sql'));
      return s.includes('gateway_payment_attempts') && s.includes('CREATE TABLE IF NOT EXISTS backups')
        && s.includes('gateway_tran_id') && s.includes('sms_provider') && s.includes('backup_retention_days');
    })());

  // ================= E6 — express checkout =================
  check('E6 route: /cart/add with express_gateway adds the item then redirects to /checkout?pay=gateway',
    /if \(req\.body\.express_gateway === '1'\) return res\.redirect\('\/checkout\?pay=gateway'\);/.test(shopRoutes));
  check('E6 route: GET /checkout passes expressGateway (?pay=gateway) to the view',
    /expressGateway: req\.query\.pay === 'gateway'/.test(shopRoutes));
  check('E6 route: cart + product renders pass gateway so the button can hide when unconfigured',
    /res\.render\('cart', \{/.test(shopRoutes) && /gateway: await getGatewayConfig\(\),/.test(shopRoutes));
  check('E6 view: cart express button links to /checkout?pay=gateway and only renders when gateway.configured',
    cartEjs.includes('href="/checkout?pay=gateway"') && cartEjs.includes('Pay with SSLCommerz')
    && /typeof gateway !== 'undefined' && gateway && gateway\.configured/.test(cartEjs));
  check('E6 view: product express button is a submit named express_gateway inside the add-to-cart form, gated on gateway.configured',
    productEjs.includes('name="express_gateway"') && productEjs.includes('Pay with SSLCommerz')
    && /typeof gateway !== 'undefined' && gateway && gateway\.configured/.test(productEjs));
  check('E6 view: footer AJAX interceptor lets the express button through like Buy Now (plain POST, no AJAX add)',
    /submitter\.name === 'buy_now' \|\| submitter\.name === 'express_gateway'/.test(footerEjs));
  check('E6 view: checkout preselects the gateway option when expressGateway and shows the gateway box on load',
    checkoutEjs.includes('typeof expressGateway') && checkoutEjs.includes("expressGateway) ? 'selected' : ''")
    && /if \(document\.getElementById\('payment_method'\)\) toggleTxnField\(\);/.test(checkoutEjs));
  check('E6 view: gateway box tells the truth — order stays Unpaid until SSLCommerz verifies it',
    checkoutEjs.includes('Order-ta') && checkoutEjs.includes('Unpaid') && checkoutEjs.includes('verify na kore'));

  // EJS renders: cart with / without a configured gateway.
  const cartLocals = {
    cart: [{ id: 3, name: 'BINBOND 2521 Watch', price: 990, quantity: 1, image: 'watch.jpg' }],
    subtotal: 990, coupon: null, discount: 0, total: 990,
    deliveryCharges: { inside_dhaka: 60, outside_dhaka: 120 },
    relatedProducts: [], estimatedDelivery: 'Mon 30 Nov - Fri 4 Dec', wishlistProductIds: [],
  };
  try {
    const htmlOn = await renderFile(path.join(__dirname, '..', 'views', 'cart.ejs'),
      Object.assign({}, shopBaseLocals, cartLocals, { gateway: { configured: true, provider: 'sslcommerz', mode: 'both' } }));
    check('render: cart WITH a configured gateway shows the Pay with SSLCommerz express button',
      htmlOn.includes('Pay with SSLCommerz') && htmlOn.includes('/checkout?pay=gateway'));
  } catch (e) { check('render: cart with gateway renders', false, e.message); }
  try {
    const htmlOff = await renderFile(path.join(__dirname, '..', 'views', 'cart.ejs'),
      Object.assign({}, shopBaseLocals, cartLocals, { gateway: { configured: false } }));
    check('render: cart WITHOUT a configured gateway hides the express button (Proceed to Checkout still there)',
      !htmlOff.includes('Pay with SSLCommerz') && htmlOff.includes('Proceed to Checkout'));
  } catch (e) { check('render: cart without gateway renders', false, e.message); }
  try {
    const htmlNoLocal = await renderFile(path.join(__dirname, '..', 'views', 'cart.ejs'),
      Object.assign({}, shopBaseLocals, cartLocals));
    check('render: cart with NO gateway local at all still renders (typeof guard — old callers safe)',
      htmlNoLocal.includes('Proceed to Checkout') && !htmlNoLocal.includes('Pay with SSLCommerz'));
  } catch (e) { check('render: cart with no gateway local renders', false, e.message); }

  // EJS render: checkout with expressGateway pre-selects the gateway option.
  try {
    const html = await renderFile(path.join(__dirname, '..', 'views', 'checkout.ejs'),
      Object.assign({}, shopBaseLocals, {
        cart: [{ id: 3, name: 'BINBOND 2521 Watch', price: 990, quantity: 1 }],
        subtotal: 990, deliveryCharge: 60, total: 1050, coupon: null, discount: 0,
        deliveryZones: [{ id: 1, name: 'Inside Dhaka', slug: 'inside_dhaka', charge: 60, delivery_time: '1–2 days' }],
        paymentMethods: [{ method_name: 'bKash', number: '01814697896', payment_type: 'send_money', instructions: '' }],
        gateway: { enabled: true, mode: 'both', configured: true, provider: 'sslcommerz' },
        expressGateway: true, allFreeShipping: false, codAllowed: true, error: null,
        bdDistricts: { districts: DISTRICTS, areas: AREAS },
        form: { customer_name: '', email: '', phone: '', district: '', area: '', address_line: '' },
        prefill: null, isLoggedIn: false,
        pointsBalance: 0, pointsValue: 0, pointsDiscount: 0, loyaltyEnabled: false,
        pointsRedeemPoints: 100, pointsRedeemTaka: 10, pointsMaxRedeem: 500,
      }));
    check('render: express checkout pre-selects Online Payment (Gateway) on the checkout page',
      /<option value="Online Payment \(Gateway\)" data-gateway="1" selected>/.test(html)
      && html.includes('Order-ta') && html.includes('Unpaid'));
  } catch (e) { check('render: express checkout renders', false, e.message); }

  // EJS render: payment-pending page (paid + unpaid).
  try {
    const unpaid = await renderFile(path.join(__dirname, '..', 'views', 'payment-pending.ejs'),
      Object.assign({}, shopBaseLocals, { order: { id: 42, total_amount: 1050, payment_status: 'Unpaid', payment_method: 'Online Payment (Gateway)' }, message: 'The online payment failed.', error: null }));
    check('render: pending page for an UNPAID gateway order shows the retry button + total, never a success claim',
      unpaid.includes('Payment Pending') && unpaid.includes('Try Payment Again') && unpaid.includes('৳1,050')
      && !unpaid.includes('Payment Received'));
    const paid = await renderFile(path.join(__dirname, '..', 'views', 'payment-pending.ejs'),
      Object.assign({}, shopBaseLocals, { order: { id: 42, total_amount: 1050, payment_status: 'Paid', payment_method: 'Online Payment (Gateway)' }, message: null, error: null }));
    check('render: pending page for a PAID order shows Payment Received and no retry button',
      paid.includes('Payment Received') && !paid.includes('Try Payment Again'));
  } catch (e) { check('render: payment-pending renders', false, e.message); }

  // ================= I2 — lib/sms.js =================
  const smsCfgOn = sms.smsConfigFromSettings((k, fb) => ({
    sms_provider: 'generic', sms_enabled: '1', sms_api_key: 'key123',
    sms_sender_id: 'GOINCE', sms_endpoint: 'https://sms.example.com/send', sms_order_status_enabled: '1',
  }[k] || fb));
  check('I2 lib: configured ONLY with generic provider + enabled + API key + endpoint',
    smsCfgOn.configured === true && sms.isConfigured(smsCfgOn) === true
    && sms.isConfigured(sms.smsConfigFromSettings((k, fb) => ({ sms_provider: 'generic', sms_enabled: '1', sms_api_key: '', sms_endpoint: 'https://sms.example.com/send' }[k] || fb))) === false
    && sms.isConfigured(sms.smsConfigFromSettings((k, fb) => ({ sms_provider: 'generic', sms_enabled: '1', sms_api_key: 'key123', sms_endpoint: '' }[k] || fb))) === false
    && sms.isConfigured(sms.smsConfigFromSettings((k, fb) => ({ sms_provider: 'generic', sms_enabled: '0', sms_api_key: 'key123', sms_endpoint: 'https://sms.example.com/send' }[k] || fb))) === false);
  check('I2 lib: no config at all is NOT configured (the old stub behaviour — never claim a send)',
    sms.isConfigured() === false && sms.isConfigured(null) === false
    && sms.isConfigured(sms.smsConfigFromSettings((k, fb) => fb)) === false);
  check('I2 lib: Bangladeshi phone validation (01XXXXXXXXX, 11 digits) — bad numbers never spend SMS money',
    sms.isValidSmsPhone('01814697896') === true && sms.isValidSmsPhone('01712345678') === true
    && sms.isValidSmsPhone('01234') === false && sms.isValidSmsPhone('0181469789') === false
    && sms.isValidSmsPhone('') === false && sms.isValidSmsPhone('01814 697896') === true);
  const noSms = await sms.sendSms('01814697896', 'hello');
  check('I2 lib: sendSms with no provider configured returns the same not-configured message as the old stub',
    noSms.ok === false && noSms.error === sms.SMS_NOT_CONFIGURED);
  const badPhone = await sms.sendSms('01234', 'hello', smsCfgOn);
  check('I2 lib: sendSms with an invalid phone refuses before any provider call',
    badPhone.ok === false && /valid Bangladeshi mobile/.test(badPhone.error));
  let lastReq = null;
  const stubSmsOk = async (url, opts) => {
    lastReq = { url, opts, body: JSON.parse(opts.body) };
    return { ok: true, status: 200, json: async () => ({ status: 'success', id: 'msg-1' }) };
  };
  const sent = await sms.sendSms('01814697896', 'Goince: your order #42 is Confirmed.', smsCfgOn, stubSmsOk);
  check('I2 lib: configured send POSTs JSON to the saved endpoint with the Bearer key + to/message/sender_id',
    sent.ok === true && lastReq.url === 'https://sms.example.com/send'
    && lastReq.opts.headers.Authorization === 'Bearer key123'
    && lastReq.opts.headers['Content-Type'] === 'application/json'
    && lastReq.body.to === '01814697896' && lastReq.body.message === 'Goince: your order #42 is Confirmed.'
    && lastReq.body.sender_id === 'GOINCE');
  const sent500 = await sms.sendSms('01814697896', 'hi', smsCfgOn, async () => ({ ok: false, status: 500, json: async () => ({ message: 'down' }) }));
  check('I2 lib: provider HTTP 500 returns ok:false (never reported as sent)',
    sent500.ok === false && /500/.test(sent500.error));
  const sentErrBody = await sms.sendSms('01814697896', 'hi', smsCfgOn, async () => ({ ok: true, status: 200, json: async () => ({ status: 'error', error: 'bad key' }) }));
  check('I2 lib: provider 200 with an error field is still a failure (never report a send that did not happen)',
    sentErrBody.ok === false && /bad key/.test(sentErrBody.error));
  const sentDown = await sms.sendSms('01814697896', 'hi', smsCfgOn, async () => { throw new Error('dns fail'); });
  check('I2 lib: unreachable provider returns ok:false with the reason',
    sentDown.ok === false && /Could not reach the SMS provider/.test(sentDown.error));

  // Order-status SMS path.
  const statusSent = await sms.sendOrderStatusSms({ id: 42, phone: '01814697896' }, 'Confirmed', smsCfgOn, stubSmsOk);
  check('I2 lib: order-status SMS sends "Goince: your order #42 is Confirmed." when configured + toggle on',
    statusSent.ok === true && statusSent.skipped === false && lastReq.body.message === 'Goince: your order #42 is Confirmed.');
  const statusToggleOff = await sms.sendOrderStatusSms({ id: 42, phone: '01814697896' }, 'Confirmed',
    sms.smsConfigFromSettings((k, fb) => ({ sms_provider: 'generic', sms_enabled: '1', sms_api_key: 'k', sms_endpoint: 'https://sms.example.com/send', sms_order_status_enabled: '0' }[k] || fb)), stubSmsOk);
  check('I2 lib: order-status SMS is SKIPPED (not an error) when the admin toggle is off',
    statusToggleOff.ok === false && statusToggleOff.skipped === true);
  const statusNoCfg = await sms.sendOrderStatusSms({ id: 42, phone: '01814697896' }, 'Confirmed', null, stubSmsOk);
  check('I2 lib: order-status SMS is SKIPPED when no provider is configured',
    statusNoCfg.ok === false && statusNoCfg.skipped === true && /not connected/.test(statusNoCfg.error));

  // getSmsSettings reads the settings table.
  const smsDb = fakeDb([
    ['FROM settings', async () => [
      { setting_key: 'sms_provider', setting_value: 'generic' },
      { setting_key: 'sms_enabled', setting_value: '1' },
      { setting_key: 'sms_api_key', setting_value: 'key123' },
      { setting_key: 'sms_endpoint', setting_value: 'https://sms.example.com/send' },
      { setting_key: 'sms_order_status_enabled', setting_value: '1' },
    ]],
  ]);
  const liveSms = await sms.getSmsSettings(smsDb);
  check('I2 lib: getSmsSettings reads the settings table and reports configured',
    liveSms.configured === true && liveSms.apiKeySet === true && liveSms.orderStatusEnabled === true);

  // ================= I2 — routes + settings =================
  check('I2 route: admin order-status change sends the SMS (best-effort, inside the guarded hook)',
    /await sendOrderStatusSms\(order, status, db\);/.test(adminRoutes));
  check('I2 route: the order-page Send SMS button passes the live DB so real settings are read',
    /const result = await sendSms\(order\.phone, message, db\);/.test(adminRoutes));
  check('I2 settings: GET loads the sms_* keys and passes an sms object (API key never passed, only apiKeySet)',
    adminRoutes.includes("'sms_provider', 'sms_enabled', 'sms_api_key', 'sms_sender_id', 'sms_endpoint', 'sms_order_status_enabled'")
    && /sms: \{/.test(adminRoutes) && /apiKeySet: !!get\('sms_api_key', ''\)/.test(adminRoutes)
    && !/sms_api_key: get\('sms_api_key'/.test(adminRoutes));
  check('I2 settings: POST saves the sms_* keys; a blank API key keeps the saved one (never echoed)',
    adminRoutes.includes("['sms_provider', ['none', 'generic'].includes(req.body.sms_provider)")
    && /if \(\(req\.body\.sms_api_key \|\| ''\)\.trim\(\)\) settingsToSave\.push\(\['sms_api_key'/.test(adminRoutes));
  check('I2 view: Settings has the SMS Notifications section (provider, endpoint, API key, sender ID, status toggle) with the not-configured warning',
    settingsEjs.includes('SMS Notifications') && settingsEjs.includes('name="sms_provider"')
    && settingsEjs.includes('name="sms_endpoint"') && settingsEjs.includes('name="sms_api_key"')
    && settingsEjs.includes('name="sms_sender_id"') && settingsEjs.includes('name="sms_order_status_enabled"')
    && settingsEjs.includes('No SMS is sent') && settingsEjs.includes('until a provider and API key are saved here'));
  check('I2 view: gateway hint now tells the truth (only SSLCommerz has a flow; order stays Unpaid until SSLCommerz confirms it)',
    settingsEjs.includes('Only SSLCommerz has a live payment flow')
    && settingsEjs.includes('stays <strong>Unpaid</strong> until SSLCommerz itself confirms the payment'));

  // Settings renders with OLD locals (no sms key — the typeof guard keeps old tests green).
  const settingsLocals = {
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
  };
  try {
    const htmlOld = await renderFile(path.join(__dirname, '..', 'views', 'admin', 'settings.ejs'),
      Object.assign({}, adminBaseLocals, settingsLocals));
    check('render: Settings with OLD locals (no sms / backup keys) still renders the SMS + Backups sections (typeof guards)',
      htmlOld.includes('SMS Notifications') && htmlOld.includes('name="sms_provider"')
      && htmlOld.includes('Database Backups') && htmlOld.includes('name="backup_retention_days"'));
  } catch (e) { check('render: Settings with old locals renders', false, e.message); }
  try {
    const htmlNew = await renderFile(path.join(__dirname, '..', 'views', 'admin', 'settings.ejs'),
      Object.assign({}, adminBaseLocals, settingsLocals, {
        sms: { provider: 'generic', enabled: '1', apiKeySet: true, senderId: 'GOINCE', endpoint: 'https://sms.example.com/send', orderStatusEnabled: '1' },
        backupRetentionDays: '14',
      }));
    check('render: Settings with SMS saved shows the provider selected + key-set note, never the key itself',
      htmlNew.includes('<option value="generic" selected>') && htmlNew.includes('one is already saved')
      && !htmlNew.includes('key123') && htmlNew.includes('value="https://sms.example.com/send"'));
  } catch (e) { check('render: Settings with sms locals renders', false, e.message); }

  // ================= I12 — lib/backups.js =================
  check('I12 lib: backup filename is goince-backup-YYYY-MM-DD-HHMMSS.sql (sortable, one per run)',
    backups.backupFileName(new Date(2026, 10, 28, 18, 30, 5)) === 'goince-backup-2026-11-28-183005.sql');
  check('I12 lib: only a plain backup filename is safe — traversal / absolute / wrong names are rejected',
    backups.isSafeBackupFileName('goince-backup-2026-11-28-183005.sql') === true
    && backups.isSafeBackupFileName('../server.js') === false
    && backups.isSafeBackupFileName('/etc/passwd') === false
    && backups.isSafeBackupFileName('goince-backup-2026-11-28-183005.sql/../../x') === false
    && backups.isSafeBackupFileName('backup.sql') === false && backups.isSafeBackupFileName('') === false);
  check('I12 lib: retention prunes only files older than the window (14 days keeps a 5-day file, drops a 20-day one)',
    (() => {
      const now = new Date(2026, 10, 28);
      const files = [
        { filename: 'goince-backup-2026-11-23-000000.sql', mtime: new Date(2026, 10, 23) },
        { filename: 'goince-backup-2026-11-08-000000.sql', mtime: new Date(2026, 10, 8) },
      ];
      const pruned = backups.filesToPrune(files, 14, now).map((f) => f.filename);
      return pruned.length === 1 && pruned[0].includes('2026-11-08');
    })());
  check('I12 lib: db config comes from the environment (never hardcoded credentials)',
    (() => {
      const c = backups.dbConfigFromEnv({ DB_HOST: 'h', DB_PORT: '3307', DB_USER: 'u', DB_PASSWORD: 'p', DB_NAME: 'd' });
      return c.host === 'h' && c.port === '3307' && c.user === 'u' && c.password === 'p' && c.database === 'd';
    })());

  // runBackup with a stubbed mysqldump (writes a fake dump to stdout).
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goince-backup-test-'));
  const appRoot = tmpDir;
  function stubDumpOk() {
    const child = new EventEmitter();
    child.stdout = Readable.from(['-- fake mysqldump\nCREATE TABLE x (id INT);\n']);
    child.stderr = new EventEmitter();
    setTimeout(() => child.emit('close', 0), 10);
    return child;
  }
  const runOk = await backups.runBackup({
    appRoot, dbConfig: { host: 'localhost', port: '3306', user: 'u', password: 'p', database: 'd' },
    triggeredBy: 'manual', retentionDays: 14, execFileImpl: stubDumpOk,
    now: new Date(2026, 10, 28, 12, 0, 0),
  });
  check('I12 lib: runBackup with a working mysqldump writes the .sql file and reports ok + filename',
    runOk.ok === true && runOk.filename === 'goince-backup-2026-11-28-120000.sql'
    && fs.existsSync(path.join(tmpDir, 'backups', runOk.filename))
    && fs.readFileSync(path.join(tmpDir, 'backups', runOk.filename), 'utf8').includes('fake mysqldump'));
  check('I12 lib: listBackupFiles lists the written file newest-first with its size',
    (() => {
      const list = backups.listBackupFiles(path.join(tmpDir, 'backups'));
      return list.length === 1 && list[0].filename === runOk.filename && list[0].size > 0;
    })());
  function stubDumpMissing() {
    const child = new EventEmitter();
    child.stdout = null;
    child.stderr = new EventEmitter();
    setTimeout(() => child.emit('error', new Error('spawn mysqldump ENOENT')), 10);
    return child;
  }
  const runMissing = await backups.runBackup({
    appRoot, dbConfig: { host: 'localhost', port: '3306', user: 'u', password: 'p', database: 'd' },
    triggeredBy: 'manual', execFileImpl: stubDumpMissing,
  });
  check('I12 lib: runBackup without mysqldump installed returns a clear ok:false (no crash, no half-file)',
    runMissing.ok === false && /mysqldump was not found/.test(runMissing.error)
    && !fs.existsSync(path.join(tmpDir, 'backups', runMissing.filename || 'nope')));
  const runNoDb = await backups.runBackup({
    appRoot, dbConfig: { host: 'localhost', port: '3306', user: '', password: '', database: '' },
    triggeredBy: 'manual', execFileImpl: stubDumpOk,
  });
  check('I12 lib: runBackup with missing DB details refuses before starting mysqldump',
    runNoDb.ok === false && /Database connection details are missing/.test(runNoDb.error));
  fs.rmSync(tmpDir, { recursive: true, force: true });

  // Schedule: returns handles, never throws, no backup spam at import.
  const sched = backups.scheduleDailyBackups({ appRoot: os.tmpdir(), retentionDays: 14 });
  check('I12 lib: scheduleDailyBackups returns a timer + runOnce without starting a backup immediately',
    sched && typeof sched.runOnce === 'function' && sched.timer && sched.bootTimer);
  clearInterval(sched.timer);
  clearTimeout(sched.bootTimer);

  // ================= I12 — routes + view + nav =================
  check('I12 route: backups list / run / download / delete routes exist, all admin-only + backups.manage',
    /router\.get\('\/backups', requireAdmin, requirePermission\('backups\.manage'\)/.test(adminRoutes)
    && /router\.post\('\/backups\/run', requireAdmin, requirePermission\('backups\.manage'\)/.test(adminRoutes)
    && /router\.get\('\/backups\/download\/:file', requireAdmin, requirePermission\('backups\.manage'\)/.test(adminRoutes)
    && /router\.post\('\/backups\/delete\/:file', requireAdmin, requirePermission\('backups\.manage'\)/.test(adminRoutes));
  check('I12 route: download validates the filename (no traversal) and 404s a missing file; run records the audit',
    /if \(!backups\.isSafeBackupFileName\(file\)\) return res\.status\(400\)/.test(adminRoutes)
    && /if \(!fs\.existsSync\(fullPath\)\) return res\.status\(404\)/.test(adminRoutes)
    && /await audit\(req, 'backup\.run'/.test(adminRoutes));
  check('I12 route: server.js schedules the daily backup (boot check + 24h timer via lib/backups)',
    /scheduleDailyBackups\(\{ appRoot: __dirname, db, retentionDays \}\)/.test(serverJs));
  check('I12 perm: backups.manage is registered in the System group (Owner auto-gains it, donal can grant it per role)',
    ALL_PERMISSIONS.includes('backups.manage')
    && PERMISSION_GROUPS.find((g) => g.group === 'System').items.some((i) => i.id === 'backups.manage'));
  check('I12 nav: Backups is in the admin System nav + breadcrumb (admin-only link, permission-guarded)',
    adminHeaderEjs.includes("['/admin/backups', 'System', 'Backups']")
    && adminHeaderEjs.includes("{ href: '/admin/backups', label: '💾 Backups', perm: 'backups.manage' }"));
  check('I12 settings: backup retention days is a setting (default 14, clamped 1–90)',
    adminRoutes.includes("['backup_retention_days', String(Math.min(90, Math.max(1, parseInt(req.body.backup_retention_days, 10) || 14)))]")
    && settingsEjs.includes('name="backup_retention_days"'));
  try {
    const html = await renderFile(path.join(__dirname, '..', 'views', 'admin', 'backups.ejs'),
      Object.assign({}, adminBaseLocals, {
        files: [{ filename: 'goince-backup-2026-11-28-120000.sql', size: 12345, mtime: new Date(2026, 10, 28, 12, 0, 0) }],
        rows: [{ created_at: new Date(2026, 10, 28, 12, 0, 0), filename: 'goince-backup-2026-11-28-120000.sql', triggered_by: 'daily', status: 'ok', error: null, size_bytes: 12345 }],
        backupMsg: null, backupErr: null,
      }));
    check('render: Backups page lists the file (size + date) with Download + Delete, and the run history',
      html.includes('goince-backup-2026-11-28-120000.sql') && html.includes('12.1 KB')
      && html.includes('/admin/backups/download/goince-backup-2026-11-28-120000.sql')
      && html.includes('Run Backup Now') && html.includes('daily'));
  } catch (e) { check('render: Backups page renders', false, e.message); }
  try {
    const htmlEmpty = await renderFile(path.join(__dirname, '..', 'views', 'admin', 'backups.ejs'),
      Object.assign({}, adminBaseLocals, { files: [], rows: [], backupMsg: null, backupErr: null }));
    check('render: Backups page with no backups yet says so instead of showing an empty table',
      htmlEmpty.includes('No backups yet'));
  } catch (e) { check('render: Backups empty page renders', false, e.message); }

  // ================= Guards (nothing else moved) =================
  check('guard: WhatsApp float + side-cart tab untouched (their markup is still in the footer)',
    footerEjs.includes('id="whatsapp-btn" class="whatsapp-float"')
    && footerEjs.includes('class="side-cart"')
    && footerEjs.includes('side-cart-badge'));
  check('guard: no photo file was touched by this batch',
    (() => {
      const { execSync } = require('child_process');
      const root = path.join(__dirname, '..');
      const img = /\.(png|jpe?g|webp|gif|svg|ico)$/i;
      // 1. Uncommitted changes (builder pre-commit workflow).
      let files = execSync('git status --porcelain', { cwd: root, encoding: 'utf8' })
        .split('\n').filter(Boolean).map((l) => l.slice(3).trim());
      if (files.length) return !files.some((f) => img.test(f));
      // 2. Committed batch: the batch commit itself (single commit) or
      // the merge commit's second-parent diff (on main after merge).
      const parents = execSync('git rev-list --parents -n 1 HEAD', { cwd: root, encoding: 'utf8' }).trim().split(' ');
      const range = parents.length > 2 ? `${parents[0]}^1..${parents[0]}` : 'HEAD~1..HEAD';
      files = execSync(`git diff --name-only ${range}`, { cwd: root, encoding: 'utf8' })
        .split('\n').filter(Boolean);
      if (files.length) return !files.some((f) => img.test(f));
      // 3. Nothing attributable to this batch — nothing to check.
      return true;
    })());

  console.log(`\nPayments & messaging checks: ${passes.length} passed, ${failures.length} failed.`);
  if (failures.length) { console.log('Failures: ' + failures.join(', ')); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
