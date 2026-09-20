-- Product-e Short Description ar Long Description alada kore rakhar jonno
-- (age shudhu ekta "description" column chilo, seta rekhei notun 2ta column jog kora hocche)
-- IF NOT EXISTS use kora hoyeche, jate kono database-e already ekta column thakleo error na ashe

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS short_description VARCHAR(300) DEFAULT NULL AFTER description,
  ADD COLUMN IF NOT EXISTS long_description LONGTEXT DEFAULT NULL AFTER short_description;

-- Purono product gulor "description" field-e jeta lekha chilo, seta automatic
-- "long_description"-e copy kore dewa hocche, jate purono data na hariye jay
UPDATE products SET long_description = description WHERE long_description IS NULL;
