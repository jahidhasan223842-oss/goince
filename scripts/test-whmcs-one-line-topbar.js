// One-line WHMCS top bar + display-name revert fix + stronger dropdown
// hover (fix/whmcs-one-line-topbar).
//
// What donal asked for (2026-11-26 10:46, with a screenshot of his own
// real WHMCS at hostseba.com/dhboss — one blue bar: logo, + button,
// Clients/Orders/Billing/... dropdowns, then a search ICON, gear,
// wrench, profile photo, help ?):
//
//   1. The profile name keeps changing back to the Gmail/email — fix it.
//      ROOT CAUSES (file + line evidence, both proven in code):
//      (a) PRE-FILL TRAP: views/admin/profile.ejs pre-filled the Display
//          Name input with the EFFECTIVE name (display_name if set, else
//          the email local part — computed in routes/admin.js GET
//          /profile), and the input was `required`. So when display_name
//          was empty, the input contained the email local part, and ANY
//          save of the details form wrote that fallback value into
//          admins.display_name (POST /profile/details UPDATEs it),
//          permanently baking the fallback into the DB. The fix pre-fills
//          the RAW stored name (empty when unset), drops `required`, and
//          passes the raw value from the GET handler.
//      (b) .ENV-FALLBACK LOGIN: routes/admin.js POST /admin/login, when
//          the typed email has NO row in `admins` but matches
//          ADMIN_EMAIL/ADMIN_PASSWORD from .env, logged in with
//          adminRow = null, so the session got adminDisplayName = null
//          and adminEmail = the TYPED email — and the header falls back
//          to the typed email's local part. Donal sometimes signed in
//          with his Gmail (jahidhasan223842@gmail.com) and sometimes
//          with admin@goince.com, so the pill flipped between
//          "jahidhasan223842" and "Jahid Hasan" on every re-login. The
//          fix loads the primary admin row (first by id) for the session
//          identity on a fallback login, so the stored display name
//          shows no matter which address was typed.
//   2. The top bar must be ONE line like his screenshot, with a search
//      ICON like that, and the day/night toggle WITH the profile. The old
//      two rows (white top bar with a big search box + dark top-nav row)
//      are merged into ONE WHMCS-blue (#1a7bb9) bar with white text:
//      brand, Dashboard + Shop/Sales/Communication/System dropdowns,
//      then search icon (click expands the search panel — the existing
//      GET /admin/search keeps working), bell, View Site globe icon,
//      theme toggle immediately next to the profile, profile pill last
//      at the far right edge. Breadcrumb stays below the bar; the mobile
//      drawer keeps working; no "+" quick-create button (not requested).
//      At <=1024px the bar wraps and the nav takes a second row inside
//      the same blue bar, so every group stays reachable on narrower
//      windows; at <=768px the drawer takes over as before.
//   3. The menu dropdowns have no colour and do not float up enough.
//      PR #61's lavender hover DID match both menus — but -1px lift is
//      barely visible and the lavender is subtle. The lavender is
//      deepened (light #e9e7f6 -> #ddd5f8, dark #37304f -> #463c6b) and
//      the lift is now translateY(-3px) with a bigger shadow, on BOTH
//      the top-nav and the profile/bell menus, still distinct from the
//      row/card hover colour.
//
// No live MySQL needed: CSS/EJS/route checks + a stubbed-DB end-to-end
// run of the real login + profile-details routes.
//
// Run:  node scripts/test-whmcs-one-line-topbar.js
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
const headerEjs = read(path.join(__dirname, '..', 'views', 'partials', 'admin-header.ejs'));
const footerEjs = read(path.join(__dirname, '..', 'views', 'partials', 'admin-footer.ejs'));
const profileEjs = read(path.join(__dirname, '..', 'views', 'admin', 'profile.ejs'));
const adminJs = read(path.join(__dirname, '..', 'routes', 'admin.js'));
const csrfJs = read(path.join(__dirname, '..', 'lib', 'csrf.js'));

const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
function allMediaRanges(text) {
  const ranges = [];
  let from = 0;
  for (;;) {
    const i = text.indexOf('@media', from);
    if (i < 0) break;
    const open = text.indexOf('{', i);
    if (open < 0) break;
    let d = 0;
    let j = open;
    for (; j < text.length; j++) {
      if (text[j] === '{') d++;
      if (text[j] === '}') { d--; if (d === 0) break; }
    }
    ranges.push([i, j + 1]);
    from = j + 1;
  }
  return ranges;
}
function stripRanges(text, ranges) {
  let out = '';
  let last = 0;
  for (const [a, b] of ranges) { out += text.slice(last, a); last = b; }
  return out + text.slice(last);
}
const cssTopLevel = stripRanges(cssNoComments, allMediaRanges(cssNoComments));
const hoverBlocks = (() => {
  let out = '';
  let from = 0;
  for (;;) {
    const i = css.indexOf('@media (hover: hover)', from);
    if (i < 0) break;
    const open = css.indexOf('{', i);
    let d = 0;
    let j = open;
    for (; j < css.length; j++) {
      if (css[j] === '{') d++;
      if (css[j] === '}') { d--; if (d === 0) break; }
    }
    out += css.slice(i, j + 1);
    from = j + 1;
  }
  return out;
})();
const mobileAdmin = (() => {
  const anchor = css.indexOf('MOBILE ADMIN CONVENTION');
  const start = css.lastIndexOf('@media (max-width: 768px)', anchor);
  const end = css.indexOf('@media (max-width: 480px)', anchor);
  return css.slice(start, end < 0 ? css.length : end);
})();
const narrowBlock = (() => {
  // Several @media (max-width: 1024px) blocks exist (shop first) — take
  // the one that holds the admin top bar rules.
  let from = 0;
  for (;;) {
    const start = css.indexOf('@media (max-width: 1024px)', from);
    if (start < 0) return '';
    const open = css.indexOf('{', start);
    let d = 0;
    let j = open;
    for (; j < css.length; j++) {
      if (css[j] === '{') d++;
      if (css[j] === '}') { d--; if (d === 0) break; }
    }
    const block = css.slice(start, j + 1);
    if (block.includes('.admin-topnav')) return block;
    from = j + 1;
  }
})();

// Header slice: everything between <header class="admin-topbar"> and
// its closing </header> (the nav now lives INSIDE the header).
const headerStart = headerEjs.indexOf('<header class="admin-topbar">');
const headerEnd = headerEjs.indexOf('</header>', headerStart);
const topbar = headerStart >= 0 && headerEnd > headerStart
  ? headerEjs.slice(headerStart, headerEnd) : '';

// --------------------------------------- 1 — display-name root causes
console.log('Display name — the two root causes are fixed in code');
check('fallback login loads the primary admin row for the session identity',
  /if \(!profileRow\) \{\s*try \{\s*const \[firstRows\] = await db\.query\('SELECT \* FROM admins ORDER BY id ASC LIMIT 1'\);/.test(adminJs)
  && adminJs.includes('req.session.adminId = profileRow ? profileRow.id : null')
  && adminJs.includes('req.session.adminEmail = profileRow ? profileRow.email : email')
  && adminJs.includes('req.session.adminDisplayName = profileRow ? (profileRow.display_name || null) : null')
  && adminJs.includes('req.session.adminPhotoUrl = profileRow ? (profileRow.photo_url || null) : null'),
  'login still builds the session from the (possibly null) typed-email row');
check('DB-row login still uses its own row (profileRow === adminRow when a row exists)',
  adminJs.includes('let profileRow = adminRow;'),
  'profileRow is not seeded from adminRow');
check('permissions resolve from the same identity row as the session',
  adminJs.includes('resolveAdminPermissions(db, profileRow || adminRow)'),
  'permissions still resolve from adminRow only');
check('GET /profile passes the RAW stored display name to the view',
  adminJs.includes('const rawDisplayName = (adminRow && adminRow.display_name) ? String(adminRow.display_name) : \'\'')
  && adminJs.includes('adminDisplayNameRaw: rawDisplayName,'),
  'GET /profile does not pass adminDisplayNameRaw');
check('profile form pre-fills the RAW stored name, not the effective name',
  profileEjs.includes('const _rawName = (typeof adminDisplayNameRaw !== \'undefined\' && adminDisplayNameRaw) ? String(adminDisplayNameRaw) : \'\'')
  && profileEjs.includes('name="display_name" value="<%= _rawName %>"'),
  'form still pre-fills the effective name');
check('display-name input is NOT required (blank = fall back to the email name)',
  (() => {
    const m = profileEjs.match(/<input[^>]*name="display_name"[^>]*>/);
    return !!m && !/required/.test(m[0]);
  })(),
  'display_name input is still required');
check('details save still updates the DB AND the session immediately',
  adminJs.includes("UPDATE admins SET display_name = ?, phone = ? WHERE id = ?")
  && adminJs.includes('req.session.adminDisplayName = result.displayName;'),
  'details save does not update the session');
check('header fallback itself is unchanged (empty display name -> email local part)',
  headerEjs.includes("(_adminEmail ? _adminEmail.split('@')[0] : 'Admin')"),
  'header fallback changed');

// --------------------------------------- 2 — one-line top bar: markup
console.log('One-line top bar — markup');
check('header contains ONE top bar and the nav lives INSIDE it (no separate top-nav row)',
  (headerEjs.match(/<header class="admin-topbar">/g) || []).length === 1
  && topbar.includes('<nav class="admin-topnav"')
  && headerEjs.indexOf('</header>') > headerEjs.indexOf('<nav class="admin-topnav"'),
  'nav is still a separate row outside the header');
check('nav keeps Dashboard + the four groups, same order and permissions',
  topbar.includes('class="admin-topnav-link') && topbar.includes('>🏠 Dashboard</a>')
  // The group definitions live in the EJS prelude BEFORE <header>, so
  // check them in the whole file, not the header slice.
  && headerEjs.includes("label: 'Shop'") && headerEjs.includes("label: 'Sales'")
  && headerEjs.includes("label: 'Communication'") && headerEjs.includes("label: 'System'"),
  'nav groups missing from the bar');
check('right-hand group order: search icon, bell, View Site globe, theme toggle, profile pill last',
  (() => {
    const i = (s) => topbar.indexOf(s);
    const search = i('id="admin-topbar-search-btn"');
    const bell = i('id="admin-bell-btn"');
    const globe = i('admin-topbar-icon-link');
    const theme = i('admin-topbar-theme-btn');
    const profile = i('id="admin-user-btn"');
    return search > 0 && bell > search && globe > bell && theme > globe && profile > theme;
  })(),
  'right-hand order is wrong');
check('theme toggle sits IMMEDIATELY next to the profile (nothing between them)',
  (() => {
    const theme = topbar.indexOf('admin-topbar-theme-btn');
    const profile = topbar.indexOf('id="admin-user-btn"');
    if (theme < 0 || profile < 0 || profile < theme) return false;
    const between = topbar.slice(theme, profile);
    return !between.includes('admin-bell-btn') && !between.includes('admin-topbar-search-btn')
      && !between.includes('admin-topbar-icon-link') && !between.includes('admin-topnav-btn');
  })(),
  'something sits between the theme toggle and the profile pill');
check('profile pill is the last item in the top bar',
  topbar.lastIndexOf('admin-topbar-dropdown') < topbar.indexOf('id="admin-user-btn"')
  && topbar.indexOf('id="admin-user-btn"') > topbar.indexOf('admin-topbar-theme-btn'),
  'profile pill is not last');
check('search is an ICON button that opens a panel (no big search box on the bar)',
  topbar.includes('id="admin-topbar-search-btn"')
  && topbar.includes('<form class="admin-topbar-search" id="admin-topbar-search" method="GET" action="/admin/search" role="search">'),
  'search form or icon button missing');
check('search form still submits to GET /admin/search',
  topbar.includes('method="GET" action="/admin/search"'),
  'search action changed');
check('View Site is a globe icon link on the bar (aria-label, opens the shop)',
  topbar.includes('class="admin-topbar-icon-link"') && topbar.includes('aria-label="View Site"')
  && topbar.includes('href="/" target="_blank"'),
  'View Site globe icon missing');
check('mobile drawer still renders the grouped nav + the full View Site link',
  headerEjs.includes('id="admin-sidebar"') && headerEjs.includes('admin-nav-group-btn')
  && headerEjs.includes('🌐 View Site'),
  'drawer lost the nav or the View Site link');
check('breadcrumb still sits below the bar, inside the main content',
  headerEjs.indexOf('</header>') < headerEjs.indexOf('<nav class="admin-breadcrumb"')
  && headerEjs.includes('<main class="admin-content">'),
  'breadcrumb moved or missing');
check('no "+" quick-create button was added (not requested)',
  !headerEjs.includes('quick-create') && !headerEjs.includes('admin-quick')
  && !/>\s*\+\s*</.test(topbar),
  'a quick-create button appeared');

// --------------------------------------- 2b — one-line top bar: CSS
console.log('One-line top bar — CSS');
check('top bar is WHMCS blue with white text (not the old soft off-white bar)',
  /\.admin-topbar\s*\{[^}]*background:\s*var\(--admin-blue\);[^}]*color:\s*#fff;/.test(cssTopLevel)
  && !/\.admin-topbar\s*\{[^}]*background:\s*var\(--surface\);/.test(cssTopLevel),
  'topbar is not blue');
check('brand is white on the blue bar',
  /\.admin-topbar-brand\s*\{[^}]*color:\s*#fff !important;/.test(cssTopLevel),
  'brand is not white');
check('search icon button is visible on desktop (inline-flex, white on blue)',
  /\.admin-topbar-search-btn\s*\{[^}]*display:\s*inline-flex;[^}]*background:\s*transparent;[^}]*color:\s*#fff;/.test(cssTopLevel),
  'search icon button still desktop-hidden');
check('search form is a hidden panel that opens with .open (desktop)',
  /\.admin-topbar-search\s*\{[^}]*display:\s*none;[^}]*position:\s*absolute;[^}]*top:\s*calc\(100% \+ 8px\);/.test(cssTopLevel)
  && /\.admin-topbar-search\.open\s*\{\s*display:\s*flex;/.test(cssTopLevel),
  'search panel rules missing');
check('right-hand group is pushed to the far right edge as one group',
  /\.admin-topbar-right\s*\{[^}]*display:\s*flex;[^}]*margin-left:\s*auto;/.test(cssTopLevel),
  'admin-topbar-right rule missing');
check('bell, View Site globe, theme toggle and profile pill are white-on-blue icon buttons',
  /\.admin-bell-btn\s*\{[^}]*background:\s*transparent;[^}]*color:\s*#fff;/.test(cssTopLevel)
  && /\.admin-topbar-icon-link\s*\{[^}]*background:\s*transparent;[^}]*color:\s*#fff;/.test(cssTopLevel)
  && /\.admin-topbar \.theme-toggle-btn\s*\{[^}]*background:\s*transparent;[^}]*color:\s*#fff;/.test(cssTopLevel)
  && /\.admin-user-btn\s*\{[^}]*background:\s*transparent;[^}]*color:\s*#fff;/.test(cssTopLevel),
  'an icon button is still the old grey chip');
check('profile avatar on the blue bar is a white circle with a blue letter',
  /\.admin-topbar \.admin-user-btn \.admin-user-avatar\s*\{\s*background:\s*#fff;\s*color:\s*var\(--admin-blue\);/.test(cssTopLevel),
  'bar avatar rule missing');
check('nav is a flex row INSIDE the bar (transparent, not a separate slate row)',
  /\.admin-topnav\s*\{[^}]*display:\s*flex;[^}]*background:\s*transparent;[^}]*position:\s*static;/.test(cssTopLevel)
  && !/\.admin-topnav\s*\{[^}]*background:\s*var\(--admin-slate\);/.test(cssTopLevel)
  && !/\.admin-topnav\s*\{[^}]*top:\s*56px;/.test(cssTopLevel),
  'nav is still a separate slate row');
check('active nav button is darker blue (visible on the blue bar, not the same blue)',
  /\.admin-topnav-link\.is-active,\s*\.admin-topnav-btn\.is-active\s*\{[^}]*background:\s*var\(--admin-blue-dark\);/.test(cssTopLevel),
  'active nav state is still var(--admin-blue)');
check('dark theme: the bar stays navy and the nav has no separate background',
  /\[data-theme="dark"\] \.admin-topbar\s*\{[^}]*background:\s*#0a1221;/.test(css)
  && /\[data-theme="dark"\] \.admin-topnav\s*\{[^}]*background:\s*transparent;/.test(css),
  'dark bar/nav wrong');
check('dark theme: the bar avatar goes back to the navy circle',
  /\[data-theme="dark"\] \.admin-topbar \.admin-user-btn \.admin-user-avatar\s*\{\s*background:\s*#2c4a73;/.test(css),
  'dark bar avatar override missing');
check('narrow windows (<=1024px): the bar wraps and the nav takes a second row inside it',
  /\.admin-topbar\s*\{\s*flex-wrap:\s*wrap;/.test(narrowBlock)
  && /\.admin-topnav\s*\{\s*flex:\s*1 1 100%;/.test(narrowBlock),
  '1024px wrap rules missing');
check('mobile (<=768px) still hides the nav row and uses the drawer',
  /\.admin-topnav\s*\{\s*display:\s*none;/.test(mobileAdmin)
  && /\.admin-sidebar\s*\{[^}]*display:\s*flex;/.test(mobileAdmin),
  'mobile nav/drawer rules changed');
check('CSS braces balanced',
  (() => { let d = 0; for (const ch of css) { if (ch === '{') d++; if (ch === '}') d--; if (d < 0) return false; } return d === 0; })(),
  'unbalanced braces');

// --------------------------------------- 3 — dropdown hover: colour + lift
console.log('Dropdown hover — visible colour + real lift');
check('dropdown hover colour is deepened in both themes, still distinct from the row/card hover',
  /--dropdown-hover:\s*#ddd5f8/.test(css) && /--dropdown-hover:\s*#463c6b/.test(css)
  && /--table-hover:\s*#e3f0f8/.test(css) && /--table-hover:\s*#22344e/.test(css),
  '--dropdown-hover not deepened or equal to --table-hover');
check('top-nav dropdown items hover with the lavender colour + -3px lift + shadow',
  /\.admin-topnav-menu-link:hover\s*\{[^}]*background:\s*var\(--dropdown-hover\);[^}]*transform:\s*translateY\(-3px\);[^}]*box-shadow:/.test(hoverBlocks),
  'top-nav item hover has no -3px lift');
check('profile/bell dropdown items hover with the same lavender colour + -3px lift + shadow',
  /\.admin-dropdown-menu a:hover\s*\{[^}]*background:\s*var\(--dropdown-hover\);[^}]*transform:\s*translateY\(-3px\);[^}]*box-shadow:/.test(hoverBlocks),
  'profile/bell item hover has no -3px lift');
check('icon buttons on the bar have a hover wash (light + dark)',
  /\.admin-topbar-search-btn:hover,[\s\S]*?\.admin-user-btn:hover\s*\{\s*background:\s*rgba\(255,\s*255,\s*255,\s*\.14\);/.test(hoverBlocks)
  && /\[data-theme="dark"\] \.admin-topbar-search-btn:hover,[\s\S]*?\[data-theme="dark"\] \.admin-user-btn:hover\s*\{\s*background:\s*#2c4a73;/.test(css),
  'icon-button hover wash missing');

// --------------------------------------- 4 — footer JS: search panel
console.log('Footer JS — search panel opens/closes like the menus');
check('search toggle stops propagation and closes open menus when opening',
  /adminSearchBtn\.addEventListener\('click', function \(e\) \{\s*e\.stopPropagation\(\);\s*closeAdminDropdowns\(null\);/.test(footerEjs),
  'search toggle does not stopPropagation / close menus');
check('a closeAdminSearch helper exists and the document click closes the panel outside it',
  footerEjs.includes('function closeAdminSearch()')
  && /document\.addEventListener\('click', function \(e\) \{\s*closeAdminDropdowns\(null\);[\s\S]*?closeAdminSearch\(\);/.test(footerEjs),
  'outside-click does not close the search panel');
check('Esc closes the search panel too',
  /if \(e\.key === 'Escape'\) \{\s*closeAdminDropdowns\(null\); closeAdminSearch\(\); \}/.test(footerEjs),
  'Esc does not close the search panel');
check('search toggle still focuses the input when opening',
  footerEjs.includes("adminSearchForm.querySelector('input[name=\"q\"]')")
  && footerEjs.includes('if (input) input.focus();'),
  'search focus lost');

// --------------------------------------- 5 — end-to-end: real login + profile routes
// Stub config/db BEFORE requiring the real admin router (the router only
// ever touches the DB through this module).
const CSRF_TOKEN = 'test-csrf-token-0123456789abcdef';
const dbPath = require.resolve('../config/db');
const adminRow = {
  id: 1, email: 'admin@goince.com', password: bcrypt.hashSync('adminpass123', 10),
  role: 'owner', role_id: null, photo_url: null, display_name: 'Jahid Hasan',
  phone: '01814697896', created_at: new Date('2026-09-19T00:00:00Z'),
};
const displayNameUpdates = [];
const dbStub = {
  query: async (sql, params) => {
    if (/SELECT \* FROM admins WHERE id/.test(sql)) return [[{ ...adminRow }]];
    if (/SELECT \* FROM admins WHERE email/.test(sql)) {
      // The .env-fallback address has NO row — that is the whole point of
      // the fallback path. The real address returns the row.
      return params && params[0] === 'jahidhasan223842@gmail.com' ? [[]] : [[{ ...adminRow }]];
    }
    if (/SELECT \* FROM admins ORDER BY id/.test(sql)) return [[{ ...adminRow }]];
    if (/UPDATE admins SET display_name/.test(sql)) {
      displayNameUpdates.push(params ? params[0] : null);
      adminRow.display_name = params ? params[0] : null;
      adminRow.phone = params ? params[1] : null;
      return [{ affectedRows: 1 }];
    }
    if (/SELECT \* FROM roles/.test(sql)) return [[]];
    if (/SELECT COUNT\(\*\) AS c/.test(sql)) return [[{ c: 0 }]];
    return [[]];
  },
};
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: dbStub };

const { csrfProtection } = require('../lib/csrf');

// One shared session object per test step, so a login POST and the
// following GETs share the session exactly like a real browser.
let currentSession = null;
function fakeSession(req, res, next) {
  if (!currentSession) currentSession = { csrfToken: CSRF_TOKEN, cookie: {} };
  req.session = currentSession;
  next();
}
function sessionLocals(req, res, next) {
  // Mirrors server.js: the header reads the name/photo from res.locals,
  // which the server copies from the session — never from the DB.
  res.locals.siteName = 'Goince';
  res.locals.adminRole = req.session.adminRole || 'owner';
  res.locals.adminPermissions = Array.isArray(req.session.adminPermissions)
    ? req.session.adminPermissions : null;
  res.locals.adminEmail = req.session.adminEmail || null;
  res.locals.adminDisplayName = req.session.adminDisplayName || null;
  res.locals.adminPhotoUrl = req.session.adminPhotoUrl || null;
  next();
}

const app = express();
app.set('views', path.join(__dirname, '..', 'views'));
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(fakeSession);
app.use(sessionLocals);
app.use(csrfProtection);
app.use('/admin', require('../routes/admin'));

function request(port, method, pathUrl, form) {
  return new Promise((resolve, reject) => {
    const body = form ? new URLSearchParams(form).toString() : '';
    const req = http.request({
      method, host: '127.0.0.1', port, path: pathUrl,
      headers: body ? { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } : {},
    }, (res) => {
      const parts = [];
      res.on('data', (c) => parts.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(parts).toString('utf8') }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}
function newSession(extra) {
  currentSession = { csrfToken: CSRF_TOKEN, cookie: {}, ...(extra || {}) };
  return currentSession;
}

(async () => {
  // .env-fallback credentials for the Gmail login test.
  const savedAdminEmail = process.env.ADMIN_EMAIL;
  const savedAdminPassword = process.env.ADMIN_PASSWORD;
  process.env.ADMIN_EMAIL = 'jahidhasan223842@gmail.com';
  process.env.ADMIN_PASSWORD = 'gmailpass';

  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.on('listening', r));
  const port = server.address().port;
  try {
    // A. DB-row login: an admin WITH a display name gets that name in
    //    the session — not the email local part.
    newSession();
    const loginA = await request(port, 'POST', '/admin/login',
      { email: 'admin@goince.com', password: 'adminpass123', _csrf: CSRF_TOKEN });
    check('E2E: DB-row login keeps the stored display name in the session',
      loginA.status === 302 && currentSession.adminDisplayName === 'Jahid Hasan'
      && currentSession.adminEmail === 'admin@goince.com' && currentSession.adminId === 1,
      `status=${loginA.status} name=${currentSession.adminDisplayName}`);

    // B. Fallback login: the Gmail address has no DB row, but the session
    //    still carries the PRIMARY row's identity — the pill shows the
    //    stored name, not "jahidhasan223842".
    newSession();
    const loginB = await request(port, 'POST', '/admin/login',
      { email: 'jahidhasan223842@gmail.com', password: 'gmailpass', _csrf: CSRF_TOKEN });
    check('E2E: .env-fallback (Gmail) login uses the primary row for the session identity',
      loginB.status === 302 && currentSession.adminId === 1
      && currentSession.adminEmail === 'admin@goince.com'
      && currentSession.adminDisplayName === 'Jahid Hasan'
      && currentSession.adminPhotoUrl === null,
      `status=${loginB.status} id=${currentSession.adminId} email=${currentSession.adminEmail} name=${currentSession.adminDisplayName}`);

    // C. Empty display name: the session carries null, and the rendered
    //    top bar falls back to the email local part ("admin").
    adminRow.display_name = null;
    newSession();
    const loginC = await request(port, 'POST', '/admin/login',
      { email: 'admin@goince.com', password: 'adminpass123', _csrf: CSRF_TOKEN });
    let pillFallback = false;
    if (loginC.status === 302 && currentSession.adminDisplayName === null) {
      const profileC = await request(port, 'GET', '/admin/profile');
      pillFallback = profileC.status === 200
        && profileC.body.includes('<span class="admin-user-name">admin</span>')
        && profileC.body.includes('name="display_name" value=""');
    }
    check('E2E: empty display name falls back to the email local part in the top bar (and the form stays empty)',
      loginC.status === 302 && currentSession.adminDisplayName === null && pillFallback,
      `status=${loginC.status} name=${currentSession.adminDisplayName} pill=${pillFallback}`);
    adminRow.display_name = 'Jahid Hasan';

    // D. Saving a new name updates the DB AND the session immediately —
    //    the top bar shows it without a re-login, and the form pre-fills
    //    the new raw name. Saving a BLANK name clears it back to the
    //    email fallback (the old pre-fill trap made that impossible).
    newSession({ isAdmin: true, adminId: 1, adminEmail: 'admin@goince.com', adminDisplayName: 'Jahid Hasan' });
    const saveD = await request(port, 'POST', '/admin/profile/details',
      { display_name: 'Donal Hasan', phone: '', _csrf: CSRF_TOKEN });
    const afterSave = await request(port, 'GET', '/admin/profile');
    check('E2E: saving a new display name updates the DB + session at once (top bar changes without re-login)',
      saveD.status === 302 && String(saveD.headers.location || '').includes('/admin/profile?saved=details')
      && displayNameUpdates.length === 1 && displayNameUpdates[0] === 'Donal Hasan'
      && adminRow.display_name === 'Donal Hasan'
      && currentSession.adminDisplayName === 'Donal Hasan'
      && afterSave.status === 200
      && afterSave.body.includes('<span class="admin-user-name">Donal Hasan</span>')
      && afterSave.body.includes('name="display_name" value="Donal Hasan"'),
      `status=${saveD.status} session=${currentSession.adminDisplayName} db=${adminRow.display_name}`);
    const clearD = await request(port, 'POST', '/admin/profile/details',
      { display_name: '', phone: '', _csrf: CSRF_TOKEN });
    const afterClear = await request(port, 'GET', '/admin/profile');
    check('E2E: saving a BLANK display name clears it — the top bar falls back to the email name again',
      clearD.status === 302 && adminRow.display_name === null
      && currentSession.adminDisplayName === null
      && afterClear.status === 200
      && afterClear.body.includes('<span class="admin-user-name">admin</span>')
      && afterClear.body.includes('name="display_name" value=""'),
      `db=${adminRow.display_name} session=${currentSession.adminDisplayName}`);
    adminRow.display_name = 'Jahid Hasan';

    // E. The search the icon opens still works: GET /admin/search renders
    //    with the same permission filtering, on the new one-line bar.
    const searchE = await request(port, 'GET', '/admin/search?q=watch');
    check('E2E: GET /admin/search still renders on the one-line bar',
      searchE.status === 200 && searchE.body.includes('<h1>Search Results</h1>')
      && searchE.body.includes('Results for')
      && searchE.body.includes('class="admin-topbar"')
      && searchE.body.includes('id="admin-topbar-search-btn"'),
      `status=${searchE.status}`);

    // F. The rendered profile page carries the new bar order end to end:
    //    nav inside the header, search icon before the bell, theme toggle
    //    right before the profile pill.
    const profileF = await request(port, 'GET', '/admin/profile');
    check('E2E: rendered profile page has the nav inside the one-line bar',
      profileF.status === 200
      && profileF.body.indexOf('<nav class="admin-topnav"') > profileF.body.indexOf('<header class="admin-topbar">')
      && profileF.body.indexOf('<nav class="admin-topnav"') < profileF.body.indexOf('</header>')
      && profileF.body.indexOf('id="admin-topbar-search-btn"') < profileF.body.indexOf('id="admin-bell-btn"')
      && profileF.body.indexOf('admin-topbar-theme-btn') < profileF.body.indexOf('id="admin-user-btn"'),
      `status=${profileF.status}`);
  } finally {
    await new Promise((r) => server.close(r));
    if (savedAdminEmail === undefined) delete process.env.ADMIN_EMAIL; else process.env.ADMIN_EMAIL = savedAdminEmail;
    if (savedAdminPassword === undefined) delete process.env.ADMIN_PASSWORD; else process.env.ADMIN_PASSWORD = savedAdminPassword;
  }

  console.log(`\n${passes.length} passed, ${failures.length} failed`);
  if (failures.length) { console.log('FAILED: ' + failures.join(' | ')); process.exitCode = 1; }
})().catch((e) => { console.error('SUITE ERROR:', e); process.exitCode = 1; });
