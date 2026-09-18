-- Notun, shohoj "Product Color" feature-er jonno table.
-- Ager jhamela-purno Attribute/Variant system theke alada ebong shohoj —
-- ekta product-er jonno shudhu color name + color code + (optional) chobi.
--
-- Run korar niyom:
--   mysql -u root -p goince_db < sql/add_product_colors.sql

CREATE TABLE IF NOT EXISTS product_colors (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  color_name VARCHAR(100) NOT NULL,   -- jemon: "Red", "Space Gray"
  color_hex VARCHAR(20) DEFAULT NULL, -- jemon: "#e63946" (swatch dekhanor jonno)
  image VARCHAR(255) DEFAULT NULL,    -- ei color-er product-er chobi (na dile default product image dekhabe)
  sort_order INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);
