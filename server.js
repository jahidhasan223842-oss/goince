// Goince E-commerce - Main Server File
require('dotenv').config();
const express = require('express');
require('express-async-errors'); // Eta thakle kono route e async error hole
                                   // pura server crash na hoye, shundor error page dekhabe
const session = require('express-session');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const path = require('path');

const { csrfProtection } = require('./lib/csrf');

const shopRoutes = require('./routes/shop');
const adminRoutes = require('./routes/admin');
const authRoutes = require('./routes/auth');
const chatRoutes = require('./routes/chat');

const helmet = require('helmet');

const app = express();

// Site settings (Admin > Settings theke bodlano jay): hero, announcement,
// address, Facebook link — kono code change chara-i homepage/footer bodle jabe.
const SITE_SETTING_KEYS = ['hero_title', 'hero_subtitle', 'announcement_text', 'shop_address', 'facebook_url', 'hero_product_id', 'footer_about', 'shop_email', 'footer_hours', 'youtube_url', 'instagram_url', 'payment_mode', 'gateway_provider', 'gateway_enabled', 'gateway_store_id', 'gateway_mode', 'logo_url', 'favicon_url', 'og_image_url'];
const SITE_SETTING_DEFAULTS = {
  hero_title: 'Cash on Delivery — sara Bangladesh-e delivery',
  hero_subtitle: 'Dhaka-r vitore 1–2 din, Dhaka-r baire 3–5 dine delivery. Order korar age phone-e confirm kora hoy.',
  announcement_text: '',
  shop_address: '',
  facebook_url: '',
  hero_product_id: '',
  footer_about: 'Bangladesh-er online shop — Cash on Delivery, Dhaka-r vitore 1–2 din, Dhaka-r baire 3–5 dine delivery.',
  shop_email: '',
  footer_hours: '',
  youtube_url: '',
  instagram_url: '',
  payment_mode: 'manual',
  gateway_provider: 'none',
  gateway_enabled: '0',
  gateway_store_id: '',
  gateway_mode: 'sandbox',
  logo_url: '/icons/icon-192.png',
  favicon_url: '/icons/icon-192.png',
  og_image_url: '/icons/icon-512.png'
};

// ---------- Auto-create tables needed by newer features ----------
// Runs on every start and does nothing if the table already exists, so a new
// feature's table never has to be created by hand on the live database.
(async () => {
  try {
    const db = require('./config/db');
    await db.query(`CREATE TABLE IF NOT EXISTS delivery_zones (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      slug VARCHAR(100) NOT NULL UNIQUE,
      charge DECIMAL(10,2) NOT NULL DEFAULT 0,
      delivery_time VARCHAR(100) DEFAULT NULL,
      is_active TINYINT(1) DEFAULT 1,
      sort_order INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    // Purono inside/outside delivery charge theke prothombar zone seed kora
    const [[{ zoneCount }]] = await db.query('SELECT COUNT(*) AS zoneCount FROM delivery_zones');
    if (zoneCount === 0) {
      const [srows] = await db.query("SELECT setting_key, setting_value FROM settings WHERE setting_key IN ('delivery_charge_inside', 'delivery_charge_outside')");
      const get = (k, fb) => { const r = srows.find(x => x.setting_key === k); return r ? parseFloat(r.setting_value) || fb : fb; };
      await db.query('INSERT INTO delivery_zones (name, slug, charge, delivery_time, sort_order) VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)',
        ['Inside Dhaka', 'inside_dhaka', get('delivery_charge_inside', 60), '1-2 din', 1, 'Outside Dhaka', 'outside_dhaka', get('delivery_charge_outside', 120), '3-5 din', 2]);
    }
    // Product advanced fields (purono table-e na thakle jog kora) — Add Product form-er
    // notun section gulo (SKU, cost, brand, status, SEO, shipping) ekhane save hoy
    const [pCols] = await db.query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products'");
    const pNames = new Set(pCols.map(c => c.COLUMN_NAME));
    const productCols = [
      ['sku', 'VARCHAR(100) DEFAULT NULL'],
      ['cost_price', 'DECIMAL(10,2) DEFAULT NULL'],
      ['brand', 'VARCHAR(100) DEFAULT NULL'],
      ['tags', 'VARCHAR(500) DEFAULT NULL'],
      ['weight_kg', 'DECIMAL(8,2) DEFAULT NULL'],
      ['status', "VARCHAR(20) NOT NULL DEFAULT 'published'"],
      ['scheduled_at', 'DATETIME DEFAULT NULL'],
      ['is_featured', 'TINYINT(1) NOT NULL DEFAULT 0'],
      ['is_new', 'TINYINT(1) NOT NULL DEFAULT 0'],
      ['free_shipping', 'TINYINT(1) NOT NULL DEFAULT 0'],
      ['cod_allowed', 'TINYINT(1) NOT NULL DEFAULT 1'],
      ['low_stock_threshold', 'INT NOT NULL DEFAULT 5'],
      ['slug', 'VARCHAR(255) DEFAULT NULL'],
      ['meta_title', 'VARCHAR(255) DEFAULT NULL'],
      ['meta_description', 'VARCHAR(500) DEFAULT NULL'],
      ['image_alt', 'VARCHAR(255) DEFAULT NULL']
    ];
    for (const [col, def] of productCols) {
      if (!pNames.has(col)) await db.query(`ALTER TABLE products ADD COLUMN ${col} ${def}`);
    }
    const [[{ slugIdx }]] = await db.query("SELECT COUNT(*) AS slugIdx FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND INDEX_NAME = 'idx_products_slug'");
    if (!slugIdx) { try { await db.query('CREATE UNIQUE INDEX idx_products_slug ON products (slug)'); } catch (e) { /* slug-e duplicate thakle index lagbe na */ } }
    await db.query(`CREATE TABLE IF NOT EXISTS related_products (
      id INT AUTO_INCREMENT PRIMARY KEY,
      product_id INT NOT NULL,
      related_id INT NOT NULL,
      sort_order INT DEFAULT 0,
      UNIQUE KEY uq_related (product_id, related_id),
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      FOREIGN KEY (related_id) REFERENCES products(id) ON DELETE CASCADE
    )`);
    const [oiCols] = await db.query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_items'");
    if (!oiCols.map(c => c.COLUMN_NAME).includes('cost_price')) {
      await db.query('ALTER TABLE order_items ADD COLUMN cost_price DECIMAL(10,2) DEFAULT NULL');
    }
    // Inventory & Variants advanced fields (PR #8)
    const [pCols2] = await db.query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products'");
    const pNames2 = new Set(pCols2.map(c => c.COLUMN_NAME));
    for (const [col, def] of [
      ['allow_backorder', 'TINYINT(1) NOT NULL DEFAULT 0'],
      ['delivery_time', 'VARCHAR(100) DEFAULT NULL'],
      ['barcode', 'VARCHAR(100) DEFAULT NULL']
    ]) if (!pNames2.has(col)) await db.query(`ALTER TABLE products ADD COLUMN ${col} ${def}`);
    const [vCols] = await db.query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_variants'");
    const vNames = new Set(vCols.map(c => c.COLUMN_NAME));
    for (const [col, def] of [
      ['image', 'VARCHAR(255) DEFAULT NULL'],
      ['compare_at_price', 'DECIMAL(10,2) DEFAULT NULL'],
      ['barcode', 'VARCHAR(100) DEFAULT NULL']
    ]) if (!vNames.has(col)) await db.query(`ALTER TABLE product_variants ADD COLUMN ${col} ${def}`);
    await db.query(`CREATE TABLE IF NOT EXISTS stock_alerts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      product_id INT NOT NULL,
      phone VARCHAR(20) NOT NULL,
      notified TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    )`);
    await db.query(`CREATE TABLE IF NOT EXISTS stock_history (
      id INT AUTO_INCREMENT PRIMARY KEY,
      product_id INT NOT NULL,
      variant_id INT DEFAULT NULL,
      change_qty INT NOT NULL,
      stock_after INT NOT NULL,
      reason VARCHAR(50) NOT NULL DEFAULT 'manual',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    )`);
    // payment_methods-e payment type + instructions column (purono table-e na thakle jog kora)
    const [pmCols] = await db.query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payment_methods'");
    const pmNames = pmCols.map(c => c.COLUMN_NAME);
    if (!pmNames.includes('payment_type')) await db.query("ALTER TABLE payment_methods ADD COLUMN payment_type VARCHAR(30) NOT NULL DEFAULT 'send_money'");
    if (!pmNames.includes('instructions')) await db.query('ALTER TABLE payment_methods ADD COLUMN instructions TEXT DEFAULT NULL');
    // Courier API: consignment id + last-known delivery status on orders
    const [oCols] = await db.query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders'");
    const oNames = new Set(oCols.map(c => c.COLUMN_NAME));
    if (!oNames.has('courier_consignment_id')) await db.query("ALTER TABLE orders ADD COLUMN courier_consignment_id VARCHAR(100) DEFAULT NULL");
    if (!oNames.has('courier_status')) await db.query("ALTER TABLE orders ADD COLUMN courier_status VARCHAR(50) DEFAULT NULL");
    // Homepage banners (Admin > Banners theke chalano jay)
    await db.query(`CREATE TABLE IF NOT EXISTS banners (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      subtitle VARCHAR(500) DEFAULT NULL,
      image VARCHAR(255) DEFAULT NULL,
      link_url VARCHAR(500) DEFAULT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    // Reviews moderation: status pending / approved / hidden (purono review gulo approved thakbe)
    const [rvCols] = await db.query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reviews'");
    if (!rvCols.map(c => c.COLUMN_NAME).includes('status')) {
      await db.query("ALTER TABLE reviews ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'approved'");
    }
    // Categories advanced fields (Admin > Categories theke chalano jay):
    // photo, description, sort order, show/hide, featured, slug
    const [cCols] = await db.query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'categories'");
    const cNames = new Set(cCols.map(c => c.COLUMN_NAME));
    for (const [col, def] of [
      ['image_url', 'VARCHAR(500) DEFAULT NULL'],
      ['description', 'TEXT DEFAULT NULL'],
      ['sort_order', 'INT NOT NULL DEFAULT 0'],
      ['is_visible', 'TINYINT(1) NOT NULL DEFAULT 1'],
      ['is_featured', 'TINYINT(1) NOT NULL DEFAULT 0'],
      ['slug', 'VARCHAR(150) DEFAULT NULL']
    ]) if (!cNames.has(col)) await db.query(`ALTER TABLE categories ADD COLUMN ${col} ${def}`);
    // Purono category gulo backfill: slug = name theke, sort_order = id order.
    // Slug 140-e kata hoy, jate duplicate hole '-2' suffix jog korleo
    // 150 character-er column-e dhore (na hole update fail korte pare).
    const slugifyCat = (t) => String(t || '').toLowerCase().trim().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 140);
    const [oldCats] = await db.query('SELECT id, name FROM categories WHERE slug IS NULL OR slug = ""');
    for (const c of oldCats) {
      let s = slugifyCat(c.name) || 'category';
      let cand = s, n = 2;
      while (true) {
        const [dups] = await db.query('SELECT id FROM categories WHERE slug = ? AND id != ?', [cand, c.id]);
        if (!dups.length) break;
        cand = s + '-' + (n++);
      }
      await db.query('UPDATE categories SET slug = ? WHERE id = ?', [cand, c.id]);
    }
    await db.query('UPDATE categories SET sort_order = id WHERE sort_order = 0');
    try { await db.query('CREATE UNIQUE INDEX idx_categories_slug ON categories (slug)'); } catch (e) { /* slug-e duplicate thakle index lagbe na */ }
    await db.query(`CREATE TABLE IF NOT EXISTS contact_messages (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      phone VARCHAR(20) DEFAULT NULL,
      email VARCHAR(255) DEFAULT NULL,
      subject VARCHAR(255) DEFAULT NULL,
      message TEXT NOT NULL,
      is_read TINYINT(1) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    await db.query(`CREATE TABLE IF NOT EXISTS product_videos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      product_id INT NOT NULL,
      filename VARCHAR(255) NOT NULL,
      duration_seconds DECIMAL(6,2) DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      INDEX idx_product_id (product_id)
    )`);
  } catch (err) {
    console.error('Auto-create product_videos skipped (create it by hand with sql/add_product_videos.sql):', err.message);
  }
})();

// ---------- Admins table-e role column (purono table-e na thakle jog kora) ----------
// Staff roles: owner / manager / staff. Default 'owner' — ekhonkar ekmatro
// admin (admin@goince.com) Owner-i thakbe.
(async () => {
  try {
    const db = require('./config/db');
    const [cols] = await db.query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'admins'");
    if (!cols.map(c => c.COLUMN_NAME).includes('role')) {
      await db.query("ALTER TABLE admins ADD COLUMN role VARCHAR(20) NOT NULL DEFAULT 'owner'");
    }
  } catch (err) {
    console.error('Admin role column skip holo:', err.message);
  }
})();

// ---------- Admin account DB-te seed kora (.env theke) ----------
// Age Admin login shudhu .env-er ADMIN_EMAIL/ADMIN_PASSWORD diye hoto.
// Forgot Password feature-er jonno DB-te thakte hobe (kokhono update
// korte hobe), tai server start howar shomoy "admins" table khali thakle
// .env-er value diye ekbar seed kore neya hoy. Table-e already row thakle
// kichu change hoy na (email/password change korte hobe Forgot Password
// diye, .env change kore na).
(async () => {
  try {
    const db = require('./config/db');
    const bcrypt = require('bcryptjs');
    const [rows] = await db.query('SELECT COUNT(*) AS cnt FROM admins');
    if (rows[0].cnt === 0 && process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
      const hashed = await bcrypt.hash(process.env.ADMIN_PASSWORD, 10);
      await db.query('INSERT INTO admins (email, password) VALUES (?, ?)', [process.env.ADMIN_EMAIL, hashed]);
      console.log('Admin account DB-te seed kora holo (.env theke):', process.env.ADMIN_EMAIL);
    }
  } catch (err) {
    // "admins" table na thakle (update.sql run kora hoyni) shudhu log kore
    // rakhbo — purono .env-based login ekhono kaj korbe, server crash korbe na
    console.error('Admin seed skip holo (sql/update.sql run kora hoyeche kina check koro):', err.message);
  }
})();

// Reverse proxy (Nginx/Cloudflare)-r pichone chalale, eta na thakle req.ip
// shobsomoy proxy-r nijer IP dekhabe, real visitor-er IP na. Eta thakle
// Nginx-er "X-Forwarded-For" header theke real IP niye nibe (Admin login
// lockout thik IP dhore kaj korar jonno eta joruri).
app.set('trust proxy', 1);

// ---------- View Engine ----------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ---------- Security Headers (Helmet) ----------
// contentSecurityPolicy off rakha hoyeche kaw Google Analytics, Facebook Pixel,
// ebong EJS-er onek inline <script> block ache - CSP on thakle egulo block hoye
// jete pare. Baki shob security header (clickjacking, MIME-sniffing protection
// ityadi) thik-i thakbe.
app.use(helmet({ contentSecurityPolicy: false, hsts: false }));

// ---------- HTTPS Force Redirect (SSL thik moto kaj korle-i .env e
// FORCE_HTTPS=true kore চালু korben, nahole site বন্ধ হয়ে jete pare) ----------
if (process.env.FORCE_HTTPS === 'true') {
  app.use((req, res, next) => {
    if (!req.secure) {
      return res.redirect(301, `https://${req.headers.host}${req.url}`);
    }
    next();
  });
}

// ---------- Middleware ----------
// Halka in-memory rate limiter (kono notun dependency chara): login / signup /
// checkout-e ek IP theke brute-force ba spam order atkanor jonno. Admin login-er
// nijer lockout (routes/admin.js) etar sathe alada vabe kaj kore.
function createRateLimiter({ windowMs, max, message }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [ip, h] of hits) if (h.resetAt <= now) hits.delete(ip);
  }, windowMs).unref();
  return (req, res, next) => {
    if (req.method !== 'POST') return next();
    const ip = req.ip || 'unknown';
    const now = Date.now();
    const h = hits.get(ip) || { count: 0, resetAt: now + windowMs };
    if (h.resetAt <= now) { h.count = 0; h.resetAt = now + windowMs; }
    h.count += 1;
    hits.set(ip, h);
    if (h.count > max) return res.status(429).send(message);
    next();
  };
}
app.use(createRateLimiter({
  windowMs: 15 * 60 * 1000, max: 60,
  message: 'Too many requests — 15 minute pore abar try koro.'
}));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(cookieParser());

// SESSION_SECRET na thakle production-e server chalano jabe na — hardcoded
// secret diye chalale jekono session forge kora jeto (age 'change_this_secret'
// chilo, seta sorano holo). Development-e ekbar-er jonno random secret banano hoy.
const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET .env-e set koro — production-e eta chara server cholbe na.');
  }
  console.warn('WARNING: SESSION_SECRET set kora nei — development-er jonno temporary random secret use hocche. Live-e obosshoi .env-e lomba random secret dite hobe.');
}
app.use(session({
  secret: sessionSecret || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: true,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24, // 1 din
    secure: process.env.FORCE_HTTPS === 'true' // HTTPS chalu thakle-i cookie-o শুধু HTTPS-e jabe
  }
}));

// ---------- Persistent Chat ID (long-lived cookie, session theke alada —
// jate server restart hoile o customer er chat history harai na jay) ----------
app.use((req, res, next) => {
  if (!req.cookies.goince_chat_id) {
    const chatId = crypto.randomBytes(16).toString('hex');
    res.cookie('goince_chat_id', chatId, { maxAge: 365 * 24 * 60 * 60 * 1000 }); // 1 bochor
    req.chatId = chatId;
  } else {
    req.chatId = req.cookies.goince_chat_id;
  }
  next();
});

// ---------- Global view variables (shob view e automatic available thakbe) ----------
app.use(async (req, res, next) => {
  res.locals.userName = req.session.userName || null;
  res.locals.adminRole = req.session.adminRole || 'owner';
  res.locals.adminEmail = req.session.adminEmail || null;
  res.locals.cartCount = (req.session.cart || []).reduce((sum, item) => sum + item.quantity, 0);

  // Shop phone + site settings Database theke real-time e neya, jate Admin Panel
  // theke change korle shathe shathe (server restart chara-i) effect hoy
  try {
    const db = require('./config/db');
    const [[row]] = await db.query("SELECT setting_value FROM settings WHERE setting_key = 'shop_phone'");
    res.locals.shopPhone = row ? row.setting_value : (process.env.SHOP_PHONE || '+8801XXXXXXXXX');
    const [srows] = await db.query(
      `SELECT setting_key, setting_value FROM settings WHERE setting_key IN (${SITE_SETTING_KEYS.map(() => '?').join(',')})`,
      SITE_SETTING_KEYS);
    res.locals.siteSettings = { ...SITE_SETTING_DEFAULTS };
    srows.forEach(r => { res.locals.siteSettings[r.setting_key] = r.setting_value || ''; });
    if (!res.locals.siteSettings.logo_url) res.locals.siteSettings.logo_url = SITE_SETTING_DEFAULTS.logo_url;
    if (!res.locals.siteSettings.favicon_url) res.locals.siteSettings.favicon_url = SITE_SETTING_DEFAULTS.favicon_url;
    if (!res.locals.siteSettings.og_image_url) res.locals.siteSettings.og_image_url = SITE_SETTING_DEFAULTS.og_image_url;
    if (!res.locals.siteSettings.hero_title) res.locals.siteSettings.hero_title = SITE_SETTING_DEFAULTS.hero_title;
    if (!res.locals.siteSettings.hero_subtitle) res.locals.siteSettings.hero_subtitle = SITE_SETTING_DEFAULTS.hero_subtitle;
  } catch (err) {
    res.locals.shopPhone = process.env.SHOP_PHONE || '+8801XXXXXXXXX';
    res.locals.siteSettings = { ...SITE_SETTING_DEFAULTS };
  }

  next();
});

// ---------- CSRF protection (session token; shob POST form-e hidden _csrf field lage) ----------
app.use(csrfProtection);

// ---------- Routes ----------
app.use('/', shopRoutes);
app.use('/', authRoutes);
app.use('/', chatRoutes);
app.use('/admin', adminRoutes);

// ---------- 404 Handler ----------
app.use((req, res) => {
  res.status(404).render('404', { siteName: 'Goince', pageTitle: 'Page Not Found - Goince' });
});

// ---------- GLOBAL ERROR HANDLER ----------
// Kono route e error hole (jemon Database e kono column na thakle) ei jaygay
// dhora porbe, server crash korbe na — shudhu ei error page ta dekhabe.
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  const detail = err.sqlMessage ? `<p><strong>Database error:</strong> ${err.sqlMessage}</p>
    <p>Shombhoboto <code>sql/update.sql</code> file ta shesh bar shothik vabe run kora hoyni. Ei command ta try koro:<br><code>mysql -u root -p -f goince_db < sql/update.sql</code></p>` : '';
  res.status(500).send(`
    <div style="font-family:sans-serif; max-width:600px; margin:60px auto; padding:20px;">
      <h1>😕 Kichu ekta shomossha hoyeche</h1>
      <p>Server crash kore ni, shudhu ei ekta request e error hoyeche.</p>
      ${detail}
      <a href="/" style="color:#f0a500; font-weight:bold;">&larr; Homepage e ferot jao</a>
    </div>
  `);
});

// ---------- Start Server ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Goince server running at http://localhost:${PORT}`);
});
