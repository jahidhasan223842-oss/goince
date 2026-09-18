// Customer Login/Signup ebong Order History er route
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../config/db');

function requireCustomer(req, res, next) {
  if (req.session.userId) return next();
  res.redirect('/login');
}

// Simple email format check
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ---------- SIGNUP ----------
router.get('/signup', (req, res) => {
  res.render('auth/signup', { error: null, siteName: 'Goince' });
});

router.post('/signup', async (req, res) => {
  try {
    let { name, email, password, phone } = req.body;

    // Trim korlei onek shadaron vul (extra space) thik hoye jay
    name = (name || '').trim();
    email = (email || '').trim().toLowerCase();
    phone = (phone || '').trim();

    // ---- Server-side validation ----
    if (!name || !email || !password) {
      return res.render('auth/signup', { error: 'Shob field pouron koro (Name, Email, Password).', siteName: 'Goince' });
    }
    if (!isValidEmail(email)) {
      return res.render('auth/signup', { error: 'Shothik email address diyo (jemon: name@example.com).', siteName: 'Goince' });
    }
    if (password.length < 6) {
      return res.render('auth/signup', { error: 'Password kompokkhe 6 character howa lagbe.', siteName: 'Goince' });
    }

    const [existing] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length > 0) {
      return res.render('auth/signup', { error: 'Ei email diye already ekta account ache. Login koro.', siteName: 'Goince' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    try {
      const [result] = await db.query(
        'INSERT INTO users (name, email, password, phone) VALUES (?, ?, ?, ?)',
        [name, email, hashedPassword, phone || null]
      );
      req.session.userId = result.insertId;
      req.session.userName = name;
      res.redirect('/');
    } catch (dbErr) {
      // Race condition: 2 jon ekshathe same email diye signup korte gele eta dhorbe
      if (dbErr.code === 'ER_DUP_ENTRY') {
        return res.render('auth/signup', { error: 'Ei email diye already ekta account ache. Login koro.', siteName: 'Goince' });
      }
      throw dbErr;
    }
  } catch (err) {
    console.error('Signup error:', err);
    res.render('auth/signup', { error: 'Kichu ekta shomossha hoyeche, abar try koro.', siteName: 'Goince' });
  }
});

// ---------- LOGIN ----------
router.get('/login', (req, res) => {
  res.render('auth/login', { error: null, siteName: 'Goince' });
});

router.post('/login', async (req, res) => {
  try {
    let { email, password } = req.body;
    email = (email || '').trim().toLowerCase();

    if (!email || !password) {
      return res.render('auth/login', { error: 'Email ebong password ditei hobe.', siteName: 'Goince' });
    }

    const [rows] = await db.query('SELECT * FROM users WHERE email = ?', [email]);

    // Email na paoya gele o same generic message dekhai (security best practice —
    // "email exists but wrong password" alada bola thik na)
    if (rows.length === 0) {
      return res.render('auth/login', { error: 'Email ba password vul hoyeche.', siteName: 'Goince' });
    }

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.render('auth/login', { error: 'Email ba password vul hoyeche.', siteName: 'Goince' });
    }

    // Admin je customer ke block kore rekheche, take login korte deya jabe na
    if (user.is_blocked) {
      return res.render('auth/login', { error: 'Apnar account block kora hoyeche. Bistarito jante shop er sathe jogajog korun.', siteName: 'Goince' });
    }

    // Session fixation attack theke bachte, login er por notun session id generate kora
    req.session.regenerate((err) => {
      if (err) {
        console.error('Session regenerate error:', err);
        return res.render('auth/login', { error: 'Kichu ekta shomossha hoyeche, abar try koro.', siteName: 'Goince' });
      }
      req.session.userId = user.id;
      req.session.userName = user.name;
      res.redirect('/');
    });
  } catch (err) {
    console.error('Login error:', err);
    res.render('auth/login', { error: 'Kichu ekta shomossha hoyeche, abar try koro.', siteName: 'Goince' });
  }
});

// ---------- LOGOUT ----------
router.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) console.error('Logout error:', err);
    res.redirect('/');
  });
});

// ==================== FORGOT / RESET PASSWORD ====================

router.get('/forgot-password', (req, res) => {
  res.render('auth/forgot-password', { error: null, message: null, siteName: 'Goince' });
});

router.post('/forgot-password', async (req, res) => {
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    if (!email) {
      return res.render('auth/forgot-password', { error: 'Email ditei hobe.', message: null, siteName: 'Goince' });
    }

    const [rows] = await db.query('SELECT * FROM users WHERE email = ?', [email]);

    // User na paoya gelew "message" e shob shomoy same shafollo dekhabo
    // (security best practice — kono email account e ache ki nei eta bujhte deya thik na)
    const genericMessage = 'Ei email diye ekta account thakle, password reset korar link pathano hoyeche. Email check koro.';

    if (rows.length > 0) {
      const user = rows[0];
      const token = require('crypto').randomBytes(32).toString('hex');
      const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 ghonta valid

      await db.query('UPDATE users SET reset_token = ?, reset_expires = ? WHERE id = ?', [token, expires, user.id]);

      const resetLink = `${req.protocol}://${req.get('host')}/reset-password/${token}`;

      // Email pathanor chesta kora, na hole (setup na thakle) screen e link dekhano
      // jate local testing e problem na hoy
      const { sendPasswordResetEmail } = require('../config/email');
      const sent = await sendPasswordResetEmail(user.email, user.name, resetLink);

      if (!sent) {
        // Email config na thakle, ei link ta screen e direct dekhiye dilam
        // (Production e email obosshoi setup kora uchit)
        return res.render('auth/forgot-password', {
          error: null,
          message: `Email pathano jayni (email setup kora nei). Test korar jonno link: ${resetLink}`,
          siteName: 'Goince'
        });
      }
    }

    res.render('auth/forgot-password', { error: null, message: genericMessage, siteName: 'Goince' });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.render('auth/forgot-password', { error: 'Kichu ekta shomossha hoyeche.', message: null, siteName: 'Goince' });
  }
});

router.get('/reset-password/:token', async (req, res) => {
  const [rows] = await db.query(
    'SELECT * FROM users WHERE reset_token = ? AND reset_expires > NOW()',
    [req.params.token]
  );
  if (rows.length === 0) {
    return res.render('auth/reset-password', { error: 'Link ta expire hoye geche ba shothik na. Abar try koro.', token: null, siteName: 'Goince' });
  }
  res.render('auth/reset-password', { error: null, token: req.params.token, siteName: 'Goince' });
});

router.post('/reset-password/:token', async (req, res) => {
  try {
    const { password, confirm_password } = req.body;

    if (!password || password.length < 6) {
      return res.render('auth/reset-password', { error: 'Password kompokkhe 6 character howa lagbe.', token: req.params.token, siteName: 'Goince' });
    }
    if (password !== confirm_password) {
      return res.render('auth/reset-password', { error: 'Duto password mile ni.', token: req.params.token, siteName: 'Goince' });
    }

    const [rows] = await db.query(
      'SELECT * FROM users WHERE reset_token = ? AND reset_expires > NOW()',
      [req.params.token]
    );
    if (rows.length === 0) {
      return res.render('auth/reset-password', { error: 'Link ta expire hoye geche. Abar Forgot Password theke try koro.', token: null, siteName: 'Goince' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await db.query(
      'UPDATE users SET password = ?, reset_token = NULL, reset_expires = NULL WHERE id = ?',
      [hashedPassword, rows[0].id]
    );

    res.render('auth/login', { error: null, message: 'Password shofolvabe change hoyeche! Ekhon login koro.', siteName: 'Goince' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.render('auth/reset-password', { error: 'Kichu ekta shomossha hoyeche.', token: req.params.token, siteName: 'Goince' });
  }
});

// ---------- MY ACCOUNT / ORDER HISTORY ----------
router.get('/account', requireCustomer, async (req, res) => {
  try {
    const [orders] = await db.query(
      'SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC',
      [req.session.userId]
    );
    res.render('auth/account', { orders, siteName: 'Goince' });
  } catch (err) {
    console.error('Account load error:', err);
    res.status(500).send('Account load korte problem hoyeche.');
  }
});

// ---------- SINGLE ORDER DETAILS ----------
router.get('/account/orders/:id', requireCustomer, async (req, res) => {
  try {
    const [[order]] = await db.query(
      'SELECT * FROM orders WHERE id = ? AND user_id = ?',
      [req.params.id, req.session.userId]
    );
    if (!order) return res.redirect('/account');
    const [items] = await db.query('SELECT * FROM order_items WHERE order_id = ?', [req.params.id]);
    res.render('auth/order-detail', { order, items, siteName: 'Goince' });
  } catch (err) {
    console.error('Order detail error:', err);
    res.status(500).send('Order details load korte problem hoyeche.');
  }
});

// ==================== PROFILE / ADDRESS MANAGEMENT ====================

router.get('/account/profile', requireCustomer, async (req, res) => {
  const [[user]] = await db.query('SELECT * FROM users WHERE id = ?', [req.session.userId]);
  res.render('auth/profile', { user, error: null, message: null, siteName: 'Goince' });
});

router.post('/account/profile', requireCustomer, async (req, res) => {
  try {
    let { name, email, phone, address } = req.body;
    name = (name || '').trim();
    email = (email || '').trim().toLowerCase();
    phone = (phone || '').trim();

    const [[user]] = await db.query('SELECT * FROM users WHERE id = ?', [req.session.userId]);

    if (!name || !email) {
      return res.render('auth/profile', { user, error: 'Name ebong Email obosshoi thakte hobe.', message: null, siteName: 'Goince' });
    }
    if (!isValidEmail(email)) {
      return res.render('auth/profile', { user, error: 'Shothik email address diyo.', message: null, siteName: 'Goince' });
    }

    const [existing] = await db.query('SELECT id FROM users WHERE email = ? AND id != ?', [email, req.session.userId]);
    if (existing.length > 0) {
      return res.render('auth/profile', { user, error: 'Ei email diye onno ekta account already ache.', message: null, siteName: 'Goince' });
    }

    await db.query(
      'UPDATE users SET name=?, email=?, phone=?, address=? WHERE id=?',
      [name, email, phone || null, address || null, req.session.userId]
    );
    req.session.userName = name;

    const [[updatedUser]] = await db.query('SELECT * FROM users WHERE id = ?', [req.session.userId]);
    res.render('auth/profile', { user: updatedUser, error: null, message: 'Profile shofolvabe update hoyeche!', siteName: 'Goince' });
  } catch (err) {
    console.error('Profile update error:', err);
    res.status(500).send('Profile update korte problem hoyeche.');
  }
});

// ---------- CHANGE PASSWORD (login thakle, purono password diye) ----------
router.post('/account/change-password', requireCustomer, async (req, res) => {
  try {
    const { current_password, new_password, confirm_new_password } = req.body;
    const [[user]] = await db.query('SELECT * FROM users WHERE id = ?', [req.session.userId]);

    const match = await bcrypt.compare(current_password || '', user.password);
    if (!match) {
      return res.render('auth/profile', { user, error: 'Ekhonkar password vul hoyeche.', message: null, siteName: 'Goince' });
    }
    if (!new_password || new_password.length < 6) {
      return res.render('auth/profile', { user, error: 'Notun password kompokkhe 6 character howa lagbe.', message: null, siteName: 'Goince' });
    }
    if (new_password !== confirm_new_password) {
      return res.render('auth/profile', { user, error: 'Notun password mile ni.', message: null, siteName: 'Goince' });
    }

    const hashedPassword = await bcrypt.hash(new_password, 10);
    await db.query('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, req.session.userId]);

    res.render('auth/profile', { user, error: null, message: 'Password shofolvabe change hoyeche!', siteName: 'Goince' });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).send('Password change korte problem hoyeche.');
  }
});

module.exports = router;
