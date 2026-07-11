-- ============================================================
-- 20260709_align_invoice_line_items.sql
-- Aligns invoice_line_items table columns between v1 invoices schema
-- and modern core tables schema.
-- ============================================================

ALTER TABLE invoice_line_items ADD COLUMN IF NOT EXISTS amount NUMERIC(12,2);
ALTER TABLE invoice_line_items ADD COLUMN IF NOT EXISTS unit_price NUMERIC(12,2) DEFAULT 0;
ALTER TABLE invoice_line_items ADD COLUMN IF NOT EXISTS line_total NUMERIC(12,2) DEFAULT 0;

-- Backfill existing data
UPDATE invoice_line_items SET amount = COALESCE(amount, unit_price) WHERE amount IS NULL;
UPDATE invoice_line_items SET unit_price = COALESCE(unit_price, amount) WHERE unit_price IS NULL OR unit_price = 0;
UPDATE invoice_line_items SET line_total = COALESCE(line_total, amount * quantity) WHERE line_total IS NULL OR line_total = 0;
