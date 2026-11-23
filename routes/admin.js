// Admin panel er shob route: Login, Dashboard, Product/Order/Coupon/Customer Manage
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const upload = require('../config/upload');
const { isConfigured: isPushConfigured } = require('../config/push');

function requireAdmin(req, res, next) {
  if (req.session.isAdmin) return next();
  res.redirect('/admin/login');
}

// ---------- ADMIN LOGIN (5 bar bhul dile 10 minute er jonno lock) ----------
const loginAttempts = {}; // { ip: { count, lockUntil } } — in-memory, server restart hole reset hoye jabe
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 10 * 60 * 1000; // 10 minute

router.get('/login', (req, res) => {
  res.render('admin/login', { error: null, siteName: 'Goince' });
});

router.post('/login', async (req, res) => {
  const ip = req.ip;
  const now = Date.now();
  const record = loginAttempts[ip];

  // Ei IP ekhono lock ache kina check kora
  if (record && record.lockUntil && now < record.lockUntil) {
    const minutesLeft = Math.ceil((record.lockUntil - now) / 60000);
    return res.render('admin/login', {
      error: `Onek bar bhul password diyecho. Doya kore ${minutesLeft} minute por abar try koro.`,
      siteName: 'Goince'
    });
  }

  const { email, password } = req.body;
  let loginOk = false;

  try {
    // Age DB ("admins" table)-e check kora, karon Forgot Password diye
    // password change korle oita-i notun sothik password
    const [rows] = await db.query('SELECT * FROM admins WHERE email = ?', [email]);
    if (rows.length > 0) {
      loginOk = await bcrypt.compare(password || '', rows[0].password);
    } else if (email === process.env.ADMIN_EMAIL && password === process.env.ADMIN_PASSWORD) {
      // "admins" table e ei email er row nei — .env diye fallback check
      loginOk = true;
    }
  } catch (err) {
    // "admins" table na thakle (sql/update.sql run kora hoyni), purono
    // .env-based check diye login cholte thakbe
    if (email === process.env.ADMIN_EMAIL && password === process.env.ADMIN_PASSWORD) {
      loginOk = true;
    }
  }

  if (loginOk) {
    delete loginAttempts[ip]; // reset attempt count after a successful login
    req.session.isAdmin = true;

    // "Remember Me" checked -> stay logged in for 30 days; otherwise the
    // session ends when the browser is closed (a normal session cookie)
    if (req.body.remember_me) {
      req.session.cookie.maxAge = 1000 * 60 * 60 * 24 * 30; // 30 days
    } else {
      req.session.cookie.expires = false; // session cookie — expires when the browser closes
    }

    return res.redirect('/admin/dashboard');
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
    ? ` (Ar ${attemptsLeft} bar bhul hole 10 minute er jonno lock hoye jabe.)`
    : '';
  res.render('admin/login', { error: `Email or password ভুল হয়েছে!${warning}`, siteName: 'Goince' });
});

router.get('/logout', (req, res) => {
  req.session.isAdmin = false;
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
      return res.render('admin/forgot-password', { error: 'Email ditei hobe.', message: null, siteName: 'Goince' });
    }

    const [rows] = await db.query('SELECT * FROM admins WHERE email = ?', [email]);

    // Account thakuk ba na thakuk, same message dekhabo (security best practice)
    const genericMessage = 'Ei email diye admin account thakle, password reset korar link pathano hoyeche. Email check koro.';

    if (rows.length > 0) {
      const admin = rows[0];
      const token = require('crypto').randomBytes(32).toString('hex');
      const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 ghonta valid

      await db.query('UPDATE admins SET reset_token = ?, reset_expires = ? WHERE id = ?', [token, expires, admin.id]);

      const resetLink = `${req.protocol}://${req.get('host')}/admin/reset-password/${token}`;

      const { sendPasswordResetEmail } = require('../config/email');
      const sent = await sendPasswordResetEmail(admin.email, 'Admin', resetLink);

      if (!sent) {
        // Email setup na thakle, test korar jonno link ta screen e dekhiye dilam
        return res.render('admin/forgot-password', {
          error: null,
          message: `Email pathano jayni (email setup kora nei). Test korar jonno link: ${resetLink}`,
          siteName: 'Goince'
        });
      }
    }

    res.render('admin/forgot-password', { error: null, message: genericMessage, siteName: 'Goince' });
  } catch (err) {
    console.error('Admin forgot password error:', err);
    res.render('admin/forgot-password', {
      error: '"admins" table paoya jayni. sql/update.sql run kora hoyeche kina check koro.',
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
    return res.render('admin/reset-password', { error: 'Link ta expire hoye geche ba shothik na. Abar try koro.', token: null, siteName: 'Goince' });
  }
  res.render('admin/reset-password', { error: null, token: req.params.token, siteName: 'Goince' });
});

router.post('/reset-password/:token', async (req, res) => {
  try {
    const { password, confirm_password } = req.body;

    if (!password || password.length < 6) {
      return res.render('admin/reset-password', { error: 'Password kompokkhe 6 character howa lagbe.', token: req.params.token, siteName: 'Goince' });
    }
    if (password !== confirm_password) {
      return res.render('admin/reset-password', { error: 'Duto password mile ni.', token: req.params.token, siteName: 'Goince' });
    }

    const [rows] = await db.query(
      'SELECT * FROM admins WHERE reset_token = ? AND reset_expires > NOW()',
      [req.params.token]
    );
    if (rows.length === 0) {
      return res.render('admin/reset-password', { error: 'Link ta expire hoye geche. Abar Forgot Password theke try koro.', token: null, siteName: 'Goince' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await db.query(
      'UPDATE admins SET password = ?, reset_token = NULL, reset_expires = NULL WHERE id = ?',
      [hashedPassword, rows[0].id]
    );

    res.render('admin/login', { error: null, message: 'Password shofolvabe change hoyeche! Ekhon login koro.', siteName: 'Goince' });
  } catch (err) {
    console.error('Admin reset password error:', err);
    res.render('admin/reset-password', { error: 'Kichu ekta shomossha hoyeche.', token: req.params.token, siteName: 'Goince' });
  }
});

// ---------- DASHBOARD / SALES ANALYTICS ----------
router.get('/dashboard', requireAdmin, async (req, res) => {
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
    const [lowStockProducts] = await db.query('SELECT * FROM products WHERE stock <= 10 ORDER BY stock ASC LIMIT 5');
    const [[{ lowStockCount }]] = await db.query('SELECT COUNT(*) AS lowStockCount FROM products WHERE stock <= 10 AND stock > 0');
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
    res.status(500).send('Dashboard load korte problem hoyeche. Server log check korun.');
  }
});

// ==================== INVENTORY / STOCK TRACKING ====================

router.get('/inventory', requireAdmin, async (req, res) => {
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

// ---------- QUICK STOCK UPDATE (ekhane thekei stock change kora jay) ----------
router.post('/inventory/update/:id', requireAdmin, async (req, res) => {
  const stock = Math.max(0, parseInt(req.body.stock) || 0);
  await db.query('UPDATE products SET stock = ? WHERE id = ?', [stock, req.params.id]);
  res.redirect('/admin/inventory' + (req.body.filter ? '?filter=' + req.body.filter : ''));
});

// ---------- PRODUCT LIST ----------
router.get('/products', requireAdmin, async (req, res) => {
  const [products] = await db.query(
    `SELECT p.*, c.name AS category_name,
            (SELECT filename FROM product_videos WHERE product_id = p.id ORDER BY created_at DESC LIMIT 1) AS video_filename,
            (SELECT id FROM product_videos WHERE product_id = p.id ORDER BY created_at DESC LIMIT 1) AS video_id
     FROM products p
     LEFT JOIN categories c ON p.category_id = c.id
     ORDER BY p.created_at DESC`
  );
  res.render('admin/products', { products, siteName: 'Goince' });
});

// ---------- ADD PRODUCT ----------
router.get('/products/add', requireAdmin, async (req, res) => {
  const [categories] = await db.query('SELECT * FROM categories ORDER BY (parent_id IS NULL) DESC, parent_id, name');
  res.render('admin/add-product', { categories, product: null, galleryImages: [], options: [], siteName: 'Goince' });
});

router.post('/products/add', requireAdmin, upload.fields([{ name: 'image', maxCount: 1 }, { name: 'gallery', maxCount: 5 }]), async (req, res) => {
  try {
    const { name, description, short_description, specifications, price, compare_at_price, stock, category_id, source_link, target_audience, size_values, custom_sizes } = req.body;
    const allowedAudiences = ['men', 'women', 'kids', 'unisex'];
    const audience = allowedAudiences.includes(target_audience) ? target_audience : 'all';
    const image = (req.files && req.files.image) ? req.files.image[0].filename : 'no-image.png';

    const [result] = await db.query(
      'INSERT INTO products (category_id, target_audience, name, description, short_description, specifications, price, compare_at_price, stock, image, source_link) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [category_id || null, audience, name, description, short_description || null, specifications || null, price, compare_at_price || null, stock || 0, image, source_link || null]
    );

    // Gallery e extra images thakle shegulo product_images table e jog kora
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
        <h1>😕 Product Add Korte Problem Hoyeche</h1>
        <p><strong>Actual Error:</strong> ${err.sqlMessage || err.message}</p>
        <a href="/admin/products/add" style="color:#f0a500; font-weight:bold;">&larr; Abar Try Koro</a>
      </div>
    `);
  }
});

// ---------- EDIT PRODUCT ----------
router.get('/products/edit/:id', requireAdmin, async (req, res) => {
  const [rows] = await db.query('SELECT * FROM products WHERE id = ?', [req.params.id]);
  if (rows.length === 0) return res.redirect('/admin/products');
  const [categories] = await db.query('SELECT * FROM categories ORDER BY (parent_id IS NULL) DESC, parent_id, name');
  const [galleryImages] = await db.query('SELECT * FROM product_images WHERE product_id = ?', [req.params.id]);
  const [options] = await db.query('SELECT * FROM product_options WHERE product_id = ? ORDER BY sort_order, id', [req.params.id]);
  res.render('admin/add-product', { categories, product: rows[0], galleryImages, options, siteName: 'Goince' });
});

router.post('/products/edit/:id', requireAdmin, upload.fields([{ name: 'image', maxCount: 1 }, { name: 'gallery', maxCount: 5 }]), async (req, res) => {
  try {
    const { name, description, short_description, specifications, price, compare_at_price, stock, category_id, source_link, target_audience } = req.body;
    const allowedAudiences = ['men', 'women', 'kids', 'unisex'];
    const audience = allowedAudiences.includes(target_audience) ? target_audience : 'all';
    const id = req.params.id;
    const mainImage = (req.files && req.files.image) ? req.files.image[0].filename : null;

    if (mainImage) {
      await db.query(
        'UPDATE products SET name=?, description=?, short_description=?, specifications=?, price=?, compare_at_price=?, stock=?, category_id=?, target_audience=?, image=?, source_link=? WHERE id=?',
        [name, description, short_description || null, specifications || null, price, compare_at_price || null, stock || 0, category_id || null, audience, mainImage, source_link || null, id]
      );
    } else {
      await db.query(
        'UPDATE products SET name=?, description=?, short_description=?, specifications=?, price=?, compare_at_price=?, stock=?, category_id=?, target_audience=?, source_link=? WHERE id=?',
        [name, description, short_description || null, specifications || null, price, compare_at_price || null, stock || 0, category_id || null, audience, source_link || null, id]
      );
    }

    // Notun gallery image add kora hole, purono gulor sathe jog hobe (mucbe na)
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
        <h1>😕 Product Update Korte Problem Hoyeche</h1>
        <p><strong>Actual Error:</strong> ${err.sqlMessage || err.message}</p>
        <a href="/admin/products/edit/${id}" style="color:#f0a500; font-weight:bold;">&larr; Abar Try Koro</a>
      </div>
    `);
  }
});

// ---------- DELETE A SINGLE GALLERY IMAGE ----------
router.post('/products/:id/gallery/delete/:imageId', requireAdmin, async (req, res) => {
  await db.query('DELETE FROM product_images WHERE id = ? AND product_id = ?', [req.params.imageId, req.params.id]);
  res.redirect('/admin/products/edit/' + req.params.id);
});

// ==================== PRODUCT OPTIONS (Color / Size / Weight — apni nijei label ঠিক korte parben) ====================
router.post('/products/:id/options/add', requireAdmin, upload.single('option_image'), async (req, res) => {
  try {
    const productId = req.params.id;
    const submittedLabel = (req.body.option_label || '').trim();
    const valueName = (req.body.value_name || '').trim();
    const colorHex = req.body.use_color_hex ? ((req.body.color_hex || '').trim() || null) : null;
    const image = req.file ? req.file.filename : null;

    if (valueName) {
      // Product-e ager theke option thakle, ek-i label rakhar jonno (jate ekta
      // product-e 2 rokom label mixed hoye na jay) — submittedLabel dile shob
      // purono row-o rename hoye jabe, na dile ager label-i thakbe
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
        <h1>😕 Option Add Korte Problem Hoyeche</h1>
        <p><strong>Error:</strong> ${err.sqlMessage || err.message}</p>
        <p>Shombhoboto <code>sql/add_product_options.sql</code> file ta run kora hoyni. Ei command ta try koro:<br>
        <code>mysql -u root -p goince_db &lt; sql/add_product_options.sql</code></p>
        <a href="/admin/products/edit/${req.params.id}" style="color:#f0a500; font-weight:bold;">&larr; Product edit page e ferot jao</a>
      </div>
    `);
  }
});

router.post('/products/:id/options/delete/:optionId', requireAdmin, async (req, res) => {
  await db.query('DELETE FROM product_options WHERE id = ? AND product_id = ?', [req.params.optionId, req.params.id]);
  res.redirect('/admin/products/edit/' + req.params.id);
});

// ---------- DELETE PRODUCT ----------
router.post('/products/delete/:id', requireAdmin, async (req, res) => {
  await db.query('DELETE FROM products WHERE id = ?', [req.params.id]);
  res.redirect('/admin/products');
});

// ---------- CATEGORY QUICK ADD (Add-product form theke use hoy) ----------
router.post('/categories/add', requireAdmin, async (req, res) => {
  try {
    const { name, parent_id } = req.body;
    if (name && name.trim()) {
      await db.query('INSERT INTO categories (name, parent_id) VALUES (?, ?)', [name.trim(), parent_id || null]);
    }
    res.redirect('back');
  } catch (err) {
    console.error('Category add error:', err);
    res.status(500).send('Category add korte problem hoyeche. Database e "parent_id" column ache kina check koro (sql/update.sql run koro).');
  }
});

// ==================== FULL CATEGORY MANAGEMENT ====================

router.get('/categories', requireAdmin, async (req, res) => {
  try {
    const [categories] = await db.query(
      `SELECT categories.*, COUNT(products.id) AS product_count, parent.name AS parent_name
       FROM categories
       LEFT JOIN products ON products.category_id = categories.id
       LEFT JOIN categories AS parent ON parent.id = categories.parent_id
       GROUP BY categories.id ORDER BY (categories.parent_id IS NULL) DESC, categories.parent_id, categories.name`
    );
    // Shudhu main (top-level) category gulo dropdown e dekhano hoy, sub-category er sub-category rakhi na (simple 2-level structure)
    const mainCategories = categories.filter(c => !c.parent_id);
    res.render('admin/categories', { categories, mainCategories, siteName: 'Goince' });
  } catch (err) {
    console.error('Category list error:', err);
    res.status(500).send('Category list load korte problem hoyeche. Database e "parent_id" column ache kina check koro (sql/update.sql -f diye run koro).');
  }
});

router.post('/categories/edit/:id', requireAdmin, async (req, res) => {
  try {
    const { name, parent_id } = req.body;
    if (name && name.trim()) {
      await db.query('UPDATE categories SET name = ?, parent_id = ? WHERE id = ?', [name.trim(), parent_id || null, req.params.id]);
    }
    res.redirect('/admin/categories');
  } catch (err) {
    console.error('Category edit error:', err);
    res.status(500).send('Category update korte problem hoyeche.');
  }
});

router.post('/categories/delete/:id', requireAdmin, async (req, res) => {
  try {
    // Category delete korle, tar under e thaka product gulo "Uncategorized" hoye jabe
    // (product delete hobe na, shudhu category_id NULL hoye jabe — DB schema e ON DELETE SET NULL ache)
    await db.query('DELETE FROM categories WHERE id = ?', [req.params.id]);
    res.redirect('/admin/categories');
  } catch (err) {
    console.error('Category delete error:', err);
    res.status(500).send('Category delete korte problem hoyeche.');
  }
});

// ---------- ORDERS LIST ----------
router.get('/orders', requireAdmin, async (req, res) => {
  const [orders] = await db.query('SELECT * FROM orders ORDER BY created_at DESC');
  res.render('admin/orders', { orders, siteName: 'Goince' });
});

// ---------- ORDER DETAILS ----------
router.get('/orders/:id', requireAdmin, async (req, res) => {
  const [[order]] = await db.query('SELECT * FROM orders WHERE id = ?', [req.params.id]);
  if (!order) return res.redirect('/admin/orders');
  const [items] = await db.query('SELECT * FROM order_items WHERE order_id = ?', [req.params.id]);
  const [[phoneRow]] = await db.query("SELECT setting_value FROM settings WHERE setting_key = 'shop_phone'");
  res.render('admin/order-details', { order, items, siteName: 'Goince', shopPhone: phoneRow ? phoneRow.setting_value : '' });
});

// ---------- UPDATE ORDER STATUS ----------
router.post('/orders/:id/status', requireAdmin, async (req, res) => {
  const { status } = req.body;
  await db.query('UPDATE orders SET status = ? WHERE id = ?', [status, req.params.id]);
  res.redirect('/admin/orders/' + req.params.id);
});

// ---------- UPDATE PAYMENT STATUS ----------
router.post('/orders/:id/payment-status', requireAdmin, async (req, res) => {
  const { payment_status } = req.body;
  await db.query('UPDATE orders SET payment_status = ? WHERE id = ?', [payment_status, req.params.id]);
  res.redirect('/admin/orders/' + req.params.id);
});

// ---------- UPDATE COURIER / TRACKING INFO ----------
router.post('/orders/:id/shipping', requireAdmin, async (req, res) => {
  const { courier_name, tracking_number } = req.body;
  await db.query(
    'UPDATE orders SET courier_name = ?, tracking_number = ? WHERE id = ?',
    [courier_name || null, tracking_number || null, req.params.id]
  );
  res.redirect('/admin/orders/' + req.params.id);
});

// ---------- COUPONS LIST ----------
router.get('/coupons', requireAdmin, async (req, res) => {
  const [coupons] = await db.query('SELECT * FROM coupons ORDER BY created_at DESC');
  res.render('admin/coupons', { coupons, siteName: 'Goince' });
});

// ---------- ADD COUPON ----------
router.post('/coupons/add', requireAdmin, async (req, res) => {
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
router.post('/coupons/toggle/:id', requireAdmin, async (req, res) => {
  await db.query('UPDATE coupons SET active = NOT active WHERE id = ?', [req.params.id]);
  res.redirect('/admin/coupons');
});

// ---------- DELETE COUPON ----------
router.post('/coupons/delete/:id', requireAdmin, async (req, res) => {
  await db.query('DELETE FROM coupons WHERE id = ?', [req.params.id]);
  res.redirect('/admin/coupons');
});

// ==================== CUSTOMER MANAGEMENT ====================

// ---------- CUSTOMER LIST (name/email/phone diye search kora jay) ----------
router.get('/customers', requireAdmin, async (req, res) => {
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
router.get('/customers/add', requireAdmin, (req, res) => {
  res.render('admin/add-customer', { customer: null, error: null, siteName: 'Goince' });
});

router.post('/customers/add', requireAdmin, async (req, res) => {
  try {
    const { name, email, phone, address, password } = req.body;

    if (!name || !email || !password) {
      return res.render('admin/add-customer', {
        customer: null, error: 'Name, Email, Password — shob field pouron koro.', siteName: 'Goince'
      });
    }

    const [existing] = await db.query('SELECT id FROM users WHERE email = ?', [email.trim().toLowerCase()]);
    if (existing.length > 0) {
      return res.render('admin/add-customer', {
        customer: null, error: 'Ei email diye already ekta account ache.', siteName: 'Goince'
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
    res.render('admin/add-customer', { customer: null, error: 'Kichu ekta shomossha hoyeche.', siteName: 'Goince' });
  }
});

// ---------- EDIT CUSTOMER ----------
router.get('/customers/edit/:id', requireAdmin, async (req, res) => {
  const [rows] = await db.query('SELECT * FROM users WHERE id = ?', [req.params.id]);
  if (rows.length === 0) return res.redirect('/admin/customers');
  res.render('admin/add-customer', { customer: rows[0], error: null, siteName: 'Goince' });
});

router.post('/customers/edit/:id', requireAdmin, async (req, res) => {
  try {
    const { name, email, phone, address, password } = req.body;
    const id = req.params.id;

    if (!name || !email) {
      const [rows] = await db.query('SELECT * FROM users WHERE id = ?', [id]);
      return res.render('admin/add-customer', {
        customer: rows[0], error: 'Name ebong Email obosshoi thakte hobe.', siteName: 'Goince'
      });
    }

    // Email onno kono user er sathe conflict korche kina check kora
    const [existing] = await db.query('SELECT id FROM users WHERE email = ? AND id != ?', [email.trim().toLowerCase(), id]);
    if (existing.length > 0) {
      const [rows] = await db.query('SELECT * FROM users WHERE id = ?', [id]);
      return res.render('admin/add-customer', {
        customer: rows[0], error: 'Ei email diye onno ekta account already ache.', siteName: 'Goince'
      });
    }

    if (password && password.trim()) {
      // Password o change korte chaile
      const hashedPassword = await bcrypt.hash(password, 10);
      await db.query(
        'UPDATE users SET name=?, email=?, phone=?, address=?, password=? WHERE id=?',
        [name.trim(), email.trim().toLowerCase(), phone || null, address || null, hashedPassword, id]
      );
    } else {
      // Password field khali rakhle, purono password e thake jabe
      await db.query(
        'UPDATE users SET name=?, email=?, phone=?, address=? WHERE id=?',
        [name.trim(), email.trim().toLowerCase(), phone || null, address || null, id]
      );
    }
    res.redirect('/admin/customers');
  } catch (err) {
    console.error(err);
    res.status(500).send('Customer update korte problem hoyeche.');
  }
});

// ---------- DELETE CUSTOMER ----------
router.post('/customers/delete/:id', requireAdmin, async (req, res) => {
  await db.query('DELETE FROM users WHERE id = ?', [req.params.id]);
  res.redirect('/admin/customers');
});

// ---------- BLOCK / UNBLOCK CUSTOMER ----------
router.post('/customers/:id/toggle-block', requireAdmin, async (req, res) => {
  const [[customer]] = await db.query('SELECT is_blocked FROM users WHERE id = ?', [req.params.id]);
  if (!customer) return res.redirect('/admin/customers');
  await db.query('UPDATE users SET is_blocked = ? WHERE id = ?', [customer.is_blocked ? 0 : 1, req.params.id]);
  res.redirect(req.headers.referer || '/admin/customers/' + req.params.id);
});

// ---------- CUSTOMER DETAIL (profile + full order history) ----------
// Eta shobar niche rakha hoyeche, karon Express route match kore order onujayi —
// eta age thakle "/customers/add" o "/customers/edit/5" ke bhul kore :id hishebe dhore nito.
router.get('/customers/:id', requireAdmin, async (req, res) => {
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
router.get('/chats', requireAdmin, async (req, res) => {
  const [conversations] = await db.query(
    `SELECT chat_conversations.*,
       (SELECT message FROM chat_messages WHERE conversation_id = chat_conversations.id ORDER BY created_at DESC LIMIT 1) AS last_message
     FROM chat_conversations
     ORDER BY last_message_at DESC`
  );
  res.render('admin/chats', { conversations, siteName: 'Goince' });
});

// ---------- SINGLE CONVERSATION VIEW ----------
router.get('/chats/:id', requireAdmin, async (req, res) => {
  const [[conversation]] = await db.query('SELECT * FROM chat_conversations WHERE id = ?', [req.params.id]);
  if (!conversation) return res.redirect('/admin/chats');
  const [messages] = await db.query(
    'SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY created_at ASC',
    [req.params.id]
  );
  res.render('admin/chat-detail', { conversation, messages, siteName: 'Goince' });
});

// ---------- GET MESSAGES (JSON, admin side polling) ----------
router.get('/chats/:id/messages', requireAdmin, async (req, res) => {
  const [messages] = await db.query(
    'SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY created_at ASC',
    [req.params.id]
  );
  res.json({ messages });
});

// ---------- ADMIN REPLY ----------
router.post('/chats/:id/reply', requireAdmin, async (req, res) => {
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
router.get('/payment-methods', requireAdmin, async (req, res) => {
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

router.post('/payment-methods/add', requireAdmin, async (req, res) => {
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

router.post('/payment-methods/edit/:id', requireAdmin, async (req, res) => {
  const methodName = (req.body.method_name || '').trim();
  const number = (req.body.number || '').trim() || null;
  await db.query('UPDATE payment_methods SET method_name = ?, number = ?, payment_type = ?, instructions = ? WHERE id = ?', [methodName, number, (req.body.payment_type || 'send_money'), (req.body.instructions || '').trim() || null, req.params.id]);
  res.redirect('/admin/payment-methods');
});

router.post('/payment-methods/toggle/:id', requireAdmin, async (req, res) => {
  await db.query('UPDATE payment_methods SET is_active = NOT is_active WHERE id = ?', [req.params.id]);
  res.redirect('/admin/payment-methods');
});

router.post('/payment-methods/delete/:id', requireAdmin, async (req, res) => {
  await db.query('DELETE FROM payment_methods WHERE id = ?', [req.params.id]);
  res.redirect('/admin/payment-methods');
});

// ==================== DELIVERY ZONES ====================
router.get('/delivery-zones', requireAdmin, async (req, res) => {
  const [zones] = await db.query('SELECT * FROM delivery_zones ORDER BY sort_order, id');
  res.render('admin/delivery-zones', { zones, siteName: 'Goince' });
});
router.post('/delivery-zones/add', requireAdmin, async (req, res) => {
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
router.post('/delivery-zones/edit/:id', requireAdmin, async (req, res) => {
  const name = (req.body.name || '').trim();
  const charge = parseFloat(req.body.charge);
  const deliveryTime = (req.body.delivery_time || '').trim() || null;
  if (name && !isNaN(charge)) {
    await db.query('UPDATE delivery_zones SET name = ?, charge = ?, delivery_time = ? WHERE id = ?', [name, charge, deliveryTime, req.params.id]);
  }
  res.redirect('/admin/delivery-zones');
});
router.post('/delivery-zones/toggle/:id', requireAdmin, async (req, res) => {
  await db.query('UPDATE delivery_zones SET is_active = NOT is_active WHERE id = ?', [req.params.id]);
  res.redirect('/admin/delivery-zones');
});
router.post('/delivery-zones/delete/:id', requireAdmin, async (req, res) => {
  await db.query('DELETE FROM delivery_zones WHERE id = ?', [req.params.id]);
  res.redirect('/admin/delivery-zones');
});

// ==================== SETTINGS ====================

router.get('/settings', requireAdmin, async (req, res) => {
  const [rows] = await db.query(
    "SELECT setting_key, setting_value FROM settings WHERE setting_key IN ('shop_phone', 'delivery_charge_inside', 'delivery_charge_outside', 'hero_title', 'hero_subtitle', 'announcement_text', 'shop_address', 'facebook_url', 'hero_product_id', 'footer_about', 'shop_email', 'footer_hours', 'youtube_url', 'instagram_url', 'payment_mode', 'gateway_provider', 'gateway_enabled', 'gateway_store_id', 'gateway_store_password', 'gateway_mode', 'logo_url', 'favicon_url', 'og_image_url')"
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
    logoUrl: get('logo_url', '/icons/icon-192.png'),
    faviconUrl: get('favicon_url', '/icons/icon-192.png'),
    ogImageUrl: get('og_image_url', '/icons/icon-512.png'),
    products,
    message: null,
    siteName: 'Goince'
  });
});

router.post('/settings', requireAdmin, upload.fields([{ name: 'logo_file', maxCount: 1 }, { name: 'favicon_file', maxCount: 1 }, { name: 'og_file', maxCount: 1 }]), async (req, res) => {
  const shopPhone = (req.body.shop_phone || '').trim();
  // Logo upload: file dile setai use hobe, na dile URL field-er value, duitai khali thakle ager-ta-i thakbe
  const logoFromFile = (req.files && req.files.logo_file && req.files.logo_file[0]) ? ('/uploads/' + req.files.logo_file[0].filename) : '';
  const faviconFromFile = (req.files && req.files.favicon_file && req.files.favicon_file[0]) ? ('/uploads/' + req.files.favicon_file[0].filename) : '';
  const ogFromFile = (req.files && req.files.og_file && req.files.og_file[0]) ? ('/uploads/' + req.files.og_file[0].filename) : '';
  const logoUrl = logoFromFile || (req.body.logo_url || '').trim();
  const faviconUrl = faviconFromFile || (req.body.favicon_url || '').trim();
  const ogImageUrl = ogFromFile || (req.body.og_image_url || '').trim();
  const deliveryChargeInside = parseFloat(req.body.delivery_charge_inside);
  const deliveryChargeOutside = parseFloat(req.body.delivery_charge_outside);

  // Delivery charge songkha (number) hote hobe, na hole purono value e ferot jabe
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
    ['logo_url', logoUrl || '/icons/icon-192.png'],
    ['favicon_url', faviconUrl || '/icons/icon-192.png'],
    ['og_image_url', ogImageUrl || '/icons/icon-512.png']
  ];
  // Gateway password khali rakhle purono-ta-i thakbe (form-e kokhono dekhano hoy na)
  if ((req.body.gateway_store_password || '').trim()) {
    settingsToSave.push(['gateway_store_password', (req.body.gateway_store_password || '').trim()]);
  }

  for (const [key, value] of settingsToSave) {
    await db.query(
      "INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?",
      [key, value, value]
    );
  }

  const [products] = await db.query('SELECT id, name FROM products ORDER BY created_at DESC');
  const [[gwRow]] = await db.query("SELECT setting_value FROM settings WHERE setting_key = 'gateway_store_password'");
  const gatewayPasswordSet = !!(gwRow && gwRow.setting_value);
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
    logoUrl: logoUrl || '/icons/icon-192.png',
    faviconUrl: faviconUrl || '/icons/icon-192.png',
    ogImageUrl: ogImageUrl || '/icons/icon-512.png',
    products,
    message: 'Settings update hoyeche! Homepage/footer-e shathe shathe dekhabe.',
    siteName: 'Goince'
  });
});

// ==================== CONTACT MESSAGES (website-er Contact form) ====================
router.get('/messages', requireAdmin, async (req, res) => {
  const [messages] = await db.query('SELECT * FROM contact_messages ORDER BY created_at DESC LIMIT 100');
  const [[{ unread }]] = await db.query('SELECT COUNT(*) AS unread FROM contact_messages WHERE is_read = 0');
  res.render('admin/messages', { messages, unread, siteName: 'Goince' });
});
router.post('/messages/:id/read', requireAdmin, async (req, res) => {
  await db.query('UPDATE contact_messages SET is_read = 1 WHERE id = ?', [req.params.id]);
  res.redirect('/admin/messages');
});
router.post('/messages/:id/delete', requireAdmin, async (req, res) => {
  await db.query('DELETE FROM contact_messages WHERE id = ?', [req.params.id]);
  res.redirect('/admin/messages');
});

// ==================== TEST EMAIL (Debug tool) ====================

router.get('/test-email', requireAdmin, (req, res) => {
  res.render('admin/test-email', { result: null, testEmail: '', siteName: 'Goince' });
});

router.post('/test-email', requireAdmin, async (req, res) => {
  const { test_email } = req.body;
  const { sendTestEmail } = require('../config/email');
  const result = await sendTestEmail(test_email);
  res.render('admin/test-email', { result, testEmail: test_email, siteName: 'Goince' });
});

// ==================== REPORTS ====================
// Daily / Weekly / Monthly / Yearly / All Time / Custom Date Range sales report
router.get('/reports', requireAdmin, async (req, res) => {
  try {
    const validPeriods = ['daily', 'weekly', 'monthly', 'yearly', 'all', 'custom'];
    const period = validPeriods.includes(req.query.period) ? req.query.period : 'daily';

    // Period onujayi WHERE condition (parameterized, SQL injection thekay nirapod)
    // ebong ekta readable label toiri kora
    let dateCondition = '1=1';
    let params = [];
    let periodLabel = 'All Time';
    let customFrom = req.query.from || '';
    let customTo = req.query.to || '';

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
      // from/to date format thik ache kina check kora (YYYY-MM-DD)
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (dateRegex.test(customFrom) && dateRegex.test(customTo)) {
        dateCondition = 'DATE(created_at) BETWEEN ? AND ?';
        params = [customFrom, customTo];
        periodLabel = customFrom + ' theke ' + customTo;
      } else {
        // Valid date na dile aajker date dekhano (fallback)
        dateCondition = 'DATE(created_at) = CURDATE()';
        periodLabel = "Today (" + new Date().toLocaleDateString() + ") — Tarikh select korun";
      }
    } else {
      periodLabel = 'All Time';
    }

    // Cancelled order bad diye shob summary calculate kora hocche
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

    // Cancelled order koyta hoyeche shetao alada kore dekhano
    const [[cancelledSummary]] = await db.query(
      `SELECT COUNT(*) AS cancelledOrders FROM orders WHERE ${dateCondition} AND status = 'Cancelled'`,
      params
    );

    // Ei period-e shob theke beshi bikri hoya product (top 5)
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

    // Ei period-er order-gulo (recent 20 ta, shob status shoho)
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
      topProducts, orders, customFrom, customTo, siteName: 'Goince'
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Report load korte problem hoyeche: ' + err.message);
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

router.post('/products/:id/generate-video', requireAdmin, async (req, res) => {
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

router.get('/products/:id/video/download', requireAdmin, async (req, res) => {
  const [rows] = await db.query(
    'SELECT filename FROM product_videos WHERE product_id = ? ORDER BY created_at DESC LIMIT 1',
    [req.params.id]
  );
  if (rows.length === 0) return res.status(404).send('No video found');
  const filePath = path.join(__dirname, '..', 'public', 'videos', rows[0].filename);
  if (!fs.existsSync(filePath)) return res.status(404).send('Video file missing');
  res.download(filePath, rows[0].filename);
});

router.post('/products/:id/video/delete', requireAdmin, async (req, res) => {
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
