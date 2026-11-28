-- Per-product free delivery (feat/cart-buying, PR #82, B4).
--
-- KONO NOTUN COLUMN LAGE NA: `free_shipping` column-ta age thekei
-- ache — sql/add_product_advanced.sql-eo ache, ar server.js start
-- howar somoy ei column-ta nije thekeo baniye ney (productCols
-- list-e `['free_shipping', 'TINYINT(1) NOT NULL DEFAULT 0']`),
-- tai deploy-e haate kichu korte hoy na. Existing shob product-er
-- value DEFAULT 0, mane "Delivery Charge" — ager behaviour bodlay
-- na. Admin > Add/Edit Product-er "Delivery" select (Free Delivery
-- / Delivery Charge) ei column-tai lekhe (routes/admin.js
-- parseProductAdvanced: body.free_shipping === '1' ? 1 : 0).
--
-- Jodi kokhono haate apply korte hoy (fresh DB ba column muche
-- gele), ei ektai statement jothesto:
--
--   mysql -u root -p -f goince_db < sql/add_free_delivery.sql
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS free_shipping TINYINT(1) NOT NULL DEFAULT 0;
