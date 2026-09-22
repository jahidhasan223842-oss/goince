-- Admin Panel-ke PWA (phone-e install-jogyo) banano-r jonno, ei table-e
-- admin-er phone/browser-er Push Subscription joma thake. Notun Order asle
-- ei list-er shob device-e notification pathano hoy.
--
-- How to run:
--   mysql -u root -p goince_db < sql/add_push_subscriptions.sql

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  endpoint VARCHAR(500) NOT NULL UNIQUE,
  p256dh VARCHAR(255) NOT NULL,
  auth VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
