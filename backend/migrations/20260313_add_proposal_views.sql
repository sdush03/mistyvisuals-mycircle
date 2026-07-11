CREATE TABLE IF NOT EXISTS proposal_views (
  id SERIAL PRIMARY KEY,
  proposal_snapshot_id INTEGER NOT NULL REFERENCES proposal_snapshots(id) ON DELETE CASCADE,
  ip TEXT NULL,
  device TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS proposal_views_snapshot_idx ON proposal_views(proposal_snapshot_id);
CREATE INDEX IF NOT EXISTS proposal_views_created_idx ON proposal_views(created_at);
