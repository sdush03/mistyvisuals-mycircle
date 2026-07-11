CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  role_target VARCHAR(50), -- 'admin', 'sales', 'vendor'
  category VARCHAR(50) NOT NULL, -- 'LEAD', 'PROPOSAL', 'FINANCE', 'VENDOR', 'SYSTEM'
  type VARCHAR(50) NOT NULL DEFAULT 'INFO', -- 'INFO', 'SUCCESS', 'WARNING', 'ERROR'
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  link_url VARCHAR(255),
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  read_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_role_target ON notifications(role_target);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);
