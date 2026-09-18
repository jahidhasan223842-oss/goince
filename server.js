// Goince E-commerce - Main Server File
require('dotenv').config();
const express = require('express');
require('express-async-errors'); // Eta thakle kono route e async error hole
                                   // pura server crash na hoye, shundor error page dekhabe
const session = require('express-session');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const path = require('path');

const shopRoutes = require('./routes/shop');
const adminRoutes = require('./routes/admin');
const authRoutes = require('./routes/auth');
const chatRoutes = require('./routes/chat');

const app = express();

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

// ---------- Middleware ----------
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(cookieParser());

app.use(session({
  secret: process.env.SESSION_SECRET || 'change_this_secret',
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 1000 * 60 * 60 * 24 } // 1 din
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
  res.locals.cartCount = (req.session.cart || []).reduce((sum, item) => sum + item.quantity, 0);

  // Shop phone number Database theke real-time e neya, jate Admin Panel theke
  // change korle shathe shathe (server restart chara-i) effect hoy
  try {
    const db = require('./config/db');
    const [[row]] = await db.query("SELECT setting_value FROM settings WHERE setting_key = 'shop_phone'");
    res.locals.shopPhone = row ? row.setting_value : (process.env.SHOP_PHONE || '+8801XXXXXXXXX');
  } catch (err) {
    res.locals.shopPhone = process.env.SHOP_PHONE || '+8801XXXXXXXXX';
  }

  next();
});

// ---------- Routes ----------
app.use('/', shopRoutes);
app.use('/', authRoutes);
app.use('/', chatRoutes);
app.use('/admin', adminRoutes);

// ---------- 404 Handler ----------
app.use((req, res) => {
  res.status(404).send('<h1>404 - Page Not Found</h1><a href="/">Go Home</a>');
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
app.listen(PORT, () => {
  console.log(`Goince server running at http://localhost:${PORT}`);
});
