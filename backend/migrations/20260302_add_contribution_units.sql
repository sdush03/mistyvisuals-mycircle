-- Contribution Units v1

CREATE TABLE IF NOT EXISTS contribution_units (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('sales','planning','execution','post_production')),
  month DATE NOT NULL,
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS contribution_units_user_month_idx ON contribution_units(user_id, month);
CREATE INDEX IF NOT EXISTS contribution_units_lead_month_idx ON contribution_units(lead_id, month);
CREATE INDEX IF NOT EXISTS contribution_units_category_idx ON contribution_units(category);
