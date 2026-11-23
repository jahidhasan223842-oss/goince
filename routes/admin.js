// All admin panel routes: Login, Dashboard, Product/Order/Coupon/Customer Manage
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { getCourierConfig, createConsignment, getTrackingStatus } = require('../lib/courier');
const db = require('../config/db');
const upload = require('../config/upload');
const { isConfigured: isPushConfigured } = require('../config/push');
const { ROLES, requireRole } = require('../lib/roles');

function requireAdmin(req, res, next) {
  if (req.session.isAdmin) return next();
  res.redirect('/admin/login');
}

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
  return {
    name: (body.name || '').trim(),
    parent_id: body.parent_id ? parseInt(body.parent_id, 10) || null : null,
    description: (body.description || '').trim() || null,
    sort_order: parseInt(body.sort_order, 10) || 0,
    is_visible: parseCategoryFlag(body.is_visible, 1),
    is_featured: parseCategoryFlag(body.is_featured, 0),
    slug: slugify(body.slug || body.name || '').slice(0, 150)
  };
}
async function uniqueCategorySlug(base, excludeId) {
  let slug = slugify(base) || 'category';
  slug = slug.slice(0, 150);
  let candidate = slug, n = 2;
  while (true) {
    const [rows] = await db.query('SELECT id FROM categories WHERE slug = ? AND id != ?', [candidate, excludeId || 0]);
    if (!rows.length) return candidate;
    candidate = (slug + '-' + (n++)).slice(0, 150);
  }
}
// Category photo: notun file upload hole seta, na hole URL field, na hole ager chobi
function categoryImage(req, oldImage) {
  if (req.file) return '/uploads/' + req.file.filename;
  const url = (req.body.image_url || '').trim();
  if (url) return url;
  return oldImage || null;
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
    req.session.isAdmin = true;
    req.session.adminId = adminRow ? adminRow.id : null;
    req.session.adminEmail = adminRow ? adminRow.email : email;
    req.session.adminRole = adminRow ? (adminRow.role || 'owner') : 'owner';

    // "Remember Me" checked -> stay logged in for 30 days; otherwise the
    // session ends when the browser is closed (a normal session cookie)
    if (req.body.remember_me) {
      req.session.cookie.maxAge = 1000 * 60 * 60 * 24 * 30; // 30 days
    } else {
      req.session.cookie.expires = false; // session cookie — expires when the browser closes
    }

    // Staff sudhu Orders + Products dekhte pare, tai tader landing page Orders
    return res.redirect(req.session.adminRole === 'staff' ? '/admin/orders' : '/admin/dashboard');
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
  req.session.adminRole = null;
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
router.get('/dashboard', requireAdmin, requireRole('dashboard'), async (req, res) => {
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
    const [[{ totalOrders }]] = await db.query('SELECT COUNT(*) AS totalOrders FROM orders');
    const [[{ totalRevenue }]] = await db.query("SELECT COALESCE(SUM(total_amount),0) AS totalRevenue FROM orders WHERE status != 'Cancelled'");
    const [[{ totalCustomers }]] = await db.query('SELECT COUNT(*) AS totalCustomers FROM users');
    const [pendingOrders] = await db.query("SELECT * FROM orders WHERE status = 'Pending' ORDER BY created_at DESC LIMIT 5");
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
    const [statusRows] = await db.query(
      `SELECT status, COUNT(*) AS count FROM orders
       WHERE DATE(created_at) BETWEEN ? AND ? GROUP BY status ORDER BY count DESC`, [from, to]);

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

    res.render('admin/dashboard', {
      totalProducts, totalOrders, totalRevenue, totalCustomers, pendingOrders,
      lowStockProducts, lowStockCount, outOfStockCount,
      dashboard: {
        range, from, to, prevFrom, prevTo, currentSummary, previousSummary,
        newCustomers: Number(newCustomers || 0), salesTrend, topProducts, statusRows,
        revenueChange, maxTrendRevenue: Math.max(1, ...salesTrend.map(row => Number(row.revenue || 0)))
      },
      siteName: 'Goince'
    });
  } catch (err) {
    console.error('Dashboard analytics error:', err);
    res.status(500).send('There was a problem loading the dashboard. Please check the server logs.');
  }
});

// ==================== INVENTORY / STOCK TRACKING ====================

router.get('/inventory', requireAdmin, requireRole('products'), async (req, res) => {
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
router.post('/inventory/update/:id', requireAdmin, requireRole('products'), async (req, res) => {
  const stock = Math.max(0, parseInt(req.body.stock) || 0);
  await db.query('UPDATE products SET stock = ? WHERE id = ?', [stock, req.params.id]);
  res.redirect('/admin/inventory' + (req.body.filter ? '?filter=' + req.body.filter : ''));
});

// ---------- PRODUCT LIST ----------
router.get('/products', requireAdmin, requireRole('productsView'), async (req, res) => {
  const { q, category } = req.query;
  const where = [];
  const params = [];
  if (q) {
    where.push('(p.name LIKE ? OR p.sku LIKE ? OR p.brand LIKE ?)');
    params.push('%' + q + '%', '%' + q + '%', '%' + q + '%');
  }
  // Categories page theke product count-e click korle ekhane ashe (?category=id)
  if (category) {
    where.push('p.category_id = ?');
    params.push(parseInt(category, 10) || 0);
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
  const [categories] = await db.query('SELECT id, name, parent_id FROM categories ORDER BY (parent_id IS NULL) DESC, parent_id, sort_order ASC, name');
  res.render('admin/products', { products, categories, category: category || '', siteName: 'Goince', q: q || '' });
});

// ---------- ADD PRODUCT ----------
router.get('/products/add', requireAdmin, requireRole('products'), async (req, res) => {
  const [categories] = await db.query('SELECT * FROM categories ORDER BY (parent_id IS NULL) DESC, parent_id, name');
  const [allProducts] = await db.query('SELECT id, name FROM products ORDER BY created_at DESC');
  res.render('admin/add-product', { categories, product: null, galleryImages: [], options: [], relatedIds: [], allProducts, videos: [], siteName: 'Goince' });
});

router.post('/products/add', requireAdmin, requireRole('products'), upload.fields([{ name: 'image', maxCount: 1 }, { name: 'gallery', maxCount: 10 }, { name: 'video', maxCount: 1 }]), async (req, res) => {
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
router.get('/products/edit/:id', requireAdmin, requireRole('products'), async (req, res) => {
  const [rows] = await db.query('SELECT * FROM products WHERE id = ?', [req.params.id]);
  if (rows.length === 0) return res.redirect('/admin/products');
  const [categories] = await db.query('SELECT * FROM categories ORDER BY (parent_id IS NULL) DESC, parent_id, name');
  const [galleryImages] = await db.query('SELECT * FROM product_images WHERE product_id = ?', [req.params.id]);
  const [options] = await db.query('SELECT * FROM product_options WHERE product_id = ? ORDER BY sort_order, id', [req.params.id]);
  const [relatedRows] = await db.query('SELECT related_id FROM related_products WHERE product_id = ?', [req.params.id]);
  const [allProducts] = await db.query('SELECT id, name FROM products WHERE id != ? ORDER BY created_at DESC', [req.params.id]);
  const [videos] = await db.query('SELECT * FROM product_videos WHERE product_id = ?', [req.params.id]);
  res.render('admin/add-product', { categories, product: rows[0], galleryImages, options, relatedIds: relatedRows.map(r => r.related_id), allProducts, videos, siteName: 'Goince' });
});

router.post('/products/edit/:id', requireAdmin, requireRole('products'), upload.fields([{ name: 'image', maxCount: 1 }, { name: 'gallery', maxCount: 10 }, { name: 'video', maxCount: 1 }]), async (req, res) => {
  try {
    const { name, description, short_description, specifications, price, compare_at_price, stock, category_id, source_link, target_audience, size_management, size_values, custom_sizes } = req.body;
    const adv = parseProductAdvanced(req.body);
    adv.slug = await uniqueSlug(adv.slug || name, req.params.id);
    const allowedAudiences = ['men', 'women', 'kids', 'unisex'];
    const audience = allowedAudiences.includes(target_audience) ? target_audience : 'all';
    const id = req.params.id;
    const mainImage = (req.files && req.files.image) ? req.files.image[0].filename : null;
    // Stock history-r jonno purono stock age-i niye rakha (UPDATE-er pore ar pawa jabe na)
    const [[oldP]] = await db.query('SELECT stock FROM products WHERE id = ?', [id]);

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
    // Stock bodlale history-te likha + stock asle Notify Me list-ke janano
    const newStock = parseInt(stock, 10) || 0;
    if (oldP && newStock !== oldP.stock) {
      await logStockChange(id, null, newStock - oldP.stock, newStock, 'manual');
      if (oldP.stock <= 0 && newStock > 0) {
        await db.query('UPDATE stock_alerts SET notified = 1 WHERE product_id = ? AND notified = 0', [id]);
      }
    }

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
router.get('/attributes', requireAdmin, requireRole('products'), async (req, res) => {
  const [attrs] = await db.query('SELECT * FROM attributes ORDER BY name');
  for (const a of attrs) {
    const [vals] = await db.query('SELECT * FROM attribute_values WHERE attribute_id = ? ORDER BY value', [a.id]);
    a.values = vals;
  }
  res.render('admin/attributes', { attributes: attrs, siteName: 'Goince' });
});
router.post('/attributes/add', requireAdmin, requireRole('products'), async (req, res) => {
  const name = (req.body.name || '').trim();
  if (name) { try { await db.query('INSERT INTO attributes (name) VALUES (?)', [name]); } catch (e) {} }
  res.redirect('/admin/attributes');
});
router.post('/attributes/delete/:id', requireAdmin, requireRole('products'), async (req, res) => {
  await db.query('DELETE FROM attributes WHERE id = ?', [req.params.id]);
  res.redirect('/admin/attributes');
});
router.post('/attributes/:id/values/add', requireAdmin, requireRole('products'), async (req, res) => {
  const value = (req.body.value || '').trim();
  if (value) { try { await db.query('INSERT INTO attribute_values (attribute_id, value) VALUES (?, ?)', [req.params.id, value]); } catch (e) {} }
  res.redirect('/admin/attributes');
});
router.post('/attribute-values/delete/:id', requireAdmin, requireRole('products'), async (req, res) => {
  await db.query('DELETE FROM attribute_values WHERE id = ?', [req.params.id]);
  res.redirect('/admin/attributes');
});

// ---------- PRODUCT VARIANTS MANAGER ----------
router.get('/products/:id/variants', requireAdmin, requireRole('products'), async (req, res) => {
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
router.post('/products/:id/variants/sync', requireAdmin, requireRole('products'), async (req, res) => {
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
router.post('/products/:id/variants/:vid/update', requireAdmin, requireRole('products'), upload.single('image'), async (req, res) => {
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
router.post('/products/:id/variants/delete/:vid', requireAdmin, requireRole('products'), async (req, res) => {
  await db.query('DELETE FROM product_variants WHERE id = ? AND product_id = ?', [req.params.vid, req.params.id]);
  res.redirect('/admin/products/' + req.params.id + '/variants');
});

// ---------- STOCK HISTORY + STOCK ALERTS ----------
router.get('/products/:id/stock-history', requireAdmin, requireRole('products'), async (req, res) => {
  const [[product]] = await db.query('SELECT id, name FROM products WHERE id = ?', [req.params.id]);
  if (!product) return res.redirect('/admin/products');
  const [rows] = await db.query('SELECT * FROM stock_history WHERE product_id = ? ORDER BY created_at DESC LIMIT 100', [req.params.id]);
  res.render('admin/stock-history', { product, rows, siteName: 'Goince' });
});
router.get('/stock-alerts', requireAdmin, requireRole('products'), async (req, res) => {
  const [alerts] = await db.query(
    `SELECT sa.*, p.name AS product_name, p.stock FROM stock_alerts sa
     JOIN products p ON p.id = sa.product_id ORDER BY sa.created_at DESC LIMIT 200`
  );
  res.render('admin/stock-alerts', { alerts, siteName: 'Goince' });
});
router.post('/stock-alerts/:id/done', requireAdmin, requireRole('products'), async (req, res) => {
  await db.query('UPDATE stock_alerts SET notified = 1 WHERE id = ?', [req.params.id]);
  res.redirect('/admin/stock-alerts');
});

// ---------- DUPLICATE PRODUCT ----------
router.post('/products/:id/duplicate', requireAdmin, requireRole('products'), async (req, res) => {
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
router.get('/products/import', requireAdmin, requireRole('products'), (req, res) => {
  res.render('admin/import-products', { result: null, siteName: 'Goince' });
});
router.post('/products/import', requireAdmin, requireRole('products'), upload.single('csv'), async (req, res) => {
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
router.get('/products/export', requireAdmin, requireRole('products'), async (req, res) => {
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
router.post('/products/:id/gallery/delete/:imageId', requireAdmin, requireRole('products'), async (req, res) => {
  await db.query('DELETE FROM product_images WHERE id = ? AND product_id = ?', [req.params.imageId, req.params.id]);
  res.redirect('/admin/products/edit/' + req.params.id);
});

// ==================== PRODUCT OPTIONS (Color / Size / Weight — you can set the label yourself) ====================
router.post('/products/:id/options/add', requireAdmin, requireRole('products'), upload.single('option_image'), async (req, res) => {
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

router.post('/products/:id/options/delete/:optionId', requireAdmin, requireRole('products'), async (req, res) => {
  await db.query('DELETE FROM product_options WHERE id = ? AND product_id = ?', [req.params.optionId, req.params.id]);
  res.redirect('/admin/products/edit/' + req.params.id);
});

// ---------- DELETE PRODUCT ----------
router.post('/products/delete/:id', requireAdmin, requireRole('products'), async (req, res) => {
  await db.query('DELETE FROM products WHERE id = ?', [req.params.id]);
  res.redirect('/admin/products');
});

// ---------- CATEGORY QUICK ADD (used from the Add Product form) ----------
// Shudhu name + parent pathay (urlencoded) — full form na, tai is_visible/
// is_featured na thakleo category visible thakbe (parseCategoryForm default).
// Quick-add hole 'back'-e ferot jay, Categories page theke add hole list-e.
router.post('/categories/add', requireAdmin, requireRole('products'), upload.single('image'), async (req, res) => {
  try {
    const f = parseCategoryForm(req.body);
    if (!f.name) return res.redirect('back');
    if (f.parent_id) {
      const [[parent]] = await db.query('SELECT id FROM categories WHERE id = ? AND parent_id IS NULL', [f.parent_id]);
      if (!parent) f.parent_id = null; // sub-category er sub-category rakhi na
    }
    const slug = await uniqueCategorySlug(f.slug || f.name);
    const image = categoryImage(req, null);
    const [result] = await db.query('INSERT INTO categories (name, parent_id, image_url, description, sort_order, is_visible, is_featured, slug) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [f.name, f.parent_id, image, f.description, f.sort_order, f.is_visible, f.is_featured, slug]);
    if (req.body.from === 'quick-add') return res.redirect('back');
    res.redirect('/admin/categories#cat-' + result.insertId);
  } catch (err) {
    console.error('Category add error:', err);
    res.status(500).send('There was a problem adding the category. Please check whether the "parent_id" column exists in the database (run sql/update.sql).');
  }
});

// ==================== FULL CATEGORY MANAGEMENT ====================

router.get('/categories', requireAdmin, requireRole('products'), async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const where = [];
    const params = [];
    if (q) { where.push('categories.name LIKE ?'); params.push('%' + q + '%'); }
    const [categories] = await db.query(
      `SELECT categories.*, COUNT(products.id) AS product_count, parent.name AS parent_name
       FROM categories
       LEFT JOIN products ON products.category_id = categories.id
       LEFT JOIN categories AS parent ON parent.id = categories.parent_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       GROUP BY categories.id ORDER BY (categories.parent_id IS NULL) DESC, categories.parent_id, categories.sort_order ASC, categories.id ASC`,
      params
    );
    // ?parent=<id> (from the "+ Sub-category" link on a main category row):
    // pre-select that main category in the Add form. Only a real main
    // category counts — a sub-category id or a bogus id is ignored.
    let selectedParent = null;
    const parentParam = parseInt(req.query.parent, 10);
    if (!isNaN(parentParam)) {
      const [[p]] = await db.query('SELECT id FROM categories WHERE id = ? AND parent_id IS NULL', [parentParam]);
      if (p) selectedParent = p.id;
    }
    // Add form-er parent dropdown-e shob main category (search filter-e bad geleo)
    const [mainCategories] = await db.query('SELECT * FROM categories WHERE parent_id IS NULL ORDER BY sort_order ASC, id ASC');
    res.render('admin/categories', { categories, mainCategories, q, selectedParent, siteName: 'Goince' });
  } catch (err) {
    console.error('Category list error:', err);
    res.status(500).send('There was a problem loading the category list. Please check whether the "parent_id" column exists in the database (run sql/update.sql -f).');
  }
});

// ---------- CATEGORY EDIT PAGE (alada clean page — table-er vitore choto form na) ----------
router.get('/categories/edit/:id', requireAdmin, requireRole('products'), async (req, res) => {
  try {
    const [[category]] = await db.query('SELECT * FROM categories WHERE id = ?', [req.params.id]);
    if (!category) return res.redirect('/admin/categories');
    const [mainCategories] = await db.query('SELECT * FROM categories WHERE parent_id IS NULL AND id != ? ORDER BY sort_order ASC, id ASC', [req.params.id]);
    res.render('admin/category-edit', { category, mainCategories, siteName: 'Goince' });
  } catch (err) {
    console.error('Category edit page error:', err);
    res.status(500).send('There was a problem loading the category.');
  }
});

router.post('/categories/edit/:id', requireAdmin, requireRole('products'), upload.single('image'), async (req, res) => {
  try {
    const [[old]] = await db.query('SELECT * FROM categories WHERE id = ?', [req.params.id]);
    if (!old) return res.redirect('/admin/categories');
    const f = parseCategoryForm(req.body);
    if (!f.name) return res.redirect('/admin/categories/edit/' + req.params.id);
    if (f.parent_id === parseInt(req.params.id, 10)) f.parent_id = null; // nijer parent nije hote parbe na
    if (f.parent_id) {
      const [[parent]] = await db.query('SELECT id FROM categories WHERE id = ? AND parent_id IS NULL', [f.parent_id]);
      if (!parent) f.parent_id = null;
    }
    const slug = await uniqueCategorySlug(f.slug || f.name, req.params.id);
    const image = categoryImage(req, old.image_url);
    await db.query('UPDATE categories SET name = ?, parent_id = ?, image_url = ?, description = ?, sort_order = ?, is_visible = ?, is_featured = ?, slug = ? WHERE id = ?',
      [f.name, f.parent_id, image, f.description, f.sort_order, f.is_visible, f.is_featured, slug, req.params.id]);
    res.redirect('/admin/categories#cat-' + req.params.id);
  } catch (err) {
    console.error('Category edit error:', err);
    res.status(500).send('There was a problem updating the category.');
  }
});

// ---------- CATEGORY REORDER (▲▼ — eki parent-er moddhe neighbour-er sathe sort_order bodol) ----------
router.post('/categories/:id/move', requireAdmin, requireRole('products'), async (req, res) => {
  try {
    const direction = req.body.direction === 'down' ? 'down' : 'up';
    const [[cat]] = await db.query('SELECT * FROM categories WHERE id = ?', [req.params.id]);
    if (!cat) return res.redirect('/admin/categories');
    const [siblings] = await db.query(
      'SELECT * FROM categories WHERE ' + (cat.parent_id ? 'parent_id = ?' : 'parent_id IS NULL') + ' ORDER BY sort_order ASC, id ASC',
      cat.parent_id ? [cat.parent_id] : []
    );
    const idx = siblings.findIndex(s => s.id == cat.id);
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (idx >= 0 && siblings[swapIdx]) {
      const other = siblings[swapIdx];
      if (cat.sort_order === other.sort_order) {
        // sort_order ek hole shudhu swap korle kichu bodlabe na — ektu shoriye dao
        await db.query('UPDATE categories SET sort_order = ? WHERE id = ?', [direction === 'up' ? other.sort_order - 1 : other.sort_order + 1, cat.id]);
      } else {
        await db.query('UPDATE categories SET sort_order = ? WHERE id = ?', [other.sort_order, cat.id]);
        await db.query('UPDATE categories SET sort_order = ? WHERE id = ?', [cat.sort_order, other.id]);
      }
    }
    // Anchor-e ferot jai, jate page-er upore na giye oi row-tei thake
    res.redirect('/admin/categories#cat-' + req.params.id);
  } catch (err) {
    console.error('Category move error:', err);
    res.redirect('/admin/categories#cat-' + req.params.id);
  }
});

// ---------- CATEGORY SHOW / HIDE (delete na kore website theke lukano) ----------
router.post('/categories/:id/toggle-visibility', requireAdmin, requireRole('products'), async (req, res) => {
  try {
    await db.query('UPDATE categories SET is_visible = 1 - is_visible WHERE id = ?', [req.params.id]);
    res.redirect('/admin/categories#cat-' + req.params.id);
  } catch (err) {
    console.error('Category visibility error:', err);
    res.redirect('/admin/categories#cat-' + req.params.id);
  }
});

router.post('/categories/delete/:id', requireAdmin, requireRole('products'), async (req, res) => {
  try {
    // Deleting a category makes the products under it "Uncategorized"
    // (products are not deleted, only category_id becomes NULL — the DB schema has ON DELETE SET NULL)
    await db.query('DELETE FROM categories WHERE id = ?', [req.params.id]);
    res.redirect('/admin/categories');
  } catch (err) {
    console.error('Category delete error:', err);
    res.status(500).send('There was a problem deleting the category.');
  }
});

// ---------- ORDERS LIST ----------
router.get('/orders', requireAdmin, requireRole('ordersView'), async (req, res) => {
  const { q, status, date_from, date_to } = req.query;
  const where = [];
  const params = [];
  if (q) {
    const idNum = parseInt(q.replace(/\D/g, ''), 10);
    if (!isNaN(idNum) && String(idNum) === q.trim().replace(/^#/, '')) {
      where.push('(id = ? OR customer_name LIKE ? OR phone LIKE ?)');
      params.push(idNum, '%' + q + '%', '%' + q + '%');
    } else {
      where.push('(customer_name LIKE ? OR phone LIKE ?)');
      params.push('%' + q + '%', '%' + q + '%');
    }
  }
  if (status) { where.push('status = ?'); params.push(status); }
  if (date_from) { where.push('DATE(created_at) >= ?'); params.push(date_from); }
  if (date_to) { where.push('DATE(created_at) <= ?'); params.push(date_to); }
  const sql = 'SELECT * FROM orders' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY created_at DESC';
  const [orders] = await db.query(sql, params);
  res.render('admin/orders', { orders, siteName: 'Goince', q: q || '', status: status || '', date_from: date_from || '', date_to: date_to || '' });
});

// ---------- ORDER DETAILS ----------
router.get('/orders/:id', requireAdmin, requireRole('ordersView'), async (req, res) => {
  const [[order]] = await db.query('SELECT * FROM orders WHERE id = ?', [req.params.id]);
  if (!order) return res.redirect('/admin/orders');
  const [items] = await db.query('SELECT * FROM order_items WHERE order_id = ?', [req.params.id]);
  const [[phoneRow]] = await db.query("SELECT setting_value FROM settings WHERE setting_key = 'shop_phone'");
  const courier = await getCourierConfig(db);
  const courierMsg = req.query.courier === 'created' ? 'Consignment created with ' + (order.courier_name || 'the courier') + ' — tracking ' + (order.tracking_number || '') + '.' :
    req.query.courier === 'failed' ? 'Courier API call failed — check the API keys in Settings > Courier API and try again.' :
    req.query.courier === 'not-configured' ? 'Courier API is not configured yet — add the API keys in Settings > Courier API first.' :
    req.query.courier === 'already' ? 'This order already has a consignment / tracking number.' :
    req.query.courier === 'status-updated' ? 'Tracking status updated from the courier.' :
    req.query.courier === 'status-failed' ? 'Could not fetch the tracking status — check the API keys and try again.' :
    req.query.courier === 'no-consignment' ? 'This order has no consignment yet — create one first.' : null;
  res.render('admin/order-details', { order, items, siteName: 'Goince', shopPhone: phoneRow ? phoneRow.setting_value : '', courier, courierMsg });
});

// ---------- UPDATE ORDER STATUS ----------
router.post('/orders/:id/status', requireAdmin, requireRole('orders'), async (req, res) => {
  const { status } = req.body;
  await db.query('UPDATE orders SET status = ? WHERE id = ?', [status, req.params.id]);
  res.redirect('/admin/orders/' + req.params.id);
});

// ---------- UPDATE PAYMENT STATUS ----------
router.post('/orders/:id/payment-status', requireAdmin, requireRole('orders'), async (req, res) => {
  const { payment_status } = req.body;
  await db.query('UPDATE orders SET payment_status = ? WHERE id = ?', [payment_status, req.params.id]);
  res.redirect('/admin/orders/' + req.params.id);
});

// ---------- UPDATE COURIER / TRACKING INFO ----------
router.post('/orders/:id/shipping', requireAdmin, requireRole('orders'), async (req, res) => {
  const { courier_name, tracking_number } = req.body;
  await db.query(
    'UPDATE orders SET courier_name = ?, tracking_number = ? WHERE id = ?',
    [courier_name || null, tracking_number || null, req.params.id]
  );
  res.redirect('/admin/orders/' + req.params.id);
});

// ---------- CREATE COURIER CONSIGNMENT (Steadfast / Pathao API) ----------
router.post('/orders/:id/create-consignment', requireAdmin, requireRole('orders'), async (req, res) => {
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
router.post('/orders/:id/refresh-tracking', requireAdmin, requireRole('orders'), async (req, res) => {
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
router.get('/coupons', requireAdmin, requireRole('coupons'), async (req, res) => {
  const [coupons] = await db.query('SELECT * FROM coupons ORDER BY created_at DESC');
  res.render('admin/coupons', { coupons, siteName: 'Goince' });
});

// ---------- ADD COUPON ----------
router.post('/coupons/add', requireAdmin, requireRole('coupons'), async (req, res) => {
  try {
    const { code, discount_percent, expiry_date } = req.body;
    await db.query(
      'INSERT INTO coupons (code, discount_percent, expiry_date) VALUES (?, ?, ?)',
      [code.toUpperCase().trim(), discount_percent, expiry_date || null]
    );
    res.redirect('/admin/coupons');
  } catch (err) {
    console.error(err);
    res.redirect('/admin/coupons');
  }
});

// ---------- TOGGLE COUPON ACTIVE/INACTIVE ----------
router.post('/coupons/toggle/:id', requireAdmin, requireRole('coupons'), async (req, res) => {
  await db.query('UPDATE coupons SET active = NOT active WHERE id = ?', [req.params.id]);
  res.redirect('/admin/coupons');
});

// ---------- DELETE COUPON ----------
router.post('/coupons/delete/:id', requireAdmin, requireRole('coupons'), async (req, res) => {
  await db.query('DELETE FROM coupons WHERE id = ?', [req.params.id]);
  res.redirect('/admin/coupons');
});

// ==================== CUSTOMER MANAGEMENT ====================

// ---------- CUSTOMER LIST (can be searched by name/email/phone) ----------
router.get('/customers', requireAdmin, requireRole('customers'), async (req, res) => {
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
  res.render('admin/customers', { customers, q, siteName: 'Goince' });
});

// ---------- ADD CUSTOMER PAGE ----------
router.get('/customers/add', requireAdmin, requireRole('customers'), (req, res) => {
  res.render('admin/add-customer', { customer: null, error: null, siteName: 'Goince' });
});

router.post('/customers/add', requireAdmin, requireRole('customers'), async (req, res) => {
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
router.get('/customers/edit/:id', requireAdmin, requireRole('customers'), async (req, res) => {
  const [rows] = await db.query('SELECT * FROM users WHERE id = ?', [req.params.id]);
  if (rows.length === 0) return res.redirect('/admin/customers');
  res.render('admin/add-customer', { customer: rows[0], error: null, siteName: 'Goince' });
});

router.post('/customers/edit/:id', requireAdmin, requireRole('customers'), async (req, res) => {
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
router.post('/customers/delete/:id', requireAdmin, requireRole('customers'), async (req, res) => {
  await db.query('DELETE FROM users WHERE id = ?', [req.params.id]);
  res.redirect('/admin/customers');
});

// ---------- BLOCK / UNBLOCK CUSTOMER ----------
router.post('/customers/:id/toggle-block', requireAdmin, requireRole('customers'), async (req, res) => {
  const [[customer]] = await db.query('SELECT is_blocked FROM users WHERE id = ?', [req.params.id]);
  if (!customer) return res.redirect('/admin/customers');
  await db.query('UPDATE users SET is_blocked = ? WHERE id = ?', [customer.is_blocked ? 0 : 1, req.params.id]);
  res.redirect(req.headers.referer || '/admin/customers/' + req.params.id);
});

// ---------- CUSTOMER DETAIL (profile + full order history) ----------
// This is kept at the bottom because Express matches routes in order —
// if it came first, "/customers/add" and "/customers/edit/5" would be mistaken for :id.
router.get('/customers/:id', requireAdmin, requireRole('customers'), async (req, res) => {
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

  res.render('admin/customer-detail', {
    customer, orders,
    wishlistCount: wishlistRow.wishlistCount,
    totalOrders, totalSpent, avgOrderValue, lastOrderDate,
    siteName: 'Goince'
  });
});

// ==================== LIVE CHAT ====================

// ---------- CONVERSATION LIST ----------
router.get('/chats', requireAdmin, requireRole('chats'), async (req, res) => {
  const [conversations] = await db.query(
    `SELECT chat_conversations.*,
       (SELECT message FROM chat_messages WHERE conversation_id = chat_conversations.id ORDER BY created_at DESC LIMIT 1) AS last_message
     FROM chat_conversations
     ORDER BY last_message_at DESC`
  );
  res.render('admin/chats', { conversations, siteName: 'Goince' });
});

// ---------- SINGLE CONVERSATION VIEW ----------
router.get('/chats/:id', requireAdmin, requireRole('chats'), async (req, res) => {
  const [[conversation]] = await db.query('SELECT * FROM chat_conversations WHERE id = ?', [req.params.id]);
  if (!conversation) return res.redirect('/admin/chats');
  const [messages] = await db.query(
    'SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY created_at ASC',
    [req.params.id]
  );
  res.render('admin/chat-detail', { conversation, messages, siteName: 'Goince' });
});

// ---------- GET MESSAGES (JSON, admin side polling) ----------
router.get('/chats/:id/messages', requireAdmin, requireRole('chats'), async (req, res) => {
  const [messages] = await db.query(
    'SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY created_at ASC',
    [req.params.id]
  );
  res.json({ messages });
});

// ---------- ADMIN REPLY ----------
router.post('/chats/:id/reply', requireAdmin, requireRole('chats'), async (req, res) => {
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
router.get('/payment-methods', requireAdmin, requireRole('paymentMethods'), async (req, res) => {
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

router.post('/payment-methods/add', requireAdmin, requireRole('paymentMethods'), async (req, res) => {
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

router.post('/payment-methods/edit/:id', requireAdmin, requireRole('paymentMethods'), async (req, res) => {
  const methodName = (req.body.method_name || '').trim();
  const number = (req.body.number || '').trim() || null;
  await db.query('UPDATE payment_methods SET method_name = ?, number = ?, payment_type = ?, instructions = ? WHERE id = ?', [methodName, number, (req.body.payment_type || 'send_money'), (req.body.instructions || '').trim() || null, req.params.id]);
  res.redirect('/admin/payment-methods');
});

router.post('/payment-methods/toggle/:id', requireAdmin, requireRole('paymentMethods'), async (req, res) => {
  await db.query('UPDATE payment_methods SET is_active = NOT is_active WHERE id = ?', [req.params.id]);
  res.redirect('/admin/payment-methods');
});

router.post('/payment-methods/delete/:id', requireAdmin, requireRole('paymentMethods'), async (req, res) => {
  await db.query('DELETE FROM payment_methods WHERE id = ?', [req.params.id]);
  res.redirect('/admin/payment-methods');
});

// ==================== DELIVERY ZONES ====================
router.get('/delivery-zones', requireAdmin, requireRole('deliveryZones'), async (req, res) => {
  const [zones] = await db.query('SELECT * FROM delivery_zones ORDER BY sort_order, id');
  res.render('admin/delivery-zones', { zones, siteName: 'Goince' });
});
router.post('/delivery-zones/add', requireAdmin, requireRole('deliveryZones'), async (req, res) => {
  const name = (req.body.name || '').trim();
  const charge = parseFloat(req.body.charge);
  const deliveryTime = (req.body.delivery_time || '').trim() || null;
  if (name && !isNaN(charge)) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') + '_' + Date.now();
    const [[maxOrder]] = await db.query('SELECT COALESCE(MAX(sort_order), 0) AS m FROM delivery_zones');
    await db.query('INSERT INTO delivery_zones (name, slug, charge, delivery_time, sort_order) VALUES (?, ?, ?, ?, ?)',
      [name, slug, charge, deliveryTime, maxOrder.m + 1]);
  }
  res.redirect('/admin/delivery-zones');
});
router.post('/delivery-zones/edit/:id', requireAdmin, requireRole('deliveryZones'), async (req, res) => {
  const name = (req.body.name || '').trim();
  const charge = parseFloat(req.body.charge);
  const deliveryTime = (req.body.delivery_time || '').trim() || null;
  if (name && !isNaN(charge)) {
    await db.query('UPDATE delivery_zones SET name = ?, charge = ?, delivery_time = ? WHERE id = ?', [name, charge, deliveryTime, req.params.id]);
  }
  res.redirect('/admin/delivery-zones');
});
router.post('/delivery-zones/toggle/:id', requireAdmin, requireRole('deliveryZones'), async (req, res) => {
  await db.query('UPDATE delivery_zones SET is_active = NOT is_active WHERE id = ?', [req.params.id]);
  res.redirect('/admin/delivery-zones');
});
router.post('/delivery-zones/delete/:id', requireAdmin, requireRole('deliveryZones'), async (req, res) => {
  await db.query('DELETE FROM delivery_zones WHERE id = ?', [req.params.id]);
  res.redirect('/admin/delivery-zones');
});

// ==================== SETTINGS ====================

router.get('/settings', requireAdmin, requireRole('settings'), async (req, res) => {
  const [rows] = await db.query(
    "SELECT setting_key, setting_value FROM settings WHERE setting_key IN ('shop_phone', 'delivery_charge_inside', 'delivery_charge_outside', 'hero_title', 'hero_subtitle', 'announcement_text', 'shop_address', 'facebook_url', 'hero_product_id', 'footer_about', 'shop_email', 'footer_hours', 'youtube_url', 'instagram_url', 'payment_mode', 'gateway_provider', 'gateway_enabled', 'gateway_store_id', 'gateway_store_password', 'gateway_mode', 'logo_url', 'favicon_url', 'og_image_url', 'courier_provider', 'courier_enabled', 'courier_mode', 'steadfast_api_key', 'steadfast_secret_key', 'pathao_client_id', 'pathao_client_secret', 'pathao_username', 'pathao_password', 'pathao_store_id')"
  );
  const [products] = await db.query('SELECT id, name FROM products ORDER BY created_at DESC');
  const get = (key, fallback) => {
    const found = rows.find(r => r.setting_key === key);
    return found ? found.setting_value : fallback;
  };
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
    logoUrl: get('logo_url', '/icons/icon-192.png'),
    faviconUrl: get('favicon_url', '/icons/icon-192.png'),
    ogImageUrl: get('og_image_url', '/icons/icon-512.png'),
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

// ---------- CHANGE ADMIN PASSWORD (Settings theke, nijer password nije bodlano) ----------
router.post('/settings/change-password', requireAdmin, async (req, res) => {
  const { current_password, new_password, confirm_password } = req.body;
  if ((new_password || '').length < 6) return res.redirect('/admin/settings?pw=short');
  if (new_password !== confirm_password) return res.redirect('/admin/settings?pw=mismatch');
  let adminRow = null;
  if (req.session.adminId) {
    const [[row]] = await db.query('SELECT * FROM admins WHERE id = ?', [req.session.adminId]);
    adminRow = row || null;
  }
  if (!adminRow) {
    const [rows] = await db.query('SELECT * FROM admins ORDER BY id ASC LIMIT 1');
    adminRow = rows[0] || null;
  }
  if (!adminRow) return res.redirect('/admin/settings?pw=noaccount');
  const ok = await bcrypt.compare(current_password || '', adminRow.password);
  if (!ok) return res.redirect('/admin/settings?pw=wrong');
  const hashed = await bcrypt.hash(new_password, 10);
  await db.query('UPDATE admins SET password = ? WHERE id = ?', [hashed, adminRow.id]);
  res.redirect('/admin/settings?pw=ok');
});

router.post('/settings', requireAdmin, requireRole('settings'), upload.fields([{ name: 'logo_file', maxCount: 1 }, { name: 'favicon_file', maxCount: 1 }, { name: 'og_file', maxCount: 1 }]), async (req, res) => {
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
    ['logo_url', logoUrl || '/icons/icon-192.png'],
    ['favicon_url', faviconUrl || '/icons/icon-192.png'],
    ['og_image_url', ogImageUrl || '/icons/icon-512.png']
  ];
  // If the gateway password is left blank, the previous one stays (it is never shown in the form)
  if ((req.body.gateway_store_password || '').trim()) {
    settingsToSave.push(['gateway_store_password', (req.body.gateway_store_password || '').trim()]);
  }
  // Same for courier secrets: blank keeps the saved one (they are never shown in the form)
  if ((req.body.steadfast_api_key || '').trim()) settingsToSave.push(['steadfast_api_key', (req.body.steadfast_api_key || '').trim()]);
  if ((req.body.steadfast_secret_key || '').trim()) settingsToSave.push(['steadfast_secret_key', (req.body.steadfast_secret_key || '').trim()]);
  if ((req.body.pathao_client_secret || '').trim()) settingsToSave.push(['pathao_client_secret', (req.body.pathao_client_secret || '').trim()]);
  if ((req.body.pathao_password || '').trim()) settingsToSave.push(['pathao_password', (req.body.pathao_password || '').trim()]);

  for (const [key, value] of settingsToSave) {
    await db.query(
      "INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?",
      [key, value, value]
    );
  }

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
    logoUrl: logoUrl || '/icons/icon-192.png',
    faviconUrl: faviconUrl || '/icons/icon-192.png',
    ogImageUrl: ogImageUrl || '/icons/icon-512.png',
    products,
    message: 'Settings updated! They will appear on the homepage and footer right away.',
    siteName: 'Goince'
  });
});

// ==================== HOMEPAGE BANNERS ====================

router.get('/banners', requireAdmin, requireRole('banners'), async (req, res) => {
  const [banners] = await db.query('SELECT * FROM banners ORDER BY sort_order ASC, id DESC');
  res.render('admin/banners', { banners, editing: null, siteName: 'Goince' });
});
router.post('/banners/add', requireAdmin, requireRole('banners'), upload.single('image'), async (req, res) => {
  const image = req.file ? '/uploads/' + req.file.filename : ((req.body.image_url || '').trim() || null);
  await db.query(
    'INSERT INTO banners (title, subtitle, image, link_url, sort_order, is_active) VALUES (?, ?, ?, ?, ?, 1)',
    [(req.body.title || '').trim(), (req.body.subtitle || '').trim() || null, image, (req.body.link_url || '').trim() || null, parseInt(req.body.sort_order, 10) || 0]
  );
  res.redirect('/admin/banners');
});
router.get('/banners/edit/:id', requireAdmin, requireRole('banners'), async (req, res) => {
  const [[editing]] = await db.query('SELECT * FROM banners WHERE id = ?', [req.params.id]);
  if (!editing) return res.redirect('/admin/banners');
  const [banners] = await db.query('SELECT * FROM banners ORDER BY sort_order ASC, id DESC');
  res.render('admin/banners', { banners, editing, siteName: 'Goince' });
});
router.post('/banners/edit/:id', requireAdmin, requireRole('banners'), upload.single('image'), async (req, res) => {
  const [[old]] = await db.query('SELECT * FROM banners WHERE id = ?', [req.params.id]);
  if (!old) return res.redirect('/admin/banners');
  const image = req.file ? '/uploads/' + req.file.filename : ((req.body.image_url || '').trim() || old.image);
  await db.query(
    'UPDATE banners SET title = ?, subtitle = ?, image = ?, link_url = ?, sort_order = ? WHERE id = ?',
    [(req.body.title || '').trim(), (req.body.subtitle || '').trim() || null, image, (req.body.link_url || '').trim() || null, parseInt(req.body.sort_order, 10) || 0, req.params.id]
  );
  res.redirect('/admin/banners');
});
router.post('/banners/:id/toggle', requireAdmin, requireRole('banners'), async (req, res) => {
  await db.query('UPDATE banners SET is_active = 1 - is_active WHERE id = ?', [req.params.id]);
  res.redirect('/admin/banners');
});
router.post('/banners/:id/delete', requireAdmin, requireRole('banners'), async (req, res) => {
  await db.query('DELETE FROM banners WHERE id = ?', [req.params.id]);
  res.redirect('/admin/banners');
});

// ==================== CONTACT MESSAGES (website-er Contact form) ====================
router.get('/messages', requireAdmin, requireRole('messages'), async (req, res) => {
  const [messages] = await db.query('SELECT * FROM contact_messages ORDER BY created_at DESC LIMIT 100');
  const [[{ unread }]] = await db.query('SELECT COUNT(*) AS unread FROM contact_messages WHERE is_read = 0');
  res.render('admin/messages', { messages, unread, siteName: 'Goince' });
});
router.post('/messages/:id/read', requireAdmin, requireRole('messages'), async (req, res) => {
  await db.query('UPDATE contact_messages SET is_read = 1 WHERE id = ?', [req.params.id]);
  res.redirect('/admin/messages');
});
router.post('/messages/:id/delete', requireAdmin, requireRole('messages'), async (req, res) => {
  await db.query('DELETE FROM contact_messages WHERE id = ?', [req.params.id]);
  res.redirect('/admin/messages');
});

// ==================== REVIEWS MODERATION ====================

router.get('/reviews', requireAdmin, requireRole('reviews'), async (req, res) => {
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
  res.render('admin/reviews', { reviews, pending, status: status || '', siteName: 'Goince' });
});
router.post('/reviews/:id/approve', requireAdmin, requireRole('reviews'), async (req, res) => {
  await db.query("UPDATE reviews SET status = 'approved' WHERE id = ?", [req.params.id]);
  res.redirect('/admin/reviews');
});
router.post('/reviews/:id/hide', requireAdmin, requireRole('reviews'), async (req, res) => {
  await db.query("UPDATE reviews SET status = 'hidden' WHERE id = ?", [req.params.id]);
  res.redirect('/admin/reviews');
});
router.post('/reviews/:id/delete', requireAdmin, requireRole('reviews'), async (req, res) => {
  await db.query('DELETE FROM reviews WHERE id = ?', [req.params.id]);
  res.redirect('/admin/reviews');
});

// ==================== TEST EMAIL (Debug tool) ====================

router.get('/test-email', requireAdmin, requireRole('testEmail'), (req, res) => {
  res.render('admin/test-email', { result: null, testEmail: '', siteName: 'Goince' });
});

router.post('/test-email', requireAdmin, requireRole('testEmail'), async (req, res) => {
  const { test_email } = req.body;
  const { sendTestEmail } = require('../config/email');
  const result = await sendTestEmail(test_email);
  res.render('admin/test-email', { result, testEmail: test_email, siteName: 'Goince' });
});

// ==================== STAFF (admin users + roles) ====================
// Owner-only: notun admin banano, role bodlano, password reset, delete.
// Role: owner (shob kichu), manager (products/orders/customers/inventory),
// staff (orders + products shudhu dekhte pare).
router.get('/staff', requireAdmin, requireRole('staff'), async (req, res) => {
  try {
    const [admins] = await db.query('SELECT id, email, role, created_at FROM admins ORDER BY id ASC');
    res.render('admin/staff', { admins, meId: req.session.adminId, siteName: 'Goince', message: req.query.msg || null, error: req.query.err || null });
  } catch (err) {
    res.render('admin/staff', { admins: [], meId: req.session.adminId, siteName: 'Goince', message: null, error: 'Could not load staff list.' });
  }
});

router.post('/staff/add', requireAdmin, requireRole('staff'), async (req, res) => {
  const { email, password, role } = req.body;
  const cleanRole = ROLES.includes(role) ? role : 'staff';
  if (!email || !password || password.length < 6) {
    return res.redirect('/admin/staff?err=' + encodeURIComponent('Email and a password of at least 6 characters are required.'));
  }
  try {
    const [existing] = await db.query('SELECT id FROM admins WHERE email = ?', [email.trim()]);
    if (existing.length > 0) return res.redirect('/admin/staff?err=' + encodeURIComponent('An admin with this email already exists.'));
    const hashed = await bcrypt.hash(password, 10);
    await db.query('INSERT INTO admins (email, password, role) VALUES (?, ?, ?)', [email.trim(), hashed, cleanRole]);
    res.redirect('/admin/staff?msg=' + encodeURIComponent('Staff account created.'));
  } catch (err) {
    res.redirect('/admin/staff?err=' + encodeURIComponent('Could not create staff account.'));
  }
});

router.post('/staff/:id/role', requireAdmin, requireRole('staff'), async (req, res) => {
  const { role } = req.body;
  const cleanRole = ROLES.includes(role) ? role : 'staff';
  try {
    const [rows] = await db.query('SELECT id, role FROM admins WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.redirect('/admin/staff?err=' + encodeURIComponent('Admin not found.'));
    // Nijer role nije bodlate parbe na; sesh Owner-ke Owner theke sorano jabe na
    if (String(rows[0].id) === String(req.session.adminId)) {
      return res.redirect('/admin/staff?err=' + encodeURIComponent('You cannot change your own role.'));
    }
    if (rows[0].role === 'owner' && cleanRole !== 'owner') {
      const [owners] = await db.query("SELECT COUNT(*) AS cnt FROM admins WHERE role = 'owner'");
      if (owners[0].cnt <= 1) return res.redirect('/admin/staff?err=' + encodeURIComponent('There must be at least one Owner.'));
    }
    await db.query('UPDATE admins SET role = ? WHERE id = ?', [cleanRole, req.params.id]);
    res.redirect('/admin/staff?msg=' + encodeURIComponent('Role updated.'));
  } catch (err) {
    res.redirect('/admin/staff?err=' + encodeURIComponent('Could not update role.'));
  }
});

router.post('/staff/:id/reset-password', requireAdmin, requireRole('staff'), async (req, res) => {
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

router.post('/staff/:id/delete', requireAdmin, requireRole('staff'), async (req, res) => {
  try {
    const [rows] = await db.query('SELECT id, role FROM admins WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.redirect('/admin/staff?err=' + encodeURIComponent('Admin not found.'));
    if (String(rows[0].id) === String(req.session.adminId)) {
      return res.redirect('/admin/staff?err=' + encodeURIComponent('You cannot delete your own account.'));
    }
    if (rows[0].role === 'owner') {
      const [owners] = await db.query("SELECT COUNT(*) AS cnt FROM admins WHERE role = 'owner'");
      if (owners[0].cnt <= 1) return res.redirect('/admin/staff?err=' + encodeURIComponent('There must be at least one Owner.'));
    }
    await db.query('DELETE FROM admins WHERE id = ?', [req.params.id]);
    res.redirect('/admin/staff?msg=' + encodeURIComponent('Staff account deleted.'));
  } catch (err) {
    res.redirect('/admin/staff?err=' + encodeURIComponent('Could not delete staff account.'));
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
  if (period === 'daily') {
    dateCondition = 'DATE(created_at) = CURDATE()';
    periodLabel = "Today (" + new Date().toLocaleDateString() + ")";
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
      periodLabel = customFrom + ' to ' + customTo;
    } else {
      dateCondition = 'DATE(created_at) = CURDATE()';
      periodLabel = "Today (" + new Date().toLocaleDateString() + ") — Please select dates";
    }
  } else {
    periodLabel = 'All Time';
  }
  return { period, dateCondition, params, periodLabel, customFrom, customTo };
}

router.get('/reports', requireAdmin, requireRole('reports'), async (req, res) => {
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

    res.render('admin/reports', {
      period, periodLabel, summary, itemsSummary, cancelledSummary,
      topProducts, orders, customFrom, customTo, totalCost, totalProfit, siteName: 'Goince'
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('There was a problem loading the report: ' + err.message);
  }
});

// ---------- REPORTS CSV EXPORT (ekoi period-er orders + revenue + profit) ----------
router.get('/reports/export', requireAdmin, requireRole('reports'), async (req, res) => {
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

router.post('/products/:id/generate-video', requireAdmin, requireRole('products'), async (req, res) => {
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

router.get('/products/:id/video/download', requireAdmin, requireRole('products'), async (req, res) => {
  const [rows] = await db.query(
    'SELECT filename FROM product_videos WHERE product_id = ? ORDER BY created_at DESC LIMIT 1',
    [req.params.id]
  );
  if (rows.length === 0) return res.status(404).send('No video found');
  const filePath = path.join(__dirname, '..', 'public', 'videos', rows[0].filename);
  if (!fs.existsSync(filePath)) return res.status(404).send('Video file missing');
  res.download(filePath, rows[0].filename);
});

router.post('/products/:id/video/delete', requireAdmin, requireRole('products'), async (req, res) => {
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
