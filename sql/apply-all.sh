#!/bin/bash
# Live / local database-e shob migration ekbare, sothik order-e chalano.
# Usage: DB_PASS=... ./sql/apply-all.sh   (ba: mysql -u root -p goince_db < sql/schema.sql ... nije)
# Prottek file-e IF NOT EXISTS / -f use kora ache, tai age run kora thakle abar chalaleo data mucbe na.
set -e
DB_USER="${DB_USER:-root}"
DB_NAME="${DB_NAME:-goince_db}"
MYSQL="mysql -u $DB_USER ${DB_PASS:+-p$DB_PASS} -f $DB_NAME"
for f in schema.sql update.sql add_product_descriptions.sql add_short_description.sql add_product_options.sql add_product_colors.sql add_payment_methods.sql add_product_videos.sql add_push_subscriptions.sql add_contact_messages.sql add_delivery_zones.sql add_product_advanced.sql add_inventory_variants_advanced.sql add_seasonal_products.sql fix_charset.sql add_banners.sql; do
  [ -f "sql/$f" ] || continue
  echo "== $f"
  $MYSQL < "sql/$f"
done
echo "Done — shob migration apply hoyeche."
