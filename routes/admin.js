// Admin panel er shob route: Login, Dashboard, Product/Order/Coupon/Customer Manage
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const upload = require('../config/upload');

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
    delete loginAttempts[ip]; // shofol login hole attempt count reset
    req.session.isAdmin = true;
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

// ---------- DASHBOARD ----------
router.get('/dashboard', requireAdmin, async (req, res) => {
  try {
    const [[{ totalProducts }]] = await db.query('SELECT COUNT(*) AS totalProducts FROM products');
    const [[{ totalOrders }]] = await db.query('SELECT COUNT(*) AS totalOrders FROM orders');
    const [[{ totalRevenue }]] = await db.query(
      "SELECT COALESCE(SUM(total_amount),0) AS totalRevenue FROM orders WHERE status != 'Cancelled'"
    );
    const [[{ totalCustomers }]] = await db.query('SELECT COUNT(*) AS totalCustomers FROM users');
    const [pendingOrders] = await db.query(
      "SELECT * FROM orders WHERE status = 'Pending' ORDER BY created_at DESC LIMIT 5"
    );

    // Low stock (10 ba tar kom) ebong Out of stock product gulo dashboard e warning hishebe dekhano
    const [lowStockProducts] = await db.query(
      'SELECT * FROM products WHERE stock <= 10 ORDER BY stock ASC LIMIT 5'
    );
    const [[{ lowStockCount }]] = await db.query('SELECT COUNT(*) AS lowStockCount FROM products WHERE stock <= 10 AND stock > 0');
    const [[{ outOfStockCount }]] = await db.query('SELECT COUNT(*) AS outOfStockCount FROM products WHERE stock = 0');

    res.render('admin/dashboard', {
      totalProducts, totalOrders, totalRevenue, totalCustomers, pendingOrders,
      lowStockProducts, lowStockCount, outOfStockCount,
      siteName: 'Goince'
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Dashboard load korte problem hoyeche.');
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
    'SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON p.category_id = c.id ORDER BY p.created_at DESC'
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
    const { name, description, short_description, specifications, price, compare_at_price, stock, category_id } = req.body;
    const image = (req.files && req.files.image) ? req.files.image[0].filename : 'no-image.png';

    const [result] = await db.query(
      'INSERT INTO products (category_id, name, description, short_description, specifications, price, compare_at_price, stock, image) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [category_id || null, name, description, short_description || null, specifications || null, price, compare_at_price || null, stock || 0, image]
    );

    // Gallery e extra images thakle shegulo product_images table e jog kora
    if (req.files && req.files.gallery) {
      for (const file of req.files.gallery) {
        await db.query('INSERT INTO product_images (product_id, image) VALUES (?, ?)', [result.insertId, file.filename]);
      }
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
    const { name, description, short_description, specifications, price, compare_at_price, stock, category_id } = req.body;
    const id = req.params.id;
    const mainImage = (req.files && req.files.image) ? req.files.image[0].filename : null;

    if (mainImage) {
      await db.query(
        'UPDATE products SET name=?, description=?, short_description=?, specifications=?, price=?, compare_at_price=?, stock=?, category_id=?, image=? WHERE id=?',
        [name, description, short_description || null, specifications || null, price, compare_at_price || null, stock || 0, category_id || null, mainImage, id]
      );
    } else {
      await db.query(
        'UPDATE products SET name=?, description=?, short_description=?, specifications=?, price=?, compare_at_price=?, stock=?, category_id=? WHERE id=?',
        [name, description, short_description || null, specifications || null, price, compare_at_price || null, stock || 0, category_id || null, id]
      );
    }

    // Notun gallery image add kora hole, purono gulor sathe jog hobe (mucbe na)
    if (req.files && req.files.gallery) {
      for (const file of req.files.gallery) {
        await db.query('INSERT INTO product_images (product_id, image) VALUES (?, ?)', [id, file.filename]);
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
  res.render('admin/order-details', { order, items, siteName: 'Goince' });
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

// ==================== SETTINGS ====================

router.get('/settings', requireAdmin, async (req, res) => {
  const [rows] = await db.query(
    "SELECT setting_key, setting_value FROM settings WHERE setting_key IN ('shop_phone', 'delivery_charge_inside', 'delivery_charge_outside')"
  );
  const get = (key, fallback) => {
    const found = rows.find(r => r.setting_key === key);
    return found ? found.setting_value : fallback;
  };
  res.render('admin/settings', {
    shopPhone: get('shop_phone', ''),
    deliveryChargeInside: get('delivery_charge_inside', '60'),
    deliveryChargeOutside: get('delivery_charge_outside', '120'),
    message: null,
    siteName: 'Goince'
  });
});

router.post('/settings', requireAdmin, async (req, res) => {
  const shopPhone = (req.body.shop_phone || '').trim();
  const deliveryChargeInside = parseFloat(req.body.delivery_charge_inside);
  const deliveryChargeOutside = parseFloat(req.body.delivery_charge_outside);

  // Delivery charge songkha (number) hote hobe, na hole purono value e ferot jabe
  const safeInside = isNaN(deliveryChargeInside) ? 60 : deliveryChargeInside;
  const safeOutside = isNaN(deliveryChargeOutside) ? 120 : deliveryChargeOutside;

  const settingsToSave = [
    ['shop_phone', shopPhone],
    ['delivery_charge_inside', String(safeInside)],
    ['delivery_charge_outside', String(safeOutside)]
  ];

  for (const [key, value] of settingsToSave) {
    await db.query(
      "INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?",
      [key, value, value]
    );
  }

  res.render('admin/settings', {
    shopPhone,
    deliveryChargeInside: safeInside,
    deliveryChargeOutside: safeOutside,
    message: 'Settings update hoyeche!',
    siteName: 'Goince'
  });
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

module.exports = router;
