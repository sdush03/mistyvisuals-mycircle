-- ============================================================
-- 20260424_add_missing_core_tables.sql
-- Adds all core tables that were created manually and never
-- tracked in migrations. Safe to run on any environment.
-- All statements use IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.
-- ============================================================

-- ── 1. Lead Events ──────────────────────────────────────────
-- Stores individual events (ceremonies, functions) for a lead.
CREATE TABLE IF NOT EXISTS lead_events (
  id              SERIAL PRIMARY KEY,
  lead_id         INT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  event_type      VARCHAR(100),
  event_date      DATE,
  pax             INT,
  venue           VARCHAR(200),
  description     TEXT,
  start_time      VARCHAR(10),
  end_time        VARCHAR(10),
  slot            VARCHAR(50),
  city_id         INT,
  venue_id        INT,
  venue_metadata  JSONB,
  date_status     VARCHAR(20) NOT NULL DEFAULT 'confirmed',
  position        INT NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lead_events_lead_id ON lead_events(lead_id);

-- ── 2. Cities ───────────────────────────────────────────────
-- Reference table for cities (used by lead_cities).
CREATE TABLE IF NOT EXISTS cities (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(100) NOT NULL,
  state_id   INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 3. Lead Cities ──────────────────────────────────────────
-- Links leads to cities; one city is marked as primary.
CREATE TABLE IF NOT EXISTS lead_cities (
  id         SERIAL PRIMARY KEY,
  lead_id    INT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  city_id    INT NOT NULL REFERENCES cities(id),
  is_primary BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(lead_id, city_id)
);
CREATE INDEX IF NOT EXISTS idx_lead_cities_lead_id ON lead_cities(lead_id);

-- ── 4. Lead Lost Reasons ────────────────────────────────────
-- Records why a lead was marked as Lost.
CREATE TABLE IF NOT EXISTS lead_lost_reasons (
  id      SERIAL PRIMARY KEY,
  lead_id INT NOT NULL REFERENCES leads(id) ON DELETE CASCADE UNIQUE,
  reason  TEXT NOT NULL,
  note    TEXT,
  user_id INT,
  lost_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 5. Known Internal IPs ───────────────────────────────────
-- Tracks internal/staff IPs so they are excluded from proposal
-- view analytics. (Also created in 20260416 migration; safe here.)
CREATE TABLE IF NOT EXISTS known_internal_ips (
  ip           TEXT PRIMARY KEY,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 6. Admin Audit Log ──────────────────────────────────────
-- General audit log for admin actions; also used to filter
-- internal IPs in proposal analytics.
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id         SERIAL PRIMARY KEY,
  user_id    INT,
  action     TEXT,
  ip         TEXT,
  metadata   JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_ip ON admin_audit_log(ip);

-- ── 7. Finance Categories ───────────────────────────────────
CREATE TABLE IF NOT EXISTS finance_categories (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL,   -- 'income' | 'expense'
  parent_id  INT REFERENCES finance_categories(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 8. Finance Transactions ─────────────────────────────────
CREATE TABLE IF NOT EXISTS finance_transactions (
  id          SERIAL PRIMARY KEY,
  amount      NUMERIC(12,2) NOT NULL DEFAULT 0,
  type        TEXT,
  category_id INT REFERENCES finance_categories(id),
  description TEXT,
  date        DATE,
  project_id  INT,
  vendor_id   INT,
  user_id     INT,
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_finance_transactions_date ON finance_transactions(date);

-- ── 9. Invoices ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoices (
  id             SERIAL PRIMARY KEY,
  lead_id        INT REFERENCES leads(id),
  quote_group_id INT,
  total_amount   NUMERIC(12,2),
  status         TEXT NOT NULL DEFAULT 'draft',
  metadata       JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 10. Invoice Line Items ──────────────────────────────────
CREATE TABLE IF NOT EXISTS invoice_line_items (
  id          SERIAL PRIMARY KEY,
  invoice_id  INT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description TEXT,
  amount      NUMERIC(12,2),
  quantity    INT NOT NULL DEFAULT 1
);

-- ── 11. Invoice Payment Schedule ────────────────────────────
CREATE TABLE IF NOT EXISTS invoice_payment_schedule (
  id         SERIAL PRIMARY KEY,
  invoice_id INT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  due_date   DATE,
  amount     NUMERIC(12,2),
  status     TEXT NOT NULL DEFAULT 'pending'
);

-- ── 12. Invoice Payments ────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoice_payments (
  id         SERIAL PRIMARY KEY,
  invoice_id INT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount     NUMERIC(12,2),
  paid_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  method     TEXT,
  note       TEXT
);

-- ── 13. SUPERSEDED status in QuoteStatus enum ───────────────
-- Adds the SUPERSEDED value if it doesn't already exist.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'SUPERSEDED'
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'quote_status')
  ) THEN
    ALTER TYPE quote_status ADD VALUE 'SUPERSEDED';
  END IF;
END
$$;
