-- 20260502_invoice_project_link.sql

ALTER TABLE invoices ADD COLUMN project_id UUID REFERENCES projects(id);
ALTER TABLE projects ADD COLUMN invoice_id INTEGER REFERENCES invoices(id);
ALTER TABLE invoices ADD COLUMN advance_amount NUMERIC(12,2) DEFAULT 0;
ALTER TABLE invoices ADD COLUMN balance_amount NUMERIC(12,2) DEFAULT 0;
ALTER TABLE invoices ADD COLUMN advance_paid BOOLEAN DEFAULT FALSE;

-- Proper schema fix for project references in finance
ALTER TABLE finance_transactions ADD COLUMN project_uuid UUID REFERENCES projects(id);
