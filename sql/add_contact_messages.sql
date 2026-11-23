-- Contact form-er message save korar table (fresh install-e schema.sql-e nei, tai alada file)
-- mysql -u root -p -f goince_db < sql/add_contact_messages.sql
-- server.js start howar somoy ei table nije thekeo baniye ney, tai haate run kora optional.
CREATE TABLE IF NOT EXISTS contact_messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(20) DEFAULT NULL,
  email VARCHAR(255) DEFAULT NULL,
  subject VARCHAR(255) DEFAULT NULL,
  message TEXT NOT NULL,
  is_read TINYINT(1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
