-- Categories SEO fields: meta title + meta description per category.
-- Shown on the shop category page (<title> + meta description) when set.
ALTER TABLE categories ADD COLUMN IF NOT EXISTS meta_title VARCHAR(255) DEFAULT NULL;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS meta_description TEXT DEFAULT NULL;
