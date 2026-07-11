-- Crew management fields and roles

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS crew_type TEXT,
  ADD COLUMN IF NOT EXISTS is_login_enabled BOOLEAN DEFAULT true;

-- Remove legacy crew-like roles
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM roles WHERE key IN ('photographer', 'cinematographer')) THEN
    DELETE FROM user_roles
    WHERE role_id IN (SELECT id FROM roles WHERE key IN ('photographer', 'cinematographer'));

    DELETE FROM roles
    WHERE key IN ('photographer', 'cinematographer');
  END IF;
END $$;

-- Add new crew role
INSERT INTO roles (key, label)
VALUES ('crew', 'Crew')
ON CONFLICT (key) DO NOTHING;
