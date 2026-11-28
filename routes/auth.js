// Customer Login/Signup ebong Order History er route
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const upload = require('../config/upload');
const { cropProfilePhoto, validateProfileDetails, validateEmailChange } = require('../lib/admin-profile');
const { customerDisplayName, formatMemberSince } = require('../lib/customer-profile');
const { isEmailConfigured } = require('../config/email');
const ret = require('../lib/retention');
const ops = require('../lib/admin-ops');
const fs = require('fs');
const path = require('path');

function requireCustomer(req, res, next) {
  if (req.session.userId) return next();
  res.redirect('/login');
}

// Simple email format check
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ---------- SIGNUP ----------
// F5 (feat/retention): ?ref=CODE link diye asle code-ta session-e
// rakha hoy — POST /signup-e referral row toiri hoy.
router.get('/signup', (req, res) => {
  const refCode = typeof req.query.ref === 'string' ? req.query.ref.trim() : '';
  if (refCode && ret.parseReferralCode(refCode)) req.session.refCode = refCode;
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
      return res.render('auth/signup', { error: 'Please fill in all fields (Name, Email, Password).', siteName: 'Goince' });
    }
    if (!isValidEmail(email)) {
      return res.render('auth/signup', { error: 'Please enter a valid email address (e.g. name@example.com).', siteName: 'Goince' });
    }
    if (password.length < 6) {
      return res.render('auth/signup', { error: 'Password must be at least 6 characters.', siteName: 'Goince' });
    }

    const [existing] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length > 0) {
      return res.render('auth/signup', { error: 'An account with this email already exists. Please login.', siteName: 'Goince' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    try {
      const [result] = await db.query(
        'INSERT INTO users (name, email, password, phone) VALUES (?, ?, ?, ?)',
        [name, email, hashedPassword, phone || null]
      );
      req.session.userId = result.insertId;
      req.session.userName = customerDisplayName({ name, email });
      req.session.userEmail = email;
      req.session.userPhotoUrl = null;
      // F5 (feat/retention): referral link diye signup hole referrer-er
      // pending referral row toiri hoy — reward tokhon-i, jokhon ei
      // customer-er prothom order Delivered hobe.
      try {
        const refCode = req.session.refCode;
        delete req.session.refCode;
        if (refCode) {
          const referrerId = ret.parseReferralCode(refCode);
          if (referrerId) {
            const settings = await ret.getRetentionSettings(db);
            if (ret.isOn(settings, 'referral_enabled')) {
              await ret.recordReferralSignup(db, referrerId, result.insertId);
            }
          }
        }
      } catch (e) { /* referral never blocks signup */ }
      res.redirect('/');
    } catch (dbErr) {
      // Race condition: 2 jon ekshathe same email diye signup korte gele eta dhorbe
      if (dbErr.code === 'ER_DUP_ENTRY') {
        return res.render('auth/signup', { error: 'An account with this email already exists. Please login.', siteName: 'Goince' });
      }
      throw dbErr;
    }
  } catch (err) {
    console.error('Signup error:', err);
    res.render('auth/signup', { error: 'Something went wrong, please try again.', siteName: 'Goince' });
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
      return res.render('auth/login', { error: 'Please enter both email and password.', siteName: 'Goince' });
    }

    const [rows] = await db.query('SELECT * FROM users WHERE email = ?', [email]);

    // Email na paoya gele o same generic message dekhai (security best practice —
    // "email exists but wrong password" alada bola thik na)
    if (rows.length === 0) {
      return res.render('auth/login', { error: 'Incorrect email or password.', siteName: 'Goince' });
    }

    const user = rows[0];
    // I15 (feat/admin-ops): customer login lockout — after N failed
    // attempts (Admin > Settings, default 5) the account locks for a
    // configurable time (default 15 minutes). Admins are NOT locked
    // by this mechanism (customer login only). The lockout columns
    // may not exist on an old DB yet — every write is guarded.
    let lockCfg = ops.ADMIN_OPS_DEFAULTS;
    try {
      const [srows] = await db.query(
        "SELECT setting_key, setting_value FROM settings WHERE setting_key IN ('login_lockout_max_attempts', 'login_lockout_minutes')");
      const settings = {};
      (srows || []).forEach((r) => { settings[r.setting_key] = r.setting_value; });
      lockCfg = settings;
    } catch (e) { /* defaults stand */ }
    const lockState = ops.isAccountLocked(user, new Date());
    if (lockState.locked) {
      return res.render('auth/login', { error: `Too many failed login attempts — your account is locked for ${lockState.minutesLeft} more minute(s). Please try again later.`, siteName: 'Goince' });
    }
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      try {
        const next = ops.nextFailedLoginState(user, lockCfg, new Date());
        await db.query('UPDATE users SET failed_login_attempts = ?, locked_until = ? WHERE id = ?',
          [next.attempts, next.lockedUntil, user.id]);
        if (next.lockedUntil) {
          const mins = ops.lockoutSettings(lockCfg).lockMinutes;
          return res.render('auth/login', { error: `Too many failed login attempts — your account is locked for ${mins} minutes. Please try again later.`, siteName: 'Goince' });
        }
      } catch (e) { /* lockout bookkeeping never blocks the login page */ }
      return res.render('auth/login', { error: 'Incorrect email or password.', siteName: 'Goince' });
    }
    // Successful login resets the failure counter + lock.
    try { await db.query('UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?', [user.id]); } catch (e) { /* ignore */ }

    // Admin je customer ke block kore rekheche, take login korte deya jabe na
    if (user.is_blocked) {
      return res.render('auth/login', { error: 'Your account has been blocked. Please contact the shop for details.', siteName: 'Goince' });
    }

    // Session fixation attack theke bachte, login er por notun session id generate kora
    req.session.regenerate((err) => {
      if (err) {
        console.error('Session regenerate error:', err);
        return res.render('auth/login', { error: 'Something went wrong, please try again.', siteName: 'Goince' });
      }
      req.session.userId = user.id;
      req.session.userName = customerDisplayName(user);
      req.session.userEmail = user.email;
      req.session.userPhotoUrl = user.photo_url || null;

      // "Remember Me" checked -> stay logged in for 30 days; otherwise the
      // session ends when the browser is closed (a normal session cookie)
      if (req.body.remember_me) {
        req.session.cookie.maxAge = 1000 * 60 * 60 * 24 * 30; // 30 days
      } else {
        req.session.cookie.expires = false; // session cookie — expires when the browser closes
      }

      res.redirect('/');
    });
  } catch (err) {
    console.error('Login error:', err);
    res.render('auth/login', { error: 'Something went wrong, please try again.', siteName: 'Goince' });
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
      return res.render('auth/forgot-password', { error: 'Please enter your email.', message: null, siteName: 'Goince' });
    }

    const [rows] = await db.query('SELECT * FROM users WHERE email = ?', [email]);

    // User na paoya gelew "message" e shob shomoy same shafollo dekhabo
    // (security best practice — kono email account e ache ki nei eta bujhte deya thik na)
    const genericMessage = 'If an account exists with this email, a password reset link has been sent. Please check your email.';

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
          message: `Email could not be sent (email is not set up). For testing, use this link: ${resetLink}`,
          siteName: 'Goince'
        });
      }
    }

    res.render('auth/forgot-password', { error: null, message: genericMessage, siteName: 'Goince' });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.render('auth/forgot-password', { error: 'Something went wrong.', message: null, siteName: 'Goince' });
  }
});

router.get('/reset-password/:token', async (req, res) => {
  const [rows] = await db.query(
    'SELECT * FROM users WHERE reset_token = ? AND reset_expires > NOW()',
    [req.params.token]
  );
  if (rows.length === 0) {
    return res.render('auth/reset-password', { error: 'This link has expired or is invalid. Please try again.', token: null, siteName: 'Goince' });
  }
  res.render('auth/reset-password', { error: null, token: req.params.token, siteName: 'Goince' });
});

router.post('/reset-password/:token', async (req, res) => {
  try {
    const { password, confirm_password } = req.body;

    if (!password || password.length < 6) {
      return res.render('auth/reset-password', { error: 'Password must be at least 6 characters.', token: req.params.token, siteName: 'Goince' });
    }
    if (password !== confirm_password) {
      return res.render('auth/reset-password', { error: 'The two passwords do not match.', token: req.params.token, siteName: 'Goince' });
    }

    const [rows] = await db.query(
      'SELECT * FROM users WHERE reset_token = ? AND reset_expires > NOW()',
      [req.params.token]
    );
    if (rows.length === 0) {
      return res.render('auth/reset-password', { error: 'This link has expired. Please try again from Forgot Password.', token: null, siteName: 'Goince' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await db.query(
      'UPDATE users SET password = ?, reset_token = NULL, reset_expires = NULL WHERE id = ?',
      [hashedPassword, rows[0].id]
    );

    res.render('auth/login', { error: null, message: 'Password changed successfully! You can now login.', siteName: 'Goince' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.render('auth/reset-password', { error: 'Something went wrong.', token: req.params.token, siteName: 'Goince' });
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
    // I3 (feat/admin-ops): this order's return / cancel requests, so
    // the customer sees their request status (Pending/Approved/...).
    let returns = [];
    try { [returns] = await db.query('SELECT * FROM order_returns WHERE order_id = ? ORDER BY created_at DESC, id DESC', [req.params.id]); } catch (e) { returns = []; }
    const returnMsg = req.query.return === 'saved' ? 'Your request has been sent — the shop will review it.' :
      req.query.return === 'exists' ? 'You already have a pending request for this order.' : null;
    const returnErr = req.query.return === 'reason' ? 'Please write a reason for your request.' :
      req.query.return === 'closed' ? 'This order can no longer be returned or cancelled.' : null;
    res.render('auth/order-detail', { order, items, returns, returnMsg, returnErr, siteName: 'Goince' });
  } catch (err) {
    console.error('Order detail error:', err);
    res.status(500).send('Order details load korte problem hoyeche.');
  }
});

// ---------- REQUEST RETURN / CANCEL (I3, feat/admin-ops) ----------
// A logged-in customer requests a return or a cancellation from
// their own order, with a reason. The request lands in
// order_returns (status Pending) and the admin approves/rejects it
// from Admin > Orders > order details. Delivered orders can only
// be returned (the 24-hour return policy wording is unchanged —
// see /return-policy); Cancelled/Delivered-past-window orders are
// refused here with a plain message. One pending request per order.
router.post('/account/orders/:id/return', requireCustomer, async (req, res) => {
  const dest = '/account/orders/' + req.params.id;
  try {
    const [[order]] = await db.query(
      'SELECT * FROM orders WHERE id = ? AND user_id = ?',
      [req.params.id, req.session.userId]
    );
    if (!order) return res.redirect('/account');
    const type = req.body.request_type === 'cancel' ? 'cancel' : 'return';
    const reason = (req.body.reason || '').trim();
    if (!reason) return res.redirect(dest + '?return=reason');
    if (order.status === 'Cancelled' || order.status === 'Delivered' && type === 'cancel') {
      return res.redirect(dest + '?return=closed');
    }
    const [[existing]] = await db.query(
      "SELECT id FROM order_returns WHERE order_id = ? AND status = 'Pending' LIMIT 1",
      [req.params.id]
    );
    if (existing) return res.redirect(dest + '?return=exists');
    await db.query(
      'INSERT INTO order_returns (order_id, reason, status, created_by, request_type) VALUES (?, ?, ?, ?, ?)',
      [req.params.id, reason, 'Pending', req.session.userEmail || req.session.userName || null, type]
    );
    res.redirect(dest + '?return=saved');
  } catch (err) {
    console.error('Return request error:', err);
    res.redirect(dest);
  }
});

// ==================== MY PROFILE (the customer hub) ====================
// One page for everything a logged-in customer needs: photo, details,
// email change, password change, order stats + quick links (orders,
// wishlist, track order, logout). All saves use the redirect-back
// pattern (like the admin profile), so a refresh never re-submits.
// The email is read-only in the details form — it changes only in the
// Change Email section below, with the current password (admin PR #61
// pattern). The name is users.name (NOT NULL, required at signup); a
// blank name on save keeps the stored name — the email-local-part
// fallback is a display rule only, never baked into the DB (the admin
// PR #62 lesson).

router.get('/account/profile', requireCustomer, async (req, res) => {
  const [[user]] = await db.query('SELECT * FROM users WHERE id = ?', [req.session.userId]);
  if (!user) return res.redirect('/login');
  // Order stats — total spent uses the same rule as the admin customer
  // detail page: cancelled orders contribute ৳0.
  let ordersCount = 0;
  let totalSpent = 0;
  try {
    const [[stats]] = await db.query(
      `SELECT COUNT(*) AS ordersCount,
              COALESCE(SUM(CASE WHEN status != 'Cancelled' THEN total_amount ELSE 0 END), 0) AS totalSpent
       FROM orders WHERE user_id = ?`,
      [req.session.userId]
    );
    ordersCount = stats ? Number(stats.ordersCount) || 0 : 0;
    totalSpent = stats ? Number(stats.totalSpent) || 0 : 0;
  } catch (e) { /* stats stay 0 — the profile still loads */ }
  const photoUrl = (user.photo_url && String(user.photo_url).startsWith('/uploads/'))
    ? String(user.photo_url) : null;
  // F4/F5/F9/F7 (feat/retention): points balance, referral code/link,
  // active win-back coupon, newsletter status — shob guarded, profile
  // kokhono egulor jonno vangbe na.
  let pointsBalance = 0;
  let referralCode = null;
  let referralLink = null;
  let winbackCoupon = null;
  let newsletterSubscribed = false;
  let loyaltySettings = ret.RETENTION_DEFAULTS;
  try {
    loyaltySettings = await ret.getRetentionSettings(db);
    pointsBalance = await ret.getPointsBalance(db, req.session.userId);
    referralCode = await ret.getOrCreateReferralCode(db, req.session.userId);
    referralLink = ret.referralLink(`${req.protocol}://${req.get('host')}`, req.session.userId);
    winbackCoupon = await ret.getActiveWinbackCoupon(db, req.session.userId);
    newsletterSubscribed = await ret.isNewsletterSubscribed(db, user.email);
  } catch (e) { /* retention sections stay empty — profile still loads */ }
  const pointsValue = ret.redeemValueForPoints(pointsBalance, loyaltySettings.loyalty_redeem_points, loyaltySettings.loyalty_redeem_taka);
  res.render('auth/profile', {
    user,
    displayName: customerDisplayName(user),
    // Raw stored name (fix/whmcs-one-line-topbar, admin side): the form
    // pre-fills with what is actually stored — never the fallback.
    rawName: user.name || '',
    photoUrl,
    memberSince: formatMemberSince(user.created_at),
    ordersCount,
    totalSpent,
    pointsBalance,
    pointsValue,
    loyaltyEnabled: ret.isOn(loyaltySettings, 'loyalty_enabled'),
    loyaltyEarnPer: loyaltySettings.loyalty_earn_per,
    loyaltyRedeemPoints: loyaltySettings.loyalty_redeem_points,
    loyaltyRedeemTaka: loyaltySettings.loyalty_redeem_taka,
    referralEnabled: ret.isOn(loyaltySettings, 'referral_enabled'),
    referralRewardPoints: loyaltySettings.referral_reward_points,
    referralCode,
    referralLink,
    winbackCoupon,
    newsletterSubscribed,
    emailConfigured: isEmailConfigured(),
    profileOk: req.query.saved === 'details' || req.query.saved === 'photo'
      || req.query.saved === 'removed' || req.query.saved === 'email'
      || req.query.saved === 'account',
    profileMessage: req.query.saved === 'details' ? 'Profile details saved.' :
      req.query.saved === 'account' ? 'Account created — your details are saved for next time.' :
      req.query.saved === 'photo' ? 'Profile photo saved.' :
      req.query.saved === 'removed' ? 'Profile photo removed.' :
      req.query.saved === 'email' ? 'Email changed successfully — use the new address to sign in next time.' :
      req.query.err === 'name' ? 'Display name must be 1–60 characters.' :
      req.query.err === 'phone' ? 'Enter a valid Bangladeshi mobile number (01XXXXXXXXX) or leave it blank.' :
      req.query.err === 'email' ? 'Enter a valid email address.' :
      req.query.err === 'emailmatch' ? 'The two new email addresses do not match.' :
      req.query.err === 'emailsame' ? 'The new email is the same as your current one.' :
      req.query.err === 'emailtaken' ? 'Another account already uses that email address.' :
      req.query.err === 'emailpw' ? 'Current password is wrong — email was not changed.' :
      req.query.err === 'photo' ? 'Choose a photo file (jpg, png or webp, up to 5 MB).' :
      req.query.err === 'crop' ? 'The photo could not be cropped — try another photo.' :
      req.query.err === 'noaccount' ? 'No account found — please sign in again.' : null,
    pwOk: req.query.pw === 'ok',
    pwMessage: req.query.pw === 'ok' ? 'Password changed successfully!' :
      req.query.pw === 'wrong' ? 'Current password is wrong — password was not changed.' :
      req.query.pw === 'mismatch' ? 'New passwords do not match — password was not changed.' :
      req.query.pw === 'short' ? 'New password must be at least 6 characters.' :
      req.query.pw === 'noaccount' ? 'No account found — please sign in again.' : null,
    siteName: 'Goince'
  });
});

// ---------- PROFILE DETAILS ----------
// Name 1–60 chars (blank keeps the stored name), phone optional but
// validated with the shared BD rule (lib/bd-phone.js, same as checkout
// and the admin profile), address kept as-is. The email is NOT updated
// here — it is read-only in this section.
router.post('/account/profile', requireCustomer, async (req, res) => {
  try {
    const result = validateProfileDetails({ displayName: req.body.name, phone: req.body.phone });
    if (!result.ok) return res.redirect('/account/profile?err=' + result.errors[0]);
    const [[user]] = await db.query('SELECT * FROM users WHERE id = ?', [req.session.userId]);
    if (!user) return res.redirect('/account/profile?err=noaccount');
    // Blank name = no change (the stored name stays; the display falls
    // back to the email local part only when the stored name is empty).
    const name = result.displayName === null ? user.name : result.displayName;
    const address = (req.body.address || '').trim() || null;
    await db.query(
      'UPDATE users SET name=?, phone=?, address=? WHERE id=?',
      [name, result.phone, address, req.session.userId]
    );
    req.session.userName = customerDisplayName({ name, email: user.email });
    return res.redirect('/account/profile?saved=details');
  } catch (err) {
    console.error('Profile update error:', err);
    res.status(500).send('Profile update korte problem hoyeche.');
  }
});

// ---------- CHANGE EMAIL ----------
// New email + confirm + current password (required — proving the
// customer owns the account). Format/match/different checks live in
// lib/admin-profile.js; the current-password check and the duplicate
// check need the DB, so they live here. On success the DB row is
// updated; the session name is unchanged (the header shows the name,
// not the email).
router.post('/account/profile/email', requireCustomer, async (req, res) => {
  try {
    const [[user]] = await db.query('SELECT * FROM users WHERE id = ?', [req.session.userId]);
    if (!user) return res.redirect('/account/profile?err=noaccount');
    const result = validateEmailChange({
      currentEmail: user.email,
      newEmail: req.body.new_email,
      confirmEmail: req.body.confirm_new_email,
    });
    if (!result.ok) return res.redirect('/account/profile?err=' + result.errors[0]);
    const ok = await bcrypt.compare(req.body.current_password || '', user.password);
    if (!ok) return res.redirect('/account/profile?err=emailpw');
    const [taken] = await db.query('SELECT id FROM users WHERE email = ? AND id != ?', [result.email, req.session.userId]);
    if (taken.length > 0) return res.redirect('/account/profile?err=emailtaken');
    await db.query('UPDATE users SET email = ? WHERE id = ?', [result.email, req.session.userId]);
    // Header-er profile dropdown-e email dekhay — session-eo bodle dewa
    // holo (fix/header-account-menu), na hole purono email-i dekhate
    // thakto jotokkhon na abar login kore.
    req.session.userEmail = result.email;
    return res.redirect('/account/profile?saved=email');
  } catch (err) {
    console.error('Customer email change error:', err);
    res.status(500).send('Email change korte problem hoyeche.');
  }
});

// ---------- PROFILE PHOTO ----------
// One image (jpg/png/webp, up to 5 MB — the shared upload filter),
// cropped to a 256x256 WebP square with the browser-sent crop
// fractions (lib/admin-profile.js clamps them to the image bounds; no
// crop sent = centred square). The old photo file is deleted on
// replace. The form action MUST carry ?_csrf= (see the photo form in
// views/auth/profile.ejs) — the global CSRF middleware runs before
// multer parses the multipart body, so a hidden _csrf body field is
// invisible at check time (the admin PR #60 lesson: the plain-action
// photo form 403'd every submit).
router.post('/account/profile/photo', requireCustomer, (req, res) => {
  upload.single('photo')(req, res, async (err) => {
    if (err || !req.file) return res.redirect('/account/profile?err=photo');
    try {
      const [[user]] = await db.query('SELECT * FROM users WHERE id = ?', [req.session.userId]);
      if (!user) { try { fs.unlinkSync(req.file.path); } catch (e) { /* ignore */ } return res.redirect('/account/profile?err=noaccount'); }
      const data = await fs.promises.readFile(req.file.path);
      const cropped = await cropProfilePhoto(data, { x: req.body.crop_x, y: req.body.crop_y, size: req.body.crop_size });
      const filename = 'customer-photo-' + user.id + '-' + Date.now() + '.webp';
      await fs.promises.writeFile(path.join(__dirname, '..', 'public', 'uploads', filename), cropped.buffer);
      try { fs.unlinkSync(req.file.path); } catch (e) { /* ignore */ }
      const oldUrl = user.photo_url;
      await db.query('UPDATE users SET photo_url = ? WHERE id = ?', ['/uploads/' + filename, user.id]);
      req.session.userPhotoUrl = '/uploads/' + filename;
      if (oldUrl && String(oldUrl).startsWith('/uploads/customer-photo-')) {
        try { fs.unlinkSync(path.join(__dirname, '..', 'public', oldUrl)); } catch (e) { /* already gone */ }
      }
      return res.redirect('/account/profile?saved=photo');
    } catch (e) {
      try { if (req.file && req.file.path) fs.unlinkSync(req.file.path); } catch (e2) { /* ignore */ }
      return res.redirect('/account/profile?err=crop');
    }
  });
});

// Remove the profile photo — back to the initial-letter avatar.
router.post('/account/profile/photo/remove', requireCustomer, async (req, res) => {
  const [[user]] = await db.query('SELECT * FROM users WHERE id = ?', [req.session.userId]);
  if (!user) return res.redirect('/account/profile?err=noaccount');
  const oldUrl = user.photo_url;
  await db.query('UPDATE users SET photo_url = NULL WHERE id = ?', [req.session.userId]);
  req.session.userPhotoUrl = null;
  if (oldUrl && String(oldUrl).startsWith('/uploads/customer-photo-')) {
    try { fs.unlinkSync(path.join(__dirname, '..', 'public', oldUrl)); } catch (e) { /* already gone */ }
  }
  return res.redirect('/account/profile?saved=removed');
});

// ---------- CHANGE PASSWORD (login thakle, purono password diye) ----------
// Posts back to the profile hub with ?pw=… (redirect, not render) so a
// refresh never re-submits the password form.
router.post('/account/change-password', requireCustomer, async (req, res) => {
  try {
    const { current_password, new_password, confirm_new_password } = req.body;
    const [[user]] = await db.query('SELECT * FROM users WHERE id = ?', [req.session.userId]);
    if (!user) return res.redirect('/account/profile?pw=noaccount');

    const match = await bcrypt.compare(current_password || '', user.password);
    if (!match) {
      return res.redirect('/account/profile?pw=wrong');
    }
    if (!new_password || new_password.length < 6) {
      return res.redirect('/account/profile?pw=short');
    }
    if (new_password !== confirm_new_password) {
      return res.redirect('/account/profile?pw=mismatch');
    }

    const hashedPassword = await bcrypt.hash(new_password, 10);
    await db.query('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, req.session.userId]);

    return res.redirect('/account/profile?pw=ok');
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).send('Password change korte problem hoyeche.');
  }
});

module.exports = router;
