# Deploy — Goince (AlmaLinux live server)

## 1. Code pull
```bash
cd /mnt/data2/Goince/Goince
git fetch origin
git checkout fix/complete-website
git pull origin fix/complete-website
```

## 2. Database migration (ekbar, live DB-te)
```bash
./sql/apply-all.sh
# ba haate: mysql -u root -p -f goince_db < sql/update.sql
```
Notun kono table/column lagle `sql/apply-all.sh`-ei jog koro — alada alada file mone kore run korte hobe na.

## 3. .env check (live-e)
- `SESSION_SECRET` — lomba random string thaktei hobe. Na thakle production-e server cholbe na (age hardcoded secret chilo, sorano hoyeche).
- `ADMIN_EMAIL` / `ADMIN_PASSWORD` — prothom login-er por Admin > Forgot Password diye shokto password set koro.
- `SHOP_PHONE` — asol dokan-er number (018...), `+8801XXXXXXXXX` placeholder rekho na.
- `FORCE_HTTPS=true` — SSL thik thakle tobei on koro.

## 4. Run with PM2 (server restart holeo cholbe)
```bash
npm install --omit=dev
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 startup   # je command debe, seta ekbar run koro
```
Age `node server.js` / `npm start` diye cholto — PM2-te gele crash hole nije theke restart hobe ar log `logs/`-e thakbe.

## 5. Rollback
Kono problem hole:
```bash
git checkout main
git pull origin main
pm2 restart goince
```
