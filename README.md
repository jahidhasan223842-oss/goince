# Goince - E-commerce Website

## Setup Korar Niyom (Local PC te)

### 1. Project Folder e jao
```bash
cd goince
```

### 2. Dependencies install koro
```bash
npm install
```

### 3. .env file banao
```bash
cp .env.example .env
```
Tarpor `.env` file ta open kore nijer MySQL password diye update koro.

### 4. Database toiri koro
```bash
mysql -u root -p
```
```sql
CREATE DATABASE goince_db;
exit
```

Ekhon schema file run koro:
```bash
mysql -u root -p goince_db < sql/schema.sql
```

**Note:** Jodi age theke `goince_db` use kore thako (purono version), notun column gulo (email, users, reviews, coupons table) add korte ei command gulo alada kore run koro:
```sql
ALTER TABLE orders ADD COLUMN email VARCHAR(255) DEFAULT NULL;
ALTER TABLE orders ADD COLUMN user_id INT DEFAULT NULL;
ALTER TABLE orders ADD COLUMN coupon_code VARCHAR(50) DEFAULT NULL;
ALTER TABLE orders ADD COLUMN discount_amount DECIMAL(10,2) DEFAULT 0;
```
(Notun/fresh database hole eta lagbe na, `schema.sql` shob kore dibe)

### 5. Server chalu koro
```bash
npm start
```
Browser e jao: `http://localhost:3000`

### 6. Admin Panel
`http://localhost:3000/admin/login`
- Email: `admin@goince.com`
- Password: `admin123`

---

## Full Feature List

### Customer Side
- Homepage: product listing, category filter, search
- Product details page with **rating & reviews**
- Cart: add/update/remove, **coupon code apply**
- Checkout: Cash on Delivery / bKash / Nagad (option select, real gateway na)
- **Signup/Login/Logout**
- **My Account: order history + order details**
- Order confirmation page
- **Email notification** (order confirmation, jodi .env e email setup thake)

### Admin Panel
- Login/Logout
- Dashboard: stats (products, orders, revenue)
- Product Add/Edit/Delete (image upload shoho)
- Category quick-add
- **Coupon Management** (add/activate/deactivate/delete)
- Order list + status update (Pending → Confirmed → Shipped → Delivered)

---

## Email Notification Chalu Korte

`.env` file e ei duita line add koro:
```
EMAIL_USER=your-gmail@gmail.com
EMAIL_PASS=your-app-password
```

**Gmail App Password kivabe banabe:**
1. Google Account e jao → Security
2. "2-Step Verification" on koro (na thakle)
3. "App Passwords" e giye notun ekta password generate koro (Goince likhe)
4. Generate hoya 16-digit code ta `EMAIL_PASS` e boshao (space chara)

Eta set na korle, shob kichu normal kaj korbe, shudhu email pathabe na (kono error hobe na).

## Coupon Code Test Korte

Schema file diye ekta test coupon already ache: **WELCOME10** (10% discount). Cart page theke likhe "Apply" dile discount kaj kore kina dekho.

---

## Hosting e Upload Korar Age

1. `.env` file e hosting er deya database info boshao
2. `ADMIN_PASSWORD` shokto kore change koro
3. Email chaile real Gmail/business email diye set koro
4. cPanel e "Setup Node.js App" diye deploy koro, Startup File: `server.js`

## Ekhono Bakir Feature (business account lagbe)

- **Real bKash/Nagad Payment Gateway** — bKash/Nagad Merchant Account lagbe (business registration diye apply korte hoy)
- **SMS Notification** — Paid SMS Gateway account lagbe (BD te: adnsms, elitbuzz, ityadi)

Account paile bolo, integrate kore dibo.
