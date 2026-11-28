// Checkout improvements — batch 5 (feat/checkout, PR #86).
//
//   E2  One-page checkout: contact + address + delivery + payment +
//       review on ONE scrollable page, in a SINGLE form (was: the
//       same page showed contact + payment only, with no review
//       section and the steps pills implying a multi-step flow).
//       Guest checkout + COD + manual bKash/Nagad/Rocket (with
//       Transaction ID) work exactly as before.
//   E3  Checkout pre-fill for logged-in customers: name / phone /
//       address from /account/profile (users table), still editable.
//   E4  Inline form validation: each field shows ✓ / error as the
//       customer types; Place Order stays disabled until valid.
//       The PR #81 double-submit lock is untouched.
//   E5  District → area address dropdown: 64 Bangladesh districts
//       (static lib/bd-districts.js) + a dependent area/thana
//       dropdown; a free-text house/road/landmark line stays.
//       The stored address is still ONE line in orders.address.
//   E9  Account creation after purchase: guest-only "Save your
//       details for next time" on the thank-you page (password +
//       one click), from the order's name/phone/email. Never
//       forced before payment.
//   E10 Post-purchase upsell on the thank-you page: related
//       products with one-click add via the PR #80 AJAX flow.
//
//   PR #87 Review delivery line follows the zone (section 11):
//       updateTotal refreshes review-delivery-display with the
//       same charge as the summary line; all-free carts stay
//       FREE 🚚 (৳0) in both lines.
//
// No live MySQL needed: source checks + direct EJS renders +
// the REAL shop routes on a stubbed DB (express, like
// test-cart-buying.js) + the REAL public/js/checkout.js in a
// stubbed DOM (vm sandbox).
//
// Run:  node scripts/test-checkout.js
// Exit code 0 = all checks passed.
'use strict';

const fs = require('fs');
const path = require('path');
const util = require('util');
const ejs = require('ejs');
const vm = require('vm');
const http = require('http');
const express = require('express');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'style.css'), 'utf8');
const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
const shopRoutes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'shop.js'), 'utf8');
const authRoutes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'auth.js'), 'utf8');
const checkoutEjs = fs.readFileSync(path.join(__dirname, '..', 'views', 'checkout.ejs'), 'utf8');
const successEjs = fs.readFileSync(path.join(__dirname, '..', 'views', 'order-success.ejs'), 'utf8');
const checkoutJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'checkout.js'), 'utf8');
const indexEjs = fs.readFileSync(path.join(__dirname, '..', 'views', 'index.ejs'), 'utf8');
const renderFile = util.promisify(ejs.renderFile);
const checkoutPath = path.join(__dirname, '..', 'views', 'checkout.ejs');
const successPath = path.join(__dirname, '..', 'views', 'order-success.ejs');

const { DISTRICTS, AREAS, areasFor } = require('../lib/bd-districts');
const co = require('../lib/checkout');

const failures = [];
const passes = [];
function check(name, ok, detail) {
  if (ok) { passes.push(name); console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

const baseLocals = {
  siteName: 'Goince', siteSettings: {}, shopPhone: '+8801814697896', paymentMethods: [],
  assetUrl: (p) => p, userName: null, userPhotoUrl: null, cartCount: 0,
  menuCategories: [], menuById: {}, search: '',
  miniCart: [], miniCartSubtotal: 0, csrfToken: 'tok123',
  siteLogoAbs: '', siteFaviconAbs: '', siteOgImageAbs: '', siteUrl: 'http://127.0.0.1',
};
const checkoutLocals = {
  cart: [{ id: 3, name: 'BINBOND 2521 Watch', price: 990, quantity: 1 }],
  subtotal: 990, deliveryCharge: 60, total: 1050, coupon: null, discount: 0,
  deliveryZones: [
    { id: 1, name: 'Inside Dhaka', slug: 'inside_dhaka', charge: 60, delivery_time: '1–2 days' },
    { id: 2, name: 'Outside Dhaka', slug: 'outside_dhaka', charge: 120, delivery_time: '3–5 days' },
  ],
  paymentMethods: [
    { method_name: 'bKash', number: '01814697896', payment_type: 'send_money', instructions: '' },
    { method_name: 'Nagad', number: '01814697896', payment_type: 'send_money', instructions: '' },
    { method_name: 'Rocket', number: '01814697896', payment_type: 'send_money', instructions: '' },
  ],
  gateway: { enabled: false, mode: 'manual', configured: false },
  allFreeShipping: false, codAllowed: true, error: null,
  bdDistricts: { districts: DISTRICTS, areas: AREAS },
};

(async () => {
  // ---------- 1. E5 — district data: all 64 districts, areas per district ----------
  check('E5 lib: exactly 64 Bangladesh districts (incl. Chapainawabganj, Chattogram, Cox\'s Bazar)',
    DISTRICTS.length === 64 && DISTRICTS.includes('Chapainawabganj')
    && DISTRICTS.includes('Chattogram') && DISTRICTS.includes("Cox's Bazar") && DISTRICTS.includes('Dhaka'));
  check('E5 lib: every district has at least 3 areas, Dhaka has 20 incl. Dhanmondi/Gulshan/Uttara/Mirpur',
    DISTRICTS.every((d) => (AREAS[d] || []).length >= 3)
    && areasFor('Dhaka').length === 20 && areasFor('Dhaka').includes('Dhanmondi')
    && areasFor('Dhaka').includes('Gulshan') && areasFor('Dhaka').includes('Uttara'));
  check('E5 lib: areasFor returns [] for an unknown district (never crashes the picker)',
    areasFor('Nowhere').length === 0 && areasFor('').length === 0);

  // ---------- 2. lib/checkout.js — compose / parse / validate ----------
  check('E5 lib: composeAddress joins house-line + area + district into ONE stored line',
    co.composeAddress({ district: 'Dhaka', area: 'Dhanmondi', address_line: 'House 12, Road 5' }) === 'House 12, Road 5, Dhanmondi, Dhaka');
  check('E5 lib: composeAddress keeps the legacy free-text address when no district is given (old forms / no-JS)',
    co.composeAddress({ address: 'Dhaka' }) === 'Dhaka' && co.composeAddress({}) === '');
  check('E3 lib: parseStoredAddress splits a saved address back into district + area + house-line',
    JSON.stringify(co.parseStoredAddress('House 12, Road 5, Dhanmondi, Dhaka'))
    === JSON.stringify({ district: 'Dhaka', area: 'Dhanmondi', addressLine: 'House 12, Road 5' }));
  check('E3 lib: parseStoredAddress round-trips composeAddress (prefill shows what was stored)',
    (() => {
      const composed = co.composeAddress({ district: 'Chattogram', area: 'Agrabad', address_line: 'Flat 3B' });
      const p = co.parseStoredAddress(composed);
      return p.district === 'Chattogram' && p.area === 'Agrabad' && p.addressLine === 'Flat 3B';
    })());
  check('E4 lib: validateCheckoutFields accepts a complete valid form (incl. +880 phone)',
    co.validateCheckoutFields({ customer_name: 'Rohim', phone: '+8801814697896', district: 'Dhaka', area: 'Dhanmondi', address_line: 'H 12' }).ok === true);
  check('E4 lib: validateCheckoutFields rejects bad phone, bad email, missing name, missing house-line, unknown district',
    (() => {
      const r = co.validateCheckoutFields({ customer_name: '', phone: 'bad', email: 'nope@', district: 'Nowhere', area: '', address_line: '' });
      return !r.ok && r.errors.customer_name && r.errors.phone && r.errors.email && r.errors.district && r.errors.address_line;
    })());
  check('E4 lib: validateCheckoutFields does NOT require email (guest checkout without email still valid)',
    co.validateCheckoutFields({ customer_name: 'Rohim', phone: '01814697896', district: 'Sylhet', area: 'Sylhet Sadar', address_line: 'H 1' }).ok === true);

  // ---------- 3. Routes — source ----------
  check('E3 route: GET /checkout loads the profile row (name/email/phone/address) for a logged-in customer',
    /loadCheckoutPrefill/.test(shopRoutes)
    && /SELECT name, email, phone, address FROM users WHERE id = \?/.test(shopRoutes));
  check('E3 route: pre-fill failure never blocks checkout (try/catch returns an empty form)',
    /catch \(e\) \{ return \{ prefill: null, form: Object\.assign\(\{\}, EMPTY_CHECKOUT_FORM\) \}; \}/.test(shopRoutes));
  check('E2 route: GET /checkout renders with prefill + form + bdDistricts locals',
    /prefill, form, bdDistricts: \{ districts: DISTRICTS, areas: AREAS \}, isLoggedIn/.test(shopRoutes));
  check('E5 route: POST /checkout composes the address from district/area/line (not the raw textarea)',
    /const fullAddress = composeAddress\(req\.body\);/.test(shopRoutes)
    && /fullAddress, payment_method/.test(shopRoutes));
  check('E5 route: POST error re-render keeps the typed district/area/line (no re-typing from scratch)',
    /district: district \|\| '', area: area \|\| '', address_line: address_line \|\| ''/.test(shopRoutes));
  check('E9 route: POST /checkout/create-account exists, guarded by the session lastOrderId',
    /router\.post\('\/checkout\/create-account'/.test(shopRoutes)
    && /req\.session\.lastOrderId !== orderId/.test(shopRoutes));
  check('E9 route: account is created from the ORDER row (name/email/phone/address) with a bcrypt hash, order linked',
    /INSERT INTO users \(name, email, password, phone, address\) VALUES/.test(shopRoutes)
    && /UPDATE orders SET user_id = \? WHERE id = \?/.test(shopRoutes)
    && /bcrypt\.hash\(password, 10\)/.test(shopRoutes));
  check('E9 route: email already taken / order already owned / short password are rejected with a re-render, not a crash',
    /An account with this email already exists/.test(shopRoutes)
    && /This order already belongs to an account/.test(shopRoutes)
    && /Password must be at least 6 characters/.test(shopRoutes));
  check('E9 route: success logs the customer in and lands on /account/profile?saved=account',
    /res\.redirect\('\/account\/profile\?saved=account'\)/.test(shopRoutes));
  check('E9 auth: profile shows an "Account created" message for saved=account',
    /req\.query\.saved === 'account' \? 'Account created — your details are saved for next time\.'/.test(authRoutes));
  check('E10 route: getUpsellProducts picks same-category in-stock products the customer did NOT just buy (max 4)',
    /async function getUpsellProducts\(orderedIds\)/.test(shopRoutes)
    && /p\.id NOT IN/.test(shopRoutes) && /p\.stock > 0/.test(shopRoutes)
    && /return rows\.slice\(0, 4\);/.test(shopRoutes));
  check('E10 route: upsell marks variant/option products (hasOptions) so they get "Choose Option →" instead of Add to Cart',
    /r\.hasOptions = withChoices\.has\(r\.id\)/.test(shopRoutes));
  check('E10 route: order-success render passes upsell + guestCheckout + zone charges for the badge',
    /upsell,\s*\n\s*guestCheckout: !userId, accountError: null,/.test(shopRoutes)
    && /deliveryInside: deliveryCharges\.inside_dhaka, deliveryOutside: deliveryCharges\.outside_dhaka,/.test(shopRoutes));
  check('E2 route: POST /checkout still stores lastOrderId in the session (E9 gate)',
    /req\.session\.lastOrderId = orderId;/.test(shopRoutes));
  // feat/admin-ops I8: the delivery-charge line is now weight-aware
  // (a matching weight band replaces the zone charge); the
  // allFreeShipping ? 0 rule itself is unchanged.
  check('guard: free-delivery rule untouched — ৳0 only when EVERY cart item is free_shipping, else the zone charge (or a matching weight band)',
    /const deliveryCharge = flags\.allFreeShipping \? 0 : ops\.weightDeliveryCharge\(cartWeight, weightBands, \(zone \? zone\.charge/.test(shopRoutes)
    && /allFreeShipping: rows\.length > 0 && rows\.every\(r => r\.free_shipping\)/.test(shopRoutes));
  // E1 (feat/payments-messaging, batch 9): the "no gateway" guard
  // is RETIRED — the real SSLCommerz flow now exists. The
  // replacement guard: a gateway order is saved Unpaid and only
  // the validated callback may mark it Paid; COD + manual
  // bKash/Nagad/Rocket (Transaction ID) are untouched, and the
  // gateway option still only renders when configured.
  check('E1 guard: gateway order redirects to SSLCommerz after the order is saved (no order-success render on that path)',
    /if \(selectedMethod === gatewayMethodName\) \{/.test(shopRoutes)
    && /ssl\.initiatePayment\(gwConfig/.test(shopRoutes)
    && /return res\.redirect\(init\.gatewayUrl\);/.test(shopRoutes));
  check('E1 guard: only the validated callback marks paid (markOrderPaidIfValidated) — success, fail, cancel and IPN routes all exist',
    /router\.get\('\/payment\/success', handleGatewaySuccess\);/.test(shopRoutes)
    && /router\.post\('\/payment\/ipn'/.test(shopRoutes)
    && /ssl\.markOrderPaidIfValidated\(db, order, validation\)/.test(shopRoutes)
    && /router\.get\('\/payment\/fail'/.test(shopRoutes)
    && /router\.get\('\/payment\/cancel'/.test(shopRoutes));
  check('E1 guard: COD + manual methods untouched — Transaction ID still required for manual, never for COD or gateway',
    /const needsTransactionId = selectedMethod !== 'Cash on Delivery' && selectedMethod !== gatewayMethodName;/.test(shopRoutes));
  check('guard: no price change in this batch (no UPDATE products SET price)',
    !/UPDATE products SET price/.test(shopRoutes));
  check('guard: WELCOME10 coupon is never shown on the homepage',
    !/WELCOME10/.test(indexEjs));
  check('guard: 24h return copy still on checkout (summary + review) and order-success upsell adds nothing to the order',
    (checkoutEjs.match(/24h return/g) || []).length >= 2);

  // ---------- 4. checkout.ejs — source ----------
  check('E2 view: EXACTLY ONE checkout form (class checkout-form, POST /checkout) holding all sections',
    (checkoutEjs.match(/<form action="\/checkout" method="POST" class="checkout-form"/g) || []).length === 1);
  const sectionOrder = ['checkout-section-contact', 'checkout-section-address', 'checkout-section-delivery', 'checkout-section-payment', 'checkout-section-review'];
  check('E2 view: all five sections exist in order — contact, address, delivery, payment, review',
    sectionOrder.every((s) => checkoutEjs.includes(`id="${s}"`))
    && sectionOrder.every((s, i) => i === 0 || checkoutEjs.indexOf(sectionOrder[i - 1]) < checkoutEjs.indexOf(s)));
  check('E2 view: section titles are numbered 1–5 (Contact, Delivery Address, Delivery, Payment, Review Your Order)',
    checkoutEjs.includes('>1. Contact</h4>') && checkoutEjs.includes('>2. Delivery Address</h4>')
    && checkoutEjs.includes('>3. Delivery</h4>') && checkoutEjs.includes('>4. Payment</h4>')
    && checkoutEjs.includes('>5. Review Your Order</h4>'));
  check('E2 view: review section lists the cart items + totals (incl. review-total-display)',
    checkoutEjs.includes('class="checkout-review-list"') && checkoutEjs.includes('id="review-total-display"'));
  check('PR #87 view: review Delivery Charge line carries id="review-delivery-display" (it was a bare server value, so no JS ever refreshed it)',
    checkoutEjs.includes('id="review-delivery-display"'));
  check('PR #87 js: updateTotal refreshes the review delivery line with the same charge as the summary line',
    /const reviewDeliveryEl = document\.getElementById\('review-delivery-display'\);/.test(checkoutEjs)
    && /if \(reviewDeliveryEl\) reviewDeliveryEl\.textContent = fmtTk\(charge\);/.test(checkoutEjs));
  check('E2 view: form is novalidate (inline validation gates, server re-validates — no-JS still submits)',
    /<form action="\/checkout" method="POST" class="checkout-form" id="checkout-form" novalidate>/.test(checkoutEjs));
  check('E3 view: fields pre-fill from the form local (name/email/phone/district/area/house-line values)',
    checkoutEjs.includes('value="<%= _fv(\'customer_name\') %>"') && checkoutEjs.includes('value="<%= _fv(\'email\') %>"')
    && checkoutEjs.includes('value="<%= _fv(\'phone\') %>"') && checkoutEjs.includes('value="<%= _fv(\'address_line\') %>"')
    && checkoutEjs.includes('<%= _fv(\'district\') === d ? \' selected\' : \'\' %>'));
  check('E3 view: logged-in note names the customer + links to /account/profile',
    checkoutEjs.includes('Signed in as <strong><%= prefill.name %></strong>')
    && checkoutEjs.includes('<a href="/account/profile">profile</a>'));
  check('E5 view: district select (name=district) + dependent area select (name=area) + house/road/landmark line',
    /<select name="district" id="district" required>/.test(checkoutEjs)
    && /<select name="area" id="area" data-selected="<%= _fv\('area'\) %>">/.test(checkoutEjs)
    && /<input type="text" id="address_line" name="address_line"/.test(checkoutEjs));
  check('E5 view: district options come from the server list (bdDistricts), with a Dhaka fallback when the local is missing',
    /const _districts = \(typeof bdDistricts !== 'undefined' && bdDistricts && bdDistricts\.districts\) \|\| \['Dhaka'\];/.test(checkoutEjs));
  check('E4 view: every validated field has a field-msg span (name/email/phone/district/area/line/txn)',
    ['customer_name-msg', 'email-msg', 'phone-msg', 'district-msg', 'area-msg', 'address_line-msg', 'transaction_id-msg']
      .every((id) => checkoutEjs.includes(`id="${id}"`)));
  check('E4 view: Place Order hint element exists for the "fill in…" gate message',
    checkoutEjs.includes('id="place-order-hint"'));
  check('E4 view: checkout.js is loaded with the inlined BD_DISTRICTS data before it',
    checkoutEjs.indexOf('window.BD_DISTRICTS = ') < checkoutEjs.indexOf("assetUrl('/js/checkout.js')")
    && checkoutEjs.includes("assetUrl('/js/checkout.js')"));
  check('E4 view: PR #81 Place Order lock untouched (form._placing + disabled + is-loading + "Placing order…" + pageshow + 15s)',
    /form\._placing = true;/.test(checkoutEjs) && /btn\.disabled = true;/.test(checkoutEjs)
    && /btn\.classList\.add\('is-loading'\)/.test(checkoutEjs) && /Placing order…/.test(checkoutEjs)
    && /window\.addEventListener\('pageshow'/.test(checkoutEjs) && /setTimeout\(resetBtn, 15000\)/.test(checkoutEjs));
  check('guard view: payment section unchanged — COD + manual methods + Transaction ID field + copy button',
    checkoutEjs.includes('<option value="Cash on Delivery">Cash on Delivery</option>')
    && checkoutEjs.includes('id="txn-field"') && checkoutEjs.includes('name="transaction_id"')
    && checkoutEjs.includes('id="copy-btn"') && checkoutEjs.includes('toggleTxnField()')
    && checkoutEjs.includes('updateTotal()'));
  check('guard view: no .toFixed(2) outside the _tk helper (PR #57 currency rule)',
    !checkoutEjs.split('\n').filter((l) => !l.includes('const _tk') && !l.includes("return '৳' + (Number.isInteger")).join('\n').includes('.toFixed(2)'));

  // ---------- 5. order-success.ejs — source ----------
  check('E9 view: guest-only save-details box posts to /checkout/create-account with hidden order_id + password',
    /<% if \(\(typeof guestCheckout !== 'undefined' && guestCheckout\) \|\| \(typeof accountError !== 'undefined' && accountError\)\) \{ %>/.test(successEjs)
    && successEjs.includes('<form action="/checkout/create-account" method="POST" class="save-details-form">')
    && successEjs.includes('<input type="hidden" name="order_id" value="<%= orderId %>">')
    && successEjs.includes('name="password"') && successEjs.includes('Save your details for next time'));
  check('E9 view: the box says sign-up is AFTER purchase (no pre-payment forcing copy)',
    successEjs.includes('Next time checkout-e naam, phone ar thikana abar likhte hobe na'));
  check('E10 view: upsell box ("You may also like") renders only when upsell products exist',
    /<% if \(typeof upsell !== 'undefined' && upsell && upsell\.length > 0\) \{ %>/.test(successEjs)
    && successEjs.includes('You may also like'));
  check('E10 view: upsell card reuses the PR #80 AJAX add (plain /cart/add/ form + CSRF + qty 1 + .btn-card)',
    successEjs.includes('<form action="/cart/add/<%= p.id %>" method="POST">')
    && successEjs.includes('<button type="submit" class="btn-card">🛒 Add to Cart</button>'));
  check('E10 view: upsell variant products get "Choose Option →" instead of an add form',
    successEjs.includes('<% if (p.hasOptions) { %>') && successEjs.includes('>Choose Option →</a>'));
  check('guard view: A9 tick + 14-piece confetti + heading untouched on the thank-you page',
    successEjs.includes('order-success-tick') && successEjs.includes('<svg viewBox="0 0 52 52"')
    && (successEjs.match(/<i><\/i>/g) || []).length === 14
    && successEjs.includes('<h1>Order Placed Successfully!</h1>'));

  // ---------- 6. public/js/checkout.js — source ----------
  check('E4 js: exposes GoinceCheckout (validateField, isValidBdPhone, isValidEmail, boot)',
    /window\.GoinceCheckout = \{/.test(checkoutJs) && /validateField: validateField,/.test(checkoutJs)
    && /isValidBdPhone: isValidBdPhone,/.test(checkoutJs) && /boot: boot,/.test(checkoutJs));
  check('E4 js: validateField covers name/email/phone/district/area/address_line/transaction_id',
    ['customer_name', 'email', 'phone', 'district', 'area', 'address_line', 'transaction_id']
      .every((f) => checkoutJs.includes(`if (name === '${f}')`)));
  check('E4 js: Place Order is disabled until valid, with the hint text; submit is blocked when invalid',
    /self\.btn\.disabled = !valid;/.test(checkoutJs)
    && checkoutJs.includes('Fill in your name, phone and address to place the order.')
    && /if \(ev && ev\.preventDefault\) ev\.preventDefault\(\);/.test(checkoutJs));
  check('E5 js: populateAreas fills the area select from BD_DISTRICTS; district change re-validates',
    /populateAreas = function \(selectedArea\)/.test(checkoutJs)
    && /areas = \(BD\.areas && BD\.areas\[district\]\)/.test(checkoutJs));
  check('E5 js: Dhaka suggests Inside Dhaka, other districts Outside Dhaka (zone stays editable)',
    /zone\.value = district === 'Dhaka' \? 'inside_dhaka' : 'outside_dhaka';/.test(checkoutJs));
  check('E4 js: the PR #81 lock is never touched here (no _placing, no "Placing order")',
    !checkoutJs.includes('_placing') && !checkoutJs.includes('Placing order'));

  // ---------- 7. CSS ----------
  // The block is the LAST thing in style.css, so slicing from its
  // opening comment (in the RAW css — the marker is a comment) to
  // the end of the file gives exactly this batch's rules.
  const checkoutCssStart = css.indexOf('/* Checkout improvements (feat/checkout');
  const checkoutCss = checkoutCssStart >= 0 ? css.slice(checkoutCssStart).replace(/\/\*[\s\S]*?\*\//g, '') : '';
  check('css: the batch block exists and introduces no new hex colour (palette vars only)',
    checkoutCssStart >= 0 && !/#[0-9a-f]{3,8}/.test(checkoutCss));
  check('css: invalid fields get a danger border, valid a success border, with error/ok message colours',
    /\.checkout-form input\.is-invalid, \.checkout-form select\.is-invalid \{[^}]*border-color: var\(--danger\)/.test(checkoutCss)
    && /\.checkout-form input\.is-valid, \.checkout-form select\.is-valid \{[^}]*border-color: var\(--success\)/.test(checkoutCss)
    && /\.field-msg--error \{[^}]*color: var\(--danger\)/.test(checkoutCss)
    && /\.field-msg--ok \{[^}]*color: var\(--success\)/.test(checkoutCss));
  check('css: disabled Place Order is faded + not-allowed (no hover lift while disabled)',
    /\.btn-place-order:disabled \{[^}]*opacity: \.55;[^}]*cursor: not-allowed/.test(checkoutCss));
  check('css: district/area sit side by side on desktop, stacked on mobile',
    /\.checkout-district-row \{[^}]*display: grid;[^}]*grid-template-columns: 1fr 1fr;/.test(checkoutCss)
    && /@media \(max-width: 700px\)[\s\S]*?\.checkout-district-row \{[^}]*grid-template-columns: 1fr;/.test(checkoutCss));
  check('css: save-details box + upsell section are styled (surface card, left-aligned upsell grid)',
    /\.save-details-box \{[^}]*background: var\(--surface\)/.test(checkoutCss)
    && /\.order-success-upsell \{[^}]*text-align: left;/.test(checkoutCss));

  // ---------- 8. EJS renders ----------
  let guestHtml = '';
  try {
    guestHtml = await renderFile(checkoutPath, Object.assign({}, baseLocals, checkoutLocals, { form: { customer_name: '', email: '', phone: '', district: '', area: '', address_line: '' }, prefill: null, isLoggedIn: false }));
  } catch (e) { check('render: guest checkout renders (EJS)', false, String(e && e.message)); }
  if (guestHtml) {
    const formBlock = (guestHtml.match(/<form action="\/checkout"[\s\S]*?<\/form>/) || [''])[0];
    check('render guest: ONE checkout form contains all five sections (contact…review inside the same <form>)',
      sectionOrder.every((s) => formBlock.includes(`id="${s}"`)));
    const dsel = (guestHtml.match(/<select name="district"[\s\S]*?<\/select>/) || [''])[0];
    check('render guest: district dropdown lists all 64 districts (+ placeholder)',
      (dsel.match(/<option/g) || []).length === 65 && dsel.includes('>Dhaka</option>')
      && dsel.includes('>Chattogram</option>') && dsel.includes('>Sylhet</option>'));
    check('render guest: fields are empty and no pre-fill note shows',
      guestHtml.includes('id="customer_name" name="customer_name" value=""')
      && !guestHtml.includes('checkout-prefill-note'));
    check('render guest: COD + bKash/Nagad/Rocket render with the Transaction ID field',
      guestHtml.includes('<option value="Cash on Delivery">Cash on Delivery</option>')
      && guestHtml.includes('>bKash — Send Money</option>') && guestHtml.includes('>Nagad — Send Money</option>')
      && guestHtml.includes('>Rocket — Send Money</option>') && guestHtml.includes('data-number="01814697896"')
      && guestHtml.includes('name="transaction_id"'));
    check('render guest: review section shows the item + total ৳1,050',
      guestHtml.includes('BINBOND 2521 Watch') && guestHtml.includes('id="review-total-display">৳1,050<'));
    check('render guest PR #87: review Delivery Charge renders with id="review-delivery-display" at ৳60 (Inside Dhaka default)',
      guestHtml.includes('id="review-delivery-display">৳60<'));
    check('render guest: inlined BD_DISTRICTS carries the 64 districts for the picker JS',
      guestHtml.includes('window.BD_DISTRICTS = ') && guestHtml.includes('"districts":["Bagerhat"')
      && guestHtml.includes('Dhanmondi'));
  }
  let prefillHtml = '';
  try {
    prefillHtml = await renderFile(checkoutPath, Object.assign({}, baseLocals, checkoutLocals, {
      form: { customer_name: 'Rohim Uddin', email: 'rohim@example.com', phone: '01814697896', district: 'Dhaka', area: 'Dhanmondi', address_line: 'House 12, Road 5' },
      prefill: { name: 'Rohim Uddin', email: 'rohim@example.com', phone: '01814697896', address: 'House 12, Road 5, Dhanmondi, Dhaka', district: 'Dhaka', area: 'Dhanmondi', addressLine: 'House 12, Road 5' },
      isLoggedIn: true,
    }));
  } catch (e) { check('render: pre-filled checkout renders (EJS)', false, String(e && e.message)); }
  if (prefillHtml) {
    check('render prefill: name / email / phone / house-line are filled from the profile',
      prefillHtml.includes('value="Rohim Uddin"') && prefillHtml.includes('value="rohim@example.com"')
      && prefillHtml.includes('value="01814697896"') && prefillHtml.includes('value="House 12, Road 5"'));
    const dsel = (prefillHtml.match(/<select name="district"[\s\S]*?<\/select>/) || [''])[0];
    const asel = (prefillHtml.match(/<select name="area"[\s\S]*?<\/select>/) || [''])[0];
    check('render prefill: Dhaka is selected and its areas are listed with Dhanmondi selected',
      dsel.includes('<option value="Dhaka" selected>Dhaka</option>')
      && (asel.match(/<option/g) || []).length === 21 && asel.includes('value="Dhanmondi" selected'));
    check('render prefill: the signed-in note shows and the fields stay editable (no readonly/disabled inputs)',
      prefillHtml.includes('Signed in as <strong>Rohim Uddin</strong>')
      && !/id="customer_name"[^>]*readonly/.test(prefillHtml) && !/id="phone"[^>]*disabled/.test(prefillHtml));
  }
  let errorHtml = '';
  try {
    errorHtml = await renderFile(checkoutPath, Object.assign({}, baseLocals, checkoutLocals, {
      error: 'Sothik naam, thikana ar Bangladeshi mobile number (01XXXXXXXXX) dao.',
      form: { customer_name: 'Rohim', email: '', phone: 'bad', district: 'Sylhet', area: 'Sylhet Sadar', address_line: 'H 1' },
      prefill: null, isLoggedIn: false,
    }));
  } catch (e) { check('render: error checkout renders (EJS)', false, String(e && e.message)); }
  if (errorHtml) {
    check('render error: the error message shows AND the typed district/area/line survive the re-render',
      errorHtml.includes('Sothik naam, thikana ar Bangladeshi mobile number')
      && errorHtml.includes('<option value="Sylhet" selected>Sylhet</option>')
      && errorHtml.includes('value="Sylhet Sadar" selected') && errorHtml.includes('value="H 1"'));
  }
  let oldLocalsHtml = '';
  try {
    oldLocalsHtml = await renderFile(checkoutPath, Object.assign({}, baseLocals, {
      cart: [], cartItems: [], subtotal: 0, deliveryCharge: 60, total: 60, user: null,
      deliveryZones: [{ id: 1, name: 'Inside Dhaka', charge: 60, delivery_time: '1–2 days' }],
      paymentMethods: [], gateway: { enabled: false }, cartCount: 0, discount: 0,
    }));
  } catch (e) { check('render: checkout with OLD locals (no form/prefill/bdDistricts) still renders', false, String(e && e.message)); }
  if (oldLocalsHtml) {
    check('render old-locals: fallback district list renders (no crash without bdDistricts)',
      oldLocalsHtml.includes('>Dhaka</option>') && oldLocalsHtml.includes('checkout-section-review'));
  }
  const upsellProduct = { id: 5, name: 'MLSM-202 Sewing Machine', price: 1250, image: 'sew.jpg', stock: 16, free_shipping: 0, hasOptions: false };
  const upsellVariant = { id: 7, name: 'A.T.Z Dress', price: 310, image: 'dress.jpg', stock: 10, free_shipping: 1, hasOptions: true };
  let successGuestHtml = '';
  try {
    successGuestHtml = await renderFile(successPath, Object.assign({}, baseLocals, {
      orderId: 42, total: 1990, cart: [{ id: 3, name: 'BINBOND 2521 Watch', price: 990, quantity: 1 }],
      guestCheckout: true, accountError: null, upsell: [upsellProduct, upsellVariant], deliveryInside: 60, deliveryOutside: 120,
    }));
  } catch (e) { check('render: guest order-success renders (EJS)', false, String(e && e.message)); }
  if (successGuestHtml) {
    check('render success guest: tick + confetti + heading kept, E9 box + upsell box both show',
      successGuestHtml.includes('order-success-tick') && (successGuestHtml.match(/<i><\/i>/g) || []).length === 14
      && successGuestHtml.includes('<h1>Order Placed Successfully!</h1>')
      && successGuestHtml.includes('Save your details for next time')
      && successGuestHtml.includes('action="/checkout/create-account"')
      && successGuestHtml.includes('You may also like'));
    check('render success guest: upsell has a working add-to-cart form for the plain product',
      successGuestHtml.includes('action="/cart/add/5"') && successGuestHtml.includes('MLSM-202 Sewing Machine'));
    check('render success guest: upsell variant product gets "Choose Option →" (no add form for it)',
      successGuestHtml.includes('A.T.Z Dress') && !successGuestHtml.includes('action="/cart/add/7"')
      && successGuestHtml.includes('>Choose Option →</a>'));
    check('render success guest: upsell cards show the delivery badge (zone charges)',
      successGuestHtml.includes('Delivery ৳60–৳120'));
  }
  let successLoggedHtml = '';
  try {
    successLoggedHtml = await renderFile(successPath, Object.assign({}, baseLocals, {
      orderId: 42, total: 1990, cart: [{ id: 3, name: 'BINBOND 2521 Watch', price: 990, quantity: 1 }],
      guestCheckout: false, accountError: null, upsell: [], deliveryInside: 60, deliveryOutside: 120,
    }));
  } catch (e) { check('render: logged-in order-success renders (EJS)', false, String(e && e.message)); }
  if (successLoggedHtml) {
    check('render success logged-in: NO account box and NO upsell box (nothing to save, nothing to upsell)',
      !successLoggedHtml.includes('save-details-box') && !successLoggedHtml.includes('order-success-upsell'));
  }
  let successOldHtml = '';
  try {
    successOldHtml = await renderFile(successPath, {
      siteName: 'Goince', shopPhone: '01814697896', cartCount: 0, miniCart: [], miniCartSubtotal: 0,
      userName: null, userPhotoUrl: null, userEmail: '', orderId: 42, total: 1990,
      cart: [{ id: 1, name: 'Watch', price: 990, quantity: 1 }], siteSettings: {},
    });
  } catch (e) { check('render: order-success with OLD locals still renders', false, String(e && e.message)); }
  if (successOldHtml) {
    check('render success old-locals: tick + confetti render, no E9/upsell boxes without the new locals',
      successOldHtml.includes('order-success-tick') && !successOldHtml.includes('save-details-box')
      && !successOldHtml.includes('order-success-upsell'));
  }

  // ---------- 9. Route E2E: real shop routes on a stubbed DB ----------
  const dbPath = require.resolve('../config/db');
  const CSRF_TOKEN = 'test-csrf-token-checkout';
  const testSession = { cart: [], csrfToken: CSRF_TOKEN };
  const products = {
    3: { id: 3, name: 'BINBOND 2521 Watch', price: 990, image: 'watch.jpg', stock: 15, free_shipping: 1, category_id: 2 },
    5: { id: 5, name: 'MLSM-202 Sewing Machine', price: 1250, image: 'sew.jpg', stock: 16, free_shipping: 0, category_id: 2 },
    7: { id: 7, name: 'A.T.Z Dress', price: 310, image: 'dress.jpg', stock: 10, free_shipping: 1, category_id: 2 },
  };
  const orderInserts = [];
  const userInserts = [];
  const orderUserUpdates = [];
  let existingEmail = false;
  let stubOrderUserId = null;
  const stubOrder = { id: 42, user_id: null, customer_name: 'Rohim Uddin', email: 'rohim@example.com', phone: '01814697896', address: 'House 12, Road 5, Dhanmondi, Dhaka', total_amount: 1990 };
  const dbStub = {
    query: async (sql, params) => {
      if (/allow_backorder/.test(sql)) return [[{ allow_backorder: 0 }]];
      if (/SELECT stock FROM products WHERE id = \?/.test(sql)) {
        const p = products[params[0]];
        return [[{ stock: p ? p.stock : 0 }]];
      }
      if (/SELECT DISTINCT category_id FROM products WHERE id IN/.test(sql)) return [[{ category_id: 2 }]];
      if (/FROM products p WHERE p\.category_id IN/.test(sql)) {
        return [[Object.assign({}, products[5])]];
      }
      if (/FROM products WHERE stock > 0/.test(sql)) {
        return [[Object.assign({}, products[7])]];
      }
      if (/FROM products WHERE id = \?/.test(sql)) {
        const p = products[params[0]];
        return [p ? [p] : []];
      }
      if (/FROM product_variants WHERE id = \? AND product_id = \?/.test(sql)) return [[]];
      if (/product_variant_attributes/.test(sql)) return [[]];
      if (/FROM product_options WHERE id = \? AND product_id = \?/.test(sql)) return [[]];
      if (/SELECT DISTINCT product_id FROM product_variants WHERE product_id IN/.test(sql)) return [[]];
      if (/SELECT DISTINCT product_id FROM product_options WHERE product_id IN/.test(sql)) return [[]];
      if (/free_shipping, cod_allowed/.test(sql)) {
        const rows = (params || []).map((id) => products[id]).filter(Boolean)
          .map((p) => ({ id: p.id, free_shipping: p.free_shipping, cod_allowed: 1 }));
        return [rows];
      }
      if (/FROM users WHERE id = \?/.test(sql)) {
        return [[{ name: 'Rohim Uddin', email: 'rohim@example.com', phone: '01814697896', address: 'House 12, Road 5, Dhanmondi, Dhaka' }]];
      }
      if (/FROM users WHERE email = \?/.test(sql)) return [existingEmail ? [{ id: 9 }] : []];
      if (/FROM orders WHERE id = \?/.test(sql)) {
        return [[Object.assign({}, stubOrder, { user_id: stubOrderUserId })]];
      }
      if (/FROM order_items WHERE order_id = \?/.test(sql)) {
        return [[{ product_id: 3, product_name: 'BINBOND 2521 Watch', price: 990, quantity: 1 }]];
      }
      if (/INSERT INTO users/.test(sql)) { userInserts.push(params); return [{ insertId: 77 }]; }
      if (/UPDATE orders SET user_id/.test(sql)) { orderUserUpdates.push(params); return [{}]; }
      if (/FROM settings/.test(sql)) {
        return [[
          { setting_key: 'delivery_charge_inside', setting_value: '60' },
          { setting_key: 'delivery_charge_outside', setting_value: '120' },
        ]];
      }
      if (/FROM delivery_zones/.test(sql)) return [[]];
      if (/FROM payment_methods/.test(sql)) {
        return [[
          { method_name: 'bKash', number: '01814697896', payment_type: 'send_money', instructions: '' },
          { method_name: 'Nagad', number: '01814697896', payment_type: 'send_money', instructions: '' },
          { method_name: 'Rocket', number: '01814697896', payment_type: 'send_money', instructions: '' },
        ]];
      }
      return [[]];
    },
    getConnection: async () => ({
      beginTransaction: async () => {},
      commit: async () => {},
      rollback: async () => {},
      release: () => {},
      query: async (sql, params) => {
        if (/INSERT INTO orders/.test(sql)) { orderInserts.push(params); return [{ insertId: 42 }]; }
        if (/INSERT INTO order_items/.test(sql)) return [{}];
        if (/UPDATE products SET stock/.test(sql)) return [{}];
        if (/UPDATE product_variants SET stock/.test(sql)) return [{}];
        if (/SELECT stock FROM products WHERE id/.test(sql)) return [[{ stock: 10 }]];
        if (/SELECT stock FROM product_variants WHERE id/.test(sql)) return [[{ stock: 5 }]];
        if (/INSERT INTO stock_history/.test(sql)) return [{}];
        return [[]];
      },
    }),
  };
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: dbStub };
  const { csrfProtection } = require('../lib/csrf');
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = testSession;
    res.locals.userName = null; res.locals.userPhotoUrl = null; res.locals.cartCount = (testSession.cart || []).reduce((s, it) => s + it.quantity, 0);
    res.locals.siteSettings = {}; res.locals.shopPhone = '+8801814697896'; res.locals.paymentMethods = [];
    res.locals.assetUrl = (p) => p; res.locals.menuCategories = []; res.locals.menuById = {};
    res.locals.miniCart = testSession.cart || [];
    res.locals.miniCartSubtotal = res.locals.miniCart.reduce((s, it) => s + (Number(it.price) || 0) * it.quantity, 0);
    res.locals.miniCartDeliveryInside = 60; res.locals.miniCartDeliveryOutside = 120;
    res.locals.csrfToken = CSRF_TOKEN; res.locals.siteUrl = 'http://127.0.0.1';
    res.locals.siteLogoAbs = ''; res.locals.siteFaviconAbs = ''; res.locals.siteOgImageAbs = '';
    next();
  });
  app.use(csrfProtection);
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.use('/', require('../routes/shop'));
  function reqRaw(port, method, pathUrl, body, ajax) {
    return new Promise((resolve, reject) => {
      const headers = {};
      if (body !== null) { headers['Content-Type'] = 'application/x-www-form-urlencoded'; headers['Content-Length'] = Buffer.byteLength(body); }
      if (ajax) { headers['X-Requested-With'] = 'XMLHttpRequest'; headers.Accept = 'application/json'; }
      const req = http.request({ method, host: '127.0.0.1', port, path: pathUrl, headers }, (res) => {
        const parts = [];
        res.on('data', (c) => parts.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(parts).toString('utf8') }));
      });
      req.on('error', reject);
      if (body !== null) req.write(body);
      req.end();
    });
  }
  const enc = (o) => Object.entries(o).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  const freeItem = { cartKey: '3', id: 3, name: 'BINBOND 2521 Watch', price: 990, image: 'watch.jpg', quantity: 1, variantId: null, variantLabel: null, freeDelivery: true };
  const chargedItem = { cartKey: '5', id: 5, name: 'MLSM-202 Sewing Machine', price: 1250, image: 'sew.jpg', quantity: 1, variantId: null, variantLabel: null, freeDelivery: false };
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.on('listening', r));
  const port = server.address().port;
  try {
    // --- 9a. GET /checkout logged-in: profile pre-fill in the HTML.
    delete testSession.userId;
    testSession.cart = [Object.assign({}, freeItem)];
    testSession.userId = 7;
    const coPrefill = await reqRaw(port, 'GET', '/checkout', null, false);
    check('e2e checkout GET logged-in: name/phone/email pre-filled, Dhaka + Dhanmondi pre-selected, signed-in note shows',
      coPrefill.status === 200 && coPrefill.body.includes('value="Rohim Uddin"')
      && coPrefill.body.includes('value="01814697896"') && coPrefill.body.includes('value="rohim@example.com"')
      && coPrefill.body.includes('<option value="Dhaka" selected>Dhaka</option>')
      && coPrefill.body.includes('value="Dhanmondi" selected')
      && coPrefill.body.includes('Signed in as <strong>Rohim Uddin</strong>'));
    delete testSession.userId;
    // --- 9b. GET /checkout guest: empty fields, all 5 sections in one form, district list present.
    const coGuest = await reqRaw(port, 'GET', '/checkout', null, false);
    const guestForm = (coGuest.body.match(/<form action="\/checkout"[\s\S]*?<\/form>/) || [''])[0];
    check('e2e checkout GET guest: one form holds contact/address/delivery/payment/review; empty fields; 64 districts',
      coGuest.status === 200
      && ['checkout-section-contact', 'checkout-section-address', 'checkout-section-delivery', 'checkout-section-payment', 'checkout-section-review'].every((s) => guestForm.includes(`id="${s}"`))
      && guestForm.includes('id="customer_name" name="customer_name" value=""')
      && (guestForm.match(/<option value="Dhaka"/g) || []).length === 1
      && coGuest.body.includes('>Chattogram</option>'));
    check('e2e checkout GET guest: COD + bKash/Nagad/Rocket (01814697896) + Transaction ID field render',
      coGuest.body.includes('<option value="Cash on Delivery">Cash on Delivery</option>')
      && coGuest.body.includes('>bKash — Send Money</option>') && coGuest.body.includes('data-number="01814697896"')
      && coGuest.body.includes('name="transaction_id"'));
    // --- 9c. GET /checkout: all-free cart → FREE delivery; mixed → zone charge (free-delivery rule).
    testSession.cart = [Object.assign({}, freeItem)];
    const coFree = await reqRaw(port, 'GET', '/checkout', null, false);
    check('e2e checkout GET: all-free cart shows FREE 🚚, total = subtotal ৳990',
      coFree.status === 200 && coFree.body.includes('FREE 🚚') && coFree.body.includes('id="total-display">৳990<'));
    testSession.cart = [Object.assign({}, freeItem), Object.assign({}, chargedItem)];
    const coMixed = await reqRaw(port, 'GET', '/checkout', null, false);
    check('e2e checkout GET: mixed cart charges inside-Dhaka ৳60, total ৳2,300',
      coMixed.status === 200 && !coMixed.body.includes('FREE 🚚')
      && coMixed.body.includes('id="delivery-display">৳60<') && coMixed.body.includes('id="total-display">৳2,300<'));
    // --- 9d. POST /checkout with district/area/line: ONE composed address stored, upsell + E9 box on success.
    orderInserts.length = 0;
    testSession.cart = [Object.assign({}, freeItem, { quantity: 2 })];
    const poDistrict = await reqRaw(port, 'POST', '/checkout', enc({
      _csrf: CSRF_TOKEN, customer_name: 'Rohim Uddin', email: 'rohim@example.com', phone: '01814697896',
      district: 'Dhaka', area: 'Dhanmondi', address_line: 'House 12, Road 5',
      payment_method: 'Cash on Delivery', delivery_area: 'outside_dhaka',
    }), false);
    check('e2e checkout POST: district/area/line compose ONE address "House 12, Road 5, Dhanmondi, Dhaka" in the order',
      poDistrict.status === 200 && orderInserts.length === 1
      && orderInserts[0][4] === 'House 12, Road 5, Dhanmondi, Dhaka');
    check('e2e checkout POST: all-free cart + Outside Dhaka still ৳0 delivery (free-delivery rule survives E5)',
      orderInserts.length === 1 && orderInserts[0][8] === 0 && orderInserts[0][11] === 1980);
    check('e2e checkout POST: thank-you page shows the E9 save-details box (guest) + E10 upsell with an add-to-cart form',
      poDistrict.body.includes('Save your details for next time')
      && poDistrict.body.includes('action="/checkout/create-account"')
      && poDistrict.body.includes('You may also like')
      && poDistrict.body.includes('MLSM-202 Sewing Machine')
      && poDistrict.body.includes('action="/cart/add/5"')
      && poDistrict.body.includes('order-success-tick'));
    check('e2e checkout POST: the session remembers the order id for the E9 gate',
      testSession.lastOrderId === 42);
    // --- 9e. POST /checkout legacy free-text address still works (old forms / no-JS / older tests).
    orderInserts.length = 0;
    testSession.cart = [Object.assign({}, freeItem), Object.assign({}, chargedItem)];
    const poLegacy = await reqRaw(port, 'POST', '/checkout', enc({
      _csrf: CSRF_TOKEN, customer_name: 'Rohim', phone: '01814697896', address: 'Chittagong',
      payment_method: 'Cash on Delivery', delivery_area: 'outside_dhaka',
    }), false);
    check('e2e checkout POST legacy: free-text address without district still places the order (mixed, outside → ৳120, total ৳2,360)',
      poLegacy.status === 200 && orderInserts.length === 1 && orderInserts[0][4] === 'Chittagong'
      && orderInserts[0][8] === 120 && orderInserts[0][11] === 2360);
    // --- 9f. POST /checkout validation: bad phone + unknown district → re-render with the error + typed values kept.
    testSession.cart = [Object.assign({}, freeItem)];
    const poBad = await reqRaw(port, 'POST', '/checkout', enc({
      _csrf: CSRF_TOKEN, customer_name: 'Rohim', phone: 'bad',
      district: 'Nowhere', area: '', address_line: 'H 1',
      payment_method: 'Cash on Delivery', delivery_area: 'inside_dhaka',
    }), false);
    check('e2e checkout POST invalid: bad phone + unknown district re-renders the error, typed values kept',
      poBad.status === 200 && poBad.body.includes('Sothik naam, thikana ar Bangladeshi mobile number')
      && poBad.body.includes('value="H 1"') && orderInserts.length === 1);
    // --- 9g. E9: short password → error on the thank-you page, no account created.
    testSession.lastOrderId = 42;
    userInserts.length = 0;
    const e9Short = await reqRaw(port, 'POST', '/checkout/create-account', enc({ _csrf: CSRF_TOKEN, order_id: '42', password: '123' }), false);
    check('e2e E9: password under 6 chars re-renders the thank-you page with the error, no user inserted',
      e9Short.status === 200 && e9Short.body.includes('Password must be at least 6 characters.')
      && e9Short.body.includes('Save your details for next time') && userInserts.length === 0);
    // --- 9h. E9: email already taken → error, no account created.
    testSession.lastOrderId = 42;
    existingEmail = true;
    const e9Taken = await reqRaw(port, 'POST', '/checkout/create-account', enc({ _csrf: CSRF_TOKEN, order_id: '42', password: 'secret1' }), false);
    check('e2e E9: email already registered re-renders with "already exists", no user inserted',
      e9Taken.status === 200 && e9Taken.body.includes('An account with this email already exists')
      && userInserts.length === 0);
    existingEmail = false;
    // --- 9i. E9: order already owned by an account → error.
    testSession.lastOrderId = 42;
    stubOrderUserId = 7;
    const e9Owned = await reqRaw(port, 'POST', '/checkout/create-account', enc({ _csrf: CSRF_TOKEN, order_id: '42', password: 'secret1' }), false);
    check('e2e E9: order already linked to an account is rejected',
      e9Owned.status === 200 && e9Owned.body.includes('This order already belongs to an account.')
      && userInserts.length === 0);
    stubOrderUserId = null;
    // --- 9j. E9: wrong order id (not the one just placed) → redirect to /track-order.
    testSession.lastOrderId = 42;
    const e9Wrong = await reqRaw(port, 'POST', '/checkout/create-account', enc({ _csrf: CSRF_TOKEN, order_id: '99', password: 'secret1' }), false);
    check('e2e E9: a different order id is refused (302 to /track-order), no user inserted',
      e9Wrong.status === 302 && e9Wrong.headers.location === '/track-order' && userInserts.length === 0);
    // --- 9k. E9: happy path — account created from the order, order linked, session logged in.
    testSession.lastOrderId = 42;
    delete testSession.userId;
    const e9Ok = await reqRaw(port, 'POST', '/checkout/create-account', enc({ _csrf: CSRF_TOKEN, order_id: '42', password: 'secret1' }), false);
    check('e2e E9: valid request creates the user from the order (rohim@example.com), links the order, redirects to /account/profile?saved=account',
      e9Ok.status === 302 && e9Ok.headers.location === '/account/profile?saved=account'
      && userInserts.length === 1 && userInserts[0][1] === 'rohim@example.com'
      && userInserts[0][0] === 'Rohim Uddin' && userInserts[0][3] === '01814697896'
      && orderUserUpdates.length === 1 && orderUserUpdates[0][0] === 77 && orderUserUpdates[0][1] === 42
      && testSession.userId === 77);
    // --- 9l. E10: the upsell add-to-cart works through the PR #80 AJAX route (JSON, no navigation).
    testSession.cart = [];
    const up1 = await reqRaw(port, 'POST', '/cart/add/5', enc({ _csrf: CSRF_TOKEN, quantity: '1' }), true);
    let jUp1 = null;
    try { jUp1 = JSON.parse(up1.body); } catch (e) { /* not JSON */ }
    check('e2e E10 upsell: AJAX add of an upsell product → 200 JSON { ok, cartCount 1 }, drawer HTML returned',
      up1.status === 200 && jUp1 && jUp1.ok === true && jUp1.cartCount === 1
      && typeof jUp1.drawerHtml === 'string' && jUp1.drawerHtml.includes('MLSM-202 Sewing Machine'));
  } finally {
    server.close();
    delete require.cache[dbPath];
    delete require.cache[require.resolve('../routes/shop')];
  }

  // ---------- 10. The REAL public/js/checkout.js in a stubbed DOM ----------
  function makeStubEl(tag) {
    const el = {
      _tag: tag || 'div', _classes: new Set(), _attrs: {}, _listeners: {},
      textContent: '', innerHTML: '', value: '', disabled: false, selectedIndex: 0,
      options: [], dataset: {}, style: {}, name: '', focused: false,
      classList: {
        add(c) { el._classes.add(c); },
        remove(c) { el._classes.delete(c); },
        toggle(c, f) { if (f === undefined) { if (el._classes.has(c)) { el._classes.delete(c); return false; } el._classes.add(c); return true; } if (f) el._classes.add(c); else el._classes.delete(c); return !!f; },
        contains(c) { return el._classes.has(c); },
      },
      setAttribute(k, v) { el._attrs[k] = String(v); },
      getAttribute(k) { return el._attrs[k] === undefined ? null : el._attrs[k]; },
      addEventListener(type, fn) { (el._listeners[type] = el._listeners[type] || []).push(fn); },
      fire(type, ev) { (el._listeners[type] || []).forEach((fn) => fn(ev || {})); },
      focus() { el.focused = true; },
    };
    return el;
  }
  const els = {};
  ['customer_name', 'email', 'phone', 'district', 'area', 'address_line', 'delivery_area', 'payment_method', 'txn-input', 'place-order-hint'].forEach((id) => { els[id] = makeStubEl(id === 'place-order-hint' ? 'p' : 'input'); });
  ['customer_name-msg', 'email-msg', 'phone-msg', 'district-msg', 'area-msg', 'address_line-msg', 'transaction_id-msg'].forEach((id) => { els[id] = makeStubEl('span'); });
  const formEl = makeStubEl('form');
  const btnEl = makeStubEl('button');
  els.district.options = [{ value: '', dataset: {} }];
  els.area.options = [{ value: '', dataset: {} }];
  els.delivery_area.options = [{ value: 'inside_dhaka', dataset: { charge: '60' } }, { value: 'outside_dhaka', dataset: { charge: '120' } }];
  els.delivery_area.value = 'inside_dhaka';
  els.payment_method.options = [{ value: 'Cash on Delivery', dataset: {} }, { value: 'bKash', dataset: { number: '01814697896' } }];
  els.payment_method.value = 'Cash on Delivery';
  els.area.setAttribute('data-selected', '');
  let updateTotalCalls = 0;
  const sandbox = {
    BD_DISTRICTS: { districts: DISTRICTS, areas: AREAS },
    document: {
      readyState: 'complete',
      getElementById(id) { return els[id] || null; },
      querySelector(sel) {
        if (sel === '.checkout-form') return formEl;
        if (sel === '.btn-place-order') return btnEl;
        return null;
      },
      querySelectorAll() { return []; },
      addEventListener() {},
      createElement(tag) { return makeStubEl(tag); },
    },
    updateTotal() { updateTotalCalls++; },
  };
  sandbox.window = sandbox;
  vm.runInNewContext(checkoutJs, sandbox);
  const GC = sandbox.GoinceCheckout;
  check('dom js: script boots and exposes GoinceCheckout (validateField + boot)',
    !!GC && typeof GC.validateField === 'function' && typeof GC.boot === 'function');
  check('dom js: empty form on load → Place Order DISABLED with the fill-in hint',
    btnEl.disabled === true && els['place-order-hint'].textContent.includes('Fill in your name, phone and address'));
  const getStub = (name) => {
    if (name === 'payment_method_gateway') {
      const sel = els.payment_method;
      const opt = sel.options[sel.selectedIndex];
      return !!(opt && opt.dataset && opt.dataset.gateway === '1');
    }
    return els[name === 'transaction_id' ? 'txn-input' : name] ? els[name === 'transaction_id' ? 'txn-input' : name].value : '';
  };
  check('dom js: validateField rejects a bad phone and a bad email, accepts a good BD phone + email',
    GC.validateField('phone', (n) => (n === 'phone' ? 'bad' : '')) !== ''
    && GC.validateField('phone', (n) => (n === 'phone' ? '01814697896' : '')) === ''
    && GC.validateField('phone', (n) => (n === 'phone' ? '+8801712345678' : '')) === ''
    && GC.validateField('email', (n) => (n === 'email' ? 'nope@' : '')) !== ''
    && GC.validateField('email', (n) => (n === 'email' ? '' : '')) === '');
  // Bad phone typed live → inline error + invalid class, button stays disabled.
  els.phone.value = '01234';
  els.phone.fire('input');
  check('dom js: typing a bad phone shows the inline error + is-invalid, button stays disabled',
    els['phone-msg'].textContent.includes('Bangladeshi mobile number')
    && els.phone.classList.contains('is-invalid') && btnEl.disabled === true);
  // Good phone → ✓ + is-valid.
  els.phone.value = '01814697896';
  els.phone.fire('input');
  check('dom js: typing a valid phone shows ✓ + is-valid',
    els['phone-msg'].textContent === '✓' && els.phone.classList.contains('is-valid'));
  // Fill the rest valid → button enables.
  els.customer_name.value = 'Rohim Uddin';
  els.customer_name.fire('input');
  els.email.value = 'rohim@example.com';
  els.email.fire('input');
  els.district.value = 'Dhaka';
  els.district.options = DISTRICTS.map((d) => ({ value: d, dataset: {} }));
  els.district.selectedIndex = DISTRICTS.indexOf('Dhaka');
  els.district.fire('change');
  check('dom js: choosing Dhaka fills the area dropdown with Dhaka thanas (Dhanmondi, Gulshan) and suggests Inside Dhaka',
    els.area.innerHTML.includes('Dhanmondi') && els.area.innerHTML.includes('Gulshan')
    && els.delivery_area.value === 'inside_dhaka' && updateTotalCalls >= 1);
  els.area.value = 'Dhanmondi';
  els.area.fire('change');
  els.address_line.value = 'House 12, Road 5';
  els.address_line.fire('input');
  check('dom js: a complete valid form enables Place Order and clears the hint',
    btnEl.disabled === false && els['place-order-hint'].textContent === '');
  // Switch district → areas follow, zone flips to outside.
  els.district.value = 'Chattogram';
  els.district.selectedIndex = DISTRICTS.indexOf('Chattogram');
  els.district.fire('change');
  check('dom js: switching to Chattogram swaps the areas (Agrabad in, Dhanmondi out) and suggests Outside Dhaka',
    els.area.innerHTML.includes('Agrabad') && !els.area.innerHTML.includes('Dhanmondi')
    && els.delivery_area.value === 'outside_dhaka');
  check('dom js: changing district clears the stale area, so the form is invalid again until an area is picked',
    els.area.value === '' && btnEl.disabled === true);
  els.area.value = 'Agrabad';
  els.area.fire('change');
  check('dom js: picking the new area re-enables Place Order',
    btnEl.disabled === false);
  // Manual payment without a Transaction ID blocks; with one it passes.
  els.payment_method.value = 'bKash';
  els.payment_method.selectedIndex = 1;
  els.payment_method.fire('change');
  check('dom js: bKash selected with an empty Transaction ID → inline error + Place Order disabled',
    els['transaction_id-msg'].textContent.includes('Transaction ID') && btnEl.disabled === true);
  els['txn-input'].value = '8N7A2K9XYZ';
  els['txn-input'].fire('input');
  check('dom js: Transaction ID filled → Place Order enabled again',
    btnEl.disabled === false && els['transaction_id-msg'].textContent === '✓');
  // Submit gate: invalid → prevented + first bad field focused; valid → not prevented.
  els.phone.value = 'bad';
  els.phone.fire('input');
  const badSubmit = { prevented: false, preventDefault() { badSubmit.prevented = true; } };
  formEl.fire('submit', badSubmit);
  check('dom js: submitting an invalid form is prevented and the first bad field is focused',
    badSubmit.prevented === true && els.customer_name.focused !== true && els.phone.focused === true);
  els.phone.value = '01814697896';
  els.phone.fire('input');
  const okSubmit = { prevented: false, preventDefault() { okSubmit.prevented = true; } };
  formEl.fire('submit', okSubmit);
  check('dom js: submitting a valid form is NOT prevented (the PR #81 lock takes over from here)',
    okSubmit.prevented === false);

  // ---------- 11. PR #87 — the REAL inline updateTotal from the
  // rendered checkout page, run in a stubbed DOM: the Review
  // section's Delivery Charge line must follow the zone exactly
  // like the Order Summary line. Before this fix the review line
  // was a bare server value with no id, so updateTotal never
  // touched it: switching to Chattogram / Outside Dhaka moved the
  // summary to ৳120 and both totals to ৳1,110 while the review
  // line stayed ৳60. The free-delivery render has NO delivery
  // spans at all (both lines statically read FREE 🚚 = ৳0), so
  // updateTotal must survive their absence.
  function updateTotalDomFrom(html, isFree) {
    const m = html.match(/<script>\s*const subtotal =[\s\S]*?<\/script>/);
    if (!m) return null;
    const code = m[0].replace(/<\/?script>/g, '');
    const mk = (text) => ({ textContent: text || '', value: '', options: [], selectedIndex: 0, dataset: {}, style: {} });
    const els2 = {
      'total-display': mk(isFree ? '৳990' : '৳1,050'),
      'btn-total-display': mk(isFree ? '৳990' : '৳1,050'),
      'review-total-display': mk(isFree ? '৳990' : '৳1,050'),
    };
    if (!isFree) {
      els2['delivery-display'] = mk('৳60');
      els2['review-delivery-display'] = mk('৳60');
    }
    const zone = mk('');
    zone.options = [{ value: 'inside_dhaka', dataset: { charge: '60' } }, { value: 'outside_dhaka', dataset: { charge: '120' } }];
    zone.value = 'inside_dhaka';
    zone.selectedIndex = 0;
    els2['delivery_area'] = zone;
    const box = { document: { getElementById: (id) => els2[id] || null }, console };
    vm.runInNewContext(code, box);
    return { els: els2, zone, updateTotal: box.updateTotal };
  }
  const paid = guestHtml ? updateTotalDomFrom(guestHtml, false) : null;
  check('PR #87 dom: the real inline updateTotal is extracted from the rendered page and runs in the stubbed DOM',
    !!paid && typeof paid.updateTotal === 'function');
  if (paid) {
    check('PR #87 dom: initial render — review delivery ৳60 matches the summary, both totals ৳1,050',
      paid.els['review-delivery-display'].textContent === '৳60'
      && paid.els['delivery-display'].textContent === '৳60'
      && paid.els['total-display'].textContent === '৳1,050'
      && paid.els['review-total-display'].textContent === '৳1,050');
    paid.zone.selectedIndex = 1;
    paid.zone.value = 'outside_dhaka';
    paid.updateTotal();
    check('PR #87 dom: Outside Dhaka (Chattogram) → review delivery ৳120 = summary ৳120, both totals + button ৳1,110',
      paid.els['review-delivery-display'].textContent === '৳120'
      && paid.els['delivery-display'].textContent === '৳120'
      && paid.els['total-display'].textContent === '৳1,110'
      && paid.els['review-total-display'].textContent === '৳1,110'
      && paid.els['btn-total-display'].textContent === '৳1,110');
    paid.zone.selectedIndex = 0;
    paid.zone.value = 'inside_dhaka';
    paid.updateTotal();
    check('PR #87 dom: back to Inside Dhaka → review delivery ৳60 again, totals ৳1,050 (no stale ৳120)',
      paid.els['review-delivery-display'].textContent === '৳60'
      && paid.els['delivery-display'].textContent === '৳60'
      && paid.els['total-display'].textContent === '৳1,050'
      && paid.els['review-total-display'].textContent === '৳1,050');
  }
  let freeHtml = '';
  try {
    freeHtml = await renderFile(checkoutPath, Object.assign({}, baseLocals, checkoutLocals, {
      form: { customer_name: '', email: '', phone: '', district: '', area: '', address_line: '' },
      prefill: null, isLoggedIn: false, allFreeShipping: true, deliveryCharge: 0, total: 990,
    }));
  } catch (e) { check('render: all-free-delivery checkout renders (EJS)', false, String(e && e.message)); }
  if (freeHtml) {
    check('PR #87 render free: summary AND review both read FREE 🚚 (charge ৳0) and carry no delivery-display ids',
      (freeHtml.match(/FREE 🚚/g) || []).length === 2
      && !freeHtml.includes('id="delivery-display"') && !freeHtml.includes('id="review-delivery-display"')
      && freeHtml.includes('const freeShipping = true;'));
    const free = updateTotalDomFrom(freeHtml, true);
    let freeOk = !!free && typeof free.updateTotal === 'function';
    if (free) {
      free.zone.selectedIndex = 1;
      free.zone.value = 'outside_dhaka';
      try { free.updateTotal(); } catch (e) { freeOk = false; }
    }
    check('PR #87 dom free: switching zone on an all-free cart does not crash and keeps all totals at ৳990 (৳0 delivery)',
      freeOk && free.els['total-display'].textContent === '৳990'
      && free.els['review-total-display'].textContent === '৳990'
      && free.els['btn-total-display'].textContent === '৳990');
  }

  console.log(`\n${passes.length} passed, ${failures.length} failed.`);
  if (failures.length) {
    console.log('Failures:');
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exit(1);
  }
})().catch((err) => {
  console.error('TEST CRASH:', err);
  process.exit(1);
});
