CREATE TABLE IF NOT EXISTS lead_quotes (
  id SERIAL PRIMARY KEY,
  lead_id INTEGER REFERENCES leads(id) ON DELETE CASCADE,
  quote_number TEXT NOT NULL,
  generated_text TEXT NOT NULL,
  amount_quoted NUMERIC,
  discounted_amount NUMERIC,
  created_at TIMESTAMP DEFAULT NOW(),
  created_by INTEGER REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_lead_quotes_lead_id ON lead_quotes(lead_id);
