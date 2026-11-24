// Call button style (fix/call-button-style) — EJS + CSS test.
//
// The Call action on the Calls & Activity page rendered as a plain gold
// text link (.analytics-view-link), and on order-details as an inline-styled
// .btn-primary, so it looked like ordinary text and the two pages were
// inconsistent. Both now use one reusable green pill class `.btn-call`.
//
// Checks:
//   1. CSS: .btn-call exists with a green background, pill radius, padding,
//      nowrap, hover (darker green + lift) and focus-visible rules; the
//      dark-theme admin-link variant exists so the dark link rules cannot
//      recolour the text; no hardcoded grey text in the block; braces
//      balanced across the whole stylesheet.
//   2. Contrast: white text on the base green #1f7a30 (var(--success)) and
//      on the hover green #176327 is >= 4.5:1 (WCAG AA, computed).
//   3. EJS render: activity.ejs phone tab renders the Call link with class
//      btn-call and the correct tel: href; no analytics-view-link Call link
//      remains; the "View order" links still use analytics-view-link.
//   4. EJS render: order-details.ejs renders the Call link with class
//      btn-call and the correct tel: href; no inline padding style remains.
//   5. Source sweep: no other admin view has a "📞 Call" link (the
//      .chat-call-btn class in CSS is unused by any view, so there is
//      nothing else to unify).
//
// Run:  node scripts/test-call-button-style.js
// Exit code 0 = all checks passed.
'use strict';

const fs = require('fs');
const path = require('path');
const util = require('util');
const ejs = require('ejs');

const failures = [];
const passes = [];
function check(name, ok, detail) {
  if (ok) { passes.push(name); console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

// ---------- WCAG contrast ----------
function luminance(hex) {
  const c = hex.replace('#', '');
  const rgb = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255);
  const lin = rgb.map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}
function contrast(hexA, hexB) {
  const [hi, lo] = [luminance(hexA), luminance(hexB)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'style.css'), 'utf8');
const callBlock = (() => {
  const i = css.indexOf('.btn-call,');
  if (i < 0) return '';
  return css.slice(i, css.indexOf('/* ===== fix/complete-website', i) === -1 ? css.length : css.indexOf('/* ===== fix/complete-website', i));
})();

(async () => {
  console.log('CSS (.btn-call)');
  check('btn-call class exists', css.includes('.btn-call,'));
  check('green background via var(--success)', callBlock.includes('background: var(--success)'));
  check('white text', callBlock.includes('color: #fff'));
  check('pill radius', callBlock.includes('border-radius: 999px'));
  check('compact padding for table rows', callBlock.includes('padding: 6px 14px'));
  check('no wrap inside the button', callBlock.includes('white-space: nowrap'));
  check('inline-block so padding applies to the <a>', callBlock.includes('display: inline-block'));
  check('hover rule with darker green + lift', callBlock.includes('.btn-call:hover') && callBlock.includes('background: #176327') && callBlock.includes('translateY(-1px)'));
  check('focus-visible outline for keyboard users', callBlock.includes('.btn-call:focus-visible') && callBlock.includes('outline: 2px solid #76a5ff'));
  check('dark-theme admin-link variant exists (beats the dark link rules)', css.includes('[data-theme="dark"] .admin-content a.btn-call { background: var(--success)'));
  check('no hardcoded grey text in the btn-call block', !/#888|#999|#666/.test(callBlock));
  const opens = (css.match(/\{/g) || []).length;
  const closes = (css.match(/\}/g) || []).length;
  check('stylesheet braces balanced', opens === closes, `${opens} open vs ${closes} close`);

  console.log('Contrast (white text on green)');
  const baseRatio = contrast('#ffffff', '#1f7a30');
  const hoverRatio = contrast('#ffffff', '#176327');
  console.log(`  white on #1f7a30: ${baseRatio.toFixed(2)}:1, white on #176327: ${hoverRatio.toFixed(2)}:1`);
  check('white on base green >= 4.5:1', baseRatio >= 4.5, baseRatio.toFixed(2) + ':1');
  check('white on hover green >= 4.5:1', hoverRatio >= 4.5, hoverRatio.toFixed(2) + ':1');
  check('--success is #1f7a30 in both themes', (css.match(/--success: #1f7a30;/g) || []).length === 2);

  console.log('EJS render (activity page, phone tab)');
  const renderFile = util.promisify(ejs.renderFile);
  const activityHtml = await renderFile(path.join(__dirname, '..', 'views', 'admin', 'activity.ejs'), {
    tab: 'phone', page: 1, totalPages: 1, totalCount: 1, perPage: 20,
    phoneTotal: 1, activityTotal: 0,
    phoneRows: [{ id: 35, customer_name: 'Jahid Hasan', phone: '01814697896', total_amount: 370, created_at: new Date('2026-11-24T10:00:00') }],
    activityRows: [],
    siteName: 'Goince', siteSettings: { logo_url: '/icons/icon-192.png' },
    adminRole: 'owner', csrfToken: 'test-csrf', assetUrl: (p) => p,
  });
  check('activity Call link has class btn-call', activityHtml.includes('class="btn-call" href="tel:01814697896"'));
  check('activity Call link keeps the tel: href', activityHtml.includes('href="tel:01814697896"'));
  check('no analytics-view-link Call link remains on the activity page', !/analytics-view-link" href="tel:/.test(activityHtml));
  check('View order link still uses analytics-view-link', activityHtml.includes('class="analytics-view-link" href="/admin/orders/35"'));
  check('phone number itself is still a plain tel: link', activityHtml.includes('<a href="tel:01814697896">01814697896</a>'));

  console.log('EJS render (order-details page)');
  const order = {
    id: 35, customer_name: 'Jahid Hasan', phone: '01814697896', email: 'jahid@example.com',
    address: 'Chuadanga', delivery_zone: 'Outside Dhaka', delivery_charge: 60,
    status: 'Pending', payment_method: 'Cash on Delivery', payment_status: 'Unpaid',
    total_amount: 370, discount_amount: 0, coupon_code: '',
    created_at: new Date('2026-11-24T10:00:00'), phone_confirmed: 0, phone_confirmed_at: null,
    cod_collected: 0, cod_collected_at: null, cancel_reason: '', transaction_id: '',
    courier_name: '', courier_status: '', courier_consignment_id: '', tracking_number: '',
  };
  const detailsHtml = await renderFile(path.join(__dirname, '..', 'views', 'admin', 'order-details.ejs'), {
    order,
    items: [{ product_name: 'A.T.Z Dress', quantity: 1, price: 310, cost_price: null, variant_label: 'Size M' }],
    history: [], notes: [], phoneHistory: { total: 0, cancelled: 0, delivered: 0 },
    returns: [], advances: [], paid: 0, due: 370, invoiceNo: 'GOINCE-00035', invoiceSends: [],
    orderMsg: null, orderErr: null, siteName: 'Goince', shopPhone: '01814697896',
    courier: { configured: false }, courierMsg: null,
    siteSettings: { logo_url: '/icons/icon-192.png' },
    adminRole: 'owner', csrfToken: 'test-csrf', assetUrl: (p) => p,
  });
  check('order-details Call link has class btn-call', detailsHtml.includes('class="btn-call">📞 Call</a>'));
  check('order-details Call link keeps the tel: href', detailsHtml.includes('href="tel:01814697896" class="btn-call"'));
  check('no inline padding style remains on the Call button', !detailsHtml.includes('style="padding:4px 10px'));
  check('order-details still shows the phone number link', detailsHtml.includes('<a href="tel:01814697896">01814697896</a>'));

  console.log('Source sweep (all admin views)');
  const viewsDir = path.join(__dirname, '..', 'views');
  const callLinks = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ejs')) {
        const src = fs.readFileSync(full, 'utf8');
        const hits = src.match(/📞 Call<\/a>/g) || [];
        hits.forEach(() => callLinks.push(path.relative(viewsDir, full)));
      }
    }
  })(viewsDir);
  check('exactly 2 "📞 Call" links in all views (activity + order-details)', callLinks.length === 2, callLinks.join(', '));
  const adminCallSrc = ['admin/activity.ejs', 'admin/order-details.ejs'].every((f) => {
    const src = fs.readFileSync(path.join(viewsDir, f), 'utf8');
    const callCount = (src.match(/📞 Call<\/a>/g) || []).length;
    const btnCallCount = (src.match(/class="btn-call"[\s\S]*?>📞 Call<\/a>/g) || []).length;
    return callCount === 1 && btnCallCount === 1;
  });
  check('every "📞 Call" link uses btn-call', adminCallSrc);
  const chatBtnUsed = [];
  (function walk2(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk2(full);
      else if (entry.name.endsWith('.ejs') && fs.readFileSync(full, 'utf8').includes('chat-call-btn')) chatBtnUsed.push(full);
    }
  })(viewsDir);
  check('.chat-call-btn is unused by any view (already a pill button; nothing to unify)', chatBtnUsed.length === 0, chatBtnUsed.join(', '));

  console.log(`\n${passes.length} passed, ${failures.length} failed`);
  if (failures.length) process.exit(1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
