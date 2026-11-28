-- Admin Ops batch (feat/admin-ops, batch 8) — schema reference.
-- The server auto-creates all of this on boot (server.js), so the
-- live deploy needs no manual step; this file documents the schema.
-- All statements are IF NOT EXISTS / guarded, so re-running is safe.

-- I1: persistent sessions (express-session MySQL store).
CREATE TABLE IF NOT EXISTS sessions (
  session_id VARCHAR(128) NOT NULL PRIMARY KEY,
  expires INT UNSIGNED NOT NULL,
  data TEXT,
  INDEX idx_sessions_expires (expires)
);

-- I7: admin audit log — who did what, when. Never stores passwords
-- or secrets (lib/admin-ops.js sanitizeAuditDetails strips them).
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  admin_id INT DEFAULT NULL,
  admin_email VARCHAR(255) DEFAULT NULL,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50) DEFAULT NULL,
  entity_id VARCHAR(100) DEFAULT NULL,
  details TEXT DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_admin (admin_email, created_at),
  INDEX idx_audit_action (action, created_at)
);

-- I5: coupon usage ledger — enforces max total uses and max uses
-- per customer (coupons table gains the limit columns below).
CREATE TABLE IF NOT EXISTS coupon_uses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  coupon_id INT NOT NULL,
  coupon_code VARCHAR(100) NOT NULL,
  user_id INT DEFAULT NULL,
  order_id INT DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_cu_coupon (coupon_id),
  INDEX idx_cu_coupon_user (coupon_id, user_id)
);
ALTER TABLE coupons ADD COLUMN max_total_uses INT DEFAULT NULL;
ALTER TABLE coupons ADD COLUMN max_uses_per_customer INT DEFAULT NULL;
ALTER TABLE coupons ADD COLUMN min_order_amount DECIMAL(10,2) DEFAULT NULL;

-- I8: weight-based delivery bands. zone_slug NULL = applies to every
-- zone; otherwise only that zone. When no band matches a cart's
-- weight, the normal zone charge (Inside Dhaka ৳60 / Outside ৳120)
-- applies unchanged.
CREATE TABLE IF NOT EXISTS weight_delivery_bands (
  id INT AUTO_INCREMENT PRIMARY KEY,
  zone_slug VARCHAR(100) DEFAULT NULL,
  max_weight_kg DECIMAL(8,2) NOT NULL,
  charge DECIMAL(10,2) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- I11: flash sales / timed offers. sale_price wins when set,
-- otherwise discount_percent off the product price. Expired offers
-- stop showing automatically (ends_at <= NOW() is filtered out).
CREATE TABLE IF NOT EXISTS flash_offers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  title VARCHAR(255) DEFAULT NULL,
  discount_percent DECIMAL(5,2) DEFAULT NULL,
  sale_price DECIMAL(10,2) DEFAULT NULL,
  starts_at DATETIME DEFAULT NULL,
  ends_at DATETIME DEFAULT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  INDEX idx_flash_product (product_id, is_active, ends_at)
);

-- I10: search terms log (top search terms) + visit log (visitors).
-- Both start counting when this batch deploys — analytics honestly
-- shows "counting from <date>" instead of inventing history.
CREATE TABLE IF NOT EXISTS search_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  term VARCHAR(100) NOT NULL,
  session_key VARCHAR(100) DEFAULT NULL,
  user_id INT DEFAULT NULL,
  results_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_search_term (term, created_at)
);
CREATE TABLE IF NOT EXISTS site_visits (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_key VARCHAR(100) NOT NULL,
  visit_date DATE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_visit_session_day (session_key, visit_date),
  INDEX idx_visit_date (visit_date)
);

-- I3: return / cancel requests — order_returns already exists; the
-- new columns record the request type and the admin's note.
ALTER TABLE order_returns ADD COLUMN request_type VARCHAR(20) NOT NULL DEFAULT 'return';
ALTER TABLE order_returns ADD COLUMN admin_note VARCHAR(500) DEFAULT NULL;

-- I9: live-chat unread counter for admins — incremented on every
-- customer message, cleared when an admin opens the conversation.
ALTER TABLE chat_conversations ADD COLUMN unread_admin INT NOT NULL DEFAULT 0;

-- I15: customer login lockout counters (admins are NOT locked by
-- this mechanism — customer login only).
ALTER TABLE users ADD COLUMN failed_login_attempts INT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN locked_until DATETIME DEFAULT NULL;
-- Settings keys (Admin > Settings, "Admin Ops" section):
--   login_lockout_max_attempts (default 5), login_lockout_minutes (default 15)
