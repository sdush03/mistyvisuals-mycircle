-- Finance v0 tables

CREATE TABLE IF NOT EXISTS money_sources (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS finance_categories (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS finance_transactions (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  money_source_id INTEGER NOT NULL REFERENCES money_sources(id) ON DELETE RESTRICT,
  lead_id INTEGER REFERENCES leads(id) ON DELETE RESTRICT,
  is_overhead BOOLEAN NOT NULL DEFAULT false,
  category_id INTEGER REFERENCES finance_categories(id) ON DELETE RESTRICT,
  note TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT finance_transactions_lead_overhead_check
    CHECK (
      (lead_id IS NOT NULL AND is_overhead = false)
      OR (lead_id IS NULL AND is_overhead = true)
    )
);

CREATE INDEX IF NOT EXISTS finance_transactions_date_idx ON finance_transactions(date);
CREATE INDEX IF NOT EXISTS finance_transactions_lead_idx ON finance_transactions(lead_id);
CREATE INDEX IF NOT EXISTS finance_transactions_source_idx ON finance_transactions(money_source_id);
CREATE INDEX IF NOT EXISTS finance_transactions_category_idx ON finance_transactions(category_id);
CREATE INDEX IF NOT EXISTS finance_transactions_direction_idx ON finance_transactions(direction);
