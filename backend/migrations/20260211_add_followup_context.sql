ALTER TABLE IF EXISTS lead_followups
  ADD COLUMN IF NOT EXISTS outcome TEXT,
  ADD COLUMN IF NOT EXISTS follow_up_mode TEXT,
  ADD COLUMN IF NOT EXISTS discussed_topics JSONB,
  ADD COLUMN IF NOT EXISTS not_connected_reason TEXT;
