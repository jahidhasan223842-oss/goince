-- Discovery & search (feat/discovery-search, PR #85).
--
-- C3 "Customers also viewed" needs a PERSISTENT view history.
-- product_views (sql/product_page_batch.sql) only keeps the last
-- 10 minutes of views (the live-viewer cleanup deletes older rows),
-- so co-viewed products could never be computed from it alone.
-- product_view_history keeps one row per (product, session) forever
-- (a repeat view only refreshes viewed_at) and is the source of the
-- co-view query in routes/shop.js. No personal data: session_key is
-- the express-session id (or a random key), never a name/phone.
--
-- C1 faceted filters need NO schema change: brand, tags and
-- compare_at_price already exist on products (sql/schema.sql,
-- sql/add_product_advanced.sql), rating comes from the reviews
-- table, in-stock from stock. C2 fuzzy search is in code
-- (lib/discovery.js). C4 pagination is LIMIT/OFFSET, no schema.
--
-- server.js also auto-creates this table on boot (CREATE TABLE IF
-- NOT EXISTS, next to product_views), so a deploy needs no manual
-- step; run this file by hand only if the auto-create was skipped.
CREATE TABLE IF NOT EXISTS product_view_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  session_key VARCHAR(100) NOT NULL,
  viewed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  UNIQUE KEY uq_pvh_product_session (product_id, session_key),
  INDEX idx_pvh_session (session_key, viewed_at),
  INDEX idx_pvh_product (product_id, viewed_at)
);
