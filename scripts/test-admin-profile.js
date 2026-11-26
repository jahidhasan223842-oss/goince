// Admin profile section (fix/admin-profile-section) — EJS + CSS + route tests.
//
// Donal sent a screenshot of /admin/dashboard (dark mode) with two red
// boxes: the profile pill ("jahidhasan223842 Owner") and the standalone
// "Logout" button at the far right. He asked: move the profile further
// right / to the edge and make it compact; remove the marked Logout
// option; make the profile look professional — a proper profile section
// with everything a profile needs, including password change and
// forgot-password options.
//
// This suite asserts the concrete changes:
//
//   1. No standalone Logout remains in the admin header: the top-nav
//      Logout link and the drawer Logout link are gone. Logout lives
//      ONLY inside the profile dropdown menu (the same GET /admin/logout
//      as before — auth behaviour unchanged).
//   2. The profile pill is the LAST element of the top bar (after the
//      theme toggle): compact avatar-with-initial + name + chevron,
//      avatar-only on narrow screens. No role text in the pill.
//   3. The dropdown holds, in order: account header (avatar, name,
//      email, role badge), My Profile, divider, Logout. Change Password
//      and Forgot Password were REMOVED from the menu in
//      fix/admin-profile-photo — they live only on the profile page now.
//      It reuses the [data-dropdown-btn] behaviour (click latches, Esc /
//      outside-click / focus-out closes).
//   4. GET /admin/profile renders for every signed-in admin (requireAdmin
//      only — no permission check, so Staff can open their own profile).
//      It shows name, email, role badge and member-since (admins.created_at
//      exists); the email is read-only. Since fix/admin-profile-photo the
//      admins table also has display_name / phone / photo_url columns,
//      and the page offers name + phone editing and a photo upload.
//   5. The Change Password form posts to the EXISTING endpoint
//      POST /admin/settings/change-password (not a duplicated one), with
//      return_to=/admin/profile so the admin lands back on the profile.
//      The Settings form is unchanged (no return_to, same redirect).
//   6. Forgot Password links to the existing /admin/forgot-password flow,
//      and the profile page says honestly when email is not configured
//      (the reset link is shown on screen instead of emailed).
//   7. Dark-theme rules exist for the profile menu; the mobile block
//      pushes the profile pill (not the theme toggle) to the far right.
//
// No live MySQL needed: direct EJS renders + CSS/route source checks.
//
// Run:  node scripts/test-admin-profile.js
// Exit code 0 = all checks passed.
'use strict';

const fs = require('fs');
const path = require('path');
const util = require('util');
const ejs = require('ejs');

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
const footerEjs = read(path.join(__dirname, '..', 'views', 'partials', 'admin-footer.ejs'));
const profileEjs = read(path.join(__dirname, '..', 'views', 'admin', 'profile.ejs'));
const settingsEjs = read(path.join(__dirname, '..', 'views', 'admin', 'settings.ejs'));
const adminJs = read(path.join(__dirname, '..', 'routes', 'admin.js'));
const count = (text, needle) => text.split(needle).length - 1;

(async () => {
  // 1 — No standalone Logout in the header partial.
  check('no top-nav Logout link remains in the admin header',
    !headerEjs.includes('admin-topnav-logout'), 'admin-topnav-logout still present');
  check('no drawer Logout link remains in the admin header',
    !headerEjs.includes('logout-link'), 'logout-link still present');
  check('exactly one /admin/logout in the header — inside the profile menu',
    count(headerEjs, '/admin/logout') === 1,
    `found ${count(headerEjs, '/admin/logout')} occurrences`);
  check('the one logout link is the profile-menu logout',
    headerEjs.includes('admin-profile-menu-link admin-profile-menu-logout'),
    'profile-menu logout link missing');

  // 2 — Profile pill is the last top-bar element, compact.
  const topbarStart = headerEjs.indexOf('<header class="admin-topbar">');
  const topbarEnd = headerEjs.indexOf('</header>', topbarStart);
  const topbar = headerEjs.slice(topbarStart, topbarEnd);
  check('profile pill comes after the theme toggle in the top bar',
    topbar.indexOf('id="admin-user-btn"') > topbar.indexOf('admin-topbar-theme-btn'),
    'pill is not after the theme toggle');
  check('profile pill is the last dropdown in the top bar',
    topbar.lastIndexOf('admin-topbar-dropdown') < topbar.indexOf('id="admin-user-btn"') &&
    topbar.indexOf('id="admin-user-btn"') > topbar.lastIndexOf('admin-bell-btn'),
    'pill is not the last top-bar control');
  check('pill has aria-haspopup (dropdown button)',
    topbar.includes('aria-haspopup="true"'), 'aria-haspopup missing on the pill');
  check('pill shows an initial avatar + name + chevron, no role text',
    topbar.includes('_adminInitial') && topbar.includes('admin-user-chevron') &&
    !topbar.includes('admin-user-role'),
    'pill still shows the role or lacks the initial/chevron');

  // 3 — Dropdown contents, in order.
  const menuStart = headerEjs.indexOf('admin-profile-menu');
  const menu = headerEjs.slice(menuStart);
  check('dropdown has an account header (avatar, name, email, role badge)',
    menu.includes('admin-profile-menu-head') && menu.includes('admin-profile-menu-name') &&
    menu.includes('admin-profile-menu-email') && menu.includes('admin-profile-role-badge'),
    'account header incomplete');
  const myProfile = menu.indexOf('/admin/profile');
  const logout = menu.indexOf('/admin/logout');
  check('dropdown lists My Profile then Logout, in order (password links moved to the profile page)',
    myProfile > -1 && logout > myProfile,
    `indexes: profile=${myProfile} logout=${logout}`);
  check('Change Password and Forgot Password are NOT in the dropdown anymore',
    menu.indexOf('/admin/profile#change-password') === -1 &&
    menu.indexOf('/admin/forgot-password') === -1,
    'password links still in the dropdown');
  check('dropdown has a divider before Logout',
    menu.includes('admin-profile-menu-divider') &&
    menu.indexOf('admin-profile-menu-divider') < logout,
    'divider missing or not before Logout');
  check('top-bar dropdowns close on focus-out (same as the top nav)',
    footerEjs.includes("wrap.addEventListener('focusout'"),
    'focusout handler missing from the footer script');

  // 4 — GET /admin/profile route: requireAdmin only, no permission gate.
  check('GET /admin/profile exists and is guarded by requireAdmin only',
    /router\.get\('\/profile', requireAdmin,/.test(adminJs) &&
    !/router\.get\('\/profile', requireAdmin, requirePermission/.test(adminJs),
    'profile route missing or permission-gated');
  check('profile route reads the admin row and member-since (created_at)',
    adminJs.includes("router.get('/profile'") && adminJs.includes('created_at') &&
    adminJs.includes('memberSince'),
    'profile handler does not read created_at/memberSince');
  check('profile route passes the email-configured flag to the view',
    adminJs.includes('emailConfigured: isEmailConfigured()'),
    'emailConfigured not passed');

  // 5 — Change Password reuses the existing endpoint, no duplicate.
  check('profile change-password form posts to the existing endpoint',
    profileEjs.includes('action="/admin/settings/change-password"'),
    'profile form does not post to /admin/settings/change-password');
  check('profile form returns to /admin/profile after the change',
    profileEjs.includes('name="return_to" value="/admin/profile"'),
    'return_to hidden field missing');
  check('only one change-password POST handler exists (no duplicate)',
    count(adminJs, "router.post('/settings/change-password'") === 1 &&
    !adminJs.includes("router.post('/profile/change-password'"),
    'a second change-password handler exists');
  check('Settings change-password form is unchanged (no return_to)',
    settingsEjs.includes('action="/admin/settings/change-password"') &&
    !settingsEjs.includes('return_to'),
    'Settings form changed');

  // 6 — Forgot Password points at the existing flow.
  check('forgot-password route exists (admin flow)',
    adminJs.includes("router.get('/forgot-password'"),
    'GET /admin/forgot-password missing');
  check('profile page links Forgot Password to the existing flow',
    profileEjs.includes('href="/admin/forgot-password"'),
    'profile forgot link missing');
  check('profile page is honest when email is not configured',
    profileEjs.includes('Email is not set up on the server yet'),
    'no honest email-not-configured note');

  // 7 — Dark theme + mobile CSS.
  check('dark-theme rules exist for the profile menu',
    css.includes('[data-theme="dark"] .admin-profile-menu-head') &&
    css.includes('[data-theme="dark"] .admin-profile-menu-divider') &&
    css.includes('[data-theme="dark"] .admin-user-chevron'),
    'dark rules for the profile menu missing');
  check('mobile: profile pill (not theme toggle) is pushed to the far right',
    css.includes('.admin-topbar .admin-profile-dropdown { margin-left: auto; }') &&
    !css.includes('.admin-topbar .theme-toggle-btn { margin-left: auto; }'),
    'mobile margin-left:auto still on the theme toggle');
  check('mobile: name and chevron hide, avatar only',
    css.includes('.admin-user-name, .admin-user-chevron { display: none; }'),
    'mobile avatar-only rule missing');
  check('breadcrumb entry exists for the profile page',
    headerEjs.includes("['/admin/profile', null, 'My Profile']"),
    'profile crumb missing');

  // 8 — The profile page renders (header + footer included) for a
  // signed-in admin, in both email states, without a top-nav highlight.
  const baseLocals = {
    siteName: 'Goince', siteSettings: {}, theme: 'light', csrfToken: 'test-csrf',
    adminEmail: 'admin@goince.com', adminRole: 'Owner', adminPermissions: null,
    adminNotifications: { pendingOrders: 1, phoneQueue: 2, unreadMessages: 0, pendingReviews: 0, openOrders: 2, total: 3 },
    adminCurrentPath: '/admin/profile', searchQuery: '',
    adminName: 'admin', adminRoleLabel: 'Owner', memberSince: '19 Sep 2026',
    pwOk: false, pwMessage: null, emailConfigured: false
  };
  let html = '';
  try {
    html = await renderFile(path.join(__dirname, '..', 'views', 'admin', 'profile.ejs'), baseLocals);
  } catch (e) {
    check('profile page renders', false, e.message);
  }
  check('profile page renders with account overview (name, email, role, member since)',
    html.includes('My Profile') && html.includes('admin@goince.com') &&
    html.includes('admin-profile-role-badge') && html.includes('19 Sep 2026'),
    'overview content missing from render');
  check('rendered profile shows the email-not-configured note',
    html.includes('Email is not set up on the server yet'),
    'not-configured note missing from render');
  check('rendered profile has the change-password form + forgot link',
    html.includes('action="/admin/settings/change-password"') &&
    html.includes('href="/admin/forgot-password"'),
    'form or forgot link missing from render');
  check('rendered profile shows no top-nav active highlight',
    !html.includes('admin-topnav-link is-active') && !html.includes('admin-topnav-btn is-active'),
    'a top-nav item is wrongly highlighted on /admin/profile');
  check('rendered profile breadcrumb shows My Profile',
    html.includes('My Profile') && html.includes('admin-breadcrumb'),
    'breadcrumb missing from render');

  const htmlConfigured = await renderFile(
    path.join(__dirname, '..', 'views', 'admin', 'profile.ejs'),
    { ...baseLocals, emailConfigured: true, pwOk: true, pwMessage: 'Password changed successfully!' }
  );
  check('email-configured render says the reset link will be emailed',
    htmlConfigured.includes('A reset link will be emailed'),
    'configured-state text missing');
  check('password-change success message renders as a success message',
    htmlConfigured.includes('Password changed successfully!') &&
    htmlConfigured.includes('success-msg'),
    'success message missing or wrong class');

  console.log(`\n${passes.length} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('Failed checks:');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  process.exit(0);
})().catch((e) => { console.error('SUITE ERROR:', e); process.exit(1); });
