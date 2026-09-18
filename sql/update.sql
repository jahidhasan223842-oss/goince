-- Tumi jodi AGE THEKEI database toiri kore fele thako, tahole notun feature
-- (Login, Review, Coupon, Customer Management, Payment Status, Delivery Charge,
--  Transaction ID, Courier/Tracking) kaj korar jonno ei file ta run koro.
-- Purono data (product, order) kichu mucbe na.
--
-- Command (mone rekho -f flag ta obosshoi dite hobe):
-- mysql -u root -p -f goince_db < sql/update.sql
--
-- "-f" (force) flag dile "Duplicate column" error ashleo script thambe na,
-- shudhu oi line skip kore porerta chalabe. Erokom error dekhale চিন্তার কারণ নেই।

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  phone VARCHAR(20),
  address TEXT DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reviews (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  user_id INT NOT NULL,
  rating INT NOT NULL,
  comment TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Live Chat feature
CREATE TABLE IF NOT EXISTS settings (
  setting_key VARCHAR(100) PRIMARY KEY,
  setting_value VARCHAR(255) NOT NULL
);
INSERT IGNORE INTO settings (setting_key, setting_value) VALUES ('shop_phone', '+8801700000000');

CREATE TABLE IF NOT EXISTS chat_conversations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  chat_identifier VARCHAR(100) NOT NULL UNIQUE,
  customer_name VARCHAR(255) DEFAULT 'Guest',
  user_id INT DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_message_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  conversation_id INT NOT NULL,
  sender VARCHAR(20) NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS wishlist (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  product_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_wishlist_item (user_id, product_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS coupons (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(50) NOT NULL UNIQUE,
  discount_percent INT NOT NULL,
  active TINYINT(1) DEFAULT 1,
  expiry_date DATE DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT IGNORE INTO coupons (code, discount_percent, active) VALUES ('WELCOME10', 10, 1);

ALTER TABLE users ADD COLUMN address TEXT DEFAULT NULL;
ALTER TABLE orders ADD COLUMN user_id INT DEFAULT NULL;
ALTER TABLE orders ADD COLUMN email VARCHAR(255) DEFAULT NULL;
ALTER TABLE orders ADD COLUMN coupon_code VARCHAR(50) DEFAULT NULL;
ALTER TABLE orders ADD COLUMN discount_amount DECIMAL(10,2) DEFAULT 0;

-- Notun: Payment Status, Delivery Charge, Transaction ID, Courier/Tracking
ALTER TABLE orders ADD COLUMN payment_status VARCHAR(20) DEFAULT 'Unpaid';
ALTER TABLE orders ADD COLUMN transaction_id VARCHAR(100) DEFAULT NULL;
ALTER TABLE orders ADD COLUMN delivery_charge DECIMAL(10,2) DEFAULT 60;
ALTER TABLE orders ADD COLUMN courier_name VARCHAR(100) DEFAULT NULL;
ALTER TABLE orders ADD COLUMN tracking_number VARCHAR(100) DEFAULT NULL;

-- Product overview e notun feature: Multiple Images, Discount Price, Specifications
CREATE TABLE IF NOT EXISTS product_images (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  image VARCHAR(255) NOT NULL,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);
ALTER TABLE products ADD COLUMN compare_at_price DECIMAL(10,2) DEFAULT NULL;
ALTER TABLE products ADD COLUMN specifications TEXT DEFAULT NULL;

-- Password Reset (Forgot Password) er jonno
ALTER TABLE users ADD COLUMN reset_token VARCHAR(255) DEFAULT NULL;
ALTER TABLE users ADD COLUMN reset_expires DATETIME DEFAULT NULL;

-- Sub-category support
ALTER TABLE categories ADD COLUMN parent_id INT DEFAULT NULL;

-- Cash on Delivery order gulo default e "Unpaid" thakbe, kintu purono
-- Delivered/Confirmed order gulo hoyto already paid — proyojon mone korle
-- ei command diye purono shob delivered order ke "Paid" mark kore dite paro:
-- UPDATE orders SET payment_status = 'Paid' WHERE status = 'Delivered';

-- Customer Management (advanced): Block/Unblock customer feature
ALTER TABLE users ADD COLUMN is_blocked TINYINT(1) DEFAULT 0;

-- Admin Panel: Forgot/Reset Password recovery. Ei table na thakle Admin
-- login .env-er ADMIN_EMAIL/ADMIN_PASSWORD diye hoy — DB te move korar
-- por password bhule gele "Forgot Password" diye reset kora jabe.
CREATE TABLE IF NOT EXISTS admins (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  reset_token VARCHAR(255) DEFAULT NULL,
  reset_expires DATETIME DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Product Variants (Size, Color, ইত্যাদি) — admin nijer moto Attribute
-- (jemon "Size") ar tar Value (jemon "Small") add/remove korte parbe,
-- ar prottek product-e sheigulo diye variant (combo) banate parbe.
CREATE TABLE IF NOT EXISTS attributes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS attribute_values (
  id INT AUTO_INCREMENT PRIMARY KEY,
  attribute_id INT NOT NULL,
  value VARCHAR(100) NOT NULL,
  FOREIGN KEY (attribute_id) REFERENCES attributes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS product_variants (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  sku VARCHAR(100) DEFAULT NULL,
  price DECIMAL(10,2) DEFAULT NULL,
  stock INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS product_variant_attributes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  variant_id INT NOT NULL,
  attribute_value_id INT NOT NULL,
  FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE CASCADE,
  FOREIGN KEY (attribute_value_id) REFERENCES attribute_values(id) ON DELETE CASCADE
);

-- Order-e ঠিক kon variant (jemon "Size: M, Color: Red") order hoyeche
-- shetar record rakhar jonno. variant_label column-e text snapshot thake,
-- tai variant delete hoye gele-o purono order-e thik jinish ta dekhabe.
ALTER TABLE order_items ADD COLUMN variant_id INT DEFAULT NULL;
ALTER TABLE order_items ADD COLUMN variant_label VARCHAR(255) DEFAULT NULL;
ALTER TABLE order_items ADD FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE SET NULL;

-- Admin Panel theke Delivery Charge (Inside/Outside Dhaka) edit korar feature.
-- Purono setup e ei row gulo na thakle default value diye toiri hobe;
-- already thakle kichu hobe na (INSERT IGNORE).
INSERT IGNORE INTO settings (setting_key, setting_value) VALUES ('delivery_charge_inside', '60');
INSERT IGNORE INTO settings (setting_key, setting_value) VALUES ('delivery_charge_outside', '120');
