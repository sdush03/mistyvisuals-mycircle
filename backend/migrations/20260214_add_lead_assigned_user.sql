ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS assigned_user_id INTEGER REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_leads_assigned_user_id
  ON leads(assigned_user_id);

-- Backfill existing unassigned leads with a random sales user (if any)
UPDATE leads l
SET assigned_user_id = u.id
FROM LATERAL (
  SELECT id
  FROM users
  WHERE role = 'sales'
  ORDER BY RANDOM()
  LIMIT 1
) u
WHERE l.assigned_user_id IS NULL;
