-- ============================================================
-- 20260501_create_projects.sql
-- Lead → Project conversion tables
-- Replaces the legacy empty projects stub (integer PK, 0 rows)
-- with the full UUID-based project management schema.
-- ============================================================

-- Drop the legacy stub table (empty, no FK references)
DROP TABLE IF EXISTS projects CASCADE;

-- ── 1. Projects ─────────────────────────────────────────────
CREATE TABLE projects (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id             INTEGER NOT NULL REFERENCES leads(id),
  quote_group_id      INTEGER REFERENCES quote_groups(id),
  quote_version_id    INTEGER REFERENCES quote_versions(id),
  proposal_snapshot_id INTEGER REFERENCES proposal_snapshots(id),
  name                TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'upcoming',
  start_date          DATE,
  end_date            DATE,
  city                TEXT,
  is_destination      BOOLEAN DEFAULT FALSE,
  project_manager_id  INTEGER REFERENCES users(id),
  notes               TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_projects_lead_id ON projects(lead_id);

-- ── 2. Project Events ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  lead_event_id   INTEGER REFERENCES lead_events(id),
  event_type      TEXT,
  event_date      DATE,
  pax             INTEGER,
  venue           TEXT,
  venue_address   TEXT,
  start_time      TEXT,
  end_time        TEXT,
  slot            TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── 3. Project Team Assignments ─────────────────────────────
CREATE TABLE IF NOT EXISTS project_team_assignments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_event_id  UUID NOT NULL REFERENCES project_events(id) ON DELETE CASCADE,
  user_id           INTEGER NOT NULL REFERENCES users(id),
  role              TEXT NOT NULL,
  call_time         TEXT,
  wrap_time         TEXT,
  notes             TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ── 4. Project Deliverables ─────────────────────────────────
CREATE TABLE IF NOT EXISTS project_deliverables (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  type        TEXT,
  quantity    INTEGER DEFAULT 1,
  due_date    DATE,
  status      TEXT NOT NULL DEFAULT 'pending',
  notes       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── 5. Project Checklist ────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_checklist (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  phase         TEXT NOT NULL,
  is_completed  BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
