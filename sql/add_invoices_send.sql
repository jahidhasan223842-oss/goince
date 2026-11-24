-- Invoices + send (PR: fix/invoices-send) — advance payments + invoice send log.
-- Safe to run more than once (IF NOT EXISTS).
-- NOTE: server.js also auto-creates these on every start, so a fresh
-- deploy picks them up even without running this file by hand.
-- No separate invoices table: an invoice IS an order, numbered GOINCE-00035.

-- Advance / partial payments recorded by the admin for an order.
CREATE TABLE IF NOT EXISTS order_payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  note VARCHAR(255) DEFAULT NULL,
  created_by VARCHAR(100) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

-- Log of every invoice send (email + WhatsApp), success or failure.
CREATE TABLE IF NOT EXISTS order_invoice_sends (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  channel VARCHAR(20) NOT NULL,
  recipient VARCHAR(255) DEFAULT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'sent',
  error VARCHAR(500) DEFAULT NULL,
  created_by VARCHAR(100) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);
