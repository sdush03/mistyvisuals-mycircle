-- Quotation engine schema
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'quote_status') THEN
    CREATE TYPE quote_status AS ENUM (
      'DRAFT',
      'PENDING_APPROVAL',
      'APPROVED',
      'SENT',
      'ACCEPTED',
      'REJECTED',
      'EXPIRED'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'pricing_item_type') THEN
    CREATE TYPE pricing_item_type AS ENUM ('TEAM_ROLE', 'DELIVERABLE');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'unit_type') THEN
    CREATE TYPE unit_type AS ENUM ('PER_DAY', 'PER_UNIT', 'FLAT');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'negotiation_type') THEN
    CREATE TYPE negotiation_type AS ENUM (
      'CLIENT_FEEDBACK',
      'DISCOUNT_REQUEST',
      'COVERAGE_CHANGE',
      'INTERNAL_NOTE'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS quote_groups (
  id SERIAL PRIMARY KEY,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quote_versions (
  id SERIAL PRIMARY KEY,
  quote_group_id INTEGER NOT NULL REFERENCES quote_groups(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  status quote_status NOT NULL DEFAULT 'DRAFT',
  calculated_price NUMERIC NULL,
  sales_override_price NUMERIC NULL,
  override_reason TEXT NULL,
  target_price NUMERIC NULL,
  soft_discount_price NUMERIC NULL,
  minimum_price NUMERIC NULL,
  draft_data_json JSONB NULL,
  is_latest BOOLEAN NOT NULL DEFAULT TRUE,
  created_by INTEGER NULL REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT quote_versions_group_version_unique UNIQUE (quote_group_id, version_number)
);

CREATE UNIQUE INDEX IF NOT EXISTS quote_versions_latest_unique
  ON quote_versions(quote_group_id)
  WHERE is_latest = true;

CREATE INDEX IF NOT EXISTS quote_versions_group_idx ON quote_versions(quote_group_id);
CREATE INDEX IF NOT EXISTS quote_versions_status_idx ON quote_versions(status);

CREATE TABLE IF NOT EXISTS quote_pricing_items (
  id SERIAL PRIMARY KEY,
  quote_version_id INTEGER NOT NULL REFERENCES quote_versions(id) ON DELETE CASCADE,
  item_type pricing_item_type NOT NULL,
  catalog_id INTEGER NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price NUMERIC NOT NULL,
  total_price NUMERIC NOT NULL
);

CREATE INDEX IF NOT EXISTS quote_pricing_items_version_idx ON quote_pricing_items(quote_version_id);

CREATE TABLE IF NOT EXISTS team_role_catalog (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  price NUMERIC NOT NULL,
  unit_type unit_type NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS deliverable_catalog (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  price NUMERIC NOT NULL,
  unit_type unit_type NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pricing_rules (
  id SERIAL PRIMARY KEY,
  rule_name TEXT NOT NULL,
  conditions_json JSONB NOT NULL,
  default_team_json JSONB NOT NULL,
  default_deliverables_json JSONB NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quote_negotiations (
  id SERIAL PRIMARY KEY,
  quote_version_id INTEGER NOT NULL REFERENCES quote_versions(id) ON DELETE CASCADE,
  type negotiation_type NOT NULL,
  message TEXT NOT NULL,
  created_by INTEGER NULL REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS quote_negotiations_version_idx ON quote_negotiations(quote_version_id);

CREATE TABLE IF NOT EXISTS quote_approvals (
  id SERIAL PRIMARY KEY,
  quote_version_id INTEGER NOT NULL REFERENCES quote_versions(id) ON DELETE CASCADE,
  approved_by INTEGER NULL REFERENCES users(id),
  approved_at TIMESTAMP NULL,
  note TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS quote_approvals_version_idx ON quote_approvals(quote_version_id);

CREATE TABLE IF NOT EXISTS proposal_snapshots (
  id SERIAL PRIMARY KEY,
  quote_version_id INTEGER NOT NULL REFERENCES quote_versions(id) ON DELETE CASCADE,
  proposal_token TEXT NOT NULL UNIQUE,
  snapshot_json JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP NULL,
  view_count INTEGER NOT NULL DEFAULT 0,
  last_viewed_at TIMESTAMP NULL
);

CREATE INDEX IF NOT EXISTS proposal_snapshots_version_idx ON proposal_snapshots(quote_version_id);
