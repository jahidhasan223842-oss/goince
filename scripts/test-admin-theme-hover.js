// Admin theme colours, dropdown hover + lift, profile photo buttons,
// email change, reset-email investigation (fix/admin-theme-hover-profile).
//
// What donal asked for after a live inspection (2026-11-26 ~10:02, he
// signed in himself as admin@goince.com, Owner, 775x616 browser):
//
//   1. Light mode is too stark white — it hurts the eyes. Dark mode's
//      colours must stay when he switches to light (the Search button
//      was gold in dark and blue in light — the colour change itself
//      was the complaint). Keep gold only as the small logo mark.
//   2. A REAL TEXT BUG in light mode: on /admin/invoices the selected
//      "Payment: All" filter chip is a solid bright-blue pill with NO
//      legible label ("All" invisible even at 2x zoom), while Paid /
//      Unpaid / Cancelled are white with legible blue text. In dark
//      mode the same chip shows white "All" on blue and is legible.
//      ROOT CAUSE (file + line evidence): the admin link-colour rule
//      `.admin-content a:not(.btn-primary):not(.report-tab):...`
//      (style.css:841) has specificity (0,5,1) — four :not(.class)
//      clauses — which beats `.btn-sm--primary` (0,1,0), so the active
//      chip's white label was recoloured to admin-blue (#1a7bb9) on the
//      admin-blue pill: blue on blue. In dark mode the same rule sets
//      #8bb4ff, which is light enough to read on blue — that is why
//      only light mode was broken. The fix excludes every button class
//      (.btn-primary, .btn-secondary, .btn-sm, .btn-call) from that
//      rule, in light AND dark, base AND :hover.
//   3. Profile photo "Choose photo" and "Save photo" are GIANT
//      full-width bright-blue bars (~700px). ROOT CAUSE: .admin-form is
//      a column flex, so its children stretch full-width — the label
//      and the submit button are flex items. The fix gives the profile
//      page's submit buttons and the choose-photo label their natural
//      size (align-self: flex-start); the text inputs still stretch.
//   4. Dropdown hover has no lift and the wrong colour: top-nav menu
//      items turned strong mustard gold, profile menu items barely
//      changed. The gold is gone everywhere (dark --table-hover was
//      #54431c); rows/cards now hover deep blue-grey in dark mode and
//      keep pale blue in light mode, with a perceptible -3px lift on
//      cards. Dropdown items get their OWN hover colour (soft lavender
//      --dropdown-hover) + lift, so a menu option never looks like a
//      table row.
//   5. Two top-nav menus could sit open at once (Shop behind Sales):
//      the CSS :hover menu and a click-latched .open menu are
//      independent — hovering one group never closed the other's
//      latch. A mouseenter handler now closes the other menus.
//   6. Email change: a new "Change Email" section on /admin/profile
//      (new email + confirm + current password). The reset email never
//      arrives — the investigation found NO code bug: the forgot route
//      calls sendPasswordResetEmail and shows the reset link on screen
//      when sending is impossible; the mailer returns false exactly
//      when EMAIL_USER/EMAIL_PASS are not set. The blocker is the
//      missing live credential (Gmail App Password -> EMAIL_USER +
//      EMAIL_PASS in the live .env), documented in the PR body.
//
// No live MySQL needed: EJS renders + CSS/route/lib checks + a stubbed-DB
// end-to-end run of the real email-change route.
//
// Run:  node scripts/test-admin-theme-hover.js
// Exit code 0 = all checks passed.
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const util = require('util');
const ejs = require('ejs');
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
const profileEjs = read(path.join(__dirname, '..', 'views', 'admin', 'profile.ejs'));
const invoicesEjs = read(path.join(__dirname, '..', 'views', 'admin', 'invoices.ejs'));
const footerEjs = read(path.join(__dirname, '..', 'views', 'partials', 'admin-footer.ejs'));
const adminJs = read(path.join(__dirname, '..', 'routes', 'admin.js'));
const emailJs = read(path.join(__dirname, '..', 'config', 'email.js'));
const { validateEmailChange } = require('../lib/admin-profile');
const { csrfProtection } = require('../lib/csrf');

// ------------------------------------------------------- 1 — soft light mode
check('light-mode admin surfaces are soft off-white, not pure white (override rule exists)',
  /html:not\(\[data-theme="dark"\]\) body\.admin-body,\s*html:not\(\[data-theme="dark"\]\) body\.admin-login-body\s*\{\s*--surface:\s*#f7f9fb;/.test(css),
  'soft-surface override rule missing');
check('top bar is WHMCS blue now, not the soft surface (one-line bar)',
  // fix/whmcs-one-line-topbar: the whole bar is var(--admin-blue) with
  // white text — the soft #f7f9fb surface still applies to CARDS and
  // secondary buttons (checked above/below), just not to the bar.
  /\.admin-topbar\s*\{[^}]*background:\s*var\(--admin-blue\);/.test(css)
  && !/\.admin-topbar\s*\{[^}]*background:\s*var\(--surface\);/.test(css)
  && !/\.admin-topbar\s*\{[^}]*background:\s*#ffffff;/.test(css),
  'topbar is not WHMCS blue');
check('admin secondary buttons use the soft surface, not pure white',
  /\.admin-content \.btn-secondary\s*\{[^}]*background:\s*var\(--surface\);/.test(css),
  'btn-secondary still #fff');
check('page background stays pale blue-grey (not stark white)',
  /--admin-bg:\s*#eef1f5/.test(css), '--admin-bg changed');
check('dark mode surfaces are untouched by the soft-light override',
  /\[data-theme="dark"\]\s*\{[^}]*--surface:\s*#111c2f/.test(css),
  'dark --surface changed');

// ------------------------------------------- 2 — same accent colour, both modes
check('search button is the same blue in dark mode as in light mode (no gold)',
  /\.admin-topbar-search button\s*\{[^}]*background:\s*var\(--admin-blue\);[^}]*color:\s*#fff;/.test(css)
  && /\[data-theme="dark"\] \.admin-topbar-search button\s*\{[^}]*background:\s*var\(--admin-blue\);[^}]*color:\s*#fff;/.test(css),
  'search button colours differ between modes');
check('dark search button no longer uses the gold accent',
  !/\[data-theme="dark"\] \.admin-topbar-search button\s*\{[^}]*var\(--accent\)/.test(css),
  'dark search button still gold');
check('top nav is transparent inside the bar in both modes (bar is blue light / navy dark)',
  // fix/whmcs-one-line-topbar: the nav moved INTO the bar, so there is no
  // separate slate row any more — the bar carries the colour.
  /\.admin-topnav\s*\{[^}]*background:\s*transparent;/.test(css)
  && /\[data-theme="dark"\] \.admin-topnav\s*\{[^}]*background:\s*transparent;/.test(css)
  && /\[data-theme="dark"\] \.admin-topbar\s*\{[^}]*background:\s*#0a1221;/.test(css),
  'topnav still has its own background');
check('gold stays only as the small logo mark (no gold primary/search buttons in dark)',
  !/\[data-theme="dark"\] \.admin-topbar-search button\s*\{[^}]*var\(--accent\)/.test(css)
  && /\[data-theme="dark"\] \.admin-topbar-brand\s*\{\s*color:\s*#f0a500/.test(css),
  'gold used beyond the logo mark');

// --------------------------------------- 3 — invisible "All" chip (the text bug)
check('admin link-colour rule excludes every button class (light mode)',
  /\.admin-content a:not\(\.btn-primary\):not\(\.btn-secondary\):not\(\.btn-sm\):not\(\.btn-call\):not\(\.report-tab\):not\(\.analytics-report-link\):not\(\.admin-tab\)\s*\{[^}]*color:\s*var\(--admin-blue\);/.test(css),
  'light link rule still recolours buttons');
check('admin link-colour :hover rule excludes every button class too',
  /\.admin-content a:not\(\.btn-primary\):not\(\.btn-secondary\):not\(\.btn-sm\):not\(\.btn-call\):not\(\.report-tab\):not\(\.analytics-report-link\):not\(\.admin-tab\):hover/.test(css),
  'link :hover rule still recolours buttons');
check('admin link-colour rule excludes every button class (dark mode)',
  /\[data-theme="dark"\] \.admin-content a:not\(\.btn-primary\):not\(\.btn-secondary\):not\(\.btn-sm\):not\(\.btn-call\):not\(\.report-tab\):not\(\.analytics-report-link\):not\(\.admin-tab\)\s*\{[^}]*color:\s*#8bb4ff;/.test(css),
  'dark link rule still recolours buttons');
check('active payment chip keeps white text on blue (btn-sm--primary)',
  /\.btn-sm--primary\s*\{[^}]*background:\s*var\(--admin-blue\);[^}]*color:\s*#fff;/.test(css)
  && invoicesEjs.includes("class=\"btn-sm <%= tab === t ? 'btn-sm--primary' : '' %>\""),
  'btn-sm--primary text/background wrong or chip markup changed');
check('other filter chips are safe too: .admin-tab already excluded, .btn-secondary now excluded',
  css.includes('.admin-content a:not(.btn-primary):not(.btn-secondary):not(.btn-sm):not(.btn-call):not(.report-tab):not(.analytics-report-link):not(.admin-tab)'),
  'another chip class is still exposed to the link rule');
check('no other admin link rule recolours button text (audit: every .admin-content a rule excludes buttons)',
  (() => {
    const rules = css.match(/\.admin-content a(?::hover)?[^{]*\{[^}]*color:/g) || [];
    const darkRules = css.match(/\[data-theme="dark"\] \.admin-content a(?::hover)?[^{]*\{[^}]*color:/g) || [];
    const all = rules.concat(darkRules);
    return all.length > 0 && all.every((r) => r.includes('.btn-sm') || r.includes('.btn-call'));
  })(),
  'an admin link rule without the button exclusions still exists');

// --------------------------------------- 4 — profile photo buttons, normal size
check('profile submit buttons + choose-photo label are natural size, not full-width bars',
  /\.admin-profile-card \.admin-form button\[type="submit"\],\s*\.admin-profile-card \.admin-form \.admin-photo-choose\s*\{[^}]*align-self:\s*flex-start;[^}]*width:\s*auto;/.test(css),
  'profile button sizing rule missing');
check('photo form still has Choose photo + Save photo (labels unchanged)',
  profileEjs.includes('class="admin-photo-choose"') && profileEjs.includes('id="admin-photo-save-btn"'),
  'photo buttons missing from the form');
check('change-password + change-email submit buttons are inside profile forms (covered by the rule)',
  profileEjs.includes('action="/admin/settings/change-password"') && profileEjs.includes('action="/admin/profile/email"'),
  'profile forms missing');
check('forgot-password link is an inline-block button, not a stretched bar',
  /\.btn-secondary\s*\{[^}]*display:\s*inline-block/.test(css)
  && profileEjs.includes('href="/admin/forgot-password" class="btn-secondary"'),
  'forgot link is not an inline-block button');

// --------------------------------------- 5 — dropdown hover: distinct + lift
check('dropdown hover colour token exists in both themes and differs from the row/card hover',
  // fix/whmcs-one-line-topbar: the lavender is deepened so the hover is
  // unmistakable (was #e9e7f6 / #37304f).
  /--dropdown-hover:\s*#ddd5f8/.test(css) && /--dropdown-hover:\s*#463c6b/.test(css)
  && /--table-hover:\s*#e3f0f8/.test(css) && /--table-hover:\s*#22344e/.test(css),
  '--dropdown-hover missing or equal to --table-hover');
check('profile/bell dropdown items hover with the lavender colour + lift + shadow',
  /\.admin-dropdown-menu a:hover\s*\{[^}]*background:\s*var\(--dropdown-hover\);[^}]*transform:\s*translateY\(-3px\);[^}]*box-shadow:/.test(css),
  'dropdown item hover has no lift or wrong colour');
check('top-nav dropdown items hover with the same lavender colour + lift + shadow',
  /\.admin-topnav-menu-link:hover\s*\{[^}]*background:\s*var\(--dropdown-hover\);[^}]*transform:\s*translateY\(-3px\);[^}]*box-shadow:/.test(css),
  'top-nav item hover has no lift or wrong colour');
check('dropdown items transition (the lift animates, not snaps)',
  /\.admin-dropdown-menu a\s*\{[^}]*transition:[^}]*transform/.test(css)
  && /\.admin-topnav-menu-link\s*\{[^}]*transition:[^}]*transform/.test(css),
  'dropdown items have no transition');

// --------------------------------------- 6 — card/row hover: gold gone, lift real
check('dark row/card hover is deep blue-grey now, not mustard gold',
  /--table-hover:\s*#22344e/.test(css) && !/--table-hover:\s*#54431c/.test(css),
  'dark --table-hover is still the gold #54431c');
check('light row/card hover stays the soft pale blue',
  /--table-hover:\s*#e3f0f8/.test(css), 'light --table-hover changed');
check('metric cards lift perceptibly on hover (-3px + stronger shadow)',
  /\.stat-card:hover,\s*\.report-card:hover,\s*\.analytics-kpi:hover\s*\{[^}]*transform:\s*translateY\(-3px\);[^}]*box-shadow:\s*0 14px 30px/.test(css),
  'card lift still -2px or shadow unchanged');
check('panels + summary cards lift perceptibly too',
  /\.analytics-panel:hover\s*\{[^}]*transform:\s*translateY\(-3px\)/.test(css)
  && /\.report-summary-card:hover,\s*\.invoice-box:hover\s*\{[^}]*transform:\s*translateY\(-3px\)/.test(css),
  'panel lift unchanged');
check('table rows still lift via their cells (a <tr> cannot be transformed)',
  /\.admin-table tbody tr:hover td,[^{]*\{[^}]*transform:\s*translateY\(-2px\)/.test(css),
  'row cell lift missing');

// --------------------------------------- 7 — one nav dropdown at a time
check('hovering a top-nav group closes the other latched menus (mouseenter handler)',
  /document\.querySelectorAll\('\.admin-topnav-dropdown'\)\.forEach\(function \(wrap\) \{\s*wrap\.addEventListener\('mouseenter', function \(\) \{\s*var btn = wrap\.querySelector\('\[data-topnav-btn\]'\);\s*closeAdminDropdowns\(btn\);/.test(footerEjs),
  'mouseenter close-others handler missing');
check('click latching still closes the other menus (existing behaviour kept)',
  footerEjs.includes('closeAdminDropdowns(btn)') && footerEjs.includes("menu.classList.toggle('open', willOpen)"),
  'click latch behaviour changed');

// --------------------------------------- 8 — email change (pure validation)
check('validateEmailChange: bad format rejected',
  validateEmailChange({ currentEmail: 'admin@goince.com', newEmail: 'notanemail', confirmEmail: 'notanemail' }).errors.includes('email'));
check('validateEmailChange: mismatched confirmation rejected',
  validateEmailChange({ currentEmail: 'admin@goince.com', newEmail: 'new@goince.com', confirmEmail: 'other@goince.com' }).errors.includes('emailmatch'));
check('validateEmailChange: same-as-current rejected',
  validateEmailChange({ currentEmail: 'admin@goince.com', newEmail: 'admin@goince.com', confirmEmail: 'admin@goince.com' }).errors.includes('emailsame'));
check('validateEmailChange: valid new email accepted + lower-cased',
  (() => {
    const r = validateEmailChange({ currentEmail: 'admin@goince.com', newEmail: 'New@Goince.com', confirmEmail: 'new@goince.com' });
    return r.ok && r.email === 'new@goince.com';
  })());
check('email-change route exists, needs the current password, checks duplicates, updates DB + session',
  /router\.post\('\/profile\/email', requireAdmin,/.test(adminJs)
  && adminJs.includes("bcrypt.compare(req.body.current_password || '', adminRow.password)")
  && /SELECT id FROM admins WHERE email = \? AND id != \?/.test(adminJs)
  && adminJs.includes("UPDATE admins SET email = ? WHERE id = ?")
  && adminJs.includes('req.session.adminEmail = result.email'),
  'email-change route is missing a step');
check('profile page has the Change Email card (new + confirm + current password)',
  profileEjs.includes('id="change-email"')
  && profileEjs.includes('action="/admin/profile/email"')
  && profileEjs.includes('name="new_email"') && profileEjs.includes('name="confirm_new_email"')
  && profileEjs.includes('name="current_password"'),
  'Change Email card incomplete');
check('overview no longer says the email cannot be changed',
  !profileEjs.includes('it cannot be changed from this page'),
  'stale "cannot be changed" hint still on the page');

// --------------------------------------- 9 — reset email: investigation
check('mailer returns false when email is not configured (the live blocker)',
  (() => {
    delete process.env.EMAIL_USER;
    delete process.env.EMAIL_PASS;
    // Fresh require AFTER clearing the env: the transporter is built at
    // module load from these two vars, so this is the real unconfigured state.
    delete require.cache[require.resolve('../config/email')];
    const mail = require('../config/email');
    return mail.isEmailConfigured() === false;
  })());
check('forgot route calls the mailer and shows the link on screen when sending fails',
  /const sent = await sendPasswordResetEmail\(admin\.email, 'Admin', resetLink\);/.test(adminJs)
  && adminJs.includes('if (!sent)') && adminJs.includes('The email could not be sent (email is not set up)'),
  'forgot route does not fall back to the on-screen link');
check('profile Forgot Password section states the email status honestly (both branches)',
  profileEjs.includes('A reset link will be emailed to the address you enter on the next page.')
  && profileEjs.includes('Email is not set up on the server yet, so the reset link will be shown on screen'),
  'forgot section does not state the email status');

// --------------------------------------- profile page still renders
(async () => {
  let rendered = null;
  let renderError = null;
  try {
    rendered = await renderFile(path.join(__dirname, '..', 'views', 'admin', 'profile.ejs'), {
      adminName: 'Jahid Hasan', adminEmail: 'admin@goince.com', adminRoleLabel: 'Owner',
      memberSince: '19 Sep 2026', photoUrl: null, phone: '01814697896',
      profileOk: false, profileMessage: null, pwOk: false, pwMessage: null,
      emailConfigured: false, siteName: 'Goince', csrfToken: 'test-csrf-token',
      adminPermissions: null, adminNotifications: null, searchQuery: '',
    });
  } catch (e) { renderError = e.message; }
  check('profile page renders with the Change Email card + honest forgot text',
    !!rendered && rendered.includes('id="change-email"') && rendered.includes('Change Email')
    && rendered.includes('Email is not set up on the server yet'),
    renderError || 'render produced no Change Email card');
  check('profile page renders with email configured (emailed branch)',
    await (async () => {
      try {
        const out = await renderFile(path.join(__dirname, '..', 'views', 'admin', 'profile.ejs'), {
          adminName: 'Jahid Hasan', adminEmail: 'admin@goince.com', adminRoleLabel: 'Owner',
          memberSince: '19 Sep 2026', photoUrl: null, phone: '',
          profileOk: false, profileMessage: null, pwOk: false, pwMessage: null,
          emailConfigured: true, siteName: 'Goince', csrfToken: 'test-csrf-token',
          adminPermissions: null, adminNotifications: null, searchQuery: '',
        });
        return out.includes('A reset link will be emailed');
      } catch (e) { return false; }
    })(),
    'configured branch did not render');

  // ------------------------- 8 (continued) — E2E email change, real router
  // Stub config/db BEFORE requiring the real admin router.
  const dbPath = require.resolve('../config/db');
  const hashed = bcrypt.hashSync('currentpass123', 4);
  const adminRow = {
    id: 1, email: 'admin@goince.com', password: hashed, role: 'owner', role_id: 1,
    photo_url: null, display_name: null, phone: null, created_at: new Date('2026-09-19T00:00:00Z'),
  };
  const emailUpdates = [];
  const dbStub = {
    query: async (sql, params) => {
      if (/SELECT \* FROM admins WHERE id/.test(sql)) return [[{ ...adminRow }]];
      if (/SELECT \* FROM admins WHERE email/.test(sql)) return [[{ ...adminRow }]];
      if (/SELECT \* FROM admins ORDER BY id/.test(sql)) return [[{ ...adminRow }]];
      if (/SELECT id FROM admins WHERE email/.test(sql)) {
        return params && params[0] === 'taken@goince.com' ? [[{ id: 2 }]] : [[]];
      }
      if (/UPDATE admins SET email/.test(sql)) {
        emailUpdates.push(params ? params[0] : null);
        adminRow.email = params ? params[0] : adminRow.email;
        return [{ affectedRows: 1 }];
      }
      if (/UPDATE admins SET display_name/.test(sql)) return [{ affectedRows: 1 }];
      if (/SELECT COUNT\(\*\) AS c/.test(sql)) return [[{ c: 0 }]];
      return [[]];
    },
  };
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: dbStub };

  const CSRF_TOKEN = 'test-csrf-token-123456';
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

  function postForm(port, pathUrl, body) {
    return new Promise((resolve, reject) => {
      const req = http.request({
        method: 'POST', host: '127.0.0.1', port, path: pathUrl,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
      }, (res) => {
        const parts = [];
        res.on('data', (c) => parts.push(c));
        res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location || '' }));
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }
  const form = (o) => Object.entries(o).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');

  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.on('listening', r));
  const port = server.address().port;
  try {
    // A. Valid change: 302 saved=email, DB updated, session updated.
    adminRow.email = 'admin@goince.com';
    emailUpdates.length = 0;
    const ok = await postForm(port, '/admin/profile/email', form({
      _csrf: CSRF_TOKEN, new_email: 'new@goince.com', confirm_new_email: 'new@goince.com',
      current_password: 'currentpass123',
    }));
    check('E2E email change: valid request succeeds (302 saved=email, DB + session updated)',
      ok.status === 302 && ok.location === '/admin/profile?saved=email'
      && emailUpdates.length === 1 && emailUpdates[0] === 'new@goince.com'
      && lastSession && lastSession.adminEmail === 'new@goince.com',
      `status=${ok.status} loc=${ok.location} updates=${JSON.stringify(emailUpdates)} session=${lastSession && lastSession.adminEmail}`);
    adminRow.email = 'admin@goince.com';

    // B. Wrong current password: rejected, nothing updated.
    emailUpdates.length = 0;
    const wrong = await postForm(port, '/admin/profile/email', form({
      _csrf: CSRF_TOKEN, new_email: 'new2@goince.com', confirm_new_email: 'new2@goince.com',
      current_password: 'wrongpassword',
    }));
    check('E2E email change: wrong current password rejected (?err=emailpw, nothing updated)',
      wrong.status === 302 && wrong.location === '/admin/profile?err=emailpw' && emailUpdates.length === 0,
      `status=${wrong.status} loc=${wrong.location}`);

    // C. Duplicate: another admin already uses the address.
    emailUpdates.length = 0;
    const dup = await postForm(port, '/admin/profile/email', form({
      _csrf: CSRF_TOKEN, new_email: 'taken@goince.com', confirm_new_email: 'taken@goince.com',
      current_password: 'currentpass123',
    }));
    check('E2E email change: duplicate email rejected (?err=emailtaken, nothing updated)',
      dup.status === 302 && dup.location === '/admin/profile?err=emailtaken' && emailUpdates.length === 0,
      `status=${dup.status} loc=${dup.location}`);

    // D. Bad format / mismatch / same-as-current: rejected before the DB.
    emailUpdates.length = 0;
    const bad = await postForm(port, '/admin/profile/email', form({
      _csrf: CSRF_TOKEN, new_email: 'notanemail', confirm_new_email: 'notanemail',
      current_password: 'currentpass123',
    }));
    check('E2E email change: bad format rejected (?err=email, nothing updated)',
      bad.status === 302 && bad.location === '/admin/profile?err=email' && emailUpdates.length === 0,
      `status=${bad.status} loc=${bad.location}`);
    const mismatch = await postForm(port, '/admin/profile/email', form({
      _csrf: CSRF_TOKEN, new_email: 'a@goince.com', confirm_new_email: 'b@goince.com',
      current_password: 'currentpass123',
    }));
    check('E2E email change: mismatched confirmation rejected (?err=emailmatch)',
      mismatch.status === 302 && mismatch.location === '/admin/profile?err=emailmatch' && emailUpdates.length === 0,
      `status=${mismatch.status} loc=${mismatch.location}`);
    const same = await postForm(port, '/admin/profile/email', form({
      _csrf: CSRF_TOKEN, new_email: 'admin@goince.com', confirm_new_email: 'admin@goince.com',
      current_password: 'currentpass123',
    }));
    check('E2E email change: same-as-current rejected (?err=emailsame)',
      same.status === 302 && same.location === '/admin/profile?err=emailsame' && emailUpdates.length === 0,
      `status=${same.status} loc=${same.location}`);
  } finally {
    server.close();
  }

  console.log(`\n${passes.length} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    console.log('Failures:');
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exit(1);
  }
})();
