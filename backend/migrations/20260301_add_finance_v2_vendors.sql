-- Migration for Finance v2: Vendors and Bills

CREATE TABLE IF NOT EXISTS vendors (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    vendor_type TEXT NOT NULL CHECK (vendor_type IN ('freelancer','employee','service')),
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    phone TEXT,
    email TEXT,
    notes TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vendor_bills (
    id SERIAL PRIMARY KEY,
    vendor_id INTEGER NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,
    lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,
    bill_date DATE,
    bill_amount NUMERIC NOT NULL,
    bill_category TEXT NOT NULL CHECK (bill_category IN ('editing','shooting','travel','food','printing','misc')),
    is_billable_to_client BOOLEAN NOT NULL DEFAULT false,
    status TEXT NOT NULL CHECK (status IN ('submitted','approved','rejected','paid')) DEFAULT 'submitted',
    notes TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS vendor_bills_vendor_id_idx ON vendor_bills(vendor_id);
CREATE INDEX IF NOT EXISTS vendor_bills_lead_id_idx ON vendor_bills(lead_id);
CREATE INDEX IF NOT EXISTS vendor_bills_status_idx ON vendor_bills(status);

CREATE TABLE IF NOT EXISTS vendor_bill_attachments (
    id SERIAL PRIMARY KEY,
    vendor_bill_id INTEGER NOT NULL REFERENCES vendor_bills(id) ON DELETE CASCADE,
    file_url TEXT NOT NULL,
    uploaded_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Link Outgoing finance_transactions to vendor bills
ALTER TABLE finance_transactions 
ADD COLUMN IF NOT EXISTS vendor_bill_id INTEGER REFERENCES vendor_bills(id) ON DELETE SET NULL;

-- Link Invoice line items to vendor bills (for explicitly billing costs to clients)
ALTER TABLE invoice_line_items 
ADD COLUMN IF NOT EXISTS vendor_bill_id INTEGER REFERENCES vendor_bills(id) ON DELETE SET NULL;
