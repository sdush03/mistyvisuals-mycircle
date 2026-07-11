-- ── Quote Presets (Quick Add bundles for team & deliverables) ───
CREATE TABLE IF NOT EXISTS quote_presets (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('TEAM', 'DELIVERABLE')),
  items_json  JSONB NOT NULL DEFAULT '[]',
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMP DEFAULT NOW(),
  updated_at  TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quote_presets_type_active ON quote_presets (type, active);

-- items_json structure:
-- TEAM:        [{ "catalogId": 5, "label": "Candid Photographer", "quantity": 2, "unitPrice": 5000 }, ...]
-- DELIVERABLE: [{ "catalogId": 12, "label": "Edited Photos", "quantity": 500, "unitPrice": 0, "category": "PHOTO" }, ...]
