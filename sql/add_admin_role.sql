-- Staff roles (Batch 6): owner / manager / staff. Default 'owner' so the
-- existing admin stays Owner. Safe to run twice (IF NOT EXISTS).
ALTER TABLE admins ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'owner';
