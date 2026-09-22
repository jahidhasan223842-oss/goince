// Database connection setup — MySQL/MariaDB er sathe connect kore
require('dotenv').config();
const mysql = require('mysql2');

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4', // Emoji (✅, 🎁, 👔 er moto 4-byte Unicode character) shothik vabe
                       // save korte ei charset lagbe. Shudhu eta dile e hobe na — Database
                       // ebong Table gulo o utf8mb4 e convert korte hobe (sql/fix_charset.sql dekho).
  decimalNumbers: true // Eta na dile price/compare_at_price-er moto DECIMAL column
                       // string hisebe ashe, tate boro/choto number compare bhul hoy
                       // (jemon "1200" ke "900"-er cheye choto mone hoy). Eta true dile
                       // MySQL2 nijei number hisebe convert kore dey, shob jaygay thik kaj korbe.
});

const db = pool.promise();

module.exports = db;
