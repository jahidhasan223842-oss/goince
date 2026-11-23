-- Delivery zones table (fresh install-er jonno; server.js start howar somoy
-- ei table nije thekeo baniye seed kore ney, tai haate run kora optional)
CREATE TABLE IF NOT EXISTS delivery_zones (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(100) NOT NULL UNIQUE,
  charge DECIMAL(10,2) NOT NULL DEFAULT 0,
  delivery_time VARCHAR(100) DEFAULT NULL,
  is_active TINYINT(1) DEFAULT 1,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
-- payment_methods-e type/instructions column (purono table-e na thakle)
-- MySQL-e IF NOT EXISTS column-e kaj kore na, tai server.js-e check kore jog kore.
