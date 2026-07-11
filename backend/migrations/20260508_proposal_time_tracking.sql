-- Add duration tracking to proposal_views
ALTER TABLE proposal_views ADD COLUMN IF NOT EXISTS duration_seconds INTEGER NOT NULL DEFAULT 0;

-- Add running total on the snapshot for quick dashboard reads
ALTER TABLE proposal_snapshots ADD COLUMN IF NOT EXISTS total_time_spent_seconds INTEGER NOT NULL DEFAULT 0;
