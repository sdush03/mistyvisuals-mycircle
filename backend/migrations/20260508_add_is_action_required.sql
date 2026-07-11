-- Add is_action_required flag to notifications
-- This distinguishes critical action items (approvals, rejections, assignments)
-- from informational activity (proposal views, status updates)

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS is_action_required BOOLEAN NOT NULL DEFAULT false;

-- Index for fast sidebar dot count queries
CREATE INDEX IF NOT EXISTS idx_notifications_action_required
  ON notifications(is_action_required, is_read)
  WHERE is_action_required = true AND is_read = false;
