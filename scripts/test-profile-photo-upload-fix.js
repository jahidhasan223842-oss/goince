// Profile photo upload fix (fix/profile-photo-upload) — CSRF 403 + sizing.
//
// What donal reported after PR #59 went live: "photo upload hocce na"
// (the photo upload does not work) and the profile page sections are
// too big ("eto boro boro").
//
// ROOT CAUSE of the upload failure (file + line evidence):
//   - lib/csrf.js: csrfProtection reads req.body._csrf || req.query._csrf
//     || the x-csrf-token header. Its own comment says multipart forms
//     (multer) cannot be read before the route runs, so those forms ALSO
//     carry the token in the action URL (?_csrf=...).
//   - server.js:632 mounts csrfProtection globally, BEFORE the admin
//     router (:638). express.urlencoded (:500) parses urlencoded bodies
//     before it, but a multipart body is only parsed by multer INSIDE
//     the route handler — so at check time req.body is empty.
//   - Every other multipart form in the codebase carries ?_csrf= in its
//     action (settings.ejs:8, banners.ejs:8, import-products.ejs:6,
//     import-categories.ejs:6, add-product.ejs:37, category-edit.ejs:8,
//     categories.ejs:9, product-variants.ejs:49).
//   - The profile photo form was the ONLY multipart form with a plain
//     action (/admin/profile/photo) — its hidden _csrf body field is
//     invisible to the middleware, so every submit died with
//     403 "Security check failed (invalid form token). Please go back,
//     reload the page and try again." — exactly what donal's screenshot
//     showed. The crop JS does not rebuild or fetch-submit the form, so
//     it is not the cause; the token field name (_csrf) was correct.
//   - FIX: the photo form action now carries ?_csrf= like every other
//     upload form. CSRF stays fully enforced — a submit without a valid
//     token still gets the 403.
//
// SIZING (the "too big" complaint): the profile cards stretched the full
// content width with no cap and default ~24px card titles. They are now
// capped at the admin's standard 760px form width, card titles are the
// standard 17px panel-heading size, card padding/gaps are tighter, and
// the crop stage (320px -> 280px) and circle preview (72px -> 64px) are
// smaller. The preview-size constant in the crop JS (p) must match the
// CSS preview size, or the live circle preview shows the wrong area.
//
// This suite asserts the concrete fixes:
//   1. The photo form action carries ?_csrf= (same pattern as the other
//      upload forms) and the hidden _csrf field is still in the form.
//   2. The real csrfProtection middleware: 403 without a token, pass
//      with a query token, pass with a body token.
//   3. End-to-end upload through the REAL middleware stack (real
//      csrfProtection + real admin router, stubbed DB only): a real
//      image POSTed with a valid query token succeeds (302 to
//      /admin/profile?saved=photo, a 256x256 WebP is saved under
//      /uploads, photo_url is stored, the session carries it); the same
//      POST without a token is still 403; a .txt file is rejected with
//      ?err=photo; no crop fields = centred square still works.
//   4. Compact sizing: 760px page cap, 17px card titles, tighter card
//      padding/gaps, 280px crop stage, 64px preview in CSS AND in the
//      crop JS (the two must agree).
//
// No live MySQL needed. Run:  node scripts/test-profile-photo-upload-fix.js
// Exit code 0 = all checks passed.
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const util = require('util');
const ejs = require('ejs');
const sharp = require('sharp');
const express = require('express');

const renderFile = util.promisify(ejs.renderFile);
const read = (p) => fs.readFileSync(p, 'utf8');

const failures = [];
const passes = [];
function check(name, ok, detail) {
  if (ok) { passes.push(name); console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

const css = read(path.join(__dirname, '..', 'public', 'css', 'style.css'));
const profileEjs = read(path.join(__dirname, '..', 'views', 'admin', 'profile.ejs'));
const adminJs = read(path.join(__dirname, '..', 'routes', 'admin.js'));
const serverJs = read(path.join(__dirname, '..', 'server.js'));
const csrfJs = read(path.join(__dirname, '..', 'lib', 'csrf.js'));
const { csrfProtection } = require('../lib/csrf');

// ---------------------------------------------------------------- 1 — form
// NB: the remove-photo form shares the "/admin/profile/photo" action
// prefix, so match the upload form by its full action + multipart type.
const photoForm = profileEjs.match(/<form action="\/admin\/profile\/photo<%-[\s\S]*?\?_csrf=' \+ csrfToken[\s\S]*?" method="POST" enctype="multipart\/form-data"[^>]*>/);
check('photo form action carries ?_csrf= (same pattern as the other upload forms)',
  !!photoForm,
  'photo upload form not found with a ?_csrf= action');
check('photo form still carries the hidden _csrf body field (csrf-field include)',
  !!photoForm && profileEjs.includes("<%- include('../partials/csrf-field') %>"));
check('photo form is still multipart with the photo field + crop fields',
  !!photoForm
  && profileEjs.includes('name="photo"')
  && profileEjs.includes('name="crop_x"') && profileEjs.includes('name="crop_y"')
  && profileEjs.includes('name="crop_size"'));
check('crop JS does not fetch-submit the form (no FormData/fetch submit that could drop the token)',
  !/fetch\s*\(/.test(profileEjs) && !/new FormData/.test(profileEjs));
check('CSRF is not disabled on the photo route (no exemption, still upload.single)',
  adminJs.includes("router.post('/profile/photo'") && adminJs.includes("upload.single('photo')")
  && !/profile\/photo[^]*?csrfProtection\s*\(\s*req\s*,\s*res\s*,\s*next\s*\)\s*=>\s*next\(\)/.test(adminJs));
check('lib/csrf.js documents the multipart query-token pattern (the rule the photo form broke)',
  csrfJs.includes('?_csrf=') && csrfJs.includes('Multipart forms'));
check('every other multipart form in the codebase carries ?_csrf= (photo was the only exception)',
  ['settings.ejs', 'banners.ejs', 'import-products.ejs', 'import-categories.ejs',
   'add-product.ejs', 'category-edit.ejs', 'categories.ejs', 'product-variants.ejs']
    .every((f) => {
      const t = read(path.join(__dirname, '..', 'views', 'admin', f));
      // Strip EJS tags first: an action's <%- ... %> contains '>' which
      // would cut a naive <form[^>]*> match short.
      const stripped = t.replace(/<%[-=_]?[\s\S]*?%>/g, 'EJS');
      const forms = stripped.match(/<form[^>]*enctype="multipart\/form-data"[^>]*>/g) || [];
      const tokens = (t.match(/\?_csrf=' \+ csrfToken/g) || []).length;
      return forms.length > 0 && tokens >= forms.length;
    }));
// E1 (feat/payments-messaging, batch 9): csrfProtection still
// runs globally before the admin router, but through a wrapper
// that exempts ONLY the four SSLCommerz callback paths (they post
// from SSLCommerz's own servers with no session/token, and can
// never pay an order without server-side validation).
check('csrfProtection runs globally before the admin router (server.js order)',
  (() => {
    const csrfAt = serverJs.indexOf('return csrfProtection(req, res, next);');
    const adminAt = serverJs.indexOf("app.use('/admin'");
    return csrfAt > 0 && adminAt > csrfAt
      && serverJs.includes('GATEWAY_CALLBACK_PATHS')
      && ['/payment/success', '/payment/fail', '/payment/cancel', '/payment/ipn'].every((p) => serverJs.includes("'" + p + "'"));
  })());

// ------------------------------------------------- 2 — middleware, for real
function runCsrf({ method, body, query, token }) {
  let nextCalled = false;
  let statusCode = null;
  let sentBody = '';
  const req = {
    method,
    session: { csrfToken: token },
    body,
    query: query || {},
    get: () => undefined,
  };
  const res = {
    locals: {},
    status: (c) => { statusCode = c; return { send: (m) => { sentBody = String(m); } }; },
  };
  csrfProtection(req, res, () => { nextCalled = true; });
  return { nextCalled, statusCode, sentBody };
}
const CSRF_TOKEN = 'test-csrf-token-abcdef';
check('csrf middleware: multipart-style POST with NO token is 403',
  (() => {
    const r = runCsrf({ method: 'POST', body: undefined, query: {}, token: CSRF_TOKEN });
    return !r.nextCalled && r.statusCode === 403 && r.sentBody.includes('Security check failed');
  })());
check('csrf middleware: POST with the token in the query (?_csrf=) passes',
  runCsrf({ method: 'POST', body: undefined, query: { _csrf: CSRF_TOKEN }, token: CSRF_TOKEN }).nextCalled);
check('csrf middleware: POST with the token in the body passes',
  runCsrf({ method: 'POST', body: { _csrf: CSRF_TOKEN }, query: {}, token: CSRF_TOKEN }).nextCalled);

// ------------------------------------------------------------- 4 — sizing
check('profile page is capped at the admin standard 760px form width',
  /\.admin-profile-page\s*\{[^}]*max-width:\s*760px/.test(css));
check('profile cards use tighter padding + gaps (16px, not 20px)',
  /\.admin-profile-card\s*\{[^}]*padding:\s*16px 20px[^}]*margin-top:\s*16px/.test(css));
check('profile card titles are the standard 17px panel-heading size',
  /\.admin-profile-card h2\s*\{[^}]*font-size:\s*17px/.test(css));
check('crop stage is 280px (not 320px)',
  /\.admin-photo-crop-stage\s*\{[^}]*width:\s*280px/.test(css));
check('circle preview is 64px in CSS',
  /\.admin-photo-crop-preview\s*\{[^}]*width:\s*64px[^}]*height:\s*64px/.test(css));
check('crop JS preview-size constant matches the CSS preview (p = 64)',
  /var p = 64;/.test(profileEjs));
check('profile cards sit inside the .admin-profile-page wrapper',
  profileEjs.includes('<div class="admin-profile-page">'));

// ------------------------------------------------ 3 — end-to-end upload
// Stub config/db BEFORE requiring the real admin router (the router only
// ever touches the DB through this module). The stub records photo_url
// updates so the test can prove the DB write happened.
const dbPath = require.resolve('../config/db');
const adminRow = {
  id: 1, email: 'admin@goince.com', password: 'x', role: 'owner', role_id: 1,
  photo_url: null, display_name: null, phone: null, created_at: new Date('2026-09-19T00:00:00Z'),
};
const photoUrlUpdates = [];
const dbStub = {
  query: async (sql, params) => {
    if (/SELECT \* FROM admins WHERE id/.test(sql)) return [[{ ...adminRow }]];
    if (/SELECT \* FROM admins WHERE email/.test(sql)) return [[{ ...adminRow }]];
    if (/SELECT \* FROM admins ORDER BY id/.test(sql)) return [[{ ...adminRow }]];
    if (/UPDATE admins SET photo_url/.test(sql)) {
      photoUrlUpdates.push(params ? params[0] : null);
      adminRow.photo_url = params ? params[0] : null;
      return [{ affectedRows: 1 }];
    }
    if (/UPDATE admins SET display_name/.test(sql)) return [{ affectedRows: 1 }];
    if (/SELECT COUNT\(\*\) AS c/.test(sql)) return [[{ c: 0 }]];
    return [[]];
  },
};
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: dbStub };

let lastSession = null;
function fakeSession(req, res, next) {
  req.session = {
    isAdmin: true, adminId: 1, adminEmail: 'admin@goince.com',
    adminRole: 'owner', csrfToken: CSRF_TOKEN,
  };
  lastSession = req.session;
  next();
}

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(fakeSession);
app.use(csrfProtection);
app.use('/admin', require('../routes/admin'));

const uploadsDir = path.join(__dirname, '..', 'public', 'uploads');
function listAdminPhotos() {
  return fs.readdirSync(uploadsDir).filter((f) => f.startsWith('admin-photo-'));
}
function cleanupPhotos(before) {
  for (const f of listAdminPhotos()) {
    if (!before.includes(f)) { try { fs.unlinkSync(path.join(uploadsDir, f)); } catch (e) { /* ignore */ } }
  }
}

function buildMultipart(boundary, fields, file) {
  const chunks = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
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
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
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

(async () => {
  const testJpg = await sharp({
    create: { width: 400, height: 300, channels: 3, background: { r: 200, g: 30, b: 30 } },
  }).jpeg().toBuffer();
  const testTxt = Buffer.from('this is not a photo', 'utf8');
  const boundary = '----testboundary1234';

  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.on('listening', r));
  const port = server.address().port;
  try {
    // A. The bug as donal saw it: no token at all -> 403, nothing saved.
    const beforeA = listAdminPhotos();
    const noToken = await postMultipart(port, '/admin/profile/photo',
      buildMultipart(boundary, { crop_x: '0.1', crop_y: '0.1', crop_size: '0.8' },
        { field: 'photo', filename: 'test.jpg', contentType: 'image/jpeg', buffer: testJpg }), boundary);
    check('E2E: upload WITHOUT any token is still 403 (CSRF enforced, nothing saved)',
      noToken.status === 403 && noToken.body.includes('Security check failed')
      && photoUrlUpdates.length === 0 && listAdminPhotos().length === beforeA.length);
    cleanupPhotos(beforeA);

    // B. The fixed path: valid token in the query string -> 302 saved=photo,
    //    a real 256x256 WebP on disk, photo_url stored, session updated.
    const beforeB = listAdminPhotos();
    const ok = await postMultipart(port, `/admin/profile/photo?_csrf=${CSRF_TOKEN}`,
      buildMultipart(boundary, { _csrf: CSRF_TOKEN, crop_x: '0.1', crop_y: '0.1', crop_size: '0.8' },
        { field: 'photo', filename: 'test.jpg', contentType: 'image/jpeg', buffer: testJpg }), boundary);
    const savedFile = listAdminPhotos().find((f) => !beforeB.includes(f));
    let savedMeta = null;
    if (savedFile) { try { savedMeta = await sharp(path.join(uploadsDir, savedFile)).metadata(); } catch (e) { /* ignore */ } }
    check('E2E: upload WITH a valid ?_csrf= token succeeds (302 to saved=photo)',
      ok.status === 302 && String(ok.headers.location || '').includes('/admin/profile?saved=photo'),
      `status=${ok.status} location=${ok.headers.location || ''}`);
    check('E2E: a 256x256 WebP photo is saved under /uploads',
      !!savedFile && savedMeta && savedMeta.width === 256 && savedMeta.height === 256 && savedMeta.format === 'webp',
      savedFile ? `${savedFile} ${savedMeta ? savedMeta.width + 'x' + savedMeta.height + ' ' + savedMeta.format : 'unreadable'}` : 'no file saved');
    check('E2E: photo_url is stored in the admins table',
      photoUrlUpdates.length === 1 && String(photoUrlUpdates[0]).startsWith('/uploads/admin-photo-1-')
      && String(photoUrlUpdates[0]).endsWith('.webp'),
      photoUrlUpdates[0] || 'no update recorded');
    check('E2E: the session carries the new photo (top-bar pill shows it)',
      lastSession && lastSession.adminPhotoUrl === photoUrlUpdates[0],
      lastSession ? String(lastSession.adminPhotoUrl) : 'no session captured');
    cleanupPhotos(beforeB);
    photoUrlUpdates.length = 0;

    // C. No crop fields at all (no-JS fallback): centred square still works.
    const beforeC = listAdminPhotos();
    const noCrop = await postMultipart(port, `/admin/profile/photo?_csrf=${CSRF_TOKEN}`,
      buildMultipart(boundary, { _csrf: CSRF_TOKEN },
        { field: 'photo', filename: 'test.jpg', contentType: 'image/jpeg', buffer: testJpg }), boundary);
    const savedC = listAdminPhotos().find((f) => !beforeC.includes(f));
    check('E2E: upload with no crop fields (no-JS fallback) still succeeds as a centred square',
      noCrop.status === 302 && String(noCrop.headers.location || '').includes('saved=photo') && !!savedC,
      `status=${noCrop.status}`);
    cleanupPhotos(beforeC);
    photoUrlUpdates.length = 0;

    // D. Wrong file type with a valid token: clean redirect with an error,
    //    not a crash and not a silent nothing.
    const bad = await postMultipart(port, `/admin/profile/photo?_csrf=${CSRF_TOKEN}`,
      buildMultipart(boundary, { _csrf: CSRF_TOKEN },
        { field: 'photo', filename: 'notes.txt', contentType: 'text/plain', buffer: testTxt }), boundary);
    check('E2E: a .txt file with a valid token is rejected back to the profile page with an error',
      bad.status === 302 && String(bad.headers.location || '').includes('/admin/profile?err=photo'),
      `status=${bad.status} location=${bad.headers.location || ''}`);

    // E. The saved photo renders on the profile page (EJS, with the new
    //    compact wrapper present).
    const html = await renderFile(path.join(__dirname, '..', 'views', 'admin', 'profile.ejs'), {
      adminName: 'Admin', adminEmail: 'admin@goince.com', adminRoleLabel: 'Owner',
      memberSince: '19 Sep 2026', photoUrl: '/uploads/admin-photo-1-123.webp', phone: '',
      emailConfigured: false, csrfToken: CSRF_TOKEN, siteName: 'Goince',
      profileOk: true, profileMessage: 'Profile photo saved.', pwOk: false, pwMessage: null,
    });
    check('profile page renders the saved photo inside the compact wrapper',
      html.includes('/uploads/admin-photo-1-123.webp') && html.includes('admin-profile-page')
      && html.includes('Profile photo saved.'));
  } finally {
    await new Promise((r) => server.close(r));
  }

  console.log(`\n${passes.length} passed, ${failures.length} failed`);
  if (failures.length) { console.log('FAILED: ' + failures.join(' | ')); process.exitCode = 1; }
})().catch((e) => { console.error('SUITE ERROR:', e); process.exitCode = 1; });
