-- Categories advanced fields: photo, description, sort order, show/hide, featured, slug.
-- Slug backfill (name theke) server start-e hoy (server.js), ekhane sudhu column gulo jog hobe.
ALTER TABLE categories ADD COLUMN IF NOT EXISTS image_url VARCHAR(500) DEFAULT NULL;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS description TEXT DEFAULT NULL;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS sort_order INT NOT NULL DEFAULT 0;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS is_visible TINYINT(1) NOT NULL DEFAULT 1;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS is_featured TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS slug VARCHAR(150) DEFAULT NULL;
-- Purono category gulo sort order-e id onujayi sajano
UPDATE categories SET sort_order = id WHERE sort_order = 0;
