ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS client_offer_amount NUMERIC NULL,
  ADD COLUMN IF NOT EXISTS discounted_amount NUMERIC NULL;

CREATE TABLE IF NOT EXISTS lead_pricing_logs (
  id SERIAL PRIMARY KEY,
  lead_id INTEGER REFERENCES leads(id) ON DELETE CASCADE,
  field_type TEXT CHECK (field_type IN ('client_offer', 'discounted')),
  amount NUMERIC NOT NULL,
  created_at TIMESTAMP DEFAULT now()
);
