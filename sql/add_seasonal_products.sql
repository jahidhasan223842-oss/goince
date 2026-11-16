-- Goince Seasonal Products Migration
-- Safe to run more than once.

SET @column_exists := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'products'
    AND column_name = 'target_audience'
);

SET @migration_sql := IF(
  @column_exists = 0,
  'ALTER TABLE products ADD COLUMN target_audience VARCHAR(20) NOT NULL DEFAULT ''all'' AFTER category_id',
  'SELECT ''target_audience column already exists'' AS migration_status'
);

PREPARE seasonal_stmt FROM @migration_sql;
EXECUTE seasonal_stmt;
DEALLOCATE PREPARE seasonal_stmt;

-- Create Seasonal Products main category if missing.
INSERT INTO categories (name, parent_id)
SELECT 'Seasonal Products', NULL
WHERE NOT EXISTS (
  SELECT 1 FROM categories
  WHERE name = 'Seasonal Products' AND parent_id IS NULL
);

SET @seasonal_parent_id := (
  SELECT id FROM categories
  WHERE name = 'Seasonal Products' AND parent_id IS NULL
  ORDER BY id ASC LIMIT 1
);

-- Create season subcategories without duplicates.
INSERT INTO categories (name, parent_id)
SELECT 'Winter Collection', @seasonal_parent_id
WHERE NOT EXISTS (
  SELECT 1 FROM categories
  WHERE name = 'Winter Collection'
    AND parent_id = @seasonal_parent_id
);

INSERT INTO categories (name, parent_id)
SELECT 'Summer Collection', @seasonal_parent_id
WHERE NOT EXISTS (
  SELECT 1 FROM categories
  WHERE name = 'Summer Collection'
    AND parent_id = @seasonal_parent_id
);

INSERT INTO categories (name, parent_id)
SELECT 'Rainy Season Collection', @seasonal_parent_id
WHERE NOT EXISTS (
  SELECT 1 FROM categories
  WHERE name = 'Rainy Season Collection'
    AND parent_id = @seasonal_parent_id
);
