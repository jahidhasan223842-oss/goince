// Admin profile photo + far-right pill (fix/admin-profile-photo) —
// EJS + CSS + route + lib tests.
//
// Donal sent a new screenshot after PR #58: the profile pill sits in the
// top bar but NOT at the extreme right edge (empty space after it, red
// circle at the edge). He asked: (1) move the profile to the red circle
// — the extreme far-right edge; (2) take Change Password and Forgot
// Password OUT of the dropdown and keep them only inside My Profile;
// (3) add a profile photo upload with a stated size, and a crop option
// to choose how much of the photo to use when the size mismatches;
// (4) add email, phone number and the other fields a profile needs.
//
// This suite asserts the concrete changes:
//
//   1. The pill is flush against the top bar's right edge: the search
//      box caps at 460px and nothing absorbed the leftover width, so the
//      right group stopped short of the edge. The fix is margin-left:
//      auto on the first top-bar dropdown (the bell) — the profile pill
//      is the last element and nothing sits after it.
//   2. The dropdown holds ONLY the account header, My Profile and
//      Logout — Change Password / Forgot Password are gone from the
//      menu but still on the /admin/profile page.
//   3. The profile page has the photo upload (jpg/png/webp, 5 MB),
//      the "256 × 256" recommendation, and the crop UI (draggable
//      square + corner resize + zoom + live circle preview). The server
//      crops to a 256x256 WebP square (lib/admin-profile.js) and clamps
//      out-of-range crop values to the image bounds.
//   4. Profile details: display_name (1–60 chars, falls back to the
//      email local part when blank) + optional BD phone number (same
//      rule as the shop checkout — lib/bd-phone.js, shared). Email
//      stays read-only. New columns (photo_url, display_name, phone)
//      are added by the server-startup migration only.
//   5. The top-bar pill, dropdown header and profile page show the
//      uploaded photo when set and the initial letter when not; the
//      session carries display name + photo at login (the header never
//      queries the DB) and clears them on logout.
//
// No live MySQL needed: direct EJS renders + CSS/route/lib checks.
//
// Run:  node scripts/test-admin-profile-photo.js
// Exit code 0 = all checks passed.
'use strict';

const fs = require('fs');
const path = require('path');
const util = require('util');
const ejs = require('ejs');
const sharp = require('sharp');

const renderFile = util.promisify(ejs.renderFile);
const read = (p) => fs.readFileSync(p, 'utf8');

const failures = [];
const passes = [];
function check(name, ok, detail) {
  if (ok) { passes.push(name); console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

const css = read(path.join(__dirname, '..', 'public', 'css', 'style.css'));
const headerEjs = read(path.join(__dirname, '..', 'views', 'partials', 'admin-header.ejs'));
const profileEjs = read(path.join(__dirname, '..', 'views', 'admin', 'profile.ejs'));
const adminJs = read(path.join(__dirname, '..', 'routes', 'admin.js'));
const serverJs = read(path.join(__dirname, '..', 'server.js'));
const shopJs = read(path.join(__dirname, '..', 'routes', 'shop.js'));
const { validateProfileDetails, cropProfilePhoto } = require('../lib/admin-profile');
const { isValidBdPhone, normalizeBdPhone } = require('../lib/bd-phone');
const count = (text, needle) => text.split(needle).length - 1;

const baseLocals = {
  siteName: 'Goince', siteSettings: {}, theme: 'light', csrfToken: 'test-csrf',
  adminEmail: 'admin@goince.com', adminRole: 'Owner', adminPermissions: null,
  adminNotifications: { pendingOrders: 1, phoneQueue: 2, unreadMessages: 0, pendingReviews: 0, openOrders: 2, total: 3 },
  adminCurrentPath: '/admin/dashboard', searchQuery: ''
};

(async () => {
  // 1 — Pill flush against the far-right edge.
  check('desktop: first top-bar dropdown absorbs the free space (margin-left: auto)',
    /\.admin-topbar-dropdown\s*\{[^}]*margin-left:\s*auto/.test(css),
    'no margin-left:auto on .admin-topbar-dropdown');
  check('desktop: the auto margin is NOT on the theme toggle',
    !css.includes('.admin-topbar .theme-toggle-btn { margin-left: auto; }'),
    'theme toggle still has margin-left:auto');
  const topbarStart = headerEjs.indexOf('<header class="admin-topbar">');
  const topbarEnd = headerEjs.indexOf('</header>', topbarStart);
  const topbar = headerEjs.slice(topbarStart, topbarEnd);
  check('profile pill is the last control in the top bar (nothing after it)',
    topbar.indexOf('id="admin-user-btn"') > topbar.indexOf('admin-bell-btn') &&
    topbar.indexOf('id="admin-user-btn"') > topbar.indexOf('admin-topbar-theme-btn') &&
    topbar.trimEnd().endsWith('</div>'),
    'pill is not the last top-bar control');
  check('mobile: profile pill still pushed right on phones',
    css.includes('.admin-topbar .admin-profile-dropdown { margin-left: auto; }'),
    'mobile profile-dropdown margin rule missing');

  // 2 — Dropdown trimmed: My Profile + Logout only.
  const menuStart = headerEjs.indexOf('id="admin-user-menu"');
  const menu = headerEjs.slice(menuStart);
  check('dropdown still lists My Profile then Logout, with a divider',
    menu.indexOf('/admin/profile') > -1 &&
    menu.indexOf('/admin/logout') > menu.indexOf('/admin/profile') &&
    menu.indexOf('admin-profile-menu-divider') < menu.indexOf('/admin/logout'),
    'My Profile / divider / Logout order wrong');
  check('Change Password is GONE from the profile dropdown',
    !menu.includes('/admin/profile#change-password'),
    'change-password link still in the dropdown');
  check('Forgot Password is GONE from the profile dropdown',
    !menu.includes('/admin/forgot-password'),
    'forgot-password link still in the dropdown');
  check('exactly one /admin/logout in the header — inside the profile menu',
    count(headerEjs, '/admin/logout') === 1,
    `found ${count(headerEjs, '/admin/logout')} occurrences`);

  // 3 — Photo upload + crop UI on the profile page.
  check('profile page has the photo upload form (multipart, photo field)',
    profileEjs.includes('action="/admin/profile/photo"') &&
    profileEjs.includes('enctype="multipart/form-data"') &&
    profileEjs.includes('name="photo"'),
    'photo form/field missing');
  check('photo file input accepts jpg/png/webp only',
    profileEjs.includes('accept="image/jpeg,image/png,image/webp"'),
    'accept list wrong');
  check('recommended size is stated (square, at least 256 × 256)',
    profileEjs.includes('256 × 256'),
    '256 × 256 recommendation missing');
  check('crop UI exists: stage + draggable box + corner handle + zoom + circle preview',
    profileEjs.includes('id="admin-photo-crop-stage"') &&
    profileEjs.includes('id="admin-photo-crop-box"') &&
    profileEjs.includes('id="admin-photo-crop-handle"') &&
    profileEjs.includes('id="admin-photo-crop-zoom"') &&
    profileEjs.includes('id="admin-photo-crop-preview"'),
    'crop UI hooks missing');
  check('crop fractions are sent as hidden fields (crop_x / crop_y / crop_size)',
    profileEjs.includes('name="crop_x"') && profileEjs.includes('name="crop_y"') &&
    profileEjs.includes('name="crop_size"'),
    'hidden crop fields missing');
  check('crop box is touch-friendly (touch-action: none) and keyboard-movable',
    css.includes('.admin-photo-crop-box') && css.includes('touch-action: none') &&
    profileEjs.includes("addEventListener('keydown'"),
    'touch/keyboard support missing');
  check('remove-photo form exists',
    profileEjs.includes('action="/admin/profile/photo/remove"'),
    'remove-photo form missing');
  check('photo section CSS: stage is a square, max-width 100% (mobile-safe)',
    css.includes('.admin-photo-crop-stage') && css.includes('aspect-ratio: 1') &&
    css.includes('max-width: 100%'),
    'crop stage CSS missing');

  // 4 — Photo routes exist and are admin-only.
  check('POST /profile/photo exists (requireAdmin, upload.single)',
    /router\.post\('\/profile\/photo', requireAdmin/.test(adminJs) &&
    adminJs.includes("upload.single('photo')"),
    'photo upload route missing');
  check('POST /profile/photo/remove exists (requireAdmin)',
    /router\.post\('\/profile\/photo\/remove', requireAdmin/.test(adminJs),
    'photo remove route missing');
  check('POST /profile/details exists (requireAdmin)',
    /router\.post\('\/profile\/details', requireAdmin/.test(adminJs),
    'details route missing');
  check('photo is saved as an admin-photo-*.webp under /uploads',
    adminJs.includes("admin-photo-' + adminRow.id + '-'") &&
    adminJs.includes("'/uploads/' + filename"),
    'photo filename/path wrong');
  check('old photo file is deleted when replaced or removed',
    count(adminJs, "startsWith('/uploads/admin-photo-')") >= 2,
    'old-photo cleanup missing');

  // 5 — Server-side crop: non-square image -> 256x256 WebP, clamped.
  const testImg = await sharp({
    create: { width: 400, height: 300, channels: 3, background: { r: 200, g: 30, b: 30 } }
  }).png().toBuffer();
  const cropped = await cropProfilePhoto(testImg, { x: 0.1, y: 0.1, size: 0.5 });
  const croppedMeta = await sharp(cropped.buffer).metadata();
  check('crop: 400x300 photo with a crop box becomes a 256x256 WebP',
    cropped.width === 256 && cropped.height === 256 &&
    cropped.format === 'webp' && croppedMeta.width === 256 &&
    croppedMeta.height === 256 && croppedMeta.format === 'webp',
    `got ${croppedMeta.width}x${croppedMeta.height} ${croppedMeta.format}`);
  const clamped = await cropProfilePhoto(testImg, { x: 0.9, y: 0.9, size: 0.9 });
  const clampedMeta = await sharp(clamped.buffer).metadata();
  check('crop: out-of-range crop values are clamped, still 256x256 WebP',
    clampedMeta.width === 256 && clampedMeta.height === 256 && clampedMeta.format === 'webp',
    'clamped crop failed');
  const centred = await cropProfilePhoto(testImg, null);
  const centredMeta = await sharp(centred.buffer).metadata();
  check('crop: no crop sent falls back to a centred square, 256x256 WebP',
    centredMeta.width === 256 && centredMeta.height === 256,
    'centred fallback failed');

  // 6 — Details validation (shared BD phone rule).
  check('BD phone: 01XXXXXXXXX and +8801XXXXXXXXX are valid, 012… is not',
    isValidBdPhone('01712345678') && isValidBdPhone('+8801712345678') &&
    isValidBdPhone('8801712345678') && !isValidBdPhone('01212345678') &&
    !isValidBdPhone('0171234567') && !isValidBdPhone(''),
    'phone rule wrong');
  check('BD phone normalises +880 form to 01… form',
    normalizeBdPhone('+8801712345678') === '01712345678',
    'normalisation wrong');
  const validDetails = validateProfileDetails({ displayName: 'Jahid Hasan', phone: '+8801814697896' });
  check('details: valid name + phone pass, phone normalised',
    validDetails.ok && validDetails.displayName === 'Jahid Hasan' &&
    validDetails.phone === '01814697896',
    JSON.stringify(validDetails));
  const badPhone = validateProfileDetails({ displayName: 'Jahid', phone: '01234' });
  check('details: invalid phone is rejected',
    !badPhone.ok && badPhone.errors.includes('phone'),
    JSON.stringify(badPhone));
  const longName = validateProfileDetails({ displayName: 'x'.repeat(61), phone: '' });
  check('details: display name over 60 characters is rejected',
    !longName.ok && longName.errors.includes('name'),
    JSON.stringify(longName));
  const blank = validateProfileDetails({ displayName: '   ', phone: '  ' });
  check('details: blank name + phone pass (fallbacks apply, both null)',
    blank.ok && blank.displayName === null && blank.phone === null,
    JSON.stringify(blank));
  check('shop checkout uses the same shared phone lib',
    shopJs.includes("require('../lib/bd-phone')") && !shopJs.includes('function isValidBdPhone'),
    'shop.js still has its own copy of the phone rule');

  // 7 — New columns via the server-startup migration only.
  check('startup migration adds photo_url, display_name and phone to admins',
    serverJs.includes("ADD COLUMN photo_url VARCHAR(255)") &&
    serverJs.includes("ADD COLUMN display_name VARCHAR(60)") &&
    serverJs.includes("ADD COLUMN phone VARCHAR(20)"),
    'migration columns missing');
  check('no manual SQL file is needed for the new columns',
    !fs.existsSync(path.join(__dirname, '..', 'sql', 'add_admin_profile_columns.sql')),
    'a manual SQL file exists for the columns');
  check('login stores display name + photo in the session; logout clears them',
    adminJs.includes('req.session.adminDisplayName = adminRow') &&
    adminJs.includes('req.session.adminPhotoUrl = adminRow') &&
    adminJs.includes('req.session.adminDisplayName = null') &&
    adminJs.includes('req.session.adminPhotoUrl = null'),
    'session fields missing');
  check('profile route passes photoUrl + phone to the view',
    adminJs.includes('photoUrl,') && adminJs.includes('phone,') &&
    adminJs.includes("startsWith('/uploads/')"),
    'photoUrl/phone not passed');

  // 8 — The pill / menu / profile page show the photo when set, the
  // initial letter when not.
  const headerWithPhoto = await renderFile(
    path.join(__dirname, '..', 'views', 'partials', 'admin-header.ejs'),
    { ...baseLocals, adminDisplayName: 'Jahid Hasan', adminPhotoUrl: '/uploads/admin-photo-1-123.webp' }
  );
  check('header with photo: pill shows the photo img, not the initial',
    headerWithPhoto.includes('admin-user-btn') &&
    headerWithPhoto.includes('<img src="/uploads/admin-photo-1-123.webp"') &&
    !headerWithPhoto.includes('>J<'),
    'photo not rendered in the pill');
  check('header with photo: display name shown (not the email local part)',
    headerWithPhoto.includes('Jahid Hasan') && !headerWithPhoto.includes('>admin<'),
    'display name not used');
  const headerNoPhoto = await renderFile(
    path.join(__dirname, '..', 'views', 'partials', 'admin-header.ejs'),
    { ...baseLocals, adminDisplayName: null, adminPhotoUrl: null }
  );
  check('header without photo: pill falls back to the initial letter, no img',
    headerNoPhoto.includes('admin-user-avatar') && !headerNoPhoto.includes('<img src="/uploads/'),
    'fallback avatar wrong');

  // 9 — The profile page renders with the new sections, and the password
  // sections are still there (moved, not removed).
  const profileHtml = await renderFile(
    path.join(__dirname, '..', 'views', 'admin', 'profile.ejs'),
    {
      ...baseLocals, adminCurrentPath: '/admin/profile',
      adminName: 'Jahid Hasan', adminRoleLabel: 'Owner', memberSince: '19 Sep 2026',
      photoUrl: '/uploads/admin-photo-1-123.webp', phone: '01814697896',
      pwOk: false, pwMessage: null, emailConfigured: false,
      profileOk: true, profileMessage: 'Profile details saved.'
    }
  );
  check('rendered profile shows the photo, display name and phone',
    profileHtml.includes('<img src="/uploads/admin-photo-1-123.webp"') &&
    profileHtml.includes('Jahid Hasan') && profileHtml.includes('01814697896'),
    'photo/name/phone missing from render');
  check('rendered profile still has Change Password + Forgot Password sections',
    profileHtml.includes('id="change-password"') && profileHtml.includes('id="forgot-password"') &&
    profileHtml.includes('action="/admin/settings/change-password"') &&
    profileHtml.includes('href="/admin/forgot-password"'),
    'password sections missing from the profile page');
  check('rendered profile has the details form (display name + phone)',
    profileHtml.includes('action="/admin/profile/details"') &&
    profileHtml.includes('name="display_name"') && profileHtml.includes('name="phone"'),
    'details form missing from render');
  check('rendered profile shows the save confirmation',
    profileHtml.includes('Profile details saved.') && profileHtml.includes('success-msg'),
    'save message missing');
  const profileNoPhoto = await renderFile(
    path.join(__dirname, '..', 'views', 'admin', 'profile.ejs'),
    {
      ...baseLocals, adminCurrentPath: '/admin/profile',
      adminName: 'admin', adminRoleLabel: 'Owner', memberSince: '19 Sep 2026',
      photoUrl: null, phone: '', pwOk: false, pwMessage: null,
      emailConfigured: false, profileOk: false, profileMessage: null
    }
  );
  check('rendered profile without photo falls back to the initial avatar',
    profileNoPhoto.includes('admin-profile-avatar') && !profileNoPhoto.includes('admin-photo-current-img'),
    'photo fallback wrong');

  console.log(`\n${passes.length} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('Failed checks:');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  process.exit(0);
})().catch((e) => { console.error('SUITE ERROR:', e); process.exit(1); });
