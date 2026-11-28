-- Payments & messaging batch (feat/payments-messaging, batch 9).
-- Documented source of the tables / columns the server also creates
-- on boot (server.js "Payments & messaging batch tables" block) —
-- the boot code is the live path; this file is the readable record
-- for a fresh database.
--
-- E1 — real SSLCommerz flow: every init + callback is recorded in
-- gateway_payment_attempts, and a gateway order is marked Paid
-- ONLY after server-side validation (lib/sslcommerz.js
-- markOrderPaidIfValidated). gateway_tran_id / gateway_val_id /
-- gateway_status on orders hold the validated references of a
-- PAID gateway order — NULL until validation succeeds.
--
-- I12 — automated daily backups: the backups table records every
-- run (manual or daily); the .sql files themselves live in
-- <app>/backups/ on the server, never in the repo, never public.

CREATE TABLE IF NOT EXISTS gateway_payment_attempts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  tran_id VARCHAR(100) DEFAULT NULL,
  val_id VARCHAR(100) DEFAULT NULL,
  status VARCHAR(50) DEFAULT NULL,
  amount DECIMAL(10,2) DEFAULT NULL,
  currency VARCHAR(10) DEFAULT NULL,
  validated TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_gpa_order (order_id),
  INDEX idx_gpa_tran (tran_id)
);

CREATE TABLE IF NOT EXISTS backups (
  id INT AUTO_INCREMENT PRIMARY KEY,
  filename VARCHAR(255) DEFAULT NULL,
  size_bytes BIGINT NOT NULL DEFAULT 0,
  triggered_by VARCHAR(20) DEFAULT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ok',
  error VARCHAR(500) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_backups_created (created_at)
);

-- Orders: gateway references (NULL until a payment is validated).
-- Guarded in the boot code — run only when the column is missing.
-- ALTER TABLE orders ADD COLUMN gateway_tran_id VARCHAR(100) DEFAULT NULL;
-- ALTER TABLE orders ADD COLUMN gateway_val_id VARCHAR(100) DEFAULT NULL;
-- ALTER TABLE orders ADD COLUMN gateway_status VARCHAR(50) DEFAULT NULL;

-- Settings keys used by this batch (all admin-changeable in
-- Admin > Settings; secrets are never echoed back to the form):
--   gateway_store_id, gateway_store_password (E1 — live Store ID +
--   password; gateway stays inactive until BOTH are saved)
--   sms_provider, sms_enabled, sms_api_key, sms_sender_id,
--   sms_endpoint, sms_order_status_enabled (I2)
--   backup_retention_days (I12 — default 14)
