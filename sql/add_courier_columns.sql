-- Courier API: consignment id + last-known delivery status on orders.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS courier_consignment_id VARCHAR(100) DEFAULT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS courier_status VARCHAR(50) DEFAULT NULL;
