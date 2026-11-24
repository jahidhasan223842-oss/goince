-- Orders Pro 2 (PR: fix/orders-pro-2) — COD collection tracking + returns.
-- Safe to run more than once (IF NOT EXISTS).
-- NOTE: server.js also auto-creates these on every start, so a fresh
-- deploy picks them up even without running this file by hand.

-- 1 = COD cash received from the customer.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cod_collected TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cod_collected_at DATETIME DEFAULT NULL;

-- Returns recorded by admin for an order.
CREATE TABLE IF NOT EXISTS order_returns (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  reason TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'Pending',
  created_by VARCHAR(100) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);
