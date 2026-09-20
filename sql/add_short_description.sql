-- Ei file ta ekbar phpMyAdmin diye Import korle "short_description" column ta
-- products table-e add hobe. Age theke thakle kono error hobe na (IF NOT EXISTS
-- diye lekha), tai nishchinte run korte paren.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS short_description VARCHAR(300) DEFAULT NULL AFTER description;
