// Customer profile section (fix/customer-profile-section) — the shop-side
// My Profile hub: photo upload + crop, details, change email, change
// password, forgot password, order stats + quick links, header/drawer
// avatar.
//
// What existed before: GET/POST /account/profile was a bare form
// (name/email/phone/address + a change-password form) with no photo,
// no stats, no quick links, no email-change-with-password, no
// forgot-password section, and the header showed only the text link
// "My Account". The admin profile (PRs #58-#62) already had all of
// this — this PR is the shop-side mirror for customers, reusing the
// same proven pieces (lib/admin-profile.js validation + crop,
// ?_csrf= multipart pattern, startup migration, session photo).
//
// This suite asserts:
//   1. lib/customer-profile.js: display-name fallback + member-since.
//   2. Profile page renders (EJS): hub sections, photo/crop markup,
//      stats, quick links, change email/password/forgot sections,
//      read-only email in details, photo + initial fallback.
//   3. Photo form action carries ?_csrf= (the PR #60 lesson) and the
//      hidden _csrf field is still present; crop JS is included
//      cache-busted and has no fetch/FormData submit.
//   4. End-to-end photo upload through the REAL middleware stack
//      (real csrfProtection + real auth router, stubbed DB only):
//      real JPEG + valid token -> 302 to /account/profile?saved=photo,
//      a real 256x256 WebP saved under /uploads, photo_url stored, the
//      session carries it; no token -> 403; .txt -> ?err=photo; no
//      crop fields = centred square; crop fractions clamped; old photo
//      deleted on replace; remove-photo route clears it.
//   5. Details/email/password validation through the real router:
//      bad phone rejected, blank name keeps the stored name, email
//      change validates format/match/different/duplicate + wrong
//      password, change password posts to the existing endpoint and
//      redirects with ?pw=.
//   6. Header renders the avatar img when a photo exists and the
//      initial-letter circle when it does not (desktop nav + drawer);
//      logged-out visitors still get Login / Sign Up.
//   7. server.js: startup migration adds users.photo_url, and the
//      global locals middleware exposes userPhotoUrl from the session.
//
// No live MySQL needed. Run:  node scripts/test-customer-profile.js
// Exit code 0 = all checks passed.
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const util = require('util');
const ejs = require('ejs');
const sharp = require('sharp');
const express = require('express');
const bcrypt = require('bcryptjs');

const renderFile = util.promisify(ejs.renderFile);
const read = (p) => fs.readFileSync(p, 'utf8');

const failures = [];
const passes = [];
function check(name, ok, detail) {
  if (ok) { passes.push(name); console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

const css = read(path.join(__dirname, '..', 'public', 'css', 'style.css'));
const profileEjs = read(path.join(__dirname, '..', 'views', 'auth', 'profile.ejs'));
const headerEjs = read(path.join(__dirname, '..', 'views', 'partials', 'header.ejs'));
const authJs = read(path.join(__dirname, '..', 'routes', 'auth.js'));
const serverJs = read(path.join(__dirname, '..', 'server.js'));
const cropJs = read(path.join(__dirname, '..', 'public', 'js', 'customer-photo-crop.js'));
const { csrfProtection } = require('../lib/csrf');
const { customerDisplayName, formatMemberSince } = require('../lib/customer-profile');
const { validateProfileDetails, validateEmailChange, cropProfilePhoto } = require('../lib/admin-profile');

// ------------------------------------------------------- 1 — lib helpers
check('display name: stored name is shown',
  customerDisplayName({ name: 'Rahim Uddin', email: 'rahim@example.com' }) === 'Rahim Uddin');
check('display name: blank name falls back to the email local part',
  customerDisplayName({ name: '   ', email: 'rahim.uddin@example.com' }) === 'rahim.uddin');
check('display name: missing name + missing email falls back to Customer',
  customerDisplayName({}) === 'Customer');
check('member since: formats like the admin page (same en-GB call: "19 Sep 2026" on the live server)',
  // This VM's Node ICU renders "Sept", the live server renders "Sep" —
  // the point is the helper uses the admin's exact formatting call.
  /^19 Sep\w* 2026$/.test(formatMemberSince(new Date('2026-09-19T12:00:00Z')))
  && formatMemberSince(new Date('2026-09-19T12:00:00Z'))
    === new Date('2026-09-19T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }));
check('member since: null in -> null out', formatMemberSince(null) === null);
check('details validation: name 1-60 + valid BD phone passes, phone normalised',
  (() => {
    const r = validateProfileDetails({ displayName: 'Rahim', phone: '+8801712345678' });
    return r.ok && r.displayName === 'Rahim' && r.phone === '01712345678';
  })());
check('details validation: blank name -> null (keep stored name), blank phone -> null',
  (() => {
    const r = validateProfileDetails({ displayName: '  ', phone: '' });
    return r.ok && r.displayName === null && r.phone === null;
  })());
check('details validation: 61-char name rejected, bad phone rejected',
  !validateProfileDetails({ displayName: 'x'.repeat(61), phone: '' }).ok
  && !validateProfileDetails({ displayName: 'Rahim', phone: '12345' }).ok);
check('email change validation: format / match / different / duplicate-shape',
  !validateEmailChange({ currentEmail: 'a@x.com', newEmail: 'not-an-email', confirmEmail: 'not-an-email' }).ok
  && !validateEmailChange({ currentEmail: 'a@x.com', newEmail: 'b@x.com', confirmEmail: 'c@x.com' }).ok
  && !validateEmailChange({ currentEmail: 'a@x.com', newEmail: 'a@x.com', confirmEmail: 'a@x.com' }).ok
  && validateEmailChange({ currentEmail: 'a@x.com', newEmail: 'b@x.com', confirmEmail: 'b@x.com' }).ok);

// ------------------------------------------- 2 — profile page renders (EJS)
const twoCats = [
  { id: 8, name: 'Home Appliances', totalProductCount: 3, image_url: '', children: [
    { id: 10, name: 'Kitchen', totalProductCount: 1, children: [] },
    { id: 11, name: 'Home Utility', totalProductCount: 2, children: [] },
  ] },
  { id: 9, name: 'Winter Collection', totalProductCount: 1, image_url: '', children: [] },
];
const baseLocals = {
  siteName: 'Goince',
  siteSettings: {},
  cartCount: 0,
  userName: 'Rahim Uddin',
  userPhotoUrl: null,
  search: '',
  menuCategories: twoCats,
  assetUrl: (p) => p,
  shopPhone: '01814697896',
};
const customer = {
  id: 7, name: 'Rahim Uddin', email: 'rahim@example.com', phone: '01712345678',
  address: 'Dhaka', photo_url: null, created_at: new Date('2026-09-19T00:00:00Z'),
};
async function renderProfile(overrides) {
  return renderFile(path.join(__dirname, '..', 'views', 'auth', 'profile.ejs'), {
    ...baseLocals,
    user: customer,
    displayName: 'Rahim Uddin',
    rawName: 'Rahim Uddin',
    photoUrl: null,
    memberSince: '19 Sep 2026',
    ordersCount: 3,
    totalSpent: 2450,
    emailConfigured: false,
    profileOk: false, profileMessage: null, pwOk: false, pwMessage: null,
    csrfToken: 'test-csrf-token-abcdef',
    ...overrides,
  });
}

(async () => {
  let html = '';
  try {
    html = await renderProfile({});
  } catch (e) {
    check('profile page renders (EJS)', false, String(e && e.message));
  }
  if (html) {
    check('profile page: hub header shows name + email + member since',
      html.includes('Rahim Uddin') && html.includes('rahim@example.com') && html.includes('Member since: 19 Sep 2026'));
    check('profile page: stats show total orders (3) + total spent (৳2450)',
      html.includes('Total Orders') && html.includes('>3<') && html.includes('Total Spent') && html.includes('৳2450'));
    check('profile page: quick links My Orders / Wishlist / Track Order / Logout',
      html.includes('href="/account"') && html.includes('href="/wishlist"')
      && html.includes('href="/track-order"') && html.includes('href="/logout"'));
    check('profile page: photo section with recommended size + remove state',
      html.includes('id="profile-photo"') && html.includes('at least 256 × 256 px')
      && html.includes('No photo yet — your initial is shown instead.'));
    check('profile page: crop UI markup (stage, box, handle, zoom, preview, hidden fields)',
      html.includes('id="customer-photo-crop-stage"') && html.includes('id="customer-photo-crop-box"')
      && html.includes('id="customer-photo-crop-handle"') && html.includes('id="customer-photo-crop-zoom"')
      && html.includes('id="customer-photo-crop-preview"') && html.includes('name="crop_x"')
      && html.includes('name="crop_y"') && html.includes('name="crop_size"'));
    check('profile page: details form pre-fills the RAW stored name, email read-only',
      html.includes('name="name" value="Rahim Uddin"') && html.includes('readonly')
      && html.includes('value="rahim@example.com"'));
    check('profile page: change email section (new + confirm + current password)',
      html.includes('action="/account/profile/email"') && html.includes('name="new_email"')
      && html.includes('name="confirm_new_email"') && html.includes('name="current_password"'));
    check('profile page: change password posts to the EXISTING endpoint',
      html.includes('action="/account/change-password"'));
    check('profile page: forgot password section links to the existing flow + honest email note',
      html.includes('href="/forgot-password"') && html.includes('Email is not set up on the server yet'));
    check('profile page: no-photo state shows the initial-letter circle (R)',
      html.includes('customer-profile-avatar') && />R</.test(html));
    check('profile page: crop JS is included (cache-busted assetUrl)',
      html.includes('/js/customer-photo-crop.js'));
  }

  // With a photo set, the page shows the img (not the initial).
  let htmlPhoto = '';
  try {
    htmlPhoto = await renderProfile({ photoUrl: '/uploads/customer-photo-7-123.webp' });
  } catch (e) {
    check('profile page renders with a photo', false, String(e && e.message));
  }
  if (htmlPhoto) {
    check('profile page with photo: shows the photo img + Remove photo button',
      htmlPhoto.includes('src="/uploads/customer-photo-7-123.webp"')
      && htmlPhoto.includes('action="/account/profile/photo/remove"')
      && htmlPhoto.includes('Remove photo'));
  }

  // Saved / error messages render in the right style.
  let htmlMsg = '';
  try {
    htmlMsg = await renderProfile({ profileOk: true, profileMessage: 'Profile photo saved.' });
  } catch (e) {
    check('profile page renders with a message', false, String(e && e.message));
  }
  if (htmlMsg) {
    check('profile page: success message renders as .success-msg',
      htmlMsg.includes('Profile photo saved.') && htmlMsg.includes('class="success-msg"'));
  }

  // --------------------------------------- 3 — photo form + CSRF (PR #60)
  const photoForm = profileEjs.match(/<form action="\/account\/profile\/photo<%-[\s\S]*?\?_csrf=' \+ csrfToken[\s\S]*?" method="POST" enctype="multipart\/form-data"[^>]*>/);
  check('photo form action carries ?_csrf= (the PR #60 lesson — multipart body is invisible to CSRF)',
    !!photoForm, 'customer photo upload form not found with a ?_csrf= action');
  check('photo form still carries the hidden _csrf body field (csrf-field include)',
    !!photoForm && profileEjs.includes("<%- include('../partials/csrf-field') %>"));
  check('photo form is multipart with the photo field + crop fields',
    !!photoForm && profileEjs.includes('name="photo"')
    && profileEjs.includes('name="crop_x"') && profileEjs.includes('name="crop_y"')
    && profileEjs.includes('name="crop_size"'));
  check('crop JS does not fetch-submit the form (no FormData/fetch submit that could drop the token)',
    !/fetch\s*\(/.test(cropJs) && !/new FormData/.test(cropJs));
  check('CSRF is not disabled on the customer photo route (no exemption, still upload.single)',
    authJs.includes("router.post('/account/profile/photo'") && authJs.includes("upload.single('photo')"));
  check('customer crop JS: pointer drag + resize handle + zoom + arrow keys + 64px preview constant',
    cropJs.includes('pointerdown') && cropJs.includes('customer-photo-crop-handle')
    && cropJs.includes('customer-photo-crop-zoom') && cropJs.includes('ArrowLeft')
    && /var p = 64;/.test(cropJs));
  check('crop JS is in the asset cache-busting list (lib/assets.js)',
    read(path.join(__dirname, '..', 'lib', 'assets.js')).includes('js/customer-photo-crop.js'));
  check('customer crop stage is 280px + preview 64px in CSS (matches the JS constant)',
    /\.customer-photo-crop-stage\s*\{[^}]*width:\s*280px/.test(css)
    && /\.customer-photo-crop-preview\s*\{[^}]*width:\s*64px[^}]*height:\s*64px/.test(css));
  check('profile page is capped at the 760px hub width like the admin profile',
    /\.customer-profile-page\s*\{[^}]*max-width:\s*760px/.test(css));

  // --------------------------------------- 4 — header avatar (desktop + drawer)
  async function renderHeader(overrides) {
    return renderFile(path.join(__dirname, '..', 'views', 'partials', 'header.ejs'), {
      ...baseLocals, ...overrides,
    });
  }
  let headerPhoto = '';
  try {
    headerPhoto = await renderHeader({ userName: 'Rahim Uddin', userPhotoUrl: '/uploads/customer-photo-7-123.webp' });
  } catch (e) {
    check('header renders logged-in with a photo', false, String(e && e.message));
  }
  if (headerPhoto) {
    check('header (logged in, photo): avatar img next to the name, links to the profile hub',
      headerPhoto.includes('src="/uploads/customer-photo-7-123.webp"')
      && headerPhoto.includes('href="/account/profile"') && headerPhoto.includes('Rahim Uddin'));
    check('header (logged in, photo): drawer shows the same avatar + name',
      headerPhoto.includes('shop-drawer-account') && headerPhoto.includes('shop-drawer-avatar'));
  }
  let headerNoPhoto = '';
  try {
    headerNoPhoto = await renderHeader({ userName: 'Rahim Uddin', userPhotoUrl: null });
  } catch (e) {
    check('header renders logged-in without a photo', false, String(e && e.message));
  }
  if (headerNoPhoto) {
    check('header (logged in, no photo): initial-letter circle (R) instead of an img',
      headerNoPhoto.includes('shop-user-avatar') && />R</.test(headerNoPhoto)
      && !headerNoPhoto.includes('customer-photo-'));
  }
  let headerLoggedOut = '';
  try {
    headerLoggedOut = await renderHeader({ userName: '', userPhotoUrl: null });
  } catch (e) {
    check('header renders logged-out', false, String(e && e.message));
  }
  if (headerLoggedOut) {
    check('header (logged out): Login / Sign Up buttons, no avatar',
      headerLoggedOut.includes('href="/login"') && headerLoggedOut.includes('href="/signup"')
      && !headerLoggedOut.includes('shop-user-avatar'));
  }

  // --------------------------------------- 5 — server.js migration + locals
  check('server.js: startup migration adds users.photo_url (additive, guarded)',
    /ALTER TABLE users ADD COLUMN photo_url VARCHAR\(255\) DEFAULT NULL/.test(serverJs));
  check('server.js: global locals expose userPhotoUrl from the session (header never queries the DB)',
    serverJs.includes('res.locals.userPhotoUrl = req.session.userPhotoUrl'));
  check('routes/auth.js: login stores the photo in the session, signup clears it',
    authJs.includes('req.session.userPhotoUrl = user.photo_url || null')
    && authJs.includes('req.session.userPhotoUrl = null'));
  check('routes/auth.js: no admin route/view touched (admin profile untouched)',
    !/admin\/profile/.test(authJs) && !/views\/admin/.test(authJs));

  // --------------------------- 6 — end-to-end through the REAL stack
  // Stub config/db BEFORE requiring the real auth router. The stub
  // records photo_url updates so the test can prove the DB write.
  const dbPath = require.resolve('../config/db');
  const userRow = {
    id: 7, name: 'Rahim Uddin', email: 'rahim@example.com',
    password: await bcrypt.hash('oldpass123', 10),
    phone: '01712345678', address: 'Dhaka', photo_url: null,
    created_at: new Date('2026-09-19T00:00:00Z'),
  };
  const otherUser = { id: 8, name: 'Other', email: 'other@example.com', password: 'x', phone: null, address: null, photo_url: null };
  const photoUrlUpdates = [];
  const nameUpdates = [];
  const emailUpdates = [];
  const passwordUpdates = [];
  const dbStub = {
    query: async (sql, params) => {
      if (/SELECT \* FROM users WHERE id/.test(sql)) return [[{ ...userRow }]];
      if (/SELECT id FROM users WHERE email/.test(sql)) {
        const email = params ? params[0] : null;
        return [email === 'other@example.com' ? [{ id: 8 }] : []];
      }
      if (/UPDATE users SET photo_url = \?/.test(sql)) {
        photoUrlUpdates.push(params ? params[0] : null);
        userRow.photo_url = params ? params[0] : null;
        return [{ affectedRows: 1 }];
      }
      if (/UPDATE users SET photo_url = NULL/.test(sql)) {
        userRow.photo_url = null;
        return [{ affectedRows: 1 }];
      }
      if (/UPDATE users SET name=/.test(sql)) {
        nameUpdates.push(params);
        userRow.name = params[0];
        userRow.phone = params[1];
        userRow.address = params[2];
        return [{ affectedRows: 1 }];
      }
      if (/UPDATE users SET email/.test(sql)) {
        emailUpdates.push(params ? params[0] : null);
        userRow.email = params ? params[0] : null;
        return [{ affectedRows: 1 }];
      }
      if (/UPDATE users SET password/.test(sql)) {
        passwordUpdates.push(params ? params[0] : null);
        userRow.password = params ? params[0] : null;
        return [{ affectedRows: 1 }];
      }
      if (/COUNT\(\*\) AS ordersCount/.test(sql)) {
        return [[{ ordersCount: 3, totalSpent: 2450 }]];
      }
      return [[]];
    },
  };
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: dbStub };

  const CSRF_TOKEN = 'test-csrf-token-abcdef';
  let lastSession = null;
  function fakeSession(req, res, next) {
    req.session = { userId: 7, userName: 'Rahim Uddin', userPhotoUrl: userRow.photo_url, csrfToken: CSRF_TOKEN };
    lastSession = req.session;
    next();
  }

  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(fakeSession);
  app.use(csrfProtection);
  app.use('/', require('../routes/auth'));

  const uploadsDir = path.join(__dirname, '..', 'public', 'uploads');
  function listCustomerPhotos() {
    return fs.readdirSync(uploadsDir).filter((f) => f.startsWith('customer-photo-'));
  }
  function cleanupPhotos(before) {
    for (const f of listCustomerPhotos()) {
      if (!before.includes(f)) { try { fs.unlinkSync(path.join(uploadsDir, f)); } catch (e) { /* ignore */ } }
    }
  }
  function buildMultipart(boundary, fields, file) {
    const chunks = [];
    for (const [name, value] of Object.entries(fields)) {
      chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
    }
    if (file) {
      chunks.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.filename}"\r\n` +
        `Content-Type: ${file.contentType}\r\n\r\n`));
      chunks.push(file.buffer);
      chunks.push(Buffer.from('\r\n'));
    }
    chunks.push(Buffer.from(`--${boundary}--\r\n`));
    return Buffer.concat(chunks);
  }
  function postMultipart(port, pathUrl, body, boundary) {
    return new Promise((resolve, reject) => {
      const req = http.request({
        method: 'POST', host: '127.0.0.1', port, path: pathUrl,
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length },
      }, (res) => {
        const parts = [];
        res.on('data', (c) => parts.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(parts).toString('utf8') }));
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }
  function postForm(port, pathUrl, body) {
    return new Promise((resolve, reject) => {
      const req = http.request({
        method: 'POST', host: '127.0.0.1', port, path: pathUrl,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
      }, (res) => {
        const parts = [];
        res.on('data', (c) => parts.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(parts).toString('utf8') }));
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  const testJpg = await sharp({
    create: { width: 400, height: 300, channels: 3, background: { r: 30, g: 120, b: 200 } },
  }).jpeg().toBuffer();
  const testTxt = Buffer.from('this is not a photo', 'utf8');
  const boundary = '----testboundary5678';

  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.on('listening', r));
  const port = server.address().port;
  try {
    // A. No token at all -> 403, nothing saved (the PR #60 bug, still guarded).
    const beforeA = listCustomerPhotos();
    const noToken = await postMultipart(port, '/account/profile/photo',
      buildMultipart(boundary, { crop_x: '0.1', crop_y: '0.1', crop_size: '0.8' },
        { field: 'photo', filename: 'test.jpg', contentType: 'image/jpeg', buffer: testJpg }), boundary);
    check('E2E photo: upload WITHOUT any token is still 403 (CSRF enforced, nothing saved)',
      noToken.status === 403 && noToken.body.includes('Security check failed')
      && photoUrlUpdates.length === 0 && listCustomerPhotos().length === beforeA.length);
    cleanupPhotos(beforeA);

    // B. Valid token in the query string -> 302 saved=photo, real 256x256
    //    WebP on disk, photo_url stored, session updated.
    const beforeB = listCustomerPhotos();
    const ok = await postMultipart(port, `/account/profile/photo?_csrf=${CSRF_TOKEN}`,
      buildMultipart(boundary, { _csrf: CSRF_TOKEN, crop_x: '0.1', crop_y: '0.1', crop_size: '0.8' },
        { field: 'photo', filename: 'test.jpg', contentType: 'image/jpeg', buffer: testJpg }), boundary);
    const savedFile = listCustomerPhotos().find((f) => !beforeB.includes(f));
    let savedMeta = null;
    if (savedFile) { try { savedMeta = await sharp(path.join(uploadsDir, savedFile)).metadata(); } catch (e) { /* ignore */ } }
    check('E2E photo: upload WITH a valid ?_csrf= token succeeds (302 to saved=photo)',
      ok.status === 302 && String(ok.headers.location || '').includes('/account/profile?saved=photo'),
      `status=${ok.status} location=${ok.headers.location || ''}`);
    check('E2E photo: a 256x256 WebP photo is saved under /uploads',
      !!savedFile && savedMeta && savedMeta.width === 256 && savedMeta.height === 256 && savedMeta.format === 'webp',
      savedFile ? `${savedFile} ${savedMeta ? savedMeta.width + 'x' + savedMeta.height + ' ' + savedMeta.format : 'unreadable'}` : 'no file saved');
    check('E2E photo: photo_url is stored in the users table',
      photoUrlUpdates.length === 1 && String(photoUrlUpdates[0]).startsWith('/uploads/customer-photo-7-')
      && String(photoUrlUpdates[0]).endsWith('.webp'),
      photoUrlUpdates[0] || 'no update recorded');
    check('E2E photo: the session carries the new photo (header avatar shows it)',
      lastSession && lastSession.userPhotoUrl === photoUrlUpdates[0],
      lastSession ? String(lastSession.userPhotoUrl) : 'no session captured');

    // B2. Replace: uploading again deletes the old photo file.
    const beforeB2 = listCustomerPhotos();
    const ok2 = await postMultipart(port, `/account/profile/photo?_csrf=${CSRF_TOKEN}`,
      buildMultipart(boundary, { _csrf: CSRF_TOKEN },
        { field: 'photo', filename: 'test2.jpg', contentType: 'image/jpeg', buffer: testJpg }), boundary);
    check('E2E photo: replacing the photo deletes the old file (only the new one remains)',
      ok2.status === 302 && listCustomerPhotos().length === beforeB2.length
      && savedFile && !fs.existsSync(path.join(uploadsDir, savedFile)),
      `files=${listCustomerPhotos().join(',')}`);
    cleanupPhotos([]);
    photoUrlUpdates.length = 0;

    // C. No crop fields at all (no-JS fallback): centred square still works.
    const beforeC = listCustomerPhotos();
    const noCrop = await postMultipart(port, `/account/profile/photo?_csrf=${CSRF_TOKEN}`,
      buildMultipart(boundary, { _csrf: CSRF_TOKEN },
        { field: 'photo', filename: 'test.jpg', contentType: 'image/jpeg', buffer: testJpg }), boundary);
    const savedC = listCustomerPhotos().find((f) => !beforeC.includes(f));
    let metaC = null;
    if (savedC) { try { metaC = await sharp(path.join(uploadsDir, savedC)).metadata(); } catch (e) { /* ignore */ } }
    check('E2E photo: upload with no crop fields (no-JS fallback) still succeeds as a centred square',
      noCrop.status === 302 && String(noCrop.headers.location || '').includes('saved=photo') && !!savedC
      && metaC && metaC.width === 256 && metaC.height === 256,
      `status=${noCrop.status}`);
    cleanupPhotos(beforeC);
    photoUrlUpdates.length = 0;

    // C2. Out-of-bounds crop fractions are clamped (never read outside the image).
    const outCrop = await postMultipart(port, `/account/profile/photo?_csrf=${CSRF_TOKEN}`,
      buildMultipart(boundary, { _csrf: CSRF_TOKEN, crop_x: '5', crop_y: '-2', crop_size: '9' },
        { field: 'photo', filename: 'test.jpg', contentType: 'image/jpeg', buffer: testJpg }), boundary);
    check('E2E photo: out-of-bounds crop fractions are clamped (still 302, no crash)',
      outCrop.status === 302 && String(outCrop.headers.location || '').includes('saved=photo'),
      `status=${outCrop.status}`);
    cleanupPhotos([]);
    photoUrlUpdates.length = 0;

    // D. Wrong file type with a valid token: clean redirect with an error.
    const bad = await postMultipart(port, `/account/profile/photo?_csrf=${CSRF_TOKEN}`,
      buildMultipart(boundary, { _csrf: CSRF_TOKEN },
        { field: 'photo', filename: 'notes.txt', contentType: 'text/plain', buffer: testTxt }), boundary);
    check('E2E photo: a .txt file with a valid token is rejected back to the profile page with an error',
      bad.status === 302 && String(bad.headers.location || '').includes('/account/profile?err=photo'),
      `status=${bad.status} location=${bad.headers.location || ''}`);

    // E. Remove photo: clears the DB + the session, deletes the file.
    const beforeE = listCustomerPhotos();
    await postMultipart(port, `/account/profile/photo?_csrf=${CSRF_TOKEN}`,
      buildMultipart(boundary, { _csrf: CSRF_TOKEN },
        { field: 'photo', filename: 'test.jpg', contentType: 'image/jpeg', buffer: testJpg }), boundary);
    const savedE = listCustomerPhotos().find((f) => !beforeE.includes(f));
    const removed = await postForm(port, `/account/profile/photo/remove?_csrf=${CSRF_TOKEN}`, `_csrf=${CSRF_TOKEN}`);
    check('E2E photo: remove-photo clears the DB + session and deletes the file',
      removed.status === 302 && String(removed.headers.location || '').includes('saved=removed')
      && userRow.photo_url === null && lastSession.userPhotoUrl === null
      && (!savedE || !fs.existsSync(path.join(uploadsDir, savedE))),
      `status=${removed.status} location=${removed.headers.location || ''}`);
    cleanupPhotos([]);
    photoUrlUpdates.length = 0;

    // ----------------------- 7 — details / email / password (real router)
    // Details: valid save.
    const details = await postForm(port, `/account/profile?_csrf=${CSRF_TOKEN}`,
      `_csrf=${CSRF_TOKEN}&name=${encodeURIComponent('Rahim Khan')}&phone=%2B8801712345678&address=${encodeURIComponent('Mirpur, Dhaka')}`);
    check('E2E details: valid save redirects to saved=details, phone normalised to 01XXXXXXXXX',
      details.status === 302 && String(details.headers.location || '').includes('saved=details')
      && nameUpdates.length === 1 && nameUpdates[0][0] === 'Rahim Khan' && nameUpdates[0][1] === '01712345678',
      `status=${details.status} location=${details.headers.location || ''} updates=${JSON.stringify(nameUpdates[0] || null)}`);
    nameUpdates.length = 0;

    // Details: bad phone rejected.
    const badPhone = await postForm(port, `/account/profile?_csrf=${CSRF_TOKEN}`,
      `_csrf=${CSRF_TOKEN}&name=${encodeURIComponent('Rahim Khan')}&phone=12345&address=`);
    check('E2E details: bad phone is rejected back with ?err=phone (nothing saved)',
      badPhone.status === 302 && String(badPhone.headers.location || '').includes('err=phone')
      && nameUpdates.length === 0,
      `status=${badPhone.status} location=${badPhone.headers.location || ''}`);

    // Details: blank name keeps the stored name (never bakes the fallback in).
    const blankName = await postForm(port, `/account/profile?_csrf=${CSRF_TOKEN}`,
      `_csrf=${CSRF_TOKEN}&name=&phone=&address=`);
    check('E2E details: blank name keeps the stored name (no fallback baked into the DB)',
      blankName.status === 302 && String(blankName.headers.location || '').includes('saved=details')
      && nameUpdates.length === 1 && nameUpdates[0][0] === 'Rahim Khan',
      `updates=${JSON.stringify(nameUpdates[0] || null)}`);
    nameUpdates.length = 0;

    // Details: email in the form is ignored (read-only in this section).
    const emailIgnored = await postForm(port, `/account/profile?_csrf=${CSRF_TOKEN}`,
      `_csrf=${CSRF_TOKEN}&name=${encodeURIComponent('Rahim Khan')}&email=${encodeURIComponent('hacker@example.com')}&phone=&address=`);
    check('E2E details: a submitted email is ignored (email changes only in its own section)',
      emailIgnored.status === 302 && userRow.email === 'rahim@example.com' && emailUpdates.length === 0);
    nameUpdates.length = 0;

    // Email change: valid.
    const emailOk = await postForm(port, `/account/profile/email?_csrf=${CSRF_TOKEN}`,
      `_csrf=${CSRF_TOKEN}&new_email=${encodeURIComponent('rahim.new@example.com')}&confirm_new_email=${encodeURIComponent('rahim.new@example.com')}&current_password=${encodeURIComponent('oldpass123')}`);
    check('E2E email: valid change with the right current password redirects to saved=email',
      emailOk.status === 302 && String(emailOk.headers.location || '').includes('saved=email')
      && emailUpdates.length === 1 && emailUpdates[0] === 'rahim.new@example.com',
      `status=${emailOk.status} location=${emailOk.headers.location || ''}`);
    emailUpdates.length = 0;

    // Email change: wrong current password.
    const emailPw = await postForm(port, `/account/profile/email?_csrf=${CSRF_TOKEN}`,
      `_csrf=${CSRF_TOKEN}&new_email=${encodeURIComponent('rahim2@example.com')}&confirm_new_email=${encodeURIComponent('rahim2@example.com')}&current_password=${encodeURIComponent('wrongpass')}`);
    check('E2E email: wrong current password is rejected (?err=emailpw, nothing saved)',
      emailPw.status === 302 && String(emailPw.headers.location || '').includes('err=emailpw') && emailUpdates.length === 0);

    // Email change: same as current.
    const emailSame = await postForm(port, `/account/profile/email?_csrf=${CSRF_TOKEN}`,
      `_csrf=${CSRF_TOKEN}&new_email=${encodeURIComponent('rahim.new@example.com')}&confirm_new_email=${encodeURIComponent('rahim.new@example.com')}&current_password=${encodeURIComponent('oldpass123')}`);
    check('E2E email: same-as-current address is rejected (?err=emailsame)',
      emailSame.status === 302 && String(emailSame.headers.location || '').includes('err=emailsame'));

    // Email change: taken by another account.
    const emailTaken = await postForm(port, `/account/profile/email?_csrf=${CSRF_TOKEN}`,
      `_csrf=${CSRF_TOKEN}&new_email=${encodeURIComponent('other@example.com')}&confirm_new_email=${encodeURIComponent('other@example.com')}&current_password=${encodeURIComponent('oldpass123')}`);
    check('E2E email: an address owned by another account is rejected (?err=emailtaken)',
      emailTaken.status === 302 && String(emailTaken.headers.location || '').includes('err=emailtaken') && emailUpdates.length === 0);

    // Email change: mismatched confirmation.
    const emailMismatch = await postForm(port, `/account/profile/email?_csrf=${CSRF_TOKEN}`,
      `_csrf=${CSRF_TOKEN}&new_email=${encodeURIComponent('a@example.com')}&confirm_new_email=${encodeURIComponent('b@example.com')}&current_password=${encodeURIComponent('oldpass123')}`);
    check('E2E email: mismatched confirmation is rejected (?err=emailmatch)',
      emailMismatch.status === 302 && String(emailMismatch.headers.location || '').includes('err=emailmatch'));

    // Password change: valid, via the EXISTING endpoint.
    const pwOk = await postForm(port, `/account/change-password?_csrf=${CSRF_TOKEN}`,
      `_csrf=${CSRF_TOKEN}&current_password=${encodeURIComponent('oldpass123')}&new_password=${encodeURIComponent('newpass456')}&confirm_new_password=${encodeURIComponent('newpass456')}`);
    const pwMatches = passwordUpdates.length === 1 && await bcrypt.compare('newpass456', passwordUpdates[0]);
    check('E2E password: change via the existing endpoint redirects to ?pw=ok and stores a bcrypt hash of the new password',
      pwOk.status === 302 && String(pwOk.headers.location || '').includes('pw=ok') && pwMatches,
      `status=${pwOk.status} location=${pwOk.headers.location || ''}`);
    passwordUpdates.length = 0;

    // Password change: wrong current password.
    const pwWrong = await postForm(port, `/account/change-password?_csrf=${CSRF_TOKEN}`,
      `_csrf=${CSRF_TOKEN}&current_password=${encodeURIComponent('nope')}&new_password=${encodeURIComponent('newpass456')}&confirm_new_password=${encodeURIComponent('newpass456')}`);
    check('E2E password: wrong current password is rejected (?pw=wrong, nothing saved)',
      pwWrong.status === 302 && String(pwWrong.headers.location || '').includes('pw=wrong') && passwordUpdates.length === 0);
  } finally {
    await new Promise((r) => server.close(r));
    cleanupPhotos([]);
  }

  console.log(`\n${passes.length} passed, ${failures.length} failed`);
  if (failures.length) { console.log('FAILED: ' + failures.join(' | ')); process.exitCode = 1; }
})().catch((e) => { console.error('SUITE ERROR:', e); process.exitCode = 1; });
