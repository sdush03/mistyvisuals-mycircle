UPDATE deliverable_catalog SET delivery_phase = 'WEDDING' WHERE delivery_phase = 'GENERAL' OR delivery_phase IS NULL;
UPDATE quote_pricing_items SET phase = 'WEDDING' WHERE phase = 'GENERAL' OR phase IS NULL;

ALTER TABLE deliverable_catalog ALTER COLUMN delivery_phase SET DEFAULT 'WEDDING';
ALTER TABLE quote_pricing_items ALTER COLUMN phase SET DEFAULT 'WEDDING';
