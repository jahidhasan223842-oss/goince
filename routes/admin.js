// All admin panel routes: Login, Dashboard, Product/Order/Coupon/Customer Manage
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { getCourierConfig, createConsignment, getTrackingStatus } = require('../lib/courier');
const { sendSms, sendOrderStatusSms, getSmsSettings, SMS_NOT_CONFIGURED } = require('../lib/sms');
const backups = require('../lib/backups');
const { invoiceNo, paidAmount, dueAmount } = require('../lib/invoice');
const { buildInvoicePdf } = require('../lib/invoice-pdf');
const { getWhatsAppConfig, sendInvoiceDocument, NOT_CONFIGURED: WHATSAPP_NOT_CONFIGURED } = require('../lib/whatsapp');
const { isEmailConfigured, sendInvoiceEmail, sendMail } = require('../config/email');
const ret = require('../lib/retention');
const ops = require('../lib/admin-ops');
const db = require('../config/db');
const upload = require('../config/upload');
const { isConfigured: isPushConfigured } = require('../config/push');
const { ROLES, requirePermission, hasPermission, resolveAdminPermissions } = require('../lib/roles');
const { PERMISSION_GROUPS, filterGrantable, parsePermissions } = require('../lib/permissions');
const { buildCategoryTree, flattenTree } = require('../lib/categories');
const { validateProfileDetails, validateEmailChange, cropProfilePhoto } = require('../lib/admin-profile');

function requireAdmin(req, res, next) {
  if (req.session.isAdmin) return next();
  res.redirect('/admin/login');
}

// I7 (feat/admin-ops): one-line audit writer for admin mutations.
// Never throws and never logs secrets (lib/admin-ops.js strips
// password/token/secret keys from details).
function audit(req, action, entityType, entityId, details) {
  return ops.logAdminAction(db, {
    adminId: req.session ? req.session.adminId : null,
    adminEmail: req.session ? req.session.adminEmail : null,
    action, entityType, entityId, details,
  });
}

// Stale-admin fix (fix/whmcs-top-nav): admin pages are private, per-admin
// HTML — they must NEVER be served from a browser cache. Before this,
// only ONE route set no-store, and it was a JSON endpoint
// (/vapid-public-key) — no admin HTML response carried it. So a browser
// could keep a pre-deploy admin page (old header script, old stored
// 'dark' theme) and show the old dark look after a deploy, even though
// the CSS was fresh via cache-busting. This router-level middleware runs
// before every /admin route (login / forgot / reset included, plus
// redirects, CSV/PDF downloads and JSON polls — all dynamic, private
// responses), so a cached pre-deploy page can never stick again.
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('Pragma', 'no-cache');
  next();
});

// WHMCS-style shell (fix/whmcs-style-admin): every admin GET page shows the
// same top bar (bell + badges) and sidebar. The counts are computed once per
// page load into res.locals — the header partial only reads them, it never
// queries. Each COUNT is guarded, so a missing table/column can never break
// a page; a failed count just shows 0. Skipped for non-GET requests, for
// signed-out visitors, and for the live-chat JSON poll (it renders no page).
router.use(async (req, res, next) => {
  res.locals.adminCurrentPath = (req.baseUrl || '') + (req.path || '');
  if (req.method !== 'GET' || !req.session || !req.session.isAdmin) return next();
  if (/^\/chats\/\d+\/messages$/.test(req.path || '')) return next();
  const count = async (sql) => {
    try {
      const [[r]] = await db.query(sql);
      return Number((r && r.c) || 0);
    } catch (e) { return 0; }
  };
  const [pendingOrders, phoneQueue, unreadMessages, pendingReviews, openOrders, unreadChats, pendingReturns] = await Promise.all([
    count("SELECT COUNT(*) AS c FROM orders WHERE status = 'Pending'"),
    count("SELECT COUNT(*) AS c FROM orders WHERE status != 'Cancelled' AND (phone_confirmed = 0 OR phone_confirmed IS NULL)"),
    count('SELECT COUNT(*) AS c FROM contact_messages WHERE is_read = 0'),
    count("SELECT COUNT(*) AS c FROM reviews WHERE status = 'pending'"),
    count("SELECT COUNT(*) AS c FROM orders WHERE status NOT IN ('Delivered', 'Cancelled')"),
    // I9 (feat/admin-ops): customer live-chat messages the admin has
    // not opened yet — bell badge + Live Chat nav badge.
    count('SELECT COALESCE(SUM(unread_admin), 0) AS c FROM chat_conversations'),
    // I3 (feat/admin-ops): return / cancel requests waiting for a decision.
    count("SELECT COUNT(*) AS c FROM order_returns WHERE status = 'Pending'"),
  ]);
  res.locals.adminNotifications = {
    pendingOrders, phoneQueue, unreadMessages, pendingReviews, openOrders, unreadChats, pendingReturns,
    total: pendingOrders + phoneQueue + unreadMessages + pendingReviews + unreadChats + pendingReturns,
  };
  next();
});

// WHMCS-style global search (fix/whmcs-style-admin): one box in the top bar
// searches orders (by number or phone), customers (name / phone / email)
// and products (name). Guarded by requireAdmin only — each section is
// filtered by the permission that opens it, so a search can never leak a
// record the admin cannot open (no customers.manage -> no customer results,
// no orders.view -> no order results, no products.view -> no products).
router.get('/search', requireAdmin, async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 100);
  const canOrders = hasPermission(req, 'orders.view');
  const canCustomers = hasPermission(req, 'customers.manage');
  const canProducts = hasPermission(req, 'products.view');
  let orderResults = [], customerResults = [], productResults = [];
  if (q) {
    try {
      if (canOrders) {
        // A phone number is all digits too — treat a short number as an
        // order number, anything longer as a phone search (BD numbers are
        // 11 digits, order ids are small).
        if (/^\d+$/.test(q) && Number(q) <= 999999) {
          [orderResults] = await db.query('SELECT id, customer_name, phone, total_amount, status, created_at FROM orders WHERE id = ? ORDER BY created_at DESC LIMIT 10', [Number(q)]);
        } else {
          [orderResults] = await db.query('SELECT id, customer_name, phone, total_amount, status, created_at FROM orders WHERE phone LIKE ? ORDER BY created_at DESC LIMIT 10', ['%' + q + '%']);
        }
      }
    } catch (e) { orderResults = []; }
    try {
      if (canCustomers) {
        [customerResults] = await db.query('SELECT id, name, email, phone, created_at FROM users WHERE name LIKE ? OR phone LIKE ? OR email LIKE ? ORDER BY created_at DESC LIMIT 10', ['%' + q + '%', '%' + q + '%', '%' + q + '%']);
      }
    } catch (e) { customerResults = []; }
    try {
      if (canProducts) {
        [productResults] = await db.query('SELECT id, name, price, stock FROM products WHERE name LIKE ? ORDER BY id DESC LIMIT 10', ['%' + q + '%']);
      }
    } catch (e) { productResults = []; }
  }
  res.render('admin/search', { q, searchQuery: q, orderResults, customerResults, productResults, canOrders, canCustomers, canProducts, siteName: 'Goince' });
});

// ---------- ADD PRODUCT: advanced fields ----------
function slugify(text) {
  return String(text || '').toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 200);
}
async function uniqueSlug(base, excludeId) {
  let slug = slugify(base) || 'product';
  let candidate = slug, n = 2;
  while (true) {
    const [rows] = await db.query('SELECT id FROM products WHERE slug = ? AND id != ?', [candidate, excludeId || 0]);
    if (!rows.length) return candidate;
    candidate = slug + '-' + (n++);
  }
}
// ---------- CATEGORIES: advanced fields ----------
// Checkbox helper: form-e checkbox na thakle (quick-add) is_visible default 1,
// is_featured default 0. Hidden 0 + checkbox 1 ekshathe ashle array hoy (qs/multer),
// tai array handle kora hoyeche.
function parseCategoryFlag(v, def) {
  if (v === undefined || v === null || v === '') return def;
  if (Array.isArray(v)) return v.includes('1') ? 1 : 0;
  return v === '1' ? 1 : 0;
}
function parseCategoryForm(body) {
  // sort_order khali/invalid hole null — add-e sheshe bosbe, edit-e ager-ta thakbe
  const so = parseInt(body.sort_order, 10);
  return {
    name: (body.name || '').trim(),
    parent_id: body.parent_id ? parseInt(body.parent_id, 10) || null : null,
    description: (body.description || '').trim() || null,
    sort_order: isNaN(so) ? null : so,
    is_visible: parseCategoryFlag(body.is_visible, 1),
    is_featured: parseCategoryFlag(body.is_featured, 0),
    slug: slugify(body.slug || body.name || '').slice(0, 150),
    banner_url: (body.banner_url || '').trim() || null,
    meta_title: (body.meta_title || '').trim() || null,
    meta_description: (body.meta_description || '').trim() || null
  };
}
async function uniqueCategorySlug(base, excludeId) {
  // Base-ta 140-e kete rakhi, jate '-2'/'-3' suffix jog korleo 150-r moddhe
  // thake — na hole 150 character-er slug nijer sathei mile infinite loop hoto.
  let slug = (slugify(base) || 'category').slice(0, 140);
  let candidate = slug, n = 2;
  while (true) {
    const [rows] = await db.query('SELECT id FROM categories WHERE slug = ? AND id != ?', [candidate, excludeId || 0]);
    if (!rows.length) return candidate;
    candidate = (slug + '-' + (n++)).slice(0, 150);
  }
}
// Category photo: notun file upload hole seta, na hole URL field, na hole ager chobi
// upload.fields() bebohar hoy (image + banner duto field), tai req.files
// thekeo dekha hoy; purono upload.single()-er req.file-o cholbe.
function categoryImage(req, oldImage) {
  const f = req.file || (req.files && req.files.image && req.files.image[0]);
  if (f) return '/uploads/' + f.filename;
  const url = (req.body.image_url || '').trim();
  if (url) return url;
  return oldImage || null;
}
// Category banner: notun file upload hole seta, na hole URL field, na hole ager banner
function categoryBanner(req, oldBanner) {
  const f = req.files && req.files.banner && req.files.banner[0];
  if (f) return '/uploads/' + f.filename;
  const url = (req.body.banner_url || '').trim();
  if (url) return url;
  return oldBanner || null;
}
// Category photo/banner upload-er multer error (bhul file type / 5MB-r beshi)
// hole generic 500 page na dekhiye porishkar message dekhano — na hole
// form-er data hariye jay. Shudhu category add/edit form-e bebohar hoy.
function categoryUpload(req, res, next) {
  upload.fields([{ name: 'image', maxCount: 1 }, { name: 'banner', maxCount: 1 }])(req, res, (err) => {
    if (!err) return upload.convertToWebP(req, res, next);
    console.error('Category image upload error:', err.message);
    return res.status(400).send(`
      <div style="font-family:sans-serif; max-width:600px; margin:60px auto; padding:20px;">
        <h1>Photo upload failed</h1>
        <p>${err.message || 'There was a problem uploading the photo.'}</p>
        <p>Only <strong>jpg, png, gif or webp</strong> photos are allowed, and the file must be under <strong>5MB</strong>.</p>
        <p><a href="/admin/categories" style="color:#f0a500; font-weight:bold;">&larr; Back to Categories</a></p>
      </div>`);
  });
}
function parseProductAdvanced(body) {
  const num = (v) => { const n = parseFloat(v); return isNaN(n) ? null : n; };
  return {
    sku: (body.sku || '').trim() || null,
    cost_price: num(body.cost_price),
    brand: (body.brand || '').trim() || null,
    tags: (body.tags || '').trim() || null,
    weight_kg: num(body.weight_kg),
    status: body.status === 'draft' ? 'draft' : 'published',
    scheduled_at: (body.scheduled_at || '').trim() || null,
    is_featured: body.is_featured === '1' ? 1 : 0,
    is_new: body.is_new === '1' ? 1 : 0,
    free_shipping: body.free_shipping === '1' ? 1 : 0,
    cod_allowed: body.cod_allowed === '0' ? 0 : 1,
    low_stock_threshold: parseInt(body.low_stock_threshold, 10) || 5,
    slug: slugify(body.slug || body.name || ''),
    barcode: (body.barcode || '').trim() || null,
    delivery_time: (body.delivery_time || '').trim() || null,
    allow_backorder: body.allow_backorder === '1' ? 1 : 0,
    meta_title: (body.meta_title || '').trim() || null,
    meta_description: (body.meta_description || '').trim() || null,
    image_alt: (body.image_alt || '').trim() || null
  };
}
async function saveRelatedProducts(productId, relatedIds) {
  await db.query('DELETE FROM related_products WHERE product_id = ?', [productId]);
  const ids = [...new Set((Array.isArray(relatedIds) ? relatedIds : (relatedIds ? [relatedIds] : [])).map(v => parseInt(v, 10)).filter(v => !isNaN(v) && v !== productId))];
  for (const rid of ids) {
    await db.query('INSERT IGNORE INTO related_products (product_id, related_id) VALUES (?, ?)', [productId, rid]);
  }
}

// ---------- ADMIN LOGIN (5 bar bhul dile 10 minute er jonno lock) ----------
const loginAttempts = {}; // { ip: { count, lockUntil } } — in-memory, resets when the server restarts
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 10 * 60 * 1000; // 10 minute

router.get('/login', (req, res) => {
  res.render('admin/login', { error: null, siteName: 'Goince' });
});

router.post('/login', async (req, res) => {
  const ip = req.ip;
  const now = Date.now();
  const record = loginAttempts[ip];

  // Check whether this IP is still locked
  if (record && record.lockUntil && now < record.lockUntil) {
    const minutesLeft = Math.ceil((record.lockUntil - now) / 60000);
    return res.render('admin/login', {
      error: `Too many incorrect password attempts. Please try again in ${minutesLeft} minute(s).`,
      siteName: 'Goince'
    });
  }

  const { email, password } = req.body;
  let loginOk = false;
  let adminRow = null;

  try {
    // Check the DB ("admins" table) first, because a password changed via
    // Forgot Password is the new correct password
    const [rows] = await db.query('SELECT * FROM admins WHERE email = ?', [email]);
    if (rows.length > 0) {
      adminRow = rows[0];
      loginOk = await bcrypt.compare(password || '', rows[0].password);
    } else if (email === process.env.ADMIN_EMAIL && password === process.env.ADMIN_PASSWORD) {
      // No row for this email in the "admins" table — fall back to the .env check
      loginOk = true;
    }
  } catch (err) {
    // If the "admins" table does not exist (sql/update.sql was not run), the old
    // .env-based check keeps login working
    if (email === process.env.ADMIN_EMAIL && password === process.env.ADMIN_PASSWORD) {
      loginOk = true;
    }
  }

  if (loginOk) {
    delete loginAttempts[ip]; // reset attempt count after a successful login
    // Fallback login (fix/whmcs-one-line-topbar): the owner can sign in
    // with the address in .env (e.g. their Gmail) while the real admin
    // row lives under a different address. Use the primary admin row for
    // the session identity (id / email / display name / photo) so the top
    // bar shows the stored display name no matter which address was
    // typed — otherwise the pill falls back to the typed email's local
    // part and the name "keeps changing back to Gmail" on every re-login.
    let profileRow = adminRow;
    if (!profileRow) {
      try {
        const [firstRows] = await db.query('SELECT * FROM admins ORDER BY id ASC LIMIT 1');
        profileRow = (firstRows && firstRows[0]) || null;
      } catch (e) { profileRow = null; }
    }
    req.session.isAdmin = true;
    req.session.adminId = profileRow ? profileRow.id : null;
    req.session.adminEmail = profileRow ? profileRow.email : email;
    // Profile display name + photo (fix/admin-profile-photo): the top bar
    // shows them on every admin page from the session — the header never
    // queries the DB. Missing columns (old DB) just read as null.
    req.session.adminDisplayName = profileRow ? (profileRow.display_name || null) : null;
    req.session.adminPhotoUrl = profileRow ? (profileRow.photo_url || null) : null;
    // Effective role + permissions: custom role (roles table) if the admin
    // has one, else the legacy `role` string. Owner always gets everything.
    const resolved = await resolveAdminPermissions(db, profileRow || adminRow);
    req.session.adminRole = resolved.roleName;
    req.session.adminRoleId = resolved.roleId;
    req.session.adminPermissions = resolved.permissions;

    // "Remember Me" checked -> stay logged in for 30 days; otherwise the
    // session ends when the browser is closed (a normal session cookie)
    if (req.body.remember_me) {
      req.session.cookie.maxAge = 1000 * 60 * 60 * 24 * 30; // 30 days
    } else {
      req.session.cookie.expires = false; // session cookie — expires when the browser closes
    }

    // Landing page = the first area this admin can actually open.
    const _perms = resolved.permissions;
    const _landing = _perms.includes('dashboard.view') ? '/admin/dashboard'
      : _perms.includes('orders.view') ? '/admin/orders'
      : _perms.includes('products.view') ? '/admin/products' : '/admin/dashboard';
    return res.redirect(_landing);
  }

  // Bhul password — attempt count barano
  if (!record || (record.lockUntil && now >= record.lockUntil)) {
    loginAttempts[ip] = { count: 1, lockUntil: null };
  } else {
    record.count += 1;
    if (record.count >= MAX_LOGIN_ATTEMPTS) {
      record.lockUntil = now + LOCKOUT_DURATION_MS;
    }
  }

  const attemptsLeft = MAX_LOGIN_ATTEMPTS - (loginAttempts[ip].count || 0);
  const warning = attemptsLeft > 0 && attemptsLeft <= 2
    ? ` (${attemptsLeft} more incorrect attempt(s) will lock this account for 10 minutes.)`
    : '';
  res.render('admin/login', { error: `Incorrect email or password!${warning}`, siteName: 'Goince' });
});

router.get('/logout', (req, res) => {
  req.session.isAdmin = false;
  req.session.adminId = null;
  req.session.adminEmail = null;
  req.session.adminDisplayName = null;
  req.session.adminPhotoUrl = null;
  req.session.adminRole = null;
  req.session.adminRoleId = null;
  req.session.adminPermissions = null;
  res.redirect('/admin/login');
});

// ---------- ADMIN FORGOT / RESET PASSWORD ----------
router.get('/forgot-password', (req, res) => {
  res.render('admin/forgot-password', { error: null, message: null, siteName: 'Goince' });
});

router.post('/forgot-password', async (req, res) => {
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    if (!email) {
      return res.render('admin/forgot-password', { error: 'Please enter your email address.', message: null, siteName: 'Goince' });
    }

    const [rows] = await db.query('SELECT * FROM admins WHERE email = ?', [email]);

    // Account thakuk ba na thakuk, same message dekhabo (security best practice)
    const genericMessage = 'If an admin account exists for this email, a password reset link has been sent. Please check your email.';

    if (rows.length > 0) {
      const admin = rows[0];
      const token = require('crypto').randomBytes(32).toString('hex');
      const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 ghonta valid

      await db.query('UPDATE admins SET reset_token = ?, reset_expires = ? WHERE id = ?', [token, expires, admin.id]);

      const resetLink = `${req.protocol}://${req.get('host')}/admin/reset-password/${token}`;

      const { sendPasswordResetEmail } = require('../config/email');
      const sent = await sendPasswordResetEmail(admin.email, 'Admin', resetLink);

      if (!sent) {
        // If email is not set up, show the link on screen for testing
        return res.render('admin/forgot-password', {
          error: null,
          message: `The email could not be sent (email is not set up). For testing, here is the link: ${resetLink}`,
          siteName: 'Goince'
        });
      }
    }

    res.render('admin/forgot-password', { error: null, message: genericMessage, siteName: 'Goince' });
  } catch (err) {
    console.error('Admin forgot password error:', err);
    res.render('admin/forgot-password', {
      error: 'The "admins" table was not found. Please check whether sql/update.sql has been run.',
      message: null, siteName: 'Goince'
    });
  }
});

router.get('/reset-password/:token', async (req, res) => {
  const [rows] = await db.query(
    'SELECT * FROM admins WHERE reset_token = ? AND reset_expires > NOW()',
    [req.params.token]
  );
  if (rows.length === 0) {
    return res.render('admin/reset-password', { error: 'This link has expired or is not valid. Please try again.', token: null, siteName: 'Goince' });
  }
  res.render('admin/reset-password', { error: null, token: req.params.token, siteName: 'Goince' });
});

router.post('/reset-password/:token', async (req, res) => {
  try {
    const { password, confirm_password } = req.body;

    if (!password || password.length < 6) {
      return res.render('admin/reset-password', { error: 'Your password must be at least 6 characters long.', token: req.params.token, siteName: 'Goince' });
    }
    if (password !== confirm_password) {
      return res.render('admin/reset-password', { error: 'The two passwords do not match.', token: req.params.token, siteName: 'Goince' });
    }

    const [rows] = await db.query(
      'SELECT * FROM admins WHERE reset_token = ? AND reset_expires > NOW()',
      [req.params.token]
    );
    if (rows.length === 0) {
      return res.render('admin/reset-password', { error: 'This link has expired. Please try again from Forgot Password.', token: null, siteName: 'Goince' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await db.query(
      'UPDATE admins SET password = ?, reset_token = NULL, reset_expires = NULL WHERE id = ?',
      [hashedPassword, rows[0].id]
    );

    res.render('admin/login', { error: null, message: 'Your password has been changed successfully! Please log in now.', siteName: 'Goince' });
  } catch (err) {
    console.error('Admin reset password error:', err);
    res.render('admin/reset-password', { error: 'Something went wrong.', token: req.params.token, siteName: 'Goince' });
  }
});

// ---------- DASHBOARD / SALES ANALYTICS ----------
router.get('/dashboard', requireAdmin, requirePermission('dashboard.view'), async (req, res) => {
  try {
    // Use validated YYYY-MM-DD values only; all user values remain SQL parameters.
    const validDate = (value) => {
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
      const d = new Date(value + 'T00:00:00Z');
      return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
    };
    const shiftDate = (value, days) => {
      const d = new Date(value + 'T00:00:00Z');
      d.setUTCDate(d.getUTCDate() + days);
      return d.toISOString().slice(0, 10);
    };
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const range = ['7', '30', '90', 'custom'].includes(String(req.query.range)) ? String(req.query.range) : '30';
    let from = shiftDate(todayStr, -(Number(range === '7' ? 7 : range === '90' ? 90 : 30) - 1));
    let to = todayStr;
    if (range === 'custom' && validDate(req.query.from) && validDate(req.query.to) && req.query.from <= req.query.to) {
      from = req.query.from;
      to = req.query.to;
    }
    // Keep charts readable and prevent an accidentally huge date range.
    const spanDays = Math.floor((new Date(to + 'T00:00:00Z') - new Date(from + 'T00:00:00Z')) / 86400000) + 1;
    if (spanDays > 366) from = shiftDate(to, -365);
    const finalSpanDays = Math.floor((new Date(to + 'T00:00:00Z') - new Date(from + 'T00:00:00Z')) / 86400000) + 1;
    const prevTo = shiftDate(from, -1);
    const prevFrom = shiftDate(prevTo, -(finalSpanDays - 1));

    const [[{ totalProducts }]] = await db.query('SELECT COUNT(*) AS totalProducts FROM products');
    const [[{ totalRevenue }]] = await db.query("SELECT COALESCE(SUM(total_amount),0) AS totalRevenue FROM orders WHERE status != 'Cancelled'");
    const [[{ totalCustomers }]] = await db.query('SELECT COUNT(*) AS totalCustomers FROM users');
    const [pendingOrders] = await db.query("SELECT * FROM orders WHERE status = 'Pending' ORDER BY created_at DESC LIMIT 5");
    // Orders Pro 2: today's pending orders count (prominent card on the dashboard).
    let todaysPendingCount = 0;
    try { const [[t]] = await db.query("SELECT COUNT(*) AS c FROM orders WHERE status = 'Pending' AND DATE(created_at) = CURDATE()"); todaysPendingCount = Number(t.c || 0); } catch (e) { /* orders table query failed — count stays 0 */ }

    // Dashboard missing cards (PR #45): outstanding COD/due, today's revenue,
    // period profit, and needs-attention counts. Each query is guarded so a
    // missing table can never break the whole dashboard.
    // (a) Pending COD / due: same due rule as the invoices list
    // (lib/invoice.js dueAmount): total − advances − COD-collected, over all
    // open (non-cancelled) orders. Point-in-time total, not period-bound.
    let pendingDue = 0, pendingDueOrders = 0;
    try {
      const [openOrders] = await db.query("SELECT id, total_amount, payment_status, cod_collected FROM orders WHERE status != 'Cancelled'");
      let advancesByOrder = {};
      try {
        const [advRows] = await db.query('SELECT order_id, COALESCE(SUM(amount), 0) AS total FROM order_payments GROUP BY order_id');
        advRows.forEach(r => { advancesByOrder[r.order_id] = Number(r.total || 0); });
      } catch (e) { /* order_payments table not migrated yet */ }
      openOrders.forEach(o => {
        const due = dueAmount(o, advancesByOrder[o.id] || 0);
        if (due > 0) { pendingDue += due; pendingDueOrders++; }
      });
    } catch (e) { /* orders query failed — due stays 0 */ }
    // (b) Needs attention: reviews awaiting approval + unread messages.
    let pendingReviews = 0, unreadMessages = 0;
    try { const [[r]] = await db.query("SELECT COUNT(*) AS pending FROM reviews WHERE status = 'pending'"); pendingReviews = Number(r.pending || 0); } catch (e) { /* reviews table query failed — count stays 0 */ }
    try { const [[m]] = await db.query('SELECT COUNT(*) AS unread FROM contact_messages WHERE is_read = 0'); unreadMessages = Number(m.unread || 0); } catch (e) { /* contact_messages table query failed — count stays 0 */ }
    // (b2) WHMCS-style: phone confirmation queue count, so the attention
    // panel can link straight to Calls & Activity. Same rule as /admin/activity.
    let phoneQueueCount = 0;
    try { const [[pq]] = await db.query("SELECT COUNT(*) AS c FROM orders WHERE status != 'Cancelled' AND (phone_confirmed = 0 OR phone_confirmed IS NULL)"); phoneQueueCount = Number((pq && pq.c) || 0); } catch (e) { /* queue count stays 0 */ }
    // (c) Today's revenue, Asia/Dhaka calendar day (the server/MySQL timezone
    // is not Dhaka, so the date is computed here and passed as a parameter).
    const dhakaToday = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' });
    let todaysSummary = { ordersCount: 0, revenue: 0 };
    try {
      const [[t]] = await db.query(
        `SELECT COUNT(*) AS ordersCount, COALESCE(SUM(total_amount), 0) AS revenue
         FROM orders WHERE DATE(created_at) = ? AND status != 'Cancelled'`, [dhakaToday]);
      todaysSummary = { ordersCount: Number(t.ordersCount || 0), revenue: Number(t.revenue || 0) };
    } catch (e) { /* today's revenue query failed — stays 0 */ }
    // (d) Profit for the selected period, same rule as Reports Total Profit:
    // revenue − cost from order_items.cost_price. totalUnits/costedUnits track
    // how many sold units actually have a cost price, so the card can refuse
    // to present revenue as profit when no cost data exists.
    let periodProfit = { totalProfit: 0, totalCost: 0, totalUnits: 0, costedUnits: 0 };
    try {
      const [[p]] = await db.query(
        `SELECT COALESCE(SUM(oi.quantity * oi.cost_price), 0) AS totalCost,
                COALESCE(SUM(oi.quantity * (oi.price - oi.cost_price)), 0) AS totalProfit,
                COALESCE(SUM(oi.quantity), 0) AS totalUnits,
                COALESCE(SUM(CASE WHEN oi.cost_price IS NOT NULL THEN oi.quantity ELSE 0 END), 0) AS costedUnits
         FROM order_items oi JOIN orders o ON o.id = oi.order_id
         WHERE DATE(o.created_at) BETWEEN ? AND ? AND o.status != 'Cancelled'`, [from, to]);
      periodProfit = {
        totalProfit: Number(p.totalProfit || 0),
        totalCost: Number(p.totalCost || 0),
        totalUnits: Number(p.totalUnits || 0),
        costedUnits: Number(p.costedUnits || 0),
      };
    } catch (e) { /* old orders have no cost_price — profit stays 0 */ }

    // Dashboard professional panels (PR #46): sales by category, top
    // customers, shipped-but-not-delivered. Recent activity + phone
    // confirmation queue moved to their own page /admin/activity (PR #47).
    // Each query is guarded so a missing table can never break the whole
    // dashboard.
    // (1) Sales by category: the EXACT computation Reports uses — per
    // top-level category including descendants, same selected period.
    // (Display-only difference: zero-revenue roots are left out and the
    // list is capped at the top 5, so the dashboard stays scannable.)
    let dashboardCategorySales = [];
    try {
      const [catRows] = await db.query('SELECT id, name, parent_id FROM categories');
      const { roots } = buildCategoryTree(catRows);
      await db.query('SET SESSION group_concat_max_len = 100000');
      const [salesRows] = await db.query(
        `SELECT products.category_id AS category_id,
                GROUP_CONCAT(DISTINCT orders.id) AS orderIds,
                COALESCE(SUM(order_items.quantity), 0) AS items,
                COALESCE(SUM(order_items.quantity * order_items.price), 0) AS revenue,
                COALESCE(SUM(order_items.quantity * order_items.cost_price), 0) AS cost,
                COALESCE(SUM(order_items.quantity * (order_items.price - order_items.cost_price)), 0) AS profit
         FROM order_items
         JOIN orders ON orders.id = order_items.order_id
         JOIN products ON products.id = order_items.product_id
         WHERE DATE(orders.created_at) BETWEEN ? AND ? AND orders.status != 'Cancelled'
         GROUP BY products.category_id`,
        [from, to]);
      const byCat = new Map();
      salesRows.forEach(r => byCat.set(+r.category_id, {
        orderIds: new Set(String(r.orderIds || '').split(',').filter(Boolean).map(Number)),
        items: +r.items || 0, revenue: +r.revenue || 0, cost: +r.cost || 0, profit: +r.profit || 0
      }));
      const sumNode = (n) => {
        const own = byCat.get(n.id) || { orderIds: new Set(), items: 0, revenue: 0, cost: 0, profit: 0 };
        const orderIds = new Set(own.orderIds);
        let items = own.items, revenue = own.revenue, cost = own.cost, profit = own.profit;
        n.children.forEach(c => {
          const s = sumNode(c);
          s.orderIds.forEach(id => orderIds.add(id));
          items += s.items; revenue += s.revenue; cost += s.cost; profit += s.profit;
        });
        return { id: n.id, name: n.name, orders: orderIds.size, items, revenue, cost, profit, orderIds };
      };
      dashboardCategorySales = roots.filter(r => !r.isOrphan).map(sumNode)
        .filter(r => r.revenue > 0).sort((a, b) => b.revenue - a.revenue).slice(0, 5);
    } catch (e) { /* category sales stay empty */ }
    // (2) Top customers in the selected period, grouped by phone — this
    // covers both registered customers and guest checkouts.
    let topCustomers = [];
    try {
      [topCustomers] = await db.query(
        `SELECT phone, MAX(customer_name) AS customer_name, MAX(user_id) AS user_id,
                COUNT(*) AS orderCount, COALESCE(SUM(total_amount), 0) AS totalSpent
         FROM orders
         WHERE DATE(created_at) BETWEEN ? AND ? AND status != 'Cancelled'
           AND phone IS NOT NULL AND phone != ''
         GROUP BY phone ORDER BY totalSpent DESC LIMIT 5`, [from, to]);
    } catch (e) { /* top customers stay empty */ }
    // (3) Shipped but not yet delivered, oldest shipped first. Days
    // waiting counts from the last Shipped status change (falls back to
    // the order date when no history row exists).
    let shippedOrders = [], shippedTotal = 0;
    try {
      [shippedOrders] = await db.query(
        `SELECT id, customer_name, phone, total_amount, courier_name, tracking_number, created_at,
                (SELECT MAX(created_at) FROM order_status_history
                  WHERE order_id = orders.id AND new_status = 'Shipped') AS shipped_at
         FROM orders WHERE status = 'Shipped' ORDER BY created_at ASC, id ASC LIMIT 10`);
      const [[sh]] = await db.query("SELECT COUNT(*) AS c FROM orders WHERE status = 'Shipped'");
      shippedTotal = Number((sh && sh.c) || 0);
      const nowMs = Date.now();
      shippedOrders = shippedOrders.map(o => {
        const base = o.shipped_at || o.created_at;
        const days = Math.max(0, Math.floor((nowMs - new Date(base).getTime()) / 86400000));
        return { ...o, daysSinceShipped: days };
      });
    } catch (e) { /* shipped list stays empty */ }

    const [lowStockProducts] = await db.query('SELECT * FROM products WHERE stock <= COALESCE(low_stock_threshold, 5) ORDER BY stock ASC LIMIT 5');
    const [[{ lowStockCount }]] = await db.query('SELECT COUNT(*) AS lowStockCount FROM products WHERE stock <= COALESCE(low_stock_threshold, 5) AND stock > 0');
    const [[{ outOfStockCount }]] = await db.query('SELECT COUNT(*) AS outOfStockCount FROM products WHERE stock = 0');

    // Keep existing reporting semantics: all non-cancelled orders are counted as sales.
    // Payment collection is shown separately to avoid treating unpaid COD as collected cash.
    const [[currentSummary]] = await db.query(
      `SELECT COUNT(*) AS ordersCount,
              COALESCE(SUM(total_amount), 0) AS revenue,
              COALESCE(AVG(total_amount), 0) AS avgOrderValue,
              COALESCE(SUM(CASE WHEN LOWER(payment_status) IN ('paid','completed','verified','success') THEN total_amount ELSE 0 END), 0) AS collectedRevenue
       FROM orders WHERE DATE(created_at) BETWEEN ? AND ? AND status != 'Cancelled'`, [from, to]);
    const [[previousSummary]] = await db.query(
      `SELECT COUNT(*) AS ordersCount, COALESCE(SUM(total_amount), 0) AS revenue
       FROM orders WHERE DATE(created_at) BETWEEN ? AND ? AND status != 'Cancelled'`, [prevFrom, prevTo]);
    const [[{ newCustomers }]] = await db.query(
      'SELECT COUNT(*) AS newCustomers FROM users WHERE DATE(created_at) BETWEEN ? AND ?', [from, to]);
    const [dailyRows] = await db.query(
      `SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS day, COALESCE(SUM(total_amount), 0) AS revenue, COUNT(*) AS ordersCount
       FROM orders WHERE DATE(created_at) BETWEEN ? AND ? AND status != 'Cancelled'
       GROUP BY DATE_FORMAT(created_at, '%Y-%m-%d') ORDER BY day ASC`, [from, to]);
    const [topProducts] = await db.query(
      `SELECT oi.product_name, SUM(oi.quantity) AS unitsSold,
              SUM(oi.quantity * oi.price) AS productRevenue
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
       WHERE DATE(o.created_at) BETWEEN ? AND ? AND o.status != 'Cancelled'
       GROUP BY oi.product_name ORDER BY unitsSold DESC LIMIT 5`, [from, to]);
    // NOTE (PR #49): the "Order status" summary used to live on the dashboard
    // (statusRows query + totalOrders count). It moved to the Orders page
    // (/admin/invoices) as a clickable all-time summary, so the dashboard no
    // longer queries it.

    const trendMap = new Map(dailyRows.map(row => [String(row.day).slice(0, 10), {
      day: String(row.day).slice(0, 10), revenue: Number(row.revenue || 0), ordersCount: Number(row.ordersCount || 0)
    }]));
    const salesTrend = [];
    for (let i = 0; i < finalSpanDays; i++) {
      const day = shiftDate(from, i);
      salesTrend.push(trendMap.get(day) || { day, revenue: 0, ordersCount: 0 });
    }
    const revenueChange = Number(previousSummary.revenue) > 0
      ? ((Number(currentSummary.revenue) - Number(previousSummary.revenue)) / Number(previousSummary.revenue)) * 100
      : (Number(currentSummary.revenue) > 0 ? null : 0);

    // I9/I3 (feat/admin-ops): unread live-chat messages + pending
    // return/cancel requests — shown as attention cards on the
    // dashboard. Guarded: a missing column/table shows 0, never a 500.
    let unreadChats = 0, pendingReturns = 0;
    try { const [[uc]] = await db.query('SELECT COALESCE(SUM(unread_admin), 0) AS c FROM chat_conversations'); unreadChats = Number((uc && uc.c) || 0); } catch (e) { /* stays 0 */ }
    try { const [[pr]] = await db.query("SELECT COUNT(*) AS c FROM order_returns WHERE status = 'Pending'"); pendingReturns = Number((pr && pr.c) || 0); } catch (e) { /* stays 0 */ }

    res.render('admin/dashboard', {
      totalProducts, totalRevenue, totalCustomers, pendingOrders, todaysPendingCount,
      lowStockProducts, lowStockCount, outOfStockCount,
      pendingDue, pendingDueOrders, pendingReviews, unreadMessages, phoneQueueCount, todaysSummary, periodProfit,
      dashboardCategorySales, topCustomers, shippedOrders, shippedTotal, unreadChats, pendingReturns,
      dashboard: {
        range, from, to, prevFrom, prevTo, currentSummary, previousSummary,
        newCustomers: Number(newCustomers || 0), salesTrend, topProducts,
        revenueChange, maxTrendRevenue: Math.max(1, ...salesTrend.map(row => Number(row.revenue || 0)))
      },
      siteName: 'Goince'
    });
  } catch (err) {
    console.error('Dashboard analytics error:', err);
    res.status(500).send('There was a problem loading the dashboard. Please check the server logs.');
  }
});

// ---------- CALLS & ACTIVITY (PR #47) ----------
// Phone confirmation queue + Recent activity moved off the dashboard into
// their own paginated page: 20 items per page, tabs ?tab=phone (default)
// and ?tab=activity. Read-only; same role guard as the Orders pages
// (ordersView: owner, manager, staff).
router.get('/activity', requireAdmin, requirePermission('activity.view'), async (req, res) => {
  const tab = ['phone', 'activity'].includes(req.query.tab) ? req.query.tab : 'phone';
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const PER_PAGE = 20;
  let phoneTotal = 0, activityTotal = 0;
  let phoneRows = [], activityRows = [];
  try {
    // Totals for both tabs (cheap COUNTs, shown in the tab labels).
    try {
      const [[pq]] = await db.query(
        `SELECT COUNT(*) AS c FROM orders
         WHERE status != 'Cancelled' AND (phone_confirmed = 0 OR phone_confirmed IS NULL)`);
      phoneTotal = Number((pq && pq.c) || 0);
    } catch (e) { /* queue count stays 0 */ }
    let ordersCount = 0, historyCount = 0;
    try {
      const [[oc]] = await db.query('SELECT COUNT(*) AS c FROM orders');
      ordersCount = Number((oc && oc.c) || 0);
    } catch (e) { /* orders count stays 0 */ }
    try {
      const [[hc]] = await db.query('SELECT COUNT(*) AS c FROM order_status_history');
      historyCount = Number((hc && hc.c) || 0);
    } catch (e) { /* history table not migrated yet */ }
    activityTotal = ordersCount + historyCount;

    if (tab === 'phone') {
      const totalPages = Math.max(1, Math.ceil(phoneTotal / PER_PAGE));
      const safePage = Math.min(page, totalPages);
      try {
        [phoneRows] = await db.query(
          `SELECT id, customer_name, phone, total_amount, created_at FROM orders
           WHERE status != 'Cancelled' AND (phone_confirmed = 0 OR phone_confirmed IS NULL)
           ORDER BY created_at ASC, id ASC LIMIT ? OFFSET ?`,
          [PER_PAGE, (safePage - 1) * PER_PAGE]);
      } catch (e) { phoneRows = []; }
      return res.render('admin/activity', { tab, page: safePage, totalPages, totalCount: phoneTotal, perPage: PER_PAGE, phoneTotal, activityTotal, phoneRows, activityRows, siteName: 'Goince' });
    }

    // Activity tab: merge the newest orders + newest status changes, newest
    // first. The top page*PER_PAGE merged entries can only come from the
    // top page*PER_PAGE of each source, so fetching that many of each and
    // slicing the page window is exact.
    const totalPages = Math.max(1, Math.ceil(activityTotal / PER_PAGE));
    const safePage = Math.min(page, totalPages);
    const take = safePage * PER_PAGE;
    let latestOrders = [], historyRows = [];
    try {
      [latestOrders] = await db.query(
        `SELECT id, customer_name, total_amount, created_at FROM orders
         ORDER BY created_at DESC, id DESC LIMIT ?`, [take]);
    } catch (e) { latestOrders = []; }
    try {
      [historyRows] = await db.query(
        `SELECT order_id, old_status, new_status, note, changed_by, created_at
         FROM order_status_history ORDER BY created_at DESC, id DESC LIMIT ?`, [take]);
    } catch (e) { /* history table not migrated yet */ }
    const entries = latestOrders.map(o => ({
      kind: 'order', orderId: Number(o.id),
      text: `Order #${o.id} placed — ৳${Number(o.total_amount || 0).toLocaleString('en-BD')}`,
      when: new Date(o.created_at),
    }));
    historyRows.forEach(h => {
      const label = h.old_status === h.new_status
        ? (h.note || 'Order updated')
        : `${h.old_status || '—'} → ${h.new_status}`;
      entries.push({
        kind: 'status', orderId: Number(h.order_id),
        text: `Order #${h.order_id} — ${label}`,
        when: new Date(h.created_at),
      });
    });
    entries.sort((a, b) => b.when - a.when);
    activityRows = entries.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE);
    return res.render('admin/activity', { tab, page: safePage, totalPages, totalCount: activityTotal, perPage: PER_PAGE, phoneTotal, activityTotal, phoneRows, activityRows, siteName: 'Goince' });
  } catch (err) {
    console.error('Activity page error:', err);
    return res.render('admin/activity', { tab, page: 1, totalPages: 1, totalCount: 0, perPage: PER_PAGE, phoneTotal, activityTotal, phoneRows, activityRows, siteName: 'Goince' });
  }
});

// ==================== INVENTORY / STOCK TRACKING ====================

router.get('/inventory', requireAdmin, requirePermission('inventory.manage'), async (req, res) => {
  const filter = req.query.filter || 'all'; // all, low, out
  let sql = `SELECT products.*, categories.name AS category_name
             FROM products LEFT JOIN categories ON products.category_id = categories.id
             WHERE 1=1`;
  if (filter === 'low') sql += ' AND stock <= 10 AND stock > 0';
  if (filter === 'out') sql += ' AND stock = 0';
  sql += ' ORDER BY stock ASC';

  const [products] = await db.query(sql);
  res.render('admin/inventory', { products, filter, siteName: 'Goince' });
});

// ---------- QUICK STOCK UPDATE (stock can be changed right from here) ----------
router.post('/inventory/update/:id', requireAdmin, requirePermission('inventory.manage'), async (req, res) => {
  const stock = Math.max(0, parseInt(req.body.stock) || 0);
  await db.query('UPDATE products SET stock = ? WHERE id = ?', [stock, req.params.id]);
  res.redirect('/admin/inventory' + (req.body.filter ? '?filter=' + req.body.filter : ''));
});

// ---------- PRODUCT LIST ----------
router.get('/products', requireAdmin, requirePermission('products.view'), async (req, res) => {
  const { q, category } = req.query;
  const where = [];
  const params = [];
  if (q) {
    where.push('(p.name LIKE ? OR p.sku LIKE ? OR p.brand LIKE ?)');
    params.push('%' + q + '%', '%' + q + '%', '%' + q + '%');
  }
  // Categories page theke product count-e click korle ekhane ashe (?category=id)
  // — oi category-r shob sub-category-r (joto govir-e hok) product-o dekhabe.
  if (category) {
    const catId = parseInt(category, 10) || 0;
    const [allCats] = await db.query('SELECT id, parent_id FROM categories');
    const { byId } = buildCategoryTree(allCats);
    const node = byId.get(catId);
    const ids = node ? [catId, ...node.descendantIds] : [catId];
    where.push(`p.category_id IN (${ids.map(() => '?').join(',')})`);
    params.push(...ids);
  }
  const [products] = await db.query(
    `SELECT p.*, c.name AS category_name,
            (SELECT filename FROM product_videos WHERE product_id = p.id ORDER BY created_at DESC LIMIT 1) AS video_filename,
            (SELECT id FROM product_videos WHERE product_id = p.id ORDER BY created_at DESC LIMIT 1) AS video_id
     FROM products p
     LEFT JOIN categories c ON p.category_id = c.id`
    + (where.length ? ' WHERE ' + where.join(' AND ') : '') + `
     ORDER BY p.created_at DESC`,
    params
  );
  const [categories] = await db.query('SELECT id, name, parent_id, sort_order FROM categories ORDER BY (parent_id IS NULL) DESC, parent_id, sort_order ASC, name');
  res.render('admin/products', { products, categories, categoryGroups: buildCategoryGroups(categories), category: category || '', siteName: 'Goince', q: q || '' });
});

// ---------- ADD PRODUCT ----------
router.get('/products/add', requireAdmin, requirePermission('products.manage'), async (req, res) => {
  const [categories] = await db.query('SELECT * FROM categories ORDER BY (parent_id IS NULL) DESC, parent_id, name');
  const [allProducts] = await db.query('SELECT id, name FROM products ORDER BY created_at DESC');
  const { roots } = buildCategoryTree(categories);
  res.render('admin/add-product', { categories, categoryGroups: buildCategoryGroups(categories), categoryFlat: flattenTree(roots), product: null, galleryImages: [], options: [], relatedIds: [], allProducts, videos: [], siteName: 'Goince' });
});

// Category dropdown-er jonno group kora list: prottek main category ekta
// <optgroup>, tar vitore se + tar shob sub-category (govirota onujayi
// indent). Orphan sub-category (parent ar nei) "Other" group-e jay.
function buildCategoryGroups(categories) {
  const { roots, orphans } = buildCategoryTree(categories || []);
  const groups = roots
    .filter(r => !r.isOrphan)
    .map(r => ({
      label: r.name,
      options: flattenTree([r]).map(n => ({ id: n.id, name: n.name, depth: n.depth }))
    }));
  if (orphans.length) {
    const opts = [];
    orphans.forEach(o => flattenTree([o]).forEach(n => opts.push({ id: n.id, name: n.name, depth: n.depth })));
    groups.push({ label: 'Other', options: opts });
  }
  return groups;
}

router.post('/products/add', requireAdmin, requirePermission('products.manage'), upload.fields([{ name: 'image', maxCount: 1 }, { name: 'gallery', maxCount: 10 }, { name: 'video', maxCount: 1 }]), upload.convertToWebP, async (req, res) => {
  try {
    const { name, description, short_description, specifications, price, compare_at_price, stock, category_id, source_link, target_audience, size_values, custom_sizes } = req.body;
    const adv = parseProductAdvanced(req.body);
    adv.slug = await uniqueSlug(adv.slug || name);
    const allowedAudiences = ['men', 'women', 'kids', 'unisex'];
    const audience = allowedAudiences.includes(target_audience) ? target_audience : 'all';
    const image = (req.files && req.files.image) ? req.files.image[0].filename : 'no-image.png';

    const [result] = await db.query(
      'INSERT INTO products (category_id, target_audience, name, description, short_description, specifications, price, compare_at_price, stock, image, source_link, sku, cost_price, brand, tags, weight_kg, status, scheduled_at, is_featured, is_new, free_shipping, cod_allowed, low_stock_threshold, slug, meta_title, meta_description, image_alt, barcode, delivery_time, allow_backorder) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [category_id || null, audience, name, description, short_description || null, specifications || null, price, compare_at_price || null, stock || 0, image, source_link || null, adv.sku, adv.cost_price, adv.brand, adv.tags, adv.weight_kg, adv.status, adv.scheduled_at, adv.is_featured, adv.is_new, adv.free_shipping, adv.cod_allowed, adv.low_stock_threshold, adv.slug, adv.meta_title, adv.meta_description, adv.image_alt, adv.barcode, adv.delivery_time, adv.allow_backorder]
    );
    await logStockChange(result.insertId, null, stock || 0, stock || 0, 'new product');
    // Product video (thakle)
    if (req.files && req.files.video) {
      await db.query('INSERT INTO product_videos (product_id, filename) VALUES (?, ?)', [result.insertId, req.files.video[0].filename]);
    }
    await saveRelatedProducts(result.insertId, req.body.related_ids);
    await audit(req, 'product.add', 'product', result.insertId, { name, price });

    // Add any extra gallery images to the product_images table
    if (req.files && req.files.gallery) {
      for (const file of req.files.gallery) {
        await db.query('INSERT INTO product_images (product_id, image) VALUES (?, ?)', [result.insertId, file.filename]);
      }
    }

    // Optional product sizes: presets + custom values
    const selectedSizes = Array.isArray(size_values)
      ? size_values
      : (size_values ? [size_values] : []);

    const customSizeValues = String(custom_sizes || '')
      .split(/[,\r\n]+/)
      .map(value => value.trim())
      .filter(Boolean);

    const sizeValues = [...new Set(
      [...selectedSizes, ...customSizeValues]
        .map(value => String(value).trim())
        .filter(Boolean)
    )];

    for (const value of sizeValues) {
      await db.query(
        'INSERT INTO product_options (product_id, option_label, value_name) VALUES (?, ?, ?)',
        [result.insertId, 'Size', value]
      );
    }

    res.redirect('/admin/products');
  } catch (err) {
    console.error(err);
    res.status(500).send(`
      <div style="font-family:sans-serif; max-width:600px; margin:60px auto; padding:20px;">
        <h1>😕 There Was a Problem Adding the Product</h1>
        <p><strong>Actual Error:</strong> ${err.sqlMessage || err.message}</p>
        <a href="/admin/products/add" style="color:#f0a500; font-weight:bold;">&larr; Try Again</a>
      </div>
    `);
  }
});

// ---------- EDIT PRODUCT ----------
router.get('/products/edit/:id', requireAdmin, requirePermission('products.manage'), async (req, res) => {
  const [rows] = await db.query('SELECT * FROM products WHERE id = ?', [req.params.id]);
  if (rows.length === 0) return res.redirect('/admin/products');
  const [categories] = await db.query('SELECT * FROM categories ORDER BY (parent_id IS NULL) DESC, parent_id, name');
  const [galleryImages] = await db.query('SELECT * FROM product_images WHERE product_id = ?', [req.params.id]);
  const [options] = await db.query('SELECT * FROM product_options WHERE product_id = ? ORDER BY sort_order, id', [req.params.id]);
  const [relatedRows] = await db.query('SELECT related_id FROM related_products WHERE product_id = ?', [req.params.id]);
  const [allProducts] = await db.query('SELECT id, name FROM products WHERE id != ? ORDER BY created_at DESC', [req.params.id]);
  const [videos] = await db.query('SELECT * FROM product_videos WHERE product_id = ?', [req.params.id]);
  const { roots } = buildCategoryTree(categories);
  res.render('admin/add-product', { categories, categoryGroups: buildCategoryGroups(categories), categoryFlat: flattenTree(roots), product: rows[0], galleryImages, options, relatedIds: relatedRows.map(r => r.related_id), allProducts, videos, siteName: 'Goince' });
});

router.post('/products/edit/:id', requireAdmin, requirePermission('products.manage'), upload.fields([{ name: 'image', maxCount: 1 }, { name: 'gallery', maxCount: 10 }, { name: 'video', maxCount: 1 }]), upload.convertToWebP, async (req, res) => {
  try {
    const { name, description, short_description, specifications, price, compare_at_price, stock, category_id, source_link, target_audience, size_management, size_values, custom_sizes } = req.body;
    const adv = parseProductAdvanced(req.body);
    adv.slug = await uniqueSlug(adv.slug || name, req.params.id);
    const allowedAudiences = ['men', 'women', 'kids', 'unisex'];
    const audience = allowedAudiences.includes(target_audience) ? target_audience : 'all';
    const id = req.params.id;
    const mainImage = (req.files && req.files.image) ? req.files.image[0].filename : null;
    // Stock history-r jonno purono stock age-i niye rakha (UPDATE-er pore ar pawa jabe na)
    const [[oldP]] = await db.query('SELECT stock, price FROM products WHERE id = ?', [id]);

    const advValues = [adv.sku, adv.cost_price, adv.brand, adv.tags, adv.weight_kg, adv.status, adv.scheduled_at, adv.is_featured, adv.is_new, adv.free_shipping, adv.cod_allowed, adv.low_stock_threshold, adv.slug, adv.meta_title, adv.meta_description, adv.image_alt, adv.barcode, adv.delivery_time, adv.allow_backorder];
    const advSet = 'sku=?, cost_price=?, brand=?, tags=?, weight_kg=?, status=?, scheduled_at=?, is_featured=?, is_new=?, free_shipping=?, cod_allowed=?, low_stock_threshold=?, slug=?, meta_title=?, meta_description=?, image_alt=?, barcode=?, delivery_time=?, allow_backorder=?';
    if (mainImage) {
      await db.query(
        'UPDATE products SET name=?, description=?, short_description=?, specifications=?, price=?, compare_at_price=?, stock=?, category_id=?, target_audience=?, image=?, source_link=?, ' + advSet + ' WHERE id=?',
        [name, description, short_description || null, specifications || null, price, compare_at_price || null, stock || 0, category_id || null, audience, mainImage, source_link || null, ...advValues, id]
      );
    } else {
      await db.query(
        'UPDATE products SET name=?, description=?, short_description=?, specifications=?, price=?, compare_at_price=?, stock=?, category_id=?, target_audience=?, source_link=?, ' + advSet + ' WHERE id=?',
        [name, description, short_description || null, specifications || null, price, compare_at_price || null, stock || 0, category_id || null, audience, source_link || null, ...advValues, id]
      );
    }
    if (req.files && req.files.video) {
      await db.query('INSERT INTO product_videos (product_id, filename) VALUES (?, ?)', [id, req.files.video[0].filename]);
    }
    await saveRelatedProducts(id, req.body.related_ids);
    // Stock bodlale history-te likha
    const newStock = parseInt(stock, 10) || 0;
    if (oldP && newStock !== oldP.stock) {
      await logStockChange(id, null, newStock - oldP.stock, newStock, 'manual');
    }
    await audit(req, 'product.edit', 'product', id, { name, price });
    // F2/F6 (feat/retention): 0 -> stock firle Notify Me subscriber-der
    // email (ekbar proti restock-e); daam komle wishlist-er customer-der
    // email (ekbar proti price-drop-e). Email configure na thakle
    // helper-gulo chup chap skip kore — product save kokhono atkabe na.
    try {
      const settings = await ret.getRetentionSettings(db);
      const siteUrl = `${req.protocol}://${req.get('host')}`;
      if (oldP && ret.shouldNotifyBackInStock(oldP.stock, newStock)) {
        await ret.notifyBackInStock(db, id, settings, sendMail, siteUrl);
      }
      if (oldP && oldP.price !== undefined && price !== undefined) {
        await ret.notifyPriceDrop(db, id, oldP.price, price, settings, sendMail, siteUrl);
      }
    } catch (e) { console.error('Retention product hook failed:', e.message); }

    // New gallery images are added alongside the existing ones (they are not removed)
    if (req.files && req.files.gallery) {
      for (const file of req.files.gallery) {
        await db.query('INSERT INTO product_images (product_id, image) VALUES (?, ?)', [id, file.filename]);
      }
    }

    // Update Product Size Variants only when the Size editor was submitted
    if (size_management === '1') {
      const [existingSizeOption] = await db.query(
        "SELECT option_label FROM product_options WHERE product_id = ? LIMIT 1",
        [id]
      );

      // Never overwrite existing Color or Weight options
      if (existingSizeOption.length === 0 ||
          String(existingSizeOption[0].option_label).toLowerCase() === 'size') {

        const selectedSizes = Array.isArray(size_values)
          ? size_values
          : (size_values ? [size_values] : []);

        const customSizeValues = String(custom_sizes || '')
          .split(/[,\r\n]+/)
          .map(value => value.trim())
          .filter(Boolean);

        const finalSizes = [...new Set(
          [...selectedSizes, ...customSizeValues]
            .map(value => String(value).trim())
            .filter(Boolean)
        )];

        await db.query(
          "DELETE FROM product_options WHERE product_id = ? AND LOWER(option_label) = 'size'",
          [id]
        );

        for (const value of finalSizes) {
          await db.query(
            'INSERT INTO product_options (product_id, option_label, value_name) VALUES (?, ?, ?)',
            [id, 'Size', value]
          );
        }
      }
    }

    res.redirect('/admin/products');
  } catch (err) {
    console.error(err);
    res.status(500).send(`
      <div style="font-family:sans-serif; max-width:600px; margin:60px auto; padding:20px;">
        <h1>😕 There Was a Problem Updating the Product</h1>
        <p><strong>Actual Error:</strong> ${err.sqlMessage || err.message}</p>
        <a href="/admin/products/edit/${req.params.id}" style="color:#f0a500; font-weight:bold;">&larr; Try Again</a>
      </div>
    `);
  }
});

// ---------- STOCK HISTORY (ke, kokhon stock bodlalo — tar hisab) ----------
async function logStockChange(productId, variantId, changeQty, stockAfter, reason) {
  try {
    await db.query(
      'INSERT INTO stock_history (product_id, variant_id, change_qty, stock_after, reason) VALUES (?, ?, ?, ?, ?)',
      [productId, variantId || null, changeQty, stockAfter, reason || 'manual']
    );
  } catch (e) { /* history na likhte parle asol kaj thambe na */ }
}

// ---------- ATTRIBUTES (Size / Color ityadi) ----------
router.get('/attributes', requireAdmin, requirePermission('products.variants'), async (req, res) => {
  const [attrs] = await db.query('SELECT * FROM attributes ORDER BY name');
  for (const a of attrs) {
    const [vals] = await db.query('SELECT * FROM attribute_values WHERE attribute_id = ? ORDER BY value', [a.id]);
    a.values = vals;
  }
  res.render('admin/attributes', { attributes: attrs, siteName: 'Goince' });
});
router.post('/attributes/add', requireAdmin, requirePermission('products.variants'), async (req, res) => {
  const name = (req.body.name || '').trim();
  if (name) { try { await db.query('INSERT INTO attributes (name) VALUES (?)', [name]); } catch (e) {} }
  res.redirect('/admin/attributes');
});
router.post('/attributes/delete/:id', requireAdmin, requirePermission('products.variants'), async (req, res) => {
  await db.query('DELETE FROM attributes WHERE id = ?', [req.params.id]);
  res.redirect('/admin/attributes');
});
router.post('/attributes/:id/values/add', requireAdmin, requirePermission('products.variants'), async (req, res) => {
  const value = (req.body.value || '').trim();
  if (value) { try { await db.query('INSERT INTO attribute_values (attribute_id, value) VALUES (?, ?)', [req.params.id, value]); } catch (e) {} }
  res.redirect('/admin/attributes');
});
router.post('/attribute-values/delete/:id', requireAdmin, requirePermission('products.variants'), async (req, res) => {
  await db.query('DELETE FROM attribute_values WHERE id = ?', [req.params.id]);
  res.redirect('/admin/attributes');
});

// ---------- PRODUCT VARIANTS MANAGER ----------
router.get('/products/:id/variants', requireAdmin, requirePermission('products.variants'), async (req, res) => {
  const [[product]] = await db.query('SELECT * FROM products WHERE id = ?', [req.params.id]);
  if (!product) return res.redirect('/admin/products');
  const [attrs] = await db.query('SELECT * FROM attributes ORDER BY name');
  for (const a of attrs) {
    const [vals] = await db.query('SELECT * FROM attribute_values WHERE attribute_id = ? ORDER BY value', [a.id]);
    a.values = vals;
  }
  const [variants] = await db.query('SELECT * FROM product_variants WHERE product_id = ? ORDER BY id', [req.params.id]);
  const selectedValueIds = new Set();
  for (const v of variants) {
    const [links] = await db.query(
      `SELECT av.id AS value_id, av.value, a.name AS attribute_name FROM product_variant_attributes pva
       JOIN attribute_values av ON pva.attribute_value_id = av.id
       JOIN attributes a ON av.attribute_id = a.id WHERE pva.variant_id = ?`,
      [v.id]
    );
    v.label = links.map(l => `${l.attribute_name}: ${l.value}`).join(', ');
    links.forEach(l => selectedValueIds.add(l.value_id));
  }
  res.render('admin/product-variants', { product, attributes: attrs, variants, selectedValueIds, siteName: 'Goince' });
});
router.post('/products/:id/variants/sync', requireAdmin, requirePermission('products.variants'), async (req, res) => {
  const productId = req.params.id;
  const [attrs] = await db.query('SELECT * FROM attributes ORDER BY name');
  // prottek attribute theke tick kora value gulo
  const picked = [];
  for (const a of attrs) {
    let vals = req.body['attr_' + a.id];
    if (!vals) continue;
    if (!Array.isArray(vals)) vals = [vals];
    const ids = vals.map(v => parseInt(v, 10)).filter(v => !isNaN(v));
    if (ids.length) picked.push(ids);
  }
  // Kichu tick na korle shob variant muche jabe, notun kichu banano hobe na
  if (picked.length === 0) {
    await db.query('DELETE FROM product_variants WHERE product_id = ?', [productId]);
    return res.redirect('/admin/products/' + productId + '/variants');
  }
  // Cartesian product: Size x Color ityadi — shob combination
  let combos = [[]];
  for (const ids of picked) {
    const next = [];
    for (const c of combos) for (const id of ids) next.push([...c, id]);
    combos = next;
  }
  const [existing] = await db.query('SELECT * FROM product_variants WHERE product_id = ?', [productId]);
  const existingMap = new Map();
  for (const v of existing) {
    const [links] = await db.query('SELECT attribute_value_id FROM product_variant_attributes WHERE variant_id = ?', [v.id]);
    const key = links.map(l => l.attribute_value_id).sort((a, b) => a - b).join(',');
    existingMap.set(key, v.id);
  }
  const wanted = new Set();
  for (const combo of combos) {
    const key = [...combo].sort((a, b) => a - b).join(',');
    wanted.add(key);
    if (!existingMap.has(key)) {
      const [r] = await db.query('INSERT INTO product_variants (product_id, stock) VALUES (?, 0)', [productId]);
      for (const vid of combo) {
        await db.query('INSERT INTO product_variant_attributes (variant_id, attribute_value_id) VALUES (?, ?)', [r.insertId, vid]);
      }
    }
  }
  // ar dorkar nei emon combination muche fela
  for (const [key, vid] of existingMap) {
    if (!wanted.has(key)) await db.query('DELETE FROM product_variants WHERE id = ?', [vid]);
  }
  res.redirect('/admin/products/' + productId + '/variants');
});
router.post('/products/:id/variants/:vid/update', requireAdmin, requirePermission('products.variants'), upload.single('image'), upload.convertToWebP, async (req, res) => {
  const stock = parseInt(req.body.stock, 10) || 0;
  const price = req.body.price === '' || req.body.price == null ? null : parseFloat(req.body.price);
  const compareAt = req.body.compare_at_price === '' || req.body.compare_at_price == null ? null : parseFloat(req.body.compare_at_price);
  const barcode = (req.body.barcode || '').trim() || null;
  const [[old]] = await db.query('SELECT * FROM product_variants WHERE id = ? AND product_id = ?', [req.params.vid, req.params.id]);
  if (!old) return res.redirect('/admin/products/' + req.params.id + '/variants');
  const image = req.file ? req.file.filename : old.image;
  await db.query(
    'UPDATE product_variants SET stock = ?, price = ?, compare_at_price = ?, barcode = ?, image = ? WHERE id = ?',
    [stock, isNaN(price) ? null : price, isNaN(compareAt) ? null : compareAt, barcode, image, req.params.vid]
  );
  if (stock !== old.stock) await logStockChange(req.params.id, req.params.vid, stock - old.stock, stock, 'variant');
  res.redirect('/admin/products/' + req.params.id + '/variants');
});
router.post('/products/:id/variants/delete/:vid', requireAdmin, requirePermission('products.variants'), async (req, res) => {
  await db.query('DELETE FROM product_variants WHERE id = ? AND product_id = ?', [req.params.vid, req.params.id]);
  res.redirect('/admin/products/' + req.params.id + '/variants');
});

// ---------- STOCK HISTORY + STOCK ALERTS ----------
router.get('/products/:id/stock-history', requireAdmin, requirePermission('products.variants'), async (req, res) => {
  const [[product]] = await db.query('SELECT id, name FROM products WHERE id = ?', [req.params.id]);
  if (!product) return res.redirect('/admin/products');
  const [rows] = await db.query('SELECT * FROM stock_history WHERE product_id = ? ORDER BY created_at DESC LIMIT 100', [req.params.id]);
  res.render('admin/stock-history', { product, rows, siteName: 'Goince' });
});
router.get('/stock-alerts', requireAdmin, requirePermission('stock-alerts.manage'), async (req, res) => {
  const [alerts] = await db.query(
    `SELECT sa.*, p.name AS product_name, p.stock FROM stock_alerts sa
     JOIN products p ON p.id = sa.product_id ORDER BY sa.created_at DESC LIMIT 200`
  );
  res.render('admin/stock-alerts', { alerts, siteName: 'Goince' });
});
router.post('/stock-alerts/:id/done', requireAdmin, requirePermission('stock-alerts.manage'), async (req, res) => {
  await db.query('UPDATE stock_alerts SET notified = 1 WHERE id = ?', [req.params.id]);
  res.redirect('/admin/stock-alerts');
});

// ---------- DUPLICATE PRODUCT ----------
router.post('/products/:id/duplicate', requireAdmin, requirePermission('products.manage'), async (req, res) => {
  const [[p]] = await db.query('SELECT * FROM products WHERE id = ?', [req.params.id]);
  if (!p) return res.redirect('/admin/products');
  const slug = await uniqueSlug((p.slug || slugify(p.name)) + '-copy');
  const [result] = await db.query(
    'INSERT INTO products (category_id, target_audience, name, description, short_description, specifications, price, compare_at_price, stock, image, source_link, sku, cost_price, brand, tags, weight_kg, status, scheduled_at, is_featured, is_new, free_shipping, cod_allowed, low_stock_threshold, slug, meta_title, meta_description, image_alt) SELECT category_id, target_audience, CONCAT(name, " (Copy)"), description, short_description, specifications, price, compare_at_price, stock, image, source_link, NULL, cost_price, brand, tags, weight_kg, "draft", NULL, is_featured, is_new, free_shipping, cod_allowed, low_stock_threshold, ?, meta_title, meta_description, image_alt FROM products WHERE id = ?',
    [slug, req.params.id]
  );
  const [imgs] = await db.query('SELECT image FROM product_images WHERE product_id = ?', [req.params.id]);
  for (const g of imgs) await db.query('INSERT INTO product_images (product_id, image) VALUES (?, ?)', [result.insertId, g.image]);
  const [opts] = await db.query('SELECT * FROM product_options WHERE product_id = ?', [req.params.id]);
  for (const o of opts) await db.query('INSERT INTO product_options (product_id, option_label, value_name, color_hex, image, sort_order) VALUES (?, ?, ?, ?, ?, ?)', [result.insertId, o.option_label, o.value_name, o.color_hex, o.image, o.sort_order]);
  res.redirect('/admin/products/edit/' + result.insertId);
});

// ---------- CSV IMPORT / EXPORT ----------
router.get('/products/import', requireAdmin, requirePermission('products.manage'), (req, res) => {
  res.render('admin/import-products', { result: null, siteName: 'Goince' });
});
router.post('/products/import', requireAdmin, requirePermission('products.manage'), upload.single('csv'), async (req, res) => {
  let added = 0, skipped = 0; const errors = [];
  try {
    const fs = require('fs');
    const text = fs.readFileSync(req.file.path, 'utf8');
    fs.unlinkSync(req.file.path);
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    const header = lines[0].split(',').map(h => h.trim().toLowerCase());
    const idx = (name) => header.indexOf(name);
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''));
      const name = cols[idx('name')] || '';
      const price = parseFloat(cols[idx('price')]);
      if (!name || isNaN(price)) { skipped++; continue; }
      try {
        const slug = await uniqueSlug(slugify(name));
        await db.query(
          'INSERT INTO products (name, price, cost_price, stock, sku, brand, tags, category_id, status, slug) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [name, price, parseFloat(cols[idx('cost_price')]) || null, parseInt(cols[idx('stock')], 10) || 0, cols[idx('sku')] || null, cols[idx('brand')] || null, cols[idx('tags')] || null, parseInt(cols[idx('category_id')], 10) || null, 'published', slug]
        );
        added++;
      } catch (e) { skipped++; errors.push('Row ' + (i + 1) + ': ' + (e.sqlMessage || e.message)); }
    }
  } catch (e) { errors.push(e.message); }
  res.render('admin/import-products', { result: { added, skipped, errors: errors.slice(0, 10) }, siteName: 'Goince' });
});
router.get('/products/export', requireAdmin, requirePermission('products.manage'), async (req, res) => {
  const [products] = await db.query('SELECT id, name, price, cost_price, stock, sku, brand, tags, category_id, status, slug FROM products ORDER BY id');
  const esc = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const csv = ['id,name,price,cost_price,stock,sku,brand,tags,category_id,status,slug'].concat(
    products.map(p => [p.id, p.name, p.price, p.cost_price, p.stock, p.sku, p.brand, p.tags, p.category_id, p.status, p.slug].map(esc).join(','))
  ).join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="goince-products.csv"');
  res.send(csv);
});

// ---------- DELETE A SINGLE GALLERY IMAGE ----------
router.post('/products/:id/gallery/delete/:imageId', requireAdmin, requirePermission('products.manage'), async (req, res) => {
  await db.query('DELETE FROM product_images WHERE id = ? AND product_id = ?', [req.params.imageId, req.params.id]);
  res.redirect('/admin/products/edit/' + req.params.id);
});

// ==================== PRODUCT OPTIONS (Color / Size / Weight — you can set the label yourself) ====================
router.post('/products/:id/options/add', requireAdmin, requirePermission('products.manage'), upload.single('option_image'), upload.convertToWebP, async (req, res) => {
  try {
    const productId = req.params.id;
    const submittedLabel = (req.body.option_label || '').trim();
    const valueName = (req.body.value_name || '').trim();
    const colorHex = req.body.use_color_hex ? ((req.body.color_hex || '').trim() || null) : null;
    const image = req.file ? req.file.filename : null;

    if (valueName) {
      // If the product already has options, keep the same label (so one
      // product does not end up with 2 different labels mixed together) — if a
      // submittedLabel is given, all old rows are renamed too; otherwise the old label stays
      const [existing] = await db.query('SELECT option_label FROM product_options WHERE product_id = ? LIMIT 1', [productId]);
      const label = submittedLabel || (existing.length > 0 ? existing[0].option_label : 'Option');

      if (existing.length > 0 && submittedLabel && submittedLabel !== existing[0].option_label) {
        await db.query('UPDATE product_options SET option_label = ? WHERE product_id = ?', [submittedLabel, productId]);
      }

      await db.query(
        'INSERT INTO product_options (product_id, option_label, value_name, color_hex, image) VALUES (?, ?, ?, ?, ?)',
        [productId, label, valueName, colorHex, image]
      );
    }
    res.redirect('/admin/products/edit/' + productId);
  } catch (err) {
    console.error('Option add error:', err);
    res.status(500).send(`
      <div style="font-family:sans-serif; max-width:600px; margin:60px auto; padding:20px;">
        <h1>😕 There Was a Problem Adding the Option</h1>
        <p><strong>Error:</strong> ${err.sqlMessage || err.message}</p>
        <p>The <code>sql/add_product_options.sql</code> file probably has not been run yet. Please try this command:<br>
        <code>mysql -u root -p goince_db &lt; sql/add_product_options.sql</code></p>
        <a href="/admin/products/edit/${req.params.id}" style="color:#f0a500; font-weight:bold;">&larr; Back to the product edit page</a>
      </div>
    `);
  }
});

router.post('/products/:id/options/delete/:optionId', requireAdmin, requirePermission('products.manage'), async (req, res) => {
  await db.query('DELETE FROM product_options WHERE id = ? AND product_id = ?', [req.params.optionId, req.params.id]);
  res.redirect('/admin/products/edit/' + req.params.id);
});

// ---------- DELETE PRODUCT ----------
router.post('/products/delete/:id', requireAdmin, requirePermission('products.manage'), async (req, res) => {
  await db.query('DELETE FROM products WHERE id = ?', [req.params.id]);
  await audit(req, 'product.delete', 'product', req.params.id, {});
  res.redirect('/admin/products');
});

// ---------- CATEGORY QUICK ADD (used from the Add Product form) ----------
// Shudhu name + parent pathay (urlencoded) — full form na, tai is_visible/
// is_featured na thakleo category visible thakbe (parseCategoryForm default).
// Quick-add hole 'back'-e ferot jay, Categories page theke add hole list-e.
router.post('/categories/add', requireAdmin, requirePermission('categories.manage'), categoryUpload, async (req, res) => {
  try {
    const f = parseCategoryForm(req.body);
    if (!f.name) return res.redirect('back');
    if (f.parent_id) {
      // Unlimited nesting: jekono category-r niche sub-category banano jay.
      // Shudhu check kori parent-ta asolei ache kina.
      const [[parent]] = await db.query('SELECT id FROM categories WHERE id = ?', [f.parent_id]);
      if (!parent) f.parent_id = null;
    }
    const slug = await uniqueCategorySlug(f.slug || f.name);
    const image = categoryImage(req, null);
    const banner = categoryBanner(req, null);
    // Sort order na dile group-er sheshe bosbe (0 dile shobar age chole jeto)
    let sortOrder = f.sort_order;
    if (sortOrder === null) {
      const [[mx]] = await db.query(
        'SELECT COALESCE(MAX(sort_order), 0) AS m FROM categories WHERE ' + (f.parent_id ? 'parent_id = ?' : 'parent_id IS NULL'),
        f.parent_id ? [f.parent_id] : []
      );
      sortOrder = mx.m + 1;
    }
    const [result] = await db.query('INSERT INTO categories (name, parent_id, image_url, description, sort_order, is_visible, is_featured, slug, meta_title, meta_description, banner_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [f.name, f.parent_id, image, f.description, sortOrder, f.is_visible, f.is_featured, slug, f.meta_title, f.meta_description, banner]);
    if (req.body.from === 'quick-add') return res.redirect('back');
    res.redirect('/admin/categories#cat-' + result.insertId);
  } catch (err) {
    console.error('Category add error:', err);
    res.status(500).send('There was a problem adding the category. Please check whether the "parent_id" column exists in the database (run sql/update.sql).');
  }
});

// ==================== FULL CATEGORY MANAGEMENT ====================

router.get('/categories', requireAdmin, requirePermission('categories.manage'), async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const visibility = ['shown', 'hidden'].includes(req.query.visible) ? req.query.visible : 'all';
    // Shob category ekbare ani (choto table) — tree, search ar filter
    // shob JavaScript-e banano hoy, jate nesting joto govir-e hok thik thake.
    const [allRows] = await db.query(
      `SELECT categories.*, COUNT(products.id) AS product_count, parent.name AS parent_name
       FROM categories
       LEFT JOIN products ON products.category_id = categories.id
       LEFT JOIN categories AS parent ON parent.id = categories.parent_id
       GROUP BY categories.id ORDER BY categories.sort_order ASC, categories.id ASC`
    );
    const { roots, orphans, byId } = buildCategoryTree(allRows);
    const flat = flattenTree(roots);
    // Tree mode shudhu jokhon kono filter nei; search ba Show/Hide filter
    // cholle flat list dekhano hoy (parent context shoho).
    const isFiltered = !!q || visibility !== 'all';
    let categories = [];
    let searchExtras = [];
    if (isFiltered) {
      const qLower = q.toLowerCase();
      categories = flat.filter(c =>
        (!q || String(c.name).toLowerCase().includes(qLower)) &&
        (visibility === 'all' || (visibility === 'shown' ? c.is_visible !== 0 : c.is_visible === 0))
      );
      // Search-e kono category mile gele tar sub-category (joto govir-e hok)
      // gulo-o dekhano hoy — na hole group-ta ordhek dekhato.
      if (q) {
        const seen = new Set(categories.map(c => c.id));
        categories.forEach(c => {
          (byId.get(c.id)?.descendantIds || []).forEach(did => {
            const d = byId.get(did);
            if (d && !seen.has(did) && (visibility === 'all' || (visibility === 'shown' ? d.is_visible !== 0 : d.is_visible === 0))) {
              seen.add(did);
              searchExtras.push(d);
            }
          });
        });
      }
    }
    // ?parent=<id> (row-er "+ Sub-category" link theke): Add form-e oi
    // category-ta age theke beche thakbe. Jekono asol category cholbe
    // (main hok ba sub) — bogus id ignore kora hoy.
    let selectedParent = null;
    const parentParam = parseInt(req.query.parent, 10);
    if (!isNaN(parentParam) && byId.get(parentParam)) selectedParent = parentParam;
    res.render('admin/categories', {
      categories, mains: roots.filter(r => !r.parent_id), treeRoots: roots.filter(r => !r.isOrphan), orphanSubs: orphans,
      searchExtras, allCategories: flat, q, visibility, selectedParent, siteName: 'Goince'
    });
  } catch (err) {
    console.error('Category list error:', err);
    res.status(500).send('There was a problem loading the category list. Please check whether the "parent_id" column exists in the database (run sql/update.sql -f).');
  }
});

// ---------- CATEGORY EDIT PAGE (alada clean page — table-er vitore choto form na) ----------
router.get('/categories/edit/:id', requireAdmin, requirePermission('categories.manage'), async (req, res) => {
  try {
    const [[category]] = await db.query('SELECT * FROM categories WHERE id = ?', [req.params.id]);
    if (!category) return res.redirect('/admin/categories');
    // Parent dropdown-e shob category (govirota onujayi indent kora) —
    // nijeke ar nijer sub-category (joto govir-e hok) beche neya jabe na,
    // na hole cycle toiri hoto. Baki shob kichu cholbe: puro subtree
    // notun parent-er niche sora jay.
    const [allRows] = await db.query('SELECT * FROM categories ORDER BY sort_order ASC, id ASC');
    const { roots, byId } = buildCategoryTree(allRows);
    const allCategories = flattenTree(roots);
    const node = byId.get(+req.params.id);
    const blockedIds = node ? [node.id, ...node.descendantIds] : [+req.params.id];
    res.render('admin/category-edit', { category, allCategories, blockedIds, childCount: node ? node.children.length : 0, siteName: 'Goince' });
  } catch (err) {
    console.error('Category edit page error:', err);
    res.status(500).send('There was a problem loading the category.');
  }
});

router.post('/categories/edit/:id', requireAdmin, requirePermission('categories.manage'), categoryUpload, async (req, res) => {
  try {
    const [[old]] = await db.query('SELECT * FROM categories WHERE id = ?', [req.params.id]);
    if (!old) return res.redirect('/admin/categories');
    const f = parseCategoryForm(req.body);
    if (!f.name) return res.redirect('/admin/categories/edit/' + req.params.id);
    if (f.sort_order === null) f.sort_order = old.sort_order; // khali rakhle ager order-i thakbe
    // Cycle check: nijeke ba nijer kono sub-category-ke (joto govir-e hok)
    // parent banano jabe na — hole parent-ta ager motoi thakbe.
    if (f.parent_id === parseInt(req.params.id, 10)) f.parent_id = old.parent_id;
    if (f.parent_id && f.parent_id !== old.parent_id) {
      const [allRows] = await db.query('SELECT id, parent_id FROM categories');
      const { byId } = buildCategoryTree(allRows);
      const node = byId.get(+req.params.id);
      const parent = byId.get(f.parent_id);
      if (!parent || (node && node.descendantIds.includes(f.parent_id))) f.parent_id = old.parent_id;
    }
    const slug = await uniqueCategorySlug(f.slug || f.name, req.params.id);
    const image = categoryImage(req, old.image_url);
    const banner = categoryBanner(req, old.banner_url);
    await db.query('UPDATE categories SET name = ?, parent_id = ?, image_url = ?, description = ?, sort_order = ?, is_visible = ?, is_featured = ?, slug = ?, meta_title = ?, meta_description = ?, banner_url = ? WHERE id = ?',
      [f.name, f.parent_id, image, f.description, f.sort_order, f.is_visible, f.is_featured, slug, f.meta_title, f.meta_description, banner, req.params.id]);
    res.redirect('/admin/categories#cat-' + req.params.id);
  } catch (err) {
    console.error('Category edit error:', err);
    res.status(500).send('There was a problem updating the category.');
  }
});

// ---------- CATEGORY REORDER (▲▼ — eki parent-er moddhe neighbour-er sathe jayga bodol) ----------
// Group-er shob row notun kore number kora hoy (10, 20, 30...) — purono
// swap-e sort_order soman thakle ba 3rd row-r sathe mile gele move-ta
// chokhe na-ow porte parto; renumber korle seta kokhono hobe na.
router.post('/categories/:id/move', requireAdmin, requirePermission('categories.manage'), async (req, res) => {
  try {
    const direction = req.body.direction === 'down' ? 'down' : 'up';
    const [[cat]] = await db.query('SELECT * FROM categories WHERE id = ?', [req.params.id]);
    if (!cat) return res.redirect('/admin/categories');
    const [siblings] = await db.query(
      'SELECT id FROM categories WHERE ' + (cat.parent_id ? 'parent_id = ?' : 'parent_id IS NULL') + ' ORDER BY sort_order ASC, id ASC',
      cat.parent_id ? [cat.parent_id] : []
    );
    const idx = siblings.findIndex(s => s.id == cat.id);
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (idx >= 0 && siblings[swapIdx]) {
      const order = siblings.slice();
      const tmp = order[idx]; order[idx] = order[swapIdx]; order[swapIdx] = tmp;
      for (let i = 0; i < order.length; i++) {
        await db.query('UPDATE categories SET sort_order = ? WHERE id = ?', [(i + 1) * 10, order[i].id]);
      }
    }
    // Anchor-e ferot jai, jate page-er upore na giye oi row-tei thake
    res.redirect('/admin/categories#cat-' + req.params.id);
  } catch (err) {
    console.error('Category move error:', err);
    res.redirect('/admin/categories#cat-' + req.params.id);
  }
});

// ---------- CATEGORY DRAG-DROP REORDER (tree-te teney sajano) ----------
// Drag-drop shudhu EKI parent-er moddhei sajay — onno group-e fele dile
// ignore kora hoy. Body: { parent_id ('' = main), ids: [ordered ids] }.
// ids-ta group-er shob sibling-er sathe na mille 400 — ordhek order
// kokhono save hobe na. Sort order 10/20/30 kore notun kore deya hoy.
router.post('/categories/reorder', requireAdmin, requirePermission('categories.manage'), async (req, res) => {
  try {
    const parentId = req.body.parent_id ? parseInt(req.body.parent_id, 10) || null : null;
    let ids = req.body.ids;
    if (!Array.isArray(ids)) ids = ids ? [ids] : [];
    ids = [...new Set(ids.map(v => parseInt(v, 10)).filter(v => !isNaN(v)))];
    const [siblings] = await db.query(
      'SELECT id FROM categories WHERE ' + (parentId ? 'parent_id = ?' : 'parent_id IS NULL') + ' ORDER BY sort_order ASC, id ASC',
      parentId ? [parentId] : []
    );
    const siblingIds = siblings.map(s => s.id).sort((a, b) => a - b);
    const given = [...ids].sort((a, b) => a - b);
    if (siblingIds.length !== given.length || !siblingIds.every((v, i) => v === given[i])) {
      return res.status(400).json({ ok: false, error: 'Order does not match this group.' });
    }
    for (let i = 0; i < ids.length; i++) {
      await db.query('UPDATE categories SET sort_order = ? WHERE id = ?', [(i + 1) * 10, ids[i]]);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('Category reorder error:', err);
    res.status(500).json({ ok: false, error: 'Could not save the new order.' });
  }
});

// ---------- CATEGORY SHOW / HIDE (delete na kore website theke lukano) ----------
router.post('/categories/:id/toggle-visibility', requireAdmin, requirePermission('categories.manage'), async (req, res) => {
  try {
    await db.query('UPDATE categories SET is_visible = 1 - is_visible WHERE id = ?', [req.params.id]);
    res.redirect('/admin/categories#cat-' + req.params.id);
  } catch (err) {
    console.error('Category visibility error:', err);
    res.redirect('/admin/categories#cat-' + req.params.id);
  }
});

router.post('/categories/delete/:id', requireAdmin, requirePermission('categories.manage'), async (req, res) => {
  try {
    // Unlimited nesting: delete shob level-e hoy. Live DB-te foreign key
    // nao thakte pare (parent_id pore jog hoyeche), tai code thekei shob
    // porishkar kora hoy: age shob level-er product Uncategorized, tarpor
    // category + tar puro subtree delete. Product kokhono haray na.
    const id = parseInt(req.params.id, 10);
    const [allRows] = await db.query('SELECT id, parent_id FROM categories');
    const { byId } = buildCategoryTree(allRows);
    const node = byId.get(id);
    const ids = node ? [id, ...node.descendantIds] : [id];
    await db.query(`UPDATE products SET category_id = NULL WHERE category_id IN (${ids.map(() => '?').join(',')})`, ids);
    await db.query(`DELETE FROM categories WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
    res.redirect('/admin/categories');
  } catch (err) {
    console.error('Category delete error:', err);
    res.status(500).send('There was a problem deleting the category.');
  }
});

// ---------- CATEGORY BULK ACTIONS (hide / show / delete selected) ----------
router.post('/categories/bulk', requireAdmin, requirePermission('categories.manage'), async (req, res) => {
  try {
    let ids = req.body.ids;
    if (!Array.isArray(ids)) ids = ids ? [ids] : [];
    ids = [...new Set(ids.map(v => parseInt(v, 10)).filter(v => !isNaN(v)))];
    const action = req.body.action;
    if (!ids.length || !['hide', 'show', 'delete'].includes(action)) return res.redirect('/admin/categories');
    if (action === 'hide' || action === 'show') {
      await db.query(
        `UPDATE categories SET is_visible = ? WHERE id IN (${ids.map(() => '?').join(',')})`,
        [action === 'show' ? 1 : 0, ...ids]
      );
    } else {
      // Delete: prottek-ti category-r puro subtree (joto govir-e hok) soho.
      const [allRows] = await db.query('SELECT id, parent_id FROM categories');
      const { byId } = buildCategoryTree(allRows);
      const allIds = new Set();
      ids.forEach(i => {
        allIds.add(i);
        const n = byId.get(i);
        if (n) n.descendantIds.forEach(d => allIds.add(d));
      });
      const list = [...allIds];
      await db.query(`UPDATE products SET category_id = NULL WHERE category_id IN (${list.map(() => '?').join(',')})`, list);
      await db.query(`DELETE FROM categories WHERE id IN (${list.map(() => '?').join(',')})`, list);
    }
    res.redirect('/admin/categories');
  } catch (err) {
    console.error('Category bulk error:', err);
    res.redirect('/admin/categories');
  }
});

// ---------- CATEGORY CSV EXPORT / IMPORT ----------
// Export: parent name diye deya hoy (id na), jate CSV-ta pore manusher
// pore bujhte ar import korte subidha hoy. Import-o parent name ba id
// — dutotei chole; na chinle top-level hishebe boshe.
// Choto CSV parser — quoted field-er vitore comma ("a, b") ar "" escape
// bojhe; products import-er naive split(',') description-e comma thakle
// venge jeto.
function parseCsvText(text) {
  const rows = [];
  let row = [], cur = '', inQ = false;
  const s = String(text || '').replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQ) {
      if (ch === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.some(v => v.trim() !== '')) rows.push(row);
      row = [];
    } else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); if (row.some(v => v.trim() !== '')) rows.push(row); }
  return rows;
}

router.get('/categories/export', requireAdmin, requirePermission('categories.manage'), async (req, res) => {
  const [rows] = await db.query('SELECT c.*, p.name AS parent_name FROM categories c LEFT JOIN categories p ON p.id = c.parent_id ORDER BY c.id');
  const esc = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const header = 'id,name,parent,slug,description,image_url,banner_url,sort_order,is_visible,is_featured,meta_title,meta_description';
  const lines = rows.map(c => [c.id, c.name, c.parent_name || '', c.slug, c.description, c.image_url, c.banner_url, c.sort_order, c.is_visible, c.is_featured, c.meta_title, c.meta_description].map(esc).join(','));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="goince-categories.csv"');
  res.send('\uFEFF' + [header].concat(lines).join('\r\n'));
});

router.get('/categories/import', requireAdmin, requirePermission('categories.manage'), (req, res) => {
  res.render('admin/import-categories', { result: null, siteName: 'Goince' });
});
router.post('/categories/import', requireAdmin, requirePermission('categories.manage'), upload.single('csv'), async (req, res) => {
  let added = 0, skipped = 0; const errors = [];
  try {
    const fs = require('fs');
    if (!req.file) {
      errors.push('No CSV file uploaded.');
    } else {
      const rows = parseCsvText(fs.readFileSync(req.file.path, 'utf8'));
      fs.unlinkSync(req.file.path);
      if (!rows.length) {
        errors.push('The CSV file is empty.');
      } else {
        const header = rows[0].map(h => h.trim().toLowerCase());
        const idx = (name) => header.indexOf(name);
        const parseFlag = (v, def) => {
          if (v === undefined || v === null || String(v).trim() === '') return def;
          return ['1', 'true', 'yes', 'y'].includes(String(v).trim().toLowerCase()) ? 1 : 0;
        };
        const resolveParent = async (raw) => {
          const v = (raw || '').trim();
          if (!v) return null;
          if (/^\d+$/.test(v)) {
            const [[r]] = await db.query('SELECT id FROM categories WHERE id = ?', [parseInt(v, 10)]);
            if (r) return r.id;
          }
          const [[r]] = await db.query('SELECT id FROM categories WHERE name = ? LIMIT 1', [v]);
          return r ? r.id : null;
        };
        // Dui pass: prothome parent paoya row gulo, tarpor baki gulo — parent
        // file-er pore thakle 2nd pass-e peye jabe; 2nd pass-eo na pele
        // top-level hishebe bosbe (unknown parent).
        let pending = rows.slice(1);
        for (let pass = 0; pass < 2 && pending.length; pass++) {
          const nextPending = [];
          for (const cols of pending) {
            const get = (name) => (idx(name) >= 0 ? (cols[idx(name)] || '').trim() : '');
            const name = get('name');
            if (!name) { skipped++; continue; }
            const parentRaw = get('parent');
            let parentId = null;
            if (parentRaw) {
              parentId = await resolveParent(parentRaw);
              if (parentId === null && pass === 0) { nextPending.push(cols); continue; }
            }
            try {
              const slug = await uniqueCategorySlug(get('slug') || name);
              let sortOrder = parseInt(get('sort_order'), 10);
              if (isNaN(sortOrder)) {
                const [[mx]] = await db.query('SELECT COALESCE(MAX(sort_order), 0) AS m FROM categories WHERE ' + (parentId ? 'parent_id = ?' : 'parent_id IS NULL'), parentId ? [parentId] : []);
                sortOrder = mx.m + 1;
              }
              await db.query('INSERT INTO categories (name, parent_id, image_url, description, sort_order, is_visible, is_featured, slug, meta_title, meta_description, banner_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [name, parentId, get('image_url') || null, get('description') || null, sortOrder, parseFlag(get('is_visible'), 1), parseFlag(get('is_featured'), 0), slug, get('meta_title') || null, get('meta_description') || null, get('banner_url') || null]);
              added++;
            } catch (e) { skipped++; errors.push('Row "' + name + '": ' + (e.sqlMessage || e.message)); }
          }
          pending = nextPending;
        }
      }
    }
  } catch (e) { errors.push(e.message); }
  res.render('admin/import-categories', { result: { added, skipped, errors: errors.slice(0, 10) }, siteName: 'Goince' });
});

// ---------- ORDERS PRO: status history helper ----------
// Records every order status change (old -> new, when, by whom, note).
// Tables are created by sql/add_orders_pro.sql and by server.js on start;
// if the table is missing (very old DB), the insert is skipped silently.
const ORDER_STATUSES = ['Pending', 'Confirmed', 'Shipped', 'Delivered', 'Cancelled'];

// Professional polish 2: collapse runs of identical consecutive status
// changes into one entry (keep the latest). Phone confirm/undo records a
// history row with old == new, so the timeline repeated "Shipped →
// Shipped" four times for one order. The rows are newest-first, so the
// first row of a run is the latest one — keep it, skip the rest.
function collapseHistory(rows) {
  const out = [];
  for (const h of rows || []) {
    const prev = out[out.length - 1];
    if (prev && prev.old_status === h.old_status && prev.new_status === h.new_status) continue;
    out.push(h);
  }
  return out;
}
async function recordStatusChange(orderId, oldStatus, newStatus, note, changedBy) {
  try {
    await db.query(
      'INSERT INTO order_status_history (order_id, old_status, new_status, note, changed_by) VALUES (?, ?, ?, ?, ?)',
      [orderId, oldStatus || null, newStatus, note || null, changedBy || null]
    );
  } catch (e) { /* history table not migrated yet — status change still stands */ }
}

// ---------- ORDERS LIST ----------
router.get('/orders', requireAdmin, requirePermission('orders.view'), (req, res) => {
  // The old Orders list moved — the Invoices page (renamed "Orders" in the
  // sidebar) is now the one list. Old bookmarks / dashboard links land here.
  // Keep the query string: /admin/orders?status=Pending must land on
  // /admin/invoices?status=Pending (before PR #49 the status was silently
  // dropped, so the dashboard "View pending orders" link never filtered).
  const qs = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
  res.redirect('/admin/invoices' + qs);
});

router.get('/orders/export', requireAdmin, requirePermission('orders.view'), async (req, res) => {
  try {
    const { whereSql, params } = ordersCsvWhere(req);
    const [orders] = await db.query('SELECT * FROM orders' + whereSql + ' ORDER BY created_at DESC', params);
    const csv = ops.toCsv([
      { key: 'id', label: 'Order ID' }, { key: 'invoiceNo', label: 'Invoice No' },
      { key: 'date', label: 'Date' }, { key: 'customer_name', label: 'Customer' },
      { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email' },
      { key: 'address', label: 'Address' }, { key: 'delivery_zone', label: 'Delivery Zone' },
      { key: 'delivery_charge', label: 'Delivery Charge' }, { key: 'coupon_code', label: 'Coupon' },
      { key: 'discount_amount', label: 'Discount' }, { key: 'total_amount', label: 'Total' },
      { key: 'payment_method', label: 'Payment Method' }, { key: 'payment_status', label: 'Payment Status' },
      { key: 'status', label: 'Order Status' },
    ], orders.map(o => ({
      ...o, invoiceNo: invoiceNo(o.id),
      date: o.created_at ? new Date(o.created_at).toISOString().slice(0, 19).replace('T', ' ') : '',
      delivery_charge: Number(o.delivery_charge || 0).toFixed(2),
      discount_amount: Number(o.discount_amount || 0).toFixed(2),
      total_amount: Number(o.total_amount || 0).toFixed(2),
    })));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="goince-orders.csv"');
    res.send(csv);
  } catch (err) {
    console.error(err);
    res.status(500).send('There was a problem exporting orders: ' + err.message);
  }
});

// ---------- INVOICES ----------
// An invoice IS an order (invoice no. GOINCE-00035 = order #35) — no separate
// invoices table. Shared loader for the invoices page, print/PDF invoice and
// the email/WhatsApp senders: order + items + advance payments + paid/due.
async function loadInvoiceData(orderId) {
  const [[order]] = await db.query('SELECT * FROM orders WHERE id = ?', [orderId]);
  if (!order) return null;
  const [items] = await db.query('SELECT * FROM order_items WHERE order_id = ?', [orderId]);
  let advances = [];
  try { [advances] = await db.query('SELECT * FROM order_payments WHERE order_id = ? ORDER BY created_at DESC, id DESC', [orderId]); } catch (e) { /* table not migrated yet */ }
  const advancesTotal = advances.reduce((s, p) => s + Number(p.amount || 0), 0);
  const subtotal = items.reduce((s, it) => s + Number(it.price || 0) * Number(it.quantity || 0), 0);
  const paid = paidAmount(order, advancesTotal);
  const due = dueAmount(order, advancesTotal);
  return { order, items, advances, advancesTotal, subtotal, paid, due, invoiceNo: invoiceNo(order.id) };
}

function invoicePdfData(inv, shopPhone) {
  return {
    invoiceNo: inv.invoiceNo,
    date: new Date(inv.order.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
    status: inv.order.status,
    paymentStatus: inv.order.payment_status,
    customerName: inv.order.customer_name,
    phone: inv.order.phone,
    email: inv.order.email || '',
    address: inv.order.address,
    deliveryZone: inv.order.delivery_zone || '',
    items: inv.items,
    subtotal: inv.subtotal,
    discount: Number(inv.order.discount_amount || 0),
    deliveryCharge: Number(inv.order.delivery_charge || 0),
    total: Number(inv.order.total_amount || 0),
    paid: inv.paid,
    due: inv.due,
    shopPhone: shopPhone || '',
  };
}

async function logInvoiceSend(orderId, channel, recipient, ok, error, createdBy) {
  try {
    await db.query(
      'INSERT INTO order_invoice_sends (order_id, channel, recipient, status, error, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      [orderId, channel, recipient || '', ok ? 'sent' : 'failed', error || null, createdBy || null]
    );
  } catch (e) { /* table not migrated yet — the send itself already happened */ }
}

// Invoices list: tabs All / Paid / Unpaid / Cancelled, 20 per page.
router.get('/invoices', requireAdmin, requirePermission('orders.view'), async (req, res) => {
  const tab = ['all', 'paid', 'unpaid', 'cancelled'].includes(req.query.tab) ? req.query.tab : 'all';
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const PER_PAGE = 20;
  const where = [];
  const params = [];
  if (tab === 'paid') { where.push("payment_status = 'Paid'"); }
  if (tab === 'unpaid') { where.push("payment_status != 'Paid' AND status != 'Cancelled'"); }
  if (tab === 'cancelled') { where.push("status = 'Cancelled'"); }
  // Order status summary (moved from the dashboard, PR #49): all-time
  // counts per status. All-time, not period-bound — the Orders page has no
  // period filter, so the counts are labelled "All-time" in the view. The
  // query is guarded: a failure degrades to an empty summary, never a 500.
  // A status filter is only honoured when it is a real status (one of the
  // known workflow statuses, or one actually present in the counts), so a
  // bogus ?status= value is ignored instead of returning an empty list.
  let statusRows = [];
  try {
    [statusRows] = await db.query(
      'SELECT status, COUNT(*) AS count FROM orders GROUP BY status ORDER BY count DESC');
  } catch (e) { statusRows = []; }
  const totalOrdersAll = statusRows.reduce((s, r) => s + Number(r.count || 0), 0);
  const allowedStatuses = new Set([...ORDER_STATUSES, ...statusRows.map(r => String(r.status))]);
  const statusFilter = allowedStatuses.has(String(req.query.status || '')) ? String(req.query.status) : '';
  if (statusFilter) { where.push('status = ?'); params.push(statusFilter); }
  const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : '';
  const [[countRow]] = await db.query('SELECT COUNT(*) AS cnt FROM orders' + whereSql, params);
  const totalCount = Number(countRow.cnt || 0);
  const totalPages = Math.max(1, Math.ceil(totalCount / PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const [orders] = await db.query(
    'SELECT * FROM orders' + whereSql + ' ORDER BY created_at DESC LIMIT ? OFFSET ?',
    [...params, PER_PAGE, (safePage - 1) * PER_PAGE]
  );
  let advancesByOrder = {};
  try {
    const [advRows] = await db.query('SELECT order_id, COALESCE(SUM(amount), 0) AS total FROM order_payments GROUP BY order_id');
    advRows.forEach(r => { advancesByOrder[r.order_id] = Number(r.total || 0); });
  } catch (e) { /* table not migrated yet */ }
  const rows = orders.map(o => ({
    ...o,
    invoiceNo: invoiceNo(o.id),
    paid: paidAmount(o, advancesByOrder[o.id] || 0),
    due: dueAmount(o, advancesByOrder[o.id] || 0),
  }));
  // Inline actions on this list (status / cancel / mark paid) redirect back
  // here with ?msg= / ?err= — show them like the old orders list did.
  const listMsg = req.query.msg === 'status-updated' ? 'Order status updated.' :
    req.query.msg === 'advance-saved' ? 'Advance payment recorded.' :
    req.query.msg === 'cod-collected' ? 'COD cash marked as collected — payment status set to Paid.' : null;
  const listErr = req.query.err === 'cancel-reason' ? 'A cancel reason is required when cancelling orders.' :
    req.query.err === 'invalid-status' ? 'That order status is not valid.' :
    req.query.err === 'bad-amount' ? 'Enter an advance amount greater than 0.' :
    req.query.err === 'not-cod' ? 'COD collection only applies to Cash on Delivery orders.' :
    req.query.err === 'already-collected' ? 'COD cash was already marked as collected.' : null;
  res.render('admin/invoices', { rows, tab, page: safePage, totalPages, totalCount, perPage: PER_PAGE, listMsg, listErr, statusRows, statusFilter, totalOrdersAll, siteName: 'Goince' });
});

// ---------- ORDER DETAILS ----------
router.get('/orders/:id', requireAdmin, requirePermission('orders.view'), async (req, res) => {
  const [[order]] = await db.query('SELECT * FROM orders WHERE id = ?', [req.params.id]);
  if (!order) return res.redirect('/admin/orders');
  const [items] = await db.query('SELECT * FROM order_items WHERE order_id = ?', [req.params.id]);
  const [[phoneRow]] = await db.query("SELECT setting_value FROM settings WHERE setting_key = 'shop_phone'");
  const courier = await getCourierConfig(db);
  let history = [];
  let notes = [];
  try { [history] = await db.query('SELECT * FROM order_status_history WHERE order_id = ? ORDER BY created_at DESC, id DESC', [req.params.id]); } catch (e) { /* table not migrated yet */ }
  history = collapseHistory(history);
  try { [notes] = await db.query('SELECT * FROM order_notes WHERE order_id = ? ORDER BY created_at DESC, id DESC', [req.params.id]); } catch (e) { /* table not migrated yet */ }
  // Orders Pro 2: this phone's order history — fake-order warning.
  let phoneHistory = { total: 0, cancelled: 0, delivered: 0 };
  try {
    const [[ph]] = await db.query("SELECT COUNT(*) AS total, SUM(status = 'Cancelled') AS cancelled, SUM(status = 'Delivered') AS delivered FROM orders WHERE phone = ? AND id != ?", [order.phone, req.params.id]);
    phoneHistory = { total: Number(ph.total || 0), cancelled: Number(ph.cancelled || 0), delivered: Number(ph.delivered || 0) };
  } catch (e) { /* keep zeros */ }
  // Orders Pro 2: returns recorded for this order.
  let returns = [];
  try { [returns] = await db.query('SELECT * FROM order_returns WHERE order_id = ? ORDER BY created_at DESC, id DESC', [req.params.id]); } catch (e) { /* table not migrated yet */ }
  // Invoices + send: advance payments, paid/due and the invoice send history.
  const inv = await loadInvoiceData(req.params.id);
  const advances = inv ? inv.advances : [];
  const paid = inv ? inv.paid : 0;
  const due = inv ? inv.due : 0;
  let invoiceSends = [];
  try { [invoiceSends] = await db.query('SELECT * FROM order_invoice_sends WHERE order_id = ? ORDER BY created_at DESC, id DESC LIMIT 20', [req.params.id]); } catch (e) { /* table not migrated yet */ }
  const courierMsg = req.query.courier === 'created' ? 'Consignment created with ' + (order.courier_name || 'the courier') + ' — tracking ' + (order.tracking_number || '') + '.' :
    req.query.courier === 'failed' ? 'Courier API call failed — check the API keys in Settings > Courier API and try again.' :
    req.query.courier === 'not-configured' ? 'Courier API is not configured yet — add the API keys in Settings > Courier API first.' :
    req.query.courier === 'already' ? 'This order already has a consignment / tracking number.' :
    req.query.courier === 'status-updated' ? 'Tracking status updated from the courier.' :
    req.query.courier === 'status-failed' ? 'Could not fetch the tracking status — check the API keys and try again.' :
    req.query.courier === 'no-consignment' ? 'This order has no consignment yet — create one first.' : null;
  const orderMsg = req.query.msg === 'phone-confirmed' ? 'Phone confirmed — order marked as confirmed by phone.' :
    req.query.msg === 'phone-unconfirmed' ? 'Phone confirmation undone — order is not phone-confirmed again.' :
    req.query.msg === 'note-saved' ? 'Admin note saved.' :
    req.query.msg === 'sms-not-connected' ? SMS_NOT_CONFIGURED :
    req.query.msg === 'cod-collected' ? 'COD cash marked as collected — payment status set to Paid.' :
    req.query.msg === 'cod-uncollected' ? 'COD collection undone — order is not collected again and payment status is back to Unpaid.' :
    req.query.msg === 'return-saved' ? 'Return recorded (Pending).' :
    req.query.msg === 'return-updated' ? 'Return status updated.' :
    req.query.msg === 'advance-saved' ? 'Advance payment recorded.' :
    req.query.msg === 'email-sent' ? 'Invoice emailed to the customer.' :
    req.query.msg === 'whatsapp-sent' ? 'Invoice sent on WhatsApp.' :
    req.query.msg === 'email-not-configured' ? 'Email is not configured yet — set EMAIL_USER and EMAIL_PASS in the .env file first.' :
    req.query.msg === 'whatsapp-not-connected' ? WHATSAPP_NOT_CONFIGURED :
    req.query.msg === 'bulk-updated' ? 'Selected orders updated.' : null;
  const orderErr = req.query.err === 'cancel-reason' ? 'A cancel reason is required when cancelling an order.' :
    req.query.err === 'invalid-status' ? 'That order status is not valid.' :
    req.query.err === 'no-orders' ? 'Select at least one order first.' :
    req.query.err === 'return-reason' ? 'A reason is required to record a return.' :
    req.query.err === 'no-email' ? 'Enter a customer email address first.' :
    req.query.err === 'email-failed' ? 'The invoice email could not be sent — check the email settings and try again.' :
    req.query.err === 'whatsapp-failed' ? 'The WhatsApp invoice could not be sent — check the WhatsApp Business API settings and try again.' :
    req.query.err === 'bad-amount' ? 'Enter an advance amount greater than 0.' :
    req.query.err === 'not-cod' ? 'COD collection only applies to Cash on Delivery orders.' :
    req.query.err === 'already-collected' ? 'COD cash was already marked as collected.' :
    req.query.err === 'not-collected' ? 'COD cash is not marked as collected for this order.' :
    req.query.err === 'not-phone-confirmed' ? 'This order is not marked as phone-confirmed.' : null;
  res.render('admin/order-details', { order, items, history, notes, phoneHistory, returns, advances, paid, due, invoiceNo: inv ? inv.invoiceNo : invoiceNo(order.id), invoiceSends, orderMsg, orderErr, siteName: 'Goince', shopPhone: phoneRow ? phoneRow.setting_value : '', courier, courierMsg });
});

// ---------- PRINTABLE INVOICE (separate print-friendly page) ----------
router.get('/orders/:id/invoice', requireAdmin, requirePermission('orders.view'), async (req, res) => {
  const inv = await loadInvoiceData(req.params.id);
  if (!inv) return res.redirect('/admin/orders');
  const [[phoneRow]] = await db.query("SELECT setting_value FROM settings WHERE setting_key = 'shop_phone'");
  res.render('admin/order-invoice', { order: inv.order, items: inv.items, paid: inv.paid, due: inv.due, invoiceNo: inv.invoiceNo, siteName: 'Goince', shopPhone: phoneRow ? phoneRow.setting_value : '' });
});

// ---------- INVOICE PDF (downloadable, also attached to emails / WhatsApp) ----------
router.get('/orders/:id/invoice.pdf', requireAdmin, requirePermission('orders.view'), async (req, res) => {
  const inv = await loadInvoiceData(req.params.id);
  if (!inv) return res.redirect('/admin/orders');
  const [[phoneRow]] = await db.query("SELECT setting_value FROM settings WHERE setting_key = 'shop_phone'");
  const pdf = buildInvoicePdf(invoicePdfData(inv, phoneRow ? phoneRow.setting_value : ''));
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="' + inv.invoiceNo + '.pdf"');
  res.send(pdf);
});

// ---------- RECORD AN ADVANCE / PARTIAL PAYMENT ----------
router.post('/orders/:id/advance', requireAdmin, requirePermission('orders.manage'), async (req, res) => {
  const amount = parseFloat(req.body.amount);
  const note = (req.body.note || '').trim();
  const dest = '/admin/orders/' + req.params.id;
  if (isNaN(amount) || amount <= 0) return res.redirect(dest + '?err=bad-amount');
  const [[order]] = await db.query('SELECT * FROM orders WHERE id = ?', [req.params.id]);
  if (!order) return res.redirect('/admin/invoices');
  await db.query(
    'INSERT INTO order_payments (order_id, amount, note, created_by) VALUES (?, ?, ?, ?)',
    [req.params.id, amount, note || null, req.session.adminEmail || null]
  );
  // Keep payment_status in step with what is actually paid: fully paid -> Paid,
  // partly paid -> Partial. COD-collected orders are already Paid.
  const inv = await loadInvoiceData(req.params.id);
  if (inv && inv.due <= 0 && order.payment_status !== 'Paid') {
    await db.query("UPDATE orders SET payment_status = 'Paid' WHERE id = ?", [req.params.id]);
  } else if (inv && inv.due > 0 && order.payment_status === 'Unpaid') {
    await db.query("UPDATE orders SET payment_status = 'Partial' WHERE id = ?", [req.params.id]);
  }
  res.redirect(dest + '?msg=advance-saved');
});

// ---------- SEND INVOICE BY EMAIL (PDF attached) ----------
router.post('/orders/:id/email-invoice', requireAdmin, requirePermission('orders.manage'), async (req, res) => {
  const toEmail = (req.body.email || '').trim();
  if (!toEmail) return res.redirect('/admin/orders/' + req.params.id + '?err=no-email');
  const inv = await loadInvoiceData(req.params.id);
  if (!inv) return res.redirect('/admin/orders');
  if (!isEmailConfigured()) {
    await logInvoiceSend(req.params.id, 'email', toEmail, false, 'Email not configured (EMAIL_USER/EMAIL_PASS missing).', req.session.adminEmail);
    return res.redirect('/admin/orders/' + req.params.id + '?msg=email-not-configured');
  }
  const [[phoneRow]] = await db.query("SELECT setting_value FROM settings WHERE setting_key = 'shop_phone'");
  const pdf = buildInvoicePdf(invoicePdfData(inv, phoneRow ? phoneRow.setting_value : ''));
  const result = await sendInvoiceEmail(toEmail, {
    invoiceNo: inv.invoiceNo,
    order: inv.order,
    items: inv.items,
    subtotal: inv.subtotal,
    discount: Number(inv.order.discount_amount || 0),
    deliveryCharge: Number(inv.order.delivery_charge || 0),
    total: Number(inv.order.total_amount || 0),
    paid: inv.paid,
    due: inv.due,
    shopPhone: phoneRow ? phoneRow.setting_value : '',
    pdfBuffer: pdf,
  });
  await logInvoiceSend(req.params.id, 'email', toEmail, result.ok, result.error || null, req.session.adminEmail);
  res.redirect('/admin/orders/' + req.params.id + (result.ok ? '?msg=email-sent' : '?err=email-failed'));
});

// ---------- SEND INVOICE ON WHATSAPP (Business API document message) ----------
router.post('/orders/:id/whatsapp-invoice', requireAdmin, requirePermission('orders.manage'), async (req, res) => {
  const inv = await loadInvoiceData(req.params.id);
  if (!inv) return res.redirect('/admin/orders');
  const cfg = await getWhatsAppConfig(db);
  if (!cfg.configured) {
    await logInvoiceSend(req.params.id, 'whatsapp', inv.order.phone, false, 'WhatsApp Business API not configured.', req.session.adminEmail);
    return res.redirect('/admin/orders/' + req.params.id + '?msg=whatsapp-not-connected');
  }
  const [[phoneRow]] = await db.query("SELECT setting_value FROM settings WHERE setting_key = 'shop_phone'");
  const pdf = buildInvoicePdf(invoicePdfData(inv, phoneRow ? phoneRow.setting_value : ''));
  const result = await sendInvoiceDocument(cfg, inv.order.phone, pdf, inv.invoiceNo + '.pdf', [inv.invoiceNo, 'Tk ' + Number(inv.order.total_amount || 0).toFixed(2)]);
  await logInvoiceSend(req.params.id, 'whatsapp', inv.order.phone, result.ok, result.error || null, req.session.adminEmail);
  res.redirect('/admin/orders/' + req.params.id + (result.ok ? '?msg=whatsapp-sent' : '?err=whatsapp-failed'));
});

// ---------- PACKING SLIP (print-friendly page for courier dispatch) ----------
router.get('/orders/:id/packing-slip', requireAdmin, requirePermission('orders.view'), async (req, res) => {
  const [[order]] = await db.query('SELECT * FROM orders WHERE id = ?', [req.params.id]);
  if (!order) return res.redirect('/admin/orders');
  const [items] = await db.query('SELECT * FROM order_items WHERE order_id = ?', [req.params.id]);
  const [[phoneRow]] = await db.query("SELECT setting_value FROM settings WHERE setting_key = 'shop_phone'");
  res.render('admin/order-packing-slip', { order, items, siteName: 'Goince', shopPhone: phoneRow ? phoneRow.setting_value : '' });
});

// ---------- UPDATE ORDER STATUS ----------
router.post('/orders/:id/status', requireAdmin, requirePermission('orders.manage'), async (req, res) => {
  const { status, cancel_reason } = req.body;
  const dest = '/admin/orders/' + req.params.id;
  if (!ORDER_STATUSES.includes(status)) return res.redirect(dest + '?err=invalid-status');
  const [[order]] = await db.query('SELECT * FROM orders WHERE id = ?', [req.params.id]);
  if (!order) return res.redirect('/admin/invoices');
  const reason = (cancel_reason || '').trim();
  if (status === 'Cancelled' && !reason) return res.redirect(dest + '?err=cancel-reason');
  await db.query('UPDATE orders SET status = ?, cancel_reason = ? WHERE id = ?', [status, status === 'Cancelled' ? reason : null, req.params.id]);
  await recordStatusChange(req.params.id, order.status, status, status === 'Cancelled' ? ('Cancelled: ' + reason) : null, req.session.adminEmail);
  await audit(req, 'order.status', 'order', req.params.id, { from: order.status, to: status });
  // F3/F4/F5/F8 (feat/retention): status change -> customer email +
  // push (if enabled + email/configured); Delivered -> loyalty points
  // for the real order + referral reward for the friend's first
  // delivered order. All guarded — admin action never breaks.
  try {
    const settings = await ret.getRetentionSettings(db);
    const siteUrl = `${req.protocol}://${req.get('host')}`;
    await ret.notifyOrderStatus(db, order, status, settings, sendMail, siteUrl);
    if (order.user_id) {
      await ret.notifyCustomerPush(db, order.user_id, {
        title: `Goince order #${req.params.id} — ${status}`,
        body: `Your order status changed to ${status}.`,
        url: '/track-order',
      }, settings);
    }
    if (status === 'Delivered' && order.user_id) {
      await ret.awardPointsForOrder(db, req.params.id, settings);
      await ret.completeReferralReward(db, order.user_id, settings);
    }
  } catch (e) { console.error('Retention order-status hook failed:', e.message); }
  // I2 (feat/payments-messaging): order-status SMS — only when a
  // provider is configured AND the admin toggle is on. Best
  // effort: a failed SMS never blocks the status change.
  try {
    await sendOrderStatusSms(order, status, db);
  } catch (e) { console.error('Order-status SMS failed:', e.message); }
  res.redirect(dest);
});

// ---------- BULK UPDATE ORDER STATUS ----------
router.post('/orders/bulk-status', requireAdmin, requirePermission('orders.manage'), async (req, res) => {
  const { status, cancel_reason } = req.body;
  if (!ORDER_STATUSES.includes(status)) return res.redirect('/admin/orders?err=invalid-status');
  let ids = req.body.order_ids || [];
  if (!Array.isArray(ids)) ids = [ids];
  ids = ids.map(id => parseInt(id, 10)).filter(id => !isNaN(id));
  if (ids.length === 0) return res.redirect('/admin/orders?err=no-orders');
  const reason = (cancel_reason || '').trim();
  if (status === 'Cancelled' && !reason) return res.redirect('/admin/orders?err=cancel-reason');
  const [orders] = await db.query('SELECT id, status FROM orders WHERE id IN (' + ids.map(() => '?').join(',') + ')', ids);
  await db.query('UPDATE orders SET status = ?, cancel_reason = ? WHERE id IN (' + ids.map(() => '?').join(',') + ')', [status, status === 'Cancelled' ? reason : null, ...ids]);
  for (const o of orders) await recordStatusChange(o.id, o.status, status, status === 'Cancelled' ? ('Cancelled (bulk): ' + reason) : 'Bulk status update', req.session.adminEmail);
  await audit(req, 'order.bulk-status', 'order', ids.join(','), { to: status, count: ids.length });
  // F3/F4/F5 (feat/retention): same hooks as the single-status route.
  try {
    const settings = await ret.getRetentionSettings(db);
    const siteUrl = `${req.protocol}://${req.get('host')}`;
    const [fullOrders] = await db.query('SELECT * FROM orders WHERE id IN (' + ids.map(() => '?').join(',') + ')', ids);
    for (const o of fullOrders) {
      await ret.notifyOrderStatus(db, o, status, settings, sendMail, siteUrl);
      if (status === 'Delivered' && o.user_id) {
        await ret.awardPointsForOrder(db, o.id, settings);
        await ret.completeReferralReward(db, o.user_id, settings);
      }
    }
  } catch (e) { console.error('Retention bulk-status hook failed:', e.message); }
  res.redirect('/admin/orders?msg=bulk-updated');
});

// ---------- MARK ORDER AS PHONE-CONFIRMED ----------
router.post('/orders/:id/phone-confirmed', requireAdmin, requirePermission('orders.manage'), async (req, res) => {
  const [[order]] = await db.query('SELECT * FROM orders WHERE id = ?', [req.params.id]);
  if (!order) return res.redirect('/admin/orders');
  await db.query('UPDATE orders SET phone_confirmed = 1, phone_confirmed_at = NOW() WHERE id = ?', [req.params.id]);
  await recordStatusChange(req.params.id, order.status, order.status, 'Phone confirmed by admin', req.session.adminEmail);
  res.redirect('/admin/orders/' + req.params.id + '?msg=phone-confirmed');
});

// ---------- UNDO MARK ORDER AS PHONE-CONFIRMED ----------
// Reverts a mistaken confirmation: phone_confirmed back to 0, confirmed
// time cleared. Order status itself is untouched. Mirrors the COD undo.
router.post('/orders/:id/phone-unconfirmed', requireAdmin, requirePermission('orders.manage'), async (req, res) => {
  const [[order]] = await db.query('SELECT * FROM orders WHERE id = ?', [req.params.id]);
  if (!order) return res.redirect('/admin/orders');
  if (!order.phone_confirmed) return res.redirect('/admin/orders/' + req.params.id + '?err=not-phone-confirmed');
  await db.query('UPDATE orders SET phone_confirmed = 0, phone_confirmed_at = NULL WHERE id = ?', [req.params.id]);
  await recordStatusChange(req.params.id, order.status, order.status, 'Phone confirmation undone by admin', req.session.adminEmail);
  res.redirect('/admin/orders/' + req.params.id + '?msg=phone-unconfirmed');
});

// ---------- ADD ADMIN NOTE ----------
router.post('/orders/:id/notes', requireAdmin, requirePermission('orders.manage'), async (req, res) => {
  const note = (req.body.note || '').trim();
  if (!note) return res.redirect('/admin/orders/' + req.params.id);
  try {
    await db.query('INSERT INTO order_notes (order_id, note, created_by) VALUES (?, ?, ?)', [req.params.id, note, req.session.adminEmail || null]);
  } catch (e) { return res.redirect('/admin/orders/' + req.params.id); }
  res.redirect('/admin/orders/' + req.params.id + '?msg=note-saved');
});

// ---------- SEND SMS UPDATE (I2, feat/payments-messaging) ----------
// Real send now: lib/sms.js reads the provider + API key from
// Settings (passed the live DB here). Still "not configured"
// until donal saves a provider + key — then this button really
// sends, and a failed send redirects with the provider's error.
router.post('/orders/:id/sms', requireAdmin, requirePermission('orders.manage'), async (req, res) => {
  const [[order]] = await db.query('SELECT * FROM orders WHERE id = ?', [req.params.id]);
  if (!order) return res.redirect('/admin/orders');
  const message = 'Goince: your order #' + order.id + ' is ' + order.status + '.';
  const result = await sendSms(order.phone, message, db);
  if (!result.ok) return res.redirect('/admin/orders/' + req.params.id + '?msg=sms-not-connected');
  res.redirect('/admin/orders/' + req.params.id);
});

// ---------- MARK COD CASH AS COLLECTED ----------
// Only for Cash on Delivery orders. Sets cod_collected + collected time and
// flips payment_status to Paid (cash is in hand), so dashboard collected
// revenue counts it. Guarded — the columns do not exist until migrated.
router.post('/orders/:id/cod-collected', requireAdmin, requirePermission('orders.manage'), async (req, res) => {
  const [[order]] = await db.query('SELECT * FROM orders WHERE id = ?', [req.params.id]);
  if (!order) return res.redirect('/admin/invoices');
  const dest = '/admin/orders/' + req.params.id;
  if (order.payment_method !== 'Cash on Delivery') return res.redirect(dest + '?err=not-cod');
  if (order.cod_collected) return res.redirect(dest + '?err=already-collected');
  try {
    await db.query("UPDATE orders SET cod_collected = 1, cod_collected_at = NOW(), payment_status = 'Paid' WHERE id = ?", [req.params.id]);
  } catch (e) { return res.redirect(dest + '?err=not-cod'); }
  res.redirect(dest + '?msg=cod-collected');
});

// ---------- UNDO MARK COD CASH AS COLLECTED ----------
// Reverts a mistaken collection: cod_collected back to 0, collected time
// cleared, payment_status back to Unpaid. Order status itself is untouched.
// Mirrors the cod-collected route (COD orders only, guarded).
router.post('/orders/:id/cod-uncollected', requireAdmin, requirePermission('orders.manage'), async (req, res) => {
  const [[order]] = await db.query('SELECT * FROM orders WHERE id = ?', [req.params.id]);
  if (!order) return res.redirect('/admin/orders');
  if (order.payment_method !== 'Cash on Delivery') return res.redirect('/admin/orders/' + req.params.id + '?err=not-cod');
  if (!order.cod_collected) return res.redirect('/admin/orders/' + req.params.id + '?err=not-collected');
  try {
    await db.query("UPDATE orders SET cod_collected = 0, cod_collected_at = NULL, payment_status = 'Unpaid' WHERE id = ?", [req.params.id]);
  } catch (e) { return res.redirect('/admin/orders/' + req.params.id + '?err=not-cod'); }
  res.redirect('/admin/orders/' + req.params.id + '?msg=cod-uncollected');
});

// ---------- RECORD A RETURN (admin-only) ----------
const RETURN_STATUSES = ['Pending', 'Approved', 'Rejected', 'Completed'];
router.post('/orders/:id/returns', requireAdmin, requirePermission('orders.manage'), async (req, res) => {
  const reason = (req.body.reason || '').trim();
  if (!reason) return res.redirect('/admin/orders/' + req.params.id + '?err=return-reason');
  const [[order]] = await db.query('SELECT * FROM orders WHERE id = ?', [req.params.id]);
  if (!order) return res.redirect('/admin/orders');
  try {
    await db.query('INSERT INTO order_returns (order_id, reason, status, created_by) VALUES (?, ?, ?, ?)', [req.params.id, reason, 'Pending', req.session.adminEmail || null]);
  } catch (e) { return res.redirect('/admin/orders/' + req.params.id); }
  res.redirect('/admin/orders/' + req.params.id + '?msg=return-saved');
});

// ---------- UPDATE A RETURN'S STATUS (admin-only) ----------
router.post('/orders/:id/returns/:returnId/status', requireAdmin, requirePermission('orders.manage'), async (req, res) => {
  const { status } = req.body;
  if (!RETURN_STATUSES.includes(status)) return res.redirect('/admin/orders/' + req.params.id + '?err=invalid-status');
  try {
    await db.query('UPDATE order_returns SET status = ? WHERE id = ? AND order_id = ?', [status, req.params.returnId, req.params.id]);
    await audit(req, 'order.return-status', 'order', req.params.id, { returnId: req.params.returnId, to: status });
  } catch (e) { /* table not migrated yet */ }
  res.redirect('/admin/orders/' + req.params.id + '?msg=return-updated');
});

// ---------- UPDATE PAYMENT STATUS ----------
router.post('/orders/:id/payment-status', requireAdmin, requirePermission('orders.manage'), async (req, res) => {
  const { payment_status } = req.body;
  await db.query('UPDATE orders SET payment_status = ? WHERE id = ?', [payment_status, req.params.id]);
  res.redirect('/admin/orders/' + req.params.id);
});

// ---------- UPDATE COURIER / TRACKING INFO ----------
router.post('/orders/:id/shipping', requireAdmin, requirePermission('orders.manage'), async (req, res) => {
  const { courier_name, tracking_number } = req.body;
  await db.query(
    'UPDATE orders SET courier_name = ?, tracking_number = ? WHERE id = ?',
    [courier_name || null, tracking_number || null, req.params.id]
  );
  res.redirect('/admin/orders/' + req.params.id);
});

// ---------- CREATE COURIER CONSIGNMENT (Steadfast / Pathao API) ----------
router.post('/orders/:id/create-consignment', requireAdmin, requirePermission('orders.manage'), async (req, res) => {
  const [[order]] = await db.query('SELECT * FROM orders WHERE id = ?', [req.params.id]);
  if (!order) return res.redirect('/admin/orders');
  if (order.courier_consignment_id || order.tracking_number) return res.redirect('/admin/orders/' + order.id + '?courier=already');
  const config = await getCourierConfig(db);
  if (!config.configured) return res.redirect('/admin/orders/' + order.id + '?courier=not-configured');
  const [items] = await db.query('SELECT * FROM order_items WHERE order_id = ?', [order.id]);
  const result = await createConsignment(order, items, config);
  if (!result.ok) return res.redirect('/admin/orders/' + order.id + '?courier=failed');
  await db.query(
    'UPDATE orders SET courier_name = ?, tracking_number = ?, courier_consignment_id = ?, courier_status = ? WHERE id = ?',
    [result.courierName, result.trackingNumber, result.consignmentId, result.status || null, order.id]
  );
  res.redirect('/admin/orders/' + order.id + '?courier=created');
});

// ---------- REFRESH TRACKING STATUS FROM COURIER ----------
router.post('/orders/:id/refresh-tracking', requireAdmin, requirePermission('orders.manage'), async (req, res) => {
  const [[order]] = await db.query('SELECT * FROM orders WHERE id = ?', [req.params.id]);
  if (!order) return res.redirect('/admin/orders');
  if (!order.courier_consignment_id && !order.tracking_number) return res.redirect('/admin/orders/' + order.id + '?courier=no-consignment');
  const config = await getCourierConfig(db);
  const result = await getTrackingStatus(order, config);
  if (!result.ok) return res.redirect('/admin/orders/' + order.id + '?courier=status-failed');
  await db.query('UPDATE orders SET courier_status = ? WHERE id = ?', [result.status, order.id]);
  res.redirect('/admin/orders/' + order.id + '?courier=status-updated');
});

// ---------- COUPONS LIST ----------
// I5 (feat/admin-ops): each coupon shows its limits + real usage
// count (coupon_uses ledger) — a coupon with no limits shows "—".
router.get('/coupons', requireAdmin, requirePermission('coupons.manage'), async (req, res) => {
  const [coupons] = await db.query('SELECT * FROM coupons ORDER BY created_at DESC');
  let usageByCoupon = {};
  try {
    const [urows] = await db.query('SELECT coupon_id, COUNT(*) AS uses FROM coupon_uses GROUP BY coupon_id');
    urows.forEach(r => { usageByCoupon[r.coupon_id] = Number(r.uses || 0); });
  } catch (e) { /* ledger not migrated yet — usage stays 0 */ }
  coupons.forEach(c => { c.uses = usageByCoupon[c.id] || 0; });
  res.render('admin/coupons', { coupons, siteName: 'Goince' });
});

// ---------- ADD COUPON ----------
router.post('/coupons/add', requireAdmin, requirePermission('coupons.manage'), async (req, res) => {
  try {
    const { code, discount_percent, expiry_date } = req.body;
    const limits = ops.parseCouponLimits(req.body);
    const [result] = await db.query(
      'INSERT INTO coupons (code, discount_percent, expiry_date, max_total_uses, max_uses_per_customer, min_order_amount) VALUES (?, ?, ?, ?, ?, ?)',
      [code.toUpperCase().trim(), discount_percent, expiry_date || null, limits.max_total_uses, limits.max_uses_per_customer, limits.min_order_amount]
    );
    await audit(req, 'coupon.add', 'coupon', result.insertId, { code: code.toUpperCase().trim(), discount_percent, ...limits });
    res.redirect('/admin/coupons');
  } catch (err) {
    console.error(err);
    res.redirect('/admin/coupons');
  }
});

// ---------- EDIT COUPON LIMITS ----------
router.post('/coupons/edit/:id', requireAdmin, requirePermission('coupons.manage'), async (req, res) => {
  try {
    const limits = ops.parseCouponLimits(req.body);
    const discount = parseInt(req.body.discount_percent, 10);
    const sets = ['max_total_uses = ?', 'max_uses_per_customer = ?', 'min_order_amount = ?'];
    const params = [limits.max_total_uses, limits.max_uses_per_customer, limits.min_order_amount];
    if (Number.isFinite(discount) && discount >= 1 && discount <= 100) { sets.push('discount_percent = ?'); params.push(discount); }
    if (req.body.expiry_date !== undefined) { sets.push('expiry_date = ?'); params.push(req.body.expiry_date || null); }
    await db.query(`UPDATE coupons SET ${sets.join(', ')} WHERE id = ?`, [...params, req.params.id]);
    await audit(req, 'coupon.edit', 'coupon', req.params.id, { ...limits });
  } catch (err) { console.error(err); }
  res.redirect('/admin/coupons');
});

// ---------- TOGGLE COUPON ACTIVE/INACTIVE ----------
router.post('/coupons/toggle/:id', requireAdmin, requirePermission('coupons.manage'), async (req, res) => {
  await db.query('UPDATE coupons SET active = NOT active WHERE id = ?', [req.params.id]);
  await audit(req, 'coupon.toggle', 'coupon', req.params.id, {});
  res.redirect('/admin/coupons');
});

// ---------- DELETE COUPON ----------
router.post('/coupons/delete/:id', requireAdmin, requirePermission('coupons.manage'), async (req, res) => {
  await db.query('DELETE FROM coupons WHERE id = ?', [req.params.id]);
  await audit(req, 'coupon.delete', 'coupon', req.params.id, {});
  res.redirect('/admin/coupons');
});

// ==================== CUSTOMER MANAGEMENT ====================

// ---------- CUSTOMER LIST (can be searched by name/email/phone) ----------
router.get('/customers', requireAdmin, requirePermission('customers.manage'), async (req, res) => {
  const q = (req.query.q || '').trim();
  let sql = `SELECT users.*, COUNT(orders.id) AS order_count,
             COALESCE(SUM(CASE WHEN orders.status != 'Cancelled' THEN orders.total_amount ELSE 0 END), 0) AS total_spent
             FROM users LEFT JOIN orders ON orders.user_id = users.id`;
  const params = [];
  if (q) {
    sql += ` WHERE users.name LIKE ? OR users.email LIKE ? OR users.phone LIKE ?`;
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  sql += ` GROUP BY users.id ORDER BY users.created_at DESC`;
  const [customers] = await db.query(sql, params);
  // F9 (feat/retention): win-back run result, e.g. ?winback=issued:2&emailed=1
  let winbackMsg = null;
  const wb = String(req.query.winback || '');
  const wbm = /^issued:(\d+)$/.exec(wb);
  if (wbm) {
    const emailed = /^(\d+)$/.exec(String(req.query.emailed || ''));
    winbackMsg = `Win-back offers issued: ${wbm[1]}${emailed ? `, emails sent: ${emailed[1]}` : ''}. Coupons are in Admin > Coupons (WINBACK-…).`;
  }
  res.render('admin/customers', { customers, q, winbackMsg, siteName: 'Goince' });
});

// ---------- ADD CUSTOMER PAGE ----------
router.get('/customers/add', requireAdmin, requirePermission('customers.manage'), (req, res) => {
  res.render('admin/add-customer', { customer: null, error: null, siteName: 'Goince' });
});

router.post('/customers/add', requireAdmin, requirePermission('customers.manage'), async (req, res) => {
  try {
    const { name, email, phone, address, password } = req.body;

    if (!name || !email || !password) {
      return res.render('admin/add-customer', {
        customer: null, error: 'Please fill in all fields: Name, Email, and Password.', siteName: 'Goince'
      });
    }

    const [existing] = await db.query('SELECT id FROM users WHERE email = ?', [email.trim().toLowerCase()]);
    if (existing.length > 0) {
      return res.render('admin/add-customer', {
        customer: null, error: 'An account already exists with this email.', siteName: 'Goince'
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await db.query(
      'INSERT INTO users (name, email, password, phone, address) VALUES (?, ?, ?, ?, ?)',
      [name.trim(), email.trim().toLowerCase(), hashedPassword, phone || null, address || null]
    );
    res.redirect('/admin/customers');
  } catch (err) {
    console.error(err);
    res.render('admin/add-customer', { customer: null, error: 'Something went wrong.', siteName: 'Goince' });
  }
});

// ---------- EDIT CUSTOMER ----------
router.get('/customers/edit/:id', requireAdmin, requirePermission('customers.manage'), async (req, res) => {
  const [rows] = await db.query('SELECT * FROM users WHERE id = ?', [req.params.id]);
  if (rows.length === 0) return res.redirect('/admin/customers');
  res.render('admin/add-customer', { customer: rows[0], error: null, siteName: 'Goince' });
});

router.post('/customers/edit/:id', requireAdmin, requirePermission('customers.manage'), async (req, res) => {
  try {
    const { name, email, phone, address, password } = req.body;
    const id = req.params.id;

    if (!name || !email) {
      const [rows] = await db.query('SELECT * FROM users WHERE id = ?', [id]);
      return res.render('admin/add-customer', {
        customer: rows[0], error: 'Name and Email are required.', siteName: 'Goince'
      });
    }

    // Check whether the email conflicts with another user
    const [existing] = await db.query('SELECT id FROM users WHERE email = ? AND id != ?', [email.trim().toLowerCase(), id]);
    if (existing.length > 0) {
      const [rows] = await db.query('SELECT * FROM users WHERE id = ?', [id]);
      return res.render('admin/add-customer', {
        customer: rows[0], error: 'Another account already exists with this email.', siteName: 'Goince'
      });
    }

    if (password && password.trim()) {
      // If the password should also be changed
      const hashedPassword = await bcrypt.hash(password, 10);
      await db.query(
        'UPDATE users SET name=?, email=?, phone=?, address=?, password=? WHERE id=?',
        [name.trim(), email.trim().toLowerCase(), phone || null, address || null, hashedPassword, id]
      );
    } else {
      // If the password field is left blank, the old password stays
      await db.query(
        'UPDATE users SET name=?, email=?, phone=?, address=? WHERE id=?',
        [name.trim(), email.trim().toLowerCase(), phone || null, address || null, id]
      );
    }
    res.redirect('/admin/customers');
  } catch (err) {
    console.error(err);
    res.status(500).send('There was a problem updating the customer.');
  }
});

// ---------- DELETE CUSTOMER ----------
router.post('/customers/delete/:id', requireAdmin, requirePermission('customers.manage'), async (req, res) => {
  await db.query('DELETE FROM users WHERE id = ?', [req.params.id]);
  res.redirect('/admin/customers');
});

// ---------- BLOCK / UNBLOCK CUSTOMER ----------
router.post('/customers/:id/toggle-block', requireAdmin, requirePermission('customers.manage'), async (req, res) => {
  const [[customer]] = await db.query('SELECT is_blocked FROM users WHERE id = ?', [req.params.id]);
  if (!customer) return res.redirect('/admin/customers');
  await db.query('UPDATE users SET is_blocked = ? WHERE id = ?', [customer.is_blocked ? 0 : 1, req.params.id]);
  res.redirect(req.headers.referer || '/admin/customers/' + req.params.id);
});

// ---------- CUSTOMER DETAIL (profile + full order history) ----------
// This is kept at the bottom because Express matches routes in order —
// if it came first, "/customers/add" and "/customers/edit/5" would be mistaken for :id.
// WHMCS-style client profile (fix/whmcs-style-admin): the customer detail
// page has tabs — Overview (profile + stats), Orders, Messages (that
// customer's contact messages + live chats), Notes (admin note on the
// customer). Same data as before, only organised; no new data sources.
router.get('/customers/:id', requireAdmin, requirePermission('customers.manage'), async (req, res) => {
  const tab = ['overview', 'orders', 'messages', 'notes'].includes(req.query.tab) ? req.query.tab : 'overview';
  const [[customer]] = await db.query('SELECT * FROM users WHERE id = ?', [req.params.id]);
  if (!customer) return res.redirect('/admin/customers');

  const [orders] = await db.query(
    'SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC',
    [req.params.id]
  );

  const [[wishlistRow]] = await db.query(
    'SELECT COUNT(*) AS wishlistCount FROM wishlist WHERE user_id = ?',
    [req.params.id]
  );

  const totalOrders = orders.length;
  const validOrders = orders.filter(o => o.status !== 'Cancelled');
  const totalSpent = validOrders.reduce((sum, o) => sum + Number(o.total_amount), 0);
  const avgOrderValue = validOrders.length ? totalSpent / validOrders.length : 0;
  const lastOrderDate = orders.length ? orders[0].created_at : null;

  // Messages tab: this customer's contact messages (matched by email or
  // phone) and live-chat conversations (matched by user_id). Guarded so a
  // missing table can never break the profile page.
  let customerMessages = [], customerChats = [];
  try {
    [customerMessages] = await db.query(
      'SELECT * FROM contact_messages WHERE email = ? OR phone = ? ORDER BY created_at DESC LIMIT 50',
      [customer.email || '', customer.phone || '']
    );
  } catch (e) { customerMessages = []; }
  try {
    [customerChats] = await db.query(
      'SELECT * FROM chat_conversations WHERE user_id = ? ORDER BY last_message_at DESC LIMIT 20',
      [req.params.id]
    );
  } catch (e) { customerChats = []; }

  res.render('admin/customer-detail', {
    customer, orders, tab, customerMessages, customerChats,
    wishlistCount: wishlistRow.wishlistCount,
    totalOrders, totalSpent, avgOrderValue, lastOrderDate,
    siteName: 'Goince'
  });
});

// Save the admin note on a customer (Notes tab). customers.manage only.
router.post('/customers/:id/notes', requireAdmin, requirePermission('customers.manage'), async (req, res) => {
  const notes = String(req.body.notes || '').slice(0, 5000);
  try {
    await db.query('UPDATE users SET notes = ? WHERE id = ?', [notes || null, req.params.id]);
  } catch (e) { /* users.notes column not migrated yet — the tab still renders */ }
  res.redirect('/admin/customers/' + req.params.id + '?tab=notes');
});

// ==================== RETENTION (feat/retention, PR #88) ====================
// F1 — Abandoned carts: Admin > Sales > Abandoned Carts. Real carts
// that reached /checkout but were never ordered. "Send recovery
// email" respects the one-email rule (lib/retention.js
// sendAbandonedCartEmail) — an already-emailed cart can never be
// mailed twice, even from a double-click.
router.get('/abandoned-carts', requireAdmin, requirePermission('customers.manage'), async (req, res) => {
  let carts = [];
  try {
    [carts] = await db.query(
      `SELECT a.*, u.name AS customer_name FROM abandoned_carts a
       LEFT JOIN users u ON u.id = a.user_id
       ORDER BY a.updated_at DESC LIMIT 200`);
    for (const c of carts) {
      try { c.items = JSON.parse(c.cart_json || '[]'); } catch (e) { c.items = []; }
      c.subtotal = (c.items || []).reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.quantity) || 0), 0);
    }
  } catch (e) { carts = []; }
  res.render('admin/abandoned-carts', {
    carts,
    msg: req.query.msg === 'sent' ? 'Recovery email sent.' :
      req.query.msg === 'already' ? 'This cart was already emailed once — no second email was sent.' :
      req.query.msg === 'noemail' ? 'This cart has no email address — the recovery email cannot be sent.' :
      req.query.msg === 'failed' ? 'The email could not be sent — check that email is configured in Settings (Gmail App Password).' : null,
    siteName: 'Goince',
  });
});

router.post('/abandoned-carts/:id/email', requireAdmin, requirePermission('customers.manage'), async (req, res) => {
  const settings = await ret.getRetentionSettings(db);
  const siteUrl = `${req.protocol}://${req.get('host')}`;
  const r = await ret.sendAbandonedCartEmail(db, req.params.id, sendMail, siteUrl, settings);
  res.redirect('/admin/abandoned-carts?msg=' + (r.sent ? 'sent' : (r.reason === 'already-emailed' ? 'already' : (r.reason === 'no-email' ? 'noemail' : 'failed'))));
});

// F7 — Email campaigns / newsletter: Admin > Communication >
// Campaigns. Lists subscribers + sent campaigns; sending needs the
// campaigns toggle ON in Settings and never exceeds the per-send cap
// (admin setting, hard-capped at 500 in lib/retention.js).
router.get('/campaigns', requireAdmin, requirePermission('campaigns.manage'), async (req, res) => {
  let subscribers = [];
  let campaigns = [];
  let customerCount = 0;
  try {
    [subscribers] = await db.query('SELECT * FROM newsletter_subscribers WHERE subscribed = 1 ORDER BY created_at DESC LIMIT 500');
  } catch (e) { subscribers = []; }
  try {
    [campaigns] = await db.query('SELECT * FROM email_campaigns ORDER BY created_at DESC LIMIT 50');
  } catch (e) { campaigns = []; }
  try {
    const [[r]] = await db.query("SELECT COUNT(DISTINCT email) AS c FROM users WHERE email IS NOT NULL AND email != ''");
    customerCount = Number((r && r.c) || 0);
  } catch (e) { customerCount = 0; }
  const settings = await ret.getRetentionSettings(db);
  res.render('admin/campaigns', {
    subscribers, campaigns, customerCount,
    campaignsEnabled: ret.isOn(settings, 'campaigns_enabled'),
    campaignCap: ret.campaignRecipientCap(settings.campaign_max_recipients),
    emailConfigured: isEmailConfigured(),
    msg: req.query.msg === 'sent' ? 'Campaign sent.' :
      req.query.msg === 'disabled' ? 'Campaigns are OFF — enable "Email campaigns" in Settings first.' :
      req.query.msg === 'empty' ? 'Subject and message are both required.' :
      req.query.msg === 'failed' ? 'The campaign could not be sent — check that email is configured in Settings (Gmail App Password).' : null,
    siteName: 'Goince',
  });
});

router.post('/campaigns/send', requireAdmin, requirePermission('campaigns.manage'), async (req, res) => {
  const settings = await ret.getRetentionSettings(db);
  const r = await ret.sendCampaign(db, {
    subject: req.body.subject,
    body: req.body.body,
    audience: req.body.audience,
    createdBy: req.session.adminEmail || null,
  }, settings, sendMail);
  if (r.error === 'disabled') return res.redirect('/admin/campaigns?msg=disabled');
  if (r.error === 'empty') return res.redirect('/admin/campaigns?msg=empty');
  if (r.error) return res.redirect('/admin/campaigns?msg=failed');
  res.redirect('/admin/campaigns?msg=sent');
});

// F9 — Win-back run: issues a real coupon (existing coupons table)
// + email to every customer with no order in X days (Settings >
// Retention). One offer per customer per X days — re-running does
// not re-issue. Result is shown on the Customers page.
router.post('/winback/run', requireAdmin, requirePermission('campaigns.manage'), async (req, res) => {
  const settings = await ret.getRetentionSettings(db);
  const siteUrl = `${req.protocol}://${req.get('host')}`;
  const r = await ret.issueWinbackOffers(db, settings, sendMail, siteUrl);
  res.redirect(`/admin/customers?winback=issued:${r.issued}&emailed=${r.emailed}`);
});

// ==================== LIVE CHAT ====================

// ---------- CONVERSATION LIST ----------
router.get('/chats', requireAdmin, requirePermission('chats.manage'), async (req, res) => {
  const [conversations] = await db.query(
    `SELECT chat_conversations.*,
       (SELECT message FROM chat_messages WHERE conversation_id = chat_conversations.id ORDER BY created_at DESC LIMIT 1) AS last_message
     FROM chat_conversations
     ORDER BY last_message_at DESC`
  );
  res.render('admin/chats', { conversations, siteName: 'Goince' });
});

// ---------- SINGLE CONVERSATION VIEW ----------
router.get('/chats/:id', requireAdmin, requirePermission('chats.manage'), async (req, res) => {
  const [[conversation]] = await db.query('SELECT * FROM chat_conversations WHERE id = ?', [req.params.id]);
  if (!conversation) return res.redirect('/admin/chats');
  // I9 (feat/admin-ops): an admin has now seen this conversation —
  // clear its unread counter (guarded: old DBs have no column yet).
  try { await db.query('UPDATE chat_conversations SET unread_admin = 0 WHERE id = ?', [req.params.id]); } catch (e) { /* ignore */ }
  const [messages] = await db.query(
    'SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY created_at ASC',
    [req.params.id]
  );
  res.render('admin/chat-detail', { conversation, messages, siteName: 'Goince' });
});

// ---------- GET MESSAGES (JSON, admin side polling) ----------
router.get('/chats/:id/messages', requireAdmin, requirePermission('chats.manage'), async (req, res) => {
  const [messages] = await db.query(
    'SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY created_at ASC',
    [req.params.id]
  );
  res.json({ messages });
});

// ---------- ADMIN REPLY ----------
router.post('/chats/:id/reply', requireAdmin, requirePermission('chats.manage'), async (req, res) => {
  const message = (req.body.message || '').trim();
  if (message) {
    await db.query(
      'INSERT INTO chat_messages (conversation_id, sender, message) VALUES (?, ?, ?)',
      [req.params.id, 'admin', message]
    );
    await db.query('UPDATE chat_conversations SET last_message_at = NOW() WHERE id = ?', [req.params.id]);
  }
  res.redirect('/admin/chats/' + req.params.id);
});

// ==================== PAYMENT METHODS (bKash / Nagad / Rocket / any new mobile banking option) ====================
router.get('/payment-methods', requireAdmin, requirePermission('payment-methods.manage'), async (req, res) => {
  try {
    const [methods] = await db.query('SELECT * FROM payment_methods ORDER BY sort_order, id');
    res.render('admin/payment-methods', { methods, siteName: 'Goince' });
  } catch (err) {
    console.error('Payment methods list error:', err);
    res.status(500).send(`
      <div style="font-family:sans-serif; max-width:600px; margin:60px auto; padding:20px;">
        <h1>😕 Could Not Load Payment Methods</h1>
        <p><strong>Error:</strong> ${err.sqlMessage || err.message}</p>
        <p>The <code>sql/add_payment_methods.sql</code> file probably hasn't been run yet. Try this command:<br>
        <code>mysql -u root -p goince_db &lt; sql/add_payment_methods.sql</code></p>
        <a href="/admin/dashboard" style="color:#f0a500; font-weight:bold;">&larr; Back to Dashboard</a>
      </div>
    `);
  }
});

router.post('/payment-methods/add', requireAdmin, requirePermission('payment-methods.manage'), async (req, res) => {
  const methodName = (req.body.method_name || '').trim();
  const number = (req.body.number || '').trim() || null;

  if (methodName) {
    const [[maxOrder]] = await db.query('SELECT COALESCE(MAX(sort_order), 0) AS m FROM payment_methods');
    await db.query(
      'INSERT INTO payment_methods (method_name, number, payment_type, instructions, sort_order) VALUES (?, ?, ?, ?, ?)',
      [methodName, number, (req.body.payment_type || 'send_money'), (req.body.instructions || '').trim() || null, maxOrder.m + 1]
    );
  }
  res.redirect('/admin/payment-methods');
});

router.post('/payment-methods/edit/:id', requireAdmin, requirePermission('payment-methods.manage'), async (req, res) => {
  const methodName = (req.body.method_name || '').trim();
  const number = (req.body.number || '').trim() || null;
  await db.query('UPDATE payment_methods SET method_name = ?, number = ?, payment_type = ?, instructions = ? WHERE id = ?', [methodName, number, (req.body.payment_type || 'send_money'), (req.body.instructions || '').trim() || null, req.params.id]);
  res.redirect('/admin/payment-methods');
});

router.post('/payment-methods/toggle/:id', requireAdmin, requirePermission('payment-methods.manage'), async (req, res) => {
  await db.query('UPDATE payment_methods SET is_active = NOT is_active WHERE id = ?', [req.params.id]);
  res.redirect('/admin/payment-methods');
});

router.post('/payment-methods/delete/:id', requireAdmin, requirePermission('payment-methods.manage'), async (req, res) => {
  await db.query('DELETE FROM payment_methods WHERE id = ?', [req.params.id]);
  res.redirect('/admin/payment-methods');
});

// ==================== DELIVERY ZONES ====================
router.get('/delivery-zones', requireAdmin, requirePermission('delivery-zones.manage'), async (req, res) => {
  const [zones] = await db.query('SELECT * FROM delivery_zones ORDER BY sort_order, id');
  // I8 (feat/admin-ops): weight bands live on this page too.
  let bands = [];
  try { [bands] = await db.query('SELECT * FROM weight_delivery_bands ORDER BY max_weight_kg ASC, id ASC'); } catch (e) { bands = []; }
  res.render('admin/delivery-zones', { zones, bands, siteName: 'Goince' });
});

// ---------- WEIGHT-BASED DELIVERY BANDS (I8) ----------
// A band replaces the zone charge when the cart's total weight fits
// it (lightest matching band wins); no matching band = normal zone
// charge (৳60/৳120) — the default never changes.
router.post('/delivery-zones/weight-bands/add', requireAdmin, requirePermission('delivery-zones.manage'), async (req, res) => {
  const parsed = ops.parseWeightBand(req.body);
  if (parsed.ok) {
    try {
      const [result] = await db.query(
        'INSERT INTO weight_delivery_bands (zone_slug, max_weight_kg, charge) VALUES (?, ?, ?)',
        [parsed.band.zone_slug, parsed.band.max_weight_kg, parsed.band.charge]);
      await audit(req, 'delivery.weight-band-add', 'weight_band', result.insertId, parsed.band);
    } catch (e) { console.error(e); }
  }
  res.redirect('/admin/delivery-zones');
});
router.post('/delivery-zones/weight-bands/delete/:id', requireAdmin, requirePermission('delivery-zones.manage'), async (req, res) => {
  await db.query('DELETE FROM weight_delivery_bands WHERE id = ?', [req.params.id]);
  await audit(req, 'delivery.weight-band-delete', 'weight_band', req.params.id, {});
  res.redirect('/admin/delivery-zones');
});
router.post('/delivery-zones/weight-bands/toggle/:id', requireAdmin, requirePermission('delivery-zones.manage'), async (req, res) => {
  await db.query('UPDATE weight_delivery_bands SET is_active = NOT is_active WHERE id = ?', [req.params.id]);
  await audit(req, 'delivery.weight-band-toggle', 'weight_band', req.params.id, {});
  res.redirect('/admin/delivery-zones');
});
router.post('/delivery-zones/add', requireAdmin, requirePermission('delivery-zones.manage'), async (req, res) => {
  const name = (req.body.name || '').trim();
  const charge = parseFloat(req.body.charge);
  const deliveryTime = (req.body.delivery_time || '').trim() || null;
  if (name && !isNaN(charge)) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') + '_' + Date.now();
    const [[maxOrder]] = await db.query('SELECT COALESCE(MAX(sort_order), 0) AS m FROM delivery_zones');
    const [zres] = await db.query('INSERT INTO delivery_zones (name, slug, charge, delivery_time, sort_order) VALUES (?, ?, ?, ?, ?)',
      [name, slug, charge, deliveryTime, maxOrder.m + 1]);
    await audit(req, 'delivery.zone-add', 'delivery_zone', zres.insertId, { name, charge });
  }
  res.redirect('/admin/delivery-zones');
});
router.post('/delivery-zones/edit/:id', requireAdmin, requirePermission('delivery-zones.manage'), async (req, res) => {
  const name = (req.body.name || '').trim();
  const charge = parseFloat(req.body.charge);
  const deliveryTime = (req.body.delivery_time || '').trim() || null;
  if (name && !isNaN(charge)) {
    await db.query('UPDATE delivery_zones SET name = ?, charge = ?, delivery_time = ? WHERE id = ?', [name, charge, deliveryTime, req.params.id]);
    await audit(req, 'delivery.zone-edit', 'delivery_zone', req.params.id, { name, charge });
  }
  res.redirect('/admin/delivery-zones');
});
router.post('/delivery-zones/toggle/:id', requireAdmin, requirePermission('delivery-zones.manage'), async (req, res) => {
  await db.query('UPDATE delivery_zones SET is_active = NOT is_active WHERE id = ?', [req.params.id]);
  res.redirect('/admin/delivery-zones');
});
router.post('/delivery-zones/delete/:id', requireAdmin, requirePermission('delivery-zones.manage'), async (req, res) => {
  await db.query('DELETE FROM delivery_zones WHERE id = ?', [req.params.id]);
  await audit(req, 'delivery.zone-delete', 'delivery_zone', req.params.id, {});
  res.redirect('/admin/delivery-zones');
});

// ==================== SETTINGS ====================

router.get('/settings', requireAdmin, requirePermission('settings.manage'), async (req, res) => {
  const [rows] = await db.query(
    "SELECT setting_key, setting_value FROM settings WHERE setting_key IN ('shop_phone', 'delivery_charge_inside', 'delivery_charge_outside', 'hero_title', 'hero_subtitle', 'announcement_text', 'shop_address', 'facebook_url', 'hero_product_id', 'footer_about', 'shop_email', 'footer_hours', 'youtube_url', 'instagram_url', 'payment_mode', 'gateway_provider', 'gateway_enabled', 'gateway_store_id', 'gateway_store_password', 'gateway_mode', 'logo_url', 'favicon_url', 'og_image_url', 'courier_provider', 'courier_enabled', 'courier_mode', 'steadfast_api_key', 'steadfast_secret_key', 'pathao_client_id', 'pathao_client_secret', 'pathao_username', 'pathao_password', 'pathao_store_id', 'whatsapp_phone_number_id', 'whatsapp_access_token', 'whatsapp_template_name', 'loyalty_enabled', 'loyalty_earn_per', 'loyalty_redeem_points', 'loyalty_redeem_taka', 'loyalty_max_redeem_taka', 'referral_enabled', 'referral_reward_points', 'winback_enabled', 'winback_days', 'winback_discount_percent', 'order_status_email_enabled', 'back_in_stock_enabled', 'price_drop_enabled', 'abandoned_cart_email_enabled', 'abandoned_cart_cooldown_hours', 'campaigns_enabled', 'campaign_max_recipients', 'push_enabled', 'vapid_public_key', 'vapid_private_key', 'login_lockout_max_attempts', 'login_lockout_minutes', 'sms_provider', 'sms_enabled', 'sms_api_key', 'sms_sender_id', 'sms_endpoint', 'sms_order_status_enabled', 'backup_retention_days')"
  );
  const [products] = await db.query('SELECT id, name FROM products ORDER BY created_at DESC');
  const get = (key, fallback) => {
    const found = rows.find(r => r.setting_key === key);
    return found ? found.setting_value : fallback;
  };
  // Retention settings (feat/retention, F4–F9): defaults from
  // lib/retention.js when a key was never saved.
  const retention = Object.assign({}, ret.RETENTION_DEFAULTS);
  for (const k of ret.RETENTION_SETTING_KEYS) {
    const v = get(k, undefined);
    if (v !== undefined) retention[k] = v;
  }
  retention.vapidPrivateKeySet = !!get('vapid_private_key', '');
  res.render('admin/settings', {
    shopPhone: get('shop_phone', ''),
    deliveryChargeInside: get('delivery_charge_inside', '60'),
    deliveryChargeOutside: get('delivery_charge_outside', '120'),
    heroTitle: get('hero_title', ''),
    heroSubtitle: get('hero_subtitle', ''),
    announcementText: get('announcement_text', ''),
    shopAddress: get('shop_address', ''),
    facebookUrl: get('facebook_url', ''),
    heroProductId: get('hero_product_id', ''),
    footerAbout: get('footer_about', ''),
    shopEmail: get('shop_email', ''),
    footerHours: get('footer_hours', ''),
    youtubeUrl: get('youtube_url', ''),
    instagramUrl: get('instagram_url', ''),
    paymentMode: get('payment_mode', 'manual'),
    gatewayProvider: get('gateway_provider', 'none'),
    gatewayEnabled: get('gateway_enabled', '0'),
    gatewayStoreId: get('gateway_store_id', ''),
    gatewayMode: get('gateway_mode', 'sandbox'),
    gatewayPasswordSet: !!get('gateway_store_password', ''),
    courierProvider: get('courier_provider', 'none'),
    courierEnabled: get('courier_enabled', '0'),
    courierMode: get('courier_mode', 'sandbox'),
    courierSteadfastKeySet: !!get('steadfast_api_key', ''),
    courierPathaoSecretSet: !!get('pathao_client_secret', ''),
    courierPathaoPasswordSet: !!get('pathao_password', ''),
    pathaoClientId: get('pathao_client_id', ''),
    pathaoUsername: get('pathao_username', ''),
    pathaoStoreId: get('pathao_store_id', ''),
    whatsappPhoneNumberId: get('whatsapp_phone_number_id', ''),
    whatsappTokenSet: !!get('whatsapp_access_token', ''),
    whatsappTemplateName: get('whatsapp_template_name', 'invoice_pdf'),
    logoUrl: get('logo_url', '/icons/icon-192.png'),
    faviconUrl: get('favicon_url', '/icons/icon-192.png'),
    ogImageUrl: get('og_image_url', '/icons/icon-512.png'),
    retention,
    adminOps: { loginLockoutMaxAttempts: get('login_lockout_max_attempts', '5'), loginLockoutMinutes: get('login_lockout_minutes', '15') },
    // I2 (feat/payments-messaging): SMS provider settings — the
    // API key is never passed to the view, only whether one is set.
    sms: {
      provider: get('sms_provider', 'none'),
      enabled: get('sms_enabled', '0'),
      apiKeySet: !!get('sms_api_key', ''),
      senderId: get('sms_sender_id', ''),
      endpoint: get('sms_endpoint', ''),
      orderStatusEnabled: get('sms_order_status_enabled', '0'),
    },
    // I12 (feat/payments-messaging): how many days of daily
    // backups to keep (older files are deleted automatically).
    backupRetentionDays: get('backup_retention_days', '14'),
    products,
    message: null,
    pwMessage: req.query.pw === 'ok' ? 'Password changed successfully!' :
      req.query.pw === 'wrong' ? 'Current password is wrong — password was not changed.' :
      req.query.pw === 'mismatch' ? 'New passwords do not match — password was not changed.' :
      req.query.pw === 'short' ? 'New password must be at least 6 characters.' :
      req.query.pw === 'noaccount' ? 'No admin account found in the database — use Forgot Password instead.' : null,
    siteName: 'Goince'
  });
});

// ---------- MY PROFILE (fix/admin-profile-section) ----------
// Every signed-in admin can open their own profile — requireAdmin only,
// no permission check, so Staff sees it too. The admins table has NO
// display-name column (id, email, password, role, role_id, reset_token,
// reset_expires, created_at), so the name shown is the email local part
// (same as the top-bar pill) and the email is read-only here.
router.get('/profile', requireAdmin, async (req, res) => {
  let adminRow = null;
  try {
    if (req.session.adminId) {
      const [[row]] = await db.query('SELECT * FROM admins WHERE id = ?', [req.session.adminId]);
      adminRow = row || null;
    }
    if (!adminRow && req.session.adminEmail) {
      const [rows] = await db.query('SELECT * FROM admins WHERE email = ?', [req.session.adminEmail]);
      adminRow = rows[0] || null;
    }
    if (!adminRow) {
      const [rows] = await db.query('SELECT * FROM admins ORDER BY id ASC LIMIT 1');
      adminRow = rows[0] || null;
    }
  } catch (e) { adminRow = null; }
  const email = (adminRow && adminRow.email) || req.session.adminEmail || '';
  // Display name (fix/admin-profile-photo): the admins table now has a
  // display_name column; when empty, the name is the email local part —
  // exactly as the top-bar pill showed it before.
  const name = (adminRow && adminRow.display_name) ? String(adminRow.display_name) : (String(email).split('@')[0] || 'Admin');
  // Raw stored name (fix/whmcs-one-line-topbar): the form must pre-fill
  // with the value actually stored in the DB — NOT the effective name
  // above. Pre-filling the fallback (email local part) baked it into
  // display_name on every save, so the name could never be cleared back
  // to the email fallback.
  const rawDisplayName = (adminRow && adminRow.display_name) ? String(adminRow.display_name) : '';
  const photoUrl = (adminRow && adminRow.photo_url && String(adminRow.photo_url).startsWith('/uploads/')) ? String(adminRow.photo_url) : null;
  const phone = (adminRow && adminRow.phone) ? String(adminRow.phone) : '';
  const roleLabel = req.session.adminRole || (adminRow && adminRow.role) || 'owner';
  let memberSince = null;
  if (adminRow && adminRow.created_at) {
    try { memberSince = new Date(adminRow.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { memberSince = null; }
  }
  res.render('admin/profile', {
    adminName: name,
    adminDisplayNameRaw: rawDisplayName,
    adminEmail: email,
    adminRoleLabel: roleLabel,
    memberSince,
    photoUrl,
    phone,
    profileOk: req.query.saved === 'details' || req.query.saved === 'photo' || req.query.saved === 'removed' || req.query.saved === 'email',
    profileMessage: req.query.saved === 'details' ? 'Profile details saved.' :
      req.query.saved === 'photo' ? 'Profile photo saved.' :
      req.query.saved === 'removed' ? 'Profile photo removed.' :
      req.query.saved === 'email' ? 'Email changed successfully — use the new address to sign in next time.' :
      req.query.err === 'name' ? 'Display name must be 1–60 characters.' :
      req.query.err === 'phone' ? 'Enter a valid Bangladeshi mobile number (01XXXXXXXXX) or leave it blank.' :
      req.query.err === 'email' ? 'Enter a valid email address.' :
      req.query.err === 'emailmatch' ? 'The two new email addresses do not match.' :
      req.query.err === 'emailsame' ? 'The new email is the same as your current one.' :
      req.query.err === 'emailtaken' ? 'Another admin already uses that email address.' :
      req.query.err === 'emailpw' ? 'Current password is wrong — email was not changed.' :
      req.query.err === 'photo' ? 'Choose a photo file (jpg, png or webp, up to 5 MB).' :
      req.query.err === 'crop' ? 'The photo could not be cropped — try another photo.' :
      req.query.err === 'noaccount' ? 'No admin account found in the database — use Forgot Password instead.' : null,
    pwOk: req.query.pw === 'ok',
    pwMessage: req.query.pw === 'ok' ? 'Password changed successfully!' :
      req.query.pw === 'wrong' ? 'Current password is wrong — password was not changed.' :
      req.query.pw === 'mismatch' ? 'New passwords do not match — password was not changed.' :
      req.query.pw === 'short' ? 'New password must be at least 6 characters.' :
      req.query.pw === 'noaccount' ? 'No admin account found in the database — use Forgot Password instead.' : null,
    emailConfigured: isEmailConfigured(),
    siteName: 'Goince'
  });
});

// ---------- MY PROFILE: DETAILS + PHOTO (fix/admin-profile-photo) ----------
// Same row lookup as GET /profile above (session id first, else the first
// admin row) — shared by the details + photo save routes below.
async function loadProfileAdminRow(req) {
  let adminRow = null;
  try {
    if (req.session.adminId) {
      const [[row]] = await db.query('SELECT * FROM admins WHERE id = ?', [req.session.adminId]);
      adminRow = row || null;
    }
    if (!adminRow) {
      const [rows] = await db.query('SELECT * FROM admins ORDER BY id ASC LIMIT 1');
      adminRow = rows[0] || null;
    }
  } catch (e) { adminRow = null; }
  return adminRow;
}

// Display name + phone: validated in lib/admin-profile.js (name 1–60
// characters, phone optional but must be a valid Bangladeshi mobile
// number). The email stays read-only — it is the sign-in address.
router.post('/profile/details', requireAdmin, async (req, res) => {
  const result = validateProfileDetails({ displayName: req.body.display_name, phone: req.body.phone });
  if (!result.ok) return res.redirect('/admin/profile?err=' + result.errors[0]);
  const adminRow = await loadProfileAdminRow(req);
  if (!adminRow) return res.redirect('/admin/profile?err=noaccount');
  await db.query('UPDATE admins SET display_name = ?, phone = ? WHERE id = ?', [result.displayName, result.phone, adminRow.id]);
  req.session.adminDisplayName = result.displayName;
  return res.redirect('/admin/profile?saved=details');
});

// Change email (fix/admin-theme-hover-profile): new email + confirm +
// current password (required — proving the admin owns the account).
// Format/match/different checks live in lib/admin-profile.js; the
// current-password check and the duplicate check need the DB, so they
// live here. On success the DB row AND the session are updated, so the
// top-bar pill and dropdown show the new address immediately.
router.post('/profile/email', requireAdmin, async (req, res) => {
  const adminRow = await loadProfileAdminRow(req);
  if (!adminRow) return res.redirect('/admin/profile?err=noaccount');
  const result = validateEmailChange({
    currentEmail: adminRow.email,
    newEmail: req.body.new_email,
    confirmEmail: req.body.confirm_new_email,
  });
  if (!result.ok) return res.redirect('/admin/profile?err=' + result.errors[0]);
  const ok = await bcrypt.compare(req.body.current_password || '', adminRow.password);
  if (!ok) return res.redirect('/admin/profile?err=emailpw');
  const [taken] = await db.query('SELECT id FROM admins WHERE email = ? AND id != ?', [result.email, adminRow.id]);
  if (taken.length > 0) return res.redirect('/admin/profile?err=emailtaken');
  await db.query('UPDATE admins SET email = ? WHERE id = ?', [result.email, adminRow.id]);
  req.session.adminEmail = result.email;
  return res.redirect('/admin/profile?saved=email');
});

// Profile photo: one image (jpg/png/webp, up to 5 MB — the shared upload
// filter), cropped to a 256x256 WebP square with the browser-sent crop
// fractions (lib/admin-profile.js clamps them to the image bounds; no
// crop sent = centred square). The old photo file is deleted on replace.
router.post('/profile/photo', requireAdmin, (req, res) => {
  upload.single('photo')(req, res, async (err) => {
    const fs = require('fs');
    const path = require('path');
    if (err || !req.file) return res.redirect('/admin/profile?err=photo');
    try {
      const adminRow = await loadProfileAdminRow(req);
      if (!adminRow) { try { fs.unlinkSync(req.file.path); } catch (e) { /* ignore */ } return res.redirect('/admin/profile?err=noaccount'); }
      const data = await fs.promises.readFile(req.file.path);
      const cropped = await cropProfilePhoto(data, { x: req.body.crop_x, y: req.body.crop_y, size: req.body.crop_size });
      const filename = 'admin-photo-' + adminRow.id + '-' + Date.now() + '.webp';
      await fs.promises.writeFile(path.join(__dirname, '..', 'public', 'uploads', filename), cropped.buffer);
      try { fs.unlinkSync(req.file.path); } catch (e) { /* ignore */ }
      const oldUrl = adminRow.photo_url;
      await db.query('UPDATE admins SET photo_url = ? WHERE id = ?', ['/uploads/' + filename, adminRow.id]);
      req.session.adminPhotoUrl = '/uploads/' + filename;
      if (oldUrl && String(oldUrl).startsWith('/uploads/admin-photo-')) {
        try { fs.unlinkSync(path.join(__dirname, '..', 'public', oldUrl)); } catch (e) { /* already gone */ }
      }
      return res.redirect('/admin/profile?saved=photo');
    } catch (e) {
      try { if (req.file && req.file.path) fs.unlinkSync(req.file.path); } catch (e2) { /* ignore */ }
      return res.redirect('/admin/profile?err=crop');
    }
  });
});

// Remove the profile photo — back to the initial-letter avatar.
router.post('/profile/photo/remove', requireAdmin, async (req, res) => {
  const fs = require('fs');
  const path = require('path');
  const adminRow = await loadProfileAdminRow(req);
  if (!adminRow) return res.redirect('/admin/profile?err=noaccount');
  const oldUrl = adminRow.photo_url;
  await db.query('UPDATE admins SET photo_url = NULL WHERE id = ?', [adminRow.id]);
  req.session.adminPhotoUrl = null;
  if (oldUrl && String(oldUrl).startsWith('/uploads/admin-photo-')) {
    try { fs.unlinkSync(path.join(__dirname, '..', 'public', oldUrl)); } catch (e) { /* already gone */ }
  }
  return res.redirect('/admin/profile?saved=removed');
});

// ---------- CHANGE ADMIN PASSWORD (Settings theke, nijer password nije bodlano) ----------
router.post('/settings/change-password', requireAdmin, async (req, res) => {
  const { current_password, new_password, confirm_password } = req.body;
  // Where to land after the change: Settings by default. The profile
  // page posts this SAME endpoint with return_to=/admin/profile, so the
  // admin lands back on their profile. Only same-site /admin paths.
  const returnTo = (typeof req.body.return_to === 'string' && /^\/admin\/[A-Za-z0-9/_-]*$/.test(req.body.return_to)) ? req.body.return_to : '/admin/settings';
  const done = (code) => res.redirect(returnTo + '?pw=' + code);
  if ((new_password || '').length < 6) return done('short');
  if (new_password !== confirm_password) return done('mismatch');
  let adminRow = null;
  if (req.session.adminId) {
    const [[row]] = await db.query('SELECT * FROM admins WHERE id = ?', [req.session.adminId]);
    adminRow = row || null;
  }
  if (!adminRow) {
    const [rows] = await db.query('SELECT * FROM admins ORDER BY id ASC LIMIT 1');
    adminRow = rows[0] || null;
  }
  if (!adminRow) return done('noaccount');
  const ok = await bcrypt.compare(current_password || '', adminRow.password);
  if (!ok) return done('wrong');
  const hashed = await bcrypt.hash(new_password, 10);
  await db.query('UPDATE admins SET password = ? WHERE id = ?', [hashed, adminRow.id]);
  return done('ok');
});

router.post('/settings', requireAdmin, requirePermission('settings.manage'), upload.fields([{ name: 'logo_file', maxCount: 1 }, { name: 'favicon_file', maxCount: 1 }, { name: 'og_file', maxCount: 1 }]), upload.convertToWebP, async (req, res) => {
  const shopPhone = (req.body.shop_phone || '').trim();
  // Logo upload: an uploaded file wins; otherwise the URL field value is used; if both are blank, the previous logo stays
  const logoFromFile = (req.files && req.files.logo_file && req.files.logo_file[0]) ? ('/uploads/' + req.files.logo_file[0].filename) : '';
  const faviconFromFile = (req.files && req.files.favicon_file && req.files.favicon_file[0]) ? ('/uploads/' + req.files.favicon_file[0].filename) : '';
  const ogFromFile = (req.files && req.files.og_file && req.files.og_file[0]) ? ('/uploads/' + req.files.og_file[0].filename) : '';
  const logoUrl = logoFromFile || (req.body.logo_url || '').trim();
  const faviconUrl = faviconFromFile || (req.body.favicon_url || '').trim();
  const ogImageUrl = ogFromFile || (req.body.og_image_url || '').trim();
  const deliveryChargeInside = parseFloat(req.body.delivery_charge_inside);
  const deliveryChargeOutside = parseFloat(req.body.delivery_charge_outside);

  // The delivery charge must be a number, otherwise the previous value is kept
  const safeInside = isNaN(deliveryChargeInside) ? 60 : deliveryChargeInside;
  const safeOutside = isNaN(deliveryChargeOutside) ? 120 : deliveryChargeOutside;

  const settingsToSave = [
    ['shop_phone', shopPhone],
    ['delivery_charge_inside', String(safeInside)],
    ['delivery_charge_outside', String(safeOutside)],
    ['hero_title', (req.body.hero_title || '').trim()],
    ['hero_subtitle', (req.body.hero_subtitle || '').trim()],
    ['announcement_text', (req.body.announcement_text || '').trim()],
    ['shop_address', (req.body.shop_address || '').trim()],
    ['facebook_url', (req.body.facebook_url || '').trim()],
    ['hero_product_id', (req.body.hero_product_id || '').trim()],
    ['footer_about', (req.body.footer_about || '').trim()],
    ['shop_email', (req.body.shop_email || '').trim()],
    ['footer_hours', (req.body.footer_hours || '').trim()],
    ['youtube_url', (req.body.youtube_url || '').trim()],
    ['instagram_url', (req.body.instagram_url || '').trim()],
    ['payment_mode', ['manual', 'gateway', 'both'].includes(req.body.payment_mode) ? req.body.payment_mode : 'manual'],
    ['gateway_provider', ['none', 'sslcommerz', 'shurjopay', 'bkash'].includes(req.body.gateway_provider) ? req.body.gateway_provider : 'none'],
    ['gateway_enabled', req.body.gateway_enabled === '1' ? '1' : '0'],
    ['gateway_store_id', (req.body.gateway_store_id || '').trim()],
    ['gateway_mode', req.body.gateway_mode === 'live' ? 'live' : 'sandbox'],
    ['courier_provider', ['none', 'steadfast', 'pathao'].includes(req.body.courier_provider) ? req.body.courier_provider : 'none'],
    ['courier_enabled', req.body.courier_enabled === '1' ? '1' : '0'],
    ['courier_mode', req.body.courier_mode === 'live' ? 'live' : 'sandbox'],
    ['pathao_client_id', (req.body.pathao_client_id || '').trim()],
    ['pathao_username', (req.body.pathao_username || '').trim()],
    ['pathao_store_id', (req.body.pathao_store_id || '').trim()],
    ['whatsapp_phone_number_id', (req.body.whatsapp_phone_number_id || '').trim()],
    ['whatsapp_template_name', (req.body.whatsapp_template_name || '').trim() || 'invoice_pdf'],
    // Retention (feat/retention, F4–F9): every toggle/rate is an admin
    // setting, never hardcoded. Numbers are clamped to sane ranges.
    ['loyalty_enabled', req.body.loyalty_enabled === '1' ? '1' : '0'],
    ['loyalty_earn_per', String(Math.max(1, parseInt(req.body.loyalty_earn_per, 10) || 100))],
    ['loyalty_redeem_points', String(Math.max(1, parseInt(req.body.loyalty_redeem_points, 10) || 100))],
    ['loyalty_redeem_taka', String(Math.max(1, parseInt(req.body.loyalty_redeem_taka, 10) || 10))],
    ['loyalty_max_redeem_taka', String(Math.max(0, parseInt(req.body.loyalty_max_redeem_taka, 10) || 0))],
    ['referral_enabled', req.body.referral_enabled === '1' ? '1' : '0'],
    ['referral_reward_points', String(Math.max(0, parseInt(req.body.referral_reward_points, 10) || 0))],
    ['winback_enabled', req.body.winback_enabled === '1' ? '1' : '0'],
    ['winback_days', String(Math.max(1, parseInt(req.body.winback_days, 10) || 60))],
    ['winback_discount_percent', String(Math.min(100, Math.max(1, parseInt(req.body.winback_discount_percent, 10) || 10)))],
    ['order_status_email_enabled', req.body.order_status_email_enabled === '1' ? '1' : '0'],
    ['back_in_stock_enabled', req.body.back_in_stock_enabled === '1' ? '1' : '0'],
    ['price_drop_enabled', req.body.price_drop_enabled === '1' ? '1' : '0'],
    ['abandoned_cart_email_enabled', req.body.abandoned_cart_email_enabled === '1' ? '1' : '0'],
    ['abandoned_cart_cooldown_hours', String(Math.max(0, parseInt(req.body.abandoned_cart_cooldown_hours, 10) || 0))],
    ['campaigns_enabled', req.body.campaigns_enabled === '1' ? '1' : '0'],
    // Admin Ops (feat/admin-ops, I15): customer login lockout — how
    // many failed attempts lock the account, and for how long.
    ['login_lockout_max_attempts', String(Math.min(20, Math.max(1, parseInt(req.body.login_lockout_max_attempts, 10) || 5)))],
    ['login_lockout_minutes', String(Math.min(1440, Math.max(1, parseInt(req.body.login_lockout_minutes, 10) || 15)))],
    // I2 (feat/payments-messaging): SMS provider — the API key
    // is saved only when typed (blank keeps the saved one, like
    // the gateway password); it is never echoed back to the form.
    ['sms_provider', ['none', 'generic'].includes(req.body.sms_provider) ? req.body.sms_provider : 'none'],
    ['sms_enabled', req.body.sms_enabled === '1' ? '1' : '0'],
    ['sms_sender_id', (req.body.sms_sender_id || '').trim()],
    ['sms_endpoint', (req.body.sms_endpoint || '').trim()],
    ['sms_order_status_enabled', req.body.sms_order_status_enabled === '1' ? '1' : '0'],
    // I12 (feat/payments-messaging): backup retention in days.
    ['backup_retention_days', String(Math.min(90, Math.max(1, parseInt(req.body.backup_retention_days, 10) || 14)))],
    ['campaign_max_recipients', String(Math.min(500, Math.max(1, parseInt(req.body.campaign_max_recipients, 10) || 200)))],
    ['push_enabled', req.body.push_enabled === '1' ? '1' : '0'],
    ['vapid_public_key', (req.body.vapid_public_key || '').trim()],
    ['logo_url', logoUrl || '/icons/icon-192.png'],
    ['favicon_url', faviconUrl || '/icons/icon-192.png'],
    ['og_image_url', ogImageUrl || '/icons/icon-512.png']
  ];
  // VAPID private key: blank keeps the saved one (never shown in the form)
  if ((req.body.vapid_private_key || '').trim()) {
    settingsToSave.push(['vapid_private_key', (req.body.vapid_private_key || '').trim()]);
  }
  // If the gateway password is left blank, the previous one stays (it is never shown in the form)
  if ((req.body.gateway_store_password || '').trim()) {
    settingsToSave.push(['gateway_store_password', (req.body.gateway_store_password || '').trim()]);
  }
  // Same for courier secrets: blank keeps the saved one (they are never shown in the form)
  if ((req.body.steadfast_api_key || '').trim()) settingsToSave.push(['steadfast_api_key', (req.body.steadfast_api_key || '').trim()]);
  if ((req.body.steadfast_secret_key || '').trim()) settingsToSave.push(['steadfast_secret_key', (req.body.steadfast_secret_key || '').trim()]);
  if ((req.body.pathao_client_secret || '').trim()) settingsToSave.push(['pathao_client_secret', (req.body.pathao_client_secret || '').trim()]);
  if ((req.body.pathao_password || '').trim()) settingsToSave.push(['pathao_password', (req.body.pathao_password || '').trim()]);
  // WhatsApp Business API token: blank keeps the saved one (never shown in the form)
  if ((req.body.whatsapp_access_token || '').trim()) settingsToSave.push(['whatsapp_access_token', (req.body.whatsapp_access_token || '').trim()]);
  // SMS API key: blank keeps the saved one (never shown in the form)
  if ((req.body.sms_api_key || '').trim()) settingsToSave.push(['sms_api_key', (req.body.sms_api_key || '').trim()]);

  for (const [key, value] of settingsToSave) {
    await db.query(
      "INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?",
      [key, value, value]
    );
  }
  await audit(req, 'settings.save', 'settings', null, { keys: settingsToSave.length });

  const [products] = await db.query('SELECT id, name FROM products ORDER BY created_at DESC');
  const [[gwRow]] = await db.query("SELECT setting_value FROM settings WHERE setting_key = 'gateway_store_password'");
  const gatewayPasswordSet = !!(gwRow && gwRow.setting_value);
  // Courier secrets: saved or just entered (never shown in the form)
  const [[sfKeyRow]] = await db.query("SELECT setting_value FROM settings WHERE setting_key = 'steadfast_api_key'");
  const courierSteadfastKeySet = !!((req.body.steadfast_api_key || '').trim() || (sfKeyRow && sfKeyRow.setting_value));
  const [[paSecRow]] = await db.query("SELECT setting_value FROM settings WHERE setting_key = 'pathao_client_secret'");
  const courierPathaoSecretSet = !!((req.body.pathao_client_secret || '').trim() || (paSecRow && paSecRow.setting_value));
  const [[paPwRow]] = await db.query("SELECT setting_value FROM settings WHERE setting_key = 'pathao_password'");
  const courierPathaoPasswordSet = !!((req.body.pathao_password || '').trim() || (paPwRow && paPwRow.setting_value));
  const [[waTokenRow]] = await db.query("SELECT setting_value FROM settings WHERE setting_key = 'whatsapp_access_token'");
  // SMS API key: saved or just entered (never shown in the form)
  const [[smsKeyRow]] = await db.query("SELECT setting_value FROM settings WHERE setting_key = 'sms_api_key'");
  const [[vapidPrivRow]] = await db.query("SELECT setting_value FROM settings WHERE setting_key = 'vapid_private_key'");
  // Retention re-render values: re-read what was just saved (a form
  // never echoes the private VAPID key back — only whether one is set).
  const retention = await ret.getRetentionSettings(db);
  retention.vapidPrivateKeySet = !!(vapidPrivRow && vapidPrivRow.setting_value);
  res.render('admin/settings', {
    shopPhone,
    deliveryChargeInside: safeInside,
    deliveryChargeOutside: safeOutside,
    heroTitle: (req.body.hero_title || '').trim(),
    heroSubtitle: (req.body.hero_subtitle || '').trim(),
    announcementText: (req.body.announcement_text || '').trim(),
    shopAddress: (req.body.shop_address || '').trim(),
    facebookUrl: (req.body.facebook_url || '').trim(),
    heroProductId: (req.body.hero_product_id || '').trim(),
    footerAbout: (req.body.footer_about || '').trim(),
    shopEmail: (req.body.shop_email || '').trim(),
    footerHours: (req.body.footer_hours || '').trim(),
    youtubeUrl: (req.body.youtube_url || '').trim(),
    instagramUrl: (req.body.instagram_url || '').trim(),
    paymentMode: ['manual', 'gateway', 'both'].includes(req.body.payment_mode) ? req.body.payment_mode : 'manual',
    gatewayProvider: ['none', 'sslcommerz', 'shurjopay', 'bkash'].includes(req.body.gateway_provider) ? req.body.gateway_provider : 'none',
    gatewayEnabled: req.body.gateway_enabled === '1' ? '1' : '0',
    gatewayStoreId: (req.body.gateway_store_id || '').trim(),
    gatewayMode: req.body.gateway_mode === 'live' ? 'live' : 'sandbox',
    gatewayPasswordSet,
    courierProvider: ['none', 'steadfast', 'pathao'].includes(req.body.courier_provider) ? req.body.courier_provider : 'none',
    courierEnabled: req.body.courier_enabled === '1' ? '1' : '0',
    courierMode: req.body.courier_mode === 'live' ? 'live' : 'sandbox',
    courierSteadfastKeySet,
    courierPathaoSecretSet,
    courierPathaoPasswordSet,
    pathaoClientId: (req.body.pathao_client_id || '').trim(),
    pathaoUsername: (req.body.pathao_username || '').trim(),
    pathaoStoreId: (req.body.pathao_store_id || '').trim(),
    whatsappPhoneNumberId: (req.body.whatsapp_phone_number_id || '').trim(),
    whatsappTokenSet: !!((req.body.whatsapp_access_token || '').trim() || (waTokenRow && waTokenRow.setting_value)),
    whatsappTemplateName: (req.body.whatsapp_template_name || '').trim() || 'invoice_pdf',
    logoUrl: logoUrl || '/icons/icon-192.png',
    faviconUrl: faviconUrl || '/icons/icon-192.png',
    ogImageUrl: ogImageUrl || '/icons/icon-512.png',
    retention,
    adminOps: { loginLockoutMaxAttempts: String(Math.min(20, Math.max(1, parseInt(req.body.login_lockout_max_attempts, 10) || 5))), loginLockoutMinutes: String(Math.min(1440, Math.max(1, parseInt(req.body.login_lockout_minutes, 10) || 15))) },
    // I2/I12 (feat/payments-messaging): re-render the SMS +
    // backup values just saved (API key itself never echoed).
    sms: {
      provider: ['none', 'generic'].includes(req.body.sms_provider) ? req.body.sms_provider : 'none',
      enabled: req.body.sms_enabled === '1' ? '1' : '0',
      apiKeySet: !!((req.body.sms_api_key || '').trim() || (smsKeyRow && smsKeyRow.setting_value)),
      senderId: (req.body.sms_sender_id || '').trim(),
      endpoint: (req.body.sms_endpoint || '').trim(),
      orderStatusEnabled: req.body.sms_order_status_enabled === '1' ? '1' : '0',
    },
    backupRetentionDays: String(Math.min(90, Math.max(1, parseInt(req.body.backup_retention_days, 10) || 14))),
    products,
    message: 'Settings updated! They will appear on the homepage and footer right away.',
    siteName: 'Goince'
  });
});

// ==================== DATABASE BACKUPS (I12, feat/payments-messaging) ====================
// Daily mysqldump (scheduled in server.js) + manual runs + admin-only
// downloads. Files live in <app>/backups/ and are NEVER served
// publicly — the only way out is the download route below, guarded
// by requireAdmin + backups.manage, with a strict filename check
// (lib/backups.js isSafeBackupFileName — no slashes, no "..").
router.get('/backups', requireAdmin, requirePermission('backups.manage'), async (req, res) => {
  const dir = backups.backupDir(path.join(__dirname, '..'));
  const files = backups.listBackupFiles(dir);
  let rows = [];
  try {
    [rows] = await db.query('SELECT * FROM backups ORDER BY created_at DESC LIMIT 50');
  } catch (e) { rows = []; }
  res.render('admin/backups', {
    files, rows,
    backupMsg: req.query.msg === 'ok' ? 'Backup finished.' : req.query.msg === 'deleted' ? 'Backup deleted.' : null,
    backupErr: req.query.err === 'failed' ? (req.query.reason || 'Backup failed.') : null,
    siteName: 'Goince',
  });
});

router.post('/backups/run', requireAdmin, requirePermission('backups.manage'), async (req, res) => {
  let retentionDays = 14;
  try {
    const [[row]] = await db.query("SELECT setting_value FROM settings WHERE setting_key = 'backup_retention_days'");
    retentionDays = parseInt(row && row.setting_value, 10) || 14;
  } catch (e) { /* default 14 days */ }
  const result = await backups.runBackup({ appRoot: path.join(__dirname, '..'), db, triggeredBy: 'manual', retentionDays });
  await audit(req, 'backup.run', 'backup', result.filename || null, { ok: result.ok });
  if (!result.ok) {
    await backups.recordBackupFailure(db, null, 'manual', result.error);
    return res.redirect('/admin/backups?err=failed&reason=' + encodeURIComponent(result.error));
  }
  res.redirect('/admin/backups?msg=ok');
});

router.get('/backups/download/:file', requireAdmin, requirePermission('backups.manage'), async (req, res) => {
  const file = req.params.file;
  if (!backups.isSafeBackupFileName(file)) return res.status(400).send('Invalid backup file name.');
  const fullPath = path.join(backups.backupDir(path.join(__dirname, '..')), file);
  if (!fs.existsSync(fullPath)) return res.status(404).send('Backup file not found.');
  await audit(req, 'backup.download', 'backup', file, {});
  res.download(fullPath, file);
});

router.post('/backups/delete/:file', requireAdmin, requirePermission('backups.manage'), async (req, res) => {
  const file = req.params.file;
  if (!backups.isSafeBackupFileName(file)) return res.redirect('/admin/backups');
  try { fs.unlinkSync(path.join(backups.backupDir(path.join(__dirname, '..')), file)); } catch (e) { /* already gone */ }
  try { await db.query('DELETE FROM backups WHERE filename = ?', [file]); } catch (e) { /* the table row is a bonus */ }
  await audit(req, 'backup.delete', 'backup', file, {});
  res.redirect('/admin/backups?msg=deleted');
});

// ==================== HOMEPAGE BANNERS ====================

router.get('/banners', requireAdmin, requirePermission('banners.manage'), async (req, res) => {
  const [banners] = await db.query('SELECT * FROM banners ORDER BY sort_order ASC, id DESC');
  res.render('admin/banners', { banners, editing: null, siteName: 'Goince' });
});
router.post('/banners/add', requireAdmin, requirePermission('banners.manage'), upload.single('image'), upload.convertToWebP, async (req, res) => {
  const image = req.file ? '/uploads/' + req.file.filename : ((req.body.image_url || '').trim() || null);
  await db.query(
    'INSERT INTO banners (title, subtitle, image, link_url, sort_order, is_active) VALUES (?, ?, ?, ?, ?, 1)',
    [(req.body.title || '').trim(), (req.body.subtitle || '').trim() || null, image, (req.body.link_url || '').trim() || null, parseInt(req.body.sort_order, 10) || 0]
  );
  res.redirect('/admin/banners');
});
router.get('/banners/edit/:id', requireAdmin, requirePermission('banners.manage'), async (req, res) => {
  const [[editing]] = await db.query('SELECT * FROM banners WHERE id = ?', [req.params.id]);
  if (!editing) return res.redirect('/admin/banners');
  const [banners] = await db.query('SELECT * FROM banners ORDER BY sort_order ASC, id DESC');
  res.render('admin/banners', { banners, editing, siteName: 'Goince' });
});
router.post('/banners/edit/:id', requireAdmin, requirePermission('banners.manage'), upload.single('image'), upload.convertToWebP, async (req, res) => {
  const [[old]] = await db.query('SELECT * FROM banners WHERE id = ?', [req.params.id]);
  if (!old) return res.redirect('/admin/banners');
  const image = req.file ? '/uploads/' + req.file.filename : ((req.body.image_url || '').trim() || old.image);
  await db.query(
    'UPDATE banners SET title = ?, subtitle = ?, image = ?, link_url = ?, sort_order = ? WHERE id = ?',
    [(req.body.title || '').trim(), (req.body.subtitle || '').trim() || null, image, (req.body.link_url || '').trim() || null, parseInt(req.body.sort_order, 10) || 0, req.params.id]
  );
  res.redirect('/admin/banners');
});
router.post('/banners/:id/toggle', requireAdmin, requirePermission('banners.manage'), async (req, res) => {
  await db.query('UPDATE banners SET is_active = 1 - is_active WHERE id = ?', [req.params.id]);
  res.redirect('/admin/banners');
});
router.post('/banners/:id/delete', requireAdmin, requirePermission('banners.manage'), async (req, res) => {
  await db.query('DELETE FROM banners WHERE id = ?', [req.params.id]);
  res.redirect('/admin/banners');
});

// ==================== CONTACT MESSAGES (website-er Contact form) ====================
// ==================== CONTACT MESSAGES (ticket-style, WHMCS-style admin) ====================
// Messages work like support tickets: each has a Status (Open / Answered /
// Closed) and an admin reply. `is_read` stays in sync (Open = unread).
// Live Chat is untouched. The unread count feeds the top-bar bell.
const MESSAGE_STATUSES = ['open', 'answered', 'closed'];
// Professional polish 2: /admin/contact-messages was a 404 that dropped
// out of the admin layout into the shop layout — it is the messages page.
router.get('/contact-messages', requireAdmin, (req, res) => res.redirect('/admin/messages'));
router.get('/messages', requireAdmin, requirePermission('messages.manage'), async (req, res) => {
  const statusFilter = MESSAGE_STATUSES.includes(req.query.status) ? req.query.status : 'all';
  let messages = [];
  try {
    if (statusFilter === 'all') {
      [messages] = await db.query('SELECT * FROM contact_messages ORDER BY created_at DESC LIMIT 100');
    } else {
      [messages] = await db.query('SELECT * FROM contact_messages WHERE status = ? ORDER BY created_at DESC LIMIT 100', [statusFilter]);
    }
  } catch (e) { messages = []; }
  let unread = 0, statusCounts = { open: 0, answered: 0, closed: 0 };
  try { const [[u]] = await db.query('SELECT COUNT(*) AS unread FROM contact_messages WHERE is_read = 0'); unread = Number((u && u.unread) || 0); } catch (e) { /* unread stays 0 */ }
  try {
    const [rows] = await db.query("SELECT status, COUNT(*) AS c FROM contact_messages GROUP BY status");
    (rows || []).forEach(r => { if (MESSAGE_STATUSES.includes(r.status)) statusCounts[r.status] = Number(r.c || 0); });
  } catch (e) { /* status counts stay 0 */ }
  const total = statusCounts.open + statusCounts.answered + statusCounts.closed;
  res.render('admin/messages', { messages, unread, statusFilter, statusCounts, total, siteName: 'Goince' });
});
// Message detail: full message + reply box + status control.
router.get('/messages/:id', requireAdmin, requirePermission('messages.manage'), async (req, res) => {
  const [[message]] = await db.query('SELECT * FROM contact_messages WHERE id = ?', [req.params.id]);
  if (!message) return res.redirect('/admin/messages');
  res.render('admin/message-detail', { message, siteName: 'Goince' });
});
// Save the admin reply: stores the reply, stamps replied_at, marks the
// ticket Answered and read. (The reply is a record of what was said by
// phone/WhatsApp — messages are not emailed from here.)
router.post('/messages/:id/reply', requireAdmin, requirePermission('messages.manage'), async (req, res) => {
  const reply = String(req.body.reply || '').trim().slice(0, 5000);
  if (reply) {
    await db.query("UPDATE contact_messages SET reply = ?, replied_at = NOW(), status = 'answered', is_read = 1 WHERE id = ?", [reply, req.params.id]);
  }
  res.redirect('/admin/messages/' + req.params.id);
});
// Change ticket status (Open / Answered / Closed). is_read follows the
// status: Open = unread, anything else = read.
router.post('/messages/:id/status', requireAdmin, requirePermission('messages.manage'), async (req, res) => {
  const status = MESSAGE_STATUSES.includes(req.body.status) ? req.body.status : null;
  if (status) {
    await db.query('UPDATE contact_messages SET status = ?, is_read = ? WHERE id = ?', [status, status === 'open' ? 0 : 1, req.params.id]);
  }
  res.redirect('/admin/messages/' + req.params.id);
});
router.post('/messages/:id/read', requireAdmin, requirePermission('messages.manage'), async (req, res) => {
  await db.query("UPDATE contact_messages SET is_read = 1, status = CASE WHEN status = 'open' THEN 'answered' ELSE status END WHERE id = ?", [req.params.id]);
  res.redirect('/admin/messages');
});
router.post('/messages/:id/delete', requireAdmin, requirePermission('messages.manage'), async (req, res) => {
  await db.query('DELETE FROM contact_messages WHERE id = ?', [req.params.id]);
  res.redirect('/admin/messages');
});

// ==================== REVIEWS MODERATION ====================

router.get('/reviews', requireAdmin, requirePermission('reviews.manage'), async (req, res) => {
  const { status } = req.query;
  const where = [];
  const params = [];
  if (status) { where.push('r.status = ?'); params.push(status); }
  const [reviews] = await db.query(
    `SELECT r.*, p.name AS product_name, u.name AS user_name FROM reviews r
     LEFT JOIN products p ON r.product_id = p.id
     LEFT JOIN users u ON r.user_id = u.id`
    + (where.length ? ' WHERE ' + where.join(' AND ') : '') + `
     ORDER BY r.created_at DESC LIMIT 200`,
    params
  );
  const [[{ pending }]] = await db.query("SELECT COUNT(*) AS pending FROM reviews WHERE status = 'pending'");
  // D4 (feat/product-page): Product Q&A — shopper-er proshno gulo
  // ekhanei ase (pending age, tarpor answered). Admin uttor dile
  // tobei shop-e dekhabe; uttor na deoa proshno public-e othe na.
  let questions = [];
  let pendingQuestions = 0;
  try {
    const [qrows] = await db.query(
      `SELECT q.*, p.name AS product_name FROM product_questions q
       LEFT JOIN products p ON q.product_id = p.id
       ORDER BY CASE WHEN q.status = 'pending' THEN 0 ELSE 1 END, q.created_at DESC LIMIT 200`
    );
    questions = qrows;
    pendingQuestions = qrows.filter((q) => q.status === 'pending').length;
  } catch (e) { questions = []; }
  res.render('admin/reviews', { reviews, pending, status: status || '', questions, pendingQuestions, siteName: 'Goince' });
});
router.post('/reviews/:id/approve', requireAdmin, requirePermission('reviews.manage'), async (req, res) => {
  await db.query("UPDATE reviews SET status = 'approved' WHERE id = ?", [req.params.id]);
  res.redirect('/admin/reviews');
});
router.post('/reviews/:id/hide', requireAdmin, requirePermission('reviews.manage'), async (req, res) => {
  await db.query("UPDATE reviews SET status = 'hidden' WHERE id = ?", [req.params.id]);
  res.redirect('/admin/reviews');
});
router.post('/reviews/:id/delete', requireAdmin, requirePermission('reviews.manage'), async (req, res) => {
  await db.query('DELETE FROM reviews WHERE id = ?', [req.params.id]);
  res.redirect('/admin/reviews');
});

// ---------- PRODUCT Q&A MODERATION (D4, feat/product-page) ----------
// Admin uttor likhle proshno-ta 'answered' hoy ar shop-er product
// page-e dekhay; khali uttor dile kichu bodlay na. Delete korle
// proshno-ta chirotore muche jay. Reviews-er motoi 'reviews.manage'
// permission lage — alada kono notun permission noy.
router.post('/questions/:id/answer', requireAdmin, requirePermission('reviews.manage'), async (req, res) => {
  const answer = String(req.body.answer || '').trim();
  if (!answer) return res.redirect('/admin/reviews');
  await db.query(
    "UPDATE product_questions SET answer = ?, status = 'answered', answered_at = NOW() WHERE id = ?",
    [answer.slice(0, 2000), req.params.id]
  );
  res.redirect('/admin/reviews');
});
router.post('/questions/:id/delete', requireAdmin, requirePermission('reviews.manage'), async (req, res) => {
  await db.query('DELETE FROM product_questions WHERE id = ?', [req.params.id]);
  res.redirect('/admin/reviews');
});

// ==================== TEST EMAIL (Debug tool) ====================

router.get('/test-email', requireAdmin, requirePermission('test-email.send'), (req, res) => {
  res.render('admin/test-email', { result: null, testEmail: '', siteName: 'Goince' });
});

router.post('/test-email', requireAdmin, requirePermission('test-email.send'), async (req, res) => {
  const { test_email } = req.body;
  const { sendTestEmail } = require('../config/email');
  const result = await sendTestEmail(test_email);
  res.render('admin/test-email', { result, testEmail: test_email, siteName: 'Goince' });
});

// ==================== STAFF (admin users + roles) ====================
// Owner-only (staff.manage permission): notun admin banano, role bodlano,
// password reset, delete. Roles are custom now (fix/custom-roles-permissions):
// the 3 system roles (Owner / Manager / Staff) behave exactly as before,
// and donal can create his own roles at /admin/roles.

// Parse a role value from a staff form: 'role:<id>' (any role, system or
// custom) or a legacy name ('owner' / 'manager' / 'staff'). A custom role
// keeps the legacy `role` column at 'staff' (least privilege) so any code
// path that still reads the string never over-grants; role_id decides.
function parseRoleInput(value) {
  if (!value) return { roleId: null, legacyRole: 'staff' };
  const m = String(value).match(/^role:(\d+)$/);
  if (m) return { roleId: parseInt(m[1], 10), legacyRole: 'staff' };
  if (ROLES.includes(value)) return { roleId: null, legacyRole: value };
  return { roleId: null, legacyRole: 'staff' };
}

// Look up the seeded system role id for a legacy name (Owner / Manager /
// Staff), so a legacy choice also gets a role_id. Null when the roles
// table is not there yet.
async function systemRoleId(name) {
  try {
    const [rows] = await db.query('SELECT id FROM roles WHERE name = ? AND is_system = 1', [name]);
    return rows && rows[0] ? rows[0].id : null;
  } catch (err) {
    return null;
  }
}

// All roles for the staff dropdowns (system first, then custom by name).
async function loadAllRoles() {
  try {
    const [roles] = await db.query('SELECT id, name, description, is_system FROM roles ORDER BY is_system DESC, name ASC');
    return roles || [];
  } catch (err) {
    return [];
  }
}

// Effective role of one admin: role row (role_id) if set, else legacy string.
async function effectiveRoleOf(adminId) {
  const [rows] = await db.query(
    'SELECT a.id, a.role, a.role_id, r.name AS role_name, r.is_system FROM admins a LEFT JOIN roles r ON r.id = a.role_id WHERE a.id = ?',
    [adminId]);
  if (!rows || !rows.length) return null;
  const row = rows[0];
  const isOwner = (row.role_id && row.is_system === 1 && row.role_name === 'Owner')
    || (!row.role_id && row.role === 'owner');
  return { id: row.id, roleName: row.role_id ? row.role_name : row.role, isOwner };
}

// How many effective Owners exist (system Owner role, or legacy 'owner'
// with no role_id). Used by the last-Owner guard.
async function countEffectiveOwners() {
  try {
    const [rows] = await db.query(
      "SELECT COUNT(*) AS cnt FROM admins a LEFT JOIN roles r ON r.id = a.role_id WHERE (r.is_system = 1 AND r.name = 'Owner') OR (a.role_id IS NULL AND a.role = 'owner')");
    return rows && rows[0] ? Number(rows[0].cnt) || 0 : 0;
  } catch (err) {
    const [rows] = await db.query("SELECT COUNT(*) AS cnt FROM admins WHERE role = 'owner'");
    return rows && rows[0] ? Number(rows[0].cnt) || 0 : 0;
  }
}

router.get('/staff', requireAdmin, requirePermission('staff.manage'), async (req, res) => {
  try {
    const [admins] = await db.query('SELECT id, email, role, role_id, created_at FROM admins ORDER BY id ASC');
    const roles = await loadAllRoles();
    res.render('admin/staff', { admins, roles, meId: req.session.adminId, siteName: 'Goince', message: req.query.msg || null, error: req.query.err || null });
  } catch (err) {
    res.render('admin/staff', { admins: [], roles: [], meId: req.session.adminId, siteName: 'Goince', message: null, error: 'Could not load staff list.' });
  }
});

router.post('/staff/add', requireAdmin, requirePermission('staff.manage'), async (req, res) => {
  const { email, password } = req.body;
  const parsed = parseRoleInput(req.body.role);
  if (!email || !password || password.length < 6) {
    return res.redirect('/admin/staff?err=' + encodeURIComponent('Email and a password of at least 6 characters are required.'));
  }
  try {
    const [existing] = await db.query('SELECT id FROM admins WHERE email = ?', [email.trim()]);
    if (existing.length > 0) return res.redirect('/admin/staff?err=' + encodeURIComponent('An admin with this email already exists.'));
    let roleId = parsed.roleId;
    if (!roleId && ROLES.includes(parsed.legacyRole)) roleId = await systemRoleId(parsed.legacyRole.charAt(0).toUpperCase() + parsed.legacyRole.slice(1));
    const hashed = await bcrypt.hash(password, 10);
    await db.query('INSERT INTO admins (email, password, role, role_id) VALUES (?, ?, ?, ?)', [email.trim(), hashed, parsed.legacyRole, roleId]);
    res.redirect('/admin/staff?msg=' + encodeURIComponent('Staff account created.'));
  } catch (err) {
    res.redirect('/admin/staff?err=' + encodeURIComponent('Could not create staff account.'));
  }
});

router.post('/staff/:id/role', requireAdmin, requirePermission('staff.manage'), async (req, res) => {
  const parsed = parseRoleInput(req.body.role);
  try {
    const target = await effectiveRoleOf(req.params.id);
    if (!target) return res.redirect('/admin/staff?err=' + encodeURIComponent('Admin not found.'));
    // Nijer role nije bodlate parbe na; sesh Owner-ke Owner theke sorano jabe na
    if (String(target.id) === String(req.session.adminId)) {
      return res.redirect('/admin/staff?err=' + encodeURIComponent('You cannot change your own role.'));
    }
    if (target.isOwner) {
      const owners = await countEffectiveOwners();
      if (owners <= 1) return res.redirect('/admin/staff?err=' + encodeURIComponent('There must be at least one Owner.'));
    }
    let roleId = parsed.roleId;
    if (!roleId && ROLES.includes(parsed.legacyRole)) roleId = await systemRoleId(parsed.legacyRole.charAt(0).toUpperCase() + parsed.legacyRole.slice(1));
    await db.query('UPDATE admins SET role = ?, role_id = ? WHERE id = ?', [parsed.legacyRole, roleId, req.params.id]);
    res.redirect('/admin/staff?msg=' + encodeURIComponent('Role updated.'));
  } catch (err) {
    res.redirect('/admin/staff?err=' + encodeURIComponent('Could not update role.'));
  }
});

router.post('/staff/:id/reset-password', requireAdmin, requirePermission('staff.manage'), async (req, res) => {
  const { new_password } = req.body;
  if (!new_password || new_password.length < 6) {
    return res.redirect('/admin/staff?err=' + encodeURIComponent('New password must be at least 6 characters.'));
  }
  try {
    const hashed = await bcrypt.hash(new_password, 10);
    await db.query('UPDATE admins SET password = ? WHERE id = ?', [hashed, req.params.id]);
    res.redirect('/admin/staff?msg=' + encodeURIComponent('Password reset.'));
  } catch (err) {
    res.redirect('/admin/staff?err=' + encodeURIComponent('Could not reset password.'));
  }
});

router.post('/staff/:id/delete', requireAdmin, requirePermission('staff.manage'), async (req, res) => {
  try {
    const target = await effectiveRoleOf(req.params.id);
    if (!target) return res.redirect('/admin/staff?err=' + encodeURIComponent('Admin not found.'));
    if (String(target.id) === String(req.session.adminId)) {
      return res.redirect('/admin/staff?err=' + encodeURIComponent('You cannot delete your own account.'));
    }
    if (target.isOwner) {
      const owners = await countEffectiveOwners();
      if (owners <= 1) return res.redirect('/admin/staff?err=' + encodeURIComponent('There must be at least one Owner.'));
    }
    await db.query('DELETE FROM admins WHERE id = ?', [req.params.id]);
    res.redirect('/admin/staff?msg=' + encodeURIComponent('Staff account deleted.'));
  } catch (err) {
    res.redirect('/admin/staff?err=' + encodeURIComponent('Could not delete staff account.'));
  }
});

// ==================== ROLES (custom roles & permissions) ====================
// Staff & Roles > Roles: donal creates his own roles and ticks exactly which
// features each role can use. The editor renders its checkboxes FROM
// lib/permissions.js (PERMISSION_GROUPS), so a future feature added to the
// registry appears here automatically — no view change needed.
// Guards (kept from PR #17, extended): Owner always has every permission;
// at least one Owner must remain; system roles are view-only; a role in use
// cannot be deleted; nobody can grant a permission they lack themselves
// (stripped server-side on save).

async function loadRoleById(id) {
  const [rows] = await db.query('SELECT * FROM roles WHERE id = ?', [id]);
  return rows && rows[0] ? rows[0] : null;
}

router.get('/roles', requireAdmin, requirePermission('staff.manage'), async (req, res) => {
  try {
    const [roles] = await db.query(
      'SELECT r.*, COUNT(a.id) AS member_count FROM roles r LEFT JOIN admins a ON a.role_id = r.id GROUP BY r.id ORDER BY r.is_system DESC, r.name ASC');
    const list = (roles || []).map(r => ({ ...r, permissions: parsePermissions(r.permissions) }));
    res.render('admin/roles', { roles: list, siteName: 'Goince', message: req.query.msg || null, error: req.query.err || null });
  } catch (err) {
    res.render('admin/roles', { roles: [], siteName: 'Goince', message: null, error: 'Could not load roles.' });
  }
});

router.get('/roles/add', requireAdmin, requirePermission('staff.manage'), async (req, res) => {
  res.render('admin/role-form', {
    role: null, readOnly: false, permissionGroups: PERMISSION_GROUPS,
    siteName: 'Goince', message: null, error: req.query.err || null,
  });
});

router.post('/roles/add', requireAdmin, requirePermission('staff.manage'), async (req, res) => {
  const name = String(req.body.name || '').trim();
  const description = String(req.body.description || '').trim() || null;
  if (!name) {
    return res.redirect('/admin/roles/add?err=' + encodeURIComponent('Role name is required.'));
  }
  try {
    const [existing] = await db.query('SELECT id FROM roles WHERE name = ?', [name]);
    if (existing.length > 0) return res.redirect('/admin/roles/add?err=' + encodeURIComponent('A role with this name already exists.'));
    // Nobody can grant a permission they lack themselves.
    const perms = filterGrantable(req.body.permissions, req.session.adminPermissions);
    await db.query('INSERT INTO roles (name, description, permissions, is_system) VALUES (?, ?, ?, 0)',
      [name, description, JSON.stringify(perms)]);
    res.redirect('/admin/roles?msg=' + encodeURIComponent('Role created.'));
  } catch (err) {
    res.redirect('/admin/roles/add?err=' + encodeURIComponent('Could not create role.'));
  }
});

router.get('/roles/edit/:id', requireAdmin, requirePermission('staff.manage'), async (req, res) => {
  try {
    const role = await loadRoleById(req.params.id);
    if (!role) return res.redirect('/admin/roles?err=' + encodeURIComponent('Role not found.'));
    res.render('admin/role-form', {
      role: { ...role, permissions: parsePermissions(role.permissions) },
      readOnly: role.is_system === 1, permissionGroups: PERMISSION_GROUPS,
      siteName: 'Goince', message: null, error: req.query.err || null,
    });
  } catch (err) {
    res.redirect('/admin/roles?err=' + encodeURIComponent('Could not load role.'));
  }
});

router.post('/roles/edit/:id', requireAdmin, requirePermission('staff.manage'), async (req, res) => {
  const name = String(req.body.name || '').trim();
  const description = String(req.body.description || '').trim() || null;
  if (!name) {
    return res.redirect('/admin/roles/edit/' + req.params.id + '?err=' + encodeURIComponent('Role name is required.'));
  }
  try {
    const role = await loadRoleById(req.params.id);
    if (!role) return res.redirect('/admin/roles?err=' + encodeURIComponent('Role not found.'));
    if (role.is_system === 1) {
      return res.redirect('/admin/roles?err=' + encodeURIComponent('System roles cannot be edited.'));
    }
    const [existing] = await db.query('SELECT id FROM roles WHERE name = ? AND id != ?', [name, req.params.id]);
    if (existing.length > 0) return res.redirect('/admin/roles/edit/' + req.params.id + '?err=' + encodeURIComponent('A role with this name already exists.'));
    // Nobody can grant a permission they lack themselves.
    const perms = filterGrantable(req.body.permissions, req.session.adminPermissions);
    await db.query('UPDATE roles SET name = ?, description = ?, permissions = ? WHERE id = ?',
      [name, description, JSON.stringify(perms), req.params.id]);
    res.redirect('/admin/roles?msg=' + encodeURIComponent('Role updated.'));
  } catch (err) {
    res.redirect('/admin/roles/edit/' + req.params.id + '?err=' + encodeURIComponent('Could not update role.'));
  }
});

router.post('/roles/delete/:id', requireAdmin, requirePermission('staff.manage'), async (req, res) => {
  try {
    const role = await loadRoleById(req.params.id);
    if (!role) return res.redirect('/admin/roles?err=' + encodeURIComponent('Role not found.'));
    if (role.is_system === 1) {
      return res.redirect('/admin/roles?err=' + encodeURIComponent('System roles cannot be deleted.'));
    }
    const [members] = await db.query('SELECT COUNT(*) AS cnt FROM admins WHERE role_id = ?', [req.params.id]);
    if (members && members[0] && Number(members[0].cnt) > 0) {
      return res.redirect('/admin/roles?err=' + encodeURIComponent('This role is in use by ' + members[0].cnt + ' staff member(s). Change their role first.'));
    }
    await db.query('DELETE FROM roles WHERE id = ?', [req.params.id]);
    res.redirect('/admin/roles?msg=' + encodeURIComponent('Role deleted.'));
  } catch (err) {
    res.redirect('/admin/roles?err=' + encodeURIComponent('Could not delete role.'));
  }
});

// ==================== REPORTS ====================
// Daily / Weekly / Monthly / Yearly / All Time / Custom Date Range sales report
// Shared by /admin/reports and /admin/reports/export: period -> WHERE condition
function getReportPeriod(query) {
  const validPeriods = ['daily', 'weekly', 'monthly', 'yearly', 'all', 'custom'];
  const period = validPeriods.includes(query.period) ? query.period : 'daily';
  let dateCondition = '1=1';
  let params = [];
  let periodLabel = 'All Time';
  let customFrom = query.from || '';
  let customTo = query.to || '';
  // One date format everywhere in the admin: "25 Nov 2026".
  const fmtDay = (iso) => {
    const d = new Date(String(iso || '') + 'T00:00:00');
    return isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  };
  const fmtToday = () => new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Dhaka' });
  if (period === 'daily') {
    dateCondition = 'DATE(created_at) = CURDATE()';
    periodLabel = "Today (" + fmtToday() + ")";
  } else if (period === 'weekly') {
    dateCondition = 'YEARWEEK(created_at, 1) = YEARWEEK(CURDATE(), 1)';
    periodLabel = 'This Week';
  } else if (period === 'monthly') {
    dateCondition = 'YEAR(created_at) = YEAR(CURDATE()) AND MONTH(created_at) = MONTH(CURDATE())';
    periodLabel = 'This Month';
  } else if (period === 'yearly') {
    dateCondition = 'YEAR(created_at) = YEAR(CURDATE())';
    periodLabel = 'This Year (' + new Date().getFullYear() + ')';
  } else if (period === 'custom') {
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (dateRegex.test(customFrom) && dateRegex.test(customTo)) {
      dateCondition = 'DATE(created_at) BETWEEN ? AND ?';
      params = [customFrom, customTo];
      periodLabel = fmtDay(customFrom) + ' to ' + fmtDay(customTo);
    } else {
      dateCondition = 'DATE(created_at) = CURDATE()';
      periodLabel = "Today (" + fmtToday() + ") — Please select dates";
    }
  } else {
    periodLabel = 'All Time';
  }
  return { period, dateCondition, params, periodLabel, customFrom, customTo };
}

router.get('/reports', requireAdmin, requirePermission('reports.view'), async (req, res) => {
  try {
    const { period, dateCondition, params, periodLabel, customFrom, customTo } = getReportPeriod(req.query);
    // All summaries are calculated excluding cancelled orders
    const [[summary]] = await db.query(
      `SELECT
         COUNT(*) AS totalOrders,
         COALESCE(SUM(total_amount), 0) AS totalRevenue,
         COALESCE(AVG(total_amount), 0) AS avgOrderValue
       FROM orders
       WHERE ${dateCondition} AND status != 'Cancelled'`,
      params
    );

    const [[itemsSummary]] = await db.query(
      `SELECT COALESCE(SUM(order_items.quantity), 0) AS totalItemsSold
       FROM order_items
       JOIN orders ON orders.id = order_items.order_id
       WHERE ${dateCondition} AND orders.status != 'Cancelled'`,
      params
    );

    // The number of cancelled orders is also shown separately
    const [[cancelledSummary]] = await db.query(
      `SELECT COUNT(*) AS cancelledOrders FROM orders WHERE ${dateCondition} AND status = 'Cancelled'`,
      params
    );

    // Profit: revenue - cost (order_items.cost_price, order-er somoy-er kena dam)
    let totalCost = 0, totalProfit = 0;
    try {
      const [[profitRow]] = await db.query(
        `SELECT COALESCE(SUM(order_items.quantity * order_items.cost_price), 0) AS totalCost,
                COALESCE(SUM(order_items.quantity * (order_items.price - order_items.cost_price)), 0) AS totalProfit
         FROM order_items
         JOIN orders ON orders.id = order_items.order_id
         WHERE ${dateCondition} AND orders.status != 'Cancelled'`,
        params
      );
      totalCost = Number(profitRow.totalCost || 0);
      totalProfit = Number(profitRow.totalProfit || 0);
    } catch (e) { /* purono order-e cost_price na thakle 0 */ }

    // The best-selling products in this period (top 5)
    const [topProducts] = await db.query(
      `SELECT order_items.product_name,
              SUM(order_items.quantity) AS unitsSold,
              SUM(order_items.quantity * order_items.price) AS revenue
       FROM order_items
       JOIN orders ON orders.id = order_items.order_id
       WHERE ${dateCondition} AND orders.status != 'Cancelled'
       GROUP BY order_items.product_name
       ORDER BY unitsSold DESC
       LIMIT 5`,
      params
    );

    // The orders in this period (most recent 20, all statuses)
    const [orders] = await db.query(
      `SELECT id, customer_name, total_amount, status, created_at
       FROM orders
       WHERE ${dateCondition}
       ORDER BY created_at DESC
       LIMIT 20`,
      params
    );

    // Sales by top-level category (nijer + shob sub-category-r sale jog
    // kore), eki period-er filter. Shunno sale-owala category-o 0 niye
    // dekhano hoy, jate kon category bikri hocche na bojha jay.
    // dateCondition-e bare `created_at` ache — products-er-o created_at
    // thakay ekhane orders.created_at diye qualify kora holo.
    let categorySales = [];
    try {
      const [catRows] = await db.query('SELECT id, name, parent_id FROM categories');
      const { roots } = buildCategoryTree(catRows);
      const salesCond = dateCondition.replace(/created_at/g, 'orders.created_at');
      // GROUP_CONCAT-e onek order id thakle default 1024 char-e kete jete
      // pare — session-er jonno limit bariye rakha holo.
      await db.query('SET SESSION group_concat_max_len = 100000');
      const [salesRows] = await db.query(
        `SELECT products.category_id AS category_id,
                GROUP_CONCAT(DISTINCT orders.id) AS orderIds,
                COALESCE(SUM(order_items.quantity), 0) AS items,
                COALESCE(SUM(order_items.quantity * order_items.price), 0) AS revenue,
                COALESCE(SUM(order_items.quantity * order_items.cost_price), 0) AS cost,
                COALESCE(SUM(order_items.quantity * (order_items.price - order_items.cost_price)), 0) AS profit
         FROM order_items
         JOIN orders ON orders.id = order_items.order_id
         JOIN products ON products.id = order_items.product_id
         WHERE ${salesCond} AND orders.status != 'Cancelled'
         GROUP BY products.category_id`,
        params
      );
      const byCat = new Map();
      salesRows.forEach(r => byCat.set(+r.category_id, {
        orderIds: new Set(String(r.orderIds || '').split(',').filter(Boolean).map(Number)),
        items: +r.items || 0, revenue: +r.revenue || 0, cost: +r.cost || 0, profit: +r.profit || 0
      }));
      const sumNode = (n) => {
        const own = byCat.get(n.id) || { orderIds: new Set(), items: 0, revenue: 0, cost: 0, profit: 0 };
        const orderIds = new Set(own.orderIds);
        let items = own.items, revenue = own.revenue, cost = own.cost, profit = own.profit;
        n.children.forEach(c => {
          const s = sumNode(c);
          s.orderIds.forEach(id => orderIds.add(id));
          items += s.items; revenue += s.revenue; cost += s.cost; profit += s.profit;
        });
        return { id: n.id, name: n.name, orders: orderIds.size, items, revenue, cost, profit, orderIds };
      };
      // Uncategorized product-er sale kono category-te dhore na — note in PR.
      categorySales = roots.filter(r => !r.isOrphan).map(sumNode).sort((a, b) => b.revenue - a.revenue);
    } catch (e) { /* purono DB-te categories/order_items na thakle section-ta khali thakbe */ }

    res.render('admin/reports', {
      period, periodLabel, summary, itemsSummary, cancelledSummary,
      topProducts, orders, customFrom, customTo, totalCost, totalProfit, categorySales, siteName: 'Goince'
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('There was a problem loading the report: ' + err.message);
  }
});

// ---------- REPORTS CSV EXPORT (ekoi period-er orders + revenue + profit) ----------
router.get('/reports/export', requireAdmin, requirePermission('reports.view'), async (req, res) => {
  try {
    const { period, dateCondition, params, periodLabel } = getReportPeriod(req.query);
    const [[summary]] = await db.query(
      `SELECT COUNT(*) AS totalOrders, COALESCE(SUM(total_amount), 0) AS totalRevenue
       FROM orders WHERE ${dateCondition} AND status != 'Cancelled'`, params);
    let totalCost = 0, totalProfit = 0;
    try {
      const [[profitRow]] = await db.query(
        `SELECT COALESCE(SUM(order_items.quantity * order_items.cost_price), 0) AS totalCost,
                COALESCE(SUM(order_items.quantity * (order_items.price - order_items.cost_price)), 0) AS totalProfit
         FROM order_items JOIN orders ON orders.id = order_items.order_id
         WHERE ${dateCondition} AND orders.status != 'Cancelled'`, params);
      totalCost = Number(profitRow.totalCost || 0);
      totalProfit = Number(profitRow.totalProfit || 0);
    } catch (e) { /* purono order-e cost_price na thakle 0 */ }
    const [orders] = await db.query(
      `SELECT id, customer_name, phone, total_amount, status, payment_status, created_at
       FROM orders WHERE ${dateCondition} ORDER BY created_at DESC`, params);
    const esc = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const lines = [
      'Goince Report - ' + periodLabel,
      'Period,' + esc(period),
      'Total Orders,' + summary.totalOrders,
      'Total Revenue,' + Number(summary.totalRevenue).toFixed(2),
      'Total Cost,' + totalCost.toFixed(2),
      'Total Profit,' + totalProfit.toFixed(2),
      '',
      'Order ID,Date,Customer,Phone,Total,Status,Payment Status',
    ];
    for (const o of orders) {
      lines.push([o.id, new Date(o.created_at).toISOString().slice(0, 19).replace('T', ' '),
        esc(o.customer_name), esc(o.phone), Number(o.total_amount).toFixed(2), o.status, o.payment_status || 'Unpaid'].join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="goince-report-' + period + '.csv"');
    res.send('\uFEFF' + lines.join('\r\n'));
  } catch (err) {
    console.error(err);
    res.status(500).send('There was a problem exporting the report: ' + err.message);
  }
});

// ==================== ADMIN OPS (feat/admin-ops, batch 8) ====================

// ---------- I7: ADMIN AUDIT LOG ----------
// Paginated (20/page), filterable by admin email or action text.
// Shows who did what, when. Passwords/secrets are never stored
// (lib/admin-ops.js strips them at write time).
router.get('/audit-log', requireAdmin, requirePermission('audit.view'), async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const PER_PAGE = 20;
  const adminFilter = String(req.query.admin || '').trim().slice(0, 100);
  const actionFilter = String(req.query.action || '').trim().slice(0, 100);
  const where = [];
  const params = [];
  if (adminFilter) { where.push('admin_email LIKE ?'); params.push('%' + adminFilter + '%'); }
  if (actionFilter) { where.push('action LIKE ?'); params.push('%' + actionFilter + '%'); }
  const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : '';
  let rows = [], totalCount = 0;
  try {
    const [[c]] = await db.query('SELECT COUNT(*) AS cnt FROM admin_audit_log' + whereSql, params);
    totalCount = Number(c.cnt || 0);
    const totalPages = Math.max(1, Math.ceil(totalCount / PER_PAGE));
    const safePage = Math.min(page, totalPages);
    [rows] = await db.query(
      'SELECT * FROM admin_audit_log' + whereSql + ' ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?',
      [...params, PER_PAGE, (safePage - 1) * PER_PAGE]
    );
    return res.render('admin/audit-log', { rows, page: safePage, totalPages, totalCount, perPage: PER_PAGE, adminFilter, actionFilter, siteName: 'Goince' });
  } catch (e) {
    return res.render('admin/audit-log', { rows: [], page: 1, totalPages: 1, totalCount: 0, perPage: PER_PAGE, adminFilter, actionFilter, siteName: 'Goince' });
  }
});

// ---------- I10: IN-ADMIN ANALYTICS ----------
// REAL data only. Visitors = distinct site_visits sessions (counting
// starts when this batch deploys — the page says so, and a period
// before that honestly shows 0). Viewers = distinct
// product_view_history sessions; checkouts = abandoned_carts rows
// (recorded on checkout reach) + orders placed in the period;
// orders = non-cancelled orders. Top search terms come from the
// search_logs table (also starting now); top products by real revenue.
router.get('/analytics', requireAdmin, requirePermission('analytics.view'), async (req, res) => {
  const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
  const from = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);
  const to = new Date().toISOString().slice(0, 10);
  const q = async (sql, params) => {
    try { const [rows] = await db.query(sql, params || []); return rows; } catch (e) { return []; }
  };
  const one = async (sql, params) => { const rows = await q(sql, params); return rows[0] || {}; };
  const visitorsRow = await one('SELECT COUNT(DISTINCT session_key) AS c FROM site_visits WHERE visit_date BETWEEN ? AND ?', [from, to]);
  const viewersRow = await one('SELECT COUNT(DISTINCT session_key) AS c FROM product_view_history WHERE DATE(viewed_at) BETWEEN ? AND ?', [from, to]);
  const checkoutCartsRow = await one('SELECT COUNT(*) AS c FROM abandoned_carts WHERE DATE(created_at) BETWEEN ? AND ?', [from, to]);
  const ordersRow = await one("SELECT COUNT(*) AS c FROM orders WHERE DATE(created_at) BETWEEN ? AND ? AND status != 'Cancelled'", [from, to]);
  const funnel = ops.computeFunnel({
    visitors: Number(visitorsRow.c || 0),
    viewers: Number(viewersRow.c || 0),
    // Checkout reach = abandoned-cart records (checkout reached, order
    // or not) plus orders placed — orders are also in abandoned_carts
    // only when the buyer reached checkout, which they always did, so
    // the larger of the two avoids double-counting the same visit.
    checkouts: Math.max(Number(checkoutCartsRow.c || 0), Number(ordersRow.c || 0)),
    orders: Number(ordersRow.c || 0),
  });
  const topSearches = await ops.getTopSearchTerms(db, 10, days);
  const topProducts = await q(
    `SELECT oi.product_name, SUM(oi.quantity) AS units, SUM(oi.quantity * oi.price) AS revenue
     FROM order_items oi JOIN orders o ON o.id = oi.order_id
     WHERE DATE(o.created_at) BETWEEN ? AND ? AND o.status != 'Cancelled'
     GROUP BY oi.product_name ORDER BY revenue DESC LIMIT 5`, [from, to]);
  const daily = await q(
    `SELECT DATE(created_at) AS day, COUNT(*) AS orders, COALESCE(SUM(total_amount), 0) AS revenue
     FROM orders WHERE DATE(created_at) BETWEEN ? AND ? AND status != 'Cancelled'
     GROUP BY DATE(created_at) ORDER BY day ASC`, [from, to]);
  res.render('admin/analytics', {
    days, from, to, funnel, topSearches, topProducts, daily,
    // The first visit/search row is written by this deploy, so the
    // honest "counting from" date is today — never a made-up history.
    countingFrom: to,
    siteName: 'Goince',
  });
});

// ---------- I11: FLASH OFFERS ----------
// Admin creates a timed offer (one product, % off OR a sale price,
// start/end time). Expired offers stop showing automatically
// (lib/admin-ops.js isOfferActive + the shop query filter).
router.get('/flash-offers', requireAdmin, requirePermission('flash-offers.manage'), async (req, res) => {
  const [products] = await db.query('SELECT id, name, price FROM products ORDER BY created_at DESC');
  let offers = [];
  try {
    [offers] = await db.query(
      `SELECT fo.*, p.name AS product_name, p.price AS product_price
       FROM flash_offers fo JOIN products p ON p.id = fo.product_id
       ORDER BY fo.ends_at ASC, fo.id DESC`);
  } catch (e) { offers = []; }
  res.render('admin/flash-offers', { products, offers, siteName: 'Goince' });
});
router.post('/flash-offers/add', requireAdmin, requirePermission('flash-offers.manage'), async (req, res) => {
  try {
    const productId = parseInt(req.body.product_id, 10);
    const discount = parseFloat(req.body.discount_percent);
    const salePrice = parseFloat(req.body.sale_price);
    const title = (req.body.title || '').trim() || null;
    const startsAt = (req.body.starts_at || '').trim() || null;
    const endsAt = (req.body.ends_at || '').trim() || null;
    if (!Number.isFinite(productId)) return res.redirect('/admin/flash-offers');
    const [result] = await db.query(
      'INSERT INTO flash_offers (product_id, title, discount_percent, sale_price, starts_at, ends_at) VALUES (?, ?, ?, ?, ?, ?)',
      [productId, title, Number.isFinite(discount) && discount > 0 ? discount : null,
       Number.isFinite(salePrice) && salePrice >= 0 ? salePrice : null, startsAt, endsAt]);
    await audit(req, 'flash-offer.add', 'flash_offer', result.insertId, { productId, title, discount_percent: discount, sale_price: salePrice, ends_at: endsAt });
  } catch (e) { console.error(e); }
  res.redirect('/admin/flash-offers');
});
router.post('/flash-offers/toggle/:id', requireAdmin, requirePermission('flash-offers.manage'), async (req, res) => {
  await db.query('UPDATE flash_offers SET is_active = NOT is_active WHERE id = ?', [req.params.id]);
  await audit(req, 'flash-offer.toggle', 'flash_offer', req.params.id, {});
  res.redirect('/admin/flash-offers');
});
router.post('/flash-offers/delete/:id', requireAdmin, requirePermission('flash-offers.manage'), async (req, res) => {
  await db.query('DELETE FROM flash_offers WHERE id = ?', [req.params.id]);
  await audit(req, 'flash-offer.delete', 'flash_offer', req.params.id, {});
  res.redirect('/admin/flash-offers');
});

// ---------- I6: ORDERS / INVOICES CSV EXPORT ----------
// Exports the SAME filtered list the Orders page shows (tab +
// status filter), with correct CSV escaping (lib/admin-ops.js
// toCsv — quotes, commas, newlines and formula-injection guards).
function ordersCsvWhere(req) {
  const tab = ['all', 'paid', 'unpaid', 'cancelled'].includes(req.query.tab) ? req.query.tab : 'all';
  const where = [];
  const params = [];
  if (tab === 'paid') where.push("payment_status = 'Paid'");
  if (tab === 'unpaid') where.push("payment_status != 'Paid' AND status != 'Cancelled'");
  if (tab === 'cancelled') where.push("status = 'Cancelled'");
  const statusFilter = String(req.query.status || '');
  if (statusFilter && ORDER_STATUSES.includes(statusFilter)) { where.push('status = ?'); params.push(statusFilter); }
  return { whereSql: where.length ? ' WHERE ' + where.join(' AND ') : '', params };
}
router.get('/invoices/export', requireAdmin, requirePermission('orders.view'), async (req, res) => {
  try {
    const { whereSql, params } = ordersCsvWhere(req);
    const [orders] = await db.query('SELECT * FROM orders' + whereSql + ' ORDER BY created_at DESC', params);
    let advancesByOrder = {};
    try {
      const [advRows] = await db.query('SELECT order_id, COALESCE(SUM(amount), 0) AS total FROM order_payments GROUP BY order_id');
      advRows.forEach(r => { advancesByOrder[r.order_id] = Number(r.total || 0); });
    } catch (e) { /* advances stay 0 */ }
    const csv = ops.toCsv([
      { key: 'invoiceNo', label: 'Invoice No' }, { key: 'id', label: 'Order ID' },
      { key: 'date', label: 'Date' }, { key: 'customer_name', label: 'Customer' },
      { key: 'phone', label: 'Phone' }, { key: 'total_amount', label: 'Total' },
      { key: 'paid', label: 'Paid' }, { key: 'due', label: 'Due' },
      { key: 'payment_status', label: 'Payment Status' }, { key: 'status', label: 'Order Status' },
    ], orders.map(o => ({
      invoiceNo: invoiceNo(o.id), id: o.id,
      date: o.created_at ? new Date(o.created_at).toISOString().slice(0, 19).replace('T', ' ') : '',
      customer_name: o.customer_name, phone: o.phone,
      total_amount: Number(o.total_amount || 0).toFixed(2),
      paid: paidAmount(o, advancesByOrder[o.id] || 0).toFixed(2),
      due: dueAmount(o, advancesByOrder[o.id] || 0).toFixed(2),
      payment_status: o.payment_status || 'Unpaid', status: o.status,
    })));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="goince-invoices.csv"');
    res.send(csv);
  } catch (err) {
    console.error(err);
    res.status(500).send('There was a problem exporting invoices: ' + err.message);
  }
});

// ==================== PUSH NOTIFICATIONS (PWA) ====================
// Admin panel-ke phone-e "App"-er moto install kore, notun Order asle
// push notification pete ei 3ta route lage.

router.get('/vapid-public-key', requireAdmin, (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.json({ key: process.env.VAPID_PUBLIC_KEY || null, configured: isPushConfigured() });
});

router.post('/push-subscribe', requireAdmin, async (req, res) => {
  const sub = req.body;
  if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
    return res.status(400).json({ ok: false, error: 'Invalid subscription' });
  }
  try {
    await db.query(
      `INSERT INTO push_subscriptions (endpoint, p256dh, auth) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE p256dh = VALUES(p256dh), auth = VALUES(auth)`,
      [sub.endpoint, sub.keys.p256dh, sub.keys.auth]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Push subscribe error:', err);
    res.status(500).json({ ok: false });
  }
});

router.post('/push-unsubscribe', requireAdmin, async (req, res) => {
  const { endpoint } = req.body;
  if (endpoint) {
    await db.query('DELETE FROM push_subscriptions WHERE endpoint = ?', [endpoint]).catch(() => {});
  }
  res.json({ ok: true });
});
// ---------- PRODUCT VIDEO (Reels / Shorts) ----------
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

router.post('/products/:id/generate-video', requireAdmin, requirePermission('products.manage'), async (req, res) => {
  try {
    const productId = req.params.id;
    const [rows] = await db.query('SELECT * FROM products WHERE id = ?', [productId]);
    if (rows.length === 0) return res.status(404).json({ ok: false, error: 'Product not found' });

    const product = rows[0];
    const [gallery] = await db.query('SELECT image FROM product_images WHERE product_id = ?', [productId]);

    const uploadDir = path.join(__dirname, '..', 'public', 'uploads');
    const images = [];
    if (product.image && product.image !== 'no-image.png') {
      const mainPath = path.join(uploadDir, product.image);
      if (fs.existsSync(mainPath)) images.push(mainPath);
    }
    for (const g of gallery) {
      const gPath = path.join(uploadDir, g.image);
      if (fs.existsSync(gPath)) images.push(gPath);
    }

    if (images.length === 0) {
      return res.status(400).json({ ok: false, error: 'No images found for this product. Upload at least one image first.' });
    }

    const videoDir = path.join(__dirname, '..', 'public', 'videos');
    if (!fs.existsSync(videoDir)) fs.mkdirSync(videoDir, { recursive: true });
    const filename = 'product-' + productId + '-' + Date.now() + '.mp4';
    const outputPath = path.join(videoDir, filename);

    const scriptPath = path.join(__dirname, '..', 'scripts', 'generate_product_video.py');
    const args = [
      scriptPath,
      '--product-id', String(productId),
      '--images', images.join(','),
      '--name', product.name || 'Product',
      '--price', String(product.price || 0),
      '--output', outputPath
    ];
    if (product.short_description) {
      args.push('--short-desc', product.short_description.substring(0, 80));
    }

    const py = spawn('python3', args, { timeout: 120000 });

    let stderr = '';
    py.stderr.on('data', (data) => { stderr += data.toString(); });

    py.on('close', async (code) => {
      if (code === 0 && fs.existsSync(outputPath)) {
        const [oldVideos] = await db.query('SELECT id, filename FROM product_videos WHERE product_id = ?', [productId]);
        for (const ov of oldVideos) {
          const oldPath = path.join(videoDir, ov.filename);
          if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
          await db.query('DELETE FROM product_videos WHERE id = ?', [ov.id]);
        }
        await db.query('INSERT INTO product_videos (product_id, filename) VALUES (?, ?)', [productId, filename]);
        return res.json({ ok: true, filename, message: 'Video generated successfully!' });
      } else {
        console.error('Video generation failed:', stderr);
        return res.status(500).json({ ok: false, error: 'Video generation failed. Check server logs. ' + (stderr.slice(-300) || '') });
      }
    });

    py.on('error', (err) => {
      console.error('Spawn error:', err);
      res.status(500).json({ ok: false, error: 'Failed to start video generator. Is python3 + ffmpeg installed?' });
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/products/:id/video/download', requireAdmin, requirePermission('products.manage'), async (req, res) => {
  const [rows] = await db.query(
    'SELECT filename FROM product_videos WHERE product_id = ? ORDER BY created_at DESC LIMIT 1',
    [req.params.id]
  );
  if (rows.length === 0) return res.status(404).send('No video found');
  const filePath = path.join(__dirname, '..', 'public', 'videos', rows[0].filename);
  if (!fs.existsSync(filePath)) return res.status(404).send('Video file missing');
  res.download(filePath, rows[0].filename);
});

router.post('/products/:id/video/delete', requireAdmin, requirePermission('products.manage'), async (req, res) => {
  const productId = req.params.id;
  const [rows] = await db.query('SELECT id, filename FROM product_videos WHERE product_id = ?', [productId]);
  const videoDir = path.join(__dirname, '..', 'public', 'videos');
  for (const row of rows) {
    const fp = path.join(videoDir, row.filename);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
    await db.query('DELETE FROM product_videos WHERE id = ?', [row.id]);
  }
  res.redirect('/admin/products');
});
module.exports = router;
