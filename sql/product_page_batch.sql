-- Product-page batch (feat/product-page, PR #83) — tables for D3/D4/G1.
-- server.js also auto-creates these on boot (same pattern as
-- product_videos), so the live deploy needs no manual step; this file
-- is the documented source of the schema.
--
--   product_questions    D4 Q&A: shopper asks, admin answers in
--                      Admin > Reviews. Only status='answered' rows
--                      are ever shown on the shop.
--   review_photos        D3 review photos (one row per uploaded photo).
--   review_helpful_votes D3 "helpful" votes: one vote per customer
--                      (user_id) or per guest session (session_key);
--                      the two UNIQUE keys enforce it in the DB.
--   product_views        G1 real live viewers: one row per session
--                      per product, refreshed on each page load;
--                      the route counts distinct sessions seen in
--                      the last 5 minutes and prunes older rows.
CREATE TABLE IF NOT EXISTS product_questions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  user_id INT DEFAULT NULL,
  asker_name VARCHAR(255) NOT NULL,
  question TEXT NOT NULL,
  answer TEXT DEFAULT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  answered_at DATETIME DEFAULT NULL,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_pq_product (product_id, status)
);

CREATE TABLE IF NOT EXISTS review_photos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  review_id INT NOT NULL,
  filename VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE,
  INDEX idx_rp_review (review_id)
);

CREATE TABLE IF NOT EXISTS review_helpful_votes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  review_id INT NOT NULL,
  user_id INT DEFAULT NULL,
  session_key VARCHAR(100) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uq_helpful_user (review_id, user_id),
  UNIQUE KEY uq_helpful_session (review_id, session_key),
  INDEX idx_rhv_review (review_id)
);

CREATE TABLE IF NOT EXISTS product_views (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  session_key VARCHAR(100) NOT NULL,
  viewed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  UNIQUE KEY uq_product_view (product_id, session_key),
  INDEX idx_pv_recent (product_id, viewed_at)
);
