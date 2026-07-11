-- Migration for Finance v1: Invoices

CREATE TABLE IF NOT EXISTS invoices (
    id SERIAL PRIMARY KEY,
    invoice_number TEXT UNIQUE NOT NULL,
    lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE RESTRICT,
    invoice_type TEXT NOT NULL CHECK (invoice_type IN ('gst', 'non_gst')),
    payment_structure_id INTEGER REFERENCES payment_structures(id) ON DELETE SET NULL,
    subtotal NUMERIC NOT NULL DEFAULT 0,
    tax_amount NUMERIC NOT NULL DEFAULT 0,
    total_amount NUMERIC NOT NULL DEFAULT 0,
    status TEXT NOT NULL CHECK (status IN ('draft', 'issued', 'partially_paid', 'paid', 'cancelled')) DEFAULT 'draft',
    issue_date DATE,
    due_date DATE,
    notes TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Index for speedy lead lookups
CREATE INDEX IF NOT EXISTS invoices_lead_id_idx ON invoices(lead_id);
-- Index for status filtering
CREATE INDEX IF NOT EXISTS invoices_status_idx ON invoices(status);

CREATE TABLE IF NOT EXISTS invoice_line_items (
    id SERIAL PRIMARY KEY,
    invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    quantity NUMERIC NOT NULL DEFAULT 1,
    unit_price NUMERIC NOT NULL DEFAULT 0,
    line_total NUMERIC NOT NULL DEFAULT 0,
    is_billable_expense BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS invoice_line_items_invoice_id_idx ON invoice_line_items(invoice_id);

CREATE TABLE IF NOT EXISTS invoice_payments (
    id SERIAL PRIMARY KEY,
    invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    finance_transaction_id INTEGER NOT NULL REFERENCES finance_transactions(id) ON DELETE RESTRICT,
    amount_applied NUMERIC NOT NULL CHECK (amount_applied > 0),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    -- Enforce a transaction can only be applied to a specific invoice once 
    -- (Though it can be applied to different invoices if split, it shouldn't have duplicate mapping rows for the exact same invoice)
    UNIQUE(invoice_id, finance_transaction_id)
);

CREATE INDEX IF NOT EXISTS invoice_payments_invoice_id_idx ON invoice_payments(invoice_id);
CREATE INDEX IF NOT EXISTS invoice_payments_trx_id_idx ON invoice_payments(finance_transaction_id);
