ALTER TABLE invoices ADD COLUMN IF NOT EXISTS quote_group_id INTEGER REFERENCES quote_groups(id);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS share_token UUID DEFAULT gen_random_uuid();
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS metadata JSONB;
ALTER TABLE invoices ALTER COLUMN invoice_number DROP NOT NULL;
ALTER TABLE invoices ALTER COLUMN invoice_type DROP NOT NULL;
ALTER TABLE invoice_payment_schedule ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';
ALTER TABLE invoice_payment_schedule ALTER COLUMN due_date DROP NOT NULL;
