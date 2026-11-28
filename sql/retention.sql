-- Retention batch (feat/retention, PR #88) — F1–F9.
--
-- The server creates all of these itself on boot (server.js,
-- "Retention batch tables"), so the live deploy needs no manual step.
-- This file is the documented source of the schema — run it by hand
-- only if the boot creation was skipped:
--   mysql -u root -p goince_db < sql/retention.sql
--
-- loyalty_points  — F4 ledger: one row per earn/redeem. Balance is
--   SUM(points) per user; points are only ever earned on a real
--   DELIVERED order, never fabricated.
-- referrals       — F5: referrer -> referred friend, pending until the
--   friend's first order is delivered, then 'rewarded'.
-- abandoned_carts — F1: carts that reached /checkout but were never
--   ordered. emailed_at enforces one recovery email per cart.
-- newsletter_subscribers — F7: footer signup + opted-in customers.
-- email_campaigns — F7: sent campaigns (subject, audience, count).
-- price_drop_alerts — F6: one row per (user, product, old->new price)
--   so a price-drop email is sent once per drop event, never twice.
-- winback_offers  — F9: win-back coupon issued per customer.
-- customer_push_subscriptions — F8: customer browsers that opted in
--   to web push (separate from the admin push_subscriptions table).
-- users.referral_code — F5: each customer's stable referral code.
-- stock_alerts.email — F2: Notify Me subscribers can leave an email
--   (phone-only rows stay as before).
-- orders.points_earned / points_redeemed / points_discount — F4:
--   points earned/redeemed on an order, for the admin + customer view.

CREATE TABLE IF NOT EXISTS loyalty_points (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  order_id INT DEFAULT NULL,
  points INT NOT NULL,
  type VARCHAR(20) NOT NULL DEFAULT 'earn',
  note VARCHAR(255) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL,
  INDEX idx_lp_user (user_id),
  INDEX idx_lp_order_type (order_id, type)
);

CREATE TABLE IF NOT EXISTS referrals (
  id INT AUTO_INCREMENT PRIMARY KEY,
  referrer_user_id INT NOT NULL,
  referred_user_id INT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  reward_points INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  rewarded_at DATETIME DEFAULT NULL,
  FOREIGN KEY (referrer_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (referred_user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uq_referral_friend (referred_user_id),
  INDEX idx_ref_referrer (referrer_user_id)
);

CREATE TABLE IF NOT EXISTS abandoned_carts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_key VARCHAR(100) NOT NULL,
  user_id INT DEFAULT NULL,
  email VARCHAR(255) DEFAULT NULL,
  cart_json TEXT NOT NULL,
  restore_token VARCHAR(64) NOT NULL UNIQUE,
  emailed_at DATETIME DEFAULT NULL,
  recovered_at DATETIME DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_ac_session (session_key),
  INDEX idx_ac_email (email)
);

CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  user_id INT DEFAULT NULL,
  source VARCHAR(50) DEFAULT 'footer',
  subscribed TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS email_campaigns (
  id INT AUTO_INCREMENT PRIMARY KEY,
  subject VARCHAR(255) NOT NULL,
  body_text TEXT NOT NULL,
  audience VARCHAR(20) NOT NULL DEFAULT 'subscribers',
  recipient_count INT NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'sending',
  sent_at DATETIME DEFAULT NULL,
  created_by VARCHAR(100) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS price_drop_alerts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  product_id INT NOT NULL,
  price_from DECIMAL(10,2) NOT NULL,
  price_to DECIMAL(10,2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  UNIQUE KEY uq_price_drop (user_id, product_id, price_from, price_to)
);

CREATE TABLE IF NOT EXISTS winback_offers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  coupon_code VARCHAR(50) NOT NULL,
  issued_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uq_winback_user (user_id)
);

CREATE TABLE IF NOT EXISTS customer_push_subscriptions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  endpoint VARCHAR(500) NOT NULL UNIQUE,
  p256dh VARCHAR(255) NOT NULL,
  auth VARCHAR(255) NOT NULL,
  user_id INT DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);
