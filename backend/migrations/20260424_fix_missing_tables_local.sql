-- ============================================================
-- 20260424_fix_missing_tables_local.sql
-- Restores all tables/columns that exist in production but were
-- never tracked via migrations (created manually in prod).
-- Safe to run multiple times — all statements are idempotent.
-- ============================================================

-- ── 1. cities — add state & country text columns ────────────
-- Production has VARCHAR state/country directly on cities.
-- Local DB was recreated from the 20260424 migration which
-- only has state_id. Add the real columns.
ALTER TABLE cities
  ADD COLUMN IF NOT EXISTS state   VARCHAR(100),
  ADD COLUMN IF NOT EXISTS country VARCHAR(100) DEFAULT 'India';

-- ── 2. lead_followups ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lead_followups (
  id            SERIAL PRIMARY KEY,
  lead_id       INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  follow_up_at  TIMESTAMPTZ NOT NULL,
  type          TEXT NOT NULL,
  note          TEXT,
  outcome       TEXT,
  follow_up_mode         TEXT,
  discussed_topics       JSONB,
  not_connected_reason   TEXT,
  user_id       INTEGER REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lead_followups_lead_id_follow_up_at
  ON lead_followups (lead_id, follow_up_at);

-- ── 3. lead_negotiations ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS lead_negotiations (
  id         SERIAL PRIMARY KEY,
  lead_id    INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  topic      TEXT NOT NULL,
  note       TEXT NOT NULL,
  user_id    INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lead_negotiations_lead_id
  ON lead_negotiations (lead_id);

-- ── 4. lead_enrichment_logs ──────────────────────────────────
CREATE TABLE IF NOT EXISTS lead_enrichment_logs (
  id         SERIAL PRIMARY KEY,
  lead_id    INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  payload    JSONB,
  user_id    INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lead_enrichment_logs_lead_id
  ON lead_enrichment_logs (lead_id);

-- ── 5. lead_pricing_logs (if missing) ────────────────────────
CREATE TABLE IF NOT EXISTS lead_pricing_logs (
  id           SERIAL PRIMARY KEY,
  lead_id      INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  field_type   TEXT NOT NULL,
  amount       NUMERIC(12,2),
  user_id      INTEGER REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lead_pricing_logs_lead_id
  ON lead_pricing_logs (lead_id);
