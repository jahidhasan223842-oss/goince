-- Generalizes "Mobile Banking Number" from a fixed 3-slot setup (bKash/Nagad/Rocket)
-- into a table where the admin can Add/Edit/Delete as many payment methods as needed.
--
-- SAFE: If you already saved bkash_number/nagad_number/rocket_number under Settings,
-- those numbers won't be lost — they get carried over automatically into the new
-- payment_methods table.
--
-- How to run:
--   mysql -u root -p goince_db < sql/add_payment_methods.sql

CREATE TABLE IF NOT EXISTS payment_methods (
  id INT AUTO_INCREMENT PRIMARY KEY,
  method_name VARCHAR(100) NOT NULL,   -- e.g. "bKash", "Nagad", "Rocket", "Upay"
  number VARCHAR(50) DEFAULT NULL,     -- the number customers should send money to
  is_active TINYINT(1) DEFAULT 1,      -- turn off to hide this method on checkout
  sort_order INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- If the table is brand new (empty), seed it with the old Settings numbers if any
-- existed, otherwise create bKash/Nagad/Rocket with blank numbers — so checkout
-- keeps working right after deploy without the admin having to set everything up
-- from scratch.
SET @existing_count = (SELECT COUNT(*) FROM payment_methods);

INSERT INTO payment_methods (method_name, number, sort_order)
SELECT * FROM (
  SELECT 'bKash' AS method_name,
         (SELECT setting_value FROM settings WHERE setting_key = 'bkash_number') AS number,
         1 AS sort_order
) AS tmp
WHERE @existing_count = 0;

INSERT INTO payment_methods (method_name, number, sort_order)
SELECT * FROM (
  SELECT 'Nagad' AS method_name,
         (SELECT setting_value FROM settings WHERE setting_key = 'nagad_number') AS number,
         2 AS sort_order
) AS tmp
WHERE @existing_count = 0;

INSERT INTO payment_methods (method_name, number, sort_order)
SELECT * FROM (
  SELECT 'Rocket' AS method_name,
         (SELECT setting_value FROM settings WHERE setting_key = 'rocket_number') AS number,
         3 AS sort_order
) AS tmp
WHERE @existing_count = 0;
