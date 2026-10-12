-- Goince: Product Videos table (for Reels / Shorts auto-generated videos)
-- Run: mysql -u root -p goince_db < sql/add_product_videos.sql

CREATE TABLE IF NOT EXISTS product_videos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  filename VARCHAR(255) NOT NULL,
  duration_seconds DECIMAL(6,2) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  INDEX idx_product_id (product_id)
);
