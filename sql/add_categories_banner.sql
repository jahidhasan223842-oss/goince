-- Categories banner: wide image shown at the top of the category's shop page.
ALTER TABLE categories ADD COLUMN IF NOT EXISTS banner_url VARCHAR(500) DEFAULT NULL;
