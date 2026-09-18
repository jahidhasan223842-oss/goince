-- Ei script "Product Colors" feature-take generalize kore "Product Options" banay,
-- jate Color chara-o Size, Weight (kg) ba onno jekono ধরনের option add kora jay.
--
-- SAFE: Jodi age theke "Product Colors" feature use kore thaken (product_colors
-- table-e data ache), ei script shei data mucbe na — nijei "Color" label diye
-- notun product_options table-e niye jabe. Jodi kokhono use na kore thaken,
-- shudhu notun khali table toiri hobe.
--
-- Run korar niyom:
--   mysql -u root -p goince_db < sql/add_product_options.sql

SET @old_table_exists = (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'product_colors');
SET @new_table_exists  = (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'product_options');

-- Case: purono product_colors ache, kintu notun product_options ekhono nei
-- -> column rename kore, "Color" label add kore, table-take product_options naam dewa
SET @sql1 = IF(@old_table_exists > 0 AND @new_table_exists = 0,
  'ALTER TABLE product_colors CHANGE COLUMN color_name value_name VARCHAR(100) NOT NULL, ADD COLUMN option_label VARCHAR(100) NOT NULL DEFAULT ''Color''',
  'SELECT 1');
PREPARE stmt1 FROM @sql1; EXECUTE stmt1; DEALLOCATE PREPARE stmt1;

SET @sql2 = IF(@old_table_exists > 0 AND @new_table_exists = 0,
  'RENAME TABLE product_colors TO product_options',
  'SELECT 1');
PREPARE stmt2 FROM @sql2; EXECUTE stmt2; DEALLOCATE PREPARE stmt2;

-- Case: kono table-i nei -> notun kore fresh toiri kora
CREATE TABLE IF NOT EXISTS product_options (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  option_label VARCHAR(100) NOT NULL DEFAULT 'Option',  -- jemon: "Color", "Size", "Weight"
  value_name VARCHAR(100) NOT NULL,                      -- jemon: "Red", "Large", "1kg"
  color_hex VARCHAR(20) DEFAULT NULL,                    -- optional swatch color
  image VARCHAR(255) DEFAULT NULL,                       -- optional: ei value-er jonno alada chobi
  sort_order INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);
