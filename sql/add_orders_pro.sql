-- Orders Pro (PR: fix/orders-pro) — order status history, admin notes,
-- phone confirmation, cancel reason, delivery zone on orders.
-- Safe to run more than once (IF NOT EXISTS / -f in apply-all.sh).
-- NOTE: server.js also auto-creates these on every start, so a fresh
-- deploy picks them up even without running this file by hand.

-- Delivery zone name as chosen at checkout (charge already lives in delivery_charge).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_zone VARCHAR(100) DEFAULT NULL;
-- 1 = customer confirmed the order by phone.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS phone_confirmed TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS phone_confirmed_at DATETIME DEFAULT NULL;
-- Required when an order is cancelled; shown on the order page + in history.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancel_reason VARCHAR(255) DEFAULT NULL;

-- Every order status change, with timestamp + who changed it + note.
CREATE TABLE IF NOT EXISTS order_status_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  old_status VARCHAR(50) DEFAULT NULL,
  new_status VARCHAR(50) NOT NULL,
  note VARCHAR(255) DEFAULT NULL,
  changed_by VARCHAR(100) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

-- Admin notes on an order (one row per note, timestamped).
CREATE TABLE IF NOT EXISTS order_notes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  note TEXT NOT NULL,
  created_by VARCHAR(100) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);
