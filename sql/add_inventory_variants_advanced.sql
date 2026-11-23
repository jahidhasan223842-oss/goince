-- Inventory & Variants advanced fields (fresh install; server.js start howar
-- somoy ei column/table gulo nije thekeo baniye ney)
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS allow_backorder TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivery_time VARCHAR(100) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS barcode VARCHAR(100) DEFAULT NULL;
ALTER TABLE product_variants
  ADD COLUMN IF NOT EXISTS image VARCHAR(255) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS compare_at_price DECIMAL(10,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS barcode VARCHAR(100) DEFAULT NULL;
CREATE TABLE IF NOT EXISTS stock_alerts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  phone VARCHAR(20) NOT NULL,
  notified TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS stock_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  variant_id INT DEFAULT NULL,
  change_qty INT NOT NULL,
  stock_after INT NOT NULL,
  reason VARCHAR(50) NOT NULL DEFAULT 'manual',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);
