CREATE TABLE IF NOT EXISTS invoice_payment_schedule (
  id SERIAL PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  label TEXT,
  percentage NUMERIC,
  amount NUMERIC NOT NULL,
  due_date DATE NOT NULL,
  step_order INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS invoice_payment_schedule_invoice_id_idx
  ON invoice_payment_schedule (invoice_id);

CREATE INDEX IF NOT EXISTS invoice_payment_schedule_due_date_idx
  ON invoice_payment_schedule (due_date);
